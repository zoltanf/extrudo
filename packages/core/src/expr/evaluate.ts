/**
 * Expression evaluation with dimensional analysis (FR-PAR-02).
 *
 * Plain numbers ("bare" values: literals and arithmetic of literals only) take
 * the unit of their context, so `width + 2` adds 2 in the document's length
 * unit and `sin(30)` means 30°. Everything else must match: `10 mm + 5 deg` is
 * an error, and so is a unitless parameter used where a length is needed.
 */
import type { LengthUnit, UnitKind } from '../schema';
import { ExprError } from './errors';
import { type Node, parse, type Span } from './parser';
import {
  ANGLE,
  type Dim,
  describeDim,
  dimOfKind,
  isUnitless,
  lengthFactor,
  mulDim,
  ownEntry,
  sameDim,
  scaleDim,
  UNITLESS,
  UNITS,
  unitNamed,
} from './units';

/** A value in base units (mm, deg) with its dimension. */
export interface Quantity {
  value: number;
  dim: Dim;
  /** A plain number: a literal, or arithmetic of literals only. Takes its context's unit. */
  bare?: boolean;
}

export interface Scope {
  /** A parameter's value, or undefined if there is no such name. May throw `ExprError`. */
  lookup(name: string, span: Span): Quantity | undefined;
  /** Known names, for "did you mean" suggestions. */
  names(): Iterable<string>;
  /** Whether `name` is a known name; `names()` is searched without it. */
  has?(name: string): boolean;
  /** The suggestion for an unknown name; `closest(name, names())` without it. */
  suggest?(name: string): string | undefined;
  /** The document's length unit: plain numbers in a length context use it. */
  lengthUnit: LengthUnit;
}

export const CONSTANTS: Readonly<Record<string, Quantity>> = {
  pi: { value: Math.PI, dim: UNITLESS },
};

type Fn = (args: Quantity[], call: Extract<Node, { kind: 'call' }>, scope: Scope) => Quantity;

const TO_RAD = Math.PI / 180;

function trig(name: string, fn: (rad: number) => number): Fn {
  return ([x], call) => {
    const arg = x as Quantity;
    let rad: number;
    if (sameDim(arg.dim, ANGLE)) rad = arg.value * TO_RAD;
    else if (isUnitless(arg.dim)) rad = arg.bare ? arg.value * TO_RAD : arg.value;
    else throw new ExprError(`\`${name}\` needs an angle, not ${describeDim(arg.dim)}.`, call.span);
    return { value: fn(rad), dim: UNITLESS };
  };
}

function inverseTrig(name: string, fn: (x: number) => number): Fn {
  return ([x], call) => {
    const arg = x as Quantity;
    if (!isUnitless(arg.dim)) {
      throw new ExprError(`\`${name}\` needs a number, not ${describeDim(arg.dim)}.`, call.span);
    }
    const rad = fn(arg.value);
    if (Number.isNaN(rad)) {
      throw new ExprError(`\`${name}\` needs a value between -1 and 1.`, call.span);
    }
    return { value: rad / TO_RAD, dim: ANGLE };
  };
}

/** Rounds in display units: the document's length unit, degrees. */
function rounding(fn: (x: number) => number): Fn {
  return ([x], _call, scope) => {
    const arg = x as Quantity;
    const unit = lengthFactor(scope.lengthUnit) ** arg.dim.length;
    return { ...arg, value: fn(arg.value / unit) * unit };
  };
}

function extreme(name: string, pick: (a: number, b: number) => number): Fn {
  return (args, call, scope) => {
    const dim = args.find((a) => !isUnitless(a.dim) || !a.bare)?.dim ?? UNITLESS;
    const values = args.map((a, i) =>
      matchDim(a, dim, scope, (from, to) => {
        const span = call.args[i]?.span ?? call.span;
        return new ExprError(`\`${name}\` can't compare ${from} with ${to}.`, span);
      }),
    );
    return {
      value: values.reduce((a, b) => pick(a, b.value), values[0]?.value ?? 0),
      dim,
      bare: args.every((a) => a.bare),
    };
  };
}

const FUNCTIONS: Readonly<Record<string, { arity: number | 'many'; fn: Fn }>> = {
  sin: { arity: 1, fn: trig('sin', Math.sin) },
  cos: { arity: 1, fn: trig('cos', Math.cos) },
  tan: { arity: 1, fn: trig('tan', Math.tan) },
  asin: { arity: 1, fn: inverseTrig('asin', Math.asin) },
  acos: { arity: 1, fn: inverseTrig('acos', Math.acos) },
  atan: { arity: 1, fn: inverseTrig('atan', Math.atan) },
  sqrt: {
    arity: 1,
    fn: ([x], call) => {
      const arg = x as Quantity;
      if (arg.dim.length % 2 !== 0 || arg.dim.angle % 2 !== 0) {
        throw new ExprError(`Can't take the square root of ${describeDim(arg.dim)}.`, call.span);
      }
      if (arg.value < 0) {
        throw new ExprError(`Can't take the square root of a negative number.`, call.span);
      }
      return { value: Math.sqrt(arg.value), dim: scaleDim(arg.dim, 0.5), bare: arg.bare };
    },
  },
  abs: { arity: 1, fn: ([x]) => ({ ...(x as Quantity), value: Math.abs((x as Quantity).value) }) },
  min: { arity: 'many', fn: extreme('min', Math.min) },
  max: { arity: 'many', fn: extreme('max', Math.max) },
  round: { arity: 1, fn: rounding(Math.round) },
  floor: { arity: 1, fn: rounding(Math.floor) },
  ceil: { arity: 1, fn: rounding(Math.ceil) },
};

export const FUNCTION_NAMES = Object.keys(FUNCTIONS);

/** How many arguments each function takes, for name completion's hints. */
export const FUNCTION_ARITIES: Readonly<Record<string, number | 'many'>> = Object.fromEntries(
  Object.entries(FUNCTIONS).map(([name, { arity }]) => [name, arity]),
);

/** Names a parameter can't have: units, functions, constants. */
export function isReservedName(name: string): boolean {
  return (
    Object.hasOwn(UNITS, name) || Object.hasOwn(FUNCTIONS, name) || Object.hasOwn(CONSTANTS, name)
  );
}

/** Base units per display unit of `dim` for a plain number: the document unit for lengths, degrees. */
function contextFactor(dim: Dim, scope: Scope): number {
  return lengthFactor(scope.lengthUnit) ** dim.length;
}

/** Converts `q` to `dim`: a bare number takes the unit; anything else must already match. */
function matchDim(
  q: Quantity,
  dim: Dim,
  scope: Scope,
  mismatch: (from: string, to: string) => ExprError,
): Quantity {
  if (sameDim(q.dim, dim)) return q;
  if (q.bare && isUnitless(q.dim)) return { value: q.value * contextFactor(dim, scope), dim };
  throw mismatch(describeDim(q.dim), describeDim(dim));
}

export function evaluateNode(node: Node, scope: Scope): Quantity {
  return combine(
    node,
    operands(node, scope).map((operand) => evaluateNode(operand, scope)),
    scope,
  );
}

/**
 * The nodes `node`'s value is made of, in the order they are evaluated: none
 * for a number or a name. A call that can't be made throws here, before its
 * values are evaluated.
 */
export function operands(node: Node, scope: Scope): readonly Node[] {
  switch (node.kind) {
    case 'num':
    case 'ref':
      return [];
    case 'unary':
      return [node.arg];
    case 'binary':
      return [node.left, node.right];
    case 'call':
      functionOf(node, scope);
      return node.args;
  }
}

/** `node`'s value from those of its `operands`, in their order. */
export function combine(node: Node, values: readonly Quantity[], scope: Scope): Quantity {
  const result = combineUnchecked(node, values, scope);
  if (!Number.isFinite(result.value)) {
    throw new ExprError('The result is too large to use.', node.span);
  }
  return result;
}

function combineUnchecked(node: Node, values: readonly Quantity[], scope: Scope): Quantity {
  switch (node.kind) {
    case 'num': {
      if (node.unit === undefined) return { value: node.value, dim: UNITLESS, bare: true };
      // biome-ignore lint/style/noNonNullAssertion: the parser only accepts known units.
      const unit = unitNamed(node.unit)!;
      return { value: node.value * unit.factor, dim: unit.dim };
    }
    case 'ref':
      return lookup(node.name, node.span, scope);
    case 'unary': {
      const arg = values[0] as Quantity;
      return node.op === '-' ? { ...arg, value: -arg.value } : arg;
    }
    case 'binary':
      return binary(node, values[0] as Quantity, values[1] as Quantity, scope);
    case 'call':
      return functionOf(node, scope).fn([...values], node, scope);
  }
}

function lookup(name: string, span: Span, scope: Scope): Quantity {
  const constant = ownEntry(CONSTANTS, name);
  if (constant) return constant;
  const value = scope.lookup(name, span);
  if (value) return value;
  if (Object.hasOwn(FUNCTIONS, name)) {
    throw new ExprError(`\`${name}\` is a function: write \`${name}(…)\`.`, span);
  }
  const suggestion = scope.suggest ? scope.suggest(name) : closest(name, scope.names());
  throw new ExprError(
    `Unknown name \`${name}\`.${suggestion ? ` Did you mean \`${suggestion}\`?` : ''}`,
    span,
    'unknown-name',
  );
}

function binary(
  node: Extract<Node, { kind: 'binary' }>,
  a: Quantity,
  b: Quantity,
  scope: Scope,
): Quantity {
  const bare = a.bare && b.bare;
  switch (node.op) {
    case '+':
    case '-': {
      // A bare number takes the other side's unit: `width + 2`.
      const dim = a.bare && isUnitless(a.dim) ? b.dim : a.dim;
      const mismatch = () =>
        new ExprError(
          node.op === '+'
            ? `Can't add ${describeDim(a.dim)} and ${describeDim(b.dim)}.`
            : `Can't subtract ${describeDim(b.dim)} from ${describeDim(a.dim)}.`,
          node.span,
        );
      const left = matchDim(a, dim, scope, mismatch);
      const right = matchDim(b, dim, scope, mismatch);
      const value = node.op === '+' ? left.value + right.value : left.value - right.value;
      return { value, dim, bare };
    }
    case '*':
      return { value: a.value * b.value, dim: mulDim(a.dim, b.dim), bare };
    case '/':
      if (b.value === 0) throw new ExprError('Division by zero.', node.span);
      return { value: a.value / b.value, dim: mulDim(a.dim, b.dim, -1), bare };
    case '^': {
      if (!isUnitless(b.dim)) {
        throw new ExprError(
          `The exponent must be a number, not ${describeDim(b.dim)}.`,
          node.right.span,
        );
      }
      const dim = scaleDim(a.dim, b.value);
      if (!Number.isInteger(dim.length) || !Number.isInteger(dim.angle)) {
        throw new ExprError(
          `Can't raise ${describeDim(a.dim)} to the power ${b.value}.`,
          node.span,
        );
      }
      const value = a.value ** b.value;
      if (Number.isNaN(value)) {
        throw new ExprError(`Can't raise a negative number to the power ${b.value}.`, node.span);
      }
      return { value, dim: isUnitless(dim) ? UNITLESS : dim, bare };
    }
  }
}

/** The function a call names, checked against its values' count. */
function functionOf(node: Extract<Node, { kind: 'call' }>, scope: Scope) {
  const fn = ownEntry(FUNCTIONS, node.name);
  if (!fn) {
    const known =
      (scope.has ? scope.has(node.name) : [...scope.names()].includes(node.name)) ||
      Object.hasOwn(CONSTANTS, node.name);
    const suggestion = known ? undefined : closest(node.name, FUNCTION_NAMES);
    throw new ExprError(
      known
        ? `\`${node.name}\` isn't a function.`
        : `Unknown function \`${node.name}\`.${suggestion ? ` Did you mean \`${suggestion}\`?` : ''}`,
      node.span,
    );
  }
  if (fn.arity === 'many' ? node.args.length === 0 : node.args.length !== fn.arity) {
    throw new ExprError(
      fn.arity === 'many'
        ? `\`${node.name}\` needs at least one value.`
        : `\`${node.name}\` takes ${fn.arity} value${fn.arity === 1 ? '' : 's'}, not ${node.args.length}.`,
      node.span,
    );
  }
  return fn;
}

/**
 * Converts a result to what a parameter or input of `kind` needs: a plain
 * number takes the context unit (document length unit, degrees); anything
 * else must already have the right dimension.
 */
export function coerce(q: Quantity, kind: UnitKind, span: Span, scope: Scope): Quantity {
  const dim = dimOfKind(kind);
  if (sameDim(q.dim, dim)) return { value: q.value, dim };
  if (isUnitless(q.dim) && q.bare) return { value: q.value * contextFactor(dim, scope), dim };
  const needed = describeDim(dim);
  const hint =
    isUnitless(q.dim) && kind !== 'unitless'
      ? ` Multiply by a unit, like \`… * 1 ${kind === 'length' ? scope.lengthUnit : 'deg'}\`.`
      : '';
  throw new ExprError(`This is ${describeDim(q.dim)}, but ${needed} is needed.${hint}`, span);
}

export interface EvaluateOptions {
  /** What the result must be. Omit to accept any dimension. */
  kind?: UnitKind;
  /** Parameter values by name (base units). */
  values?: ReadonlyMap<string, Quantity>;
  lengthUnit?: LengthUnit;
}

export type EvaluateResult =
  | { ok: true; value: number; dim: Dim }
  | { ok: false; error: ExprError };

/** Parses and evaluates one expression. Never throws for bad input. */
export function evaluateExpression(source: string, options: EvaluateOptions = {}): EvaluateResult {
  const values = options.values ?? new Map<string, Quantity>();
  const scope: Scope = {
    lookup: (name) => values.get(name),
    names: () => values.keys(),
    lengthUnit: options.lengthUnit ?? 'mm',
  };
  try {
    const node = parse(source);
    let q = evaluateNode(node, scope);
    if (options.kind) q = coerce(q, options.kind, node.span, scope);
    return { ok: true, value: q.value, dim: q.dim };
  } catch (error) {
    if (error instanceof ExprError) return { ok: false, error };
    throw error;
  }
}

/**
 * The candidate within a small edit distance of `name`, if one is clearly
 * closest. With a `budget`, at most `budget.cells` cells of edit-distance work
 * are spent across calls; once they are, there is no suggestion.
 */
export function closest(
  name: string,
  candidates: Iterable<string>,
  budget?: { cells: number },
): string | undefined {
  const limit = name.length <= 3 ? 1 : 2;
  const lower = name.toLowerCase();
  let best: string | undefined;
  let bestDistance = limit + 1;
  for (const candidate of candidates) {
    // Names are ASCII, so lower-casing keeps lengths: a longer or shorter one is farther.
    if (Math.abs(candidate.length - name.length) >= bestDistance) continue;
    const d = editDistance(lower, candidate.toLowerCase(), bestDistance - 1, budget);
    if (budget && budget.cells < 0) return undefined;
    if (d < bestDistance) {
      best = candidate;
      bestDistance = d;
    }
  }
  return best;
}

/** The edit distance from `a` to `b`, or `max + 1` when it is more than `max`. */
function editDistance(a: string, b: string, max: number, budget?: { cells: number }): number {
  const far = max + 1;
  if (Math.abs(a.length - b.length) > max) return far;
  // Only cells within `max` of the diagonal can be `max` or less: row i keeps
  // columns i - max … i + max, column j at index j - i + max.
  const width = 2 * max + 1;
  let previous = new Array<number>(width + 2).fill(far);
  let current = new Array<number>(width + 2).fill(far);
  // Index k + 1 holds column j = i + k - max; indexes 0 and width + 1 stay `far`.
  for (let k = 0; k < width; k++) if (k - max >= 0) previous[k + 1] = k - max;
  for (let i = 1; i <= a.length; i++) {
    if (budget) budget.cells -= width;
    let least = far;
    for (let k = 0; k < width; k++) {
      const j = i + k - max;
      let d = far;
      if (j === 0) d = i;
      else if (j > 0 && j <= b.length) {
        d = Math.min(
          (previous[k + 2] as number) + 1,
          (current[k] as number) + 1,
          (previous[k + 1] as number) + (a[i - 1] === b[j - 1] ? 0 : 1),
          far,
        );
      }
      current[k + 1] = d;
      if (d < least) least = d;
    }
    if (least > max) return far;
    [previous, current] = [current, previous];
  }
  return previous[b.length - a.length + max + 1] as number;
}
