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
  THREAD_TYPE,
  type ThreadInputOptions,
  threadInputs,
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
import { leadSection, ringSection, toothSection } from './thread';

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

// ------------------------------------------------------------------ tests

describe('thread sections', () => {
  it('draws a tooth that keeps clear of the next turn and a ring round it', () => {
    for (const internal of [false, true]) {
      const radii = threadRadii(8, 1.25, 0.1, internal);
      const tooth = toothSection({ internal, pitch: 1.25, radii }, 0);
      const vs = tooth.vertices.map((v) => v[1]);
      expect(Math.max(...vs) - Math.min(...vs)).toBeLessThan(1.25 * 0.95);
      // The crest flat and the flanks at 30° to the radius.
      const [, kink, c0, c1] = tooth.vertices as [
        [number, number],
        [number, number],
        [number, number],
        [number, number],
      ];
      expect(c1[1] - c0[1]).toBeCloseTo(internal ? 1.25 / 4 : 1.25 / 8, 9);
      expect(Math.abs(c0[1] - kink[1]) / Math.abs(c0[0] - kink[0])).toBeCloseTo(
        Math.tan(Math.PI / 6),
        9,
      );
    }
  });

  it('starts a lead-in cone just past the root, at 45°', () => {
    const radii = threadRadii(8, 1.25, 0, false);
    const plan = {
      axis: { origin: [0, 0, 0] as const, direction: [0, 0, 1] as const },
      x: [1, 0, 0] as const,
      internal: false,
      pitch: 1.25,
      radii,
      radius: 4,
      from: 0,
      to: 10,
      lead: [true, true] as [boolean, boolean],
      left: false,
      report: {} as never,
    };
    const lead = leadSection(plan, 0);
    const [, b, c] = lead.vertices as [[number, number], [number, number], [number, number]];
    expect(b[1]).toBe(0);
    expect(c[1] - b[1]).toBeCloseTo(c[0] - b[0], 9);
    expect(b[0]).toBeLessThan(radii.root);
    const ring = ringSection(plan);
    expect(ring.vertices[0]).toEqual([radii.root, 0]);
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
    const radii = threadRadii(8, 1.25, t, false);
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
      const r = threadRadii(8, 1.25, 0.1, false).crest - 0.05;
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
      [{ faces: [wall('C')], numbers: { diameter: '6 mm', pitch: '0.01 mm' } }, /up to 400/],
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

  it('keeps a golden table of options', async () => {
    const rows: Record<string, unknown> = {};
    const cases: Record<string, ThreadInputOptions> = {
      'M6 full': { faces: [wall('C')] },
      'M6 left, no lead-in': { faces: [wall('C')], hand: 'left', chamfer: false },
      'Ø6 × 0.75 custom, 3 mm': {
        faces: [wall('C')],
        extent: 'length',
        numbers: { diameter: '6 mm', pitch: '0.75 mm', length: '3 mm' },
      },
      '1/4-20 UNC on a 6.35 mm shaft': {
        faces: [wall('C')],
        numbers: { diameter: '0.25 in', pitch: '1 in / 20', tolerance: '0.2 mm' },
      },
    };
    for (const [name, options] of Object.entries(cases)) {
      engine.clear();
      const diameter = name.startsWith('1/4') ? 6.35 : 6;
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
