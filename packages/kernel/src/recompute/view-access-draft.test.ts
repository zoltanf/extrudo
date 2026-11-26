// `view` body access for the draft (ADR-0024's amendment on `view` access): the seeded proof and
// the counters of `view-access-features-test-support.ts` on designs with it in multi-body chains.
// Real OCCT and manifold, strict leaks, no clock.
import {
  constructionRef,
  draftInputs,
  type FeatureId,
  type GeomRef,
  originPlaneRef,
} from '@extrudo/core';
import { describe, expect, it } from 'vitest';
import { length, setInputs } from './add-access-test-support';
import {
  AFTER,
  BASE,
  build,
  countEdits,
  type Design,
  faces,
  feature,
  proveDesigns,
  sequence,
  side,
  useKernel,
  withBottoms,
} from './view-access-features-test-support';
import { document, platesOf } from './view-access-test-support';

useKernel();

/** A construction plane 1 mm over XY, then three plates with their sides drafted about XY. */
function drafts() {
  const plane = feature('cp', 'offsetPlane', {
    plane: { kind: 'ref', refs: [originPlaneRef('origin:xy')] },
    distance: length('1 mm'),
  });
  const doc = document('plates with drafts', [plane, ...platesOf(3)]);
  return build(
    doc,
    [0, 1, 2].map((i) => ({
      id: `dr${i}`,
      after: `ex${i}`,
      make: (refs) =>
        feature(
          `dr${i}`,
          'draft',
          draftInputs(refs(`ex${i}:0`, faces(side)), originPlaneRef('origin:xy'), '3 deg'),
        ),
    })),
  );
}

const DESIGNS: Design[] = [
  {
    name: 'plates with drafts about XY, a construction plane or a face',
    make: async () => withBottoms(await drafts()),
    kinds: [...BASE, 'plane', 'plane', 'plane', 'flip', ...AFTER],
    flips: ['plane: view→view'],
  },
];

describe('view access: the draft (ADR-0024)', () => {
  proveDesigns(DESIGNS);
  countEdits([
    [
      'draft',
      drafts,
      'ex1',
      { distance: length('9 mm') },
      'dr1',
      { angle: { kind: 'expr', expr: '4 deg', unit: 'angle' } },
    ],
  ]);

  it('a draft keys a construction plane it turns about: an edit of the plane evaluates it', {
    timeout: 300_000,
  }, async () => {
    const doc = await drafts();
    const onPlane = setInputs(doc, 'dr0', {
      plane: {
        kind: 'ref',
        refs: [constructionRef({ id: 'cp' as FeatureId, type: 'offsetPlane' }) as GeomRef],
      },
    });
    const steps = await sequence([onPlane, setInputs(onPlane, 'cp', { distance: length('2 mm') })]);
    expect(steps[0]?.result.stats.viewed).toContain('dr0');
    expect(steps[1]?.evaluated).toEqual(['cp', 'dr0']);
    for (const step of steps) expect(step.problems).toEqual([]);
  });
});
