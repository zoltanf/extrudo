/**
 * Parameter evaluation: the dependency graph of user and model parameters
 * (architecture §4.3, FR-PAR-01, FR-PAR-04).
 *
 * User parameters live in `doc.parameters`. Model parameters are feature
 * inputs of kind `expr` with a `paramName` (`d1`, `d2`…). Both share one
 * namespace, and any expression can refer to either. Evaluation walks the
 * references depth-first, detects cycles and reports them with their path.
 */
import type { FeatureId, ParameterId } from '../ids';
import type { ExtrudoDocument, UnitKind } from '../schema';
import { ExprError } from './errors';
import {
  coerce,
  type EvaluateResult,
  evaluateNode,
  isReservedName,
  type Quantity,
  type Scope,
} from './evaluate';
import { type Node, parse, references, type Span } from './parser';

export type ParameterOwner =
  | { type: 'user'; id: ParameterId }
  | { type: 'model'; featureId: FeatureId; input: string };

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

  const results = new Map<string, EvaluateResult>();
  const cycleErrors = new Map<string, ExprError>();
  const stack: string[] = [];

  const scope: Scope = {
    lookup(name, span) {
      if (!sources.has(name)) return undefined;
      const result = evaluateParameter(name);
      if (result.ok) return { value: result.value, dim: result.dim };
      throw new ExprError(`Uses \`${name}\`, which has an error.`, span);
    },
    names: () => sources.keys(),
    lengthUnit: doc.settings.units,
  };

  function evaluateParameter(name: string): EvaluateResult {
    const done = results.get(name);
    if (done) return done;
    const at = stack.indexOf(name);
    if (at >= 0) {
      const cycle = stack.slice(at);
      cycle.forEach((member, i) => {
        const path = [...cycle.slice(i), ...cycle.slice(0, i), member];
        const next = path[1] as string;
        const own = parsedOf(member);
        const span = own.ok ? (findRef(own.node, next) ?? own.node.span) : { start: 0, end: 0 };
        cycleErrors.set(
          member,
          new ExprError(
            path.length === 2
              ? `\`${member}\` refers to itself.`
              : `\`${member}\` refers to itself: ${path.join(' → ')}.`,
            span,
          ),
        );
      });
      // Unwinds to the members, which then report their cycle error.
      throw new ExprError('cycle', { start: 0, end: 0 });
    }
    // biome-ignore lint/style/noNonNullAssertion: only called for known names.
    const source = sources.get(name)!;
    const p = parsedOf(name);
    let result: EvaluateResult;
    if (!p.ok) {
      result = { ok: false, error: p.error };
    } else {
      stack.push(name);
      result = run(() => coerce(evaluateNode(p.node, scope), source.unit, p.node.span, scope));
      stack.pop();
    }
    const cycleError = cycleErrors.get(name);
    if (cycleError) result = { ok: false, error: cycleError };
    results.set(name, result);
    return result;
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

  const evaluateExtra = (expression: string, unit: UnitKind = 'length'): EvaluateResult => {
    const p = parseSafely(expression);
    if (!p.ok) return { ok: false, error: p.error };
    return run(() => coerce(evaluateNode(p.node, scope), unit, p.node.span, scope));
  };

  const inputs = new Map<FeatureId, Map<string, EvaluateResult>>();
  const inputRefs = new Map<FeatureId, Set<string>>();
  for (const feature of doc.features) {
    const featureInputs = new Map<string, EvaluateResult>();
    const refs = new Set<string>();
    for (const [input, value] of Object.entries(feature.inputs)) {
      if (value.kind !== 'expr') continue;
      const own = value.paramName !== undefined && sources.get(value.paramName);
      const isOwner =
        own &&
        own.owner.type === 'model' &&
        own.owner.featureId === feature.id &&
        own.owner.input === input;
      if (value.paramName !== undefined && isOwner) {
        // biome-ignore lint/style/noNonNullAssertion: every source has a result.
        featureInputs.set(input, results.get(value.paramName)!);
        refs.add(value.paramName);
      } else {
        featureInputs.set(input, evaluateExtra(value.expr, value.unit ?? 'length'));
        const p = parseSafely(value.expr);
        if (p.ok) for (const ref of p.refs) refs.add(ref);
      }
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
    }
  }

  const dependents = (names: Iterable<string>): Set<string> => {
    const found = new Set<string>();
    const queue = [...names];
    const start = new Set(queue);
    while (queue.length > 0) {
      const name = queue.pop() as string;
      for (const p of parameters.values()) {
        if (p.refs.includes(name) && !found.has(p.name) && !start.has(p.name)) {
          found.add(p.name);
          queue.push(p.name);
        }
      }
    }
    return found;
  };

  return {
    parameters,
    inputs,
    dependents,
    featuresAffectedBy(names) {
      const changed = new Set(names);
      for (const d of dependents(changed)) changed.add(d);
      return doc.features
        .filter((f) => [...(inputRefs.get(f.id) ?? [])].some((ref) => changed.has(ref)))
        .map((f) => f.id);
    },
    evaluate: evaluateExtra,
  };
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

function findRef(node: Node, name: string): Span | undefined {
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

/** Every parameter name in use, user and model. */
export function parameterNames(doc: ExtrudoDocument): Set<string> {
  return new Set(sourcesOf(doc).map((s) => s.name));
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
