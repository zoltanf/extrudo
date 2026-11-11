/**
 * A display list (P6-24 S1, ADR-0143 §7): what one page shows, as paths and
 * text runs in page millimetres, measured from the top-left corner with y
 * down, the way a sheet, the screen and SVG measure. One list has three
 * consumers that must agree: the screen (SVG in the DOM, from
 * `displayPathData`, `displayPaint` and `displayTextLayer`), `writeDisplaySvg`
 * and `writeDisplayPdf`. What is on screen is what is exported.
 *
 * The paint model is `writePdf`'s (a stroke with width, colour, dash, cap and
 * join; a fill with its rule; text as filled glyph outlines plus the string),
 * so a list item and a PDF item differ only in the direction of y.
 * `displayPdfPage` is the one place that turns y down into PDF's y up.
 *
 * Arcs keep io's numeric convention in this frame: a positive `sweep` turns
 * from +x towards +y, which on a y-down page is clockwise as seen.
 */
import type { Contour, Point } from './drawing';
import { num, xmlText } from './format';
import { type PdfItem, type PdfOptions, type PdfPage, writePdf } from './pdf';
import { pathData } from './svg';
import { type Matrix, transformContour } from './transform';

/** A stroke, mm (as `writePdf`'s). Round caps and joins when left out. */
export interface DisplayStroke {
  /** Line width, mm. */
  width: number;
  /** `#rrggbb`; black when left out. */
  color?: string;
  /** Dash pattern, mm: on, off, on, … */
  dash?: readonly number[];
  cap?: 'butt' | 'round' | 'square';
  join?: 'miter' | 'round' | 'bevel';
}

export interface DisplayFill {
  color: string;
  /** Default even-odd: a region's inner contours are holes. */
  rule?: 'evenodd' | 'nonzero';
}

/** A path: contours of exact segments, stroked, filled or both. */
export interface DisplayPath {
  type: 'path';
  contours: readonly Contour[];
  stroke?: DisplayStroke;
  fill?: DisplayFill;
  /** What the item is part of, for the screen's picking (`"item:<id>"`); writers ignore it. */
  key?: string;
}

/** One line of text: its glyph outlines, filled even-odd, and the string they spell. */
export interface DisplayText {
  type: 'text';
  /** The string, for selecting and searching. */
  text: string;
  /** Glyph outlines in page mm. */
  outline: readonly Contour[];
  /** `#rrggbb`; black when left out. */
  color?: string;
  /** Start of the baseline, page mm. */
  at: Point;
  /** Cap height, mm. */
  height: number;
  /** Advance width along the baseline, mm. */
  width: number;
  /** Baseline direction, radians from +x towards +y (clockwise as seen); 0 when left out. */
  angle?: number;
  key?: string;
}

export type DisplayItem = DisplayPath | DisplayText;

/** One page: its size in mm and its items, drawn in order. */
export interface DisplayList {
  width: number;
  height: number;
  items: readonly DisplayItem[];
}

// The flip into PDF -------------------------------------------------------------

/**
 * A list as a `writePdf` page: every point's y becomes `height − y` and every
 * angle its negative. This is the only place the page's y-down frame meets
 * PDF's y-up one.
 */
export function displayPdfPage(list: DisplayList): PdfPage {
  const flip: Matrix = [1, 0, 0, -1, 0, list.height];
  const contours = (cs: readonly Contour[]) => cs.map((c) => transformContour(flip, c));
  const items = list.items.map((item): PdfItem => {
    if (item.type === 'path') {
      return {
        type: 'path',
        contours: contours(item.contours),
        ...(item.stroke && { stroke: item.stroke }),
        ...(item.fill && { fill: item.fill }),
      };
    }
    return {
      type: 'text',
      text: item.text,
      outline: contours(item.outline),
      ...(item.color && { color: item.color }),
      at: [item.at[0], list.height - item.at[1]],
      height: item.height,
      width: item.width,
      ...(item.angle && { angle: -item.angle }),
    };
  });
  return { width: list.width, height: list.height, items };
}

/** Lists as a PDF, one page each at its true size, in order (`writePdf`). */
export function writeDisplayPdf(
  lists: readonly DisplayList[],
  options: PdfOptions = {},
): Uint8Array {
  return writePdf(lists.map(displayPdfPage), options);
}

// SVG, for the file and for the screen -----------------------------------------

/** SVG path data of contours in page mm: no flip, the page's frame is SVG's. */
export function displayPathData(contours: readonly Contour[]): string {
  return pathData(contours, 1);
}

/**
 * An item's paint as SVG presentation attributes in React's spelling
 * (`strokeWidth`, `fillRule`), so the screen can spread them onto a `<path>`;
 * `writeDisplaySvg` writes the same values. A text run is its outline filled.
 */
export interface DisplayPaint {
  fill: string;
  fillRule?: 'evenodd' | 'nonzero';
  stroke?: string;
  strokeWidth?: string;
  strokeDasharray?: string;
  strokeLinecap?: 'butt' | 'round' | 'square';
  strokeLinejoin?: 'miter' | 'round' | 'bevel';
}

export function displayPaint(item: DisplayItem): DisplayPaint {
  if (item.type === 'text') return { fill: item.color ?? '#000000', fillRule: 'evenodd' };
  const paint: DisplayPaint = { fill: item.fill?.color ?? 'none' };
  if (item.fill) paint.fillRule = item.fill.rule ?? 'evenodd';
  const s = item.stroke;
  if (s) {
    paint.stroke = s.color ?? '#000000';
    paint.strokeWidth = num(s.width);
    if (s.dash?.length) paint.strokeDasharray = s.dash.map((d) => num(d)).join(' ');
    paint.strokeLinecap = s.cap ?? 'round';
    paint.strokeLinejoin = s.join ?? 'round';
  }
  return paint;
}

/**
 * Inter's cap height in em (1490 of 2048 units): the invisible SVG text is
 * sized so its capitals are the outlines' height in a reader that has Inter,
 * and `textLength` stretches it to the outlines' width in one that hasn't.
 */
const CAP_EM = 0.7275;

/**
 * The invisible, selectable copy of a text run as `<text>` attributes, in
 * React's spelling: its baseline start, a font size giving the run's cap
 * height, `textLength` its width, a rotation about the start. The string goes
 * in as the element's content.
 */
export interface DisplayTextLayer {
  x: string;
  y: string;
  fontSize: string;
  textLength?: string;
  transform?: string;
}

export function displayTextLayer(item: DisplayText): DisplayTextLayer {
  const [x, y] = [num(item.at[0]), num(item.at[1])];
  const layer: DisplayTextLayer = { x, y, fontSize: num(item.height / CAP_EM) };
  if (item.width > 0) layer.textLength = num(item.width);
  if (item.angle) layer.transform = `rotate(${num((item.angle * 180) / Math.PI)} ${x} ${y})`;
  return layer;
}

const ATTRIBUTE: Record<string, string> = {
  fill: 'fill',
  fillRule: 'fill-rule',
  stroke: 'stroke',
  strokeWidth: 'stroke-width',
  strokeDasharray: 'stroke-dasharray',
  strokeLinecap: 'stroke-linecap',
  strokeLinejoin: 'stroke-linejoin',
  x: 'x',
  y: 'y',
  fontSize: 'font-size',
  textLength: 'textLength',
  transform: 'transform',
};

function attributes(values: object): string {
  return Object.entries(values)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => ` ${ATTRIBUTE[k] ?? k}="${xmlText(String(v))}"`)
    .join('');
}

export interface DisplaySvgOptions {
  /** The file's `<title>`. */
  title?: string;
}

/**
 * A list as a standalone SVG at its true size: `width`/`height` in mm and one
 * user unit per millimetre. Paths and glyph outlines are `<path>`s; each text
 * run also gets an invisible `<text>` (fill-opacity 0, in Inter or a
 * sans-serif, stretched with `textLength` onto the outlines), so the text can
 * be selected in a browser and found by a search or an indexer. The same
 * input always writes the same text.
 */
export function writeDisplaySvg(list: DisplayList, options: DisplaySvgOptions = {}): string {
  const w = num(list.width);
  const h = num(list.height);
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}mm" height="${h}mm" viewBox="0 0 ${w} ${h}">`,
  ];
  if (options.title) lines.push(`<title>${xmlText(options.title)}</title>`);
  const texts: DisplayText[] = [];
  for (const item of list.items) {
    const contours = item.type === 'path' ? item.contours : item.outline;
    if (contours.length === 0) continue;
    if (item.type === 'path' && !item.fill && !item.stroke) continue;
    lines.push(`<path d="${displayPathData(contours)}"${attributes(displayPaint(item))}/>`);
    if (item.type === 'text') texts.push(item);
  }
  if (texts.length > 0) {
    // One group after the drawing, so the invisible text is on top for selecting.
    lines.push(
      '<g font-family="Inter, sans-serif" fill="#000000" fill-opacity="0" xml:space="preserve">',
    );
    for (const item of texts) {
      const layer = displayTextLayer(item);
      const adjust = layer.textLength ? ' lengthAdjust="spacingAndGlyphs"' : '';
      lines.push(`<text${attributes(layer)}${adjust}>${xmlText(item.text)}</text>`);
    }
    lines.push('</g>');
  }
  lines.push('</svg>', '');
  return lines.join('\n');
}
