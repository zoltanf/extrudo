/**
 * Expression lexer and Pratt parser (architecture §4.3).
 *
 * Grammar, loosest binding first:
 *   + -          left-assoc
 *   * /          left-assoc
 *   unary + -
 *   ^            right-assoc, binds tighter than unary minus (-2^2 = -4)
 *   atoms        number [unit] · name · name(args) · ( expr )
 * A unit may follow a number literal only: `10 mm`, `2.5in`, `1e-3 m`.
 * An inch design may also type fractions and feet-inches (ADR-0113 §3):
 * `3/8 in`, `1 1/2"`, `5' 6"` each parse to one number.
 */
import { ExprError } from './errors';
import { canonicalUnit, UNIT_NAMES, unitNamed } from './units';

/** Half-open source range [start, end), for error underlines. */
export interface Span {
  start: number;
  end: number;
}

export type Node =
  | { kind: 'num'; value: number; unit: string | undefined; span: Span }
  | { kind: 'ref'; name: string; span: Span }
  | { kind: 'unary'; op: '+' | '-'; arg: Node; span: Span }
  | { kind: 'binary'; op: '+' | '-' | '*' | '/' | '^'; left: Node; right: Node; span: Span }
  | { kind: 'call'; name: string; args: Node[]; span: Span };

type TokenKind = 'num' | 'name' | 'op' | 'end';

interface Token {
  kind: TokenKind;
  text: string;
  start: number;
  end: number;
}

const NUMBER = /(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/y;
const NAME = /[A-Za-z_][A-Za-z0-9_]*/y;
const SPACE = /\s+/y;
const OPERATORS = '+-*/^(),';

export function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let pos = 0;
  const match = (re: RegExp) => {
    re.lastIndex = pos;
    return re.exec(source)?.[0];
  };
  while (pos < source.length) {
    const space = match(SPACE);
    if (space) {
      pos += space.length;
      continue;
    }
    const num = match(NUMBER);
    const text = num ?? match(NAME);
    if (text) {
      // `1e3` is a number, but `2e` or `3x` runs a number into a name.
      tokens.push({ kind: num ? 'num' : 'name', text, start: pos, end: pos + text.length });
      pos += text.length;
      continue;
    }
    const char = source.charAt(pos);
    // The foot and inch marks (`5'`, `6"`) are unit tokens (ADR-0113 §3).
    if (char === "'" || char === '"') {
      tokens.push({ kind: 'name', text: char, start: pos, end: pos + 1 });
      pos += 1;
      continue;
    }
    if (OPERATORS.includes(char)) {
      tokens.push({ kind: 'op', text: char, start: pos, end: pos + 1 });
      pos += 1;
      continue;
    }
    throw new ExprError(`Unexpected character \`${char}\`.`, { start: pos, end: pos + 1 });
  }
  tokens.push({ kind: 'end', text: '', start: source.length, end: source.length });
  return tokens;
}

const INFIX_POWER: Record<string, [left: number, right: number]> = {
  '+': [10, 11],
  '-': [10, 11],
  '*': [20, 21],
  '/': [20, 21],
  '^': [41, 40],
};
const PREFIX_POWER = 30;
/**
 * How deep an expression may nest (brackets, operators, calls). Far beyond
 * anything typed, and well inside the stack, so a hostile file's
 * `((((…))))` gets a clean error rather than a stack overflow.
 */
export const MAX_DEPTH = 256;

export function parse(source: string): Node {
  const tokens = tokenize(source);
  let index = 0;
  const peek = (): Token => tokens[index] as Token;
  const next = (): Token => tokens[index++] as Token;

  if (peek().kind === 'end') {
    throw new ExprError('Enter a value or an expression.', { start: 0, end: source.length });
  }

  // The parser's own nesting, and each node's height: a long `1+1+…` chain
  // nests the tree without nesting the parser.
  let nesting = 0;
  const heights = new WeakMap<Node, number>();
  const tooDeep = (span: Span): never => {
    throw new ExprError(`Nested more than ${MAX_DEPTH} levels deep.`, span);
  };
  const grown = <T extends Node>(node: T, ...children: Node[]): T => {
    const height = 1 + Math.max(0, ...children.map((c) => heights.get(c) ?? 1));
    if (height > MAX_DEPTH) tooDeep(node.span);
    heights.set(node, height);
    return node;
  };

  function expression(minPower: number): Node {
    if (++nesting > MAX_DEPTH) tooDeep(peek());
    try {
      return infix(minPower);
    } finally {
      nesting--;
    }
  }

  function infix(minPower: number): Node {
    let left = prefix();
    for (;;) {
      const token = peek();
      if (token.kind === 'end' || token.text === ')' || token.text === ',') break;
      if (token.kind !== 'op' || token.text === '(') {
        throw new ExprError(`Missing an operator before \`${token.text}\`.`, token);
      }
      const power = INFIX_POWER[token.text];
      if (!power) throw new ExprError(`Unexpected \`${token.text}\`.`, token);
      const [leftPower, rightPower] = power;
      if (leftPower < minPower) break;
      next();
      const right = expression(rightPower);
      left = grown(
        {
          kind: 'binary',
          op: token.text as '+' | '-' | '*' | '/' | '^',
          left,
          right,
          span: { start: left.span.start, end: right.span.end },
        },
        left,
        right,
      );
    }
    return left;
  }

  function prefix(): Node {
    const token = next();
    if (token.kind === 'num') return number(token);
    if (token.kind === 'name') return nameOrCall(token);
    if (token.text === '(') {
      const inner = expression(0);
      const close = next();
      if (close.text !== ')') {
        throw new ExprError('Missing a closing `)`.', {
          start: token.start,
          end: close.kind === 'end' ? source.length : close.start,
        });
      }
      return grown({ ...inner, span: { start: token.start, end: close.end } }, inner);
    }
    if (token.text === '-' || token.text === '+') {
      const arg = expression(PREFIX_POWER);
      return grown(
        { kind: 'unary', op: token.text, arg, span: { start: token.start, end: arg.span.end } },
        arg,
      );
    }
    if (token.kind === 'end') {
      const previous = tokens[index - 2];
      throw new ExprError(
        previous ? `Expected a value after \`${previous.text}\`.` : 'Expected a value.',
        { start: previous?.start ?? 0, end: source.length },
      );
    }
    throw new ExprError(`Expected a value, found \`${token.text}\`.`, token);
  }

  /** `int/int` with no whitespace, at token index `at` (the numerator). */
  function fractionAt(at: number): { value: number; denominator: Token; last: number } | undefined {
    const numerator = tokens[at];
    const slash = tokens[at + 1];
    const denominator = tokens[at + 2];
    if (
      numerator?.kind !== 'num' ||
      !/^\d+$/.test(numerator.text) ||
      slash?.kind !== 'op' ||
      slash.text !== '/' ||
      numerator.end !== slash.start ||
      denominator?.kind !== 'num' ||
      !/^\d+$/.test(denominator.text) ||
      slash.end !== denominator.start
    ) {
      return undefined;
    }
    const den = Number(denominator.text);
    if (den === 0) {
      throw new ExprError('Divide by zero in a fraction.', {
        start: numerator.start,
        end: denominator.end,
      });
    }
    return { value: Number(numerator.text) / den, denominator, last: at + 2 };
  }

  /** The length unit token at token index `at`, if any (a fraction must take one). */
  function lengthUnitAt(at: number): Token | undefined {
    const token = tokens[at];
    if (token?.kind !== 'name') return undefined;
    const unit = unitNamed(token.text);
    return unit && unit.dim.length === 1 && unit.dim.angle === 0 ? token : undefined;
  }

  function numNode(value: number, unitToken: Token, start: number): Node {
    return {
      kind: 'num',
      value,
      unit: canonicalUnit(unitToken.text),
      span: { start, end: unitToken.end },
    };
  }

  /**
   * One number with an optional unit, a fraction or a mixed number
   * (ADR-0113 §3): `10 mm`, `3/8 in`, `1 1/2 in`, `1-1/2"`. A fraction is
   * `int/int` with no spaces; either form needs a length unit right after it,
   * so `10 / 2`, `10/2` and `width/2` stay arithmetic.
   */
  function singleNumber(token: Token): Node {
    if (/^\d+$/.test(token.text)) {
      // A mixed number: `1 1/2` (space) or `1-1/2` (dash), then a fraction.
      const dash = tokens[index];
      const dashed =
        dash?.kind === 'op' && dash.text === '-' && dash.start === token.end
          ? fractionAt(index + 1)
          : undefined;
      const mixed = dashed ?? fractionAt(index);
      if (mixed) {
        const unitToken = lengthUnitAt(mixed.last + 1);
        if (unitToken) {
          index = mixed.last + 2;
          return numNode(Number(token.text) + mixed.value, unitToken, token.start);
        }
        // A spaced mixed number with no length unit can't mean anything else;
        // a dashed one falls through, so `1-1/2` stays `1 - 1/2`.
        if (!dashed) {
          throw new ExprError('A mixed number needs a length unit, like `1 1/2 in`.', {
            start: token.start,
            end: mixed.denominator.end,
          });
        }
      }
      // A plain fraction `3/8`, only when a length unit follows.
      const slash = tokens[index];
      const denominator = tokens[index + 1];
      if (
        slash?.kind === 'op' &&
        slash.text === '/' &&
        token.end === slash.start &&
        denominator?.kind === 'num' &&
        /^\d+$/.test(denominator.text) &&
        slash.end === denominator.start
      ) {
        const unitToken = lengthUnitAt(index + 2);
        if (unitToken) {
          const den = Number(denominator.text);
          if (den === 0) {
            throw new ExprError('Divide by zero in a fraction.', {
              start: token.start,
              end: denominator.end,
            });
          }
          index += 3;
          return numNode(Number(token.text) / den, unitToken, token.start);
        }
        const after = tokens[index + 2];
        if (after?.kind === 'name' && unitNamed(after.text)) {
          throw new ExprError('Fractions take a length unit, like `3/8 in`.', after);
        }
      }
    }
    const value = Number(token.text);
    const unitToken = peek();
    if (unitToken.kind === 'name' && unitToken.start === token.end && !unitNamed(unitToken.text)) {
      throw new ExprError(
        `\`${unitToken.text}\` isn't a unit. Units: ${UNIT_NAMES.join(', ')}.`,
        unitToken,
      );
    }
    if (unitToken.kind === 'name' && unitNamed(unitToken.text)) {
      next();
      return numNode(value, unitToken, token.start);
    }
    return { kind: 'num', value, unit: undefined, span: token };
  }

  /**
   * A number, plus a feet number directly followed by an inches number as
   * their sum in inches: `5' 6"` and `5 ft 6 in` are 66 in (ADR-0113 §3).
   */
  function number(token: Token): Node {
    const first = singleNumber(token);
    if (first.kind !== 'num' || first.unit !== 'ft') return first;
    const nextToken = tokens[index];
    if (nextToken?.kind !== 'num') return first;
    const save = index;
    index += 1;
    let second: Node;
    try {
      second = singleNumber(nextToken);
    } catch (error) {
      index = save;
      throw error;
    }
    if (second.kind !== 'num' || second.unit !== 'in') {
      index = save;
      return first;
    }
    return {
      kind: 'num',
      value: first.value * 12 + second.value,
      unit: 'in',
      span: { start: first.span.start, end: second.span.end },
    };
  }

  function nameOrCall(token: Token): Node {
    if (unitNamed(token.text)) {
      throw new ExprError(`A unit needs a number before it, like \`1 ${token.text}\`.`, token);
    }
    if (peek().text !== '(') return { kind: 'ref', name: token.text, span: token };
    next();
    const args: Node[] = [];
    if (peek().text !== ')') {
      for (;;) {
        args.push(expression(0));
        if (peek().text !== ',') break;
        next();
      }
    }
    const close = next();
    if (close.text !== ')') {
      throw new ExprError(`Missing a closing \`)\` for \`${token.text}(\`.`, {
        start: token.start,
        end: close.kind === 'end' ? source.length : close.start,
      });
    }
    return grown(
      { kind: 'call', name: token.text, args, span: { start: token.start, end: close.end } },
      ...args,
    );
  }

  const root = expression(0);
  const rest = peek();
  if (rest.kind !== 'end') {
    throw new ExprError(
      rest.text === ')' ? 'There is a `)` without a matching `(`.' : `Unexpected \`${rest.text}\`.`,
      rest,
    );
  }
  return root;
}

/**
 * Is the source exactly one number literal (with an optional unit, fraction
 * or feet-inches), so it reads as a value the user typed rather than a
 * formula? `10`, `-2.5`, `3/8 in`, `1 1/2"` and `5' 6"` are; `2 * 3`,
 * `width + 2` and `10 / 2` are not.
 */
export function isNumberLiteral(source: string): boolean {
  try {
    const node = parse(source.trim());
    return node.kind === 'num' || (node.kind === 'unary' && node.arg.kind === 'num');
  } catch {
    return false;
  }
}

/** Every name the expression refers to (parameters, not functions or units), in order, once each. */
export function references(node: Node): string[] {
  const names = new Set<string>();
  const walk = (n: Node): void => {
    switch (n.kind) {
      case 'ref':
        names.add(n.name);
        break;
      case 'unary':
        walk(n.arg);
        break;
      case 'binary':
        walk(n.left);
        walk(n.right);
        break;
      case 'call':
        n.args.forEach(walk);
        break;
    }
  };
  walk(node);
  return [...names];
}
