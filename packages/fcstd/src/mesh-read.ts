/**
 * FreeCAD's mesh kernel entry (`*.bms`, `MeshKernel::Write`; FORMAT.md) read
 * into points and facets, and what the triangles are once placed: their
 * pieces, whether they close, their volume and box (P6-25 S12b, ADR-0144).
 * Pure: no kernel, no DOM. Every count is checked against the entry's length
 * before anything is allocated, every index against the points, every
 * coordinate for being finite.
 */
import type { TriangleMesh } from '@extrudo/io';
import { rotate } from './final-shapes';
import type { FcPlacement } from './model';
import { compose } from './sketch-place';

/**
 * The most facets a mesh may have. A binary STL is 84 bytes and 50 a
 * triangle, so 500,000 facets are 25,000,084 bytes: under ADR-0066's 25 MiB
 * an attachment (26,214,400 bytes) with room for nothing larger, and half
 * the kernel's 1,000,000 triangles a mesh import. The library's largest has
 * about 6,000.
 */
export const MAX_MESH_FACETS = 500_000;

/** Magic, version, header, the two counts. */
const HEAD = 4 + 4 + 256 + 8;
/** The bounding box after the facets: six `float32`. */
const TAIL = 24;
const MAGIC = 0xa0b0c0d0;
const VERSION = 0x00010000;
const OPEN_EDGE = 0xffffffff;

/** The biggest entry a mesh under `maxFacets` can be (as many points as three a facet). */
export const maxMeshEntryBytes = (maxFacets = MAX_MESH_FACETS) =>
  HEAD + 12 * 3 * maxFacets + 24 * maxFacets + TAIL;

export type MeshRefusal =
  /** Not FreeCAD's little-endian mesh kernel, version 1. */
  | 'format'
  /** The entry isn't exactly what its counts say. */
  | 'length'
  /** More facets than `MAX_MESH_FACETS`. */
  | 'facets'
  /** A facet names a point or a neighbour that isn't there. */
  | 'index'
  /** A coordinate that isn't a finite number. */
  | 'coordinate'
  /** A facet that names one point twice. */
  | 'degenerate';

export interface MeshKernel {
  /** x, y, z a point, in the object's own frame. */
  readonly points: Float32Array;
  /** Three point indices a facet. */
  readonly facets: Uint32Array;
}

export type MeshRead =
  | { readonly mesh: MeshKernel }
  /** No facets: nothing to import. */
  | { readonly empty: true }
  | { readonly refused: MeshRefusal; readonly detail: string };

/** Reads a mesh kernel entry, or says exactly why not. */
export function readMeshKernel(bytes: Uint8Array, maxFacets = MAX_MESH_FACETS): MeshRead {
  if (bytes.length < HEAD + TAIL)
    return { refused: 'length', detail: `the mesh entry is ${bytes.length} bytes, too short` };
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== MAGIC || view.getUint32(4, true) !== VERSION)
    return { refused: 'format', detail: "the mesh entry isn't in the form FreeCAD writes" };
  const points = view.getUint32(264, true);
  const facets = view.getUint32(268, true);
  if (facets > maxFacets)
    return {
      refused: 'facets',
      detail: `the mesh has ${facets} facets; at most ${maxFacets} come in`,
    };
  // Exact in a double: at most 296 + 12·(2³²−1) + 24·maxFacets.
  const expected = HEAD + 12 * points + 24 * facets + TAIL;
  if (bytes.length !== expected)
    return {
      refused: 'length',
      detail: `the mesh entry is ${bytes.length} bytes where its counts say ${expected}`,
    };
  if (facets === 0) return { empty: true };
  const p = new Float32Array(points * 3);
  for (let i = 0; i < p.length; i++) {
    const v = view.getFloat32(HEAD + 4 * i, true);
    if (!Number.isFinite(v))
      return { refused: 'coordinate', detail: `point ${Math.floor(i / 3)} isn't a finite number` };
    p[i] = v;
  }
  const f = new Uint32Array(facets * 3);
  let at = HEAD + 12 * points;
  for (let i = 0; i < facets; i++, at += 24) {
    const a = view.getUint32(at, true);
    const b = view.getUint32(at + 4, true);
    const c = view.getUint32(at + 8, true);
    if (a >= points || b >= points || c >= points)
      return { refused: 'index', detail: `facet ${i} names a point past the ${points} there are` };
    if (a === b || b === c || a === c)
      return { refused: 'degenerate', detail: `facet ${i} names one point twice` };
    for (let k = 12; k < 24; k += 4) {
      const n = view.getUint32(at + k, true);
      if (n >= facets && n !== OPEN_EDGE)
        return { refused: 'index', detail: `facet ${i} names a neighbour that isn't there` };
    }
    f[3 * i] = a;
    f[3 * i + 1] = b;
    f[3 * i + 2] = c;
  }
  return { mesh: { points: p, facets: f } };
}

/** What a mesh's triangles are once placed. */
export interface MeshFacts {
  /** The placed triangles, as the STL holds them (single precision). */
  readonly triangles: TriangleMesh;
  /** Pieces joined by shared edges. */
  readonly pieces: number;
  /** Edges not met by exactly one opposite edge: 0 for a closed, consistently turned surface. */
  readonly openEdges: number;
  /** The enclosed volume (positive when the facets face outwards), mm³. */
  readonly volume: number;
  readonly area: number;
  readonly box: {
    readonly min: readonly [number, number, number];
    readonly max: readonly [number, number, number];
  };
  /** The centre of the enclosed volume (of the box when it encloses none), mm. */
  readonly centre: readonly [number, number, number];
}

/**
 * The mesh placed by `chain` (outermost first, the object's own placement
 * last), in single precision as the STL stores it, and measured from those
 * same numbers: the volume, area and box the import is checked against.
 */
export function meshFacts(mesh: MeshKernel, chain: readonly FcPlacement[]): MeshFacts {
  let place: FcPlacement = { position: [0, 0, 0], rotation: [0, 0, 0, 1] };
  for (const p of chain) place = compose(place, p);
  const { points, facets } = mesh;
  // Only the points the facets use, once each by position: two points at one place are one.
  const index = new Map<string, number>();
  const remap = new Uint32Array(points.length / 3).fill(OPEN_EDGE);
  const positions: number[] = [];
  const indices = new Uint32Array(facets.length);
  for (let i = 0; i < facets.length; i++) {
    const old = facets[i] as number;
    let n = remap[old] as number;
    if (n === OPEN_EDGE) {
      const [x, y, z] = rotate(place.rotation, [
        points[3 * old] as number,
        points[3 * old + 1] as number,
        points[3 * old + 2] as number,
      ]);
      const v = [
        Math.fround(x + place.position[0]),
        Math.fround(y + place.position[1]),
        Math.fround(z + place.position[2]),
      ];
      const key = `${v[0]},${v[1]},${v[2]}`;
      const known = index.get(key);
      if (known === undefined) {
        n = positions.length / 3;
        index.set(key, n);
        positions.push(...v);
      } else n = known;
      remap[old] = n;
    }
    indices[i] = n;
  }
  const count = positions.length / 3;
  // Directed edges: a closed surface turned one way meets each a→b once and b→a once.
  const directed = new Map<number, number>();
  const parent = new Int32Array(facets.length / 3).map((_, i) => i);
  const find = (x: number): number => {
    let r = x;
    while (parent[r] !== r) r = parent[r] as number;
    for (let y = x; parent[y] !== r; ) {
      const next = parent[y] as number;
      parent[y] = r;
      y = next;
    }
    return r;
  };
  const firstFacet = new Map<number, number>();
  let volume = 0;
  let area = 0;
  const moment: [number, number, number] = [0, 0, 0];
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  const at = (i: number, k: number) => positions[3 * i + k] as number;
  for (let t = 0; t < indices.length / 3; t++) {
    const c = [indices[3 * t], indices[3 * t + 1], indices[3 * t + 2]] as [number, number, number];
    for (let e = 0; e < 3; e++) {
      const a = c[e] as number;
      const b = c[(e + 1) % 3] as number;
      const key = a * count + b;
      directed.set(key, (directed.get(key) ?? 0) + 1);
      const undirected = Math.min(a, b) * count + Math.max(a, b);
      const other = firstFacet.get(undirected);
      if (other === undefined) firstFacet.set(undirected, t);
      else parent[find(t)] = find(other);
    }
    const [ax, ay, az] = [at(c[0], 0), at(c[0], 1), at(c[0], 2)];
    const [bx, by, bz] = [at(c[1], 0), at(c[1], 1), at(c[1], 2)];
    const [cx, cy, cz] = [at(c[2], 0), at(c[2], 1), at(c[2], 2)];
    const v = (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
    volume += v;
    // The tetrahedron from the origin: its centre is a quarter of its corners' sum.
    moment[0] += (v * (ax + bx + cx)) / 4;
    moment[1] += (v * (ay + by + cy)) / 4;
    moment[2] += (v * (az + bz + cz)) / 4;
    const ux = bx - ax;
    const uy = by - ay;
    const uz = bz - az;
    const vx = cx - ax;
    const vy = cy - ay;
    const vz = cz - az;
    area += Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
  }
  for (let i = 0; i < count; i++)
    for (let k = 0; k < 3; k++) {
      const v = at(i, k);
      if (v < (min[k] as number)) min[k] = v;
      if (v > (max[k] as number)) max[k] = v;
    }
  let openEdges = 0;
  for (const [key, n] of directed) {
    const a = Math.floor(key / count);
    const b = key - a * count;
    if (n !== 1 || directed.get(b * count + a) !== 1) openEdges++;
  }
  let pieces = 0;
  for (let t = 0; t < parent.length; t++) if (find(t) === t) pieces++;
  return {
    triangles: { positions: Float32Array.from(positions), indices },
    pieces,
    openEdges,
    volume,
    area,
    box: { min, max },
    centre:
      volume !== 0
        ? [moment[0] / volume, moment[1] / volume, moment[2] / volume]
        : [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2],
  };
}
