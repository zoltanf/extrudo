/**
 * Triangle meshes for the mesh formats (STL, 3MF): indexed triangles in
 * millimetres, and a check that a mesh encloses a solid (closed, manifold,
 * consistently oriented), which slicers need.
 */

/**
 * An indexed triangle mesh. Triangles share nodes: an edge between two
 * triangles uses the same two node indices in both.
 */
export interface TriangleMesh {
  /** xyz per node, in mm. */
  positions: Float64Array | Float32Array;
  /** Three node indices per triangle, counter-clockwise seen from outside. */
  indices: Uint32Array;
}

/** One body of a mesh file: a 3MF object, or part of an STL's triangles. */
export interface MeshObject {
  name: string;
  mesh: TriangleMesh;
  /** `#rrggbb` or `#rrggbbaa` (sRGB); none for no colour. */
  color?: string;
}

/** What `checkManifold` found. `ok` holds when a slicer can treat the mesh as a solid. */
export interface ManifoldReport {
  ok: boolean;
  triangles: number;
  nodes: number;
  /** Edges (node pairs) used by the triangles. */
  edges: number;
  /** Edges used by one triangle only: holes in the surface. */
  boundaryEdges: number;
  /** Edges used by more than two triangles. */
  nonManifoldEdges: number;
  /** Edges whose two triangles run along it the same way: flipped triangles. */
  misorientedEdges: number;
  /** Triangles that repeat a node or name one that doesn't exist. */
  badTriangles: number;
  /** Nodes with a coordinate that isn't a finite number. */
  badNodes: number;
  /**
   * Enclosed volume in mm³ (signed: negative when the triangles face
   * inwards). Only meaningful when the mesh is closed.
   */
  volume: number;
}

/**
 * Checks that a mesh is watertight and manifold: every edge is shared by
 * exactly two triangles that run along it in opposite directions (so the
 * surface is closed and consistently oriented), no triangle repeats a
 * node, every coordinate is finite and the enclosed volume is positive
 * (the triangles face outwards).
 */
export function checkManifold(mesh: TriangleMesh): ManifoldReport {
  const { positions, indices } = mesh;
  const nodes = Math.floor(positions.length / 3);
  const triangles = Math.floor(indices.length / 3);
  let badNodes = 0;
  for (let i = 0; i < nodes * 3; i += 3) {
    if (
      !Number.isFinite(positions[i]) ||
      !Number.isFinite(positions[i + 1]) ||
      !Number.isFinite(positions[i + 2])
    ) {
      badNodes++;
    }
  }
  // Per undirected edge (low, high): how many triangles run low → high and high → low.
  const forward = new Map<number, number>();
  const backward = new Map<number, number>();
  let badTriangles = 0;
  let volume = 0;
  const bump = (map: Map<number, number>, key: number) => map.set(key, (map.get(key) ?? 0) + 1);
  const edge = (a: number, b: number) => {
    if (a < b) bump(forward, a * nodes + b);
    else bump(backward, b * nodes + a);
  };
  for (let t = 0; t < triangles; t++) {
    const a = indices[3 * t] as number;
    const b = indices[3 * t + 1] as number;
    const c = indices[3 * t + 2] as number;
    if (a === b || b === c || a === c || a >= nodes || b >= nodes || c >= nodes) {
      badTriangles++;
      continue;
    }
    edge(a, b);
    edge(b, c);
    edge(c, a);
    volume += signedVolume(positions, a, b, c);
  }
  let boundaryEdges = 0;
  let nonManifoldEdges = 0;
  let misorientedEdges = 0;
  const keys = new Set([...forward.keys(), ...backward.keys()]);
  for (const key of keys) {
    const f = forward.get(key) ?? 0;
    const b = backward.get(key) ?? 0;
    const uses = f + b;
    if (uses === 1) boundaryEdges++;
    else if (uses > 2) nonManifoldEdges++;
    else if (f !== 1) misorientedEdges++;
  }
  return {
    ok:
      triangles > 0 &&
      boundaryEdges === 0 &&
      nonManifoldEdges === 0 &&
      misorientedEdges === 0 &&
      badTriangles === 0 &&
      badNodes === 0 &&
      volume > 0,
    triangles,
    nodes,
    edges: keys.size,
    boundaryEdges,
    nonManifoldEdges,
    misorientedEdges,
    badTriangles,
    badNodes,
    volume,
  };
}

/** The signed volume of the tetrahedron (origin, a, b, c). */
function signedVolume(p: TriangleMesh['positions'], a: number, b: number, c: number): number {
  const [ax, ay, az] = [p[3 * a] as number, p[3 * a + 1] as number, p[3 * a + 2] as number];
  const [bx, by, bz] = [p[3 * b] as number, p[3 * b + 1] as number, p[3 * b + 2] as number];
  const [cx, cy, cz] = [p[3 * c] as number, p[3 * c + 1] as number, p[3 * c + 2] as number];
  return (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
}

/** The unit normal of a triangle by the right-hand rule, or zeros for a degenerate one. */
export function triangleNormal(
  p: TriangleMesh['positions'],
  a: number,
  b: number,
  c: number,
): [number, number, number] {
  const ux = (p[3 * b] as number) - (p[3 * a] as number);
  const uy = (p[3 * b + 1] as number) - (p[3 * a + 1] as number);
  const uz = (p[3 * b + 2] as number) - (p[3 * a + 2] as number);
  const vx = (p[3 * c] as number) - (p[3 * a] as number);
  const vy = (p[3 * c + 1] as number) - (p[3 * a + 1] as number);
  const vz = (p[3 * c + 2] as number) - (p[3 * a + 2] as number);
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  const length = Math.hypot(nx, ny, nz);
  return length > 0 ? [nx / length, ny / length, nz / length] : [0, 0, 0];
}

/** Axis-aligned bounds of the nodes, or undefined for an empty mesh. */
export function meshBounds(
  mesh: TriangleMesh,
): { min: [number, number, number]; max: [number, number, number] } | undefined {
  const p = mesh.positions;
  if (p.length < 3) return undefined;
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i + 2 < p.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const v = p[i + k] as number;
      if (v < (min[k] as number)) min[k] = v;
      if (v > (max[k] as number)) max[k] = v;
    }
  }
  return { min, max };
}

/** Concatenates meshes into one (an STL of several bodies). */
export function mergeMeshes(meshes: readonly TriangleMesh[]): TriangleMesh {
  const nodeCount = meshes.reduce((n, m) => n + m.positions.length, 0);
  const indexCount = meshes.reduce((n, m) => n + m.indices.length, 0);
  const positions = new Float64Array(nodeCount);
  const indices = new Uint32Array(indexCount);
  let p = 0;
  let i = 0;
  for (const mesh of meshes) {
    const base = p / 3;
    positions.set(mesh.positions, p);
    for (let k = 0; k < mesh.indices.length; k++)
      indices[i + k] = (mesh.indices[k] as number) + base;
    p += mesh.positions.length;
    i += mesh.indices.length;
  }
  return { positions, indices };
}
