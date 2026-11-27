// Operations keyed by the bodies they change (ADR-0024's amendment on operations): an extrude that
// cuts or intersects the bodies it picks answers `view`. Boxes no feature refers to before, between
// and after the picked ones, one of them in the tool's way (a cut that searched the bodies it
// touches would cut it under `write` but not with a view). The seeded proof of
// `view-access-features-test-support.ts` and exact counters. Real OCCT and manifold, strict leaks,
// no clock.
import type { ExtrudoDocument, GeomRef } from '@extrudo/core';
import { describe, expect, it } from 'vitest';
import { fallbacks, GENERIC_KINDS, length, setInputs } from './add-access-test-support';
import {
  BASE,
  box,
  type Design,
  type Kind,
  proveDesigns,
  sequence,
  useKernel,
} from './view-access-features-test-support';
import { document, slot } from './view-access-test-support';

useKernel();

const bodies = (...ids: string[]) => ({
  kind: 'ref' as const,
  refs: ids.map((id): GeomRef => ({ kind: 'body', id })),
});

/**
 * Boxes `o0`, `b1`, `o1`, `b2`, `o2` along X, and a 2 mm slot through all of them on XY cut out of
 * `b1` and `b2` only (each in two), `o1` in its way.
 */
function picked(): ExtrudoDocument {
  const doc = document('cuts of picked bodies', [
    box('o0', -40),
    box('b1', 0),
    box('o1', 20),
    box('b2', 40),
    ...slot('cx', [-50, -1, 50, 1]),
    box('o2', 80),
  ]);
  return setInputs(doc, 'cx', { bodies: bodies('b1:0', 'b2:0') });
}

const DESIGNS: Design[] = [
  {
    name: 'cuts of picked bodies, a box in the way it doesn’t pick',
    make: async () => picked(),
    target: 'cx',
    refsKey: 'bodies',
    kinds: [
      ...BASE,
      'twice',
      'untwice',
      'op-cycle',
      'op-cycle',
      'op-cycle',
      'op-cycle',
      'reach',
      'reach',
      ...GENERIC_KINDS,
    ] as Kind[],
    flips: [
      'twice: view→view',
      'untwice: view→view',
      'op-cycle: view→view',
      'op-cycle: view→write',
      'op-cycle: write→view',
      'reach: view→view',
    ],
    steps: 24,
  },
];

describe('view access: operations (ADR-0024)', () => {
  proveDesigns(DESIGNS);

  it('picked cut: a box it doesn’t pick runs alone; a picked box runs the cut', {
    timeout: 120_000,
  }, async () => {
    const doc = picked();
    const steps = await sequence([
      doc,
      setInputs(doc, 'o0', { length: length('12 mm') }),
      doc,
      setInputs(doc, 'o1', { height: length('12 mm') }),
      doc,
      setInputs(doc, 'b2', { height: length('12 mm') }),
    ]);
    for (const step of steps) {
      expect(step.problems).toEqual([]);
      expect(fallbacks(step.result, doc)).toEqual([]);
      expect(step.result.stats.viewed).toEqual(['cx']);
    }
    // Each picked box in two, its piece right after it; the box in the way whole.
    expect(steps[0]?.result.bodies.map((b) => b.id)).toEqual([
      'o0:0',
      'b1:0',
      'cx:0',
      'o1:0',
      'b2:0',
      'cx:1',
      'o2:0',
    ]);
    expect(steps[1]?.evaluated).toEqual(['o0']);
    expect(steps[3]?.evaluated).toEqual(['o1']);
    expect(steps[5]?.evaluated).toEqual(['b2', 'cx']);
  });
});
