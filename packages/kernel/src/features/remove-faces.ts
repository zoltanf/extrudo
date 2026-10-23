import { type BodyId, type RemoveFacesInputs, removeFacesFeature } from '@extrudo/core';
import {
  type Axis,
  type Kernel,
  KernelError,
  type OperationResult,
  RemoveFacesError,
  type ShapeHandle,
  type Vec3,
} from '../kernel';
import type { ShapeDescription } from '../naming/description';
import type { TopoNames } from '../naming/names';
import { withHistory } from '../naming/ops';
import type { EvalContext, FeatureOutput, KernelFeatureDefinition } from '../recompute/types';

/**
 * The Remove Faces feature in the kernel (ADR-0099, #78): takes the picked
 * faces out of their bodies and extends or trims the faces around them
 * until they meet (OCCT's defeaturing, facade `removeFaces`), so a hole
 * closes up and a round becomes a sharp edge. Faces are resolved by name
 * (ADR-0005); faces of several bodies are removed body by body, and the
 * bodies are kept only when every one worked.
 *
 * **All or nothing**: when OCCT can't close the gap of one picked face, the
 * step fails and says which faces usually have to come along (the rest of
 * the round or hole, `removeFacesPick`). Removed faces' names are gone; an
 * extended neighbour keeps its name (the history's `modified`), so a
 * fillet on "the top face" still finds it after a hole in it was removed.
 */
export const kernelRemoveFaces: KernelFeatureDefinition<RemoveFacesInputs> = {
  ...removeFacesFeature,
  bodyAccess: () => 'write',
  evaluate: evaluateRemoveFaces,
};

function evaluateRemoveFaces(ctx: EvalContext<RemoveFacesInputs>): FeatureOutput {
  const { kernel } = ctx;
  const refs = ctx.inputs.faces.refs;
  if (refs.length === 0) throw new KernelError('Pick a face to remove.');

  // The faces to remove, by body.
  const picked = new Map<BodyId, number[]>();
  for (const ref of refs) {
    const hit = ctx.resolve(ref, { label: 'a face to remove' });
    const faces = picked.get(hit.body) ?? [];
    if (!faces.includes(hit.index)) faces.push(hit.index);
    picked.set(hit.body, faces);
  }
  for (const [body, faces] of picked) {
    const shape = ctx.bodies.get(body) as ShapeHandle;
    if (faces.length >= kernel.count(shape, 'face')) {
      throw new KernelError('That would remove the whole body. Use Remove on the body instead.');
    }
  }

  using scope = kernel.scope();
  const removed = new Map<BodyId, { shape: ShapeHandle; table: TopoNames }>();
  for (const [body, faces] of picked) {
    const shape = ctx.bodies.get(body) as ShapeHandle;
    let result: OperationResult;
    try {
      result = kernel.removeFaces(shape, faces);
    } catch (error) {
      if (error instanceof RemoveFacesError) {
        throw new KernelError(removeFacesMessage(kernel, shape, ctx.describe(shape), faces, error));
      }
      throw error;
    }
    scope.track(result.shape);
    const named = withHistory(kernel, result, [ctx.names(body)], {
      op: 'removeFaces',
      feature: ctx.feature.id,
    });
    removed.set(body, { shape: named.shape, table: named.names });
  }
  // Kept only when every body worked: a failure releases them all with the scope.
  const bodies = new Map(ctx.bodies);
  const names = new Map<BodyId, TopoNames>();
  for (const [body, { shape, table }] of removed) {
    bodies.set(body, scope.keep(shape));
    names.set(body, table);
  }
  return { bodies, names };
}

// ----------------------------------------------------------------- messages

/**
 * A refusal as a message (FR-UX-06, ADR-0099 §4): how many faces were the
 * trouble and, when the failed faces' rounds or holes (`removeFacesPick`)
 * have faces that aren't picked, how many to add.
 */
function removeFacesMessage(
  kernel: Kernel,
  shape: ShapeHandle,
  description: ShapeDescription,
  picked: readonly number[],
  error: RemoveFacesError,
): string {
  if (error.failed.length === 0) {
    return "Remove Faces can't close the gap the picked faces leave: the faces around them can't be extended to meet. Pick fewer faces, or the whole round or hole.";
  }
  const group = removeFacesPick(
    error.failed,
    description,
    kernelSurface(kernel, shape, description),
    (face) => kernel.tangentFaces(shape, face),
  );
  const more = group.filter((face) => !picked.includes(face)).length;
  return refusalMessage(error.failed.length, more);
}

/** The refusal's words for `count` failed faces and `more` faces of their groups not picked. */
export function refusalMessage(count: number, more: number): string {
  const these = count === 1 ? 'this face leaves' : `these ${count} faces leave`;
  return more > 0
    ? `Remove Faces can't close the gap ${these}. Pick the rest of the round or hole too (${more} more ${more === 1 ? 'face' : 'faces'}), or fewer faces.`
    : `Remove Faces can't close the gap ${these}: the faces around them can't be extended to meet. Pick fewer faces, or the whole round or hole.`;
}

// -------------------------------------------------------------------- picks

/** What the pick rule needs of a cylinder, cone or torus face. */
export interface PickSurface {
  /** The surface's axis (a point on it and its direction). */
  axis: Axis;
  /** A cylinder or cone with the material outside it (a hole's wall). */
  inside: boolean;
  /** The face goes all the way round. */
  whole: boolean;
}

/** Axis directions this close (the cross product's length) are parallel. */
const PARALLEL = 1e-6;
/** mm: axis lines this close are one, and a point this far past the radius is still within it. */
const NEAR = 1e-4;

/**
 * The faces one click on each of `starts` takes for Remove Faces (ADR-0099
 * §5), the starts first, no duplicates:
 * - a hole's wall (a cylinder or cone with the material outside it, all
 *   the way round): the whole hole, its bottom, counterbore step,
 *   countersink or drill point too, not the face it opens onto (`holeOf`);
 * - another face that isn't flat (a round): its smooth chain (`chain`,
 *   the kernel's `tangentFaces`) walked across shared edges through
 *   non-planar faces only, so a fillet run comes whole but not the flat
 *   faces it blends;
 * - anything else: the face itself.
 * `surface` answers for cylinder, cone and torus faces (undefined for
 * anything else); it and `chain` are asked only when needed.
 */
export function removeFacesPick(
  starts: readonly number[],
  description: ShapeDescription,
  surface: (face: number) => PickSurface | undefined,
  chain: (face: number) => number[],
): number[] {
  const out = new Set<number>(starts);
  const around = neighbours(description);
  const surfaces = new Map<number, PickSurface | undefined>();
  const surfaceOf = (face: number) => {
    if (!surfaces.has(face)) {
      const type = description.faces[face]?.type;
      surfaces.set(
        face,
        type === 'cylinder' || type === 'cone' || type === 'torus' ? surface(face) : undefined,
      );
    }
    return surfaces.get(face);
  };
  for (const start of starts) {
    const type = description.faces[start]?.type;
    if (type === undefined || type === 'plane') continue;
    const own = surfaceOf(start);
    if ((type === 'cylinder' || type === 'cone') && own?.inside && own.whole) {
      for (const face of holeOf(start, own.axis, description, around, surfaceOf)) out.add(face);
      continue;
    }
    const members = new Set(chain(start));
    const reached = new Set([start]);
    const queue = [start];
    for (let face = queue.pop(); face !== undefined; face = queue.pop()) {
      for (const next of around.get(face) ?? []) {
        if (reached.has(next) || !members.has(next)) continue;
        if (description.faces[next]?.type === 'plane') continue;
        reached.add(next);
        queue.push(next);
      }
    }
    for (const face of reached) out.add(face);
  }
  return [...out];
}

/**
 * A hole's faces from its wall `wall` (ADR-0099 §5, as amended): the faces
 * connected to it across shared edges that are a cylinder, cone or torus on
 * its axis or a plane square to it, and whose edge midpoints and vertices
 * lie within the hole's radius: the largest distance from the axis of a
 * hole wall (an inside cylinder or cone) among those faces. So a click on a
 * counterbore's narrow wall takes the wide one and the step between them,
 * and the face the hole opens onto stays (its outer edges lie further out).
 */
function holeOf(
  wall: number,
  axis: Axis,
  description: ShapeDescription,
  around: ReadonlyMap<number, number[]>,
  surfaceOf: (face: number) => PickSurface | undefined,
): number[] {
  const reach = reachOf(description, axis);
  const onAxis = (face: number): boolean => {
    const info = description.faces[face];
    if (!info) return false;
    if (info.type === 'plane')
      return info.direction !== undefined && parallel(info.direction, axis.direction);
    if (info.type !== 'cylinder' && info.type !== 'cone' && info.type !== 'torus') return false;
    const own = surfaceOf(face);
    return own !== undefined && coaxial(own.axis, axis);
  };
  // The faces on the axis connected to the wall, and the hole's radius among them.
  const connected = walk([wall], around, onAxis);
  let radius = 0;
  for (const face of connected) {
    const type = description.faces[face]?.type;
    if ((type === 'cylinder' || type === 'cone') && surfaceOf(face)?.inside) {
      radius = Math.max(radius, reach(face));
    }
  }
  // Of those, the ones within the radius, still connected to the wall.
  return [...walk([wall], around, (face) => connected.has(face) && reach(face) <= radius + NEAR)];
}

/** The faces reached from `starts` across shared edges through faces `take` accepts. */
function walk(
  starts: readonly number[],
  around: ReadonlyMap<number, number[]>,
  take: (face: number) => boolean,
): Set<number> {
  const reached = new Set(starts);
  const queue = [...starts];
  for (let face = queue.pop(); face !== undefined; face = queue.pop()) {
    for (const next of around.get(face) ?? []) {
      if (reached.has(next) || !take(next)) continue;
      reached.add(next);
      queue.push(next);
    }
  }
  return reached;
}

/** The largest distance from `axis` of a face's edge midpoints and vertices. */
function reachOf(description: ShapeDescription, axis: Axis): (face: number) => number {
  const points = new Map<number, Vec3[]>();
  const add = (face: number, point: Vec3) => {
    const list = points.get(face) ?? [];
    list.push(point);
    points.set(face, list);
  };
  for (const edge of description.edges) for (const face of edge.faces) add(face, edge.midpoint);
  for (const vertex of description.vertices)
    for (const face of vertex.faces) add(face, vertex.point);
  return (face) => Math.max(0, ...(points.get(face) ?? []).map((p) => distanceToAxis(p, axis)));
}

/** Each face's neighbours across shared edges. */
function neighbours(description: ShapeDescription): Map<number, number[]> {
  const around = new Map<number, number[]>();
  for (const edge of description.edges) {
    for (const a of edge.faces) {
      const list = around.get(a) ?? [];
      for (const b of edge.faces) if (b !== a && !list.includes(b)) list.push(b);
      around.set(a, list);
    }
  }
  return around;
}

function parallel(a: Vec3, b: Vec3): boolean {
  const la = Math.hypot(...a);
  const lb = Math.hypot(...b);
  if (!(la > 0 && lb > 0)) return false;
  const cross = Math.hypot(
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  );
  return cross / (la * lb) <= PARALLEL;
}

function coaxial(a: Axis, b: Axis): boolean {
  return parallel(a.direction, b.direction) && distanceToAxis(a.origin, b) <= NEAR;
}

function distanceToAxis(point: Vec3, axis: Axis): number {
  const d = axis.direction;
  const length = Math.hypot(...d);
  const v: Vec3 = [point[0] - axis.origin[0], point[1] - axis.origin[1], point[2] - axis.origin[2]];
  const along = (v[0] * d[0] + v[1] * d[1] + v[2] * d[2]) / length;
  return Math.sqrt(Math.max(0, v[0] ** 2 + v[1] ** 2 + v[2] ** 2 - along ** 2));
}

/**
 * The pick rule's `surface` from the kernel: the axis from the surface's
 * geometry, inside and all the way round from `threadFace` (which answers
 * for cones too); a torus is never a wall.
 */
export function kernelSurface(
  kernel: Kernel,
  shape: ShapeHandle,
  description: ShapeDescription,
): (face: number) => PickSurface | undefined {
  return (face) => {
    const geometry = kernel.surfaceGeometry(shape, face);
    if (!geometry.origin || !geometry.direction) return undefined;
    const axis: Axis = { origin: geometry.origin, direction: geometry.direction };
    if (description.faces[face]?.type === 'torus') return { axis, inside: false, whole: false };
    const thread = kernel.threadFace(shape, face, 'Remove Faces');
    return { axis, inside: thread?.inside ?? false, whole: thread?.whole ?? false };
  };
}
