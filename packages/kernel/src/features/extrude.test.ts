// The extrude feature (P2-06, ADR-0028) through the recompute engine with
// real OCCT: every option of FR-FT-01, the names it gives (ADR-0005), its
// errors and warnings. `golden/extrude-options.json` is the golden table of
// every direction × extent × operation × taper combination (a Vitest file
// snapshot); rewrite it with `pnpm vitest run -u
// packages/kernel/src/features/extrude` and review the diff.
import {
  type BodyId,
  type ExtrudeDirection,
  type ExtrudeExtent,
  type ExtrudeInputOptions,
  type ExtrudeOperation,
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
} from '@extrudo/core';
import { SketchBuilder } from '@extrudo/sketch/fixtures';
import { detectProfiles, type Profile, profileCentroid } from '@extrudo/sketch/profiles';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { SubShapeKind } from '../history';
import { Kernel, type ShapeHandle } from '../kernel';
import { loadOcct } from '../occt/load';
import { RecomputeEngine } from '../recompute/engine';
import { testDocument, testFeature, testFeatures } from '../recompute/testing';
import type { FeatureOutput, KernelFeatureDefinition, RecomputeResult } from '../recompute/types';
import type { ExtrudeOutputData } from './extrude';

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
type Plane = 'origin:xy' | 'origin:xz' | 'origin:yz';

// ------------------------------------------------------------------ helpers

function rect(b: SketchBuilder, x: number, y: number, w: number, h: number): string[] {
  return [
    b.line(x, y, x + w, y).id,
    b.line(x + w, y, x + w, y + h).id,
    b.line(x + w, y + h, x, y + h).id,
    b.line(x, y + h, x, y).id,
  ];
}

function polygon(b: SketchBuilder, points: [number, number][]): string[] {
  return points.map((p, i) => {
    const q = points[(i + 1) % points.length] as [number, number];
    return b.line(p[0], p[1], q[0], q[1]).id;
  });
}

function sketch(id: string, data: SketchData, plane: Plane = 'origin:xy'): Feature {
  return { ...testFeature(id, 'sketch'), inputs: sketchInputs(originPlaneRef(plane), data) };
}

/** A profile of `data` as a reference: the largest, or the one `pick` chooses. */
function profile(
  sketchId: string,
  data: SketchData,
  pick: (profiles: Profile[]) => Profile | undefined = (p) => p[0],
): GeomRef {
  const found = pick(detectProfiles(data).sort((a, b) => b.area - a.area));
  if (!found) throw new Error('no profile');
  return { kind: 'profile', id: `${sketchId}/${found.id}` };
}

/** The profile whose centroid is nearest (x, y). */
const near =
  (x: number, y: number) =>
  (profiles: Profile[]): Profile | undefined =>
    [...profiles].sort((a, b) => dist(a, x, y) - dist(b, x, y))[0];
const dist = (p: Profile, x: number, y: number) => {
  const [cx, cy] = profileCentroid(p);
  return Math.hypot(cx - x, cy - y);
};

function extrude(id: string, profiles: GeomRef[], options: ExtrudeInputOptions): Feature {
  return { ...testFeature(id, 'extrude'), inputs: extrudeInputs(profiles, options) };
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

/** Volume, area, bounding box and counts of a body of the last `runWithShapes`. */
function measure(result: Done, body: string) {
  const found = result.bodies.find((b) => b.id === body);
  const shape = bodyShapes.get(body) as ShapeHandle | undefined;
  if (!found || shape === undefined) throw new Error(`no body ${body}`);
  const m = kernel.measure(shape);
  const solids = kernel.solids(shape);
  kernel.release(...solids);
  return {
    volume: m.volume,
    area: m.area,
    bbox: m.bbox,
    faces: kernel.count(shape, 'face'),
    edges: kernel.count(shape, 'edge'),
    vertices: kernel.count(shape, 'vertex'),
    solids: solids.length,
    names: found.mesh?.faceIds ?? [],
    edgeNames: found.mesh?.edgeIds ?? [],
  };
}

/** The body shapes of the last `runWithShapes`. */
let bodyShapes = new Map<string, ShapeHandle>();

/** A recompute that also captures the body shapes (through a spy on the kernel's mesh call). */
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

/** A recompute from an empty cache, so `seen` holds this document's outputs. */
async function fresh(doc: ExtrudoDocument): Promise<Done> {
  engine.clear();
  seen.clear();
  return run(doc);
}

async function outputData(doc: ExtrudoDocument): Promise<ExtrudeOutputData> {
  ok(await fresh(doc));
  const data = seen.get('E')?.data as ExtrudeOutputData | undefined;
  if (!data) throw new Error('no data');
  return data;
}

/** A reference, with its fingerprint, to the sub-shape named `id` in the last recompute. */
function refTo(result: Done, kind: SubShapeKind, id: string): GeomRef {
  for (const body of result.bodies) {
    const list =
      kind === 'face'
        ? body.mesh?.faceIds
        : kind === 'edge'
          ? body.mesh?.edgeIds
          : body.mesh?.vertexIds;
    const index = list?.indexOf(id) ?? -1;
    if (index < 0) continue;
    const ref = engine.reference(body.id, kind, index);
    if (ref) return ref;
  }
  throw new Error(`no ${kind} named ${id}`);
}

const close = (a: number, b: number, tolerance = 1e-3) =>
  expect(Math.abs(a - b), `${a} ≈ ${b}`).toBeLessThanOrEqual(tolerance * Math.max(1, Math.abs(b)));

/** A bounding box as [min, max] rounded to 0.01 mm (OCCT pads boxes by the tolerance, more on curves). */
const box = (b: { min: readonly number[]; max: readonly number[] }) =>
  [...b.min, ...b.max].map((v) => round(v, 2));

const round = (x: number, digits = 3) => {
  const r = Number(x.toFixed(digits));
  return Object.is(r, -0) ? 0 : r;
};

// ------------------------------------------------------------------ scenes

/** A 40 × 30 block from z = −10 to 10 (body `B:0`), from a rectangle on XY. */
function block() {
  const b = new SketchBuilder();
  const [bottom, right, top, left] = rect(b, 0, 0, 40, 30) as [string, string, string, string];
  const data = b.sketch;
  return {
    data,
    lines: { bottom, right, top, left },
    features: [
      sketch('SB', data),
      extrude('B', [profile('SB', data)], { direction: 'symmetric', distance: '20 mm' }),
    ],
  };
}

/** A circle of radius 5 at (10, 10) on XY. */
function circle(id = 'SC', x = 10, y = 10, r = 5) {
  const b = new SketchBuilder();
  const c = b.circle(x, y, r).id;
  return { data: b.sketch, circle: c, feature: sketch(id, b.sketch) };
}

describe('extrude', { timeout: 120_000 }, () => {
  it('a profile one side: a new body named after its sketch', async () => {
    const b = new SketchBuilder();
    const [l0, l1, l2, l3] = rect(b, 0, 0, 30, 10) as [string, string, string, string];
    const result = ok(
      await runWithShapes(
        testDocument([
          sketch('S', b.sketch),
          extrude('E', [profile('S', b.sketch)], { distance: '5 mm' }),
        ]),
      ),
    );
    expect(result.bodies.map((body) => body.id)).toEqual(['E:0']);
    const m = measure(result, 'E:0');
    close(m.volume, 1500);
    expect(box(m.bbox)).toEqual([0, 0, 0, 30, 10, 5]);
    expect([...m.names].sort()).toEqual(
      [
        'extrude:E:cap:end',
        'extrude:E:cap:start',
        `extrude:E:side:${l0}`,
        `extrude:E:side:${l1}`,
        `extrude:E:side:${l2}`,
        `extrude:E:side:${l3}`,
      ].sort(),
    );
    expect(m.edgeNames).toContain(`e[extrude:E:cap:end|extrude:E:side:${l2}]`);
  });

  it('negative distances and flip go the other way; the data says where it went', async () => {
    const c = circle();
    for (const [options, min, max, extents] of [
      [{ distance: '-4 mm' }, -4, 0, [-4, 0]],
      [{ distance: '4 mm', flip: true }, -4, 0, [4, 0]],
      [{ distance: '6 mm', direction: 'symmetric' }, -3, 3, [3, 3]],
      // The `half` measure (P4-12's amendment): the distance is each side's.
      [{ distance: '6 mm', direction: 'symmetric', symmetricMeasure: 'half' }, -6, 6, [6, 6]],
      [{ distance: '6 mm', direction: 'two-sides', distance2: '2 mm' }, -2, 6, [6, 2]],
      [{ distance: '6 mm', direction: 'two-sides', distance2: '-2 mm' }, 2, 6, [6, -2]],
    ] as [ExtrudeInputOptions, number, number, [number, number]][]) {
      const result = ok(
        await runWithShapes(
          testDocument([c.feature, extrude('E', [profile('SC', c.data)], options)]),
        ),
      );
      const m = measure(result, 'E:0');
      close(m.bbox.min[2], min, 0.02);
      close(m.bbox.max[2], max, 0.02);
      close(m.volume, 25 * Math.PI * (max - min));
      const data = await outputData(
        testDocument([c.feature, extrude('E', [profile('SC', c.data)], options)]),
      );
      expect(data.extents.map((e) => round(e))).toEqual(extents);
      expect(data.origin.map((v) => round(v))).toEqual([10, 10, 0]);
      expect(data.direction.map((v) => round(v))).toEqual([0, 0, options.flip ? -1 : 1]);
    }
  });

  it('a symmetric extrude measures the whole length or each side (P4-12)', async () => {
    const c = circle();
    for (const [how, reach] of [
      ['half', 10],
      ['whole', 5],
      [undefined, 5],
    ] as [ExtrudeInputOptions['symmetricMeasure'], number][]) {
      const options: ExtrudeInputOptions = {
        direction: 'symmetric',
        distance: '10 mm',
        ...(how === 'half' ? { symmetricMeasure: how } : {}),
      };
      const result = ok(
        await runWithShapes(
          testDocument([c.feature, extrude('E', [profile('SC', c.data)], options)]),
        ),
      );
      const m = measure(result, 'E:0');
      close(m.volume, 25 * Math.PI * 2 * reach);
      close(m.bbox.min[2], -reach, 0.02);
      close(m.bbox.max[2], reach, 0.02);
      const data = await outputData(
        testDocument([c.feature, extrude('E', [profile('SC', c.data)], options)]),
      );
      expect(data.extents.map((e) => round(e))).toEqual([reach, reach]);
    }
  });

  it('a profile with a hole, and several profiles at once', async () => {
    const b = new SketchBuilder();
    rect(b, 0, 0, 40, 20);
    const hole = b.circle(10, 10, 4).id;
    b.circle(60, 10, 5); // a separate disc
    b.line(30, 0, 30, 20); // splits the plate: two regions next to each other
    const data = b.sketch;
    const ring = profile('S', data, near(14, 10));
    const right = profile('S', data, near(35, 10));
    const disc = profile('S', data, near(60, 10));

    const one = ok(
      await runWithShapes(
        testDocument([sketch('S', data), extrude('E', [ring], { distance: '3 mm' })]),
      ),
    );
    const m = measure(one, 'E:0');
    close(m.volume, (30 * 20 - 16 * Math.PI) * 3);
    expect(m.names).toContain(`extrude:E:side:${hole}`);
    expect(m.faces).toBe(7);

    // The ring and the region next to it become one plate (no face between
    // them); the disc is a second body.
    const all = ok(
      await runWithShapes(
        testDocument([sketch('S', data), extrude('E', [ring, right, disc], { distance: '3 mm' })]),
      ),
    );
    expect(all.bodies.map((body) => body.id)).toEqual(['E:0', 'E:1']);
    const plate = measure(all, 'E:0');
    close(plate.volume, (40 * 20 - 16 * Math.PI) * 3);
    expect(plate.faces).toBe(7);
    const discBody = measure(all, 'E:1');
    close(discBody.volume, 25 * Math.PI * 3);
    expect(discBody.names.filter((n) => n.startsWith('extrude:E:cap:end'))).toHaveLength(1);
    expect(plate.names.some((n) => n.startsWith('extrude:E:cap:end'))).toBe(true);
  });

  it('tapers: cones and frustums, widening or narrowing, per side', async () => {
    const c = circle();
    const cone = (r: number, h: number, t: number) => {
      const r2 = r + h * Math.tan((t * Math.PI) / 180);
      return (Math.PI * h * (r * r + r * r2 + r2 * r2)) / 3;
    };
    for (const [options, volume] of [
      [{ distance: '10 mm', taper: '-10 deg' }, cone(5, 10, -10)],
      [{ distance: '10 mm', taper: '10 deg' }, cone(5, 10, 10)],
      [{ distance: '-10 mm', taper: '10 deg' }, cone(5, 10, 10)],
      [{ distance: '10 mm', taper: '-10 deg', direction: 'symmetric' }, 2 * cone(5, 5, -10)],
      [
        {
          direction: 'two-sides',
          distance: '10 mm',
          taper: '-10 deg',
          distance2: '4 mm',
          taper2: '5 deg',
        },
        cone(5, 10, -10) + cone(5, 4, 5),
      ],
      [
        {
          direction: 'two-sides',
          distance: '10 mm',
          taper: '5 deg',
          distance2: '4 mm',
          taper2: '-5 deg',
        },
        cone(5, 10, 5) + cone(5, 4, -5),
      ],
    ] as [ExtrudeInputOptions, number][]) {
      const result = ok(
        await runWithShapes(
          testDocument([c.feature, extrude('E', [profile('SC', c.data)], options)]),
        ),
      );
      const m = measure(result, 'E:0');
      close(m.volume, volume);
      expect(m.solids).toBe(1);
    }
    // A symmetric taper has a side face per side, named `side` and `side2`.
    const symmetric = ok(
      await runWithShapes(
        testDocument([
          c.feature,
          extrude('E', [profile('SC', c.data)], {
            direction: 'symmetric',
            distance: '10 mm',
            taper: '-10 deg',
          }),
        ]),
      ),
    );
    expect([...measure(symmetric, 'E:0').names].sort()).toEqual(
      [
        'extrude:E:cap:end',
        'extrude:E:cap:start',
        `extrude:E:side2:${c.circle}`,
        `extrude:E:side:${c.circle}`,
      ].sort(),
    );
    // Opposite tapers on two sides make one straight side: flat sides merge
    // into one face, named after side 1. (Cones stay two faces: OCCT doesn't
    // see the two halves as one surface.)
    const b = new SketchBuilder();
    const lines = rect(b, 0, 0, 20, 10);
    const straight = ok(
      await runWithShapes(
        testDocument([
          sketch('S', b.sketch),
          extrude('E', [profile('S', b.sketch)], {
            direction: 'two-sides',
            distance: '10 mm',
            taper: '5 deg',
            distance2: '4 mm',
            taper2: '-5 deg',
          }),
        ]),
      ),
    );
    expect([...measure(straight, 'E:0').names].sort()).toEqual(
      [
        'extrude:E:cap:end',
        'extrude:E:cap:start',
        ...lines.map((l) => `extrude:E:side:${l}`),
      ].sort(),
    );
  });

  it('a rectangle tapered keeps its corners sharp and every side named', async () => {
    const b = new SketchBuilder();
    const lines = rect(b, 0, 0, 20, 10);
    const result = ok(
      await runWithShapes(
        testDocument([
          sketch('S', b.sketch),
          extrude('E', [profile('S', b.sketch)], { distance: '10 mm', taper: '-5 deg' }),
        ]),
      ),
    );
    const m = measure(result, 'E:0');
    const t = Math.tan((5 * Math.PI) / 180);
    const h = 10;
    close(m.volume, h * 200 - t * h * h * 30 + (4 / 3) * t * t * h ** 3);
    expect(m.faces).toBe(6);
    expect(m.edges).toBe(12);
    for (const line of lines) expect(m.names).toContain(`extrude:E:side:${line}`);
  });

  it('joins, cuts and intersects the bodies it touches', async () => {
    const base = block();
    const c = circle();
    const pick = profile('SC', c.data);
    const doc = (operation: ExtrudeOperation, more: ExtrudeInputOptions = {}) =>
      testDocument([
        ...base.features,
        c.feature,
        extrude('E', [pick], { distance: '15 mm', operation, ...more }),
      ]);
    const blockVolume = 40 * 30 * 20;
    const disc = 25 * Math.PI;

    const joined = ok(await runWithShapes(doc('join')));
    expect(joined.bodies.map((b) => b.id)).toEqual(['B:0']);
    close(measure(joined, 'B:0').volume, blockVolume + disc * 5);
    expect(measure(joined, 'B:0').names).toContain(`extrude:E:side:${c.circle}`);

    const cut = ok(await runWithShapes(doc('cut')));
    close(measure(cut, 'B:0').volume, blockVolume - disc * 10);

    const common = ok(await runWithShapes(doc('intersect')));
    close(measure(common, 'B:0').volume, disc * 10);

    const added = ok(await runWithShapes(doc('new-body')));
    expect(added.bodies.map((b) => b.id)).toEqual(['B:0', 'E:0']);
  });

  it('press-pulls a flat face of a body, and extrudes up to a face or a vertex', async () => {
    const base = block();
    const first = ok(await runWithShapes(testDocument(base.features)));
    const top = refTo(first, 'face', 'extrude:B:cap:end');
    const bottom = refTo(first, 'face', 'extrude:B:cap:start');
    const corner = refTo(
      first,
      'vertex',
      `v[extrude:B:cap:end|extrude:B:side:${base.lines.right}|extrude:B:side:${base.lines.top}]`,
    );

    // Out of the top face as a new body: the sides are named after the body's edges.
    const block2 = ok(
      await runWithShapes(
        testDocument([...base.features, extrude('P', [top], { distance: '5 mm' })]),
      ),
    );
    const pad = measure(block2, 'P:0');
    close(pad.volume, 40 * 30 * 5);
    expect(pad.names).toContain(
      `extrude:P:side:(e[extrude:B:cap:end|extrude:B:side:${base.lines.top}])`,
    );
    // Joined, its sides merge with the block's (which keep their names); the
    // new top is its end cap.
    const pulled = ok(
      await runWithShapes(
        testDocument([
          ...base.features,
          extrude('P', [top], { distance: '5 mm', operation: 'join' }),
        ]),
      ),
    );
    const m = measure(pulled, 'B:0');
    close(m.volume, 40 * 30 * 25);
    expect(m.faces).toBe(6);
    expect([...m.names].sort()).toEqual(
      [
        'extrude:B:cap:start',
        'extrude:P:cap:end',
        ...Object.values(base.lines).map((l) => `extrude:B:side:${l}`),
      ].sort(),
    );

    // Into it, cut: 3 mm off the top.
    const pushed = ok(
      await runWithShapes(
        testDocument([
          ...base.features,
          extrude('P', [top], { distance: '3 mm', flip: true, operation: 'cut' }),
        ]),
      ),
    );
    close(measure(pushed, 'B:0').bbox.max[2], 7, 0.02);

    // A circle up to the top face, the bottom face (behind: it turns round),
    // and a vertex.
    const c = circle();
    for (const [toObject, min, max] of [
      [top, 0, 10],
      [bottom, -10, 0],
      [corner, 0, 10],
    ] as [GeomRef, number, number][]) {
      const result = ok(
        await runWithShapes(
          testDocument([
            ...base.features,
            c.feature,
            extrude('E', [profile('SC', c.data)], { extent: 'to-object', toObject }),
          ]),
        ),
      );
      const disc = measure(result, 'E:0');
      close(disc.bbox.min[2], min, 0.02);
      close(disc.bbox.max[2], max, 0.02);
    }
  });

  it('extrudes up to an inclined face, which becomes its end', async () => {
    // A wedge on XZ: its top rises from z = 10 at x = 0 to z = 20 at x = 40.
    const b = new SketchBuilder();
    polygon(b, [
      [0, 0],
      [40, 0],
      [40, 20],
      [0, 10],
    ]);
    const wedge = [
      sketch('SW', b.sketch, 'origin:xz'),
      extrude('W', [profile('SW', b.sketch)], { direction: 'symmetric', distance: '60 mm' }),
    ];
    const first = ok(await runWithShapes(testDocument(wedge)));
    const slope = first.bodies[0]?.mesh?.faceIds?.find((name, i) => {
      const ref = engine.reference('W:0' as BodyId, 'face', i);
      const dir = ref?.fingerprint?.dir ?? [0, 0, 0];
      return name.includes(':side:') && Math.abs(dir[0]) > 0.1 && Math.abs(dir[2]) > 0.1;
    });
    if (!slope) throw new Error('no sloped face');
    const target = refTo(first, 'face', slope);
    const c = circle('SC', 20, 0, 3);
    for (const taper of ['0 deg', '-5 deg', '5 deg']) {
      const result = ok(
        await runWithShapes(
          testDocument([
            ...wedge,
            c.feature,
            extrude('E', [profile('SC', c.data)], { extent: 'to-object', toObject: target, taper }),
          ]),
        ),
      );
      const m = measure(result, 'E:0');
      expect(m.names).toContain('extrude:E:cap:end');
      expect(m.faces).toBe(3);
      if (taper === '0 deg') close(m.volume, 9 * Math.PI * 15); // the mean height is at the centroid
      const data = await outputData(
        testDocument([
          ...wedge,
          c.feature,
          extrude('E', [profile('SC', c.data)], { extent: 'to-object', toObject: target, taper }),
        ]),
      );
      close(data.extents[0], 15);
    }
  });

  it('goes through all bodies, one way or both', async () => {
    const base = block();
    const c = circle();
    const pick = profile('SC', c.data);
    for (const [options, removed] of [
      [{ extent: 'through-all' }, 10],
      [{ extent: 'through-all', flip: true }, 10],
      [{ extent: 'through-all', direction: 'symmetric' }, 20],
      [{ direction: 'two-sides', distance: '4 mm', extent2: 'through-all' }, 14],
    ] as [ExtrudeInputOptions, number][]) {
      const result = ok(
        await runWithShapes(
          testDocument([
            ...base.features,
            c.feature,
            extrude('E', [pick], { ...options, operation: 'cut' }),
          ]),
        ),
      );
      close(measure(result, 'B:0').volume, 40 * 30 * 20 - 25 * Math.PI * removed);
    }
  });

  it('takes the bodies it is told to, and joins several into one', async () => {
    const b1 = new SketchBuilder();
    rect(b1, 0, 0, 10, 10);
    rect(b1, 20, 0, 10, 10);
    const two = [
      sketch('S1', b1.sketch),
      extrude('B', [profile('S1', b1.sketch, near(5, 5)), profile('S1', b1.sketch, near(25, 5))], {
        distance: '5 mm',
      }),
    ];
    const bridge = new SketchBuilder();
    rect(bridge, 5, 2, 20, 6);
    const over = [
      sketch('S2', bridge.sketch),
      extrude('E', [profile('S2', bridge.sketch)], { distance: '2 mm', operation: 'cut' }),
    ];
    // Automatic: both bodies are cut.
    const both = ok(await runWithShapes(testDocument([...two, ...over])));
    close(measure(both, 'B:0').volume, 500 - 5 * 6 * 2);
    close(measure(both, 'B:1').volume, 500 - 5 * 6 * 2);
    // Told to cut only B:1.
    const only = ok(
      await runWithShapes(
        testDocument([
          ...two,
          sketch('S2', bridge.sketch),
          extrude('E', [profile('S2', bridge.sketch)], {
            distance: '2 mm',
            operation: 'cut',
            bodies: ['B:1'],
          }),
        ]),
      ),
    );
    close(measure(only, 'B:0').volume, 500);
    close(measure(only, 'B:1').volume, 500 - 60);
    // A join touching both makes one body, the first.
    const joined = ok(
      await runWithShapes(
        testDocument([
          ...two,
          sketch('S2', bridge.sketch),
          extrude('E', [profile('S2', bridge.sketch)], { distance: '8 mm', operation: 'join' }),
        ]),
      ),
    );
    expect(joined.bodies.map((b) => b.id)).toEqual(['B:0']);
    close(measure(joined, 'B:0').volume, 1000 + 20 * 6 * 8 - 2 * 5 * 6 * 5);
  });

  it('warns when a join has nothing to join, and offers the tool for previews', async () => {
    const c = circle();
    const doc = testDocument([
      c.feature,
      extrude('E', [profile('SC', c.data)], { distance: '2 mm', operation: 'join' }),
    ]);
    const result = await run(doc);
    expect(status(result, 'E')).toEqual({
      status: 'warning',
      message: 'Nothing to join to, so the extrude made a new body.',
    });
    expect(result.bodies.map((b) => b.id)).toEqual(['E:0']);

    const base = block();
    ok(
      await fresh(
        testDocument([
          ...base.features,
          c.feature,
          extrude('E', [profile('SC', c.data)], { distance: '15 mm', operation: 'cut' }),
        ]),
      ),
    );
    const tools = seen.get('E')?.previewTools ?? [];
    expect(tools.map((t) => t.style)).toEqual(['cut']);
    close(kernel.measure((tools[0] as { shape: ShapeHandle }).shape).volume, 25 * Math.PI * 15);
    // The cache owns the tool: clearing it gives every shape back.
    engine.clear();
    expect(kernel.stats().liveShapes).toBe(0);
  });

  it('tells the user what is wrong', async () => {
    const base = block();
    const c = circle();
    const pick = profile('SC', c.data);
    const b = new SketchBuilder();
    b.ellipse(0, 0, 5, 3);
    const ellipse = sketch('SE', b.sketch);
    const onXz = circle('SX');
    const r = new SketchBuilder();
    rect(r, 0, 0, 10, 6);
    const rectangleData = r.sketch;
    const rectangle = sketch('SR', rectangleData);
    const steep =
      'The taper is too steep for this distance: the sides meet before the end. Use a smaller angle or distance.';
    const xz = sketch('SX', onXz.data, 'origin:xz');
    const cases: [Feature[], string][] = [
      // The Wall bracket template's extrudes: expressions, no profiles.
      [
        [
          {
            ...testFeature('E', 'extrude'),
            inputs: {
              distance: { kind: 'expr', expr: '10 mm', paramName: 'd1', unit: 'length' },
              taper: { kind: 'expr', expr: '5 deg', paramName: 'd2', unit: 'angle' },
            },
          },
        ],
        'Pick at least one profile or face to extrude.',
      ],
      [
        [c.feature, extrude('E', [pick], { distance: '0 mm' })],
        'The distance is 0. Enter a distance other than 0.',
      ],
      [[c.feature, extrude('E', [pick], {})], 'Enter a distance.'],
      [
        [c.feature, extrude('E', [pick], { distance: '5 mm', operation: 'cut' })],
        "The cut doesn't touch any body. Check its direction and distance.",
      ],
      [
        [
          rectangle,
          extrude('E', [profile('SR', rectangleData)], { distance: '10 mm', taper: '-20 deg' }),
        ],
        steep,
      ],
      [
        [ellipse, extrude('E', [profile('SE', b.sketch)], { distance: '10 mm', taper: '3 deg' })],
        "Can't taper sides made from ellipses or splines yet. Set the taper to 0.",
      ],
      [
        [c.feature, extrude('E', [pick], { distance: '10 mm', taper: '90 deg' })],
        'The taper angle must be between -90° and 90°.',
      ],
      [
        [
          c.feature,
          extrude('E', [pick], {
            direction: 'symmetric',
            extent: 'to-object',
            toObject: originPlaneRef('origin:xy'),
          }),
        ],
        "A symmetric extrude can't end at an object. Use two sides instead.",
      ],
      [
        [
          c.feature,
          extrude('E', [pick], { extent: 'to-object', toObject: originPlaneRef('origin:xy') }),
        ],
        "That object lies in the profile's plane, so there is nothing to extrude. Pick another object.",
      ],
      [
        [
          c.feature,
          extrude('E', [pick], { extent: 'to-object', toObject: originPlaneRef('origin:yz') }),
        ],
        'The extrude runs alongside that object and never reaches it. Pick another object.',
      ],
      [[c.feature, extrude('E', [pick], { extent: 'to-object' })], 'Pick an object to extrude to.'],
      [
        [c.feature, extrude('E', [pick], { extent: 'through-all' })],
        'There are no bodies to go through. Enter a distance instead.',
      ],
      [
        [c.feature, xz, extrude('E', [pick, profile('SX', onXz.data)], { distance: '5 mm' })],
        'Pick profiles and faces that lie in one plane.',
      ],
      [
        [
          ...base.features,
          c.feature,
          extrude('E', [pick], { distance: '5 mm', operation: 'cut', bodies: ['X:0'] }),
        ],
        'One of the bodies to cut no longer exists. Edit the extrude and pick the bodies again.',
      ],
      [
        [c.feature, extrude('E', [{ kind: 'profile', id: 'SC/gone' }], { distance: '5 mm' })],
        "Can't find one of its profiles any more: an earlier change to the sketch removed it. Edit the extrude and pick it again.",
      ],
      [
        [
          c.feature,
          extrude('E', [pick], { direction: 'two-sides', distance: '5 mm', distance2: '-5 mm' }),
        ],
        'The two sides cancel each other out, so the extrude has no length. Change a distance.',
      ],
      // A cone whose tip comes before the end.
      [[c.feature, extrude('E', [pick], { distance: '10 mm', taper: '-30 deg' })], steep],
      [[c.feature, extrude('E', [pick], { distance: '10 mm', taper: '-27 deg' })], steep],
    ];
    for (const [features, message] of cases) {
      const result = await run(testDocument(features));
      // Lost references are listed too (ADR-0033); the lost-reference tests check them.
      const { refs: _, ...plain } = status(result, 'E');
      expect(plain, message).toEqual({ status: 'error', message });
    }
    const lostProfile = await run(
      testDocument([
        c.feature,
        extrude('E', [{ kind: 'profile', id: 'SC/gone' }], { distance: '5 mm' }),
      ]),
    );
    expect(status(lostProfile, 'E').refs).toEqual([
      { ref: { kind: 'profile', id: 'SC/gone' }, state: 'lost' },
    ]);

    // A face that isn't flat, a face that no longer exists.
    const cylinder = [c.feature, extrude('C', [pick], { distance: '5 mm' })];
    const first = ok(await run(testDocument(cylinder)));
    const side = refTo(first, 'face', `extrude:C:side:${c.circle}`);
    const curved = await run(
      testDocument([...cylinder, extrude('E', [side], { distance: '5 mm' })]),
    );
    expect(status(curved, 'E')).toEqual({
      status: 'error',
      message: 'Can only extrude flat faces. Pick a flat face or a sketch profile.',
    });
    const gone = await run(
      testDocument([
        ...cylinder,
        extrude('E', [{ kind: 'face', id: 'extrude:X:cap:end' }], { distance: '5 mm' }),
      ]),
    );
    expect(status(gone, 'E').status).toBe('error');
    expect(status(gone, 'E').message).toMatch(/^Can't find the face to extrude any more/);

    // A cut that misses the body it was told to cut.
    const far = circle('SM', 100, 100);
    const missed = await run(
      testDocument([
        ...base.features,
        far.feature,
        extrude('E', [profile('SM', far.data)], {
          distance: '5 mm',
          operation: 'cut',
          bodies: ['B:0'],
        }),
      ]),
    );
    expect(status(missed, 'E')).toEqual({
      status: 'error',
      message: "The cut doesn't remove anything. Check its direction and distance.",
    });
  });

  it('keeps references to its faces and edges through sketch edits', async () => {
    const make = (h: number) => {
      const b = new SketchBuilder();
      const lines = rect(b, 0, 0, 30, h);
      return { data: b.sketch, lines };
    };
    const small = make(10);
    const edgeName = `e[extrude:E:cap:end|extrude:E:side:${small.lines[2]}]`;
    const features = (data: SketchData, taper: string) => [
      sketch('S', data),
      extrude('E', [profile('S', data)], { distance: '5 mm', taper }),
    ];
    for (const taper of ['0 deg', '-10 deg']) {
      const first = ok(await run(testDocument(features(small.data, taper))));
      const edge = refTo(first, 'edge', edgeName);
      const fillet = testFeature(
        'F',
        'test-fillet',
        { radius: '1 mm' },
        { edges: { kind: 'ref', refs: [edge] } },
      );
      // The sketch's top line moves up (a dimension changed): the same IDs,
      // other coordinates.
      const bigger = make(16);
      const moved = ok(await run(testDocument([...features(bigger.data, taper), fillet])));
      expect(moved.bodies[0]?.mesh?.faceIds).toContain(`fillet:F:from:(${edgeName})`);
      const where = refTo(moved, 'face', `fillet:F:from:(${edgeName})`).fingerprint?.at ?? [
        0, 0, 0,
      ];
      expect(where[1]).toBeGreaterThan(14);
    }
  });

  it('golden table of every option combination', async () => {
    const base = block();
    const c = circle();
    const pick = profile('SC', c.data);
    const first = ok(await run(testDocument(base.features)));
    const top = refTo(first, 'face', 'extrude:B:cap:end');
    const bottom = refTo(first, 'face', 'extrude:B:cap:start');
    const table: Record<string, unknown> = {};
    const directions: ExtrudeDirection[] = ['one-side', 'symmetric', 'two-sides'];
    const extents: ExtrudeExtent[] = ['distance', 'to-object', 'through-all'];
    const operations: ExtrudeOperation[] = ['new-body', 'join', 'cut', 'intersect'];
    for (const direction of directions) {
      for (const extent of extents) {
        for (const operation of operations) {
          for (const taper of ['0 deg', '-5 deg', '5 deg']) {
            const options: ExtrudeInputOptions = {
              direction,
              extent,
              distance: '15 mm',
              toObject: top,
              taper,
              extent2: extent,
              distance2: '5 mm',
              toObject2: bottom,
              taper2: taper === '0 deg' ? '0 deg' : '-3 deg',
              operation,
            };
            const key = `${direction} ${extent} ${operation} taper ${taper}`;
            const result = await runWithShapes(
              testDocument([...base.features, c.feature, extrude('E', [pick], options)]),
            );
            const s = status(result, 'E');
            if (s.status === 'error') {
              table[key] = { error: s.message };
              continue;
            }
            table[key] = {
              ...(s.status === 'warning' ? { warning: s.message } : {}),
              bodies: Object.fromEntries(
                result.bodies.map((body) => {
                  const m = measure(result, body.id);
                  return [
                    body.id,
                    {
                      volume: round(m.volume, 2),
                      area: round(m.area, 2),
                      bbox: [...m.bbox.min, ...m.bbox.max].map((v) => round(v, 2)),
                      faces: m.faces,
                      edges: m.edges,
                      vertices: m.vertices,
                      extrudeFaces: m.names.filter((n) => n.includes(':E:')).sort(),
                    },
                  ];
                }),
              ),
            };
          }
        }
      }
    }
    // P4-12: to a curved face and to a body, with an offset. A Ø20 cylinder
    // lying along Y above the circle (axis at x = 10, z = 30).
    const cylinder: Feature = {
      ...testFeature('C', 'cylinder'),
      inputs: primitiveInputs('cylinder', {
        plane: originPlaneRef('origin:xz'),
        numbers: { diameter: '20 mm', height: '60 mm', x: '10 mm', y: '30 mm', offset: '-40 mm' },
      }),
    };
    const curved = [...base.features, cylinder, c.feature];
    const lying = ok(await run(testDocument(curved)));
    const wall = refTo(lying, 'face', 'cylinder:C:side:wall');
    const targets: [string, GeomRef][] = [
      ['curved face', wall],
      ['body', { kind: 'body', id: 'C:0' }],
    ];
    for (const [target, toObject] of targets) {
      for (const operation of operations) {
        for (const taper of ['0 deg', '5 deg']) {
          for (const offset of ['0 mm', '2 mm']) {
            const key = `to-object ${target} ${operation} taper ${taper} offset ${offset}`;
            const result = await runWithShapes(
              testDocument([
                ...curved,
                extrude('E', [pick], { extent: 'to-object', toObject, offset, taper, operation }),
              ]),
            );
            const s = status(result, 'E');
            table[key] =
              s.status === 'error'
                ? { error: s.message }
                : {
                    ...(s.status === 'warning' ? { warning: s.message } : {}),
                    bodies: Object.fromEntries(
                      result.bodies.map((body) => {
                        const m = measure(result, body.id);
                        return [
                          body.id,
                          {
                            volume: round(m.volume, 2),
                            faces: m.faces,
                            extrudeFaces: m.names.filter((n) => n.includes(':E:')).sort(),
                          },
                        ];
                      }),
                    ),
                  };
          }
        }
      }
    }
    // The symmetric measure (P4-12's amendment): `distance` the whole
    // length, or each side's.
    for (const how of ['whole', 'half'] as const) {
      const key = `symmetric distance measure ${how}`;
      const result = await runWithShapes(
        testDocument([
          ...base.features,
          c.feature,
          extrude('E', [pick], {
            direction: 'symmetric',
            extent: 'distance',
            distance: '15 mm',
            operation: 'new-body',
            ...(how === 'half' ? { symmetricMeasure: how } : {}),
          }),
        ]),
      );
      const s = status(result, 'E');
      table[key] =
        s.status === 'error'
          ? { error: s.message }
          : {
              ...(s.status === 'warning' ? { warning: s.message } : {}),
              bodies: Object.fromEntries(
                result.bodies.map((body) => {
                  const m = measure(result, body.id);
                  return [
                    body.id,
                    {
                      volume: round(m.volume, 2),
                      area: round(m.area, 2),
                      bbox: [...m.bbox.min, ...m.bbox.max].map((v) => round(v, 2)),
                      faces: m.faces,
                      edges: m.edges,
                      vertices: m.vertices,
                      extrudeFaces: m.names.filter((n) => n.includes(':E:')).sort(),
                    },
                  ];
                }),
              ),
            };
    }
    await expect(`${JSON.stringify(table, null, 1)}\n`).toMatchFileSnapshot(
      './golden/extrude-options.json',
    );
  });
});
