import {
  type BodyId,
  type ExtrudeInputs,
  type ExtrudeSettings,
  type ExtrudeSide,
  extrudeFeature,
  extrudeSettings,
  type GeomRef,
  originPlane,
} from '@extrudo/core';
import { KernelError, type ShapeHandle, type ShapeScope, type Vec3 } from '../kernel';
import { type NamedShape, namedBoolean, namedPrism, type SweepSource } from '../naming/ops';
import type { EvalContext, FeatureOutput, KernelFeatureDefinition } from '../recompute/types';
import { splitSolids } from './bodies';
import { explicitBodies, type OperationWords, operate } from './operation';
import { planeOf } from './references';
import { type Base, baseOf, centroidOf, PARALLEL_EPS, type Plane } from './sources';
import { add, corners, degrees, dot, length, perpendicular, scale, sub } from './vec';

/**
 * The `data` of an extrude's output: where it sits, for the dialog's
 * manipulators (the distance arrows and taper arcs) and later features.
 */
export interface ExtrudeOutputData {
  /** Area centroid of the extruded profiles and faces, in their plane (mm). */
  origin: Vec3;
  /** Unit direction of side 1: the profile plane's normal, reversed by `flip`. */
  direction: Vec3;
  /**
   * How far the extrude reaches from the plane along the line through
   * `origin`: side 1 along `direction`, side 2 against it (0 for one side),
   * in mm. Negative is behind the plane (a negative distance).
   */
  extents: [number, number];
  /** Taper of each side in degrees (symmetric: the same on both). */
  tapers: [number, number];
}

/** Lengths (mm) at or below which an extrude has none. */
const LENGTH_EPS = 1e-6;

/** How an extrude speaks of itself (the shared operation code, `operation.ts`). */
const WORDS: OperationWords = { noun: 'extrude', check: 'Check its direction and distance.' };

/** One side of the extrude, resolved to numbers. */
interface Side {
  /** Unit direction it grows in. */
  along: Vec3;
  /** Signed sweep length along `along` (past `trim` when there is one). */
  length: number;
  /** Radians; positive widens along `along`. */
  taper: number;
  /** An inclined plane the side ends on; its normal points away from the profile. */
  trim?: Plane;
  /** Where it ends on the line through the profile's centroid (for `ExtrudeOutputData`). */
  reach: number;
}

/**
 * The extrude feature in the kernel (P2-06, ADR-0028): sweeps profiles and
 * flat faces (unioned when there are several) along their plane's normal,
 * tapers the sides, ends each side at a distance, an object or past every
 * body, then makes new bodies or joins, cuts or intersects. Every face is
 * named (ADR-0005): `extrude:<id>:cap:start` on the start plane (the far end
 * of side 2 for two-sided extrudes), `cap:end`, `side:<sketch curve>` or
 * `side:(<body edge>)`, and `side2:<…>` for side 2 of a tapered two-sided
 * extrude.
 */
export const kernelExtrude: KernelFeatureDefinition<ExtrudeInputs> = {
  ...extrudeFeature,
  bodyAccess: () => 'write',
  evaluate: evaluateExtrude,
};

function evaluateExtrude(ctx: EvalContext<ExtrudeInputs>): FeatureOutput {
  const { kernel } = ctx;
  const settings = extrudeSettings(ctx.inputs);
  if (settings.profiles.length === 0) {
    throw new KernelError('Pick at least one profile or face to extrude.');
  }
  using scope = kernel.scope();
  const base = baseOf(ctx, scope, settings.profiles, WORDS.noun);
  const n = settings.flip ? scale(base.plane.normal, -1) : base.plane.normal;
  const origin = centroidOf(ctx, base.source.shape);
  const participants = explicitBodies(ctx, settings, WORDS);
  const sides = resolveSides(ctx, settings, base, n, origin, participants);
  const tool = sweep(ctx, scope, base.source, n, sides, settings.direction);
  const data: ExtrudeOutputData = {
    origin,
    direction: n,
    // Side 1 measured along n, side 2 against it (one side may have turned round).
    extents: [reachOf(sides[0], n), reachOf(sides[1], scale(n, -1))],
    tapers: [degrees(sides[0]?.taper ?? 0), degrees(sides[1]?.taper ?? 0)],
  };
  const warnings: string[] = [];
  const result = splitSolids(
    ctx,
    scope,
    operate(ctx, scope, settings, tool, participants, warnings, WORDS),
  );
  return { ...result, data, ...(warnings.length ? { warnings } : {}) };
}

const reachOf = (side: Side | undefined, along: Vec3) =>
  side ? side.reach * Math.sign(dot(side.along, along)) : 0;

// ------------------------------------------------------------------ extents

function resolveSides(
  ctx: EvalContext<ExtrudeInputs>,
  settings: ExtrudeSettings,
  base: Base,
  n: Vec3,
  origin: Vec3,
  participants: BodyId[] | undefined,
): Side[] {
  const [first, second] = settings.sides as [ExtrudeSide, ExtrudeSide?];
  const through = (along: Vec3) => throughAll(ctx, base, along, participants);
  switch (settings.direction) {
    case 'one-side':
      return [resolveSide(ctx, first, base, n, origin, through, true)];
    case 'symmetric': {
      const taper = taperOf(ctx, first);
      let half: number;
      if (first.extent === 'to-object') {
        throw new KernelError("A symmetric extrude can't end at an object. Use two sides instead.");
      } else if (first.extent === 'through-all') {
        half = Math.max(through(n), through(scale(n, -1)));
        if (half <= LENGTH_EPS) throw nothingToGoThrough();
      } else {
        half = Math.abs(distanceOf(ctx, first)) / 2;
      }
      return [
        { along: n, length: half, taper, reach: half },
        { along: scale(n, -1), length: half, taper, reach: half },
      ];
    }
    case 'two-sides': {
      if (!second) throw new Error('two-sides without side 2');
      const one = resolveSide(ctx, first, base, n, origin, through, false);
      const two = resolveSide(ctx, second, base, scale(n, -1), origin, through, false);
      if (!one.trim && !two.trim && one.length + two.length <= LENGTH_EPS) {
        throw new KernelError(
          'The two sides cancel each other out, so the extrude has no length. Change a distance.',
        );
      }
      return [one, two];
    }
  }
}

/**
 * One side's length along `along` (side 1: the normal; side 2: against it).
 * With `mayFlip` (one side), an object behind the profile turns the side round.
 */
function resolveSide(
  ctx: EvalContext<ExtrudeInputs>,
  side: ExtrudeSide,
  base: Base,
  along: Vec3,
  origin: Vec3,
  through: (along: Vec3) => number,
  mayFlip: boolean,
): Side {
  const taper = taperOf(ctx, side);
  switch (side.extent) {
    case 'distance': {
      const length = distanceOf(ctx, side);
      return { along, length, taper, reach: length };
    }
    case 'through-all': {
      const length = through(along);
      if (length <= LENGTH_EPS) throw nothingToGoThrough();
      return { along, length, taper, reach: length };
    }
    case 'to-object': {
      if (!side.toObject) throw new KernelError('Pick an object to extrude to.');
      const target = objectPlane(ctx, side.toObject, along);
      const facing = dot(target.normal, along);
      if (Math.abs(facing) < PARALLEL_EPS) {
        throw new KernelError(
          'The extrude runs alongside that object and never reaches it. Pick another object.',
        );
      }
      if (Math.abs(Math.abs(facing) - 1) <= PARALLEL_EPS * 1e3) {
        // Parallel to the profile: an exact distance.
        const length = dot(sub(target.point, base.plane.point), along);
        if (Math.abs(length) <= LENGTH_EPS) {
          throw new KernelError(
            "That object lies in the profile's plane, so there is nothing to extrude. Pick another object.",
          );
        }
        return { along, length, taper, reach: length };
      }
      return inclinedSide(ctx, base, along, origin, target, taper, mayFlip);
    }
  }
}

/**
 * A side ending on a plane at an angle to the profile: swept far enough to
 * pass the plane everywhere, then trimmed there (`trim`).
 */
function inclinedSide(
  ctx: EvalContext<ExtrudeInputs>,
  base: Base,
  along: Vec3,
  origin: Vec3,
  target: Plane,
  taper: number,
  mayFlip: boolean,
): Side {
  let u = along;
  // How far along u each corner of the profile's box meets the plane.
  const reachAt = (p: Vec3, dir: Vec3) =>
    dot(sub(target.point, p), target.normal) / dot(dir, target.normal);
  const { bbox } = ctx.kernel.measure(base.source.shape);
  let ts = corners(bbox.min, bbox.max).map((p) => reachAt(p, u));
  if (mayFlip && ts.every((t) => t < -LENGTH_EPS)) {
    u = scale(u, -1);
    ts = ts.map((t) => -t);
  }
  if (!ts.every((t) => t > LENGTH_EPS)) {
    throw new KernelError(
      ts.some((t) => t > LENGTH_EPS)
        ? 'That object cuts through the profile. Pick one that lies beyond it.'
        : 'That object lies behind the profile on this side. Pick one in front of it, or use one side.',
    );
  }
  const far = Math.max(...ts);
  // A widening taper pushes the outline outwards as it goes; on an inclined
  // plane that moves where it meets the plane by up to tan(taper) × slope.
  const cos = Math.abs(dot(u, target.normal));
  const slope = Math.sqrt(Math.max(0, 1 - cos * cos)) / cos;
  const grow = taper > 0 ? Math.tan(taper) * slope : 0;
  if (grow >= 0.95) {
    throw new KernelError(
      'With this taper the sides never reach that object. Use a smaller taper or another object.',
    );
  }
  const length = far / (1 - grow) + Math.max(1, 0.05 * far);
  const normal = dot(target.normal, u) > 0 ? target.normal : scale(target.normal, -1);
  return {
    along: u,
    length,
    taper,
    trim: { point: target.point, normal },
    reach: reachAt(origin, u),
  };
}

/** The plane an extrude goes up to: a flat face's, an origin plane, or one through a vertex square to the extrude. */
function objectPlane(ctx: EvalContext<ExtrudeInputs>, ref: GeomRef, along: Vec3): Plane {
  if (ref.kind === 'plane') {
    const frame = originPlane(ref.id)?.frame ?? planeOf(ctx, ref, 'the plane to extrude to').frame;
    return { point: frame.origin, normal: frame.normal };
  }
  const label = ref.kind === 'vertex' ? 'the vertex to extrude to' : 'the face to extrude to';
  const hit = ctx.resolve(ref, { label });
  const description = ctx.describe(hit.shape);
  if (hit.kind === 'vertex') {
    const vertex = description.vertices[hit.index];
    if (!vertex) throw new KernelError("Can't find the vertex to extrude to. Pick it again.");
    return { point: vertex.point, normal: along };
  }
  const face = description.faces[hit.index];
  if (hit.kind !== 'face' || !face || face.type !== 'plane' || !face.direction) {
    throw new KernelError(
      'Can only extrude up to a flat face, a vertex or a plane. Pick another object.',
    );
  }
  return { point: face.centroid, normal: face.direction };
}

/** How far past the profile's plane the bodies reach along `along` (0 if none do), plus a margin. */
function throughAll(
  ctx: EvalContext<ExtrudeInputs>,
  base: Base,
  along: Vec3,
  participants: BodyId[] | undefined,
): number {
  const shapes = participants
    ? participants.map((id) => ctx.bodies.get(id) as ShapeHandle)
    : [...ctx.bodies.values()];
  if (shapes.length === 0) {
    throw new KernelError('There are no bodies to go through. Enter a distance instead.');
  }
  let far = 0;
  for (const shape of shapes) {
    const { bbox } = ctx.kernel.measure(shape);
    for (const c of corners(bbox.min, bbox.max)) {
      far = Math.max(far, dot(sub(c, base.plane.point), along));
    }
  }
  return far <= LENGTH_EPS ? 0 : far + Math.max(1, 0.05 * far);
}

const nothingToGoThrough = () =>
  new KernelError(
    "There's nothing to go through in this direction. Flip the direction, or pick another extent.",
  );

function distanceOf(ctx: EvalContext<ExtrudeInputs>, side: ExtrudeSide): number {
  if (!side.distance) throw new KernelError('Enter a distance.');
  const value = ctx.value(side.distance);
  if (Math.abs(value) <= LENGTH_EPS) {
    throw new KernelError('The distance is 0. Enter a distance other than 0.');
  }
  return value;
}

/** A side's taper in radians. */
function taperOf(ctx: EvalContext<ExtrudeInputs>, side: ExtrudeSide): number {
  const value = side.taper ? ctx.value(side.taper) : 0;
  if (Math.abs(value) >= 90) {
    throw new KernelError('The taper angle must be between -90° and 90°.');
  }
  return (value * Math.PI) / 180;
}

// ------------------------------------------------------------------ the sweep

/**
 * The swept tool, named. Without a taper it is one prism from the start
 * of side 2 to the end of side 1 (ADR-0005 §6). A taper widens or narrows
 * each side away from the profile's plane, so a tapered two-sided extrude
 * is two prisms from the plane, fused: side 2's sides are `side2:<source>`
 * and its far cap `cap:start`. Sides ending on an inclined plane are
 * trimmed there; the trimmed end is `cap:end` (side 2: `cap:start`).
 */
function sweep(
  ctx: EvalContext<ExtrudeInputs>,
  scope: ShapeScope,
  source: SweepSource,
  n: Vec3,
  sides: Side[],
  direction: ExtrudeSettings['direction'],
): NamedShape {
  const { kernel, feature } = ctx;
  const prism = (
    options: Omit<Parameters<typeof namedPrism>[1], 'feature' | keyof SweepSource>,
  ) => {
    const made = namedPrism(kernel, { feature: feature.id, ...source, ...options });
    scope.track(made.shape);
    return made;
  };
  const [one, two] = sides as [Side, Side?];
  let tool: NamedShape;
  if (!two || direction === 'one-side') {
    tool = prism({ vector: scale(one.along, one.length), taper: one.taper });
  } else if (one.taper === 0 && two.taper === 0) {
    // From −side 2 to side 1 along n, in one sweep.
    const hi = one.length * dot(one.along, n);
    const lo = -two.length * dot(two.along, scale(n, -1));
    tool = prism({ vector: scale(n, hi - lo), shift: scale(n, lo) });
  } else {
    if (one.length < -LENGTH_EPS || two.length < -LENGTH_EPS) {
      throw new KernelError(
        'With a taper, both sides have to reach out from the profile. Enter positive distances.',
      );
    }
    const second = { start: 'cap:plane', end: 'cap:start', side: 'side2' };
    const a =
      one.length > LENGTH_EPS
        ? prism({ vector: scale(one.along, one.length), taper: one.taper })
        : undefined;
    const b =
      two.length > LENGTH_EPS
        ? prism({
            vector: scale(two.along, two.length),
            taper: two.taper,
            roles: a ? second : { ...second, start: 'cap:end' },
          })
        : undefined;
    if (a && b) {
      tool = namedBoolean(kernel, 'fuse', a, b, {
        feature: feature.id,
        op: 'extrude',
        simplify: true,
      });
      scope.track(tool.shape);
    } else {
      tool = (a ?? b) as NamedShape;
    }
  }
  sides.forEach((side, i) => {
    if (!side.trim) return;
    const box = trimmer(ctx, scope, tool.shape, side.trim, i === 0 ? 'cap:end' : 'cap:start');
    tool = namedBoolean(kernel, 'common', tool, box, { feature: feature.id, op: 'extrude' });
    scope.track(tool.shape);
  });
  return tool;
}

/**
 * A big box on the profile's side of `plane`, whose face in the plane is
 * named `role`: `common` with it trims a sweep at the plane and names the
 * new end.
 */
function trimmer(
  ctx: EvalContext<ExtrudeInputs>,
  scope: ShapeScope,
  near: ShapeHandle,
  plane: Plane,
  role: string,
): NamedShape {
  const { kernel } = ctx;
  const { bbox } = kernel.measure(near);
  const center = scale(add(bbox.min, bbox.max), 0.5);
  const size =
    2 * (length(sub(bbox.max, bbox.min)) + Math.abs(dot(sub(center, plane.point), plane.normal))) +
    10;
  const normal = scale(plane.normal, -1);
  const origin = sub(center, scale(normal, dot(sub(center, plane.point), normal)));
  const x = perpendicular(normal);
  const s = size / 2;
  const { faces } = kernel.planarFaces(
    [
      { kind: 'line', a: [-s, -s], b: [s, -s] },
      { kind: 'line', a: [s, -s], b: [s, s] },
      { kind: 'line', a: [s, s], b: [-s, s] },
      { kind: 'line', a: [-s, s], b: [-s, -s] },
    ],
    { origin, x, normal },
    1e-7,
  );
  for (const face of faces) scope.track(face.shape);
  const face = faces[0];
  if (!face) throw new KernelError("Couldn't end the extrude at that object.");
  const box = namedPrism(kernel, {
    feature: ctx.feature.id,
    shape: face.shape,
    edgeSources: [],
    vector: scale(normal, size),
    roles: { start: role, end: 'trim', side: 'trim' },
  });
  scope.track(box.shape);
  return box;
}
