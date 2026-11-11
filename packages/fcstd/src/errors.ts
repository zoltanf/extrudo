/** A file that is not the shape this reader expects, or that breaks one of its limits. */
export class FcstdFormatError extends Error {
  override name = 'FcstdFormatError';
}

/**
 * A number from the file, refused unless finite (`what` names it): NaN and
 * infinities from a file never reach the mapping or the kernel. `undefined`
 * when the text is missing; a text that is not a number at all is refused too.
 */
export function finite(what: string, text: string | undefined): number | undefined {
  if (text === undefined) return undefined;
  const trimmed = text.trim();
  const value = trimmed === '' ? Number.NaN : Number(trimmed);
  if (!Number.isFinite(value))
    throw new FcstdFormatError(`${what}: "${short(text)}" is not a finite number.`);
  return value;
}

/** At most 40 characters of a file's text, for a message. */
export function short(text: string): string {
  return text.length > 40 ? `${text.slice(0, 37)}...` : text;
}
