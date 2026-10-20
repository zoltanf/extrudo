/**
 * Parameter name completion in expression fields (ADR-0096): the word at the
 * caret and the names that match it. Pure, so `ExpressionInput` only renders.
 */

/** The identifier around the caret: the part a picked name replaces. */
export interface Word {
  start: number;
  end: number;
  text: string;
}

/** A name to offer, with its value for display ("12.00 mm"); no value when it has an error. */
export interface NameEntry {
  name: string;
  value?: string;
}

const WORD_CHAR = /[A-Za-z0-9_]/;
// A number literal (the parser's NUMBER) ending the text, then spaces: a unit goes there.
const NUMBER_BEFORE = /(?<![A-Za-z0-9_.])(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?\s*$/;

/**
 * The word at `caret`, empty between two non-word characters. Undefined where
 * no parameter name can go: inside a number (`12`, `1e3`), or where a unit
 * follows a number (`10 m`).
 */
export function wordAt(text: string, caret: number): Word | undefined {
  let start = caret;
  while (start > 0 && WORD_CHAR.test(text.charAt(start - 1))) start--;
  let end = caret;
  while (end < text.length && WORD_CHAR.test(text.charAt(end))) end++;
  const word = text.slice(start, end);
  if (/^\d/.test(word)) return undefined;
  if (NUMBER_BEFORE.test(text.slice(0, start))) return undefined;
  return { start, end, text: word };
}

/**
 * The entries whose name contains `word`, ignoring case: the exact name first,
 * then prefix matches, then the rest, each group in the given order. An empty
 * word matches every entry.
 */
export function matching(word: string, entries: readonly NameEntry[]): NameEntry[] {
  const needle = word.toLowerCase();
  const rank = (name: string) => {
    if (name === word) return 0;
    const lower = name.toLowerCase();
    if (lower.startsWith(needle)) return 1;
    return lower.includes(needle) ? 2 : undefined;
  };
  return entries
    .flatMap((entry, index) => {
      const r = rank(entry.name);
      return r === undefined ? [] : [{ entry, r, index }];
    })
    .sort((a, b) => a.r - b.r || a.index - b.index)
    .map(({ entry }) => entry);
}
