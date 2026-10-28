import type { LengthUnit } from '../schema';
import { type Node, parse } from './parser';

/**
 * Is the expression a plain number: literals and arithmetic of literals with
 * no unit and no parameter (`10`, `-2.5`, `10 / 2`)? Such a number takes the
 * document's length unit when it is read (ADR-0004), so it means something
 * else once that unit changes.
 */
export function isBareNumber(expression: string): boolean {
  try {
    return isBare(parse(expression.trim()));
  } catch {
    return false;
  }
}

function isBare(node: Node): boolean {
  switch (node.kind) {
    case 'num':
      return node.unit === undefined;
    case 'unary':
      return isBare(node.arg);
    case 'binary':
      return isBare(node.left) && isBare(node.right);
    default:
      return false;
  }
}

/**
 * The expression with `unit` spelled out if it is a plain number, so it keeps
 * its length when the document's unit changes (ADR-0113 §1): `10` → `10 mm`,
 * `-2.5` → `-2.5 mm`, `10 / 2` → `(10 / 2) * 1 mm`. Anything else (a unit
 * already written, a parameter, a function) comes back unchanged.
 */
export function spellOutUnit(expression: string, unit: LengthUnit): string {
  const trimmed = expression.trim();
  if (!isBareNumber(trimmed)) return expression;
  return /^[-+]?\s*(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(trimmed)
    ? `${trimmed} ${unit}`
    : `(${trimmed}) * 1 ${unit}`;
}
