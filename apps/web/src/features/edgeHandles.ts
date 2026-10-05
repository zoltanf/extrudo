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
 */
import type { BodyId, GeomRef, Vec3 } from '@extrudo/core';
import { type BodyMesh, parseCompound } from '@extrudo/kernel';
import { meshSurfaceFrameAt } from './geometry';
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
    origin = edgeMidpoint(mesh, edge);
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

/**
 * The handle of a set's first edge for one of its length fields, or nothing
 * where the edge can't carry one. The value is the field's own: a variable
 * fillet's arrow moves Radius only (its End radius has its own field).
 */
export function setDistanceManipulator(
  field: string,
  edgesField: string,
  values: DialogValues,
  bodies: Readonly<Record<BodyId, BodyMesh>>,
): Manipulator | undefined {
  const at = edgeHandle(bodies, values.refs[edgesField]?.[0]);
  if (!at) return undefined;
  return { kind: 'distance', field, origin: at.origin, direction: at.direction };
}
