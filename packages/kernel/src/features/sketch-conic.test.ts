// Exact conics in the kernel (P4-12, ADR-0063's amendment "Exact conics in the
// kernel"): a sketch conic reaches OCCT as the rational quadratic Bézier it is
// (facade `sketchConic`), not as the cubic within 1e-5 mm the app draws, so the
// faces, solids and STEP files made of it are exact. Real OCCT in Node,
// `strictLeaks` like the other feature tests.
import {
  conicSpline,
  type ExtrudoDocument,
  extrudeInputs,
  type Feature,
  FeatureRegistry,
  originPlaneRef,
  type SketchData,
  type SketchEntityId,
  sketchInputs,
  type Vec2,
} from '@extrudo/core';
import { SketchBuilder } from '@extrudo/sketch/fixtures';
import { detectProfiles } from '@extrudo/sketch/profiles';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Kernel, type ShapeHandle } from '../kernel';
import { loadOcct } from '../occt/load';
import type { PlanarCurve, PlanarFrame } from '../planar';
import { RecomputeEngine } from '../recompute/engine';
import { testDocument, testFeature, testFeatures } from '../recompute/testing';
import type { FeatureOutput, KernelFeatureDefinition } from '../recompute/types';
import { planarCurves, type SketchOutputData } from './sketch';

let kernel: Kernel;
let engine: RecomputeEngine;
const seen = new Map<string, FeatureOutput>();

beforeAll(async () => {
  kernel = new Kernel(await loadOcct());
});

beforeEach(() => {
  engine?.clear();
  expect(kernel.stats().liveShapes).toBe(0);
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
  engine = new RecomputeEngine(kernel, registry, { strictLeaks: true });
});

afterAll(() => {
  engine?.clear();
  expect(kernel.stats().liveShapes).toBe(0);
});

type Done = Extract<Awaited<ReturnType<RecomputeEngine['recompute']>>, { status: 'done' }>;

const XY: PlanarFrame = { origin: [0, 0, 0], x: [1, 0, 0], normal: [0, 0, 1] };

/** The three conics of the tests: one chord from (−20, 0) to (20, 0), the shoulder at (0, 15). */
const START: Vec2 = [-20, 0];
const SHOULDER: Vec2 = [0, 15];
const END: Vec2 = [20, 0];

/**
 * The exact conic's area against its chord, `½ ∮ (x dy − y dx)` (the chord lies
 * on y = 0, so only the curve contributes), and its arc length `∫ |c'(t)| dt`:
 * five-point Gauss–Legendre on 400 panels of the rational curve, which is
 * smooth, so the sums are exact to rounding (the parabola's area is 200 to
 * 1e-14).
 */
function exact(rho: number): { area: number; length: number } {
  const w = rho / (1 - rho);
  const nodes = [0, -0.5384693101056831, 0.5384693101056831, -0.906179845938664, 0.906179845938664];
  const weights = [
    0.5688888888888889, 0.4786286704993665, 0.4786286704993665, 0.2369268850561891,
    0.2369268850561891,
  ];
  const panels = 400;
  let area = 0;
  let length = 0;
  for (let p = 0; p < panels; p++) {
    const lo = p / panels;
    const hi = (p + 1) / panels;
    for (let k = 0; k < 5; k++) {
      const t = (lo + hi) / 2 + ((hi - lo) / 2) * (nodes[k] as number);
      const [a, b, c] = [(1 - t) ** 2, 2 * t * (1 - t) * w, t * t];
      const [da, db, dc] = [-2 * (1 - t), 2 * (1 - 2 * t) * w, 2 * t];
      const d = a + b + c;
      const dd = da + db + dc;
      const nx = a * START[0] + b * SHOULDER[0] + c * END[0];
      const ny = a * START[1] + b * SHOULDER[1] + c * END[1];
      const dnx = da * START[0] + db * SHOULDER[0] + dc * END[0];
      const dny = da * START[1] + db * SHOULDER[1] + dc * END[1];
      const dx = (dnx * d - nx * dd) / (d * d);
      const dy = (dny * d - ny * dd) / (d * d);
      const step = ((weights[k] as number) * (hi - lo)) / 2;
      area += (step * ((nx / d) * dy - (ny / d) * dx)) / 2;
      length += step * Math.hypot(dx, dy);
    }
  }
  return { area: Math.abs(area), length };
}

/** A sketch of the conic closed by its chord. */
function conicSketch(rho: number): { data: SketchData; conic: SketchEntityId } {
  const b = new SketchBuilder();
  const conic = b.spline([START, SHOULDER, END] as [number, number][], { mode: 'conic', rho });
  b.line(END[0], END[1], START[0], START[1]);
  return { data: b.sketch, conic: conic.id as SketchEntityId };
}

function sketchFeature(id: string, data: SketchData): Feature {
  return { ...testFeature(id, 'sketch'), inputs: sketchInputs(originPlaneRef('origin:xy'), data) };
}

function extrude(id: string, profile: string): Feature {
  return {
    ...testFeature(id, 'extrude'),
    inputs: extrudeInputs([{ kind: 'profile', id: profile }], { distance: '5 mm' }),
  };
}

async function run(doc: ExtrudoDocument): Promise<Done> {
  const result = await engine.recompute({ doc });
  if (result.status !== 'done') throw new Error('cancelled');
  for (const [id, s] of Object.entries(result.features)) {
    if (s.status !== 'ok') throw new Error(`${id}: ${s.status} ${s.message ?? ''}`);
  }
  return result;
}

const relative = (got: number, want: number) => Math.abs(got - want) / want;

/** Extrudes the closed conic 5 mm through the sketch and extrude features. */
async function extruded(rho: number) {
  const { data } = conicSketch(rho);
  const [profile] = detectProfiles(data);
  if (!profile) throw new Error('no profile');
  const result = await run(
    testDocument([sketchFeature('SK', data), extrude('E', `SK/${profile.id}`)]),
  );
  const sketch = seen.get('SK')?.data as SketchOutputData;
  const [body] = result.bodies;
  if (!body) throw new Error('no body');
  const shape = engine.latestBody(body.id) as ShapeHandle;
  return { result, profile, sketch, shape, volume: kernel.measure(shape).volume };
}

/**
 * The solid the old route made (P4-05: the conic as `conicSpline`'s cubic,
 * staged with `sketchSpline`), for the errors the amendment's Results quote.
 */
function oldRouteVolume(rho: number): number {
  const curve = conicSpline(START, SHOULDER, END, rho);
  const curves: PlanarCurve[] = [
    { kind: 'spline', degree: curve.degree, poles: curve.poles, knots: curve.knots },
    { kind: 'line', a: END, b: START },
  ];
  const faces = kernel.planarFaces(curves, XY, 1e-4).faces;
  try {
    const { shape } = kernel.prism((faces[0] as { shape: ShapeHandle }).shape, [0, 0, 5]);
    try {
      return kernel.measure(shape).volume;
    } finally {
      kernel.release(shape);
    }
  } finally {
    kernel.release(...faces.map((f) => f.shape));
  }
}

describe('exact conics in the kernel (P4-12)', () => {
  it('stages a conic as a conic, every other spline as its B-spline', () => {
    const { data } = conicSketch(0.3);
    const b = new SketchBuilder();
    b.spline(
      [
        [0, 0],
        [10, 5],
        [20, 0],
      ],
      { mode: 'control' },
    );
    expect(planarCurves(b.sketch).curves.map((c) => c.kind)).toEqual(['spline']);
    const { curves } = planarCurves(data);
    // planarCurves keeps entity ID order, not the order they were drawn in.
    expect(curves.map((c) => c.kind).sort()).toEqual(['conic', 'line']);
    expect(curves.find((c) => c.kind === 'conic')).toEqual({
      kind: 'conic',
      start: START,
      shoulder: SHOULDER,
      end: END,
      rho: 0.3,
    });
  });

  it('extrudes a parabola into exactly ⅔ · base · sagitta · 5', async () => {
    // rho 0.5 is the parabola (middle weight 1). Its point at t = ½ is
    // (start + 2·shoulder + end) / 4 = (0, 7.5): the sagitta is half the
    // shoulder's height, and Archimedes' segment between a parabola and a
    // chord is ⅔ of the chord times the sagitta, ⅔ · 40 · 7.5 = 200 mm².
    const segment = 200;
    expect(relative(exact(0.5).area, segment)).toBeLessThan(1e-13);
    const { sketch, volume } = await extruded(0.5);
    expect(relative(sketch.profiles[0]?.area ?? 0, segment)).toBeLessThan(1e-9);
    expect(relative(volume, segment * 5)).toBeLessThan(1e-9);
  });

  for (const [rho, kind] of [
    [0.3, 'an ellipse arc'],
    [0.8, 'a hyperbola arc'],
  ] as const) {
    it(`extrudes ${kind} (rho ${rho}) to its exact area times the distance`, async () => {
      const { area } = exact(rho);
      const { sketch, shape, volume } = await extruded(rho);
      const face = sketch.profiles[0]?.area ?? 0;
      expect(relative(face, area)).toBeLessThan(1e-9);
      expect(relative(volume, area * 5)).toBeLessThan(1e-9);
      expect(relative(kernel.properties(shape).volume, area * 5)).toBeLessThan(1e-9);
      // The side is one face of the conic, as with the cubic: two caps, the
      // chord's wall and the conic's.
      expect(kernel.count(shape, 'face')).toBe(4);
      // The old route, for the record: within the cubic's 1e-5 mm and OCCT's
      // fixed-order integral of its many spans, but not exact.
      // (Measured: 4.0e-7 for rho 0.3, 7.5e-6 for rho 0.8.)
      const old = relative(oldRouteVolume(rho), area * 5);
      expect(old).toBeLessThan(1e-4);
      expect(old).toBeGreaterThan(1e-8);
    });
  }

  it("keys the conic's face with detectProfiles' region ID", async () => {
    const { profile, sketch } = await extruded(0.3);
    expect(sketch.profiles.map((p) => p.id)).toEqual([profile.id]);
    expect(sketch.profiles[0]?.holes).toBe(0);
  });

  it('writes the conic to STEP and reads back the same solid', async () => {
    const rho = 0.8;
    const { shape, volume } = await extruded(rho);
    const text = kernel.writeStep([{ shape, name: 'Conic' }]);
    const back = kernel.readStep(text);
    try {
      const read = kernel.measure(back).volume;
      expect(relative(read, volume)).toBeLessThan(1e-9);
      expect(relative(read, exact(rho).area * 5)).toBeLessThan(1e-9);
      // A rational B-spline curve carries its weights in STEP.
      expect(text).toMatch(/RATIONAL_B_SPLINE_CURVE/);
    } finally {
      kernel.release(back);
    }
  });

  it('chains a conic into a sweep path at its exact length', () => {
    // The path route stages through the same `sketchConic` (P4-01's `path`).
    const path = kernel.path([
      {
        kind: 'curve',
        curve: { kind: 'conic', start: START, shoulder: SHOULDER, end: END, rho: 0.8 },
        frame: XY,
      },
    ]);
    try {
      const length = kernel.properties(path).length;
      // The exact arc length, by the same quadrature.
      expect(relative(length, exact(0.8).length)).toBeLessThan(1e-9);
    } finally {
      kernel.release(path);
    }
  });

  it('refuses a conic whose rho is out of range', () => {
    const curves: PlanarCurve[] = [
      { kind: 'conic', start: START, shoulder: SHOULDER, end: END, rho: 1 },
      { kind: 'line', a: END, b: START },
    ];
    const result = kernel.planarFaces(curves, XY, 1e-4);
    try {
      expect(result.skipped).toEqual([0]);
    } finally {
      kernel.release(...result.faces.map((f) => f.shape));
    }
  });
});
