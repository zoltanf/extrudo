/**
 * Creating a parameter inline (FR-PAR-03): `wall = 2 mm` typed into a value
 * field defines the user parameter `wall` and leaves `wall` in the field.
 */
import type { UnitKind } from '../schema';
import { ExprError } from './errors';
import { type EvaluateResult, isReservedName } from './evaluate';
import type { Span } from './parser';

export interface InlineParameter {
  name: string;
  /** Where the name is in the typed text. */
  nameSpan: Span;
  /** The value's expression, after the `=`. */
  expression: string;
  /** Where the expression starts in the typed text. */
  offset: number;
}

const DEFINITION = /^(\s*)([A-Za-z_][A-Za-z0-9_]*)\s*=(?!=)\s*/;

/** The definition in `text` if it has the form `name = expression`. */
export function inlineParameter(text: string): InlineParameter | undefined {
  const match = DEFINITION.exec(text);
  if (!match) return undefined;
  const start = (match[1] ?? '').length;
  const name = match[2] ?? '';
  return {
    name,
    nameSpan: { start, end: start + name.length },
    expression: text.slice(match[0].length),
    offset: match[0].length,
  };
}

/**
 * The value an inline definition gives, checked like a new parameter: the
 * name must be free and not a unit, function or constant. Error spans are
 * in the typed text, so the field underlines the right part.
 */
export function evaluateInline(
  inline: InlineParameter,
  taken: ReadonlySet<string>,
  evaluate: (expression: string, unit: UnitKind) => EvaluateResult,
  unit: UnitKind,
): EvaluateResult {
  const refuse = (message: string): EvaluateResult => ({
    ok: false,
    error: new ExprError(message, inline.nameSpan),
  });
  if (isReservedName(inline.name)) {
    return refuse(`\`${inline.name}\` is a unit, function or constant; pick another name.`);
  }
  if (taken.has(inline.name)) return refuse(`A parameter named \`${inline.name}\` already exists.`);
  if (inline.expression.trim() === '') {
    const at = inline.offset;
    return {
      ok: false,
      error: new ExprError('Give the new parameter a value.', { start: at, end: at }),
    };
  }
  const result = evaluate(inline.expression, unit);
  if (result.ok) return result;
  const { start, end } = result.error.span;
  return {
    ok: false,
    error: new ExprError(result.error.message, {
      start: start + inline.offset,
      end: end + inline.offset,
    }),
  };
}
