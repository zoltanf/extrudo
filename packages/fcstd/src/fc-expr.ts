/**
 * FreeCAD's expression language, as a file stores it (ADR-0144 S10): a
 * tokenizer and a recursive-descent parser with fixed limits, into a small
 * syntax tree. Nothing here evaluates anything: `fc-emit.ts` writes the tree
 * as Extrudo expression text and `@extrudo/core` evaluates that.
 *
 * FreeCAD's meaning, from its grammar and the truth table of
 * `parameter-fixtures.ts` (FORMAT.md, "Expressions"):
 *
 *   c ? a : b                  right, loosest
 *   == != < > <= >=            left
 *   + -                        left
 *   * / %                      left
 *   ^                          LEFT (`2 ^ 3 ^ 2` is 64)
 *   unary - +                  tighter than `^` (`-2 ^ 2` is 4)
 *   number [unit]              a unit only right after a number (`1 / 2 in` is 1 / (2 in))
 *
 * Function arguments are separated by `;` or `,`; `1,5` (digits round a
 * comma, no space) is 1.5. A name that is a unit or a constant (`mm`, `H`,
 * `e`) is not a name: `Sheet.H` doesn't parse, as in FreeCAD.
 */

/** An expression's longest text (characters): the library's longest is 66. */
export const MAX_EXPRESSION_LENGTH = 4_096;
/** Its most tokens. */
export const MAX_EXPRESSION_TOKENS = 1_024;
/** Its deepest nesting (brackets, operators, calls): Extrudo's parser takes 256, and the emitter adds at most three levels per level. */
export const MAX_EXPRESSION_DEPTH = 64;

/** A FreeCAD unit's dimension in this importer's terms: length and angle exponents, or another dimension. */
export interface FcDim {
  readonly length: number;
  readonly angle: number;
  /** A dimension Extrudo has no unit for (mass, time …). */
  readonly other?: true;
}

export const FC_NONE: FcDim = { length: 0, angle: 0 };
const L: FcDim = { length: 1, angle: 0 };
const A: FcDim = { length: 0, angle: 1 };
const OTHER: FcDim = { length: 0, angle: 0, other: true };

/** A unit token: its dimension and its value in mm or degrees; Extrudo's own name when it has the unit. */
export interface FcUnitInfo {
  readonly dim: FcDim;
  readonly factor: number;
  readonly extrudo?: string;
}

const UNIT_TABLE: ReadonlyMap<string, FcUnitInfo> = new Map<string, FcUnitInfo>([
  ['nm', { dim: L, factor: 1e-6 }],
  ['um', { dim: L, factor: 1e-3 }],
  ['µm', { dim: L, factor: 1e-3 }],
  ['mm', { dim: L, factor: 1, extrudo: 'mm' }],
  ['cm', { dim: L, factor: 10, extrudo: 'cm' }],
  ['dm', { dim: L, factor: 100 }],
  ['m', { dim: L, factor: 1000, extrudo: 'm' }],
  ['km', { dim: L, factor: 1e6 }],
  ['in', { dim: L, factor: 25.4, extrudo: 'in' }],
  ['"', { dim: L, factor: 25.4, extrudo: 'in' }],
  ['ft', { dim: L, factor: 304.8, extrudo: 'ft' }],
  ["'", { dim: L, factor: 304.8, extrudo: 'ft' }],
  ['thou', { dim: L, factor: 0.0254 }],
  ['mil', { dim: L, factor: 0.0254 }],
  ['yd', { dim: L, factor: 914.4 }],
  ['mi', { dim: L, factor: 1_609_344 }],
  ['deg', { dim: A, factor: 1, extrudo: 'deg' }],
  ['°', { dim: A, factor: 1, extrudo: 'deg' }],
  ['rad', { dim: A, factor: 180 / Math.PI, extrudo: 'rad' }],
  ['gon', { dim: A, factor: 0.9 }],
  ['M', { dim: A, factor: 1 / 60 }],
  ['′', { dim: A, factor: 1 / 60 }],
  ['AS', { dim: A, factor: 1 / 3600 }],
  ['″', { dim: A, factor: 1 / 3600 }],
  ...(
    'sqft cft l ml ug µg mg g kg t lb lbm oz st cwt s min h Hz kHz MHz GHz THz N mN kN MN lbf ' +
    'Pa kPa MPa GPa bar mbar Torr mTorr uTorr µTorr psi ksi Mpsi A nA uA mA kA MA V mV kV W nW ' +
    'uW mW kW VA S mS uS kS MS Ohm kOhm MOhm C T mT G Wb F mF uF nF pF H mH uH nH J mJ kJ Nm ' +
    'Nmm VAs CV Ws kWh eV keV MeV cal kcal K mK uK mol nmol umol mmol cd mph'
  )
    .split(' ')
    .map((u): [string, FcUnitInfo] => [u, { dim: OTHER, factor: 1 }]),
]);

/** The unit called `name` in FreeCAD's language, if it is one. */
export function fcUnit(name: string): FcUnitInfo | undefined {
  return UNIT_TABLE.get(name);
}

/** FreeCAD's constants: names that are never a name. */
const CONSTANTS: ReadonlyMap<string, number> = new Map([
  ['pi', Math.PI],
  ['e', Math.E],
  ['True', 1],
  ['true', 1],
  ['False', 0],
  ['false', 0],
  ['None', 0],
]);

/** Whether FreeCAD reads `name` as a unit or a constant, never as a name (an alias it refuses). */
export function isFcToken(name: string): boolean {
  return UNIT_TABLE.has(name) || CONSTANTS.has(name);
}

/** FreeCAD's functions (`Expression.cpp`); any other name followed by `(` doesn't parse. */
export const FC_FUNCTIONS: ReadonlySet<string> = new Set(
  (
    'abs acos asin atan cbrt ceil cos cosh exp floor log log10 round sin sinh sqrt tan tanh trunc not ' +
    'atan2 mod pow hypot cath sum average count min max stddev and or ' +
    'vector vangle vcross vdot vlinedist vlinesegdist vlineproj vnormalize vplanedist vplaneproj ' +
    'vscale vscalex vscaley vscalez matrix minvert mrotate mrotatex mrotatey mrotatez mscale ' +
    'mtranslate translationm create placement rotation rotationx rotationy rotationz list tuple ' +
    'str parsequant address hiddenref href'
  ).split(' '),
);

/** One part of a path: a name or a `<<label>>`, with an index (`[3]`) or a key (`[<<k>>]`) after it. */
export interface FcComponent {
  readonly name: string;
  /** Written `<<…>>` (a label, or text). */
  readonly quoted: boolean;
  readonly index?: number;
  readonly key?: string;
  /** `[a:b]` and other subscripts this importer doesn't read. */
  readonly slice?: true;
}

export type FcNode =
  | {
      readonly kind: 'num';
      readonly value: number;
      /** The unit as written after it (`mm`, `mm^2` as `[['mm', 2]]`); absent for a plain number. */
      readonly unit?: readonly (readonly [string, number])[];
    }
  | { readonly kind: 'constant'; readonly name: string; readonly value: number }
  | {
      readonly kind: 'path';
      /** `doc#…`: another document. */
      readonly document?: string;
      /** Written with a leading `.`: the owner's own property. */
      readonly local: boolean;
      readonly components: readonly FcComponent[];
    }
  | { readonly kind: 'string'; readonly value: string }
  | { readonly kind: 'unary'; readonly op: '-' | '+'; readonly arg: FcNode }
  | {
      readonly kind: 'binary';
      readonly op: '+' | '-' | '*' | '/' | '%' | '^';
      readonly left: FcNode;
      readonly right: FcNode;
    }
  | { readonly kind: 'compare'; readonly op: string; readonly left: FcNode; readonly right: FcNode }
  | {
      readonly kind: 'conditional';
      readonly test: FcNode;
      readonly yes: FcNode;
      readonly no: FcNode;
    }
  | { readonly kind: 'call'; readonly name: string; readonly args: readonly FcNode[] }
  | { readonly kind: 'range'; readonly from: string; readonly to: string }
  /** A member or subscript of something that isn't a path (`vector(1; 2; 3).x`). */
  | { readonly kind: 'member'; readonly of: FcNode };

/** Why a text is not an expression this importer can read: FreeCAD's grammar refuses it, or a limit. */
export class FcSyntaxError extends Error {
  constructor(
    message: string,
    readonly limit = false,
  ) {
    super(message);
  }
}

type TokenKind = 'num' | 'name' | 'string' | 'op' | 'end';
interface Token {
  readonly kind: TokenKind;
  readonly text: string;
  readonly value?: number;
  /** A space before it. */
  readonly spaced: boolean;
}

const isDigit = (c: string | undefined) => c !== undefined && c >= '0' && c <= '9';
const LETTER = /^\p{L}$/u;
const isNameStart = (c: string) => c === '_' || LETTER.test(c);
const isNameChar = (c: string) => isNameStart(c) || isDigit(c) || c === '@' || /^\p{N}$/u.test(c);

const OPERATORS = [
  '==',
  '!=',
  '<=',
  '>=',
  '<',
  '>',
  '+',
  '-',
  '−',
  '*',
  '/',
  '%',
  '^',
  '(',
  ')',
  ',',
  ';',
  '.',
  '[',
  ']',
  '?',
  ':',
  '#',
];

/** FreeCAD's tokens of `text`; throws `FcSyntaxError`. Linear in the text. */
function tokenize(text: string): Token[] {
  if (text.length > MAX_EXPRESSION_LENGTH)
    throw new FcSyntaxError(`it is longer than ${MAX_EXPRESSION_LENGTH} characters`, true);
  const chars = [...text];
  const tokens: Token[] = [];
  let i = 0;
  const push = (t: Token) => {
    if (tokens.length >= MAX_EXPRESSION_TOKENS)
      throw new FcSyntaxError(`it has more than ${MAX_EXPRESSION_TOKENS} tokens`, true);
    tokens.push(t);
  };
  while (i < chars.length) {
    let spaced = false;
    while (i < chars.length && /^\s$/u.test(chars[i] as string)) {
      i++;
      spaced = true;
    }
    if (i >= chars.length) break;
    const c = chars[i] as string;
    if (isDigit(c) || (c === '.' && isDigit(chars[i + 1]))) {
      let j = i;
      let s = '';
      while (isDigit(chars[j])) s += chars[j++];
      // A comma between digits is a decimal point (FreeCAD's `D*,D+`).
      if ((chars[j] === '.' || chars[j] === ',') && isDigit(chars[j + 1])) {
        s += '.';
        j++;
        while (isDigit(chars[j])) s += chars[j++];
      } else if (chars[j] === '.' && !isNameStart(chars[j + 1] ?? ' ')) {
        j++;
      }
      if (
        (chars[j] === 'e' || chars[j] === 'E') &&
        (isDigit(chars[j + 1]) ||
          ((chars[j + 1] === '-' || chars[j + 1] === '+') && isDigit(chars[j + 2])))
      ) {
        s += 'e';
        j++;
        if (chars[j] === '-' || chars[j] === '+') s += chars[j++];
        while (isDigit(chars[j])) s += chars[j++];
      }
      const value = Number(s);
      if (!Number.isFinite(value)) throw new FcSyntaxError('it has a number that is not finite');
      push({ kind: 'num', text: s, value, spaced });
      i = j;
      continue;
    }
    if (c === '<' && chars[i + 1] === '<') {
      let j = i + 2;
      let s = '';
      for (;;) {
        if (j >= chars.length) throw new FcSyntaxError('a quoted <<…>> has no end');
        if (chars[j] === '\\' && j + 1 < chars.length) {
          const e = chars[j + 1] as string;
          s += e === 't' ? '\t' : e === 'n' ? '\n' : e === 'r' ? '\r' : e;
          j += 2;
          continue;
        }
        if (chars[j] === '>' && chars[j + 1] === '>') break;
        s += chars[j++];
      }
      push({ kind: 'string', text: s, spaced });
      i = j + 2;
      continue;
    }
    if (isNameStart(c) || c === '$' || UNIT_TABLE.has(c)) {
      // `$A$1`: an absolute cell address.
      let j = i;
      let s = '';
      if (isNameStart(c) || c === '$') {
        while (j < chars.length && (isNameChar(chars[j] as string) || chars[j] === '$'))
          s += chars[j++];
      } else s = chars[j++] as string;
      push({ kind: 'name', text: s, spaced });
      i = j;
      continue;
    }
    const two = c + (chars[i + 1] ?? '');
    const op = OPERATORS.find((o) => (o.length === 2 ? o === two : o === c));
    if (!op) throw new FcSyntaxError(`it has a character FreeCAD doesn't read (${c})`);
    push({ kind: 'op', text: op === '−' ? '-' : op, spaced });
    i += op.length;
  }
  push({ kind: 'end', text: '', spaced: false });
  return tokens;
}

const CELL = /^\$?([A-Z]{1,2})\$?([0-9]{1,5})$/;

/**
 * A cell address as FreeCAD names it (`B6`; `$B$6` is the same cell), or
 * `undefined`. Upper case only: FreeCAD 1.1 takes `e1` and `x1` as aliases
 * (the `names` fixture), so they are not addresses.
 */
export function cellAddress(text: string): string | undefined {
  const m = CELL.exec(text);
  if (!m) return undefined;
  const row = Number(m[2]);
  return row >= 1 ? `${m[1] as string}${row}` : undefined;
}

/** Parses FreeCAD's expression text. Throws `FcSyntaxError`; never anything else for any text. */
export function parseFcExpression(text: string): FcNode {
  const tokens = tokenize(text);
  let at = 0;
  let depth = 0;
  const peek = (k = 0) => tokens[Math.min(at + k, tokens.length - 1)] as Token;
  const next = () => tokens[Math.min(at++, tokens.length - 1)] as Token;
  const isOp = (t: Token, s: string) => t.kind === 'op' && t.text === s;
  const expect = (s: string) => {
    const t = next();
    if (!isOp(t, s)) throw new FcSyntaxError(`expected ${s}`);
  };
  const nest = <T>(f: () => T): T => {
    if (++depth > MAX_EXPRESSION_DEPTH)
      throw new FcSyntaxError(`it is nested more than ${MAX_EXPRESSION_DEPTH} deep`, true);
    try {
      return f();
    } finally {
      depth--;
    }
  };

  const conditional = (): FcNode =>
    nest(() => {
      const test = comparison();
      if (!isOp(peek(), '?')) return test;
      next();
      const yes = conditional();
      expect(':');
      const no = conditional();
      return { kind: 'conditional', test, yes, no };
    });
  const comparison = (): FcNode => {
    let left = additive();
    while (peek().kind === 'op' && ['==', '!=', '<', '>', '<=', '>='].includes(peek().text)) {
      const op = next().text;
      left = nest(() => ({ kind: 'compare', op, left, right: additive() }) as FcNode);
    }
    return left;
  };
  const additive = (): FcNode => {
    let left = multiplicative();
    while (isOp(peek(), '+') || isOp(peek(), '-')) {
      const op = next().text as '+' | '-';
      left = nest(() => ({ kind: 'binary', op, left, right: multiplicative() }) as FcNode);
    }
    return left;
  };
  const multiplicative = (): FcNode => {
    let left = power();
    while (isOp(peek(), '*') || isOp(peek(), '/') || isOp(peek(), '%')) {
      const op = next().text as '*' | '/' | '%';
      left = nest(() => ({ kind: 'binary', op, left, right: power() }) as FcNode);
    }
    return left;
  };
  const power = (): FcNode => {
    let left = unary();
    while (isOp(peek(), '^')) {
      next();
      left = nest(() => ({ kind: 'binary', op: '^', left, right: unary() }) as FcNode);
    }
    return left;
  };
  const unary = (): FcNode =>
    nest(() => {
      if (isOp(peek(), '-') || isOp(peek(), '+')) {
        const op = next().text as '-' | '+';
        return { kind: 'unary', op, arg: unary() };
      }
      return postfix();
    });
  const postfix = (): FcNode => {
    const node = primary();
    if (node.kind !== 'path' && (isOp(peek(), '.') || isOp(peek(), '['))) {
      // A member of a value: read past it, never kept.
      while (isOp(peek(), '.') || isOp(peek(), '[')) {
        if (next().text === '.') {
          if (peek().kind !== 'name') throw new FcSyntaxError('expected a name after .');
          next();
        } else subscript();
      }
      return { kind: 'member', of: node };
    }
    return node;
  };
  /** After `[`: an index, a key or a slice, up to `]`. */
  const subscript = (): Pick<FcComponent, 'index' | 'key' | 'slice'> => {
    const t = peek();
    if (t.kind === 'string' && isOp(peek(1), ']')) {
      next();
      next();
      return { key: t.text };
    }
    const negative = isOp(t, '-');
    const n = peek(negative ? 1 : 0);
    if (n.kind === 'num' && isOp(peek(negative ? 2 : 1), ']') && Number.isInteger(n.value)) {
      at += negative ? 3 : 2;
      return { index: negative ? -(n.value as number) : (n.value as number) };
    }
    // Anything else (a slice, an expression): read to the matching `]`.
    let open = 1;
    while (open > 0) {
      const x = next();
      if (x.kind === 'end') throw new FcSyntaxError('a [ has no ]');
      if (isOp(x, '[')) open++;
      if (isOp(x, ']')) open--;
    }
    return { slice: true };
  };
  const component = (t: Token): FcComponent => {
    if (t.kind === 'string') return { name: t.text, quoted: true };
    if (t.kind !== 'name') throw new FcSyntaxError('expected a name');
    if (isFcToken(t.text)) throw new FcSyntaxError(`${t.text} is a unit or a constant, not a name`);
    return { name: t.text, quoted: false };
  };
  /** A path from its first part (already read); `local` for a leading `.`. */
  const path = (first: Token | undefined, local: boolean, document?: string): FcNode => {
    const components: FcComponent[] = [];
    const add = (t: Token) => {
      let c = component(t);
      while (isOp(peek(), '[')) {
        next();
        c = { ...c, ...subscript() };
        if (isOp(peek(), '[')) c = { ...c, slice: true };
      }
      components.push(c);
    };
    if (first) add(first);
    else add(next());
    while (isOp(peek(), '.')) {
      next();
      add(next());
      if (components.length > 16) throw new FcSyntaxError('a path has more than 16 parts', true);
    }
    return { kind: 'path', local, components, ...(document !== undefined ? { document } : {}) };
  };
  const unitAfterNumber = (): (readonly [string, number])[] | undefined => {
    const t = peek();
    const parenthesised = isOp(t, '(') && peek(1).kind === 'name' && UNIT_TABLE.has(peek(1).text);
    if (!parenthesised && !(t.kind === 'name' && UNIT_TABLE.has(t.text) && !isOp(peek(1), '(')))
      return undefined;
    if (parenthesised) next();
    const out: [string, number][] = [];
    const factor = (sign: number) => {
      const u = next();
      let power = 1;
      if (isOp(peek(), '^')) {
        const neg = isOp(peek(1), '-');
        const n = peek(neg ? 2 : 1);
        if (n.kind === 'num' && Number.isInteger(n.value)) {
          at += neg ? 3 : 2;
          power = neg ? -(n.value as number) : (n.value as number);
        }
      }
      out.push([u.text, sign * power]);
    };
    factor(1);
    // `mm/s`, `kg*m`: a unit operator only when a unit follows.
    while (
      (isOp(peek(), '*') || isOp(peek(), '/')) &&
      peek(1).kind === 'name' &&
      UNIT_TABLE.has(peek(1).text) &&
      !isOp(peek(2), '(')
    ) {
      const sign = next().text === '/' ? -1 : 1;
      factor(sign);
    }
    if (parenthesised) expect(')');
    return out;
  };
  const primary = (): FcNode => {
    const t = next();
    if (t.kind === 'num') {
      const unit = unitAfterNumber();
      const node: FcNode = { kind: 'num', value: t.value as number, ...(unit ? { unit } : {}) };
      // `1 ' 2 "`: feet and inches written side by side are their sum.
      if (unit?.length === 1 && unit[0]?.[0] === "'" && peek().kind === 'num') {
        const save = at;
        const n = next();
        const u2 = unitAfterNumber();
        if (u2?.length === 1 && u2[0]?.[0] === '"')
          return {
            kind: 'binary',
            op: '+',
            left: node,
            right: { kind: 'num', value: n.value as number, unit: u2 },
          };
        at = save;
      }
      return node;
    }
    if (t.kind === 'string') {
      if (isOp(peek(), '.')) return path(t, false);
      if (isOp(peek(), '#')) {
        next();
        return path(undefined, false, t.text);
      }
      return { kind: 'string', value: t.text };
    }
    if (isOp(t, '(')) {
      const inner = nest(conditional);
      expect(')');
      return inner;
    }
    if (isOp(t, '.')) return path(undefined, true);
    if (t.kind === 'name') {
      if (isOp(peek(), '(')) {
        if (!FC_FUNCTIONS.has(t.text))
          throw new FcSyntaxError(`${t.text} is not a FreeCAD function`);
        next();
        const args: FcNode[] = [];
        if (!isOp(peek(), ')')) {
          for (;;) {
            const a = peek();
            const from = a.kind === 'name' ? cellAddress(a.text) : undefined;
            const to =
              isOp(peek(1), ':') && peek(2).kind === 'name' ? cellAddress(peek(2).text) : undefined;
            if (from && to) {
              at += 3;
              args.push({ kind: 'range', from, to });
            } else args.push(nest(conditional));
            if (isOp(peek(), ';') || isOp(peek(), ',')) {
              next();
              continue;
            }
            break;
          }
        }
        expect(')');
        return nest(() => ({ kind: 'call', name: t.text, args }) as FcNode);
      }
      const constant = CONSTANTS.get(t.text);
      if (constant !== undefined) {
        if (isOp(peek(), '.')) throw new FcSyntaxError(`${t.text} is a constant, not a name`);
        return { kind: 'constant', name: t.text, value: constant };
      }
      const unit = UNIT_TABLE.get(t.text);
      if (unit) {
        if (isOp(peek(), '.') || isOp(peek(), '#'))
          throw new FcSyntaxError(`${t.text} is a unit, not a name`);
        // A unit alone is one of it.
        return { kind: 'num', value: 1, unit: [[t.text, 1]] };
      }
      if (isOp(peek(), '#')) {
        next();
        return path(undefined, false, t.text);
      }
      return path(t, false);
    }
    throw new FcSyntaxError(t.kind === 'end' ? 'it ends too early' : `unexpected ${t.text}`);
  };

  const root = conditional();
  if (peek().kind !== 'end') throw new FcSyntaxError(`unexpected ${peek().text}`);
  return root;
}

/** Every path the expression reads, in order (a bounded walk: the tree is bounded by the limits). */
export function pathsOf(node: FcNode): Extract<FcNode, { kind: 'path' }>[] {
  const out: Extract<FcNode, { kind: 'path' }>[] = [];
  const stack: FcNode[] = [node];
  while (stack.length > 0) {
    const n = stack.pop() as FcNode;
    switch (n.kind) {
      case 'path':
        out.push(n);
        break;
      case 'unary':
        stack.push(n.arg);
        break;
      case 'binary':
      case 'compare':
        stack.push(n.right, n.left);
        break;
      case 'conditional':
        stack.push(n.no, n.yes, n.test);
        break;
      case 'call':
        for (let i = n.args.length - 1; i >= 0; i--) stack.push(n.args[i] as FcNode);
        break;
      case 'member':
        stack.push(n.of);
        break;
    }
  }
  return out;
}
