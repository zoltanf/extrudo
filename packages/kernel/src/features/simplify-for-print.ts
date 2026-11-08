/**
 * The Simplify for Print feature in the kernel (ADR-0141, #79): finds the
 * rounds under a radius, the chamfers under a size and the holes under a
 * diameter on each chosen body and removes them with Remove Faces'
 * defeaturing (`kernel.removeFaces`, ADR-0099).
 *
 * Detection (§2) is TypeScript over the shape description and two existing
 * facade queries (`surfaceGeometry`, `threadFace`), so it needs no new WASM;
 * two faces meet smoothly across an edge when their normals at its midpoint
 * are parallel (`smoothAcross`):
 * - a **hole** is a closed cylindrical wall (one face all the way round, or
 *   a ring of coaxial pieces of one radius) with the faces Remove Faces'
 *   hole rule takes with it (`removeFacesPick`: floor, counterbore,
 *   countersink, drill point) and the round at its mouth (a torus on its
 *   axis next to its wall); its size is the widest wall's diameter;
 * - a **round** is a run of cylinder (not all the way round), torus and
 *   sphere faces under the radius, joined across smooth edges; a face with
 *   no smooth neighbour is no round;
 * - a **chamfer** is a narrow flat strip between two flat faces that meet
 *   at an angle, or a cone between two circles that meets its neighbours
 *   at an angle; its size is its longer leg (how far it cuts back into
 *   either face); touching chamfers are one, with any corner patch among
 *   them (chamfers on most of its sides; flat, or the curved one OCCT makes
 *   where unequal chamfers meet).
 *
 * Removal (§3): rounds, chamfers, then holes, all in one defeaturing first;
 * when that fails, all but the ones OCCT names in one, then those alone
 * (else each alone), on the shape the ones before left,
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
  /** A torus's major radius (its tube's centre circle). */
  major?: number;
}

/** The limits in mm; undefined where that kind is off. */
export interface DetectLimits {
  maxRoundRadius: number | undefined;
  /** Undefined or absent: chamfers stay. */
  maxChamferSize?: number | undefined;
  maxHoleDiameter: number | undefined;
}

/**
 * One round, chamfer or hole found: its faces (indices, sorted) and size
 * (a radius, a chamfer's longer leg or a diameter, mm).
 */
export interface FoundGroup {
  kind: 'round' | 'chamfer' | 'hole';
  faces: number[];
  size: number;
}

/** mm: a size this much over the limit is still within it, and radii this close are one. */
const SIZE_TOLERANCE = 1e-6;
/** Axis directions this close (the cross product's length) are parallel; points this close are on the axis. */
const PARALLEL = 1e-6;
const NEAR = 1e-4;
/**
 * The cosine range between a chamfer's normal and each neighbour's: not
 * square to it (a rib's top between two walls) and not smooth with it
 * (under about 1°, a tangent face).
 */
const CHAMFER_COS = { min: 0.05, max: 0.99985 };
/** Two faces whose normals at an edge's midpoint are within about 2° meet smoothly there. */
const SMOOTH_COS = Math.cos((2 * Math.PI) / 180);

/**
 * The rounds, chamfers and holes of a body under the limits (ADR-0141 §2),
 * in that order, each its faces once: no face is in two groups. `surface`
 * answers for curved faces, asked only for faces that need it.
 */
export function findSimplifyGroups(
  description: ShapeDescription,
  surface: (face: number) => SimplifySurface | undefined,
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
  const index = indexOf(description);
  const smooth = new Map<number, Set<number>>();
  /** The faces `face` meets smoothly across an edge. */
  const smoothOf = (face: number) => {
    let set = smooth.get(face);
    if (!set) {
      set = new Set();
      for (const edge of index.edges.get(face) ?? []) {
        const other = edge.faces.find((f) => f !== face);
        if (other === undefined || edge.faces.length !== 2) continue;
        if (smoothAcross(edge.midpoint, face, other, description, surfaceOf)) set.add(other);
      }
      smooth.set(face, set);
    }
    return set;
  };

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
      const faces = withMouth(
        removeFacesPick(wall, description, pick, (face) => [face]),
        description,
        around,
        surfaceOf,
      ).sort((a, b) => a - b);
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
    const candidates = new Set<number>();
    for (let face = 0; face < faceCount; face++) {
      if (taken.has(face) || ringFaces.has(face)) continue;
      const s = surfaceOf(face);
      if (!s || s.type === 'cone' || s.radius > max + SIZE_TOLERANCE) continue;
      if (s.type === 'cylinder' && s.whole) continue;
      if (smoothOf(face).size === 0) continue;
      candidates.add(face);
    }
    for (const faces of components(candidates, around, (a, b) => smoothOf(a).has(b))) {
      if (faces.length >= faceCount) continue;
      const size = Math.max(...faces.map((face) => surfaceOf(face)?.radius ?? 0));
      rounds.push({ kind: 'round', faces: faces.sort((a, b) => a - b), size });
    }
  }

  // Chamfers: narrow bevels, joined where they touch, with the corner patches among them.
  const chamfers: FoundGroup[] = [];
  const maxChamfer = limits.maxChamferSize;
  if (maxChamfer !== undefined) {
    const bevels = new Map<number, Bevel>();
    for (let face = 0; face < faceCount; face++) {
      if (taken.has(face) || ringFaces.has(face)) continue;
      const bevel = bevelOf(face, description, index, surfaceOf, smoothOf);
      if (bevel) bevels.set(face, bevel);
    }
    // A face between two bevels (an octagon's) is no chamfer when one of them is at most its size.
    const sizes = new Map<number, number>();
    for (const [face, { size, between }] of bevels) {
      if (size > maxChamfer + NEAR) continue;
      if (between.some((other) => (bevels.get(other)?.size ?? Infinity) <= size + NEAR)) continue;
      sizes.set(face, size);
    }
    const members = new Set(sizes.keys());
    for (let face = 0; face < faceCount; face++) {
      if (members.has(face) || taken.has(face) || ringFaces.has(face)) continue;
      // A corner patch: chamfers on most sides (two at least), and about their size (not the face
      // they ring). Where unequal chamfers meet, OCCT's patch is a B-spline that also touches a
      // flat face; one left behind is stretched along the edges the chamfers leave.
      const next = around.get(face) ?? [];
      const beside = next.filter((n) => sizes.has(n));
      if (beside.length < 2 || 2 * beside.length <= next.length) continue;
      const reach = 2 * Math.max(...beside.map((n) => sizes.get(n) ?? 0));
      const centre = description.faces[face]?.centroid ?? [0, 0, 0];
      if ((index.corners.get(face) ?? []).every((p) => length(sub(p, centre)) <= reach)) {
        members.add(face);
      }
    }
    for (const faces of components(members, around, () => true)) {
      if (faces.length >= faceCount || !faces.some((face) => sizes.has(face))) continue;
      const size = Math.max(...faces.map((face) => sizes.get(face) ?? 0));
      chamfers.push({ kind: 'chamfer', faces: faces.sort((a, b) => a - b), size });
    }
  }
  return [...rounds, ...chamfers, ...holes];
}

/**
 * A hole's faces with the round at its mouth: the tori on the hole's axis
 * next to one of its walls (an inside cylinder or cone), so a hole whose
 * edge is rounded over the round limit still goes whole.
 */
function withMouth(
  faces: readonly number[],
  description: ShapeDescription,
  around: ReadonlyMap<number, number[]>,
  surfaceOf: (face: number) => SimplifySurface | undefined,
): number[] {
  const out = new Set(faces);
  for (const face of faces) {
    const wall = surfaceOf(face);
    if ((wall?.type !== 'cylinder' && wall?.type !== 'cone') || !wall.inside) continue;
    for (const next of around.get(face) ?? []) {
      if (out.has(next) || description.faces[next]?.type !== 'torus') continue;
      const torus = surfaceOf(next);
      if (torus && coaxial(torus.axis, wall.axis)) out.add(next);
    }
  }
  return [...out];
}

/** A face shaped like a chamfer: its size (the longer leg, mm) and the two faces it bevels between. */
interface Bevel {
  size: number;
  between: number[];
}

/**
 * A face's chamfer shape, or undefined when it has none (ADR-0141 §2):
 * - a plane with two parallel straight edges on two flat neighbours that
 *   meet at an angle, at an angle to both, and no wider than the strip
 *   between those edges: the legs run from each edge to the line where the
 *   neighbours would meet;
 * - a cone with its circles at two levels, not smooth with its neighbours:
 *   the legs are the change in radius and the change along the axis.
 */
function bevelOf(
  face: number,
  description: ShapeDescription,
  index: FaceIndex,
  surfaceOf: (face: number) => SimplifySurface | undefined,
  smoothOf: (face: number) => ReadonlySet<number>,
): Bevel | undefined {
  const info = description.faces[face];
  if (info?.type === 'cone') {
    const own = surfaceOf(face);
    if (!own) return undefined;
    const levels: [number, number][] = [];
    const between = new Set<number>();
    for (const edge of index.edges.get(face) ?? []) {
      if (edge.type !== 'circle') continue;
      for (const other of edge.faces) if (other !== face) between.add(other);
      const v = sub(edge.midpoint, own.axis.origin);
      const level: [number, number] = [
        distanceToAxis(edge.midpoint, own.axis),
        dot(v, unit(own.axis.direction)),
      ];
      if (
        !levels.some((l) => Math.abs(l[0] - level[0]) <= NEAR && Math.abs(l[1] - level[1]) <= NEAR)
      )
        levels.push(level);
    }
    const [a, b] = levels;
    if (levels.length !== 2 || !a || !b) return undefined;
    const legs = [Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1])];
    if (legs.some((leg) => leg <= NEAR)) return undefined;
    if (smoothOf(face).size > 0) return undefined;
    return { size: Math.max(...legs), between: [...between] };
  }
  if (info?.type !== 'plane' || !info.direction) return undefined;
  const normal = unit(info.direction);
  // Straight edges on flat neighbours at an angle to this face.
  const rails: { point: Vec3; along: Vec3; other: number; normal: Vec3 }[] = [];
  for (const edge of index.edges.get(face) ?? []) {
    if (edge.type !== 'line' || !edge.direction || edge.faces.length !== 2) continue;
    const other = edge.faces[0] === face ? edge.faces[1] : edge.faces[0];
    const otherInfo = other === undefined ? undefined : description.faces[other];
    if (other === undefined || otherInfo?.type !== 'plane' || !otherInfo.direction) continue;
    const n = unit(otherInfo.direction);
    const cos = dot(normal, n);
    if (cos < CHAMFER_COS.min || cos > CHAMFER_COS.max) continue;
    rails.push({ point: edge.midpoint, along: unit(edge.direction), other, normal: n });
  }
  if (rails.length < 2) return undefined;
  const corners = index.corners.get(face) ?? [];
  let best: Bevel | undefined;
  for (const [i, a] of rails.entries()) {
    for (const b of rails.slice(i + 1)) {
      if (a.other === b.other || !parallel(a.along, b.along) || parallel(a.normal, b.normal)) {
        continue;
      }
      const corner = meet(a.normal, a.point, b.normal, b.point, a.along, a.point);
      if (!corner) continue;
      // b's edge in a's cross-section, and the strip across the edges.
      const bPoint = sub(b.point, scale(a.along, dot(sub(b.point, a.point), a.along)));
      const across = unit(cross(normal, a.along));
      const [lo, hi] = [dot(a.point, across), dot(bPoint, across)].sort((x, y) => x - y) as [
        number,
        number,
      ];
      if (corners.some((p) => dot(p, across) < lo - NEAR || dot(p, across) > hi + NEAR)) continue;
      const size = Math.max(length(sub(corner, a.point)), length(sub(corner, bPoint)));
      if (best === undefined || size < best.size) best = { size, between: [a.other, b.other] };
    }
  }
  return best;
}

/**
 * Whether faces `a` and `b` meet smoothly at `point` on their shared edge:
 * their normals there are parallel (either sign), within about 2°. A face
 * whose normal isn't known (a spline) meets nothing smoothly.
 */
function smoothAcross(
  point: Vec3,
  a: number,
  b: number,
  description: ShapeDescription,
  surfaceOf: (face: number) => SimplifySurface | undefined,
): boolean {
  const na = normalAt(a, point, description, surfaceOf);
  const nb = normalAt(b, point, description, surfaceOf);
  if (!na || !nb) return false;
  return Math.abs(dot(unit(na), unit(nb))) >= SMOOTH_COS;
}

/** A face's normal at a point on it, either sign; undefined where unknown or on an axis. */
function normalAt(
  face: number,
  point: Vec3,
  description: ShapeDescription,
  surfaceOf: (face: number) => SimplifySurface | undefined,
): Vec3 | undefined {
  const info = description.faces[face];
  if (info?.type === 'plane') return info.direction;
  const s = surfaceOf(face);
  if (!s) return undefined;
  const d = unit(s.axis.direction);
  const v = sub(point, s.axis.origin);
  const radial = sub(v, scale(d, dot(v, d)));
  if (s.type === 'sphere') return length(v) > NEAR ? v : undefined;
  if (length(radial) <= NEAR) return undefined;
  if (s.type === 'cylinder') return radial;
  if (s.type === 'torus') {
    return s.major === undefined ? undefined : sub(v, scale(unit(radial), s.major));
  }
  // A cone, its axis' origin the apex: the radial direction less its part along the line to the apex.
  const along = unit(v);
  const r = unit(radial);
  return sub(r, scale(along, dot(r, along)));
}

/** Each face's edges and vertex points. */
interface FaceIndex {
  edges: Map<number, ShapeDescription['edges']>;
  corners: Map<number, Vec3[]>;
}

function indexOf(description: ShapeDescription): FaceIndex {
  const edges = new Map<number, ShapeDescription['edges']>();
  const corners = new Map<number, Vec3[]>();
  const add = <T>(map: Map<number, T[]>, face: number, item: T) => {
    const list = map.get(face);
    if (list) list.push(item);
    else map.set(face, [item]);
  };
  for (const edge of description.edges) for (const face of edge.faces) add(edges, face, edge);
  for (const vertex of description.vertices)
    for (const face of vertex.faces) add(corners, face, vertex.point);
  return { edges, corners };
}

/** The point on three planes (normal, point on it), or undefined when they don't meet in one. */
function meet(n1: Vec3, p1: Vec3, n2: Vec3, p2: Vec3, n3: Vec3, p3: Vec3): Vec3 | undefined {
  const c23 = cross(n2, n3);
  const det = dot(n1, c23);
  if (Math.abs(det) < 1e-9) return undefined;
  const sum = add(
    add(scale(c23, dot(n1, p1)), scale(cross(n3, n1), dot(n2, p2))),
    scale(cross(n1, n2), dot(n3, p3)),
  );
  return scale(sum, 1 / det);
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

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const length = (a: Vec3) => Math.hypot(...a);
const unit = (a: Vec3): Vec3 => scale(a, 1 / (length(a) || 1));
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

function coaxial(a: Axis, b: Axis): boolean {
  return parallel(a.direction, b.direction) && distanceToAxis(a.origin, b) <= NEAR;
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
      return {
        type,
        radius: geometry.minorRadius,
        major: geometry.radius,
        axis,
        inside: false,
        whole: false,
      };
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
  if (!kinds.rounds && !kinds.chamfers && !kinds.holes) {
    throw new KernelError('Turn on rounds, chamfers or holes to simplify.');
  }
  const limits: DetectLimits = {
    maxRoundRadius: kinds.rounds
      ? positive(ctx.value('maxRoundRadius'), 'round radius')
      : undefined,
    maxChamferSize: kinds.chamfers
      ? positive(ctx.value('maxChamferSize'), 'chamfer size')
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
        'A mesh body has no rounds, chamfers or holes to find. Turn it into a solid with Mesh to Solid first.',
      );
    }
    const description = ctx.describe(shape);
    const found = findSimplifyGroups(
      description,
      kernelSimplifySurface(kernel, shape, description),
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

  if (groups.length === 0) ctx.warn('Nothing under the limits: the body is unchanged.');
  const failed = groups.filter((g) => !g.removed).length;
  if (failed > 0) {
    ctx.warn(
      failed === groups.length
        ? `None of the ${groups.length} found could be removed: the faces around them can't be extended to meet.`
        : `${failed} of the ${groups.length} found couldn't be removed; the rest are.`,
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
 * Removes the groups from `shape` (ADR-0141 §3): all in one defeaturing;
 * else all but the groups whose faces OCCT named as failing, in one, then
 * those alone; else each alone. Alone means on the shape the ones before
 * left, each group found again by its faces' names. The returned shape is
 * `shape` itself when nothing was removed; otherwise a new one the caller
 * owns (the steps between are released here).
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
  const facesOf = (list: readonly number[]) => list.flatMap((i) => groups[i]?.faces ?? []);
  const every = [...groups.keys()];
  let failing: Set<number>;
  try {
    return { ...removeAll(shape, table, facesOf(every)), removed: new Set(every) };
  } catch (error) {
    if (!(error instanceof RemoveFacesError)) throw error;
    failing = new Set(error.failed);
  }
  // Without the groups OCCT named, in one; then those alone.
  const named = every.filter((i) => groups[i]?.faces.some((face) => failing.has(face)));
  if (named.length > 0 && named.length < every.length) {
    const rest = every.filter((i) => !named.includes(i));
    let first: { shape: ShapeHandle; names: TopoNames } | undefined;
    try {
      first = removeAll(shape, table, facesOf(rest));
    } catch (error) {
      if (!(error instanceof RemoveFacesError)) throw error;
    }
    if (first) return alone(first, named, new Set(rest));
  }
  return alone({ shape, names: table }, every, new Set());

  /** Each of `order` alone: each success is the next one's shape, released when replaced. */
  function alone(
    start: { shape: ShapeHandle; names: TopoNames },
    order: readonly number[],
    removed: Set<number>,
  ): { shape: ShapeHandle; names: TopoNames; removed: Set<number> } {
    let current = start;
    for (const i of order) {
      const group = groups[i];
      if (!group) continue;
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
}
