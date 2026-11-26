// New bodies in a `view` result (ADR-0024's amendment on new bodies): copies by Move, Scale and
// Mirror, instances of patterns of bodies, pieces by Split Body and by a Combine cut. Each goes
// where `write` puts it: a copy or an instance (a `set` of a new ID) at the end of the whole map, a
// piece `splitSolids` splits off right after its body, with bodies outside the view before,
// between and after. Where that can't be told without the bodies outside the view (a piece of
// the view's last body, with a body outside the view after it), the feature runs as `write`. A cut
// through all of them after reads the order. Real OCCT and manifold, strict leaks, no clock.
import {
  circularPatternInputs,
  combineInputs,
  type FeatureId,
  type GeomRef,
  mirrorInputs,
  moveInputs,
  originPlaneRef,
  primitiveInputs,
  rectangularPatternInputs,
  scaleInputs,
  splitBodyInputs,
} from '@extrudo/core';
import { describe, expect, it } from 'vitest';
import { fallbacks, GENERIC_KINDS, length, setInputs } from './add-access-test-support';
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
const Z_AXIS: GeomRef = { kind: 'axis', id: 'origin:z' };
const XZ = originPlaneRef('origin:xz');

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
 * a scale and a mirror one each.
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
 * outside its view after it: its pieces' place can't be told, so it runs as `write`.
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
 * view before; then the same with a box outside the view after the target.
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
    // A reorder can put a box outside the view after the last box a split names.
    fallBackOk: ['sp', 'sp2'],
    steps: 20,
  },
  {
    name: 'combine cuts that split their targets',
    make: async () => combines(),
    target: 'cb',
    refsKey: 'tools',
    rule: ['lose: view→write', 'find: write→view', 'empty: view→view', 'fill: view→view'],
    kinds: [...BASE, 'twice', 'untwice', ...GENERIC_KINDS] as Kind[],
    flips: ['twice: view→view', 'untwice: view→view'],
    fallBackOk: ['cb', 'cb2'],
    steps: 20,
  },
];

describe('view access: new bodies (ADR-0024)', () => {
  proveDesigns(DESIGNS);

  it.each([
    ['copies', copies, ['mc', 'sc', 'mic'], []],
    ['patterns', patterns, ['rp', 'cp'], []],
    ['splits', splits, ['sp'], ['sp2']],
    ['combine cuts', combines, ['cb'], ['cb2']],
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
      for (const id of [...viewed, ...written]) {
        expect(step?.result.features[id as FeatureId]?.status, id).toBe('ok');
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
    // (the last body then), the scale's of `b1` (a body in the middle by then) after `o2`.
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
    ]);
    // `b1`'s piece right after it (before `o1`); `b3`'s at the end, which is right after it.
    const ids = await order(splits);
    expect(ids?.slice(0, 6)).toEqual(['o0:0', 'b1:0', 'sp:0', 'o1:0', 'b3:0', 'sp:1']);
  });

  it('a body outside the view with the feature’s own ID prefix: write at once, the same result', {
    timeout: 120_000,
  }, async () => {
    // A box whose ID starts with the move's own (`mc:`).
    const doc = copies();
    const features = [box('mc:x', -80), ...doc.features];
    const clash = { ...doc, features, timelineMarker: features.length };
    const steps = await sequence([clash, setInputs(clash, 'o0', { length: length('12 mm') })]);
    for (const step of steps) {
      expect(step.problems).toEqual([]);
      expect(step.result.stats.viewed).toEqual(['sc', 'mic']);
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
    // A copied box: it, the move that copies it with another, the mirror of it, and the cut.
    expect(steps[3]?.evaluated).toEqual(['b0', 'mc', 'mic', 'cut']);
  });
});
