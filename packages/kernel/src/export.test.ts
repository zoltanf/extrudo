// Export (P2-12, ADR-0034): welded meshes for STL and 3MF that close up for
// every kind of face the modelling features make, and STEP AP242 that reads
// back to the same solids.
import { checkManifold, readStl, writeStl } from '@extrudo/io';
import { beforeAll, describe, expect, it } from 'vitest';
import { Kernel, KernelError, type ShapeHandle, stepString, type Vec3 } from './kernel';
import type { MeshOptions } from './mesh';
import { loadOcct } from './occt/load';
import type { PlanarCurve, PlanarFrame } from './planar';

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
