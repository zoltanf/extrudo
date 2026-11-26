// `view` body access for the thread (ADR-0024's amendment on `view` access): the seeded proof and
// the counters of `view-access-features-test-support.ts` on designs with it in multi-body chains.
// Real OCCT and manifold, strict leaks, no clock.
import { primitiveInputs, threadInputs } from '@extrudo/core';
import { describe } from 'vitest';
import { GENERIC_KINDS, length } from './add-access-test-support';
import {
  BASE,
  countEdits,
  type Design,
  feature,
  type Kind,
  proveDesigns,
  useKernel,
} from './view-access-features-test-support';
import { document, plate } from './view-access-test-support';

useKernel();

const stud = (i: number) =>
  feature(
    `c${i}`,
    'cylinder',
    primitiveInputs('cylinder', {
      numbers: { diameter: '8 mm', height: '10 mm', x: `${i * 30} mm`, y: '-40 mm' },
    }),
  );

const studThread = (i: number) =>
  feature(
    `th${i}`,
    'thread',
    threadInputs({
      faces: [{ kind: 'face', id: `cylinder:c${i}:side:wall` }],
      numbers: { diameter: '8 mm', pitch: '1.25 mm', length: '5 mm' },
      extent: 'length',
    }),
  );

/** Two studs, each threaded part of its length, a plate between them. */
function threads() {
  const features = [stud(0), studThread(0), ...plate(5, 0, '4 mm'), stud(1), studThread(1)];
  return document('studs with threads', features);
}

const DESIGNS: Design[] = [
  {
    name: 'studs with threads, a plate between',
    make: async () => threads(),
    kinds: [...BASE, 'hand', 'extent', ...GENERIC_KINDS] as Kind[],
    flips: ['hand: view→view', 'extent: view→view'],
  },
];

describe('view access: the thread (ADR-0024)', () => {
  proveDesigns(DESIGNS);
  countEdits([
    [
      'thread',
      async () => threads(),
      'c1',
      { height: length('12 mm') },
      'th1',
      { length: length('4 mm') },
    ],
  ]);
});
