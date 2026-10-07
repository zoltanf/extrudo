// The thread feature (P4-02, ADR-0056, FR-FT-15) through the recompute engine
// with real OCCT: external threads on a cylinder primitive, an extruded
// circle and a revolved shaft, internal ones in a Hole and an extruded hole,
// sizes (presets, auto), length, offset, flip, hand, lead-ins, tolerance and
// a screw and nut that clear each other, the names (ADR-0005), and errors.
// `golden/thread-options.json` is the golden table (a Vitest file snapshot);
// rewrite it with `pnpm vitest run -u packages/kernel/src/features/thread`.
// Threads are slow to build (about 0.1 s a turn): cases stay short.
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
  originAxisRef,
  originPlaneRef,
  primitiveInputs,
  revolveInputs,
  type SketchData,
  sketchInputs,
  THREAD_PROFILE_NAMES,
  THREAD_TYPE,
  type ThreadInputOptions,
  type ThreadLoadFlank,
  type ThreadProfileName,
  threadInputs,
  threadProfile,
  threadRadii,
  threadSettings,
} from '@extrudo/core';
import { SketchBuilder } from '@extrudo/sketch/fixtures';
import { detectProfiles } from '@extrudo/sketch/profiles';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Kernel, type ShapeHandle, type ThreadFace } from '../kernel';
import type { BodyMesh } from '../mesh';
import { loadOcct } from '../occt/load';
import { RecomputeEngine } from '../recompute/engine';
import { testDocument, testFeature, testFeatures } from '../recompute/testing';
import type { FeatureOutput, KernelFeatureDefinition, RecomputeResult } from '../recompute/types';
import type { ThreadOutputData } from './thread';
import {
  leadSection,
  MAX_TURNS,
  planThread,
  ringSection,
  THREAD_CHUNK,
  toothPieces,
  toothSection,
} from './thread';

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

/** Whether a 0.05 mm cube centred at `at` overlaps the shape. */
function solidAt(shape: ShapeHandle, at: readonly [number, number, number]): boolean {
  const h = 0.025;
  const probe = kernel.box([2 * h, 2 * h, 2 * h], [at[0] - h, at[1] - h, at[2] - h]);
  const common = kernel.common(shape, probe);
  const volume = kernel.measure(common.shape).volume;
  kernel.release(probe, common.shape);
  return volume > 1e-6;
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

const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env;

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
function grooveOf(profile: ThreadProfileName, pitch: number, crest: number, depth: number) {
  const shape = threadProfile(profile, pitch);
  const tooth = clipAtRoot(flattenProfile(shape.segments), depth);
  const t = areaCentroid(tooth);
  const rectArea = depth * pitch;
  const grooveArea = rectArea - t.area;
  const cr = ((depth / 2) * rectArea - t.cr * t.area) / grooveArea;
  return { grooveArea, centroidRadius: crest - cr };
}

/** The average outward normal of a mesh face by name (a thread face is `#n` per turn). */
function faceNormal(mesh: BodyMesh, name: string): [number, number, number] {
  const ids = mesh.faceIds ?? [];
  const index = ids.findIndex((id) => id === name || id.startsWith(`${name}#`));
  if (index < 0) throw new Error(`no face ${name}`);
  const start = mesh.faceRanges[2 * index] as number;
  const count = mesh.faceRanges[2 * index + 1] as number;
  let x = 0;
  let y = 0;
  let z = 0;
  for (let t = start; t < start + count; t++) {
    for (let k = 0; k < 3; k++) {
      const n = mesh.indices[3 * t + k] as number;
      x += mesh.normals[3 * n] as number;
      y += mesh.normals[3 * n + 1] as number;
      z += mesh.normals[3 * n + 2] as number;
    }
  }
  const l = Math.hypot(x, y, z) || 1;
  return [x / l, y / l, z / l];
}

/** A stepped shaft of two cylinders, both `tall` mm: `C1` Ø20, `C2` Ø24 above it. */
function steppedShaft(tall: number): Feature[] {
  return [
    cylinder('C1', 20, tall),
    {
      ...testFeature('C2', CYLINDER_TYPE),
      inputs: primitiveInputs('cylinder', {
        numbers: { diameter: '24 mm', height: `${tall} mm`, offset: `${tall} mm` },
      }),
    },
  ];
}

/** The volumes of both bodies of a stepped shaft, added up. */
function shaftVolume(result: Done): number {
  return measure(result, 'C1:0').volume + measure(result, 'C2:0').volume;
}

// ------------------------------------------------------------------ tests

describe('thread sections', () => {
  it('draws a tooth that keeps clear of the next turn and a ring round it', () => {
    for (const internal of [false, true]) {
      const radii = threadRadii('iso', 8, 1.25, 0.1, internal);
      const tooth = toothSection(
        { internal, pitch: 1.25, profile: 'iso', loadFlank: 'end' as const, radii },
        0,
      );
      const pts = tooth.curves.map((c) => (c.kind === 'line' ? c.b : ([0, 0] as [number, number])));
      const [b, c, d] = pts as [number, number][];
      const vs = pts.map((p) => p[1]);
      expect(Math.max(...vs) - Math.min(...vs)).toBeLessThan(1.25 * 0.95);
      // The crest flat and the flanks at 30° to the radius.
      expect((d as [number, number])[1] - (c as [number, number])[1]).toBeCloseTo(
        internal ? 1.25 / 4 : 1.25 / 8,
        9,
      );
      expect(
        Math.abs((c as [number, number])[1] - (b as [number, number])[1]) /
          Math.abs((c as [number, number])[0] - (b as [number, number])[0]),
      ).toBeCloseTo(Math.tan(Math.PI / 6), 9);
    }
  });

  it('starts a lead-in cone just past the root, at 45°', () => {
    const radii = threadRadii('iso', 8, 1.25, 0, false);
    const plan = {
      axis: { origin: [0, 0, 0] as const, direction: [0, 0, 1] as const },
      x: [1, 0, 0] as const,
      internal: false,
      pitch: 1.25,
      starts: 1,
      leadLength: 1.25,
      profile: 'iso' as const,
      loadFlank: 'end' as const,
      radii,
      radius: 4,
      from: 0,
      to: 10,
      lead: [true, true] as [boolean, boolean],
      left: false,
      report: {} as never,
    };
    const lead = leadSection(plan, 0);
    const pts = lead.curves.map((c) => (c.kind === 'line' ? c.b : ([0, 0] as [number, number])));
    const [b, c] = pts as [number, number][];
    expect((b as [number, number])[1]).toBe(0);
    expect((c as [number, number])[1] - (b as [number, number])[1]).toBeCloseTo(
      (c as [number, number])[0] - (b as [number, number])[0],
      9,
    );
    expect((b as [number, number])[0]).toBeLessThan(radii.root);
    const ring = ringSection(plan);
    expect(ring.curves[0]).toMatchObject({ kind: 'line', a: [radii.root, 0] });
  });

  // P4-12, ADR-0067 §H2: the tooth is cut out of the ring in pieces, so that no
  // boolean works on a whole thread's faces (OCCT's ring − tooth of a 400-turn
  // thread wants more memory than the WASM module can grow to and traps).
  it('cuts the tooth out of the ring in pieces of THREAD_CHUNK turns', () => {
    // A thread of as many turns as may be modeled is one piece, its cut exactly
    // as it was: the tooth runs two pitches past the thread.
    expect(THREAD_CHUNK).toBe(MAX_TURNS + 2);
    expect(toothPieces(MAX_TURNS + 2)).toEqual([{ from: 0, turns: MAX_TURNS + 2 }]);
    // A longer one is cut in pieces that tile it, in order.
    expect(toothPieces(250)).toEqual([
      { from: 0, turns: 152 },
      { from: 152, turns: 98 },
    ]);
    expect(toothPieces(304, 100)).toEqual([
      { from: 0, turns: 100 },
      { from: 100, turns: 100 },
      { from: 200, turns: 100 },
      { from: 300, turns: 4 },
    ]);
    expect(toothPieces(0)).toEqual([]);
  });
});

describe('thread', { timeout: 300_000 }, () => {
  it('an external M8 on a cylinder: crests, root, pitch, lead-ins, names', async () => {
    const doc = testDocument([
      cylinder('C', 8, 6),
      thread('T', { faces: [wall('C')], numbers: { diameter: '8 mm', pitch: '1.25 mm' } }),
    ]);
    const result = ok(await runWithShapes(doc));
    const m = measure(result, 'C:0');
    expect(m.valid).toBe(true);
    expect(m.solids).toBe(1);
    const t = 0.1;
    const radii = threadRadii('iso', 8, 1.25, t, false);
    // The crests are the diameter less twice the tolerance.
    expect(round(m.bbox.max[0], 2)).toBeLessThanOrEqual(round(radii.crest, 2));
    expect(m.bbox.max[0]).toBeGreaterThan(radii.crest - 0.01);
    expect(round(m.bbox.max[2], 6)).toBe(6);
    // Between the root and the crest cylinders.
    const core = Math.PI * radii.root ** 2 * 6;
    expect(m.volume).toBeGreaterThan(core);
    expect(m.volume).toBeLessThan(Math.PI * radii.crest ** 2 * 6);
    // About half the band between root and crest is tooth.
    const band = Math.PI * (radii.crest ** 2 - radii.root ** 2) * 6;
    expect((m.volume - core) / band).toBeGreaterThan(0.35);
    expect((m.volume - core) / band).toBeLessThan(0.65);
    expect(threadNames(m.names)).toEqual([
      'thread:T:side:f0.crest',
      'thread:T:side:f0.flank0',
      'thread:T:side:f0.flank1',
      'thread:T:side:f0.lead0',
      'thread:T:side:f0.lead1',
      'thread:T:side:f0.root',
    ]);
    const data = dataOf('T');
    expect(data.faces[0]).toMatchObject({
      internal: false,
      designation: 'M8',
      from: 0,
      to: 6,
      lead: [true, true],
    });
    // One pitch apart along a line on the surface: a crest at z, the next at z + P.
    const r = radii.crest - 0.05;
    const along = (z: number) => solidAt(m.shape, [0, r, z]);
    const crests = [...Array(60).keys()].map((i) => 1.5 + i * 0.05).filter(along);
    expect(crests.length).toBeGreaterThan(0);
    const first = crests[0] as number;
    expect(along(first + 1.25)).toBe(true);
    expect(along(first + 1.25 / 2)).toBe(false);
  });

  it('turns right-handed by default and left-handed when asked', async () => {
    const hand = async (left: boolean) => {
      engine.clear();
      const doc = testDocument([
        cylinder('C', 8, 6),
        thread('T', {
          faces: [wall('C')],
          numbers: { diameter: '8 mm', pitch: '1.25 mm' },
          hand: left ? 'left' : 'right',
          chamfer: false,
        }),
      ]);
      const result = ok(await runWithShapes(doc));
      const m = measure(result, 'C:0');
      const r = threadRadii('iso', 8, 1.25, 0.1, false).crest - 0.05;
      // A crest on +Y at height z; a quarter turn on, it is P/4 higher (right) or lower (left).
      const z = [...Array(30).keys()]
        .map((i) => 2 + i * 0.05)
        .find((v) => solidAt(m.shape, [0, r, v])) as number;
      // Where +Y turns to, counter-clockwise about +Z: −X.
      const up = solidAt(m.shape, [-r, 0, z + 1.25 / 4]);
      const down = solidAt(m.shape, [-r, 0, z - 1.25 / 4]);
      return { up, down };
    };
    expect(await hand(false)).toEqual({ up: true, down: false });
    expect(await hand(true)).toEqual({ up: false, down: true });
  });

  it('an M8 screw and an M8 nut with tolerance clear each other', async () => {
    const block = blockWithHole(6.8, 6);
    const doc = testDocument([
      ...block.features,
      cylinder('C', 8, 6),
      thread('TN', { faces: [block.wall], numbers: { diameter: '8 mm', pitch: '1.25 mm' } }),
      thread('TS', { faces: [wall('C')], numbers: { diameter: '8 mm', pitch: '1.25 mm' } }),
    ]);
    const result = ok(await runWithShapes(doc));
    const nut = measure(result, 'E:0');
    const screw = measure(result, 'C:0');
    expect(nut.valid && screw.valid).toBe(true);
    expect(dataOf('TN').faces[0]).toMatchObject({ internal: true, designation: 'M8' });
    const overlap = kernel.common(nut.shape, screw.shape);
    expect(kernel.measure(overlap.shape).volume).toBeLessThan(1e-4);
    kernel.release(overlap.shape);
    // Without tolerance on either they would touch, not overlap; with it, 0.2 mm apart radially.
    expect(kernel.distance(nut.shape, screw.shape)).toBeGreaterThan(0.09);
  });

  it('threads a Hole, a revolved shaft and an extruded circle', async () => {
    const b = new SketchBuilder();
    const lines = rect(b, 0, 0, 3, 8);
    const shaft = new SketchBuilder();
    const circle = shaft.circle(20, 0, 3);
    const doc = testDocument([
      // A revolved shaft about Z: a 3 × 8 rectangle in XZ.
      sketch('SR', b.sketch, originPlaneRef('origin:xz')),
      {
        ...testFeature('R', 'revolve'),
        inputs: revolveInputs(profileRefs('SR', b.sketch), originAxisRef('origin:z')),
      },
      // An extruded circle beside it.
      sketch('SE', shaft.sketch),
      {
        ...testFeature('X', 'extrude'),
        inputs: extrudeInputs(profileRefs('SE', shaft.sketch), { distance: '5 mm' }),
      },
      thread('T', {
        faces: [
          { kind: 'face', id: `revolve:R:side:${lines[1]}` },
          { kind: 'face', id: `extrude:X:side:${circle.id}` },
        ],
      }),
    ]);
    const result = ok(await runWithShapes(doc));
    const data = dataOf('T');
    expect(data.faces.map((f) => f.designation)).toEqual(['M6', 'M6']);
    for (const body of ['R:0', 'X:0']) expect(measure(result, body).valid).toBe(true);
    expect(threadNames(measure(result, 'X:0').names)).toContain('thread:T:side:f1.crest');
  });

  it('threads a Hole feature’s wall (auto-sized from a tap-drill hole)', async () => {
    const doc = testDocument([
      cylinder('C', 16, 5),
      {
        ...testFeature('H', HOLE_TYPE),
        inputs: holeInputs({
          plane: { kind: 'face', id: 'cylinder:C:cap:end' },
          extent: 'through',
          numbers: { diameter: '5 mm' },
        }),
      },
      thread('T', { faces: [{ kind: 'face', id: 'hole:H:side:wall' }] }),
    ]);
    const result = ok(await runWithShapes(doc));
    expect(dataOf('T').faces[0]).toMatchObject({
      internal: true,
      designation: 'M6',
      lead: [true, true],
    });
    expect(measure(result, 'C:0').valid).toBe(true);
  });

  it('a part-length thread with an offset, from either end, steps into the face', async () => {
    const run2 = async (flip: boolean) => {
      engine.clear();
      const doc = testDocument([
        cylinder('C', 6, 10),
        thread('T', {
          faces: [wall('C')],
          extent: 'length',
          flip,
          numbers: { diameter: '6 mm', pitch: '1 mm', length: '4 mm', offset: '2 mm' },
        }),
      ]);
      const result = ok(await runWithShapes(doc));
      const m = measure(result, 'C:0');
      expect(m.valid).toBe(true);
      const face = dataOf('T').faces[0];
      return { from: face?.from, to: face?.to, lead: face?.lead, names: threadNames(m.names) };
    };
    const low = await run2(false);
    expect(low).toMatchObject({ from: 2, to: 6, lead: [false, false] });
    expect(low.names).toContain('thread:T:side:f0.end0');
    expect(low.names).toContain('thread:T:side:f0.end1');
    const high = await run2(true);
    expect(high).toMatchObject({ from: 4, to: 8 });
  });

  it('says what is wrong', async () => {
    const cases: [ThreadInputOptions, RegExp][] = [
      [{ faces: [{ kind: 'face', id: 'cylinder:C:cap:end' }] }, /isn't cylindrical/],
      [
        { faces: [wall('C')], numbers: { diameter: '12 mm', pitch: '1.75 mm' } },
        /thinner than the M12/,
      ],
      [
        { faces: [wall('C')], extent: 'length', numbers: { length: '20 mm' } },
        /face is only 10 mm long/,
      ],
      [{ faces: [wall('C')], numbers: { offset: '10 mm' } }, /offset \(10 mm\) is as long/],
      [{ faces: [wall('C')], numbers: { diameter: '6 mm', pitch: '0.01 mm' } }, /up to 150/],
    ];
    for (const [options, message] of cases) {
      engine.clear();
      const result = await run(testDocument([cylinder('C', 6, 10), thread('T', options)]));
      const s = status(result, 'T');
      expect(s.status, String(message)).toBe('error');
      expect(s.message).toMatch(message);
    }
    engine.clear();
    const big = await run(
      testDocument([cylinder('C', 100, 3), thread('T', { faces: [wall('C')] })]),
    );
    expect(status(big, 'T').message).toMatch(/No standard metric thread fits/);
  });

  // B9's fuzzing found that a thread of the ~400 turns the evaluator used to
  // allow corrupts the WASM heap (ADR-0039's B9 amendment), so `MAX_TURNS` is
  // 150 now: more turns is refused before anything is built.
  it('refuses a thread of more than MAX_TURNS before the facade runs', async () => {
    expect(MAX_TURNS).toBe(150);
    const sweep = kernel.threadSweep.bind(kernel);
    const boolean = kernel.boolean.bind(kernel);
    let swept = 0;
    let cut = 0;
    kernel.threadSweep = ((...args: Parameters<typeof sweep>) => {
      swept++;
      return sweep(...args);
    }) as typeof kernel.threadSweep;
    kernel.boolean = ((...args: Parameters<typeof boolean>) => {
      cut++;
      return boolean(...args);
    }) as typeof kernel.boolean;
    try {
      // An M8 on a 200 mm shaft: 160 turns.
      const result = await runWithShapes(
        testDocument([
          cylinder('C', 8, 200),
          thread('T', { faces: [wall('C')], numbers: { diameter: '8 mm', pitch: '1.25 mm' } }),
        ]),
      );
      const s = status(result, 'T');
      expect(s.status).toBe('error');
      expect(s.message).toBe(
        'The thread would have 160 turns; up to 150 can be modeled. Make it shorter or the pitch larger.',
      );
      expect(swept, 'nothing was swept').toBe(0);
      expect(cut, 'nothing was cut').toBe(0);
      // The body the thread would have cut is still there, whole.
      expect(measure(result, 'C:0').valid).toBe(true);
    } finally {
      kernel.threadSweep = sweep;
      kernel.boolean = boolean;
    }
  });

  // P4-12, ADR-0067 §H2: two tools whose boxes overlap are merged without
  // asking OCCT for the exact distance when either is heavy (over
  // `HEAVY_TOOL_FACES` faces); on B9 that distance was 26 s of a 30 s
  // recompute. Fusing tools that only nearly touch is still correct, so the
  // cut is the same as with a feature per face; light tools keep the exact test.
  it('merges heavy tools whose boxes overlap, without the exact distance', async () => {
    const distance = kernel.distance.bind(kernel);
    let asked = 0;
    kernel.distance = ((...args: Parameters<typeof distance>) => {
      asked++;
      return distance(...args);
    }) as typeof kernel.distance;
    // 180 mm of M20 (72 turns) and of M24 (60): a thread's tool has about
    // four faces a turn, so these are over HEAVY_TOOL_FACES each. Their bands
    // overlap in the bounding box and never touch, and the exact distance
    // between tools that size is minutes (measured: 277 s), which is what the
    // heavy rule exists for.
    const heavy = 180;
    try {
      const both = ok(
        await runWithShapes(
          testDocument([...steppedShaft(heavy), thread('T', { faces: [wall('C1'), wall('C2')] })]),
        ),
      );
      expect(asked, 'no exact distance between heavy tools').toBe(0);
      expect(measure(both, 'C1:0').valid).toBe(true);
      expect(measure(both, 'C2:0').valid).toBe(true);
      const merged = shaftVolume(both);
      // The same two threads as two features: one tool each, nothing to merge,
      // and nothing else in the way, so the same material comes off.
      engine.clear();
      const separate = ok(
        await runWithShapes(
          testDocument([
            ...steppedShaft(heavy),
            thread('T1', { faces: [wall('C1')] }),
            thread('T2', { faces: [wall('C2')] }),
          ]),
        ),
      );
      expect(asked, 'one tool is never compared').toBe(0);
      const apart = shaftVolume(separate);
      expect(Math.abs(merged - apart) / apart, 'the same cut').toBeLessThan(1e-6);
      // Threads of 4 turns have 30-odd faces: light tools still get the exact
      // test, which finds the bands don't touch and leaves them apart.
      engine.clear();
      asked = 0;
      const light = ok(
        await runWithShapes(
          testDocument([...steppedShaft(10), thread('T', { faces: [wall('C1'), wall('C2')] })]),
        ),
      );
      expect(asked, 'light tools are compared').toBe(1);
      const lightVolume = shaftVolume(light);
      engine.clear();
      const lightSeparate = ok(
        await runWithShapes(
          testDocument([
            ...steppedShaft(10),
            thread('T1', { faces: [wall('C1')] }),
            thread('T2', { faces: [wall('C2')] }),
          ]),
        ),
      );
      expect(Math.abs(lightVolume - shaftVolume(lightSeparate)) / lightVolume).toBeLessThan(1e-6);
    } finally {
      kernel.distance = distance;
    }
  });

  it('models MAX_TURNS turns and refuses one more', () => {
    // The boundary itself, without building anything: 150 turns is allowed.
    const settings = threadSettings(
      threadInputs({ faces: [{ kind: 'face', id: 'x' }], numbers: { diameter: '8 mm' } }),
    );
    const numbers = {
      diameter: 8,
      pitch: 1.25,
      length: 10,
      offset: 0,
      tolerance: 0.1,
    };
    const face = (turns: number): ThreadFace => ({
      axis: { origin: [0, 0, 0], direction: [0, 0, 1] },
      radius: 4,
      inside: false,
      from: 0,
      to: turns * 1.25,
      whole: true,
      open: [false, false],
    });
    expect(planThread(face(MAX_TURNS), settings, numbers, []).report.turns).toBe(MAX_TURNS);
    expect(() => planThread(face(MAX_TURNS + 1), settings, numbers, [])).toThrow(
      `The thread would have ${MAX_TURNS + 1} turns; up to ${MAX_TURNS} can be modeled`,
    );
  });

  // P4-12: each profile builds, cuts about the volume its own section
  // predicts (not a snapshot), and keeps its face names.
  it('cuts two turns of each profile by its own section area', async () => {
    const P = 2.5;
    const tol = 0.1;
    for (const profile of THREAD_PROFILE_NAMES) {
      engine.clear();
      const radii = threadRadii(profile, 20, P, tol, false);
      // A shaft exactly at the crest radius: nothing is turned down, so the
      // material taken off is the groove itself.
      const result = ok(
        await runWithShapes(
          testDocument([
            cylinder('C', 2 * radii.crest, 5),
            thread('T', {
              faces: [wall('C')],
              numbers: {
                diameter: '20 mm',
                pitch: `${P} mm`,
                tolerance: `${tol} mm`,
              },
              profile,
              chamfer: false,
            }),
          ]),
        ),
      );
      const body = measure(result, 'C:0');
      expect(body.valid, profile).toBe(true);
      const removed = Math.PI * radii.crest ** 2 * 5 - body.volume;
      const { grooveArea, centroidRadius } = grooveOf(profile, P, radii.crest, radii.depth);
      const turns = 5 / P;
      const helix = turns * Math.sqrt((2 * Math.PI * centroidRadius) ** 2 + P ** 2);
      const expected = grooveArea * helix;
      expect(removed, `${profile} removed`).toBeGreaterThan(0.9 * expected);
      expect(removed, `${profile} removed`).toBeLessThan(1.1 * expected);
      expect(dataOf('T').faces[0]?.profile).toBe(profile);
      const names = threadNames(body.names);
      for (const piece of ['crest', 'flank0', 'flank1', 'root']) {
        expect(names, `${profile} ${piece}`).toContain(`thread:T:side:f0.${piece}`);
      }
    }
  });

  it('cuts an internal bottle thread in a bore', async () => {
    engine.clear();
    const result = ok(
      await runWithShapes(
        testDocument([
          cylinder('C', 40, 5),
          {
            ...testFeature('H', HOLE_TYPE),
            inputs: holeInputs({
              plane: { kind: 'face', id: 'cylinder:C:cap:end' },
              extent: 'through',
              numbers: { diameter: '27 mm' },
            }),
          },
          thread('T', {
            faces: [{ kind: 'face', id: 'hole:H:side:wall' }],
            numbers: { diameter: '27.43 mm', pitch: '2.7 mm' },
            profile: 'bottle',
          }),
        ]),
      ),
    );
    expect(dataOf('T').faces[0]).toMatchObject({
      internal: true,
      profile: 'bottle',
      designation: 'PCO-1881',
    });
    expect(measure(result, 'C:0').valid).toBe(true);
  });

  it('puts the steep buttress flank at the end loadFlank names', async () => {
    const flanks = async (loadFlank: ThreadLoadFlank) => {
      engine.clear();
      const result = ok(
        await runWithShapes(
          testDocument([
            cylinder('C', 20, 8),
            thread('T', {
              faces: [wall('C')],
              numbers: { diameter: '20 mm', pitch: '4 mm' },
              profile: 'buttress',
              loadFlank,
            }),
          ]),
        ),
      );
      const mesh = result.bodies.find((b) => b.id === 'C:0')?.mesh;
      if (!mesh) throw new Error('no mesh');
      return {
        zero: faceNormal(mesh, 'thread:T:side:f0.flank0'),
        one: faceNormal(mesh, 'thread:T:side:f0.flank1'),
      };
    };
    // A 3° load flank is nearly radial, so its normal is nearly axial; a 30°
    // flank's is not. The two flanks face opposite ways.
    const atEnd = await flanks('end');
    expect(Math.abs(atEnd.one[2])).toBeGreaterThan(Math.abs(atEnd.zero[2]));
    expect(atEnd.one[2] * atEnd.zero[2]).toBeLessThan(0);
    const atStart = await flanks('start');
    expect(Math.abs(atStart.zero[2])).toBeGreaterThan(Math.abs(atStart.one[2]));
    expect(atStart.zero[2] * atStart.one[2]).toBeLessThan(0);
  });

  it('refuses a non-ISO profile without a size', async () => {
    engine.clear();
    const result = await run(
      testDocument([
        cylinder('C', 20, 5),
        thread('T', { faces: [wall('C')], profile: 'trapezoidal' }),
      ]),
    );
    const s = status(result, 'T');
    expect(s.status).toBe('error');
    expect(s.message).toBe('Enter a diameter and pitch for a trapezoidal thread.');
  });

  it('keeps a golden table of options', async () => {
    const rows: Record<string, unknown> = {};
    const cases: [string, number, ThreadInputOptions][] = [
      ['M6 full', 6, { faces: [wall('C')] }],
      ['M6 left, no lead-in', 6, { faces: [wall('C')], hand: 'left', chamfer: false }],
      [
        'Ø6 × 0.75 custom, 3 mm',
        6,
        {
          faces: [wall('C')],
          extent: 'length',
          numbers: { diameter: '6 mm', pitch: '0.75 mm', length: '3 mm' },
        },
      ],
      [
        '1/4-20 UNC on a 6.35 mm shaft',
        6.35,
        {
          faces: [wall('C')],
          numbers: { diameter: '0.25 in', pitch: '1 in / 20', tolerance: '0.2 mm' },
        },
      ],
      [
        'Tr 20 × 4',
        20,
        {
          faces: [wall('C')],
          numbers: { diameter: '20 mm', pitch: '4 mm' },
          profile: 'trapezoidal',
        },
      ],
      [
        'S 20 × 4 buttress',
        20,
        {
          faces: [wall('C')],
          numbers: { diameter: '20 mm', pitch: '4 mm' },
          profile: 'buttress',
          chamfer: false,
        },
      ],
      [
        'PCO-1881 on a 27.43 mm shaft',
        27.43,
        {
          faces: [wall('C')],
          numbers: { diameter: '27.43 mm', pitch: '2.7 mm' },
          profile: 'bottle',
        },
      ],
      ['M6 two starts', 6, { faces: [wall('C')], starts: '2' }],
      [
        'Ø6 × 0.75 left, three starts, 4 mm',
        6,
        {
          faces: [wall('C')],
          hand: 'left',
          starts: '3',
          extent: 'length',
          numbers: { diameter: '6 mm', pitch: '0.75 mm', length: '4 mm' },
        },
      ],
    ];
    for (const [name, diameter, options] of cases) {
      engine.clear();
      const result = ok(
        await runWithShapes(testDocument([cylinder('C', diameter, 5), thread('T', options)])),
      );
      const m = measure(result, 'C:0');
      const face = dataOf('T').faces[0];
      rows[name] = {
        valid: m.valid,
        volume: round(m.volume, 1),
        faces: m.faces,
        bbox: [...m.bbox.min, ...m.bbox.max].map((v) => round(v, 2)),
        designation: face?.designation,
        turns: round(face?.turns ?? 0, 3),
        names: threadNames(m.names),
      };
    }
    await expect(JSON.stringify(rows, null, 2)).toMatchFileSnapshot('golden/thread-options.json');
  });

  // Recompute times for ADR-0056 (BENCH=1): one thread on a fresh engine, then a warm edit after it.
  it.runIf(env?.BENCH)('times threads', async () => {
    const lines: string[] = [];
    const cases: [string, Feature[], ThreadInputOptions][] = [
      [
        'M8 × 12 mm shaft',
        [cylinder('C', 8, 12)],
        { faces: [wall('C')], numbers: { diameter: '8 mm', pitch: '1.25 mm' } },
      ],
      [
        'M3 × 10 mm shaft',
        [cylinder('C', 3, 10)],
        { faces: [wall('C')], numbers: { diameter: '3 mm', pitch: '0.5 mm' } },
      ],
      [
        'M20 × 30 mm shaft',
        [cylinder('C', 20, 30)],
        { faces: [wall('C')], numbers: { diameter: '20 mm', pitch: '2.5 mm' } },
      ],
      [
        'M30 × 30 mm shaft',
        [cylinder('C', 30, 30)],
        { faces: [wall('C')], numbers: { diameter: '30 mm', pitch: '3.5 mm' } },
      ],
    ];
    const spent = new Map<string, number>();
    const proto = Object.getPrototypeOf(kernel) as Record<string, unknown>;
    const originals = new Map<string, unknown>();
    for (const name of Object.getOwnPropertyNames(proto)) {
      const fn = proto[name];
      if (name === 'constructor' || name === 'scope' || typeof fn !== 'function') continue;
      originals.set(name, fn);
      proto[name] = function (this: unknown, ...args: unknown[]) {
        const start = performance.now();
        try {
          return (fn as (...a: unknown[]) => unknown).apply(this, args);
        } finally {
          spent.set(name, (spent.get(name) ?? 0) + performance.now() - start);
        }
      };
    }
    for (const [name, before, options] of cases) {
      engine.clear();
      const base = await run(testDocument(before));
      spent.clear();
      const t0 = performance.now();
      const result = ok(await run(testDocument([...before, thread('T', options)])));
      const ms = performance.now() - t0;
      lines.push(
        [...spent]
          .filter(([, t]) => t > 20)
          .sort((a, b) => b[1] - a[1])
          .map(([n, t]) => `${n} ${Math.round(t)}`)
          .join(', '),
      );
      const triangles = (result.bodies[0]?.mesh?.indices.length ?? 0) / 3;
      lines.push(
        `${name}: ${Math.round(ms)} ms (engine ${Math.round(result.stats.ms)} ms), ${triangles} triangles, base ${Math.round(base.stats.ms)} ms`,
      );
    }
    for (const [name, fn] of originals) proto[name] = fn;
    // Vitest swallows console output in some setups: the report is the failure message.
    expect(lines.join('\n')).toBe('');
  });
});
