/**
 * Text on a sheet (ADR-0143 §7): Inter Regular and Bold through the text
 * module's API (`@extrudo/sketch/text`, the only place opentype.js is
 * imported), turned into display-list text runs: the glyph outlines in sheet
 * mm, y down, plus the string. Sizes are cap heights, as everywhere in
 * Extrudo's text (ADR-0058): a 3.5 mm text has 3.5 mm capitals.
 */
import type { UnitContour } from '@extrudo/core';
import type { BundledFontId } from '@extrudo/fonts';
import type { Contour, DisplayText, Matrix, Point } from '@extrudo/io';
import { transformContour } from '@extrudo/io';
import { measureText, shapeText } from '@extrudo/sketch/text';

/** The two faces sheets use; the caller loads them (`loadFont`) before laying out. */
export const SHEET_FONT = {
  regular: 'inter-regular@1',
  bold: 'inter-bold@1',
} as const satisfies Record<string, BundledFontId>;
export type SheetFont = keyof typeof SHEET_FONT;
export const SHEET_FONTS: readonly BundledFontId[] = Object.values(SHEET_FONT);

/** Baseline to baseline, in letter heights. */
export const LINE_SPACING = 1.6;

function notLoaded(font: SheetFont): Error {
  return new Error(`The sheet font ${SHEET_FONT[font]} is not loaded`);
}

/** The advance width of one line at letter height `height`, mm. */
export function textWidth(text: string, height: number, font: SheetFont = 'regular'): number {
  const unit = measureText(SHEET_FONT[font], text);
  if (unit === undefined) throw notLoaded(font);
  return unit * height;
}

export interface TextRunOptions {
  font?: SheetFont;
  color?: string;
  /** Baseline direction, radians from +x towards +y (clockwise as seen). */
  angle?: number;
  key?: string;
}

/** One line of text as a run, its baseline starting at `at`, capitals `height` mm high. */
export function textRun(
  text: string,
  at: Point,
  height: number,
  options: TextRunOptions = {},
): DisplayText {
  const font = options.font ?? 'regular';
  const layout = shapeText(SHEET_FONT[font], text, 'left');
  if (!layout) throw notLoaded(font);
  const angle = options.angle ?? 0;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  // The unit frame is y up with the cap height 1: scale by `height`, mirror
  // y (the sheet's y runs down), turn by the angle, move to the baseline.
  const m: Matrix = [height * cos, height * sin, height * sin, -height * cos, at[0], at[1]];
  return {
    type: 'text',
    text,
    outline: layout.contours.flatMap((c) => {
      const contour = unitContour(c);
      return contour ? [transformContour(m, contour)] : [];
    }),
    ...(options.color && { color: options.color }),
    at,
    height,
    width: textWidth(text, height, font),
    ...(angle !== 0 && { angle }),
    ...(options.key && { key: options.key }),
  };
}

function unitContour(c: UnitContour): Contour | undefined {
  const first = c.segments[0];
  if (!first) return undefined;
  const start = first.kind === 'line' ? first.a : first.points[0];
  if (!start) return undefined;
  return {
    start,
    segments: c.segments.map((s) => {
      if (s.kind === 'line') return { type: 'line', to: s.b };
      const [, p1, p2, p3] = s.points as [Point, Point, Point, Point?];
      return p3
        ? { type: 'cubic', c1: p1, c2: p2, to: p3 }
        : { type: 'quadratic', control: p1, to: p2 };
    }),
    closed: true,
  };
}

/**
 * Text broken into lines: at its newlines, and when `width` is given, before
 * a word that would end past it (a word longer than the width breaks between
 * characters). Spaces at a wrap are dropped; a blank line stays a line.
 */
export function wrapText(
  text: string,
  height: number,
  width?: number,
  font: SheetFont = 'regular',
): string[] {
  const out: string[] = [];
  for (const paragraph of text.split(/\r?\n/)) {
    if (width === undefined) {
      out.push(paragraph);
      continue;
    }
    const fits = (line: string) => textWidth(line.trimEnd(), height, font) <= width;
    let line = '';
    for (const word of paragraph.match(/\s*\S+\s*/g) ?? []) {
      if (fits(line + word)) {
        line += word;
        continue;
      }
      if (line.trim() !== '') out.push(line.trimEnd());
      // A new line starts with the word itself; one too long for a line breaks.
      line = line.trim() === '' ? line + word : word.trimStart();
      while (!fits(line)) {
        const chars = [...line.trimEnd()];
        if (chars.length <= 1) break;
        let n = chars.length - 1;
        while (n > 1 && !fits(chars.slice(0, n).join(''))) n--;
        out.push(chars.slice(0, n).join(''));
        line = chars.slice(n).join('') + line.slice(line.trimEnd().length);
      }
    }
    out.push(line.trimEnd());
  }
  return out;
}

/**
 * One line that fits `width`: at letter height `height` if it can, else
 * smaller down to `min`, else cut and ended with an ellipsis. Newlines
 * become spaces. Title-block values are fitted this way.
 */
export function fitLine(
  text: string,
  height: number,
  width: number,
  min: number,
  font: SheetFont = 'regular',
): { text: string; height: number } {
  const line = text.replace(/\s*\r?\n\s*/g, ' ');
  const natural = textWidth(line, 1, font);
  if (natural * height <= width) return { text: line, height };
  const shrunk = Math.max(min, width / natural);
  if (natural * shrunk <= width) return { text: line, height: shrunk };
  const chars = [...line];
  let n = chars.length;
  while (n > 0 && textWidth(`${chars.slice(0, n).join('').trimEnd()}…`, min, font) > width) n--;
  return { text: `${chars.slice(0, n).join('').trimEnd()}…`, height: min };
}
