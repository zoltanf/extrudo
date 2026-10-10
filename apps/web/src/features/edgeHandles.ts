/**
 * The in-view radius/distance handle of a fillet or chamfer set (P4-12,
 * ADR-0038/ADR-0043 amendments): an arrow standing on the set's first edge
 * and pointing along the bisector of its two faces' outward normals there, so
 * dragging it away from the body grows the value.
 *
 * Everything comes from the model meshes: an edge's middle from its polyline
 * and each face's normal from the mesh node nearest that middle (a flat
 * face's normal is the same everywhere, so its own mean is exact). The two
 * faces are the ones in the edge's own name (`e[<face>|<face>]`, ADR-0005).
 * Where any of that is missing — a seam edge with one face, a face the meshes
 * don't have, two faces that run smoothly into each other, so there is no
 * corner to point away from — the handle is left out rather than guessed.
 *
 * **Every set has one** (P4-12, ADR-0038/0043 amendments): `setDistanceManipulator`
 * is called per set that has edges, and the dialog's overlay draws the set
 * last focused prominent and the rest quiet. **A variable fillet set has two**
 * (`variableSetManipulators`): Radius where the round starts and End radius
 * where it ends, each on the bisector at that end of the tangent chain. **A
 * chamfer of the unequal types** takes its distances along the faces
 * themselves (`faceDirections`, `chamferManipulators`), read locally at the
 * edge's middle (`localFaceDirections`), so a curved edge and a curved face
 * work too; **a distance-and-angle set's Angle is an arc** from the reference
 * face's direction towards the other face's, about the edge itself (P4-12,
 * ADR-0043's fourth amendment).
 */
import type { BodyId, GeomRef, Vec3 } from '@extrudo/core';
import { type BodyMesh, parseCompound } from '@extrudo/kernel';
import { meshSurfaceFrameAt } from './geometry';
import type { DialogValues, Manipulator } from './spec';

/** Below this the two normals are too much alike for a bisector that means anything. */
const MIN_BISECTOR = 0.5;

/**
 * Two faces whose normals agree within this much run smoothly into each other,
 * so there is no corner for a chamfer handle to point away from (ADR-0038).
 */
const SMOOTH_COS = 0.5;

/** The two local face directions point within this much of each other: no corner. */
const ALIGNED_COS = Math.cos((10 * Math.PI) / 180);

/** A point on a body's mesh. */
type MeshPoint = { mesh: BodyMesh; point: Vec3 };

/**
 * The middle of an edge's polyline: its middle point, or the middle of the
 * two middle ones (a straight edge has two). Undefined where the edge is a
 * degenerate point.
 */
function edgeMidpoint(mesh: BodyMesh, edge: number): Vec3 | undefined {
  const first = mesh.edgeRanges[2 * edge] ?? 0;
  const count = mesh.edgeRanges[2 * edge + 1] ?? 0;
  if (count < 2) return undefined;
  const at = (i: number): Vec3 => [
    mesh.edgePoints[3 * i] ?? 0,
    mesh.edgePoints[3 * i + 1] ?? 0,
    mesh.edgePoints[3 * i + 2] ?? 0,
  ];
  if (count % 2 === 1) return at(first + (count - 1) / 2);
  const a = at(first + count / 2 - 1);
  const b = at(first + count / 2);
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
}

/**
 * The unit normal of the face named `name` at `at`, and the body it belongs
 * to. Undefined when no mesh has that face, or it has no normal there.
 */
function faceNormalAt(
  bodies: Readonly<Record<BodyId, BodyMesh>>,
  name: string,
  at: Vec3,
): (MeshPoint & { normal: Vec3 }) | undefined {
  for (const mesh of Object.values(bodies)) {
    const face = mesh.faceIds?.indexOf(name) ?? -1;
    if (face < 0) continue;
    const frame = meshSurfaceFrameAt(mesh, face, at);
    if (!frame) return undefined;
    const n = frame.normal;
    const length = Math.hypot(n[0], n[1], n[2]);
    if (!(length > 0)) return undefined;
    return {
      mesh,
      point: frame.origin,
      normal: [n[0] / length, n[1] / length, n[2] / length],
    };
  }
  return undefined;
}

/** Where an edge's handle sits: a point and the direction its arrow points. */
export interface EdgeHandle {
  /** The middle of the edge, world mm. */
  origin: Vec3;
  /** Unit length: the bisector of the two faces' outward normals there. */
  direction: Vec3;
}

/**
 * Where an edge's handle sits: the middle of the edge and the bisector of
 * its two faces' outward normals there. That bisector points into the void
 * whether the corner is convex or concave (both normals point away from the
 * material), so dragging along it always grows the value. Undefined where
 * the handle can't be placed honestly.
 */
export function edgeHandle(
  bodies: Readonly<Record<BodyId, BodyMesh>>,
  ref: GeomRef | undefined,
  /** Where on the edge the handle stands (an end of a chain); default its middle. */
  at?: Vec3,
): EdgeHandle | undefined {
  if (ref?.kind !== 'edge') return undefined;
  const parsed = parseCompound(ref.id);
  // Two faces: a seam edge has one, a non-manifold edge more.
  if (parsed?.kind !== 'edge' || parsed.faces.length !== 2) return undefined;
  let origin: Vec3 | undefined;
  let edgeMesh: BodyMesh | undefined;
  for (const mesh of Object.values(bodies)) {
    const edge = mesh.edgeIds?.indexOf(ref.id) ?? -1;
    if (edge < 0) continue;
    origin = at ?? edgeMidpoint(mesh, edge);
    edgeMesh = mesh;
    break;
  }
  if (!origin || !edgeMesh) return undefined;
  const normals = parsed.faces.map((name) => faceNormalAt(bodies, name, origin as Vec3));
  if (normals.some((n) => n === undefined || n.mesh !== edgeMesh)) return undefined;
  const [one, other] = normals as [MeshPoint & { normal: Vec3 }, MeshPoint & { normal: Vec3 }];
  const sum: Vec3 = [
    one.normal[0] + other.normal[0],
    one.normal[1] + other.normal[1],
    one.normal[2] + other.normal[2],
  ];
  const length = Math.hypot(sum[0], sum[1], sum[2]);
  if (length < MIN_BISECTOR) return undefined;
  return { origin, direction: [sum[0] / length, sum[1] / length, sum[2] / length] };
}

/** What the dialog overlay needs besides the handle itself (`DistanceManipulator`). */
export interface HandleStyle {
  /**
   * Fields whose focus makes this set's handle the prominent one: the set's
   * pick field, its toggles. Its own field always does.
   */
  follows?: readonly string[];
}

/** An `EdgeHandle` as a quiet distance arrow of `field`. */
function asManipulator(field: string, at: EdgeHandle, style: HandleStyle): Manipulator {
  return {
    kind: 'distance',
    field,
    origin: at.origin,
    direction: at.direction,
    quiet: true,
    ...(style.follows && { follows: style.follows }),
  };
}

/**
 * The handle of a set's first edge for one of its length fields, or nothing
 * where the edge can't carry one. The value is the field's own: a variable
 * fillet's arrows move Radius and End radius, each its own.
 */
export function setDistanceManipulator(
  field: string,
  edgesField: string,
  values: DialogValues,
  bodies: Readonly<Record<BodyId, BodyMesh>>,
  style: HandleStyle = {},
): Manipulator | undefined {
  const at = edgeHandle(bodies, values.refs[edgesField]?.[0]);
  return at ? asManipulator(field, at, style) : undefined;
}

/** The two ends of a set's tangent chain, in the direction the round runs. */
export interface ChainEnds {
  /** Where the round starts (radius, or End radius when swapped), and the chain's edge there. */
  start: { point: Vec3; edge: GeomRef };
  /** Where it ends, and the chain's edge there. */
  end: { point: Vec3; edge: GeomRef };
}

/** A point as a map key, to a micron. */
const keyOf = (p: Vec3) =>
  `${Math.round(p[0] * 1e3)},${Math.round(p[1] * 1e3)},${Math.round(p[2] * 1e3)}`;

/** The two end points of an edge's polyline in a mesh, or undefined where it has none. */
function edgeEnds(
  bodies: Readonly<Record<BodyId, BodyMesh>>,
  ref: GeomRef,
): [Vec3, Vec3] | undefined {
  for (const mesh of Object.values(bodies)) {
    const edge = mesh.edgeIds?.indexOf(ref.id) ?? -1;
    if (edge < 0) continue;
    const first = mesh.edgeRanges[2 * edge] ?? 0;
    const count = mesh.edgeRanges[2 * edge + 1] ?? 0;
    if (count < 2) return undefined;
    const at = (i: number): Vec3 => [
      mesh.edgePoints[3 * i] ?? 0,
      mesh.edgePoints[3 * i + 1] ?? 0,
      mesh.edgePoints[3 * i + 2] ?? 0,
    ];
    return [at(first), at(first + count - 1)];
  }
  return undefined;
}

/**
 * Where a variable round starts and ends along its chain (P4-12). OCCT runs
 * the radius from the chain's start to its end, and **the chain's start is
 * the end its edges' own directions leave from** (measured on a box's twelve
 * edges and on a line-arc-line chain whichever edge came first: the Radius
 * lands at the end the polylines flow away from). The chain is walked from
 * one free end over the edges' shared end points; a closed chain has no ends,
 * a branching or broken one is no chain, and edges whose polylines disagree
 * about the direction leave nothing to say which end is the start — all of
 * those give undefined, so the arrows are left out rather than put on the
 * wrong end.
 */
export function chainEnds(
  bodies: Readonly<Record<BodyId, BodyMesh>>,
  edges: readonly GeomRef[],
): ChainEnds | undefined {
  if (edges.length === 0) return undefined;
  const found: { ref: GeomRef; from: Vec3; to: Vec3 }[] = [];
  for (const ref of edges) {
    const ends = edgeEnds(bodies, ref);
    if (!ends) return undefined;
    found.push({ ref, from: ends[0], to: ends[1] });
  }
  const degree = new Map<string, number>();
  for (const e of found) {
    for (const p of [e.from, e.to]) degree.set(keyOf(p), (degree.get(keyOf(p)) ?? 0) + 1);
  }
  const free = [...degree].filter(([, d]) => d === 1).map(([k]) => k);
  if (free.length !== 2 || [...degree.values()].some((d) => d > 2)) return undefined;
  // Walk from the first free end; every edge entered at its own start agrees.
  const used = new Set<number>();
  let at = free[0] as string;
  let forward = 0;
  let backward = 0;
  let last: { edge: GeomRef; point: Vec3 } | undefined;
  let firstEdge: { edge: GeomRef; point: Vec3 } | undefined;
  while (used.size < found.length) {
    const next = found.findIndex(
      (e, i) => !used.has(i) && (keyOf(e.from) === at || keyOf(e.to) === at),
    );
    if (next < 0) return undefined;
    used.add(next);
    const e = found[next] as (typeof found)[number];
    const entersAtStart = keyOf(e.from) === at;
    if (entersAtStart) forward++;
    else backward++;
    const entry = entersAtStart ? e.from : e.to;
    const exit = entersAtStart ? e.to : e.from;
    firstEdge ??= { edge: e.ref, point: entry };
    last = { edge: e.ref, point: exit };
    at = keyOf(exit);
  }
  if (!firstEdge || !last || at !== free[1]) return undefined;
  // Mixed directions: nothing says which end OCCT starts at.
  if (forward > 0 && backward > 0) return undefined;
  return forward > 0 ? { start: firstEdge, end: last } : { start: last, end: firstEdge };
}

/**
 * The two handles of a variable fillet set: `startField` where the round
 * starts and `endField` where it ends, each on the bisector of the faces at
 * that end of the chain. Fewer where an end can't be read (a closed chain has
 * none); the fields themselves still work.
 */
export function variableSetManipulators(
  fields: { start: string; end: string },
  edgesField: string,
  values: DialogValues,
  bodies: Readonly<Record<BodyId, BodyMesh>>,
  /** Per field: the style of the arrow that writes it. */
  style: Readonly<Record<string, HandleStyle>> = {},
): Manipulator[] {
  const ends = chainEnds(bodies, values.refs[edgesField] ?? []);
  if (!ends) return [];
  const out: Manipulator[] = [];
  for (const which of ['start', 'end'] as const) {
    const at = edgeHandle(bodies, ends[which].edge, ends[which].point);
    if (at) out.push(asManipulator(fields[which], at, style[fields[which]] ?? {}));
  }
  return out;
}

/** A face's unit direction away from one of its straight edges, in its own plane. */
export interface FaceDirections {
  /** The middle of the edge, world mm. */
  origin: Vec3;
  /** Along the reference face, across the edge, into the face. */
  first: Vec3;
  /** Along the other face, likewise. */
  second: Vec3;
}

const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const unit = (v: Vec3): Vec3 | undefined => {
  const length = Math.hypot(v[0], v[1], v[2]);
  return length > 1e-12 ? [v[0] / length, v[1] / length, v[2] / length] : undefined;
};

/** The middle of an edge's polyline and the direction of the segment there. */
interface EdgeLocator {
  point: Vec3;
  /** Unit direction of the polyline segment containing the middle (sign arbitrary). */
  tangent: Vec3;
}

/**
 * Where an edge's handle stands and which way the edge runs there (P4-12,
 * ADR-0043's fourth amendment): the point halfway along the display polyline
 * **by arc length** — for a closed loop, halfway round it — and the direction
 * of the segment that contains it. A straight two-point edge gives exactly
 * the old middle. Undefined for a degenerate edge (fewer than two points).
 */
export function edgeLocator(mesh: BodyMesh, edge: number): EdgeLocator | undefined {
  const first = mesh.edgeRanges[2 * edge] ?? 0;
  const count = mesh.edgeRanges[2 * edge + 1] ?? 0;
  if (count < 2) return undefined;
  const at = (i: number): Vec3 => [
    mesh.edgePoints[3 * i] ?? 0,
    mesh.edgePoints[3 * i + 1] ?? 0,
    mesh.edgePoints[3 * i + 2] ?? 0,
  ];
  let total = 0;
  for (let i = 0; i < count - 1; i++) total += Math.hypot(...sub(at(first + i + 1), at(first + i)));
  if (!(total > 0)) return undefined;
  let remaining = total / 2;
  for (let i = 0; i < count - 1; i++) {
    const a = at(first + i);
    const b = at(first + i + 1);
    const span = sub(b, a);
    const length = Math.hypot(...span);
    if (remaining <= length || i === count - 2) {
      const t = length > 0 ? remaining / length : 0;
      const point: Vec3 = [a[0] + span[0] * t, a[1] + span[1] * t, a[2] + span[2] * t];
      const tangent = unit(span);
      return tangent ? { point, tangent } : undefined;
    }
    remaining -= length;
  }
  return undefined;
}

/** A face triangle touched: its own outward normal and its centroid. */
interface TriangleAt {
  normal: Vec3;
  centroid: Vec3;
}

/**
 * The face `face`'s display triangle nearest `at`: its own normal (from the
 * triangle's winding, counter-clockwise seen from outside) and its centroid.
 * A flat face gives its one normal, a curved face the one where `at` is.
 */
export function nearestTriangleNormal(
  mesh: BodyMesh,
  face: number,
  at: Vec3,
): TriangleAt | undefined {
  const first = mesh.faceRanges[2 * face] ?? 0;
  const count = mesh.faceRanges[2 * face + 1] ?? 0;
  if (count <= 0) return undefined;
  const p = mesh.positions;
  const node = (i: number): Vec3 => [p[3 * i] ?? 0, p[3 * i + 1] ?? 0, p[3 * i + 2] ?? 0];
  let best: TriangleAt | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let t = first; t < first + count; t++) {
    const a = node(mesh.indices[3 * t] ?? 0);
    const b = node(mesh.indices[3 * t + 1] ?? 0);
    const c = node(mesh.indices[3 * t + 2] ?? 0);
    const centroid: Vec3 = [
      (a[0] + b[0] + c[0]) / 3,
      (a[1] + b[1] + c[1]) / 3,
      (a[2] + b[2] + c[2]) / 3,
    ];
    const distance = Math.hypot(...sub(centroid, at));
    if (distance >= bestDistance) continue;
    const normal = unit(cross(sub(b, a), sub(c, a)));
    if (!normal) continue;
    bestDistance = distance;
    best = { normal, centroid };
  }
  return best;
}

/**
 * The two directions a chamfer's distances run, read **locally at the edge's
 * middle** (P4-12, ADR-0043's fourth amendment): each face's normal from its
 * display triangle nearest that point, and the direction across the face as
 * `tangent × normal`, signed towards the triangle's centroid, so it runs into
 * the face and away from the edge. `faceA` gives `first`, `faceB` `second`.
 * Works on a curved edge and a curved face. Undefined where it can't be read:
 * a degenerate edge, a face the mesh lacks, two faces whose normals agree
 * within 60° (a smooth chain), or two directions within 10° of each other.
 */
export function localFaceDirections(
  mesh: BodyMesh,
  edge: number,
  faceA: number,
  faceB: number,
): FaceDirections | undefined {
  const loc = edgeLocator(mesh, edge);
  if (!loc) return undefined;
  const a = nearestTriangleNormal(mesh, faceA, loc.point);
  const b = nearestTriangleNormal(mesh, faceB, loc.point);
  if (!a || !b) return undefined;
  if (dot(a.normal, b.normal) > SMOOTH_COS) return undefined;
  const into = (tri: TriangleAt): Vec3 | undefined => {
    const side = cross(loc.tangent, tri.normal);
    const direction = unit(side);
    if (!direction) return undefined;
    const lean = dot(direction, sub(tri.centroid, loc.point));
    if (Math.abs(lean) < 1e-9) return undefined;
    return lean > 0 ? direction : [-direction[0], -direction[1], -direction[2]];
  };
  const first = into(a);
  const second = into(b);
  if (!first || !second) return undefined;
  if (dot(first, second) > ALIGNED_COS) return undefined;
  return { origin: loc.point, first, second };
}

/**
 * Where a chamfer's two distances run (P4-12): from the middle of the set's
 * first edge, along each face across the edge into the face — read locally, so
 * a curved edge and a curved face work too (`localFaceDirections`).
 * `reference` is the face that takes the first distance: the picked one, else
 * the lower-numbered of the edge's two (the kernel's own rule) or, with
 * `flip`, the other. Undefined where that can't be read reliably: a seam edge,
 * a face the meshes lack, a reference face that isn't one of the edge's two,
 * or a smooth or nearly straight corner — the dialog then keeps its single
 * bisector handle.
 */
export function faceDirections(
  bodies: Readonly<Record<BodyId, BodyMesh>>,
  ref: GeomRef | undefined,
  reference: GeomRef | undefined,
  flip: boolean,
): FaceDirections | undefined {
  if (ref?.kind !== 'edge') return undefined;
  const parsed = parseCompound(ref.id);
  if (parsed?.kind !== 'edge' || parsed.faces.length !== 2) return undefined;
  const found = Object.values(bodies).find((m) => (m.edgeIds?.indexOf(ref.id) ?? -1) >= 0);
  if (!found) return undefined;
  const edge = found.edgeIds?.indexOf(ref.id) ?? -1;
  const [nameA, nameB] = parsed.faces as [string, string];
  const order = (name: string) => found.faceIds?.indexOf(name) ?? -1;
  if (order(nameA) < 0 || order(nameB) < 0) return undefined;
  const [low, high] = order(nameA) < order(nameB) ? [nameA, nameB] : [nameB, nameA];
  let one = flip ? high : low;
  if (reference) {
    if (reference.kind !== 'face' || (reference.id !== nameA && reference.id !== nameB)) {
      return undefined;
    }
    one = reference.id;
  }
  const other = one === nameA ? nameB : nameA;
  return localFaceDirections(found, edge, order(one), order(other));
}

/**
 * The handles of one chamfer set. Equal distances have the bisector handle of
 * every set; the unequal types run **Distance along the reference face** and
 * (two distances) **Second distance along the other one** where `faceDirections`
 * can read them, else Distance keeps the bisector handle. A distance-and-angle
 * set **also gets its Angle as an arc** (P4-12): it starts along the reference
 * face's direction and swings towards the other face's, about the edge itself,
 * so its head sits on the chamfer face at the set's angle. Where the directions
 * can't be read, the set keeps its single bisector handle and has no arc.
 */
export function chamferSetManipulators(
  set: {
    edges: string;
    distance: string;
    distanceB: string;
    mode: string;
    flip: boolean;
    face: GeomRef | undefined;
    /** The set's angle field (`chamferAngleKey(n)`), written by a distance-and-angle arc. */
    angle: string;
  },
  values: DialogValues,
  bodies: Readonly<Record<BodyId, BodyMesh>>,
  style: { distance?: HandleStyle; distanceB?: HandleStyle; angle?: HandleStyle } = {},
): Manipulator[] {
  const unequal = set.mode === 'two-distances' || set.mode === 'distance-angle';
  const dirs = unequal
    ? faceDirections(bodies, values.refs[set.edges]?.[0], set.face, set.flip)
    : undefined;
  if (!dirs) {
    const one = setDistanceManipulator(set.distance, set.edges, values, bodies, style.distance);
    return one ? [one] : [];
  }
  const out: Manipulator[] = [
    {
      kind: 'distance',
      field: set.distance,
      origin: dirs.origin,
      direction: dirs.first,
      quiet: true,
      ...(style.distance?.follows && { follows: style.distance.follows }),
    },
  ];
  if (set.mode === 'two-distances') {
    out.push({
      kind: 'distance',
      field: set.distanceB,
      origin: dirs.origin,
      direction: dirs.second,
      quiet: true,
      ...(style.distanceB?.follows && { follows: style.distanceB.follows }),
    });
  } else {
    // The arc turns from `first` (its zero) towards `second`: the axis is the
    // two directions' cross product — along the edge, signed so the turn to
    // `second` is positive — and a chamfer face at angle θ lies on the arc at
    // θ. Left out where the two directions are parallel or opposed, which no
    // face corner between two flat faces of an edge can be.
    const across = cross(dirs.first, dirs.second);
    const length = Math.hypot(...across);
    if (length > 1e-6) {
      out.push({
        kind: 'angle',
        field: set.angle,
        origin: dirs.origin,
        axis: [across[0] / length, across[1] / length, across[2] / length],
        zero: dirs.first,
        quiet: true,
        ...(style.angle?.follows && { follows: style.angle.follows }),
      });
    }
  }
  return out;
}
