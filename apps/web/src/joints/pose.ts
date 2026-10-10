/**
 * Posing a joint (P6-05 J2, ADR-0081 §4): pure. The pose is view state, so these only turn a
 * joint's resolved axis and a value into the matrix the view draws the moving bodies through.
 */
import {
  type BodyId,
  type ComponentId,
  type ExtrudoDocument,
  type Joint,
  type JointReport,
  movingComponents,
  type Vec3,
} from '@extrudo/core';
import { IDENTITY, type Matrix12, rotation, translation } from '@extrudo/kernel/matrix';

/** The live bodies of each component (`componentMembers(...).components`). */
export type ComponentMembers = readonly { id: ComponentId; bodies: readonly BodyId[] }[];

const scale = (v: Vec3, k: number): Vec3 => [v[0] * k, v[1] * k, v[2] * k];

/**
 * The matrix that poses the moving side: a turn of `value` degrees about the report's axis
 * (right-handed, `flip` reverses) or a move of `value` mm along it; the identity at 0, for a
 * rigid joint and where the kernel gave no axis.
 */
export function poseMatrix(report: JointReport, joint: Joint, value: number): Matrix12 {
  const axis = report.axis;
  if (!axis || joint.type === 'rigid' || value === 0 || !Number.isFinite(value)) return IDENTITY;
  const signed = joint.flip ? -value : value;
  if (joint.type === 'revolute') {
    return rotation(axis.origin, axis.direction, (signed * Math.PI) / 180);
  }
  const length = Math.hypot(...axis.direction);
  return translation(scale(axis.direction, signed / (length || 1)));
}

/**
 * `value` held to the joint's range. A revolute without limits is a whole turn: the value wraps
 * to (−180, 180]. A slider without limits has no range to hold it to.
 */
export function clampPose(
  joint: Joint,
  range: { min: number; max: number } | undefined,
  value: number,
): number {
  if (!Number.isFinite(value)) return 0;
  if (range)
    return Math.min(
      Math.max(value, Math.min(range.min, range.max)),
      Math.max(range.min, range.max),
    );
  if (joint.type !== 'revolute') return value;
  const wrapped = ((((value + 180) % 360) + 360) % 360) - 180;
  return wrapped === -180 ? 180 : wrapped;
}

/** The live bodies that move with the joint: the members of `movingComponents`. */
export function posedBodies(
  doc: Pick<ExtrudoDocument, 'joints'>,
  joint: Joint,
  members: ComponentMembers,
): BodyId[] {
  const moving = new Set(movingComponents(doc, joint));
  return members.filter((m) => moving.has(m.id)).flatMap((m) => [...m.bodies]);
}
