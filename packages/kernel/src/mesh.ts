/**
 * A tessellated body, ready for three.js. All arrays are plain typed arrays so
 * the worker can transfer them to the UI thread without copying.
 *
 * Faces, edges and vertices come in the kernel's sub-shape order: face `i` is
 * `faceRanges[2i..2i+1]`, edge `i` is `edgeRanges[2i..2i+1]`, vertex `i` is
 * `vertices[3i..3i+2]`. The recompute engine adds the persistent name
 * (TopoId, ADR-0005) of each in `faceIds`, `edgeIds` and `vertexIds`.
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
   * Persistent name of each face, in face order (ADR-0005): what a `face`
   * reference stores as its `id`. Plain strings (copied, not transferred).
   */
  faceIds?: string[];
  /** Persistent name of each edge, in edge order. */
  edgeIds?: string[];
  /** Persistent name of each vertex, in vertex order. */
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

/**
 * A body tessellated for export (STL, 3MF; P2-12, ADR-0034): welded, so
 * the triangles of a closed solid form a closed, manifold surface. Same
 * shape as `@extrudo/io`'s `TriangleMesh`.
 */
export interface ExportMesh {
  /** xyz per node, in mm. */
  positions: Float64Array;
  /** Three node indices per triangle, counter-clockwise seen from outside. */
  indices: Uint32Array;
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
