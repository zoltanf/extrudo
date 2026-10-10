/**
 * Revolve features. The revolve's own members open with the result operation
 * (u32: 1 join, 2 cut, 3 intersect, 4 new body) and a u32 that is 2 in every
 * file seen. The profile is a sketch-profile operand, as for an extrude. The
 * axis is a geometry operand (`5A1BF548…`) that names a sketch line
 * (`E2CEFD18…`: u64 0, u64 sketch record, u64 curve tag) or an origin axis
 * (`90055C05…`: u64 record), beside the axis as a line in model space
 * (`50AEE8B4…`: start and displacement, cm). The angles are parameters owned
 * by the feature ("AlongAngle", …).
 */
import { F3dFormatError, Reader } from '../bytes';
import type { Segment } from '../segment';
import type { BodyOperation } from './extrude';
import type { Scope } from './scope';
import type { Vec3 } from './sketch-geometry';

export const GEOMETRY_OPERAND = '5A1BF548-241F-46FD-9FB5-E4B05126EB9D';
export const SKETCH_CURVE_REF = 'E2CEFD18-D755-4E09-8E7F-953A2F6D43F8';
export const MODEL_LINE = '50AEE8B4-9456-4DD7-847D-6F6C909BBB9D';

const OPERATIONS: Record<number, BodyOperation> = {
  1: 'join',
  2: 'cut',
  3: 'intersect',
  4: 'new-body',
};

/**
 * Payload offsets the operation has been seen at: after the prologue and an
 * empty property block, or right after a prologue without one.
 */
const HEAD_OFFSETS = [6, 2];

export function readRevolveOperation(seg: Segment, scope: Scope): BodyOperation {
  for (const at of HEAD_OFFSETS) {
    const r = new Reader(seg.bulk, scope.start + at, scope.end);
    if (r.remaining < 8) continue;
    const op = OPERATIONS[r.u32()];
    const next = r.u32();
    if (op && next >= 1 && next <= 3) return op;
  }
  throw new F3dFormatError(`Revolve #${scope.id}: operation not found.`);
}

/** A revolve axis: a line in model space (cm), and the sketch line it is, if it is one. */
export interface RevolveAxis {
  point: Vec3;
  direction: Vec3;
  /** The sketch record and curve tag of the sketch line it is. */
  sketch?: number;
  tag?: bigint;
}

/** The axis a geometry operand names, from the records it refers to. */
export function readAxis(seg: Segment, refs: number[]): RevolveAxis | undefined {
  let line: { point: Vec3; direction: Vec3 } | undefined;
  let curve: { sketch: number; tag: bigint } | undefined;
  for (const id of refs) {
    const type = seg.typeOf(id)?.guid;
    if (type === MODEL_LINE) {
      const r = seg.reader(id);
      r.zeros(2);
      const point: Vec3 = [r.f64(), r.f64(), r.f64()];
      const direction: Vec3 = [r.f64(), r.f64(), r.f64()];
      if (Math.hypot(...direction) > 1e-12) line ??= { point, direction };
    } else if (type === SKETCH_CURVE_REF) {
      const r = seg.reader(id);
      r.zeros(2);
      r.u64();
      const sketch = r.u64();
      curve ??= { sketch, tag: r.u64big() };
    }
  }
  return line && { ...line, ...curve };
}
