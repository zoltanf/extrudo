// Operations keyed by the bodies they change (ADR-0024's amendment on operations): an extrude that
// cuts or intersects the bodies it picks answers `view`; one whose participants are automatic
// answers `touch`, keyed by the bodies its tool touches, asked again of every body the tool hasn't
// been asked about. Boxes no feature refers to before, between and after, one in the tool's way
// for the picked cut (a cut that searched the bodies it touches would cut it under `write` but not
// with a view), one whose box meets the tool's but that it doesn't touch. The seeded proof of
// `view-access-features-test-support.ts`, exact counters, and a test for each way the bodies a tool
// touches can change. Real OCCT and manifold, strict leaks, no clock.
import {
  type ExtrudoDocument,
  extrudeInputs,
  type FeatureId,
  type GeomRef,
  primitiveInputs,
  profileRefId,
  sketchInputs,
} from '@extrudo/core';
import { SketchBuilder } from '@extrudo/sketch/fixtures';
import { detectProfiles } from '@extrudo/sketch/profiles';
import { describe, expect, it } from 'vitest';
import { kernelFeatures } from '../features';
import { Kernel, KernelError } from '../kernel';
import { choice, fallbacks, GENERIC_KINDS, length, setInputs } from './add-access-test-support';
import { RecomputeEngine } from './engine';
import type { EvalContext, KernelFeatureDefinition } from './types';
import {
  BASE,
  box,
  computed,
  type Design,
  faceRefs,
  feature,
  type Kind,
  proveDesigns,
  sequence,
  testKernel,
  top,
  useKernel,
} from './view-access-features-test-support';
import { document, slot } from './view-access-test-support';

useKernel();

const bodies = (...ids: string[]) => ({
  kind: 'ref' as const,
  refs: ids.map((id): GeomRef => ({ kind: 'body', id })),
});

/**
 * Boxes `o0`, `b1`, `o1`, `b2`, `o2` along X, and a 2 mm slot through all of them on XY cut out of
 * `b1` and `b2` only (each in two), `o1` in its way.
 */
function picked(): ExtrudoDocument {
  const doc = document('cuts of picked bodies', [
    box('o0', -40),
    box('b1', 0),
    box('o1', 20),
    box('b2', 40),
    ...slot('cx', [-50, -1, 50, 1]),
    box('o2', 80),
  ]);
  return setInputs(doc, 'cx', { bodies: bodies('b1:0', 'b2:0') });
}

/** A `size` mm box centred at `x`, `y` (10 mm high). */
const small = (id: string, x: number, y: number, size: number) =>
  feature(
    id,
    'box',
    primitiveInputs('box', {
      numbers: {
        length: `${size} mm`,
        width: `${size} mm`,
        height: '10 mm',
        x: `${x} mm`,
        y: `${y} mm`,
      },
    }),
  );

/** A circle of radius `r` at `x`, `y` on XY and its extrude doing `operation`, symmetric 20 mm. */
function circleCut(id: string, x: number, y: number, r: number, operation = 'cut') {
  const b = new SketchBuilder();
  b.circle(x, y, r);
  const [region] = detectProfiles(b.sketch);
  const sketch = `sk-${id}`;
  return [
    feature(sketch, 'sketch', sketchInputs({ kind: 'plane', id: 'origin:xy' }, b.sketch)),
    feature(
      id,
      'extrude',
      extrudeInputs(
        [{ kind: 'profile', id: profileRefId(sketch as FeatureId, region?.id ?? '') }],
        {
          distance: '20 mm',
          direction: 'symmetric',
          operation: operation as 'cut',
        },
      ),
    ),
  ];
}

/**
 * Automatic participants: boxes `o0` before, `fb` (the one a 2 mm slot cuts, in two), `o1`
 * between (12 mm from the slot's end: `nudge` moves it in), the slot cut, `o2` after.
 */
function touching(): ExtrudoDocument {
  return document('a cut of the bodies it touches', [
    box('o0', -40),
    box('fb', 0),
    box('o1', 20),
    ...slot('cut', [-8, -1, 8, 1]),
    box('o2', 40),
  ]);
}

/**
 * A circle cut of radius 8 at (100, 0) through `ob`, and a 4 mm box `nb` whose box meets the
 * tool's but that it doesn't touch.
 */
function nearby(): ExtrudoDocument {
  return document('a box near the tool, not touching it', [
    box('ob', 100),
    small('nb', 108, 8, 4),
    ...circleCut('cc', 100, 0, 8),
  ]);
}

/** A slot like `slot`'s that joins. */
const joined = (id: string, rect: [number, number, number, number]) =>
  slot(id, rect).map((f) =>
    f.id === id ? { ...f, inputs: { ...f.inputs, operation: choice('join') } } : f,
  );

/**
 * A join of a picked box `fb`: a slot reaching from it towards `o1` (20 mm off: `nudge` moves it
 * to 12 mm, into the slot's way, touched but not picked), boxes before and after.
 */
function pickedJoin(): ExtrudoDocument {
  const doc = document('a join of a picked body', [
    box('o0', -40),
    box('fb', 0),
    box('o1', 20),
    ...joined('jn', [-8, -1, 14, 1]),
    box('o2', 40),
  ]);
  return setInputs(doc, 'jn', { bodies: bodies('fb:0') });
}

const DESIGNS: Design[] = [
  {
    name: 'cuts of picked bodies, a box in the way it doesn’t pick',
    make: async () => picked(),
    target: 'cx',
    refsKey: 'bodies',
    // No bodies picked: the cut asks every body which it touches (`touch`), a view too.
    rule: ['lose: view→write', 'find: write→view', 'empty: view→view', 'fill: view→view'],
    kinds: [
      ...BASE,
      'twice',
      'untwice',
      'op-cycle',
      'op-cycle',
      'op-cycle',
      'op-cycle',
      'reach',
      'reach',
      ...GENERIC_KINDS,
    ] as Kind[],
    flips: [
      'twice: view→view',
      'untwice: view→view',
      'op-cycle: view→view',
      'op-cycle: view→write',
      'op-cycle: write→view',
      'reach: view→view',
    ],
    steps: 24,
  },
  {
    name: 'a cut of the bodies it touches, boxes before, between (moved in and out) and after',
    make: async () => touching(),
    target: 'cut',
    refsKey: 'bodies',
    rule: [],
    kinds: [
      'size-face',
      'size-before',
      'size-between',
      'size-after',
      'nudge',
      'nudge',
      'op-cycle',
      'op-cycle',
      'op-cycle',
      'op-cycle',
      'reach',
      'reach',
      ...GENERIC_KINDS,
    ] as Kind[],
    flips: [
      'size-face: view→view',
      'size-before: view→view',
      'size-between: view→view',
      'nudge: view→view',
      'op-cycle: view→view',
      'op-cycle: view→write',
      'op-cycle: write→view',
      // Through all: the reach from the boxes in the tool's key (rule B).
      'reach: view→view',
    ],
    steps: 24,
  },
  {
    name: 'a join of a picked box, a box it touches but doesn’t pick moved in and out',
    make: async () => pickedJoin(),
    target: 'jn',
    refsKey: 'bodies',
    // No bodies picked: a join of the bodies it touches, `touch` too.
    rule: ['lose: view→write', 'find: write→view', 'empty: view→view', 'fill: view→view'],
    kinds: [
      ...BASE,
      'twice',
      'untwice',
      'size-face',
      'size-before',
      'nudge',
      'nudge',
      'op-cycle',
      'op-cycle',
      'op-cycle',
      'op-cycle',
      ...GENERIC_KINDS,
    ] as Kind[],
    flips: [
      'twice: view→view',
      'untwice: view→view',
      'size-face: view→view',
      'nudge: view→view',
      'op-cycle: view→write',
      'op-cycle: write→view',
      'op-cycle: view→view',
    ],
    steps: 24,
  },
];

describe('view access: operations (ADR-0024)', () => {
  proveDesigns(DESIGNS);

  it('picked cut: a box it doesn’t pick runs alone; a picked box runs the cut', {
    timeout: 120_000,
  }, async () => {
    const doc = picked();
    const steps = await sequence([
      doc,
      setInputs(doc, 'o0', { length: length('12 mm') }),
      doc,
      setInputs(doc, 'o1', { height: length('12 mm') }),
      doc,
      setInputs(doc, 'b2', { height: length('12 mm') }),
    ]);
    for (const step of steps) {
      expect(step.problems).toEqual([]);
      expect(fallbacks(step.result, doc)).toEqual([]);
      expect(step.result.stats.viewed).toEqual(['cx']);
    }
    // Each picked box in two, its piece right after it; the box in the way whole.
    expect(steps[0]?.result.bodies.map((b) => b.id)).toEqual([
      'o0:0',
      'b1:0',
      'cx:0',
      'o1:0',
      'b2:0',
      'cx:1',
      'o2:0',
    ]);
    expect(steps[1]?.evaluated).toEqual(['o0']);
    expect(steps[3]?.evaluated).toEqual(['o1']);
    expect(steps[5]?.evaluated).toEqual(['b2', 'cx']);
  });

  /** Steps from `doc`, each equal to a cleared engine and to `write` keys, no fall-back. */
  const steps = async (docs: ExtrudoDocument[]) => {
    const out = await sequence(docs);
    out.forEach((step, i) => {
      expect(step.problems, `step ${i}`).toEqual([]);
      expect(fallbacks(step.result, docs[i] as ExtrudoDocument), `step ${i}`).toEqual([]);
    });
    return out;
  };
  const at = (doc: ExtrudoDocument, id: string, x: number) =>
    setInputs(doc, id, { x: length(`${x} mm`) });

  it('touch: a box whose box misses the tool’s, larger and smaller: it alone', {
    timeout: 120_000,
  }, async () => {
    const doc = touching();
    const run = await steps([
      doc,
      setInputs(doc, 'o0', { length: length('12 mm') }),
      setInputs(doc, 'o0', { length: length('8 mm') }),
    ]);
    expect(run[0]?.result.stats.viewed).toEqual(['cut']);
    expect(run[1]?.evaluated).toEqual(['o0']);
    expect(run[2]?.evaluated).toEqual(['o0']);
  });

  it('touch: a box whose box meets the tool’s, not touching it, larger and smaller: it alone', {
    timeout: 120_000,
  }, async () => {
    const doc = nearby();
    const size = (s: number) =>
      setInputs(doc, 'nb', { length: length(`${s} mm`), width: length(`${s} mm`) });
    const run = await steps([doc, size(4.4), size(3)]);
    expect(run[0]?.result.stats.viewed).toEqual(['cc']);
    expect(run[1]?.evaluated).toEqual(['nb']);
    expect(run[2]?.evaluated).toEqual(['nb']);
  });

  it('touch: a box comes to touch the tool, and goes again', { timeout: 120_000 }, async () => {
    const doc = touching();
    const run = await steps([doc, at(doc, 'o1', 12), at(doc, 'o1', 24)]);
    // In: the cut runs with it (a notch in its corner). Out again, somewhere new: the box runs,
    // the cut's first result from the cache.
    expect(run[1]?.evaluated).toEqual(['o1', 'cut']);
    expect(run[2]?.evaluated).toEqual(['o1']);
  });

  it('touch: the box it touches moves away (the cut touches nothing: its error), and back', {
    timeout: 120_000,
  }, async () => {
    const doc = touching();
    const run = await steps([doc, at(doc, 'fb', 60), doc]);
    expect(run[1]?.evaluated).toEqual(['fb', 'cut']);
    expect(run[1]?.result.features['cut' as FeatureId]?.status).toBe('error');
    // Back: every feature from the cache (the box's own entry too).
    expect(run[2]?.evaluated).toEqual([]);
  });

  it('touch: the box it touches changes and still touches; the tool changes', {
    timeout: 120_000,
  }, async () => {
    const doc = touching();
    const run = await steps([
      doc,
      setInputs(doc, 'fb', { height: length('12 mm') }),
      doc,
      setInputs(doc, 'cut', { distance: length('24 mm') }),
    ]);
    expect(run[1]?.evaluated).toEqual(['fb', 'cut']);
    expect(run[3]?.evaluated).toEqual(['cut']);
  });

  it('touch: a body added before it in the tool’s way, and taken out again', {
    timeout: 120_000,
  }, async () => {
    const doc = touching();
    const at0 = doc.features.findIndex((f) => f.id === 'sk-cut');
    const features = [...doc.features];
    features.splice(at0, 0, small('ab', 4, 0, 4));
    const added = { ...doc, features, timelineMarker: features.length };
    const run = await steps([doc, added, doc]);
    expect(run[1]?.evaluated).toEqual(['ab', 'cut']);
    expect(run[2]?.evaluated).toEqual([]);
  });

  it('touch: a join of two boxes in the other order: the other keeps its ID', {
    timeout: 120_000,
  }, async () => {
    const doc = document('a join of two boxes', [
      box('j1', 0),
      box('j2', 6),
      box('o0', 60),
      ...joined('jn', [-2, -1, 8, 1]),
    ]);
    const swapped = {
      ...doc,
      features: [doc.features[1], doc.features[0], ...doc.features.slice(2)] as typeof doc.features,
    };
    const run = await steps([doc, swapped, setInputs(swapped, 'o0', { length: length('12 mm') })]);
    expect(run[0]?.result.bodies.map((b) => b.id)).toEqual(['j1:0', 'o0:0']);
    expect(run[1]?.result.bodies.map((b) => b.id)).toEqual(['j2:0', 'o0:0']);
    expect(run[1]?.evaluated).toEqual(['jn']);
    expect(run[2]?.evaluated).toEqual(['o0']);
  });

  it('touch: a join that touches nothing makes a new body at the end; then a box comes to it', {
    timeout: 120_000,
  }, async () => {
    const doc = document('a join apart', [
      box('o0', 0),
      box('jb', 40),
      ...joined('jn', [196, -1, 204, 1]),
    ]);
    const run = await steps([doc, at(doc, 'jb', 200), at(doc, 'o0', 4)]);
    expect(run[0]?.result.stats.viewed).toEqual(['jn']);
    expect(run[0]?.result.bodies.map((b) => b.id)).toEqual(['o0:0', 'jb:0', 'jn:0']);
    expect(run[1]?.result.bodies.map((b) => b.id)).toEqual(['o0:0', 'jb:0']);
    expect(run[2]?.evaluated).toEqual(['o0']);
  });

  it('answers: touch for automatic participants, distances or through all, sketch profiles; else view or write', {
    timeout: 120_000,
  }, async () => {
    const extrude = kernelFeatures().get('extrude');
    const access = (more: object, profile: GeomRef = { kind: 'profile', id: 'sk/r' }) =>
      extrude?.bodyAccess?.(
        extrudeInputs([profile as never], { distance: '2 mm', ...more }) as never,
      );
    expect(access({ operation: 'cut' })).toBe('touch');
    expect(access({ operation: 'join' })).toBe('touch');
    expect(access({ operation: 'intersect' })).toBe('touch');
    expect(access({ operation: 'cut', bodies: ['b:0'] })).toBe('view');
    expect(access({ operation: 'join', bodies: ['b:0'] })).toBe('touch');
    expect(access({ operation: 'join', bodies: ['b:0'], extent: 'through-all' })).toBe('write');
    // Through all: the engine keys the tool by its reach (rule B).
    expect(access({ operation: 'cut', extent: 'through-all' })).toBe('touch');
    expect(access({ operation: 'cut', extent: 'to-object' })).toBe('write');
    // A face profile: the tool built on that body (rule R).
    expect(access({ operation: 'cut' }, { kind: 'face', id: 'f[top]' })).toBe('touch');
    expect(access({})).toBe('add');
  });

  it('a cut from a body’s face keeps its tool by that body’s version: changed, built again', {
    timeout: 120_000,
  }, async () => {
    const parts = document('a box under a box', [box('fb', 0), small('ub', 0, 0, 6)]);
    const face = await computed(parts, (engine) => faceRefs(engine, 'fb:0', top)[0] as GeomRef);
    const doc = document('a cut from a body’s face', [
      box('fb', 0),
      feature('ub', 'box', {
        ...small('ub', 0, 0, 6).inputs,
        offset: length('8 mm'),
      }),
      feature(
        'fp',
        'extrude',
        extrudeInputs([{ kind: 'face', id: face.id } as never], {
          distance: '4 mm',
          operation: 'cut',
        }),
      ),
    ]);
    const run = await steps([doc, setInputs(doc, 'fb', { width: length('4 mm') })]);
    expect(run[0]?.result.features['fp' as FeatureId]?.status).toBe('ok');
    expect(run[0]?.result.stats.viewed).toEqual(['fp']);
    expect(run[1]?.evaluated).toEqual(['fb', 'fp']);
  });

  it('touch: a tool whose result the cache let go is not asked again: every body, as at first', {
    timeout: 120_000,
  }, async () => {
    // Two entries at most: the first cut's result goes while the second distance is computed, so
    // its tool (held by that result) is gone when the first distance comes back.
    const doc = touching();
    const other = setInputs(doc, 'cut', { distance: length('24 mm') });
    const out = await sequence([doc, other, setInputs(doc, 'o0', { length: length('12 mm') })], {
      options: { maxEntries: 2 },
    });
    for (const step of out) expect(step.problems).toEqual([]);
    expect(out[2]?.evaluated).toContain('cut');
    expect(out[2]?.result.stats.viewed).toEqual(['cut']);
  });

  /** `Kernel.distance` failing for a 4.4 mm wide shape while `use` runs (a test switch). */
  async function failingDistance<T>(use: (log: string[]) => Promise<T>): Promise<T> {
    const original = Kernel.prototype.distance;
    const log: string[] = [];
    Kernel.prototype.distance = function (this: Kernel, a, b) {
      log.push('distance');
      const wide = (s: typeof a) => {
        const { min, max } = this.measureBox(s);
        return Math.abs((max[0] ?? 0) - (min[0] ?? 0) - 4.4) < 0.01;
      };
      if (wide(a) || wide(b)) throw new KernelError('A test distance failed.');
      return original.call(this, a, b);
    };
    try {
      return await use(log);
    } finally {
      Kernel.prototype.distance = original;
    }
  }

  it('touch: asking a body again fails: the cut’s error as a cleared engine’s, the rest computed', {
    timeout: 120_000,
  }, async () => {
    const doc = document('a box near the tool, not touching it, a box after', [
      ...nearby().features,
      box('o9', 140),
    ]);
    const size = (s: number) =>
      setInputs(doc, 'nb', { length: length(`${s} mm`), width: length(`${s} mm`) });
    const run = await failingDistance(() => sequence([doc, size(4.4), doc, size(4.4)]));
    for (const step of run) expect(step.problems).toEqual([]);
    const status = (i: number, id: string) => run[i]?.result.features[id as FeatureId]?.status;
    expect(status(1, 'cc')).toBe('error');
    for (const id of ['ob', 'nb', 'o9']) expect(status(1, id), id).not.toBe('error');
    // Back: no tool kept (the ask failed), so the cut runs with every body and finds its first
    // result in the cache (`#evaluate` hands back that entry).
    expect(run[2]?.evaluated).toEqual(['cc']);
    expect(status(2, 'cc')).not.toBe('error');
    expect(status(2, 'cc')).toBe(status(0, 'cc'));
    // The failing box again: the error from the cache, the ask failing again.
    expect(run[3]?.evaluated).toEqual([]);
    expect(status(3, 'cc')).toBe('error');
  });

  it('touch: the feature is reported before its bodies are asked again', {
    timeout: 120_000,
  }, async () => {
    const doc = nearby();
    const engine = new RecomputeEngine(testKernel(), kernelFeatures(), { strictLeaks: true });
    try {
      await engine.recompute({ doc });
      await failingDistance(async (log) => {
        log.length = 0;
        const grown = setInputs(doc, 'nb', { length: length('4.2 mm'), width: length('4.2 mm') });
        await engine.recompute({ doc: grown }, (id) => log.push(`feature ${id ?? '-'}`));
        // The box, then the cut reported, then its exact distance to the box asked.
        expect(log.slice(0, 3)).toEqual(['feature nb', 'feature cc', 'distance']);
        // The box the cut touches made taller: asked once, by the engine; the cut, run again with
        // it, takes that answer (`EvalContext.touched`).
        log.length = 0;
        await engine.recompute({ doc: setInputs(grown, 'ob', { height: length('12 mm') }) });
        expect(log).toEqual(['distance']);
      });
    } finally {
      engine.clear();
    }
  });

  it('touch: a body before it without a version keeps the write key: nothing runs again', {
    timeout: 120_000,
  }, async () => {
    // A test feature whose body is the sketch's profile face itself (held by the sketch's output,
    // so it gets no version of its own).
    const registry = () => {
      const out = kernelFeatures();
      out.register({
        type: 'test-sheet',
        label: 'test-sheet',
        category: 'create',
        icon: 'test',
        inputsSchema: (kernelFeatures().get('extrude') as KernelFeatureDefinition).inputsSchema,
        bodyAccess: () => 'write',
        evaluate(ctx: EvalContext) {
          const ref = (ctx.inputs.profiles as { refs: GeomRef[] }).refs[0] as GeomRef;
          const [sketch, region] = ref.id.split('/') as [string, string];
          const face = (ctx.output(sketch as FeatureId).shapes as Record<string, unknown>)[region];
          return { bodies: new Map(ctx.bodies).set(ctx.bodyId(), face as never) };
        },
      } as unknown as KernelFeatureDefinition);
      return out;
    };
    const doc = touching();
    const sheet = circleCut('sh', 200, 0, 3).map((f) =>
      f.id === 'sh' ? { ...f, type: 'test-sheet' } : f,
    );
    const at0 = doc.features.findIndex((f) => f.id === 'sk-cut');
    const features = [...doc.features];
    features.splice(at0, 0, ...sheet);
    const withSheet = { ...doc, features, timelineMarker: features.length };
    // Versions aside: a body with none has none to compare (the same with today's keys).
    const run = await sequence([withSheet, withSheet], {
      registry,
      reference: registry,
      exact: false,
    });
    for (const step of run) expect(step.problems).toEqual([]);
    expect(run[0]?.result.features['cut' as FeatureId]?.status).toBe('ok');
    expect(run[0]?.result.stats.viewed).toEqual([]);
    expect(run[1]?.evaluated).toEqual([]);
  });

  it('touch: back to an earlier tool while its memory lives: its own answers', {
    timeout: 120_000,
  }, async () => {
    // A 4 mm box 12 mm over `fb`: the slot 20 mm deep doesn't reach it, 30 mm deep does.
    const base = touching();
    const doc = {
      ...base,
      features: [
        ...base.features.slice(0, 2),
        feature('xb', 'box', { ...small('xb', 0, 0, 4).inputs, offset: length('12 mm') }),
        ...base.features.slice(2),
      ],
      timelineMarker: base.features.length + 1,
    };
    const deep = setInputs(doc, 'cut', { distance: length('30 mm') });
    const run = await steps([doc, deep, doc, setInputs(doc, 'o0', { length: length('12 mm') })]);
    expect(run[1]?.evaluated).toEqual(['cut']);
    expect(run[2]?.evaluated).toEqual([]);
    expect(run[3]?.evaluated).toEqual(['o0']);
  });

  it('touch: a picked join: a box it touches but doesn’t pick runs it, an unrelated one doesn’t', {
    timeout: 120_000,
  }, async () => {
    const doc = pickedJoin();
    const run = await steps([
      doc,
      setInputs(doc, 'o0', { length: length('12 mm') }),
      at(doc, 'o1', 12),
      at(doc, 'fb', -30),
    ]);
    expect(run[0]?.result.stats.viewed).toEqual(['jn']);
    expect(run[1]?.evaluated).toEqual(['o0']);
    // In the slot's way: listed among the bodies it touches (its report), not joined.
    expect(run[2]?.evaluated).toEqual(['o1', 'jn']);
    expect(
      (run[2]?.result.reports['jn' as FeatureId] as { touching?: string[] } | undefined)?.touching,
    ).toEqual(['fb:0', 'o1:0']);
    // The picked box off the slot: the join makes a new body and says so.
    expect(run[3]?.evaluated).toEqual(['fb', 'jn']);
    expect(run[3]?.result.features['jn' as FeatureId]?.status).toBe('warning');
  });

  it('touch: the picked box of a join gone (suppressed): its error, as a cleared engine’s, no fall-back', {
    timeout: 120_000,
  }, async () => {
    const doc = pickedJoin();
    const gone = {
      ...doc,
      features: doc.features.map((f) => (f.id === 'fb' ? { ...f, suppressed: true } : f)),
    };
    const run = await steps([doc, gone]);
    expect(run[1]?.result.features['jn' as FeatureId]?.status).toBe('error');
    expect(run[1]?.evaluated).toEqual(['jn']);
  });

  it('touch: a picked join that misses its picked box and touches another: the answers it hands over', {
    timeout: 120_000,
  }, async () => {
    // The slot touches `cb` (not picked) and misses `pb` (picked): a new body, `cb` in its report.
    // With a kept tool the cut's evaluation is told which bodies it touches: `pb` must come out
    // "not touched" (in the view, as a picked body, but apart from the tool), or it would be fused
    // with a tool apart from it.
    const base = document('a picked join apart from its body', [
      box('o0', -40),
      box('pb', 0),
      box('cb', 20),
      ...joined('jn', [12, -1, 28, 1]),
    ]);
    const doc = setInputs(base, 'jn', { bodies: bodies('pb:0') });
    const run = await steps([
      doc,
      setInputs(doc, 'cb', { height: length('12 mm') }),
      at(doc, 'pb', 8),
      at(doc, 'pb', -20),
    ]);
    expect(run[0]?.result.features['jn' as FeatureId]?.status).toBe('warning');
    expect(run[1]?.evaluated).toEqual(['cb', 'jn']);
    expect(run[1]?.result.bodies.map((b) => b.id)).toEqual(['o0:0', 'pb:0', 'cb:0', 'jn:0']);
    // In the slot's way: joined.
    expect(run[2]?.evaluated).toEqual(['pb', 'jn']);
    expect(run[2]?.result.bodies.map((b) => b.id)).toEqual(['o0:0', 'pb:0', 'cb:0']);
    expect(run[3]?.evaluated).toEqual(['pb', 'jn']);
  });

  it('touch: a to-object body left from an earlier extent is in the view (sound, a run more)', {
    timeout: 120_000,
  }, async () => {
    // `toObject` names `o0` but the extent is a distance again: the engine takes every `body`
    // reference as picked, so `o0` is in the cut's view and its edit runs the cut too.
    const doc = setInputs(touching(), 'cut', { toObject: bodies('o0:0') });
    const run = await steps([doc, setInputs(doc, 'o0', { length: length('12 mm') })]);
    expect(run[0]?.result.stats.viewed).toEqual(['cut']);
    expect(run[1]?.evaluated).toEqual(['o0', 'cut']);
  });
});
