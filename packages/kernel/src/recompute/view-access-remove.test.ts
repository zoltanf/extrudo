// `view` body access for Remove (ADR-0024's amendment on `view` access): the seeded proof and the
// counters of `view-access-features-test-support.ts` on boxes, some removed. A box no Remove names
// overlaps the second removed box (and another one a kept box): a Remove that also took the bodies
// touching the ones it names would take it under `write` but not with a view. Real OCCT and manifold, strict leaks, no clock.
import { type BodyId, type FeatureId, removeBodiesFeatureOf } from '@extrudo/core';
import { describe } from 'vitest';
import { GENERIC_KINDS, length } from './add-access-test-support';
import {
  box,
  countEdits,
  type Design,
  type Kind,
  proveDesigns,
  useKernel,
} from './view-access-features-test-support';
import { document } from './view-access-test-support';

useKernel();

const remove = (id: string, bodies: string[]) =>
  removeBodiesFeatureOf(id as FeatureId, `Remove ${id}`, bodies as BodyId[]);

/**
 * Three boxes, two more taken out by a Remove each, a box through the first kept box and one
 * through the second removed box.
 */
function removes() {
  return document('boxes with some removed', [
    box('b0', 0),
    box('z0', 0, 4),
    box('r0', 20),
    remove('rm0', ['r0:0']),
    box('b1', 40),
    box('r1', 60),
    box('z1', 60, 4),
    remove('rm1', ['r1:0']),
    box('b2', 80),
  ]);
}

const DESIGNS: Design[] = [
  {
    name: 'boxes with some removed, a box through a removed one and one through a kept one',
    make: async () => removes(),
    refsKey: 'bodies',
    // No `empty`/`fill`: Remove's inputs refuse an empty list before any body access is asked.
    rule: ['lose: view→write', 'find: write→view'],
    kinds: ['lose', 'find', 'twice', 'untwice', ...GENERIC_KINDS] as Kind[],
    flips: ['twice: view→view', 'untwice: view→view'],
    steps: 20,
  },
];

describe('view access: Remove (ADR-0024)', () => {
  proveDesigns(DESIGNS);
  // The removed box's size: the box and its Remove run again, and no mesh is sent (it is gone).
  countEdits([
    ['remove', async () => removes(), 'r1', { length: length('12 mm') }, 'rm1', undefined, []],
  ]);
});
