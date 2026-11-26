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
  computed,
  countEdits,
  type Design,
  down,
  faceRefs,
  faces,
  feature,
  proveDesigns,
  sequence,
  side,
  top,
  useKernel,
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
    name: 'plates with drafts about XY, a construction plane or another plate’s face',
    make: drafts,
    // The second plate's draft: the first plate's bottom face is outside its view until it is the
    // neutral plane.
    target: 'dr1',
    named: async (doc) => {
      const [face] = await computed(doc, (engine) => faceRefs(engine, 'ex0:0', faces(down)));
      if (!face) throw new Error('no bottom face on ex0:0');
      return { 'plane face': face };
    },
    kinds: [...BASE, 'plane', 'plane', 'plane', 'flip', ...AFTER],
    flips: ['plane: view→view'],
    steady: ['plane'],
  },
];

/**
 * The drafts, and a construction plane 1 mm over the first plate's top face (a feature that reads
 * that body, `read`) that the second plate's sides are drafted about.
 */
async function onFacePlane() {
  const doc = await drafts();
  const [face] = await computed(doc, (engine) => faceRefs(engine, 'ex0:0', top));
  const plane = feature('cpf', 'offsetPlane', {
    plane: { kind: 'ref', refs: [face as GeomRef] },
    distance: length('1 mm'),
  });
  const features = [...doc.features];
  features.splice(features.findIndex((f) => f.id === 'dr0') + 1, 0, plane);
  const drafted = { ...doc, features, timelineMarker: features.length };
  return setInputs(drafted, 'dr1', {
    plane: {
      kind: 'ref',
      refs: [constructionRef({ id: 'cpf' as FeatureId, type: 'offsetPlane' }) as GeomRef],
    },
  });
}

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

  it('a draft about a plane on another body’s face runs again when that body changes', {
    timeout: 300_000,
  }, async () => {
    // The plane reads the first plate (`read`), so its key moves with every body-writing feature
    // before it, and the draft's key holds the plane's: an edit of the first plate reaches it.
    const doc = await onFacePlane();
    const steps = await sequence([doc, setInputs(doc, 'ex0', { distance: length('9 mm') })]);
    expect(steps[0]?.result.stats.viewed).toEqual(['dr0', 'dr1', 'dr2']);
    expect(steps[0]?.result.features['dr1' as FeatureId]?.status).toBe('ok');
    expect(steps[1]?.evaluated).toEqual(['ex0', 'dr0', 'cpf', 'dr1']);
    for (const step of steps) expect(step.problems).toEqual([]);
  });
});
