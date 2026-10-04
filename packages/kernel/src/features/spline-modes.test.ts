// Control-point splines and conics in the kernel (P4-05, ADR-0063 §2): the
// sketch evaluator stages each mode's own curve, a sketch closed by a line
// gives one face whose area is the profile's, and the extrude makes one valid
// body. Real OCCT in Node, `strictLeaks` like the other feature tests.
import {
  conicPoint,
  controlSpline,
  type ExtrudoDocument,
  extrudeInputs,
  type Feature,
  type FeatureId,
  FeatureRegistry,
  type FeatureStatus,
  originPlaneRef,
  type SketchData,
  type SketchEntityId,
  sketchInputs,
  splinePoint,
  type Vec2,
} from '@extrudo/core';
import { SketchBuilder } from '@extrudo/sketch/fixtures';
import { detectProfiles } from '@extrudo/sketch/profiles';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Kernel, type ShapeHandle } from '../kernel';
import { loadOcct } from '../occt/load';
import { RecomputeEngine } from '../recompute/engine';
import { testDocument, testFeature, testFeatures } from '../recompute/testing';
import type { FeatureOutput, KernelFeatureDefinition } from '../recompute/types';
import type { SketchOutputData } from './sketch';

let kernel: Kernel;
let engine: RecomputeEngine;
let registry: FeatureRegistry<KernelFeatureDefinition>;
/** The output of each feature's latest evaluation (see the beforeEach wrap). */
const seen = new Map<string, FeatureOutput>();

beforeAll(async () => {
  kernel = new Kernel(await loadOcct());
});

beforeEach(() => {
  engine?.clear();
  expect(kernel.stats().liveShapes).toBe(0);
  registry = new FeatureRegistry<KernelFeatureDefinition>();
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

const eid = (id: string) => id as SketchEntityId;

function sketchFeature(id: string, data: SketchData): Feature {
  return { ...testFeature(id, 'sketch'), inputs: sketchInputs(originPlaneRef('origin:xy'), data) };
}

function extrude(id: string, refs: { kind: 'profile'; id: string }[]): Feature {
  return { ...testFeature(id, 'extrude'), inputs: extrudeInputs(refs, { distance: '5 mm' }) };
}

async function run(doc: ExtrudoDocument): Promise<Done> {
  const result = await engine.recompute({ doc });
  if (result.status !== 'done') throw new Error('cancelled');
  return result;
}

function ok(result: Done): Done {
  for (const [id, s] of Object.entries(result.features)) {
    if (s.status !== 'ok') throw new Error(`${id}: ${s.status} ${s.message ?? ''}`);
  }
  return result;
}

const status = (result: Done, id: string): FeatureStatus =>
  result.features[id as FeatureId] ?? { status: 'ok' };

function volumeOf(result: Done): number {
  let total = 0;
  for (const { id } of result.bodies) {
    const shape = engine.latestBody(id);
    if (!shape) throw new Error(`no body ${id}`);
    total += kernel.measure(shape).volume;
  }
  return total;
}

/** The profile areas the sketch evaluator reported. */
function profileAreas(): number[] {
  const data = seen.get('SK')?.data as SketchOutputData | undefined;
  if (!data) throw new Error('no sketch output');
  return data.profiles.map((profile) => profile.area);
}

/** A sketch with a spline of the given mode, closed by a line from its end to its start. */
function closedSpline(
  mode: 'control' | 'conic',
  points: [number, number][],
  rho?: number,
): { data: SketchData; curve: SketchEntityId } {
  const b = new SketchBuilder();
  const curve = b.spline(points, { mode, rho });
  const [first] = points;
  const last = points[points.length - 1] as [number, number];
  b.line(last[0], last[1], (first as [number, number])[0], (first as [number, number])[1]);
  return { data: b.sketch, curve: eid(curve.id) };
}

describe('control-point splines and conics in the kernel', () => {
  it('makes a face from a control-point spline closed by a line', async () => {
    const poles: [number, number][] = [
      [0, 0],
      [10, 20],
      [25, 12],
      [30, 0],
    ];
    const { data } = closedSpline('control', poles);
    const profiles = detectProfiles(data);
    expect(profiles).toHaveLength(1);
    ok(await run(testDocument([sketchFeature('SK', data)])));

    // The face follows the curve the control points make, which the detector's
    // polyline only reaches from below.
    const exact: Vec2[] = [];
    for (let i = 0; i <= 400; i++) exact.push(splinePoint(controlSpline(poles), i / 400));
    const [face] = profileAreas();
    expect(face).toBeCloseTo(areaUnder([...exact, [0, 0] as Vec2]), 2);
    expect((profiles[0] as { area: number }).area).toBeLessThan(face ?? 0);
    expect(face).toBeGreaterThan(100);
    expect(status(ok(await run(testDocument([sketchFeature('SK', data)]))), 'SK').status).toBe(
      'ok',
    );
  });

  it('makes a face from a conic closed by a line, and extrudes one body', async () => {
    const shoulder: [number, number] = [15, 20];
    const rho = 0.4;
    const { data } = closedSpline('conic', [[0, 0], shoulder, [30, 0]], rho);
    const profiles = detectProfiles(data);
    expect(profiles).toHaveLength(1);
    const doc = testDocument([
      sketchFeature('SK', data),
      extrude('E', [{ kind: 'profile', id: `SK/${profiles[0]?.id ?? ''}` }]),
    ]);
    const result = ok(await run(doc));

    // The face follows the exact conic, not its polyline approximation.
    // The exact area of the conic, from dense samples of it.
    const exact: Vec2[] = [];
    for (let i = 0; i <= 400; i++) exact.push(conicPoint([0, 0], shoulder, [30, 0], rho, i / 400));
    const area = areaUnder(exact);
    const [face] = profileAreas();
    expect(Math.abs((face ?? 0) - area) / area).toBeLessThan(1e-4);
    expect((profiles[0] as { area: number }).area).toBeLessThan(face ?? 0);

    // One body, as thick as the extrude is long.
    expect(result.bodies).toHaveLength(1);
    expect(volumeOf(result)).toBeCloseTo((face ?? 0) * 5, 1);
    const [body] = result.bodies;
    if (!body) throw new Error('no body');
    expect(kernel.isValid(engine.latestBody(body.id) as ShapeHandle)).toBe(true);
  });

  it('rebuilds a conic when its rho changes, without touching the reference', async () => {
    const { data, curve } = closedSpline(
      'conic',
      [
        [0, 0],
        [15, 20],
        [30, 0],
      ],
      0.4,
    );
    const profiles = detectProfiles(data);
    const ref = { kind: 'profile' as const, id: `SK/${profiles[0]?.id ?? ''}` };
    const before = ok(await run(testDocument([sketchFeature('SK', data), extrude('E', [ref])])));
    const beforeVolume = volumeOf(before);
    const beforeArea = profileAreas()[0] ?? 0;
    const fuller: SketchData = {
      ...data,
      entities: {
        ...data.entities,
        [curve]: { ...(data.entities[curve] as object), rho: 0.9 } as never,
      },
    };
    const after = ok(await run(testDocument([sketchFeature('SK', fuller), extrude('E', [ref])])));
    // A fuller conic is shorter, so the face is taller and the extrude longer.
    expect(profileAreas()[0]).toBeGreaterThan(beforeArea);
    expect(volumeOf(after)).toBeGreaterThan(beforeVolume);
    expect(status(after, 'E').status).toBe('ok');
  });
});

/** The area a polyline and the line closing it enclose. */
function areaUnder(polyline: Vec2[]): number {
  let area = 0;
  for (let i = 1; i < polyline.length; i++) {
    const a = polyline[i - 1] as Vec2;
    const b = polyline[i] as Vec2;
    area += (a[0] + b[0]) * (b[1] - a[1]);
  }
  return Math.abs(area / 2);
}
