import { describe, expect, it } from 'vitest';
import { boxMesh } from '../selection/testing';
import { volumeCentroid } from './bodyGeometry';

const round = (v: readonly number[]) => v.map((c) => Math.round(c * 1000) / 1000 + 0);

describe('volumeCentroid', () => {
  it('finds a box’s volume and middle', () => {
    const found = volumeCentroid(boxMesh());
    expect(found?.volume).toBeCloseTo(1000, 6);
    expect(round(found?.centroid ?? [])).toEqual([5, 5, 5]);
  });

  it('works for a box away from the origin, where the tetrahedra are signed', () => {
    const found = volumeCentroid(boxMesh([20, -10, 5], [30, 0, 15]));
    expect(found?.volume).toBeCloseTo(1000, 6);
    expect(round(found?.centroid ?? [])).toEqual([25, -5, 10]);
  });

  it('is nothing for a mesh with no volume', () => {
    const flat = boxMesh();
    expect(volumeCentroid({ ...flat, indices: new Uint32Array([0, 1, 2]) })).toBeUndefined();
    expect(volumeCentroid({ ...flat, indices: new Uint32Array(0) })).toBeUndefined();
  });
});
