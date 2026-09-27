/**
 * B-splines as Bézier pieces (P1-13), so SVG gets a fit-point spline exactly
 * (`Q`/`C` commands) rather than a polyline. Knot insertion (Boehm) raises
 * every interior knot to the degree's multiplicity; each knot span is then
 * one Bézier. Pieces of a spline between two parameters are cut with de
 * Casteljau.
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
