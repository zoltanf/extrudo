import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { checkManifold, mergeMeshes, splitNonManifoldEdges, type TriangleMesh } from './mesh';
import { readStl, writeStl } from './stl';
import { MODEL_PATH, read3mf, write3mf } from './threemf';

/** A w × d × h box at `at`, triangles counter-clockwise from outside. */
function box(w: number, d: number, h: number, at: [number, number, number] = [0, 0, 0]) {
  const [x, y, z] = at;
  const positions = new Float64Array([
    ...[x, y, z],
    ...[x + w, y, z],
    ...[x + w, y + d, z],
    ...[x, y + d, z],
    ...[x, y, z + h],
    ...[x + w, y, z + h],
    ...[x + w, y + d, z + h],
    ...[x, y + d, z + h],
  ]);
  // biome-ignore format: two triangles per side
  const indices = new Uint32Array([
    0, 2, 1, 0, 3, 2, // bottom (-z)
    4, 5, 6, 4, 6, 7, // top (+z)
    0, 1, 5, 0, 5, 4, // front (-y)
    2, 3, 7, 2, 7, 6, // back (+y)
    1, 2, 6, 1, 6, 5, // right (+x)
    3, 0, 4, 3, 4, 7, // left (-x)
  ]);
  return { positions, indices } satisfies TriangleMesh;
}

function withIndices(mesh: TriangleMesh, indices: number[]): TriangleMesh {
  return { positions: mesh.positions, indices: new Uint32Array(indices) };
}

describe('checkManifold', () => {
  it('accepts a closed, outward-facing box and measures its volume', () => {
    const report = checkManifold(box(10, 20, 30));
    expect(report).toMatchObject({
      ok: true,
      triangles: 12,
      nodes: 8,
      edges: 18,
      boundaryEdges: 0,
      nonManifoldEdges: 0,
      misorientedEdges: 0,
    });
    expect(report.volume).toBeCloseTo(6000, 9);
  });

  it('finds a hole (a missing triangle)', () => {
    const mesh = box(1, 1, 1);
    const report = checkManifold(withIndices(mesh, [...mesh.indices].slice(3)));
    expect(report.ok).toBe(false);
    expect(report.boundaryEdges).toBe(3);
  });

  it('finds a flipped triangle', () => {
    const t = [...box(1, 1, 1).indices];
    [t[1], t[2]] = [t[2] as number, t[1] as number];
    const report = checkManifold(withIndices(box(1, 1, 1), t));
    expect(report.ok).toBe(false);
    expect(report.misorientedEdges).toBe(3);
  });

  it('finds an edge shared by more than two triangles', () => {
    const t = [...box(1, 1, 1).indices];
    const report = checkManifold(withIndices(box(1, 1, 1), [...t, 0, 1, 5]));
    expect(report.ok).toBe(false);
    expect(report.nonManifoldEdges).toBeGreaterThan(0);
  });

  it('finds triangles facing inwards (negative volume)', () => {
    const t = [...box(2, 2, 2).indices];
    for (let i = 0; i < t.length; i += 3)
      [t[i + 1], t[i + 2]] = [t[i + 2], t[i + 1]] as [number, number];
    const report = checkManifold(withIndices(box(2, 2, 2), t));
    expect(report.misorientedEdges).toBe(0);
    expect(report.volume).toBeCloseTo(-8, 9);
    expect(report.ok).toBe(false);
  });

  it('finds unwelded corners (a triangle soup is all boundary)', () => {
    const { positions, indices } = box(1, 1, 1);
    const soup = new Float64Array(indices.length * 3);
    for (const [i, node] of indices.entries()) {
      soup.set(positions.subarray(3 * node, 3 * node + 3), 3 * i);
    }
    const report = checkManifold({
      positions: soup,
      indices: Uint32Array.from(soup.subarray(0, indices.length), (_, i) => i),
    });
    expect(report.ok).toBe(false);
    expect(report.boundaryEdges).toBe(36);
  });

  it('finds degenerate triangles and bad coordinates', () => {
    const mesh = box(1, 1, 1);
    expect(checkManifold(withIndices(mesh, [...mesh.indices, 1, 1, 2])).badTriangles).toBe(1);
    expect(checkManifold(withIndices(mesh, [...mesh.indices, 1, 2, 99])).badTriangles).toBe(1);
    const positions = Float64Array.from(mesh.positions);
    positions[4] = Number.NaN;
    expect(checkManifold({ positions, indices: mesh.indices })).toMatchObject({
      ok: false,
      badNodes: 1,
    });
  });
});

describe('splitNonManifoldEdges', () => {
  it('leaves a manifold mesh alone, as the same object', () => {
    const mesh = box(10, 20, 30);
    const result = splitNonManifoldEdges(mesh);
    expect(result.split).toBe(0);
    expect(result.mesh).toBe(mesh);
  });

  it('separates two cubes that share one edge: 4 uses become 2 + 2', () => {
    // Through an STL: `readStl` welds the shared edge's corners, as importing does.
    const shared = readStl(writeStl([box(10, 10, 10), box(10, 10, 10, [10, 10, 0])])).mesh;
    expect(checkManifold(shared).nonManifoldEdges).toBe(1);
    const { mesh, split } = splitNonManifoldEdges(shared);
    expect(split).toBe(1);
    expect(mesh).not.toBe(shared);
    const report = checkManifold(mesh);
    expect(report).toMatchObject({
      ok: true,
      triangles: 24,
      nonManifoldEdges: 0,
      boundaryEdges: 0,
    });
    expect(report.volume).toBeCloseTo(2000, 3);
    // The shared edge's two end nodes became four.
    expect(report.nodes).toBe(16);
  });

  it('separates two cubes that touch at one corner (a non-manifold vertex)', () => {
    const touching = readStl(writeStl([box(10, 10, 10), box(10, 10, 10, [10, 10, 10])])).mesh;
    expect(checkManifold(touching).nonManifoldEdges).toBe(0);
    const { mesh, split } = splitNonManifoldEdges(touching);
    expect(mesh).not.toBe(touching);
    expect(split).toBe(0);
    const report = checkManifold(mesh);
    expect(report).toMatchObject({ ok: true, triangles: 24, boundaryEdges: 0 });
    // Only the shared corner split: each cube keeps its own 18 edges.
    expect(report.edges).toBe(36);
  });

  it('leaves an edge whose uses do not balance for checkManifold', () => {
    const cube = box(1, 1, 1);
    // Edge 0–1 already has one use each way; two more forward uses unbalance it.
    const unequal = withIndices(cube, [...cube.indices, 0, 1, 4, 0, 1, 7]);
    expect(checkManifold(unequal).nonManifoldEdges).toBeGreaterThan(0);
    expect(checkManifold(splitNonManifoldEdges(unequal).mesh).ok).toBe(false);
  });
});

describe('writeStl', () => {
  it('writes the binary layout: header, count, normal, corners, attribute', () => {
    const bytes = writeStl(box(10, 20, 30), { header: 'Extrudo test' });
    expect(bytes.length).toBe(80 + 4 + 12 * 50);
    const view = new DataView(bytes.buffer);
    expect(strFromU8(bytes.subarray(0, 12))).toBe('Extrudo test');
    expect(bytes[12]).toBe(0);
    expect(view.getUint32(80, true)).toBe(12);
    // Triangle 0 is the bottom (0, 2, 1): normal -z, corners as given.
    const f = (offset: number) => view.getFloat32(84 + offset, true);
    expect([f(0), f(4), f(8)]).toEqual([0, 0, -1]);
    expect([f(12), f(16), f(20)]).toEqual([0, 0, 0]);
    expect([f(24), f(28), f(32)]).toEqual([10, 20, 0]);
    expect([f(36), f(40), f(44)]).toEqual([10, 0, 0]);
    expect(view.getUint16(84 + 48, true)).toBe(0);
  });

  it('gives every triangle its outward unit normal', () => {
    const { normals, mesh } = readStl(writeStl(box(3, 4, 5, [1, 2, 3])));
    const center = [2.5, 4, 5.5] as const;
    for (let t = 0; t < 12; t++) {
      const n = [normals[3 * t], normals[3 * t + 1], normals[3 * t + 2]] as number[];
      expect(Math.hypot(...n)).toBeCloseTo(1, 6);
      const corner = mesh.indices[3 * t] as number;
      const out = [0, 1, 2].map(
        (k) => (mesh.positions[3 * corner + k] as number) - (center[k] as number),
      );
      expect(n.reduce((s, v, k) => s + v * (out[k] as number), 0)).toBeGreaterThan(0);
    }
  });

  it('never starts the header with "solid" (ASCII STL readers would take it)', () => {
    const bytes = writeStl(box(1, 1, 1), { header: 'solid part' });
    expect(strFromU8(bytes.subarray(0, 5))).not.toBe('solid');
  });

  it('puts several bodies into one file, and reads back to the same closed meshes', () => {
    const a = box(10, 10, 10);
    const b = box(5, 5, 5, [20, 0, 0]);
    const { mesh } = readStl(writeStl([a, b]));
    const report = checkManifold(mesh);
    expect(report).toMatchObject({ ok: true, triangles: 24, nodes: 16 });
    expect(report.volume).toBeCloseTo(1125, 3);
    expect(checkManifold(mergeMeshes([a, b])).volume).toBeCloseTo(1125, 9);
  });

  it('refuses files that are not binary STL', () => {
    expect(() => readStl(new Uint8Array(10))).toThrow(/too short/);
    const bytes = writeStl(box(1, 1, 1));
    expect(() => readStl(bytes.subarray(0, bytes.length - 1))).toThrow(/file size/);
  });
});

describe('write3mf', () => {
  const objects = [
    { name: 'Bracket', mesh: box(40, 80, 60), color: '#ff8800' },
    { name: 'Lid & <cap> "2"', mesh: box(10, 10, 2, [50, 0, 0]) },
    { name: 'Pin', mesh: box(2, 2, 20, [70, 0, 0]), color: '#11223380' },
  ];

  it('is an OPC package with content types, the root relationship and the model', () => {
    const entries = unzipSync(write3mf(objects));
    expect(Object.keys(entries).sort()).toEqual([
      '3D/3dmodel.model',
      '[Content_Types].xml',
      '_rels/.rels',
    ]);
    const types = strFromU8(entries['[Content_Types].xml'] as Uint8Array);
    expect(types).toContain('xmlns="http://schemas.openxmlformats.org/package/2006/content-types"');
    expect(types).toContain(
      '<Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>',
    );
    expect(types).toContain(
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
    );
    const rels = strFromU8(entries['_rels/.rels'] as Uint8Array);
    expect(rels).toContain(
      '<Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>',
    );
    const model = strFromU8(entries[MODEL_PATH] as Uint8Array);
    expect(
      model.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<model unit="millimeter"'),
    ).toBe(true);
    expect(model).toContain('xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"');
  });

  it('writes objects with names, units, colours and one build item each', () => {
    const model = read3mf(
      write3mf(objects, { title: 'Wall bracket', application: 'Extrudo 0.2.0' }),
    );
    expect(model.unit).toBe('millimeter');
    expect(model.metadata).toEqual({ Title: 'Wall bracket', Application: 'Extrudo 0.2.0' });
    expect(model.objects.map((o) => [o.name, o.type, o.color])).toEqual([
      ['Bracket', 'model', '#FF8800FF'],
      ['Lid & <cap> "2"', 'model', undefined],
      ['Pin', 'model', '#11223380'],
    ]);
    expect(model.build).toEqual(model.objects.map((o) => o.id));
    // Resource IDs are unique, and the materials come before their objects.
    const xml = strFromU8(unzipSync(write3mf(objects))[MODEL_PATH] as Uint8Array);
    expect(xml.indexOf('<m:colorgroup id="1">')).toBeLessThan(xml.indexOf('<object'));
    expect(xml).toContain(
      'xmlns:m="http://schemas.microsoft.com/3dmanufacturing/material/2015/02"',
    );
    expect(xml).not.toContain('requiredextensions');
    // The object's default colour, and each triangle's (Bambu Studio and OrcaSlicer read those).
    expect(xml).toContain('<object id="4" type="model" name="Pin" pid="1" pindex="1">');
    expect(xml).toContain('<triangle v1="0" v2="2" v3="1" pid="1" p1="1"/>');
    expect(xml).toContain(
      '<object id="3" type="model" name="Lid &amp; &lt;cap&gt; &quot;2&quot;">',
    );
    expect(xml).toContain('<m:color color="#11223380"/>');
    expect(new Set(model.objects.map((o) => o.id)).size).toBe(3);
    expect(model.objects.map((o) => o.id)).not.toContain(1);
  });

  it('keeps the meshes: the same nodes and triangles, closed', () => {
    const model = read3mf(write3mf(objects));
    model.objects.forEach((object, i) => {
      const source = (objects[i] as (typeof objects)[number]).mesh;
      expect([...object.mesh.indices]).toEqual([...source.indices]);
      expect([...object.mesh.positions]).toEqual([...source.positions]);
      expect(checkManifold(object.mesh).ok).toBe(true);
    });
  });

  it('writes coordinates to 10 nm, without exponents', () => {
    const tiny = { name: 'T', mesh: box(1e-7, 1 / 3, 123456.789) };
    const xml = strFromU8(unzipSync(write3mf([tiny]))[MODEL_PATH] as Uint8Array);
    expect(xml).toContain('<vertex x="0" y="0.33333" z="123456.789"/>');
    expect(xml).not.toMatch(/e[+-]?\d/);
  });

  it('writes no materials when no body has a colour, and drops control characters from names', () => {
    const xml = strFromU8(
      unzipSync(write3mf([{ name: 'A\u0001B', mesh: box(1, 1, 1) }]))[MODEL_PATH] as Uint8Array,
    );
    expect(xml).not.toContain('colorgroup');
    expect(xml).not.toContain('pid=');
    expect(xml).toContain('<object id="1" type="model" name="AB">');
    expect(xml).toContain('<item objectid="1"/>');
  });

  it('refuses a colour that is not hex', () => {
    expect(() => write3mf([{ name: 'A', mesh: box(1, 1, 1), color: 'red' }])).toThrow(/colour/);
  });
});
