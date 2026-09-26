/**
 * Constructions for the drawing tools (P1-04, ADR-0013): circles and arcs
 * from the points a tool collects. Coordinates are sketch mm; angles are
 * radians, counter-clockwise from +x.
 */
import type { Vec2 } from '@extrudo/core';
import { cross, dist, dot, normalizeAngle, sub, TAU } from './geometry';

export interface CircleShape {
  center: Vec2;
  radius: number;
}

/**
 * An arc as the sketch stores it: counter-clockwise from `from` through
 * `sweep` (in (0, 2π)). `reversed` says that the arc was drawn clockwise,
 * so the stored start is the point the user placed last.
 */
export interface ArcShape extends CircleShape {
  from: number;
  sweep: number;
  reversed: boolean;
}

const angleOf = (center: Vec2, p: Vec2) => Math.atan2(p[1] - center[1], p[0] - center[0]);

/** The circle through three points; undefined if they are (nearly) collinear. */
export function circleThrough(a: Vec2, b: Vec2, c: Vec2): CircleShape | undefined {
  const ab = sub(b, a);
  const ac = sub(c, a);
  const d = 2 * cross(ab, ac);
  const scale = Math.max(dot(ab, ab), dot(ac, ac));
  if (scale === 0 || Math.abs(d) < 1e-9 * scale) return undefined;
  const ab2 = dot(ab, ab);
  const ac2 = dot(ac, ac);
  const ux = (ac[1] * ab2 - ab[1] * ac2) / d;
  const uy = (ab[0] * ac2 - ac[0] * ab2) / d;
  const center: Vec2 = [a[0] + ux, a[1] + uy];
  return { center, radius: Math.hypot(ux, uy) };
}

/** The arc from `start` to `end` around `center`, turning the given way. */
export function arcAround(center: Vec2, start: Vec2, end: Vec2, ccw: boolean): ArcShape {
  const [s, e] = ccw ? [start, end] : [end, start];
  const from = angleOf(center, s);
  let sweep = normalizeAngle(angleOf(center, e) - from);
  if (sweep < 1e-12) sweep = TAU;
  return { center, radius: dist(center, start), from, sweep, reversed: !ccw };
}

/** The arc from `start` through `via` to `end`; undefined if the points are collinear. */
export function arcThrough(start: Vec2, via: Vec2, end: Vec2): ArcShape | undefined {
  const circle = circleThrough(start, via, end);
  if (!circle) return undefined;
  const ccw = cross(sub(via, start), sub(end, via)) > 0;
  return arcAround(circle.center, start, end, ccw);
}

/**
 * The arc from `start` to `end` with radius `radius`, bulging toward `side`
 * (the shorter arc of the two on that side). Undefined when the chord is
 * longer than the diameter.
 */
export function arcWithRadius(
  start: Vec2,
  end: Vec2,
  radius: number,
  side: Vec2,
): ArcShape | undefined {
  const chord = sub(end, start);
  const len = Math.hypot(chord[0], chord[1]);
  if (len === 0 || radius < len / 2 - 1e-9) return undefined;
  const mid: Vec2 = [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2];
  const h = Math.sqrt(Math.max(0, radius * radius - (len * len) / 4));
  const n: Vec2 = [-chord[1] / len, chord[0] / len];
  // The arc bulges toward `side`; its center sits on the other side of the chord.
  const bulgeLeft = cross(chord, sub(side, start)) > 0;
  const center: Vec2 = bulgeLeft
    ? [mid[0] - n[0] * h, mid[1] - n[1] * h]
    : [mid[0] + n[0] * h, mid[1] + n[1] * h];
  // Bulging left of start → end means turning clockwise.
  return arcAround(center, start, end, !bulgeLeft);
}

/**
 * The arc that leaves `start` in direction `dir` (tangent there) and ends at
 * `end`. Undefined when `end` lies on the tangent line.
 */
export function tangentArc(start: Vec2, dir: Vec2, end: Vec2): ArcShape | undefined {
  const len = Math.hypot(dir[0], dir[1]);
  if (len === 0) return undefined;
  const t: Vec2 = [dir[0] / len, dir[1] / len];
  const n: Vec2 = [-t[1], t[0]];
  const d = sub(end, start);
  const nd = dot(n, d);
  const d2 = dot(d, d);
  if (d2 === 0 || Math.abs(nd) < 1e-9 * Math.sqrt(d2)) return undefined;
  const k = d2 / (2 * nd);
  const center: Vec2 = [start[0] + n[0] * k, start[1] + n[1] * k];
  // Center on the left of the direction of travel: counter-clockwise.
  return arcAround(center, start, end, nd > 0);
}

/** The points of an arc or circle as a polyline, for previews. */
export function arcPolyline(arc: CircleShape & { from?: number; sweep?: number }, segments = 64) {
  const from = arc.from ?? 0;
  const sweep = arc.sweep ?? TAU;
  const n = Math.max(2, Math.ceil((segments * sweep) / TAU));
  const out: Vec2[] = [];
  for (let i = 0; i <= n; i++) {
    const a = from + (sweep * i) / n;
    out.push([arc.center[0] + arc.radius * Math.cos(a), arc.center[1] + arc.radius * Math.sin(a)]);
  }
  return out;
}
