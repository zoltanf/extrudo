/**
 * What every item tied to the model shares (P6-24 S3 and S4, ADR-0143's S3
 * and S4 amendments): its anchors' geometry as the view sees it, its state
 * from their reports, where its text is now, and how its lines, arrowheads,
 * dots and text are collected into display items. Dimensions
 * (`dimensions.ts`), leader notes, centre marks and centre lines
 * (`notes.ts`) are drawn through here.
 *
 * Frames: anchors and an item's `at` are in the view's own mm (model size,
 * x right, y up, `toSheetView`); display items are in sheet mm, y down.
 */
import {
  type Sheet,
  type SheetAnchor,
  type SheetAnchorReport,
  type SheetView,
  type SheetViewFrame,
  toSheetView,
  type Vec2,
  type Vec3,
} from '@extrudo/core';
import type { Contour, DisplayItem, DisplayText, Point } from '@extrudo/io';
import { sheetViewScale } from './layout';
import { textRun, textWidth } from './text';

/**
 * How an anchored item is drawn, for the screen: `moved` (an anchor found by
 * its fingerprint: drawn as usual, warned about elsewhere), `detached` (an
 * anchor is lost: the screen draws it in the error colour), `invalid` (the
 * anchors resolve but don't make this item, say two lines that aren't
 * parallel). The export draws every state the same.
 */
export type SheetItemState = 'ok' | 'moved' | 'detached' | 'invalid';

// The geometry in view mm -----------------------------------------------------------

export type Shape =
  | { kind: 'point'; p: Vec2 }
  | { kind: 'line'; a: Vec2; b: Vec2 }
  | { kind: 'circle'; centre: Vec2; at: (dir: Vec2) => Vec2; radius: number };

/** What an item's anchors give in its view, or why they give nothing. */
export type Placed =
  | { shapes: (Shape | undefined)[]; problem?: undefined }
  | { shapes?: undefined; problem: string };

/**
 * Each anchor's geometry in the view (`undefined` where it is lost), or the
 * first message of an anchor that resolved but can't give what it is asked.
 */
export function placeAnchors(
  anchors: readonly SheetAnchor[],
  reports: readonly SheetAnchorReport[] | undefined,
  frame: SheetViewFrame,
): Placed {
  const shapes: (Shape | undefined)[] = [];
  for (const [i, anchor] of anchors.entries()) {
    if ('free' in anchor) {
      shapes.push({ kind: 'point', p: anchor.free });
      continue;
    }
    const report = reports?.[i];
    const g = report?.geometry;
    if (!g) {
      if (report && report.status !== 'detached' && report.message) {
        return { problem: report.message };
      }
      shapes.push(undefined);
      continue;
    }
    const v = (p: Vec3) => toSheetView(frame, p);
    switch (g.type) {
      case 'point':
        shapes.push({ kind: 'point', p: v(g.point) });
        break;
      case 'line':
      case 'silhouette':
      case 'axis':
      case 'curve': {
        const a = v(g.start);
        const b = v(g.end);
        // A line seen end-on is a point.
        shapes.push(len(sub(b, a)) < EPS ? { kind: 'point', p: a } : { kind: 'line', a, b });
        break;
      }
      case 'circle': {
        const { centre, axis, xDirection, radius } = g;
        const y = cross(axis, xDirection);
        const c = v(centre);
        // The point of the circle furthest along `dir` as the view sees it.
        const at = (dir: Vec2): Vec2 => {
          let best = c;
          let reach = -Infinity;
          for (let k = 0; k < 360; k++) {
            const t = (k * Math.PI) / 180;
            const p = v(
              add3(
                centre,
                add3(scale3(xDirection, radius * Math.cos(t)), scale3(y, radius * Math.sin(t))),
              ),
            );
            const r = dot(sub(p, c), dir);
            if (r > reach) [best, reach] = [p, r];
          }
          return best;
        };
        shapes.push({ kind: 'circle', centre: c, at, radius });
        break;
      }
    }
  }
  return { shapes };
}

/** The worst of the anchors' states. */
export function anchorsState(
  anchors: readonly SheetAnchor[],
  reports: readonly SheetAnchorReport[] | undefined,
): SheetItemState {
  let state: SheetItemState = 'ok';
  for (const [i, anchor] of anchors.entries()) {
    if ('free' in anchor) continue;
    const status = reports?.[i]?.status ?? 'detached';
    if (status === 'detached') return 'detached';
    if (status === 'moved') state = 'moved';
  }
  return state;
}

/**
 * Where an item's text is now, view mm: its stored `at`, moved as far as
 * its anchors moved since they were picked (each one's fingerprint point
 * then and now, averaged), so a dimension placed above an edge stays above
 * it when a parameter moves the edge, and a note stays beside its hole.
 * Free anchors don't move it.
 */
export function followAnchors(
  at: Vec2,
  anchors: readonly SheetAnchor[],
  reports: readonly SheetAnchorReport[] | undefined,
  frame: SheetViewFrame,
): Vec2 {
  let dx = 0;
  let dy = 0;
  let n = 0;
  for (const [i, anchor] of anchors.entries()) {
    if ('free' in anchor) continue;
    const now = reports?.[i]?.resolved?.fingerprint?.at;
    if (!now) continue;
    const [x0, y0] = toSheetView(frame, anchor.ref.fingerprint.at);
    const [x1, y1] = toSheetView(frame, now);
    dx += x1 - x0;
    dy += y1 - y0;
    n++;
  }
  return n === 0 ? at : [at[0] + dx / n, at[1] + dy / n];
}

/** From a view's own mm to sheet mm: `S` for points, `D` for directions (y flips). */
export function viewToSheet(
  sheet: Sheet,
  view: SheetView,
): { S: (p: Vec2) => Point; D: (d: Vec2) => Vec2; k: number } {
  const [a, b] = sheetViewScale(sheet, view);
  const k = a / b;
  const [x0, y0] = view.at;
  return { S: (p) => [x0 + k * p[0], y0 - k * p[1]], D: (d) => [d[0], -d[1]], k };
}

// Display items ------------------------------------------------------------------------

/** Paper sizes the drawing collector needs, mm. */
export interface DrawingStyle {
  /** Line width. */
  line: number;
  /** An arrowhead's length and width. */
  arrow: number;
  arrowWidth: number;
  /** Letter height of `text`. */
  text: number;
  /** `text`'s distance above its line. */
  lift: number;
}

/** Collects one item's lines, arrowheads, dots and text, keyed and marked with its state. */
export class Drawing {
  readonly #lines: Contour[] = [];
  readonly #fills: Contour[] = [];
  readonly #texts: DisplayItem[] = [];
  readonly #key: string;
  readonly #state: SheetItemState;
  readonly #style: DrawingStyle;

  constructor(key: string, state: SheetItemState, style: DrawingStyle) {
    this.#key = key;
    this.#state = state;
    this.#style = style;
  }

  get key(): string {
    return this.#key;
  }

  line(a: Point, b: Point): void {
    if (len(sub(b, a)) < EPS) return;
    this.#lines.push({ start: a, segments: [{ type: 'line', to: b }], closed: false });
  }

  arc(centre: Point, from: Point, sweep: number, to: Point): void {
    this.#lines.push({
      start: from,
      segments: [{ type: 'arc', center: centre, sweep, to }],
      closed: false,
    });
  }

  /** A filled arrowhead with its tip at `tip`, pointing along `dir` (sheet). */
  arrow(tip: Point, dir: Vec2): void {
    const { arrow, arrowWidth } = this.#style;
    const back = sub(tip, scale(dir, arrow));
    const side = scale([-dir[1], dir[0]], arrowWidth / 2);
    this.#fills.push({
      start: tip,
      segments: [
        { type: 'line', to: add(back, side) },
        { type: 'line', to: sub(back, side) },
        { type: 'line', to: tip },
      ],
      closed: true,
    });
  }

  /** A filled dot of radius `r` on `centre` (sheet). */
  dot(centre: Point, r: number): void {
    const start: Point = [centre[0] + r, centre[1]];
    this.#fills.push({
      start,
      segments: [{ type: 'arc', center: centre, sweep: 2 * Math.PI, to: start }],
      closed: true,
    });
  }

  /**
   * The text with its baseline along `angle` (sheet, radians), centred on
   * `at` and lifted off it (`centre`), or starting at it (`start`) or ending
   * at it (`end`), lifted.
   */
  text(value: string, at: Point, angle: number, align: 'centre' | 'start' | 'end'): void {
    const { text, lift } = this.#style;
    const w = textWidth(value, text);
    const dir: Vec2 = [Math.cos(angle), Math.sin(angle)];
    const up: Vec2 = [Math.sin(angle), -Math.cos(angle)];
    const shift = align === 'centre' ? -w / 2 : align === 'end' ? -w : 0;
    const start = add(add(at, scale(dir, shift)), scale(up, lift));
    this.#texts.push(
      textRun(value, start, text, { key: this.#key, ...(angle !== 0 && { angle }) }),
    );
  }

  /** A text run made elsewhere (`textRun`), keyed with the rest. */
  run(text: DisplayText): void {
    this.#texts.push({ ...text, key: this.#key });
  }

  items(): DisplayItem[] {
    const state = this.#state === 'ok' ? {} : { state: this.#state };
    const out: DisplayItem[] = [];
    if (this.#lines.length > 0) {
      out.push({
        type: 'path',
        contours: this.#lines,
        stroke: { width: this.#style.line, cap: 'butt' },
        key: this.#key,
        ...state,
      });
    }
    if (this.#fills.length > 0) {
      out.push({
        type: 'path',
        contours: this.#fills,
        fill: { color: '#000000', rule: 'nonzero' },
        key: this.#key,
        ...state,
      });
    }
    for (const t of this.#texts) out.push({ ...t, ...state });
    return out;
  }
}

// 2D and 3D arithmetic -------------------------------------------------------------

export const EPS = 1e-9;
export const add = (a: Vec2, b: Vec2): Vec2 => [a[0] + b[0], a[1] + b[1]];
export const sub = (a: Vec2, b: Vec2): Vec2 => [a[0] - b[0], a[1] - b[1]];
export const scale = (a: Vec2, k: number): Vec2 => [a[0] * k, a[1] * k];
export const dot = (a: Vec2, b: Vec2) => a[0] * b[0] + a[1] * b[1];
export const cross2 = (a: Vec2, b: Vec2) => a[0] * b[1] - a[1] * b[0];
export const len = (a: Vec2) => Math.hypot(a[0], a[1]);
export const unit = (a: Vec2): Vec2 | undefined => {
  const l = len(a);
  return l > EPS ? [a[0] / l, a[1] / l] : undefined;
};
const add3 = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale3 = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

/** The point of a segment nearest `p`. */
export function closest(line: { a: Vec2; b: Vec2 }, p: Vec2): Vec2 {
  const d = sub(line.b, line.a);
  const t = Math.max(0, Math.min(1, dot(sub(p, line.a), d) / dot(d, d)));
  return add(line.a, scale(d, t));
}
