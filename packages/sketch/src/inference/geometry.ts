/**
 * 2D geometry for inference (P1-02): sketch curves as plain shapes, the
 * nearest point on each, and intersections. Coordinates are sketch mm.
 */
import type { SketchData, SketchEntityId, Vec2 } from '@extrudo/core';

export type Curve =
  | { kind: 'line'; id: string; a: Vec2; b: Vec2 }
  | { kind: 'circle'; id: string; center: Vec2; radius: number }
  | {
      kind: 'arc';
      id: string;
      center: Vec2;
      radius: number;
      /** Start angle, radians. */
      from: number;
      /** Counter-clockwise sweep from `from`, in (0, 2π]. */
      sweep: number;
    };

/** An infinite line through `a` in direction `d` (alignment guides). */
export interface Ray {
  a: Vec2;
  d: Vec2;
}

export const TAU = 2 * Math.PI;

export const sub = (a: Vec2, b: Vec2): Vec2 => [a[0] - b[0], a[1] - b[1]];
export const add = (a: Vec2, b: Vec2): Vec2 => [a[0] + b[0], a[1] + b[1]];
export const scale = (a: Vec2, k: number): Vec2 => [a[0] * k, a[1] * k];
export const dot = (a: Vec2, b: Vec2) => a[0] * b[0] + a[1] * b[1];
export const cross = (a: Vec2, b: Vec2) => a[0] * b[1] - a[1] * b[0];
export const dist = (a: Vec2, b: Vec2) => Math.hypot(a[0] - b[0], a[1] - b[1]);
export const lerp = (a: Vec2, b: Vec2, t: number): Vec2 => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
];

/** An angle in [0, 2π). */
export function normalizeAngle(angle: number): number {
  const a = angle % TAU;
  return a < 0 ? a + TAU : a;
}

/** Whether the direction `angle` lies on the arc (with a small tolerance, radians). */
export function onArc(arc: { from: number; sweep: number }, angle: number, eps = 1e-9): boolean {
  const t = normalizeAngle(angle - arc.from);
  return t <= arc.sweep + eps || t >= TAU - eps;
}

/** A point of the circle or arc at `angle`. */
export function polar(center: Vec2, radius: number, angle: number): Vec2 {
  return [center[0] + radius * Math.cos(angle), center[1] + radius * Math.sin(angle)];
}

/** The start and end of an arc, and its midpoint. */
export function arcPoints(arc: Extract<Curve, { kind: 'arc' }>) {
  return {
    start: polar(arc.center, arc.radius, arc.from),
    end: polar(arc.center, arc.radius, arc.from + arc.sweep),
    mid: polar(arc.center, arc.radius, arc.from + arc.sweep / 2),
  };
}

/** The nearest point of a curve to `p`. */
export function nearestOnCurve(curve: Curve, p: Vec2): Vec2 {
  switch (curve.kind) {
    case 'line': {
      const d = sub(curve.b, curve.a);
      const len2 = dot(d, d);
      const t = len2 === 0 ? 0 : Math.min(1, Math.max(0, dot(sub(p, curve.a), d) / len2));
      return lerp(curve.a, curve.b, t);
    }
    case 'circle':
    case 'arc': {
      const v = sub(p, curve.center);
      const angle = Math.hypot(v[0], v[1]) === 0 ? 0 : Math.atan2(v[1], v[0]);
      if (curve.kind === 'circle' || onArc(curve, angle)) {
        return polar(curve.center, curve.radius, angle);
      }
      const { start, end } = arcPoints(curve);
      return dist(p, start) <= dist(p, end) ? start : end;
    }
  }
}

/** Intersections of an infinite line with a curve (bounded to a segment or an arc). */
export function intersectRay(ray: Ray, curve: Curve): Vec2[] {
  if (curve.kind === 'line') {
    const e = sub(curve.b, curve.a);
    const denom = cross(ray.d, e);
    if (Math.abs(denom) < 1e-12 * Math.hypot(...e) * Math.hypot(...ray.d)) return [];
    const w = sub(curve.a, ray.a);
    const u = cross(w, ray.d) / denom;
    return u >= -1e-9 && u <= 1 + 1e-9 ? [lerp(curve.a, curve.b, u)] : [];
  }
  return lineCircle(ray.a, ray.d, curve.center, curve.radius).filter(
    (p) => curve.kind === 'circle' || onArc(curve, angleAt(curve.center, p)),
  );
}

/** Intersections of two curves (tangent contacts count once). */
export function intersectCurves(c1: Curve, c2: Curve): Vec2[] {
  if (c1.kind === 'line' && c2.kind === 'line') {
    const d1 = sub(c1.b, c1.a);
    const d2 = sub(c2.b, c2.a);
    const denom = cross(d1, d2);
    if (Math.abs(denom) < 1e-12 * Math.hypot(...d1) * Math.hypot(...d2)) return [];
    const w = sub(c2.a, c1.a);
    const t = cross(w, d2) / denom;
    const u = cross(w, d1) / denom;
    const eps = 1e-9;
    return t >= -eps && t <= 1 + eps && u >= -eps && u <= 1 + eps ? [lerp(c1.a, c1.b, t)] : [];
  }
  if (c1.kind === 'line')
    return intersectRay({ a: c1.a, d: sub(c1.b, c1.a) }, c2).filter(inLine(c1));
  if (c2.kind === 'line') return intersectCurves(c2, c1);
  return circleCircle(c1.center, c1.radius, c2.center, c2.radius).filter(
    (p) =>
      (c1.kind === 'circle' || onArc(c1, angleAt(c1.center, p))) &&
      (c2.kind === 'circle' || onArc(c2, angleAt(c2.center, p))),
  );
}

const angleAt = (center: Vec2, p: Vec2) => Math.atan2(p[1] - center[1], p[0] - center[0]);

const inLine = (line: { a: Vec2; b: Vec2 }) => (p: Vec2) => {
  const d = sub(line.b, line.a);
  const t = dot(sub(p, line.a), d) / dot(d, d);
  return t >= -1e-9 && t <= 1 + 1e-9;
};

function lineCircle(a: Vec2, d: Vec2, center: Vec2, radius: number): Vec2[] {
  const len = Math.hypot(d[0], d[1]);
  if (len === 0) return [];
  const u: Vec2 = [d[0] / len, d[1] / len];
  const t0 = dot(sub(center, a), u);
  const foot = add(a, scale(u, t0));
  const h2 = radius * radius - dist(foot, center) ** 2;
  if (h2 < -1e-9 * radius * radius) return [];
  if (h2 <= 1e-9 * radius * radius) return [foot];
  const h = Math.sqrt(h2);
  return [add(foot, scale(u, -h)), add(foot, scale(u, h))];
}

function circleCircle(c1: Vec2, r1: number, c2: Vec2, r2: number): Vec2[] {
  const d = dist(c1, c2);
  if (d === 0 || d > r1 + r2 + 1e-9 || d < Math.abs(r1 - r2) - 1e-9) return [];
  const a = (r1 * r1 - r2 * r2 + d * d) / (2 * d);
  const h2 = r1 * r1 - a * a;
  const u = scale(sub(c2, c1), 1 / d);
  const foot = add(c1, scale(u, a));
  if (h2 <= 1e-9 * r1 * r1) return [foot];
  const h = Math.sqrt(h2);
  const n: Vec2 = [-u[1], u[0]];
  return [add(foot, scale(n, h)), add(foot, scale(n, -h))];
}

/** The curves of a sketch as shapes. Curves whose points are missing are left out. */
export function sketchCurves(sketch: SketchData): Curve[] {
  const point = (id: SketchEntityId): Vec2 | undefined => {
    const p = sketch.entities[id];
    return p?.type === 'point' ? [p.x, p.y] : undefined;
  };
  const curves: Curve[] = [];
  for (const [id, e] of Object.entries(sketch.entities)) {
    if (e.type === 'line') {
      const a = point(e.start);
      const b = point(e.end);
      if (a && b) curves.push({ kind: 'line', id, a, b });
    } else if (e.type === 'circle') {
      const center = point(e.center);
      if (center) curves.push({ kind: 'circle', id, center, radius: e.radius });
    } else if (e.type === 'arc') {
      const center = point(e.center);
      const s = point(e.start);
      const t = point(e.end);
      if (!center || !s || !t) continue;
      const from = angleAt(center, s);
      let sweep = normalizeAngle(angleAt(center, t) - from);
      if (sweep <= 1e-12) sweep = TAU;
      curves.push({ kind: 'arc', id, center, radius: dist(center, s), from, sweep });
    }
  }
  return curves;
}
