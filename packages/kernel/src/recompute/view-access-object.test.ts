// Extrudes up to an object keyed by the bodies they read (ADR-0024's amendment on up to an
// object): `touch` up to a face, a vertex or a plane, the object by its body's version (rule R);
// up to a curved face the target is sized by the box round every body, asked as six reaches along
// the axes (rule B). Up to a body stays `write`. Boxes `o0` before (far off, moved and grown to
// change that box), `fb` (cut), `o1` between (`nudge` moves it into the slot's way), `o2` after; the
// slot sketched on XY. Real OCCT and manifold, strict leaks, no clock.
import {
  type AttachmentId,
  type ExtrudeInputOptions,
  extrudeInputs,
  type Feature,
  type FeatureId,
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
import { reachAlong } from '../features/operation';
import {
  bytesOf,
  type Done,
  fallbacks,
  GENERIC_KINDS,
  length,
  setInputs,
} from './add-access-test-support';
import type { ImportedFile } from './types';
import {
  BASE,
  box,
  computed,
  type Design,
  faceRefs,
  feature,
  type Kind,
  proveDesigns,
  provedSteps,
  sequence,
  statusOf,
  topOf,
  useKernel,
} from './view-access-features-test-support';
import { document, slot } from './view-access-test-support';

useKernel();

/** A sketch of `rect` on XY and `id` extruding it up to an object. */
function toObject(
  id: string,
  [x0, y0, x1, y1]: [number, number, number, number],
  options: ExtrudeInputOptions,
): Feature[] {
  const b = new SketchBuilder();
  b.line(x0, y0, x1, y0);
  b.line(x1, y0, x1, y1);
  b.line(x1, y1, x0, y1);
  b.line(x0, y1, x0, y0);
  const [region] = detectProfiles(b.sketch);
  const sketch = `sk-${id}`;
  return [
    feature(sketch, 'sketch', sketchInputs(originPlaneRef('origin:xy'), b.sketch)),
    feature(
      id,
      'extrude',
      extrudeInputs(
        [{ kind: 'profile', id: profileRefId(sketch as FeatureId, region?.id ?? '') }],
        {
          extent: 'to-object',
          distance: '4 mm',
          operation: 'cut',
          ...options,
        },
      ),
    ),
  ];
}

/** A 30 mm sphere `sp` centred 30 mm over the origin (it covers the slot), and its one face. */
const sphere = () =>
  feature(
    'sp',
    'sphere',
    primitiveInputs('sphere', { numbers: { diameter: '30 mm', offset: '30 mm' } }),
  );
async function sphereFace(): Promise<GeomRef> {
  return computed(
    document('a sphere', [sphere()]),
    (engine) => faceRefs(engine, 'sp:0', () => [0])[0] as GeomRef,
  );
}

/** `o0`, `fb`, `o1`, `more`, a 16 × 2 mm slot `cut` up to `object` (`options`), `o2`. */
function slotted(object: GeomRef, more: Feature[] = [], options: ExtrudeInputOptions = {}) {
  return document('a cut up to an object', [
    box('o0', -40),
    box('fb', 0),
    box('o1', 20),
    ...more,
    ...toObject('cut', [-8, -1, 8, 1], { toObject: object, ...options }),
    box('o2', 40),
  ]);
}

/** Up to `fb`'s top face: flat, the exact distance; the object is a body the tool cuts. */
const toTop = async () => slotted(await topOf());
/**
 * Up to the sphere, 1 mm short of it: a curved face, the target sized by the box round every
 * body; the object is a body the tool doesn't touch.
 */
const toSphere = async (options: ExtrudeInputOptions = {}) =>
  slotted(await sphereFace(), [sphere()], { offset: '-1 mm', ...options });

const touching = (run: Awaited<ReturnType<typeof provedSteps>>, i: number) =>
  (run[i]?.result.reports['cut' as FeatureId] as { touching: string[] } | undefined)?.touching;

const KINDS = [
  ...BASE,
  'size-face',
  'size-before',
  'size-between',
  'nudge',
  'nudge',
  'tall',
  'tall',
  'op-cycle',
  'op-cycle',
  'op-cycle',
  'op-cycle',
  ...GENERIC_KINDS,
] as Kind[];

const DESIGNS: Design[] = [
  {
    name: 'a cut up to a box’s top face, the boxes edited',
    make: toTop,
    target: 'cut',
    refsKey: 'toObject',
    // No object or one no body has: the extrude's error, every body.
    rule: ['lose: view→write', 'find: write→view', 'empty: view→write', 'fill: write→view'],
    kinds: KINDS,
    flips: [
      'size-face: view→view',
      'size-before: view→view',
      'nudge: view→view',
      'op-cycle: view→write',
      'op-cycle: write→view',
    ],
    steps: 30,
  },
  {
    name: 'a cut of a picked box up to its top face, a box it doesn’t pick moved into its way',
    make: async () => slotted(await topOf(), [], { bodies: ['fb:0'] }),
    target: 'cut',
    refsKey: 'bodies',
    // No bodies picked: a cut of what it touches, `touch`, a view too.
    rule: ['lose: view→write', 'find: write→view', 'empty: view→view', 'fill: view→view'],
    kinds: KINDS,
    flips: [
      'size-face: view→view',
      'nudge: view→view',
      'op-cycle: view→view',
      'op-cycle: view→write',
      'op-cycle: write→view',
    ],
    steps: 30,
  },
  {
    name: 'a cut up to a sphere, the box round every body changed',
    make: () => toSphere(),
    target: 'cut',
    refsKey: 'toObject',
    rule: ['lose: view→write', 'find: write→view', 'empty: view→write', 'fill: write→view'],
    kinds: KINDS,
    flips: [
      'size-before: view→view',
      'tall: view→view',
      'nudge: view→view',
      'op-cycle: view→write',
      'op-cycle: write→view',
    ],
    steps: 30,
  },
];

describe('view access: up to an object (ADR-0024)', () => {
  proveDesigns(DESIGNS);

  it('up to a sphere: the box round every body grown each way and back runs it; inside, kept', {
    timeout: 120_000,
  }, async () => {
    const doc = await toSphere();
    const edits: [string, Record<string, ReturnType<typeof length>>][] = [
      ['o0', { x: length('-60 mm') }],
      ['o0', { height: length('60 mm') }],
      ['o0', { y: length('30 mm') }],
      ['o2', { x: length('60 mm') }],
    ];
    const docs = [doc];
    for (const [id, inputs] of edits) docs.push(setInputs(doc, id, inputs), doc);
    // Inside the box: `o1` 12 mm wide keeps every side of it.
    docs.push(setInputs(doc, 'o1', { width: length('12 mm') }));
    const run = await provedSteps(docs);
    expect(statusOf(run, 0, 'cut')).toBe('ok');
    expect(run[0]?.result.stats.viewed).toEqual(['cut']);
    expect(touching(run, 0)).toEqual(['fb:0']);
    // `o0` grown each way: the target's size changes, the cut runs; back: from the cache.
    for (const i of [1, 3, 5]) expect(run[i]?.evaluated, `step ${i}`).toEqual(['o0', 'cut']);
    for (const i of [2, 4, 6, 8]) expect(run[i]?.evaluated, `step ${i}`).toEqual([]);
    // `o2` comes after the cut: nothing it reads.
    expect(run[7]?.evaluated).toEqual(['o2']);
    expect(run[9]?.evaluated).toEqual(['o1']);
  });

  it('the object’s body changed, replaced by a same-ID move, suppressed and back; a related name', {
    timeout: 120_000,
  }, async () => {
    const doc = await toTop();
    const at = doc.features.findIndex((f) => f.id === 'sk-cut');
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
      insert(feature('mv', 'move', moveInputs(['fb:0'], { dz: '1 mm' }))),
      gone,
      doc,
      split,
    ]);
    expect(run[0]?.result.stats.viewed).toEqual(['cut']);
    expect(touching(run, 0)).toEqual(['fb:0']);
    expect(run[1]?.evaluated).toEqual(['fb', 'cut']);
    expect(run[2]?.evaluated).toEqual(['mv', 'cut']);
    expect(statusOf(run, 3, 'cut')).toBe('error');
    expect(run[3]?.result.stats.viewed).not.toContain('cut');
    expect(run[4]?.evaluated).toEqual([]);
    expect(run[5]?.result.stats.viewed).not.toContain('cut');
  });

  it('up to a sphere: the sphere moved runs it; a box the tool cuts; a box comes and goes', {
    timeout: 120_000,
  }, async () => {
    const doc = await toSphere();
    const run = await provedSteps([
      doc,
      setInputs(doc, 'sp', { offset: length('32 mm') }),
      setInputs(doc, 'fb', { width: length('12 mm') }),
      setInputs(doc, 'o1', { x: length('12 mm') }),
      doc,
    ]);
    expect(run[1]?.evaluated).toEqual(['sp', 'cut']);
    expect(run[2]?.evaluated).toEqual(['fb', 'cut']);
    expect(run[3]?.evaluated).toEqual(['o1', 'cut']);
    expect(touching(run, 3)).toEqual(['fb:0', 'o1:0']);
    // Back where it was (moving it further would widen the box round every body): the cache.
    expect(run[4]?.evaluated).toEqual([]);
  });

  it('a mesh body among the bodies: in the box round them, cut as a cleared engine cuts it', {
    timeout: 120_000,
  }, async () => {
    const STL = 'att-stl' as AttachmentId;
    const files = new Map<AttachmentId, ImportedFile>([
      [STL, { bytes: bytesOf(cubeStl), mediaType: 'model/stl', fileName: 'cube.stl' }],
    ]);
    const doc = await toSphere();
    const at = doc.features.findIndex((f) => f.id === 'sp');
    const features = [...doc.features];
    features.splice(at, 0, feature('imp', 'import', importInputs({ file: STL })));
    const mesh = { ...doc, features, timelineMarker: features.length };
    const run = await provedSteps(
      [
        mesh,
        setInputs(mesh, 'o2', { length: length('12 mm') }),
        setInputs(mesh, 'o0', { height: length('60 mm') }),
      ],
      { options: { files: (id: AttachmentId) => files.get(id) } },
    );
    expect(statusOf(run, 0, 'cut')).not.toBe('error');
    expect(touching(run, 0)).toContain('imp:0');
    expect(run[1]?.evaluated).toEqual(['o2']);
    expect(run[2]?.evaluated).toEqual(['o0', 'cut']);
  });

  it('a picked cut up to a face: its view; a box in its way it doesn’t pick runs alone', {
    timeout: 120_000,
  }, async () => {
    const doc = slotted(await topOf(), [], { bodies: ['fb:0'] });
    const run = await provedSteps([
      doc,
      setInputs(doc, 'o1', { x: length('12 mm') }),
      setInputs(doc, 'o0', { height: length('60 mm') }),
      setInputs(doc, 'fb', { height: length('12 mm') }),
    ]);
    expect(run[0]?.result.stats.viewed).toEqual(['cut']);
    expect(run[1]?.evaluated).toEqual(['o1']);
    expect(run[2]?.evaluated).toEqual(['o0']);
    expect(run[3]?.evaluated).toEqual(['fb', 'cut']);
  });

  it('a picked cut up to a sphere: a view can’t give every body’s box, so it runs as write', {
    timeout: 120_000,
  }, async () => {
    // The target's size needs the box round every body: in its view `everyBodyBox` reads `size`,
    // the view notices it, and the cut runs as `write` (one fall-back per new view key, as a
    // cleared engine's).
    const doc = await toSphere({ bodies: ['fb:0'] });
    const docs = [doc, setInputs(doc, 'o0', { height: length('60 mm') }), doc];
    const run = await sequence(docs);
    for (const step of run) expect(step.problems).toEqual([]);
    expect(run[0]?.result.features['cut' as FeatureId]?.status).toBe('ok');
    expect(fallbacks(run[0]?.result as Done, doc)).toEqual(['cut']);
    expect(run[0]?.result.stats.viewed).not.toContain('cut');
  });

  it('a picked join up to a face: touch, the picked box joined, another box touched', {
    timeout: 120_000,
  }, async () => {
    const doc = slotted(await topOf(), [], { bodies: ['fb:0'], operation: 'join' });
    const run = await provedSteps([
      doc,
      setInputs(doc, 'o1', { x: length('12 mm') }),
      setInputs(doc, 'o0', { height: length('60 mm') }),
    ]);
    expect(statusOf(run, 0, 'cut')).not.toBe('error');
    expect(run[0]?.result.stats.viewed).toEqual(['cut']);
    expect(run[1]?.evaluated).toEqual(['o1', 'cut']);
    expect(touching(run, 1)).toEqual(['fb:0', 'o1:0']);
    expect(run[2]?.evaluated).toEqual(['o0']);
  });

  it('the reach is unclamped: boxes wholly behind give their extent, so the box round them is exact', () => {
    // Along -x from the origin, boxes at x 5 to 9 reach -5: the box round them starts at x 5, as
    // every box's minimum gives it. Clamped at 0 it would start at the origin.
    const boxes = [
      { min: [5, 1, 2], max: [6, 3, 4] },
      { min: [7, -1, 0], max: [9, 2, 3] },
    ];
    // `+ 0` makes a -0 a 0: the box's minimum comes back as -(-0) where a box starts at 0, which
    // only enters the target's size through a subtraction.
    const far = (along: number[]) => (reachAlong(boxes, [0, 0, 0], along) as number) + 0;
    expect([-far([-1, 0, 0]) + 0, far([1, 0, 0])]).toEqual([5, 9]);
    expect([-far([0, -1, 0]) + 0, far([0, 1, 0])]).toEqual([-1, 3]);
    expect([-far([0, 0, -1]) + 0, far([0, 0, 1])]).toEqual([0, 4]);
    expect(reachAlong([], [0, 0, 0], [1, 0, 0])).toBeUndefined();
  });

  it('answers: touch up to a face, a vertex or a plane, write up to a body or with none', () => {
    const extrude = kernelFeatures().get('extrude');
    const access = (more: ExtrudeInputOptions) =>
      extrude?.bodyAccess?.(
        extrudeInputs([{ kind: 'profile', id: 'sk/r' } as never], {
          distance: '2 mm',
          extent: 'to-object',
          ...more,
        }) as never,
      );
    const face: GeomRef = { kind: 'face', id: 'f[top]' };
    expect(access({ operation: 'cut', toObject: face })).toBe('touch');
    expect(access({ operation: 'join', toObject: { kind: 'vertex', id: 'v' } })).toBe('touch');
    expect(access({ operation: 'cut', toObject: { kind: 'plane', id: 'pl' } })).toBe('touch');
    expect(access({ operation: 'cut', toObject: { kind: 'body', id: 'b:0' } })).toBe('write');
    expect(access({ operation: 'cut', toObject: face, bodies: ['b:0'] })).toBe('view');
    expect(access({ operation: 'intersect', toObject: face, bodies: ['b:0'] })).toBe('view');
    expect(access({ operation: 'join', toObject: face, bodies: ['b:0'] })).toBe('touch');
    expect(
      access({ operation: 'cut', toObject: { kind: 'body', id: 'b:1' }, bodies: ['b:0'] }),
    ).toBe('write');
    expect(access({ operation: 'cut' })).toBe('write');
    expect(access({ toObject: face })).toBe('write');
  });
});
