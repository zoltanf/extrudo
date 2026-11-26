// `view` body access for the thread (ADR-0024's amendment on `view` access): the seeded proof and
// the counters of `view-access-features-test-support.ts` on designs with it in multi-body chains.
// A thin box outside the threads' views overlaps the first stud where its thread is cut, so a cut
// that searched the bodies it touches would cut it too, under `write` but not with a view; and a
// stud thinner than the thread is built up to it first (the fill). Short, coarse threads: what
// the tests look at doesn't depend on their size. Real OCCT and manifold, strict leaks, no clock.
import { primitiveInputs, threadInputs } from '@extrudo/core';
import { describe, expect, it } from 'vitest';
import { GENERIC_KINDS, length } from './add-access-test-support';
import {
  BASE,
  countEdits,
  type Design,
  feature,
  type Kind,
  proveDesigns,
  sequence,
  useKernel,
} from './view-access-features-test-support';
import { document, plate } from './view-access-test-support';

useKernel();

const stud = (i: number, diameter = '8 mm') =>
  feature(
    `c${i}`,
    'cylinder',
    primitiveInputs('cylinder', {
      numbers: { diameter, height: '10 mm', x: `${i * 30} mm`, y: '-40 mm' },
    }),
  );

const studThread = (i: number) =>
  feature(
    `th${i}`,
    'thread',
    threadInputs({
      faces: [{ kind: 'face', id: `cylinder:c${i}:side:wall` }],
      numbers: { diameter: '8 mm', pitch: '2 mm', length: '3 mm' },
      extent: 'length',
    }),
  );

/** A 1 mm box through the first stud's axis, its whole height: no thread's participant. */
const crossing = feature(
  'xb',
  'box',
  primitiveInputs('box', {
    numbers: { length: '1 mm', width: '20 mm', height: '10 mm', x: '0 mm', y: '-40 mm' },
  }),
);

/**
 * Two studs threaded part of their length (the second Ø6.5, built up to the thread first), a
 * plate between them, and the box through the first stud.
 */
function threads() {
  const features = [
    stud(0),
    crossing,
    studThread(0),
    ...plate(5, 0, '4 mm'),
    stud(1, '6.5 mm'),
    studThread(1),
  ];
  return document('studs with threads', features);
}

const DESIGNS: Design[] = [
  {
    name: 'studs with threads (one built up), a box through one, a plate between',
    make: async () => threads(),
    kinds: [...BASE, 'hand', 'extent', ...GENERIC_KINDS] as Kind[],
    flips: ['hand: view→view', 'extent: view→view'],
    steps: 20,
  },
];

describe('view access: the thread (ADR-0024)', () => {
  proveDesigns(DESIGNS);
  countEdits([
    [
      'thread',
      async () => threads(),
      // The first stud: the second one's thread warns that it was built up.
      'c0',
      { height: length('12 mm') },
      'th0',
      { length: length('4 mm') },
    ],
  ]);

  it('the box the first stud’s thread reaches is no participant; the thin stud is built up', {
    timeout: 300_000,
  }, async () => {
    const [step] = await sequence([threads()]);
    expect(step?.problems).toEqual([]);
    expect(step?.result.stats.viewed).toEqual(['th0', 'th1']);
    // The box stays a box: six faces, so the cut didn't reach it.
    const box = step?.result.bodies.find((b) => b.id === 'xb:0');
    expect(box?.mesh?.faceIds?.length).toBe(6);
    // The fill's note: the shaft built up to the thread.
    const status = step?.result.features['th1' as never];
    expect(status?.status).toBe('warning');
    expect(status && 'message' in status ? status.message : '').toMatch(/built up to it/);
  });
});
