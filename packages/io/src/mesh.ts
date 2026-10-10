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

/** What `splitNonManifoldEdges` did: the mesh, and how many edges it separated. */
export interface NonManifoldSplit {
  /**
   * The same mesh when nothing needed splitting; otherwise a mesh whose
   * touching surfaces no longer share edges or vertices.
   */
  mesh: TriangleMesh;
  /** Edges used by more than two triangles that were separated into sheets. */
  split: number;
}

/**
 * Separates surfaces that touch along an edge or at a vertex (ADR-0066's
 * 2026-10-09 amendment). An STL has no topology: `readStl` welds corners by
 * exact position, so where two closed surfaces meet along an edge that edge
 * ends up used by four triangles, and where they meet at one point its fan
 * falls into several discs. Each surface is fine on its own; the weld glues
 * them together. This duplicates the shared edge's end nodes (and a shared
 * vertex) so every surface keeps its own, which is what manifold-3d needs
 * while the parts still touch geometrically.
 *
 * For an edge used by 2n triangles the forward and backward uses are paired
 * about the edge by dihedral angle (neighbours of opposite direction), which
 * keeps each surface's own neighbours together. An edge whose uses don't
 * balance (3 forward, 1 backward) is left as it is: `checkManifold` refuses it.
 */
export function splitNonManifoldEdges(mesh: TriangleMesh): NonManifoldSplit {
  const { positions, indices } = mesh;
  const nodeCount = Math.floor(positions.length / 3);
  const triangles = Math.floor(indices.length / 3);
  if (triangles === 0 || nodeCount === 0) return { mesh, split: 0 };
  // Weld by exact position into representative nodes, the way `readStl` does,
  // so the topology is the one the file's shared coordinates make.
  const reps = new Uint32Array(nodeCount);
  const firstOf = new Map<string, number>();
  for (let i = 0; i < nodeCount; i++) {
    const key = `${positions[3 * i]},${positions[3 * i + 1]},${positions[3 * i + 2]}`;
    const known = firstOf.get(key);
    if (known === undefined) {
      firstOf.set(key, i);
      reps[i] = i;
    } else {
      reps[i] = known;
    }
  }
  // Each triangle's three representative nodes, or -1 for one to leave alone.
  const rep = new Int32Array(triangles * 3).fill(-1);
  const good = new Uint8Array(triangles);
  for (let t = 0; t < triangles; t++) {
    const a = indices[3 * t] as number;
    const b = indices[3 * t + 1] as number;
    const c = indices[3 * t + 2] as number;
    if (a === b || b === c || a === c || a >= nodeCount || b >= nodeCount || c >= nodeCount) {
      continue;
    }
    good[t] = 1;
    rep[3 * t] = reps[a] as number;
    rep[3 * t + 1] = reps[b] as number;
    rep[3 * t + 2] = reps[c] as number;
  }
  // Count every undirected edge's uses by the key low * nodeCount + high.
  const counted = new Map<number, number>();
  const keyOf = (a: number, b: number) => (a < b ? a * nodeCount + b : b * nodeCount + a);
  for (let t = 0; t < triangles; t++) {
    if (!good[t]) continue;
    for (let e = 0; e < 3; e++) {
      const na = rep[3 * t + e] as number;
      const nb = rep[3 * t + ((e + 1) % 3)] as number;
      if (na === nb) continue;
      counted.set(keyOf(na, nb), (counted.get(keyOf(na, nb)) ?? 0) + 1);
    }
  }
  // Union-find over corners: two corners of one vertex are joined when their
  // triangles share an edge that connects them (a normal manifold edge, or a
  // pair of a non-manifold one). Each component is one fan of that vertex.
  const parent = new Int32Array(triangles * 3);
  for (let i = 0; i < parent.length; i++) parent[i] = i;
  const find = (a: number): number => {
    let at = a;
    while ((parent[at] as number) !== at) {
      parent[at] = parent[parent[at] as number] as number;
      at = parent[at] as number;
    }
    return at;
  };
  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  };
  let split = 0;
  // Non-manifold edges (3+ uses): pair the uses by angle, then join each pair.
  const heavy = new Map<number, EdgeUse[]>();
  for (let t = 0; t < triangles; t++) {
    if (!good[t]) continue;
    for (let e = 0; e < 3; e++) {
      const ca = e;
      const cb = (e + 1) % 3;
      const na = rep[3 * t + ca] as number;
      const nb = rep[3 * t + cb] as number;
      if (na === nb) continue;
      const key = keyOf(na, nb);
      if ((counted.get(key) ?? 0) <= 2) continue;
      let list = heavy.get(key);
      if (!list) {
        list = [];
        heavy.set(key, list);
      }
      const cc = (e + 2) % 3;
      const third = rep[3 * t + cc] as number;
      const low = na < nb ? na : nb;
      const normal = triangleNormal(
        positions,
        indices[3 * t] as number,
        indices[3 * t + 1] as number,
        indices[3 * t + 2] as number,
      );
      list.push({
        tri: t,
        forward: na < nb,
        cornerLow: (na < nb ? ca : cb) as number,
        cornerHigh: (na < nb ? cb : ca) as number,
        angle: edgeAngle(positions, low, na < nb ? nb : na, third),
        nx: normal[0],
        ny: normal[1],
        nz: normal[2],
        dx: (positions[3 * third] as number) - (positions[3 * low] as number),
        dy: (positions[3 * third + 1] as number) - (positions[3 * low + 1] as number),
        dz: (positions[3 * third + 2] as number) - (positions[3 * low + 2] as number),
      });
    }
  }
  for (const list of heavy.values()) {
    if (list.length < 3) continue;
    let forward = 0;
    for (const use of list) forward += use.forward ? 1 : 0;
    if (forward * 2 !== list.length) continue; // unbalanced: leave for checkManifold
    const sorted = [...list].sort((a, b) => a.angle - b.angle);
    const paired = new Array<boolean>(sorted.length).fill(false);
    let separated = false;
    for (let i = 0; i < sorted.length; i++) {
      if (paired[i]) continue;
      const first = sorted[i] as EdgeUse;
      // The nearest opposite use that bounds material with it keeps a closed
      // surface's own two faces together (the angle alone pairs the wrong
      // ones where two cubes meet).
      let best = -1;
      let bestDistance = Number.POSITIVE_INFINITY;
      for (let j = 0; j < sorted.length; j++) {
        if (j === i || paired[j]) continue;
        const other = sorted[j] as EdgeUse;
        if (first.forward === other.forward || !boundsMaterial(first, other)) continue;
        const raw = Math.abs(first.angle - other.angle);
        const distance = Math.min(raw, Math.PI * 2 - raw);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = j;
        }
      }
      if (best < 0) continue;
      const other = sorted[best] as EdgeUse;
      union(first.tri * 3 + first.cornerLow, other.tri * 3 + other.cornerLow);
      union(first.tri * 3 + first.cornerHigh, other.tri * 3 + other.cornerHigh);
      paired[i] = true;
      paired[best] = true;
      separated = true;
    }
    if (separated) split++;
  }
  // Normal edges: join the two triangles at each of a vertex's corners.
  const seen = new Map<number, { low: number; high: number; forward: boolean }>();
  for (let t = 0; t < triangles; t++) {
    if (!good[t]) continue;
    for (let e = 0; e < 3; e++) {
      const ca = e;
      const cb = (e + 1) % 3;
      const na = rep[3 * t + ca] as number;
      const nb = rep[3 * t + cb] as number;
      if (na === nb) continue;
      const key = keyOf(na, nb);
      if ((counted.get(key) ?? 0) !== 2) continue;
      const forward = na < nb;
      const mine = {
        low: t * 3 + (forward ? ca : cb),
        high: t * 3 + (forward ? cb : ca),
        forward,
      };
      const other = seen.get(key);
      if (!other) {
        seen.set(key, mine);
      } else if (other.forward !== forward) {
        union(other.low, mine.low);
        union(other.high, mine.high);
      }
    }
  }
  // Roots identify fans; a vertex with one fan is unchanged.
  const rootOf = new Int32Array(triangles * 3).fill(-1);
  const roots = new Set<number>();
  const vertices = new Set<number>();
  for (let i = 0; i < rep.length; i++) {
    if ((rep[i] as number) < 0) continue;
    const root = find(i);
    rootOf[i] = root;
    roots.add(root);
    vertices.add(rep[i] as number);
  }
  if (split === 0 && roots.size === vertices.size) return { mesh, split: 0 };
  // Rebuild: fan 0 keeps the representative's node, later fans get copies.
  const outIndices = new Uint32Array(indices);
  const outPositions = Array.from(positions);
  const rootNode = new Map<number, number>();
  const fans = new Map<number, number>();
  for (let i = 0; i < rep.length; i++) {
    const r = rep[i] as number;
    if (r < 0) continue;
    const root = rootOf[i] as number;
    let node = rootNode.get(root);
    if (node === undefined) {
      const fan = fans.get(r) ?? 0;
      fans.set(r, fan + 1);
      if (fan === 0) {
        node = r;
      } else {
        node = outPositions.length / 3;
        outPositions.push(
          positions[3 * r] as number,
          positions[3 * r + 1] as number,
          positions[3 * r + 2] as number,
        );
      }
      rootNode.set(root, node);
    }
    outIndices[i] = node;
  }
  return {
    mesh: { positions: new Float64Array(outPositions), indices: outIndices },
    split,
  };
}

/** One triangle's use of an edge, for separating a non-manifold one. */
interface EdgeUse {
  tri: number;
  /** The triangle runs low → high. */
  forward: boolean;
  cornerLow: number;
  cornerHigh: number;
  /** Dihedral angle about the edge (the third corner projected), for pairing. */
  angle: number;
  /** The triangle's outward normal. */
  nx: number;
  ny: number;
  nz: number;
  /** The direction from the edge's low node to the third corner. */
  dx: number;
  dy: number;
  dz: number;
}

/**
 * Whether two opposite uses of an edge bound material between them: each
 * triangle's third corner lies on the other's material side (the side its
 * outward normal points away from). This is what tells two touching surfaces
 * apart when the angle alone can't (a cube edge's two faces are 90° from the
 * other cube's, either way round).
 */
function boundsMaterial(a: EdgeUse, b: EdgeUse): boolean {
  return a.nx * b.dx + a.ny * b.dy + a.nz * b.dz < 0 && b.nx * a.dx + b.ny * a.dy + b.nz * a.dz < 0;
}

/**
 * The angle of the third corner about the edge low → high, in the plane
 * perpendicular to it: the order of the uses around the edge. The plane's
 * reference frame is fixed by the edge, so every use is comparable.
 */
function edgeAngle(p: TriangleMesh['positions'], low: number, high: number, w: number): number {
  const lx = p[3 * low] as number;
  const ly = p[3 * low + 1] as number;
  const lz = p[3 * low + 2] as number;
  let ex = (p[3 * high] as number) - lx;
  let ey = (p[3 * high + 1] as number) - ly;
  let ez = (p[3 * high + 2] as number) - lz;
  const length = Math.hypot(ex, ey, ez);
  if (length === 0) return 0;
  ex /= length;
  ey /= length;
  ez /= length;
  let dx = (p[3 * w] as number) - lx;
  let dy = (p[3 * w + 1] as number) - ly;
  let dz = (p[3 * w + 2] as number) - lz;
  const along = dx * ex + dy * ey + dz * ez;
  dx -= along * ex;
  dy -= along * ey;
  dz -= along * ez;
  // A reference not parallel to the edge, made square to it, gives the frame.
  let rx = 1;
  let ry = 0;
  let rz = 0;
  if (Math.abs(ex) > 0.9) {
    rx = 0;
    ry = 0;
    rz = 1;
  }
  const rdot = rx * ex + ry * ey + rz * ez;
  let px = rx - rdot * ex;
  let py = ry - rdot * ey;
  let pz = rz - rdot * ez;
  const plen = Math.hypot(px, py, pz);
  px /= plen;
  py /= plen;
  pz /= plen;
  const qx = ey * pz - ez * py;
  const qy = ez * px - ex * pz;
  const qz = ex * py - ey * px;
  return Math.atan2(dx * qx + dy * qy + dz * qz, dx * px + dy * py + dz * pz);
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
