/**
 * A tessellated body, ready for three.js. All arrays are plain typed arrays so
 * the worker can transfer them to the UI thread without copying.
 *
 * Faces, edges and vertices come in the kernel's sub-shape order: face `i` is
 * `faceRanges[2i..2i+1]`, edge `i` is `edgeRanges[2i..2i+1]`, vertex `i` is
 * `vertices[3i..3i+2]`. The topological-naming service (P2-04) maps these
 * indices to persistent IDs.
 */
export interface BodyMesh {
  /** xyz per mesh node. */
  positions: Float32Array;
  /** Unit normal per mesh node, pointing out of the solid. */
  normals: Float32Array;
  /** Three node indices per triangle, counter-clockwise seen from outside. */
  indices: Uint32Array;
  /** Per face: first triangle, triangle count. */
  faceRanges: Uint32Array;
  /** Edge polylines, xyz per point. */
  edgePoints: Float32Array;
  /** Per edge: first point, point count (0 for degenerate edges). */
  edgeRanges: Uint32Array;
  /** Per edge: flag bits, see `EDGE_SEAM`. */
  edgeFlags: Uint8Array;
  /** xyz per B-rep vertex. */
  vertices: Float32Array;
  /**
   * Persistent ID of each face (topological naming, P2-04), parallel to
   * `faceRanges`: face `i` is `faceIds[i]`. Absent until the kernel names
   * faces; the viewport's selection then only has indices (ADR-0026).
   */
  faceIds?: string[];
  /** Persistent ID of each edge, parallel to `edgeRanges` (P2-04). */
  edgeIds?: string[];
  /** Persistent ID of each vertex, parallel to `vertices` (P2-04). */
  vertexIds?: string[];
}

/**
 * Edge flag: a seam, where a closed face (a cylinder, a sphere) meets
 * itself. It is a real B-rep edge but not a visible one, so the viewport
 * doesn't draw it.
 */
export const EDGE_SEAM = 1;

export interface Measurements {
  /** mm³ */
  volume: number;
  /** mm² */
  area: number;
  bbox: { min: [number, number, number]; max: [number, number, number] };
}

export interface MeshOptions {
  /** Maximum distance between the mesh and the surface, in mm. */
  linearDeflection: number;
  /** Maximum angle between adjacent mesh normals, in radians. */
  angularDeflection: number;
}

/** The ArrayBuffers of a mesh, for `postMessage` transfer lists. */
export function meshBuffers(mesh: BodyMesh): ArrayBuffer[] {
  return [
    mesh.positions,
    mesh.normals,
    mesh.indices,
    mesh.faceRanges,
    mesh.edgePoints,
    mesh.edgeRanges,
    mesh.edgeFlags,
    mesh.vertices,
  ].map((array) => array.buffer as ArrayBuffer);
}
