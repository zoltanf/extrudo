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
 * `label` with control characters (U+0000–U+001F, U+007F–U+009F) and line
 * and paragraph separators as spaces, the invisible format characters
 * removed (S13: `FORMAT`), a lone surrogate as U+FFFD, runs of white space as
 * one space, trimmed and cut to `MAX_NAME_LENGTH` code points; `fallback` (the
 * object's internal name) when nothing is left. Letters keep their own
 * direction: a right-to-left name still reads right to left.
 */
export function cleanName(label: string, fallback: string): string {
  return tidy(label) || tidy(fallback) || 'Shape';
}

// biome-ignore lint/suspicious/noControlCharactersInRegex: replacing them is the point
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g;
/**
 * Invisible format characters a name shouldn't carry (S13): bidirectional embeddings, overrides
 * and isolates, the marks, U+180E, zero widths, U+FEFF, the interlinear annotation characters
 * U+FFF9–U+FFFB and the tag characters U+E0000–U+E007F.
 */
const FORMAT =
  /[\u061c\u180e\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff\ufff9-\ufffb]|\udb40[\udc00-\udc7f]/g;
const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g;

/** `text` with no control, format or lone surrogate character (S13), nothing else changed. */
export function plainText(text: string): string {
  return text.replace(LONE_SURROGATE, '\ufffd').replace(FORMAT, '').replace(CONTROL, ' ');
}

function tidy(text: string): string {
  const flat = plainText(text).replace(/\s+/g, ' ').trim();
  return [...flat].slice(0, MAX_NAME_LENGTH).join('').trim();
}

/**
 * An attachment's file name for a cleaned name: the export's rule
 * (`safeFileName` in `@extrudo/kernel`'s `model-export.ts`, which this package
 * may not import): `< > : " / \ | ? *` as spaces, white space collapsed,
 * leading dots dropped, then `.step`.
 */
export function stepFileName(name: string): string {
  return modelFileName(name, 'step');
}

/** An attachment's file name for a cleaned name and an extension (`stl`): `stepFileName`'s rule. */
export function modelFileName(name: string, extension: string): string {
  const base = name
    .replace(/[<>:"/\\|?*]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    // Leading dots and the spaces between them (`../..` became `.. ..`): no hidden or relative name.
    .replace(/^[.\s]+/, '');
  return `${base || 'Shape'}.${extension}`;
}

/**
 * `text` cut to `MAX_DETAIL_LENGTH` code points (with an ellipsis when cut), S13: with no
 * control, format or lone surrogate character (`plainText`), since a detail may quote the file.
 */
export function clip(text: string, max = MAX_DETAIL_LENGTH): string {
  const chars = [...plainText(text)];
  return chars.length <= max ? chars.join('') : `${chars.slice(0, max - 1).join('')}…`;
}
