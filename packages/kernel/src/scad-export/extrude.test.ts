// The OpenSCAD export's hooks for Extrude and Revolve (P6-09 slice 4a,
// ADR-0088 §7). Each file is rendered by OpenSCAD's real WASM and every
// exported body measured against the kernel's: volume and box within the
// mesh's tolerance, and no polyhedron where the hooks translate everything.
// A profile's arcs facet with `ctx.fragments`; a full-circle loop is a
// `circle`. Real OCCT, `strictLeaks`.
import {
  type BodyId,
  type CombineOperation,
  circularPatternInputs,
  combineInputs,
  type ExtrudeInputOptions,
  type ExtrudoDocument,
  extrudeInputs,
  type Feature,
  type GeomRef,
  originAxisRef,
  originPlaneRef,
  type PrimitiveInputOptions,
  type PrimitiveType,
  primitiveInputs,
  type RevolveInputOptions,
  revolveInputs,
  type SketchData,
  type SketchEntity,
  type SketchEntityId,
  sketchInputs,
} from '@extrudo/core';
import { DEFAULT_FONT } from '@extrudo/fonts';
import type { ScadCompiler } from '@extrudo/openscad';
import { SketchBuilder } from '@extrudo/sketch/fixtures';
import { detectProfiles, type Profile, profileCentroid } from '@extrudo/sketch/profiles';
import { loadFont } from '@extrudo/sketch/text';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import interRegular from '../../../fonts/fonts/inter-regular.ttf?url&inline';
import { kernelFeatures } from '../features';
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
  loadFont(DEFAULT_FONT, bytesOf(interRegular));
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

/** The bytes of a `data:` URL (Vite's `?url&inline` import of the font). */
function bytesOf(dataUrl: string): Uint8Array {
  const binary = atob(dataUrl.slice(dataUrl.indexOf(',') + 1));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

const TESSELLATION = RESOLUTIONS.fine;

const body = (feature: string, n = 0) => `${feature}:${n}` as BodyId;
const nameOf = (id: BodyId) => id.replace(/[^A-Za-z0-9]/g, '_');

const Y_AXIS = originAxisRef('origin:y');

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

/** A profile reference of `data`: the largest, or the one `pick` chooses. */
function profile(
  sketchId: string,
  data: SketchData,
  pick: (profiles: Profile[]) => Profile | undefined = (p) => p[0],
): GeomRef {
  const found = pick(detectProfiles(data).sort((a, b) => b.area - a.area));
  if (!found) throw new Error('no profile');
  return { kind: 'profile', id: `${sketchId}/${found.id}` };
}

const leftOf = (data: SketchData) =>
  profile('S', data, (p) => p.find((x) => (profileCentroid(x)[0] as number) < 20));
const rightOf = (data: SketchData) =>
  profile('S', data, (p) => p.find((x) => (profileCentroid(x)[0] as number) > 20));

const lineRef = (sketchId: string, entity: string): GeomRef => ({
  kind: 'sketchEntity',
  id: `${sketchId}/${entity}`,
});
const textRef = (sketchId: string, textId: SketchEntityId): GeomRef => ({
  kind: 'sketchEntity',
  id: `${sketchId}/${textId}`,
});

function extrude(id: string, profiles: GeomRef[], options: ExtrudeInputOptions): Feature {
  return { ...testFeature(id, 'extrude'), inputs: extrudeInputs(profiles, options) };
}

function revolve(
  id: string,
  profiles: GeomRef[],
  axis: GeomRef | undefined,
  options: RevolveInputOptions = {},
): Feature {
  return { ...testFeature(id, 'revolve'), inputs: revolveInputs(profiles, axis, options) };
}

function primitive(id: string, type: PrimitiveType, options: PrimitiveInputOptions = {}): Feature {
  return { ...testFeature(id, type), inputs: primitiveInputs(type, options) };
}

const box = (id: string, x = '0 mm', more: PrimitiveInputOptions = {}) =>
  primitive(id, 'box', {
    ...more,
    numbers: { length: '40 mm', width: '20 mm', height: '10 mm', x, ...more.numbers },
  });

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

function exportScad(ids: readonly BodyId[]): string {
  return engine.exportScad({
    bodies: ids.map((id) => ({ id, name: nameOf(id) })),
    tessellation: TESSELLATION,
    project: 'Test',
    version: '0.0.0-test',
  });
}

/** Every body exported on its own matches the kernel's, and none is a polyhedron (unless `meshes`). */
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

/** A 40 × 20 rectangle on an origin plane (or a face), for later features. */
function scene(plane: Plane | GeomRef = 'origin:xy') {
  const b = new SketchBuilder();
  rect(b, 0, 0, 40, 20);
  return { data: b.sketch, feature: sketch('S', b.sketch, plane) };
}

// ------------------------------------------------------------------ extrude

describe('extrude', () => {
  it('extrudes a rectangle with a circular hole as a new body', async () => {
    const b = new SketchBuilder();
    rect(b, 0, 0, 40, 20);
    b.circle(20, 10, 5);
    const data = b.sketch;
    const result = await run(
      testDocument([sketch('S', data), extrude('E', [profile('S', data)], { distance: '10 mm' })]),
    );
    expect(bodiesOf(result)).toEqual([body('E')]);
    await expectExact(bodiesOf(result));
  });

  it('extrudes on a non-XY origin plane and on a face of a body', async () => {
    const onXz = scene('origin:xz');
    const result = await run(
      testDocument([
        box('B'),
        onXz.feature,
        extrude('E', [profile('S', onXz.data)], { distance: '8 mm' }),
      ]),
    );
    expect(bodiesOf(result)).toEqual([body('B'), body('E')]);
    await expectExact(bodiesOf(result));

    // A sketch on B's +X end face (x 20).
    await run(testDocument([box('B')]));
    const shape = engine.latestBody(body('B'));
    if (!shape) throw new Error('no body');
    const described = kernel.describe(shape);
    const index = described.faces.findIndex((f) => Math.abs((f.centroid[0] as number) - 20) < 1e-6);
    const face = engine.reference(body('B'), 'face', index);
    if (!face) throw new Error('no face');
    const onFace = scene(face);
    const onFaceRun = await run(
      testDocument([
        box('B'),
        onFace.feature,
        extrude('E2', [profile('S', onFace.data)], { distance: '6 mm' }),
      ]),
    );
    expect(bodiesOf(onFaceRun)).toEqual([body('B'), body('E2')]);
    await expectExact(bodiesOf(onFaceRun));
  });

  it('flips one side, and measures a symmetric sweep whole and half', async () => {
    const s = scene();
    const cases: [ExtrudeInputOptions, number, number][] = [
      [{ distance: '10 mm', flip: true }, -10, 0],
      [{ distance: '20 mm', direction: 'symmetric' }, -10, 10],
      [{ distance: '20 mm', direction: 'symmetric', symmetricMeasure: 'half' }, -20, 20],
    ];
    for (const [options, zMin, zMax] of cases) {
      const result = await run(
        testDocument([s.feature, extrude('E', [profile('S', s.data)], options)]),
      );
      const ids = bodiesOf(result);
      const m = measured(kernel, engine, ids);
      expect(Math.abs((m.min[2] as number) - zMin)).toBeLessThan(0.01);
      expect(Math.abs((m.max[2] as number) - zMax)).toBeLessThan(0.01);
      await expectExact(ids);
    }
  });

  it('sweeps two sides with different distances', async () => {
    const s = scene();
    const result = await run(
      testDocument([
        s.feature,
        extrude('E', [profile('S', s.data)], {
          direction: 'two-sides',
          distance: '10 mm',
          distance2: '6 mm',
        }),
      ]),
    );
    const ids = bodiesOf(result);
    const m = measured(kernel, engine, ids);
    expect(Math.abs((m.min[2] as number) + 6)).toBeLessThan(0.01);
    expect(Math.abs((m.max[2] as number) - 10)).toBeLessThan(0.01);
    await expectExact(ids);
  });

  it('joins, cuts and intersects into a box', async () => {
    const b = new SketchBuilder();
    rect(b, 10, -10, 20, 40);
    const data = b.sketch;
    for (const operation of ['join', 'cut', 'intersect'] as const) {
      const result = await run(
        testDocument([
          box('B'),
          sketch('S', data),
          extrude('E', [profile('S', data)], { distance: '30 mm', offset: '-5 mm', operation }),
        ]),
      );
      await expectExact(bodiesOf(result));
    }
  });

  it('cuts through everything, and cuts two boxes with one shared tool', async () => {
    const b = new SketchBuilder();
    b.circle(0, 0, 4);
    const data = b.sketch;
    const through = await run(
      testDocument([
        box('B'),
        sketch('S', data),
        extrude('E', [profile('S', data)], {
          distance: '30 mm',
          extent: 'through-all',
          operation: 'cut',
        }),
      ]),
    );
    await expectExact(bodiesOf(through));

    // Two blind holes, one per box: both bodies change, the tool is written
    // once, as a module.
    const slot = new SketchBuilder();
    slot.circle(0, 0, 4);
    slot.circle(50, 0, 4);
    const slotData = slot.sketch;
    const two = await run(
      testDocument([
        box('B'),
        box('C', '50 mm'),
        sketch('Sd', slotData),
        extrude('X', [profile('Sd', slotData, (p) => p[0]), profile('Sd', slotData, (p) => p[1])], {
          distance: '5 mm',
          operation: 'cut',
        }),
      ]),
    );
    const text = await expectExact(bodiesOf(two));
    expect(count(text, 'module X_tool()')).toBe(1);
    expect(count(text, 'X_tool();')).toBe(2);
  });

  it('cuts symmetrically through everything from a mid-plane', async () => {
    const b = new SketchBuilder();
    b.circle(0, 0, 4);
    const data = b.sketch;
    const result = await run(
      testDocument([
        box('B', '0 mm', { numbers: { offset: '-5 mm' } }),
        sketch('S', data),
        extrude('E', [profile('S', data)], {
          direction: 'symmetric',
          extent: 'through-all',
          operation: 'cut',
        }),
      ]),
    );
    expect(bodiesOf(result)).toEqual([body('B')]);
    const text = await expectExact(bodiesOf(result));
    expect(text).not.toContain('Enter a distance');
  });

  it('samples arc profiles (a slot) and splines, and extrudes a text', async () => {
    const slot = new SketchBuilder();
    slot.arc(10, 0, 5, 90, 270);
    slot.line(10, -5, 30, -5);
    slot.arc(30, 0, 5, -90, 90);
    slot.line(30, 5, 10, 5);
    const slotData = slot.sketch;
    const slotRun = await run(
      testDocument([
        sketch('S', slotData),
        extrude('E', [profile('S', slotData)], { distance: '5 mm' }),
      ]),
    );
    await expectExact(bodiesOf(slotRun));

    const d = new SketchBuilder();
    d.line(0, 0, 0, 10);
    d.spline(
      [
        [0, 10],
        [10, 5],
        [0, 0],
      ],
      { mode: 'fit' },
    );
    const dData = d.sketch;
    const dRun = await run(
      testDocument([sketch('S', dData), extrude('E', [profile('S', dData)], { distance: '4 mm' })]),
    );
    await expectExact(bodiesOf(dRun));

    const t = new SketchBuilder();
    const text = addText(t, [0, 0], [0, 10], 'O');
    const tData = t.sketch;
    const tRun = await run(
      testDocument([sketch('S', tData), extrude('E', [textRef('S', text)], { distance: '3 mm' })]),
    );
    await expectExact(bodiesOf(tRun));
  });

  it('meshes a profile that gives two solids, and a taper', async () => {
    const b = new SketchBuilder();
    rect(b, 0, 0, 10, 10);
    rect(b, 30, 0, 10, 10);
    const data = b.sketch;
    const both = await run(
      testDocument([
        sketch('S', data),
        extrude('E', [leftOf(data), rightOf(data)], { distance: '5 mm' }),
      ]),
    );
    const text = await expectExact(bodiesOf(both), 2);
    expect(text).toContain('a solid that falls apart into several bodies');

    const taper = new SketchBuilder();
    rect(taper, 0, 0, 20, 20);
    const tData = taper.sketch;
    const tRun = await run(
      testDocument([
        sketch('S2', tData),
        extrude('E2', [profile('S2', tData)], { distance: '10 mm', taper: '10 deg' }),
      ]),
    );
    const tText = await expectExact(bodiesOf(tRun), 1);
    expect(tText).toContain('a taper');
  });
});

// ------------------------------------------------------------------ revolve

describe('revolve', () => {
  /** A 3 × 4 rectangle from x = 5 on XY: a ring of radii 5 and 8 when turned about Y. */
  const ring = () => {
    const b = new SketchBuilder();
    rect(b, 5, 0, 3, 4);
    return { data: b.sketch, feature: sketch('S', b.sketch) };
  };

  it('turns a rectangle offset from the axis a whole turn', async () => {
    const p = ring();
    const result = await run(
      testDocument([p.feature, revolve('V', [profile('S', p.data)], Y_AXIS)]),
    );
    const ids = bodiesOf(result);
    expect(measured(kernel, engine, ids).volume).toBeCloseTo(Math.PI * (64 - 25) * 4, 1);
    await expectExact(ids);
  });

  it('turns 90° each way, symmetric (whole and half) and two sides', async () => {
    const p = ring();
    const cases: [RevolveInputOptions, number, number][] = [
      [{ angle: '90 deg' }, -8, 0],
      [{ angle: '90 deg', flip: true }, 0, 8],
      [{ angle: '90 deg', direction: 'symmetric' }, -5.66, 5.66],
      [{ angle: '90 deg', direction: 'symmetric', symmetricMeasure: 'half' }, -8, 8],
      [{ angle: '90 deg', direction: 'two-sides', angle2: '30 deg' }, -8, 4],
    ];
    for (const [options, zMin, zMax] of cases) {
      const result = await run(
        testDocument([p.feature, revolve('V', [profile('S', p.data)], Y_AXIS, options)]),
      );
      const ids = bodiesOf(result);
      const m = measured(kernel, engine, ids);
      await expectExact(ids);
      expect(Math.abs((m.min[2] as number) - zMin), JSON.stringify(options)).toBeLessThan(0.05);
      expect(Math.abs((m.max[2] as number) - zMax), JSON.stringify(options)).toBeLessThan(0.05);
    }
  });

  it('joins into a box and cuts from one', async () => {
    const b = new SketchBuilder();
    rect(b, 20, 0, 4, 4);
    const data = b.sketch;
    const join = await run(
      testDocument([
        box('B'),
        sketch('S', data),
        revolve('V', [profile('S', data)], Y_AXIS, { operation: 'join' }),
      ]),
    );
    await expectExact(bodiesOf(join));

    const cut = await run(
      testDocument([
        box('B'),
        sketch('S2', data),
        revolve('V2', [profile('S2', data)], Y_AXIS, { operation: 'cut' }),
      ]),
    );
    await expectExact(bodiesOf(cut));
  });

  it('revolves about a sketch line and about a profile touching the axis', async () => {
    // A construction line at x = 2: the rectangle from x = 5 is 3 to 6 from it.
    const b = new SketchBuilder();
    rect(b, 5, 0, 3, 4);
    const axis = b.line(2, 0, 2, 10, true).id;
    const data = b.sketch;
    const onLine = await run(
      testDocument([
        sketch('S', data),
        revolve('V', [profile('S', data)], lineRef('S', axis), { angle: '120 deg' }),
      ]),
    );
    await expectExact(bodiesOf(onLine));

    // A cone: a triangle with one edge on the Y axis.
    const c = new SketchBuilder();
    c.line(0, 0, 5, 0);
    c.line(5, 0, 0, 6);
    c.line(0, 6, 0, 0);
    const coneData = c.sketch;
    const cone = await run(
      testDocument([sketch('Sc', coneData), revolve('V', [profile('Sc', coneData)], Y_AXIS)]),
    );
    const ids = bodiesOf(cone);
    expect(measured(kernel, engine, ids).volume).toBeCloseTo((Math.PI * 25 * 6) / 3, 1);
    await expectExact(ids);
  });
});

// ------------------------------------------------------------------ the ADR's case

describe("the ADR's case", () => {
  it('cuts a pattern of cylinders from an extruded box without a polyhedron', async () => {
    const b = new SketchBuilder();
    rect(b, 0, 0, 40, 20);
    const data = b.sketch;
    // Holes about the Z axis that overlap, so the joined pattern is one body.
    const holes = () => [
      rod('C', '3 mm'),
      {
        ...testFeature('Cp', 'circularPattern'),
        inputs: circularPatternInputs({
          bodies: ['C:0'],
          axis: originAxisRef('origin:z'),
          count: '4',
          join: true,
        }),
      },
      combine('Cut', 'A', ['C'], 'cut'),
    ];
    const result = await run(
      testDocument([
        sketch('S', data),
        extrude('A', [profile('S', data)], { distance: '10 mm' }),
        ...holes(),
      ]),
    );
    expect(bodiesOf(result)).toEqual([body('A')]);
    const text = await expectExact([body('A')]);
    expect(text).toMatch(
      /module A_0_v2\(\) \{\n {2}difference\(\) \{\n {4}A_0_v1\(\);\n {4}C_body_v2\(\);/,
    );
  });
});

// ------------------------------------------------------------------ text helper

/** A text entity with its two points, as the Text tool would make them. */
function addText(
  b: SketchBuilder,
  anchor: [number, number],
  top: [number, number],
  text: string,
): SketchEntityId {
  const a = b.point(...anchor);
  const t = b.point(...top);
  const id = b.id('t');
  const entity: SketchEntity = {
    type: 'text',
    anchor: a as SketchEntityId,
    top: t as SketchEntityId,
    text,
    font: DEFAULT_FONT,
    align: 'left',
    construction: false,
  };
  b.entities[id] = entity;
  return id as SketchEntityId;
}
