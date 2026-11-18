/**
 * Parameter evaluation: the dependency graph of user and model parameters
 * (architecture §4.3, FR-PAR-01, FR-PAR-04).
 *
 * User parameters live in `doc.parameters`. Model parameters are feature
 * inputs of kind `expr` with a `paramName` (`d1`, `d2`…), and driving sketch
 * dimensions with one (P1-07). All share one namespace, and any expression
 * can refer to any of them. Evaluation walks the references depth-first, on
 * a stack of its own, detects cycles and reports them with their path.
 */
import type { DimensionId, FeatureId, ParameterId } from '../ids';
import type { ExtrudoDocument, UnitKind } from '../schema';
import { dimensionUnit } from '../sketch/dimensions';
import { ExprError } from './errors';
import {
  CONSTANTS,
  closest,
  coerce,
  combine,
  type EvaluateResult,
  evaluateNode,
  isReservedName,
  operands,
  type Quantity,
  type Scope,
} from './evaluate';
import { heightOf, type Node, parse, references, type Span } from './parser';

/**
 * How deep parameters may refer to each other: the summed nesting of a chain
 * of parameters, each one's own levels counted (`a + 1` is 2, `a` is 1). Far
 * beyond any design; past it the parameter is an error like any other
 * (ADR-0004, amendment of 2026-11-15).
 */
export const MAX_PARAMETER_DEPTH = 10_000;

/** A cycle's message lists its path while it has at most this many members… */
const MAX_CYCLE_PATH = 20;
/** …and its names take at most this many characters; past that it counts them. */
const MAX_CYCLE_PATH_TEXT = 500;
/**
 * The work "did you mean" suggestions may take: once for the document's own
 * parameters and inputs, and again for each `evaluate()` call.
 */
const SUGGESTION_CELLS = 1_000_000;

/** What a parameter past `MAX_PARAMETER_DEPTH` says. */
export const PARAMETER_DEPTH_MESSAGE = `Nested more than ${MAX_PARAMETER_DEPTH} levels deep through the parameters it uses.`;

export type ParameterOwner =
  | { type: 'user'; id: ParameterId }
  | { type: 'model'; featureId: FeatureId; input: string }
  /** A driving sketch dimension; `input` is the sketch's `sketchData` input. */
  | { type: 'dimension'; featureId: FeatureId; input: string; dimension: DimensionId };

export interface EvaluatedParameter {
  name: string;
  expression: string;
  unit: UnitKind;
  owner: ParameterOwner;
  result: EvaluateResult;
  /** Names this parameter's expression refers to directly (empty if it doesn't parse). */
  refs: string[];
}

export interface ParameterEvaluation {
  /** Every parameter by name, in document order: user parameters, then model parameters. */
  parameters: ReadonlyMap<string, EvaluatedParameter>;
  /** Every `expr` input by feature and input name, named or not. */
  inputs: ReadonlyMap<FeatureId, ReadonlyMap<string, EvaluateResult>>;
  /** Every driving sketch dimension by sketch feature and dimension ID, named or not. */
  dimensions: ReadonlyMap<FeatureId, ReadonlyMap<string, EvaluateResult>>;
  /** Parameters that depend on any of `names`, directly or through others (not `names` themselves). */
  dependents(names: Iterable<string>): Set<string>;
  /**
   * Features to recompute when `names` change: those with an input that refers
   * to one of them or to a dependent, and those that own one of them. In
   * timeline order.
   */
  featuresAffectedBy(names: Iterable<string>): FeatureId[];
  /** Evaluates an extra expression against the current values (for a field being edited). */
  evaluate(expression: string, unit?: UnitKind): EvaluateResult;
}

interface Source {
  name: string;
  expression: string;
  unit: UnitKind;
  owner: ParameterOwner;
}

type Parsed = { ok: true; node: Node; refs: string[] } | { ok: false; error: ExprError };

function parseSafely(expression: string): Parsed {
  try {
    const node = parse(expression);
    return { ok: true, node, refs: references(node).filter((n) => !isReservedName(n)) };
  } catch (error) {
    if (error instanceof ExprError) return { ok: false, error };
    throw error;
  }
}

function sourcesOf(doc: ExtrudoDocument): Source[] {
  const sources: Source[] = doc.parameters.map((p) => ({
    name: p.name,
    expression: p.expression,
    unit: p.unit,
    owner: { type: 'user', id: p.id },
  }));
  for (const feature of doc.features) {
    for (const [input, value] of Object.entries(feature.inputs)) {
      if (value.kind === 'expr' && value.paramName) {
        sources.push({
          name: value.paramName,
          expression: value.expr,
          unit: value.unit ?? 'length',
          owner: { type: 'model', featureId: feature.id, input },
        });
      } else if (value.kind === 'sketchData') {
        for (const [id, d] of Object.entries(value.sketch.dimensions)) {
          if (d.driven || !d.paramName) continue;
          sources.push({
            name: d.paramName,
            expression: d.expr,
            unit: dimensionUnit(d),
            owner: {
              type: 'dimension',
              featureId: feature.id,
              input,
              dimension: id as DimensionId,
            },
          });
        }
      }
    }
  }
  return sources;
}

export function evaluateParameters(doc: ExtrudoDocument): ParameterEvaluation {
  const sources = new Map<string, Source>();
  const duplicates = new Set<Source>();
  for (const source of sourcesOf(doc)) {
    if (sources.has(source.name)) duplicates.add(source);
    else sources.set(source.name, source);
  }
  const parsed = new Map<string, Parsed>();
  const parsedOf = (name: string): Parsed => {
    let p = parsed.get(name);
    if (!p) {
      // biome-ignore lint/style/noNonNullAssertion: only called for known names.
      p = parseSafely(sources.get(name)!.expression);
      parsed.set(name, p);
    }
    return p;
  };

  // Every expression is read before any is evaluated.
  for (const name of sources.keys()) parsedOf(name);

  const results = new Map<string, EvaluateResult>();
  const cycleErrors = new Map<string, ExprError>();
  /** The parameters being evaluated, outermost first. */
  const stack: string[] = [];
  const onStack = new Set<string>();
  /** Each evaluated parameter's deepest chain through the parameters it uses, its own height included. */
  const chains = new Map<string, number>();
  const budget = { cells: SUGGESTION_CELLS };
  /** Where `member`'s expression refers to `next`, or all of it. */
  const spanTo = (member: string, next: string): Span => {
    const own = parsedOf(member);
    return own.ok ? (findRef(own.node, next) ?? own.node.span) : { start: 0, end: 0 };
  };

  const scope: Scope = {
    lookup(name, span) {
      if (!sources.has(name)) return undefined;
      const result = results.get(name) ?? evaluateParameter(name);
      if (result.ok) return { value: result.value, dim: result.dim };
      throw new ExprError(`Uses \`${name}\`, which has an error.`, span);
    },
    names: () => sources.keys(),
    has: (name) => sources.has(name),
    suggest: (name) => closest(name, sources.keys(), budget),
    lengthUnit: doc.settings.units,
  };
  /** A name that refers to a parameter (a constant's name never does). */
  const isParameter = (name: string) => sources.has(name) && !Object.hasOwn(CONSTANTS, name);

  /** Every member of `cycle`, the end of the stack, gets its cycle error. */
  function markCycle(cycle: string[]): void {
    const listed =
      cycle.length <= MAX_CYCLE_PATH &&
      cycle.reduce((n, member) => n + member.length, 0) <= MAX_CYCLE_PATH_TEXT;
    cycle.forEach((member, i) => {
      const next = cycle[(i + 1) % cycle.length] as string;
      const message =
        cycle.length === 1
          ? `\`${member}\` refers to itself.`
          : listed
            ? `\`${member}\` refers to itself: ${[...cycle.slice(i), ...cycle.slice(0, i), member].join(' → ')}.`
            : `\`${member}\` refers to itself through ${cycle.length} parameters.`;
      cycleErrors.set(member, new ExprError(message, spanTo(member, next), 'cycle'));
    });
  }

  /** A parameter's result once its expression has given `result`: depth and cycle checked. */
  function settle(name: string, result: EvaluateResult): EvaluateResult {
    const p = parsedOf(name);
    if (p.ok) {
      // The deepest chain, from those of the parameters it uses: exact when
      // it evaluates, since then it has evaluated every one of them.
      const height = heightOf(p.node);
      let chain = height;
      let deepest = '';
      for (const ref of p.refs) {
        const under = chains.get(ref);
        if (under !== undefined && height + under > chain) {
          chain = height + under;
          deepest = ref;
        }
      }
      chains.set(name, chain);
      if (result.ok && chain > MAX_PARAMETER_DEPTH) {
        const message = PARAMETER_DEPTH_MESSAGE;
        result = { ok: false, error: new ExprError(message, spanTo(name, deepest), 'limit') };
      }
    }
    const cycleError = cycleErrors.get(name);
    if (cycleError) result = { ok: false, error: cycleError };
    results.set(name, result);
    return result;
  }

  /**
   * Evaluates `name`, and each parameter it uses that has no result yet when
   * it is reached, depth-first in the order its expression uses them. The
   * walk keeps its own stack of expression nodes, so a chain of parameters,
   * however long, needs no deeper call stack than one expression.
   */
  function evaluateParameter(name: string): EvaluateResult {
    const done = results.get(name);
    if (done) return done;
    const tasks: { name: string; frames: Frame[] }[] = [];
    /** Starts on `next`, or settles it at once when it doesn't parse; false then. */
    const begin = (next: string): boolean => {
      const p = parsedOf(next);
      if (!p.ok) {
        settle(next, { ok: false, error: p.error });
        return false;
      }
      tasks.push({ name: next, frames: [{ node: p.node, values: [] }] });
      stack.push(next);
      onStack.add(next);
      return true;
    };
    const end = (result: EvaluateResult): void => {
      const task = tasks.pop() as { name: string };
      stack.pop();
      onStack.delete(task.name);
      settle(task.name, result);
    };
    begin(name);
    while (tasks.length > 0) {
      const task = tasks[tasks.length - 1] as { name: string; frames: Frame[] };
      const frame = task.frames[task.frames.length - 1] as Frame;
      let value: Quantity;
      try {
        frame.operands ??= operands(frame.node, scope);
        const next = frame.operands[frame.values.length];
        if (next) {
          task.frames.push({ node: next, values: [] });
          continue;
        }
        const node = frame.node;
        if (node.kind === 'ref' && isParameter(node.name) && !results.has(node.name)) {
          if (onStack.has(node.name)) {
            markCycle(stack.slice(stack.indexOf(node.name)));
            // Unwinds to the members, which then report their cycle error.
            throw new ExprError('cycle', { start: 0, end: 0 });
          }
          if (begin(node.name)) continue;
        }
        value = combine(node, frame.values, scope);
      } catch (error) {
        if (!(error instanceof ExprError)) throw error;
        end({ ok: false, error });
        continue;
      }
      task.frames.pop();
      const parent = task.frames[task.frames.length - 1];
      if (parent) {
        parent.values.push(value);
        continue;
      }
      // biome-ignore lint/style/noNonNullAssertion: only called for known names.
      const source = sources.get(task.name)!;
      const root = (parsedOf(task.name) as { node: Node }).node;
      end(run(() => coerce(value, source.unit, root.span, scope)));
    }
    // biome-ignore lint/style/noNonNullAssertion: just evaluated.
    return results.get(name)!;
  }

  const parameters = new Map<string, EvaluatedParameter>();
  for (const source of sources.values()) {
    const p = parsedOf(source.name);
    parameters.set(source.name, {
      ...source,
      result: evaluateParameter(source.name),
      refs: p.ok ? p.refs : [],
    });
  }

  const evaluateExtra = (
    expression: string,
    unit: UnitKind = 'length',
    within: Scope = scope,
  ): EvaluateResult => {
    const p = parseSafely(expression);
    if (!p.ok) return { ok: false, error: p.error };
    return run(() => coerce(evaluateNode(p.node, within), unit, p.node.span, within));
  };
  /** An expression evaluated on its own (a field being edited), with suggestions of its own. */
  const evaluateOwn = (expression: string, unit: UnitKind = 'length'): EvaluateResult => {
    const own = { cells: SUGGESTION_CELLS };
    return evaluateExtra(expression, unit, {
      ...scope,
      suggest: (name) => closest(name, sources.keys(), own),
    });
  };

  const inputs = new Map<FeatureId, Map<string, EvaluateResult>>();
  const dimensions = new Map<FeatureId, Map<string, EvaluateResult>>();
  const inputRefs = new Map<FeatureId, Set<string>>();
  /** An expression's value and references, through its parameter when it owns one. */
  const resultOf = (
    expression: string,
    unit: UnitKind,
    paramName: string | undefined,
    owns: (owner: ParameterOwner) => boolean,
    refs: Set<string>,
  ): EvaluateResult => {
    const own = paramName !== undefined ? sources.get(paramName) : undefined;
    if (paramName !== undefined && own && owns(own.owner)) {
      refs.add(paramName);
      // biome-ignore lint/style/noNonNullAssertion: every source has a result.
      return results.get(paramName)!;
    }
    const p = parseSafely(expression);
    if (p.ok) for (const ref of p.refs) refs.add(ref);
    return evaluateExtra(expression, unit);
  };
  for (const feature of doc.features) {
    const featureInputs = new Map<string, EvaluateResult>();
    const refs = new Set<string>();
    for (const [input, value] of Object.entries(feature.inputs)) {
      if (value.kind === 'sketchData') {
        const values = new Map<string, EvaluateResult>();
        for (const [id, d] of Object.entries(value.sketch.dimensions)) {
          if (d.driven) continue;
          const owns = (o: ParameterOwner) =>
            o.type === 'dimension' && o.featureId === feature.id && o.dimension === id;
          values.set(id, resultOf(d.expr, dimensionUnit(d), d.paramName, owns, refs));
        }
        dimensions.set(feature.id, values);
      }
      if (value.kind !== 'expr') continue;
      const owns = (o: ParameterOwner) =>
        o.type === 'model' && o.featureId === feature.id && o.input === input;
      featureInputs.set(
        input,
        resultOf(value.expr, value.unit ?? 'length', value.paramName, owns, refs),
      );
    }
    inputs.set(feature.id, featureInputs);
    inputRefs.set(feature.id, refs);
  }

  for (const source of duplicates) {
    const error = new ExprError(`The name \`${source.name}\` is used twice.`, {
      start: 0,
      end: source.expression.length,
    });
    if (source.owner.type === 'model') {
      inputs.get(source.owner.featureId)?.set(source.owner.input, { ok: false, error });
    } else if (source.owner.type === 'dimension') {
      dimensions.get(source.owner.featureId)?.set(source.owner.dimension, { ok: false, error });
    }
  }

  /** The parameters that refer to each name directly, in document order. */
  let users: Map<string, string[]> | undefined;
  /** Made when first asked for: most evaluations never ask what depends on what. */
  const usersByName = (): Map<string, string[]> => {
    if (users) return users;
    users = new Map();
    for (const p of parameters.values()) {
      for (const ref of p.refs) {
        const direct = users.get(ref);
        if (direct) direct.push(p.name);
        else users.set(ref, [p.name]);
      }
    }
    return users;
  };

  const dependents = (names: Iterable<string>): Set<string> => {
    const byName = usersByName();
    const found = new Set<string>();
    const queue = [...names];
    const start = new Set(queue);
    /** A name given twice is followed once. */
    const followed = new Set<string>();
    while (queue.length > 0) {
      const name = queue.pop() as string;
      if (followed.has(name)) continue;
      followed.add(name);
      for (const user of byName.get(name) ?? []) {
        if (!found.has(user) && !start.has(user)) {
          found.add(user);
          queue.push(user);
        }
      }
    }
    return found;
  };

  return {
    parameters,
    inputs,
    dimensions,
    dependents,
    featuresAffectedBy(names) {
      const changed = new Set(names);
      for (const d of dependents(changed)) changed.add(d);
      return doc.features
        .filter((f) => [...(inputRefs.get(f.id) ?? [])].some((ref) => changed.has(ref)))
        .map((f) => f.id);
    },
    evaluate: evaluateOwn,
  };
}

/** One expression node being evaluated: its operands and the values of those done. */
interface Frame {
  node: Node;
  operands?: readonly Node[];
  values: Quantity[];
}

function run(fn: () => Quantity): EvaluateResult {
  try {
    const q = fn();
    return { ok: true, value: q.value, dim: q.dim };
  } catch (error) {
    if (error instanceof ExprError) return { ok: false, error };
    throw error;
  }
}

/** Where an expression first refers to `name`, if it does. */
export function findRef(node: Node, name: string): Span | undefined {
  switch (node.kind) {
    case 'ref':
      return node.name === name ? node.span : undefined;
    case 'unary':
      return findRef(node.arg, name);
    case 'binary':
      return findRef(node.left, name) ?? findRef(node.right, name);
    case 'call':
      for (const arg of node.args) {
        const span = findRef(arg, name);
        if (span) return span;
      }
      return undefined;
    case 'num':
      return undefined;
  }
}

/** A free model-parameter name: `d` plus one more than the highest `dN` in use. */
export function nextModelParameterName(doc: ExtrudoDocument): string {
  let highest = 0;
  for (const { name } of sourcesOf(doc)) {
    const match = /^d(\d+)$/.exec(name);
    if (match) highest = Math.max(highest, Number(match[1]));
  }
  return `d${highest + 1}`;
}

/**
 * The lowest free `dN`: what "reset name" gives a renamed model parameter
 * (ADR-0142). Usually its original, since auto names are handed out upwards
 * and its own was freed by the rename.
 */
export function lowestFreeModelParameterName(doc: ExtrudoDocument): string {
  const used = parameterNames(doc);
  let n = 1;
  while (used.has(`d${n}`)) n++;
  return `d${n}`;
}

/** Every parameter name in use, user and model. */
export function parameterNames(doc: ExtrudoDocument): Set<string> {
  return new Set(sourcesOf(doc).map((s) => s.name));
}

/**
 * Every parameter that evaluates, by name, in base units: what a script's or
 * plugin's `params` holds (ADR-0070 §2). The object has no prototype, so a
 * parameter named `__proto__` is a value like any other and a name the design
 * doesn't have (`constructor`) reads as undefined.
 */
export function valuesByName(evaluation: ParameterEvaluation): Record<string, number> {
  const values: Record<string, number> = Object.create(null);
  for (const [name, parameter] of evaluation.parameters) {
    if (parameter.result.ok) values[name] = parameter.result.value;
  }
  return values;
}

const nameAt = (name: string) =>
  new RegExp(`(?<![A-Za-z0-9_.])${name}(?![A-Za-z0-9_])(?!\\s*\\()`, 'g');

/**
 * Whether `expression` refers to `name`. Works on expressions that don't
 * parse too (they may still refer to it once fixed).
 */
export function mentions(expression: string, name: string): boolean {
  return nameAt(name).test(expression);
}

/** Replaces references to `from` with `to`, leaving function calls and other names alone. */
export function renameReferences(expression: string, from: string, to: string): string {
  return expression.replace(nameAt(from), to);
}
