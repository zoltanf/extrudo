/**
 * Binary STL: an 80-byte header, a little-endian uint32 triangle count, then
 * per triangle a float32 normal, three float32 corners and a uint16
 * attribute (0). STL has no units; by convention (and every slicer's
 * default) the numbers are millimetres. It has no objects either: several
 * bodies go into one file as one list of triangles.
 */
import { mergeMeshes, type TriangleMesh, triangleNormal } from './mesh';

export interface StlOptions {
  /**
   * Header text, ASCII, cut to 80 bytes. It must not start with "solid"
   * (readers would take the file for ASCII STL), so such text gets a prefix.
   */
  header?: string;
}

const HEADER_BYTES = 80;
const TRIANGLE_BYTES = 50;

/** Writes meshes as one binary STL file. */
export function writeStl(meshes: TriangleMesh | readonly TriangleMesh[], options: StlOptions = {}) {
  const mesh = Array.isArray(meshes) ? mergeMeshes(meshes) : (meshes as TriangleMesh);
  const { positions: p, indices } = mesh;
  const count = Math.floor(indices.length / 3);
  const bytes = new Uint8Array(HEADER_BYTES + 4 + count * TRIANGLE_BYTES);
  const view = new DataView(bytes.buffer);
  let header = options.header ?? 'Binary STL, units: mm';
  if (/^\s*solid/i.test(header)) header = `STL ${header}`;
  for (let i = 0; i < Math.min(header.length, HEADER_BYTES); i++) {
    const code = header.charCodeAt(i);
    bytes[i] = code >= 0x20 && code < 0x7f ? code : 0x3f; // '?'
  }
  view.setUint32(HEADER_BYTES, count, true);
  let at = HEADER_BYTES + 4;
  for (let t = 0; t < count; t++) {
    const corners = [indices[3 * t], indices[3 * t + 1], indices[3 * t + 2]] as number[];
    const [a, b, c] = corners as [number, number, number];
    for (const v of triangleNormal(p, a, b, c)) {
      view.setFloat32(at, v, true);
      at += 4;
    }
    for (const node of corners) {
      for (let k = 0; k < 3; k++) {
        view.setFloat32(at, p[3 * node + k] as number, true);
        at += 4;
      }
    }
    view.setUint16(at, 0, true);
    at += 2;
  }
  return bytes;
}

/** What `readStl` found besides the mesh. */
export interface StlFile {
  /** Corners that are equal to the bit are one node. */
  mesh: TriangleMesh;
  header: string;
  /** Each triangle's stored normal, xyz. */
  normals: Float32Array;
}

/**
 * Reads a binary STL. Corners with exactly equal coordinates become one
 * node, which rebuilds the topology of a mesh written from shared nodes
 * (enough to check it with `checkManifold`). ASCII STL isn't read.
 */
export function readStl(bytes: Uint8Array): StlFile {
  if (bytes.length < HEADER_BYTES + 4) throw new Error('Not a binary STL file: too short.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = view.getUint32(HEADER_BYTES, true);
  if (bytes.length !== HEADER_BYTES + 4 + count * TRIANGLE_BYTES) {
    throw new Error(`Not a binary STL file: ${count} triangles need a different file size.`);
  }
  let header = '';
  for (let i = 0; i < HEADER_BYTES && bytes[i] !== 0; i++) {
    header += String.fromCharCode(bytes[i] as number);
  }
  const normals = new Float32Array(count * 3);
  const indices = new Uint32Array(count * 3);
  const positions: number[] = [];
  const nodes = new Map<string, number>();
  let at = HEADER_BYTES + 4;
  for (let t = 0; t < count; t++) {
    for (let k = 0; k < 3; k++) normals[3 * t + k] = view.getFloat32(at + 4 * k, true);
    at += 12;
    for (let corner = 0; corner < 3; corner++) {
      const x = view.getFloat32(at, true);
      const y = view.getFloat32(at + 4, true);
      const z = view.getFloat32(at + 8, true);
      at += 12;
      const key = `${x},${y},${z}`;
      let node = nodes.get(key);
      if (node === undefined) {
        node = positions.length / 3;
        nodes.set(key, node);
        positions.push(x, y, z);
      }
      indices[3 * t + corner] = node;
    }
    at += 2;
  }
  return { mesh: { positions: new Float32Array(positions), indices }, header, normals };
}
