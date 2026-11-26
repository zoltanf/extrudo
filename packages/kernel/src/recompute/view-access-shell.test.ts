// `view` body access for the shell (ADR-0024's amendment on `view` access): the seeded proof and
// the counters of `view-access-features-test-support.ts` on designs with it in multi-body chains.
// Real OCCT and manifold, strict leaks, no clock.
import { shellInputs } from '@extrudo/core';
import { describe } from 'vitest';
import { length } from './add-access-test-support';
import {
  AFTER,
  BASE,
  build,
  countEdits,
  type Design,
  down,
  faces,
  feature,
  filletAfter,
  proveDesigns,
  side,
  top,
  useKernel,
} from './view-access-features-test-support';
import { document, platesOf, slot, twin } from './view-access-test-support';

useKernel();

/**
 * Four plates, each hollowed from its top face; one with a wall set of its own thickness, one
 * hollowed closed (a body reference), one after a fillet; a slot cut through all of them after.
 */
async function shells() {
  let doc = document('plates with shells', platesOf(4));
  doc = await filletAfter(doc, 'fi2', 'ex2', 'ex2:0', '2 mm');
  doc = await build(doc, [
    {
      // After the second plate, so it can pick that plate's body to hollow too (`pick-body`).
      id: 'sh0',
      after: 'ex1',
      make: (refs) => feature('sh0', 'shell', shellInputs(refs('ex0:0', top), '0.8 mm')),
    },
    {
      id: 'sh1',
      after: 'ex1',
      make: (refs) =>
        feature(
          'sh1',
          'shell',
          shellInputs(refs('ex1:0', top), '0.8 mm', {
            walls: [{ faces: refs('ex1:0', faces(side)).slice(0, 1), thickness: '1.2 mm' }],
          }),
        ),
    },
    {
      id: 'sh2',
      after: 'fi2',
      // Its bottom face: the top one runs into the fillet, which a shell can't open.
      make: (refs) => feature('sh2', 'shell', shellInputs(refs('ex2:0', faces(down)), '0.8 mm')),
    },
    {
      id: 'sh3',
      after: 'ex3',
      make: () => feature('sh3', 'shell', shellInputs([], '0.8 mm', { bodies: ['ex3:0'] })),
    },
  ]);
  const features = [...doc.features, ...slot('cut', [-10, 18, 300, 22])];
  return { ...doc, features, timelineMarker: features.length };
}

/** Two twin boxes (the same names) and a shell of a top face named on both: `closest` decides. */
function twinShells() {
  const doc = document('twin bodies and a shell named on both', [
    twin('ta', '0 mm'),
    twin('tb', '30 mm'),
    ...platesOf(1),
  ]);
  return build(doc, [
    {
      id: 'st',
      after: 'tb',
      make: (refs) => feature('st', 'shell', shellInputs(refs('ta:0', top), '1 mm')),
    },
  ]);
}

const DESIGNS: Design[] = [
  {
    name: 'plates with shells (a wall set, a closed one, one after a fillet, a cut after)',
    make: shells,
    target: 'sh0',
    kinds: [...BASE, 'pick-body', 'unpick-body', 'lose-body', 'found-body', ...AFTER],
    flips: [
      'pick-body: view→view',
      'unpick-body: view→view',
      'lose-body: view→write',
      'found-body: write→view',
    ],
  },
  {
    name: 'twin bodies and a shell of a face named on both',
    make: twinShells,
    kinds: [...BASE, 'swap', 'twin-off', 'twin-on', ...AFTER],
    flips: ['swap: view→view', 'twin-off: view→view', 'twin-on: view→view'],
  },
];

describe('view access: the shell (ADR-0024)', () => {
  proveDesigns(DESIGNS);
  countEdits([
    ['shell', shells, 'ex1', { distance: length('9 mm') }, 'sh1', { thickness: length('1 mm') }],
  ]);
});
