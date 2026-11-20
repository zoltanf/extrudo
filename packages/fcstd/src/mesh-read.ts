/**
 * FreeCAD's mesh kernel entry (`*.bms`, `MeshKernel::Write`; FORMAT.md) read
 * into points and facets, and what the triangles are once placed: their
 * pieces, whether they close, their volume and box (P6-25 S12b, ADR-0144).
 * Pure: no kernel, no DOM. Every count is checked against the entry's length
 * before anything is allocated, every index against the points, every
 * coordinate for being finite.
 */
import {
  checkManifold,
  dropBadTriangles,
  splitNonManifoldEdges,
  type TriangleMesh,
} from '@extrudo/io';
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
  /** The placed triangles, as the STL holds them (single precision), flat and repeated ones dropped. */
  readonly triangles: TriangleMesh;
  /** Pieces joined by shared edges. */
  readonly pieces: number;
  /** What keeps it from closing, as the kernel counts it: open, non-manifold after the split and flipped edges, bad triangles. */
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
 * Closed and in pieces exactly as the kernel's `meshFrom` makes it: flat and
 * repeated triangles dropped, edges where surfaces touch split apart
 * (`@extrudo/io`'s own steps), then the manifold check.
 */
export function meshFacts(mesh: MeshKernel, chain: readonly FcPlacement[]): MeshFacts {
  let place: FcPlacement = { position: [0, 0, 0], rotation: [0, 0, 0, 1] };
  for (const p of chain) place = compose(place, p);
  const { points, facets } = mesh;
  // Placed, in single precision, and welded by exact position: what `readStl` gives the kernel.
  const index = new Map<string, number>();
  const remap = new Uint32Array(points.length / 3);
  const positions: number[] = [];
  for (let i = 0; i < points.length / 3; i++) {
    const [x, y, z] = rotate(place.rotation, [
      points[3 * i] as number,
      points[3 * i + 1] as number,
      points[3 * i + 2] as number,
    ]);
    const v = [
      Math.fround(x + place.position[0]),
      Math.fround(y + place.position[1]),
      Math.fround(z + place.position[2]),
    ];
    const key = `${v[0]},${v[1]},${v[2]}`;
    let n = index.get(key);
    if (n === undefined) {
      n = positions.length / 3;
      index.set(key, n);
      positions.push(...(v as [number, number, number]));
    }
    remap[i] = n;
  }
  const welded: TriangleMesh = {
    positions: Float32Array.from(positions),
    indices: facets.map((f) => remap[f] as number),
  };
  // What `meshFrom` builds from these triangles, step by step.
  const kept = dropBadTriangles(welded).mesh;
  const separated = splitNonManifoldEdges(kept);
  const report = checkManifold(separated.mesh);
  const openEdges =
    report.boundaryEdges + report.nonManifoldEdges + report.misorientedEdges + report.badTriangles;
  // Pieces: triangles joined by shared edges (a split keeps touching surfaces apart).
  const solid = separated.mesh;
  const nodes = solid.positions.length / 3;
  const count = solid.indices.length / 3;
  const parent = new Int32Array(count).map((_, i) => i);
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
  const byEdge = new Map<number, number>();
  let volume = 0;
  let area = 0;
  const moment: [number, number, number] = [0, 0, 0];
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  const at = (i: number, k: number) => solid.positions[3 * i + k] as number;
  for (let t = 0; t < count; t++) {
    const c = [solid.indices[3 * t], solid.indices[3 * t + 1], solid.indices[3 * t + 2]] as [
      number,
      number,
      number,
    ];
    for (let e = 0; e < 3; e++) {
      const a = c[e] as number;
      const b = c[(e + 1) % 3] as number;
      const key = Math.min(a, b) * nodes + Math.max(a, b);
      const other = byEdge.get(key);
      if (other === undefined) byEdge.set(key, t);
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
    for (const i of c)
      for (let k = 0; k < 3; k++) {
        const x = at(i, k);
        if (x < (min[k] as number)) min[k] = x;
        if (x > (max[k] as number)) max[k] = x;
      }
  }
  let pieces = 0;
  for (let t = 0; t < count; t++) if (find(t) === t) pieces++;
  return {
    triangles: kept,
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
