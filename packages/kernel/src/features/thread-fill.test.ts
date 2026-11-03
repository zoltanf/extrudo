// The fill (P4-12, ADR-0056's fifth amendment) through the recompute engine
// with real OCCT: a hole drawn wider than the thread's minor diameter is
// filled in to it along the thread before the cut, a shaft thinner than the
// major is built up to it, so a part drawn at the nominal sizes (a Ø5 hole
// for M5) threads fully. The harness is `thread.test.ts`'s.
import {
  CYLINDER_TYPE,
  type ExtrudoDocument,
  extrudeInputs,
  type Feature,
  type FeatureId,
  FeatureRegistry,
  type FeatureStatus,
  type GeomRef,
  HOLE_TYPE,
  holeInputs,
  originPlaneRef,
  primitiveInputs,
  type SketchData,
  sketchInputs,
  THREAD_TYPE,
  type ThreadInputOptions,
  type ThreadProfileName,
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

function profileRefs(sketchId: string, data: SketchData): GeomRef[] {
  return detectProfiles(data).map((p) => ({ kind: 'profile' as const, id: `${sketchId}/${p.id}` }));
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

/** Whether a 0.05 mm cube centred at `at` overlaps the shape. */
function solidAt(shape: ShapeHandle, at: readonly [number, number, number]): boolean {
  const h = 0.025;
  const probe = kernel.box([2 * h, 2 * h, 2 * h], [at[0] - h, at[1] - h, at[2] - h]);
  const common = kernel.common(shape, probe);
  const volume = kernel.measure(common.shape).volume;
  kernel.release(probe, common.shape);
  return volume > 1e-6;
}

/** The thread's own face names, without `#n`, sorted and unique. */
const threadNames = (names: readonly string[]) =>
  [
    ...new Set(names.filter((n) => n.startsWith('thread:')).map((n) => n.replace(/#\d+$/, ''))),
  ].sort();

const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env;

const round = (x: number, digits = 3) => Number(x.toFixed(digits));

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

/** The groove's cross-section area (one pitch) and the radius of its centroid; a hole's grows outward. */
function grooveOf(
  profile: ThreadProfileName,
  pitch: number,
  crest: number,
  depth: number,
  internal: boolean,
) {
  const shape = threadProfile(profile, pitch, { internal });
  const tooth = clipAtRoot(flattenProfile(shape.segments), depth);
  const t = areaCentroid(tooth);
  const rectArea = depth * pitch;
  const grooveArea = rectArea - t.area;
  const cr = ((depth / 2) * rectArea - t.cr * t.area) / grooveArea;
  return { grooveArea, centroidRadius: internal ? crest + cr : crest - cr };
}

/** A cut through a body lying along X: a Ø`hole` bore along Z through a Ø12 × 20 cylinder (body `X:0`). */
function crossBore(hole: number): { features: Feature[]; wall: GeomRef } {
  const rod = new SketchBuilder();
  rod.circle(0, 0, 6);
  const bore = new SketchBuilder();
  const circle = bore.circle(0, 0, hole / 2);
  return {
    features: [
      sketch('SX', rod.sketch, originPlaneRef('origin:yz')),
      {
        ...testFeature('X', 'extrude'),
        inputs: extrudeInputs(profileRefs('SX', rod.sketch), {
          direction: 'symmetric',
          distance: '20 mm',
        }),
      },
      sketch('SB', bore.sketch),
      {
        ...testFeature('B', 'extrude'),
        inputs: extrudeInputs(profileRefs('SB', bore.sketch), {
          direction: 'symmetric',
          distance: '16 mm',
          operation: 'cut',
        }),
      },
    ],
    wall: { kind: 'face', id: `extrude:B:side:${circle.id}` },
  };
}

/** How many of `count` points at radius `rho` on +Y, z from `z0` to `z1`, lie in the shape. */
function solidAlong(shape: ShapeHandle, rho: number, z0: number, z1: number, count = 40): number {
  let n = 0;
  for (let i = 0; i < count; i++) {
    if (solidAt(shape, [0, rho, z0 + ((z1 - z0) * i) / (count - 1)])) n++;
  }
  return n;
}

/** The groove a thread takes out of a face at its crest over `length` (Pappus along the helix). */
function grooveVolume(
  profile: ThreadProfileName,
  d: number,
  p: number,
  internal: boolean,
  length: number,
) {
  const radii = threadRadii(profile, d, p, 0.1, internal);
  const { grooveArea, centroidRadius } = grooveOf(profile, p, radii.crest, radii.depth, internal);
  const turns = length / p;
  return grooveArea * turns * Math.sqrt((2 * Math.PI * centroidRadius) ** 2 + p ** 2);
}

const FILLED =
  "The hole is 5 mm across, wider than the M5 thread's minor diameter (4.334 mm): it is filled in to it along the thread.";

/** Every feature ok, or warning only that a face was filled in or built up. */
function filledOk(result: Done): Done {
  for (const [id, s] of Object.entries(result.features)) {
    if (s.status === 'ok') continue;
    if (s.status === 'warning' && /filled in to it|built up to it/.test(s.message ?? '')) continue;
    throw new Error(`${id}: ${s.status} ${s.message ?? ''}`);
  }
  return result;
}

const warningOf = (result: Done, id: string) => {
  const s = status(result, id);
  return s.status === 'warning' ? s.message : undefined;
};

describe('thread fill', { timeout: 300_000 }, () => {
  const m5in = threadRadii('iso', 5, 0.8, 0.1, true);
  const m5out = threadRadii('iso', 5, 0.8, 0.1, false);

  it('fills a Ø5 hole in to M5’s minor diameter along the thread, then cuts a full tooth', async () => {
    const block = blockWithHole(5, 10);
    const result = await runWithShapes(
      testDocument([
        ...block.features,
        thread('T', {
          faces: [block.wall],
          numbers: { diameter: '5 mm', pitch: '0.8 mm' },
          chamfer: false,
        }),
      ]),
    );
    // Ø5 is 0.666 mm over the minor's Ø4.334, more than the thread's depth (0.541 mm): a note.
    expect(warningOf(result, 'T')).toBe(FILLED);
    const m = measure(result, 'E:0');
    expect(m.valid).toBe(true);
    expect(m.solids).toBe(1);
    expect(dataOf('T').faces[0]).toMatchObject({ internal: true, designation: 'M5', face: 5 });
    // The material is a bore at the crest (Ø4.534) less the groove.
    const expected =
      20 * 20 * 10 - Math.PI * m5in.crest ** 2 * 10 - grooveVolume('iso', 5, 0.8, true, 10);
    expect(Math.abs(m.volume - expected) / (4000 - expected)).toBeLessThan(0.02);
    // Nothing inside the crest, tooth between crest and the drawn Ø5, matter past the root.
    expect(solidAlong(m.shape, m5in.crest - 0.03, 1, 9)).toBe(0);
    const tooth = solidAlong(m.shape, m5in.crest + 0.03, 1, 9);
    expect(tooth).toBeGreaterThan(5);
    expect(tooth).toBeLessThan(35);
    expect(solidAlong(m.shape, 2.45, 1, 9)).toBeGreaterThan(0);
    expect(solidAlong(m.shape, m5in.root + 0.03, 1, 9)).toBe(40);
    expect(solidAlong(m.shape, m5in.root - 0.03, 1, 9)).toBeLessThan(40);
    const names = threadNames(m.names);
    for (const piece of ['crest', 'flank0', 'flank1', 'root']) {
      expect(names).toContain(`thread:T:side:f0.${piece}`);
    }
    // The sleeve's own faces are cut away with the ring (its band lies inside it).
    expect(names.filter((n) => n.includes('.fill'))).toEqual([]);
  });

  it('refuses M4 in a Ø5 hole (past its root) and gives M6 there with no fill', async () => {
    const block = blockWithHole(5, 10);
    const m4 = await run(
      testDocument([
        ...block.features,
        thread('T', { faces: [block.wall], numbers: { diameter: '4 mm', pitch: '0.7 mm' } }),
      ]),
    );
    expect(status(m4, 'T').status).toBe('error');
    expect(status(m4, 'T').message).toMatch(/as wide as the M4 thread/);
    engine.clear();
    const m6 = await runWithShapes(
      testDocument([
        ...block.features,
        thread('T', { faces: [block.wall], numbers: { diameter: '6 mm', pitch: '1 mm' } }),
      ]),
    );
    // M6's minor with the tolerance is Ø5.117: the Ø5 hole is bored out, not filled.
    expect(status(m6, 'T')).toEqual({ status: 'ok' });
    expect(measure(m6, 'E:0').valid).toBe(true);
    expect(dataOf('T').faces[0]?.designation).toBe('M6');
  });

  it('Fit the face on a Ø5 hole cuts as much as M5 at the tap drill', async () => {
    const volume = async (hole: number) => {
      engine.clear();
      const block = blockWithHole(hole, 10);
      const result = filledOk(
        await runWithShapes(
          testDocument([...block.features, thread('T', { faces: [block.wall] })]),
        ),
      );
      expect(dataOf('T').faces[0]?.designation).toBe('M5');
      const m = measure(result, 'E:0');
      expect(m.valid).toBe(true);
      return m.volume;
    };
    const nominal = await volume(5);
    const tapDrill = await volume(4.2);
    expect(Math.abs(nominal - tapDrill) / tapDrill).toBeLessThan(0.01);
  });

  it('builds a Ø4 pin up to M5 and says so', async () => {
    const pin = async (diameter: number) => {
      engine.clear();
      const result = await runWithShapes(
        testDocument([
          cylinder('C', diameter, 20),
          thread('T', { faces: [wall('C')], numbers: { diameter: '5 mm', pitch: '0.8 mm' } }),
        ]),
      );
      const m = measure(result, 'C:0');
      expect(m.valid).toBe(true);
      expect(m.solids).toBe(1);
      return { result, m };
    };
    const thin = await pin(4);
    // Ø4 is 0.8 mm under the crest's Ø4.8, more than the thread's depth: a note.
    expect(warningOf(thin.result, 'T')).toBe(
      "The shaft is 4 mm across, thinner than the M5 thread's major diameter (4.8 mm): it is built up to it along the thread.",
    );
    // The crests at Ø4.8, the root at the root.
    expect(thin.m.bbox.max[0]).toBeLessThanOrEqual(m5out.crest + 0.01);
    expect(thin.m.bbox.max[0]).toBeGreaterThan(m5out.crest - 0.01);
    expect(solidAlong(thin.m.shape, m5out.root - 0.03, 2, 18)).toBe(40);
    expect(solidAlong(thin.m.shape, m5out.root + 0.03, 2, 18)).toBeLessThan(40);
    expect(solidAlong(thin.m.shape, 2.1, 2, 18)).toBeGreaterThan(0);
    const thick = await pin(5);
    expect(status(thick.result, 'T')).toEqual({ status: 'ok' });
    expect(Math.abs(thin.m.volume - thick.m.volume) / thick.m.volume).toBeLessThan(0.01);
  });

  it('fills a short thread only along its run', async () => {
    const block = blockWithHole(5, 10);
    const result = filledOk(
      await runWithShapes(
        testDocument([
          ...block.features,
          thread('T', {
            faces: [block.wall],
            extent: 'length',
            numbers: { diameter: '5 mm', pitch: '0.8 mm', length: '4 mm', offset: '2 mm' },
          }),
        ]),
      ),
    );
    const m = measure(result, 'E:0');
    expect(m.valid).toBe(true);
    expect(dataOf('T').faces[0]).toMatchObject({ from: 2, to: 6, lead: [false, false] });
    // Between the crest and the drawn bore: matter only along the thread.
    expect(solidAlong(m.shape, 2.45, 0.2, 1.9)).toBe(0);
    expect(solidAlong(m.shape, 2.45, 6.1, 9.8)).toBe(0);
    expect(solidAlong(m.shape, 2.45, 2.1, 5.9)).toBeGreaterThan(0);
    // Past the drawn bore and short of the root, the groove only along the thread too.
    expect(solidAlong(m.shape, 2.55, 0.2, 1.9)).toBe(40);
    expect(solidAlong(m.shape, 2.55, 6.1, 9.8)).toBe(40);
    const names = threadNames(m.names);
    expect(names).toContain('thread:T:side:f0.root');
  });

  it('trims a cross bore’s sleeve to the curved wall it comes out of', async () => {
    const volumeOf = async (hole: number) => {
      engine.clear();
      const bore = crossBore(hole);
      const result = await runWithShapes(
        testDocument([
          ...bore.features,
          thread('T', { faces: [bore.wall], numbers: { diameter: '5 mm', pitch: '0.8 mm' } }),
        ]),
      );
      return { result, m: measure(result, 'X:0') };
    };
    const filled = await volumeOf(5);
    expect(warningOf(filled.result, 'T')).toBe(FILLED);
    expect(filled.m.valid).toBe(true);
    expect(filled.m.solids).toBe(1);
    // Nothing stands out of the Ø12 rod: its box, and a point just outside it
    // over the hole's edge where an untrimmed sleeve would stand.
    expect(filled.m.bbox.max[1]).toBeLessThan(6.01);
    expect(filled.m.bbox.max[2]).toBeLessThan(6.01);
    expect(solidAt(filled.m.shape, [0, 2.4, 5.9])).toBe(false);
    expect(solidAt(filled.m.shape, [0, -2.4, -5.9])).toBe(false);
    // As much as the same thread in a bore drawn at the crest: the fill is exactly the hull's.
    const atCrest = await volumeOf(2 * m5in.crest - 0.02);
    expect(atCrest.m.valid).toBe(true);
    expect(Math.abs(filled.m.volume - atCrest.m.volume) / atCrest.m.volume).toBeLessThan(0.01);
  });

  it('fills a blind hole, drill point or flat floor, closing it with its floor for the trim', async () => {
    for (const tipAngle of ['118 deg', '0 deg']) {
      engine.clear();
      const result = await runWithShapes(
        testDocument([
          cylinder('C', 16, 12),
          {
            ...testFeature('H', HOLE_TYPE),
            inputs: holeInputs({
              plane: { kind: 'face', id: 'cylinder:C:cap:end' },
              extent: 'blind',
              numbers: { diameter: '5 mm', depth: '8 mm', tipAngle },
            }),
          },
          thread('T', {
            faces: [{ kind: 'face', id: 'hole:H:side:wall' }],
            numbers: { diameter: '5 mm', pitch: '0.8 mm' },
          }),
        ]),
      );
      // Filled (the note), not left as drawn.
      expect(warningOf(result, 'T'), tipAngle).toBe(FILLED);
      const m = measure(result, 'C:0');
      expect(m.valid, tipAngle).toBe(true);
      expect(m.solids).toBe(1);
      expect(round(m.bbox.max[2], 3)).toBe(12);
      // Matter between the crest and the drawn bore, half way down.
      expect(solidAlong(m.shape, 2.45, 6, 10)).toBeGreaterThan(0);
    }
  });

  it('fills a bore that another one crosses, keeping the cross bore open', async () => {
    const block = blockWithHole(5, 10);
    const cross = new SketchBuilder();
    cross.circle(0, 5, 1.5);
    const result = await runWithShapes(
      testDocument([
        ...block.features,
        sketch('SC', cross.sketch, originPlaneRef('origin:yz')),
        {
          ...testFeature('XC', 'extrude'),
          inputs: extrudeInputs(profileRefs('SC', cross.sketch), {
            direction: 'symmetric',
            distance: '30 mm',
            operation: 'cut',
          }),
        },
        thread('T', { faces: [block.wall], numbers: { diameter: '5 mm', pitch: '0.8 mm' } }),
      ]),
    );
    // Remove Faces closes the Z bore with the cross bore still in the hull,
    // so the trim keeps the sleeve out of the cross bore.
    expect(warningOf(result, 'T')).toBe(FILLED);
    const m = measure(result, 'E:0');
    expect(m.valid).toBe(true);
    expect(m.solids).toBe(1);
    for (const x of [2.35, -2.35]) expect(solidAt(m.shape, [x, 0, 5])).toBe(false);
    expect(solidAlong(m.shape, 2.45, 1, 3)).toBeGreaterThan(0);
  });

  it('an M5 screw on a Ø4.5 pin and an M5 nut in a Ø5 hole clear each other', async () => {
    const block = blockWithHole(5, 6);
    const result = filledOk(
      await runWithShapes(
        testDocument([
          ...block.features,
          cylinder('C', 4.5, 6),
          thread('TN', { faces: [block.wall], numbers: { diameter: '5 mm', pitch: '0.8 mm' } }),
          thread('TS', { faces: [wall('C')], numbers: { diameter: '5 mm', pitch: '0.8 mm' } }),
        ]),
      ),
    );
    const nut = measure(result, 'E:0');
    const screw = measure(result, 'C:0');
    expect(nut.valid && screw.valid).toBe(true);
    const overlap = kernel.common(nut.shape, screw.shape);
    expect(kernel.measure(overlap.shape).volume).toBeLessThan(1e-4);
    kernel.release(overlap.shape);
    expect(kernel.distance(nut.shape, screw.shape)).toBeGreaterThan(0.09);
  });

  // Recompute times for the amendment (BENCH=1): M5 in a Ø5 hole (filled) and at the tap drill.
  it.runIf(env?.BENCH)('times a filled thread against an unfilled one', async () => {
    const lines: string[] = [];
    for (const hole of [5, 4.2, 5, 4.2]) {
      engine.clear();
      const block = blockWithHole(hole, 10);
      const base = await run(testDocument(block.features));
      const t0 = performance.now();
      const result = await runWithShapes(
        testDocument([
          ...block.features,
          thread('T', { faces: [block.wall], numbers: { diameter: '5 mm', pitch: '0.8 mm' } }),
        ]),
      );
      const ms = performance.now() - t0;
      const m = measure(result, 'E:0');
      lines.push(
        `Ø${hole}: ${Math.round(ms)} ms (engine ${Math.round(result.stats.ms)}, base ${Math.round(base.stats.ms)}), ${m.volume.toFixed(3)} mm³, ${m.faces} faces, valid ${m.valid}`,
      );
    }
    expect(lines.join('\n')).toBe('');
  });
});
