/**
 * The mesh kernel reader and the triangles' measures (P6-25 S12b, ADR-0144): the fixtures'
 * entries as FreeCAD wrote them, against FreeCAD's own numbers, and every way an entry can lie.
 */
import { describe, expect, it } from 'vitest';
import { MAX_MESH_FACETS, meshFacts, readMeshKernel } from './mesh-read';
import { structureEntry, structureObject } from './structure-parts';

/** A mesh kernel entry: `points` (x, y, z each) and `facets` (three indices each), neighbours open. */
export function bms(
  points: readonly number[],
  facets: readonly number[],
  counts?: { points?: number; facets?: number },
): Uint8Array {
  const p = points.length / 3;
  const f = facets.length / 3;
  const bytes = new Uint8Array(296 + 12 * p + 24 * f);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0xa0b0c0d0, true);
  view.setUint32(4, 0x00010000, true);
  view.setUint32(264, counts?.points ?? p, true);
  view.setUint32(268, counts?.facets ?? f, true);
  for (const [i, v] of points.entries()) view.setFloat32(272 + 4 * i, v, true);
  let at = 272 + 12 * p;
  for (let i = 0; i < f; i++, at += 24) {
    for (let k = 0; k < 3; k++) view.setUint32(at + 4 * k, facets[3 * i + k] as number, true);
    for (let k = 3; k < 6; k++) view.setUint32(at + 4 * k, 0xffffffff, true);
  }
  return bytes;
}

/** A closed unit tetrahedron, facing outwards. */
const TETRA_POINTS = [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1];
const TETRA_FACETS = [0, 2, 1, 0, 1, 3, 0, 3, 2, 1, 2, 3];

const read = (bytes: Uint8Array, max?: number) => readMeshKernel(bytes, max);
const mesh = (bytes: Uint8Array) => {
  const r = read(bytes);
  if (!('mesh' in r)) throw new Error(JSON.stringify(r));
  return r.mesh;
};

describe('the fixtures as FreeCAD wrote them', () => {
  it('reads the mesh box: 680 bytes, 8 points, 12 facets, the layout confirmed', () => {
    const bytes = structureEntry('meshes', 'Mesh', 'MeshKernel.bms');
    expect(bytes.length).toBe(680);
    const m = mesh(bytes);
    expect(m.points.length / 3).toBe(8);
    expect(m.facets.length / 3).toBe(12);
  });

  it('measures each mesh as FreeCAD does, placed by its own placement', () => {
    for (const [doc, object, file] of [
      ['meshes', 'Mesh', 'MeshKernel.bms'],
      ['meshes', 'Mesh001', 'MeshKernel1.bms'],
      ['meshes', 'Mesh002', 'MeshKernel2.bms'],
      ['mesh_in_part', 'Mesh', 'MeshKernel.bms'],
      ['mesh_odd', 'Mesh', 'MeshKernel.bms'],
      ['mesh_and_solid', 'Mesh', 'MeshKernel.bms'],
    ] as const) {
      const o = structureObject(doc, object);
      const truth = o.mesh as NonNullable<typeof o.mesh>;
      const placement = /<Property name="Placement"[\s\S]*?<PropertyPlacement ([^/]*)\/>/.exec(
        o.xml,
      );
      const a = Object.fromEntries(
        [...(placement?.[1] ?? '').matchAll(/(\w+)="([^"]*)"/g)].map((x) => [x[1], Number(x[2])]),
      );
      const facts = meshFacts(mesh(structureEntry(doc, object, file)), [
        {
          position: [a.Px ?? 0, a.Py ?? 0, a.Pz ?? 0],
          rotation: [a.Q0 ?? 0, a.Q1 ?? 0, a.Q2 ?? 0, a.Q3 ?? 1],
        },
      ]);
      expect(facts.openEdges, `${doc} ${object}`).toBe(0);
      expect(facts.pieces).toBe(truth.components);
      // FreeCAD measures in single precision before its placement, the import after it: 1e-4.
      expect(facts.volume / truth.volume).toBeCloseTo(1, 4);
      expect(facts.area / truth.area).toBeCloseTo(1, 4);
      // FreeCAD's box is in the object's parent's frame: its placement, no container.
      const box = [...facts.box.min, ...facts.box.max];
      for (const [i, v] of box.entries()) expect(v).toBeCloseTo(truth.box[i] as number, 4);
    }
  });

  it('finds what is wrong with the open box, the sheet and the empty mesh', () => {
    const open = meshFacts(mesh(structureEntry('mesh_odd', 'Mesh001', 'MeshKernel1.bms')), []);
    expect(open.openEdges).toBeGreaterThan(0);
    const sheet = meshFacts(mesh(structureEntry('mesh_odd', 'Mesh002', 'MeshKernel2.bms')), []);
    expect(sheet.openEdges).toBe(4);
    expect(read(structureEntry('mesh_odd', 'Mesh003', 'MeshKernel3.bms'))).toEqual({
      empty: true,
    });
  });

  it('a facet dropped from a closed mesh opens it', () => {
    const m = mesh(structureEntry('meshes', 'Mesh', 'MeshKernel.bms'));
    const facets = [...m.facets.slice(0, 33)];
    const facts = meshFacts(mesh(bms([...m.points], facets)), []);
    expect(facts.openEdges).toBe(3);
  });
});

describe('the triangles', () => {
  it('measure a tetrahedron, turned and moved', () => {
    const f = meshFacts(mesh(bms(TETRA_POINTS, TETRA_FACETS)), [
      { position: [10, 0, 0], rotation: [0, 0, Math.SQRT1_2, Math.SQRT1_2] },
    ]);
    expect(f.openEdges).toBe(0);
    expect(f.pieces).toBe(1);
    expect(f.volume).toBeCloseTo(1 / 6, 6);
    expect([...f.box.min]).toEqual([9, 0, 0]);
    expect([...f.box.max].map((v) => Math.round(v * 1e6) / 1e6)).toEqual([10, 1, 1]);
  });

  it('a surface turned inside out has a negative volume and is closed', () => {
    const flipped = TETRA_FACETS.map(
      (_, i, a) => a[i - (i % 3) + ([0, 2, 1][i % 3] as number)] as number,
    );
    const f = meshFacts(mesh(bms(TETRA_POINTS, flipped)), []);
    expect(f.openEdges).toBe(0);
    expect(f.volume).toBeCloseTo(-1 / 6, 6);
  });

  it('facets turned against each other are not closed', () => {
    const f = meshFacts(mesh(bms(TETRA_POINTS, [...TETRA_FACETS.slice(0, 9), 1, 3, 2])), []);
    expect(f.openEdges).toBeGreaterThan(0);
  });

  it('two points at one place are one: two copies of a point still close', () => {
    const points = [...TETRA_POINTS, 0, 0, 0];
    const facets = [4, 2, 1, 0, 1, 3, 0, 3, 2, 1, 2, 3];
    expect(meshFacts(mesh(bms(points, facets)), []).openEdges).toBe(0);
  });
});

describe('an entry that lies (hostile files)', () => {
  const good = () => bms(TETRA_POINTS, TETRA_FACETS);

  it('counts of 2³²−1 in a 300-byte entry: refused before anything is allocated', () => {
    const bytes = new Uint8Array(300);
    bytes.set(good().subarray(0, 264));
    const view = new DataView(bytes.buffer);
    view.setUint32(264, 0xffffffff, true);
    view.setUint32(268, 0xffffffff, true);
    expect(read(bytes)).toMatchObject({ refused: 'facets' });
    view.setUint32(268, 1, true);
    expect(read(bytes)).toMatchObject({ refused: 'length' });
  });

  it('truncated by one byte, or one byte too long', () => {
    const g = good();
    expect(read(g.subarray(0, g.length - 1))).toMatchObject({ refused: 'length' });
    const long = new Uint8Array(g.length + 1);
    long.set(g);
    expect(read(long)).toMatchObject({ refused: 'length' });
    expect(read(new Uint8Array(10))).toMatchObject({ refused: 'length' });
  });

  it('another magic, version or byte order', () => {
    const g = good();
    g[0] = 0xa0;
    expect(read(g)).toMatchObject({ refused: 'format' });
    const v = good();
    v[6] = 2;
    expect(read(v)).toMatchObject({ refused: 'format' });
  });

  it('an index past the points, a neighbour past the facets', () => {
    expect(read(bms(TETRA_POINTS, [...TETRA_FACETS.slice(0, 11), 4]))).toMatchObject({
      refused: 'index',
    });
    const g = good();
    new DataView(g.buffer).setUint32(296 + 12 * 4 - 24 + 12, 4, true);
    expect(read(g)).toMatchObject({ refused: 'index' });
  });

  it('NaN and infinite coordinates', () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const points = [...TETRA_POINTS];
      points[4] = bad;
      expect(read(bms(points, TETRA_FACETS))).toMatchObject({ refused: 'coordinate' });
    }
  });

  it('a facet naming one point three times, or twice', () => {
    expect(read(bms(TETRA_POINTS, [...TETRA_FACETS.slice(0, 9), 1, 1, 1]))).toMatchObject({
      refused: 'degenerate',
    });
    expect(read(bms(TETRA_POINTS, [...TETRA_FACETS.slice(0, 9), 1, 2, 1]))).toMatchObject({
      refused: 'degenerate',
    });
  });

  it('a million facets: refused by the cap from the header alone', () => {
    const bytes = new Uint8Array(296 + 24 * 1_000_000);
    bytes.set(good().subarray(0, 264));
    const view = new DataView(bytes.buffer);
    view.setUint32(264, 0, true);
    view.setUint32(268, 1_000_000, true);
    const start = performance.now();
    expect(read(bytes)).toMatchObject({ refused: 'facets' });
    const ms = performance.now() - start;
    if (process.env.BENCH)
      process.stderr.write(
        `S12BTIME a million facets, ${bytes.length} bytes, refused: ${ms.toFixed(2)} ms\n`,
      );
    expect(ms).toBeLessThan(50);
  });

  it(`a mesh at the cap (${MAX_MESH_FACETS} facets) reads and measures within seconds`, () => {
    // A strip of tetrahedra side by side: closed pieces, every facet used.
    const pieces = Math.floor(MAX_MESH_FACETS / 4);
    const points: number[] = [];
    const facets: number[] = [];
    for (let i = 0; i < pieces; i++) {
      for (let k = 0; k < 12; k += 3)
        points.push(
          (TETRA_POINTS[k] as number) + 2 * i,
          TETRA_POINTS[k + 1] as number,
          TETRA_POINTS[k + 2] as number,
        );
      for (const f of TETRA_FACETS) facets.push(f + 4 * i);
    }
    const bytes = bms(points, facets);
    const start = performance.now();
    const facts = meshFacts(mesh(bytes), []);
    const ms = performance.now() - start;
    if (process.env.BENCH)
      process.stderr.write(
        `S12BTIME ${pieces * 4} facets, ${bytes.length} bytes: ${ms.toFixed(0)} ms\n`,
      );
    expect(facts.pieces).toBe(pieces);
    expect(facts.openEdges).toBe(0);
    expect(ms).toBeLessThan(20_000);
  }, 60_000);
});
