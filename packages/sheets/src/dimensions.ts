/**
 * Dimensions on a sheet (P6-24 S3, ADR-0143's S3 amendment): from the
 * anchors the kernel resolved (`KernelApi.resolveSheet`), the view's frame
 * and scale, a dimension's value in model units and its display items
 * (extension lines, the dimension line, filled arrowheads, the text). The
 * app, its Dimension tool's preview and the CLI all go through here, so they
 * give the same value and the same picture.
 *
 * What is measured is the geometry as the view shows it: a linear distance
 * and an angle in the view's plane at model size, a radius or a diameter the
 * circle's own. Nothing is stored: the value comes from the anchors each
 * time.
 *
 * Frames: a dimension's `at` and a free anchor are in the view's own mm
 * (model size, x right, y up, `toSheetView`); the display items are in sheet
 * mm, y down. Sizes on paper (arrowheads, gaps, the text) are sheet mm and
 * don't scale with the view.
 */
import {
  type LengthUnit,
  type Sheet,
  type SheetAnchorReport,
  type SheetAnchors,
  type SheetDimensionItem,
  type SheetViewFrame,
  sheetViewFrame,
  UNITS,
  type Vec2,
} from '@extrudo/core';
import type { DisplayItem, Point } from '@extrudo/io';
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
import { textWidth } from './text';

/** Paper sizes of a dimension, mm (plan §4.2; ISO 129's proportions). */
export const SHEET_DIMENSION = {
  /** Its lines (`SHEET_LINE.thin`; a literal, as layout.ts imports this file). */
  line: 0.18,
  /** The text's letter height. */
  text: 3.5,
  /** An arrowhead's length and width. */
  arrow: 3,
  arrowWidth: 1,
  /** The gap between the geometry and an extension line. */
  gap: 1,
  /** How far an extension line runs past the dimension line. */
  overshoot: 2,
  /** The text's distance above its line. */
  lift: 1,
} as const;

/** How a dimension is drawn, for the screen (`SheetItemState`, as every anchored item). */
export type SheetDimensionState = SheetItemState;

export interface SheetDimensionMeasure {
  /** Model mm for a length, degrees for an angle; undefined when it can't be measured. */
  value: number | undefined;
  /** What is written: the value with its decimals, R or Ø, before and after, brackets. */
  text: string;
  state: SheetDimensionState;
  /** Why it is detached or invalid. */
  message?: string;
}

export interface SheetDimensionOptions {
  /** The design's length unit, which values are written in; absent: mm. */
  units?: LengthUnit;
}

// Measuring ---------------------------------------------------------------------------

/** A distance between two places along `u`, with where its extension lines start. */
interface Linear {
  /** The two places measured (their difference along `u` is the value). */
  p: Vec2;
  q: Vec2;
  /** Unit, view mm. */
  u: Vec2;
}

type Measured =
  | { type: 'linear'; value: number; linear: Linear }
  | { type: 'circle'; value: number; circle: Extract<Shape, { kind: 'circle' }> }
  | { type: 'angle'; value: number; vertex: Vec2; a: Vec2; b: Vec2; ends: [Vec2[], Vec2[]] }
  | { type: 'invalid'; message: string };

function measure(item: SheetDimensionItem, shapes: Shape[], at: Vec2): Measured {
  switch (item.type) {
    case 'linear':
      return linearOf(shapes, at, item.direction);
    case 'radius':
    case 'diameter': {
      const [one] = shapes;
      // A cylinder from the side: across its two outlines.
      if (shapes.length === 2) return linearOf(shapes, at, 'aligned');
      if (one?.kind !== 'circle') return { type: 'invalid', message: 'The edge is not a circle.' };
      return {
        type: 'circle',
        value: item.type === 'radius' ? one.radius : 2 * one.radius,
        circle: one,
      };
    }
    case 'angle':
      return angleOf(shapes, at);
  }
}

const NOT_PARALLEL = "The lines aren't parallel: dimension their angle instead.";

function linearOf(shapes: Shape[], at: Vec2, direction: SheetDimensionItem['direction']): Measured {
  // A whole circular edge stands for its centre.
  const s = shapes.map((x): Shape => (x.kind === 'circle' ? { kind: 'point', p: x.centre } : x));
  const fixed = (d: SheetDimensionItem['direction']): Vec2 | undefined =>
    d === 'horizontal' ? [1, 0] : d === 'vertical' ? [0, 1] : undefined;
  const done = (p: Vec2, q: Vec2, u: Vec2): Measured => ({
    type: 'linear',
    value: Math.abs(dot(sub(q, p), u)),
    linear: { p, q, u },
  });
  const [first, second] = s;
  if (!first) return { type: 'invalid', message: 'There is nothing to measure.' };
  // One line, or two points: from one end to the other.
  const ends = !second
    ? first.kind === 'line'
      ? ([first.a, first.b] as const)
      : undefined
    : first.kind === 'point' && second.kind === 'point'
      ? ([first.p, second.p] as const)
      : undefined;
  if (!second && !ends) return { type: 'invalid', message: 'A single point has no length.' };
  if (ends) {
    const [p, q] = ends;
    const d = sub(q, p);
    const u =
      fixed(direction) ??
      (direction === 'aligned' ? unit(d) : autoDirection(p, q, at)) ??
      ([1, 0] as Vec2);
    return done(p, q, u);
  }
  // A point and a line, or two lines.
  const lines = s.filter((x): x is Extract<Shape, { kind: 'line' }> => x.kind === 'line');
  const line = lines[0] as Extract<Shape, { kind: 'line' }>;
  const along = unit(sub(line.b, line.a)) as Vec2;
  const normal: Vec2 = [-along[1], along[0]];
  const u = fixed(direction) ?? normal;
  const square = Math.abs(dot(along, u)) < 1e-6;
  if (lines.length === 2) {
    const other = lines[1] as Extract<Shape, { kind: 'line' }>;
    const d2 = unit(sub(other.b, other.a)) as Vec2;
    if (Math.abs(cross2(along, d2)) > 1e-6 || !square)
      return { type: 'invalid', message: NOT_PARALLEL };
    // From the first line where it is nearest the text, straight across to the second.
    const p = closest(line, at);
    return done(p, closest(other, p), u);
  }
  const point = (s.find((x) => x.kind === 'point') as Extract<Shape, { kind: 'point' }>).p;
  const q = square ? closest(line, point) : nearestEnd(line, point);
  return first.kind === 'point' ? done(point, q, u) : done(q, point, u);
}

/**
 * Which way an unset linear dimension measures: horizontal when its text is
 * above or below the two points, vertical when beside them, else along them.
 */
function autoDirection(p: Vec2, q: Vec2, at: Vec2): Vec2 | undefined {
  const inX = at[0] >= Math.min(p[0], q[0]) && at[0] <= Math.max(p[0], q[0]);
  const inY = at[1] >= Math.min(p[1], q[1]) && at[1] <= Math.max(p[1], q[1]);
  const d = sub(q, p);
  if (Math.abs(d[1]) < EPS) return [1, 0];
  if (Math.abs(d[0]) < EPS) return [0, 1];
  if (inX && !inY) return [1, 0];
  if (inY && !inX) return [0, 1];
  return unit(d);
}

function angleOf(shapes: Shape[], at: Vec2): Measured {
  const [a, b] = shapes;
  if (a?.kind !== 'line' || b?.kind !== 'line') {
    return { type: 'invalid', message: 'An angle is between two lines.' };
  }
  const da = unit(sub(a.b, a.a)) as Vec2;
  const db = unit(sub(b.b, b.a)) as Vec2;
  const det = cross2(da, db);
  if (Math.abs(det) < 1e-9)
    return { type: 'invalid', message: 'The lines are parallel: they make no angle.' };
  // Where the lines cross.
  const t = cross2(sub(b.a, a.a), db) / det;
  const vertex = add(a.a, scale(da, t));
  // The sector the text is in: each line's ray on the text's side.
  const toAt = sub(at, vertex);
  const [x, y] = inBasis(toAt, da, db);
  const ra = scale(da, x < 0 ? -1 : 1);
  const rb = scale(db, y < 0 ? -1 : 1);
  const value = (Math.acos(Math.max(-1, Math.min(1, dot(ra, rb)))) * 180) / Math.PI;
  return {
    type: 'angle',
    value,
    vertex,
    a: ra,
    b: rb,
    ends: [
      [a.a, a.b],
      [b.a, b.b],
    ],
  };
}

// The text ---------------------------------------------------------------------------

/**
 * A dimension's text (plan §4.5): the value at the item's decimals (else the
 * sheet's), a length in the design's unit without the unit, R before a
 * radius and Ø before a diameter, ° after an angle; `before` and `after`
 * around it; in brackets for a reference dimension. `?` for a value that
 * can't be measured.
 */
export function sheetDimensionText(
  sheet: Pick<Sheet, 'decimals'>,
  item: SheetDimensionItem,
  value: number | undefined,
  options: SheetDimensionOptions = {},
): string {
  const decimals = item.decimals ?? sheet.decimals;
  let number = '?';
  if (value !== undefined) {
    const shown =
      item.type === 'angle' ? value : value / (UNITS[options.units ?? 'mm']?.factor ?? 1);
    number = shown.toFixed(decimals);
    if (/^-0\.?0*$/.test(number)) number = number.slice(1);
  }
  const symbol = item.type === 'radius' ? 'R' : item.type === 'diameter' ? 'Ø' : '';
  const unit = item.type === 'angle' ? '°' : '';
  const text = `${item.before ?? ''}${symbol}${number}${unit}${item.after ?? ''}`;
  return item.reference ? `(${text})` : text;
}

/** A dimension's value, text and state from the resolved anchors (`resolveSheet`). */
export function measureSheetDimension(
  sheet: Sheet,
  item: SheetDimensionItem,
  anchors: SheetAnchors | undefined,
  options: SheetDimensionOptions = {},
): SheetDimensionMeasure {
  const solved = solve(sheet, item, anchors?.[item.id]);
  const value = solved.measured?.type === 'invalid' ? undefined : solved.measured?.value;
  return {
    value,
    text: sheetDimensionText(sheet, item, value, options),
    state: solved.state,
    ...(solved.message && { message: solved.message }),
  };
}

interface Solved {
  state: SheetDimensionState;
  message?: string;
  frame?: SheetViewFrame;
  /** The text's place now, view mm. */
  at: Vec2;
  measured?: Measured;
}

function solve(
  sheet: Sheet,
  item: SheetDimensionItem,
  reports: readonly SheetAnchorReport[] | undefined,
): Solved {
  const frame = sheetViewFrame(sheet, item.view);
  if (!frame) return { state: 'detached', message: "The dimension's view is gone.", at: item.at };
  let state: SheetDimensionState = anchorsState(item.anchors, reports);
  const at = followAnchors(item.at, item.anchors, reports, frame);
  const placed = placeAnchors(item.anchors, reports, frame);
  if (placed.problem) return { state: 'invalid', message: placed.problem, frame, at };
  const shapes = placed.shapes ?? [];
  // Why it is lost: the kernel's reason when it gives one (a deleted, suppressed or
  // failed feature), else what to do about it.
  const lost =
    reports?.find((r) => r.status === 'detached' && r.message)?.message ??
    'This dimension lost its edge: drag an end onto an edge, or delete it.';
  if (shapes.some((s) => s === undefined)) {
    return { state: 'detached', message: lost, frame, at };
  }
  const measured = measure(item, shapes as Shape[], at);
  let message: string | undefined;
  if (measured.type === 'invalid') {
    if (state !== 'detached') state = 'invalid';
    message = measured.message;
  } else if (state === 'detached') {
    message = lost;
  }
  return { state, frame, at, measured, ...(message && { message }) };
}

// Layout -----------------------------------------------------------------------------

/**
 * A dimension's display items in sheet mm, keyed `item:<id>`, each with the
 * dimension's `state` unless it is `ok`. A dimension that can't be measured
 * (detached with no geometry kept, or invalid) is its text alone at `at`.
 */
export function layoutSheetDimension(
  sheet: Sheet,
  item: SheetDimensionItem,
  anchors: SheetAnchors | undefined,
  options: SheetDimensionOptions = {},
): DisplayItem[] {
  const view = sheet.views.find((v) => v.id === item.view);
  if (!view) return [];
  const solved = solve(sheet, item, anchors?.[item.id]);
  const { S, D } = viewToSheet(sheet, view);
  const m = solved.measured;
  const value = m && m.type !== 'invalid' ? m.value : undefined;
  const text = sheetDimensionText(sheet, item, value, options);
  const at = S(solved.at);
  const draw = new Drawing(`item:${item.id}`, solved.state, SHEET_DIMENSION);
  if (!m || m.type === 'invalid') {
    draw.text(text, at, 0, 'centre');
    return draw.items();
  }
  switch (m.type) {
    case 'linear':
      linearItems(draw, S(m.linear.p), S(m.linear.q), D(m.linear.u), at, text);
      break;
    case 'circle': {
      const c = S(m.circle.centre);
      const towards = unit(sub(at, c)) ?? ([Math.SQRT1_2, -Math.SQRT1_2] as Vec2);
      // The circle's point furthest that way on the sheet (y flips back for the view).
      const rim = (dir: Vec2) => S(m.circle.at([dir[0], -dir[1]]));
      circleItems(
        draw,
        c,
        rim(towards),
        item.type === 'diameter' ? rim(scale(towards, -1)) : undefined,
        at,
        text,
      );
      break;
    }
    case 'angle':
      angleItems(draw, S(m.vertex), D(m.a), D(m.b), [m.ends[0].map(S), m.ends[1].map(S)], at, text);
      break;
  }
  return draw.items();
}

/** A text angle that reads from below or from the right: in [-90°, 90°). */
function readable(dir: Vec2): number {
  let a = Math.atan2(dir[1], dir[0]);
  if (a >= Math.PI / 2 - 1e-9) a -= Math.PI;
  else if (a < -Math.PI / 2 - 1e-9) a += Math.PI;
  return a;
}

/**
 * A linear dimension (sheet mm): extension lines from `p` and `q` square to
 * `u` out to the dimension line through `at`, the line with an arrowhead at
 * each end (inside, or outside when there is no room), the text above it in
 * its direction.
 */
function linearItems(draw: Drawing, p: Point, q: Point, u: Vec2, at: Point, text: string): void {
  const { gap, overshoot, arrow, text: height } = SHEET_DIMENSION;
  const n: Vec2 = [-u[1], u[0]];
  const p2 = add(p, scale(n, dot(sub(at, p), n)));
  const q2 = add(q, scale(n, dot(sub(at, q), n)));
  for (const [from, to] of [
    [p, p2],
    [q, q2],
  ] as const) {
    const reach = len(sub(to, from));
    if (reach <= gap) continue;
    const out = scale(sub(to, from), 1 / reach);
    draw.line(add(from, scale(out, gap)), add(to, scale(out, overshoot)));
  }
  const span = dot(sub(q2, p2), u);
  const along = span >= 0 ? u : scale(u, -1);
  const length = Math.abs(span);
  // The text along the line, centred on `at`; the line reaches out to it when it is beyond an end.
  const angle = readable(u);
  const w = textWidth(text, height);
  const t = dot(sub(at, p2), along);
  const lo = Math.min(0, t - w / 2);
  const hi = Math.max(length, t + w / 2);
  if (length < EPS) {
    draw.text(text, at, angle, 'centre');
    return;
  }
  const inside = length >= 2 * arrow + 1;
  if (inside) {
    draw.line(add(p2, scale(along, Math.min(0, lo))), add(p2, scale(along, Math.max(length, hi))));
    draw.arrow(p2, scale(along, -1));
    draw.arrow(q2, along);
  } else {
    // No room: the arrowheads outside, pointing in, on stubs.
    const stub = arrow + 2;
    draw.line(
      add(p2, scale(along, Math.min(-stub, lo))),
      add(p2, scale(along, Math.max(length + stub, hi))),
    );
    draw.arrow(p2, along);
    draw.arrow(q2, scale(along, -1));
  }
  draw.text(text, at, angle, 'centre');
}

/**
 * A radius (no `back`) or a diameter (sheet mm): the line from the centre
 * (from the far side for a diameter) through the rim towards `at`, an
 * arrowhead at the rim (both rims for a diameter); outside the circle a
 * short horizontal shelf under the text.
 */
function circleItems(
  draw: Drawing,
  c: Point,
  rim: Point,
  back: Point | undefined,
  at: Point,
  text: string,
): void {
  const { text: height } = SHEET_DIMENSION;
  const r = len(sub(rim, c));
  const out = unit(sub(rim, c)) ?? ([1, 0] as Vec2);
  const reach = len(sub(at, c));
  const far = reach > r ? at : rim;
  draw.line(back ?? c, far);
  draw.arrow(rim, out);
  if (back) draw.arrow(back, unit(sub(back, c)) ?? scale(out, -1));
  if (reach > r) {
    const w = textWidth(text, height);
    const right = out[0] >= 0;
    const end = add(at, [right ? w + 1 : -(w + 1), 0]);
    draw.line(at, end);
    draw.text(text, right ? add(at, [0.5, 0]) : add(at, [-0.5, 0]), 0, right ? 'start' : 'end');
  } else {
    draw.text(text, at, 0, 'centre');
  }
}

/**
 * An angle (sheet mm): an arc about the lines' crossing through `at`, from
 * one ray to the other, arrowheads at its ends, extension lines where the
 * edges stop short of it, the text level, just outside the arc.
 */
function angleItems(
  draw: Drawing,
  vertex: Point,
  ra: Vec2,
  rb: Vec2,
  ends: [Point[], Point[]],
  at: Point,
  text: string,
): void {
  const { gap, overshoot, text: height } = SHEET_DIMENSION;
  const radius = Math.max(len(sub(at, vertex)), 1);
  const from = add(vertex, scale(ra, radius));
  const to = add(vertex, scale(rb, radius));
  let sweep = Math.atan2(rb[1], rb[0]) - Math.atan2(ra[1], ra[0]);
  while (sweep > Math.PI) sweep -= 2 * Math.PI;
  while (sweep < -Math.PI) sweep += 2 * Math.PI;
  draw.arc(vertex, from, sweep, to);
  const turn = Math.sign(sweep) || 1;
  // Tangent at each end, pointing away from the arc's middle.
  draw.arrow(from, scale([-ra[1], ra[0]], -turn));
  draw.arrow(to, scale([-rb[1], rb[0]], turn));
  for (const [ray, pts] of [
    [ra, ends[0]],
    [rb, ends[1]],
  ] as const) {
    const along = pts.map((p) => dot(sub(p, vertex), ray));
    const reach = Math.max(...along);
    const start = Math.min(...along);
    if (reach < radius - gap) {
      // The edge stops short of the arc: out from its end to past the arc.
      draw.line(
        add(vertex, scale(ray, Math.max(reach, 0) + gap)),
        add(vertex, scale(ray, radius + overshoot)),
      );
    } else if (start > radius + gap) {
      // The edge starts beyond the arc: back from its start to inside the arc.
      draw.line(
        add(vertex, scale(ray, start - gap)),
        add(vertex, scale(ray, Math.max(radius - overshoot, 0))),
      );
    }
  }
  // Level text just outside the arc, clear of it however the arc runs there.
  const radial = unit(sub(at, vertex)) ?? ([0, -1] as Vec2);
  const w = textWidth(text, height);
  const clear =
    SHEET_DIMENSION.lift + (Math.abs(radial[0]) * w) / 2 + (Math.abs(radial[1]) * height) / 2;
  const centre = add(at, scale(radial, clear));
  draw.text(text, add(centre, [0, height / 2 - SHEET_DIMENSION.lift]), 0, 'centre');
}

function nearestEnd(line: { a: Vec2; b: Vec2 }, p: Vec2): Vec2 {
  return len(sub(line.a, p)) <= len(sub(line.b, p)) ? line.a : line.b;
}

/** Coordinates of `v` in the basis (a, b). */
function inBasis(v: Vec2, a: Vec2, b: Vec2): [number, number] {
  const det = cross2(a, b);
  return [cross2(v, b) / det, cross2(a, v) / det];
}
