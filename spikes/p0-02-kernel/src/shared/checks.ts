// Mesh utilities that do not depend on any kernel: binary STL writer,
// watertightness check and signed-volume check.

import type { MeshData } from './types.ts';

/** Binary STL from an indexed mesh. Facet normals come from the winding. */
export function meshToBinaryStl(mesh: Pick<MeshData, 'positions' | 'indices'>): Uint8Array {
  const tris = mesh.indices.length / 3;
  const buf = new ArrayBuffer(84 + tris * 50);
  const dv = new DataView(buf);
  const header = 'Extrudo P0-02 spike';
  for (let i = 0; i < header.length; i++) dv.setUint8(i, header.charCodeAt(i));
  dv.setUint32(80, tris, true);
  const p = mesh.positions;
  let o = 84;
  for (let t = 0; t < tris; t++) {
    const a = mesh.indices[t * 3] * 3;
    const b = mesh.indices[t * 3 + 1] * 3;
    const c = mesh.indices[t * 3 + 2] * 3;
    const ux = p[b] - p[a];
    const uy = p[b + 1] - p[a + 1];
    const uz = p[b + 2] - p[a + 2];
    const vx = p[c] - p[a];
    const vy = p[c + 1] - p[a + 1];
    const vz = p[c + 2] - p[a + 2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len;
    ny /= len;
    nz /= len;
    for (const v of [nx, ny, nz]) {
      dv.setFloat32(o, v, true);
      o += 4;
    }
    for (const idx of [a, b, c]) {
      dv.setFloat32(o, p[idx], true);
      dv.setFloat32(o + 4, p[idx + 1], true);
      dv.setFloat32(o + 8, p[idx + 2], true);
      o += 12;
    }
    o += 2;
  }
  return new Uint8Array(buf);
}

/**
 * Parse a binary STL, weld vertices by exact float position and check that
 * every undirected edge is used by exactly two triangles, once in each
 * direction (closed, consistently oriented, edge-manifold). Also returns the
 * signed volume.
 */
export function checkStl(stl: Uint8Array): {
  triangles: number;
  watertight: boolean;
  badEdges: number;
  volume: number;
} {
  const dv = new DataView(stl.buffer, stl.byteOffset, stl.byteLength);
  const tris = dv.getUint32(80, true);
  const ids = new Map<string, number>();
  const vid = (x: number, y: number, z: number) => {
    const k = `${x},${y},${z}`;
    let id = ids.get(k);
    if (id === undefined) {
      id = ids.size;
      ids.set(k, id);
    }
    return id;
  };
  const directed = new Map<string, number>();
  let volume = 0;
  for (let t = 0; t < tris; t++) {
    const o = 84 + t * 50 + 12;
    const v: number[][] = [];
    for (let k = 0; k < 3; k++) {
      v.push([
        dv.getFloat32(o + k * 12, true),
        dv.getFloat32(o + k * 12 + 4, true),
        dv.getFloat32(o + k * 12 + 8, true),
      ]);
    }
    const [a, b, c] = v;
    volume +=
      (a[0] * (b[1] * c[2] - b[2] * c[1]) -
        a[1] * (b[0] * c[2] - b[2] * c[0]) +
        a[2] * (b[0] * c[1] - b[1] * c[0])) /
      6;
    const id = v.map(([x, y, z]) => vid(x, y, z));
    for (let k = 0; k < 3; k++) {
      const key = `${id[k]}>${id[(k + 1) % 3]}`;
      directed.set(key, (directed.get(key) ?? 0) + 1);
    }
  }
  let badEdges = 0;
  for (const [key, count] of directed) {
    const [a, b] = key.split('>');
    if (count !== 1 || directed.get(`${b}>${a}`) !== 1) badEdges++;
  }
  return { triangles: tris, watertight: badEdges === 0, badEdges, volume };
}

/** Simple stopwatch helper. */
export function timer() {
  let t = performance.now();
  return () => {
    const now = performance.now();
    const d = now - t;
    t = now;
    return d;
  };
}

/** Sort key for deterministic ordering of split results by centroid. */
export function centroidKey(c: [number, number, number]): string {
  return c.map((v) => v.toFixed(4).padStart(12, ' ')).join(',');
}
