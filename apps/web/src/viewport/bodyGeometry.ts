/**
 * Plain geometry of body meshes for the view (bounds, edge segments), kept
 * out of `Bodies.tsx` so unit tests and other modules can use it without
 * loading React Three Fiber.
 */
import type { Vec3 } from '@extrudo/core';
import { type BodyMesh, EDGE_SEAM } from '@extrudo/kernel';
import { Box3, Sphere } from 'three';
import type { Bounds } from './store';

/** The bounding sphere and box of the visible bodies, or `undefined` if there are none. */
export function boundsOf(meshes: readonly BodyMesh[]): Bounds | undefined {
  const box = new Box3();
  for (const mesh of meshes) {
    if (mesh.positions.length >= 3) box.union(new Box3().setFromArray(mesh.positions));
  }
  if (box.isEmpty()) return undefined;
  const sphere = box.getBoundingSphere(new Sphere());
  return {
    center: [sphere.center.x, sphere.center.y, sphere.center.z],
    radius: sphere.radius,
    box: { min: box.min.toArray(), max: box.max.toArray() },
  };
}

/**
 * Edge polylines as line-segment pairs (xyz xyz per segment). Seams are left
 * out: they are B-rep edges, but not lines anyone sees on the part.
 */
export function edgeSegments(mesh: BodyMesh): Float32Array {
  const { edgePoints, edgeRanges, edgeFlags } = mesh;
  const edges = edgeRanges.length >> 1;
  const drawn = (e: number) => ((edgeFlags[e] ?? 0) & EDGE_SEAM) === 0;
  let count = 0;
  for (let e = 0; e < edges; e++) {
    if (drawn(e)) count += Math.max(0, (edgeRanges[2 * e + 1] ?? 0) - 1);
  }
  const out = new Float32Array(count * 6);
  let o = 0;
  for (let e = 0; e < edges; e++) {
    if (!drawn(e)) continue;
    const first = edgeRanges[2 * e] ?? 0;
    const n = edgeRanges[2 * e + 1] ?? 0;
    for (let i = 0; i + 1 < n; i++) {
      const a = (first + i) * 3;
      out.set(edgePoints.subarray(a, a + 6), o);
      o += 6;
    }
  }
  return out;
}

/**
 * The volume a closed triangle mesh has and where its mass is (the
 * divergence theorem: the signed volume of the tetrahedron each triangle
 * makes with the origin, and its centroid). Undefined for a mesh with no
 * volume. Exact for the mesh, so a coarse one puts the middle a little off
 * the solid's — enough to tell which side of a line the material is on.
 */
export function volumeCentroid(mesh: BodyMesh): { volume: number; centroid: Vec3 } | undefined {
  const { positions: p, indices } = mesh;
  let volume = 0;
  const sum: [number, number, number] = [0, 0, 0];
  for (let t = 0; t + 2 < indices.length; t += 3) {
    const at = (node: number, k: number) => p[3 * node + k] ?? 0;
    const a = indices[t] ?? 0;
    const b = indices[t + 1] ?? 0;
    const c = indices[t + 2] ?? 0;
    // Six times the signed volume of the tetrahedron (origin, a, b, c).
    const six =
      at(a, 0) * (at(b, 1) * at(c, 2) - at(b, 2) * at(c, 1)) -
      at(a, 1) * (at(b, 0) * at(c, 2) - at(b, 2) * at(c, 0)) +
      at(a, 2) * (at(b, 0) * at(c, 1) - at(b, 1) * at(c, 0));
    volume += six / 6;
    const share = six / 24;
    for (let k = 0; k < 3; k++) {
      sum[k] = (sum[k] as number) + share * (at(a, k) + at(b, k) + at(c, k));
    }
  }
  if (volume <= 0) return undefined;
  const [x, y, z] = sum;
  return {
    volume,
    centroid: [(x as number) / volume, (y as number) / volume, (z as number) / volume],
  };
}
