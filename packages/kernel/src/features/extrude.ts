import {
  type BodyId,
  type ExtrudeInputs,
  type ExtrudeSettings,
  type ExtrudeSide,
  extrudeFeature,
  extrudeSettings,
  type FeatureId,
  type GeomRef,
  originPlane,
  parseProfileRefId,
} from '@extrudo/core';
import { KernelError, type ShapeHandle, type ShapeScope, type Vec3 } from '../kernel';
import { compareGeometry, deriveNames, type TopoNames } from '../naming/names';
import {
  faceEdgeSources,
  type NamedShape,
  namedBoolean,
  namedPrism,
  type SweepSource,
} from '../naming/ops';
import type {
  EvalContext,
  FeatureOutput,
  KernelFeatureDefinition,
  PreviewTool,
} from '../recompute/types';
import type { SketchOutputData } from './sketch';

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

/** Distances (mm) at or below which shapes touch. */
const TOUCH = 1e-4;
/** Lengths (mm) at or below which an extrude has none. */
const LENGTH_EPS = 1e-6;
/** Cosines within this of 1 are parallel directions. */
const PARALLEL_EPS = 1e-9;

type Plane = { point: Vec3; normal: Vec3 };

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
  const base = baseOf(ctx, scope, settings.profiles);
  const n = settings.flip ? scale(base.plane.normal, -1) : base.plane.normal;
  const origin = centroidOf(ctx, base.source.shape);
  const participants = explicitBodies(ctx, settings);
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
  const result = operate(ctx, scope, settings, tool, participants, warnings);
  return { ...result, data, ...(warnings.length ? { warnings } : {}) };
}

const reachOf = (side: Side | undefined, along: Vec3) =>
  side ? side.reach * Math.sign(dot(side.along, along)) : 0;

// ------------------------------------------------------------------ profiles

interface Base {
  source: SweepSource;
  plane: Plane;
}

/** The profiles and faces to sweep, united into one source, and their plane. */
function baseOf(ctx: EvalContext<ExtrudeInputs>, scope: ShapeScope, refs: GeomRef[]): Base {
  const parts: Base[] = [];
  const seen = new Set<string>();
  for (const ref of refs) {
    const key = `${ref.kind}:${ref.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    parts.push(ref.kind === 'profile' ? profilePart(ctx, ref) : facePart(ctx, scope, ref));
  }
  const [first, ...rest] = parts as [Base, ...Base[]];
  let source = first.source;
  for (const part of rest) {
    if (!coplanar(first.plane, part.plane)) {
      throw new KernelError('Pick profiles and faces that lie in one plane.');
    }
    source = unite(ctx, scope, source, part.source);
  }
  return { source, plane: first.plane };
}

function profilePart(ctx: EvalContext<ExtrudeInputs>, ref: GeomRef): Base {
  const parsed = parseProfileRefId(ref.id);
  if (!parsed) throw new KernelError("One of its profiles isn't a sketch profile. Pick it again.");
  const output = ctx.output(parsed.feature as FeatureId);
  const data = output.data as Partial<SketchOutputData> | undefined;
  const face = output.shapes?.[parsed.profile];
  const info = data?.profiles?.find((p) => p.id === parsed.profile);
  if (face === undefined || !info || !data?.frame) {
    throw new KernelError(
      "Can't find one of its profiles any more: an earlier change to the sketch removed it. Edit the extrude and pick it again.",
    );
  }
  return {
    source: { shape: face, edgeSources: info.edges },
    plane: { point: data.frame.origin, normal: data.frame.normal },
  };
}

/** A flat face of a body (press-pull): the face itself, its edges' names as sources. */
function facePart(ctx: EvalContext<ExtrudeInputs>, scope: ShapeScope, ref: GeomRef): Base {
  const hit = ctx.resolve(ref, { label: 'the face to extrude' });
  const info = ctx.describe(hit.shape).faces[hit.index];
  if (info?.type !== 'plane' || !info.direction) {
    throw new KernelError('Can only extrude flat faces. Pick a flat face or a sketch profile.');
  }
  const source = faceEdgeSources(
    ctx.kernel,
    { shape: hit.shape, names: ctx.names(hit.body) },
    hit.index,
  );
  scope.track(source.shape);
  return { source, plane: { point: info.centroid, normal: info.direction } };
}

/**
 * Two coplanar sources as one (a region split by a sketch line, a face and
 * a profile next to it): fused and simplified, so shared edges disappear
 * and the extrude has one face per side, not one per piece. Edge sources
 * follow the fuse's history; a merged edge takes the first input's source.
 */
function unite(
  ctx: EvalContext<ExtrudeInputs>,
  scope: ShapeScope,
  a: SweepSource,
  b: SweepSource,
): SweepSource {
  const { kernel } = ctx;
  const result = scope.track(kernel.boolean('fuse', a.shape, b.shape, { simplify: true }));
  const edgeSources: (string | null)[] = new Array(kernel.count(result.shape, 'edge')).fill(null);
  const rank: number[] = edgeSources.map(() => Number.POSITIVE_INFINITY);
  for (const record of result.history) {
    if (record.from.kind !== 'edge') continue;
    if (record.relation !== 'modified' && record.relation !== 'kept') continue;
    const source = (record.input === 0 ? a : b).edgeSources[record.from.index] ?? null;
    if (source === null) continue;
    for (const to of record.to) {
      if (to.kind !== 'edge' || (rank[to.index] as number) <= record.input) continue;
      edgeSources[to.index] = source;
      rank[to.index] = record.input;
    }
  }
  return { shape: result.shape, edgeSources };
}

function coplanar(a: Plane, b: Plane): boolean {
  const scaleOf = Math.max(1, length(a.point), length(b.point));
  return (
    Math.abs(Math.abs(dot(a.normal, b.normal)) - 1) <= PARALLEL_EPS * 1e3 &&
    Math.abs(dot(sub(b.point, a.point), a.normal)) <= 1e-6 * scaleOf
  );
}

/** Area centroid of a face or a compound of faces. */
function centroidOf(ctx: EvalContext<ExtrudeInputs>, shape: ShapeHandle): Vec3 {
  let area = 0;
  let sum: Vec3 = [0, 0, 0];
  for (const face of ctx.kernel.describe(shape).faces) {
    area += face.area;
    sum = add(sum, scale(face.centroid, face.area));
  }
  return area > 0 ? scale(sum, 1 / area) : sum;
}

// ------------------------------------------------------------------ extents

/** The bodies named in `bodies`, or undefined for "automatic". */
function explicitBodies(
  ctx: EvalContext<ExtrudeInputs>,
  settings: ExtrudeSettings,
): BodyId[] | undefined {
  if (settings.bodies.length === 0) return undefined;
  const ids = [...new Set(settings.bodies)] as BodyId[];
  if (ids.some((id) => !ctx.bodies.has(id))) {
    throw new KernelError(
      `One of the bodies to ${verb(settings.operation)} no longer exists. Edit the extrude and pick the bodies again.`,
    );
  }
  return ids;
}

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
    const frame = originPlane(ref.id)?.frame;
    if (!frame) throw new KernelError("Can't find the plane to extrude to. Pick it again.");
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

// ------------------------------------------------------------------ operations

function operate(
  ctx: EvalContext<ExtrudeInputs>,
  scope: ShapeScope,
  settings: ExtrudeSettings,
  tool: NamedShape,
  participants: BodyId[] | undefined,
  warnings: string[],
): Pick<FeatureOutput, 'bodies' | 'names' | 'previewTools'> {
  const { kernel } = ctx;
  const operation = settings.operation;
  if (operation === 'new-body') return newBodies(ctx, scope, tool);

  const targets =
    participants ??
    [...ctx.bodies]
      .filter(([, shape]) => kernel.distance(shape, tool.shape) <= TOUCH)
      .map(([id]) => id);
  // Kept only on success: a failure below must release the tool with the scope.
  const preview = (): PreviewTool[] => [{ shape: scope.keep(tool.shape), style: operation }];
  const named = (id: BodyId): NamedShape => ({
    shape: ctx.bodies.get(id) as ShapeHandle,
    names: ctx.names(id),
  });
  const options = { feature: ctx.feature.id, op: 'extrude' };

  if (operation === 'join') {
    const [first, ...rest] = targets;
    if (first === undefined) {
      warnings.push('Nothing to join to, so the extrude made a new body.');
      return { ...newBodies(ctx, scope, tool), previewTools: preview() };
    }
    let joined = namedBoolean(kernel, 'fuse', named(first), tool, { ...options, simplify: true });
    scope.track(joined.shape);
    for (const id of rest) {
      joined = namedBoolean(kernel, 'fuse', joined, named(id), { ...options, simplify: true });
      scope.track(joined.shape);
    }
    const bodies = new Map(ctx.bodies);
    for (const id of rest) bodies.delete(id);
    bodies.set(first, scope.keep(joined.shape));
    return { bodies, names: new Map([[first, joined.names]]), previewTools: preview() };
  }

  const op = operation === 'cut' ? 'cut' : 'common';
  const changed = new Map<BodyId, NamedShape | undefined>();
  for (const id of targets) {
    const before = named(id);
    const result = namedBoolean(kernel, op, before, tool, options);
    scope.track(result.shape);
    const was = kernel.measure(before.shape).volume;
    const now = kernel.measure(result.shape).volume;
    const eps = 1e-6 * Math.max(1, Math.abs(was));
    if (op === 'cut' && Math.abs(was - now) <= eps) continue;
    if (now > eps) {
      changed.set(id, result);
    } else if (op === 'cut') {
      changed.set(id, undefined);
      warnings.push('The cut removed a whole body.');
    } else if (participants) {
      throw new KernelError(
        'Nothing is left of one of its bodies after the intersection. Check the extrude, or pick other bodies.',
      );
    }
    // An automatic intersect target it only touches stays as it is.
  }
  if (changed.size === 0) {
    if (op === 'cut') {
      throw new KernelError(
        targets.length === 0
          ? "The cut doesn't touch any body. Check its direction and distance."
          : "The cut doesn't remove anything. Check its direction and distance.",
      );
    }
    throw new KernelError(
      "The extrude doesn't overlap any body, so there's nothing to intersect. Check its direction and distance.",
    );
  }
  const bodies = new Map(ctx.bodies);
  const names = new Map<BodyId, TopoNames>();
  for (const [id, result] of changed) {
    if (!result) {
      bodies.delete(id);
      continue;
    }
    bodies.set(id, scope.keep(result.shape));
    names.set(id, result.names);
  }
  return { bodies, names, previewTools: preview() };
}

/** The tool as new bodies: one per separate solid, in geometric order. */
function newBodies(
  ctx: EvalContext<ExtrudeInputs>,
  scope: ShapeScope,
  tool: NamedShape,
): Pick<FeatureOutput, 'bodies' | 'names'> {
  const { kernel } = ctx;
  const bodies = new Map(ctx.bodies);
  const names = new Map<BodyId, TopoNames>();
  const solids = kernel.solids(tool.shape);
  for (const solid of solids) scope.track(solid);
  if (solids.length === 0) throw new KernelError('The extrude made no solid. Check its profiles.');
  if (solids.length === 1) {
    const id = ctx.bodyId(0);
    bodies.set(id, scope.keep(tool.shape));
    names.set(id, tool.names);
    return { bodies, names };
  }
  const placed = solids.map((solid) => {
    const { min, max } = kernel.measure(solid).bbox;
    return { solid, center: scale(add(min, max), 0.5) };
  });
  placed.sort((a, b) => compareGeometry(a.center, b.center));
  const named = placed.map(({ solid }) => {
    const faces = kernel.locate(solid, tool.shape, 'face').map((at) => tool.names.faces[at] ?? '');
    return { solid, names: deriveNames(faces, kernel.describe(solid)) };
  });
  named.forEach(({ solid, names: table }, i) => {
    const id = ctx.bodyId(i);
    names.set(id, table);
    bodies.set(id, scope.keep(solid));
  });
  return { bodies, names };
}

function verb(operation: ExtrudeSettings['operation']): string {
  return operation === 'new-body' ? 'use' : operation;
}

// ------------------------------------------------------------------ vectors

const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const length = (a: Vec3): number => Math.sqrt(dot(a, a));
const degrees = (radians: number) => (radians * 180) / Math.PI;

/** A unit vector square to `n`. */
function perpendicular(n: Vec3): Vec3 {
  const helper: Vec3 = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const c: Vec3 = [
    n[1] * helper[2] - n[2] * helper[1],
    n[2] * helper[0] - n[0] * helper[2],
    n[0] * helper[1] - n[1] * helper[0],
  ];
  return scale(c, 1 / length(c));
}

function corners(min: Vec3, max: Vec3): Vec3[] {
  const out: Vec3[] = [];
  for (const x of [min[0], max[0]]) {
    for (const y of [min[1], max[1]]) {
      for (const z of [min[2], max[2]]) out.push([x, y, z]);
    }
  }
  return out;
}
