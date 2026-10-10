/**
 * Joint frames (P6-05, ADR-0081 §4): what a joint's two picked frames are at
 * the timeline marker. The engine runs `resolveJoint` for every unsuppressed
 * joint after a recompute, in a context at the marker (as a feature appended
 * there would get), so a frame resolves through the same naming service as a
 * feature's reference: exact, related, guessed with a warning, else lost.
 *
 * A revolute's axis and a slider's direction are read from side b's frame;
 * side a's must agree with it as built. Nothing here is cached: it costs a
 * resolve and a geometry query per frame.
 */
import type { BodyId, GeomRef, Joint, JointReport } from '@extrudo/core';
import { lineOf } from '../features/references';
import { add, cross, degrees, dot, length, scale, sub, unit } from '../features/vec';
import { KernelError, type Vec3 } from '../kernel';
import { LostReferenceError } from '../naming/resolve';
import type { EvalContext } from '../recompute/types';

/** Two revolute axes count as one within this distance, mm (ADR-0081 §4). */
export const JOINT_AXIS_DISTANCE = 0.05;
/** Two axes or directions count as parallel within this angle, degrees. */
export const JOINT_AXIS_ANGLE = 0.5;

/** A frame's line, and the body it is on where it is on one. */
export interface JointFrameLine {
  origin: Vec3;
  direction: Vec3;
  body?: BodyId;
}

/**
 * The line of a revolute's or slider's frame: a cylindrical or conical face's
 * axis, a flat face's normal through its centre (a slider), a circular edge's
 * centre and normal, a straight edge's line, an axis or a sketch line.
 */
export function jointFrameLine(
  ctx: EvalContext,
  ref: GeomRef,
  label: string,
  type: 'revolute' | 'slider',
): JointFrameLine {
  if (ref.kind === 'face') {
    const hit = ctx.resolve(ref, { label });
    const surface = ctx.kernel.surfaceGeometry(hit.shape, hit.index);
    if ((surface.type === 'cylinder' || surface.type === 'cone') && surface.origin) {
      if (surface.direction) {
        // The point of the axis level with the face's centre, as Axis Through Cylinder has it.
        const direction = unit(surface.direction);
        const centre = ctx.describe(hit.shape).faces[hit.index]?.centroid ?? surface.origin;
        const along = dot(sub(centre, surface.origin), direction);
        return { origin: add(surface.origin, scale(direction, along)), direction, body: hit.body };
      }
    }
    if (type === 'slider' && surface.type === 'plane' && surface.direction) {
      const centre = ctx.describe(hit.shape).faces[hit.index]?.centroid ?? surface.origin;
      if (centre) return { origin: centre, direction: unit(surface.direction), body: hit.body };
    }
    throw new KernelError(
      type === 'slider'
        ? 'Pick a flat or round face, a straight edge or an axis for the joint.'
        : 'Pick a round face, a straight or circular edge or an axis for the joint.',
    );
  }
  if (ref.kind === 'edge') {
    const hit = ctx.resolve(ref, { label });
    const info = ctx.describe(hit.shape).edges[hit.index];
    if (info?.type === 'circle') {
      const geometry = ctx.kernel.edgeGeometry(hit.shape, hit.index);
      if (geometry.type === 'circle' && geometry.conic) {
        return {
          origin: geometry.conic.center,
          direction: unit(geometry.conic.axis),
          body: hit.body,
        };
      }
    }
    if (info?.type !== 'line') {
      throw new KernelError(
        'Pick a round face, a straight or circular edge or an axis for the joint.',
      );
    }
    return { ...lineOf(ctx, ref, label), body: hit.body };
  }
  return lineOf(ctx, ref, label);
}

/** That a rigid joint's frame exists, and the body it is on. */
function rigidFrame(ctx: EvalContext, ref: GeomRef, label: string): BodyId | undefined {
  if (ref.kind === 'body') {
    if (!ctx.bodies.has(ref.id as BodyId)) {
      throw new LostReferenceError(`Can't find ${label}: its body is gone. Pick it again.`, ref);
    }
    return ref.id as BodyId;
  }
  return ctx.resolve(ref, { label }).body;
}

/**
 * Resolves a joint's two frames and reads its axis or direction (side b's),
 * with a warning where side a's frame disagrees with it as built. A frame the
 * kernel can't find or read is the joint's error (a lost one with `refs`, for
 * Fix References). Guessed frames add their warnings through `ctx.warn`; the
 * engine adds those and their `refs`.
 */
export function resolveJoint(ctx: EvalContext, joint: Joint): JointReport {
  const moving = `${joint.name}'s moving frame`;
  const fixed = `${joint.name}'s fixed frame`;
  try {
    if (joint.type === 'rigid') {
      const a = rigidFrame(ctx, joint.a.ref, moving);
      const b = rigidFrame(ctx, joint.b.ref, fixed);
      return { status: 'ok', ...bodiesOf(a, b) };
    }
    const b = jointFrameLine(ctx, joint.b.ref, fixed, joint.type);
    const a = jointFrameLine(ctx, joint.a.ref, moving, joint.type);
    const axis = { origin: b.origin, direction: b.direction };
    const angle = degrees(Math.acos(Math.min(1, Math.abs(dot(a.direction, b.direction)))));
    const report: JointReport = { status: 'ok', axis, ...bodiesOf(a.body, b.body) };
    const what = joint.type === 'revolute' ? 'axes' : 'directions';
    if (joint.type === 'revolute') {
      const offset = length(cross(sub(a.origin, b.origin), b.direction));
      report.offset = offset;
      if (offset > JOINT_AXIS_DISTANCE) {
        return {
          ...report,
          status: 'warning',
          message: apart(joint.name, what, `${round(offset)} mm`),
        };
      }
    }
    if (angle > JOINT_AXIS_ANGLE) {
      return {
        ...report,
        status: 'warning',
        message: apart(joint.name, what, `${round(angle, 1)}°`),
      };
    }
    return report;
  } catch (error) {
    if (!(error instanceof KernelError)) throw error;
    return {
      status: 'error',
      message: error.message,
      ...(error instanceof LostReferenceError && {
        refs: [{ ref: { kind: error.ref.kind, id: error.ref.id }, state: 'lost' as const }],
      }),
    };
  }
}

const apart = (name: string, what: string, amount: string) =>
  `${name}'s ${what} are ${amount} apart: the parts aren't where the joint was made.`;

function bodiesOf(
  a: BodyId | undefined,
  b: BodyId | undefined,
): Partial<Pick<JointReport, 'bodies'>> {
  if (a === undefined && b === undefined) return {};
  return { bodies: { ...(a !== undefined && { a }), ...(b !== undefined && { b }) } };
}

function round(value: number, digits = 2): string {
  return String(Number(value.toFixed(digits)));
}
