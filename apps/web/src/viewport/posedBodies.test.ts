import type { BodyId } from '@extrudo/core';
import { rotation, translation } from '@extrudo/kernel/matrix';
import { describe, expect, it } from 'vitest';
import { boxMesh } from '../selection/testing';
import { posedBox, posedSummary } from './posedBodies';

const L = 'l:0' as BodyId;

describe('posedBox', () => {
  it('is the mesh box through the pose', () => {
    const box = posedBox(boxMesh([0, 0, 0], [10, 10, 10]), translation([1, 2, 3]));
    expect(box).toEqual({ min: [1, 2, 3], max: [11, 12, 13] });
  });
});

describe('posedSummary', () => {
  it('is absent with no pose and names the posed bodies otherwise', () => {
    const bodies = { [L]: boxMesh([0, 0, 0], [10, 10, 10]) };
    const meta = { [L]: { name: 'Leaf plate' } } as never;
    expect(posedSummary(bodies, meta, undefined)).toBeUndefined();
    expect(posedSummary(bodies, meta, { [L]: translation([0, 0, 5]) })).toBe(
      'Leaf_plate:0,0,5..10,10,15',
    );
    // A quarter turn about the Z axis through the origin: x in [-10, 0], y in [0, 10].
    expect(posedSummary(bodies, meta, { [L]: rotation([0, 0, 0], [0, 0, 1], Math.PI / 2) })).toBe(
      'Leaf_plate:-10,0,0..0,10,10',
    );
  });
});
