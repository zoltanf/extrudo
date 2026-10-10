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
import type { Segment } from '../segment';
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

/** Where the hole's own members start (`01 01`), by version and property block. */
const HEAD_OFFSETS = [10, 6, 2];

/** The hole drills along its face plane's normal (Fusion's flip). */
export function readHoleFlipped(seg: Segment, scope: Scope): boolean {
  const b = seg.bulk;
  for (const at of HEAD_OFFSETS) {
    const p = scope.start + at;
    if (p + 29 > scope.end || b[p] !== 1 || b[p + 1] !== 1) continue;
    return b[p + 28] === 1;
  }
  return false;
}
