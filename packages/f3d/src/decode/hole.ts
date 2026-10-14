/**
 * Hole features (`1C037A07…`). The sizes are parameters the feature owns
 * ("HoleDiameter", "HoleDepth", "TipAngle", "CSDiameter" and "CSAngle" for a
 * countersink, "CBDiameter" and "CBDepth" for a counterbore). The face it
 * starts on is a placement operand (`F2A7590D…`) whose geometry operand holds
 * the face's plane in model space (`CC54ECAD…`); each hole centre is a
 * geometry operand holding a point in model space (`994C518A…`).
 *
 * The hole's own members open with `01 01` (after the prologue and an empty
 * property block, or right after a prologue without one); 28 bytes on, a
 * byte is 1 where the hole drills along the face plane's normal rather than
 * against it. Seen once in the corpus (the one hole that drills that way),
 * so not certain.
 */
import type { AsmSurface } from '../asm';
import { readPrologue, type Segment } from '../segment';
import type { Scope } from './scope';
import type { Vec3 } from './sketch-geometry';

export const HOLE_PLACEMENT = 'F2A7590D-6654-4674-B393-A2AEF4FEC48A';
export const MODEL_PLANE = 'CC54ECAD-6DE8-4DE1-803D-BBE0E751975B';
export const MODEL_POINT = '994C518A-A831-400A-B7C7-16DAC55F4F1C';

/** A plane in model space, cm: its origin and two unit directions in it. */
export interface ModelPlane {
  origin: Vec3;
  x: Vec3;
  y: Vec3;
}

/** `CC54ECAD…`: three bytes, then origin, x and y directions (9 f64). */
export function readModelPlane(seg: Segment, id: number): ModelPlane {
  const r = seg.reader(id);
  r.skip(3);
  const v = (): Vec3 => [r.f64(), r.f64(), r.f64()];
  return { origin: v(), x: v(), y: v() };
}

/**
 * `994C518A…`: the two-byte prologue and a point (3 f64); then a byte and,
 * in the long form, the sketch-to-model matrix of the sketch it is in.
 */
export function readModelPoint(seg: Segment, id: number): Vec3 {
  const r = seg.reader(id);
  r.skip(2);
  return [r.f64(), r.f64(), r.f64()];
}

/**
 * `F2A7590D…` as a hole's placement: the prologue, u32 8, then a point and the start face's
 * unit normal (3 f64 each). The point is zero where a model plane (`CC54ECAD…`) gives the
 * face; where the face is a body face (an edge recipe naming it), it is the hole's place on
 * that face. Undefined unless the values read as such.
 */
export function readHolePlacement(
  seg: Segment,
  id: number,
): { point: Vec3; normal: Vec3 } | undefined {
  const r = seg.reader(id);
  if (readPrologue(r).leading || r.remaining < 52 || r.u32() !== 8) return undefined;
  const v = (): Vec3 => [r.f64(), r.f64(), r.f64()];
  const point = v();
  const normal = v();
  if (![...point, ...normal].every(Number.isFinite)) return undefined;
  if (Math.abs(Math.hypot(...normal) - 1) > 1e-6) return undefined;
  return { point, normal };
}

/** A plane through a point with the given unit normal, its directions picked so x × y is it. */
export function planeThrough(point: Vec3, normal: Vec3): ModelPlane {
  const [a, b, c] = normal;
  // A direction in the plane: across the axis the normal leans on least.
  const raw: Vec3 = Math.abs(c) < 0.9 ? [-b, a, 0] : [0, -c, b];
  const len = Math.hypot(...raw);
  const x: Vec3 = [raw[0] / len, raw[1] / len, raw[2] / len];
  const y: Vec3 = [b * x[2] - c * x[1], c * x[0] - a * x[2], a * x[1] - b * x[0]];
  return { origin: point, x, y };
}

/** Where the hole's own members start (`01 01`), by version and property block. */
const HEAD_OFFSETS = [10, 6, 2];

/** The hole drills along its face plane's normal (the file's flip). */
export function readHoleFlipped(seg: Segment, scope: Scope): boolean {
  const b = seg.bulk;
  for (const at of HEAD_OFFSETS) {
    const p = scope.start + at;
    if (p + 29 > scope.end || b[p] !== 1 || b[p + 1] !== 1) continue;
    return b[p + 28] === 1;
  }
  return false;
}

/** The most holes `centresFromCylinders` returns (a file's faces are untrusted). */
export const MAX_FOUND_CENTRES = 256;

/**
 * Hole centres read off the cylinders the hole made, for a hole the file places by its
 * distances to edges rather than at points (no centre is stored then): every cylinder of the
 * hole's radius (cm) whose axis is square to the start face's plane gives the point where
 * that axis meets the plane. Faces split at a seam or kept from earlier states give the same
 * point once. At most `MAX_FOUND_CENTRES`.
 */
export function centresFromCylinders(
  surfaces: readonly AsmSurface[],
  plane: ModelPlane,
  radius: number,
): Vec3[] {
  const { origin: O, x: X, y: Y } = plane;
  const n: Vec3 = [X[1] * Y[2] - X[2] * Y[1], X[2] * Y[0] - X[0] * Y[2], X[0] * Y[1] - X[1] * Y[0]];
  const len = Math.hypot(...n);
  if (!(len > 1e-9) || !(radius > 0)) return [];
  const N = n.map((v) => v / len) as Vec3;
  const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const out: Vec3[] = [];
  for (const s of surfaces) {
    if (out.length >= MAX_FOUND_CENTRES) break;
    if (s.kind !== 'cone' || !s.cylinder || Math.abs(s.radius - radius) > 1e-6) continue;
    const a = Math.hypot(...s.axis);
    if (!(a > 1e-9)) continue;
    const along = dot(s.axis, N) / a;
    if (Math.abs(Math.abs(along) - 1) > 1e-6) continue;
    // The axis point in the plane: the centre moved along N onto it.
    const h = dot([s.center[0] - O[0], s.center[1] - O[1], s.center[2] - O[2]], N);
    const c: Vec3 = [s.center[0] - h * N[0], s.center[1] - h * N[1], s.center[2] - h * N[2]];
    if (!out.some((p) => Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2]) < 1e-6)) out.push(c);
  }
  return out;
}
