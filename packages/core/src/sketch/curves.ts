/**
 * The shapes of ellipses and splines (P1-05, P4-05, ADR-0014, ADR-0063),
 * read from their points. The viewport, the drawing tools and the kernel all
 * draw them from here, so a spline is the same curve on screen and in the
 * model: the kernel gets these poles and knots, not the fit points.
 */

import type { SketchEntityId } from '../ids';
import type { Vec2 } from './planes';
import type { SketchData, SketchEntity, SketchSpline } from './schema';

// Ellipses ---------------------------------------------------------------------

export interface EllipseShape {
  center: Vec2;
  /** Semi-major axis, mm. */
  a: number;
  /** Semi-minor axis, mm. */
  b: number;
  /** Direction of the major axis, radians. */
  rotation: number;
}

/**
 * The ellipse through its center, major-axis end and minor-axis end. The
 * minor radius is the minor point's distance from the major axis, so a
 * point slightly off square (before a solve) still gives a sensible shape.
 */
export function ellipseShape(center: Vec2, major: Vec2, minor: Vec2): EllipseShape {
  const ux = major[0] - center[0];
  const uy = major[1] - center[1];
  const a = Math.hypot(ux, uy);
  const rotation = Math.atan2(uy, ux);
  const mx = minor[0] - center[0];
  const my = minor[1] - center[1];
  const b = a === 0 ? Math.hypot(mx, my) : Math.abs(ux * my - uy * mx) / a;
  return { center, a, b, rotation };
}

/** The point of an ellipse at parameter `t` (radians; 0 is the major-axis end). */
export function ellipsePoint(e: EllipseShape, t: number): Vec2 {
  const cos = Math.cos(e.rotation);
  const sin = Math.sin(e.rotation);
  const x = e.a * Math.cos(t);
  const y = e.b * Math.sin(t);
  return [e.center[0] + x * cos - y * sin, e.center[1] + x * sin + y * cos];
}

// Fit-point splines ------------------------------------------------------------

/** A clamped, non-rational B-spline. */
export interface BSpline {
  degree: number;
  poles: Vec2[];
  /** Full knot vector: poles + degree + 1 values, from 0 to 1. */
  knots: number[];
}

/**
 * The cubic B-spline through `points` in order (global interpolation with
 * chord-length parameters and averaged knots, Piegl & Tiller §9.2.1). Two
 * points give a line, three a parabola. The curve passes through every
 * point and is C2 inside.
 */
export function fitSpline(points: readonly Vec2[]): BSpline {
  const n = points.length - 1;
  if (n < 1) throw new Error('fitSpline: needs at least two points');
  const degree = Math.min(3, n);

  // Chord-length parameters. Coincident neighbours would make the system
  // singular, so every step is at least a small share of the total.
  const lengths = points
    .slice(1)
    .map((p, i) => Math.hypot(p[0] - (points[i] as Vec2)[0], p[1] - (points[i] as Vec2)[1]));
  const total = lengths.reduce((s, l) => s + l, 0);
  const floor = total > 0 ? (1e-6 * total) / n : 1;
  const steps = lengths.map((l) => Math.max(l, floor));
  const sum = steps.reduce((s, l) => s + l, 0);
  const params = [0];
  for (const step of steps) params.push((params[params.length - 1] as number) + step / sum);
  params[n] = 1;

  const knots: number[] = [];
  for (let i = 0; i <= degree; i++) knots.push(0);
  for (let j = 1; j <= n - degree; j++) {
    let s = 0;
    for (let i = j; i < j + degree; i++) s += params[i] as number;
    knots.push(s / degree);
  }
  for (let i = 0; i <= degree; i++) knots.push(1);

  // N · P = Q, one row per fit point.
  const matrix = params.map((u) => {
    const row = new Array<number>(n + 1).fill(0);
    const span = findSpan(n, degree, u, knots);
    basis(span, u, degree, knots).forEach((value, k) => {
      row[span - degree + k] = value;
    });
    return row;
  });
  const poles = solve(
    matrix,
    points.map((p) => [p[0], p[1]]),
  ).map((r) => [r[0], r[1]] as Vec2);
  return { degree, poles, knots };
}

/** The point of a B-spline at `u` in [0, 1]. */
export function splinePoint(spline: BSpline, u: number): Vec2 {
  const { degree, poles, knots } = spline;
  const n = poles.length - 1;
  const span = findSpan(n, degree, u, knots);
  const values = basis(span, u, degree, knots);
  let x = 0;
  let y = 0;
  values.forEach((value, k) => {
    const pole = poles[span - degree + k] as Vec2;
    x += value * pole[0];
    y += value * pole[1];
  });
  return [x, y];
}

/** Segments a spline's polyline draws per knot span (ADR-0063). */
export const SPLINE_SEGMENTS_PER_SPAN = 16;
/**
 * A conic's pieces are short (ADR-0063: its subdivision has up to 144 spans),
 * so its polyline draws fewer segments in each: four, which keeps a full conic
 * at under 600 drawn and picked points instead of over 2,000.
 * Fit-point and control-point splines keep the full sixteen.
 */
export const CONIC_SEGMENTS_PER_SPAN = 4;
/**
 * …but a conic with few spans still wants enough of them to draw smooth: the
 * segments are `max(4, ceil(96 / spans))` per span, so a one-span parabola
 * (rho 0.5) is drawn with 96 chords and its chords stay two orders of
 * magnitude inside the profile detection's vertex tolerance.
 */
export const CONIC_MIN_SEGMENTS = 96;

/** Points along a B-spline, `perSpan` segments between neighbouring distinct knots. */
export function splinePolyline(spline: BSpline, perSpan = SPLINE_SEGMENTS_PER_SPAN): Vec2[] {
  const distinct = [...new Set(spline.knots)];
  const out: Vec2[] = [splinePoint(spline, 0)];
  for (let i = 1; i < distinct.length; i++) {
    const u0 = distinct[i - 1] as number;
    const u1 = distinct[i] as number;
    for (let k = 1; k <= perSpan; k++)
      out.push(splinePoint(spline, u0 + ((u1 - u0) * k) / perSpan));
  }
  return out;
}

// Spline modes (P4-05, ADR-0063 §1, §2) ------------------------------------------

/** How a spline's points shape its curve; 'fit' is what an old spline without a mode is. */
export type SplineMode = 'fit' | 'control' | 'conic';

/**
 * The clamped cubic B-spline through `poles` as control points (P4-05,
 * `mode: 'control'`): degree `min(3, n − 1)` with uniform interior knots, so
 * the curve starts at the first pole, ends at the last and is tangent to the
 * control polygon at both. Two poles give a line, three a quadratic Bézier.
 */
export function controlSpline(poles: readonly Vec2[]): BSpline {
  if (poles.length < 2) throw new Error('controlSpline: needs at least two points');
  const degree = Math.min(3, poles.length - 1);
  // Uniform interior knots, one per knot span after the first.
  const spans = poles.length - degree;
  const knots: number[] = [];
  for (let i = 0; i <= degree; i++) knots.push(0);
  for (let j = 1; j < spans; j++) knots.push(j / spans);
  for (let i = 0; i <= degree; i++) knots.push(1);
  return { degree, poles: poles.map((p) => [p[0], p[1]] as Vec2), knots };
}

/** The middle weight of a conic: the ratio a rational Bézier needs for its rho. */
const conicWeight = (rho: number): number => rho / (1 - rho);

/**
 * The exact rational quadratic Bézier of a conic (P4-05, `mode: 'conic'`):
 * the poles `start`, `shoulder`, `end` with weights 1, `rho / (1 − rho)`, 1.
 * Below rho 0.5 an ellipse arc, 0.5 a parabola, above a hyperbola arc; the end
 * tangents point at the shoulder. This is the curve a conic *means* — the
 * sketch stores these three points and rho, and `conicSpline` approximates it.
 */
export function conicPoint(start: Vec2, shoulder: Vec2, end: Vec2, rho: number, t: number): Vec2 {
  const w = conicWeight(rho);
  const a = (1 - t) * (1 - t);
  const b = 2 * t * (1 - t) * w;
  const c = t * t;
  const d = a + b + c;
  return [
    (a * start[0] + b * shoulder[0] + c * end[0]) / d,
    (a * start[1] + b * shoulder[1] + c * end[1]) / d,
  ];
}

/** The tangent of the exact conic at `t`, as a vector per unit of `t`. */
function conicTangent(start: Vec2, shoulder: Vec2, end: Vec2, rho: number, t: number): Vec2 {
  const w = conicWeight(rho);
  const a = (1 - t) * (1 - t);
  const b = 2 * t * (1 - t) * w;
  const c = t * t;
  const da = -2 * (1 - t);
  const db = 2 * w * (1 - 2 * t);
  const dc = 2 * t;
  const d = a + b + c;
  const dd = da + db + dc;
  const n0 = a * start[0] + b * shoulder[0] + c * end[0];
  const n1 = a * start[1] + b * shoulder[1] + c * end[1];
  const dn0 = da * start[0] + db * shoulder[0] + dc * end[0];
  const dn1 = da * start[1] + db * shoulder[1] + dc * end[1];
  return [(dn0 * d - n0 * dd) / (d * d), (dn1 * d - n1 * dd) / (d * d)];
}

/**
 * How close a conic's cubic approximation stays to the exact curve, mm
 * (ADR-0063 §2): a hundredth of a micron, and a tenth of the profile
 * detection's own vertex tolerance.
 */
export const CONIC_TOLERANCE = 1e-5;
/**
 * The most Hermite pieces a conic is cut into (ADR-0063 §2). Adaptive
 * subdivision gives an ordinary conic a few dozen and the fullest one (rho
 * 0.95, whose speed swings 19:1 between its ends) 144, so this cap only
 * stops a degenerate one.
 */
export const CONIC_MAX_PIECES = 160;
/** Parameters checked inside each piece while looking for the tolerance. */
const CONIC_SAMPLES_PER_PIECE = 8;

/** One cubic Hermite piece of the exact conic over the parameters [t0, t1]. */
function conicPiece(
  start: Vec2,
  shoulder: Vec2,
  end: Vec2,
  rho: number,
  t0: number,
  t1: number,
): Vec2[] {
  const from = conicPoint(start, shoulder, end, rho, t0);
  const to = conicPoint(start, shoulder, end, rho, t1);
  // The exact tangents, each a third of its piece's parameter span: the join
  // point's tangent vector is then the same from both sides, which is what
  // makes the joined B-spline C1.
  const span = t1 - t0;
  const at = conicTangent(start, shoulder, end, rho, t0);
  const leave = conicTangent(start, shoulder, end, rho, t1);
  return [
    from,
    [from[0] + (span / 3) * at[0], from[1] + (span / 3) * at[1]],
    [to[0] - (span / 3) * leave[0], to[1] - (span / 3) * leave[1]],
    to,
  ];
}

/** The point of a cubic Bézier at `s` in [0, 1] (de Casteljau). */
function bezierAt(points: readonly Vec2[], s: number): Vec2 {
  let row = points;
  while (row.length > 1) {
    const next: Vec2[] = [];
    for (let i = 1; i < row.length; i++) {
      const a = row[i - 1] as Vec2;
      const b = row[i] as Vec2;
      next.push([a[0] + (b[0] - a[0]) * s, a[1] + (b[1] - a[1]) * s]);
    }
    row = next;
  }
  return row[0] as Vec2;
}

/** How far a piece runs from the exact conic inside it, mm. */
function pieceError(
  points: readonly Vec2[],
  start: Vec2,
  shoulder: Vec2,
  end: Vec2,
  rho: number,
  t0: number,
  t1: number,
): number {
  const span = t1 - t0;
  let worst = 0;
  // The piece's ends are the exact curve's points, so the inside is what to see.
  for (let i = 1; i < CONIC_SAMPLES_PER_PIECE; i++) {
    const s = i / CONIC_SAMPLES_PER_PIECE;
    const at = bezierAt(points, s);
    const [ex, ey] = conicPoint(start, shoulder, end, rho, t0 + s * span);
    worst = Math.max(worst, Math.hypot(at[0] - ex, at[1] - ey));
  }
  return worst;
}

/**
 * The non-rational cubic B-spline within `CONIC_TOLERANCE` of the exact conic
 * (P4-05, ADR-0063 §2). Its own curve is rational, which the kernel cannot
 * take (ADR-0001), so this is what everything downstream draws, measures,
 * extrudes and exports; the stored conic stays exact.
 *
 * The pieces are cubic Hermite pieces of the exact conic, subdivided
 * adaptively: an interval over the tolerance is split at its middle and
 * looked at again. Splitting halves the parameter span, which brings the
 * rational weight of the piece towards 1, so a piece becomes polynomial
 * (fourth order) quickly and the ones where the curve swings — the ends of a
 * full conic — get the spans they need while the flat middle keeps two.
 *
 * They are joined into one cubic B-spline with **double interior knots at the
 * pieces' parameters**, so `splinePoint(spline, t)` is the exact conic's point
 * at every join, and the poles are the pieces' control points with each join's
 * shared point dropped. rho = 0.5 is exact: one quadratic Bézier raised to
 * degree 3.
 */
export function conicSpline(start: Vec2, shoulder: Vec2, end: Vec2, rho: number): BSpline {
  // The quadratic Bézier of rho = 0.5 is already a cubic.
  if (rho === 0.5) {
    return {
      degree: 3,
      poles: [
        start,
        [
          start[0] + (2 / 3) * (shoulder[0] - start[0]),
          start[1] + (2 / 3) * (shoulder[1] - start[1]),
        ],
        [end[0] + (2 / 3) * (shoulder[0] - end[0]), end[1] + (2 / 3) * (shoulder[1] - end[1])],
        end,
      ],
      knots: [0, 0, 0, 0, 1, 1, 1, 1],
    };
  }
  const pending: [number, number][] = [
    [0, 0.5],
    [0.5, 1],
  ];
  const kept: { t0: number; points: Vec2[] }[] = [];
  while (pending.length > 0) {
    const [t0, t1] = pending.shift() as [number, number];
    const points = conicPiece(start, shoulder, end, rho, t0, t1);
    const over =
      pieceError(points, start, shoulder, end, rho, t0, t1) > CONIC_TOLERANCE &&
      // Every interval still waiting ends up a piece, and this one has just
      // come off the queue, so they are the budget.
      kept.length + pending.length + 1 < CONIC_MAX_PIECES;
    if (over) {
      // Splitting at the middle puts the halves at the back of the queue, so
      // the subdivision spreads evenly (breadth first) instead of deepening
      // the first interval until the pieces are wasted.
      const mid = (t0 + t1) / 2;
      pending.push([t0, mid], [mid, t1]);
    } else kept.push({ t0, points });
  }
  kept.sort((a, b) => a.t0 - b.t0);
  return joinConicPieces(kept);
}

/**
 * The kept pieces as one cubic B-spline: double interior knots at their
 * parameters, and the poles a C1 chain has — the first piece's first three
 * control points, then each piece's middle two, then the last point. The
 * pieces' shared ends are the curve's join points, which such a chain implies
 * from the two poles around them (the test proves it for unequal spans).
 */
function joinConicPieces(pieces: readonly { t0: number; points: Vec2[] }[]): BSpline {
  const first = pieces[0]?.points as Vec2[];
  const last = pieces[pieces.length - 1]?.points as Vec2[];
  const poles: Vec2[] = [first[0] as Vec2, first[1] as Vec2, first[2] as Vec2];
  for (const piece of pieces.slice(1)) poles.push(piece.points[1] as Vec2, piece.points[2] as Vec2);
  poles.push(last[3] as Vec2);
  const knots: number[] = [0, 0, 0, 0];
  for (const piece of pieces.slice(1)) knots.push(piece.t0, piece.t0);
  knots.push(1, 1, 1, 1);
  return { degree: 3, poles, knots };
}

/**
 * The curve of a spline entity from the positions of its points (P4-05,
 * ADR-0063 §2): the one place a spline's shape comes from, so the viewport,
 * the profiles, the export and the kernel all draw the same curve. `mode`
 * picks how the points shape it; a spline without one is a fit-point spline.
 */
export function splineCurve(entity: SketchSpline, points: Vec2[]): BSpline {
  if (entity.mode === 'control') return controlSpline(points);
  if (entity.mode === 'conic' && entity.rho !== undefined && points.length === 3) {
    const [start, shoulder, end] = points as [Vec2, Vec2, Vec2];
    return conicSpline(start, shoulder, end, entity.rho);
  }
  return fitSpline(points);
}

// Polylines --------------------------------------------------------------------

/** Segments for a full circle or ellipse; arcs use a share of these. */
export const CIRCLE_SEGMENTS = 96;

/**
 * A curve of a sketch as a polyline in sketch coordinates: what the viewport
 * draws, and what picking and highlights (P1-06) measure against. A circle
 * or an ellipse ends on its first point; an arc runs counter-clockwise from
 * its start, with the radius of its start point. Undefined for points and
 * for curves whose points are missing.
 */
export function curvePolyline(data: SketchData, entity: SketchEntity): Vec2[] | undefined {
  const at = (id: SketchEntityId): Vec2 | undefined => {
    const p = data.entities[id];
    return p?.type === 'point' ? [p.x, p.y] : undefined;
  };
  switch (entity.type) {
    case 'point':
      return undefined;
    case 'line': {
      const a = at(entity.start);
      const b = at(entity.end);
      return a && b ? [a, b] : undefined;
    }
    case 'circle': {
      const c = at(entity.center);
      return c && circular(c, entity.radius, 0, 2 * Math.PI);
    }
    case 'arc': {
      const c = at(entity.center);
      const s = at(entity.start);
      const e = at(entity.end);
      if (!c || !s || !e) return undefined;
      const from = Math.atan2(s[1] - c[1], s[0] - c[0]);
      const to = Math.atan2(e[1] - c[1], e[0] - c[0]);
      let sweep = (to - from) % (2 * Math.PI);
      if (sweep <= 1e-12) sweep += 2 * Math.PI;
      return circular(c, Math.hypot(s[0] - c[0], s[1] - c[1]), from, sweep);
    }
    case 'ellipse': {
      const c = at(entity.center);
      const major = at(entity.major);
      const minor = at(entity.minor);
      if (!c || !major || !minor) return undefined;
      const shape = ellipseShape(c, major, minor);
      const out: Vec2[] = [];
      for (let i = 0; i <= CIRCLE_SEGMENTS; i++) {
        out.push(ellipsePoint(shape, (2 * Math.PI * i) / CIRCLE_SEGMENTS));
      }
      return out;
    }
    case 'spline': {
      const points = entity.points.map(at);
      if (!points.every((p) => p !== undefined)) return undefined;
      const spline = splineCurve(entity, points as Vec2[]);
      if (entity.mode !== 'conic') return splinePolyline(spline);
      const spans = new Set(spline.knots).size - 1;
      return splinePolyline(
        spline,
        Math.max(CONIC_SEGMENTS_PER_SPAN, Math.ceil(CONIC_MIN_SEGMENTS / spans)),
      );
    }
    case 'text':
      // A text is many curves: its callers that must see text use `textPolylines`.
      return undefined;
  }
}

function circular(center: Vec2, radius: number, from: number, sweep: number): Vec2[] {
  const n = Math.max(2, Math.ceil((Math.abs(sweep) / (2 * Math.PI)) * CIRCLE_SEGMENTS));
  const out: Vec2[] = [];
  for (let i = 0; i <= n; i++) {
    const t = from + (sweep * i) / n;
    out.push([center[0] + radius * Math.cos(t), center[1] + radius * Math.sin(t)]);
  }
  return out;
}

/** The knot span that holds `u` (Piegl & Tiller A2.1). */
function findSpan(n: number, degree: number, u: number, knots: readonly number[]): number {
  if (u >= (knots[n + 1] as number)) return n;
  if (u <= (knots[degree] as number)) return degree;
  let low = degree;
  let high = n + 1;
  let mid = Math.floor((low + high) / 2);
  while (u < (knots[mid] as number) || u >= (knots[mid + 1] as number)) {
    if (u < (knots[mid] as number)) high = mid;
    else low = mid;
    mid = Math.floor((low + high) / 2);
  }
  return mid;
}

/** The degree + 1 non-zero basis functions at `u` (Piegl & Tiller A2.2). */
function basis(span: number, u: number, degree: number, knots: readonly number[]): number[] {
  const values = [1];
  const left = [0];
  const right = [0];
  for (let j = 1; j <= degree; j++) {
    left[j] = u - (knots[span + 1 - j] as number);
    right[j] = (knots[span + j] as number) - u;
    let saved = 0;
    for (let r = 0; r < j; r++) {
      const denom = (right[r + 1] as number) + (left[j - r] as number);
      const temp = denom === 0 ? 0 : (values[r] as number) / denom;
      values[r] = saved + (right[r + 1] as number) * temp;
      saved = (left[j - r] as number) * temp;
    }
    values[j] = saved;
  }
  return values;
}

/** Solves A · X = B by Gaussian elimination with partial pivoting (small, dense systems). */
function solve(a: number[][], b: number[][]): number[][] {
  const n = a.length;
  const m = a.map((row, i) => [...row, ...(b[i] as number[])]);
  const width = (m[0] as number[]).length;
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) {
      if (
        Math.abs((m[r] as number[])[col] as number) >
        Math.abs((m[pivot] as number[])[col] as number)
      )
        pivot = r;
    }
    [m[col], m[pivot]] = [m[pivot] as number[], m[col] as number[]];
    const top = m[col] as number[];
    const p = top[col] as number;
    for (let r = col + 1; r < n; r++) {
      const row = m[r] as number[];
      const f = (row[col] as number) / p;
      if (f === 0) continue;
      for (let c = col; c < width; c++) row[c] = (row[c] as number) - f * (top[c] as number);
    }
  }
  const x = b.map((row) => row.map(() => 0));
  for (let r = n - 1; r >= 0; r--) {
    const row = m[r] as number[];
    const out = x[r] as number[];
    for (let k = 0; k < out.length; k++) {
      let s = row[n + k] as number;
      for (let c = r + 1; c < n; c++) s -= (row[c] as number) * ((x[c] as number[])[k] as number);
      out[k] = s / (row[r] as number);
    }
  }
  return x;
}
