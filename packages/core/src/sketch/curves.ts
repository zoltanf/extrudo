/**
 * The shapes of ellipses and fit-point splines (P1-05, ADR-0014), read from
 * their points. The viewport, the drawing tools and (later) the kernel all
 * draw them from here, so a spline is the same curve on screen and in the
 * model: the kernel gets these poles and knots, not the fit points.
 */

import type { SketchEntityId } from '../ids';
import type { Vec2 } from './planes';
import type { SketchData, SketchEntity } from './schema';

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

/** Points along a B-spline, `perSpan` segments between neighbouring distinct knots. */
export function splinePolyline(spline: BSpline, perSpan = 16): Vec2[] {
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
      const fit = entity.points.map(at);
      return fit.every((p) => p !== undefined) ? splinePolyline(fitSpline(fit)) : undefined;
    }
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
