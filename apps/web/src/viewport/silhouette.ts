/**
 * Silhouette edges of curved faces (P2-08, ADR-0030, FR-VP-03): the outline
 * of a cylinder, a cone or a fillet seen from the camera, which the B-rep
 * edges don't show (seams are hidden, ADR-0008). Drawn in the wireframe and
 * hidden-edge styles, where there is no shading to show the outline.
 *
 * The silhouette is where the surface turns from facing the camera to
 * facing away: the zero line of `f = n · (eye − p)` (perspective) or
 * `f = −n · d` (orthographic, `d` the view direction), with `n` the mesh's
 * smooth node normals. Each triangle whose nodes change sign contributes
 * one segment between the two points where `f` crosses zero along its
 * edges, interpolated linearly: a contour line, so the outline is smooth
 * and needs no adjacency. Flat faces have a constant `f` sign and are
 * skipped up front (`curvedFaces`). Pure and allocation-free per call, so
 * the view can run it whenever the camera moves.
 */
import type { BodyMesh } from '@extrudo/kernel';

/** Node normals closer than this (1 − cos) count as one direction: the face is flat. */
const FLAT = 1e-6;

export type Vec3 = readonly [number, number, number];

/** How the camera looks: from a point (perspective) or along a direction (orthographic). */
export type SilhouetteView = { eye: Vec3 } | { direction: Vec3 };

/** The triangle ranges (first, count pairs) of a mesh's curved faces. */
export function curvedFaces(mesh: BodyMesh): Uint32Array {
  const { faceRanges, indices, normals } = mesh;
  const out: number[] = [];
  for (let f = 0; f + 1 < faceRanges.length; f += 2) {
    const first = faceRanges[f] ?? 0;
    const count = faceRanges[f + 1] ?? 0;
    if (count === 0) continue;
    const n0 = (indices[first * 3] ?? 0) * 3;
    const [x, y, z] = [normals[n0] ?? 0, normals[n0 + 1] ?? 0, normals[n0 + 2] ?? 0];
    let curved = false;
    for (let k = first * 3; k < (first + count) * 3 && !curved; k++) {
      const n = (indices[k] ?? 0) * 3;
      const dot = x * (normals[n] ?? 0) + y * (normals[n + 1] ?? 0) + z * (normals[n + 2] ?? 0);
      curved = 1 - dot > FLAT;
    }
    if (curved) out.push(first, count);
  }
  return Uint32Array.from(out);
}

/** The most floats `silhouetteSegments` can write for these faces (one segment per triangle). */
export function silhouetteCapacity(curved: Uint32Array): number {
  let triangles = 0;
  for (let i = 1; i < curved.length; i += 2) triangles += curved[i] ?? 0;
  return triangles * 6;
}

/**
 * Writes the silhouette of the curved faces as line segments (xyz xyz) into
 * `out` (at least `silhouetteCapacity` long) and returns the number of
 * floats written.
 */
export function silhouetteSegments(
  mesh: BodyMesh,
  curved: Uint32Array,
  view: SilhouetteView,
  out: Float32Array,
): number {
  const { positions: p, normals: n, indices } = mesh;
  const eye = 'eye' in view ? view.eye : undefined;
  const d = 'direction' in view ? view.direction : [0, 0, 0];
  const f = (node: number) => {
    const i = node * 3;
    const nx = n[i] ?? 0;
    const ny = n[i + 1] ?? 0;
    const nz = n[i + 2] ?? 0;
    return eye
      ? nx * (eye[0] - (p[i] ?? 0)) +
          ny * (eye[1] - (p[i + 1] ?? 0)) +
          nz * (eye[2] - (p[i + 2] ?? 0))
      : -(nx * d[0] + ny * d[1] + nz * d[2]);
  };
  let o = 0;
  const crossing = (a: number, b: number, fa: number, fb: number) => {
    const t = fa / (fa - fb);
    const i = a * 3;
    const j = b * 3;
    for (let k = 0; k < 3; k++) {
      const pa = p[i + k] ?? 0;
      out[o++] = pa + ((p[j + k] ?? 0) - pa) * t;
    }
  };
  for (let r = 0; r + 1 < curved.length; r += 2) {
    const first = curved[r] ?? 0;
    const end = first + (curved[r + 1] ?? 0);
    for (let t = first; t < end; t++) {
      const a = indices[t * 3] ?? 0;
      const b = indices[t * 3 + 1] ?? 0;
      const c = indices[t * 3 + 2] ?? 0;
      const fa = f(a);
      const fb = f(b);
      const fc = f(c);
      // Zero counts as facing: a node exactly on the silhouette belongs to one side.
      const sa = fa >= 0;
      const sb = fb >= 0;
      const sc = fc >= 0;
      if (sa === sb && sb === sc) continue;
      if (sa !== sb) crossing(a, b, fa, fb);
      if (sb !== sc) crossing(b, c, fb, fc);
      if (sc !== sa) crossing(c, a, fc, fa);
    }
  }
  return o;
}
