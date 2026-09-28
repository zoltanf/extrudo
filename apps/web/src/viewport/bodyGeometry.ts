/**
 * Plain geometry of body meshes for the view (bounds, edge segments), kept
 * out of `Bodies.tsx` so unit tests and other modules can use it without
 * loading React Three Fiber.
 */
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
