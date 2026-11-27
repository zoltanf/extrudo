// The hole keyed by what it reads (ADR-0024's amendment on the hole): `touch`, its face by that
// body's version (rule R), a through hole's length by `ctx.reach` (rule B), the bodies it cuts by
// the touch test; its count of holes that reach no body over the bodies the tool touches, the same
// as over every body while the holes don't overlap (overlapping holes hand over no touch answers:
// keyed by every body). Boxes `o0` before (far off: `tall` makes it 30 mm high), `fb` (the hole's),
// `o1` between (`nudge` moves it under a hole that misses), `o2` after. Real OCCT and manifold,
// strict leaks, no clock.
import {
  type AttachmentId,
  type ExtrudoDocument,
  type Feature,
  type FeatureId,
  type GeomRef,
  type HoleInputOptions,
  holeInputs,
  importInputs,
  moveInputs,
  originPlaneRef,
  sketchInputs,
} from '@extrudo/core';
import { SketchBuilder } from '@extrudo/sketch/fixtures';
import { describe, expect, it } from 'vitest';
import cubeStl from '../../../../fixtures/imports/cube.stl?url&inline';
import { kernelFeatures } from '../features';
import { bytesOf, fallbacks, GENERIC_KINDS, length, setInputs } from './add-access-test-support';
import type { ImportedFile } from './types';
import {
  BASE,
  box,
  computed,
  type Design,
  down,
  faceRefs,
  faces,
  feature,
  type Kind,
  proveDesigns,
  provedSteps,
  statusOf,
  topOf,
  useKernel,
} from './view-access-features-test-support';
import { document, slot } from './view-access-test-support';

useKernel();

/** Every number a type switch needs: a 4 mm hole 4 mm deep, a 7 mm counterbore or countersink. */
const NUMBERS = {
  diameter: '4 mm',
  depth: '4 mm',
  cbDiameter: '7 mm',
  cbDepth: '2 mm',
  csDiameter: '7 mm',
};

/** `fb`'s bottom face, from an engine that computed it. */
async function bottomOf(): Promise<GeomRef> {
  return computed(
    document('a box', [box('fb', 0)]),
    (engine) => faceRefs(engine, 'fb:0', faces(down))[0] as GeomRef,
  );
}

/** `o0`, `fb`, `o1`, the hole `hl` (`options`), `o2`; `more` before the hole. */
function drilled(options: HoleInputOptions, more: Feature[] = []): ExtrudoDocument {
  return document('a hole', [
    box('o0', -40),
    box('fb', 0),
    box('o1', 20),
    ...more,
    feature('hl', 'hole', holeInputs({ numbers: NUMBERS, ...options })),
    box('o2', 40),
  ]);
}

/** A hole into `fb`'s top face at its middle (the face's frame starts at the world origin). */
const blind = async () => drilled({ plane: await topOf() });
/** A hole through all up from `fb`'s bottom face: its length comes from every box above. */
const through = async () => drilled({ plane: await bottomOf(), extent: 'through' });

/**
 * Three holes on `fb`'s top face at sketch points x = 0 (in `fb`), 12 (in nothing: `o1` at 20 is
 * 15 to 25 mm; `nudge` moves it to 12, under the hole) and 60 (in nothing).
 */
async function several(xs = [0, 12, 60]): Promise<ExtrudoDocument> {
  const b = new SketchBuilder();
  const ids = xs.map((x) => b.point(x, 0));
  return drilled(
    {
      plane: await topOf(),
      points: ids.map((id): GeomRef => ({ kind: 'sketchEntity', id: `hp/${id}` })),
    },
    [feature('hp', 'sketch', sketchInputs(originPlaneRef('origin:xy'), b.sketch))],
  );
}

const warnings = (run: Awaited<ReturnType<typeof provedSteps>>, i: number) =>
  run[i]?.result.features['hl' as FeatureId]?.message;

const HOLE_KINDS = [
  'hole-type',
  'hole-type',
  'hole-type',
  'hole-size',
  'hole-size',
  'hole-depth',
  'hole-depth',
  'hole-extent',
  'hole-extent',
] as Kind[];

const DESIGNS: Design[] = [
  {
    name: 'a blind hole on a box’s face, the boxes and the hole edited',
    make: blind,
    target: 'hl',
    refsKey: 'plane',
    // No plane: the XY plane, under every box: the hole cuts nothing (its error, every body).
    rule: ['lose: view→write', 'find: write→view', 'empty: view→write', 'fill: write→view'],
    kinds: [
      ...BASE,
      'size-face',
      'size-face',
      'size-before',
      'size-between',
      'size-after',
      'nudge',
      'nudge',
      ...HOLE_KINDS,
      ...GENERIC_KINDS,
    ] as Kind[],
    flips: [
      'size-face: view→view',
      'size-before: view→view',
      'hole-type: view→view',
      'hole-size: view→view',
      'hole-depth: view→view',
      'hole-extent: view→view',
    ],
    steps: 30,
  },
  {
    name: 'a hole through all from a box’s bottom face, the far box taller',
    make: through,
    target: 'hl',
    refsKey: 'plane',
    rule: ['lose: view→write', 'find: write→view', 'empty: view→write', 'fill: write→view'],
    kinds: [
      ...BASE,
      'size-face',
      'size-before',
      'tall',
      'tall',
      ...HOLE_KINDS,
      ...GENERIC_KINDS,
    ] as Kind[],
    flips: ['size-face: view→view', 'tall: view→view', 'hole-type: view→view'],
    steps: 30,
  },
  {
    name: 'three holes at sketch points, two missing, a box moved under one and away',
    make: () => several(),
    target: 'hl',
    refsKey: 'points',
    // No points: one hole at the face's middle; a lost point: the hole's error.
    rule: ['lose: view→write', 'find: write→view', 'empty: view→view', 'fill: view→view'],
    kinds: [
      ...BASE,
      'size-face',
      'size-before',
      'nudge',
      'nudge',
      'hole-size',
      'hole-size',
      'hole-extent',
      'hole-extent',
      ...GENERIC_KINDS,
    ] as Kind[],
    flips: [
      'size-face: view→view',
      'nudge: view→view',
      'hole-size: view→view',
      'hole-extent: view→view',
    ],
    steps: 30,
  },
];

describe('view access: the hole (ADR-0024)', () => {
  proveDesigns(DESIGNS);

  it('the face’s box changed, replaced by a same-ID box, suppressed and back; a related name', {
    timeout: 120_000,
  }, async () => {
    const doc = await blind();
    const at = doc.features.findIndex((f) => f.id === 'hl');
    const insert = (...extra: Feature[]) => {
      const features = [...doc.features];
      features.splice(at, 0, ...extra);
      return { ...doc, features, timelineMarker: features.length };
    };
    const gone = {
      ...doc,
      features: doc.features.map((f) => (f.id === 'fb' ? { ...f, suppressed: true } : f)),
    };
    // A slot through `fb` splits its top face: found by a related name only.
    const split = insert(...slot('gr', [-1, -20, 1, 20]));
    const run = await provedSteps([
      doc,
      setInputs(doc, 'fb', { height: length('12 mm') }),
      insert(feature('mv', 'move', moveInputs(['fb:0'], { dx: '1 mm' }))),
      gone,
      doc,
      split,
    ]);
    expect(statusOf(run, 0, 'hl')).toBe('ok');
    expect(run[0]?.result.stats.viewed).toEqual(['hl']);
    expect(run[1]?.evaluated).toEqual(['fb', 'hl']);
    expect(run[2]?.evaluated).toEqual(['mv', 'hl']);
    expect(statusOf(run, 3, 'hl')).toBe('error');
    expect(run[3]?.result.stats.viewed).not.toContain('hl');
    expect(run[4]?.evaluated).toEqual([]);
    expect(run[5]?.result.stats.viewed).not.toContain('hl');
  });

  it('a box comes under a hole that missed: cut, the warning changes; gone again', {
    timeout: 120_000,
  }, async () => {
    const doc = await several();
    const run = await provedSteps([
      doc,
      setInputs(doc, 'o1', { x: length('12 mm') }),
      setInputs(doc, 'o1', { x: length('20 mm') }),
      setInputs(doc, 'o2', { length: length('12 mm') }),
    ]);
    expect(warnings(run, 0)).toContain('2 of 3 holes');
    expect(run[1]?.evaluated).toEqual(['o1', 'hl']);
    expect(warnings(run, 1)).toContain('1 of 3 holes');
    expect(
      (run[1]?.result.reports['hl' as FeatureId] as { touching: string[] } | undefined)?.touching,
    ).toEqual(['fb:0', 'o1:0']);
    // Back where it was: the first document, from the cache.
    expect(run[2]?.evaluated).toEqual([]);
    expect(warnings(run, 2)).toContain('2 of 3 holes');
    // After the hole: nothing it reads.
    expect(run[3]?.evaluated).toEqual(['o2']);
  });

  it('the cut box changed runs it; a box nothing reads, the hole’s own inputs', {
    timeout: 120_000,
  }, async () => {
    const doc = await blind();
    const run = await provedSteps([
      doc,
      setInputs(doc, 'o0', { length: length('12 mm') }),
      setInputs(doc, 'fb', { width: length('12 mm') }),
      setInputs(doc, 'hl', { depth: length('6 mm') }),
      setInputs(doc, 'hl', { diameter: length('5 mm') }),
      setInputs(doc, 'hl', { type: { kind: 'enum', value: 'counterbore' } }),
    ]);
    expect(run[1]?.evaluated).toEqual(['o0']);
    expect(run[2]?.evaluated).toEqual(['fb', 'hl']);
    for (const i of [3, 4, 5]) expect(run[i]?.evaluated, `step ${i}`).toEqual(['hl']);
  });

  it('through all: the far box taller changes the reach and back; wider, kept', {
    timeout: 120_000,
  }, async () => {
    const doc = await through();
    const tall = setInputs(doc, 'o0', { height: length('30 mm') });
    const run = await provedSteps([
      doc,
      tall,
      doc,
      setInputs(doc, 'o0', { width: length('14 mm') }),
    ]);
    expect(statusOf(run, 0, 'hl')).toBe('ok');
    expect(run[0]?.result.stats.viewed).toEqual(['hl']);
    expect(run[1]?.evaluated).toEqual(['o0', 'hl']);
    expect(run[2]?.evaluated).toEqual([]);
    expect(run[3]?.evaluated).toEqual(['o0']);
  });

  it('overlapping holes: no touch answers, keyed by every body as before', {
    timeout: 120_000,
  }, async () => {
    // Points 3 mm apart with 4 mm holes: one solid of the tool, so the count of holes that reach
    // no body isn't the touch test's. An edit of `o0`, which nothing reads, runs the hole.
    const doc = await several([0, 3, 60]);
    const run = await provedSteps([doc, setInputs(doc, 'o0', { length: length('12 mm') })]);
    expect(run[0]?.result.stats.viewed).not.toContain('hl');
    expect(run[1]?.evaluated).toEqual(['o0', 'hl']);
    expect(fallbacks(run[1]?.result as never, doc)).toEqual([]);
  });

  it('a mesh body under a hole: cut as a cleared engine cuts it', {
    timeout: 120_000,
  }, async () => {
    // The 20 mm cube from an STL (0 to 20 mm each way): the hole at x = 12 reaches it.
    const STL = 'att-stl' as AttachmentId;
    const files = new Map<AttachmentId, ImportedFile>([
      [STL, { bytes: bytesOf(cubeStl), mediaType: 'model/stl', fileName: 'cube.stl' }],
    ]);
    const base = await several();
    const at = base.features.findIndex((f) => f.id === 'hl');
    const features = [...base.features];
    features.splice(at, 0, feature('imp', 'import', importInputs({ file: STL })));
    const doc = { ...base, features, timelineMarker: features.length };
    const run = await provedSteps(
      [
        doc,
        setInputs(doc, 'o2', { length: length('12 mm') }),
        setInputs(doc, 'fb', { width: length('12 mm') }),
      ],
      { options: { files: (id: AttachmentId) => files.get(id) } },
    );
    expect(statusOf(run, 0, 'hl')).not.toBe('error');
    expect(
      (run[0]?.result.reports['hl' as FeatureId] as { touching: string[] } | undefined)?.touching,
    ).toContain('imp:0');
    expect(run[1]?.evaluated).toEqual(['o2']);
    expect(run[2]?.evaluated).toEqual(['fb', 'hl']);
  });

  it('answers: touch, on a face or a plane, blind or through', () => {
    const hole = kernelFeatures().get('hole');
    const face: GeomRef = { kind: 'face', id: 'box:b:top' };
    for (const options of [{}, { plane: face }, { plane: face, extent: 'through' as const }]) {
      expect(hole?.bodyAccess?.(holeInputs(options) as never)).toBe('touch');
    }
  });
});
