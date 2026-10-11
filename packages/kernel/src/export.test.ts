// Export (P2-12, ADR-0034): welded meshes for STL and 3MF that close up for
// every kind of face the modelling features make, and STEP AP242 that reads
// back to the same solids.
import { type BodyId, type Feature, primitiveInputs } from '@extrudo/core';
import { checkManifold, readStl, writeStl } from '@extrudo/io';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Kernel, KernelError, type ShapeHandle, stepString, type Vec3 } from './kernel';
import type { MeshOptions } from './mesh';
import { stepGroups } from './model-export';
import { loadOcct } from './occt/load';
import type { PlanarCurve, PlanarFrame } from './planar';
import { testDocument, testFeature } from './recompute/testing';
import { isExportCancelled, KernelService } from './service';

let kernel: Kernel;

beforeAll(async () => {
  kernel = new Kernel(await loadOcct());
});

const MEDIUM: MeshOptions = { linearDeflection: 0.05, angularDeflection: 0.3 };
const PI = Math.PI;
/** The XZ plane, its y along world Z: a revolve profile about the Z axis. */
const XZ: PlanarFrame = { origin: [0, 0, 0], x: [1, 0, 0], normal: [0, -1, 0] };
const Z_AXIS = { origin: [0, 0, 0] as Vec3, direction: [0, 0, 1] as Vec3 };

/** The largest face between `curves` in `frame` (the caller releases it). */
function face(curves: PlanarCurve[], frame: PlanarFrame = XZ): ShapeHandle {
  const { faces } = kernel.planarFaces(curves, frame, 1e-4);
  const [largest, ...rest] = [...faces].sort((a, b) => b.area - a.area);
  if (!largest) throw new Error('no face');
  // A hole's disc is a face too: not wanted here.
  kernel.release(...rest.map((f) => f.shape));
  return largest.shape;
}

function rectangle(x0: number, y0: number, x1: number, y1: number): PlanarCurve[] {
  return [
    { kind: 'line', a: [x0, y0], b: [x1, y0] },
    { kind: 'line', a: [x1, y0], b: [x1, y1] },
    { kind: 'line', a: [x1, y1], b: [x0, y1] },
    { kind: 'line', a: [x0, y1], b: [x0, y0] },
  ];
}

/** Every modelling shape the tests export, made fresh (the caller releases them). */
const SHAPES = {
  box: () => [kernel.box([40, 80, 60])],
  cylinder: () => [kernel.cylinder(7.5, 20)],
  'box with a through hole': () => {
    const block = kernel.box([40, 30, 10]);
    const hole = kernel.cylinder(5, 30, [20, 15, -10]);
    const cut = kernel.cut(block, hole).shape;
    return [block, hole, cut];
  },
  'filleted box with a hole': () => {
    const block = kernel.box([40, 30, 20]);
    const rounded = kernel.fillet(block, [0, 1, 2, 3], 3).shape;
    const hole = kernel.cylinder(4, 40, [20, 15, -10]);
    return [block, rounded, hole, kernel.cut(rounded, hole).shape];
  },
  'sphere (revolved half disc: poles)': () => {
    const profile = face([
      { kind: 'arc', center: [0, 0], radius: 10, from: -PI / 2, sweep: PI },
      { kind: 'line', a: [0, 10], b: [0, -10] },
    ]);
    return [profile, kernel.revolve(profile, Z_AXIS, 2 * PI).shape];
  },
  'cone (revolved triangle: an apex)': () => {
    const profile = face([
      { kind: 'line', a: [0, 0], b: [8, 0] },
      { kind: 'line', a: [8, 0], b: [0, 12] },
      { kind: 'line', a: [0, 12], b: [0, 0] },
    ]);
    return [profile, kernel.revolve(profile, Z_AXIS, 2 * PI).shape];
  },
  'torus (revolved circle: seams both ways)': () => {
    const profile = face([{ kind: 'arc', center: [20, 0], radius: 4, from: 0, sweep: 2 * PI }]);
    return [profile, kernel.revolve(profile, Z_AXIS, 2 * PI).shape];
  },
  'ring segment (partial revolve of a holed profile)': () => {
    const profile = face([
      ...rectangle(10, 0, 20, 10),
      { kind: 'arc', center: [15, 5], radius: 2, from: 0, sweep: 2 * PI },
    ]);
    return [profile, kernel.revolve(profile, Z_AXIS, (3 * PI) / 4).shape];
  },
  'tapered extrude with a hole': () => {
    const profile = face(
      [
        ...rectangle(0, 0, 30, 20),
        { kind: 'arc', center: [15, 10], radius: 5, from: 0, sweep: 2 * PI },
      ],
      { origin: [0, 0, 0], x: [1, 0, 0], normal: [0, 0, 1] },
    );
    return [profile, kernel.prism(profile, [0, 0, 15], [0, 0, 0], 0.1).shape];
  },
  'fused box and cylinder': () => {
    const block = kernel.box([20, 20, 10]);
    const post = kernel.cylinder(4, 25, [10, 10, 5]);
    return [block, post, kernel.fuse(block, post, { simplify: true }).shape];
  },
} satisfies Record<string, () => ShapeHandle[]>;

describe('exportMesh', () => {
  for (const [label, make] of Object.entries(SHAPES)) {
    it(`gives a closed, manifold, outward mesh: ${label}`, () => {
      const shapes = make();
      try {
        const body = shapes[shapes.length - 1] as ShapeHandle;
        const mesh = kernel.exportMesh(body, MEDIUM);
        const report = checkManifold(mesh);
        expect(report).toMatchObject({
          ok: true,
          boundaryEdges: 0,
          nonManifoldEdges: 0,
          misorientedEdges: 0,
          badTriangles: 0,
        });
        // Euler characteristic V − E + F = 2 − 2 × genus of the solid.
        const genus = /hole|torus|ring/.test(label) ? 1 : 0;
        expect(report.nodes - report.edges + report.triangles).toBe(2 - 2 * genus);
        // The mesh encloses the solid's volume, within the deflection.
        const { volume, area } = kernel.measure(body);
        expect(Math.abs(report.volume - volume)).toBeLessThan(area * MEDIUM.linearDeflection);
        // It survives STL's float32 corners: welded again by position, still closed.
        expect(checkManifold(readStl(writeStl(mesh)).mesh)).toMatchObject({
          ok: true,
          nodes: report.nodes,
          triangles: report.triangles,
        });
      } finally {
        kernel.release(...shapes);
      }
    });
  }

  it('follows the deflection: finer presets give more triangles and a truer volume', () => {
    const [block, hole, body] = SHAPES['box with a through hole']() as ShapeHandle[];
    try {
      const exact = kernel.measure(body as ShapeHandle).volume;
      const coarse = checkManifold(
        kernel.exportMesh(body as ShapeHandle, { linearDeflection: 0.1, angularDeflection: 0.35 }),
      );
      const fine = checkManifold(
        kernel.exportMesh(body as ShapeHandle, { linearDeflection: 0.01, angularDeflection: 0.09 }),
      );
      expect(fine.triangles).toBeGreaterThan(2 * coarse.triangles);
      expect(Math.abs(fine.volume - exact)).toBeLessThan(Math.abs(coarse.volume - exact));
    } finally {
      kernel.release(body as ShapeHandle, hole as ShapeHandle, block as ShapeHandle);
    }
  });

  it("leaves the display mesh alone: a fine export doesn't refine the next display mesh", () => {
    const [block, hole, body] = SHAPES['box with a through hole']() as ShapeHandle[];
    try {
      const coarse = { linearDeflection: 0.5, angularDeflection: 0.8 };
      const before = kernel.mesh(body as ShapeHandle, coarse).indices.length;
      kernel.exportMesh(body as ShapeHandle, { linearDeflection: 0.005, angularDeflection: 0.05 });
      expect(kernel.mesh(body as ShapeHandle, coarse).indices.length).toBe(before);
    } finally {
      kernel.release(body as ShapeHandle, hole as ShapeHandle, block as ShapeHandle);
    }
  });

  it('refuses unknown shapes', () => {
    expect(() => kernel.exportMesh(999_999 as ShapeHandle, MEDIUM)).toThrow(KernelError);
  });
});

describe('writeStep', () => {
  it('writes AP242 in millimetres with one named product per body, and reads back', () => {
    const part = SHAPES['filleted box with a hole']();
    const ball = SHAPES['sphere (revolved half disc: poles)']();
    const bracket = part[part.length - 1] as ShapeHandle;
    const sphere = ball[ball.length - 1] as ShapeHandle;
    try {
      const text = kernel.writeStep([
        { shape: bracket, name: 'Bracket' },
        { shape: sphere, name: "Ball 'Nº 2' \\ ok" },
      ]);
      expect(text.startsWith('ISO-10303-21;')).toBe(true);
      expect(text.trimEnd().endsWith('END-ISO-10303-21;')).toBe(true);
      expect(text).toMatch(
        /FILE_SCHEMA\s*\(\s*\(\s*'AP242_MANAGED_MODEL_BASED_3D_ENGINEERING_MIM_LF/,
      );
      expect(text).toContain('SI_UNIT(.MILLI.,.METRE.)');
      expect(text).toContain("PRODUCT('Bracket','Bracket'");
      // Apostrophes doubled, non-ASCII and the backslash as \X2\ (ISO 10303-21).
      expect(text).toContain("PRODUCT('Ball ''N\\X2\\00BA\\X0\\ 2'' \\X2\\005C\\X0\\ ok'");
      expect(text.match(/MANIFOLD_SOLID_BREP/g)).toHaveLength(2);
      expect(/[^\t\n\r\x20-\x7e]/.test(text)).toBe(false);

      const back = kernel.readStep(text);
      try {
        const expected = kernel.measure(bracket).volume + kernel.measure(sphere).volume;
        expect(kernel.measure(back).volume).toBeCloseTo(expected, 3);
        expect(kernel.count(back, 'face')).toBe(
          kernel.count(bracket, 'face') + kernel.count(sphere, 'face'),
        );
        expect(kernel.isValid(back)).toBe(true);
      } finally {
        kernel.release(back);
      }
    } finally {
      kernel.release(...part, ...ball);
    }
  });

  it('groups parts into one assembly product per component (P6-05, ADR-0081 §7)', () => {
    const boxes = [
      kernel.box([10, 10, 10], [0, 0, 0]),
      kernel.box([20, 10, 10], [30, 0, 0]),
      kernel.box([10, 10, 30], [60, 0, 0]),
    ];
    const [lid, seal, base] = boxes as [ShapeHandle, ShapeHandle, ShapeHandle];
    try {
      const parts = [
        { shape: lid, name: 'Lid top', color: '#c81e28', group: 0 },
        { shape: seal, name: 'Seal', group: 0 },
        { shape: base, name: 'Base', color: '#1080ff' },
      ];
      const text = kernel.writeStep(parts, ['Lid']);
      expect(text).toContain("PRODUCT('Lid'");
      for (const name of ['Lid top', 'Seal', 'Base']) expect(text).toContain(`PRODUCT('${name}'`);
      // Lid's two parts are its components; the loose Base is a top-level
      // product, no component of anything.
      expect(text.match(/NEXT_ASSEMBLY_USAGE_OCCURRENCE/g)).toHaveLength(2);
      expect(text.match(/PRODUCT\(/g)).toHaveLength(4);
      expect(text).not.toMatch(/PRODUCT\('Product/);
      expect(text).toContain('SI_UNIT(.MILLI.,.METRE.)');
      expect(/[^\t\n\r\x20-\x7e]/.test(text)).toBe(false);
      expect(kernel.readStepColors(text)).toEqual({
        solids: ['#c81e28', undefined, '#1080ff'],
        coloredFaces: 0,
      });
      const back = kernel.readStep(text);
      const solids = kernel.solids(back);
      try {
        expect(solids.map((s) => Math.round(kernel.measure(s).volume))).toEqual([1000, 2000, 3000]);
      } finally {
        kernel.release(...solids, back);
      }

      // A component's name is a STEP string like a body's.
      const german = kernel.writeStep(parts, ['Deckel ö']);
      expect(german).toContain("PRODUCT('Deckel \\X2\\00F6\\X0\\'");

      // No part in a group: the file is the one written without groups.
      const data = (t: string) => t.slice(t.indexOf('DATA;'));
      const plain = kernel.writeStep(parts.map(({ group: _, ...part }) => part));
      expect(plain).not.toContain('NEXT_ASSEMBLY_USAGE_OCCURRENCE');
      expect(data(kernel.writeStep(parts))).toBe(data(plain));
      expect(data(kernel.writeStep(parts, []))).toBe(data(plain));
      const unnamed = parts.map((part) => ({ ...part, group: -1 }));
      expect(data(kernel.writeStep(unnamed, ['Lid']))).toBe(data(plain));
    } finally {
      kernel.release(...boxes);
    }
  });

  it('refuses unknown shapes and unreadable text', () => {
    expect(() => kernel.writeStep([{ shape: 999_999 as ShapeHandle, name: 'X' }])).toThrow(
      KernelError,
    );
    expect(() => kernel.readStep('not a step file')).toThrow(KernelError);
  });
});

describe('stepString', () => {
  it('keeps printable ASCII and encodes the rest as \\X2\\ or \\X4\\', () => {
    expect(stepString('Body1 (v2)')).toBe('Body1 (v2)');
    expect(stepString('Größe')).toBe('Gr\\X2\\00F600DF\\X0\\e');
    expect(stepString('a\\b')).toBe('a\\X2\\005C\\X0\\b');
    expect(stepString('Rocket 🚀!')).toBe('Rocket \\X4\\0001F680\\X0\\!');
    expect(stepString('tab\there\nnew')).toBe('tabherenew');
    expect(stepString('é🚀é')).toBe('\\X2\\00E9\\X0\\\\X4\\0001F680\\X0\\\\X2\\00E9\\X0\\');
  });
});

describe('stepGroups (P6-05, ADR-0081 §7)', () => {
  it('numbers components in first-seen order and leaves loose bodies out', () => {
    const body = (id: string, component?: string) => ({
      id: id as BodyId,
      name: id,
      ...(component !== undefined && { component }),
    });
    expect(stepGroups([body('a', 'Lid'), body('b'), body('c', 'Box'), body('d', 'Lid')])).toEqual({
      groups: ['Lid', 'Box'],
      of: [0, undefined, 1, 0],
    });
    expect(stepGroups([body('a'), body('b')])).toEqual({ groups: [], of: [undefined, undefined] });
  });
});

describe('KernelService export (the primitives of P2-10)', () => {
  const service = new KernelService(() => loadOcct());
  afterAll(() => service.dispose());
  const primitive = (id: string, type: 'sphere' | 'torus' | 'box', x: string): Feature => ({
    ...testFeature(id, type),
    inputs: primitiveInputs(type, { numbers: { x } }),
  });

  it('exports the bodies of the last recompute: welded meshes and named STEP', async () => {
    const doc = testDocument([
      primitive('S', 'sphere', '0 mm'),
      primitive('T', 'torus', '60 mm'),
      primitive('B', 'box', '-60 mm'),
    ]);
    const result = await service.recompute({ doc });
    if (result.status !== 'done') throw new Error('not done');
    const ids = result.bodies.map((b) => b.id).sort();
    expect(ids.map((id) => id.split(':')[0])).toEqual(['B', 'S', 'T']);

    const meshes = await service.exportMeshes(ids, MEDIUM);
    expect(meshes.map((m) => m.id)).toEqual(ids);
    for (const { mesh } of meshes) expect(checkManifold(mesh).ok).toBe(true);
    const [, sphere, torus] = meshes.map(({ mesh }) => checkManifold(mesh));
    // Within area × deviation of the exact sphere (radius 10).
    const exact = (4 / 3) * Math.PI * 10 ** 3;
    expect(Math.abs((sphere?.volume ?? 0) - exact)).toBeLessThan(4 * Math.PI * 100 * 0.05);
    // Torus: V − E + F = 0.
    expect((torus?.nodes ?? 0) - (torus?.edges ?? 0) + (torus?.triangles ?? 0)).toBe(0);

    const text = await service.exportStep(
      ids.map((id, i) => ({ id, name: ['Block', 'Ball', 'Ring'][i] as string })),
    );
    for (const name of ['Ball', 'Ring', 'Block']) expect(text).toContain(`PRODUCT('${name}'`);
    expect(text).not.toContain('COLOUR_RGB');

    // A body's colour becomes its solid's styled item (P4-12, ADR-0034's
    // amendment), and reads back as the same `#rrggbb`.
    const coloured = await service.exportStep(
      ids.map((id, i) => ({
        id,
        name: ['Block', 'Ball', 'Ring'][i] as string,
        ...(i === 1 && { color: '#2fbf8f' }),
      })),
    );
    expect(coloured.match(/COLOUR_RGB/g)).toHaveLength(1);
    for (const name of ['Ball', 'Ring', 'Block']) expect(coloured).toContain(`PRODUCT('${name}'`);

    // A body's component makes it a part of an assembly product named after
    // the component, components in first-seen order (P6-05, ADR-0081 §7).
    const grouped = await service.exportStep(
      ids.map((id, i) => ({
        id,
        name: ['Block', 'Ball', 'Ring'][i] as string,
        ...(i !== 1 && { component: 'Toys' }),
      })),
    );
    expect(grouped).toContain("PRODUCT('Toys'");
    expect(grouped.match(/NEXT_ASSEMBLY_USAGE_OCCURRENCE/g)).toHaveLength(2);
    for (const name of ['Ball', 'Ring', 'Block']) expect(grouped).toContain(`PRODUCT('${name}'`);

    await expect(service.exportMeshes(['gone' as BodyId], MEDIUM)).rejects.toThrow(
      /no longer in the model/,
    );
  });

  it('meshes body by body with progress, and stops when told to (P3-13)', async () => {
    const doc = testDocument([
      primitive('S', 'sphere', '0 mm'),
      primitive('T', 'torus', '60 mm'),
      primitive('B', 'box', '-60 mm'),
    ]);
    const result = await service.recompute({ doc });
    if (result.status !== 'done') throw new Error('not done');
    const ids = result.bodies.map((b) => b.id);
    const seen: [number, number][] = [];
    const meshes = await service.exportMeshes(ids, MEDIUM, (done, total) => {
      seen.push([done, total]);
    });
    expect(meshes).toHaveLength(3);
    expect(seen).toEqual([
      [0, 3],
      [1, 3],
      [2, 3],
      [3, 3],
    ]);

    // `false` stops before the next body; nothing is left behind.
    const before = (await service.stats()).liveShapes;
    let calls = 0;
    const stopped = service.exportMeshes(ids, MEDIUM, async () => ++calls < 2);
    await expect(stopped).rejects.toSatisfy(isExportCancelled);
    expect(calls).toBe(2);
    expect((await service.stats()).liveShapes).toBe(before);
  });

  it('keeps the bodies it exports while a recompute in between drops them (P3-13)', async () => {
    const small = new KernelService(() => loadOcct(), { engine: { maxEntries: 1 } });
    try {
      const first = await small.recompute({
        doc: testDocument([primitive('S', 'sphere', '0 mm'), primitive('B', 'box', '-60 mm')]),
      });
      if (first.status !== 'done') throw new Error('not done');
      const ids = first.bodies.map((b) => b.id);
      let recomputed = false;
      const meshes = await small.exportMeshes(ids, MEDIUM, async (done) => {
        // After the first body, another document replaces the model and the cache.
        if (done === 1 && !recomputed) {
          recomputed = true;
          const other = await small.recompute({
            doc: testDocument([primitive('T', 'torus', '0 mm')]),
          });
          expect(other.status).toBe('done');
        }
      });
      expect(recomputed).toBe(true);
      expect(meshes.map(({ mesh }) => checkManifold(mesh).ok)).toEqual([true, true]);
      // The held shapes went back to the kernel afterwards: only the torus is left.
      const other = await small.recompute({
        doc: testDocument([primitive('T', 'torus', '0 mm')]),
      });
      expect(other.status).toBe('done');
      const shapes = (await small.stats()).liveShapes;
      await small.exportMeshes(
        other.status === 'done' ? other.bodies.map((b) => b.id) : [],
        MEDIUM,
      );
      expect((await small.stats()).liveShapes).toBe(shapes);
    } finally {
      await small.dispose();
    }
  });
});
