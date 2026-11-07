/**
 * The Simplify for Print feature in the kernel (ADR-0141, #79): finds the
 * rounds under a radius and the holes under a diameter on each chosen body
 * and removes them with Remove Faces' defeaturing (`kernel.removeFaces`,
 * ADR-0099).
 *
 * Detection (§2) is TypeScript over the shape description and three
 * existing facade queries (`surfaceGeometry`, `threadFace`, `tangentFaces`),
 * so it needs no new WASM:
 * - a **hole** is a closed cylindrical wall (one face all the way round, or
 *   a ring of coaxial pieces of one radius) with the faces Remove Faces'
 *   hole rule takes with it (`removeFacesPick`: floor, counterbore,
 *   countersink, drill point); its size is the widest wall's diameter;
 * - a **round** is a run of cylinder (not all the way round), torus and
 *   sphere faces under the radius, joined across smooth edges (the
 *   kernel's `tangentFaces`); a face with no smooth neighbour is no round.
 *
 * Removal (§3): rounds, then holes, all in one defeaturing first; when that
 * fails, each round or hole on its own, on the shape the ones before left,
 * so one that can't be removed doesn't stop the rest. A later group's faces
 * are found again on that shape by name (ADR-0005). Removed faces' names are
 * gone; extended neighbours keep theirs. The preview draws the removed faces
 * as a cut (red), and the report lists every group, removed or not (§4).
 */
import {
  type BodyId,
  type SimplifyForPrintInputs,
  type SimplifyGroup,
  type SimplifyReport,
  simplifyForPrintFeature,
  simplifyKinds,
} from '@extrudo/core';
import {
  type Axis,
  type Kernel,
  KernelError,
  RemoveFacesError,
  type ShapeHandle,
  type Vec3,
} from '../kernel';
import type { ShapeDescription } from '../naming/description';
import type { TopoNames } from '../naming/names';
import { withHistory } from '../naming/ops';
import type {
  EvalContext,
  FeatureOutput,
  KernelFeatureDefinition,
  PreviewTool,
} from '../recompute/types';
import { type PickSurface, removeFacesPick } from './remove-faces';
import { existing } from './transform';

/** The kernel's report of a simplification, as the recompute result carries it. */
export interface SimplifyFeatureReport extends SimplifyReport {
  kind: 'simplifyForPrint';
}

/** Whether a kernel report is Simplify for Print's. */
export function isSimplifyReport(report: unknown): report is SimplifyFeatureReport {
  return (report as { kind?: unknown } | null | undefined)?.kind === 'simplifyForPrint';
}

export const kernelSimplifyForPrint: KernelFeatureDefinition<SimplifyForPrintInputs> = {
  ...simplifyForPrintFeature,
  bodyAccess: () => 'write',
  evaluate: evaluateSimplify,
};

// ---------------------------------------------------------------- detection

/** What detection needs of a curved face (undefined for planes and anything else). */
export interface SimplifySurface {
  type: 'cylinder' | 'cone' | 'torus' | 'sphere';
  /** A cylinder's or sphere's radius; a torus's tube (minor) radius; a cone's reference radius. */
  radius: number;
  axis: Axis;
  /** A cylinder or cone with the material outside it (a hole's wall, or a concave round). */
  inside: boolean;
  /** The face goes all the way round. */
  whole: boolean;
}

/** The limits in mm; undefined where that kind is off. */
export interface DetectLimits {
  maxRoundRadius: number | undefined;
  maxHoleDiameter: number | undefined;
}

/** One round or hole found: its faces (indices, sorted) and size (a radius or a diameter, mm). */
export interface FoundGroup {
  kind: 'round' | 'hole';
  faces: number[];
  size: number;
}

/** mm: a size this much over the limit is still within it, and radii this close are one. */
const SIZE_TOLERANCE = 1e-6;
/** Axis directions this close (the cross product's length) are parallel; points this close are on the axis. */
const PARALLEL = 1e-6;
const NEAR = 1e-4;

/**
 * The rounds and holes of a body under the limits (ADR-0141 §2), rounds
 * first, each its faces once: no face is in two groups. `surface` answers
 * for curved faces and `chain` gives a face's smooth chain (the kernel's
 * `tangentFaces`); both are asked only for faces that need them.
 */
export function findSimplifyGroups(
  description: ShapeDescription,
  surface: (face: number) => SimplifySurface | undefined,
  chain: (face: number) => number[],
  limits: DetectLimits,
): FoundGroup[] {
  const around = neighbours(description);
  const surfaces = new Map<number, SimplifySurface | undefined>();
  const surfaceOf = (face: number) => {
    if (!surfaces.has(face)) {
      const type = description.faces[face]?.type;
      const curved =
        type === 'cylinder' || type === 'cone' || type === 'torus' || type === 'sphere';
      surfaces.set(face, curved ? surface(face) : undefined);
    }
    return surfaces.get(face);
  };
  const faceCount = description.faces.length;
  const taken = new Set<number>();

  // Hole walls: whole inside cylinders, and rings of coaxial inside pieces of one radius.
  const walls: number[][] = [];
  const pieces = new Set<number>();
  for (let face = 0; face < faceCount; face++) {
    const s = surfaceOf(face);
    if (s?.type !== 'cylinder' || !s.inside) continue;
    if (s.whole) walls.push([face]);
    else pieces.add(face);
  }
  const ringFaces = new Set<number>();
  for (const ring of components(pieces, around, (a, b) =>
    sameCylinder(surfaceOf(a), surfaceOf(b)),
  )) {
    if (ring.length >= 2 && sharedEdges(description, new Set(ring)) >= ring.length) {
      walls.push(ring);
      for (const face of ring) ringFaces.add(face);
    }
  }
  const holes: FoundGroup[] = [];
  if (limits.maxHoleDiameter !== undefined) {
    const pick = (face: number): PickSurface | undefined => {
      const s = surfaceOf(face);
      if (!s || s.type === 'sphere') return undefined;
      return { axis: s.axis, inside: s.inside, whole: s.whole || ringFaces.has(face) };
    };
    for (const wall of walls) {
      if (wall.some((face) => taken.has(face))) continue;
      const faces = removeFacesPick(wall, description, pick, (face) => [face]).sort(
        (a, b) => a - b,
      );
      if (faces.length >= faceCount) continue;
      let radius = 0;
      for (const face of faces) {
        const s = surfaceOf(face);
        if (s?.type === 'cylinder' && s.inside) radius = Math.max(radius, s.radius);
      }
      const size = 2 * radius;
      if (size > limits.maxHoleDiameter + SIZE_TOLERANCE) continue;
      for (const face of faces) taken.add(face);
      holes.push({ kind: 'hole', faces, size });
    }
  }

  // Rounds: small curved faces with a smooth neighbour, joined across smooth edges.
  const rounds: FoundGroup[] = [];
  const max = limits.maxRoundRadius;
  if (max !== undefined) {
    const chains = new Map<number, Set<number>>();
    const chainOf = (face: number) => {
      let set = chains.get(face);
      if (!set) {
        set = new Set(chain(face));
        chains.set(face, set);
      }
      return set;
    };
    const candidates = new Set<number>();
    for (let face = 0; face < faceCount; face++) {
      if (taken.has(face) || ringFaces.has(face)) continue;
      const s = surfaceOf(face);
      if (!s || s.type === 'cone' || s.radius > max + SIZE_TOLERANCE) continue;
      if (s.type === 'cylinder' && s.whole) continue;
      if (chainOf(face).size < 2) continue;
      candidates.add(face);
    }
    for (const faces of components(
      candidates,
      around,
      (a, b) => chainOf(a).has(b) || chainOf(b).has(a),
    )) {
      if (faces.length >= faceCount) continue;
      const size = Math.max(...faces.map((face) => surfaceOf(face)?.radius ?? 0));
      rounds.push({ kind: 'round', faces: faces.sort((a, b) => a - b), size });
    }
  }
  return [...rounds, ...holes];
}

/** The connected pieces of `faces` across shared edges where `joins` says two neighbours belong together. */
function components(
  faces: ReadonlySet<number>,
  around: ReadonlyMap<number, number[]>,
  joins: (a: number, b: number) => boolean,
): number[][] {
  const seen = new Set<number>();
  const out: number[][] = [];
  for (const start of [...faces].sort((a, b) => a - b)) {
    if (seen.has(start)) continue;
    seen.add(start);
    const group = [start];
    const queue = [start];
    for (let face = queue.pop(); face !== undefined; face = queue.pop()) {
      for (const next of around.get(face) ?? []) {
        if (seen.has(next) || !faces.has(next) || !joins(face, next)) continue;
        seen.add(next);
        group.push(next);
        queue.push(next);
      }
    }
    out.push(group);
  }
  return out;
}

/** How many edges have every face in `faces` (a closed ring of n faces has n). */
function sharedEdges(description: ShapeDescription, faces: ReadonlySet<number>): number {
  let count = 0;
  for (const edge of description.edges) {
    if (edge.faces.length === 2 && edge.faces.every((face) => faces.has(face))) count++;
  }
  return count;
}

/** Two cylinder faces of one cylinder: coaxial, one radius. */
function sameCylinder(a: SimplifySurface | undefined, b: SimplifySurface | undefined): boolean {
  if (a?.type !== 'cylinder' || b?.type !== 'cylinder') return false;
  return (
    Math.abs(a.radius - b.radius) <= NEAR &&
    parallel(a.axis.direction, b.axis.direction) &&
    distanceToAxis(a.axis.origin, b.axis) <= NEAR
  );
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

function distanceToAxis(point: Vec3, axis: Axis): number {
  const d = axis.direction;
  const length = Math.hypot(...d);
  const v: Vec3 = [point[0] - axis.origin[0], point[1] - axis.origin[1], point[2] - axis.origin[2]];
  const along = (v[0] * d[0] + v[1] * d[1] + v[2] * d[2]) / length;
  return Math.sqrt(Math.max(0, v[0] ** 2 + v[1] ** 2 + v[2] ** 2 - along ** 2));
}

/**
 * Detection's `surface` from the kernel: type, radius and axis from the
 * surface's geometry, inside and all the way round from `threadFace` for
 * cylinders and cones; a torus or sphere is never a wall.
 */
export function kernelSimplifySurface(
  kernel: Kernel,
  shape: ShapeHandle,
  description: ShapeDescription,
): (face: number) => SimplifySurface | undefined {
  return (face) => {
    const type = description.faces[face]?.type;
    if (type !== 'cylinder' && type !== 'cone' && type !== 'torus' && type !== 'sphere') {
      return undefined;
    }
    const geometry = kernel.surfaceGeometry(shape, face);
    if (!geometry.origin || geometry.radius === undefined) return undefined;
    const axis: Axis = { origin: geometry.origin, direction: geometry.direction ?? [0, 0, 1] };
    if (type === 'torus') {
      if (geometry.minorRadius === undefined) return undefined;
      return { type, radius: geometry.minorRadius, axis, inside: false, whole: false };
    }
    if (type === 'sphere')
      return { type, radius: geometry.radius, axis, inside: false, whole: false };
    const thread = kernel.threadFace(shape, face, 'Simplify for Print');
    return {
      type,
      radius: thread?.radius ?? geometry.radius,
      axis,
      inside: thread?.inside ?? false,
      whole: thread?.whole ?? false,
    };
  };
}

// ------------------------------------------------------------------ removal

function evaluateSimplify(ctx: EvalContext<SimplifyForPrintInputs>): FeatureOutput {
  const { kernel } = ctx;
  const kinds = simplifyKinds(ctx.inputs);
  if (!kinds.rounds && !kinds.holes) {
    throw new KernelError('Turn on rounds or holes (or both) to simplify.');
  }
  const limits: DetectLimits = {
    maxRoundRadius: kinds.rounds
      ? positive(ctx.value('maxRoundRadius'), 'round radius')
      : undefined,
    maxHoleDiameter: kinds.holes
      ? positive(ctx.value('maxHoleDiameter'), 'hole diameter')
      : undefined,
  };
  const ids = [...new Set(existing(ctx, ctx.inputs.bodies.refs, 'simplify'))];

  using scope = kernel.scope();
  const bodies = new Map(ctx.bodies);
  const names = new Map<BodyId, TopoNames>();
  const groups: SimplifyGroup[] = [];
  const gone: ShapeHandle[] = [];
  for (const id of ids) {
    const shape = ctx.bodies.get(id) as ShapeHandle;
    if (kernel.isMesh(shape)) {
      throw new KernelError(
        'A mesh body has no rounds or holes to find. Turn it into a solid with Mesh to Solid first.',
      );
    }
    const description = ctx.describe(shape);
    const found = findSimplifyGroups(
      description,
      kernelSimplifySurface(kernel, shape, description),
      (face) => kernel.tangentFaces(shape, face),
      limits,
    );
    if (found.length === 0) continue;
    const result = removeGroups(ctx, shape, ctx.names(id), found);
    if (result.shape !== shape) {
      bodies.set(id, scope.track(result.shape));
      names.set(id, result.names);
    }
    for (const [i, group] of found.entries()) {
      const removed = result.removed.has(i);
      groups.push({
        kind: group.kind,
        body: id,
        size: group.size,
        faces: group.faces.length,
        removed,
      });
      if (removed)
        for (const face of group.faces)
          gone.push(scope.track(kernel.subShape(shape, 'face', face)));
    }
  }

  if (groups.length === 0) ctx.warn('No rounds or holes under the limits: nothing changed.');
  const failed = groups.filter((g) => !g.removed).length;
  if (failed > 0) {
    ctx.warn(
      failed === groups.length
        ? `None of the ${groups.length} rounds and holes found could be removed: the faces around them can't be extended to meet.`
        : `${failed} of the ${groups.length} rounds and holes found couldn't be removed; the rest are.`,
    );
  }
  const previewTools: PreviewTool[] =
    gone.length > 0 ? [{ shape: scope.track(kernel.compound(gone)), style: 'cut' }] : [];
  // Kept only after the last thing that can throw: a failure releases them with the scope.
  for (const id of names.keys()) scope.keep(bodies.get(id) as ShapeHandle);
  for (const tool of previewTools) scope.keep(tool.shape);
  const report: SimplifyFeatureReport = { kind: 'simplifyForPrint', groups };
  return { bodies, names, report, previewTools };
}

function positive(value: number, what: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new KernelError(`The largest ${what} must be greater than 0.`);
  }
  return value;
}

/**
 * Removes the groups from `shape` (ADR-0141 §3): all in one defeaturing,
 * else one by one on the shape the ones before left, each found again by
 * its faces' names. The returned shape is `shape` itself when nothing was
 * removed; otherwise a new one the caller owns (the steps between are
 * released here).
 */
function removeGroups(
  ctx: EvalContext<SimplifyForPrintInputs>,
  shape: ShapeHandle,
  table: TopoNames,
  groups: readonly FoundGroup[],
): { shape: ShapeHandle; names: TopoNames; removed: Set<number> } {
  const { kernel } = ctx;
  const naming = { op: 'simplifyForPrint', feature: ctx.feature.id };
  const removeAll = (from: ShapeHandle, names: TopoNames, faces: readonly number[]) => {
    const result = kernel.removeFaces(from, faces);
    return withHistory(kernel, result, [names], naming);
  };
  const all = groups.flatMap((g) => g.faces);
  try {
    const named = removeAll(shape, table, all);
    return { ...named, removed: new Set(groups.keys()) };
  } catch (error) {
    if (!(error instanceof RemoveFacesError)) throw error;
  }
  // One by one: each success is the next one's shape, released when replaced.
  let current = { shape, names: table };
  const removed = new Set<number>();
  for (const [i, group] of groups.entries()) {
    const faces = group.faces.map((face) => current.names.faces.indexOf(table.faces[face] ?? ''));
    // A face an earlier removal changed beyond its name: this group can't be found whole.
    if (faces.some((face) => face < 0)) continue;
    try {
      const next = removeAll(current.shape, current.names, faces);
      if (current.shape !== shape) kernel.release(current.shape);
      current = next;
      removed.add(i);
    } catch (error) {
      if (!(error instanceof RemoveFacesError)) {
        if (current.shape !== shape) kernel.release(current.shape);
        throw error;
      }
    }
  }
  return { ...current, removed };
}
