// `view` body access for offset faces (ADR-0024's amendment on `view` access): the seeded proof and
// the counters of `view-access-features-test-support.ts` on designs with it in multi-body chains.
// Real OCCT and manifold, strict leaks, no clock.
import { offsetFaceInputs } from '@extrudo/core';
import { describe } from 'vitest';
import { length } from './add-access-test-support';
import {
  AFTER,
  BASE,
  build,
  countEdits,
  type Design,
  feature,
  filletAfter,
  proveDesigns,
  top,
  useKernel,
} from './view-access-features-test-support';
import { document, platesOf } from './view-access-test-support';

useKernel();

/** Three plates with their top faces offset; the middle one's top edges filleted first. */
async function offsets() {
  let doc = document('plates with offset faces', platesOf(3));
  doc = await filletAfter(doc, 'fi1', 'ex1', 'ex1:0');
  return build(
    doc,
    [0, 1, 2].map((i) => ({
      id: `of${i}`,
      after: i === 1 ? 'fi1' : `ex${i}`,
      make: (refs) =>
        feature(`of${i}`, 'offsetFace', offsetFaceInputs(refs(`ex${i}:0`, top), '0.5 mm')),
    })),
  );
}

const DESIGNS: Design[] = [
  {
    name: 'plates with offset faces, one next to a fillet',
    make: offsets,
    kinds: [...BASE, 'keep', ...AFTER],
    flips: ['keep: view→view'],
  },
];

describe('view access: offset faces (ADR-0024)', () => {
  proveDesigns(DESIGNS);
  countEdits([
    [
      'offset faces',
      offsets,
      'ex2',
      { distance: length('9 mm') },
      'of2',
      { distance: length('0.7 mm') },
    ],
  ]);
});
