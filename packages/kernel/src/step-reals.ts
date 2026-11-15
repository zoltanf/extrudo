/**
 * STEP reals written without a decimal point (`1e1`, `2E-7`, `-5e+3`), read
 * as the standard requires (ADR-0066, amendment of 2026-11-15). ISO 10303-21
 * writes a real with a point (`1.E1`); the kernel's reader takes a real
 * without one but reads some of them as other numbers (those with an unsigned
 * one-digit mantissa: `1e1` as 0), so a file from another writer could import
 * as another shape. This pass writes each such real in the standard form
 * (`1e1` → `1.E1`) before the reader sees it.
 *
 * It looks only at numbers between the delimiters of a parameter list: never
 * inside a string (`'…'`, `''` an escaped quote), a binary (`"…"`) or a
 * comment (`/* … *\/`), nor in a name such as `#12` or `.MILLI.`. One pass,
 * left to right, whose only state is whether it is inside a string, a binary
 * or a comment, so it is linear in the text and could run over chunks as they
 * come. A text with no such real (every file the standard allows) comes back
 * as it is: the same string.
 */

const QUOTE = 0x27; // '
const DQUOTE = 0x22; // "
const SLASH = 0x2f;
const STAR = 0x2a;
const DOT = 0x2e;
const PLUS = 0x2b;
const MINUS = 0x2d;
const E_UPPER = 0x45;
const E_LOWER = 0x65;

const isDigit = (c: number) => c >= 0x30 && c <= 0x39;

/** What may stand right before a number's first character: a list's opening, a comma or white space. */
const opens = (c: number) =>
  c === 0x28 /* ( */ || c === 0x2c /* , */ || c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d;

const isLetter = (c: number) => (c | 0x20) >= 0x61 && (c | 0x20) <= 0x7a;

/** What may stand right after a number: the text's end or anything that can't continue a token. */
const closes = (c: number) =>
  Number.isNaN(c) || !((isDigit(c) || isLetter(c) || c === DOT || c === 0x5f) /* _ */);

/** Could the text hold a real with an exponent and no point at all? (A quick test that may say yes wrongly.) */
const CANDIDATE = /(?:^|[^0-9.])[0-9]+[eE][-+]?[0-9]/;

/** `text` with every real written without a decimal point in the standard form. */
export function standardStepReals(text: string): string {
  if (!CANDIDATE.test(text)) return text;
  const parts: string[] = [];
  let from = 0;
  const n = text.length;
  let i = 0;
  while (i < n) {
    const c = text.charCodeAt(i);
    if (c === QUOTE) {
      // A string: to the quote that isn't doubled.
      i++;
      while (i < n) {
        if (text.charCodeAt(i) === QUOTE) {
          if (text.charCodeAt(i + 1) === QUOTE) i += 2;
          else break;
        } else i++;
      }
      i++;
      continue;
    }
    if (c === DQUOTE) {
      const end = text.indexOf('"', i + 1);
      i = end < 0 ? n : end + 1;
      continue;
    }
    if (c === SLASH && text.charCodeAt(i + 1) === STAR) {
      const end = text.indexOf('*/', i + 2);
      i = end < 0 ? n : end + 2;
      continue;
    }
    const start = i;
    if ((isDigit(c) || c === PLUS || c === MINUS) && (i === 0 || opens(text.charCodeAt(i - 1)))) {
      let k = c === PLUS || c === MINUS ? i + 1 : i;
      const digits = k;
      while (k < n && isDigit(text.charCodeAt(k))) k++;
      const e = text.charCodeAt(k);
      if (k > digits && (e === E_UPPER || e === E_LOWER)) {
        let x = k + 1;
        const sign = text.charCodeAt(x);
        if (sign === PLUS || sign === MINUS) x++;
        const exponent = x;
        while (x < n && isDigit(text.charCodeAt(x))) x++;
        if (x > exponent && closes(text.charCodeAt(x))) {
          parts.push(text.slice(from, k), '.E', text.slice(k + 1, x));
          from = x;
        }
        i = x;
        continue;
      }
      i = Math.max(k, start + 1);
      continue;
    }
    i++;
  }
  if (from === 0) return text;
  parts.push(text.slice(from));
  return parts.join('');
}
