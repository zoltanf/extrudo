// Tools built on a body (rule R, ADR-0024's amendment on tools built on a body): a `touch`
// feature whose tool is built on a face, edge or vertex a reference names keeps that tool, and its
// answers, by that body's version. The extrude of a box's top face: a cut of the box over it, and
// a boss joined to the box itself. Boxes before, between and after; one 12 mm off that a wider
// face would reach. Real OCCT and manifold, strict leaks, no clock.
import {
  type ExtrudoDocument,
  extrudeInputs,
  type FeatureId,
  type GeomRef,
  moveInputs,
  primitiveInputs,
} from '@extrudo/core';
import { describe, expect, it } from 'vitest';
import { fallbacks, GENERIC_KINDS, length, setInputs } from './add-access-test-support';
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
import { document, slot } from './view-access-test-support';

useKernel();

/** A `size` mm box centred at `x`, 10 mm high, `offset` mm up. */
const lifted = (id: string, x: number, size: number, offset: number) =>
  feature(
    id,
    'box',
    primitiveInputs('box', {
      numbers: {
        length: `${size} mm`,
        width: `${size} mm`,
        height: '10 mm',
        x: `${x} mm`,
        offset: `${offset} mm`,
      },
    }),
  );

/** `fb`'s top face, from an engine that computed it. */
async function topOf(): Promise<GeomRef> {
  return computed(
    document('a box', [box('fb', 0)]),
    (engine) => faceRefs(engine, 'fb:0', top)[0] as GeomRef,
  );
}

/**
 * Boxes `o0` before, `fb`, `ub` (6 mm, on top of `fb`), `o1` (on top too, 12 mm off), `o2`
 * after; `fp` extrudes `fb`'s top face 6 mm up: a cut (of `ub`; it meets `fb` at the face), or a
 * boss joined to `fb` (`join`).
 */
async function faceExtrude(operation: 'cut' | 'join' = 'cut'): Promise<ExtrudoDocument> {
  const face = await topOf();
  return document(`a ${operation} extruded from a box's face`, [
    box('o0', -40),
    box('fb', 0),
    lifted('ub', 0, 6, 10),
    lifted('o1', 12, 10, 10),
    feature(
      'fp',
      'extrude',
      extrudeInputs([{ kind: 'face', id: face.id } as never], { distance: '6 mm', operation }),
    ),
    box('o2', 40),
  ]);
}

/**
 * A 4 mm box cut placed on `fb`'s top face 2 mm up (it doesn't touch `fb`), 6 mm high, through
 * `ub` over `fb`; boxes before, between and after.
 */
async function faceBox(): Promise<ExtrudoDocument> {
  const face = await topOf();
  return document('a box cut placed on a box’s face, apart from it', [
    box('o0', -40),
    box('fb', 0),
    lifted('ub', 0, 6, 10),
    lifted('o1', 12, 10, 10),
    feature(
      'pc',
      'box',
      primitiveInputs('box', {
        plane: face,
        numbers: { length: '4 mm', width: '4 mm', height: '6 mm', offset: '2 mm' },
        operation: 'cut',
      } as never),
    ),
    box('o2', 40),
  ]);
}

const DESIGNS: Design[] = [
  {
    name: 'a cut extruded from a box’s face, the box and others edited',
    make: () => faceExtrude(),
    target: 'fp',
    refsKey: 'profiles',
    kinds: [
      ...BASE,
      'size-face',
      'size-face',
      'size-before',
      'op-cycle',
      'op-cycle',
      'op-cycle',
      'op-cycle',
      ...GENERIC_KINDS,
    ] as Kind[],
    flips: [
      'size-face: view→view',
      'size-before: view→view',
      'op-cycle: view→view',
      'op-cycle: view→write',
      'op-cycle: write→view',
    ],
    steps: 22,
  },
  {
    name: 'a box cut placed on a box’s face, apart from it, the box and others edited',
    make: faceBox,
    target: 'pc',
    refsKey: 'plane',
    // No plane: on XY, nothing built on a body: `touch` still.
    rule: ['lose: view→write', 'find: write→view', 'empty: view→view', 'fill: view→view'],
    kinds: [
      ...BASE,
      'size-face',
      'size-face',
      'size-before',
      'op-cycle',
      'op-cycle',
      'op-cycle',
      'op-cycle',
      ...GENERIC_KINDS,
    ] as Kind[],
    flips: [
      'size-face: view→view',
      'size-before: view→view',
      'op-cycle: view→view',
      'op-cycle: view→write',
      'op-cycle: write→view',
    ],
    steps: 22,
  },
];

/** Steps, each equal to a cleared engine (versions included) and to `write` keys, no fall-back. */
async function steps(docs: ExtrudoDocument[]) {
  const out = await sequence(docs);
  out.forEach((step, i) => {
    expect(step.problems, `step ${i}`).toEqual([]);
    expect(fallbacks(step.result, docs[i] as ExtrudoDocument), `step ${i}`).toEqual([]);
  });
  return out;
}

const status = (run: Awaited<ReturnType<typeof steps>>, i: number, id: string) =>
  run[i]?.result.features[id as FeatureId]?.status;

describe('view access: tools built on a body (ADR-0024)', () => {
  proveDesigns(DESIGNS);

  it('the face’s box wider: the tool is built again and reaches a box the old one didn’t', {
    timeout: 120_000,
  }, async () => {
    // At 16 mm `fb`'s face reaches `o1` (7…17 mm): an answer kept for `o1` from the 10 mm tool
    // would leave it uncut.
    const doc = await faceExtrude();
    const run = await steps([
      doc,
      setInputs(doc, 'o0', { length: length('12 mm') }),
      setInputs(doc, 'fb', { length: length('16 mm') }),
    ]);
    expect(run[0]?.result.stats.viewed).toEqual(['fp']);
    expect(status(run, 0, 'fp')).toBe('ok');
    expect(run[1]?.evaluated).toEqual(['o0']);
    expect(run[2]?.evaluated).toEqual(['fb', 'fp']);
    expect((run[2]?.result.reports['fp' as FeatureId] as { touching: string[] }).touching).toEqual([
      'fb:0',
      'ub:0',
      'o1:0',
    ]);
  });

  it('a boss from the face joined to its own box: that box edited runs it, another doesn’t', {
    timeout: 120_000,
  }, async () => {
    const doc = await faceExtrude('join');
    const run = await steps([
      doc,
      setInputs(doc, 'o2', { length: length('12 mm') }),
      setInputs(doc, 'fb', { height: length('12 mm') }),
    ]);
    expect(run[0]?.result.stats.viewed).toEqual(['fp']);
    expect(run[1]?.evaluated).toEqual(['o2']);
    expect(run[2]?.evaluated).toEqual(['fb', 'fp']);
  });

  it('the face’s box replaced by a moved box of the same ID: the tool built again', {
    timeout: 120_000,
  }, async () => {
    const doc = await faceExtrude();
    const at = doc.features.findIndex((f) => f.id === 'fp');
    const features = [...doc.features];
    features.splice(at, 0, feature('mv', 'move', moveInputs(['fb:0'], { dx: '3 mm' })));
    const moved = { ...doc, features, timelineMarker: features.length };
    const run = await steps([doc, moved]);
    expect(run[1]?.evaluated).toEqual(['mv', 'fp']);
    expect(run[1]?.result.stats.viewed).toContain('fp');
  });

  it('a box comes into the tool’s way and goes again', { timeout: 120_000 }, async () => {
    const doc = await faceExtrude();
    const run = await steps([
      doc,
      setInputs(doc, 'o1', { x: length('6 mm') }),
      setInputs(doc, 'o1', { x: length('30 mm') }),
    ]);
    expect(run[1]?.evaluated).toEqual(['o1', 'fp']);
    expect(run[2]?.evaluated).toEqual(['o1']);
  });

  it('the face’s box suppressed, and back; the face found only by a related name: today’s key', {
    timeout: 120_000,
  }, async () => {
    const doc = await faceExtrude();
    const gone = {
      ...doc,
      features: doc.features.map((f) => (f.id === 'fb' ? { ...f, suppressed: true } : f)),
    };
    // A slot through `fb` before the extrude splits its top face: found by a related name only.
    const at = doc.features.findIndex((f) => f.id === 'fp');
    const features = [...doc.features];
    features.splice(at, 0, ...slot('gr', [-1, -20, 1, 20]));
    const split = { ...doc, features, timelineMarker: features.length };
    const run = await steps([doc, gone, doc, split]);
    expect(status(run, 1, 'fp')).toBe('error');
    expect(run[1]?.result.stats.viewed).not.toContain('fp');
    expect(run[2]?.result.stats.viewed).toContain('fp');
    expect(run[3]?.result.stats.viewed).not.toContain('fp');
  });

  it('a box cut on a box’s face it doesn’t touch: the box taller moves the tool, another doesn’t', {
    timeout: 120_000,
  }, async () => {
    const doc = await faceBox();
    const run = await steps([
      doc,
      setInputs(doc, 'o0', { length: length('12 mm') }),
      setInputs(doc, 'fb', { height: length('12 mm') }),
    ]);
    expect(run[0]?.result.stats.viewed).toEqual(['pc']);
    // Built on `fb` but apart from it: its report names `ub` alone.
    expect((run[0]?.result.reports['pc' as FeatureId] as { touching: string[] }).touching).toEqual([
      'ub:0',
    ]);
    expect(run[1]?.evaluated).toEqual(['o0']);
    expect(run[2]?.evaluated).toEqual(['fb', 'pc']);
  });
});
