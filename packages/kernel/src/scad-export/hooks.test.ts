// The OpenSCAD export's hooks for the primitives, Move, Mirror, Scale and the
// rectangular and circular patterns (P6-09 slice 3, ADR-0088 §7). Each file is
// rendered by OpenSCAD's real WASM and every exported body measured against
// the kernel's: volume and box within the mesh's tolerance, and no
// polyhedron where the hooks translate everything. Real OCCT, `strictLeaks`.
import {
  type BodyId,
  type CombineOperation,
  circularPatternInputs,
  combineInputs,
  type ExtrudoDocument,
  type Feature,
  filletInputs,
  type GeomRef,
  mirrorInputs,
  moveInputs,
  type PrimitiveInputOptions,
  type PrimitiveOperation,
  type PrimitiveType,
  primitiveInputs,
  rectangularPatternInputs,
  scaleInputs,
} from '@extrudo/core';
import type { ScadCompiler } from '@extrudo/openscad';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { kernelFeatures } from '../features';
import type { SubShapeKind } from '../history';
import { Kernel } from '../kernel';
import { loadManifold } from '../manifold';
import { RESOLUTIONS } from '../model-export';
import { loadOcct } from '../occt/load';
import { RecomputeEngine } from '../recompute/engine';
import { testDocument, testFeature } from '../recompute/testing';
import type { RecomputeResult } from '../recompute/types';
import type { CsgInput } from './context';
import type { Scalar } from './ir';
import { scadNumber } from './number';
import { count, expectSame, measured, nodeCompiler, render } from './testing';

type Done = Extract<RecomputeResult, { status: 'done' }>;

let kernel: Kernel;
let compiler: ScadCompiler;
let engine: RecomputeEngine;

beforeAll(async () => {
  kernel = new Kernel(await loadOcct());
  kernel.enableMeshes(await loadManifold());
  compiler = await nodeCompiler();
});

beforeEach(() => {
  engine?.clear();
  expect(kernel.stats().liveShapes).toBe(0);
  engine = new RecomputeEngine(kernel, kernelFeatures(), { strictLeaks: true });
});

afterAll(() => {
  engine.clear();
  expect(kernel.stats().liveShapes).toBe(0);
  compiler.dispose();
});

// ------------------------------------------------------------------ helpers

// Fine, so that OpenSCAD's polygons ($fa 5°: 72 sides) stay within the
// tolerance of the kernel's exact volumes.
const TESSELLATION = RESOLUTIONS.fine;

const body = (feature: string, n = 0) => `${feature}:${n}` as BodyId;
const nameOf = (id: BodyId) => id.replace(/[^A-Za-z0-9]/g, '_');

function primitive(id: string, type: PrimitiveType, options: PrimitiveInputOptions = {}): Feature {
  return { ...testFeature(id, type), inputs: primitiveInputs(type, options) };
}

/** A 40 × 20 × 10 box centred on (x, 0) in XY, z 0…10. */
const box = (id: string, x = '0 mm', more: PrimitiveInputOptions = {}) =>
  primitive(id, 'box', {
    ...more,
    numbers: { length: '40 mm', width: '20 mm', height: '10 mm', x, ...more.numbers },
  });

/** A cylinder ⌀ 8 through that box: z −10…20. */
const rod = (id: string, x = '0 mm', more: PrimitiveInputOptions = {}) =>
  primitive(id, 'cylinder', {
    ...more,
    numbers: { diameter: '8 mm', height: '30 mm', offset: '-10 mm', x, ...more.numbers },
  });

const combine = (id: string, target: string, tools: string[], operation: CombineOperation) => ({
  ...testFeature(id, 'combine'),
  inputs: combineInputs(
    `${target}:0`,
    tools.map((t) => `${t}:0`),
    { operation },
  ),
});

async function run(doc: ExtrudoDocument): Promise<Done> {
  const result = await engine.recompute({ doc });
  if (result.status !== 'done') throw new Error('cancelled');
  for (const [id, s] of Object.entries(result.features)) {
    if (s.status === 'error') throw new Error(`${id}: ${s.message}`);
  }
  return result;
}

function exportScad(ids: readonly BodyId[], scalar?: (input: CsgInput) => Scalar): string {
  return engine.exportScad(
    {
      bodies: ids.map((id) => ({ id, name: nameOf(id) })),
      tessellation: TESSELLATION,
      project: 'Test',
      version: '0.0.0-test',
    },
    scalar,
  );
}

/**
 * Every body exported on its own matches the kernel's, and none of them is a
 * polyhedron (unless `meshes` says how many may be). The file of all of them.
 */
async function expectExact(ids: readonly BodyId[], meshes = 0): Promise<string> {
  for (const id of ids) {
    const text = exportScad([id]);
    if (meshes === 0) expect(text).not.toContain('polyhedron(');
    expectSame(await render(compiler, text), measured(kernel, engine, [id]));
  }
  const text = exportScad(ids);
  expect(count(text, 'polyhedron(')).toBe(meshes);
  return text;
}

/** The bodies at the marker. */
const bodiesOf = (result: Done) => result.bodies.map((b) => b.id);

/** A face, edge or vertex of a body, by its index there. */
function sub(id: BodyId, kind: SubShapeKind, index: number): GeomRef {
  const ref = engine.reference(id, kind, index);
  if (!ref) throw new Error(`no ${kind} ${index} on ${id}`);
  return ref;
}

/** The first face, edge or vertex of a body that `test` accepts, by the kernel's description. */
function find(id: BodyId, kind: 'face' | 'edge' | 'vertex', test: (v: number[]) => boolean) {
  const shape = engine.latestBody(id);
  if (!shape) throw new Error(`no body ${id}`);
  const described = kernel.describe(shape);
  const points =
    kind === 'face'
      ? described.faces.map((f) => [...f.centroid])
      : kind === 'edge'
        ? described.edges.map((e) => [...e.midpoint])
        : described.vertices.map((v) => [...v.point]);
  const index = points.findIndex(test);
  if (index < 0) throw new Error(`no such ${kind} on ${id}`);
  return sub(id, kind, index);
}

const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;

const XZ: GeomRef = { kind: 'plane', id: 'origin:xz' };
const YZ: GeomRef = { kind: 'plane', id: 'origin:yz' };
const Z_AXIS: GeomRef = { kind: 'axis', id: 'origin:z' };
const X_AXIS: GeomRef = { kind: 'axis', id: 'origin:x' };
const Y_AXIS: GeomRef = { kind: 'axis', id: 'origin:y' };

// ------------------------------------------------------------------ primitives

/** Each primitive as a tool that half overlaps the box `B` at its +X end. */
const TOOLS: Record<PrimitiveType, PrimitiveInputOptions['numbers']> = {
  box: { length: '10 mm', width: '8 mm', height: '20 mm', offset: '-5 mm', x: '18 mm' },
  cylinder: { diameter: '8 mm', height: '20 mm', offset: '-5 mm', x: '18 mm' },
  sphere: { diameter: '12 mm', offset: '5 mm', x: '18 mm' },
  torus: { diameter: '16 mm', tube: '4 mm', offset: '5 mm', x: '18 mm' },
};

const OPERATIONS: PrimitiveOperation[] = ['new-body', 'join', 'cut', 'intersect'];

describe('primitives', () => {
  for (const type of Object.keys(TOOLS) as PrimitiveType[]) {
    it.each(OPERATIONS)(`${type}: %s`, async (operation) => {
      const tool = primitive('T', type, { numbers: TOOLS[type], operation });
      const result = await run(testDocument([box('B'), tool]));
      const ids = bodiesOf(result);
      expect(ids).toEqual(operation === 'new-body' ? [body('B'), body('T')] : [body('B')]);
      const text = await expectExact(ids);
      const solid = {
        box: 'cube(',
        cylinder: 'cylinder(',
        sphere: 'sphere(',
        torus: 'rotate_extrude(',
      }[type];
      expect(text).toContain(solid);
      if (operation !== 'new-body') {
        const kind = { join: 'union', cut: 'difference', intersect: 'intersection' }[operation];
        expect(text).toMatch(
          new RegExp(`module B_0_v2\\(\\) \\{\\n {2}${kind}\\(\\) \\{\\n {4}B_0_v1\\(\\);`),
        );
      }
    });
  }

  it('places a box rotated and moved on an origin plane and on a face', async () => {
    await run(testDocument([box('B')]));
    // The box's +X end face (x 20), a plane whose frame isn't the world's.
    const end = find(body('B'), 'face', (c) => near(c[0] as number, 20));
    const turned = (id: string, plane: GeomRef) =>
      primitive(id, 'box', {
        plane,
        numbers: {
          length: '12 mm',
          width: '6 mm',
          height: '9 mm',
          rotation: '30 deg',
          x: '3 mm',
          y: '2 mm',
          offset: '1.5 mm',
        },
      });
    const result = await run(
      testDocument([box('B'), turned('OnXz', XZ), { ...turned('OnFace', end) }]),
    );
    const ids = bodiesOf(result);
    expect(ids).toEqual([body('B'), body('OnXz'), body('OnFace')]);
    const text = await expectExact(ids);
    // B sits at the origin: no placement.
    expect(count(text, 'multmatrix(')).toBe(2);
  });

  it('takes a negative height for a box and a cylinder', async () => {
    const down = { height: '-12 mm', offset: '4 mm' };
    const result = await run(
      testDocument([
        box('B'),
        primitive('Peg', 'cylinder', {
          numbers: { diameter: '6 mm', x: '-10 mm', ...down },
          operation: 'join',
        }),
        primitive('Slot', 'box', {
          numbers: { length: '6 mm', width: '30 mm', x: '10 mm', ...down, offset: '14 mm' },
          operation: 'cut',
        }),
        primitive('Post', 'box', {
          numbers: { length: '5 mm', width: '5 mm', x: '40 mm', ...down },
        }),
      ]),
    );
    const ids = bodiesOf(result);
    expect(ids).toEqual([body('B'), body('Post')]);
    // Below the plane: the kernel's box reaches down to z −8.
    expect(measured(kernel, engine, [body('B')]).min[2]).toBeCloseTo(-8, 6);
    const text = await expectExact(ids);
    expect(text).toContain('h = 12');
  });

  for (const axis of ['normal', 'x', 'y'] as const) {
    for (const seat of ['centre', 'plane'] as const) {
      it(`places a torus with axis ${axis}, seat ${seat}`, async () => {
        const ring = primitive('Ring', 'torus', {
          plane: XZ,
          numbers: { diameter: '20 mm', tube: '5 mm', x: '7 mm', y: '3 mm', offset: '2 mm' },
          axis,
          seat,
        });
        const result = await run(testDocument([ring]));
        await expectExact(bodiesOf(result));
      });
    }
  }

  it('writes a tool that cuts two bodies once, as a module', async () => {
    // Along X (the YZ plane's normal), through two boxes 50 mm apart.
    const drill = primitive('Drill', 'cylinder', {
      plane: YZ,
      numbers: { diameter: '6 mm', height: '100 mm', offset: '-30 mm', y: '5 mm' },
      operation: 'cut',
    });
    const result = await run(testDocument([box('B'), box('C', '50 mm'), drill]));
    const ids = bodiesOf(result);
    expect(ids).toEqual([body('B'), body('C')]);
    const text = await expectExact(ids);
    expect(count(text, 'module Drill_tool()')).toBe(1);
    expect(count(text, 'Drill_tool();')).toBe(2);
    expect(count(text, 'cylinder(')).toBe(1);
  });

  it('writes the scalars where OpenSCAD takes an expression', async () => {
    // A stand-in translator: every input as an expression of its value.
    const scalar = (input: CsgInput): Scalar => ({
      expr: `(1 * ${scadNumber(input.value)})`,
      value: input.value,
      refs: [],
    });
    await run(
      testDocument([
        box('B', '0 mm', { numbers: { height: '-10 mm' } }),
        primitive('T', 'torus', { numbers: { diameter: '16 mm', tube: '4 mm', x: '30 mm' } }),
      ]),
    );
    const text = exportScad([body('B'), body('T')], scalar);
    expect(text).toContain('cube(size = [(1 * 40), (1 * 20), abs((1 * -10))], center = true)');
    expect(text).toContain('translate([0, 0, (1 * -10) / 2])');
    expect(text).toContain('translate([(1 * 16) / 2, 0, 0])');
    expect(text).toContain('circle(r = (1 * 4) / 2)');
    expectSame(await render(compiler, text), measured(kernel, engine, [body('B'), body('T')]));
  });
});

// ------------------------------------------------------------------ move

describe('move', () => {
  /** A box away from the origin, so the free move's pivot (its centre) isn't the origin. */
  const block = () => box('A', '30 mm', { numbers: { y: '10 mm', offset: '5 mm' } });

  it('moves free with three turns about the pivot', async () => {
    // A box of three different sides turned about X, Y and Z: OpenSCAD's
    // `rotate([x, y, z])` turns in Extrudo's order, X then Y then Z, or the
    // box would end up elsewhere.
    const move = {
      ...testFeature('Mv', 'move'),
      inputs: moveInputs(['A:0'], {
        rx: '20 deg',
        ry: '35 deg',
        rz: '50 deg',
        dx: '5 mm',
        dy: '-3 mm',
        dz: '7 mm',
      }),
    };
    const result = await run(testDocument([block(), move]));
    const text = await expectExact(bodiesOf(result));
    expect(text).toContain('rotate([20, 35, 50])');
    expect(text).toContain('translate([5, -3, 7])');
    expect(text).toContain('translate([30, 10, 10])');
  });

  it('rotates about an edge of another body', async () => {
    await run(testDocument([block(), box('E', '-40 mm')]));
    // E's edge along Y at its +X top (x −20, z 10).
    const edge = find(
      body('E'),
      'edge',
      (m) => near(m[0] as number, -20) && near(m[2] as number, 10),
    );
    const move = {
      ...testFeature('Mv', 'move'),
      inputs: moveInputs(['A:0'], { mode: 'rotate', axis: edge, angle: '70 deg' }),
    };
    const result = await run(testDocument([block(), box('E', '-40 mm'), move]));
    const text = await expectExact(bodiesOf(result));
    expect(text).toContain('rotate(a = 70, v = [0, 1, 0])');
  });

  it('moves point to point, and copies', async () => {
    await run(testDocument([block(), box('E', '-40 mm')]));
    const from = find(
      body('A'),
      'vertex',
      (p) => near(p[0] as number, 10) && near(p[2] as number, 5),
    );
    const to = find(
      body('E'),
      'vertex',
      (p) => near(p[0] as number, -20) && near(p[2] as number, 10),
    );
    const move = {
      ...testFeature('Mv', 'move'),
      inputs: moveInputs(['A:0'], { mode: 'point-to-point', from, to, copy: true }),
    };
    const result = await run(testDocument([block(), box('E', '-40 mm'), move]));
    const ids = bodiesOf(result);
    expect(ids).toEqual([body('A'), body('E'), body('Mv')]);
    const text = await expectExact(ids);
    // The source keeps its version; the copy is the moved one.
    expect(text).toContain('module A_0_v1()');
    expect(text).not.toContain('module A_0_v2()');
    expect(text).toMatch(/module Mv_0_v1\(\) \{\n {2}translate\(\[[^\]]+\]\)\n {4}A_0_v1\(\);/);
  });
});

// ------------------------------------------------------------------ mirror

describe('mirror', () => {
  /** A box's +X end face (x 20), shifted by `x`. */
  const endOf = async (x: number) => {
    await run(testDocument([box('M', `${x - 20} mm`)]));
    return find(body('M'), 'face', (c) => near(c[0] as number, x));
  };

  it('mirrors a body in a face, plain and as a copy', async () => {
    const plane = await endOf(50);
    const plain = {
      ...testFeature('Mr', 'mirror'),
      inputs: mirrorInputs(['A:0'], plane, { copy: false }),
    };
    const copy = {
      ...testFeature('Mc', 'mirror'),
      inputs: mirrorInputs(['C:0'], plane, { copy: true }),
    };
    const result = await run(
      testDocument([
        box('M', '30 mm'),
        box('A', '0 mm', { numbers: { y: '5 mm' } }),
        rod('C'),
        plain,
        copy,
      ]),
    );
    const ids = bodiesOf(result);
    expect(ids).toEqual([body('M'), body('A'), body('C'), body('Mc')]);
    const text = await expectExact(ids);
    expect(text).toContain('mirror([1, 0, 0])');
  });

  it('joins a mirrored copy to its original', async () => {
    // A box across the YZ plane, mirrored in it: the copy overlaps it.
    const mirror = {
      ...testFeature('Mj', 'mirror'),
      inputs: mirrorInputs(['A:0'], YZ, { copy: true, join: true }),
    };
    const result = await run(testDocument([box('A', '15 mm'), mirror]));
    const ids = bodiesOf(result);
    expect(ids).toEqual([body('A')]);
    const text = await expectExact(ids);
    expect(text).toMatch(/module A_0_v2\(\) \{\n {2}union\(\) \{\n {4}A_0_v1\(\);\n {4}mirror/);
    expect(measured(kernel, engine, ids).volume).toBeCloseTo(70 * 20 * 10, 3);
  });

  it("keeps a joined copy that doesn't touch its original as a new body", async () => {
    // A box at x 10…50, mirrored in YZ: the copy (x −50…−10) stays apart, a
    // new body as the evaluator numbers it, and the original keeps its version.
    const mirror = {
      ...testFeature('Mj', 'mirror'),
      inputs: mirrorInputs(['A:0'], YZ, { copy: true, join: true }),
    };
    const result = await run(testDocument([box('A', '30 mm'), mirror]));
    const ids = bodiesOf(result);
    expect(ids).toEqual([body('A'), body('Mj')]);
    const text = await expectExact(ids);
    expect(text).not.toContain('module A_0_v2()');
    expect(text).toMatch(/module Mj_0_v1\(\) \{\n {2}mirror\(\[1, 0, 0\]\)\n {4}A_0_v1\(\);/);
  });

  it('meshes a mirror of features, and says why', async () => {
    const hole = rod('H', '12 mm', { operation: 'cut' });
    const mirror = {
      ...testFeature('Mf', 'mirror'),
      inputs: mirrorInputs([], YZ, { features: ['H'] }),
    };
    const result = await run(testDocument([box('A'), hole, mirror]));
    const text = await expectExact(bodiesOf(result), 1);
    expect(text).toContain('//   A_0_v3: Mf: mirroring features');
  });
});

// ------------------------------------------------------------------ scale

describe('scale', () => {
  it('scales uniformly about a vertex', async () => {
    await run(testDocument([box('A', '25 mm')]));
    const corner = find(
      body('A'),
      'vertex',
      (p) => near(p[0] as number, 45) && near(p[2] as number, 10),
    );
    const scale = {
      ...testFeature('Sc', 'scale'),
      inputs: scaleInputs(['A:0'], { factor: '1.5', point: corner }),
    };
    const result = await run(testDocument([box('A', '25 mm'), scale]));
    const text = await expectExact(bodiesOf(result));
    expect(text).toContain('scale([1.5, 1.5, 1.5])');
  });

  it('scales non-uniformly about the centre, and copies', async () => {
    const scale = {
      ...testFeature('Sc', 'scale'),
      inputs: scaleInputs(['A:0', 'C:0'], {
        mode: 'non-uniform',
        x: '0.5',
        y: '2',
        z: '1.25',
        copy: true,
      }),
    };
    const result = await run(testDocument([box('A', '25 mm'), rod('C', '-30 mm'), scale]));
    const ids = bodiesOf(result);
    expect(ids).toEqual([body('A'), body('C'), body('Sc', 0), body('Sc', 1)]);
    const text = await expectExact(ids);
    expect(count(text, 'scale([0.5, 2, 1.25])')).toBe(2);
  });
});

// ------------------------------------------------------------------ patterns

describe('patterns', () => {
  it('copies a body in two directions, skipping one', async () => {
    const pattern = {
      ...testFeature('Rp', 'rectangularPattern'),
      inputs: rectangularPatternInputs({
        bodies: ['C:0'],
        direction1: X_AXIS,
        count1: '3',
        distance1: '15 mm',
        direction2: Y_AXIS,
        count2: '2',
        distance2: '12 mm',
        skip: ['1x1'],
      }),
    };
    const result = await run(testDocument([rod('C'), pattern]));
    const ids = bodiesOf(result);
    // Six instances, the original and one skipped among them: four copies.
    expect(ids).toHaveLength(5);
    const text = await expectExact(ids);
    // The original and four copies, each moved by a `translate`.
    expect(count(text, 'C_0_v1();')).toBe(5);
    expect(text).not.toContain('multmatrix(');
  });

  it('joins a circular pattern of a body into it', async () => {
    const bar = primitive('Bar', 'box', {
      numbers: { length: '40 mm', width: '6 mm', height: '5 mm', x: '10 mm' },
    });
    const pattern = {
      ...testFeature('Cp', 'circularPattern'),
      inputs: circularPatternInputs({ bodies: ['Bar:0'], axis: Z_AXIS, count: '5', join: true }),
    };
    const result = await run(testDocument([bar, pattern]));
    const ids = bodiesOf(result);
    expect(ids).toEqual([body('Bar')]);
    const text = await expectExact(ids);
    expect(text).toMatch(/module Bar_0_v2\(\) \{\n {2}union\(\) \{\n {4}Bar_0_v1\(\);/);
    expect(count(text, 'Bar_0_v1();')).toBe(5);
  });

  it('meshes a pattern of features', async () => {
    const pattern = {
      ...testFeature('Pf', 'rectangularPattern'),
      inputs: rectangularPatternInputs({
        features: ['H'],
        direction1: X_AXIS,
        count1: '2',
        distance1: '15 mm',
      }),
    };
    const result = await run(
      testDocument([box('A'), rod('H', '-8 mm', { operation: 'cut' }), pattern]),
    );
    const text = await expectExact(bodiesOf(result), 1);
    expect(text).toContain('//   A_0_v3: Pf: patterning features');
  });
});

// ------------------------------------------------------------------ the ADR's case

describe("the ADR's case", () => {
  /** Holes about the Z axis that overlap, so the joined pattern is one body. */
  const holes = () => [
    rod('C', '3 mm'),
    {
      ...testFeature('Cp', 'circularPattern'),
      inputs: circularPatternInputs({ bodies: ['C:0'], axis: Z_AXIS, count: '4', join: true }),
    },
    combine('Cut', 'A', ['C'], 'cut'),
  ];

  it('cuts a pattern of cylinders from a box without a polyhedron', async () => {
    const result = await run(testDocument([box('A'), ...holes()]));
    expect(bodiesOf(result)).toEqual([body('A')]);
    const text = await expectExact([body('A')]);
    expect(text).toMatch(
      /module A_0_v2\(\) \{\n {2}difference\(\) \{\n {4}A_0_v1\(\);\n {4}C_body_v2\(\);/,
    );
  });

  it('cuts it from a filleted box: the fillet a polyhedron, the holes CSG', async () => {
    await run(testDocument([box('A')]));
    // An upright outer edge (x 20, y 10).
    const edge = find(
      body('A'),
      'edge',
      (m) => near(m[0] as number, 20) && near(m[1] as number, 10),
    );
    const fillet = {
      ...testFeature('Fl', 'fillet'),
      inputs: filletInputs([{ edges: [edge], radius: '3 mm' }]),
    };
    const result = await run(testDocument([box('A'), fillet, ...holes()]));
    expect(bodiesOf(result)).toEqual([body('A')]);
    const text = await expectExact([body('A')], 1);
    expect(text).toContain('//   A_0_v2: Fl: no OpenSCAD equivalent');
    expect(text).toMatch(
      /module A_0_v3\(\) \{\n {2}difference\(\) \{\n {4}A_0_v2\(\);\n {4}C_body_v2\(\);/,
    );
  });
});
