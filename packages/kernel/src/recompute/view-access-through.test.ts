// Extrudes through all keyed by the reach their boxes give (rule B, ADR-0024's amendment on boxes
// by version): a cut through all with automatic participants answers `touch`; the engine keeps
// each body version's box, hands the evaluator the reach (`ctx.reach`), and keys the tool by the
// calls it made and their answers. Boxes `o0` before (far off: `tall` makes it set the reach),
// `fb` (cut in two), `o1` between (`nudge` moves it into the slot's way), `o2` after; the slot
// sketched on a plane 5 mm up, so both directions reach something. Real OCCT and manifold, strict
// leaks, no clock.
import {
  type AttachmentId,
  type ExtrudeInputOptions,
  type ExtrudoDocument,
  extrudeInputs,
  type Feature,
  type FeatureId,
  FeatureRegistry,
  type GeomRef,
  importInputs,
  moveInputs,
  originPlaneRef,
  primitiveInputs,
  profileRefId,
  sketchInputs,
} from '@extrudo/core';
import { SketchBuilder } from '@extrudo/sketch/fixtures';
import { detectProfiles } from '@extrudo/sketch/profiles';
import { describe, expect, it } from 'vitest';
import cubeStl from '../../../../fixtures/imports/cube.stl?url&inline';
import { kernelFeatures } from '../features';
import type { ExtrudeOutputData } from '../features/extrude';
import { reachAlong } from '../features/operation';
import { KernelError } from '../kernel';
import {
  bytesOf,
  type Done,
  fallbacks,
  GENERIC_KINDS,
  length,
  setInputs,
} from './add-access-test-support';
import { RecomputeEngine } from './engine';
import type { ImportedFile, KernelFeatureDefinition } from './types';
import {
  BASE,
  box,
  type Design,
  feature,
  type Kind,
  lifted,
  proveDesigns,
  provedSteps,
  sequence,
  statusOf,
  testKernel,
  topOf,
  useKernel,
} from './view-access-features-test-support';
import { document } from './view-access-test-support';

useKernel();

/** A plane `zp` 5 mm up, a sketch of `rect` on it, and `id` extruding it through all. */
function throughCut(
  id: string,
  [x0, y0, x1, y1]: [number, number, number, number],
  options: ExtrudeInputOptions = {},
): Feature[] {
  const b = new SketchBuilder();
  b.line(x0, y0, x1, y0);
  b.line(x1, y0, x1, y1);
  b.line(x1, y1, x0, y1);
  b.line(x0, y1, x0, y0);
  const [region] = detectProfiles(b.sketch);
  const sketch = `sk-${id}`;
  return [
    feature('zp', 'offsetPlane', {
      plane: { kind: 'ref', refs: [originPlaneRef('origin:xy')] },
      distance: length('5 mm'),
    }),
    feature(sketch, 'sketch', sketchInputs({ kind: 'plane', id: 'zp' }, b.sketch)),
    feature(
      id,
      'extrude',
      extrudeInputs(
        [{ kind: 'profile', id: profileRefId(sketch as FeatureId, region?.id ?? '') }],
        {
          extent: 'through-all',
          distance: '4 mm',
          operation: 'cut',
          ...options,
        },
      ),
    ),
  ];
}

/** `o0`, `fb`, `o1`, a 16 × 2 mm slot cut through all from 5 mm up, `o2`; `more` before the cut. */
const slotted = (more: Feature[] = [], options: ExtrudeInputOptions = {}): ExtrudoDocument =>
  document('a cut through all', [
    box('o0', -40),
    box('fb', 0),
    box('o1', 20),
    ...more,
    ...throughCut('cut', [-8, -1, 8, 1], options),
    box('o2', 40),
  ]);

/**
 * `fb`'s top face cut through all (`fp`), up through `ub` on top of it; `o0` before, far off
 * (`tall` sets the reach), `o2` after. Built on `fb` (rule R) and keyed by the reach (rule B).
 */
async function faceThrough(): Promise<ExtrudoDocument> {
  const face = await topOf();
  return document('a cut through all from a box’s face', [
    box('o0', -40),
    box('fb', 0),
    lifted('ub', 0, 6, 10),
    feature(
      'fp',
      'extrude',
      extrudeInputs([{ kind: 'face', id: face.id } as never], {
        extent: 'through-all',
        distance: '4 mm',
        operation: 'cut',
      }),
    ),
    box('o2', 40),
  ]);
}

/** `slotted`'s slot joined to the picked `fb` alone: its reach is `fb`'s box alone. */
const pickedThrough = () =>
  slotted([], { operation: 'join', bodies: ['fb:0'], direction: 'symmetric' });

const tall = (doc: ExtrudoDocument) => setInputs(doc, 'o0', { height: length('30 mm') });
const touching = (run: Awaited<ReturnType<typeof provedSteps>>, i: number) =>
  (run[i]?.result.reports['cut' as FeatureId] as { touching: string[] } | undefined)?.touching;

const DESIGNS: Design[] = [
  {
    name: 'a cut through all of what it touches, the far box taller, flipped, its sides cycled',
    make: async () => slotted(),
    target: 'cut',
    refsKey: 'profiles',
    kinds: [
      ...BASE,
      'size-face',
      'size-before',
      'size-between',
      'size-after',
      'nudge',
      'nudge',
      'tall',
      'tall',
      'turn',
      'turn',
      'sides',
      'sides',
      'side2',
      'side2',
      'sides',
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
      'nudge: view→view',
      'tall: view→view',
      'turn: view→view',
      'sides: view→view',
      'side2: view→view',
      'op-cycle: view→write',
      'op-cycle: write→view',
      'reach: view→view',
    ],
    steps: 40,
  },
  {
    name: 'a cut through all from a box’s face, the box and the far box changed, flipped',
    make: faceThrough,
    target: 'fp',
    refsKey: 'profiles',
    kinds: [
      ...BASE,
      'size-face',
      'size-face',
      'size-before',
      'tall',
      'tall',
      'turn',
      'turn',
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
      'tall: view→view',
      'turn: view→view',
      'op-cycle: view→write',
      'op-cycle: write→view',
      'reach: view→view',
    ],
    steps: 30,
  },
  {
    name: 'a join through all of a picked box, the far box taller, a box moved to it and away',
    make: async () => pickedThrough(),
    target: 'cut',
    refsKey: 'bodies',
    // No bodies picked: a join of the bodies it touches, `touch` too.
    rule: ['lose: view→write', 'find: write→view', 'empty: view→view', 'fill: view→view'],
    kinds: [
      ...BASE,
      'twice',
      'untwice',
      'size-face',
      'tall',
      'tall',
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
      'tall: view→view',
      'nudge: view→view',
      'op-cycle: view→write',
      'op-cycle: write→view',
      'op-cycle: view→view',
    ],
    steps: 30,
  },
];

describe('view access: through all, keyed by the reach (ADR-0024)', () => {
  proveDesigns(DESIGNS);

  it('the far box taller: a new reach, the cut runs again; back, the first tool and result', {
    timeout: 120_000,
  }, async () => {
    const doc = slotted();
    const run = await provedSteps([doc, tall(doc), doc]);
    expect(statusOf(run, 0, 'cut')).toBe('ok');
    expect(run[0]?.result.stats.viewed).toEqual(['cut']);
    expect(run[1]?.evaluated).toEqual(['o0', 'cut']);
    // The first document again: every result from the cache, the cut's under its first reach.
    expect(run[2]?.evaluated).toEqual([]);
    expect(run[2]?.result.stats.viewed).toEqual(['cut']);
  });

  it('a box moved from beside the slot to over it, past the old reach: the new tool cuts it', {
    timeout: 120_000,
  }, async () => {
    // At 30 mm, 0 to 10 mm high: off the slot, the reach up 6 mm. Over the slot 20 to 30 mm high:
    // the reach 26.25 mm. The 6 mm tool, kept, would not touch it, and it would stay uncut.
    const doc = slotted([lifted('ub', 30, 4, 0)]);
    const over = setInputs(doc, 'ub', { x: length('0 mm'), offset: length('20 mm') });
    const run = await provedSteps([doc, over, doc]);
    expect(touching(run, 0)).toEqual(['fb:0']);
    expect(run[1]?.evaluated).toEqual(['ub', 'cut']);
    expect(touching(run, 1)).toEqual(['fb:0', 'ub:0']);
    expect(run[2]?.evaluated).toEqual([]);
  });

  it('a box wider, the reach the same: kept; the cut box wider: run with the kept tool', {
    timeout: 120_000,
  }, async () => {
    const doc = tall(slotted());
    const run = await provedSteps([
      doc,
      setInputs(doc, 'o0', { width: length('14 mm') }),
      setInputs(doc, 'fb', { width: length('14 mm') }),
    ]);
    expect(run[1]?.evaluated).toEqual(['o0']);
    expect(run[2]?.evaluated).toEqual(['fb', 'cut']);
    expect(run[2]?.result.stats.viewed).toContain('cut');
  });

  it('the box that sets the reach suppressed, moved by a same-ID move, deleted; one added', {
    timeout: 120_000,
  }, async () => {
    const doc = tall(slotted());
    const without = (id: string) => ({
      ...doc,
      features: doc.features.filter((f) => f.id !== id),
      timelineMarker: doc.features.length - 1,
    });
    const before = (extra: Feature) => {
      const features = [...doc.features];
      features.splice(
        features.findIndex((f) => f.id === 'zp'),
        0,
        extra,
      );
      return { ...doc, features, timelineMarker: features.length };
    };
    const suppressed = {
      ...doc,
      features: doc.features.map((f) => (f.id === 'o0' ? { ...f, suppressed: true } : f)),
    };
    const moved = before(feature('mv', 'move', moveInputs(['o0:0'], { dz: '5 mm' })));
    const added = before(
      feature('tb', 'box', {
        ...box('tb', 60).inputs,
        height: length('50 mm'),
      }),
    );
    const run = await provedSteps([
      doc,
      suppressed,
      doc,
      moved,
      doc,
      without('o0'),
      doc,
      added,
      doc,
    ]);
    expect(run[1]?.evaluated).toEqual(['cut']);
    expect(run[3]?.evaluated).toEqual(['mv', 'cut']);
    // Deleted: the bodies and the reach of the suppressed step, its result from the cache.
    expect(run[5]?.evaluated).toEqual([]);
    expect(run[7]?.evaluated).toEqual(['tb', 'cut']);
    for (const i of [2, 4, 6, 8]) expect(run[i]?.evaluated, `step ${i}`).toEqual([]);
  });

  it('no body at all: the error a cleared engine gives; a box, then ok', {
    timeout: 120_000,
  }, async () => {
    const empty = document('nothing to go through', throughCut('cut', [-8, -1, 8, 1]));
    const one = document('one box', [box('fb', 0), ...throughCut('cut', [-8, -1, 8, 1])]);
    const gone = {
      ...one,
      features: one.features.map((f) => (f.id === 'fb' ? { ...f, suppressed: true } : f)),
    };
    const run = await provedSteps([empty, one, gone, one]);
    expect(statusOf(run, 0, 'cut')).toBe('error');
    expect(statusOf(run, 1, 'cut')).toBe('ok');
    expect(statusOf(run, 2, 'cut')).toBe('error');
    expect(statusOf(run, 3, 'cut')).toBe('ok');
  });

  it('the direction flipped and the profile changed: a new tool each', {
    timeout: 120_000,
  }, async () => {
    const doc = tall(slotted());
    const wider = tall(
      document('a wider slot', [
        box('o0', -40),
        box('fb', 0),
        box('o1', 20),
        ...throughCut('cut', [-8, -1, 8, 3]),
        box('o2', 40),
      ]),
    );
    const run = await provedSteps([
      doc,
      setInputs(doc, 'cut', { flip: { kind: 'bool', value: true } }),
      doc,
      wider,
    ]);
    expect(run[1]?.evaluated).toEqual(['cut']);
    expect(run[2]?.evaluated).toEqual([]);
    expect(run[3]?.evaluated).toEqual(['sk-cut', 'cut']);
  });

  it('a box comes to touch and goes', { timeout: 120_000 }, async () => {
    const doc = slotted();
    const run = await provedSteps([
      doc,
      setInputs(doc, 'o1', { x: length('12 mm') }),
      setInputs(doc, 'o1', { x: length('30 mm') }),
    ]);
    expect(run[1]?.evaluated).toEqual(['o1', 'cut']);
    expect(touching(run, 1)).toEqual(['fb:0', 'o1:0']);
    expect(run[2]?.evaluated).toEqual(['o1']);
  });

  it('a mesh body among the bodies: its box in the reach, cut as a cleared engine cuts it', {
    timeout: 120_000,
  }, async () => {
    // The 20 mm cube from an STL (0 to 20 mm each way): a mesh body the slot meets at its edge;
    // its box sets the reach up (15 mm above the plane).
    const STL = 'att-stl' as AttachmentId;
    const files = new Map<AttachmentId, ImportedFile>([
      [STL, { bytes: bytesOf(cubeStl), mediaType: 'model/stl', fileName: 'cube.stl' }],
    ]);
    const doc = slotted([feature('imp', 'import', importInputs({ file: STL }))]);
    const run = await provedSteps(
      [doc, setInputs(doc, 'fb', { width: length('12 mm') }), tall(doc)],
      { options: { files: (id: AttachmentId) => files.get(id) } },
    );
    expect(statusOf(run, 0, 'cut')).not.toBe('error');
    expect(touching(run, 0)).toEqual(['fb:0', 'imp:0']);
    expect(run[1]?.evaluated).toEqual(['fb', 'cut']);
    expect(run[2]?.evaluated).toEqual(['o0', 'cut']);
  });

  it('the evaluator in a view takes the reach of every body, not of the view', {
    timeout: 120_000,
  }, async () => {
    // `o0` sets the reach (30 mm high) but is outside the view: an evaluator measuring only the
    // bodies it sees would make the tool 6 mm long instead of 26.25 mm.
    const extents: { reach: boolean; extents: readonly number[] }[] = [];
    const spy = () => {
      const registry = new FeatureRegistry<KernelFeatureDefinition>();
      for (const definition of kernelFeatures().list()) {
        registry.register(
          definition.type !== 'extrude'
            ? definition
            : {
                ...definition,
                evaluate(ctx) {
                  const out = definition.evaluate(ctx);
                  const data = out.data as ExtrudeOutputData | undefined;
                  if (ctx.feature.id === 'cut' && data) {
                    extents.push({ reach: ctx.reach !== undefined, extents: data.extents });
                  }
                  return out;
                },
              },
        );
      }
      return registry;
    };
    // Only the engine under test takes the spy; it evaluates the cut once a step.
    const doc = tall(slotted());
    const run = await provedSteps([doc, setInputs(doc, 'fb', { width: length('14 mm') })], {
      registry: spy,
    });
    expect(run[1]?.evaluated).toEqual(['fb', 'cut']);
    expect(run[1]?.result.stats.viewed).toContain('cut');
    expect(extents).toHaveLength(2);
    expect(extents[0]?.extents[0]).toBeCloseTo(26.25, 5);
    expect(extents[1]).toEqual(extents[0]);
    expect(extents[1]?.reach).toBe(true);
  });

  it('a cut through all from a face: the face’s box or the far box changed runs it, another not', {
    timeout: 120_000,
  }, async () => {
    const doc = await faceThrough();
    const run = await provedSteps([
      doc,
      setInputs(doc, 'o2', { height: length('30 mm') }),
      tall(doc),
      setInputs(doc, 'fb', { width: length('12 mm') }),
    ]);
    // A warning: `ub`, all within the face's prism, is cut away whole.
    expect(statusOf(run, 0, 'fp')).toBe('warning');
    expect(run[0]?.result.stats.viewed).toEqual(['fp']);
    // After it: not in its reach.
    expect(run[1]?.evaluated).toEqual(['o2']);
    expect(run[2]?.evaluated).toEqual(['o0', 'fp']);
    expect(run[3]?.evaluated).toEqual(['fb', 'fp']);
  });

  it('a join through all of a picked box: its reach is that box’s, the far box runs alone', {
    timeout: 120_000,
  }, async () => {
    const doc = pickedThrough();
    const run = await provedSteps([
      doc,
      tall(doc),
      setInputs(doc, 'fb', { height: length('12 mm') }),
      setInputs(doc, 'o1', { x: length('12 mm') }),
    ]);
    expect(statusOf(run, 0, 'cut')).toBe('ok');
    expect(run[0]?.result.stats.viewed).toEqual(['cut']);
    expect(run[1]?.evaluated).toEqual(['o0']);
    expect(run[2]?.evaluated).toEqual(['fb', 'cut']);
    // Come to the slot's end: touched (in its report and view), not joined: not picked.
    expect(run[3]?.evaluated).toEqual(['o1', 'cut']);
    expect(touching(run, 3)).toEqual(['fb:0', 'o1:0']);
  });

  it('answers: through all touch (automatic, a picked join, a sketch, a face); to an object not', () => {
    const extrude = kernelFeatures().get('extrude');
    const access = (
      more: ExtrudeInputOptions,
      profile: GeomRef = { kind: 'profile', id: 'sk/r' },
    ) =>
      extrude?.bodyAccess?.(
        extrudeInputs([profile as never], { distance: '2 mm', ...more }) as never,
      );
    expect(access({ operation: 'cut', extent: 'through-all' })).toBe('touch');
    expect(access({ operation: 'join', extent: 'through-all', direction: 'symmetric' })).toBe(
      'touch',
    );
    expect(access({ operation: 'intersect', direction: 'two-sides', extent2: 'through-all' })).toBe(
      'touch',
    );
    expect(access({ operation: 'cut', extent: 'through-all', bodies: ['b:0'] })).toBe('view');
    expect(access({ operation: 'join', extent: 'through-all', bodies: ['b:0'] })).toBe('touch');
    expect(
      access({ operation: 'cut', extent: 'through-all' }, { kind: 'face', id: 'f[top]' }),
    ).toBe('touch');
    expect(access({ operation: 'cut', extent: 'to-object' })).toBe('write');
    expect(access({ extent: 'through-all' })).toBe('write');
  });
  it('a kept tool’s calls stay while it does: other through-all cuts past the bound, then nothing runs', {
    timeout: 120_000,
  }, async () => {
    // A bound of 4: six other cuts through all (each a new input, each new calls) evaluated with
    // every body after the slot. The slot's tool is kept each walk, and so are its calls; without
    // them its key would be the one without the reach, which keeps no tool, and it would run.
    const doc = slotted([], {});
    const other = (k: number) => {
      const extra = throughCut('oc', [38, -1, 42, 1], { distance: `${k} mm` });
      const features = [...doc.features, ...extra.filter((f) => f.id !== 'zp')];
      return { ...doc, features, timelineMarker: features.length };
    };
    const docs = [other(1), other(2), other(3), other(4), other(5), other(6), other(7), other(7)];
    const run = await provedSteps(docs, { options: { maxEntries: 4 } });
    for (const i of [1, 2, 3, 4, 5, 6]) expect(run[i]?.evaluated, `step ${i}`).toEqual(['oc']);
    expect(run[7]?.evaluated).toEqual([]);
  });

  it('a box that fails to measure when the key is worked out: reported first, a cleared engine’s error', {
    timeout: 120_000,
  }, async () => {
    const kernel = testKernel();
    const measure = kernel.measureBox.bind(kernel);
    const events: string[] = [];
    const doc = slotted();
    const cached = new RecomputeEngine(kernel, kernelFeatures(), { strictLeaks: true });
    const cleared = new RecomputeEngine(kernel, kernelFeatures(), { strictLeaks: true });
    try {
      await cached.recompute({ doc });
      // The far box made 30 mm high fails to measure: its first box is asked when the slot's key
      // is worked out.
      kernel.measureBox = (shape) => {
        const box = measure(shape);
        if ((box.max[2] as number) < 25) return box;
        events.push('measure');
        throw new KernelError('This box can’t be measured.');
      };
      const mine = await cached.recompute({ doc: tall(doc) }, (id) => events.push(`report ${id}`));
      const fresh = await cleared.recompute({ doc: tall(doc) });
      if (mine.status !== 'done' || fresh.status !== 'done') throw new Error('cancelled');
      expect(mine.features['cut' as FeatureId]?.status).toBe('error');
      expect(mine.features).toEqual(fresh.features);
      expect(mine.features['o2' as FeatureId]?.status).toBe('ok');
      expect(events.slice(0, events.indexOf('measure') + 1)).toEqual([
        'report o0',
        'report cut',
        'measure',
      ]);
    } finally {
      // The instance's own function goes; the class's is back.
      delete (kernel as { measureBox?: unknown }).measureBox;
      cached.clear();
      cleared.clear();
    }
  });

  it('an evaluation in the view that asks the boxes otherwise than its key: run as write', {
    timeout: 120_000,
  }, async () => {
    // An extrude that asks once more on every evaluation but its first: the calls an evaluation
    // in the view makes are not the ones its key holds. Rule B's induction, checked: the result
    // goes and the cut runs as `write` (one fall-back), equal to a cleared engine's but versions.
    let evaluations = 0;
    const asksMore = () => {
      const registry = new FeatureRegistry<KernelFeatureDefinition>();
      for (const definition of kernelFeatures().list()) {
        registry.register(
          definition.type !== 'extrude'
            ? definition
            : {
                ...definition,
                evaluate(ctx) {
                  if (ctx.feature.id === 'cut' && evaluations++ > 0)
                    ctx.reach?.([0, 0, 0], [1, 0, 0]);
                  return definition.evaluate(ctx);
                },
              },
        );
      }
      return registry;
    };
    const doc = tall(slotted());
    const docs = [doc, setInputs(doc, 'fb', { width: length('14 mm') })];
    const run = await sequence(docs, { registry: asksMore, exact: false });
    for (const step of run) expect(step.problems).toEqual([]);
    expect(fallbacks(run[0]?.result as Done, doc)).toEqual([]);
    expect(fallbacks(run[1]?.result as Done, docs[1] as ExtrudoDocument)).toEqual(['cut']);
  });
  it('the engine’s answers from the corners it keeps equal reachAlong over the boxes', {
    timeout: 120_000,
  }, async () => {
    // 60 boxes of random sizes and places, a slot through all after them; in its evaluation with
    // every body the extrude compares 300 of the engine's answers (random points and directions)
    // with `reachAlong` over the boxes it measures itself: exactly equal.
    let seed = 7;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    const boxes = Array.from({ length: 60 }, (_, i) =>
      feature(
        `rb${i}`,
        'box',
        primitiveInputs('box', {
          numbers: {
            length: `${1 + 29 * rand()} mm`,
            width: `${1 + 29 * rand()} mm`,
            height: `${1 + 29 * rand()} mm`,
            x: `${200 * rand() - 100} mm`,
            y: `${200 * rand() - 100} mm`,
            offset: `${40 * rand() - 20} mm`,
          },
        }),
      ),
    );
    const compared: { engine: number | undefined; own: number | undefined }[] = [];
    const spy = () => {
      const registry = new FeatureRegistry<KernelFeatureDefinition>();
      for (const definition of kernelFeatures().list()) {
        registry.register(
          definition.type !== 'extrude'
            ? definition
            : {
                ...definition,
                evaluate(ctx) {
                  if (ctx.feature.id === 'cut' && ctx.reach) {
                    const own = [...ctx.bodies.values()].map((s) => ctx.kernel.measureBox(s));
                    for (let k = 0; k < 300; k++) {
                      const v = [rand() - 0.5, rand() - 0.5, rand() - 0.5];
                      const n = Math.hypot(...v);
                      const along = v.map((x) => x / n) as [number, number, number];
                      const point = [200 * rand() - 100, 200 * rand() - 100, 40 * rand() - 20] as [
                        number,
                        number,
                        number,
                      ];
                      compared.push({
                        engine: ctx.reach(point, along),
                        own: reachAlong(own, point, along),
                      });
                    }
                  }
                  return definition.evaluate(ctx);
                },
              },
        );
      }
      return registry;
    };
    const doc = document('random boxes and a cut through all', [
      ...boxes,
      ...throughCut('cut', [-8, -1, 8, 1]),
    ]);
    const run = await sequence([doc], { registry: spy, exact: false });
    expect(run[0]?.problems).toEqual([]);
    expect(compared).toHaveLength(300);
    for (const { engine, own } of compared) expect(engine).toBe(own);
  });
});
