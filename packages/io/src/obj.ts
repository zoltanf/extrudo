/**
 * Wavefront OBJ (P4-06, ADR-0066 §3): a text format of vertices and faces,
 * which a mesh tool exports. Extrudo reads what a body is made of: `v`
 * vertices and `f` faces (triangles and polygons, indices as `v`, `v/vt`,
 * `v//vn`, `v/vt/vn`, positive or negative), with `o` and `g` starting a new
 * object (one body each, named after it). Everything else — `vt`, `vn`,
 * materials (`usemtl`, `mtllib`), `s`, comments, free-form elements — is
 * skipped, and so is a face that repeats a vertex (a degenerate polygon) or
 * names a vertex the file doesn't have.
 *
 * OBJ has no units (the numbers are unitless; by the same convention as STL
 * Extrudo reads them as millimetres unless the user says otherwise) and no
 * up axis, so an OBJ from a Y-up tool needs the import's `up` setting.
 */
import type { MeshObject } from './mesh';

/** What `readObj` could not read, worded for the user. */
export class ObjError extends Error {
  override name = 'ObjError';
}

/**
 * Reads the objects of an OBJ file, in the order they appear (an object with
 * no faces is left out: it has no geometry to show).
 */
export function readObj(text: string): MeshObject[] {
  const positions: number[] = [];
  const objects: { name: string; indices: number[] }[] = [];
  let current: { name: string; indices: number[] } | undefined;
  const begin = (name: string) => {
    // A `g` inside the same `o` is a group of it, not a body of its own.
    if (current && current.name === name) return current;
    current = { name, indices: [] };
    objects.push(current);
    return current;
  };
  for (const raw of text.split('\n')) {
    const line = raw.replace(/(#.*)?$/, '').trim();
    if (!line) continue;
    const space = line.indexOf(' ');
    const key = space < 0 ? line : line.slice(0, space);
    const rest = space < 0 ? '' : line.slice(space + 1).trim();
    switch (key) {
      case 'v': {
        const xyz = numbers(rest, 3, 'v');
        positions.push(xyz[0] as number, xyz[1] as number, xyz[2] as number);
        break;
      }
      case 'f':
        current ??= begin('');
        current.indices.push(...face(rest, positions.length / 3));
        break;
      case 'o':
        begin(rest);
        break;
      case 'g':
        if (rest) begin(rest);
        break;
    }
  }
  return objects
    .filter((object) => object.indices.length >= 3)
    .map((object) => ({
      name: object.name,
      mesh: {
        positions: new Float64Array(positions),
        indices: new Uint32Array(object.indices),
      },
    }));
}

/**
 * One face's node indices, fanned into triangles: a quadrilateral `a b c d`
 * becomes `a b c` and `a c d`. A triangle whose corners repeat a vertex (a
 * face that names one twice, which some exporters write) is left out rather
 * than imported as a degenerate face.
 */
function face(rest: string, nodes: number): number[] {
  const corners = rest.split(/\s+/).map((corner) => {
    const first = corner.split('/')[0] as string;
    const at = Number(first);
    if (!Number.isFinite(at) || !Number.isInteger(at) || at === 0) {
      throw new ObjError(`This OBJ file has a face that isn't a vertex index: "${corner}".`);
    }
    // Negative indices count back from the vertices so far (-1 is the last).
    const node = at < 0 ? nodes + at : at - 1;
    if (node < 0 || node >= nodes) {
      throw new ObjError(
        `This OBJ file has a face that names vertex ${at}, which it doesn't have.`,
      );
    }
    return node;
  });
  if (corners.length < 3) {
    throw new ObjError(`This OBJ file has a face with ${corners.length} vertices, not 3 or more.`);
  }
  const out: number[] = [];
  for (let i = 1; i + 1 < corners.length; i++) {
    const a = corners[0] as number;
    const b = corners[i] as number;
    const c = corners[i + 1] as number;
    if (a === b || b === c || a === c) continue;
    out.push(a, b, c);
  }
  return out;
}

/** `count` numbers from a line, or the file's error. */
function numbers(rest: string, count: number, key: string): number[] {
  const parts = rest.split(/\s+/).filter(Boolean);
  if (parts.length < count) {
    throw new ObjError(
      `This OBJ file has a "${key}" line with ${parts.length} numbers, not ${count}.`,
    );
  }
  const values = parts.slice(0, count).map(Number);
  if (values.some((v) => !Number.isFinite(v))) {
    throw new ObjError(`This OBJ file has a "${key}" line that isn't numbers: "${rest}".`);
  }
  return values;
}
