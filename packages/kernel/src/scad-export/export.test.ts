// The OpenSCAD export (P6-09 slice 1, ADR-0088): body versions from the last
// recompute, Combine and Remove as CSG, everything else as polyhedra. Each
// file is rendered by OpenSCAD's real WASM (`@extrudo/openscad`'s Node
// compiler) and its result measured against the kernel's body: volume and
// box within the mesh's tolerance. Real OCCT and `strictLeaks`.
import {
  type AttachmentId,
  type BodyId,
  type CombineOperation,
  combineInputs,
  type ExtrudoDocument,
  type Feature,
  type FeatureId,
  filletInputs,
  type GeomRef,
  importInputs,
  moveInputs,
  type PrimitiveInputOptions,
  type PrimitiveType,
  primitiveInputs,
  removeBodiesFeatureOf,
} from '@extrudo/core';
import type { ScadCompiler } from '@extrudo/openscad';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import cubeStl from '../../../../fixtures/imports/cube.stl?url&inline';
import { kernelMove } from '../features/transform';
import { Kernel } from '../kernel';
import { loadManifold } from '../manifold';
import { RESOLUTIONS } from '../model-export';
import { loadOcct } from '../occt/load';
import { RecomputeEngine } from '../recompute/engine';
import { testDocument, testFeature } from '../recompute/testing';
import type { ImportedFile, KernelFeatureDefinition, RecomputeResult } from '../recompute/types';
import type { ScadBody } from './file';
import { boolean } from './ir';
import {
  count,
  expectSame,
  featuresWithoutHooks,
  measured as measureWith,
  nodeCompiler,
  render as renderWith,
} from './testing';

type Done = Extract<RecomputeResult, { status: 'done' }>;

/**
 * These tests are about the version walk and its fallback: the primitives
 * they build with are polyhedra here, as they were before they had hooks
 * (`hooks.test.ts` tests those).
 */
const features = () => featuresWithoutHooks(['box', 'cylinder', 'sphere', 'torus']);

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
  engine = new RecomputeEngine(kernel, features(), { strictLeaks: true });
});

afterAll(() => {
  engine.clear();
  expect(kernel.stats().liveShapes).toBe(0);
  compiler.dispose();
});

// ------------------------------------------------------------------ helpers

const TESSELLATION = RESOLUTIONS.medium;

/** A 20 mm cube, 0…20 on each axis, as a binary STL (a `?url&inline` data URL). */
const CUBE_STL = Uint8Array.from(atob(cubeStl.slice(cubeStl.indexOf(',') + 1)), (c) =>
  c.charCodeAt(0),
);

function primitive(id: string, type: PrimitiveType, options: PrimitiveInputOptions = {}): Feature {
  return { ...testFeature(id, type), inputs: primitiveInputs(type, options) };
}

/** A 40 × 20 × 10 box centred on the origin in XY, z 0…10 (body `<id>:0`). */
const box = (id: string, x = '0 mm') =>
  primitive(id, 'box', {
    numbers: { length: '40 mm', width: '20 mm', height: '10 mm', x },
  });

/** A cylinder through that box: ⌀ 8, z −10…20. */
const rod = (id: string, x = '0 mm') =>
  primitive(id, 'cylinder', {
    numbers: { diameter: '8 mm', height: '30 mm', offset: '-10 mm', x },
  });

const combine = (
  id: string,
  target: string,
  tools: string[],
  operation: CombineOperation,
): Feature => ({
  ...testFeature(id, 'combine'),
  inputs: combineInputs(
    `${target}:0`,
    tools.map((t) => `${t}:0`),
    { operation },
  ),
});

const body = (feature: string) => `${feature}:0` as BodyId;

async function run(doc: ExtrudoDocument): Promise<Done> {
  const result = await engine.recompute({ doc });
  if (result.status !== 'done') throw new Error('cancelled');
  for (const [id, s] of Object.entries(result.features)) {
    if (s.status === 'error') throw new Error(`${id}: ${s.message}`);
  }
  return result;
}

function exportScad(bodies: readonly ScadBody[]): string {
  return engine.exportScad({
    bodies,
    tessellation: TESSELLATION,
    project: 'Test',
    version: '0.0.0-test',
  });
}

/** OpenSCAD's result of a file, measured. */
const render = (source: string) => renderWith(compiler, source);

/** The kernel's measure of the bodies, together. */
const measured = (ids: readonly BodyId[]) => measureWith(kernel, engine, ids);

// ------------------------------------------------------------------ tests

describe('exportScad', () => {
  it('writes a combine cut as a difference of the two polyhedra', async () => {
    await run(testDocument([box('A'), rod('C'), combine('Cut', 'A', ['C'], 'cut')]));
    const text = exportScad([{ id: body('A'), name: 'Plate' }]);
    expect(text).toContain('difference() {');
    expect(text).toMatch(
      /module Plate_v2\(\) \{\n {2}difference\(\) \{\n {4}Plate_v1\(\);\n {4}C_body_v1\(\);\n {2}\}\n\}/,
    );
    expect(count(text, 'polyhedron(')).toBe(2);
    expect(text).toContain('//   Plate_v1: A: no OpenSCAD equivalent');
    expect(text).toContain('//   C_body_v1: C: no OpenSCAD equivalent');
    expect(text).toContain('// Plate\nPlate_v2();');
    expect(text).toContain(`$fa = 15;\n$fs = 0.4;`);
    expectSame(await render(text), measured([body('A')]));
  });

  it('meshes both pieces of a cut that splits a body', async () => {
    const slab = primitive('S', 'box', {
      numbers: { length: '4 mm', width: '40 mm', height: '30 mm', offset: '-10 mm' },
    });
    const result = await run(testDocument([box('A'), slab, combine('Cut', 'A', ['S'], 'cut')]));
    const ids = result.bodies.map((b) => b.id);
    expect(ids).toEqual([body('A'), 'Cut:0']);
    const text = exportScad(ids.map((id, i) => ({ id, name: `Half${i + 1}` })));
    expect(text).not.toContain('difference()');
    expect(text).toContain('//   Half1_v2: Cut: split a body into pieces');
    expect(text).toContain('//   Half2_v1: Cut: split a body into pieces');
    expect(count(text, 'polyhedron(')).toBe(2);
    expectSame(await render(text), measured(ids));
    // Each on its own as well.
    for (const [i, id] of ids.entries()) {
      expectSame(await render(exportScad([{ id, name: `Half${i + 1}` }])), measured([id]));
    }
  });

  it('joins two bodies and removes a third', async () => {
    const sphere = primitive('Ball', 'sphere', { numbers: { diameter: '6 mm', x: '60 mm' } });
    const result = await run(
      testDocument([
        box('A'),
        box('B', '30 mm'),
        sphere,
        combine('Join', 'A', ['B'], 'join'),
        removeBodiesFeatureOf('Rm' as FeatureId, 'Rm', [body('Ball')]),
      ]),
    );
    expect(result.bodies.map((b) => b.id)).toEqual([body('A')]);
    const text = exportScad([{ id: body('A'), name: 'Bar' }]);
    expect(text).toMatch(/union\(\) \{\n {4}Bar_v1\(\);\n {4}B_body_v1\(\);/);
    expect(text).not.toContain('Ball');
    expectSame(await render(text), measured([body('A')]));
    expect(measured([body('A')]).volume).toBeCloseTo(40 * 20 * 10 + 30 * 20 * 10, 0);
  });

  it('builds on a feature without a hook with CSG again', async () => {
    // An edge of the box away from the hole, named on the box alone.
    await run(testDocument([box('A')]));
    const edge = (() => {
      for (let i = 0; i < 12; i++) {
        const ref = engine.reference(body('A'), 'edge', i);
        if (ref) return ref;
      }
      throw new Error('no edge');
    })() as GeomRef;
    const fillet: Feature = {
      ...testFeature('Fillet3', 'fillet'),
      inputs: filletInputs([{ edges: [edge], radius: '2 mm' }]),
    };
    await run(
      testDocument([
        box('A'),
        rod('C'),
        combine('Cut1', 'A', ['C'], 'cut'),
        fillet,
        rod('D', '12 mm'),
        combine('Cut2', 'A', ['D'], 'cut'),
      ]),
    );
    const text = exportScad([{ id: body('A'), name: 'Plate', color: '#FF8800' }]);
    // v1 the box, v2 the first cut (not reached), v3 the fillet, v4 the second cut.
    expect(text).toContain('//   Plate_v3: Fillet3: no OpenSCAD equivalent');
    expect(text).not.toContain('module Plate_v2()');
    expect(text).not.toContain('module Plate_v1()');
    expect(text).not.toContain('C_body');
    expect(text).toMatch(
      /module Plate_v4\(\) \{\n {2}difference\(\) \{\n {4}Plate_v3\(\);\n {4}D_body_v1\(\);/,
    );
    expect(text).toContain('color("#ff8800")\n  Plate_v4();');
    expectSame(await render(text), measured([body('A')]));
  });

  it('writes the same bytes for the same document', async () => {
    const doc = testDocument([box('A'), rod('C'), combine('Cut', 'A', ['C'], 'cut')]);
    await run(doc);
    const bodies = [{ id: body('A'), name: 'Plate' }];
    const first = exportScad(bodies);
    expect(exportScad(bodies)).toBe(first);
    // And after the cache is gone: the shapes are made again.
    engine.clear();
    await run(doc);
    expect(exportScad(bodies)).toBe(first);
  });

  it('writes only the bodies chosen, in their colours and components', async () => {
    const doc = testDocument([box('A'), box('B', '50 mm'), rod('C', '50 mm')]);
    doc.bodies = {
      [body('A')]: { name: 'Shown', visible: true, color: '#112233' },
      [body('B')]: { name: 'Hidden', visible: false },
      [body('C')]: { name: 'Pin', visible: true },
    };
    await run(doc);
    const text = exportScad([
      { id: body('A'), name: 'Shown', color: '#112233', component: 'Frame' },
      { id: body('C'), name: 'Pin' },
    ]);
    expect(text).toContain('// Shown (component Frame)\ncolor("#112233")\n  Shown_v1();');
    expect(text).toContain('// Pin\nPin_v1();');
    expect(text).not.toContain('Hidden');
    const chosen = exportScad([{ id: body('B'), name: 'Hidden' }]);
    expect(chosen).toContain('// Hidden\nHidden_v1();');
  });

  it('passes over suppressed and failed features', async () => {
    const suppressed = { ...combine('Cut', 'A', ['C'], 'cut'), suppressed: true };
    const failed = combine('Bad', 'A', ['Nope'], 'cut');
    const result = await engine.recompute({
      doc: testDocument([box('A'), rod('C'), suppressed, failed]),
    });
    expect(result.status === 'done' && result.features['Bad' as FeatureId]?.status).toBe('error');
    const text = exportScad([{ id: body('A'), name: 'Plate' }]);
    expect(text).toContain('module Plate_v1()');
    expect(text).not.toContain('difference()');
    expect(text).not.toContain('C_body');
  });

  it("writes a script's generated features under the script's name", async () => {
    // A feature that makes a combine, as a Script or a plugin does (ADR-0070 §1).
    const registry = features();
    registry.register({
      type: 'test-maker',
      label: 'Maker',
      category: 'create',
      icon: 'test',
      inputsSchema: z.strictObject({}),
      evaluate() {
        throw new Error('expanded, not evaluated');
      },
      expand: () => ({
        features: [{ ...combine('Gen.f1', 'A', ['C'], 'cut'), name: 'Combine1' }],
        log: [],
      }),
    } as KernelFeatureDefinition);
    engine.clear();
    engine = new RecomputeEngine(kernel, registry, { strictLeaks: true });
    const maker: Feature = { ...testFeature('Gen', 'test-maker'), name: 'Script1' };
    await run(testDocument([box('A'), rod('C'), maker, primitive('E', 'sphere')]));
    const text = exportScad([
      { id: body('A'), name: 'Plate' },
      { id: body('E'), name: 'Ball' },
    ]);
    expect(text).toMatch(/module Plate_v2\(\) \{\n {2}difference\(\) \{/);
    expect(text).toContain('//   Ball_v1: E: no OpenSCAD equivalent');
    expectSame(await render(exportScad([{ id: body('A'), name: 'Plate' }])), measured([body('A')]));
  });

  it("names a generated feature's polyhedron after its script", async () => {
    const registry = features();
    registry.register({
      type: 'test-maker',
      label: 'Maker',
      category: 'create',
      icon: 'test',
      inputsSchema: z.strictObject({}),
      evaluate() {
        throw new Error('expanded, not evaluated');
      },
      expand: () => ({ features: [{ ...box('Gen.f1'), name: 'Box1' }], log: [] }),
    } as KernelFeatureDefinition);
    engine.clear();
    engine = new RecomputeEngine(kernel, registry, { strictLeaks: true });
    await run(testDocument([{ ...testFeature('Gen', 'test-maker'), name: 'Script1' }]));
    const text = exportScad([{ id: 'Gen.f1:0' as BodyId, name: 'Block' }]);
    expect(text).toContain('//   Block_v1: Script1 › Box1: no OpenSCAD equivalent');
  });

  it('writes a mesh body as its own triangles, and cuts it with CSG', async () => {
    const file = 'file-1' as AttachmentId;
    const held: ImportedFile = { bytes: CUBE_STL, mediaType: 'model/stl' };
    engine.clear();
    engine = new RecomputeEngine(kernel, features(), {
      strictLeaks: true,
      files: (id) => (id === file ? held : undefined),
    });
    const doc: ExtrudoDocument = {
      ...testDocument([
        { ...testFeature('Import1', 'import'), inputs: importInputs({ file }) },
        rod('C', '10 mm'),
        combine('Cut', 'Import1', ['C'], 'cut'),
      ]),
      attachments: {
        [file]: {
          name: 'cube',
          fileName: 'cube.stl',
          mediaType: 'model/stl',
          sha256: 'c'.repeat(64),
          size: CUBE_STL.length,
        },
      },
    };
    await run(doc);
    const text = exportScad([{ id: body('Import1'), name: 'Cube' }]);
    expect(text).toContain('//   Cube_v1: Import1: no OpenSCAD equivalent');
    // The STL as it is: 8 corners and 12 triangles (every coordinate a whole number).
    const cube = text.slice(text.indexOf('module Cube_v1()'), text.indexOf('module C_body_v1()'));
    expect(cube.match(/\[\d+, \d+, \d+\]/g)?.length).toBe(8 + 12);
    expect(text).toMatch(/difference\(\) \{\n {4}Cube_v1\(\);\n {4}C_body_v1\(\);/);
    expectSame(await render(text), measured([body('Import1')]));
  });

  it('writes a tool two bodies use as a module, and one used once in place', async () => {
    // Move with a test hook that moves each body by one shared translate (the
    // hook for Move itself is a later slice): the scalar comes from the input.
    const registry = features();
    registry.register({
      ...(kernelMove as unknown as KernelFeatureDefinition),
      type: 'test-move',
      csg(ctx) {
        const shift = ctx.tool({ kind: 'sphere', r: ctx.scalar('dx') });
        return new Map(
          ctx.changed.map((id) => [id, boolean('union', [ctx.body(id), shift])] as const),
        );
      },
    });
    engine.clear();
    engine = new RecomputeEngine(kernel, registry, { strictLeaks: true });
    const move = (id: string, bodies: string[]): Feature => ({
      ...testFeature(id, 'test-move'),
      inputs: moveInputs(
        bodies.map((b) => `${b}:0`),
        { dx: '5 mm' },
      ),
    });
    await run(
      testDocument([box('A'), box('B', '50 mm'), move('Mover', ['A', 'B']), move('Solo', ['A'])]),
    );
    const text = exportScad([
      { id: body('A'), name: 'A' },
      { id: body('B'), name: 'B' },
    ]);
    expect(count(text, 'module Mover_tool()')).toBe(1);
    expect(text).toMatch(
      /module A_v2\(\) \{\n {2}union\(\) \{\n {4}A_v1\(\);\n {4}Mover_tool\(\);/,
    );
    expect(text).toMatch(
      /module B_v2\(\) \{\n {2}union\(\) \{\n {4}B_v1\(\);\n {4}Mover_tool\(\);/,
    );
    expect(text).toMatch(
      /module A_v3\(\) \{\n {2}union\(\) \{\n {4}A_v2\(\);\n {4}sphere\(r = 5\);/,
    );
    expect(text).not.toContain('Solo_tool');
    // The tool's module comes before the first version that uses it.
    expect(text.indexOf('module Mover_tool()')).toBeLessThan(text.indexOf('module A_v2()'));
  });

  it('refuses a body that is not in the model', async () => {
    await run(testDocument([box('A')]));
    expect(() => exportScad([{ id: 'Gone:0' as BodyId, name: 'Gone' }])).toThrow(
      'Gone is no longer in the model.',
    );
  });
});
