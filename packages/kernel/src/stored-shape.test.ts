/**
 * `storedShapeToStep` (P6-25 S3, ADR-0144 decision 5): only an import kernel
 * reads B-rep text; it places the shape, writes STEP and reads it back, and
 * leaves nothing alive.
 */

import { type BodyId, type Feature, primitiveInputs } from '@extrudo/core';
import { beforeAll, describe, expect, it } from 'vitest';
import { importRebuilder } from './import-rebuild';
import { Kernel } from './kernel';
import { loadOcct } from './occt/load';
import { BOX, boxBrep, cylinderBrep, LOCATED_FACE_PLACED } from './read-brep-test-support';
import { testDocument, testFeature } from './recompute/testing';
import type { KernelApi } from './service';
import { KernelService } from './service';
import {
  chainMatrix,
  describeElements,
  describeShapes,
  MAX_DETAILED_EDGES,
  measureShape,
  placementMatrix,
  type ShapePlacement,
} from './stored-shape';

const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env;

let normal: KernelService;
let importer: KernelService;

beforeAll(async () => {
  normal = new KernelService(() => loadOcct());
  importer = new KernelService(() => loadOcct(), { importKernel: true });
  await Promise.all([normal.init(), importer.init()]);
});

const turnZ = (deg: number): ShapePlacement['rotation'] => {
  const half = (deg * Math.PI) / 360;
  return [0, 0, Math.sin(half), Math.cos(half)];
};

const expectBox = (
  box: { min: number[]; max: number[] },
  [x0, y0, z0, x1, y1, z1]: number[],
  digits = 5,
) => {
  [...box.min, ...box.max].forEach((v, i) => {
    expect(v).toBeCloseTo([x0, y0, z0, x1, y1, z1][i] as number, digits);
  });
};

describe('storedShapeToStep', () => {
  it("is refused by a project's kernel", async () => {
    await expect(normal.storedShapeToStep(BOX, [])).rejects.toThrow(/only an import's own kernel/);
    expect((await normal.stats()).liveShapes).toBe(0);
  });

  it('converts a box and measures it before and after STEP', async () => {
    const result = await importer.storedShapeToStep(BOX, [], { name: 'Box', color: '#ff8000' });
    expect(result.step).toMatch(/^ISO-10303-21;/);
    expect(result.step).toContain("'Box'");
    expect(result.solids).toBe(1);
    expect(result.read.solids).toBe(1);
    expect(result.volume).toBeCloseTo(6000, 6);
    expect(result.read.volume).toBeCloseTo(6000, 6);
    expect(result.area).toBeCloseTo(2 * (200 + 300 + 600), 6);
    expectBox(result.box, [0, 0, 0, 10, 20, 30]);
    expectBox(result.read.box, [0, 0, 0, 10, 20, 30]);
    expect((await importer.stats()).liveShapes).toBe(0);
  });

  it('writes the same STEP for the same shape, so imports can share an attachment', async () => {
    const a = await importer.storedShapeToStep(BOX, []);
    await new Promise((resolve) => setTimeout(resolve, 1100));
    const b = await importer.storedShapeToStep(BOX, []);
    expect(b.step).toBe(a.step);
  });

  it('applies the placements outermost first', async () => {
    // Inner: a quarter turn about z. Outer: a move by (100, 0, 0).
    // The box (0..10, 0..20, 0..30) turned lands at (-20..0, 0..10), then moves.
    const chain: ShapePlacement[] = [
      { position: [100, 0, 0], rotation: [0, 0, 0, 1] },
      { position: [0, 0, 0], rotation: turnZ(90) },
    ];
    const result = await importer.storedShapeToStep(BOX, chain);
    expectBox(result.read.box, [80, 0, 0, 100, 10, 30]);
    expectBox(result.box, [80, 0, 0, 100, 10, 30]);
    expect(result.volume).toBeCloseTo(6000, 6);
    // The other order: the move turned with it.
    const reversed = await importer.storedShapeToStep(BOX, [...chain].reverse());
    expectBox(reversed.box, [-20, 100, 0, 0, 110, 30]);
    expect((await importer.stats()).liveShapes).toBe(0);
  });

  it('keeps the solid of a located shape and moves it', async () => {
    const plain = await importer.storedShapeToStep(LOCATED_FACE_PLACED, []);
    const moved = await importer.storedShapeToStep(LOCATED_FACE_PLACED, [
      { position: [0, 0, 50], rotation: [0, 0, 0, 1] },
    ]);
    expect(plain.solids).toBe(1);
    expect(moved.solids).toBe(1);
    expect(Math.abs(moved.volume - plain.read.volume)).toBeLessThan(1e-6 * plain.read.volume);
    expect(moved.box.min[2]).toBeCloseTo(plain.box.min[2] + 50, 5);
    expect((await importer.stats()).liveShapes).toBe(0);
  });

  it('refuses a bad text or a placement that is not finite, leaving nothing', async () => {
    await expect(importer.storedShapeToStep('not a shape', [])).rejects.toThrow();
    await expect(
      importer.storedShapeToStep(BOX, [{ position: [Number.NaN, 0, 0], rotation: [0, 0, 0, 1] }]),
    ).rejects.toThrow(/not finite/);
    await expect(
      importer.storedShapeToStep(BOX, [{ position: [0, 0, 0], rotation: [0, 0, 0, 0] }]),
    ).rejects.toThrow(/zero rotation/);
    expect((await importer.stats()).liveShapes).toBe(0);
    // Still usable after the refusals.
    expect((await importer.storedShapeToStep(BOX, [])).solids).toBe(1);
  });
});

describe('placement matrices', () => {
  it('turn by a unit quaternion and normalise one that is not', () => {
    const m = placementMatrix({ position: [1, 2, 3], rotation: [0, 0, 2, 2] });
    // A quarter turn about z: x → y.
    [0, -1, 0, 1, 1, 0, 0, 2, 0, 0, 1, 3].forEach((v, i) => {
      expect(m[i]).toBeCloseTo(v, 12);
    });
    expect(chainMatrix([])).toEqual([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0]);
  });
});

describe('measureStoredShape and measureBodies (S5)', () => {
  const box = (id: string, x: string): Feature => ({
    ...testFeature(id, 'box'),
    inputs: primitiveInputs('box', { numbers: { x } }),
  });

  it("is refused by a project's kernel", async () => {
    await expect(normal.measureStoredShape(BOX, [])).rejects.toThrow(/only an import's own kernel/);
    expect((await normal.stats()).liveShapes).toBe(0);
  });

  it('measures a stored shape where it is placed, with no STEP, leaving nothing', async () => {
    const at = await importer.measureStoredShape(boxBrep([1, 2, 3], [5, 7, 9]), [
      { position: [10, 0, 0], rotation: [0, 0, 0, 1] },
    ]);
    expect(at.solids).toBe(1);
    expect(at.volume).toBeCloseTo(120, 9);
    expect(at.area).toBeCloseTo(148, 9);
    expectBox(at.box, [11, 2, 3, 15, 7, 9]);
    const tall = await importer.measureStoredShape(cylinderBrep(50, [59.16, -59.16, 0]), []);
    expect(tall.volume).toBeCloseTo(Math.PI * 100 * 50, 6);
    expectBox(tall.box, [-10, -10, 0, 10, 10, 50]);
    await expect(importer.measureStoredShape('not a shape', [])).rejects.toThrow();
    expect((await importer.stats()).liveShapes).toBe(0);
  });

  it('measures rebuilt bodies with the same code as stored shapes', async () => {
    const result = await importer.recompute({ doc: testDocument([box('B', '-60 mm')]) });
    if (result.status !== 'done') throw new Error('not done');
    const id = result.bodies[0]?.id as BodyId;
    const measured = await importer.measureBodies([id]);
    const body = measured[id];
    if (!body) throw new Error('no measure');
    expect(body.solids).toBe(1);
    const stored = await importer.measureStoredShape(boxBrep(body.box.min, body.box.max), []);
    expect(stored.volume).toBeCloseTo(body.volume, 9);
    expect(stored.area).toBeCloseTo(body.area, 9);
    expectBox(stored.box, [...body.box.min, ...body.box.max], 9);
    await expect(importer.measureBodies(['nothing' as BodyId])).rejects.toThrow(/no longer/);
    // The IDs are the caller's strings: the record has no prototype for one to reach.
    expect(Object.getPrototypeOf(measured)).toBeNull();
  });

  it('releases every solid of a shape with a huge solid count, one by one', () => {
    let released = 0;
    const count = 500_000;
    const kernel = {
      solids: () => Array.from({ length: count }, (_, i) => i),
      release: (...shapes: unknown[]) => {
        released += shapes.length;
      },
      properties: () => ({
        volume: 1,
        area: 2,
        bbox: { min: [0, 0, 0], max: [1, 1, 1] },
        centroid: [0.5, 0.5, 0.5],
      }),
    } as unknown as Parameters<typeof measureShape>[0];
    expect(measureShape(kernel, 0 as never).solids).toBe(count);
    expect(released).toBe(count);
  });
});

describe('describeStoredShape and describeBodies (S6)', () => {
  const box = (id: string): Feature => ({
    ...testFeature(id, 'box'),
    inputs: primitiveInputs('box', {
      numbers: { length: '10 mm', width: '20 mm', height: '30 mm' },
    }),
  });
  const BOX_10_20_30 = boxBrep([0, 0, 0], [10, 20, 30]);

  it("is refused by a project's kernel", async () => {
    await expect(normal.describeStoredShape(BOX, [], { edges: [0], faces: [] })).rejects.toThrow(
      /only an import's own kernel/,
    );
    expect((await normal.stats()).liveShapes).toBe(0);
  });

  it('describes only what is asked and its neighbours, placed, leaving nothing', async () => {
    // A recompute before this one keeps its bodies alive.
    const alive = (await importer.stats()).liveShapes;
    const d = await importer.describeStoredShape(
      BOX_10_20_30,
      [{ position: [100, 0, 0], rotation: [0, 0, 0, 1] }],
      { edges: [0, -1, 12, 1e9, 0.5], faces: [] },
    );
    expect([d.edgeCount, d.faceCount]).toEqual([12, 6]);
    // Edge 0 only (the rest are out of range), with the two faces it bounds.
    expect(d.edges.map((e) => e.index)).toEqual([0]);
    const e = d.edges[0];
    if (!e) throw new Error('no edge');
    expect(e.type).toBe('line');
    expect(e.ends).toHaveLength(2);
    expect(e.faces).toHaveLength(2);
    expect(d.faces.map((f) => f.index).sort()).toEqual([...e.faces].sort());
    // Placed: every point is past x = 100.
    for (const p of [e.midpoint, ...(e.ends ?? [])])
      expect(p[0]).toBeGreaterThanOrEqual(100 - 1e-9);
    const [a, b] = e.ends as unknown as [readonly number[], readonly number[]];
    expect(e.length).toBeCloseTo(Math.hypot(...a.map((v, i) => v - (b[i] as number))), 9);
    // A face asked for brings its four edges.
    const top = await importer.describeStoredShape(BOX_10_20_30, [], {
      edges: [],
      faces: [d.faces[0]?.index ?? 0],
    });
    expect(top.faces[0]?.edges).toHaveLength(4);
    expect(top.edges).toHaveLength(4);
    await expect(
      importer.describeStoredShape('not a shape', [], { edges: [], faces: [] }),
    ).rejects.toThrow();
    expect((await importer.stats()).liveShapes).toBe(alive);
  });

  it('describes a circle with its centre and radius', async () => {
    const d = await importer.describeStoredShape(cylinderBrep(50), [], {
      edges: [0, 1, 2],
      faces: [],
    });
    const circles = d.edges.filter((e) => e.type === 'circle');
    expect(circles.length).toBeGreaterThan(0);
    for (const c of circles) expect(c.radius).toBeCloseTo(10, 9);
  });

  it('describes rebuilt bodies with the same code as stored shapes', async () => {
    const result = await importer.recompute({ doc: testDocument([box('B')]) });
    if (result.status !== 'done') throw new Error('not done');
    const id = result.bodies[0]?.id as BodyId;
    // In detail only the edges near the points given: the stored edges an import looks for.
    const plain = (await importer.describeBodies([id]))[id];
    expect(plain?.edges.every((e) => e.ends === undefined)).toBe(true);
    const at = (await importer.measureBodies([id]))[id]?.box;
    if (!at) throw new Error('no measure');
    const stored = await importer.describeStoredShape(boxBrep(at.min, at.max), [], {
      edges: [...Array(12).keys()],
      faces: [],
    });
    const described = await importer.describeBodies([id], {
      points: stored.edges.map((e) => e.midpoint),
      radius: 0.04,
    });
    expect(Object.getPrototypeOf(described)).toBeNull();
    const body = described[id];
    if (!body) throw new Error('no description');
    expect([body.edgeCount, body.faceCount, body.edges.length, body.faces.length]).toEqual([
      12, 6, 12, 6,
    ]);
    expect(body.edges.every((e) => e.ends?.length === 2)).toBe(true);
    const first = stored.edges[0]?.midpoint ?? [0, 0, 0];
    const one = await importer.describeBodies([id], { points: [first], radius: 0.04 });
    expect(one[id]?.edges.filter((e) => e.ends).length).toBe(1);
    // Every stored edge has exactly one rebuilt edge with its midpoint and length.
    for (const e of stored.edges) {
      const same = body.edges.filter(
        (r) =>
          Math.hypot(...r.midpoint.map((v, i) => v - (e.midpoint[i] as number))) < 1e-9 &&
          Math.abs(r.length - e.length) < 1e-9,
      );
      expect(same).toHaveLength(1);
    }
    // The reference the app would store for that edge.
    const ref = await importer.reference(id, 'edge', 0);
    expect(ref?.kind).toBe('edge');
    expect(ref?.id).toContain(':B:');
    await expect(importer.describeBodies(['nothing' as BodyId])).rejects.toThrow(/no longer/);
  });
});

describe('the caps of a description hold for the whole call (S6 review)', () => {
  let kernel: Kernel;
  beforeAll(async () => {
    kernel = new Kernel(await loadOcct());
  });
  /** `n` unit boxes side by side in one compound: 12 edges and 6 faces each. */
  const boxes = (n: number, x0 = 0) => {
    const parts = Array.from({ length: n }, (_, i) =>
      kernel.box([1, 1, 1], [x0 + 2 * (i % 100), 2 * Math.floor(i / 100), 0]),
    );
    const c = kernel.compound(parts);
    kernel.release(...parts);
    return c;
  };

  it('answers `detail` at 2,001 edges in detail, stored side and rebuilt side', () => {
    const c = boxes(167); // 2,004 edges
    const asked = describeElements(kernel, c, {
      edges: [...Array(MAX_DETAILED_EDGES + 1).keys()],
      faces: [],
    });
    expect(asked).toMatchObject({ edges: [], faces: [], over: 2_001, limit: 'detail' });
    const all = kernel.describe(c);
    const near = describeElements(kernel, c, undefined, {
      points: all.edges.slice(0, MAX_DETAILED_EDGES + 1).map((e) => e.midpoint),
      radius: 0.01,
    });
    expect(near).toMatchObject({ edges: [], over: 2_001, limit: 'detail' });
    // At the cap itself it describes.
    const at = describeElements(kernel, c, {
      edges: [...Array(MAX_DETAILED_EDGES).keys()],
      faces: [],
    });
    expect(at.over).toBeUndefined();
    expect(at.edges.filter((e) => e.ends)).toHaveLength(MAX_DETAILED_EDGES);
    kernel.release(c);
  });

  it('counts a shape before describing it, and shares the caps across the shapes of a call', () => {
    const big = boxes(1_700); // 20,400 edges
    const t = performance.now();
    expect(describeElements(kernel, big, { edges: [0], faces: [] })).toMatchObject({
      edges: [],
      over: 20_400,
      limit: 'edges',
    });
    expect(performance.now() - t).toBeLessThan(2_000);
    kernel.release(big);
    // Two bodies of 1,200 edges each, 1,100 near points in each: 2,200 in detail for the call.
    const a = boxes(100);
    const b = boxes(100, 1_000);
    const points = [a, b].flatMap((x) =>
      kernel
        .describe(x)
        .edges.slice(0, 1_100)
        .map((e) => e.midpoint),
    );
    const both = describeShapes(kernel, [a, b], undefined, { points, radius: 0.01 });
    for (const d of both) expect(d).toMatchObject({ edges: [], over: 2_200, limit: 'detail' });
    // Each alone is under the cap.
    expect(
      describeShapes(kernel, [a], undefined, { points, radius: 0.01 })[0]?.over,
    ).toBeUndefined();
    kernel.release(a, b);
    // Two of 12,000 edges each: 24,000 for the call.
    const c = boxes(1_000);
    const d = boxes(1_000, 5_000);
    for (const x of describeShapes(kernel, [c, d]))
      expect(x).toMatchObject({ over: 24_000, limit: 'edges' });
    kernel.release(c, d);
  });

  // The worst the caps allow, measured (ADR-0144's S6 amendment): `BENCH=1`.
  it.runIf(env?.BENCH)('measures the worst cases at the caps', { timeout: 900_000 }, () => {
    const one = boxes(1_666); // 19,992 edges
    const d = kernel.describe(one);
    let t = performance.now();
    describeElements(kernel, one, undefined, {
      points: d.edges.slice(0, MAX_DETAILED_EDGES).map((e) => e.midpoint),
      radius: 0.01,
    });
    console.log('one body, 2,000 of 19,992 in detail, ms', Math.round(performance.now() - t));
    t = performance.now();
    describeElements(kernel, one, { edges: [...Array(MAX_DETAILED_EDGES).keys()], faces: [] });
    console.log('stored, 2,000 of 19,992 asked, ms', Math.round(performance.now() - t));
    const parts = Array.from({ length: 10 }, (_, i) => boxes(166, 1_000 * i));
    const near = parts.flatMap((p) =>
      kernel
        .describe(p)
        .edges.slice(0, 200)
        .map((e) => e.midpoint),
    );
    t = performance.now();
    describeShapes(kernel, parts, undefined, { points: near, radius: 0.01 });
    console.log('ten bodies of 1,992, 200 each in detail, ms', Math.round(performance.now() - t));
    const huge = boxes(16_700); // 200,400 edges
    t = performance.now();
    describeElements(kernel, huge, { edges: [0], faces: [] });
    console.log(
      'a stored shape of 200,400 edges turned away, ms',
      Math.round(performance.now() - t),
    );
    kernel.release(one, huge, ...parts);
  });
});

describe('importRebuilder', () => {
  it('sends each file once, passes the versions back and measures only what is asked', async () => {
    const calls: string[] = [];
    let haveSeen: unknown[] = [];
    const api = {
      addFile: async (id: string) => {
        calls.push(`file ${id}`);
      },
      recompute: async (request: { have?: unknown }) => {
        haveSeen.push(request.have);
        return {
          status: 'done',
          features: { A: { status: 'ok' }, B: { status: 'error', message: 'no' } },
          bodies: [
            { id: 'A:0', version: 'v1' },
            { id: 'B:0', version: 'v2' },
          ],
        };
      },
      measureBodies: async (ids: string[]) => {
        calls.push(`measure ${ids.join(',')}`);
        return Object.fromEntries(ids.map((id) => [id, { solids: 1 }]));
      },
    } as unknown as Pick<KernelApi, 'addFile' | 'recompute' | 'measureBodies'>;
    const doc = {
      ...testDocument([]),
      attachments: {
        F: { name: 'f', fileName: 'f.step', mediaType: 'model/step', sha256: 'x', size: 1 },
      },
    } as never;
    const files = new Map([['F' as never, new Uint8Array([1])]]);
    const rebuilder = importRebuilder(api);
    const first = await rebuilder.rebuild(doc, files);
    const second = await rebuilder.rebuild(doc, files, ['A:0']);
    expect(calls).toEqual(['file F', 'measure A:0,B:0', 'measure B:0']);
    expect(haveSeen).toEqual([{}, { 'A:0': 'v1', 'B:0': 'v2' }]);
    expect(first.ids).toEqual(['A:0', 'B:0']);
    expect(second.bodies).toEqual({ 'B:0': { solids: 1 } });
    expect(first.failed).toEqual([{ feature: 'B', message: 'no' }]);
    haveSeen = [];
  });
});
