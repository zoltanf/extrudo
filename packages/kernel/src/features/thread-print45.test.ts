// The print45 thread profile (P4-12, ADR-0056's fourth amendment) through the
// recompute engine with real OCCT: a print screw and a print nut (Fit the
// face) clear each other, the cut matches the profile's section area, a hole
// at a size's own diameter gets that size, and the new warnings say what a
// bore wider than the minor (or a shaft thinner than the major) does.
// `thread.test.ts` has the ISO side and the golden table; the cases here live
// in their own file so the next slice's tests don't collide.
import {
  CYLINDER_TYPE,
  type ExtrudoDocument,
  extrudeInputs,
  type Feature,
  type FeatureId,
  FeatureRegistry,
  type FeatureStatus,
  type GeomRef,
  originPlaneRef,
  primitiveInputs,
  type SketchData,
  sketchInputs,
  THREAD_TYPE,
  type ThreadInputOptions,
  threadInputs,
  threadProfile,
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

// ------------------------------------------------------------------ helpers

function thread(id: string, options: ThreadInputOptions): Feature {
  return { ...testFeature(id, THREAD_TYPE), inputs: threadInputs(options) };
}

/** A cylinder primitive on XY: Ø`diameter`, z 0…`height` (body `C:0`). */
function cylinder(id: string, diameter: number, height: number): Feature {
  return {
    ...testFeature(id, CYLINDER_TYPE),
    inputs: primitiveInputs('cylinder', {
      numbers: { diameter: `${diameter} mm`, height: `${height} mm` },
    }),
  };
}
const wall = (id: string): GeomRef => ({ kind: 'face', id: `cylinder:${id}:side:wall` });

function sketch(id: string, data: SketchData, plane = originPlaneRef('origin:xy')): Feature {
  return { ...testFeature(id, 'sketch'), inputs: sketchInputs(plane, data) };
}

function rect(b: SketchBuilder, x: number, y: number, w: number, h: number) {
  const lines = [
    b.line(x, y, x + w, y),
    b.line(x + w, y, x + w, y + h),
    b.line(x + w, y + h, x, y + h),
    b.line(x, y + h, x, y),
  ];
  return lines.map((l) => l.id);
}

/** A block x, y ±10, z 0…`height` with a round hole Ø`hole` through it (body `E:0`); its wall `extrude:E:side:<circle>`. */
function blockWithHole(hole: number, height: number): { features: Feature[]; wall: GeomRef } {
  const b = new SketchBuilder();
  rect(b, -10, -10, 20, 20);
  const circle = b.circle(0, 0, hole / 2);
  const outer =
    detectProfiles(b.sketch).find((p) => p.holes.length > 0) ?? detectProfiles(b.sketch)[0];
  if (!outer) throw new Error('no profile');
  return {
    features: [
      sketch('S', b.sketch),
      {
        ...testFeature('E', 'extrude'),
        inputs: extrudeInputs([{ kind: 'profile', id: `S/${outer.id}` }], {
          distance: `${height} mm`,
        }),
      },
    ],
    wall: { kind: 'face', id: `extrude:E:side:${circle.id}` },
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

function measure(result: Done, body: string) {
  const found = result.bodies.find((b) => b.id === body);
  const shape = bodyShapes.get(body) as ShapeHandle | undefined;
  if (!found || shape === undefined) throw new Error(`no body ${body}`);
  const p = kernel.properties(shape);
  const solids = kernel.solids(shape);
  kernel.release(...solids);
  return {
    shape,
    volume: p.volume,
    bbox: p.bbox,
    faces: kernel.count(shape, 'face'),
    solids: solids.length,
    valid: kernel.isValid(shape),
    names: found.mesh?.faceIds ?? [],
  };
}

const round = (x: number, digits = 3) => {
  const r = Number(x.toFixed(digits));
  return Object.is(r, -0) ? 0 : r;
};

/** The thread's own face names, without `#n`, sorted and unique. */
const threadNames = (names: readonly string[]) =>
  [
    ...new Set(names.filter((n) => n.startsWith('thread:')).map((n) => n.replace(/#\d+$/, ''))),
  ].sort();

const dataOf = (id: string) => seen.get(id)?.data as ThreadOutputData;

/** A profile's outline as a polygon in (axial, radial), sampling its arcs. */
function flattenProfile(
  segments: ReturnType<typeof threadProfile>['segments'],
): [number, number][] {
  const last = segments[segments.length - 1];
  const points: [number, number][] = [];
  let at: [number, number] = last ? [last.to[0], last.to[1]] : [0, 0];
  for (const segment of segments) {
    if (segment.kind === 'line') {
      points.push([segment.to[0], segment.to[1]]);
    } else {
      const [cx, cy] = segment.centre;
      const r = Math.hypot(at[0] - cx, at[1] - cy);
      const a0 = Math.atan2(at[1] - cy, at[0] - cx);
      const a1 = Math.atan2(segment.to[1] - cy, segment.to[0] - cx);
      let sweep = a1 - a0;
      if (segment.ccw) while (sweep <= 0) sweep += 2 * Math.PI;
      else while (sweep >= 0) sweep -= 2 * Math.PI;
      const steps = 24;
      for (let k = 1; k <= steps; k++) {
        const angle = a0 + (sweep * k) / steps;
        points.push([cx + r * Math.cos(angle), cy + r * Math.sin(angle)]);
      }
    }
    at = [segment.to[0], segment.to[1]];
  }
  return points;
}

/** Clips a polygon to `radial <= depth` (Sutherland–Hodgman). */
function clipAtRoot(points: [number, number][], depth: number): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < points.length; i++) {
    const a = points[i] as [number, number];
    const b = points[(i + 1) % points.length] as [number, number];
    const aIn = a[1] <= depth;
    const bIn = b[1] <= depth;
    if (aIn) out.push(a);
    if (aIn !== bIn) {
      const t = (depth - a[1]) / (b[1] - a[1]);
      out.push([a[0] + t * (b[0] - a[0]), depth]);
    }
  }
  return out;
}

/** A polygon's area and centroid in (axial, radial). */
function areaCentroid(points: [number, number][]) {
  let a2 = 0;
  let ca = 0;
  let cr = 0;
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i] as [number, number];
    const [x2, y2] = points[(i + 1) % points.length] as [number, number];
    const cross = x1 * y2 - x2 * y1;
    a2 += cross;
    ca += (x1 + x2) * cross;
    cr += (y1 + y2) * cross;
  }
  return { area: Math.abs(a2) / 2, ca: ca / (3 * a2), cr: cr / (3 * a2) };
}

/** The groove's cross-section area (one pitch) and the radius of its centroid. */
function grooveOf(profile: 'print45', pitch: number, crest: number, depth: number) {
  const shape = threadProfile(profile, pitch);
  const tooth = clipAtRoot(flattenProfile(shape.segments), depth);
  const t = areaCentroid(tooth);
  const rectArea = depth * pitch;
  const grooveArea = rectArea - t.area;
  const cr = ((depth / 2) * rectArea - t.cr * t.area) / grooveArea;
  return { grooveArea, centroidRadius: crest - cr };
}

// -------------------------------------------------------------------- tests

describe('print45 threads', { timeout: 300_000 }, () => {
  it('cuts Print 10 × 2.75 into a Ø10 × 20 cylinder: crests at 9.8, names, volume', async () => {
    const P = 2.75;
    const tol = 0.1;
    const radii = threadRadii('print45', 10, P, tol, false);
    const result = ok(
      await runWithShapes(
        testDocument([
          cylinder('C', 10, 20),
          thread('T', {
            faces: [wall('C')],
            numbers: { diameter: '10 mm', pitch: `${P} mm`, tolerance: `${tol} mm` },
            profile: 'print45',
          }),
        ]),
      ),
    );
    const m = measure(result, 'C:0');
    expect(m.valid).toBe(true);
    expect(m.solids).toBe(1);
    // The crests are the major diameter less twice the tolerance: 4.9 across
    // the half (the shaft's Ø10 surface is cut down to them).
    expect(round(m.bbox.max[0], 2)).toBe(4.9);
    expect(round(m.bbox.min[0], 2)).toBe(-4.9);
    expect(round(m.bbox.max[2], 6)).toBe(20);
    expect(threadNames(m.names)).toEqual([
      'thread:T:side:f0.crest',
      'thread:T:side:f0.flank0',
      'thread:T:side:f0.flank1',
      'thread:T:side:f0.lead0',
      'thread:T:side:f0.lead1',
      'thread:T:side:f0.root',
    ]);
    expect(dataOf('T').faces[0]).toMatchObject({
      internal: false,
      profile: 'print45',
      designation: 'Print 10 × 2.75',
    });
    // The material taken off: the groove's own section swept along the helix
    // (the method of thread.test.ts's section-area test), plus the band above
    // the crests, turned down over the whole length. The two lead-in cones
    // cut the tooth back a little more at the ends, a few percent more.
    const removed = Math.PI * 5 ** 2 * 20 - m.volume;
    const { grooveArea, centroidRadius } = grooveOf('print45', P, radii.crest, radii.depth);
    const turns = 20 / P;
    const helix = turns * Math.sqrt((2 * Math.PI * centroidRadius) ** 2 + P ** 2);
    const expected = grooveArea * helix + Math.PI * (5 ** 2 - radii.crest ** 2) * 20;
    expect(removed / expected).toBeGreaterThan(0.98);
    expect(removed / expected).toBeLessThan(1.1);
  });

  it('a print screw and a print nut from Fit the face clear each other', async () => {
    const block = blockWithHole(8.35, 6); // the print-10 tap drill (10 − 2 × 0.825)
    const doc = testDocument([
      ...block.features,
      cylinder('C', 10, 6),
      thread('TN', { faces: [block.wall], profile: 'print45' }),
      thread('TS', { faces: [wall('C')], profile: 'print45' }),
    ]);
    const result = ok(await runWithShapes(doc));
    const nut = measure(result, 'E:0');
    const screw = measure(result, 'C:0');
    expect(nut.valid && screw.valid).toBe(true);
    expect(dataOf('TN').faces[0]).toMatchObject({ internal: true, designation: 'Print 10 × 2.75' });
    expect(dataOf('TS').faces[0]).toMatchObject({
      internal: false,
      designation: 'Print 10 × 2.75',
    });
    const overlap = kernel.common(nut.shape, screw.shape);
    expect(kernel.measure(overlap.shape).volume).toBeLessThan(1e-4);
    kernel.release(overlap.shape);
    expect(kernel.distance(nut.shape, screw.shape)).toBeGreaterThan(0.09);
  });

  it('warns when a bore is past the minor or a shaft under the major, and still cuts', async () => {
    // M5 typed into a hole drawn at Ø5: the nominal size, but the bore is
    // already past the thread's minor diameter.
    engine.clear();
    const hole = blockWithHole(5, 6);
    const inWide = await runWithShapes(
      testDocument([
        ...hole.features,
        thread('T', { faces: [hole.wall], numbers: { diameter: '5 mm', pitch: '0.8 mm' } }),
      ]),
    );
    const wide = status(inWide, 'T');
    expect(wide.status).toBe('warning');
    expect(wide.message).toBe(
      "The hole is 5 mm across, wider than the M5 thread's minor diameter (4.334 mm): only the outer part of the tooth is cut. Draw the hole at about 4.1 mm for a full thread.",
    );
    expect(measure(inWide, 'E:0').valid).toBe(true);

    // M5 on a Ø4.5 shaft: the teeth would stand off the surface.
    engine.clear();
    const onThin = await runWithShapes(
      testDocument([
        cylinder('C', 4.5, 6),
        thread('T', { faces: [wall('C')], numbers: { diameter: '5 mm', pitch: '0.8 mm' } }),
      ]),
    );
    const thin = status(onThin, 'T');
    expect(thin.status).toBe('warning');
    expect(thin.message).toBe(
      "The shaft is 4.5 mm across, thinner than the M5 thread's major diameter (4.8 mm): only the outer part of the tooth is cut. Make the shaft 5 mm for a full thread.",
    );
    expect(measure(onThin, 'C:0').valid).toBe(true);
  });

  it('fits print sizes to a nominal hole and a tap-drill hole, and refuses others', async () => {
    // A hole drawn at the size's own diameter is that size (Ø5 → Print 5 × 1.5);
    // the bore is wider than the tooth's tip, so it also warns.
    engine.clear();
    const block = blockWithHole(5, 6);
    const nominal = await runWithShapes(
      testDocument([...block.features, thread('T', { faces: [block.wall], profile: 'print45' })]),
    );
    expect(dataOf('T').faces[0]).toMatchObject({ designation: 'Print 5 × 1.5', diameter: 5 });
    expect(status(nominal, 'T').status).toBe('warning');
    expect(measure(nominal, 'E:0').valid).toBe(true);

    // The tap drill (Ø4.1, the print-5 minor) fits the same size, no warning.
    engine.clear();
    const drilled = blockWithHole(4.1, 6);
    const tap = await runWithShapes(
      testDocument([
        ...drilled.features,
        thread('T', { faces: [drilled.wall], profile: 'print45' }),
      ]),
    );
    expect(status(tap, 'T').status).toBe('ok');
    expect(dataOf('T').faces[0]).toMatchObject({ designation: 'Print 5 × 1.5', diameter: 5 });
    expect(measure(tap, 'E:0').valid).toBe(true);

    // A profile with no fit table still needs a size.
    engine.clear();
    const refused = await run(
      testDocument([
        cylinder('C', 20, 5),
        thread('T', { faces: [wall('C')], profile: 'trapezoidal' }),
      ]),
    );
    const s = status(refused, 'T');
    expect(s.status).toBe('error');
    expect(s.message).toBe('Enter a diameter and pitch for a trapezoidal thread.');
  });
});
