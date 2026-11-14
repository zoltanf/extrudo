/**
 * FreeCAD's expression tree (`fc-expr.ts`) as Extrudo expression text
 * (ADR-0144 S10). Text to text only: `@extrudo/core` evaluates what this
 * writes, and the importer keeps it only when that value is the one the file
 * stores (the rule, `bind.ts`).
 *
 * Both languages hold lengths in mm and angles in degrees, so the number an
 * Extrudo expression computes is FreeCAD's number; only the dimension it
 * carries may differ: FreeCAD's plain cell numbers have none, and Extrudo
 * wants a length in a length field. Each piece of the text keeps its FreeCAD
 * dimension (`fc`) and its Extrudo one (`ex`); where an operator needs them to
 * agree, the text is multiplied or divided by `1 mm` or `1 deg`, which changes
 * no number. Where the two languages group differently the text gets
 * parentheses; what Extrudo lacks but can express is rewritten; anything else
 * is a reason, never a guess.
 */
import { cellAddress, type FcDim, type FcNode, fcUnit } from './fc-expr';

/** Why an expression came in as the stored number: a closed set (`EXPRESSION_REASONS`). */
export type ExpressionReason =
  | 'syntax'
  | 'function'
  | 'operator'
  | 'unit'
  | 'reference'
  | 'target'
  | 'unmapped'
  | 'differs'
  | 'cycle'
  | 'limit';

/** A plain sentence per reason, for the report. */
export const EXPRESSION_REASONS: Readonly<Record<ExpressionReason, string>> = {
  syntax: "FreeCAD's own grammar doesn't read it",
  function: "it uses a function Extrudo's expressions don't have",
  operator: "it uses a comparison, a condition or text, which Extrudo's expressions don't have",
  unit: "it uses a unit Extrudo doesn't have, or units that don't fit together",
  reference: "it reads a value that doesn't come in as a parameter",
  target: "it sets something Extrudo doesn't take as an expression",
  unmapped: "what it sets didn't come in",
  differs: 'Extrudo computes another value from it than the file stores',
  cycle: 'it is part of a loop of expressions that read each other',
  limit: 'it is past one of the import’s limits',
};

/** Extrudo's dimension of a piece of text: length and angle exponents. */
export interface ExDim {
  readonly length: number;
  readonly angle: number;
}

export const NONE: ExDim = { length: 0, angle: 0 };
export const LENGTH: ExDim = { length: 1, angle: 0 };
export const ANGLE: ExDim = { length: 0, angle: 1 };

/** What a path reads, as the resolver found it. */
export interface Resolved {
  /** Extrudo text that reads it (a parameter's name, or a name with a transformation). */
  readonly text: string;
  /** The text's precedence (`PREC`): a name is an atom. */
  readonly prec?: number;
  /** The value's dimension in FreeCAD. */
  readonly fc: FcDim;
  /** The text's dimension in Extrudo. */
  readonly ex: ExDim;
}

export type Resolver = (
  path: Extract<FcNode, { kind: 'path' }>,
) => Resolved | { readonly reason: ExpressionReason; readonly detail: string };

/**
 * What the expression sets:
 * - `quantity`: a property of FreeCAD's with a unit (a pad's `Length`): FreeCAD takes a value of that unit or a plain number;
 * - `constraint`: a sketch constraint, which FreeCAD gives the value whatever its unit;
 * - `count`: an integer property (`Occurrences`): a plain number;
 * - `parameter`: a user parameter of the given dimension, from a value without one or of that one.
 */
export type EmitTarget =
  | { readonly mode: 'quantity' | 'constraint' | 'parameter'; readonly dim: ExDim }
  | { readonly mode: 'count' };

export type EmitResult =
  | { readonly ok: true; readonly text: string; readonly fc: FcDim }
  | { readonly ok: false; readonly reason: ExpressionReason; readonly detail: string };

/** The longest Extrudo text the emitter writes (`%` repeats its operands). */
export const MAX_EMITTED_LENGTH = 16_384;

/** Precedence of Extrudo text: sums 1, products 2, unary 3, powers 4, atoms 5. */
const PREC = { add: 1, mul: 2, unary: 3, pow: 4, atom: 5 } as const;

interface Piece {
  readonly text: string;
  readonly prec: number;
  readonly fc: FcDim;
  readonly ex: ExDim;
  /** A plain number written as a literal (no unit, not negative): `10`. */
  readonly literal?: true;
}

class Refusal extends Error {
  constructor(
    readonly reason: ExpressionReason,
    readonly detail: string,
  ) {
    super(detail);
  }
}
const refuse = (reason: ExpressionReason, detail: string): never => {
  throw new Refusal(reason, detail);
};

const sameFc = (a: FcDim, b: FcDim) =>
  a.length === b.length && a.angle === b.angle && !a.other && !b.other;
const isNone = (d: FcDim | ExDim) => d.length === 0 && d.angle === 0 && !(d as FcDim).other;
const addDim = (a: ExDim, b: ExDim, k = 1): ExDim => ({
  length: a.length + k * b.length,
  angle: a.angle + k * b.angle,
});
const addFc = (a: FcDim, b: FcDim, k = 1): FcDim =>
  a.other || b.other
    ? { length: 0, angle: 0, other: true }
    : { length: a.length + k * b.length, angle: a.angle + k * b.angle };
/** A piece's whole Extrudo dimension. */
const exOf = (p: Piece): ExDim => addDim(p.fc, p.ex);

/** Numbers as Extrudo's parser reads them, every digit JavaScript keeps. */
const num = (v: number) => {
  const s = String(v);
  return s.includes('e') ? s.replace('e+', 'e') : s;
};

const wrap = (p: Piece, min: number) => (p.prec >= min ? p.text : `(${p.text})`);

const piece = (text: string, prec: number, fc: FcDim, ex: ExDim, literal?: true): Piece => {
  if (text.length > MAX_EMITTED_LENGTH)
    refuse('limit', `its Extrudo form would be longer than ${MAX_EMITTED_LENGTH} characters`);
  return { text, prec, fc, ex, ...(literal ? { literal } : {}) };
};

/** `p` with its Extrudo dimension moved by `by` (multiplied by `1 mm` / `1 deg`): its number stays. */
function shift(p: Piece, by: ExDim): Piece {
  if (by.length === 0 && by.angle === 0) return p;
  const ex = addDim(p.ex, by);
  if (p.literal && ((by.length === 1 && by.angle === 0) || (by.length === 0 && by.angle === 1)))
    return piece(`${p.text} ${by.length === 1 ? 'mm' : 'deg'}`, PREC.atom, p.fc, ex);
  let text = wrap(p, PREC.mul);
  for (const [unit, k] of [
    ['mm', by.length],
    ['deg', by.angle],
  ] as const) {
    if (k === 0) continue;
    const power = Math.abs(k) === 1 ? `1 ${unit}` : `1 ${unit} ^ ${Math.abs(k)}`;
    text = `${text} ${k > 0 ? '*' : '/'} ${power}`;
  }
  return piece(text, PREC.mul, p.fc, ex);
}

/** `p` written with the Extrudo dimension `ex` (its FreeCAD one stays). */
const toEx = (p: Piece, ex: ExDim) => shift(p, addDim(ex, exOf(p), -1));
/** `p` written so that its Extrudo dimension is its FreeCAD one. */
const plain = (p: Piece) => shift(p, { length: -p.ex.length, angle: -p.ex.angle });

const checkFc = (d: FcDim) => {
  if (d.other) refuse('unit', 'it uses a unit of a dimension Extrudo has no unit for');
  return d;
};

/** A number with its unit as Extrudo text. */
function literalOf(n: Extract<FcNode, { kind: 'num' }>): Piece {
  if (!n.unit) return piece(num(n.value), PREC.atom, { length: 0, angle: 0 }, NONE, true);
  let fc: FcDim = { length: 0, angle: 0 };
  let factor = 1;
  for (const [name, power] of n.unit) {
    const u = fcUnit(name);
    if (!u) return refuse('unit', `it uses the unit ${name}`);
    if (u.dim.other)
      return refuse('unit', `it uses the unit ${name}, of a dimension Extrudo has no unit for`);
    fc = addFc(fc, u.dim, power);
    factor *= u.factor ** power;
  }
  const value = n.value * factor;
  if (!Number.isFinite(value)) return refuse('limit', 'it has a number too large to use');
  const only = n.unit.length === 1 ? n.unit[0] : undefined;
  const u = only ? fcUnit(only[0]) : undefined;
  if (only && only[1] === 1 && u?.extrudo)
    return piece(`${num(n.value)} ${u.extrudo}`, PREC.atom, fc, NONE);
  if (fc.length === 0 && fc.angle === 0) return piece(num(value), PREC.atom, fc, NONE, true);
  // Another unit of a length or an angle, or one to a power: the number in mm or degrees.
  if ((fc.length === 1 && fc.angle === 0) || (fc.length === 0 && fc.angle === 1))
    return piece(`${num(value)} ${fc.length === 1 ? 'mm' : 'deg'}`, PREC.atom, fc, NONE);
  const parts: string[] = [num(value)];
  if (fc.length !== 0) parts.push(fc.length === 1 ? '1 mm' : `1 mm ^ ${fc.length}`);
  if (fc.angle !== 0) parts.push(fc.angle === 1 ? '1 deg' : `1 deg ^ ${fc.angle}`);
  // `1 mm ^ -1` doesn't parse: a negative power divides.
  const text = parts
    .map((p, i) => (i === 0 ? p : p.includes('^ -') ? `/ ${p.replace('^ -', '^ ')}` : `* ${p}`))
    .join(' ')
    .replace(/ \^ 1\b/g, '');
  return piece(text, PREC.mul, fc, NONE);
}

/** The pieces of `args`, written with one Extrudo dimension (the first one's that isn't a bare number). */
function aligned(args: Piece[], name: string): Piece[] {
  const first = args[0] as Piece;
  for (const a of args)
    if (!sameFc(a.fc, first.fc))
      refuse('unit', `${name} gets values of different units, which FreeCAD refuses`);
  const lead = args.find((a) => !a.literal) ?? first;
  return args.map((a) => toEx(a, exOf(lead)));
}

const ARITY: Readonly<Record<string, [number, number]>> = {
  sin: [1, 1],
  cos: [1, 1],
  tan: [1, 1],
  asin: [1, 1],
  acos: [1, 1],
  atan: [1, 1],
  sqrt: [1, 1],
  cbrt: [1, 1],
  abs: [1, 1],
  round: [1, 1],
  floor: [1, 1],
  ceil: [1, 1],
  pow: [2, 2],
  mod: [2, 2],
  hypot: [2, 3],
  cath: [2, 3],
  min: [1, Number.POSITIVE_INFINITY],
  max: [1, Number.POSITIVE_INFINITY],
  sum: [1, Number.POSITIVE_INFINITY],
  average: [1, Number.POSITIVE_INFINITY],
  count: [1, Number.POSITIVE_INFINITY],
};

/** Writes `node` as Extrudo text for `target`, reading paths through `resolve`. Never throws. */
export function emitExtrudo(node: FcNode, resolve: Resolver, target: EmitTarget): EmitResult {
  try {
    const p = emit(node, resolve);
    checkFc(p.fc);
    let out: Piece;
    if (target.mode === 'count') {
      if (!isNone(p.fc)) refuse('unit', 'a count gets a value with a unit');
      out = plain(p);
    } else if (target.mode === 'constraint') {
      // FreeCAD gives a constraint the value whatever its unit (the truth table's `1 / 2 in`).
      out = toEx(p, target.dim);
    } else {
      if (!isNone(p.fc) && !sameFc(p.fc, target.dim))
        refuse('unit', 'it computes a value of another unit than what it sets');
      out = toEx(p, target.dim);
    }
    return { ok: true, text: out.text, fc: p.fc };
  } catch (error) {
    if (error instanceof Refusal) return { ok: false, reason: error.reason, detail: error.detail };
    throw error;
  }
}

function emit(node: FcNode, resolve: Resolver): Piece {
  switch (node.kind) {
    case 'num':
      return literalOf(node);
    case 'constant':
      if (node.name === 'pi') return piece('pi', PREC.atom, { length: 0, angle: 0 }, NONE);
      if (node.name === 'e')
        return piece(num(Math.E), PREC.atom, { length: 0, angle: 0 }, NONE, true);
      return refuse('operator', `it uses ${node.name}, a truth value`);
    case 'string':
      return refuse('operator', 'it uses text as a value');
    case 'compare':
      return refuse('operator', `it compares two values (${node.op})`);
    case 'conditional':
      return refuse('operator', 'it chooses between two values (… ? … : …)');
    case 'range':
      return refuse('function', `it reads a range of cells (${node.from}:${node.to})`);
    case 'member':
      return refuse('function', 'it reads a part of a value');
    case 'path': {
      const r = resolve(node);
      if ('reason' in r) return refuse(r.reason, r.detail);
      checkFc(r.fc);
      return piece(r.text, r.prec ?? PREC.atom, r.fc, addDim(r.ex, r.fc, -1));
    }
    case 'unary': {
      const a = emit(node.arg, resolve);
      if (node.op === '+') return a;
      return piece(`-${wrap(a, PREC.unary)}`, PREC.unary, a.fc, a.ex);
    }
    case 'binary':
      return binary(node, resolve);
    case 'call':
      return call(node, resolve);
  }
}

function binary(node: Extract<FcNode, { kind: 'binary' }>, resolve: Resolver): Piece {
  const a = emit(node.left, resolve);
  const b = emit(node.right, resolve);
  switch (node.op) {
    case '+':
    case '-': {
      if (!sameFc(a.fc, b.fc))
        refuse(
          'unit',
          `it ${node.op === '+' ? 'adds' : 'subtracts'} values of different units, which FreeCAD refuses`,
        );
      // The bare number takes the other side's unit, written out.
      const [l, r] =
        b.literal && !a.literal
          ? [a, toEx(b, exOf(a))]
          : a.literal && !b.literal
            ? [toEx(a, exOf(b)), b]
            : [a, toEx(b, exOf(a))];
      return piece(`${wrap(l, PREC.add)} ${node.op} ${wrap(r, PREC.mul)}`, PREC.add, a.fc, l.ex);
    }
    case '*':
      return piece(
        `${wrap(a, PREC.mul)} * ${wrap(b, PREC.unary)}`,
        PREC.mul,
        addFc(a.fc, b.fc),
        addDim(a.ex, b.ex),
      );
    case '/':
      return piece(
        `${wrap(a, PREC.mul)} / ${wrap(b, PREC.unary)}`,
        PREC.mul,
        addFc(a.fc, b.fc, -1),
        addDim(a.ex, b.ex, -1),
      );
    case '%':
      return remainder(a, b);
    case '^':
      return power(a, b);
  }
}

/** Python's remainder (FreeCAD's `%`): `a - b * floor(a / b)`, with the left value's unit. */
function remainder(a: Piece, b: Piece): Piece {
  if (!isNone(b.fc) && !sameFc(a.fc, b.fc))
    refuse('unit', 'it takes a remainder of values of different units');
  // `b` with `a`'s whole Extrudo dimension, so `a / b` has none and `floor` rounds nothing but the number.
  const bb = shift(b, addDim(exOf(a), exOf(b), -1));
  const text = `${wrap(a, PREC.add)} - ${wrap(bb, PREC.mul)} * floor(${wrap(a, PREC.mul)} / ${wrap(bb, PREC.unary)})`;
  return piece(`(${text})`, PREC.atom, a.fc, a.ex);
}

function power(a: Piece, b: Piece): Piece {
  if (!isNone(b.fc)) refuse('unit', 'its exponent has a unit');
  const e = plain(b);
  const base = plain(a);
  let fc: FcDim = { length: 0, angle: 0 };
  if (!isNone(a.fc)) {
    if (!b.literal) refuse('unit', 'it raises a value with a unit to a power that is not a number');
    const k = Number(b.text);
    fc = { length: a.fc.length * k, angle: a.fc.angle * k };
    if (!Number.isInteger(fc.length) || !Number.isInteger(fc.angle))
      refuse('unit', 'it raises a value with a unit to a power that leaves a part of a unit');
  }
  return piece(`${wrap(base, PREC.atom)} ^ ${wrap(e, PREC.atom)}`, PREC.pow, fc, NONE);
}

function call(node: Extract<FcNode, { kind: 'call' }>, resolve: Resolver): Piece {
  const arity = ARITY[node.name];
  if (!arity) return refuse('function', `it uses ${node.name}()`);
  if (node.args.length < arity[0] || node.args.length > arity[1])
    return refuse('syntax', `${node.name}() gets ${node.args.length} values`);
  if (node.name === 'count') {
    // FreeCAD counts the values it is given: without ranges, the number of them.
    for (const a of node.args)
      if (a.kind === 'range') refuse('function', 'count() reads a range of cells');
    return piece(String(node.args.length), PREC.atom, { length: 0, angle: 0 }, NONE, true);
  }
  const args = node.args.map((a) => emit(a, resolve));
  const one = args[0] as Piece;
  const none = { length: 0, angle: 0 };
  switch (node.name) {
    case 'sin':
    case 'cos':
    case 'tan': {
      // FreeCAD reads a plain number as degrees, also a name's value; Extrudo a name's as radians.
      if (isNone(one.fc)) {
        const x = plain(one);
        const text = x.literal ? `${x.text} deg` : `${wrap(x, PREC.mul)} * 1 deg`;
        return piece(`${node.name}(${text})`, PREC.atom, none, NONE);
      }
      if (!sameFc(one.fc, { length: 0, angle: 1 }))
        refuse('unit', `${node.name}() gets a value that is not an angle`);
      return piece(`${node.name}(${plain(one).text})`, PREC.atom, none, NONE);
    }
    case 'asin':
    case 'acos':
    case 'atan':
      if (!isNone(one.fc)) refuse('unit', `${node.name}() gets a value with a unit`);
      return piece(`${node.name}(${plain(one).text})`, PREC.atom, { length: 0, angle: 1 }, NONE);
    case 'sqrt':
    case 'cbrt': {
      const k = node.name === 'sqrt' ? 2 : 3;
      const fc = { length: one.fc.length / k, angle: one.fc.angle / k };
      if (!Number.isInteger(fc.length) || !Number.isInteger(fc.angle))
        refuse(
          'unit',
          `${node.name}() of a value whose unit has no ${k === 2 ? 'square' : 'cube'} root`,
        );
      const x = plain(one);
      return k === 2
        ? piece(`sqrt(${x.text})`, PREC.atom, fc, NONE)
        : piece(`${wrap(x, PREC.atom)} ^ (1 / 3)`, PREC.pow, fc, NONE);
    }
    case 'abs':
      return piece(`abs(${one.text})`, PREC.atom, one.fc, one.ex);
    case 'round':
    case 'floor':
    case 'ceil':
      // Extrudo rounds in display units: only a plain number keeps its meaning.
      if (!isNone(one.fc))
        refuse(
          'function',
          `${node.name}() of a value with a unit rounds in the display unit in Extrudo`,
        );
      return piece(`${node.name}(${plain(one).text})`, PREC.atom, none, NONE);
    case 'pow':
      return power(one, args[1] as Piece);
    case 'mod':
      // C's fmod truncates, Python's remainder floors: the same where a / b ≥ 0, which the rule checks.
      return remainder(one, args[1] as Piece);
    case 'min':
    case 'max': {
      const xs = aligned(args, `${node.name}()`);
      return piece(
        `${node.name}(${xs.map((x) => x.text).join(', ')})`,
        PREC.atom,
        one.fc,
        (xs[0] as Piece).ex,
      );
    }
    case 'sum':
    case 'average': {
      const xs = aligned(args, `${node.name}()`);
      const total = xs.map((x, i) => (i === 0 ? wrap(x, PREC.add) : wrap(x, PREC.mul))).join(' + ');
      const text = node.name === 'sum' ? `(${total})` : `(${total}) / ${xs.length}`;
      return piece(text, node.name === 'sum' ? PREC.atom : PREC.mul, one.fc, (xs[0] as Piece).ex);
    }
    case 'hypot':
    case 'cath': {
      const xs = aligned(args, `${node.name}()`).map(plain);
      const squares = xs.map((x) => `${wrap(x, PREC.atom)} ^ 2`);
      return piece(
        `sqrt(${squares.join(node.name === 'hypot' ? ' + ' : ' - ')})`,
        PREC.atom,
        one.fc,
        NONE,
      );
    }
  }
  return refuse('function', `it uses ${node.name}()`);
}

/** A sheet's own name in a formula (`width`, `B6`, `$B$6`): an alias or a cell. */
export function ownCell(name: string): { address: string } | { alias: string } {
  const address = cellAddress(name);
  return address ? { address } : { alias: name };
}
