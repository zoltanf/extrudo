// The OpenSCAD export's roadmap acceptance tests (P6-09, ADR-0088 §11): one
// `it` per AC bullet, each rendering the real file with OpenSCAD's WASM
// compiler and comparing every exported body's volume and box with the
// kernel's, at the Fine resolution. Real OCCT, `strictLeaks`.
import {
  type BodyId,
  type CombineOperation,
  circularPatternInputs,
  combineInputs,
  type ExtrudoDocument,
  extrudeInputs,
  type Feature,
  filletInputs,
  type GeomRef,
  type LengthUnit,
  originAxisRef,
  originPlaneRef,
  type Parameter,
  type ParameterId,
  type PrimitiveInputOptions,
  type PrimitiveType,
  primitiveInputs,
  type SketchData,
  sketchInputs,
  type UnitKind,
} from '@extrudo/core';
import type { ScadCompiler, ScadDefine } from '@extrudo/openscad';
import { SketchBuilder } from '@extrudo/sketch/fixtures';
import { detectProfiles, type Profile } from '@extrudo/sketch/profiles';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { kernelFeatures } from '../features';
import type { SubShapeKind } from '../history';
import { Kernel } from '../kernel';
import { RESOLUTIONS } from '../model-export';
import { loadOcct } from '../occt/load';
import { RecomputeEngine } from '../recompute/engine';
import { testDocument, testFeature } from '../recompute/testing';
import type { RecomputeResult } from '../recompute/types';
import { count, expectSame, measured, nodeCompiler, render } from './testing';

type Done = Extract<RecomputeResult, { status: 'done' }>;
type Plane = 'origin:xy' | 'origin:xz' | 'origin:yz';

let kernel: Kernel;
let compiler: ScadCompiler;
let engine: RecomputeEngine;

beforeAll(async () => {
  kernel = new Kernel(await loadOcct());
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

const TESSELLATION = RESOLUTIONS.fine;

const body = (feature: string, n = 0) => `${feature}:${n}` as BodyId;
const nameOf = (id: BodyId) => id.replace(/[^A-Za-z0-9]/g, '_');
const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;

function rect(b: SketchBuilder, x: number, y: number, w: number, h: number): string[] {
  return [
    b.line(x, y, x + w, y).id,
    b.line(x + w, y, x + w, y + h).id,
    b.line(x + w, y + h, x, y + h).id,
    b.line(x, y + h, x, y).id,
  ];
}

function sketch(id: string, data: SketchData, plane: Plane | GeomRef = 'origin:xy'): Feature {
  const ref = typeof plane === 'string' ? originPlaneRef(plane) : plane;
  return { ...testFeature(id, 'sketch'), inputs: sketchInputs(ref, data) };
}

/** A profile reference of `data`, the largest by default. */
function profile(
  sketchId: string,
  data: SketchData,
  pick: (profiles: Profile[]) => Profile | undefined = (p) => p[0],
): GeomRef {
  const found = pick(detectProfiles(data).sort((a, b) => b.area - a.area));
  if (!found) throw new Error('no profile');
  return { kind: 'profile', id: `${sketchId}/${found.id}` };
}

function primitive(id: string, type: PrimitiveType, options: PrimitiveInputOptions = {}): Feature {
  return { ...testFeature(id, type), inputs: primitiveInputs(type, options) };
}

/** A cylinder ⌀ 8 through a 15 mm box (z −12…28), offset `x` from the axis. */
const rod = (id: string, x = '0 mm', more: PrimitiveInputOptions = {}) =>
  primitive(id, 'cylinder', {
    ...more,
    numbers: { diameter: '8 mm', height: '40 mm', offset: '-12 mm', x, ...more.numbers },
  });

const combine = (id: string, target: string, tools: string[], operation: CombineOperation) => ({
  ...testFeature(id, 'combine'),
  inputs: combineInputs(
    `${target}:0`,
    tools.map((t) => `${t}:0`),
    { operation },
  ),
});

/** A user parameter; `customizer` exposes it. */
function param(
  name: string,
  expression: string,
  unit: UnitKind = 'length',
  customizer?: Parameter['customizer'],
  group?: string,
): Parameter {
  return {
    id: `p-${name}` as ParameterId,
    name,
    expression,
    unit,
    ...(customizer && { customizer }),
    ...(group && { group }),
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

function exportScad(ids: readonly BodyId[]): string {
  return engine.exportScad({
    bodies: ids.map((id) => ({ id, name: nameOf(id) })),
    tessellation: TESSELLATION,
    project: 'Test',
    version: '0.0.0-test',
  });
}

/** Every body exported on its own matches the kernel's; the file of all of them. */
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

const bodiesOf = (result: Done) => result.bodies.map((b) => b.id);

/** A face of a body whose centroid `test` accepts. */
function faceOf(id: BodyId, test: (c: number[]) => boolean): GeomRef {
  const shape = engine.latestBody(id);
  if (!shape) throw new Error(`no body ${id}`);
  const index = kernel.describe(shape).faces.findIndex((f) => test([...f.centroid]));
  const ref = index < 0 ? undefined : engine.reference(id, 'face', index);
  if (!ref) throw new Error(`no such face on ${id}`);
  return ref;
}

/** Every edge of a body whose midpoint `test` accepts. */
function edgesOf(id: BodyId, test: (m: number[]) => boolean): GeomRef[] {
  const shape = engine.latestBody(id);
  if (!shape) throw new Error(`no body ${id}`);
  const described = kernel.describe(shape);
  const refs: GeomRef[] = [];
  described.edges.forEach((e, index) => {
    if (!test([...e.midpoint])) return;
    const ref = engine.reference(id, 'edge' as SubShapeKind, index);
    if (ref) refs.push(ref);
  });
  if (refs.length === 0) throw new Error(`no such edges on ${id}`);
  return refs;
}

// ------------------------------------------------------------------ the part

/**
 * The AC's part: a 60 × 40 × 15 box (a sketch rectangle extruded), a pocket
 * cut into its top by a sketch on its top face and a circular pattern of six
 * holes cut from it. With `withFillet`, the box's four outer vertical edges
 * are filleted before the pocket and the holes.
 */
async function buildPart(withFillet: boolean): Promise<Feature[]> {
  const boxSketch = new SketchBuilder();
  rect(boxSketch, -30, -20, 60, 40);
  const boxData = boxSketch.sketch;
  const box = extrude('A', [profile('S', boxData)], { distance: '15 mm' });

  const features: Feature[] = [sketch('S', boxData), box];
  if (withFillet) {
    await run(testDocument(features));
    const edges = edgesOf(
      body('A'),
      (m) => near(Math.abs(m[0] as number), 30) && near(Math.abs(m[1] as number), 20),
    );
    features.push({
      ...testFeature('Fl', 'fillet'),
      inputs: filletInputs([{ edges, radius: '3 mm' }]),
    });
  }

  await run(testDocument(features));
  const top = faceOf(body('A'), (c) => near(c[2] as number, 15));

  const pocketSketch = new SketchBuilder();
  rect(pocketSketch, -10, -5, 20, 10);
  const pocketData = pocketSketch.sketch;
  const pocket = extrude('Pkt', [profile('P', pocketData)], {
    distance: '6 mm',
    flip: true,
    operation: 'cut',
  });

  const holes: Feature[] = [
    rod('C', '3 mm'),
    {
      ...testFeature('Cp', 'circularPattern'),
      inputs: circularPatternInputs({
        bodies: ['C:0'],
        axis: originAxisRef('origin:z'),
        count: '6',
        join: true,
      }),
    },
    combine('Cut', 'A', ['C'], 'cut'),
  ];

  return [...features, sketch('P', pocketData, top), pocket, ...holes];
}

// ------------------------------------------------------------------ AC 1–2

describe('the roadmap AC', () => {
  it('AC 1: a box, an extruded pocket and a circular pattern of holes have no polyhedron', async () => {
    const result = await run(testDocument(await buildPart(false)));
    const ids = bodiesOf(result);
    expect(ids).toEqual([body('A')]);
    const text = await expectExact(ids);
    expect(text).not.toContain('polyhedron(');
  });

  it('AC 2: a fillet before the pocket and holes is one polyhedron with differences built on it', async () => {
    const result = await run(testDocument(await buildPart(true)));
    const ids = bodiesOf(result);
    expect(ids).toEqual([body('A')]);
    const text = await expectExact(ids, 1);
    expect(count(text, 'polyhedron(')).toBe(1);
    expect(count(text, 'difference()')).toBeGreaterThanOrEqual(2);
  });
});

// ------------------------------------------------------------------ AC 3–4

describe('the roadmap AC (parameters)', () => {
  /** A 60 × 40 box whose extrude distance is the Customizer parameter `height`. */
  function heightDoc(): ExtrudoDocument {
    const b = new SketchBuilder();
    rect(b, -30, -20, 60, 40);
    const data = b.sketch;
    return docOf(
      [sketch('S', data), extrude('A', [profile('S', data)], { distance: 'height' })],
      [param('height', '20 mm', 'length', { min: '5 mm', max: '50 mm', step: '1 mm' }, 'Size')],
    );
  }

  it('AC 3: a Customizer parameter drives the extrude distance', async () => {
    const doc = heightDoc();
    const ids = bodiesOf(await run(doc));
    const text = exportScad(ids);
    expect(text).toContain('/* [Size] */');
    expect(text).toContain('height = 20; // [5:1:50]');
    expectSame(await render(compiler, text), measured(kernel, engine, ids));

    const at35 = bodiesOf(await run(setParam(doc, 'height', '35 mm')));
    const define: ScadDefine = { name: 'height', value: 35 };
    expectSame(await render(compiler, text, [define]), measured(kernel, engine, at35));
  });

  it('AC 4: exporting the same document twice gives the same bytes', async () => {
    const features = await buildPart(false);
    const result = await run(testDocument(features));
    const ids = bodiesOf(result);
    const first = exportScad(ids);
    engine.clear();
    engine = new RecomputeEngine(kernel, kernelFeatures(), { strictLeaks: true });
    await run(testDocument(features));
    expect(exportScad(ids)).toBe(first);
  });
});

// ------------------------------------------------------------------ text helper

function extrude(
  id: string,
  profiles: GeomRef[],
  options: Parameters<typeof extrudeInputs>[1],
): Feature {
  return { ...testFeature(id, 'extrude'), inputs: extrudeInputs(profiles, options) };
}
