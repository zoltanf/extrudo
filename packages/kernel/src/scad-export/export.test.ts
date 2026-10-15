// The OpenSCAD export (P6-09 slice 1, ADR-0086): body versions from the last
// recompute, Combine and Remove as CSG, everything else as polyhedra. Each
// file is rendered by OpenSCAD's real WASM (`@extrudo/openscad`'s Node
// compiler) and its result measured against the kernel's body: volume and
// box within the mesh's tolerance. Real OCCT and `strictLeaks`.
import {
  type BodyId,
  type CombineOperation,
  combineInputs,
  type ExtrudoDocument,
  type Feature,
  type FeatureId,
  filletInputs,
  type GeomRef,
  type PrimitiveInputOptions,
  type PrimitiveType,
  primitiveInputs,
  removeBodiesFeatureOf,
} from '@extrudo/core';
import { read3mf } from '@extrudo/io';
import type { ScadCompiler } from '@extrudo/openscad';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { kernelFeatures } from '../features';
import { Kernel } from '../kernel';
import { RESOLUTIONS } from '../model-export';
import { loadOcct } from '../occt/load';
import { RecomputeEngine } from '../recompute/engine';
import { testDocument, testFeature } from '../recompute/testing';
import type { KernelFeatureDefinition, RecomputeResult } from '../recompute/types';
import type { ScadBody } from './file';

type Done = Extract<RecomputeResult, { status: 'done' }>;

// The Node compiler needs Node's types, which the kernel's program doesn't
// have (see `import-scad.test.ts`).
const NODE_ENTRY = '@extrudo/openscad/node';

let kernel: Kernel;
let compiler: ScadCompiler;
let engine: RecomputeEngine;

beforeAll(async () => {
  kernel = new Kernel(await loadOcct());
  const { createNodeCompiler } = (await import(/* @vite-ignore */ NODE_ENTRY)) as {
    createNodeCompiler(): ScadCompiler;
  };
  compiler = createNodeCompiler();
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

const TESSELLATION = RESOLUTIONS.medium;

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

interface Solid {
  volume: number;
  min: number[];
  max: number[];
}

/** What OpenSCAD makes of a file: its whole result's volume and box. */
async function render(source: string): Promise<Solid> {
  const result = await compiler.compile({
    fileName: 'export.scad',
    source: new TextEncoder().encode(source),
  });
  if (!result.ok) throw new Error(`OpenSCAD: ${result.error}`);
  let volume = 0;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const { mesh } of read3mf(result.model).objects) {
    const p = mesh.positions;
    for (let i = 0; i < p.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        min[k] = Math.min(min[k] as number, p[i + k] as number);
        max[k] = Math.max(max[k] as number, p[i + k] as number);
      }
    }
    const at = (n: number) => [p[n * 3] ?? 0, p[n * 3 + 1] ?? 0, p[n * 3 + 2] ?? 0];
    for (let t = 0; t < mesh.indices.length; t += 3) {
      const [ax, ay, az] = at(mesh.indices[t] as number) as [number, number, number];
      const [bx, by, bz] = at(mesh.indices[t + 1] as number) as [number, number, number];
      const [cx, cy, cz] = at(mesh.indices[t + 2] as number) as [number, number, number];
      volume +=
        (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
    }
  }
  return { volume, min, max };
}

/** The kernel's measure of the bodies, together. */
function measured(ids: readonly BodyId[]): Solid {
  let volume = 0;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const id of ids) {
    const shape = engine.latestBody(id);
    if (shape === undefined) throw new Error(`no body ${id}`);
    const m = kernel.measure(shape);
    volume += m.volume;
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k] as number, m.bbox.min[k] as number);
      max[k] = Math.max(max[k] as number, m.bbox.max[k] as number);
    }
  }
  return { volume, min, max };
}

/** Within the mesh's tolerance: the volume to 0.5 %, the box to a few deflections. */
function expectSame(actual: Solid, expected: Solid): void {
  expect(Math.abs(actual.volume - expected.volume) / expected.volume).toBeLessThan(0.005);
  for (let k = 0; k < 3; k++) {
    expect(actual.min[k]).toBeCloseTo(expected.min[k] as number, 1);
    expect(actual.max[k]).toBeCloseTo(expected.max[k] as number, 1);
  }
}

const count = (text: string, what: string) => text.split(what).length - 1;

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
    const registry = kernelFeatures();
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
    const registry = kernelFeatures();
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

  it('refuses a body that is not in the model', async () => {
    await run(testDocument([box('A')]));
    expect(() => exportScad([{ id: 'Gone:0' as BodyId, name: 'Gone' }])).toThrow(
      'Gone is no longer in the model.',
    );
  });
});
