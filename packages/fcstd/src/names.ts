/**
 * Names that come from a file (labels) before they reach a design, a file
 * name or a notice: they are the file author's text, so control characters
 * go, white space is tidied and the length is bounded.
 */

/** The longest name the import writes. */
export const MAX_NAME_LENGTH = 120;
/** The longest `detail` or error text the import passes on. */
export const MAX_DETAIL_LENGTH = 300;

/**
 * `label` with control characters (U+0000–U+001F, U+007F) as spaces, runs of
 * white space as one space, trimmed and cut to `MAX_NAME_LENGTH`; `fallback`
 * (the object's internal name) when nothing is left.
 */
export function cleanName(label: string, fallback: string): string {
  return tidy(label) || tidy(fallback) || 'Shape';
}

// biome-ignore lint/suspicious/noControlCharactersInRegex: replacing them is the point
const CONTROL = /[\u0000-\u001f\u007f]/g;

function tidy(text: string): string {
  const flat = text.replace(CONTROL, ' ').replace(/\s+/g, ' ').trim();
  return [...flat].slice(0, MAX_NAME_LENGTH).join('').trim();
}

/**
 * An attachment's file name for a cleaned name: the export's rule
 * (`safeFileName` in `@extrudo/kernel`'s `model-export.ts`, which this package
 * may not import): `< > : " / \ | ? *` as spaces, white space collapsed,
 * leading dots dropped, then `.step`.
 */
export function stepFileName(name: string): string {
  const base = name
    .replace(/[<>:"/\\|?*]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '');
  return `${base || 'Shape'}.step`;
}

/** `text` cut to `MAX_DETAIL_LENGTH` characters (with an ellipsis when cut). */
export function clip(text: string, max = MAX_DETAIL_LENGTH): string {
  const chars = [...text];
  return chars.length <= max ? text : `${chars.slice(0, max - 1).join('')}…`;
}
