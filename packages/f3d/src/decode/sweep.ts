/**
 * Sweeps (`FCBB1707…`). The sweep's own members open with the result
 * operation (u32, as an extrude's: 1 join, 2 cut, 3 intersect, 4 new body),
 * after the prologue and an empty property block. The profile is a
 * sketch-profile operand in an operand group, as an extrude's; the path is an
 * operand group of geometry operands, each naming a sketch curve
 * (`E2CEFD18…`: u64 0, u64 sketch, u64 curve tag) beside the curve in model
 * space; a body operand names a body it joins or cuts. How much of the path
 * it follows are parameters it owns, as fractions of the path from the
 * profile: `AlongDistance` one way, `AgainstDistance` the other;
 * `TwistAngle` and `TaperAngle` as named. `AlongRailDistance` and
 * `AgainstRailDistance` belong to a guide rail (none seen).
 */
import { F3dFormatError, Reader } from '../bytes';
import type { Segment } from '../segment';
import { EDGE_OPERAND, OPERAND_GROUP } from './edges';
import { type BodyOperation, SKETCH_PROFILE_OPERAND } from './extrude';
import { GEOMETRY_OPERAND, SKETCH_CURVE_REF } from './revolve';
import type { Scope } from './scope';

export const SWEEP = 'FCBB1707-4450-46B3-9E65-0F61682EA8CA';

const OPERATIONS: Record<number, BodyOperation> = {
  1: 'join',
  2: 'cut',
  3: 'intersect',
  4: 'new-body',
};

/** A sketch curve a feature names: its sketch (container record) and curve tag. */
export interface CurveRef {
  sketch: number;
  tag: bigint;
}

/** The operation: a u32 after an empty property block (offset 6), or right after the prologue (2). */
export function readSweepOperation(seg: Segment, scope: Scope): BodyOperation {
  for (const at of [6, 2]) {
    const r = new Reader(seg.bulk, scope.start + at, scope.end);
    if (r.remaining < 4) continue;
    const op = OPERATIONS[r.u32()];
    if (op) return op;
  }
  throw new F3dFormatError(`Sweep #${scope.id}: operation not found.`);
}

/** `E2CEFD18…`: two zero bytes, u64 0, u64 sketch, u64 curve tag. */
export function readCurveRef(seg: Segment, id: number): CurveRef {
  const r = seg.reader(id);
  r.zeros(2);
  r.u64();
  const sketch = r.u64();
  return { sketch, tag: r.u64big() };
}

/**
 * A sweep's paths: per operand group of geometry operands, the sketch curves
 * they name, in order; `edges` when a path names a body edge instead (or the
 * profile is a face: its group is not told apart from an edge path's).
 */
export function readPaths(
  seg: Segment,
  scope: Scope,
  inside: (id: number) => number[],
): { paths: CurveRef[][]; edges: boolean } {
  const paths: CurveRef[][] = [];
  let edges = false;
  for (const group of scope.refs) {
    if (seg.typeOf(group)?.guid !== OPERAND_GROUP) continue;
    const members = inside(group);
    // The profile's group (a sketch profile, or faces) is not a path.
    if (members.some((m) => seg.typeOf(m)?.guid === SKETCH_PROFILE_OPERAND)) continue;
    const curves: CurveRef[] = [];
    let path = false;
    for (const member of members) {
      const t = seg.typeOf(member)?.guid;
      if (t === EDGE_OPERAND) edges = true;
      if (t !== GEOMETRY_OPERAND) continue;
      path = true;
      const ref = inside(member).find((r) => seg.typeOf(r)?.guid === SKETCH_CURVE_REF);
      if (ref !== undefined) curves.push(readCurveRef(seg, ref));
      else edges = true;
    }
    if (path) paths.push(curves);
  }
  return { paths, edges };
}
