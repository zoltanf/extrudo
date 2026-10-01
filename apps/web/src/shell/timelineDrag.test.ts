import type { FeatureId } from '@extrudo/core';
import { describe, expect, it } from 'vitest';
import { chipSelection, EDGE_PX, EDGE_SPEED, edgeScrollStep } from './timelineDrag';

describe('edgeScrollStep', () => {
  it('scrolls towards an end the pointer is near, faster the nearer, none in the middle', () => {
    expect(edgeScrollStep(500, 100, 900)).toBe(0);
    expect(edgeScrollStep(100 + EDGE_PX / 2, 100, 900)).toBe(-Math.ceil(EDGE_SPEED / 2));
    expect(edgeScrollStep(890, 100, 900)).toBeGreaterThan(0);
    // Past the end (the chip holds the pointer): full speed.
    expect(edgeScrollStep(40, 100, 900)).toBe(-EDGE_SPEED);
    expect(edgeScrollStep(1200, 100, 900)).toBe(EDGE_SPEED);
    // A list too short for two edges doesn't scroll.
    expect(edgeScrollStep(105, 100, 150)).toBe(0);
  });
});

describe('chipSelection', () => {
  const [a, b, c, d] = ['a', 'b', 'c', 'd'] as [FeatureId, FeatureId, FeatureId, FeatureId];
  const order = [a, b, c, d] as FeatureId[];
  it('selects one, toggles with Ctrl, extends a run with Shift, in timeline order', () => {
    expect(chipSelection(order, [a, b], c, 'replace', a)).toEqual([c]);
    expect(chipSelection(order, [c], a, 'toggle', c)).toEqual([a, c]);
    expect(chipSelection(order, [a, c], a, 'toggle', a)).toEqual([c]);
    expect(chipSelection(order, [b], d, 'range', b)).toEqual([b, c, d]);
    expect(chipSelection(order, [d], b, 'range', d)).toEqual([b, c, d]);
    // No anchor: just the chip.
    expect(chipSelection(order, [], c, 'range', undefined)).toEqual([c]);
  });
});
