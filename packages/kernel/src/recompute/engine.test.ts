import {
  type BodyId,
  type ExtrudoDocument,
  type Feature,
  type FeatureId,
  type GeomRef,
  originPlaneRef,
  sketchInputs,
} from '@extrudo/core';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Kernel } from '../kernel';
import { loadOcct } from '../occt/load';
import type { OcctModule } from '../occt/types';
import { RecomputeEngine } from './engine';
import {
  chainDocument,
  type TestFeatures,
  testDocument,
  testFeature,
  testFeatures,
  withExpr,
} from './testing';
import type { RecomputeRequest, RecomputeResult } from './types';

let oc: OcctModule;
let kernel: Kernel;
let features: TestFeatures;
let engine: RecomputeEngine;

beforeAll(async () => {
  oc = await loadOcct();
  kernel = new Kernel(oc);
});

beforeEach(() => {
  engine?.clear();
  expect(kernel.stats().liveShapes).toBe(0);
  features = testFeatures();
  engine = new RecomputeEngine(kernel, features.registry, { strictLeaks: true });
});

async function done(result: Promise<RecomputeResult>) {
  const r = await result;
  if (r.status !== 'done') throw new Error(`expected a result, got ${r.status}`);
  return r;
}

const recompute = (doc: ExtrudoDocument, more: Omit<RecomputeRequest, 'doc'> = {}) =>
  done(engine.recompute({ doc, ...more }));

const ids = (...names: string[]) => names as FeatureId[];
const range = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => `f${from + i}`);

describe('incremental recompute', () => {
  it('re-evaluates only features 25 to 30 after an edit at feature 25 of 30 (the P2-01 AC)', {
    timeout: 60_000,
  }, async () => {
    const doc = chainDocument(30);
    const first = await recompute(doc);
    expect(first.stats.evaluated).toEqual(range(1, 30));
    expect(features.calls).toEqual(range(1, 30));
    expect(Object.values(first.features).every((s) => s.status === 'ok')).toBe(true);
    expect(first.bodies).toHaveLength(1);

    features.calls.length = 0;
    const edited = await recompute(withExpr(doc, 'f25', 'height', '3 mm'));
    expect(edited.stats.evaluated).toEqual(range(25, 30));
    expect(features.calls).toEqual(range(25, 30));
    expect(edited.stats.reused).toBe(24);
    // The body grew by 2 mm.
    const z = (r: typeof first) => {
      const { positions } = r.bodies[0]?.mesh ?? { positions: new Float32Array() };
      return Math.max(...positions.filter((_, i) => i % 3 === 2));
    };
    expect(z(edited) - z(first)).toBeCloseTo(2, 4);
  });

  it('evaluates nothing when the document is unchanged, or when an edit is undone', async () => {
    const doc = chainDocument(5);
    await recompute(doc);
    await recompute(withExpr(doc, 'f3', 'height', '4 mm'));
    features.calls.length = 0;

    const undone = await recompute(doc);
    expect(undone.stats.evaluated).toEqual([]);
    expect(undone.stats.reused).toBe(5);
    expect(features.calls).toEqual([]);
  });

  it('re-evaluates the features that use a parameter, and those after them that use bodies', async () => {
    const doc = testDocument(
      [
        testFeature('f1', 'test-box', { size: '10 mm' }),
        testFeature('f2', 'test-grow', { height: '1 mm' }),
        testFeature('f3', 'test-hole', { radius: 'hole' }),
        testFeature('f4', 'test-grow', { height: '1 mm' }),
      ],
      { hole: '2 mm', unused: '5 mm' },
    );
    await recompute(doc);
    const changed = {
      ...doc,
      parameters: doc.parameters.map((p) => ({ ...p, expression: '3 mm' })),
    };
    expect((await recompute(changed)).stats.evaluated).toEqual(ids('f3', 'f4'));
  });

  it("doesn't re-evaluate a feature that ignores bodies when an earlier body changes", async () => {
    const doc = testDocument([
      testFeature('f1', 'test-box', { size: '10 mm' }),
      testFeature('p', 'test-profile', { size: '4 mm' }),
      testFeature('f2', 'test-grow', { height: '1 mm' }),
    ]);
    await recompute(doc);
    expect((await recompute(withExpr(doc, 'f1', 'size', '12 mm'))).stats.evaluated).toEqual(
      ids('f1', 'f2'),
    );
  });

  it('re-evaluates a feature when a feature it refers to changes', async () => {
    const profile = testFeature('p', 'test-profile', { size: '4 mm' });
    const pad = testFeature(
      'pad',
      'test-pad',
      { height: '5 mm' },
      { profile: { kind: 'ref', refs: [{ kind: 'profile', id: 'p/square' }] } },
    );
    const doc = testDocument([profile, testFeature('f1', 'test-box', { size: '10 mm' }), pad]);
    const first = await recompute(doc);
    expect(first.bodies.map((b) => b.id)).toEqual(['f1:0', 'pad:0']);
    expect((await recompute(withExpr(doc, 'p', 'size', '6 mm'))).stats.evaluated).toEqual(
      ids('p', 'pad'),
    );
  });

  it('computes only up to the timeline marker', async () => {
    const doc = { ...chainDocument(6), timelineMarker: 3 };
    const result = await recompute(doc);
    expect(result.stats.evaluated).toEqual(ids('f1', 'f2', 'f3'));
    expect(Object.keys(result.features)).toEqual(ids('f1', 'f2', 'f3'));
  });

  it('skips suppressed features: their bodies pass through unchanged', async () => {
    const doc = chainDocument(3);
    const suppressed = {
      ...doc,
      features: doc.features.map((f) => (f.id === 'f2' ? { ...f, suppressed: true } : f)),
    };
    const result = await recompute(suppressed);
    expect(result.stats.evaluated).toEqual(ids('f1', 'f3'));
    expect(result.features['f2' as FeatureId]).toBeUndefined();
  });
});

describe('feature status', () => {
  it('reports errors in plain words and carries on with the bodies before the failed feature', async () => {
    const doc = testDocument([
      testFeature('f1', 'test-box', { size: '10 mm' }),
      testFeature('bad', 'test-fail'),
      testFeature('odd', 'extrude-to-moon'),
      testFeature('expr', 'test-grow', { height: 'nothing * 2' }),
      testFeature('f2', 'test-grow', { height: '1 mm' }),
    ]);
    const result = await recompute(doc);
    expect(result.features).toEqual({
      f1: { status: 'ok' },
      bad: { status: 'error', message: 'This feature always fails.' },
      odd: {
        status: 'error',
        message: "This version of Extrudo can't compute Extrude to moon features.",
      },
      expr: {
        status: 'error',
        message: expect.stringMatching(/^Height: .*`nothing`/),
      },
      f2: { status: 'ok' },
    });
    expect(result.bodies).toHaveLength(1);
  });

  it('reports invalid inputs', async () => {
    const result = await recompute(testDocument([testFeature('f1', 'test-box')]));
    expect(result.features['f1' as FeatureId]).toEqual({
      status: 'error',
      message: expect.stringMatching(/^Invalid inputs: size/),
    });
  });

  it('fails a feature whose reference is suppressed, failed, later or gone', async () => {
    const pad = (id: string, target: string) =>
      testFeature(
        id,
        'test-pad',
        { height: '5 mm' },
        { profile: { kind: 'ref', refs: [{ kind: 'profile', id: `${target}/square` }] } },
      );
    const doc = testDocument([
      { ...testFeature('off', 'test-profile', { size: '4 mm' }), suppressed: true },
      testFeature('broken', 'test-fail'),
      pad('a', 'off'),
      pad('b', 'broken'),
      pad('c', 'later'),
      pad('d', 'gone'),
      testFeature('later', 'test-profile', { size: '4 mm' }),
    ]);
    const result = await recompute(doc);
    const message = (id: string) => result.features[id as FeatureId]?.message;
    expect(message('a')).toBe('Needs off, which is suppressed.');
    expect(message('b')).toBe('Needs broken, which has an error.');
    expect(message('c')).toBe('Refers to later, which comes later in the timeline.');
    expect(message('d')).toBe('Refers to a feature that no longer exists.');
  });

  it('caches a failure like a result', async () => {
    const doc = testDocument([testFeature('bad', 'test-fail')]);
    await recompute(doc);
    expect((await recompute(doc)).stats.evaluated).toEqual([]);
    expect(features.calls).toEqual(ids('bad'));
  });

  it("doesn't evaluate a feature that crashed the kernel, and says so", async () => {
    const result = await recompute(chainDocument(3), { crashed: ids('f2') });
    expect(result.stats.evaluated).toEqual(ids('f1', 'f3'));
    expect(result.features['f2' as FeatureId]).toEqual({
      status: 'error',
      message: 'The kernel stopped while computing this feature. Change it to try again.',
    });
  });

  it('checks sketch planes', async () => {
    const sketch = (id: string, plane: string, kind: 'plane' | 'face' = 'plane') => ({
      ...testFeature(id, 'sketch'),
      inputs: sketchInputs(
        kind === 'plane' ? { ...originPlaneRef('origin:xy'), id: plane } : { kind, id: plane },
      ),
    });
    const result = await recompute(
      testDocument([sketch('s1', 'origin:xz'), sketch('s2', 'gone'), sketch('s3', 'x', 'face')]),
    );
    expect(result.features).toEqual({
      s1: { status: 'ok' },
      s2: { status: 'error', message: expect.stringMatching(/^Can't find this sketch's plane/) },
      // A face that no body has (P2-09 resolves faces; sketch-on-face.test.ts has the rest).
      s3: { status: 'error', message: expect.stringMatching(/^Can't find the face to sketch on/) },
    });
  });
});

describe('bodies and meshes', () => {
  it('leaves out meshes the caller already has', async () => {
    const doc = testDocument([
      testFeature('a', 'test-box', { size: '10 mm' }),
      testFeature('b', 'test-box', { size: '5 mm' }),
      testFeature('grow', 'test-grow', { height: '1 mm' }),
    ]);
    const first = await recompute(doc);
    expect(first.bodies.map((b) => [b.id, b.mesh !== undefined])).toEqual([
      ['a:0', true],
      ['b:0', true],
    ]);
    const have = Object.fromEntries(first.bodies.map((b) => [b.id, b.version]));

    // Growing changes body a only; b's mesh stays with the caller.
    const second = await recompute(withExpr(doc, 'grow', 'height', '2 mm'), { have });
    const [a, b] = second.bodies;
    expect(a?.version).not.toBe(have['a:0' as BodyId]);
    expect(a?.mesh).toBeDefined();
    expect(b).toEqual({ id: 'b:0', version: have['b:0' as BodyId] });
  });

  it('gives the same versions after a restart (a fresh engine), so kept meshes stay valid', async () => {
    const doc = chainDocument(3);
    const first = await recompute(doc);
    engine.clear();
    engine = new RecomputeEngine(kernel, features.registry, { strictLeaks: true });
    const again = await recompute(doc);
    expect(again.bodies.map((b) => b.version)).toEqual(first.bodies.map((b) => b.version));
  });
});

describe('cancellation', () => {
  it('a newer recompute cancels the running one between features', async () => {
    const doc = chainDocument(10);
    const progress: FeatureId[] = [];
    const older = engine.recompute({ doc }, (id) => {
      progress.push(id);
      // The user edits while f3 is being computed; the request comes in at the next yield.
      if (id === 'f3') {
        queueMicrotask(() => {
          newer = engine.recompute({ doc: withExpr(doc, 'f8', 'height', '2 mm') });
        });
      }
    });
    let newer: Promise<RecomputeResult> | undefined;
    expect(await older).toEqual({ status: 'cancelled' });
    const result = await done(newer as Promise<RecomputeResult>);

    // f1–f3 were computed once, by the older request; the newer one reused them.
    expect(progress).toEqual(ids('f1', 'f2', 'f3'));
    expect(result.stats.reused).toBe(3);
    expect(result.stats.evaluated).toEqual(range(4, 10));
    expect(features.calls).toEqual(range(1, 10));
  });

  it('two walks waiting on the same feature evaluate it once', async () => {
    const doc = chainDocument(3);
    const draft = testFeature('f4', 'test-grow', { height: '1 mm' });
    const [preview, full] = await Promise.all([
      done(engine.preview({ doc, draft, index: 3 })),
      recompute(doc),
    ]);
    expect(features.calls).toEqual(range(1, 4));
    expect(preview.stats.evaluated.length + full.stats.evaluated.length).toBe(4);
  });

  it("previews don't cancel recomputes, and the dialog's OK hits the cache", async () => {
    const doc = chainDocument(4);
    await recompute(doc);
    const draft = testFeature('f5', 'test-hole', { radius: '1 mm' });
    const preview = await done(engine.preview({ doc, draft, index: 4 }));
    expect(preview.stats.evaluated).toEqual(ids('f5'));
    expect(preview.features['f5' as FeatureId]).toEqual({ status: 'ok' });

    const committed = { ...doc, features: [...doc.features, draft], timelineMarker: 5 };
    expect((await recompute(committed)).stats.evaluated).toEqual([]);
  });

  it('previews an edited feature in place of the stored one', async () => {
    const doc = chainDocument(4);
    await recompute(doc);
    const draft = testFeature('f2', 'test-grow', { height: '5 mm' });
    const preview = await done(engine.preview({ doc, draft, index: 1 }));
    expect(preview.stats.evaluated).toEqual(ids('f2'));
    expect(Object.keys(preview.features)).toEqual(ids('f1', 'f2'));
  });
});

describe('preview tools (P2-05)', () => {
  /** A box and a reference to its top face (+Z), from the last recompute. */
  async function boxWithTop() {
    const doc = testDocument([testFeature('box', 'test-box', { size: '10 mm' })]);
    await recompute(doc);
    for (let i = 0; i < 6; i++) {
      const ref = engine.reference('box:0' as BodyId, 'face', i);
      if (ref?.fingerprint?.dir?.[2] === 1) return { doc, top: ref };
    }
    throw new Error('no top face');
  }
  const press = (top: GeomRef, operation: string, distance = '5 mm', angle?: string) =>
    testFeature(
      'press',
      'test-press',
      { distance },
      {
        faces: { kind: 'ref', refs: [top] },
        operation: { kind: 'enum', value: operation },
        ...(angle && { angle: { kind: 'expr', expr: angle, unit: 'angle' } }),
      },
    );
  const zRange = (positions: Float32Array) => {
    const z = positions.filter((_, i) => i % 3 === 2);
    return [Math.min(...z), Math.max(...z)];
  };

  it.each([
    ['new', 2, [10, 15]],
    ['join', 1, [10, 15]],
    ['cut', 1, [5, 10]],
    ['intersect', 1, [5, 10]],
  ] as const)(
    "meshes the draft's %s tool with its style, previews only",
    async (operation, bodies, range) => {
      const { doc, top } = await boxWithTop();
      const distance = operation === 'cut' || operation === 'intersect' ? '-5 mm' : '5 mm';
      const draft = press(top, operation, distance);
      const preview = await done(engine.preview({ doc, draft, index: 1 }));
      expect(preview.features['press' as FeatureId]).toEqual({ status: 'ok' });
      expect(preview.bodies).toHaveLength(bodies);
      expect(preview.tools?.map((t) => t.style)).toEqual([operation]);
      const mesh = preview.tools?.[0]?.mesh;
      expect(zRange(mesh?.positions ?? new Float32Array())).toEqual(range);

      // The same feature committed: no tools in a recompute, and no new evaluation.
      const committed = { ...doc, features: [...doc.features, draft], timelineMarker: 2 };
      const result = await recompute(committed);
      expect(result.tools).toBeUndefined();
      expect(result.stats.evaluated).toEqual([]);
    },
  );

  it('tilts the press by its angle', async () => {
    const { doc, top } = await boxWithTop();
    const preview = await done(
      engine.preview({ doc, draft: press(top, 'new', '10 mm', '60 deg'), index: 1 }),
    );
    const [, zMax] = zRange(preview.tools?.[0]?.mesh.positions ?? new Float32Array());
    expect(zMax).toBeCloseTo(10 + 10 * Math.cos(Math.PI / 3), 4);
  });

  it('has no tools when the draft fails', async () => {
    const { doc, top } = await boxWithTop();
    const preview = await done(engine.preview({ doc, draft: press(top, 'new', '0 mm'), index: 1 }));
    expect(preview.features['press' as FeatureId]).toEqual({
      status: 'error',
      message: 'The distance is zero.',
    });
    expect(preview.tools).toBeUndefined();
  });

  it('gives the bodies before the draft for editing, and references into them', async () => {
    const { doc, top } = await boxWithTop();
    const draft = press(top, 'join', '5 mm');
    const committed = { ...doc, features: [...doc.features, draft], timelineMarker: 2 };
    const model = await recompute(committed);
    const tall = (r: typeof model) => zRange(r.bodies[0]?.mesh?.positions ?? new Float32Array());
    expect(tall(model)).toEqual([0, 15]);
    // Edit it: the base is the box before the press, meshed; without `base`, none.
    const edited = press(top, 'join', '2 mm');
    const preview = await done(
      engine.preview({ doc: committed, draft: edited, index: 1, base: true }),
    );
    const base = preview.base?.[0];
    expect(zRange(base?.mesh?.positions ?? new Float32Array())).toEqual([0, 10]);
    expect(base?.mesh?.faceIds).toContain(top.id);
    expect(
      (await done(engine.preview({ doc: committed, draft: edited, index: 1 }))).base,
    ).toBeUndefined();
    // With `base`, references come from the base; the model's top face moved up.
    await done(engine.preview({ doc: committed, draft: edited, index: 1, base: true }));
    const at = base?.mesh?.faceIds?.indexOf(top.id) ?? -1;
    expect(engine.reference('box:0' as BodyId, 'face', at, true)?.fingerprint?.at[2]).toBeCloseTo(
      10,
      6,
    );
    engine.endPreview();
    expect(engine.reference('box:0' as BodyId, 'face', at, true)).toBeUndefined();
  });

  it('owns tool shapes in the cache and gives them back with the entry', async () => {
    const { doc, top } = await boxWithTop();
    const before = kernel.stats().liveShapes;
    const [join, cut, fresh] = ['join', 'cut', 'new'].map((op) => press(top, op, '-2 mm'));
    for (const draft of [join, cut, join, fresh]) {
      await done(engine.preview({ doc, draft: draft as Feature, index: 1 }));
    }
    // join and cut each hold a result and a tool; new holds one prism as body and tool.
    expect(kernel.stats().liveShapes).toBe(before + 5);
    expect(kernel.stats().liveShapes).toBe(engine.size.shapes);
    engine.clear();
    expect(kernel.stats().liveShapes).toBe(0);
  });
});

describe('memory', () => {
  it('evicts old entries beyond the limit and gives their shapes back', async () => {
    engine = new RecomputeEngine(kernel, features.registry, { strictLeaks: true, maxEntries: 5 });
    let doc = chainDocument(3);
    await recompute(doc);
    const shapes = engine.size.shapes;
    for (let i = 2; i <= 12; i++) {
      doc = withExpr(doc, 'f2', 'height', `${i} mm`);
      await recompute(doc);
    }
    expect(engine.size.entries).toBeLessThanOrEqual(5);
    expect(engine.size.shapes).toBeLessThanOrEqual(shapes + 2 * 2);
    expect(kernel.stats().liveShapes).toBe(engine.size.shapes);
    engine.clear();
    expect(kernel.stats().liveShapes).toBe(0);
  });

  it('never evicts what the current result uses', async () => {
    engine = new RecomputeEngine(kernel, features.registry, { strictLeaks: true, maxEntries: 0 });
    const doc = chainDocument(4);
    await recompute(doc);
    expect(engine.size.entries).toBe(4);
    expect((await recompute(doc)).stats.evaluated).toEqual([]);
  });

  it('shares an unchanged body between entries and frees it with the last one', async () => {
    const doc = testDocument([
      testFeature('a', 'test-box', { size: '10 mm' }),
      testFeature('p', 'test-profile', { size: '4 mm' }),
    ]);
    await recompute(doc);
    // One box, one profile face.
    expect(kernel.stats().liveShapes).toBe(2);
    engine.clear();
    expect(kernel.stats().liveShapes).toBe(0);
  });

  it('catches an evaluator that leaves shapes behind', async () => {
    // Its own kernel: the leaked shapes go when it is disposed.
    const own = new Kernel(oc);
    const doc = testDocument([testFeature('leak', 'test-leak')]);
    const strict = new RecomputeEngine(own, features.registry, { strictLeaks: true });
    await expect(strict.recompute({ doc })).rejects.toThrow(/left 1 shape\(s\) behind/);

    const leaks: number[] = [];
    const lenient = new RecomputeEngine(own, features.registry, {
      onLeak: (_, n) => leaks.push(n),
    });
    await done(lenient.recompute({ doc }));
    expect(leaks).toEqual([1]);
    own.dispose();
  });
});
