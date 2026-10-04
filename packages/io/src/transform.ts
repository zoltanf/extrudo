/**
 * Affine transforms of drawing segments (P4-06, ADR-0066 §1): an SVG reader
 * composes the `transform` of every element down the tree and puts each
 * contour through it. Lines and Béziers transform pole by pole; a circle
 * stays a circle while the linear part keeps circles (a similarity: uniform
 * scale, rotation, reflection), and becomes an elliptical arc otherwise (an
 * unequal scale or a skew), exactly as the ADR says.
 */
import type { Contour, Point, Segment } from './drawing';

/** `[a, b, c, d, e, f]`: `x' = a·x + c·y + e`, `y' = b·x + d·y + f`. */
export type Matrix = [a: number, b: number, c: number, d: number, e: number, f: number];

export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

/** `m` then `n`: the point goes through `n` first. */
export function multiply(m: Matrix, n: Matrix): Matrix {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

export function apply(m: Matrix, [x, y]: Point): Point {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

const isIdentity = (m: Matrix) => m.every((v, i) => v === IDENTITY[i]);

/** Whether the linear part of `m` maps circles to circles (up to scale). */
function keepsCircles(m: Matrix): boolean {
  const [a, b, c, d] = m;
  const u = a * a + b * b;
  const v = c * c + d * d;
  const w = a * c + b * d;
  const big = Math.max(u, v, 1);
  return Math.abs(u - v) <= 1e-12 * big && Math.abs(w) <= 1e-12 * big;
}

/** The sign a transform turns a turn of a curve: 1 keeps it, −1 reverses it. */
const handedness = (m: Matrix) => (m[0] * m[3] - m[1] * m[2] < 0 ? -1 : 1);

/** An ellipse the way a segment spells it: a centre, semi-axes and a rotation. */
export interface EllipseFrame {
  center: Point;
  rx: number;
  ry: number;
  rotation: number;
}

/**
 * The image of the elliptical arc running `sweep` radians (counter-clockwise
 * positive) on `e` under `m`, as a segment: an `arc` while the transform keeps
 * circles, an `ellipse` otherwise.
 */
export function transformArc(m: Matrix, e: EllipseFrame, sweep: number, to: Point): Segment {
  const end = apply(m, to);
  const sign = handedness(m);
  if (keepsCircles(m) && Math.abs(e.rx - e.ry) <= 1e-12 * Math.max(e.rx, e.ry)) {
    return { type: 'arc', center: apply(m, e.center), sweep: sweep * sign, to: end };
  }
  // `imageEllipse` reads the turn's reversal out of A's own determinant, which
  // already accounts for the transform's hand.
  return imageEllipse(m, e, sweep, end);
}

/**
 * The image of an arc of an ellipse under a general affine transform: an
 * ellipse is the unit circle under `A = L·R(rotation)·diag(rx, ry)`, so the
 * image's semi-axes are `A`'s singular values (the eigenvalues of `A·Aᵀ`) and
 * its rotation the first eigenvector's direction. `A`'s determinant says
 * whether the arc's parameter still turns the same way round.
 */
function imageEllipse(m: Matrix, e: EllipseFrame, sweep: number, end: Point): Segment {
  const [a, b, c, d] = m;
  const cos = Math.cos(e.rotation);
  const sin = Math.sin(e.rotation);
  // A = L · R(rotation) · diag(rx, ry)
  const a00 = (a * cos + c * sin) * e.rx;
  const a01 = (-a * sin + c * cos) * e.ry;
  const a10 = (b * cos + d * sin) * e.rx;
  const a11 = (-b * sin + d * cos) * e.ry;
  // S = A · Aᵀ, symmetric: its eigenvectors are the image ellipse's axes.
  const s00 = a00 * a00 + a01 * a01;
  const s01 = a00 * a10 + a01 * a11;
  const s11 = a10 * a10 + a11 * a11;
  const trace = s00 + s11;
  const spread = Math.hypot(s00 - s11, 2 * s01);
  const r1 = Math.sqrt(Math.max(0, (trace + spread) / 2));
  const r2 = Math.sqrt(Math.max(0, (trace - spread) / 2));
  if (r2 <= 1e-12 * Math.max(r1, 1)) {
    // A flat ellipse: nothing of the arc is left but lines.
    return { type: 'line', to: end };
  }
  return {
    type: 'ellipse',
    center: apply(m, e.center),
    rx: r1,
    ry: r2,
    rotation: 0.5 * Math.atan2(2 * s01, s00 - s11),
    sweep: a00 * a11 - a01 * a10 < 0 ? -sweep : sweep,
    to: end,
  };
}

/** A segment put through `m`, with its end exactly where the transform puts it. */
export function transformSegment(m: Matrix, from: Point, segment: Segment): Segment {
  if (isIdentity(m)) return segment;
  switch (segment.type) {
    case 'line':
      return { type: 'line', to: apply(m, segment.to) };
    case 'quadratic':
      return { type: 'quadratic', control: apply(m, segment.control), to: apply(m, segment.to) };
    case 'cubic':
      return {
        type: 'cubic',
        c1: apply(m, segment.c1),
        c2: apply(m, segment.c2),
        to: apply(m, segment.to),
      };
    case 'arc': {
      const r = Math.hypot(from[0] - segment.center[0], from[1] - segment.center[1]);
      return transformArc(
        m,
        { center: segment.center, rx: r, ry: r, rotation: 0 },
        segment.sweep,
        segment.to,
      );
    }
    case 'ellipse':
      return transformArc(m, segment, segment.sweep, segment.to);
  }
}

/** A contour put through `m`. */
export function transformContour(m: Matrix, contour: Contour): Contour {
  if (isIdentity(m)) return contour;
  const segments: Segment[] = [];
  let at = contour.start;
  for (const segment of contour.segments) {
    const moved = transformSegment(m, at, segment);
    segments.push(moved);
    at = moved.to;
  }
  return { start: apply(m, contour.start), segments, closed: contour.closed };
}
