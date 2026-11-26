// `view` body access for remove faces (ADR-0024's amendment on `view` access): the seeded proof and
// the counters of `view-access-features-test-support.ts` on designs with it in multi-body chains.
// Real OCCT and manifold, strict leaks, no clock.
import { removeFacesInputs } from '@extrudo/core';
import { describe } from 'vitest';
import { length } from './add-access-test-support';
import {
  AFTER,
  BASE,
  build,
  countEdits,
  type Design,
  faces,
  feature,
  proveDesigns,
  useKernel,
} from './view-access-features-test-support';
import { document, platesOf, slot } from './view-access-test-support';

useKernel();

/** Three plates, each with one of its holes filled (its wall removed); a slot cut after. */
async function removes() {
  const doc = await build(
    document('plates with a hole filled', platesOf(3)),
    [0, 1, 2].map((i) => ({
      id: `rf${i}`,
      after: `ex${i}`,
      make: (refs) =>
        feature(
          `rf${i}`,
          'removeFaces',
          removeFacesInputs(
            refs(
              `ex${i}:0`,
              faces((f) => f.type === 'cylinder'),
            ).slice(0, 1),
          ),
        ),
    })),
  );
  const features = [...doc.features, ...slot('cut', [-10, 8, 300, 12])];
  return { ...doc, features, timelineMarker: features.length };
}

const DESIGNS: Design[] = [
  {
    name: 'plates with a hole filled each, a cut after',
    make: removes,
    kinds: [...BASE, ...AFTER],
    flips: [],
  },
];

describe('view access: remove faces (ADR-0024)', () => {
  proveDesigns(DESIGNS);
  countEdits([['remove faces', removes, 'ex1', { distance: length('9 mm') }, 'rf1', undefined]]);
});
