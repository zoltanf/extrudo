// `view` body access for Combine (ADR-0024's amendment on `view` access): the seeded proof and the
// counters of `view-access-features-test-support.ts` on boxes joined, cut and intersected with
// tool boxes. Beside each target, a box that overlaps it but is no tool: a combine that took the
// bodies it touches would take it under `write` but not with a view. Real OCCT and manifold,
// strict leaks, no clock.
import { combineInputs } from '@extrudo/core';
import { describe } from 'vitest';
import { GENERIC_KINDS, length } from './add-access-test-support';
import {
  BASE,
  box,
  countEdits,
  type Design,
  feature,
  type Kind,
  proveDesigns,
  useKernel,
} from './view-access-features-test-support';
import { document } from './view-access-test-support';

useKernel();

/** Three targets, each with a tool over one corner and a bystander over another. */
function combines() {
  const features = [];
  for (const [i, operation] of (['join', 'cut', 'intersect'] as const).entries()) {
    const x = i * 40;
    features.push(
      box(`a${i}`, x),
      box(`t${i}`, x + 6, 6),
      box(`z${i}`, x - 6, -6),
      feature(`cb${i}`, 'combine', combineInputs(`a${i}:0`, [`t${i}:0`], { operation })),
    );
  }
  return document('targets combined with tools, bystanders beside them', features);
}

const DESIGNS: Design[] = [
  {
    name: 'boxes joined, cut and intersected with tools, bystanders beside them',
    make: async () => combines(),
    refsKey: 'tools',
    // With no tools the target is still named: the view stays (and both fail the same way).
    rule: ['lose: view→write', 'find: write→view', 'empty: view→view', 'fill: view→view'],
    kinds: [
      ...BASE,
      'combine-op',
      'combine-op',
      'combine-op',
      'keep-tools',
      'keep-tools',
      'twice',
      ...GENERIC_KINDS,
    ] as Kind[],
    flips: ['combine-op: view→view', 'keep-tools: view→view', 'twice: view→view'],
    steps: 20,
  },
];

describe('view access: Combine (ADR-0024)', () => {
  proveDesigns(DESIGNS);
  countEdits([
    ['combine', async () => combines(), 'a1', { length: length('12 mm') }, 'cb1', undefined],
  ]);
});
