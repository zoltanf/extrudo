/**
 * Create Sketch on a flat face (P2-09, FR-SK-01, ADR-0031): what the
 * pointer is over while Create Sketch waits for a plane. Body faces and the
 * origin planes are both offered; the nearer one under the pointer wins.
 * Only flat faces count: a curved face can't hold a sketch.
 */
import { type BodyId, ORIGIN_PLANES, type SelectionItem, type Vec3 } from '@extrudo/core';
import type { BodyMesh } from '@extrudo/kernel';
import { DEFAULT_FILTER, type SelectionFilter } from '../selection/filter';
import { readTopology } from '../selection/items';
import { type PickCamera, type PickPlane, type PickScene, pickStack } from '../selection/pick';
import { rayPlane, viewRay } from '../viewport/camera';

/** Only faces: what Create Sketch and the Project tool's face picks take. */
export const FACES_ONLY: SelectionFilter = Object.fromEntries(
  Object.keys(DEFAULT_FILTER).map((k) => [k, k === 'faces']),
) as SelectionFilter;

/** Half the side of an origin plane's square, as a share of the view size (`Origin.tsx`). */
export const PLANE_HALF = 0.16;

export type SketchTarget =
  /** An origin plane (`origin:xy`) or a construction plane (its feature's ID, P3-05). */
  { kind: 'plane'; plane: string } | { kind: 'face'; item: SelectionItem };

/**
 * The origin plane or flat face under the pointer, whichever is nearer
 * along the pick ray; hidden faces and curved faces don't count. Origin
 * planes are the squares the view draws around the origin; construction
 * planes (`scene.planes`, P3-05) are the squares drawn around their anchors.
 */
export function sketchTargetAt(
  scene: PickScene,
  camera: PickCamera,
  at: readonly [number, number],
): SketchTarget | undefined {
  if (camera.width <= 0 || camera.height <= 0) return undefined;
  const hit = pickStack(scene, camera, at, FACES_ONLY).find(
    (h) => !h.occluded && h.item.kind === 'face',
  );
  const topology = hit && readTopology(hit.item);
  const mesh = topology && scene.bodies.find((b) => b.id === topology.body)?.mesh;
  const face =
    hit && topology && mesh && isFlatFace(mesh, topology.index)
      ? { item: hit.item, depth: hit.depth }
      : undefined;
  const plane = originPlaneAt(camera, at, scene.planes);
  if (face && (!plane || face.depth <= plane.depth)) return { kind: 'face', item: face.item };
  return plane ? { kind: 'plane', plane: plane.plane } : undefined;
}

/** The nearest origin plane square under the pointer, with its depth along the pick ray. */
export function originPlaneAt(
  camera: PickCamera,
  at: readonly [number, number],
  extra: readonly PickPlane[] = [],
): { plane: string; depth: number } | undefined {
  const { view, projection, width, height } = camera;
  const ndc: [number, number] = [(at[0] / width) * 2 - 1, 1 - (at[1] / height) * 2];
  const ray = viewRay(view, projection, width / height, ndc);
  const half = view.size * PLANE_HALF;
  let best: { plane: string; depth: number } | undefined;
  const squares: PickPlane[] = [
    ...ORIGIN_PLANES.map(({ id, frame }) => ({ id, frame, anchor: [0, 0, 0] as Vec3, half })),
    ...extra,
  ];
  for (const { id, frame, anchor, half: reach } of squares) {
    const p = rayPlane(ray, frame.origin, frame.normal);
    if (!p) continue;
    const point: Vec3 = [p.x - anchor[0], p.y - anchor[1], p.z - anchor[2]];
    const u = point[0] * frame.x[0] + point[1] * frame.x[1] + point[2] * frame.x[2];
    const v = point[0] * frame.y[0] + point[1] * frame.y[1] + point[2] * frame.y[2];
    if (Math.abs(u) > reach || Math.abs(v) > reach) continue;
    const depth = p.sub(ray.origin).dot(ray.direction) / ray.direction.length();
    if (!best || depth < best.depth) best = { plane: id, depth };
  }
  return best;
}

/** Whether all of a mesh face's triangles face the same way: a flat face. */
export function isFlatFace(mesh: BodyMesh, face: number): boolean {
  const first = mesh.faceRanges[2 * face] ?? 0;
  const count = mesh.faceRanges[2 * face + 1] ?? 0;
  const { positions: p, indices } = mesh;
  let reference: Vec3 | undefined;
  for (let t = first; t < first + count; t++) {
    const [a, b, c] = [indices[3 * t] ?? 0, indices[3 * t + 1] ?? 0, indices[3 * t + 2] ?? 0];
    const v = (i: number, k: number) => p[3 * i + k] ?? 0;
    const e1 = [v(b, 0) - v(a, 0), v(b, 1) - v(a, 1), v(b, 2) - v(a, 2)] as const;
    const e2 = [v(c, 0) - v(a, 0), v(c, 1) - v(a, 1), v(c, 2) - v(a, 2)] as const;
    const n: Vec3 = [
      e1[1] * e2[2] - e1[2] * e2[1],
      e1[2] * e2[0] - e1[0] * e2[2],
      e1[0] * e2[1] - e1[1] * e2[0],
    ];
    const length = Math.hypot(n[0], n[1], n[2]);
    if (length < 1e-12) continue;
    const unit: Vec3 = [n[0] / length, n[1] / length, n[2] / length];
    if (!reference) reference = unit;
    else if (unit[0] * reference[0] + unit[1] * reference[1] + unit[2] * reference[2] < 1 - 1e-4) {
      return false;
    }
  }
  return reference !== undefined;
}

/** The body face a session item names, when it is one. */
export function faceOf(
  item: SelectionItem | undefined,
  bodies: Readonly<Record<BodyId, BodyMesh>>,
): { body: BodyId; index: number } | undefined {
  const topology = readTopology(item);
  if (topology?.kind !== 'face' || !bodies[topology.body]) return undefined;
  return { body: topology.body, index: topology.index };
}
