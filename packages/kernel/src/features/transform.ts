/**
 * Move/Copy and Mirror in the kernel (P3-06, ADR-0044): rigid transforms of
 * whole bodies through the facade's `transform`. The result is a rebuilt
 * shape whose faces, edges and vertices are the images of the input's, so
 * `withHistory` carries every persistent name across: a fillet or a sketch
 * on a face of a moved body keeps resolving. A copy gets the moved body's
 * naming table too (names are per body, `ctx.names(<id>)`), so the same
 * name means the same face in the original and in each copy.
 *
 * Both features take bodies by ID, and a body that no longer exists is a
 * `LostReferenceError` (Fix References).
 */
import {
  type BodyId,
  type GeomRef,
  type MirrorInputs,
  type MoveInputs,
  mirrorFeature,
  mirrorSettings,
  moveBodiesFeature,
  moveSettings,
} from '@extrudo/core';
import { KernelError, type ShapeHandle, type ShapeScope, type Vec3 } from '../kernel';
import type { TopoNames } from '../naming/names';
import { type NamedShape, namedBoolean } from '../naming/ops';
import { LostReferenceError } from '../naming/resolve';
import type { EvalContext, FeatureOutput, KernelFeatureDefinition } from '../recompute/types';
import type { CsgContext, CsgResult } from '../scad-export/context';
import { about, type CsgNode } from '../scad-export/ir';
import { splitSolids } from './bodies';
import { compose, IDENTITY, type Matrix12, mirror, rotation, translation } from './matrix';
import { nameMeshBodies, transformedNames, warnIfBecameMesh } from './mesh-bodies';
import { bodiesTouch } from './operation';
import { replayFeatures } from './pattern';
import type { Placement } from './pattern-layout';
import { type GeometryReader, type LineOf, lineOf, planeOf, pointOf } from './references';

const RADIANS = Math.PI / 180;

/** The bodies a feature works on, by ID: the ones that exist, else a lost reference. */
export function existing(
  ctx: Pick<EvalContext, 'bodies' | 'feature'>,
  refs: readonly GeomRef[],
  what: string,
): BodyId[] {
  if (refs.length === 0) throw new KernelError(`Pick the bodies to ${what}.`);
  return refs.map((ref) => {
    if (!ctx.bodies.has(ref.id as BodyId)) {
      throw new LostReferenceError(
        `One of the bodies to ${what} no longer exists. Edit ${ctx.feature.name} and pick the bodies again.`,
        ref,
      );
    }
    return ref.id as BodyId;
  });
}

/** A body moved by `matrix`: its source, the new shape (tracked in the scope) and its names. */
export interface Image {
  source: BodyId;
  /** The ID it takes in the output: the source's for a move, a new `<feature>:<n>` for a copy. */
  id: BodyId;
  named: NamedShape;
}

/**
 * Every body in `ids` transformed by `matrix`, each named through the
 * transform's history. The new shapes belong to `scope`; the caller keeps
 * the ones it puts in the output.
 */
export function transformBodies(
  ctx: EvalContext,
  scope: ShapeScope,
  ids: readonly BodyId[],
  matrix: Matrix12,
  copy: boolean,
  op: string,
): Image[] {
  const { kernel } = ctx;
  return ids.map((source, i) => {
    const result = kernel.transform(ctx.bodies.get(source) as ShapeHandle, matrix);
    // A mesh body's single face keeps the name it had (a move) or gets the
    // copy rule (a copy); a solid's names come from the transform's history
    // (ADR-0066 §4, `transformedNames`).
    const names = transformedNames(ctx, result, ctx.names(source), {
      op,
      ...(copy ? { role: 'from' } : {}),
    });
    scope.track(result.shape);
    return { source, id: copy ? ctx.bodyId(i) : source, named: { shape: result.shape, names } };
  });
}

/** The output body set with the images in it (a copy adds them, a move replaces the sources). */
export function withImages(ctx: EvalContext, scope: ShapeScope, images: readonly Image[]) {
  const bodies = new Map(ctx.bodies);
  const names = new Map<BodyId, TopoNames>();
  for (const { id, named } of images) {
    bodies.set(id, scope.keep(named.shape));
    names.set(id, named.names);
  }
  return { bodies, names };
}

export function isIdentity(matrix: Matrix12): boolean {
  return matrix.every((value, i) => Math.abs(value - (IDENTITY[i] as number)) < 1e-12);
}

// --------------------------------------------------------------------- move

export const kernelMove: KernelFeatureDefinition<MoveInputs> = {
  ...moveBodiesFeature,
  bodyAccess: () => 'write',
  evaluate: evaluateMove,
  csg: moveCsg,
};

function evaluateMove(ctx: EvalContext<MoveInputs>): FeatureOutput {
  const settings = moveSettings(ctx.inputs);
  const ids = existing(ctx, settings.bodies, 'move');
  const matrix = motionMatrix(moveMotion(ctx, settings, ids));
  if (isIdentity(matrix)) {
    ctx.warn(
      settings.copy
        ? 'Nothing moves, so the copy sits exactly on the original.'
        : 'Nothing moves: every distance and angle is 0.',
    );
  }
  using scope = ctx.kernel.scope();
  const images = transformBodies(ctx, scope, ids, matrix, settings.copy, 'move');
  return withImages(ctx, scope, images);
}

/** What a move's context needs: its inputs and the geometry they name. */
type MoveReader = Pick<EvalContext<MoveInputs>, 'inputs' | 'value' | 'bodies'> & GeometryReader;

/**
 * A move as its mode and inputs say (the evaluator makes its matrix of it,
 * the OpenSCAD export its transforms): angles in degrees.
 */
export type Motion =
  /** Turned about the world axes through `pivot`, X then Y then Z, then moved by `by`. */
  | { mode: 'free'; pivot: Vec3; turns: Vec3; by: Vec3 }
  | { mode: 'rotate'; axis: LineOf; angle: number }
  | { mode: 'point-to-point'; by: Vec3 };

export function moveMotion(
  ctx: MoveReader,
  settings: ReturnType<typeof moveSettings>,
  ids: readonly BodyId[],
): Motion {
  const { inputs } = ctx;
  const number = (name: 'dx' | 'dy' | 'dz' | 'rx' | 'ry' | 'rz' | 'angle') =>
    inputs[name] ? ctx.value(name) : 0;
  switch (settings.mode) {
    case 'free':
      // The pivot is the bodies' box centre.
      return {
        mode: 'free',
        pivot: centreOf(ctx, ids),
        turns: [number('rx'), number('ry'), number('rz')],
        by: [number('dx'), number('dy'), number('dz')],
      };
    case 'rotate': {
      if (!settings.axis) throw new KernelError('Pick the axis to turn about.');
      const axis = lineOf(ctx, settings.axis, 'the axis to turn about');
      return { mode: 'rotate', axis, angle: number('angle') };
    }
    case 'point-to-point': {
      if (!settings.from) throw new KernelError('Pick the point to move from.');
      if (!settings.to) throw new KernelError('Pick the point to move to.');
      const from = pointOf(ctx, settings.from, 'the point to move from');
      const to = pointOf(ctx, settings.to, 'the point to move to');
      return { mode: 'point-to-point', by: [to[0] - from[0], to[1] - from[1], to[2] - from[2]] };
    }
  }
}

/** The matrix of a move. */
export function motionMatrix(motion: Motion): Matrix12 {
  switch (motion.mode) {
    case 'free': {
      const { pivot, turns } = motion;
      const turn = (axis: Vec3, degrees: number): Matrix12 =>
        degrees === 0 ? IDENTITY : rotation(pivot, axis, degrees * RADIANS);
      const turned = compose(
        turn([0, 0, 1], turns[2]),
        compose(turn([0, 1, 0], turns[1]), turn([1, 0, 0], turns[0])),
      );
      return compose(translation(motion.by), turned);
    }
    case 'rotate':
      return rotation(motion.axis.origin, motion.axis.direction, motion.angle * RADIANS);
    case 'point-to-point':
      return translation(motion.by);
  }
}

/** The centre of the box that holds the bodies (the exact, tight boxes). */
export function centreOf(
  ctx: Pick<EvalContext, 'kernel' | 'bodies'>,
  ids: readonly BodyId[],
): Vec3 {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const id of ids) {
    const box = ctx.kernel.properties(ctx.bodies.get(id) as ShapeHandle).bbox;
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k] as number, box.min[k] as number);
      max[k] = Math.max(max[k] as number, box.max[k] as number);
    }
  }
  return [0, 1, 2].map((k) => ((min[k] as number) + (max[k] as number)) / 2) as unknown as Vec3;
}

// ------------------------------------------------------------------- mirror

export const kernelMirror: KernelFeatureDefinition<MirrorInputs> = {
  ...mirrorFeature,
  bodyAccess: () => 'write',
  evaluate: evaluateMirror,
  csg: mirrorCsg,
};

/**
 * Mirrors features (P3-07, ADR-0047): the tool of each chosen solid feature
 * reflected in the plane and joined or cut like the feature did.
 */
function mirrorFeatures(
  ctx: EvalContext<MirrorInputs>,
  settings: ReturnType<typeof mirrorSettings>,
): FeatureOutput {
  if (!settings.plane) throw new KernelError('Pick the plane to mirror in.');
  const { frame } = planeOf(ctx, settings.plane, 'the mirror plane');
  using scope = ctx.kernel.scope();
  const placement: Placement = {
    label: '',
    slot: 0,
    matrix: mirror(frame.origin, frame.normal),
  };
  return replayFeatures(
    ctx,
    scope,
    settings.features,
    { placements: [placement], skipped: [] },
    'mirror',
  );
}

function evaluateMirror(ctx: EvalContext<MirrorInputs>): FeatureOutput {
  const settings = mirrorSettings(ctx.inputs);
  const { kernel } = ctx;
  if (settings.objects === 'features') return mirrorFeatures(ctx, settings);
  const ids = existing(ctx, settings.bodies, 'mirror');
  if (!settings.plane) throw new KernelError('Pick the plane to mirror in.');
  const { frame } = planeOf(ctx, settings.plane, 'the mirror plane');
  const matrix = mirror(frame.origin, frame.normal);

  using scope = kernel.scope();
  const images = transformBodies(ctx, scope, ids, matrix, settings.copy, 'mirror');
  if (!settings.join) return withImages(ctx, scope, images);

  // Each mirrored copy fused into its original, which keeps its ID; one that
  // doesn't touch its original stays a body of its own.
  const bodies = new Map(ctx.bodies);
  const names = new Map<BodyId, TopoNames>();
  const kept: ShapeHandle[] = [];
  let apart = 0;
  let extra = 0;
  for (const { source, named } of images) {
    const original: NamedShape = {
      shape: ctx.bodies.get(source) as ShapeHandle,
      names: ctx.names(source),
    };
    if (!bodiesTouch(ctx, original.shape, named.shape)) {
      const id = ctx.bodyId(extra++);
      bodies.set(id, named.shape);
      kept.push(named.shape);
      names.set(id, named.names);
      apart++;
      continue;
    }
    const joined = namedBoolean(kernel, 'fuse', original, named, {
      feature: ctx.feature.id,
      op: 'mirror',
      simplify: true,
    });
    scope.track(joined.shape);
    warnIfBecameMesh(ctx, original.shape, joined.shape);
    bodies.set(source, joined.shape);
    kept.push(joined.shape);
    names.set(source, joined.names);
  }
  // Kept only when every copy worked: a failure releases them all with the scope.
  for (const shape of kept) scope.keep(shape);
  if (apart > 0) {
    ctx.warn(
      apart === 1
        ? "The mirrored copy doesn't touch its original, so it stays a separate body."
        : `${apart} mirrored copies don't touch their originals, so they stay separate bodies.`,
    );
  }
  return nameMeshBodies(ctx, splitSolids(ctx, scope, { bodies, names }));
}

// ----------------------------------------------------------------- OpenSCAD

/**
 * The bodies a move, mirror or scale writes (ADR-0088 §7): each source's
 * version under `place`, as the source itself or, for a copy, as the new
 * body `transformBodies` gave it (the source keeps its version).
 */
export function imagesCsg(
  ctx: CsgContext,
  ids: readonly BodyId[],
  copy: boolean,
  place: (node: CsgNode) => CsgNode,
): CsgResult {
  return new Map(
    ids.map((source, i) => [copy ? ctx.bodyId(i) : source, place(ctx.body(source))] as const),
  );
}

/**
 * A move in OpenSCAD: free is `translate(by)` of the turns about the pivot
 * (`rotate([rx, ry, rz])` turns about X, then Y, then Z, as the evaluator
 * does), rotate a `rotate(a, v)` about the axis point, point-to-point a
 * `translate`. Distances and angles are the inputs' scalars, the pivot, axis
 * and points numbers.
 */
function moveCsg(ctx: CsgContext<MoveInputs>): CsgResult {
  const settings = moveSettings(ctx.inputs);
  const ids = existing(ctx, settings.bodies, 'move');
  const motion = moveMotion(ctx, settings, ids);
  const scalar = (name: 'dx' | 'dy' | 'dz' | 'rx' | 'ry' | 'rz' | 'angle') =>
    ctx.input(name) ? ctx.scalar(name) : 0;
  let place: (node: CsgNode) => CsgNode;
  switch (motion.mode) {
    case 'free': {
      // A zero is left out only as a number: an expression that is 0 now stays live.
      const turns = [scalar('rx'), scalar('ry'), scalar('rz')] as const;
      const by = [scalar('dx'), scalar('dy'), scalar('dz')] as const;
      const turned = (node: CsgNode): CsgNode =>
        turns.every((t) => t === 0)
          ? node
          : about(motion.pivot, (child) => ({ kind: 'rotate', a: turns, children: [child] }), node);
      place = (node) =>
        by.every((d) => d === 0)
          ? turned(node)
          : { kind: 'translate', v: by, children: [turned(node)] };
      break;
    }
    case 'rotate': {
      const { origin, direction } = motion.axis;
      const angle = scalar('angle');
      place = (node) =>
        about(
          origin,
          (child) => ({ kind: 'rotate', a: angle, v: direction, children: [child] }),
          node,
        );
      break;
    }
    case 'point-to-point':
      place = (node) => ({ kind: 'translate', v: motion.by, children: [node] });
      break;
  }
  return imagesCsg(ctx, ids, settings.copy, place);
}

/**
 * A mirror of bodies in OpenSCAD: `mirror(normal)` about the plane's point,
 * the source's version or a copy; with join, each copy that touched its
 * original is a union with it, and one that didn't is a new body, as
 * `evaluateMirror` numbered them (told apart by which sources changed).
 * Mirroring features replays their tools, which has no hook yet.
 */
function mirrorCsg(ctx: CsgContext<MirrorInputs>): CsgResult {
  const settings = mirrorSettings(ctx.inputs);
  if (settings.objects === 'features') return ctx.unsupported('mirroring features');
  const ids = existing(ctx, settings.bodies, 'mirror');
  if (!settings.plane) throw new KernelError('Pick the plane to mirror in.');
  const { frame } = planeOf(ctx, settings.plane, 'the mirror plane');
  const flip = (node: CsgNode) =>
    about(frame.origin, (child) => ({ kind: 'mirror', v: frame.normal, children: [child] }), node);
  if (!settings.join) return imagesCsg(ctx, ids, settings.copy, flip);
  const out = new Map<BodyId, CsgNode>();
  let extra = 0;
  for (const source of ids) {
    const original = ctx.body(source);
    if (ctx.changed.includes(source)) {
      out.set(source, { kind: 'union', children: [original, flip(original)] });
    } else {
      out.set(ctx.bodyId(extra++), flip(original));
    }
  }
  return out;
}
