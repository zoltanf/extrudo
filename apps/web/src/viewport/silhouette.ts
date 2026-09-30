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
 * skipped up front (`curvedFaces`), and `f` is evaluated once per node
 * (`silhouettePlan`, P3-13). Pure and allocation-free per call, so the view
 * can run it whenever the camera moves.
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
 * What a silhouette pass reuses between frames (P3-13): the nodes of the
 * curved faces, once each, and room for their facing values. Each node is
 * shared by about six triangles, so evaluating `f` per node rather than per
 * triangle corner does a sixth of the dot products.
 */
export interface SilhouettePlan {
  curved: Uint32Array;
  /** The nodes the curved faces use, each once. */
  nodes: Uint32Array;
  /** `f` per node of the mesh (only `nodes` are written). */
  facing: Float32Array;
}

export function silhouettePlan(mesh: BodyMesh, curved = curvedFaces(mesh)): SilhouettePlan {
  const { indices } = mesh;
  const count = mesh.positions.length / 3;
  const used = new Uint8Array(count);
  let n = 0;
  for (let r = 0; r + 1 < curved.length; r += 2) {
    const first = (curved[r] as number) * 3;
    const end = first + (curved[r + 1] as number) * 3;
    for (let k = first; k < end; k++) {
      const node = indices[k] as number;
      if (used[node] === 0) {
        used[node] = 1;
        n++;
      }
    }
  }
  const nodes = new Uint32Array(n);
  let o = 0;
  for (let node = 0; node < count; node++) if (used[node] === 1) nodes[o++] = node;
  return { curved, nodes, facing: new Float32Array(count) };
}

/**
 * Writes the silhouette of the curved faces as line segments (xyz xyz) into
 * `out` (at least `silhouetteCapacity(plan.curved)` long) and returns the
 * number of floats written.
 */
export function silhouetteSegments(
  mesh: BodyMesh,
  plan: SilhouettePlan,
  view: SilhouetteView,
  out: Float32Array,
): number {
  const { positions: p, normals: n, indices } = mesh;
  const { curved, nodes, facing: f } = plan;
  if ('eye' in view) {
    const [ex, ey, ez] = view.eye;
    for (let k = 0; k < nodes.length; k++) {
      const i = (nodes[k] as number) * 3;
      f[i / 3] =
        (n[i] as number) * (ex - (p[i] as number)) +
        (n[i + 1] as number) * (ey - (p[i + 1] as number)) +
        (n[i + 2] as number) * (ez - (p[i + 2] as number));
    }
  } else {
    const [dx, dy, dz] = view.direction;
    for (let k = 0; k < nodes.length; k++) {
      const i = (nodes[k] as number) * 3;
      f[i / 3] = -((n[i] as number) * dx + (n[i + 1] as number) * dy + (n[i + 2] as number) * dz);
    }
  }
  let o = 0;
  const crossing = (a: number, b: number, fa: number, fb: number) => {
    const t = fa / (fa - fb);
    const i = a * 3;
    const j = b * 3;
    for (let k = 0; k < 3; k++) {
      const pa = p[i + k] as number;
      out[o++] = pa + ((p[j + k] as number) - pa) * t;
    }
  };
  for (let r = 0; r + 1 < curved.length; r += 2) {
    const first = curved[r] as number;
    const end = first + (curved[r + 1] as number);
    for (let t = first; t < end; t++) {
      const a = indices[t * 3] as number;
      const b = indices[t * 3 + 1] as number;
      const c = indices[t * 3 + 2] as number;
      const fa = f[a] as number;
      const fb = f[b] as number;
      const fc = f[c] as number;
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
