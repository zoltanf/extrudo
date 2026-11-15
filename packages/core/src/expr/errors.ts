import type { Span } from './parser';

/**
 * What kind of error, for callers that act on it: completion leaves out names
 * the field doesn't know (`unknown-name`) or that would refer back to it
 * (`cycle`); an importer keeps a value in place of an expression past a limit
 * on length, values per call or depth through parameters (`limit`).
 */
export type ExprErrorCode = 'unknown-name' | 'cycle' | 'limit';

/** An expression that doesn't parse or evaluate. `span` marks the part to underline. */
export class ExprError extends Error {
  override readonly name = 'ExprError';
  readonly span: Span;
  readonly code: ExprErrorCode | undefined;

  constructor(message: string, span: Span, code?: ExprErrorCode) {
    super(message);
    this.span = { start: span.start, end: span.end };
    this.code = code;
  }
}
