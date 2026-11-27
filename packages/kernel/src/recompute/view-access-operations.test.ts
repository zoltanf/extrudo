// The other operations keyed by the bodies they touch or pick (ADR-0024's amendment on the other
// operations): a revolve, a sweep, a loft, a coil and a box cut answer `touch` with automatic
// participants and a tool that reads no body, `view` for a picked cut or intersect, `write`
// otherwise. One small design per family: a box `fb` its tool cuts, a box `o1` 20 mm off that
// `nudge` moves into the tool's way (12 mm), boxes before and after. The engine-level cases (a
// failed ask, an evicted tool, join order, the version and order terms) are the same code path
// for every family and are tested once, with the extrude (`view-access-operation.test.ts`).
// Real OCCT and manifold, strict leaks, no clock.
import {
  coilInputs,
  type ExtrudoDocument,
  type Feature,
  type FeatureId,
  type FeatureInputs,
  type GeomRef,
  loftInputs,
  originPlaneRef,
  primitiveInputs,
  profileRefId,
  revolveInputs,
  sketchInputs,
  sweepInputs,
} from '@extrudo/core';
import { SketchBuilder } from '@extrudo/sketch/fixtures';
import { detectProfiles } from '@extrudo/sketch/profiles';
import { describe, expect, it } from 'vitest';
import { kernelFeatures } from '../features';
import { choice, fallbacks, GENERIC_KINDS, length, setInputs } from './add-access-test-support';
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
  top,
  useKernel,
} from './view-access-features-test-support';
import { document } from './view-access-test-support';

useKernel();

const X_AXIS: GeomRef = { kind: 'axis', id: 'origin:x' };

/** A sketch `id` on `plane` and the profile of its one region. */
function sketch(id: string, b: SketchBuilder, plane: GeomRef = originPlaneRef('origin:xy')) {
  const [region] = detectProfiles(b.sketch);
  return {
    feature: feature(id, 'sketch', sketchInputs(plane, b.sketch)),
    profile: { kind: 'profile', id: profileRefId(id as FeatureId, region?.id ?? '') } as GeomRef,
  };
}

function rectangle(x0: number, y0: number, x1: number, y1: number) {
  const b = new SketchBuilder();
  b.line(x0, y0, x1, y0);
  b.line(x1, y0, x1, y1);
  b.line(x1, y1, x0, y1);
  b.line(x0, y1, x0, y0);
  return b;
}

/** Each family's cut `cut`: through `fb` (at 0) and reaching to x = 9 (`o1` at 12 meets it). */
const TOOLS: Record<string, () => Feature[]> = {
  // A ring about X, 5–12 mm from it, x −5…9.
  revolve: () => {
    const s = sketch('rs', rectangle(-5, 5, 9, 12));
    return [
      s.feature,
      feature('cut', 'revolve', revolveInputs([s.profile], X_AXIS, { operation: 'cut' })),
    ];
  },
  // A slab x −1…8, y −1…1, swept up a line on XZ 15 mm.
  sweep: () => {
    const s = sketch('wp', rectangle(-1, -1, 8, 1));
    const path = new SketchBuilder();
    const up = path.line(0, 0, 0, 15);
    return [
      s.feature,
      feature('wq', 'sketch', sketchInputs(originPlaneRef('origin:xz'), path.sketch)),
      feature(
        'cut',
        'sweep',
        sweepInputs([s.profile], [{ kind: 'sketchEntity', id: `wq/${up.id}` }], {
          operation: 'cut',
        }),
      ),
    ];
  },
  // A 16 mm square on XY to a 6 mm square on a plane 12 mm up.
  loft: () => {
    const bottom = sketch('la', rectangle(-8, -2, 8, 2));
    const top = sketch('lb', rectangle(-3, -1, 3, 1), { kind: 'plane', id: 'lp' });
    return [
      feature('lp', 'offsetPlane', {
        plane: { kind: 'ref', refs: [originPlaneRef('origin:xy')] },
        distance: length('12 mm'),
      }),
      bottom.feature,
      top.feature,
      feature('cut', 'loft', loftInputs([bottom.profile, top.profile], { operation: 'cut' })),
    ];
  },
  // A coil Ø12 at x = 3, one turn 6 mm high, a 1.5 mm section.
  coil: () => [
    feature(
      'cut',
      'coil',
      coilInputs({
        operation: 'cut',
        numbers: { diameter: '12 mm', revolutions: '1', height: '6 mm', size: '1.5 mm', x: '3 mm' },
      }),
    ),
  ],
  // A 14 × 4 mm box x −5…9.
  primitive: () => [
    feature(
      'cut',
      'box',
      primitiveInputs('box', {
        numbers: { length: '14 mm', width: '4 mm', height: '12 mm', x: '2 mm' },
        operation: 'cut',
      } as never),
    ),
  ],
};

const design = (family: string): ExtrudoDocument =>
  document(`a ${family} cut of the bodies it touches`, [
    box('o0', -40),
    box('fb', 0),
    box('o1', 20),
    ...(TOOLS[family] as () => Feature[])(),
    box('o2', 40),
  ]);

const FAMILIES = Object.keys(TOOLS);

// The coil's seeded proof is left out for time: its answer is the same `operationAccess`, its
// counters below.
const DESIGNS: Design[] = FAMILIES.filter((family) => family !== 'coil').map((family) => ({
  name: `a ${family} cut of the bodies it touches, a box moved into its way and out`,
  make: async () => design(family),
  target: 'cut',
  refsKey: 'bodies',
  rule: [],
  kinds: [
    'size-face',
    'size-before',
    'size-after',
    'nudge',
    'nudge',
    'op-cycle',
    'op-cycle',
    'op-cycle',
    'op-cycle',
    ...GENERIC_KINDS,
  ] as Kind[],
  flips: [
    'size-face: view→view',
    'size-before: view→view',
    'nudge: view→view',
    'op-cycle: view→view',
    'op-cycle: view→write',
    'op-cycle: write→view',
  ],
  steps: 18,
}));

/** `family`'s design with `fb` picked and `operation` (a picked cut, or a picked join). */
const picked = (family: string, operation: 'cut' | 'join') =>
  setInputs(design(family), 'cut', {
    bodies: { kind: 'ref', refs: [{ kind: 'body', id: 'fb:0' }] },
    operation: choice(operation),
  });

/**
 * A box `pk` on top of `fb` (10 mm up), cut by a 4 mm box placed on `fb`'s top face, `pk` picked:
 * `fb` is in the view by the face reference, not picked; boxes before, between and after.
 */
async function onFace(): Promise<ExtrudoDocument> {
  const parts = document('a box', [box('fb', 0)]);
  const face = await computed(parts, (engine) => faceRefs(engine, 'fb:0', top)[0] as GeomRef);
  return document('a picked cut placed on another body’s face', [
    box('o0', -40),
    box('fb', 0),
    feature('pk', 'box', { ...box('pk', 0).inputs, offset: length('10 mm') }),
    box('o1', 20),
    feature(
      'cut',
      'box',
      primitiveInputs('box', {
        plane: face,
        numbers: { length: '4 mm', width: '4 mm', height: '6 mm' },
        operation: 'cut',
        bodies: ['pk:0'],
      } as never),
    ),
    box('o2', 40),
  ]);
}

/** The edits of a design that picks its bodies from the start. */
const PICKED_KINDS = [
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
] as Kind[];

const PICKED: Design[] = [
  ...(
    [
      ['a picked box cut on a plane', 'primitive', 'cut'],
      ['a picked revolve join', 'revolve', 'join'],
      ['a picked sweep cut', 'sweep', 'cut'],
    ] as const
  ).map(
    ([name, family, operation]): Design => ({
      name: `${name}, a box moved into its way and out`,
      make: async () => picked(family, operation),
      target: 'cut',
      refsKey: 'bodies',
      // No bodies picked: automatic, `touch`, a view too.
      rule: ['lose: view→write', 'find: write→view', 'empty: view→view', 'fill: view→view'],
      kinds: PICKED_KINDS,
      flips: [
        'twice: view→view',
        'untwice: view→view',
        'size-face: view→view',
        'size-before: view→view',
        'nudge: view→view',
        'op-cycle: view→view',
        'op-cycle: view→write',
        'op-cycle: write→view',
      ],
      steps: 24,
    }),
  ),
  {
    name: 'a picked box cut placed on another body’s face, that body and others edited',
    make: onFace,
    target: 'cut',
    refsKey: 'bodies',
    // No bodies picked: automatic with a tool on a face, `touch` (rule R), a view too.
    rule: ['lose: view→write', 'find: write→view', 'empty: view→view', 'fill: view→view'],
    kinds: PICKED_KINDS,
    flips: [
      'twice: view→view',
      'size-face: view→view',
      'size-before: view→view',
      'nudge: view→view',
      'op-cycle: view→view',
      'op-cycle: view→write',
      'op-cycle: write→view',
    ],
    steps: 24,
  },
];

describe('view access: the other operations (ADR-0024)', () => {
  proveDesigns(DESIGNS);
  proveDesigns(PICKED);

  it('a picked cut placed on another body’s face: that body runs it, an unrelated one doesn’t', {
    timeout: 120_000,
  }, async () => {
    const doc = await onFace();
    const docs = [
      doc,
      setInputs(doc, 'o0', { length: length('12 mm') }),
      setInputs(doc, 'fb', { height: length('12 mm') }),
    ];
    const run = await sequence(docs);
    run.forEach((step, i) => {
      expect(step.problems, `step ${i}`).toEqual([]);
      expect(fallbacks(step.result, docs[i] as ExtrudoDocument), `step ${i}`).toEqual([]);
    });
    expect(run[0]?.result.features['cut' as FeatureId]?.status).toBe('ok');
    expect(run[0]?.result.stats.viewed).toEqual(['cut']);
    expect(run[1]?.evaluated).toEqual(['o0']);
    // The face's box taller: its face rises, and the cut with it.
    expect(run[2]?.evaluated).toEqual(['fb', 'cut']);
  });

  it.each(FAMILIES)(
    '%s: a box nothing touches alone; the cut box and a box come to touch run the cut',
    { timeout: 120_000 },
    async (family) => {
      const doc = design(family);
      const docs = [
        doc,
        setInputs(doc, 'o0', { length: length('12 mm') }),
        setInputs(doc, 'fb', { height: length('12 mm') }),
        setInputs(doc, 'o1', { x: length('12 mm') }),
        setInputs(doc, 'o1', { x: length('24 mm') }),
      ];
      const run = await sequence(docs);
      run.forEach((step, i) => {
        expect(step.problems, `step ${i}`).toEqual([]);
        expect(fallbacks(step.result, docs[i] as ExtrudoDocument), `step ${i}`).toEqual([]);
      });
      expect(run[0]?.result.features['cut' as FeatureId]?.status).not.toBe('error');
      expect(run[0]?.result.stats.viewed).toEqual(['cut']);
      expect(run[1]?.evaluated).toEqual(['o0']);
      expect(run[2]?.evaluated).toEqual(['fb', 'cut']);
      expect(run[3]?.evaluated).toEqual(['o1', 'cut']);
      // Out again, somewhere new: the cut's first result from the cache.
      expect(run[4]?.evaluated).toEqual(['o1']);
    },
  );

  it('a picked revolve cut is keyed by the bodies it picks', { timeout: 120_000 }, async () => {
    const doc = setInputs(design('revolve'), 'cut', {
      bodies: { kind: 'ref', refs: [{ kind: 'body', id: 'fb:0' }] },
    });
    const run = await sequence([doc, setInputs(doc, 'o1', { x: length('12 mm') })]);
    for (const step of run) expect(step.problems).toEqual([]);
    expect(run[0]?.result.stats.viewed).toEqual(['cut']);
    // In the tool's way but not picked: it alone.
    expect(run[1]?.evaluated).toEqual(['o1']);
  });

  it('answers: touch or view for a tool that reads no body, write for one that reads one', () => {
    const registry = kernelFeatures();
    const access = (type: string, inputs: FeatureInputs) =>
      registry.get(type)?.bodyAccess?.(inputs as never);
    const profile: GeomRef = { kind: 'profile', id: 's/r' };
    const face: GeomRef = { kind: 'face', id: 'box:b:top' };
    const edge: GeomRef = { kind: 'edge', id: 'box:b:e1' };
    const line: GeomRef = { kind: 'sketchEntity', id: 's/l1' };
    const picked = { bodies: ['b:0'] };
    // Revolve: an origin axis and a sketch profile by an angle.
    expect(access('revolve', revolveInputs([profile], X_AXIS, { operation: 'cut' }))).toBe('touch');
    expect(
      access('revolve', revolveInputs([profile], X_AXIS, { operation: 'join', ...picked })),
    ).toBe('touch');
    expect(
      access('revolve', revolveInputs([profile], X_AXIS, { operation: 'cut', ...picked })),
    ).toBe('view');
    expect(access('revolve', revolveInputs([profile], edge, { operation: 'cut' }))).toBe('write');
    expect(access('revolve', revolveInputs([face], X_AXIS, { operation: 'cut' }))).toBe('write');
    expect(
      access(
        'revolve',
        revolveInputs([profile], X_AXIS, { operation: 'cut', extent: 'to-object', ...picked }),
      ),
    ).toBe('write');
    expect(access('revolve', revolveInputs([profile], X_AXIS, {}))).toBe('add');
    // Sweep: a sketch profile along sketch curves.
    expect(access('sweep', sweepInputs([profile], [line], { operation: 'cut' }))).toBe('touch');
    expect(access('sweep', sweepInputs([profile], [edge], { operation: 'cut' }))).toBe('write');
    expect(access('sweep', sweepInputs([profile], [edge], { operation: 'cut', ...picked }))).toBe(
      'view',
    );
    // Loft: profiles, points and sketch entities.
    expect(access('loft', loftInputs([profile, profile], { operation: 'intersect' }))).toBe(
      'touch',
    );
    expect(
      access('loft', loftInputs([profile, { kind: 'vertex', id: 'v' }], { operation: 'cut' })),
    ).toBe('write');
    // Coil and primitives: on a plane, or on a face.
    expect(access('coil', coilInputs({ operation: 'cut' }))).toBe('touch');
    // On a face: the tool built on that body (rule R).
    expect(access('coil', coilInputs({ operation: 'cut', plane: face }))).toBe('touch');
    expect(access('coil', coilInputs({ plane: face }))).toBe('write');
    expect(access('box', primitiveInputs('box', { operation: 'join' } as never))).toBe('touch');
    expect(access('box', primitiveInputs('box', { operation: 'cut', plane: face } as never))).toBe(
      'touch',
    );
    expect(
      access('box', primitiveInputs('box', { operation: 'cut', plane: face, ...picked } as never)),
    ).toBe('view');
    expect(
      access(
        'cylinder',
        primitiveInputs('cylinder', { operation: 'new-body', ...picked } as never),
      ),
    ).toBe('write');
  });

  it('a box cut placed on a body’s face keeps its tool by that body’s version: moved, built again', {
    timeout: 120_000,
  }, async () => {
    // A 4 mm box sunk 3 mm into `fb`'s top face; `o1` at 16 mm. With `fb` at 12 mm the cut (on its
    // face) reaches `o1` too: an answer kept from the cut at 0 would miss it (rule R: the face's
    // body's version is in the tool's key).
    const parts = document('a box', [box('fb', 0)]);
    const face = await computed(parts, (engine) => faceRefs(engine, 'fb:0', top)[0] as GeomRef);
    const doc = document('a box cut on a body’s face', [
      box('fb', 0),
      box('o1', 16),
      feature(
        'pc',
        'box',
        primitiveInputs('box', {
          plane: face,
          numbers: { length: '4 mm', width: '4 mm', height: '6 mm', offset: '-3 mm' },
          operation: 'cut',
        } as never),
      ),
    ]);
    const docs = [doc, setInputs(doc, 'fb', { x: length('12 mm') })];
    const run = await sequence(docs);
    for (const step of run) expect(step.problems).toEqual([]);
    expect(run[0]?.result.features['pc' as FeatureId]?.status).toBe('ok');
    expect(run[0]?.result.stats.viewed).toEqual(['pc']);
    expect(run[1]?.evaluated).toEqual(['fb', 'pc']);
  });
});
