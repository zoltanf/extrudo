/**
 * Look at Selection (UI spec §3.1): the box of what is selected, and the direction to turn
 * the camera to when the selection is one flat side. Pure: the view's fit maths takes the box
 * in place of the model's bounds (`ViewportState.lookAtBox`).
 */
import {
  curvePolyline,
  parseSketchEntityRefId,
  type SelectionItem,
  type SketchData,
  type SketchEntityId,
  type SketchFrame,
  sketchToWorld,
} from '@extrudo/core';
import type { BodyMesh } from '@extrudo/kernel';
import { readTopology } from './items';

type Vec3 = [number, number, number];

export interface LookTarget {
  min: Vec3;
  max: Vec3;
  /** Target → camera, when everything selected is a face of one flat orientation. */
  direction?: Vec3;
}

/** A shown sketch as the selection can reach it. */
export interface LookSketch {
  id: string;
  frame: SketchFrame;
  data: SketchData;
}

/** How alike two unit normals must be to count as one flat side. */
const FLAT = 1e-3;

/**
 * The box of the selected bodies, faces, edges, vertices and sketch curves, or `undefined`
 * when nothing selected has geometry. `meshes` is by body ID.
 */
export function selectionLookTarget(
  items: readonly SelectionItem[],
  meshes: Readonly<Record<string, BodyMesh | undefined>>,
  sketches: readonly LookSketch[] = [],
): LookTarget | undefined {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  const add = (x: number, y: number, z: number) => {
    if (x < min[0]) min[0] = x;
    if (y < min[1]) min[1] = y;
    if (z < min[2]) min[2] = z;
    if (x > max[0]) max[0] = x;
    if (y > max[1]) max[1] = y;
    if (z > max[2]) max[2] = z;
  };
  let normal: Vec3 | undefined;
  let flat = true;
  let faces = 0;
  let others = 0;
  const addNormal = (mesh: BodyMesh, node: number) => {
    const n: Vec3 = [
      mesh.normals[node * 3] as number,
      mesh.normals[node * 3 + 1] as number,
      mesh.normals[node * 3 + 2] as number,
    ];
    if (!normal) normal = n;
    else if (Math.hypot(n[0] - normal[0], n[1] - normal[1], n[2] - normal[2]) > FLAT) flat = false;
  };
  for (const item of items) {
    const topology = readTopology(item);
    if (topology) {
      const mesh = meshes[topology.body];
      if (!mesh) continue;
      if (topology.kind === 'body') {
        for (let i = 0; i + 2 < mesh.positions.length; i += 3) {
          add(
            mesh.positions[i] as number,
            mesh.positions[i + 1] as number,
            mesh.positions[i + 2] as number,
          );
        }
        others++;
      } else if (topology.kind === 'face') {
        const first = mesh.faceRanges[topology.index * 2];
        const count = mesh.faceRanges[topology.index * 2 + 1];
        if (first === undefined || count === undefined) continue;
        for (let t = first; t < first + count; t++) {
          for (let k = 0; k < 3; k++) {
            const node = mesh.indices[t * 3 + k] as number;
            add(
              mesh.positions[node * 3] as number,
              mesh.positions[node * 3 + 1] as number,
              mesh.positions[node * 3 + 2] as number,
            );
            addNormal(mesh, node);
          }
        }
        faces++;
      } else if (topology.kind === 'edge') {
        const first = mesh.edgeRanges[topology.index * 2];
        const count = mesh.edgeRanges[topology.index * 2 + 1];
        if (first === undefined || !count) continue;
        for (let p = first; p < first + count; p++) {
          add(
            mesh.edgePoints[p * 3] as number,
            mesh.edgePoints[p * 3 + 1] as number,
            mesh.edgePoints[p * 3 + 2] as number,
          );
        }
        others++;
      } else {
        const v = topology.index * 3;
        if (v + 2 >= mesh.vertices.length) continue;
        add(
          mesh.vertices[v] as number,
          mesh.vertices[v + 1] as number,
          mesh.vertices[v + 2] as number,
        );
        others++;
      }
      continue;
    }
    if (item.kind === 'sketchEntity') {
      const ref = parseSketchEntityRefId(item.id);
      const sketch = ref && sketches.find((s) => s.id === ref.feature);
      const entity = ref && sketch?.data.entities[ref.entity as SketchEntityId];
      if (!sketch || !entity) continue;
      const points =
        entity.type === 'point'
          ? [[entity.x, entity.y] as [number, number]]
          : curvePolyline(sketch.data, entity);
      for (const p of points ?? []) {
        const w = sketchToWorld(sketch.frame, p);
        add(w[0], w[1], w[2]);
      }
      others++;
    }
  }
  if (min[0] === Infinity) return undefined;
  const target: LookTarget = { min, max };
  if (faces > 0 && others === 0 && flat && normal) {
    const length = Math.hypot(...normal);
    if (length > 0) target.direction = [normal[0] / length, normal[1] / length, normal[2] / length];
  }
  return target;
}
