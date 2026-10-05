/**
 * Binary STL: an 80-byte header, a little-endian uint32 triangle count, then
 * per triangle a float32 normal, three float32 corners and a uint16
 * attribute (0). ASCII STL (`solid` … `endsolid`, P4-06) is read too. STL has
 * no units; by convention (and every slicer's default) the numbers are
 * millimetres. It has no objects either: several bodies go into one file as
 * one list of triangles.
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
 * Reads an STL file, binary or ASCII (P4-06, ADR-0066 §3). ASCII is detected
 * the way a reader has to: the bytes don't fit the binary layout and start
 * with `solid` (a binary file's header may begin with it too, but its size
 * says otherwise). Corners with exactly equal coordinates become one node,
 * which rebuilds the topology of a mesh written from shared nodes (enough to
 * check it with `checkManifold`).
 *
 * An ASCII file's `facet normal` lines are read for `normals` (binary STL's
 * are), but the mesh never uses them: the triangle's own winding gives the
 * normal that matters.
 */
export function readStl(bytes: Uint8Array): StlFile {
  if (bytes.length < HEADER_BYTES + 4) throw new Error('Not an STL file: too short.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = view.getUint32(HEADER_BYTES, true);
  const fitsBinary = bytes.length === HEADER_BYTES + 4 + count * TRIANGLE_BYTES;
  if (!fitsBinary && isAscii(bytes)) return readAsciiStl(bytes);
  if (!fitsBinary) {
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

/**
 * The triangle count of a binary STL, read from its header alone: how a
 * reader refuses a file with more triangles than it will read without reading
 * it (P4-06, ADR-0066 §3). Undefined for an ASCII file, which has no count to
 * read — its triangles are counted as they are parsed.
 */
export function stlTriangleCount(bytes: Uint8Array): number | undefined {
  if (bytes.length < HEADER_BYTES + 4) return undefined;
  const count = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(
    HEADER_BYTES,
    true,
  );
  // A binary file's size says so; anything else that isn't ASCII is a binary
  // file the header's count is still the best word for.
  return bytes.length === HEADER_BYTES + 4 + count * TRIANGLE_BYTES || !isAscii(bytes)
    ? count
    : undefined;
}

/** Whether a file that doesn't fit the binary layout is ASCII STL (`solid` and `facet`). */
function isAscii(bytes: Uint8Array): boolean {
  // Only the first lines matter, and a file may start with a BOM.
  const head = new TextDecoder().decode(bytes.subarray(0, 1024)).replace(/^\uFEFF/, '');
  return /^\s*solid\b/i.test(head) || /^\s*facet\b/i.test(head);
}

/**
 * Reads ASCII STL: `solid name`, then per facet `facet normal nx ny nz` and
 * `outer loop` with three `vertex x y z` lines and `endloop`, then
 * `endfacet`, and `endsolid`. `endsolid`, `end` and the colour extensions
 * (`solid color=`) are left out; nothing else is read, so a file that carries
 * more reads its triangles.
 */
function readAsciiStl(bytes: Uint8Array): StlFile {
  const text = new TextDecoder().decode(bytes);
  const normals: number[] = [];
  const indices: number[] = [];
  const positions: number[] = [];
  const nodes = new Map<string, number>();
  const line = (match: RegExpExecArray): [number, number, number] => {
    const xyz = (match[1] as string).trim().split(/\s+/).map(Number);
    if (xyz.length !== 3 || xyz.some((v) => !Number.isFinite(v))) {
      throw new Error(
        `Not an ASCII STL file: "vertex ${(match[1] as string).trim()}" isn't a point.`,
      );
    }
    return xyz as [number, number, number];
  };
  // A node is the corner's coordinates, exactly as the binary reader's key is.
  const node = (xyz: readonly number[]) => {
    const key = xyz.join(',');
    const known = nodes.get(key);
    if (known !== undefined) return known;
    const at = positions.length / 3;
    nodes.set(key, at);
    positions.push(...xyz);
    return at;
  };
  for (const match of text.matchAll(/facet\s+normal\s+([^\r\n]+)/gi)) {
    const xyz = (match[1] as string).trim().split(/\s+/).map(Number);
    if (xyz.length !== 3 || xyz.some((v) => !Number.isFinite(v))) {
      throw new Error(
        `Not an ASCII STL file: "facet normal ${(match[1] as string).trim()}" isn't a normal.`,
      );
    }
    normals.push(...(xyz as [number, number, number]));
  }
  for (const match of text.matchAll(/outer\s+loop\s*([\s\S]*?)endloop/gi)) {
    const corners = [...(match[1] as string).matchAll(/vertex\s+([^\r\n]+)/gi)].map(line);
    if (corners.length !== 3) {
      throw new Error(
        `Not an ASCII STL file: an "outer loop" has ${corners.length} vertices, not 3.`,
      );
    }
    for (const corner of corners) indices.push(node(corner));
  }
  const header = /^\s*solid\s+([^\r\n]*)/i.exec(text)?.[1]?.trim() ?? '';
  return {
    mesh: { positions: new Float32Array(positions), indices: new Uint32Array(indices) },
    header,
    normals: new Float32Array(normals),
  };
}
