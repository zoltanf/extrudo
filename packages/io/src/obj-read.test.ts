/**
 * The mesh readers of ADR-0066 §3: ASCII STL in `readStl` and the new
 * `readObj`. The fixtures are hand-written (`packages/io/src/fixtures/`), so
 * the tests read what a mesh tool would write rather than what our own
 * writers make.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { checkManifold } from './mesh';
import { readObj } from './obj';
import { readStl, writeStl } from './stl';

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url));

describe('readStl with an ASCII file', () => {
  const file = new Uint8Array(fixture('tetra-ascii.stl'));

  it("reads the solid's name, its normals and its four triangles", () => {
    const stl = readStl(file);
    expect(stl.header).toBe('tetra');
    expect(stl.normals.length).toBe(12);
    // The first facet is the bottom face, its normal -z.
    expect(stl.normals[0]).toBeCloseTo(0, 3);
    expect(stl.normals[1]).toBeCloseTo(0, 3);
    expect(stl.normals[2]).toBeCloseTo(-1, 3);
    expect(stl.mesh.indices.length).toBe(12);
  });

  it('welds the corners that are equal to the bit, so the tetrahedron is closed', () => {
    const stl = readStl(file);
    expect(stl.mesh.positions.length / 3).toBe(4);
    // The same four triangles our own writer makes of a mesh, so the report is
    // the one a slicer would take: closed, manifold, outward-facing.
    expect(checkManifold(stl.mesh)).toMatchObject({
      ok: true,
      nodes: 4,
      triangles: 4,
      boundaryEdges: 0,
      nonManifoldEdges: 0,
      misorientedEdges: 0,
    });
  });

  it('still reads a binary file that fits its size', () => {
    const tetrahedron = {
      positions: new Float32Array([0, 0, 0, 20, 0, 0, 0, 20, 0, 0, 0, 20]),
      indices: new Uint32Array([0, 2, 1, 0, 3, 2, 0, 1, 3, 1, 2, 3]),
    };
    const binary = readStl(writeStl(tetrahedron));
    expect(binary.header).toBe('Binary STL, units: mm');
    expect(binary.mesh.indices.length).toBe(12);
  });

  it('refuses a file that is neither', () => {
    expect(() => readStl(new Uint8Array(200))).toThrow(/binary STL/);
    expect(() => readStl(new Uint8Array([1, 2, 3]))).toThrow(/too short/);
  });
});

describe('readObj', () => {
  const objects = readObj(fixture('two-objects.obj').toString());

  it('reads one object per o/g line, named after it', () => {
    expect(objects.map((o) => o.name)).toEqual(['Base', 'Cover']);
  });

  it('fans a quad face into triangles and reads v/vt/vn corners', () => {
    const base = objects[0];
    expect(base).toBeDefined();
    // Six quads of the box: 12 triangles, plus the one triangle of the cover.
    expect(base?.mesh.indices.length).toBe(36);
    expect(objects[1]?.mesh.indices.length).toBe(3);
  });

  it('resolves negative indices against the vertices so far', () => {
    const base = objects[0];
    const first = base?.mesh.indices.slice(0, 3) as Uint32Array;
    // `-4/1/1 -3/1/1 -2/1/1` with eight vertices: nodes 4, 5, 6.
    expect(Array.from(first)).toEqual([4, 5, 6]);
  });

  it('shares one vertex list between the objects', () => {
    const cover = objects[1]?.mesh;
    // The cover's `v 9 10 11` are the file's 9th to 11th vertices.
    expect(Array.from((cover?.indices ?? []) as Uint32Array)).toEqual([8, 9, 10]);
    expect(cover?.positions.length).toBe(11 * 3);
  });

  it('drops an object with no faces and reads faces before any v as its error', () => {
    expect(readObj('o Empty\nv 0 0 0\n')).toEqual([]);
    expect(() => readObj('o A\nv 0 0 0\nf 1 2 3\n')).toThrow(/which it doesn't have/);
    expect(() => readObj('o A\nv 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 9\n')).toThrow(/doesn't have/);
    expect(() => readObj('o A\nv 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2\n')).toThrow(/not 3 or more/);
  });

  it('reads a face with no name as the first object', () => {
    const anonymous = readObj('v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n');
    expect(anonymous).toHaveLength(1);
    expect(anonymous[0]?.name).toBe('');
  });
});
