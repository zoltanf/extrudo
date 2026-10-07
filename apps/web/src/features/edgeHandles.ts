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
 * themselves (`faceDirections`, `chamferManipulators`), and **a
 * distance-and-angle set's Angle is an arc** from the reference face's
 * direction towards the other face's, about the edge itself.
 */
import type { BodyId, GeomRef, Vec3 } from '@extrudo/core';
import { type BodyMesh, parseCompound } from '@extrudo/kernel';
import { meshFaceFrame, meshSurfaceFrameAt } from './geometry';
import type { DialogValues, Manipulator } from './spec';

/** Below this the two normals are too much alike for a bisector that means anything. */
const MIN_BISECTOR = 0.5;

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

/**
 * Where a chamfer's two distances run (P4-12): from the middle of a straight
 * edge between two **flat** faces, along each face across the edge into the
 * face. `reference` is the face that takes the first distance: the picked one,
 * else the lower-numbered of the edge's two (the kernel's own rule) or, with
 * `flip`, the other. Undefined where that can't be read reliably: a curved
 * edge or face, a face the meshes lack, or a reference face that isn't one of
 * the edge's two — the dialog then keeps its single bisector handle.
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
  const first = found.edgeRanges[2 * edge] ?? 0;
  const count = found.edgeRanges[2 * edge + 1] ?? 0;
  const origin = edgeMidpoint(found, edge);
  if (!origin || count < 2) return undefined;
  const pt = (i: number): Vec3 => [
    found.edgePoints[3 * i] ?? 0,
    found.edgePoints[3 * i + 1] ?? 0,
    found.edgePoints[3 * i + 2] ?? 0,
  ];
  const a = pt(first);
  const z = pt(first + count - 1);
  const span: Vec3 = [z[0] - a[0], z[1] - a[1], z[2] - a[2]];
  const length = Math.hypot(...span);
  if (!(length > 0)) return undefined;
  const t: Vec3 = [span[0] / length, span[1] / length, span[2] / length];
  // A straight edge: every point of its polyline on the line through the ends.
  for (let i = first + 1; i < first + count - 1; i++) {
    const p = pt(i);
    const off = cross([p[0] - a[0], p[1] - a[1], p[2] - a[2]], t);
    if (Math.hypot(...off) > 1e-3 * length) return undefined;
  }
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
  const across = (name: string): Vec3 | undefined => {
    const face = order(name);
    const frame = meshFaceFrame(found, face);
    if (!frame || (frame.flatness ?? 1) < 0.98) return undefined;
    const n = frame.normal;
    if (Math.abs(dot(n, t)) > 0.02) return undefined;
    const side = cross(t, n);
    const sideLength = Math.hypot(...side);
    if (!(sideLength > 0)) return undefined;
    const d: Vec3 = [side[0] / sideLength, side[1] / sideLength, side[2] / sideLength];
    // Into the face: where the bulk of its nodes lie.
    const start = found.faceRanges[2 * face] ?? 0;
    const triangles = found.faceRanges[2 * face + 1] ?? 0;
    let lean = 0;
    for (let k = 0; k < 3 * triangles; k++) {
      const node = found.indices[3 * start + k] ?? 0;
      lean += dot(
        [
          (found.positions[3 * node] ?? 0) - origin[0],
          (found.positions[3 * node + 1] ?? 0) - origin[1],
          (found.positions[3 * node + 2] ?? 0) - origin[2],
        ],
        d,
      );
    }
    if (lean === 0) return undefined;
    return lean > 0 ? d : [-d[0], -d[1], -d[2]];
  };
  const along = across(one);
  const second = across(other);
  return along && second ? { origin, first: along, second } : undefined;
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
