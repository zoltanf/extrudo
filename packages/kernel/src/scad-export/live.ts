/**
 * Live parameters in the exported file (P6-09, ADR-0088 §4–§6): a feature's
 * scalar inputs as OpenSCAD expressions over the parameter variables, and
 * which parameters the written code uses or holds fixed, for the parameter
 * block (`params.ts`).
 */
import {
  type ExtrudoDocument,
  evaluateParameters,
  type Feature,
  type FeatureId,
  type FeatureInputs,
  type ParameterEvaluation,
  parse,
  referencedFeatures,
  references,
} from '@extrudo/core';
import type { CsgInput } from './context';
import { type ExprContext, scadNames, translateExpression } from './expr';
import type { Scalar } from './ir';
import type { ParameterUse } from './params';

/** What the file needs of the document for its parameters. */
export interface ScadParameters {
  doc: ExtrudoDocument;
  expr: ExprContext;
}

export function scadParameters(doc: ExtrudoDocument): ScadParameters {
  const evaluation = evaluateParameters(doc);
  return {
    doc,
    expr: { evaluation, lengthUnit: doc.settings.units, names: scadNames(evaluation) },
  };
}

/** Where an input sits: its feature and name. */
export interface InputOf {
  feature: FeatureId;
  input: string;
}

/** The named model parameter that owns an input, if one does. */
function ownerOf(evaluation: ParameterEvaluation, at: InputOf): string | undefined {
  for (const p of evaluation.parameters.values()) {
    const { owner } = p;
    if (owner.type === 'model' && owner.featureId === at.feature && owner.input === at.input) {
      return p.result.ok ? p.name : undefined;
    }
  }
  return undefined;
}

/**
 * `ScadSource.scalar` over a document's parameters: the variable of the
 * named model parameter the input owns, else its translated expression,
 * else (no translation, or a constant) its value.
 */
export function liveScalar({ expr: ctx }: ScadParameters) {
  return (input: CsgInput, at: InputOf): Scalar => {
    const owner = ownerOf(ctx.evaluation, at);
    if (owner !== undefined) {
      return { expr: ctx.names.get(owner) ?? owner, value: input.value, refs: [owner] };
    }
    const t = translateExpression(input.expr, input.unit, ctx);
    if (!t || t.refs.length === 0) return input.value;
    return { expr: t.code, value: input.value, refs: t.refs };
  };
}

/** The parameters an expression refers to directly: its own name when it owns one. */
function directRefs(
  evaluation: ParameterEvaluation,
  expr: string,
  owns: (name: string) => boolean,
  paramName: string | undefined,
): string[] {
  if (paramName !== undefined && owns(paramName)) return [paramName];
  try {
    return references(parse(expr)).filter((n) => evaluation.parameters.has(n));
  } catch {
    return [];
  }
}

/** Every parameter an input refers to, `skip` aside: its expressions and a sketch's driving dimensions. */
function inputRefs(
  evaluation: ParameterEvaluation,
  feature: Pick<Feature, 'id' | 'inputs'>,
  skip: (input: string) => boolean = () => false,
): string[] {
  const out: string[] = [];
  const owner = (name: string) => evaluation.parameters.get(name)?.owner;
  for (const [input, value] of Object.entries(feature.inputs as FeatureInputs)) {
    if (skip(input)) continue;
    if (value.kind === 'expr') {
      const owns = (name: string) => {
        const o = owner(name);
        return o?.type === 'model' && o.featureId === feature.id && o.input === input;
      };
      out.push(...directRefs(evaluation, value.expr, owns, value.paramName));
    } else if (value.kind === 'sketchData') {
      for (const [id, d] of Object.entries(value.sketch.dimensions)) {
        if (d.driven) continue;
        const owns = (name: string) => {
          const o = owner(name);
          return o?.type === 'dimension' && o.featureId === feature.id && o.dimension === id;
        };
        out.push(...directRefs(evaluation, d.expr, owns, d.paramName));
      }
    }
  }
  return out;
}

/** A step of the written file, as the parameter use reads it. */
export interface WrittenStep {
  feature: Feature;
  /** How the header names it. */
  name: string;
  /** Whether any of its written versions is a mesh. */
  mesh: boolean;
  /** The inputs its hook read through `ctx.scalar`. */
  read: ReadonlySet<string>;
  /** Its place in the walk. */
  at: number;
}

/**
 * Which parameters the written code uses (`used`: every expression's refs)
 * and which it holds fixed (ADR-0088 §5): those an expression of a mesh
 * version's feature, an input a hook didn't read as a scalar, or a body-less
 * feature the written features build on (a sketch, a plane) refers to,
 * directly or through other parameters. Each with its features in timeline
 * order.
 */
export function parameterUse(
  { doc, expr: { evaluation } }: ScadParameters,
  used: Iterable<string>,
  steps: readonly WrittenStep[],
  /** Features that wrote bodies in the walk (written or not). */
  bodyMakers: ReadonlySet<FeatureId>,
): ParameterUse {
  const ids = new Set<string>(doc.features.map((f) => f.id));
  const byId = new Map(doc.features.map((f, i) => [f.id, { feature: f, at: i }]));
  /** Feature name → its timeline position and the parameters it refers to. */
  const holders = new Map<string, { order: number; refs: string[] }>();
  const hold = (name: string, order: number, refs: string[]) => {
    if (refs.length === 0) return;
    const held = holders.get(name) ?? { order, refs: [] };
    held.refs.push(...refs);
    holders.set(name, held);
  };
  /** A step's place in the timeline: its own, or its script's (just after it). */
  const orderOf = (step: WrittenStep) =>
    byId.get(step.feature.id)?.at ??
    (byId.get(step.feature.id.split('.')[0] as FeatureId)?.at ?? 0) + 0.5 + step.at * 1e-6;

  const followed = new Set<FeatureId>();
  const follow = (feature: Pick<Feature, 'id' | 'inputs'>) => {
    for (const id of referencedFeatures(feature, ids)) {
      if (followed.has(id) || bodyMakers.has(id)) continue;
      followed.add(id);
      const found = byId.get(id);
      if (!found) continue;
      hold(found.feature.name, found.at, inputRefs(evaluation, found.feature));
      follow(found.feature);
    }
  };
  for (const step of steps) {
    const skip = step.mesh ? undefined : (input: string) => step.read.has(input);
    hold(step.name, orderOf(step), inputRefs(evaluation, step.feature, skip));
    follow(step.feature);
  }

  /** A parameter and every parameter it refers to, transitively. */
  const closure = (names: readonly string[]): Set<string> => {
    const out = new Set<string>();
    for (const queue = [...names]; queue.length > 0; ) {
      const name = queue.pop() as string;
      if (out.has(name)) continue;
      out.add(name);
      queue.push(...(evaluation.parameters.get(name)?.refs ?? []));
    }
    return out;
  };
  const fixed = new Map<string, string[]>();
  const sorted = [...holders].sort((a, b) => a[1].order - b[1].order);
  for (const [feature, { refs }] of sorted) {
    for (const name of closure(refs)) {
      if (!evaluation.parameters.has(name)) continue;
      const list = fixed.get(name) ?? [];
      if (!list.includes(feature)) list.push(feature);
      fixed.set(name, list);
    }
  }
  return { used, fixed };
}
