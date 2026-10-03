// Sweep, loft and coil (P4-01, ADR-0055) through the recompute engine with
// real OCCT: paths of sketch curves and edges, orientations, twist, scale,
// holes, lofts to points and rings, coils of every type and section, the
// names they give (ADR-0005), the body operations, patterns of them, and
// their errors. The golden tables `golden/{sweep,loft,coil}-options.json`
// are Vitest file snapshots: rewrite them with
// `pnpm vitest run -u packages/kernel/src/features/sweep-loft-coil` and
// review the diff.
import {
  type CoilInputOptions,
  coilInputs,
  constructionRef,
  type ExtrudoDocument,
  type Feature,
  type FeatureId,
  FeatureRegistry,
  type FeatureStatus,
  type GeomRef,
  type LoftInputOptions,
  loftInputs,
  originAxisRef,
  originPlaneRef,
  primitiveInputs,
  rectangularPatternInputs,
  type SketchData,
  type SweepInputOptions,
  sketchInputs,
  sweepInputs,
} from '@extrudo/core';
import { SketchBuilder } from '@extrudo/sketch/fixtures';
import { detectProfiles, type Profile, profileCentroid } from '@extrudo/sketch/profiles';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Kernel, type ShapeHandle } from '../kernel';
import { loadOcct } from '../occt/load';
import { RecomputeEngine } from '../recompute/engine';
import { testDocument, testFeature, testFeatures } from '../recompute/testing';
import type { FeatureOutput, KernelFeatureDefinition, RecomputeResult } from '../recompute/types';
import type { CoilOutputData } from './coil';

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

const XY = originPlaneRef('origin:xy');
const XZ = originPlaneRef('origin:xz');
const YZ = originPlaneRef('origin:yz');

function sketch(id: string, data: SketchData, plane: GeomRef = XY): Feature {
  return { ...testFeature(id, 'sketch'), inputs: sketchInputs(plane, data) };
}

function rect(b: SketchBuilder, x: number, y: number, w: number, h: number): string[] {
  return [
    b.line(x, y, x + w, y).id,
    b.line(x + w, y, x + w, y + h).id,
    b.line(x + w, y + h, x, y + h).id,
    b.line(x, y + h, x, y).id,
  ];
}

/** The largest profile of `data`, or the one nearest (x, y). */
function profile(sketchId: string, data: SketchData, at?: [number, number]): GeomRef {
  const profiles = detectProfiles(data).sort((a, b) => b.area - a.area);
  const dist = (p: Profile) => {
    const [cx, cy] = profileCentroid(p);
    return at ? Math.hypot(cx - at[0], cy - at[1]) : 0;
  };
  const found = at ? [...profiles].sort((a, b) => dist(a) - dist(b))[0] : profiles[0];
  if (!found) throw new Error('no profile');
  return { kind: 'profile', id: `${sketchId}/${found.id}` };
}

const entity = (sketchId: string, id: string): GeomRef => ({
  kind: 'sketchEntity',
  id: `${sketchId}/${id}`,
});

const sweep = (id: string, profiles: GeomRef[], path: GeomRef[], o: SweepInputOptions = {}) => ({
  ...testFeature(id, 'sweep'),
  inputs: sweepInputs(profiles, path, o),
});
const loft = (id: string, sections: GeomRef[], o: LoftInputOptions = {}) => ({
  ...testFeature(id, 'loft'),
  inputs: loftInputs(sections, o),
});
const coil = (id: string, o: CoilInputOptions = {}) => ({
  ...testFeature(id, 'coil'),
  inputs: coilInputs(o),
});
const box = (id: string, numbers: Record<string, string> = {}, plane?: GeomRef) => ({
  ...testFeature(id, 'box'),
  inputs: primitiveInputs('box', { numbers, ...(plane && { plane }) }),
});
const cylinder = (id: string, numbers: Record<string, string> = {}) => ({
  ...testFeature(id, 'cylinder'),
  inputs: primitiveInputs('cylinder', { numbers }),
});
const length = (expr: string) => ({ kind: 'expr' as const, expr, unit: 'length' as const });
const offsetPlane = (id: string, plane: GeomRef, distance: string) => ({
  ...testFeature(id, 'offsetPlane'),
  inputs: { plane: { kind: 'ref' as const, refs: [plane] }, distance: length(distance) },
});
const point = (id: string, x: number, y: number, z: number) => ({
  ...testFeature(id, 'constructionPoint'),
  inputs: { x: length(`${x} mm`), y: length(`${y} mm`), z: length(`${z} mm`) },
});
const planeOf = (f: Feature) => constructionRef(f) as GeomRef;

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

/** A recompute that also captures the body shapes (through a spy on the kernel's mesh call). */
async function runWithShapes(features: Feature[]): Promise<Done> {
  bodyShapes = new Map();
  const shapes: ShapeHandle[] = [];
  const mesh = kernel.mesh.bind(kernel);
  kernel.mesh = (shape, options) => {
    shapes.push(shape);
    return mesh(shape, options);
  };
  try {
    engine.clear();
    seen.clear();
    const result = await run(testDocument(features));
    // The bodies are meshed last, in order (a pattern meshes the tools it replays before them).
    const last = shapes.slice(-result.bodies.length);
    result.bodies.forEach((b, i) => {
      const shape = last[i];
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
  const props = kernel.properties(shape);
  return {
    volume: props.volume,
    bbox: props.bbox,
    faces: kernel.count(shape, 'face'),
    valid: kernel.isValid(shape),
    names: found.mesh?.faceIds ?? [],
    shape,
  };
}

const close = (a: number, b: number, tolerance = 1e-3) =>
  expect(Math.abs(a - b), `${a} ≈ ${b}`).toBeLessThanOrEqual(tolerance * Math.max(1, Math.abs(b)));

const round = (x: number, digits = 3) => {
  const r = Number(x.toFixed(digits));
  return Object.is(r, -0) ? 0 : r;
};
const boxOf = (b: { min: readonly number[]; max: readonly number[] }) =>
  [...b.min, ...b.max].map((v) => round(v, 1));

async function errorOf(features: Feature[], id: string): Promise<string> {
  const result = await runWithShapes(features);
  const s = status(result, id);
  expect(s.status, s.message).toBe('error');
  return s.message ?? '';
}

// ------------------------------------------------------------------ scenes

/** A circle of radius `r` at the origin of XY (sketch S). */
function disc(r = 3, id = 'S') {
  const b = new SketchBuilder();
  const c = b.circle(0, 0, r).id;
  return { data: b.sketch, circle: c, feature: sketch(id, b.sketch) };
}

/**
 * Paths on XZ (sketch P; sketch (u, v) is world (u, 0, v)): `straight` up Z
 * from 0 to 30, `bend` that line then a 45° arc of radius 20 towards +X,
 * `ell` that line, a quarter arc of radius 20 and 40 mm along +X.
 */
function paths(id = 'P') {
  const b = new SketchBuilder();
  const up = b.line(0, 0, 0, 30).id;
  const bend = b.arc(20, 30, 20, 135, 180).id;
  const quarter = b.arc(20, 30, 20, 90, 180).id;
  const along = b.line(20, 50, 60, 50).id;
  return {
    data: b.sketch,
    feature: sketch(id, b.sketch, XZ),
    straight: [entity(id, up)],
    bend: [entity(id, up), entity(id, bend)],
    ell: [entity(id, along), entity(id, up), entity(id, quarter)],
  };
}

const ELL = 30 + 10 * Math.PI + 40;

describe('sweep', { timeout: 120_000 }, () => {
  it('a disc along a straight line, a bend and a line-arc-line chain picked out of order', async () => {
    const d = disc();
    const p = paths();
    for (const [path, length] of [
      [p.straight, 30],
      [p.bend, 30 + 20 * (Math.PI / 4)],
      [p.ell, ELL],
    ] as const) {
      const result = ok(
        await runWithShapes([d.feature, p.feature, sweep('W', [profile('S', d.data)], [...path])]),
      );
      expect(result.bodies.map((b) => b.id)).toEqual(['W:0']);
      const m = measure(result, 'W:0');
      expect(m.valid).toBe(true);
      close(m.volume, Math.PI * 9 * length);
      // One side face per piece of the path, numbered along it (`#n`) when there are several.
      const side = `sweep:W:side:${d.circle}`;
      const sides = path.length === 1 ? [side] : path.map((_, i) => `${side}#${i + 1}`);
      expect([...m.names].sort()).toEqual(
        ['sweep:W:cap:end', 'sweep:W:cap:start', ...sides].sort(),
      );
    }
  });

  it('fixed keeps the profile parallel to itself; follow turns it with the path', async () => {
    const d = disc();
    const p = paths();
    const follow = ok(
      await runWithShapes([d.feature, p.feature, sweep('W', [profile('S', d.data)], p.bend)]),
    );
    close(measure(follow, 'W:0').volume, Math.PI * 9 * (30 + 5 * Math.PI));
    const fixed = ok(
      await runWithShapes([
        d.feature,
        p.feature,
        sweep('W', [profile('S', d.data)], p.bend, { orientation: 'fixed' }),
      ]),
    );
    // Translated, a disc square to Z sweeps only its rise: 30 mm, then 20·sin 45° on the arc.
    close(measure(fixed, 'W:0').volume, Math.PI * 9 * (30 + 20 * Math.SQRT1_2));
  });

  it('twist turns the profile, scale shrinks it towards the end', async () => {
    const b = new SketchBuilder();
    const lines = rect(b, -5, -5, 10, 10);
    const p = paths();
    const square = sketch('S', b.sketch);
    const twisted = ok(
      await runWithShapes([
        square,
        p.feature,
        sweep('W', [profile('S', b.sketch)], p.straight, { twist: '90 deg' }),
      ]),
    );
    const m = measure(twisted, 'W:0');
    close(m.volume, 3000);
    expect(m.valid).toBe(true);
    expect([...m.names].sort()).toEqual(
      ['sweep:W:cap:end', 'sweep:W:cap:start', ...lines.map((l) => `sweep:W:side:${l}`)].sort(),
    );
    const scaled = ok(
      await runWithShapes([
        square,
        p.feature,
        sweep('W', [profile('S', b.sketch)], p.straight, { scale: '0.5' }),
      ]),
    );
    close(measure(scaled, 'W:0').volume, (100 * 30 * (1 + 0.5 + 0.25)) / 3);
    // A twisted, scaling sweep along the curved chain: sound, and smaller than the straight one.
    const both = ok(
      await runWithShapes([
        square,
        p.feature,
        sweep('W', [profile('S', b.sketch)], p.ell, { twist: '180 deg', scale: '0.5' }),
      ]),
    );
    const n = measure(both, 'W:0');
    expect(n.valid).toBe(true);
    expect(n.volume).toBeLessThan(100 * ELL);
    expect(n.volume).toBeGreaterThan(25 * ELL);
  });

  it('a tube: a profile with a hole keeps its hole, inner and outer walls named', async () => {
    const b = new SketchBuilder();
    const outer = b.circle(0, 0, 3).id;
    const inner = b.circle(0, 0, 2).id;
    const p = paths();
    const result = ok(
      await runWithShapes([
        sketch('S', b.sketch),
        p.feature,
        sweep('W', [profile('S', b.sketch)], p.ell),
      ]),
    );
    const m = measure(result, 'W:0');
    close(m.volume, Math.PI * 5 * ELL);
    const sides = [inner, outer].flatMap((c) => [1, 2, 3].map((n) => `sweep:W:side:${c}#${n}`));
    expect([...m.names].sort()).toEqual(['sweep:W:cap:end', 'sweep:W:cap:start', ...sides].sort());
  });

  it('a body face along a sketch line joins, its sides named after its edges', async () => {
    const p = new SketchBuilder();
    p.line(0, 20, 0, 40);
    const line = Object.keys(p.sketch.entities).find((k) => k.startsWith('l')) as string;
    const first = ok(await runWithShapes([box('B')]));
    const top = (first.bodies[0]?.mesh?.faceIds ?? []).indexOf('box:B:cap:end');
    const face = engine.reference('B:0' as never, 'face', top);
    if (!face) throw new Error('no face');
    const result = ok(
      await runWithShapes([
        box('B'),
        sketch('P', p.sketch, XZ),
        sweep('W', [face], [entity('P', line)], { operation: 'join' }),
      ]),
    );
    expect(result.bodies.map((b) => b.id)).toEqual(['B:0']);
    const m = measure(result, 'B:0');
    close(m.volume, 20 * 20 * 40);
    expect(boxOf(m.bbox)).toEqual([-10, -10, 0, 10, 10, 40]);
    // The sides run flush with the box's and merge into them (the box's names win); the top is the sweep's.
    expect(m.names).toContain('sweep:W:cap:end');
    expect(m.faces).toBe(6);
  });

  it('a path of body edges', async () => {
    const first = ok(await runWithShapes([box('B')]));
    const shape = bodyShapes.get('B:0') as ShapeHandle;
    // The top edge along X on the front (y = −10, z = 20).
    const index = kernel
      .describe(shape)
      .edges.findIndex(
        (e) =>
          Math.abs(e.midpoint[1] + 10) < 1e-6 &&
          Math.abs(e.midpoint[2] - 20) < 1e-6 &&
          Math.abs(e.midpoint[0]) < 1e-6,
      );
    expect(index).toBeGreaterThanOrEqual(0);
    expect(first.bodies).toHaveLength(1);
    const edge = engine.reference('B:0' as never, 'edge', index);
    if (!edge) throw new Error('no edge');
    // A circle on YZ (at x = 0) round the edge's middle: it sweeps from there to one end and on.
    const b = new SketchBuilder();
    b.circle(-10, 20, 2);
    const result = ok(
      await runWithShapes([
        box('B'),
        sketch('S', b.sketch, YZ),
        sweep('W', [profile('S', b.sketch)], [edge]),
      ]),
    );
    const m = measure(result, 'W:0');
    close(m.volume, Math.PI * 4 * 20);
    expect(Math.abs((m.bbox.max[0] as number) - (m.bbox.min[0] as number) - 20)).toBeLessThan(0.05);
  });

  it('cuts, joins and intersects like extrude', async () => {
    const d = disc();
    const p = paths();
    const volume = async (operation: SweepInputOptions['operation']) => {
      const result = ok(
        await runWithShapes([
          box('B'),
          d.feature,
          p.feature,
          sweep('W', [profile('S', d.data)], p.straight, { operation }),
        ]),
      );
      return measure(result, 'B:0').volume;
    };
    close(await volume('cut'), 8000 - Math.PI * 9 * 20);
    close(await volume('join'), 8000 + Math.PI * 9 * 10);
    close(await volume('intersect'), Math.PI * 9 * 20);
  });

  it('a pattern repeats a cutting sweep', async () => {
    const d = disc(2);
    const p = paths();
    const result = ok(
      await runWithShapes([
        box('B', { length: '60 mm' }),
        d.feature,
        p.feature,
        sweep('W', [profile('S', d.data)], p.straight, { operation: 'cut' }),
        {
          ...testFeature('R', 'rectangularPattern'),
          inputs: rectangularPatternInputs({
            features: ['W'],
            direction1: originAxisRef('origin:x'),
            count1: '3',
            distance1: '10 mm',
          }),
        },
      ]),
    );
    close(measure(result, 'B:0').volume, 60 * 20 * 20 - 3 * Math.PI * 4 * 20);
  });

  it('refuses what it cannot build, in words', async () => {
    const d = disc();
    const p = paths();
    const prof = [profile('S', d.data)];
    const base = [d.feature, p.feature];
    expect(await errorOf([...base, sweep('W', [], p.straight)], 'W')).toMatch(
      /Pick at least one profile/,
    );
    expect(await errorOf([...base, sweep('W', prof, [])], 'W')).toMatch(/Pick the path/);
    // A line and the far end of the arc only: a gap.
    const gap = [p.straight[0] as GeomRef, p.ell[0] as GeomRef];
    expect(await errorOf([...base, sweep('W', prof, gap)], 'W')).toMatch(/don't join end to end/);
    expect(await errorOf([...base, sweep('W', prof, p.straight, { scale: '0' })], 'W')).toMatch(
      /scale must be greater than 0/,
    );
    expect(
      await errorOf(
        [...base, sweep('W', prof, p.straight, { orientation: 'fixed', twist: '10 deg' })],
        'W',
      ),
    ).toMatch(/stays fixed can't twist/);
    // A disc of radius 25 round a bend of radius 20 runs into itself.
    const big = disc(25);
    expect(
      await errorOf([big.feature, p.feature, sweep('W', [profile('S', big.data)], p.bend)], 'W'),
    ).toMatch(/runs into itself|Couldn't sweep/);
    // A sharp corner: a twist is refused; a plain sweep mitres it.
    const c = new SketchBuilder();
    const l1 = c.line(0, 0, 0, 30).id;
    const l2 = c.line(0, 30, 30, 30).id;
    const corner = sketch('C', c.sketch, XZ);
    const path = [entity('C', l1), entity('C', l2)];
    expect(
      await errorOf([d.feature, corner, sweep('W', prof, path, { twist: '45 deg' })], 'W'),
    ).toMatch(/needs a smooth path/);
    const mitred = ok(await runWithShapes([d.feature, corner, sweep('W', prof, path)]));
    close(measure(mitred, 'W:0').volume, Math.PI * 9 * 60);
    // A closed path can't scale.
    const ring = new SketchBuilder();
    const loop = ring.circle(20, 0, 20).id;
    expect(
      await errorOf(
        [
          d.feature,
          sketch('C', ring.sketch, XZ),
          sweep('W', prof, [entity('C', loop)], { scale: '2' }),
        ],
        'W',
      ),
    ).toMatch(/closed path can't change/);
    // A point is no path.
    const pts = new SketchBuilder();
    const dot = pts.point(5, 5);
    expect(
      await errorOf(
        [d.feature, sketch('C', pts.sketch, XZ), sweep('W', prof, [entity('C', dot)])],
        'W',
      ),
    ).toMatch(/curves, not points/);
  });

  it('golden table: orientation × twist × scale × operation', async () => {
    const b = new SketchBuilder();
    rect(b, -5, -5, 10, 10);
    const p = paths();
    const table: Record<string, unknown> = {};
    for (const orientation of ['follow', 'fixed'] as const) {
      for (const twist of ['0 deg', '90 deg']) {
        for (const scale of ['1', '0.5']) {
          for (const operation of ['new-body', 'join', 'cut', 'intersect'] as const) {
            const key = `${orientation} twist=${twist} scale=${scale} ${operation}`;
            const result = await runWithShapes([
              box('B'),
              sketch('S', b.sketch),
              p.feature,
              sweep('W', [profile('S', b.sketch)], p.bend, {
                orientation,
                twist,
                scale,
                operation,
              }),
            ]);
            const st = status(result, 'W');
            if (st.status === 'error') {
              table[key] = { error: st.message };
              continue;
            }
            table[key] = {
              ...(st.status === 'warning' ? { warning: st.message } : {}),
              bodies: Object.fromEntries(
                result.bodies.map((body) => {
                  const m = measure(result, body.id);
                  return [
                    body.id,
                    {
                      volume: round(m.volume, 1),
                      bbox: boxOf(m.bbox),
                      faces: m.faces,
                      valid: m.valid,
                      sweepFaces: m.names.filter((n) => n.includes(':W:')).length,
                    },
                  ];
                }),
              ),
            };
          }
        }
      }
    }
    await expect(`${JSON.stringify(table, null, 1)}\n`).toMatchFileSnapshot(
      './golden/sweep-options.json',
    );
  });
});

// ------------------------------------------------------------------ loft

/** A square of side `s` centred on the origin of a sketch `id` on `plane`. */
function square(id: string, s: number, plane: GeomRef = XY) {
  const b = new SketchBuilder();
  const lines = rect(b, -s / 2, -s / 2, s, s);
  return {
    data: b.sketch,
    lines,
    feature: sketch(id, b.sketch, plane),
    ref: () => profile(id, b.sketch),
  };
}

function circleSketch(id: string, r: number, plane: GeomRef, at: [number, number] = [0, 0]) {
  const b = new SketchBuilder();
  const c = b.circle(at[0], at[1], r).id;
  return {
    data: b.sketch,
    circle: c,
    feature: sketch(id, b.sketch, plane),
    ref: () => profile(id, b.sketch),
  };
}

describe('loft', { timeout: 120_000 }, () => {
  const A = offsetPlane('A', XY, '20 mm');
  const C = offsetPlane('C', XY, '30 mm');

  it('ruled between two squares: a frustum, caps and sides named', async () => {
    const s1 = square('S1', 20);
    const s2 = square('S2', 10, planeOf(A));
    const result = ok(
      await runWithShapes([
        s1.feature,
        A,
        s2.feature,
        loft('L', [s1.ref(), s2.ref()], { ruled: true }),
      ]),
    );
    const m = measure(result, 'L:0');
    close(m.volume, (20 / 3) * (400 + 100 + 200));
    expect(m.valid).toBe(true);
    expect([...m.names].sort()).toEqual(
      ['loft:L:cap:end', 'loft:L:cap:start', ...s1.lines.map((l) => `loft:L:side:${l}`)].sort(),
    );
  });

  it('smooth through a square, a circle and a square; to a point; through a sketch point', async () => {
    const B = offsetPlane('B', XY, '10 mm');
    const s1 = square('S1', 20);
    const c = circleSketch('S2', 6, planeOf(B));
    const s3 = square('S3', 10, planeOf(A));
    const three = ok(
      await runWithShapes([
        s1.feature,
        A,
        B,
        c.feature,
        s3.feature,
        loft('L', [s1.ref(), c.ref(), s3.ref()]),
      ]),
    );
    const m = measure(three, 'L:0');
    expect(m.valid).toBe(true);
    expect(m.volume).toBeGreaterThan(20 * 100);
    expect(m.volume).toBeLessThan(20 * 400);
    expect(boxOf(m.bbox).slice(2, 3)).toEqual([0]);

    const apex = point('Q', 0, 0, 30);
    const pyramid = ok(
      await runWithShapes([
        s1.feature,
        apex,
        loft('L', [s1.ref(), planeOf(apex)], { ruled: true }),
      ]),
    );
    const n = measure(pyramid, 'L:0');
    close(n.volume, 4000);
    expect(n.names).toContain('loft:L:cap:start');
    expect(n.names).not.toContain('loft:L:cap:end');

    const top = new SketchBuilder();
    const tip = top.point(0, 0);
    const cone = ok(
      await runWithShapes([
        C,
        sketch('T', top.sketch, planeOf(C)),
        circleSketch('S2', 5, XY).feature,
        loft('L', [entity('T', tip), circleSketch('S2', 5, XY).ref()]),
      ]),
    );
    close(measure(cone, 'L:0').volume, (Math.PI * 25 * 30) / 3, 2e-3);
  });

  it('a closed ring through four circles', async () => {
    const sections = [
      circleSketch('R1', 3, XZ, [20, 0]),
      circleSketch('R2', 3, YZ, [20, 0]),
      circleSketch('R3', 3, XZ, [-20, 0]),
      circleSketch('R4', 3, YZ, [-20, 0]),
    ];
    const result = ok(
      await runWithShapes([
        ...sections.map((s) => s.feature),
        loft(
          'L',
          sections.map((s) => s.ref()),
          { closed: true },
        ),
      ]),
    );
    const m = measure(result, 'L:0');
    expect(m.valid).toBe(true);
    expect(m.names.some((n) => n.includes('cap'))).toBe(false);
    // Close to a torus of radii 20 and 3 (the ring through four points is a little squarer).
    expect(m.volume).toBeGreaterThan(0.9 * Math.PI * 9 * 2 * Math.PI * 20);
    expect(m.volume).toBeLessThan(1.2 * Math.PI * 9 * 2 * Math.PI * 20);
  });

  it('joins and cuts', async () => {
    const s1 = square('S1', 10);
    const s2 = square('S2', 4, planeOf(C));
    const result = ok(
      await runWithShapes([
        box('B'),
        s1.feature,
        C,
        s2.feature,
        loft('L', [s1.ref(), s2.ref()], { ruled: true, operation: 'cut' }),
      ]),
    );
    // The frustum from 10 to 4 over 30 mm, its part below z = 20 (side 6 there).
    close(measure(result, 'B:0').volume, 8000 - (20 / 3) * (100 + 36 + 60));
  });

  it('refuses what it cannot build, in words', async () => {
    const s1 = square('S1', 20);
    const s2 = square('S2', 10, planeOf(A));
    const apex = point('Q', 0, 0, 30);
    expect(await errorOf([s1.feature, loft('L', [s1.ref()])], 'L')).toMatch(
      /at least two sections/,
    );
    expect(
      await errorOf(
        [s1.feature, A, s2.feature, loft('L', [s1.ref(), s2.ref()], { closed: true })],
        'L',
      ),
    ).toMatch(/closed loft needs at least three/);
    expect(
      await errorOf(
        [s1.feature, A, s2.feature, apex, loft('L', [s1.ref(), planeOf(apex), s2.ref()])],
        'L',
      ),
    ).toMatch(/can only start or end/);
    const same = square('S3', 8);
    expect(
      await errorOf([s1.feature, same.feature, loft('L', [s1.ref(), same.ref()])], 'L'),
    ).toMatch(/lie in one plane/);
    const holed = new SketchBuilder();
    rect(holed, -10, -10, 20, 20);
    holed.circle(0, 0, 3);
    expect(
      await errorOf(
        [
          sketch('H', holed.sketch),
          A,
          s2.feature,
          loft('L', [profile('H', holed.sketch), s2.ref()]),
        ],
        'L',
      ),
    ).toMatch(/has a hole/);
  });

  it('golden table: ruled × operation', async () => {
    const s1 = square('S1', 10);
    const c = circleSketch('S2', 4, planeOf(C));
    const table: Record<string, unknown> = {};
    for (const ruled of [false, true]) {
      for (const operation of ['new-body', 'join', 'cut', 'intersect'] as const) {
        const key = `${ruled ? 'ruled' : 'smooth'} ${operation}`;
        const result = await runWithShapes([
          box('B'),
          s1.feature,
          C,
          c.feature,
          loft('L', [s1.ref(), c.ref()], { ruled, operation }),
        ]);
        const st = status(result, 'L');
        table[key] =
          st.status === 'error'
            ? { error: st.message }
            : Object.fromEntries(
                result.bodies.map((body) => {
                  const m = measure(result, body.id);
                  return [
                    body.id,
                    {
                      volume: round(m.volume, 1),
                      bbox: boxOf(m.bbox),
                      faces: m.faces,
                      valid: m.valid,
                    },
                  ];
                }),
              );
      }
    }
    await expect(`${JSON.stringify(table, null, 1)}\n`).toMatchFileSnapshot(
      './golden/loft-options.json',
    );
  });
});

// ------------------------------------------------------------------ coil

describe('coil', { timeout: 120_000 }, () => {
  it('the default coil: 5 turns, 20 mm high, a 2 mm wire on 20 mm', async () => {
    const result = ok(await runWithShapes([coil('K')]));
    const m = measure(result, 'K:0');
    expect(m.valid).toBe(true);
    close(m.volume, Math.PI * 1 * 5 * 2 * Math.PI * 10);
    expect(boxOf(m.bbox)).toEqual([-11, -11, -1, 11, 11, 21]);
    expect([...m.names].sort()).toEqual([
      'coil:K:cap:end',
      'coil:K:cap:start',
      'coil:K:side:surface',
    ]);
    const data = seen.get('K')?.data as CoilOutputData;
    expect(data).toMatchObject({ radius: 10, turns: 5, pitch: 4, height: 20 });
  });

  it('each type takes two of revolutions, height and pitch', async () => {
    const shapes: Record<string, unknown> = {};
    for (const [type, numbers] of [
      ['revolutions-pitch', { revolutions: '3', pitch: '5 mm' }],
      ['height-pitch', { height: '12 mm', pitch: '4 mm' }],
    ] as const) {
      ok(await runWithShapes([coil('K', { type, numbers })]));
      const data = seen.get('K')?.data as CoilOutputData;
      shapes[type] = [data.turns, data.pitch, data.height];
    }
    expect(shapes).toEqual({ 'revolutions-pitch': [3, 5, 15], 'height-pitch': [3, 4, 12] });
  });

  it('sections and positions: Pappus volumes, named sides', async () => {
    const turns = 3;
    const ring = (r: number) => turns * 2 * Math.PI * r;
    const base = { revolutions: '3', height: '15 mm', size: '2 mm' };
    const square = ok(
      await runWithShapes([coil('K', { section: 'square', position: 'inside', numbers: base })]),
    );
    const m = measure(square, 'K:0');
    close(m.volume, 4 * ring(9));
    expect([...m.names].sort()).toEqual(
      ['cap:end', 'cap:start', 'side:bottom', 'side:inner', 'side:outer', 'side:top'].map(
        (r) => `coil:K:${r}`,
      ),
    );
    const h = Math.sqrt(3);
    const out = ok(
      await runWithShapes([
        coil('K', { section: 'triangle-out', position: 'outside', numbers: base }),
      ]),
    );
    // The centroid of a triangle lies a third of its height from its base.
    close(measure(out, 'K:0').volume, h * ring(10 + h / 3));
    const inward = ok(
      await runWithShapes([coil('K', { section: 'triangle-in', position: 'on', numbers: base })]),
    );
    close(measure(inward, 'K:0').volume, h * ring(10 + h / 2 - h / 3));
  });

  it('winds counter-clockwise or clockwise, and tapers', async () => {
    const quarter = { revolutions: '0.25', height: '1 mm', size: '0.5 mm' };
    const ccw = ok(await runWithShapes([coil('K', { numbers: quarter })]));
    expect(measure(ccw, 'K:0').bbox.max[1]).toBeGreaterThan(9.5);
    const cw = ok(await runWithShapes([coil('K', { numbers: quarter, direction: 'clockwise' })]));
    expect(measure(cw, 'K:0').bbox.min[1]).toBeLessThan(-9.5);
    const tapered = ok(await runWithShapes([coil('K', { numbers: { taper: '10 deg' } })]));
    const t = measure(tapered, 'K:0');
    expect(t.valid).toBe(true);
    expect(t.bbox.max[0]).toBeGreaterThan(11 + Math.tan((10 * Math.PI) / 180) * 18);
  });

  it('sits on a face, joins a body, and a pattern repeats a cut', async () => {
    const first = ok(await runWithShapes([cylinder('Y', { diameter: '20 mm', height: '20 mm' })]));
    const top = (first.bodies[0]?.mesh?.faceIds ?? []).indexOf('cylinder:Y:cap:end');
    const face = engine.reference('Y:0' as never, 'face', top);
    if (!face) throw new Error('no face');
    const joined = ok(
      await runWithShapes([
        cylinder('Y', { diameter: '20 mm', height: '20 mm' }),
        coil('K', { plane: face, numbers: { diameter: '16 mm' }, operation: 'join' }),
      ]),
    );
    expect(joined.bodies.map((b) => b.id)).toEqual(['Y:0']);
    const j = measure(joined, 'Y:0');
    expect(j.bbox.max[2]).toBeCloseTo(41, 1);
    // A thread-like cut round a cylinder, repeated along Z.
    const cut = ok(
      await runWithShapes([
        cylinder('Y', { diameter: '20 mm', height: '40 mm' }),
        coil('K', {
          section: 'triangle-in',
          position: 'inside',
          numbers: {
            diameter: '20 mm',
            revolutions: '2',
            height: '6 mm',
            size: '2 mm',
            offset: '5 mm',
          },
          operation: 'cut',
        }),
        {
          ...testFeature('R', 'rectangularPattern'),
          inputs: rectangularPatternInputs({
            features: ['K'],
            direction1: originAxisRef('origin:z'),
            count1: '2',
            distance1: '20 mm',
          }),
        },
      ]),
    );
    // Measured now: the next run releases its shapes.
    const patterned = measure(cut, 'Y:0').volume;
    const single = ok(
      await runWithShapes([
        cylinder('Y', { diameter: '20 mm', height: '40 mm' }),
        coil('K', {
          section: 'triangle-in',
          position: 'inside',
          numbers: {
            diameter: '20 mm',
            revolutions: '2',
            height: '6 mm',
            size: '2 mm',
            offset: '5 mm',
          },
          operation: 'cut',
        }),
      ]),
    );
    const whole = Math.PI * 100 * 40;
    const once = whole - measure(single, 'Y:0').volume;
    expect(once).toBeGreaterThan(1);
    close(whole - patterned, 2 * once, 2e-3);
  });

  it('refuses sizes that would make the turns or the axis meet', async () => {
    expect(
      await errorOf([coil('K', { numbers: { pitch: '2 mm' }, type: 'revolutions-pitch' })], 'K'),
    ).toMatch(/as tall as the pitch/);
    expect(await errorOf([coil('K', { numbers: { diameter: '2 mm' } })], 'K')).toMatch(
      /reaches the coil/,
    );
    expect(await errorOf([coil('K', { numbers: { taper: '-60 deg' } })], 'K')).toMatch(
      /taper narrows/,
    );
    expect(
      await errorOf([coil('K', { numbers: { revolutions: '2000', height: '20000 mm' } })], 'K'),
    ).toMatch(/at most 1000/);
    expect(await errorOf([coil('K', { numbers: { size: '0 mm' } })], 'K')).toMatch(
      /section size must be greater than 0/,
    );
  });

  it('golden table: section × position × direction', async () => {
    const table: Record<string, unknown> = {};
    for (const section of ['circle', 'square', 'triangle-out', 'triangle-in'] as const) {
      for (const position of ['inside', 'on', 'outside'] as const) {
        for (const direction of ['counter-clockwise', 'clockwise'] as const) {
          const key = `${section} ${position} ${direction}`;
          const result = await runWithShapes([
            coil('K', {
              section,
              position,
              direction,
              numbers: { revolutions: '2.5', height: '10 mm' },
            }),
          ]);
          const st = status(result, 'K');
          if (st.status === 'error') {
            table[key] = { error: st.message };
            continue;
          }
          const m = measure(result, 'K:0');
          table[key] = {
            volume: round(m.volume, 2),
            bbox: boxOf(m.bbox),
            faces: m.faces,
            valid: m.valid,
            names: [...m.names].sort(),
          };
        }
      }
    }
    await expect(`${JSON.stringify(table, null, 1)}\n`).toMatchFileSnapshot(
      './golden/coil-options.json',
    );
  });
});
