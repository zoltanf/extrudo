// The rib feature (P4-10, ADR-0064 §1) through the recompute engine with real
// OCCT: an L-bracket and a diagonal line on its middle plane, the volume the
// wall adds (the triangle the extended line cuts from the legs × the
// thickness), the sides and flip, the names it gives (ADR-0005), both ways it
// can fail to close and a pattern that repeats it. `golden/rib-options.json` is
// the golden table of side × flip × thickness (a Vitest file snapshot); rewrite
// it with `pnpm vitest run -u packages/kernel/src/features/rib` and review the
// diff.
import {
  type ExtrudeInputOptions,
  extrudeInputs,
  type Feature,
  type FeatureId,
  FeatureRegistry,
  type FeatureStatus,
  type GeomRef,
  originPlaneRef,
  type RectangularOptions,
  RIB_TYPE,
  type RibInputOptions,
  rectangularPatternInputs,
  ribInputs,
  type SketchData,
  sketchInputs,
} from '@extrudo/core';
import { SketchBuilder } from '@extrudo/sketch/fixtures';
import { detectProfiles } from '@extrudo/sketch/profiles';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Kernel, type ShapeHandle } from '../kernel';
import { loadOcct } from '../occt/load';
import { RecomputeEngine } from '../recompute/engine';
import { testDocument, testFeature, testFeatures } from '../recompute/testing';
import type { FeatureOutput, KernelFeatureDefinition, RecomputeResult } from '../recompute/types';
import type { RibOutputData } from './rib';

let kernel: Kernel;
let engine: RecomputeEngine;
/** The output of each feature's latest evaluation (see `fresh`). */
const seen = new Map<string, FeatureOutput>();

beforeAll(async () => {
  kernel = new Kernel(await loadOcct());
});

beforeEach(() => {
  engine?.clear();
  expect(kernel.stats().liveShapes).toBe(0);
  seen.clear();
  engine = new RecomputeEngine(kernel, registryOf(), { strictLeaks: true });
});

/** The kernel's features (so the rib is registered), recording each output. */
function registryOf(): FeatureRegistry<KernelFeatureDefinition> {
  const registry = new FeatureRegistry<KernelFeatureDefinition>();
  for (const definition of testFeatures().registry.list()) {
    registry.register({
      ...definition,
      evaluate(ctx) {
        const output = definition.evaluate(ctx);
        seen.set(ctx.feature.id, output);
        return output;
      },
    });
  }
  return registry;
}

afterAll(() => {
  engine.clear();
  expect(kernel.stats().liveShapes).toBe(0);
});

type Done = Extract<RecomputeResult, { status: 'done' }>;

// ------------------------------------------------------------------ helpers

const XZ = originPlaneRef('origin:xz');
const AXIS_Y = { kind: 'axis', id: 'origin:y' } as const;

/** The L-bracket's own numbers, in the XZ sketch plane (x along, y up). */
const T = 5;
const LONG = 60;
const TALL = 50;
/** The bracket's depth along Y, symmetric about the plane. */
const DEPTH = 40;

function feature(id: string, type: string, inputs: Feature['inputs'] = {}): Feature {
  return { ...testFeature(id, type), inputs };
}

function sketch(id: string, data: SketchData): Feature {
  return feature(id, 'sketch', sketchInputs(XZ, data));
}

/** A closed outline as a sketch on the XZ plane: one line per side. */
function outline(corners: readonly (readonly [number, number])[]): {
  data: SketchData;
  profile: GeomRef;
} {
  const b = new SketchBuilder();
  corners.forEach((a, i) => {
    const next = corners[(i + 1) % corners.length] as readonly [number, number];
    b.line(a[0], a[1], next[0], next[1]);
  });
  const data = b.sketch;
  const [region] = detectProfiles(data);
  if (!region) throw new Error('no profile');
  return { data, profile: { kind: 'profile', id: `SL/${region.id}` } };
}

/** A sketch with one line (the rib's open edge) and a reference to it. */
function ribLine(
  from: readonly [number, number],
  to: readonly [number, number],
  id = 'SR',
): { feature: Feature; line: GeomRef; data: SketchData } {
  const b = new SketchBuilder();
  const line = b.line(from[0], from[1], to[0], to[1]);
  const data = b.sketch;
  return {
    feature: sketch(id, data),
    line: { kind: 'sketchEntity', id: `${id}/${line.id}` },
    data,
  };
}

/** The L-bracket: an L outline on XZ extruded symmetric about the plane. */
function bracket(
  options: ExtrudeInputOptions = { direction: 'symmetric', distance: `${DEPTH} mm` },
) {
  const profile = outline([
    [0, 0],
    [LONG, 0],
    [LONG, T],
    [T, T],
    [T, TALL],
    [0, TALL],
  ]);
  const features = [sketch('SL', profile.data), extrude([profile.profile], options)];
  return { features };
}

function extrude(profiles: GeomRef[], options: ExtrudeInputOptions): Feature {
  return { ...testFeature('LE', 'extrude'), inputs: extrudeInputs(profiles, options) };
}

function rib(curve: GeomRef, options: RibInputOptions = {}, id = 'R'): Feature {
  return { ...testFeature(id, RIB_TYPE), inputs: ribInputs(curve, options) };
}

function pattern(options: RectangularOptions, id = 'P'): Feature {
  return { ...testFeature(id, 'rectangularPattern'), inputs: rectangularPatternInputs(options) };
}

/** The line from the wall's inner face to the base's top: the rib of FR-FT-17. */
const DIAGONAL = {
  from: [T, 40] as const,
  to: [30, T] as const,
};

/** The triangle its extension cuts from the legs: ½ · 25 · 35 mm². */
const TRIANGLE = (25 * 35) / 2;
const BRACKET = (LONG * TALL - (LONG - T) * (TALL - T)) * DEPTH;

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

/** The body the bracket makes, with the rib: its volume, box, faces and names. */
function shapeOf(body = 'LE:0') {
  const shape = engine.latestBody(body as never);
  if (shape === undefined) throw new Error(`no body ${body}`);
  const props = kernel.properties(shape);
  const solids = kernel.solids(shape);
  kernel.release(...solids);
  return {
    shape,
    min: props.bbox.min.map((x) => round(x)),
    max: props.bbox.max.map((x) => round(x)),
    volume: props.volume,
    faces: kernel.count(shape, 'face'),
    solids: solids.length,
    valid: kernel.isValid(shape),
  };
}

const round = (x: number, digits = 3) => {
  const r = Number(x.toFixed(digits));
  return Object.is(r, -0) ? 0 : r;
};

const round3 = (v: readonly number[] | undefined) => v?.map((x) => round(x));

/** The persistent face names of a body, in sub-shape order. */
const faceNames = (result: Done, body = 'LE:0'): string[] =>
  result.bodies.find((b) => b.id === body)?.mesh?.faceIds ?? [];

/** Whether a 0.05 mm cube centred at `at` is inside the shape. */
function solidAt(shape: ShapeHandle, at: readonly [number, number, number]): boolean {
  const h = 0.025;
  const probe = kernel.box([2 * h, 2 * h, 2 * h], [at[0] - h, at[1] - h, at[2] - h]);
  const common = kernel.common(shape, probe);
  const volume = kernel.measure(common.shape).volume;
  kernel.release(probe, common.shape);
  return volume > 1e-6;
}

const data = (): RibOutputData => seen.get('R')?.data as RibOutputData;

// -------------------------------------------------------------------- tests

describe('rib on an L-bracket', { timeout: 300_000 }, () => {
  it('fills the corner from the line: the volume grows by the triangle × thickness', async () => {
    const { features } = bracket();
    const line = ribLine(DIAGONAL.from, DIAGONAL.to);
    const result = ok(await run([...features, line.feature, rib(line.line)]));

    const box = shapeOf();
    // The default 2 mm, centred on the plane.
    expect(box.volume).toBeCloseTo(BRACKET + TRIANGLE * 2, 3);
    expect(box.min).toEqual([0, -20, 0]);
    expect(box.max).toEqual([LONG, 20, TALL]);
    expect(box.valid).toBe(true);
    expect(box.solids).toBe(1);
    // The eight faces of the extruded L and the wall's own three: the face it
    // stands on (the sketch line) and its two sides across the plane. The legs'
    // faces grow where the wall meets them, they aren't new.
    expect(box.faces).toBe(11);
    // The wall stands inside the corner: in it, and not beyond its legs.
    expect(solidAt(box.shape, [17.5, 0, 22.5])).toBe(true);
    expect(solidAt(box.shape, [17.5, 0, 40])).toBe(false);
    expect(solidAt(box.shape, [30, 0, 30])).toBe(false);
    // Names: the prism's, on the wall's own three faces — the one standing on
    // the sketch line and the two across the plane.
    const names = faceNames(result);
    expect(names.filter((n) => n.startsWith('rib:R:')).sort()).toEqual([
      'rib:R:cap:end',
      'rib:R:cap:start',
      'rib:R:side:l2',
    ]);
    // The dialog's data: the line's middle, the plane's normal and the way the
    // wall grows (square to the line, into the corner).
    expect(round3(data()?.origin)).toEqual([17.5, 0, 22.5]);
    expect(round3(data()?.normal)).toEqual([0, -1, 0]);
    expect(round3(data()?.towards)).toEqual([-0.814, 0, -0.581]);
    expect(data()?.thickness).toBe(2);
    expect(data()?.band).toEqual([-1, 1]);
  });

  it('puts the wall on one side of the plane, or the other, with the same volume', async () => {
    for (const side of ['one', 'other'] as const) {
      engine.clear();
      const { features } = bracket();
      const line = ribLine(DIAGONAL.from, DIAGONAL.to);
      const result = ok(await run([...features, line.feature, rib(line.line, { side })]));
      const box = shapeOf();
      expect(box.volume).toBeCloseTo(BRACKET + TRIANGLE * 2, 3);
      expect(box.solids).toBe(1);
      expect(box.min).toEqual([0, -20, 0]);
      expect(box.max).toEqual([LONG, 20, TALL]);
      // `one` runs along the plane's normal (XZ: −Y), `other` against it: the
      // wall is in the corner's middle above the plane only for `one`.
      expect(solidAt(box.shape, [17.5, -1, 22.5])).toBe(side === 'one');
      expect(solidAt(box.shape, [17.5, 1, 22.5])).toBe(side === 'other');
      expect(faceNames(result).filter((n) => n.startsWith('rib:R:'))).toHaveLength(3);
      expect(data()?.band).toEqual(side === 'one' ? [0, 2] : [-2, 0]);
    }
  });

  it('flips to the other side of the line, where the rib cannot close', async () => {
    const { features } = bracket();
    const line = ribLine(DIAGONAL.from, DIAGONAL.to);
    const result = await run([...features, line.feature, rib(line.line, { flip: true })]);
    expect(status(result, 'R')).toEqual({
      status: 'error',
      message:
        "The rib doesn't close against the body: make the line's ends reach it, or flip the rib.",
    });
    // Nothing changed: the bracket is as it was.
    expect(shapeOf().volume).toBeCloseTo(BRACKET, 3);
  });

  it('refuses a line that lies inside the body', async () => {
    const { features } = bracket();
    // Inside the base (5 mm thick, so z = 2 with room either side).
    const line = ribLine([10, 2], [40, 2]);
    const result = await run([...features, line.feature, rib(line.line)]);
    expect(status(result, 'R')).toEqual({
      status: 'error',
      message: "The rib's line lies inside the body.",
    });
  });

  it('refuses a line whose region is open on one side', async () => {
    const { features } = bracket();
    // Above the wall: nothing closes the strip between the line and the wall's top.
    const line = ribLine([0, TALL + 10], [LONG, TALL + 10]);
    const result = await run([...features, line.feature, rib(line.line)]);
    expect(status(result, 'R')).toEqual({
      status: 'error',
      message:
        "The rib doesn't close against the body: make the line's ends reach it, or flip the rib.",
    });
  });

  it('refuses a line no longer in its sketch as a lost reference', async () => {
    const { features } = bracket();
    const line = ribLine(DIAGONAL.from, DIAGONAL.to);
    // The sketch keeps its ID but the line is gone.
    const emptied: SketchData = { ...line.data, entities: {} };
    const result = await run([
      ...features,
      feature('SR', 'sketch', sketchInputs(XZ, emptied)),
      rib(line.line),
    ]);
    expect(status(result, 'R')).toMatchObject({
      status: 'error',
      message: expect.stringContaining("Can't find the rib's line any more"),
    });
  });

  it('repeats as a rectangular pattern of features along the depth', async () => {
    const { features } = bracket();
    const line = ribLine(DIAGONAL.from, DIAGONAL.to);
    const result = ok(
      await run([
        ...features,
        line.feature,
        rib(line.line),
        pattern({
          features: ['R'],
          direction1: AXIS_Y,
          count1: '3',
          distance1: '10 mm',
          symmetric1: true,
        }),
      ]),
    );
    const box = shapeOf();
    expect(box.solids).toBe(1);
    expect(box.volume).toBeCloseTo(BRACKET + 3 * TRIANGLE * 2, 3);
    expect(box.min[1]).toBe(-20);
    expect(box.max[1]).toBe(20);
    // Three walls: the original's three faces and the copies' six, each named
    // after the rib it came from.
    expect(faceNames(result).filter((n) => n.startsWith('rib:R:'))).toHaveLength(3);
    expect(faceNames(result).filter((n) => n.startsWith('pattern:P:'))).toHaveLength(6);
    expect(box.faces).toBe(11 + 6);
    expect(solidAt(box.shape, [17.5, -10, 22.5])).toBe(true);
    expect(solidAt(box.shape, [17.5, -5, 22.5])).toBe(false);
  });

  it('keeps the rib face names through an unrelated edit', async () => {
    const { features } = bracket({ direction: 'symmetric', distance: '30 mm' });
    const line = ribLine(DIAGONAL.from, DIAGONAL.to);
    const ribFeature = rib(line.line);
    const first = ok(await run([...features, line.feature, ribFeature]));
    expect(
      faceNames(first)
        .filter((n) => n.startsWith('rib:R:'))
        .sort(),
    ).toEqual(['rib:R:cap:end', 'rib:R:cap:start', 'rib:R:side:l2']);

    // The bracket's depth changes: the rib is somewhere else, its names travel.
    const wider = bracket({ direction: 'symmetric', distance: '40 mm' });
    const second = ok(await run([...wider.features, line.feature, ribFeature]));
    expect(shapeOf().volume).toBeCloseTo(BRACKET + TRIANGLE * 2, 3);
    expect(faceNames(second)).toContain('rib:R:cap:start');
    expect(faceNames(second)).toContain('rib:R:cap:end');
    expect(status(second, 'R')).toEqual({ status: 'ok' });
  });

  it('golden table of side × flip × thickness', async () => {
    const table: Record<string, unknown> = {};
    for (const side of ['both', 'one', 'other'] as const) {
      for (const flip of [false, true]) {
        for (const thickness of ['2 mm', '5 mm']) {
          const key = `${side} ${flip ? 'flipped' : ''} ${thickness}`;
          engine.clear();
          seen.clear();
          const { features } = bracket();
          const line = ribLine(DIAGONAL.from, DIAGONAL.to);
          const result = await run([
            ...features,
            line.feature,
            rib(line.line, { side, flip, thickness }),
          ]);
          const s = status(result, 'R');
          if (s.status === 'error') {
            table[key] = { error: s.message };
            continue;
          }
          const m = shapeOf();
          table[key] = {
            volume: round(m.volume, 2),
            bbox: [...m.min, ...m.max].map((v) => round(v, 2)),
            faces: m.faces,
            solids: m.solids,
            valid: m.valid,
            ribFaces: faceNames(result)
              .filter((n) => n.startsWith('rib:R:'))
              .sort(),
            data: {
              origin: round3(data()?.origin),
              towards: round3(data()?.towards),
              band: data()?.band,
            },
          };
        }
      }
    }
    await expect(`${JSON.stringify(table, null, 1)}\n`).toMatchFileSnapshot(
      './golden/rib-options.json',
    );
  });
});
