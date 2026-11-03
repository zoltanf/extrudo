/**
 * Auto-project (P6-07, FR-SK-17): the body edge or vertex under the pointer
 * while a sketch tool runs, so the tool can snap to it and the host can
 * project it (ADR-0074).
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
 */
import { type BodyId, type SketchFrame, type Vec2, type Vec3, worldToSketch } from '@extrudo/core';
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

/**
 * The edge, vertex or face centre to offer a running tool, or `undefined`
 * when the auto-project preference is off (P6-07): off, the view offers no
 * body geometry at all and the Project tool is the only way to bring one in.
 * A face centre within `tolerance` (mm) of the cursor wins when it is nearer
 * than the pick (issue #140).
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
): ModelSnap | undefined {
  if (!viewport.getState().autoProject) return undefined;
  const pick = modelSnapAt(scene, camera, frame, at, cursor, bodies);
  const shown = scene.bodies.map((b) => b.id);
  const centre = faceCenterSnapAt(frame, cursor, tolerance, shown, bodies);
  if (!centre) return pick;
  const far = (s: ModelSnap) => Math.hypot(s.point[0] - cursor[0], s.point[1] - cursor[1]);
  return pick && far(pick) < far(centre) ? pick : centre;
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
  let best = project(first);
  let bestD = Number.POSITIVE_INFINITY;
  for (let i = first; i + 1 < first + count; i++) {
    const a = project(i);
    const b = project(i + 1);
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
  const straight = count <= 2 || isStraight(project, first, count);
  const line: readonly [Vec2, Vec2] | undefined =
    count >= 2 ? [project(first), project(first + count - 1)] : undefined;
  return line ? { point: best, straight, line } : { point: best, straight };
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
