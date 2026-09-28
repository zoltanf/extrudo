import {
  type FeatureId,
  type GeomRef,
  originAxis,
  parseSketchEntityRefId,
  type RevolveInputs,
  type RevolveSettings,
  revolveFeature,
  revolveSettings,
  sketchToWorld,
} from '@extrudo/core';
import { type Axis, KernelError, type ShapeHandle, type ShapeScope, type Vec3 } from '../kernel';
import { type NamedShape, namedRevolve, type SweepSource } from '../naming/ops';
import type { EvalContext, FeatureOutput, KernelFeatureDefinition } from '../recompute/types';
import { splitSolids } from './bodies';
import { explicitBodies, type OperationWords, operate } from './operation';
import type { SketchOutputData } from './sketch';
import { type Base, centroidOf, PARALLEL_EPS, type Plane, partsOf, uniteParts } from './sources';
import { add, dot, length, scale, sub, unit } from './vec';

/**
 * The `data` of a revolve's output: where it sits, for later features and
 * the tests (the dialog's arcs are placed on the UI thread, like extrude's
 * arrows).
 */
export interface RevolveOutputData {
  /** Area centroid of the revolved profiles and faces, in their plane (mm). */
  origin: Vec3;
  /**
   * The axis: a point on it and its unit direction, reversed by `flip`.
   * Side 1 turns right-handed about it (counter-clockwise seen from its
   * tip), side 2 the other way.
   */
  axis: Axis;
  /** How far each side turns, in degrees: side 1 about `axis`, side 2 against it. */
  angles: [number, number];
  /** A whole turn: no end faces. */
  full: boolean;
}

/** Angles (degrees) at or below which a revolve has none. */
const ANGLE_EPS = 1e-6;
/** A share of a profile's area this small on the far side of the axis is rounding. */
const AREA_EPS = 1e-7;

/** How a revolve speaks of itself (the shared operation code, `operation.ts`). */
const WORDS: OperationWords = { noun: 'revolve', check: 'Check its axis and angle.' };

/**
 * The revolve feature in the kernel (P2-07, ADR-0029): turns profiles and
 * flat faces (unioned when there are several) about an axis in their
 * plane, one side, symmetric or two sides, by an angle or a whole turn,
 * then makes new bodies or joins, cuts or intersects like extrude. Every
 * face is named (ADR-0005): `revolve:<id>:cap:start` where the turn starts
 * (the profile's own place for one side), `cap:end` where it ends (a whole
 * turn has neither), and `side:<sketch curve>` or `side:(<body edge>)`.
 */
export const kernelRevolve: KernelFeatureDefinition<RevolveInputs> = {
  ...revolveFeature,
  bodyAccess: () => 'write',
  evaluate: evaluateRevolve,
};

function evaluateRevolve(ctx: EvalContext<RevolveInputs>): FeatureOutput {
  const settings = revolveSettings(ctx.inputs);
  if (settings.profiles.length === 0) {
    throw new KernelError('Pick at least one profile or face to revolve.');
  }
  if (!settings.axis) throw new KernelError('Pick an axis to revolve about.');
  using scope = ctx.kernel.scope();
  const parts = partsOf(ctx, scope, settings.profiles, WORDS.noun);
  const base = uniteParts(ctx, scope, parts);
  const axis = axisOf(ctx, settings.axis);
  if (!inPlane(axis, base.plane)) {
    throw new KernelError(
      "The axis doesn't lie in the profile's plane. Pick an axis in that plane.",
    );
  }
  oneSide(ctx, scope, parts, axis, base.plane);
  const turnAxis: Axis = settings.flip
    ? { origin: axis.origin, direction: scale(axis.direction, -1) }
    : axis;
  const turn = anglesOf(ctx, settings);
  const tool = sweep(ctx, scope, base.source, turnAxis, turn);
  const data: RevolveOutputData = {
    origin: centroidOf(ctx, base.source.shape),
    axis: turnAxis,
    angles: turn.angles,
    full: turn.full,
  };
  const participants = explicitBodies(ctx, settings, WORDS);
  const warnings: string[] = [];
  const result = splitSolids(
    ctx,
    scope,
    operate(ctx, scope, settings, tool, participants, warnings, WORDS),
  );
  return { ...result, data, ...(warnings.length ? { warnings } : {}) };
}

// ------------------------------------------------------------------ the axis

/** The axis a reference names, in world mm: a point on it and its unit direction. */
function axisOf(ctx: EvalContext<RevolveInputs>, ref: GeomRef): Axis {
  switch (ref.kind) {
    case 'axis': {
      const found = originAxis(ref.id);
      if (!found) throw new KernelError("Can't find the axis to revolve about. Pick it again.");
      return { origin: found.origin, direction: found.direction };
    }
    case 'sketchEntity':
      return sketchLineAxis(ctx, ref);
    case 'edge': {
      const hit = ctx.resolve(ref, { label: 'the edge to revolve about' });
      const edge = ctx.describe(hit.shape).edges[hit.index];
      if (hit.kind !== 'edge' || edge?.type !== 'line' || !edge.direction) {
        throw new KernelError(
          'Can only revolve about a straight edge. Pick a straight edge, a sketch line or an origin axis.',
        );
      }
      return { origin: edge.midpoint, direction: unit(edge.direction) };
    }
    default:
      throw new KernelError(
        'Pick a sketch line, a straight edge or an origin axis to revolve about.',
      );
  }
}

/**
 * A sketch line as an axis, placed by the sketch's own output frame (so a
 * sketch on a face works as well as one on an origin plane), from its start
 * to its end.
 */
function sketchLineAxis(ctx: EvalContext<RevolveInputs>, ref: GeomRef): Axis {
  const parsed = parseSketchEntityRefId(ref.id);
  if (!parsed) throw new KernelError("The axis isn't a sketch line. Pick it again.");
  const data = ctx.output(parsed.feature as FeatureId).data as
    | Partial<SketchOutputData>
    | undefined;
  const line = data?.lines?.[parsed.entity];
  if (!data?.frame || !line) {
    throw new KernelError(
      "Can't find the axis line any more: an earlier change to its sketch removed it. Edit the revolve and pick another axis.",
    );
  }
  const a = sketchToWorld(data.frame, line[0]);
  const b = sketchToWorld(data.frame, line[1]);
  const along = sub(b, a);
  if (length(along) <= 1e-9)
    throw new KernelError('The axis line has no length. Pick another axis.');
  return { origin: a, direction: unit(along) };
}

/** Whether the axis lies in the plane (within 1e-6 mm, like coplanar profiles). */
function inPlane(axis: Axis, plane: Plane): boolean {
  const scaleOf = Math.max(1, length(axis.origin), length(plane.point));
  return (
    Math.abs(dot(axis.direction, plane.normal)) <= PARALLEL_EPS * 1e3 &&
    Math.abs(dot(sub(axis.origin, plane.point), plane.normal)) <= 1e-6 * scaleOf
  );
}

/**
 * Every profile must lie on one side of the axis, touching it at most: a
 * profile across the axis would sweep through itself. Each part's area on
 * the axis's positive side is its overlap with a half-plane face there.
 */
function oneSide(
  ctx: EvalContext<RevolveInputs>,
  scope: ShapeScope,
  parts: Base[],
  axis: Axis,
  plane: Plane,
): void {
  const { kernel } = ctx;
  const half = halfPlane(ctx, scope, parts, axis, plane);
  const sides = new Set<number>();
  for (const part of parts) {
    const area = kernel.measure(part.source.shape).area;
    const overlap = scope.track(kernel.boolean('common', part.source.shape, half));
    const positive = kernel.measure(overlap.shape).area;
    const eps = AREA_EPS * area + 1e-9;
    const onPositive = positive > eps;
    const onNegative = area - positive > eps;
    if (onPositive && onNegative) {
      throw new KernelError(
        'The profile crosses the axis. Pick an axis beside the profile, not through it.',
      );
    }
    sides.add(onPositive ? 1 : -1);
  }
  if (sides.size > 1) {
    throw new KernelError(
      'The profiles lie on both sides of the axis. Pick profiles on one side of it.',
    );
  }
}

/** A face covering the plane on the positive side of the axis (plane normal × axis), well past every part. */
function halfPlane(
  ctx: EvalContext<RevolveInputs>,
  scope: ShapeScope,
  parts: Base[],
  axis: Axis,
  plane: Plane,
): ShapeHandle {
  const { kernel } = ctx;
  let reach = 0;
  for (const part of parts) {
    const { min, max } = kernel.measure(part.source.shape).bbox;
    const center = scale(add(min, max), 0.5);
    reach = Math.max(reach, length(sub(max, min)) + length(sub(center, axis.origin)));
  }
  const s = 2 * reach + 10;
  const { faces } = kernel.planarFaces(
    [
      { kind: 'line', a: [-s, 0], b: [s, 0] },
      { kind: 'line', a: [s, 0], b: [s, s] },
      { kind: 'line', a: [s, s], b: [-s, s] },
      { kind: 'line', a: [-s, s], b: [-s, 0] },
    ],
    { origin: axis.origin, x: axis.direction, normal: plane.normal },
    1e-7,
  );
  for (const face of faces) scope.track(face.shape);
  const face = faces[0];
  if (!face) throw new KernelError("Couldn't check which side of the axis the profile is on.");
  return face.shape;
}

// ------------------------------------------------------------------ angles

interface Turn {
  /** Where the sweep starts, radians about the axis from the profile (negative: back). */
  start: number;
  /** How far it turns from there, radians (negative: the other way). */
  sweep: number;
  /** Side 1 about the axis and side 2 against it, degrees (for `RevolveOutputData`). */
  angles: [number, number];
  full: boolean;
}

function anglesOf(ctx: EvalContext<RevolveInputs>, settings: RevolveSettings): Turn {
  const one = settings.angle ? ctx.value(settings.angle) : 360;
  const check = (value: number, which: string) => {
    if (Math.abs(value) > 360 + ANGLE_EPS) {
      throw new KernelError(`${which} must be between -360° and 360°.`);
    }
  };
  check(one, 'The angle');
  const turn = (start: number, sweep: number, angles: [number, number]): Turn => {
    const full = Math.abs(sweep) >= 360 - ANGLE_EPS;
    return { start: radians(start), sweep: radians(sweep), angles, full };
  };
  switch (settings.direction) {
    case 'one-side':
      if (Math.abs(one) <= ANGLE_EPS) {
        throw new KernelError('The angle is 0. Enter an angle other than 0.');
      }
      return turn(0, one, [one, 0]);
    case 'symmetric': {
      const whole = Math.abs(one);
      if (whole <= ANGLE_EPS) throw new KernelError('The angle is 0. Enter an angle other than 0.');
      return turn(-whole / 2, whole, [whole / 2, whole / 2]);
    }
    case 'two-sides': {
      const two = settings.angle2 ? ctx.value(settings.angle2) : 0;
      check(two, 'The angle of side 2');
      const total = one + two;
      if (total <= ANGLE_EPS) {
        throw new KernelError(
          'The two sides cancel each other out, so the revolve has no angle. Change an angle.',
        );
      }
      if (total > 360 + ANGLE_EPS) {
        throw new KernelError(
          'The two sides add up to more than a full turn. Make the angles smaller.',
        );
      }
      return turn(-two, total, [one, two]);
    }
  }
}

const radians = (degrees: number) => (degrees * Math.PI) / 180;

// ------------------------------------------------------------------ the sweep

/**
 * The revolved tool, named. A sweep that doesn't start at the profile
 * (symmetric, two sides) turns the profile to its start first (the end face
 * of a revolve by `start`, whose edges keep their sources through the
 * history), so the result is one sweep with one face per side and its caps
 * where it starts and ends. A whole turn starts at the profile: it has no
 * caps, and where its seam lies doesn't change a name.
 */
function sweep(
  ctx: EvalContext<RevolveInputs>,
  scope: ShapeScope,
  source: SweepSource,
  axis: Axis,
  turn: Turn,
): NamedShape {
  const { kernel, feature } = ctx;
  const startsAway = !turn.full && Math.abs(turn.start) > radians(ANGLE_EPS);
  const from = startsAway ? turned(ctx, scope, source, axis, turn.start) : source;
  const tool = namedRevolve(kernel, {
    feature: feature.id,
    ...from,
    axis,
    angle: turn.full ? 2 * Math.PI : turn.sweep,
  });
  scope.track(tool.shape);
  return tool;
}

/** The source turned about the axis by `angle` radians, with each edge's source carried along. */
function turned(
  ctx: EvalContext<RevolveInputs>,
  scope: ShapeScope,
  source: SweepSource,
  axis: Axis,
  angle: number,
): SweepSource {
  const { kernel } = ctx;
  const swept = scope.track(kernel.revolve(source.shape, axis, angle));
  const ends: number[] = [];
  // Each edge of the sweep that is the end copy of a source edge.
  const edgeOrigin = new Map<number, number>();
  for (const record of swept.history) {
    if (record.relation !== 'last' || record.input !== 0) continue;
    for (const to of record.to) {
      if (record.from.kind === 'face' && to.kind === 'face') ends.push(to.index);
      if (record.from.kind === 'edge' && to.kind === 'edge') {
        edgeOrigin.set(to.index, record.from.index);
      }
    }
  }
  if (ends.length === 0) throw new KernelError("Couldn't turn the profile to where it starts.");
  const faces = ends.map((index) => scope.track(kernel.subShape(swept.shape, 'face', index)));
  const shape =
    faces.length === 1 ? (faces[0] as ShapeHandle) : scope.track(kernel.compound(faces));
  const edgeSources = kernel
    .locate(shape, swept.shape, 'edge')
    .map((at) => source.edgeSources[edgeOrigin.get(at) ?? -1] ?? null);
  return { shape, edgeSources };
}
