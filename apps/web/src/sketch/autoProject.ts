/**
 * Auto-project (P6-07, FR-SK-17): the body edge or vertex under the pointer
 * while a sketch tool runs, so the tool can snap to it and the host can
 * project it (ADR-0074). Since ADR-0125 an earlier sketch's curve or point
 * under the pointer is offered too, linked to that sketch.
 *
 * The pick runs through the model picker (`pickStack`) with a filter of edges
 * and vertices only, behind the sketch's own geometry (the inference is what
 * decides a sketch entity wins). A body edge or vertex hidden behind a face
 * is still offered — a sketch on a face routinely snaps to geometry seen
 * through the face — so the first vertex, then the first edge, visible before
 * hidden, is taken. The point is the vertex projected onto the sketch plane,
 * or the nearest point of the edge's display polyline projected onto it; the
 * exact edge arrives from the kernel on the next recompute.
 *
 * Issue #140: the centre of a shown body's flat face lying in the sketch
 * plane (the face a sketch is on, say) is offered too, when it is nearer the
 * cursor than the edge or vertex under the pointer; the host projects it as a
 * `center` projection of the face.
 *
 * ADR-0125: a second pick runs with a sketches-and-sketch-points filter for
 * the earlier, shown sketches; its curves and points (`sketchCurve`,
 * `sketchPoint`) carry the nearest point of the curve's display polyline into
 * the open sketch. Since amendment 1 the carried copies the view draws faintly
 * on the open sketch's plane are offered too, when within the snap tolerance of
 * the cursor. Of the body pick, the face centre and the sketch pick, the
 * nearest to the cursor wins; a tie goes to the body, then the face centre.
 */
import {
  type BodyId,
  curvePolyline,
  type FeatureId,
  parseSketchEntityRefId,
  type SketchData,
  type SketchEntityId,
  type SketchFrame,
  sketchEntityRefId,
  sketchToWorld,
  type Vec2,
  type Vec3,
  worldToSketch,
} from '@extrudo/core';
import type { BodyMesh } from '@extrudo/kernel';
import type { ModelSnap } from '@extrudo/sketch/inference';
import { DEFAULT_FILTER, type SelectionFilter } from '../selection/filter';
import { readTopology, topologyRef } from '../selection/items';
import { type PickCamera, type PickScene, pickStack } from '../selection/pick';
import type { ViewportStore } from '../viewport/store';

/** Only body edges and vertices: never faces, sketches, profiles or construction. */
const SNAP_FILTER: SelectionFilter = {
  ...DEFAULT_FILTER,
  bodies: false,
  faces: false,
  edges: true,
  vertices: true,
  sketches: false,
  profiles: false,
  construction: false,
  sketchPoints: false,
};

/** The earlier sketches' curves, construction curves and points (ADR-0125). */
const SKETCH_SNAP_FILTER: SelectionFilter = {
  ...DEFAULT_FILTER,
  bodies: false,
  faces: false,
  edges: false,
  vertices: false,
  sketches: true,
  profiles: false,
  construction: true,
  sketchPoints: true,
};

const EMPTY_SKETCHES: ReadonlySet<FeatureId> = new Set();

/**
 * The body edge, vertex, face centre or earlier-sketch curve or point to offer
 * a running tool (P6-07, ADR-0125), or `undefined` when both auto-project
 * preferences are off. The body pick and the face centre are gated by
 * `autoProject`, the sketch pick by `autoProjectSketches`; of the candidates
 * the nearest to the cursor wins, a tie to the body then the face centre.
 */
export function autoProjectSnap(
  viewport: Pick<ViewportStore, 'getState'>,
  scene: PickScene,
  camera: PickCamera,
  frame: SketchFrame,
  at: readonly [number, number],
  cursor: Vec2,
  bodies: Readonly<Record<BodyId, BodyMesh>>,
  tolerance: number,
  earlier: ReadonlySet<FeatureId> = EMPTY_SKETCHES,
): ModelSnap | undefined {
  const state = viewport.getState();
  const body = state.autoProject
    ? modelSnapAt(scene, camera, frame, at, cursor, bodies)
    : undefined;
  const shown = scene.bodies.map((b) => b.id);
  const centre = state.autoProject
    ? faceCenterSnapAt(frame, cursor, tolerance, shown, bodies)
    : undefined;
  const sketch = state.autoProjectSketches
    ? sketchSnapAt(scene, camera, frame, at, cursor, earlier, tolerance)
    : undefined;
  const far = (s: ModelSnap) => Math.hypot(s.point[0] - cursor[0], s.point[1] - cursor[1]);
  let best: ModelSnap | undefined;
  for (const candidate of [body, centre, sketch]) {
    if (candidate && (!best || far(candidate) < far(best))) best = candidate;
  }
  return best;
}

/** Off the plane by more than this (mm), a face isn't in it: the mesh is single precision. */
const IN_PLANE = 1e-3;

/** A body's faces lying in a sketch plane, by face index, and their area centres in sketch coordinates. */
const centresCache = new WeakMap<BodyMesh, { frame: SketchFrame; centres: [number, Vec2][] }>();

/**
 * The centre of a flat face of one of the `shown` bodies that lies in the
 * sketch plane, nearest `cursor` within `tolerance` (mm), as a `faceCenter`
 * model snap (issue #140); `undefined` if none is that near. The centre is the
 * area centroid of the face's triangles, so a face with round edges is a
 * little off until the kernel reports the exact one. Mesh bodies have no
 * B-rep face to name, so they offer none.
 */
export function faceCenterSnapAt(
  frame: SketchFrame,
  cursor: Vec2,
  tolerance: number,
  shown: readonly BodyId[],
  bodies: Readonly<Record<BodyId, BodyMesh>>,
): ModelSnap | undefined {
  let best: ModelSnap | undefined;
  let bestD = tolerance;
  for (const body of shown) {
    const mesh = bodies[body];
    if (!mesh || mesh.mesh) continue;
    for (const [index, point] of planeFaceCentres(mesh, frame)) {
      const d = Math.hypot(point[0] - cursor[0], point[1] - cursor[1]);
      if (d > bestD) continue;
      const ref = topologyRef({ kind: 'face', body, index }, bodies);
      if (!ref) continue;
      best = { ref, point, kind: 'faceCenter', straight: true };
      bestD = d;
    }
  }
  return best;
}

/** The faces of `mesh` lying in the frame's plane, with their area centres (cached per mesh and frame). */
function planeFaceCentres(mesh: BodyMesh, frame: SketchFrame): [number, Vec2][] {
  const hit = centresCache.get(mesh);
  if (hit?.frame === frame) return hit.centres;
  const { positions: p, indices, faceRanges } = mesh;
  const [ox, oy, oz] = frame.origin;
  const [nx, ny, nz] = frame.normal;
  const node = (i: number): Vec3 => [p[3 * i] ?? 0, p[3 * i + 1] ?? 0, p[3 * i + 2] ?? 0];
  const off = ([x, y, z]: Vec3) => Math.abs((x - ox) * nx + (y - oy) * ny + (z - oz) * nz);
  const centres: [number, Vec2][] = [];
  for (let face = 0; 2 * face + 1 < faceRanges.length; face++) {
    const first = faceRanges[2 * face] ?? 0;
    const count = faceRanges[2 * face + 1] ?? 0;
    let flat = count > 0;
    let area = 0;
    let [sx, sy, sz] = [0, 0, 0];
    for (let t = first; t < first + count && flat; t++) {
      const [ax, ay, az] = node(indices[3 * t] ?? 0);
      const [bx, by, bz] = node(indices[3 * t + 1] ?? 0);
      const [cx, cy, cz] = node(indices[3 * t + 2] ?? 0);
      flat = [off([ax, ay, az]), off([bx, by, bz]), off([cx, cy, cz])].every((d) => d <= IN_PLANE);
      // Twice the triangle's area, |(b − a) × (c − a)|, weighs its centroid.
      const [ux, uy, uz] = [bx - ax, by - ay, bz - az];
      const [vx, vy, vz] = [cx - ax, cy - ay, cz - az];
      const w = Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
      area += w;
      sx += (w * (ax + bx + cx)) / 3;
      sy += (w * (ay + by + cy)) / 3;
      sz += (w * (az + bz + cz)) / 3;
    }
    if (flat && area > 0)
      centres.push([face, worldToSketch(frame, [sx / area, sy / area, sz / area])]);
  }
  centresCache.set(mesh, { frame, centres });
  return centres;
}

/** A source sketch's point (mm) carried into the open sketch's frame. */
function carry(source: SketchFrame, frame: SketchFrame, p: Vec2): Vec2 {
  return worldToSketch(frame, sketchToWorld(source, p));
}

/** An earlier sketch's point or curve carried into the open sketch: a point, or a polyline. */
type CarriedEntity =
  | { entity: SketchEntityId; point: Vec2 }
  | { entity: SketchEntityId; polyline: Vec2[]; line: boolean };

/** Each source sketch's entities carried into a frame (cached per sketch data and frame). */
const carriedCache = new WeakMap<
  SketchData,
  { frame: SketchFrame; source: SketchFrame; items: CarriedEntity[] }
>();

/** The points and curves of `source` (no text) carried into `frame`. */
function carriedEntities(
  source: PickScene['sketches'][number],
  frame: SketchFrame,
): CarriedEntity[] {
  const hit = carriedCache.get(source.data);
  if (hit?.frame === frame && hit.source === source.frame) return hit.items;
  const items: CarriedEntity[] = [];
  for (const [id, entity] of Object.entries(source.data.entities)) {
    if (entity.type === 'text') continue;
    const key = id as SketchEntityId;
    if (entity.type === 'point') {
      items.push({ entity: key, point: carry(source.frame, frame, [entity.x, entity.y]) });
      continue;
    }
    const polyline = curvePolyline(source.data, entity);
    if (!polyline || polyline.length === 0) continue;
    items.push({
      entity: key,
      polyline: polyline.map((p) => carry(source.frame, frame, p)),
      line: entity.type === 'line',
    });
  }
  carriedCache.set(source.data, { frame, source: source.frame, items });
  return items;
}

/**
 * A curve or point of an **earlier**, shown sketch (ADR-0125), as a
 * `sketchCurve` or `sketchPoint` model snap: one under the pointer `at`
 * (where the source sketch is drawn), or, since amendment 1, one whose
 * carried copy in the open sketch's plane (the faint preview) lies within
 * `tolerance` (mm) of `cursor`. A point entity wins over a curve; within
 * each, the nearest to `cursor` wins. A text is skipped; the snap point is
 * the nearest point of the curve's display polyline carried into the open
 * sketch's frame.
 */
export function sketchSnapAt(
  scene: PickScene,
  camera: PickCamera,
  frame: SketchFrame,
  at: readonly [number, number],
  cursor: Vec2,
  earlier: ReadonlySet<FeatureId>,
  tolerance = 0,
): ModelSnap | undefined {
  type Candidate = { snap: ModelSnap; point: Vec2 };
  const points: Candidate[] = [];
  const curves: Candidate[] = [];
  const far = (p: Vec2) => Math.hypot(p[0] - cursor[0], p[1] - cursor[1]);
  /** Adds `item` of sketch `feature`; with `near`, only when it lies within `tolerance`. */
  const offer = (feature: FeatureId, item: CarriedEntity, near: boolean) => {
    const ref = { kind: 'sketchEntity' as const, id: sketchEntityRefId(feature, item.entity) };
    if ('point' in item) {
      if (near && far(item.point) > tolerance) return;
      const point = item.point;
      points.push({ snap: { ref, point, kind: 'sketchPoint', straight: true }, point });
      return;
    }
    const point = nearestOnPolyline(item.polyline, cursor);
    if (near && far(point) > tolerance) return;
    const { polyline } = item;
    const line =
      item.line && polyline.length >= 2
        ? ([polyline[0], polyline[polyline.length - 1]] as [Vec2, Vec2])
        : undefined;
    curves.push({
      snap: { ref, point, kind: 'sketchCurve', straight: item.line, ...(line && { line }) },
      point,
    });
  };
  const hits = pickStack(scene, camera, at, SKETCH_SNAP_FILTER).filter(
    (h) => h.item.kind === 'sketchEntity',
  );
  for (const hit of hits) {
    const parsed = parseSketchEntityRefId(hit.item.id);
    if (!parsed || !earlier.has(parsed.feature)) continue;
    const source = scene.sketches.find((s) => s.id === parsed.feature);
    const item = source && carriedEntities(source, frame).find((c) => c.entity === parsed.entity);
    if (item) offer(parsed.feature, item, false);
  }
  if (tolerance > 0) {
    for (const source of scene.sketches) {
      if (!earlier.has(source.id as FeatureId)) continue;
      for (const item of carriedEntities(source, frame)) offer(source.id as FeatureId, item, true);
    }
  }
  const nearest = (list: Candidate[]) =>
    list.reduce<Candidate | undefined>(
      (best, c) => (!best || far(c.point) < far(best.point) ? c : best),
      undefined,
    );
  return (nearest(points) ?? nearest(curves))?.snap;
}

/**
 * The body edge or vertex under the pointer `at` (view px), in sketch
 * coordinates, or `undefined` over empty space or when the body's mesh
 * carries no persistent name (never store an index).
 */
export function modelSnapAt(
  scene: PickScene,
  camera: PickCamera,
  frame: SketchFrame,
  at: readonly [number, number],
  cursor: Vec2,
  bodies: Readonly<Record<BodyId, BodyMesh>>,
): ModelSnap | undefined {
  const hits = pickStack(scene, camera, at, SNAP_FILTER);
  const first = (kind: 'vertex' | 'edge', occluded: boolean) =>
    hits.find((h) => h.item.kind === kind && h.occluded === occluded);
  // A vertex wins over an edge; a visible one over a hidden one.
  const hit =
    first('vertex', false) ?? first('edge', false) ?? first('vertex', true) ?? first('edge', true);
  if (!hit) return undefined;
  const topology = readTopology(hit.item);
  if (!topology || (topology.kind !== 'vertex' && topology.kind !== 'edge')) return undefined;
  const ref = topologyRef(topology, bodies);
  const mesh = bodies[topology.body];
  if (!ref || !mesh) return undefined;
  if (topology.kind === 'vertex') {
    const point = vertexPoint(mesh, topology.index, frame);
    return point ? { ref, point, kind: 'vertex', straight: true } : undefined;
  }
  const edge = edgePoint(mesh, topology.index, frame, cursor);
  return edge ? { ref, kind: 'edge', ...edge } : undefined;
}

/** The vertex, in sketch coordinates. */
function vertexPoint(mesh: BodyMesh, index: number, frame: SketchFrame): Vec2 | undefined {
  const v = mesh.vertices;
  if (3 * index + 2 >= v.length) return undefined;
  return worldToSketch(frame, [v[3 * index] ?? 0, v[3 * index + 1] ?? 0, v[3 * index + 2] ?? 0]);
}

/**
 * An edge's display polyline in sketch coordinates: the point on it nearest
 * `cursor` and the polyline's two ends (P6-07 slice 2: a picking tool's
 * stand-in line). Absent when the mesh carries no points for the edge. The
 * nearest point is on a segment, not only at a vertex: a body edge's
 * polyline for a straight edge is just its two ends, so a vertex-only search
 * would put the snap at an endpoint far from the pointer.
 */
function edgePoint(
  mesh: BodyMesh,
  index: number,
  frame: SketchFrame,
  cursor: Vec2,
): { point: Vec2; straight: boolean; line?: readonly [Vec2, Vec2] } | undefined {
  const first = mesh.edgeRanges[2 * index] ?? 0;
  const count = mesh.edgeRanges[2 * index + 1] ?? 0;
  if (count <= 0) return undefined;
  const p = mesh.edgePoints;
  const project = (i: number): Vec2 =>
    worldToSketch(frame, [p[3 * i] ?? 0, p[3 * i + 1] ?? 0, p[3 * i + 2] ?? 0]);
  const points: Vec2[] = [];
  for (let i = first; i < first + count; i++) points.push(project(i));
  const best = nearestOnPolyline(points, cursor);
  const straight = count <= 2 || isStraight(project, first, count);
  const line: readonly [Vec2, Vec2] | undefined =
    count >= 2 ? [points[0] as Vec2, points[count - 1] as Vec2] : undefined;
  return line ? { point: best, straight, line } : { point: best, straight };
}

/**
 * The point of a polyline nearest `cursor`: the nearest point on a segment,
 * not only at a vertex (a straight edge's polyline is just its two ends, so a
 * vertex-only search would put the snap at an endpoint far from the pointer).
 */
export function nearestOnPolyline(points: readonly Vec2[], cursor: Vec2): Vec2 {
  let best = (points[0] ?? cursor) as Vec2;
  let bestD = Number.POSITIVE_INFINITY;
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i] as Vec2;
    const b = points[i + 1] as Vec2;
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len2 = dx * dx + dy * dy;
    const t =
      len2 === 0
        ? 0
        : Math.min(1, Math.max(0, ((cursor[0] - a[0]) * dx + (cursor[1] - a[1]) * dy) / len2));
    const q: Vec2 = [a[0] + t * dx, a[1] + t * dy];
    const d = Math.hypot(q[0] - cursor[0], q[1] - cursor[1]);
    if (d < bestD) {
      bestD = d;
      best = q;
    }
  }
  return best;
}

/**
 * Whether an edge's display polyline is straight (P6-07 slice 2's review): with
 * two points it is, else every interior point lies within 1e-6 × the chord's
 * length of the chord. A cylinder's rim is a many-point polyline whose interior
 * points stand well off the chord, so it is curved.
 */
function isStraight(project: (i: number) => Vec2, first: number, count: number): boolean {
  const a = project(first);
  const b = project(first + count - 1);
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const length = Math.hypot(dx, dy);
  const tolerance = 1e-6 * length;
  for (let i = first + 1; i < first + count - 1; i++) {
    const q = project(i);
    // The distance from q to the line through a and b (a degenerate chord keeps the ends).
    const distance =
      length === 0
        ? Math.hypot(q[0] - a[0], q[1] - a[1])
        : Math.abs((q[0] - a[0]) * dy - (q[1] - a[1]) * dx) / length;
    if (distance > tolerance) return false;
  }
  return true;
}
