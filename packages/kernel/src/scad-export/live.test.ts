// The OpenSCAD export's live parameters (P6-09 slice 4b, ADR-0088 §4–§6):
// scalars written as expressions over the parameter variables, and the
// parameter block collected from the walk. Most tests render the file twice,
// as exported and with a parameter overridden (OpenSCAD's `-D`), and compare
// each with the kernel recomputed at that value. Real OCCT, `strictLeaks`.
import {
  type BodyId,
  type DimensionId,
  type ExtrudoDocument,
  evaluateParameters,
  extrudeInputs,
  type Feature,
  filletInputs,
  type GeomRef,
  type LengthUnit,
  moveInputs,
  originPlaneRef,
  type Parameter,
  type ParameterId,
  type PrimitiveInputOptions,
  type PrimitiveType,
  primitiveInputs,
  rectangularPatternInputs,
  type SketchDimension,
  scaleInputs,
  sketchInputs,
  type UnitKind,
} from '@extrudo/core';
import type { ScadCompiler, ScadDefine } from '@extrudo/openscad';
import { SketchBuilder } from '@extrudo/sketch/fixtures';
import { detectProfiles } from '@extrudo/sketch/profiles';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { kernelFeatures } from '../features';
import { Kernel } from '../kernel';
import { loadManifold } from '../manifold';
import { RESOLUTIONS } from '../model-export';
import { loadOcct } from '../occt/load';
import { RecomputeEngine } from '../recompute/engine';
import { testDocument, testFeature } from '../recompute/testing';
import type { RecomputeResult } from '../recompute/types';
import { scadNames } from './expr';
import { liveScalar } from './live';
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

// Fine, as slice 3's tests: OpenSCAD's circles stay within the volume tolerance.
const TESSELLATION = RESOLUTIONS.fine;

const body = (feature: string, n = 0) => `${feature}:${n}` as BodyId;

function primitive(id: string, type: PrimitiveType, options: PrimitiveInputOptions = {}): Feature {
  return { ...testFeature(id, type), inputs: primitiveInputs(type, options) };
}

const box = (id: string, numbers: Record<string, string>, more: PrimitiveInputOptions = {}) =>
  primitive(id, 'box', {
    ...more,
    numbers: { length: '40 mm', width: '20 mm', height: '10 mm', ...numbers },
  });

/** A user parameter; `customizer` exposes it. */
function param(
  name: string,
  expression: string,
  unit: UnitKind = 'length',
  customizer?: Parameter['customizer'],
): Parameter {
  return {
    id: `p-${name}` as ParameterId,
    name,
    expression,
    unit,
    ...(customizer && { customizer }),
  };
}

function docOf(
  features: Feature[],
  parameters: Parameter[] = [],
  units: LengthUnit = 'mm',
): ExtrudoDocument {
  const doc = testDocument(features);
  return { ...doc, parameters, settings: { ...doc.settings, units } };
}

/** The document with parameter `name` set to `expression`. */
const setParam = (doc: ExtrudoDocument, name: string, expression: string): ExtrudoDocument => ({
  ...doc,
  parameters: doc.parameters.map((p) => (p.name === name ? { ...p, expression } : p)),
});

async function run(doc: ExtrudoDocument): Promise<Done> {
  const result = await engine.recompute({ doc });
  if (result.status !== 'done') throw new Error('cancelled');
  for (const [id, s] of Object.entries(result.features)) {
    if (s.status === 'error') throw new Error(`${id}: ${s.message}`);
  }
  return result;
}

const bodiesOf = (result: Done) => result.bodies.map((b) => b.id);

function exportScad(ids: readonly BodyId[]): string {
  return engine.exportScad({
    bodies: ids.map((id) => ({ id, name: id.replace(/[^A-Za-z0-9]/g, '_') })),
    tessellation: TESSELLATION,
    project: 'Test',
    version: '0.0.0-test',
  });
}

/**
 * Exports the bodies of `doc` (all of them), checks the file against the
 * kernel, then renders it with `define` and checks that against the kernel
 * recomputed with `changed`. Returns the file.
 */
async function expectLive(
  doc: ExtrudoDocument,
  define: ScadDefine,
  changed: ExtrudoDocument,
  meshes = 0,
): Promise<string> {
  const ids = bodiesOf(await run(doc));
  const text = exportScad(ids);
  expect(count(text, 'polyhedron(')).toBe(meshes);
  expectSame(await render(compiler, text), measured(kernel, engine, ids));
  const other = bodiesOf(await run(changed));
  expect(other).toEqual(ids);
  const before = measured(kernel, engine, ids);
  const after = await render(compiler, text, [define]);
  expectSame(after, before);
  return text;
}

/** The first edge of a body whose midpoint `test` accepts. */
function edgeOf(id: BodyId, test: (m: number[]) => boolean): GeomRef {
  const shape = engine.latestBody(id);
  if (!shape) throw new Error(`no body ${id}`);
  const index = kernel.describe(shape).edges.findIndex((e) => test([...e.midpoint]));
  const ref = index < 0 ? undefined : engine.reference(id, 'edge', index);
  if (!ref) throw new Error(`no such edge on ${id}`);
  return ref;
}

const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;

const X_AXIS: GeomRef = { kind: 'axis', id: 'origin:x' };
const Z_AXIS: GeomRef = { kind: 'axis', id: 'origin:z' };

// ------------------------------------------------------------------ scalars

describe('live scalars', () => {
  const width = param('width', '40 mm', 'length', { min: '10 mm', max: '100 mm', step: '1 mm' });

  it('writes a Customizer parameter and a hidden one, and follows an override', async () => {
    const doc = docOf(
      [box('B', { length: 'width', height: 'wall * 5' })],
      [width, param('wall', 'width / 10')],
    );
    const text = await expectLive(
      doc,
      { name: 'width', value: 60 },
      setParam(doc, 'width', '60 mm'),
    );
    expect(text).toContain('width = 40; // [10:1:100]\n\n/* [Hidden] */\nwall = width / 10;\n');
    expect(text).toContain('cube(size = [width, 20, abs(wall * 5)], center = true)');
    expect(text).toContain('translate([0, 0, (wall * 5) / 2])');
  });

  it('brackets an expression it halves: a cylinder of diameter width + 2', async () => {
    const doc = docOf(
      [
        box('B', { length: 'width * 2', width: '60 mm' }),
        primitive('H', 'cylinder', {
          numbers: { diameter: 'width + 2 mm', height: '30 mm', offset: '-10 mm' },
          operation: 'cut',
        }),
      ],
      [width],
    );
    const text = await expectLive(
      doc,
      { name: 'width', value: 50 },
      setParam(doc, 'width', '50 mm'),
    );
    expect(text).toContain('r1 = (width + 2) / 2, r2 = (width + 2) / 2');
  });

  it('writes a bare number in the document unit as mm', async () => {
    // In cm, `height = 2` is 20 mm: the file says so in mm.
    const doc = docOf([box('B', { height: 'height' })], [param('height', '2')], 'cm');
    const text = await expectLive(doc, { name: 'height', value: 30 }, setParam(doc, 'height', '3'));
    expect(text).toContain('height = 20;');
    expect(text).toContain('abs(height)');
  });

  it('writes a named model input as its variable', async () => {
    const make = (length: string) => {
      const b = box('B', { length });
      const input = b.inputs.length;
      if (input?.kind !== 'expr') throw new Error('no length');
      b.inputs.length = { ...input, paramName: 'boxLen' };
      return docOf([b]);
    };
    const text = await expectLive(make('40 mm'), { name: 'boxLen', value: 55 }, make('55 mm'));
    expect(text).toContain('/* [Hidden] */\nboxLen = 40;\n');
    expect(text).toContain('cube(size = [boxLen, 20, 10], center = true)');
  });

  it('moves by a parameter', async () => {
    const move = {
      ...testFeature('Mv', 'move'),
      inputs: moveInputs(['B:0'], { dx: 'width', dz: '5 mm' }),
    };
    const doc = docOf([box('B', {}), move], [width]);
    const text = await expectLive(
      doc,
      { name: 'width', value: 25 },
      setParam(doc, 'width', '25 mm'),
    );
    expect(text).toContain('translate([width, 0, 5])');
  });

  it('rotates by an angle parameter', async () => {
    const move = {
      ...testFeature('Rt', 'move'),
      inputs: moveInputs(['B:0'], { mode: 'rotate', axis: Z_AXIS, angle: 'turn' }),
    };
    const doc = docOf([box('B', { x: '30 mm' }), move], [param('turn', '30 deg', 'angle')]);
    const text = await expectLive(
      doc,
      { name: 'turn', value: 50 },
      setParam(doc, 'turn', '50 deg'),
    );
    expect(text).toContain('rotate(a = turn, v = [0, 0, 1])');
  });

  it('scales by a factor parameter', async () => {
    const scale = {
      ...testFeature('Sc', 'scale'),
      inputs: scaleInputs(['B:0'], { factor: 'k' }),
    };
    const doc = docOf([box('B', { x: '30 mm' }), scale], [param('k', '1.5', 'unitless')]);
    const text = await expectLive(doc, { name: 'k', value: 2 }, setParam(doc, 'k', '2'));
    expect(text).toContain('scale([k, k, k])');
  });

  it('keeps a seated torus on the plane when its sizes change', { timeout: 60_000 }, async () => {
    // One along the normal (lifted by half the tube), one on edge along X
    // (lifted by half the diameter and half the tube).
    const doc = docOf(
      [
        primitive('T', 'torus', {
          numbers: { diameter: '30 mm', tube: 'dia / 5' },
          seat: 'plane',
        }),
        primitive('U', 'torus', {
          numbers: { diameter: 'dia', tube: '6 mm', x: '60 mm' },
          axis: 'x',
          seat: 'plane',
        }),
      ],
      [param('dia', '30 mm')],
    );
    const text = await expectLive(doc, { name: 'dia', value: 40 }, setParam(doc, 'dia', '40 mm'));
    expect(text).toContain('translate([0, 0, (dia / 5) / 2])');
    expect(text).toContain('dia / 2 + 3');
  });
});

// ------------------------------------------------------------------ fixed

describe('parameters the file holds fixed', () => {
  it('names the pattern and the fillet a live parameter also sets', async () => {
    // B uses `n` and `r` live; A is filleted by `r` (a polyhedron) and
    // patterned `n` times, `gap` apart (placements are numbers).
    const features = (fillet?: Feature): Feature[] => [
      box('B', { width: 'r * 10', height: 'n * 5 mm', y: '-40 mm' }),
      box('A', {}),
      ...(fillet ? [fillet] : []),
    ];
    const parameters = [param('n', '3', 'unitless'), param('r', '2 mm'), param('gap', '60 mm')];
    await run(docOf(features(), parameters));
    const edge = edgeOf(body('A'), (m) => near(m[0] as number, 20) && near(m[1] as number, 10));
    const fillet = {
      ...testFeature('Round', 'fillet'),
      inputs: filletInputs([{ edges: [edge], radius: 'r' }]),
    };
    const pattern = {
      ...testFeature('Row', 'rectangularPattern'),
      inputs: rectangularPatternInputs({
        bodies: ['A:0'],
        direction1: X_AXIS,
        count1: 'n',
        distance1: 'gap',
      }),
    };
    const doc = docOf([...features(fillet), pattern], parameters);
    const ids = bodiesOf(await run(doc));
    const text = exportScad(ids);
    expect(count(text, 'polyhedron(')).toBe(1);
    expect(text).toContain(
      '/* [Hidden] */\n// Also sets Row, which this file holds fixed.\nn = 3;\n' +
        '// Also sets Round, which this file holds fixed.\nr = 2;\n',
    );
    // Only fixed things use `gap`: it isn't written.
    expect(text).not.toContain('gap');
    expectSame(await render(compiler, text), measured(kernel, engine, ids));
  });

  it("names a sketch's driving dimension and the plane it is on", async () => {
    // The extrude's distance is live; the sketch (a dimension of `size`) and
    // its offset plane (by `lift`) are fixed, and say so.
    const b = new SketchBuilder();
    const bottom = b.line(0, 0, 30, 0);
    b.line(30, 0, 30, 20);
    b.line(30, 20, 0, 20);
    b.line(0, 20, 0, 0);
    const d = b.dimension({ type: 'distance', orientation: 'aligned', a: bottom.id }, 30);
    const data = b.sketch;
    data.dimensions[d as DimensionId] = {
      ...(data.dimensions[d as DimensionId] as SketchDimension),
      expr: 'size',
    };
    const plane = {
      ...testFeature('P', 'offsetPlane'),
      inputs: {
        plane: { kind: 'ref', refs: [originPlaneRef('origin:xy')] },
        distance: { kind: 'expr', expr: 'lift', unit: 'length' },
      },
    } as Feature;
    const found = detectProfiles(data)[0];
    if (!found) throw new Error('no profile');
    const extrude = {
      ...testFeature('E', 'extrude'),
      inputs: extrudeInputs([{ kind: 'profile', id: `S/${found.id}` }], {
        distance: 'size / 3 + lift',
      }),
    };
    const sketch = {
      ...testFeature('S', 'sketch'),
      inputs: sketchInputs({ kind: 'plane', id: 'P' }, data),
    };
    const doc = docOf([plane, sketch, extrude], [param('size', '30 mm'), param('lift', '5 mm')]);
    const ids = bodiesOf(await run(doc));
    const text = exportScad(ids);
    expect(text).toContain(
      '/* [Hidden] */\n// Also sets S, which this file holds fixed.\nsize = 30;\n' +
        '// Also sets P, which this file holds fixed.\nlift = 5;\n',
    );
    expect(text).toContain('linear_extrude(height = abs((size / 3) + lift), center = true)');
    expectSame(await render(compiler, text), measured(kernel, engine, ids));
  });
});

// ------------------------------------------------------------------ fallbacks

describe('fallbacks', () => {
  it('writes the value of an input whose expression does not translate', () => {
    // Every expression core evaluates translates today; one whose name the
    // context lacks stands in for one that wouldn't.
    const doc = docOf([], [param('b', '5 mm')]);
    const evaluation = evaluateParameters(doc);
    const names = scadNames(evaluation);
    names.delete('b');
    const scalar = liveScalar({ doc, expr: { evaluation, lengthUnit: 'mm', names } });
    const at = { feature: 'X' as Feature['id'], input: 'length' };
    expect(scalar({ value: 10, expr: 'b * 2', unit: 'length' }, at)).toBe(10);
    // A constant is its value too, in the document's unit.
    expect(scalar({ value: 15, expr: '10 mm + 5', unit: 'length' }, at)).toBe(15);
  });
});

// ------------------------------------------------------------------ determinism

describe('determinism', () => {
  it('writes the same bytes for the same document twice', async () => {
    const doc = docOf(
      [box('B', { length: 'width', height: 'wall * 5' })],
      [
        param('width', '40 mm', 'length', { min: '10 mm', max: '100 mm', step: '1 mm' }),
        param('wall', 'width / 10'),
      ],
    );
    const ids = bodiesOf(await run(doc));
    const first = exportScad(ids);
    engine.clear();
    engine = new RecomputeEngine(kernel, kernelFeatures(), { strictLeaks: true });
    await run(doc);
    expect(exportScad(ids)).toBe(first);
  });
});
