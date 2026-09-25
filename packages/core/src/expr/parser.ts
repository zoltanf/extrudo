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
 */
import { ExprError } from './errors';
import { UNIT_NAMES, UNITS } from './units';

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

export function parse(source: string): Node {
  const tokens = tokenize(source);
  let index = 0;
  const peek = (): Token => tokens[index] as Token;
  const next = (): Token => tokens[index++] as Token;

  if (peek().kind === 'end') {
    throw new ExprError('Enter a value or an expression.', { start: 0, end: source.length });
  }

  function expression(minPower: number): Node {
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
      left = {
        kind: 'binary',
        op: token.text as '+' | '-' | '*' | '/' | '^',
        left,
        right,
        span: { start: left.span.start, end: right.span.end },
      };
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
      return { ...inner, span: { start: token.start, end: close.end } };
    }
    if (token.text === '-' || token.text === '+') {
      const arg = expression(PREFIX_POWER);
      return {
        kind: 'unary',
        op: token.text,
        arg,
        span: { start: token.start, end: arg.span.end },
      };
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

  function number(token: Token): Node {
    const value = Number(token.text);
    const unitToken = peek();
    if (unitToken.kind === 'name' && unitToken.start === token.end && !UNITS[unitToken.text]) {
      throw new ExprError(
        `\`${unitToken.text}\` isn't a unit. Units: ${UNIT_NAMES.join(', ')}.`,
        unitToken,
      );
    }
    if (unitToken.kind === 'name' && UNITS[unitToken.text]) {
      next();
      return {
        kind: 'num',
        value,
        unit: unitToken.text,
        span: { start: token.start, end: unitToken.end },
      };
    }
    return { kind: 'num', value, unit: undefined, span: token };
  }

  function nameOrCall(token: Token): Node {
    if (UNITS[token.text]) {
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
    return { kind: 'call', name: token.text, args, span: { start: token.start, end: close.end } };
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
