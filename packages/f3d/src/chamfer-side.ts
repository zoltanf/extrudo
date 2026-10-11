/**
 * Which of a chamfer edge's two faces takes its first distance. A chamfer
 * with two distances, or a distance and an angle, is not symmetric, and the
 * file says which face is which only through the faces it made: a chamfer
 * face meets each of the edge's two faces along a curve as far from the edge
 * as that face's distance. So, from a point on the edge, the chamfer face is
 * looked for along each face, square to the edge; the face where it lies the
 * first distance away takes that distance (cm, model space).
 */
import type { AsmSurface } from './asm';
import type { Vec3 } from './decode/sketch-geometry';
import { type EdgeShape, lineCuts, surfaceOf } from './edge-shape';
import type { F3dEdge } from './model';

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const norm = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
const unit = (a: Vec3) => scale(a, 1 / norm(a));

/** A surface's normal at a point on it (either way round), when it is a plane or a cone. */
function normalAt(s: AsmSurface, p: Vec3): Vec3 | undefined {
  if (s.kind === 'plane') return s.normal;
  if (s.kind !== 'cone') return undefined;
  const a = unit(s.axis);
  const w = sub(p, s.center);
  const radial = sub(w, scale(a, dot(w, a)));
  if (norm(radial) < 1e-9) return undefined;
  return sub(unit(radial), scale(a, s.slope));
}

/**
 * 0 or 1: the face of `e` (in `e.faces`) that takes `first`, the other
 * taking `second`, as one of the chamfer faces `made` shows; undefined when
 * none does, or they disagree.
 */
export function firstFace(
  e: F3dEdge,
  shape: EdgeShape,
  made: AsmSurface[],
  first: number,
  second: number,
): 0 | 1 | undefined {
  // A point on the edge and its tangent there.
  let p = shape.mid;
  let u: Vec3;
  if (shape.type === 'line') u = unit(shape.dir);
  else if (shape.type === 'circle' && shape.circle) {
    const { center, axis, radius } = shape.circle;
    if (!shape.ends) {
      // A whole circle: `mid` is its centre; any point of the rim will do.
      const helper: Vec3 = Math.abs(axis[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
      p = add(center, scale(unit(cross(axis, helper)), radius));
    }
    u = unit(cross(axis, sub(p, center)));
  } else return undefined;
  // From p, along each face and square to the edge, how far off each chamfer face lies.
  const across = e.faces.map((face) => {
    const s = surfaceOf(face);
    const n = s && normalAt(s, p);
    const d = n && cross(n, u);
    return d && norm(d) > 1e-9 ? unit(d) : undefined;
  });
  const [d0, d1] = across;
  if (!d0 || !d1) return undefined;
  const away = (d: Vec3, s: AsmSurface) => {
    const ts = lineCuts(p, d, s)
      .map(Math.abs)
      .filter((t) => t > 1e-6);
    return ts.length > 0 ? Math.min(...ts) : Number.NaN;
  };
  const tol = 1e-4 + 1e-3 * Math.max(first, second);
  const near = (x: number, y: number) => Math.abs(x - y) < tol;
  const votes = new Set<0 | 1>();
  for (const s of made) {
    const a = away(d0, s);
    const b = away(d1, s);
    if (near(a, first) && near(b, second)) votes.add(0);
    else if (near(b, first) && near(a, second)) votes.add(1);
  }
  return votes.size === 1 ? [...votes][0] : undefined;
}
