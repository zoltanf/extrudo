// New bodies in a `view` result (ADR-0024's amendment on new bodies): copies by Move, Scale and
// Mirror, instances of patterns of bodies (joined too), pieces by Split Body and by a Combine.
// Each goes where `write` puts it: a copy or an instance (a `set` of a new ID) at the end of the
// whole map, a piece `splitSolids` splits off right after its body, with bodies outside the view
// before, between and after. Where that can't be told without the bodies outside the view (a
// mesh's side Split Body made, of the view's last body, with a body outside the view after it),
// the feature runs as `write` for that walk. A cut through all of them after reads the order.
//
// Which features tell the placement rules apart (where the two places differ):
// - a new body at the end, not right after the view's last body: `sc`, `mic`, `mij`, `rp` (a body
//   outside the view comes after the copied box). `mc` and `cp` copy the last body there is, so
//   both places are the same for them;
// - a piece right after a view body that a later view body follows: `sp`'s piece of `b1`;
// - a piece of the view's last body right after it (its `origins` entry): `sp2`, `cb2`, `pa`. The
//   pieces of `b3` (`sp`) and of `a` (`cb`) are of the last body there is: the same either way;
// - the mesh fall-back: the mesh split.
// Real OCCT and manifold, strict leaks, no clock.
import {
  type AttachmentId,
  circularPatternInputs,
  combineInputs,
  type FeatureId,
  type GeomRef,
  importInputs,
  mirrorInputs,
  moveInputs,
  originPlaneRef,
  pathPatternInputs,
  primitiveInputs,
  rectangularPatternInputs,
  scaleInputs,
  splitBodyInputs,
} from '@extrudo/core';
import { describe, expect, it } from 'vitest';
import cubeStl from '../../../../fixtures/imports/cube.stl?url&inline';
import { kernelFeatures } from '../features';
import { bytesOf, fallbacks, GENERIC_KINDS, length, setInputs } from './add-access-test-support';
import type { ImportedFile } from './types';
import {
  BASE,
  box,
  type Design,
  feature,
  type Kind,
  proveDesigns,
  sequence,
  useKernel,
} from './view-access-features-test-support';
import { document, slot } from './view-access-test-support';

useKernel();

const X_AXIS: GeomRef = { kind: 'axis', id: 'origin:x' };
const Y_AXIS: GeomRef = { kind: 'axis', id: 'origin:y' };
const Z_AXIS: GeomRef = { kind: 'axis', id: 'origin:z' };
const XZ = originPlaneRef('origin:xz');
const STL = 'att-stl' as AttachmentId;

/** A box `l` × `w` × `h` mm centred at `x`, `y`. */
const block = (id: string, x: number, l: number, w = 10, h = 10, y = 0) =>
  feature(
    id,
    'box',
    primitiveInputs('box', {
      numbers: {
        length: `${l} mm`,
        width: `${w} mm`,
        height: `${h} mm`,
        x: `${x} mm`,
        y: `${y} mm`,
      },
    }),
  );

/** A slot cut through every box (`write`: it reads them all, in order). */
const cut = () => slot('cut', [-60, 3, 200, 4]);

/**
 * Boxes `o…` no feature names, before, between and after the ones it copies: a move copies two,
 * a scale and a mirror one each; a mirror with a join copies two, one fused into its box, the
 * other apart, over the box outside the view `o0` (the join takes only its own original).
 */
function copies(withCut = true) {
  return document('copies among bodies outside the view', [
    box('o0', -40),
    box('b0', 0),
    box('o1', 20),
    box('b1', 40),
    feature('mc', 'move', moveInputs(['b0:0', 'b1:0'], { dy: '30 mm', copy: true })),
    box('o2', 60),
    feature('sc', 'scale', scaleInputs(['b1:0'], { factor: '0.5', copy: true })),
    feature('mic', 'mirror', mirrorInputs(['b0:0'], originPlaneRef('origin:yz'), { copy: true })),
    feature(
      'mij',
      'mirror',
      mirrorInputs(['b0:0', 'b1:0'], originPlaneRef('origin:yz'), { copy: true, join: true }),
    ),
    ...(withCut ? cut() : []),
  ]);
}

/** A box patterned along X (over a box outside the view), another round Z, a box after both. */
function patterns() {
  return document('patterns of bodies among bodies outside the view', [
    box('b0', 0),
    box('o0', 20),
    feature(
      'rp',
      'rectangularPattern',
      rectangularPatternInputs({
        bodies: ['b0:0'],
        direction1: X_AXIS,
        count1: '3',
        distance1: '15 mm',
      }),
    ),
    box('b1', 60),
    feature(
      'cp',
      'circularPattern',
      circularPatternInputs({ bodies: ['b1:0'], axis: Z_AXIS, count: '3', angle: '360 deg' }),
    ),
    box('o1', 100),
    ...cut(),
  ]);
}

/**
 * Two boxes split through XZ, a box outside the view before and one between them: the first's
 * pieces go right after it, the last's (no body after it) at the end. Then a box split with a box
 * outside its view after it: its pieces right after it.
 */
function splits(withCut = true) {
  return document('splits among bodies outside the view', [
    box('o0', -30),
    box('b1', 0),
    box('o1', 20),
    box('b3', 40),
    feature('sp', 'splitBody', splitBodyInputs(['b1:0', 'b3:0'], XZ)),
    box('b5', 80),
    box('o2', 100),
    feature('sp2', 'splitBody', splitBodyInputs(['b5:0'], XZ)),
    ...(withCut ? cut() : []),
  ]);
}

/**
 * A long box cut in two by a wall box (a Combine cut that splits its target), a box outside the
 * view before; then the same with a box outside the view between the target and the tool.
 */
function combines() {
  return document('combine cuts that split their targets', [
    box('o0', -40),
    block('a', 0, 40),
    block('t', 0, 2, 20, 20),
    feature('cb', 'combine', combineInputs('a:0', ['t:0'], { operation: 'cut' })),
    block('a2', 80, 40),
    box('o3', 120),
    block('t2', 80, 2, 20, 20),
    feature('cb2', 'combine', combineInputs('a2:0', ['t2:0'], { operation: 'cut' })),
    ...cut(),
  ]);
}

/**
 * Patterns of bodies with a join: a box's three instances 10 mm apart, each touching the next,
 * fused into it (one body); another box's instance 20 mm off, apart from it, so the fuse makes two
 * solids, the instance a piece right after its box, before the box outside the view after it.
 */
function patternJoins(withCut = true) {
  return document('patterns of bodies joined', [
    box('b0', 0),
    box('o0', 20),
    feature(
      'pj',
      'rectangularPattern',
      rectangularPatternInputs({
        bodies: ['b0:0'],
        direction1: Y_AXIS,
        count1: '3',
        distance1: '10 mm',
        join: true,
      }),
    ),
    box('b1', 60),
    box('o1', 100),
    feature(
      'pa',
      'rectangularPattern',
      rectangularPatternInputs({
        bodies: ['b1:0'],
        direction1: Y_AXIS,
        count1: '2',
        distance1: '20 mm',
        join: true,
      }),
    ),
    ...(withCut ? cut() : []),
  ]);
}

const DESIGNS: Design[] = [
  {
    name: 'copies among bodies outside the view',
    make: async () => copies(),
    target: 'mc',
    refsKey: 'bodies',
    kinds: [...BASE, 'copy', 'copy', 'twice', 'untwice', ...GENERIC_KINDS] as Kind[],
    flips: ['copy: view→view', 'twice: view→view', 'untwice: view→view'],
    steps: 20,
  },
  {
    name: 'patterns of bodies among bodies outside the view',
    make: async () => patterns(),
    target: 'rp',
    refsKey: 'bodies',
    kinds: [...BASE, 'twice', 'untwice', ...GENERIC_KINDS] as Kind[],
    flips: ['twice: view→view', 'untwice: view→view'],
    steps: 20,
  },
  {
    name: 'splits among bodies outside the view',
    make: async () => splits(),
    target: 'sp',
    refsKey: 'bodies',
    kinds: [...BASE, 'twice', 'untwice', ...GENERIC_KINDS] as Kind[],
    flips: ['twice: view→view', 'untwice: view→view'],
    steps: 20,
  },
  {
    name: 'combine cuts that split their targets',
    make: async () => combines(),
    target: 'cb',
    refsKey: 'tools',
    rule: ['lose: view→write', 'find: write→view', 'empty: view→view', 'fill: view→view'],
    // The operation cycles cut, intersect, join and back to cut.
    kinds: [
      ...BASE,
      'combine-op',
      'combine-op',
      'combine-op',
      'twice',
      'untwice',
      ...GENERIC_KINDS,
    ] as Kind[],
    flips: ['combine-op: view→view', 'twice: view→view', 'untwice: view→view'],
    steps: 20,
  },
  {
    name: 'patterns of bodies joined',
    make: async () => patternJoins(),
    target: 'pa',
    refsKey: 'bodies',
    // The join off (instances as bodies of their own, at the end) and on again.
    kinds: [...BASE, 'join', 'join', 'twice', 'untwice', ...GENERIC_KINDS] as Kind[],
    flips: ['join: view→view', 'twice: view→view', 'untwice: view→view'],
    steps: 20,
  },
];

describe('view access: new bodies (ADR-0024)', () => {
  proveDesigns(DESIGNS);

  it.each([
    ['copies', copies, ['mc', 'sc', 'mic', 'mij'], []],
    ['patterns', patterns, ['rp', 'cp'], []],
    ['splits', splits, ['sp', 'sp2'], []],
    ['combine cuts', combines, ['cb', 'cb2'], []],
    ['pattern joins', patternJoins, ['pj', 'pa'], []],
  ] as const)(
    '%s: each new body where write puts it; a place that needs the bodies outside the view: write',
    { timeout: 120_000 },
    async (_name, make, viewed, written) => {
      const doc = make();
      const [step] = await sequence([doc]);
      // The same IDs in the same order, names and meshes as an all-`write` engine and a cleared one.
      expect(step?.problems).toEqual([]);
      expect(step?.result.stats.viewed).toEqual([...viewed]);
      // The ones that fall back try the view once, then run as `write`.
      expect(fallbacks(step?.result as NonNullable<typeof step>['result'], doc)).toEqual([
        ...written,
      ]);
      // The mirror's join warns that one copy stays apart, the second pattern's that its instance
      // is a body of its own.
      for (const id of [...viewed, ...written]) {
        expect(step?.result.features[id as FeatureId]?.status, id).toBe(
          id === 'mij' || id === 'pa' ? 'warning' : 'ok',
        );
      }
    },
  );

  it('the pieces of a middle body go right after it, a copy at the end, the pieces of the last after it', {
    timeout: 120_000,
  }, async () => {
    // Without the cut, which splits every box.
    const order = async (make: (withCut: boolean) => ReturnType<typeof copies>) => {
      const [step] = await sequence([make(false)]);
      return step?.result.bodies.map((b) => b.id);
    };
    // Each copy at the end of the map as it stands when the copy is made: the move's after `b1`
    // (the last body then, so the end and right after it are one place), the scale's of `b1` (a
    // body in the middle by then) after `o2`, the mirrors' of `b0` and `b1` after that.
    expect(await order(copies)).toEqual([
      'o0:0',
      'b0:0',
      'o1:0',
      'b1:0',
      'mc:0',
      'mc:1',
      'o2:0',
      'sc:0',
      'mic:0',
      'mij:0',
    ]);
    // `b1`'s piece right after it (before `o1`); `b3`'s at the end, which is right after it.
    // `b5`'s piece right after it too, before `o2` (a B-rep piece: `splitSolids` placed it).
    expect(await order(splits)).toEqual([
      'o0:0',
      'b1:0',
      'sp:0',
      'o1:0',
      'b3:0',
      'sp:1',
      'b5:0',
      'sp2:0',
      'o2:0',
    ]);
    // The joined instance apart from `b1` is a piece right after it, before `o1`.
    expect(await order(patternJoins)).toEqual(['b0:0', 'o0:0', 'b1:0', 'pa:0', 'o1:0']);
  });

  it('mirrors and patterns of features answer write; of bodies, view', () => {
    // A replayed tool cuts or joins whatever bodies it meets. (The engine gives no view to a
    // `feature` reference either.)
    const registry = kernelFeatures();
    const access = (type: string, inputs: object) =>
      registry.get(type)?.bodyAccess?.(inputs as never);
    const plane = originPlaneRef('origin:yz');
    const line: GeomRef = { kind: 'sketchEntity', id: 'sk:line' };
    const cases = [
      ['mirror', (features?: string[]) => mirrorInputs(['b0:0'], plane, { features })],
      [
        'rectangularPattern',
        (features?: string[]) =>
          rectangularPatternInputs({ bodies: ['b0:0'], features, direction1: X_AXIS }),
      ],
      [
        'circularPattern',
        (features?: string[]) =>
          circularPatternInputs({ bodies: ['b0:0'], features, axis: Z_AXIS }),
      ],
      [
        'pathPattern',
        (features?: string[]) => pathPatternInputs({ bodies: ['b0:0'], features, path: [line] }),
      ],
    ] as const;
    for (const [type, inputs] of cases) {
      expect(access(type, inputs()), type).toBe('view');
      expect(access(type, inputs(['cut'])), type).toBe('write');
    }
  });

  it('a mesh split by Split Body with a body outside the view after it: write, not remembered', {
    timeout: 120_000,
  }, async () => {
    // A mesh's second side gets a `set` (the end of the map) and an `origins` entry, as a piece
    // `splitSolids` places right after its body: with a body outside the view after the mesh the
    // two places differ, and the result can't tell which. That depends on the bodies outside the
    // view, so it is decided again at each walk: the box after the mesh gone, the split keeps its
    // view (and its versions are a cleared engine's); the box back, `write` again.
    const files = new Map<AttachmentId, ImportedFile>([
      [STL, { bytes: bytesOf(cubeStl), mediaType: 'model/stl', fileName: 'cube.stl' }],
    ]);
    const options = { options: { files: (id: AttachmentId) => files.get(id) } };
    const mesh = (after: boolean) =>
      document('a mesh split', [
        feature('imp', 'import', importInputs({ file: STL })),
        feature('xp', 'offsetPlane', {
          plane: { kind: 'ref', refs: [originPlaneRef('origin:yz')] },
          distance: length('10 mm'),
        }),
        ...(after ? [box('o0', 60)] : []),
        feature(
          'ms',
          'splitBody',
          splitBodyInputs(['imp:0'], { kind: 'plane', id: 'xp' } as GeomRef),
        ),
      ]);
    const docs = [mesh(true), mesh(false), mesh(true)];
    const steps = await sequence(docs, options);
    steps.forEach((step, i) => {
      const after = i !== 1;
      // Equal to a cleared engine, versions included, and to an all-`write` one.
      expect(step.problems, `step ${i}`).toEqual([]);
      expect(step.result.features['ms' as FeatureId]?.status).toBe('ok');
      expect(step.result.bodies.map((b) => b.id)).toEqual(
        after ? ['imp:0', 'o0:0', 'ms:0'] : ['imp:0', 'ms:0'],
      );
      expect(step.result.stats.viewed, `step ${i}`).toEqual(after ? [] : ['ms']);
    });
    // Tried as a view, then evaluated as `write`; then both from the cache.
    expect(
      fallbacks(steps[0]?.result as NonNullable<(typeof steps)[0]>['result'], docs[0] as never),
    ).toEqual(['ms']);
    expect(steps[1]?.evaluated).not.toContain('ms');
    expect(steps[2]?.evaluated).not.toContain('ms');
  });

  it('a body outside the view with the feature’s own ID prefix: write at once, the same result', {
    timeout: 120_000,
  }, async () => {
    // A box whose ID starts with the move's own (`mc:`). This shows the check fires; `mc:x` is
    // not an ID the move would pick, so it isn't a collision itself.
    const doc = copies();
    const features = [box('mc:x', -80), ...doc.features];
    const clash = { ...doc, features, timelineMarker: features.length };
    const steps = await sequence([clash, setInputs(clash, 'o0', { length: length('12 mm') })]);
    for (const step of steps) {
      expect(step.problems).toEqual([]);
      expect(step.result.stats.viewed).toEqual(['sc', 'mic', 'mij']);
      expect(fallbacks(step.result, clash)).toEqual([]);
    }
  });

  it('counters: an edit of a copied body runs its copies, not the bodies outside the view', {
    timeout: 120_000,
  }, async () => {
    const doc = copies();
    const steps = await sequence([
      doc,
      setInputs(doc, 'o1', { length: length('12 mm') }),
      doc,
      setInputs(doc, 'b0', { length: length('12 mm') }),
    ]);
    for (const step of steps) expect(step.problems).toEqual([]);
    // A box outside every view: it, and the cut that reads every body.
    expect(steps[1]?.evaluated).toEqual(['o1', 'cut']);
    // A copied box: it, the move that copies it with another, the mirrors of it, and the cut.
    expect(steps[3]?.evaluated).toEqual(['b0', 'mc', 'mic', 'mij', 'cut']);
  });
});
