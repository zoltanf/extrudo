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
  SketchDataSchema,
  type SketchEntityId,
  type SketchSpline,
  sketchInputs,
  splineCurve,
  splinePoint,
  type Vec2,
} from '@extrudo/core';
import { SketchBuilder } from '@extrudo/sketch/fixtures';
import { trim } from '@extrudo/sketch/modify';
import { detectProfiles, profileAt } from '@extrudo/sketch/profiles';
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

describe('closed and trimmed splines in the kernel (P4-12)', () => {
  const loop: [number, number][] = [
    [0, 0],
    [30, -4],
    [36, 20],
    [10, 28],
    [-6, 14],
  ];

  for (const mode of ['fit', 'control'] as const) {
    it(`extrudes a closed ${mode} spline alone into one solid of its area`, async () => {
      const b = new SketchBuilder();
      const s = b.spline(loop, { mode, closed: true });
      const data = b.sketch;
      const profiles = detectProfiles(data);
      expect(profiles).toHaveLength(1);
      const result = ok(
        await run(
          testDocument([
            sketchFeature('SK', data),
            extrude('E', [{ kind: 'profile', id: `SK/${profiles[0]?.id ?? ''}` }]),
          ]),
        ),
      );
      expect(result.bodies).toHaveLength(1);
      // The polygon of a fine polyline of the curve, times the extrude's length.
      const curve = splineCurve(
        data.entities[eid(s.id)] as SketchSpline,
        loop.map((p) => [p[0], p[1]] as Vec2),
      );
      const fine: Vec2[] = [];
      for (let i = 0; i <= 20000; i++) fine.push(splinePoint(curve, i / 20000));
      const area = areaUnder(fine);
      const volume = meshVolume(result);
      expect(Math.abs(volume - area * 5) / (area * 5)).toBeLessThan(1e-4);
      const [body] = result.bodies;
      if (!body) throw new Error('no body');
      expect(kernel.isValid(engine.latestBody(body.id) as ShapeHandle)).toBe(true);
    });
  }

  it("extrudes a profile bounded by a trimmed spline's piece", async () => {
    const b = new SketchBuilder();
    const s = b.spline([
      [0, 0],
      [10, 15],
      [20, 15],
      [30, 0],
      [35, -5],
    ]);
    b.line(25, -10, 25, 30);
    b.line(0, 0, 25, 0);
    const before = b.sketch;
    const change = trim(
      before,
      eid(s.id),
      [32, -2],
      (() => {
        let n = 0;
        return () => `t${n++}`;
      })(),
    );
    const data = SketchDataSchema.parse({
      entities: Object.fromEntries(
        Object.entries({ ...before.entities, ...change.update, ...change.entities }).filter(
          ([key]) => !change.remove?.entities?.includes(key as SketchEntityId),
        ),
      ),
      constraints: Object.fromEntries(
        Object.entries({ ...before.constraints, ...change.constraints }).filter(
          ([key]) => !change.remove?.constraints?.includes(key as never),
        ),
      ),
      dimensions: {},
    });
    expect(data.entities[eid(s.id)]).toMatchObject({ mode: 'control' });
    const profile = profileAt(detectProfiles(data), [12, 5]);
    expect(profile).toBeDefined();
    const result = ok(
      await run(
        testDocument([
          sketchFeature('SK', data),
          extrude('E', [{ kind: 'profile', id: `SK/${profile?.id ?? ''}` }]),
        ]),
      ),
    );
    expect(result.bodies).toHaveLength(1);
    // The region: the kept piece from (0, 0) to the line, down the line, back along the base.
    const piece = data.entities[eid(s.id)] as SketchSpline;
    const curve = splineCurve(
      piece,
      piece.points.map((p) => {
        const e = data.entities[p] as { x: number; y: number };
        return [e.x, e.y] as Vec2;
      }),
    );
    const fine: Vec2[] = [];
    for (let i = 0; i <= 20000; i++) fine.push(splinePoint(curve, i / 20000));
    const area = areaUnder([...fine, [25, 0], [0, 0]]);
    expect(area).toBeGreaterThan(200);
    // The face and the solid follow the piece (OCCT's own integrals, a few 1e-5 out here).
    expect(Math.abs((profileAreas()[0] ?? 0) - area) / area).toBeLessThan(1e-3);
    expect(Math.abs(volumeOf(result) - area * 5) / (area * 5)).toBeLessThan(1e-3);
    const [body] = result.bodies;
    if (!body) throw new Error('no body');
    expect(kernel.isValid(engine.latestBody(body.id) as ShapeHandle)).toBe(true);
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

/**
 * The volume of the bodies from a fine mesh of them (0.2 µm deflection): the
 * mass integral OCCT uses for a prism with B-spline walls is a fixed-order one
 * (ADR-0067 §H3 keeps it there), about 1e-4 out on these loops, while the mesh
 * is within a few 1e-6 of the curve's own polygon.
 */
function meshVolume(result: Done): number {
  let total = 0;
  for (const { id } of result.bodies) {
    const mesh = kernel.exportMesh(engine.latestBody(id) as ShapeHandle, {
      linearDeflection: 0.0002,
      angularDeflection: 0.01,
    });
    const p = mesh.positions;
    const node = (k: number): [number, number, number] => [
      p[3 * k] as number,
      p[3 * k + 1] as number,
      p[3 * k + 2] as number,
    ];
    for (let i = 0; i < mesh.indices.length; i += 3) {
      const a = node(mesh.indices[i] as number);
      const b = node(mesh.indices[i + 1] as number);
      const c = node(mesh.indices[i + 2] as number);
      total +=
        (a[0] * (b[1] * c[2] - b[2] * c[1]) -
          a[1] * (b[0] * c[2] - b[2] * c[0]) +
          a[2] * (b[0] * c[1] - b[1] * c[0])) /
        6;
    }
  }
  return total;
}
