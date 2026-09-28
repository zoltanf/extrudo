/**
 * Projecting body geometry into a sketch plane (P2-09, FR-SK-12, ADR-0031):
 * straight along the plane's normal, from the exact edge geometry the
 * facade gives (`Kernel.edgeGeometry`). Lines stay lines; circles in a
 * parallel plane stay circles and arcs, tilted ones become ellipses (whole
 * circles) or fit-point splines (arcs); circles seen edge-on become lines;
 * everything else becomes a fit-point spline through its projected samples.
 */
import {
  type ProjectedCurve,
  type SketchFrame,
  type Vec2,
  type Vec3,
  worldToSketch,
} from '@extrudo/core';
import type { EdgeGeometry } from '../kernel';

/** Shorter than this (mm), a projected curve is a point and is left out. */
const TINY = 1e-6;
/** |cos| of the angle between an axis and the plane's normal above this: parallel planes. */
const PARALLEL = 1 - 1e-9;

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const add = (a: Vec3, b: Vec3, s = 1): Vec3 => [a[0] + s * b[0], a[1] + s * b[1], a[2] + s * b[2]];
const unit = (v: Vec3): Vec3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};

/** Rounds away floating noise (1e-9 mm), so the same model reports the same numbers. */
function tidy([x, y]: Vec2): Vec2 {
  const r = (v: number) => Math.round(v * 1e9) / 1e9 + 0;
  return [r(x), r(y)];
}

/** An edge projected into a sketch plane, or `undefined` if it projects to a point. */
export function projectEdge(g: EdgeGeometry, frame: SketchFrame): ProjectedCurve | undefined {
  if (g.type === 'degenerate' || g.points.length < 2) return undefined;
  const to2d = (p: Vec3) => tidy(worldToSketch(frame, p));
  const points = g.points.map(to2d);
  const first = points[0] as Vec2;
  const last = points[points.length - 1] as Vec2;
  if (g.type === 'line') return line(first, last);

  const conic = g.conic;
  if (conic && (g.type === 'circle' || g.type === 'ellipse')) {
    const cos = dot(unit(conic.axis), frame.normal);
    const whole = g.closed && conic.last - conic.first >= 2 * Math.PI - 1e-9;
    const center = to2d(conic.center);
    if (Math.abs(cos) >= PARALLEL) {
      if (g.type === 'circle') {
        if (whole) return { type: 'circle', center, radius: conic.radius };
        // The edge runs counter-clockwise about its axis: the same way in the sketch
        // when the axis points along the normal, the other way when against it.
        return cos > 0
          ? { type: 'arc', center, start: first, end: last }
          : { type: 'arc', center, start: last, end: first };
      }
      if (whole) {
        const minorDirection = cross(unit(conic.axis), unit(conic.xDirection));
        return {
          type: 'ellipse',
          center,
          major: to2d(add(conic.center, unit(conic.xDirection), conic.radius)),
          minor: to2d(add(conic.center, minorDirection, conic.minor ?? conic.radius)),
        };
      }
      return spline(points);
    }
    if (g.type === 'circle' && whole && Math.abs(cos) > 1e-9) {
      // A tilted circle: an ellipse whose major axis lies along the line where the
      // circle's plane meets the sketch plane, at full radius.
      const along = unit(cross(conic.axis, frame.normal));
      const across = unit(cross(conic.axis, along));
      return {
        type: 'ellipse',
        center,
        major: to2d(add(conic.center, along, conic.radius)),
        minor: to2d(add(conic.center, across, conic.radius)),
      };
    }
    if (Math.abs(cos) <= 1e-9) {
      // Seen edge-on, the curve is a segment: add its extreme points, which the
      // samples may miss, and let `spline` find the line.
      points.push(...conicExtremes(conic, frame.normal).map(to2d));
    }
  }
  return spline(points);
}

/**
 * The points of a circle or ellipse edge farthest either way along the line
 * its plane makes with the sketch plane (it is seen edge-on), within the
 * edge's angles.
 */
function conicExtremes(
  conic: NonNullable<Extract<EdgeGeometry, { points: Vec3[] }>['conic']>,
  normal: Vec3,
): Vec3[] {
  const x = unit(conic.xDirection);
  const y = cross(unit(conic.axis), x);
  const along = unit(cross(conic.axis, normal));
  const a = conic.radius;
  const b = conic.minor ?? conic.radius;
  const t = Math.atan2(b * dot(y, along), a * dot(x, along));
  const out: Vec3[] = [];
  for (const theta of [t, t + Math.PI]) {
    let u = conic.first + ((((theta - conic.first) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI));
    if (u > conic.last + 1e-12) continue;
    u = Math.min(u, conic.last);
    out.push(add(add(conic.center, x, a * Math.cos(u)), y, b * Math.sin(u)));
  }
  return out;
}

/** A line, or `undefined` if its ends coincide. */
function line(a: Vec2, b: Vec2): ProjectedCurve | undefined {
  return Math.hypot(b[0] - a[0], b[1] - a[1]) <= TINY ? undefined : { type: 'line', a, b };
}

/**
 * A fit-point spline through the points, or a line where they all lie on
 * one (a curve seen edge-on: from the extreme points), or nothing.
 */
function spline(points: Vec2[]): ProjectedCurve | undefined {
  const a = points[0] as Vec2;
  // The farthest pair along the points' main direction spans a straight projection.
  let far = a;
  for (const p of points) {
    if (Math.hypot(p[0] - a[0], p[1] - a[1]) > Math.hypot(far[0] - a[0], far[1] - a[1])) far = p;
  }
  const length = Math.hypot(far[0] - a[0], far[1] - a[1]);
  let farBack = far;
  for (const p of points) {
    if (
      Math.hypot(p[0] - far[0], p[1] - far[1]) >
      Math.hypot(farBack[0] - far[0], farBack[1] - far[1])
    ) {
      farBack = p;
    }
  }
  const span = Math.hypot(farBack[0] - far[0], farBack[1] - far[1]);
  if (Math.max(length, span) <= TINY) return undefined;
  const [u, v] = [far, farBack];
  const d: Vec2 = [v[0] - u[0], v[1] - u[1]];
  const off = (p: Vec2) => Math.abs((p[0] - u[0]) * d[1] - (p[1] - u[1]) * d[0]) / span;
  if (points.every((p) => off(p) <= TINY)) return line(u, v);
  // Drop repeats (a closed curve's seam point is kept at both ends).
  const kept: Vec2[] = [];
  for (const p of points) {
    const q = kept[kept.length - 1];
    if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) > TINY) kept.push(p);
  }
  return kept.length >= 2 ? { type: 'spline', points: kept } : undefined;
}

/** A straight segment in space (a silhouette line) projected into the plane. */
export function projectSegment(
  [a, b]: readonly [Vec3, Vec3],
  frame: SketchFrame,
): ProjectedCurve | undefined {
  return line(tidy(worldToSketch(frame, a)), tidy(worldToSketch(frame, b)));
}
