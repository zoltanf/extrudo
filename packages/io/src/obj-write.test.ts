/**
 * `writeObj` (P6-15, ADR-0101 §2): the OBJ and MTL texts Render Picture hands
 * to Blender, exact and deterministic.
 */
import { describe, expect, it } from 'vitest';
import type { MeshObject } from './mesh';
import { readObj, writeObj } from './obj';

/** A single triangle in the XY plane. */
const triangle = (name: string, color?: string, dz = 0): MeshObject => ({
  name,
  mesh: {
    positions: new Float64Array([0, 0, dz, 10, 0, dz, 0, 10, dz]),
    indices: new Uint32Array([0, 1, 2]),
  },
  ...(color ? { color } : {}),
});

/** A tetrahedron with its four triangles. */
const tetra = (name: string, color?: string): MeshObject => ({
  name,
  mesh: {
    positions: new Float64Array([0, 0, 0, 10, 0, 0, 0, 10, 0, 0, 0, 10]),
    indices: new Uint32Array([0, 2, 1, 0, 1, 3, 1, 2, 3, 0, 3, 2]),
  },
  ...(color ? { color } : {}),
});

describe('writeObj', () => {
  it('round-trips two coloured objects through readObj', () => {
    const { obj } = writeObj([tetra('Lid', '#ff0000'), triangle('Base', '#00ff00', 5)]);
    const back = readObj(obj);
    expect(back.map((o) => o.name)).toEqual(['Lid', 'Base']);
    expect(back.map((o) => o.mesh.indices.length / 3)).toEqual([4, 1]);
    // The second object's single triangle sits at z = 5.
    const base = back[1] as MeshObject;
    for (let t = 0; t < 3; t++) {
      const node = base.mesh.indices[t] as number;
      expect(base.mesh.positions[node * 3 + 2]).toBeCloseTo(5, 4);
    }
    // The first object's first corner is the origin.
    const lid = back[0] as MeshObject;
    const first = lid.mesh.indices[0] as number;
    expect(lid.mesh.positions[first * 3]).toBeCloseTo(0, 4);
    expect(lid.mesh.positions[first * 3 + 1]).toBeCloseTo(0, 4);
  });

  it('writes the exact text of a one-triangle object', () => {
    const { obj, mtl } = writeObj([triangle('Base', '#3b82f6')], {
      application: 'Extrudo 0.8.3',
      project: 'Bracket',
    });
    expect(obj).toBe(
      [
        '# Extrudo 0.8.3 — Bracket',
        'mtllib model.mtl',
        'o Base',
        'v 0 0 0',
        'v 10 0 0',
        'v 0 10 0',
        'usemtl m0',
        'f 1 2 3',
        '',
      ].join('\n'),
    );
    expect(mtl).toBe(
      ['# Extrudo 0.8.3 — Bracket', 'newmtl m0', 'Kd 0.2314 0.5098 0.9647', ''].join('\n'),
    );
  });

  it('offsets the second object’s face indices by the first’s node count', () => {
    const { obj } = writeObj([tetra('A'), triangle('B')], { mtlName: 'scene.mtl' });
    expect(obj).toContain('mtllib scene.mtl');
    expect(obj).toContain('usemtl m1\nf 5 6 7\n');
    expect(obj.startsWith('# OBJ\n')).toBe(true);
  });

  it('writes a grey material for no colour and a `d` line for alpha', () => {
    const { mtl } = writeObj([
      triangle('A'),
      triangle('B', '#ff000080'),
      triangle('C', '#ff0000ff'),
    ]);
    expect(mtl).toBe(
      [
        '# OBJ',
        'newmtl m0',
        'Kd 0.8 0.8 0.8',
        'newmtl m1',
        'Kd 1 0 0',
        'd 0.502',
        'newmtl m2',
        'Kd 1 0 0',
        '',
      ].join('\n'),
    );
  });

  it('keeps names and the header on one line, and names the unnamed', () => {
    const { obj, mtl } = writeObj([triangle(' Two\r\nlines '), triangle('')], {
      project: 'Evil\nmtllib /etc/passwd',
    });
    expect(obj).toContain('o Two lines\n');
    expect(obj).toContain('o Body2\n');
    expect(obj.startsWith('# Evil mtllib /etc/passwd\nmtllib model.mtl\n')).toBe(true);
    expect(mtl.startsWith('# Evil mtllib /etc/passwd\nnewmtl m0\n')).toBe(true);
  });

  it('is deterministic', () => {
    const objects = [tetra('Lid', '#ff0000'), triangle('Base', '#00ff0080', 5)];
    expect(writeObj(objects)).toEqual(writeObj(objects));
  });
});
