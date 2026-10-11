/**
 * The macro emitter (P5-05 slice 1, ADR-0073): `emitScript(doc)` writes the
 * TypeScript that adds a document's features again. The document already is
 * the record — every UI action left its result in it — so the macro is not a
 * log of events but the inverse of the API: a stored feature becomes the call
 * that makes it.
 *
 * ```
 * const code = emitScript(doc);                       // the whole design
 * const run = emitScript(doc, { features: ['f4', 'f9'] }); // one run of the timeline
 * ```
 *
 * The output runs against a `Design` or inside a Script feature's `design`
 * (ADR-0070), which is why the design variable is `design`. It is formatted
 * the way Biome formats TypeScript, so a macro pasted into a Script reads like
 * the rest of the repository (the test runs `biome format` and expects no
 * change).
 */
import {
  type Component,
  type ComponentId,
  type ExtrudoDocument,
  type Feature,
  type FeatureDefinition,
  type FeatureInputs,
  type GeomRef,
  type Joint,
  type JointId,
  readSketch,
  SKETCH_TYPE,
  scriptOfGenerated,
} from '@extrudo/core';
import type { EmitContext, SketchView } from './emit/context';
import { definitionOf } from './emit/context';
import {
  arr,
  bool,
  call,
  comment,
  constant,
  type Expr,
  num,
  obj,
  printProgram,
  raw,
  type Stmt,
  statement,
  str,
} from './emit/print';
import { refExpr } from './emit/refs';
import { sketchExpr } from './emit/sketch';
import { inferUnit } from './expr';
import { compact, inputMeta } from './inputs';

export interface EmitOptions {
  /**
   * The contiguous run of the timeline to emit, as `[from, to]` (indices or
   * feature IDs, inclusive). The whole timeline when left out.
   */
  features?: readonly [number | string, number | string];
  /**
   * Emit the design's own parameters. Defaults to true for the whole design
   * and false for a run (a run sits inside a design that has them).
   */
  parameters?: boolean;
}

/** A document as the TypeScript that builds it again. */
export function emitScript(doc: ExtrudoDocument, options: EmitOptions = {}): string {
  const { features, start, whole } = selectionOf(doc, options);
  // A feature that reads an attachment can't run in a script (ADR-0073): it is
  // left out with a comment, and the references to it stay stored names.
  const skipped = new Set(
    features.filter((feature) => hasAttachmentInput(feature)).map((feature) => feature.id),
  );
  const varOf = new Map<string, string>();
  const used = new Set<string>();
  const featureById = new Map(doc.features.map((feature) => [feature.id, feature]));
  const selectedIds = new Set(features.map((feature) => feature.id));
  // Components first (ADR-0081 §9): a whole design emits every component, a run
  // only the ones its features stamp or its bodies join.
  const components = selectedComponents(doc, features, selectedIds, whole);
  const componentOf = new Map<ComponentId, string>();
  for (const component of components) {
    componentOf.set(component.id, uniqueVariable(variableBase(component.name, 'component'), used));
  }
  for (const feature of features) {
    if (skipped.has(feature.id)) continue;
    varOf.set(feature.id, uniqueVariable(variableBase(feature.name, feature.type), used));
  }
  // Joints follow the features (ADR-0081 §9).
  const joints = selectedJoints(doc, componentOf, whole);
  const jointOf = new Map<JointId, string>();
  for (const joint of joints) {
    jointOf.set(joint.id, uniqueVariable(variableBase(joint.name, 'joint'), used));
  }
  const sketchOf = new Map<string, SketchView>();
  for (const feature of features) {
    if (feature.type !== SKETCH_TYPE) continue;
    const view = readSketch(feature);
    if (view) sketchOf.set(feature.id, view);
  }
  const ctx: EmitContext = {
    doc,
    selected: new Set(features.filter((feature) => !skipped.has(feature.id)).map((f) => f.id)),
    varOf,
    componentOf,
    jointOf,
    featureById,
    sketchOf,
    definition: definitionOf,
    // A whole design keeps the names; a run replays into a live design.
    preserveParamNames: whole,
  };

  const statements: Stmt[] = [];
  if (options.parameters ?? whole) statements.push(...parameterStatements(doc));
  for (const component of components) {
    statements.push(
      constant(
        componentOf.get(component.id) as string,
        call('design.component', [str(component.name)]),
      ),
    );
  }
  const names = defaultNames(doc, start);
  for (const feature of features) {
    if (skipped.has(feature.id)) {
      statements.push(
        comment(`${feature.name} reads an attachment, which a script can't carry: add it by hand.`),
      );
      continue;
    }
    const definition = definitionOf(feature.type);
    const label = definition?.label ?? feature.type;
    const nameOption = feature.name === names.next(label) ? undefined : feature.name;
    const componentVar =
      feature.component === undefined ? undefined : componentOf.get(feature.component);
    statements.push(featureStatement(feature, nameOption, componentVar, ctx));
    if (feature.suppressed)
      statements.push(statement(call('design.suppress', [raw(varOf.get(feature.id) as string)])));
  }
  statements.push(...groupStatements(doc, ctx));
  statements.push(...membershipStatements(doc, features, componentOf, ctx));
  statements.push(...jointStatements(joints, ctx));
  return printProgram(statements);
}

/** The components to emit: all, or a run's stamped/joined ones (ADR-0081 §9). */
function selectedComponents(
  doc: ExtrudoDocument,
  features: readonly Feature[],
  selectedIds: ReadonlySet<string>,
  whole: boolean,
): Component[] {
  const all = doc.components ?? [];
  if (whole) return [...all];
  const wanted = new Set<ComponentId>();
  for (const feature of features) {
    if (feature.component) wanted.add(feature.component);
  }
  for (const [bodyId, meta] of Object.entries(doc.bodies)) {
    if (!meta.component) continue;
    const owner = featureOfBody(doc, bodyId);
    if (owner && selectedIds.has(owner.id)) wanted.add(meta.component);
  }
  return all.filter((component) => wanted.has(component.id));
}

/** The joints to emit: all, or a run's whose two components are emitted. */
function selectedJoints(
  doc: ExtrudoDocument,
  componentOf: ReadonlyMap<ComponentId, string>,
  whole: boolean,
): Joint[] {
  return (doc.joints ?? []).filter(
    (joint) => whole || (componentOf.has(joint.a.component) && componentOf.has(joint.b.component)),
  );
}

/** The feature that made a body, through a Script's generated ID (ADR-0070). */
function featureOfBody(doc: ExtrudoDocument, bodyId: string): Feature | undefined {
  const at = bodyId.lastIndexOf(':');
  const id = at <= 0 ? bodyId : bodyId.slice(0, at);
  const own = doc.features.find((feature) => feature.id === id);
  if (own) return own;
  const script = scriptOfGenerated(id, new Set(doc.features.map((feature) => feature.id)));
  return script === undefined ? undefined : doc.features.find((feature) => feature.id === script);
}

/**
 * The `lid.add(design.ref('body', …))` calls that give each stored membership
 * its component (ADR-0081 §9). The API stores no body metadata on its own, so
 * every stored membership is emitted here, whether the making feature's stamp
 * would give it anyway or not.
 */
function membershipStatements(
  doc: ExtrudoDocument,
  features: readonly Feature[],
  componentOf: ReadonlyMap<ComponentId, string>,
  ctx: EmitContext,
): Stmt[] {
  const selected = new Set(features.map((feature) => feature.id));
  const statements: Stmt[] = [];
  for (const [bodyId, meta] of Object.entries(doc.bodies)) {
    if (!meta.component) continue;
    const variable = componentOf.get(meta.component);
    if (!variable) continue;
    const owner = featureOfBody(doc, bodyId);
    if (owner && !selected.has(owner.id)) continue;
    statements.push(
      statement(call(`${variable}.add`, [refExpr({ kind: 'body', id: bodyId }, ctx)])),
    );
  }
  return statements;
}

/** The `design.joint('Hinge', …)` calls (ADR-0081 §9). */
function jointStatements(joints: readonly Joint[], ctx: EmitContext): Stmt[] {
  const statements: Stmt[] = [];
  for (const joint of joints) {
    const options: [string, Expr][] = [
      ['type', str(joint.type)],
      ['a', jointFrameExpr(joint.a, ctx)],
      ['b', jointFrameExpr(joint.b, ctx)],
    ];
    if (joint.min) options.push(['min', str(joint.min.expr)]);
    if (joint.max) options.push(['max', str(joint.max.expr)]);
    if (joint.flip) options.push(['flip', bool(true)]);
    if (joint.suppressed) options.push(['suppressed', bool(true)]);
    statements.push(
      constant(
        ctx.jointOf.get(joint.id) as string,
        call('design.joint', [str(joint.name), obj(options)]),
      ),
    );
  }
  return statements;
}

/** One joint side as `{ component: leaf, frame: … }`. */
function jointFrameExpr(frame: Joint['a'], ctx: EmitContext): Expr {
  const component = ctx.componentOf.get(frame.component) ?? 'undefined';
  return obj([
    ['component', raw(component)],
    ['frame', refExpr(frame.ref, ctx)],
  ]);
}

/** A variable name that is not taken yet ("lid", "lid2"…). */
function uniqueVariable(base: string, used: Set<string>): string {
  let name = base;
  let n = 2;
  while (used.has(name)) name = `${base}${n++}`;
  used.add(name);
  return name;
}

/** The features a call emits, and whether it is the whole timeline. */
function selectionOf(
  doc: ExtrudoDocument,
  options: EmitOptions,
): { features: Feature[]; start: number; whole: boolean } {
  if (!options.features) return { features: [...doc.features], start: 0, whole: true };
  const index = (value: number | string): number => {
    if (typeof value === 'number') {
      if (value < 0 || value >= doc.features.length)
        throw new Error(`No feature at index ${value}.`);
      return value;
    }
    const at = doc.features.findIndex((feature) => feature.id === value);
    if (at < 0) throw new Error(`There is no feature "${value}".`);
    return at;
  };
  const from = index(options.features[0]);
  const to = index(options.features[1]);
  if (from > to) throw new Error('Emit a run from the first feature to the last one.');
  return { features: doc.features.slice(from, to + 1), start: from, whole: false };
}

/** One feature as its call and (through `nameOption`) its name. */
function featureStatement(
  feature: Feature,
  nameOption: string | undefined,
  componentVar: string | undefined,
  ctx: EmitContext,
): Stmt {
  const variable = ctx.varOf.get(feature.id) as string;
  const expression =
    feature.type === SKETCH_TYPE
      ? sketchExpr(feature, nameOption, componentVar, ctx)
      : call(
          `design.${methodOf(feature.type)}`,
          callArguments(feature, nameOption, componentVar, ctx),
        );
  const base = variableBase(feature.name, feature.type);
  const nameComment = variable === base ? undefined : `// ${feature.name}`;
  return constant(variable, expression, nameComment);
}

/** The method a feature type's call uses (`remove` and `move` are renamed). */
function methodOf(type: string): string {
  if (type === 'remove') return 'removeBodies';
  if (type === 'move') return 'moveBodies';
  return type;
}

/** The arguments of a feature's call: its inputs and, when needed, its options. */
function callArguments(
  feature: Feature,
  nameOption: string | undefined,
  componentVar: string | undefined,
  ctx: EmitContext,
): Expr[] {
  const definition = ctx.definition(feature.type);
  const args: Expr[] = [];
  const inputs = Object.entries(compact(feature.inputs));
  if (inputs.length > 0) {
    args.push(
      obj(
        inputs.map(
          ([name, input]) =>
            [name, inputExpr(feature.type, definition, name, input, ctx)] as [string, Expr],
        ),
      ),
    );
  }
  const options: [string, Expr][] = [];
  if (componentVar !== undefined) options.push(['component', raw(componentVar)]);
  if (nameOption !== undefined) options.push(['name', str(nameOption)]);
  // The options are the second argument: an empty inputs object holds its place.
  if (options.length > 0) args.push(...(args.length === 0 ? [obj([])] : []), obj(options));
  return args;
}

/** One stored input as the plain value its method takes (ADR-0068 §3). */
function inputExpr(
  type: string,
  definition: FeatureDefinition | undefined,
  name: string,
  input: FeatureInputs[string],
  ctx: EmitContext,
): Expr {
  switch (input.kind) {
    case 'expr':
      // A whole design keeps a stored input's own parameter name (`d1`), so an
      // expression that reads it resolves after the round trip (ADR-0073 §2);
      // a run leaves it to the surrounding design (see `preserveParamNames`).
      if (input.paramName !== undefined && ctx.preserveParamNames) {
        return obj([
          ['expr', str(input.expr)],
          ['paramName', str(input.paramName)],
        ]);
      }
      return str(input.expr);
    case 'enum':
      return str(input.value);
    case 'bool':
      return bool(input.value);
    case 'file':
      // A feature with a file input is skipped before this runs; a call to it
      // directly is a programming mistake, so say what happened.
      throw new Error(`${type}.${name} reads an attachment, which a script can't carry.`);
    case 'labels':
      return arr(input.labels.map((label) => str(label)));
    case 'code':
      return str(input.value);
    case 'ref': {
      const meta = definition ? inputMeta(definition, name) : undefined;
      const single = meta?.kind === 'ref' && meta.max === 1;
      if (input.refs.length === 0) return arr([]);
      if (single) return refExpr(input.refs[0] as GeomRef, ctx);
      return arr(input.refs.map((ref) => refExpr(ref, ctx)));
    }
    case 'sketchData':
      throw new Error(`${type}.${name} is a sketch's content; only a sketch feature has one.`);
    default:
      // Only reachable with a hand-mangled document: name the input rather
      // than crash the printer with `undefined`.
      throw new Error(
        `${type}.${name} has an input kind the emitter doesn't know: ${String((input as { kind?: unknown }).kind)}.`,
      );
  }
}

/** Whether a feature reads a file of the design (an import, a canvas image). */
function hasAttachmentInput(feature: Feature): boolean {
  return Object.values(feature.inputs).some((input) => input.kind === 'file');
}

/** The `design.group(...)` calls for groups that lie inside the selection. */
function groupStatements(doc: ExtrudoDocument, ctx: EmitContext): Stmt[] {
  const statements: Stmt[] = [];
  for (const group of doc.groups ?? []) {
    if (!ctx.selected.has(group.first) || !ctx.selected.has(group.last)) continue;
    const options: [string, Expr][] = [['name', str(group.name)]];
    if (group.collapsed) options.push(['collapsed', bool(true)]);
    statements.push(
      statement(
        call('design.group', [
          raw(ctx.varOf.get(group.first) as string),
          raw(ctx.varOf.get(group.last) as string),
          obj(options),
        ]),
      ),
    );
  }
  return statements;
}

/** The `design.parameter(...)` calls, in dependency order. */
function parameterStatements(doc: ExtrudoDocument): Stmt[] {
  const byName = new Map(doc.parameters.map((parameter) => [parameter.name, parameter]));
  const ordered: typeof doc.parameters = [];
  const visited = new Set<string>();
  const visit = (name: string): void => {
    if (visited.has(name)) return;
    visited.add(name);
    const parameter = byName.get(name);
    if (!parameter) return;
    const dependencies = [...byName.keys()].filter(
      (other) =>
        other !== name &&
        new RegExp(`(^|[^A-Za-z0-9_])${escapeRegExp(other)}([^A-Za-z0-9_]|$)`).test(
          parameter.expression,
        ),
    );
    for (const dependency of dependencies) visit(dependency);
    ordered.push(parameter);
  };
  for (const name of byName.keys()) visit(name);
  return ordered.map((parameter) =>
    statement(call('design.parameter', parameterArguments(parameter))),
  );
}

function parameterArguments(parameter: ExtrudoDocument['parameters'][number]): Expr[] {
  const args: Expr[] = [str(parameter.name), str(parameter.expression)];
  const options: [string, Expr][] = [];
  if (parameter.unit !== inferUnit(parameter.expression))
    options.push(['unit', str(parameter.unit)]);
  if (parameter.comment !== undefined) options.push(['comment', str(parameter.comment)]);
  if (parameter.customizer) options.push(['customizer', customizerExpr(parameter.customizer)]);
  if (options.length > 0) args.push(obj(options));
  return args;
}

function customizerExpr(
  customizer: NonNullable<ExtrudoDocument['parameters'][number]['customizer']>,
): Expr {
  const props: [string, Expr][] = [];
  if (customizer.min !== undefined) props.push(['min', num(customizer.min)]);
  if (customizer.max !== undefined) props.push(['max', num(customizer.max)]);
  if (customizer.step !== undefined) props.push(['step', num(customizer.step)]);
  if (customizer.group !== undefined) props.push(['group', str(customizer.group)]);
  return obj(props);
}

/** The defaults `nextFeatureName` would assign, seeded from the features before the run. */
function defaultNames(doc: ExtrudoDocument, start: number): { next(label: string): string } {
  const counts = new Map<string, number>();
  for (const feature of doc.features.slice(0, start)) {
    const definition = definitionOf(feature.type);
    const label = definition?.label ?? feature.type;
    const match = new RegExp(`^${escapeRegExp(label)}(\\d+)$`).exec(feature.name);
    if (match) counts.set(label, Math.max(counts.get(label) ?? 0, Number(match[1])));
  }
  return {
    next(label: string): string {
      const value = (counts.get(label) ?? 0) + 1;
      counts.set(label, value);
      return `${label}${value}`;
    },
  };
}

/** A feature's name as a variable: "Rectangular Pattern1" → "rectangularPattern1". */
function camelCase(name: string): string {
  const parts = name.split(/[^A-Za-z0-9]+/).filter((part) => part.length > 0);
  const [first, ...rest] = parts;
  if (first === undefined) return '';
  const head = first.charAt(0).toLowerCase() + first.slice(1);
  return `${head}${rest.map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join('')}`;
}

/**
 * Words a variable may not be: JavaScript reserved words (a feature may be
 * typed `import`) and the emitter's own globals, `design` (the Script sandbox)
 * and `k` (a sketch's builder). A reserved name or one that would start with a
 * digit gets a leading underscore.
 */
const RESERVED_VARIABLES = new Set([
  'await',
  'break',
  'case',
  'catch',
  'class',
  'const',
  'continue',
  'debugger',
  'default',
  'delete',
  'do',
  'else',
  'enum',
  'export',
  'extends',
  'false',
  'finally',
  'for',
  'function',
  'if',
  'import',
  'in',
  'instanceof',
  'let',
  'new',
  'null',
  'package',
  'private',
  'protected',
  'public',
  'return',
  'static',
  'super',
  'switch',
  'this',
  'throw',
  'true',
  'try',
  'typeof',
  'var',
  'void',
  'while',
  'with',
  'yield',
  'design',
  'k',
]);

/** A valid, non-reserved variable name for a feature. */
function variableBase(name: string, type: string): string {
  const base = camelCase(name) || camelCase(type) || 'feature';
  return /^[0-9]/.test(base) || RESERVED_VARIABLES.has(base) ? `_${base}` : base;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
