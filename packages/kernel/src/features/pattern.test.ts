// Patterns and mirrored features (P3-07, ADR-0047, FR-FT-11) through the
// recompute engine with real OCCT: rectangular, circular and path patterns of
// bodies (copies, joined) and of features (a hole cut, a boss joined), the
// names of the instances and how they stay when counts grow, Mirror's
// `features` mode, the errors, a 10 × 10 pattern's time, and a leak check.
// `golden/pattern-options.json` is a golden table of layouts (a Vitest file
// snapshot); rewrite it with
// `pnpm vitest run -u packages/kernel/src/features/pattern` and review the diff.
import {
  type CircularOptions,
  circularPatternInputs,
  extrudeInputs,
  type Feature,
  type FeatureId,
  FeatureRegistry,
  type FeatureStatus,
  type GeomRef,
  mirrorInputs,
  originAxisRef,
  originPlaneRef,
  type PathOptions,
  type PatternReport,
  type PrimitiveInputOptions,
  pairSlots,
  pathPatternInputs,
  primitiveInputs,
  type RectangularOptions,
  rectangularPatternInputs,
  type SketchData,
  sketchInputs,
  slotOf,
} from '@extrudo/core';
import { SketchBuilder } from '@extrudo/sketch/fixtures';
import { detectProfiles } from '@extrudo/sketch/profiles';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { SubShapeKind } from '../history';
import { Kernel, type ShapeHandle, type Vec3 } from '../kernel';
import { loadOcct } from '../occt/load';
import { RecomputeEngine } from '../recompute/engine';
import { testDocument, testFeature, testFeatures } from '../recompute/testing';
import type { FeatureOutput, KernelFeatureDefinition, RecomputeResult } from '../recompute/types';

let kernel: Kernel;
let engine: RecomputeEngine;

beforeAll(async () => {
  kernel = new Kernel(await loadOcct());
});

/** The output of each feature's latest evaluation, for the ghosts and reports. */
const seen = new Map<string, FeatureOutput>();

/** A definition that remembers what it evaluated (the `extrude` test's `seen`). */
const watched = (definition: KernelFeatureDefinition): KernelFeatureDefinition => ({
  ...definition,
  evaluate(ctx) {
    const output = definition.evaluate(ctx);
    seen.set(ctx.feature.name, output);
    return output;
  },
});

beforeEach(() => {
  engine?.clear();
  seen.clear();
  expect(kernel.stats().liveShapes).toBe(0);
  const registry = new FeatureRegistry<KernelFeatureDefinition>();
  for (const definition of testFeatures().registry.list()) registry.register(watched(definition));
  engine = new RecomputeEngine(kernel, registry, { strictLeaks: true });
});

afterAll(() => {
  engine.clear();
  expect(kernel.stats().liveShapes).toBe(0);
});

type Done = Extract<RecomputeResult, { status: 'done' }>;

// ------------------------------------------------------------------ helpers

const XY = originPlaneRef('origin:xy');
const YZ = originPlaneRef('origin:yz');
const AXIS_X = originAxisRef('origin:x');
const AXIS_Y = originAxisRef('origin:y');
const AXIS_Z = originAxisRef('origin:z');

function sketch(id: string, data: SketchData): Feature {
  return { ...testFeature(id, 'sketch'), inputs: sketchInputs(XY, data) };
}

/** A `w` × `d` × `h` block from (x, y, 0) as body `<id>:0`, made by sketch `S<id>` and extrude `<id>`. */
function block(id: string, x: number, y: number, w = 40, d = 30, h = 20): Feature[] {
  const b = new SketchBuilder();
  b.line(x, y, x + w, y);
  b.line(x + w, y, x + w, y + d);
  b.line(x + w, y + d, x, y + d);
  b.line(x, y + d, x, y);
  const [found] = detectProfiles(b.sketch);
  if (!found) throw new Error('no profile');
  const profile: GeomRef = { kind: 'profile', id: `S${id}/${found.id}` };
  return [
    sketch(`S${id}`, b.sketch),
    { ...testFeature(id, 'extrude'), inputs: extrudeInputs([profile], { distance: `${h} mm` }) },
  ];
}

const primitive = (
  id: string,
  type: 'box' | 'cylinder',
  options: PrimitiveInputOptions = {},
): Feature => ({ ...testFeature(id, type), inputs: primitiveInputs(type, options) });

/** A 100 × 100 × 10 plate, body `L:0`. */
const plate = () => block('L', 0, 0, 100, 100, 10);

/** A hole feature: a cylinder cut through the plate at (x, y). */
const hole = (id: string, x: number, y: number, d = 8): Feature =>
  primitive(id, 'cylinder', {
    numbers: { diameter: `${d} mm`, height: '20 mm', x: `${x} mm`, y: `${y} mm` },
    operation: 'cut',
  });

/** A boss feature: a box joined on the plate's top. */
const boss = (id: string, x: number, y: number): Feature =>
  primitive(id, 'box', {
    numbers: {
      length: '6 mm',
      width: '6 mm',
      height: '5 mm',
      x: `${x} mm`,
      y: `${y} mm`,
      offset: '10 mm',
    },
    operation: 'join',
  });

const rect = (id: string, o: RectangularOptions): Feature => ({
  ...testFeature(id, 'rectangularPattern'),
  inputs: rectangularPatternInputs(o),
});
const circ = (id: string, o: CircularOptions): Feature => ({
  ...testFeature(id, 'circularPattern'),
  inputs: circularPatternInputs(o),
});
const along = (id: string, o: PathOptions): Feature => ({
  ...testFeature(id, 'pathPattern'),
  inputs: pathPatternInputs(o),
});
const mirror = (id: string, plane: GeomRef, features: string[]): Feature => ({
  ...testFeature(id, 'mirror'),
  inputs: mirrorInputs([], plane, { features }),
});

async function run(features: Feature[]): Promise<Done> {
  const result = await engine.recompute({ doc: testDocument(features) });
  if (result.status !== 'done') throw new Error('cancelled');
  return result;
}

const status = (result: Done, id: string): FeatureStatus =>
  result.features[id as FeatureId] ?? { status: 'ok' };

function ok(result: Done): Done {
  for (const [id, s] of Object.entries(result.features)) {
    if (s.status !== 'ok') throw new Error(`${id}: ${s.status} ${s.message ?? ''}`);
  }
  return result;
}

const round = (x: number, digits = 3) => {
  const r = Number(x.toFixed(digits));
  return Object.is(r, -0) ? 0 : r;
};

/** A point equal to `b`, to `digits`. */
const near3 = (a: readonly number[], b: readonly number[], digits = 6) => {
  for (let k = 0; k < 3; k++) expect(a[k]).toBeCloseTo(b[k] as number, digits);
};

function shapeOf(body: string) {
  const shape = engine.latestBody(body as never);
  if (shape === undefined) throw new Error(`no body ${body}`);
  const props = kernel.properties(shape);
  const r = (v: readonly number[]) => v.map((x) => round(x)) as unknown as Vec3;
  return {
    min: r(props.bbox.min),
    max: r(props.bbox.max),
    volume: round(props.volume),
    faces: kernel.count(shape, 'face'),
    valid: kernel.isValid(shape),
  };
}

const ids = (result: Done) => result.bodies.map((b) => b.id);

function namesOf(result: Done, body: string, kind: SubShapeKind): string[] {
  const mesh = result.bodies.find((b) => b.id === body)?.mesh;
  const list = kind === 'face' ? mesh?.faceIds : kind === 'edge' ? mesh?.edgeIds : mesh?.vertexIds;
  return list ?? [];
}

/** The ID of the copy of body `bodyIndex` at 1-D instance `i` of a pattern (see `pairSlots`). */
const copy = (pattern: string, i: number, bodyIndex = 0) =>
  `${pattern}:${pairSlots(slotOf(i), bodyIndex)}`;

const A = block('A', 0, 0);
const HOLE_VOLUME = Math.PI * 16 * 10;

// -------------------------------------------------------- rectangular, bodies

describe('rectangular pattern of bodies', { timeout: 120_000 }, () => {
  it('copies a body along an axis, the original counting as the first', async () => {
    const result = ok(
      await run([
        ...A,
        rect('P', { bodies: ['A:0'], direction1: AXIS_X, count1: '3', distance1: '60 mm' }),
      ]),
    );
    // Instances 1 and 2 have the slots 3 and 10 (Cantor of zigzag(i), zigzag(0)).
    expect(ids(result)).toEqual(['A:0', copy('P', 1), copy('P', 2)]);
    expect(shapeOf('A:0').min).toEqual([0, 0, 0]);
    expect(shapeOf(copy('P', 1))).toMatchObject({
      min: [60, 0, 0],
      max: [100, 30, 20],
      volume: 24_000,
      valid: true,
    });
    expect(shapeOf(copy('P', 2)).min).toEqual([120, 0, 0]);
  });

  it('reads the distance as an extent, from the first instance to the last', async () => {
    ok(
      await run([
        ...A,
        rect('P', {
          bodies: ['A:0'],
          direction1: AXIS_Y,
          count1: '4',
          distance1: '90 mm',
          measure1: 'extent',
        }),
      ]),
    );
    const ys = [copy('P', 1), copy('P', 2), copy('P', 3)].map((b) => shapeOf(b).min[1]);
    expect(ys).toEqual([30, 60, 90]);
  });

  it('makes a grid with a second direction', async () => {
    const result = ok(
      await run([
        ...A,
        rect('P', {
          bodies: ['A:0'],
          direction1: AXIS_X,
          count1: '3',
          distance1: '50 mm',
          direction2: AXIS_Y,
          count2: '2',
          distance2: '40 mm',
        }),
      ]),
    );
    expect(result.bodies).toHaveLength(6);
    const mins = result.bodies.map((b) => shapeOf(b.id).min.slice(0, 2).join(','));
    expect(mins.sort()).toEqual(['0,0', '0,40', '100,0', '100,40', '50,0', '50,40']);
  });

  it('symmetric keeps the original in the middle', async () => {
    const result = ok(
      await run([
        ...A,
        rect('P', {
          bodies: ['A:0'],
          direction1: AXIS_X,
          count1: '5',
          distance1: '50 mm',
          symmetric1: true,
        }),
      ]),
    );
    const xs = result.bodies.map((b) => shapeOf(b.id).min[0]).sort((a, b) => a - b);
    expect(xs).toEqual([-100, -50, 0, 50, 100]);
  });

  it('copies several bodies, each with the same layout', async () => {
    const b = block('B', 0, 100);
    const result = ok(
      await run([
        ...A,
        ...b,
        rect('P', { bodies: ['A:0', 'B:0'], direction1: AXIS_X, count1: '2', distance1: '60 mm' }),
      ]),
    );
    expect(result.bodies).toHaveLength(4);
    expect(shapeOf(copy('P', 1)).min).toEqual([60, 0, 0]);
    expect(shapeOf(copy('P', 1, 1)).min).toEqual([60, 100, 0]);
  });

  it('names an instance’s faces after the original’s, per instance', async () => {
    const before = ok(await run(A));
    const result = ok(
      await run([
        ...A,
        rect('P', { bodies: ['A:0'], direction1: AXIS_X, count1: '3', distance1: '60 mm' }),
      ]),
    );
    expect(namesOf(result, copy('P', 1), 'face')).toEqual(
      namesOf(before, 'A:0', 'face').map((n) => `pattern:P:1:from:(${n})`),
    );
    expect(namesOf(result, copy('P', 2), 'face')[0]).toMatch(/^pattern:P:2:from:\(/);
  });

  it('adding instances keeps the earlier instances’ IDs, names and shapes', async () => {
    const three = ok(
      await run([
        ...A,
        rect('P', { bodies: ['A:0'], direction1: AXIS_X, count1: '3', distance1: '60 mm' }),
      ]),
    );
    const faces3 = namesOf(three, copy('P', 1), 'face');
    const edges3 = namesOf(three, copy('P', 2), 'edge');
    const five = ok(
      await run([
        ...A,
        rect('P', { bodies: ['A:0'], direction1: AXIS_X, count1: '5', distance1: '60 mm' }),
      ]),
    );
    expect(ids(five)).toEqual(['A:0', copy('P', 1), copy('P', 2), copy('P', 3), copy('P', 4)]);
    expect(namesOf(five, copy('P', 1), 'face')).toEqual(faces3);
    expect(namesOf(five, copy('P', 2), 'edge')).toEqual(edges3);
    expect(shapeOf(copy('P', 2)).min).toEqual([120, 0, 0]);
  });

  it('a fillet on a face of an instance still finds it when the count grows', async () => {
    const two = ok(
      await run([
        ...A,
        rect('P', { bodies: ['A:0'], direction1: AXIS_X, count1: '2', distance1: '60 mm' }),
      ]),
    );
    const edgeName = namesOf(two, copy('P', 1), 'edge')[0] as string;
    const index = namesOf(two, copy('P', 1), 'edge').indexOf(edgeName);
    const ref = engine.reference(copy('P', 1) as never, 'edge', index);
    if (!ref) throw new Error('no reference');
    const fillet = (): Feature => ({
      ...testFeature('F', 'fillet'),
      inputs: {
        edges: { kind: 'ref', refs: [ref] },
        radius: { kind: 'expr', expr: '2 mm', unit: 'length' },
      },
    });
    const withCount = (n: string) => [
      ...A,
      rect('P', { bodies: ['A:0'], direction1: AXIS_X, count1: n, distance1: '60 mm' }),
      fillet(),
    ];
    const first = await run(withCount('2'));
    expect(status(first, 'F').status).toBe('ok');
    const grown = await run(withCount('4'));
    expect(status(grown, 'F')).toEqual({ status: 'ok' });
    expect(shapeOf(copy('P', 1)).volume).toBeLessThan(24_000);
  });

  describe('join', () => {
    it('fuses touching copies into the original, one body', async () => {
      const result = ok(
        await run([
          ...A,
          rect('P', {
            bodies: ['A:0'],
            direction1: AXIS_X,
            count1: '3',
            distance1: '40 mm',
            join: true,
          }),
        ]),
      );
      expect(ids(result)).toEqual(['A:0']);
      expect(shapeOf('A:0')).toMatchObject({
        min: [0, 0, 0],
        max: [120, 30, 20],
        volume: 72_000,
        faces: 6,
        valid: true,
      });
    });

    it('overlapping copies fuse too (a group of interfering instances)', async () => {
      const result = ok(
        await run([
          ...A,
          rect('P', {
            bodies: ['A:0'],
            direction1: AXIS_X,
            count1: '4',
            distance1: '25 mm',
            join: true,
          }),
        ]),
      );
      expect(ids(result)).toEqual(['A:0']);
      expect(shapeOf('A:0')).toMatchObject({
        max: [115, 30, 20],
        volume: 115 * 30 * 20,
        valid: true,
      });
    });

    it('copies that miss the original stay separate bodies, with a warning', async () => {
      const result = await run([
        ...A,
        rect('P', {
          bodies: ['A:0'],
          direction1: AXIS_X,
          count1: '3',
          distance1: '100 mm',
          join: true,
        }),
      ]);
      expect(status(result, 'P').status).toBe('warning');
      expect(status(result, 'P').message).toMatch(/separate bodies/);
      expect(result.bodies).toHaveLength(3);
    });
  });
});

// --------------------------------------------------------- circular, bodies

describe('circular pattern of bodies', { timeout: 120_000 }, () => {
  const boxAt = block('A', 40, -10, 20, 20, 10);

  it('spreads instances evenly round a whole turn', async () => {
    const result = ok(
      await run([...boxAt, circ('C', { bodies: ['A:0'], axis: AXIS_Z, count: '4' })]),
    );
    expect(result.bodies).toHaveLength(4);
    const centres = result.bodies.map((b) => {
      const s = shapeOf(b.id);
      return [round((s.min[0] + s.max[0]) / 2, 1), round((s.min[1] + s.max[1]) / 2, 1)].join(',');
    });
    expect(centres.sort()).toEqual(['-50,0', '0,-50', '0,50', '50,0']);
  });

  it('a part of a turn ends on the angle; a step angle is between neighbours', async () => {
    const total = ok(
      await run([
        ...boxAt,
        circ('C', { bodies: ['A:0'], axis: AXIS_Z, count: '3', angle: '90 deg' }),
      ]),
    );
    expect(total.bodies).toHaveLength(3);
    const last = shapeOf(copy('C', 2));
    expect(round((last.min[1] + last.max[1]) / 2, 1)).toBe(50);
    ok(
      await run([
        ...boxAt,
        circ('C', { bodies: ['A:0'], axis: AXIS_Z, count: '3', angle: '45 deg', measure: 'step' }),
      ]),
    );
    const s = shapeOf(copy('C', 2));
    expect(round((s.min[1] + s.max[1]) / 2, 1)).toBe(50);
  });

  it('symmetric turns both ways from the original', async () => {
    const result = ok(
      await run([
        ...boxAt,
        circ('C', {
          bodies: ['A:0'],
          axis: AXIS_Z,
          count: '3',
          angle: '60 deg',
          measure: 'step',
          symmetric: true,
        }),
      ]),
    );
    expect(result.bodies).toHaveLength(3);
    const ys = result.bodies
      .map((b) => {
        const s = shapeOf(b.id);
        return round((s.min[1] + s.max[1]) / 2, 1);
      })
      .sort((a, b) => a - b);
    // ±60° from the centre at (50, 0): y = ∓50·sin 60°
    expect(ys).toEqual([-43.3, 0, 43.3]);
  });
});

// ------------------------------------------------------------- path, bodies

describe('path pattern of bodies', { timeout: 120_000 }, () => {
  /** A sketch line from (0, -50) to (0, 150) on XY, and a quarter-circle path. */
  function pathSketch() {
    const b = new SketchBuilder();
    const line = b.line(0, 100, 200, 100);
    return {
      feature: sketch('SL', b.sketch),
      ref: { kind: 'sketchEntity', id: `SL/${line.id}` } as GeomRef,
    };
  }

  it('places instances along a sketch line by distance', async () => {
    const { feature, ref } = pathSketch();
    const result = ok(
      await run([
        ...A,
        feature,
        along('W', { bodies: ['A:0'], path: [ref], count: '4', distance: '50 mm' }),
      ]),
    );
    expect(result.bodies).toHaveLength(4);
    // The first instance is the original; the path started at (0, 100), so instances move by 50, 100, 150 in x.
    const xs = result.bodies.map((b) => shapeOf(b.id).min[0]).sort((a, b) => a - b);
    expect(xs).toEqual([0, 50, 100, 150]);
    expect(shapeOf(copy('W', 1)).min[1]).toBe(0);
  });

  it('runs past the end of the path: an error that says how long it is', async () => {
    const { feature, ref } = pathSketch();
    const result = await run([
      ...A,
      feature,
      along('W', { bodies: ['A:0'], path: [ref], count: '6', distance: '50 mm' }),
    ]);
    expect(status(result, 'W').status).toBe('error');
    expect(status(result, 'W').message).toMatch(/path is 200 mm long/);
  });

  it('an extent divides the distance among the instances', async () => {
    const { feature, ref } = pathSketch();
    const result = ok(
      await run([
        ...A,
        feature,
        along('W', {
          bodies: ['A:0'],
          path: [ref],
          count: '3',
          distance: '160 mm',
          measure: 'extent',
        }),
      ]),
    );
    const xs = result.bodies.map((b) => shapeOf(b.id).min[0]).sort((a, b) => a - b);
    expect(xs).toEqual([0, 80, 160]);
  });

  it('follows an arc and turns each instance to the tangent', async () => {
    const b = new SketchBuilder();
    // A quarter circle of radius 100 about the origin, from (100, 0) to (0, 100).
    const arc = b.arc(0, 0, 100, 0, 90);
    const ref = { kind: 'sketchEntity', id: `SQ/${arc.id}` } as GeomRef;
    const long = block('A', 100, -5, 30, 10, 10);
    const result = ok(
      await run([
        ...long,
        sketch('SQ', b.sketch),
        along('W', {
          bodies: ['A:0'],
          path: [ref],
          count: '3',
          distance: `${(Math.PI * 100) / 4} mm`,
          aligned: true,
        }),
      ]),
    );
    expect(result.bodies).toHaveLength(3);
    // The last instance sits a quarter turn on, its length (30 mm) now along y.
    const last = shapeOf(copy('W', 2));
    expect(round(last.max[1] - last.min[1], 1)).toBe(30);
    expect(round(last.min[0], 1)).toBe(-5);
    expect(last.valid).toBe(true);
  });

  it('chains sketch curves that meet end to end', async () => {
    const b = new SketchBuilder();
    const first = b.line(0, 100, 100, 100);
    const second = b.line(200, 100, 100, 100);
    const refs = [first, second].map(
      (l) => ({ kind: 'sketchEntity', id: `SL/${l.id}` }) as GeomRef,
    );
    const result = ok(
      await run([
        ...A,
        sketch('SL', b.sketch),
        along('W', { bodies: ['A:0'], path: refs, count: '5', distance: '50 mm' }),
      ]),
    );
    expect(result.bodies).toHaveLength(5);
    expect(shapeOf(copy('W', 2)).min[0]).toBe(100);
  });

  it('refuses curves that do not meet', async () => {
    const b = new SketchBuilder();
    const first = b.line(0, 100, 100, 100);
    const second = b.line(300, 100, 400, 100);
    const refs = [first, second].map(
      (l) => ({ kind: 'sketchEntity', id: `SL/${l.id}` }) as GeomRef,
    );
    const result = await run([
      ...A,
      sketch('SL', b.sketch),
      along('W', { bodies: ['A:0'], path: refs }),
    ]);
    expect(status(result, 'W').message).toMatch(/don't join end to end/);
  });
});

// ------------------------------------------------------------- features

describe('patterns of features', { timeout: 120_000 }, () => {
  it('repeats a hole cut along an axis', async () => {
    const result = ok(
      await run([
        ...plate(),
        hole('H', 10, 10),
        rect('P', { features: ['H'], direction1: AXIS_X, count1: '4', distance1: '20 mm' }),
      ]),
    );
    expect(ids(result)).toEqual(['L:0']);
    expect(shapeOf('L:0')).toMatchObject({
      volume: expect.closeTo(100 * 100 * 10 - 4 * HOLE_VOLUME, 2),
      valid: true,
      faces: 6 + 4,
    });
  });

  it('instances that miss every body make a cut that removes nothing: an error', async () => {
    const result = await run([
      ...plate(),
      hole('H', 70, 50),
      circ('C', { features: ['H'], axis: AXIS_Z, count: '3' }),
    ]);
    // Turned about the world Z axis, (70, 50) lands at negative x, off the plate.
    expect(status(result, 'C').status).toBe('error');
    expect(status(result, 'C').message).toMatch(/doesn't touch any body/);
  });

  it('a circular pattern of holes about an axis through the plate’s middle', async () => {
    // The axis is a sketch line through (50, 50) along Z? Use a construction-free way: a plate centred on the origin.
    const c = block('L', -50, -50, 100, 100, 10);
    const result = ok(
      await run([...c, hole('H', 30, 0), circ('C', { features: ['H'], axis: AXIS_Z, count: '6' })]),
    );
    expect(shapeOf('L:0')).toMatchObject({
      volume: expect.closeTo(100 * 100 * 10 - 6 * HOLE_VOLUME, 2),
      valid: true,
    });
    // Holes' faces are named after the hole's, per instance.
    const names = namesOf(result, 'L:0', 'face');
    expect(names.some((n) => n.startsWith('pattern:C:1:from:(cylinder:H:'))).toBe(true);
    expect(names.some((n) => n.startsWith('pattern:C:5:from:(cylinder:H:'))).toBe(true);
  });

  it('repeats a boss (a joined box) and joins it to the body', async () => {
    const result = ok(
      await run([
        ...plate(),
        boss('B', 10, 10),
        rect('P', {
          features: ['B'],
          direction1: AXIS_X,
          count1: '3',
          distance1: '20 mm',
          direction2: AXIS_Y,
          count2: '2',
          distance2: '30 mm',
        }),
      ]),
    );
    expect(ids(result)).toEqual(['L:0']);
    expect(shapeOf('L:0')).toMatchObject({
      volume: expect.closeTo(100 * 100 * 10 + 6 * 6 * 6 * 5, 2),
      valid: true,
    });
  });

  it('overlapping instances of a hole merge before the cut', async () => {
    const result = ok(
      await run([
        ...plate(),
        hole('H', 20, 50),
        rect('P', { features: ['H'], direction1: AXIS_X, count1: '5', distance1: '4 mm' }),
      ]),
    );
    expect(status(result, 'P').status).toBe('ok');
    expect(shapeOf('L:0').valid).toBe(true);
    // A slot: five 8 mm holes 4 mm apart cover x 16…40, less than five holes' worth.
    expect(shapeOf('L:0').volume).toBeLessThan(100 * 100 * 10 - 3 * HOLE_VOLUME);
  });

  it('overlapping holes are cut a colour class at a time: the union of the circles, named', async () => {
    // Five 8 mm holes 4 mm apart (a chain: two classes). The cut is the union of the circles:
    // at each x the chord of the nearest centre, integrated.
    const centres = [20, 24, 28, 32, 36];
    let area = 0;
    const step = 0.001;
    for (let x = 16; x < 40; x += step) {
      const d = Math.min(...centres.map((c) => Math.abs(x + step / 2 - c)));
      area += 2 * Math.sqrt(Math.max(0, 16 - d * d)) * step;
    }
    const result = ok(
      await run([
        ...plate(),
        hole('H', 20, 50),
        rect('P', { features: ['H'], direction1: AXIS_X, count1: '5', distance1: '4 mm' }),
      ]),
    );
    expect(shapeOf('L:0').valid).toBe(true);
    expect(shapeOf('L:0').volume).toBeCloseTo(100 * 100 * 10 - 10 * area, 1);
    // The ghost is one shape of all five, and it can't be repeated again.
    const instances = namesOf(result, 'L:0', 'face').filter((n) => n.startsWith('pattern:P:'));
    // Plate (6) less the top and bottom plus the slot's: the same 14 faces as with the holes fused.
    expect(shapeOf('L:0').faces).toBe(14);
    for (const label of ['1', '2', '3', '4']) {
      expect(instances.some((n) => n.startsWith(`pattern:P:${label}:from:`))).toBe(true);
    }
    const again = await run([
      ...plate(),
      hole('H', 20, 50),
      rect('P', { features: ['H'], direction1: AXIS_X, count1: '5', distance1: '4 mm' }),
      rect('Q', { features: ['P'], direction1: AXIS_Y, count1: '2', distance1: '20 mm' }),
    ]);
    expect(status(again, 'Q').status).toBe('error');
    expect(status(again, 'Q').message).toMatch(/overlap/);
  });

  it('several features at once, each keeping its operation', async () => {
    const result = ok(
      await run([
        ...plate(),
        hole('H', 10, 10),
        boss('B', 10, 40),
        rect('P', { features: ['H', 'B'], direction1: AXIS_X, count1: '3', distance1: '30 mm' }),
      ]),
    );
    expect(shapeOf('L:0').volume).toBeCloseTo(100 * 100 * 10 - 3 * HOLE_VOLUME + 3 * 180, 3);
    expect(result.bodies).toHaveLength(1);
  });

  it('adding instances keeps the earlier instances’ names', async () => {
    const make = (count: string) => [
      ...plate(),
      hole('H', 10, 10),
      rect('P', { features: ['H'], direction1: AXIS_X, count1: count, distance1: '20 mm' }),
    ];
    const three = ok(await run(make('3')));
    const four = ok(await run(make('4')));
    const has = (r: Done) => namesOf(r, 'L:0', 'face').filter((n) => n.startsWith('pattern:P:'));
    for (const name of has(three)) expect(has(four)).toContain(name);
    expect(has(four).length).toBeGreaterThan(has(three).length);
  });

  it('a feature that makes a new body has nothing to repeat', async () => {
    const result = await run([
      ...plate(),
      ...block('Q', 10, 10, 5, 5, 5),
      rect('P', { features: ['Q'], direction1: AXIS_X, count1: '2' }),
    ]);
    expect(status(result, 'P').status).toBe('error');
    expect(status(result, 'P').message).toMatch(/doesn't join or cut anything/);
  });
});

// ------------------------------------------------------------ mirror features

describe('mirror of features', { timeout: 120_000 }, () => {
  it('mirrors a hole to the other side of a plane', async () => {
    const c = block('L', -50, -50, 100, 100, 10);
    const result = ok(await run([...c, hole('H', 30, 10), mirror('M', YZ, ['H'])]));
    expect(ids(result)).toEqual(['L:0']);
    expect(shapeOf('L:0')).toMatchObject({
      volume: expect.closeTo(100 * 100 * 10 - 2 * HOLE_VOLUME, 2),
      valid: true,
      faces: 8,
    });
    expect(
      namesOf(result, 'L:0', 'face').some((n) => n.startsWith('mirror:M:from:(cylinder:H:')),
    ).toBe(true);
  });

  it('mirrors a boss and joins it', async () => {
    const c = block('L', -50, -50, 100, 100, 10);
    ok(await run([...c, boss('B', 20, 10), mirror('M', YZ, ['B'])]));
    expect(shapeOf('L:0').volume).toBeCloseTo(100 * 100 * 10 + 2 * 180, 3);
  });

  it('the bodies of a features mirror are ignored', async () => {
    const c = block('L', -50, -50, 100, 100, 10);
    const result = ok(await run([...c, hole('H', 30, 10), mirror('M', YZ, ['H'])]));
    expect(result.bodies).toHaveLength(1);
  });
});

// ------------------------------------------------------------------ errors

describe('what a pattern says when it cannot be made', { timeout: 120_000 }, () => {
  const msg = async (pattern: Feature, base: Feature[] = A) =>
    status(await run([...base, pattern]), pattern.id);

  it('needs something to pattern and a direction', async () => {
    expect(await msg(rect('P', { direction1: AXIS_X }))).toMatchObject({
      status: 'error',
      message: 'Pick the bodies to pattern.',
    });
    expect(await msg(rect('P', { bodies: ['A:0'] }))).toMatchObject({
      message: 'Pick the direction to repeat along.',
    });
    expect(await msg(rect('P', { features: [], direction1: AXIS_X }))).toMatchObject({
      message: 'Pick the features to pattern.',
    });
    expect(await msg(circ('C', { bodies: ['A:0'] }))).toMatchObject({
      message: 'Pick the axis to turn about.',
    });
    expect(await msg(along('W', { bodies: ['A:0'] }))).toMatchObject({
      message: 'Pick the path: sketch curves or edges.',
    });
  });

  it('counts are whole numbers, at least 1, and not too many', async () => {
    const at = (count1: string) => msg(rect('P', { bodies: ['A:0'], direction1: AXIS_X, count1 }));
    expect((await at('2.5')).message).toMatch(/whole number/);
    expect((await at('0')).message).toBe('Count must be at least 1.');
    expect((await at('2000')).message).toMatch(/up to 1000 instances/);
    const grid = await msg(
      rect('P', {
        bodies: ['A:0'],
        direction1: AXIS_X,
        count1: '40',
        direction2: AXIS_Y,
        count2: '40',
      }),
    );
    expect(grid.message).toMatch(/1600/);
  });

  it('a count of 1 makes nothing new and says so', async () => {
    const result = await run([
      ...A,
      rect('P', { bodies: ['A:0'], direction1: AXIS_X, count1: '1' }),
    ]);
    expect(status(result, 'P').status).toBe('warning');
    expect(result.bodies).toHaveLength(1);
  });

  it('two parallel directions are refused', async () => {
    const s = await msg(
      rect('P', {
        bodies: ['A:0'],
        direction1: AXIS_X,
        direction2: AXIS_X,
        count1: '2',
        count2: '2',
      }),
    );
    expect(s.message).toMatch(/parallel/);
  });

  it('a body or a feature that is gone is a lost reference', async () => {
    const gone = await run([...A, rect('P', { bodies: ['Z:0'], direction1: AXIS_X })]);
    expect(status(gone, 'P').message).toMatch(/no longer exists/);
    expect(status(gone, 'P').refs).toEqual([{ ref: { kind: 'body', id: 'Z:0' }, state: 'lost' }]);
  });

  it('a suppressed source feature says so', async () => {
    const h = { ...hole('H', 10, 10), suppressed: true };
    const result = await run([...plate(), h, rect('P', { features: ['H'], direction1: AXIS_X })]);
    expect(status(result, 'P').message).toMatch(/suppressed/);
  });
});

// ---------------------------------------------------------------- skipping

describe('skipping instances (P4-12)', { timeout: 120_000 }, () => {
  /** A 3 × 3 grid of the block `A`, skipping `labels`. */
  const grid = (labels: readonly string[]) =>
    rect('P', {
      bodies: ['A:0'],
      direction1: AXIS_X,
      count1: '3',
      distance1: '60 mm',
      direction2: AXIS_Y,
      count2: '3',
      distance2: '60 mm',
      skip: labels,
    });

  it('leaves the named instances out and keeps the rest whole', async () => {
    const result = ok(await run([...A, grid(['1x1', '2x2'])]));
    expect(ids(result)).toHaveLength(7);
    expect(ids(result)).not.toContain(`P:${pairSlots(slotOf(1, 1), 0)}`);
    expect(ids(result)).not.toContain(`P:${pairSlots(slotOf(2, 2), 0)}`);
    // What is there sits where its label says (A is 40 × 30 × 20 at the origin).
    expect(shapeOf(copy('P', 1)).min).toEqual([60, 0, 0]);
    expect(shapeOf(`P:${pairSlots(slotOf(0, 2), 0)}`).min).toEqual([0, 120, 0]);
    for (const id of ids(result)) expect(shapeOf(id).volume).toBe(24_000);
  });

  it('a skip stays on its instance when the counts grow', async () => {
    const three = ok(await run([...A, grid(['1x1'])]));
    expect(ids(three)).toHaveLength(8);
    const taller = ok(
      await run([
        ...A,
        rect('P', {
          bodies: ['A:0'],
          direction1: AXIS_X,
          count1: '3',
          distance1: '60 mm',
          direction2: AXIS_Y,
          count2: '5',
          distance2: '60 mm',
          skip: ['1x1'],
        }),
      ]),
    );
    expect(ids(taller)).toHaveLength(14);
    // The label follows the position, so the same instance is gone in the taller grid.
    expect(ids(taller)).not.toContain(`P:${pairSlots(slotOf(1, 1), 0)}`);
    expect(ids(taller)).toContain(`P:${pairSlots(slotOf(1, 3), 0)}`);
  });

  it('the original cannot be skipped', async () => {
    const skipped = await run([...A, grid(['0x0'])]);
    expect(status(skipped, 'P')).toMatchObject({
      status: 'error',
      message: "The original can't be skipped.",
    });
    const row = await run([
      ...A,
      rect('P', { bodies: ['A:0'], direction1: AXIS_X, count1: '3', skip: ['0'] }),
    ]);
    expect(status(row, 'P').message).toBe("The original can't be skipped.");
  });

  it('a label past the count is ignored, and kept', async () => {
    const past = ok(await run([...A, grid(['2x4'])]));
    expect(ids(past)).toHaveLength(9);
    // The list is what was asked for, so the skip comes back when the count grows.
    const grown = ok(
      await run([
        ...A,
        rect('P', {
          bodies: ['A:0'],
          direction1: AXIS_X,
          count1: '5',
          distance1: '60 mm',
          direction2: AXIS_Y,
          count2: '5',
          distance2: '60 mm',
          skip: ['2x4'],
        }),
      ]),
    );
    expect(ids(grown)).toHaveLength(24);
    expect(ids(grown)).not.toContain(`P:${pairSlots(slotOf(2, 4), 0)}`);
  });

  it('a circular pattern skips instances of its turn too', async () => {
    const result = ok(
      await run([
        ...block('L', -50, -50, 100, 100, 10),
        hole('H', 30, 0),
        circ('C', { features: ['H'], axis: AXIS_Z, count: '6', skip: ['2'] }),
      ]),
    );
    expect(shapeOf('L:0')).toMatchObject({
      volume: expect.closeTo(100 * 100 * 10 - 5 * HOLE_VOLUME, 2),
      valid: true,
    });
    const names = namesOf(result, 'L:0', 'face');
    expect(names.some((n) => n.startsWith('pattern:C:2:from:('))).toBe(false);
    expect(names.some((n) => n.startsWith('pattern:C:1:from:('))).toBe(true);
  });

  it('a path pattern skips instances along the path', async () => {
    const b = new SketchBuilder();
    const line = b.line(0, 100, 200, 100);
    const ref = { kind: 'sketchEntity', id: `SL/${line.id}` } as GeomRef;
    const result = ok(
      await run([
        ...A,
        sketch('SL', b.sketch),
        along('W', { bodies: ['A:0'], path: [ref], count: '4', distance: '50 mm', skip: ['1'] }),
      ]),
    );
    // The original, then instances 2 and 3.
    expect(result.bodies.map((b) => shapeOf(b.id).min[0]).sort((x, y) => x - y)).toEqual([
      0, 100, 150,
    ]);
  });

  it('skipped instances are preview ghosts of what they would have been', async () => {
    ok(await run([...A, grid(['1x1'])]));
    const tools = seen.get('P')?.previewTools ?? [];
    expect(tools.map((t) => t.style)).toEqual(['skip']);
    const ghost = tools[0] as { shape: ShapeHandle };
    expect(round(kernel.measure(ghost.shape).volume)).toBe(24_000);
    // Where the label says it would be: the original's centre moved by (60, 60, 0).
    const box = kernel.measure(ghost.shape).bbox;
    near3(box.min, [60, 60, 0]);
    near3(box.max, [100, 90, 20]);
  });

  it('reports the whole layout: every instance, its centre, and the series', async () => {
    ok(await run([...A, grid(['1x1'])]));
    const report = seen.get('P')?.report as PatternReport | undefined;
    expect(report?.instances.map((i) => i.label)).toEqual([
      '0x0',
      '1x0',
      '2x0',
      '0x1',
      '1x1',
      '2x1',
      '0x2',
      '1x2',
      '2x2',
    ]);
    expect(report?.instances.filter((i) => i.skipped).map((i) => i.label)).toEqual(['1x1']);
    expect(report?.instances[0]?.original).toBe(true);
    // A is 40 × 30 × 20 at the origin, so its centre is (20, 15, 10).
    near3(report?.instances[0]?.at as Vec3, [20, 15, 10]);
    near3(report?.instances[4]?.at as Vec3, [80, 75, 10]);
    const [first, second] = report?.series ?? [];
    expect(first).toMatchObject({ mode: 'linear', direction: [1, 0, 0], step: 60, count: 3 });
    near3(first?.first as Vec3, [20, 15, 10]);
    near3(first?.last as Vec3, [140, 15, 10]);
    expect(second).toMatchObject({ mode: 'linear', direction: [0, 1, 0], count: 3 });
    near3(second?.last as Vec3, [20, 135, 10]);
  });

  it('reports a turn as one series', async () => {
    ok(
      await run([
        ...block('L', -50, -50, 100, 100, 10),
        hole('H', 30, 0),
        circ('C', { features: ['H'], axis: AXIS_Z, count: '4', angle: '90 deg' }),
      ]),
    );
    const turn = seen.get('C')?.report as PatternReport;
    expect(turn.series).toHaveLength(1);
    // A quarter spread over four instances: 30 degrees each, the last at 90.
    expect(turn.series[0]).toMatchObject({ mode: 'turn', direction: [0, 0, 1], count: 4 });
    expect(turn.series[0]?.step).toBeCloseTo(Math.PI / 6, 9);
    // The hole's tool is centred at (30, 0, 10); a quarter about +Z takes it to (0, 30, 10).
    near3(turn.series[0]?.last as Vec3, [0, 30, 10]);
    expect(turn.instances).toHaveLength(4);
  });

  it('reports a path as one series, running along the path', async () => {
    const b = new SketchBuilder();
    const line = b.line(0, 100, 200, 100);
    const ref = { kind: 'sketchEntity', id: `SL/${line.id}` } as GeomRef;
    ok(
      await run([
        ...A,
        sketch('SL', b.sketch),
        along('W', { bodies: ['A:0'], path: [ref], count: '3', distance: '40 mm' }),
      ]),
    );
    const report = seen.get('W')?.report as PatternReport;
    expect(report.series).toHaveLength(1);
    expect(report.series[0]).toMatchObject({
      mode: 'linear',
      direction: [1, 0, 0],
      count: 3,
      step: 40,
    });
    // Two steps of 40 mm along the path: the body's centre moves 80 mm in x.
    near3(report.series[0]?.last as Vec3, [100, 15, 10]);
  });

  it('every instance skipped makes nothing new and says so', async () => {
    const result = await run([
      ...A,
      rect('P', { bodies: ['A:0'], direction1: AXIS_X, count1: '3', skip: ['1', '2'] }),
    ]);
    expect(ids(result)).toHaveLength(1);
    expect(status(result, 'P')).toMatchObject({
      status: 'warning',
      message: 'Every instance is skipped, so the pattern makes nothing new.',
    });
  });
});

// ------------------------------------------------------------- performance

describe('performance', { timeout: 300_000 }, () => {
  const timings: Record<string, number> = {};
  const time = async (name: string, features: Feature[]) => {
    const t = performance.now();
    const result = ok(await run(features));
    timings[name] = Math.round(performance.now() - t);
    return result;
  };

  it('a 10 × 10 pattern of a small body, as copies and joined', async () => {
    const base = [...plate(), ...block('B', 5, 5, 6, 6, 4)];
    const grid = (distance: string, join: boolean) =>
      rect('P', {
        bodies: ['B:0'],
        direction1: AXIS_X,
        count1: '10',
        distance1: distance,
        direction2: AXIS_Y,
        count2: '10',
        distance2: distance,
        join,
      });
    const copies = await time('bodies, 100 copies', [...base, grid('9 mm', false)]);
    expect(copies.bodies).toHaveLength(101);
    const joined = await time('bodies, joined (touching, one 60 x 60 slab)', [
      ...base,
      grid('6 mm', true),
    ]);
    expect(joined.bodies).toHaveLength(2);
    expect(shapeOf('B:0').volume).toBeCloseTo(60 * 60 * 4, 3);
  });

  it('a 10 × 10 pattern of a hole cut and of a boss', async () => {
    const holes = await time('holes 10 x 10', [
      ...block('L', 0, 0, 120, 120, 10),
      hole('H', 10, 10, 4),
      rect('P2', {
        features: ['H'],
        direction1: AXIS_X,
        count1: '10',
        distance1: '11 mm',
        direction2: AXIS_Y,
        count2: '10',
        distance2: '11 mm',
      }),
    ]);
    expect(shapeOf('L:0').volume).toBeCloseTo(120 * 120 * 10 - 100 * Math.PI * 4 * 10, 3);
    expect(holes.bodies).toHaveLength(1);
    await time('bosses 10 x 10', [
      ...block('L', 0, 0, 120, 120, 10),
      boss('B', 10, 10),
      rect('P2', {
        features: ['B'],
        direction1: AXIS_X,
        count1: '10',
        distance1: '11 mm',
        direction2: AXIS_Y,
        count2: '10',
        distance2: '11 mm',
      }),
    ]);
    expect(shapeOf('L:0').volume).toBeCloseTo(120 * 120 * 10 + 100 * 180, 3);
  });

  it('overlapping holes: a 10 × 10 grid whose instances interfere', async () => {
    await time('overlapping holes 10 x 10', [
      ...block('L', 0, 0, 120, 120, 10),
      hole('H', 10, 10, 6),
      rect('P2', {
        features: ['H'],
        direction1: AXIS_X,
        count1: '10',
        distance1: '5 mm',
        direction2: AXIS_Y,
        count2: '10',
        distance2: '5 mm',
      }),
    ]);
    expect(shapeOf('L:0').valid).toBe(true);
  });

  it('overlapping bosses: a 10 × 10 grid whose instances interfere', async () => {
    await time('overlapping bosses 10 x 10', [
      ...block('L', 0, 0, 120, 120, 10),
      boss('B', 10, 10),
      rect('P2', {
        features: ['B'],
        direction1: AXIS_X,
        count1: '10',
        distance1: '4 mm',
        direction2: AXIS_Y,
        count2: '10',
        distance2: '4 mm',
      }),
    ]);
    // Boxes 6 mm square at 4 mm pitch cover 42 x 42 mm, 5 mm high.
    expect(shapeOf('L:0').volume).toBeCloseTo(120 * 120 * 10 + 42 * 42 * 5, 3);
    expect(shapeOf('L:0').valid).toBe(true);
  });

  it('reports the timings', () => {
    // Read by a person: `pnpm vitest run packages/kernel/src/features/pattern -t timings --reporter verbose`.
    console.info('pattern timings (ms)', JSON.stringify(timings));
    expect(Object.keys(timings).length).toBeGreaterThan(0);
  });
});

// ------------------------------------------------------------------ leaks

describe('leaks', { timeout: 300_000 }, () => {
  it('leaves no shapes behind over changing counts, joins and features', async () => {
    for (let n = 2; n <= 6; n++) {
      ok(
        await run([
          ...A,
          rect('P', {
            bodies: ['A:0'],
            direction1: AXIS_X,
            count1: String(n),
            distance1: '25 mm',
            join: n % 2 === 0,
          }),
        ]),
      );
      ok(
        await run([
          ...block('L', -50, -50, 100, 100, 10),
          hole('H', 30, 0),
          circ('C', { features: ['H'], axis: AXIS_Z, count: String(n), angle: '90 deg' }),
        ]),
      );
    }
    // strictLeaks throws inside the engine for any evaluation that leaves a shape;
    // `afterAll` checks the arena is empty once the cache is cleared.
    engine.clear();
    expect(kernel.stats().liveShapes).toBe(0);
  });
});

// ------------------------------------------------------------ golden table

describe('golden table', { timeout: 300_000 }, () => {
  it('layouts, by type, measure and symmetry', async () => {
    const cases: [string, Feature][] = [
      [
        'rect 3 spacing',
        rect('P', { bodies: ['A:0'], direction1: AXIS_X, count1: '3', distance1: '50 mm' }),
      ],
      [
        'rect 3 extent',
        rect('P', {
          bodies: ['A:0'],
          direction1: AXIS_Y,
          count1: '3',
          distance1: '90 mm',
          measure1: 'extent',
        }),
      ],
      [
        'rect 4 symmetric',
        rect('P', {
          bodies: ['A:0'],
          direction1: AXIS_X,
          count1: '4',
          distance1: '50 mm',
          symmetric1: true,
        }),
      ],
      [
        'rect 2x2',
        rect('P', {
          bodies: ['A:0'],
          direction1: AXIS_X,
          count1: '2',
          distance1: '50 mm',
          direction2: AXIS_Y,
          count2: '2',
          distance2: '40 mm',
        }),
      ],
      [
        'rect 3 join',
        rect('P', {
          bodies: ['A:0'],
          direction1: AXIS_X,
          count1: '3',
          distance1: '40 mm',
          join: true,
        }),
      ],
      ['circ 4 total', circ('P', { bodies: ['A:0'], axis: AXIS_Z, count: '4' })],
      ['circ 3 quarter', circ('P', { bodies: ['A:0'], axis: AXIS_Z, count: '3', angle: '90 deg' })],
      [
        'circ 3 step symmetric',
        circ('P', {
          bodies: ['A:0'],
          axis: AXIS_Y,
          count: '3',
          angle: '30 deg',
          measure: 'step',
          symmetric: true,
        }),
      ],
    ];
    const table: Record<string, unknown> = {};
    for (const [name, feature] of cases) {
      const result = ok(await run([...A, feature]));
      table[name] = result.bodies.map((b) => ({ id: b.id, ...shapeOf(b.id) }));
    }
    const holes: [string, Feature[]][] = [
      [
        'hole rect 3',
        [
          ...plate(),
          hole('H', 10, 10),
          rect('P', { features: ['H'], direction1: AXIS_X, count1: '3', distance1: '20 mm' }),
        ],
      ],
      [
        'hole circ 4',
        [
          ...block('L', -50, -50, 100, 100, 10),
          hole('H', 30, 0),
          circ('P', { features: ['H'], axis: AXIS_Z, count: '4' }),
        ],
      ],
    ];
    for (const [name, features] of holes) {
      const result = ok(await run(features));
      table[name] = result.bodies.map((b) => ({ id: b.id, ...shapeOf(b.id) }));
    }
    await expect(`${JSON.stringify(table, null, 2)}\n`).toMatchFileSnapshot(
      'golden/pattern-options.json',
    );
  });
});
