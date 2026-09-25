import type { Span } from './parser';

/** An expression that doesn't parse or evaluate. `span` marks the part to underline. */
export class ExprError extends Error {
  override readonly name = 'ExprError';
  readonly span: Span;

  constructor(message: string, span: Span) {
    super(message);
    this.span = { start: span.start, end: span.end };
  }
}
