/**
 * Notes and centre lines on a sheet (P6-24 S4, ADR-0143's S4 amendment):
 * leader notes, sticky notes, centre marks and centre lines as display
 * items, from the anchors the kernel resolved (`KernelApi.resolveSheet`)
 * as a dimension's are (`anchored.ts`). Nothing here is stored and nothing
 * is made for a view by itself: a centre mark exists because someone placed
 * it.
 *
 * Frames: a leader's `at` and every anchor are in the view's own mm (model
 * size, x right, y up); a sticky note's `at` and `size` are sheet mm. Sizes
 * on paper (arrowheads, dashes, text) are sheet mm and don't scale with the
 * view.
 */
import {
  type Sheet,
  type SheetAnchors,
  type SheetCentreLineItem,
  type SheetCentreMarkItem,
  type SheetItem,
  type SheetLeaderItem,
  type SheetStickyColor,
  type SheetStickyItem,
  sheetViewFrame,
  type Vec2,
} from '@extrudo/core';
import type { Contour, DisplayItem, Point } from '@extrudo/io';
import {
  add,
  anchorsState,
  closest,
  cross2,
  Drawing,
  dot,
  EPS,
  followAnchors,
  len,
  placeAnchors,
  type Shape,
  type SheetItemState,
  scale,
  sub,
  unit,
  viewToSheet,
} from './anchored';
import { measureSheetDimension, type SheetDimensionOptions } from './dimensions';
import { fitLine, LINE_SPACING, textRun, textWidth, wrapText } from './text';

/** Paper sizes of notes and centre lines, mm. */
export const SHEET_NOTE = {
  /** Leader, centre mark and centre line width (`SHEET_LINE.thin`). */
  line: 0.18,
  /** A leader's and a sticky note's letter height (`SHEET_TEXT_SIZE`). */
  text: 3.5,
  /** A leader's arrowhead, as a dimension's. */
  arrow: 3,
  arrowWidth: 1,
  /** The radius of the dot a leader ends in on a face. */
  dot: 0.75,
  /** The level stretch between a leader line and its text. */
  shoulder: 3,
  /** Between the shoulder and the text. */
  gap: 1,
  /** How far a centre mark or line runs past the geometry. */
  overshoot: 3,
  /** A centre mark's middle cross: each arm, and the gap after it. */
  cross: 1.5,
  crossGap: 1,
  /** A centre line's dash-dot: long dash about this long, then gap, dot, gap. */
  dash: 8,
  dashGap: 1.5,
  dashDot: 1,
  /** A sticky note: corner radius, padding, and its "On screen only" line. */
  corner: 1.5,
  padding: 3,
  label: 2,
} as const;

const STYLE = { ...SHEET_NOTE, lift: 0 };

/** Each sticky colour's paper and the ink of its small print, `#rrggbb`. */
export const SHEET_STICKY: Readonly<Record<SheetStickyColor, { fill: string; ink: string }>> = {
  yellow: { fill: '#ffe27a', ink: '#7a6410' },
  orange: { fill: '#ffc285', ink: '#7a4310' },
  pink: { fill: '#ffb8cf', ink: '#7a1f40' },
  blue: { fill: '#acd5ff', ink: '#1f497a' },
  green: { fill: '#b9eaa5', ink: '#2f6a1f' },
};

/** The words a sticky note that isn't printed carries on screen. */
export const SHEET_STICKY_SCREEN_ONLY = 'On screen only';

/** What a display list is for: the screen, or a file (PDF, SVG). */
export type SheetOutput = 'screen' | 'export';

export interface SheetNoteOptions {
  /** Absent: the screen. */
  output?: SheetOutput;
}

/**
 * How many sticky notes an export of `sheets` leaves out: those whose Print
 * switch is off (the export dialog's summary).
 */
export function sheetStickiesLeftOut(sheets: readonly Sheet[]): number {
  let n = 0;
  for (const sheet of sheets) {
    for (const item of sheet.items) if (item.kind === 'sticky' && !item.print) n++;
  }
  return n;
}

/**
 * Whether an item is drawn at all in a view's list: a centre mark or line
 * in a view with `centreLines: false` is not, nor a screen-only sticky note
 * in an export.
 */
export function sheetItemShown(
  sheet: Sheet,
  item: SheetItem,
  output: SheetOutput = 'screen',
): boolean {
  if (item.kind === 'sticky') return output === 'screen' || item.print === true;
  if (item.kind === 'centreMark' || item.kind === 'centreLine') {
    return sheet.views.find((v) => v.id === item.view)?.centreLines !== false;
  }
  return true;
}

/** An item's state and why, as the browser row and the status bar say it. */
export interface SheetItemStatus {
  state: SheetItemState;
  message?: string;
}

/**
 * Any item's state from the resolved anchors: a dimension's from
 * `measureSheetDimension`, a leader's, centre mark's or centre line's from
 * its anchors and what they make; a text or a sticky note is always `ok`.
 */
export function sheetItemStatus(
  sheet: Sheet,
  item: SheetItem,
  anchors: SheetAnchors | undefined,
  options: SheetDimensionOptions = {},
): SheetItemStatus {
  switch (item.kind) {
    case 'dimension': {
      const { state, message } = measureSheetDimension(sheet, item, anchors, options);
      return { state, ...(message && { message }) };
    }
    case 'leader': {
      const { state, message } = solveLeader(sheet, item, anchors);
      return { state, ...(message && { message }) };
    }
    case 'centreMark':
    case 'centreLine': {
      const { state, message } = solveCentre(sheet, item, anchors);
      return { state, ...(message && { message }) };
    }
    default:
      return { state: 'ok' };
  }
}

// Leader notes ------------------------------------------------------------------------

const LOST_LEADER = 'This note lost what it points at: drag its arrow onto an edge, or delete it.';

interface SolvedLeader extends SheetItemStatus {
  /** Where the text is now, view mm. */
  at: Vec2;
  /** What the arrow points at, view mm, when it is known. */
  shape?: Shape;
}

function solveLeader(
  sheet: Sheet,
  item: SheetLeaderItem,
  anchors: SheetAnchors | undefined,
): SolvedLeader {
  const frame = sheetViewFrame(sheet, item.view);
  if (!frame) return { state: 'detached', message: "The note's view is gone.", at: item.at };
  const reports = anchors?.[item.id];
  const at = followAnchors(item.at, [item.anchor], reports, frame);
  const state = anchorsState([item.anchor], reports);
  const placed = placeAnchors([item.anchor], reports, frame);
  if (placed.problem) return { state: 'invalid', message: placed.problem, at };
  const shape = placed.shapes?.[0];
  if (!shape) return { state: 'detached', message: LOST_LEADER, at };
  return { state, at, shape, ...(state === 'detached' && { message: LOST_LEADER }) };
}

/** Where on `shape` an arrow from `from` lands (view mm): a line's nearest point, a circle's rim towards it. */
function tipOf(shape: Shape, from: Vec2): Vec2 {
  switch (shape.kind) {
    case 'point':
      return shape.p;
    case 'line':
      return closest(shape, from);
    case 'circle':
      return shape.at(unit(sub(from, shape.centre)) ?? [1, 0]);
  }
}

/**
 * A leader note in sheet mm, keyed `item:<id>`: a filled arrowhead on what
 * the anchor names (a dot on a face), the leader line to `at`, a level
 * shoulder away from the arrow, and the text beside the shoulder, its first
 * line's capitals centred on it, one run per line. A note whose anchor is
 * lost with no geometry kept is its text alone at `at`; every item carries
 * the note's `state` unless it is `ok`.
 */
export function layoutSheetLeader(
  sheet: Sheet,
  item: SheetLeaderItem,
  anchors: SheetAnchors | undefined,
): DisplayItem[] {
  const view = sheet.views.find((v) => v.id === item.view);
  if (!view) return [];
  const { S } = viewToSheet(sheet, view);
  const solved = solveLeader(sheet, item, anchors);
  const draw = new Drawing(`item:${item.id}`, solved.state, STYLE);
  const knee = S(solved.at);
  const tip = solved.shape ? S(tipOf(solved.shape, solved.at)) : undefined;
  const right = !tip || knee[0] >= tip[0] - EPS;
  const { shoulder, gap, text: size, arrow, dot: r } = SHEET_NOTE;
  if (tip) {
    const face =
      'ref' in item.anchor && !('silhouette' in item.anchor) && item.anchor.ref.kind === 'face';
    const towards = unit(sub(tip, knee));
    if (face) {
      draw.dot(tip, r);
      draw.line(knee, towards ? sub(tip, scale(towards, r)) : tip);
    } else if (towards && len(sub(tip, knee)) > arrow) {
      draw.arrow(tip, towards);
      draw.line(knee, sub(tip, scale(towards, arrow / 2)));
    }
    draw.line(knee, add(knee, [right ? shoulder : -shoulder, 0]));
  }
  // The text past the shoulder (or at `at` when there is none), lines one below the other.
  const x = tip ? knee[0] + (right ? shoulder + gap : -(shoulder + gap)) : knee[0];
  wrapText(item.text, size).forEach((line, i) => {
    if (line.trim() === '') return;
    const baseline = knee[1] + size / 2 + i * size * LINE_SPACING;
    const w = textWidth(line, size);
    draw.run(textRun(line, [right ? x : x - w, baseline], size));
  });
  return draw.items();
}

// Centre marks and centre lines --------------------------------------------------------

const LOST_CENTRE = {
  centreMark: 'This centre mark lost its circle: delete it, or place it again.',
  centreLine: 'This centre line lost its edges: delete it, or place it again.',
} as const;

type Centre =
  | { type: 'mark'; c: Vec2; circle: Extract<Shape, { kind: 'circle' }> }
  | { type: 'line'; a: Vec2; b: Vec2 };

interface SolvedCentre extends SheetItemStatus {
  centre?: Centre;
}

function solveCentre(
  sheet: Sheet,
  item: SheetCentreMarkItem | SheetCentreLineItem,
  anchors: SheetAnchors | undefined,
): SolvedCentre {
  const frame = sheetViewFrame(sheet, item.view);
  const noun = item.kind === 'centreMark' ? 'centre mark' : 'centre line';
  if (!frame) return { state: 'detached', message: `The ${noun}'s view is gone.` };
  const reports = anchors?.[item.id];
  const state = anchorsState(item.anchors, reports);
  const placed = placeAnchors(item.anchors, reports, frame);
  if (placed.problem) return { state: 'invalid', message: placed.problem };
  const shapes = placed.shapes ?? [];
  if (shapes.some((s) => s === undefined)) {
    return { state: 'detached', message: LOST_CENTRE[item.kind] };
  }
  const made = item.kind === 'centreMark' ? markOf(shapes as Shape[]) : lineOf(shapes as Shape[]);
  if ('problem' in made) {
    return { state: state === 'detached' ? 'detached' : 'invalid', message: made.problem };
  }
  return {
    state,
    centre: made,
    ...(state === 'detached' && { message: LOST_CENTRE[item.kind] }),
  };
}

function markOf(shapes: Shape[]): Centre | { problem: string } {
  const [one] = shapes;
  if (one?.kind !== 'circle') return { problem: 'The edge is not a circle.' };
  // Seen edge-on, a circle is a line: it has no centre to mark in this view.
  const across = len(sub(one.at([1, 0]), one.at([-1, 0])));
  const down = len(sub(one.at([0, 1]), one.at([0, -1])));
  if (Math.min(across, down) < 1e-6 * Math.max(one.radius, 1)) {
    return { problem: 'The circle is seen edge-on here: draw a centre line along it instead.' };
  }
  return { type: 'mark', c: one.centre, circle: one };
}

function lineOf(shapes: Shape[]): Centre | { problem: string } {
  if (shapes.length === 1) {
    const [axis] = shapes;
    if (axis?.kind === 'line') return { type: 'line', a: axis.a, b: axis.b };
    return { problem: 'The axis points out of this view: draw a centre mark instead.' };
  }
  const [p, q] = shapes;
  if (p?.kind !== 'line' || q?.kind !== 'line') {
    return { problem: 'A centre line runs between two lines; one of these is seen end-on.' };
  }
  const u = unit(sub(p.b, p.a)) as Vec2;
  const v = unit(sub(q.b, q.a)) as Vec2;
  if (Math.abs(cross2(u, v)) > 1e-6) {
    return { problem: "The lines aren't parallel: a centre line runs between parallel lines." };
  }
  // Midway across, from the first end to the last along them.
  const n: Vec2 = [-u[1], u[0]];
  const off = (dot(p.a, n) + dot(q.a, n)) / 2;
  const ts = [p.a, p.b, q.a, q.b].map((x) => dot(x, u));
  const at = (t: number): Vec2 => add(scale(n, off), scale(u, t));
  return { type: 'line', a: at(Math.min(...ts)), b: at(Math.max(...ts)) };
}

/**
 * A centre mark or a centre line in sheet mm, keyed `item:<id>`, its lines
 * 0.18 mm. A centre mark is a level and an upright line through the
 * circle's centre, each a short cross arm, a gap and a long dash out to
 * 3 mm past the circle (one plain line on a small circle); a centre line
 * is dash-dot with a long dash at each end, 3 mm past the geometry. One
 * that is lost with no geometry kept, or that its anchors can't make, draws
 * nothing (`sheetItemStatus` says why).
 */
export function layoutSheetCentre(
  sheet: Sheet,
  item: SheetCentreMarkItem | SheetCentreLineItem,
  anchors: SheetAnchors | undefined,
): DisplayItem[] {
  const view = sheet.views.find((v) => v.id === item.view);
  if (!view) return [];
  const { S } = viewToSheet(sheet, view);
  const solved = solveCentre(sheet, item, anchors);
  const centre = solved.centre;
  if (!centre) return [];
  const draw = new Drawing(`item:${item.id}`, solved.state, STYLE);
  const { overshoot } = SHEET_NOTE;
  if (centre.type === 'line') {
    const a = S(centre.a);
    const b = S(centre.b);
    const d = unit(sub(b, a)) as Vec2;
    dashDot(draw, sub(a, scale(d, overshoot)), add(b, scale(d, overshoot)));
    return draw.items();
  }
  const c = S(centre.c);
  // How far the circle reaches each way on the sheet (y flips back for the view).
  const reach = (d: Vec2) => dot(sub(S(centre.circle.at([d[0], -d[1]])), c), d);
  for (const d of [
    [1, 0],
    [0, 1],
  ] as Vec2[]) {
    const minus = scale(d, -1);
    markArm(draw, c, d, reach(d) + overshoot, reach(minus) + overshoot);
  }
  return draw.items();
}

/** One line of a centre mark through `c` along `d`: out to `plus` one way and `minus` the other. */
function markArm(draw: Drawing, c: Point, d: Vec2, plus: number, minus: number): void {
  const { cross, crossGap, overshoot } = SHEET_NOTE;
  const at = (t: number) => add(c, scale(d, t));
  // Too small for the pattern: one plain line.
  if (Math.min(plus, minus) - overshoot < cross + crossGap + 1) {
    draw.line(at(-minus), at(plus));
    return;
  }
  draw.line(at(-minus), at(-(cross + crossGap)));
  draw.line(at(-cross), at(cross));
  draw.line(at(cross + crossGap), at(plus));
}

/** A dash-dot line from `a` to `b`: long dashes stretched a little so both ends are long ones. */
function dashDot(draw: Drawing, a: Point, b: Point): void {
  const { dash, dashGap, dashDot: dotLength } = SHEET_NOTE;
  const length = len(sub(b, a));
  const d = unit(sub(b, a));
  if (!d) return;
  const pattern = dash + 2 * dashGap + dotLength;
  const dots = Math.max(0, Math.round((length - dash) / pattern));
  const long = (length - dots * (2 * dashGap + dotLength)) / (dots + 1);
  if (dots === 0 || long < dash / 2) {
    draw.line(a, b);
    return;
  }
  let t = 0;
  const at = (s: number) => add(a, scale(d, s));
  for (let i = 0; i <= dots; i++) {
    draw.line(at(t), at(t + long));
    t += long + dashGap;
    if (i === dots) break;
    draw.line(at(t), at(t + dotLength));
    t += dotLength + dashGap;
  }
}

// Sticky notes ------------------------------------------------------------------------

/**
 * A sticky note in sheet mm, keyed `item:<id>`: a filled rounded note in its
 * colour, its text wrapped inside it (a line that doesn't fit the height is
 * left out and the last one shown ends in an ellipsis) and, on screen when
 * it isn't printed, "On screen only" along its bottom. In an export a note
 * that isn't printed is left out (`sheetItemShown`).
 */
export function layoutSheetSticky(
  item: SheetStickyItem,
  options: SheetNoteOptions = {},
): DisplayItem[] {
  const output = options.output ?? 'screen';
  if (output === 'export' && !item.print) return [];
  const key = `item:${item.id}`;
  const { corner, padding, text: size, label } = SHEET_NOTE;
  const colour = SHEET_STICKY[item.color ?? 'yellow'];
  const [x0, y0] = item.at;
  const [w, h] = item.size;
  const out: DisplayItem[] = [
    { type: 'path', contours: [rounded(x0, y0, w, h, corner)], fill: { color: colour.fill }, key },
  ];
  const marked = output === 'screen' && !item.print;
  const inner = w - 2 * padding;
  // The lowest baseline text may take: above the screen's small print when there is some.
  const floor = y0 + h - padding - (marked ? label + 1 : 0);
  const lines = inner > 0 ? wrapText(item.text, size, inner) : [];
  const fit: string[] = [];
  for (const [i, line] of lines.entries()) {
    if (y0 + padding + size + i * size * LINE_SPACING > floor + EPS) break;
    fit.push(line);
  }
  if (fit.length < lines.length && fit.length > 0) {
    const last = fit.length - 1;
    fit[last] = fitLine(`${fit[last]}…`, size, inner, size).text;
  }
  fit.forEach((line, i) => {
    if (line.trim() === '') return;
    out.push(
      textRun(line, [x0 + padding, y0 + padding + size + i * size * LINE_SPACING], size, { key }),
    );
  });
  if (marked && h >= label + 2) {
    const small = fitLine(SHEET_STICKY_SCREEN_ONLY, label, Math.max(w - 2, 1), label);
    out.push(
      textRun(small.text, [x0 + Math.min(padding, 1.5), y0 + h - 1.5], label, {
        color: colour.ink,
        key,
      }),
    );
  }
  return out;
}

/** A rectangle with corners rounded to `r`, clockwise on the sheet (y down). */
function rounded(x: number, y: number, w: number, h: number, radius: number): Contour {
  const r = Math.min(radius, w / 2, h / 2);
  const q = Math.PI / 2;
  return {
    start: [x + r, y],
    segments: [
      { type: 'line', to: [x + w - r, y] },
      { type: 'arc', center: [x + w - r, y + r], sweep: q, to: [x + w, y + r] },
      { type: 'line', to: [x + w, y + h - r] },
      { type: 'arc', center: [x + w - r, y + h - r], sweep: q, to: [x + w - r, y + h] },
      { type: 'line', to: [x + r, y + h] },
      { type: 'arc', center: [x + r, y + h - r], sweep: q, to: [x, y + h - r] },
      { type: 'line', to: [x, y + r] },
      { type: 'arc', center: [x + r, y + r], sweep: q, to: [x + r, y] },
    ],
    closed: true,
  };
}
