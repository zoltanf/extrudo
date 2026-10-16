/**
 * B-splines as Bézier pieces (P1-13), so SVG gets a fit-point spline exactly
 * (`Q`/`C` commands) rather than a polyline. Knot insertion (Boehm) raises
 * every interior knot to the degree's multiplicity; each knot span is then
 * one Bézier. Pieces of a spline between two parameters are cut with de
 * Casteljau. A piece of degree 4 or 5 (a control spline's own degree,
 * ADR-0063's third amendment), which SVG and DXF can't write, is given as
 * cubics within `CUBIC_TOLERANCE` (`cubicApproximation`).
 */
import type { BSpline, Vec2 } from '@extrudo/core';
import { splinePoint } from '@extrudo/core';

/** One Bézier piece: `degree + 1` control points over the parameters [u0, u1]. */
export interface BezierPiece {
  u0: number;
  u1: number;
  points: Vec2[];
}

/** Inserts knot `u` once (Piegl & Tiller A5.1 with r = 1). */
function insertKnot(spline: BSpline, u: number): BSpline {
  const { degree: p, knots, poles } = spline;
  // The span: the last knot at or below u, below the clamped end.
  let k = p;
  while (k < poles.length - 1 && (knots[k + 1] as number) <= u) k++;
  const out: Vec2[] = [];
  for (let i = 0; i <= poles.length; i++) {
    if (i <= k - p) out.push(poles[i] as Vec2);
    else if (i > k) out.push(poles[i - 1] as Vec2);
    else {
      const ki = knots[i] as number;
      const a = (u - ki) / ((knots[i + p] as number) - ki);
      const prev = poles[i - 1] as Vec2;
      const cur = poles[i] as Vec2;
      out.push([(1 - a) * prev[0] + a * cur[0], (1 - a) * prev[1] + a * cur[1]]);
    }
  }
  return { degree: p, poles: out, knots: [...knots.slice(0, k + 1), u, ...knots.slice(k + 1)] };
}

/** The spline's knot spans as Bézier pieces, in order. */
export function bezierPieces(spline: BSpline): BezierPiece[] {
  const p = spline.degree;
  let s = spline;
  const interior = [...new Set(spline.knots)].slice(1, -1);
  for (const u of interior) {
    const multiplicity = s.knots.filter((k) => k === u).length;
    for (let m = multiplicity; m < p; m++) s = insertKnot(s, u);
  }
  const breaks = [0, ...interior, 1];
  return breaks.slice(1).map((u1, j) => ({
    u0: breaks[j] as number,
    u1,
    points: s.poles.slice(j * p, j * p + p + 1),
  }));
}

/** Splits a Bézier at local parameter `t` (de Casteljau): the part before and after. */
function split(points: readonly Vec2[], t: number): [Vec2[], Vec2[]] {
  const before: Vec2[] = [];
  const after: Vec2[] = [];
  let row = points.slice();
  while (row.length > 0) {
    before.push(row[0] as Vec2);
    after.unshift(row[row.length - 1] as Vec2);
    const next: Vec2[] = [];
    for (let i = 1; i < row.length; i++) {
      const a = row[i - 1] as Vec2;
      const b = row[i] as Vec2;
      next.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
    row = next;
  }
  return [before, after];
}

/** The Bézier pieces of the spline between parameters `from` and `to`, in that direction. */
export function bezierRange(pieces: readonly BezierPiece[], from: number, to: number): Vec2[][] {
  const lo = Math.min(from, to);
  const hi = Math.max(from, to);
  const out: Vec2[][] = [];
  for (const piece of pieces) {
    if (piece.u1 <= lo + 1e-12 || piece.u0 >= hi - 1e-12) continue;
    let points = piece.points;
    const span = piece.u1 - piece.u0;
    const a = Math.max(0, (lo - piece.u0) / span);
    const b = Math.min(1, (hi - piece.u0) / span);
    if (b < 1) points = split(points, b)[0];
    if (a > 0) points = split(points, a / b)[1];
    out.push(points);
  }
  if (from > to) {
    out.reverse();
    for (const piece of out) piece.reverse();
  }
  return out;
}

/**
 * The parameter of the spline point nearest to `p`: the nearest of dense
 * samples, refined by golden-section search between its neighbours.
 */
export function splineParam(spline: BSpline, p: Vec2): number {
  const n = 64 * Math.max(1, spline.poles.length - spline.degree);
  const d = (u: number) => {
    const q = splinePoint(spline, u);
    return (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2;
  };
  let best = 0;
  let bestD = Number.POSITIVE_INFINITY;
  for (let i = 0; i <= n; i++) {
    const di = d(i / n);
    if (di < bestD) {
      bestD = di;
      best = i;
    }
  }
  let a = Math.max(0, (best - 1) / n);
  let b = Math.min(1, (best + 1) / n);
  const g = (Math.sqrt(5) - 1) / 2;
  for (let i = 0; i < 60; i++) {
    const c = b - g * (b - a);
    const e = a + g * (b - a);
    if (d(c) < d(e)) b = e;
    else a = c;
  }
  return (a + b) / 2;
}

/**
 * How close the cubics that stand in for a degree-4 or 5 Bézier stay to it, mm
 * (ADR-0063's third amendment, B2): the offset's `OFFSET_TOLERANCE`.
 */
export const CUBIC_TOLERANCE = 1e-3;
/** The most halvings of a piece's parameter range (2⁸ cubics per piece). */
const CUBIC_MAX_DEPTH = 8;

/** A Bézier's point and derivative at `t` (de Casteljau's last two points). */
function pointAndDerivative(points: readonly Vec2[], t: number): [Vec2, Vec2] {
  let row = points.slice();
  while (row.length > 2) {
    const next: Vec2[] = [];
    for (let i = 1; i < row.length; i++) {
      const a = row[i - 1] as Vec2;
      const b = row[i] as Vec2;
      next.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
    row = next;
  }
  const [a, b] = row as [Vec2, Vec2];
  const d = points.length - 1;
  return [
    [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t],
    [d * (b[0] - a[0]), d * (b[1] - a[1])],
  ];
}

/**
 * A Bézier of any degree as cubic Béziers within `tolerance` (mm): the cubic
 * Hermite of each part's ends and end derivatives, checked against the Bézier
 * at its quarter points and halved until it holds. A cubic or lower comes back
 * as it is.
 */
export function cubicApproximation(points: readonly Vec2[], tolerance = CUBIC_TOLERANCE): Vec2[][] {
  if (points.length <= 4) return [points.slice()];
  const out: Vec2[][] = [];
  const part = (t0: number, t1: number, depth: number) => {
    const [p0, d0] = pointAndDerivative(points, t0);
    const [p1, d1] = pointAndDerivative(points, t1);
    const h = (t1 - t0) / 3;
    const cubic: Vec2[] = [
      p0,
      [p0[0] + h * d0[0], p0[1] + h * d0[1]],
      [p1[0] - h * d1[0], p1[1] - h * d1[1]],
      p1,
    ];
    const off = [0.25, 0.5, 0.75].some((s) => {
      const [q] = pointAndDerivative(points, t0 + s * (t1 - t0));
      const [c] = pointAndDerivative(cubic, s);
      return Math.hypot(q[0] - c[0], q[1] - c[1]) > tolerance;
    });
    if (off && depth < CUBIC_MAX_DEPTH) {
      const mid = (t0 + t1) / 2;
      part(t0, mid, depth + 1);
      part(mid, t1, depth + 1);
    } else out.push(cubic);
  };
  part(0, 1, 0);
  // The ends are the piece's own, exactly.
  (out[0] as Vec2[])[0] = points[0] as Vec2;
  (out[out.length - 1] as Vec2[])[3] = points[points.length - 1] as Vec2;
  return out;
}
