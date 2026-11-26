// `view` body access for Scale (ADR-0024's amendment on `view` access): the seeded proof and the
// counters of `view-access-features-test-support.ts` on boxes scaled in place (a copy runs as
// `write`): one about its own centre, one about a corner of another box (that box comes into its
// view by the vertex). A box outside every scale's view overlaps the first box. Real OCCT and
// manifold, strict leaks, no clock.
import { scaleInputs } from '@extrudo/core';
import { describe } from 'vitest';
import { GENERIC_KINDS, length } from './add-access-test-support';
import {
  BASE,
  box,
  computed,
  countEdits,
  type Design,
  feature,
  type Kind,
  proveDesigns,
  useKernel,
  vertexRef,
} from './view-access-features-test-support';
import { document } from './view-access-test-support';

useKernel();

/** Boxes, each scaled: about its centre, and about the next box's corner. */
async function scales() {
  const base = document('boxes scaled', [
    box('b0', 0),
    box('z0', 0, 4),
    box('b1', 30),
    box('b2', 60),
  ]);
  const corner = await computed(base, (engine) => vertexRef(engine, 'b2:0', 0));
  const features = [
    ...base.features.slice(0, 2),
    feature('sc0', 'scale', scaleInputs(['b0:0'], { factor: '1.2' })),
    ...base.features.slice(2),
    feature('sc1', 'scale', scaleInputs(['b1:0'], { factor: '0.8', point: corner })),
  ];
  return { ...base, features, timelineMarker: features.length };
}

const DESIGNS: Design[] = [
  {
    name: 'boxes scaled about their centre and about another box’s corner',
    make: scales,
    refsKey: 'bodies',
    kinds: [...BASE, 'copy', 'copy', 'twice', ...GENERIC_KINDS] as Kind[],
    flips: ['copy: view→write', 'copy: write→view', 'twice: view→view'],
    steps: 20,
  },
];

describe('view access: Scale (ADR-0024)', () => {
  proveDesigns(DESIGNS);
  countEdits([
    [
      'scale',
      scales,
      'b0',
      { length: length('12 mm') },
      'sc0',
      { factor: { kind: 'expr', expr: '1.3', unit: 'unitless' } },
    ],
  ]);
});
