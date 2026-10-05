/**
 * A mesh body as a `BodyMesh` (P4-06, ADR-0066 §3): **one face** (all the
 * triangles), normals flat across a crease and smooth everywhere else, and
 * the creases themselves as the body's edges — drawn like any edge, but
 * flagged `EDGE_MESH` so picking skips them (there is no B-rep edge to refer
 * to).
 *
 * Pure and free of OCCT and manifold-3d: it takes the triangles and gives the
 * buffers three.js reads, which is also how the tests check it.
 */
import { type BodyMesh, EDGE_MESH } from './mesh';

/**
 * The angle between two triangles' normals over which the surface creases
 * (ADR-0066 §3). Below it the corner normals are averaged (a sphere stays
 * smooth); above it each side keeps its own (a box's sides stay flat).
 */
export const CREASE = Math.PI / 6;

/** Indexed triangles in millimetres: what `Manifold.getMesh()` gives. */
export interface MeshTriangles {
  positions: Float32Array | Float64Array;
  indices: Uint32Array;
}

/**
 * One face of all the triangles, with per-node normals and the creases as
 * edges. A node is shared where every triangle that uses it meets there
 * smoothly (so a sphere keeps one node per vertex), and split where they
 * don't (a box's corner has three normals and three nodes).
 *
 * Linear in the triangles: the edges are found through one map, the corners
 * grouped with union-find, and each group's normal accumulated in one pass.
 */
export function displayMesh(mesh: MeshTriangles): BodyMesh {
  const { positions: p, indices } = mesh;
  const nodes = Math.floor(p.length / 3);
  const triangles = Math.floor(indices.length / 3);
  const corners = triangles * 3;
  // Each triangle's own normal, and a group per corner (unioned across the
  // smooth edges it takes part in) whose mean is the corner's normal.
  const normals = new Float32Array(triangles * 3);
  for (let t = 0; t < triangles; t++) normals.set(normalOf(p, indices, t), 3 * t);
  const groups = new Int32Array(corners);
  for (let c = 0; c < corners; c++) groups[c] = c;
  const creases = creasedEdges(nodes, indices, normals, groups);

  // One node per (original node, group): smooth parts keep sharing, creases
  // split. The map keeps the nodes in triangle order.
  const lookup = new Map<number, number>();
  const outPositions: number[] = [];
  const outNormals: number[] = [];
  const sums = new Map<number, [number, number, number]>();
  for (let c = 0; c < corners; c++) {
    const root = find(groups, c);
    const sum = sums.get(root) ?? [0, 0, 0];
    const t = Math.floor(c / 3);
    sum[0] += normals[3 * t] as number;
    sum[1] += normals[3 * t + 1] as number;
    sum[2] += normals[3 * t + 2] as number;
    sums.set(root, sum);
  }
  const nodeOf = new Uint32Array(corners);
  for (let c = 0; c < corners; c++) {
    const v = indices[c] as number;
    const root = find(groups, c);
    const key = v * corners + root;
    let at = lookup.get(key);
    if (at === undefined) {
      at = outPositions.length / 3;
      lookup.set(key, at);
      outPositions.push(p[3 * v] as number, p[3 * v + 1] as number, p[3 * v + 2] as number);
      const sum = sums.get(root) as [number, number, number];
      const length = Math.hypot(sum[0], sum[1], sum[2]);
      outNormals.push(
        ...(length > 0 ? [sum[0] / length, sum[1] / length, sum[2] / length] : [0, 0, 1]),
      );
    }
    nodeOf[c] = at;
  }
  const edgePoints = new Float32Array(creases.length * 6);
  creases.forEach(([a, b], i) => {
    for (const [k, v] of [a, b].entries()) {
      edgePoints[6 * i + 3 * k] = p[3 * v] as number;
      edgePoints[6 * i + 3 * k + 1] = p[3 * v + 1] as number;
      edgePoints[6 * i + 3 * k + 2] = p[3 * v + 2] as number;
    }
  });
  return {
    positions: new Float32Array(outPositions),
    normals: new Float32Array(outNormals),
    indices: nodeOf,
    faceRanges: new Uint32Array([0, triangles]),
    edgePoints,
    edgeRanges: new Uint32Array(creases.flatMap((_, i) => [2 * i, 2])),
    edgeFlags: new Uint8Array(creases.length).fill(EDGE_MESH),
    vertices: new Float32Array(0),
    // Tells the app this body is a mesh: no B-rep face to put a feature on.
    mesh: true,
  };
}

/**
 * Unions the corners of every pair of triangles that meets at an edge
 * smoothly, and returns the edges the two meet at sharply: the creases the
 * body draws and picks around.
 */
function creasedEdges(
  nodes: number,
  indices: Uint32Array,
  normals: Float32Array,
  groups: Int32Array,
): [number, number][] {
  const triangles = Math.floor(indices.length / 3);
  // Undirected edge (low, high) → the triangle that first used it, then the
  // second one's triangle number.
  const edges = new Map<number, number>();
  const creases: [number, number][] = [];
  for (let t = 0; t < triangles; t++) {
    for (let corner = 0; corner < 3; corner++) {
      const a = indices[3 * t + corner] as number;
      const b = indices[3 * t + ((corner + 1) % 3)] as number;
      if (a === b || a >= nodes || b >= nodes) continue;
      const [low, high] = a < b ? [a, b] : [b, a];
      const key = low * nodes + high;
      const first = edges.get(key);
      if (first === undefined) {
        edges.set(key, t);
        continue;
      }
      edges.delete(key);
      // The angle between the two triangles' normals, 0 across a flat surface.
      const cosine = dot3(normals, 3 * first, normals, 3 * t);
      if (Math.acos(Math.min(1, Math.max(-1, cosine))) > CREASE) {
        creases.push([low, high]);
        continue;
      }
      // Smooth: the corners at both ends of this edge share a normal.
      for (const end of [low, high]) {
        union(groups, 3 * first + cornerOf(indices, first, end), 3 * t + cornerOf(indices, t, end));
      }
    }
  }
  return creases;
}

/** Which of a triangle's three corners is the node `v`. */
function cornerOf(indices: Uint32Array, triangle: number, v: number): number {
  for (let corner = 0; corner < 3; corner++)
    if (indices[3 * triangle + corner] === v) return corner;
  return 0;
}

/** The unit normal of one triangle by the right-hand rule (zeros when flat). */
function normalOf(p: MeshTriangles['positions'], indices: Uint32Array, t: number) {
  const [a, b, c] = [
    indices[3 * t] as number,
    indices[3 * t + 1] as number,
    indices[3 * t + 2] as number,
  ];
  const ux = (p[3 * b] as number) - (p[3 * a] as number);
  const uy = (p[3 * b + 1] as number) - (p[3 * a + 1] as number);
  const uz = (p[3 * b + 2] as number) - (p[3 * a + 2] as number);
  const vx = (p[3 * c] as number) - (p[3 * a] as number);
  const vy = (p[3 * c + 1] as number) - (p[3 * a + 1] as number);
  const vz = (p[3 * c + 2] as number) - (p[3 * a + 2] as number);
  const n = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
  const length = Math.hypot(n[0] as number, n[1] as number, n[2] as number);
  return length > 0
    ? [(n[0] as number) / length, (n[1] as number) / length, (n[2] as number) / length]
    : [0, 0, 0];
}

/** The group's root, with the path to it flattened as we go. */
function find(groups: Int32Array, c: number): number {
  let at = groups[c] as number;
  while (at !== (groups[at] as number)) at = groups[at] as number;
  let walk = c;
  while ((groups[walk] as number) !== at) {
    const next = groups[walk] as number;
    groups[walk] = at;
    walk = next;
  }
  return at;
}

function union(groups: Int32Array, a: number, b: number): void {
  const [low, high] = find(groups, a) < find(groups, b) ? [a, b] : [b, a];
  groups[find(groups, high)] = find(groups, low);
}

function dot3(a: Float32Array, at: number, b: Float32Array, bt: number): number {
  return (
    (a[at] as number) * (b[bt] as number) +
    (a[at + 1] as number) * (b[bt + 1] as number) +
    (a[at + 2] as number) * (b[bt + 2] as number)
  );
}
