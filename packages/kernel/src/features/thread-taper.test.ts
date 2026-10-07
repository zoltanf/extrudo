// Tapered threads (P4-12, ADR-0056's third amendment) through the recompute
// engine with real OCCT: a thread on a conical face follows the cone. NPT 1/2
// on a revolved cone (sized and fitted), its crests and lead-ins along the
// slope, the volume it removes against a straight thread of the mean
// diameter, an internal one in a tapered hole, two starts, and the warning and
// the refusal for a taper that isn't the size's.
import {
  CYLINDER_TYPE,
  type ExtrudoDocument,
  extrudeInputs,
  type Feature,
  type FeatureId,
  FeatureRegistry,
  type FeatureStatus,
  type GeomRef,
  NPT_TAPER,
  originAxisRef,
  originPlaneRef,
  primitiveInputs,
  revolveInputs,
  type SketchData,
  sketchInputs,
  THREAD_TYPE,
  type ThreadInputOptions,
  threadInputs,
  threadPreset,
  threadRadii,
} from '@extrudo/core';
import { SketchBuilder } from '@extrudo/sketch/fixtures';
import { detectProfiles } from '@extrudo/sketch/profiles';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Kernel, type ShapeHandle } from '../kernel';
import { loadOcct } from '../occt/load';
import { RecomputeEngine } from '../recompute/engine';
import { testDocument, testFeature, testFeatures } from '../recompute/testing';
import type { FeatureOutput, KernelFeatureDefinition, RecomputeResult } from '../recompute/types';
import type { ThreadOutputData } from './thread';

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
  engine.clear();
  expect(kernel.stats().liveShapes).toBe(0);
});

type Done = Extract<RecomputeResult, { status: 'done' }>;

const NPT_HALF = threadPreset('npt-1q2') as NonNullable<ReturnType<typeof threadPreset>>;
const SIZE = { diameter: NPT_HALF.exprs.diameter as string, pitch: NPT_HALF.exprs.pitch as string };
const T = Math.tan(NPT_TAPER);
/** The cone's length and its radius at z = 0 (NPT 1/2's major radius at the small end). */
const L = 20;
const R0 = NPT_HALF.diameter / 2;
const coneRadius = (z: number, r0 = R0, t = T) => r0 + z * t;

function thread(id: string, options: ThreadInputOptions): Feature {
  return { ...testFeature(id, THREAD_TYPE), inputs: threadInputs(options) };
}

function sketch(id: string, data: SketchData, plane = originPlaneRef('origin:xy')): Feature {
  return { ...testFeature(id, 'sketch'), inputs: sketchInputs(plane, data) };
}

function profileRefs(sketchId: string, data: SketchData): GeomRef[] {
  return detectProfiles(data).map((p) => ({ kind: 'profile' as const, id: `${sketchId}/${p.id}` }));
}

/**
 * A cone turned about Z from a trapezoid in XZ: radius `r0` at z = 0 growing
 * by tan(`taper`) per mm up to z = `length` (body `R:0`), and its side.
 */
function cone(r0 = R0, taper = NPT_TAPER, length = L): { features: Feature[]; side: GeomRef } {
  const b = new SketchBuilder();
  const r1 = r0 + length * Math.tan(taper);
  b.line(0, 0, r0, 0);
  const slope = b.line(r0, 0, r1, length);
  b.line(r1, length, 0, length);
  b.line(0, length, 0, 0);
  return {
    features: [
      sketch('SR', b.sketch, originPlaneRef('origin:xz')),
      {
        ...testFeature('R', 'revolve'),
        inputs: revolveInputs(profileRefs('SR', b.sketch), originAxisRef('origin:z')),
      },
    ],
    side: { kind: 'face', id: `revolve:R:side:${slope.id}` },
  };
}

function cylinder(id: string, diameter: number, height: number): Feature {
  return {
    ...testFeature(id, CYLINDER_TYPE),
    inputs: primitiveInputs('cylinder', {
      numbers: { diameter: `${diameter} mm`, height: `${height} mm` },
    }),
  };
}

async function run(doc: ExtrudoDocument): Promise<Done> {
  const result = await engine.recompute({ doc });
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

let bodyShapes = new Map<string, ShapeHandle>();

async function runWithShapes(doc: ExtrudoDocument): Promise<Done> {
  bodyShapes = new Map();
  const shapes: ShapeHandle[] = [];
  const mesh = kernel.mesh.bind(kernel);
  kernel.mesh = (shape, options) => {
    shapes.push(shape);
    return mesh(shape, options);
  };
  try {
    const result = await run(doc);
    result.bodies.forEach((b, i) => {
      const shape = shapes[i];
      if (shape !== undefined) bodyShapes.set(b.id, shape);
    });
    return result;
  } finally {
    kernel.mesh = mesh;
  }
}

function shapeOf(body: string): ShapeHandle {
  const shape = bodyShapes.get(body);
  if (shape === undefined) throw new Error(`no body ${body}`);
  return shape;
}

/** How far from the Z axis the body reaches in the slab z0…z1: its section's extent. */
function reachIn(shape: ShapeHandle, z0: number, z1: number): number {
  const big = 100;
  const slab = kernel.box([2 * big, 2 * big, z1 - z0], [-big, -big, z0]);
  const common = kernel.common(shape, slab);
  const { bbox } = kernel.properties(common.shape);
  kernel.release(slab, common.shape);
  return Math.max(-bbox.min[0], bbox.max[0], -bbox.min[1], bbox.max[1]);
}

/** A frustum's volume. */
const frustum = (r0: number, r1: number, h: number) =>
  (Math.PI * h * (r0 * r0 + r0 * r1 + r1 * r1)) / 3;

const dataOf = (id: string) => seen.get(id)?.data as ThreadOutputData;

const depth = threadRadii('iso', NPT_HALF.diameter, NPT_HALF.pitch, 0, false).depth;

describe('tapered threads', { timeout: 300_000 }, () => {
  it('cuts NPT 1/2 into a cone: crests and both ends follow the slope', async () => {
    const c = cone();
    const result = ok(
      await runWithShapes(
        testDocument([...c.features, thread('T', { faces: [c.side], numbers: SIZE })]),
      ),
    );
    const shape = shapeOf('R:0');
    expect(kernel.isValid(shape)).toBe(true);
    const face = dataOf('T').faces[0];
    expect(face).toMatchObject({ internal: false, designation: 'NPT 1/2', from: 0, to: L });
    expect(face?.taper).toBeCloseTo((NPT_TAPER * 180) / Math.PI, 6);
    expect(face?.face).toBeCloseTo(2 * R0, 6);
    expect(seen.get('T')?.report).toEqual({ kind: 'thread', designations: ['NPT 1/2'] });
    expect(result.bodies.find((b) => b.id === 'R:0')?.mesh?.faceIds).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^thread:T:side:f0\.crest#\d+$/),
        expect.stringMatching(/^thread:T:side:f0\.lead0/),
        expect.stringMatching(/^thread:T:side:f0\.lead1/),
      ]),
    );
    // Both ends are cut down past the thread's depth by the lead-ins (a 45°
    // cone from just past the root), at the small end and at the large end.
    const small = reachIn(shape, 0, 0.02);
    const large = reachIn(shape, L - 0.02, L);
    expect(coneRadius(0) - small).toBeGreaterThan(depth);
    expect(coneRadius(0) - small).toBeLessThan(depth + 0.5);
    expect(coneRadius(L) - large).toBeGreaterThan(depth);
    expect(coneRadius(L) - large).toBeLessThan(depth + 0.5);
    // In between the crests follow the cone, the tolerance (0.1 mm) under it,
    // a pitch of slab long so that a crest is in it.
    for (const z of [5, 10, 15]) {
      const crest = reachIn(shape, z, z + NPT_HALF.pitch);
      const cone = coneRadius(z + NPT_HALF.pitch) - 0.1;
      expect(crest, `crest at ${z}`).toBeLessThanOrEqual(cone + 1e-4);
      expect(crest, `crest at ${z}`).toBeGreaterThan(cone - 0.08);
    }
    const z = kernel.properties(shape).bbox;
    expect(z.min[2]).toBeCloseTo(0, 6);
    expect(z.max[2]).toBeCloseTo(L, 6);
    // What it removes is within 5 % of a straight thread's on the mean diameter.
    const removed = frustum(coneRadius(0), coneRadius(L), L) - kernel.properties(shape).volume;
    engine.clear();
    const mean = 2 * coneRadius(L / 2);
    ok(
      await runWithShapes(
        testDocument([
          cylinder('C', mean, L),
          thread('S', {
            faces: [{ kind: 'face', id: 'cylinder:C:side:wall' }],
            numbers: { diameter: `${mean} mm`, pitch: SIZE.pitch },
          }),
        ]),
      ),
    );
    const straight = Math.PI * (mean / 2) ** 2 * L - kernel.properties(shapeOf('C:0')).volume;
    expect(Math.abs(removed - straight) / straight).toBeLessThan(0.05);
    // The numbers ADR-0056's third amendment quotes.
    console.log(
      `NPT 1/2 on a cone: small-end reach ${small.toFixed(4)} (cone ${coneRadius(0).toFixed(4)}), large-end ${large.toFixed(4)} (cone ${coneRadius(L).toFixed(4)}), removed ${removed.toFixed(3)} mm³, straight at Ø${mean.toFixed(3)} ${straight.toFixed(3)} mm³`,
    );
  });

  it('fits NPT 1/2 to a cone of its taper without a size, from either end', async () => {
    const c = cone();
    ok(await runWithShapes(testDocument([...c.features, thread('T', { faces: [c.side] })])));
    expect(dataOf('T').faces[0]?.designation).toBe('NPT 1/2');
    // A cone narrowing up: its small end is the face's upper one.
    engine.clear();
    const down = cone(coneRadius(L), -NPT_TAPER);
    ok(await runWithShapes(testDocument([...down.features, thread('T', { faces: [down.side] })])));
    const face = dataOf('T').faces[0];
    expect(face?.designation).toBe('NPT 1/2');
    expect(face?.face).toBeCloseTo(2 * R0, 6);
    expect(kernel.isValid(shapeOf('R:0'))).toBe(true);
  });

  it('cuts two starts on the cone', async () => {
    const c = cone();
    ok(
      await runWithShapes(
        testDocument([
          ...c.features,
          thread('T', { faces: [c.side], numbers: SIZE, starts: '2', chamfer: false }),
        ]),
      ),
    );
    const face = dataOf('T').faces[0];
    expect(face).toMatchObject({ starts: 2, designation: 'NPT 1/2, 2 starts' });
    expect(face?.leadLength).toBeCloseTo(2 * NPT_HALF.pitch, 9);
    expect(kernel.isValid(shapeOf('R:0'))).toBe(true);
  });

  it('cuts an internal NPT 1/2 in a tapered hole', async () => {
    const block = new SketchBuilder();
    block.line(-15, -15, 15, -15);
    block.line(15, -15, 15, 15);
    block.line(15, 15, -15, 15);
    block.line(-15, 15, -15, -15);
    const hole = new SketchBuilder();
    const circle = hole.circle(0, 0, 9.6);
    const doc = testDocument([
      sketch('SB', block.sketch),
      {
        ...testFeature('B', 'extrude'),
        inputs: extrudeInputs(profileRefs('SB', block.sketch), { distance: `${L} mm` }),
      },
      sketch('SH', hole.sketch),
      {
        ...testFeature('H', 'extrude'),
        inputs: extrudeInputs(profileRefs('SH', hole.sketch), {
          distance: `${L} mm`,
          taper: `${(NPT_TAPER * 180) / Math.PI} deg`,
          operation: 'cut',
        }),
      },
      thread('T', {
        faces: [{ kind: 'face', id: `extrude:H:side:${circle.id}` }],
        numbers: SIZE,
      }),
    ]);
    ok(await runWithShapes(doc));
    const face = dataOf('T').faces[0];
    expect(face).toMatchObject({ internal: true, designation: 'NPT 1/2' });
    expect(Math.abs(face?.taper ?? 0)).toBeCloseTo((NPT_TAPER * 180) / Math.PI, 6);
    expect(kernel.isValid(shapeOf('B:0'))).toBe(true);
  });

  it('warns about NPT on a cylinder and still cuts it straight', async () => {
    const result = await runWithShapes(
      testDocument([
        cylinder('C', NPT_HALF.diameter, 8),
        thread('T', { faces: [{ kind: 'face', id: 'cylinder:C:side:wall' }], numbers: SIZE }),
      ]),
    );
    const s = status(result, 'T');
    const face = dataOf('T').faces[0];
    expect(face?.taper).toBe(0);
    expect(face?.designation).toBe(`Ø${Number(NPT_HALF.diameter.toFixed(3))} × 1.814`);
    expect(s.status).toBe('warning');
    expect(s.message).toContain(
      'NPT 1/2 is made for a 1.8° taper, but this face is a cylinder (0°)',
    );
  });

  it('refuses to fit a cone of another taper and names a custom size with it', async () => {
    const steep = cone(10, (5 * Math.PI) / 180, 10);
    const result = await run(
      testDocument([...steep.features, thread('T', { faces: [steep.side] })]),
    );
    expect(status(result, 'T')).toMatchObject({
      status: 'error',
      message: "Enter a diameter and pitch: this cone's taper (5°) isn't a pipe thread's.",
    });
    engine.clear();
    ok(
      await runWithShapes(
        testDocument([
          ...steep.features,
          thread('T', {
            faces: [steep.side],
            numbers: { diameter: '20 mm', pitch: '1.5 mm' },
          }),
        ]),
      ),
    );
    expect(dataOf('T').faces[0]?.designation).toBe('Ø20 × 1.5, taper 5°');
    expect(kernel.isValid(shapeOf('R:0'))).toBe(true);
  });
});
