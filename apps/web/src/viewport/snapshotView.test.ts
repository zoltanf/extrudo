import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { HOME_DIRECTION } from './camera';
import { sectionPlane, snapshotDirection } from './snapshotView';

describe('snapshot views (#88)', () => {
  it('looks from the named side, or along a direction given', () => {
    expect(snapshotDirection('iso')).toEqual(HOME_DIRECTION);
    expect(snapshotDirection('top')).toEqual([0, 0, 1]);
    expect(snapshotDirection('bottom')).toEqual([0, 0, -1]);
    expect(snapshotDirection('front')).toEqual([0, -1, 0]);
    expect(snapshotDirection('back')).toEqual([0, 1, 0]);
    expect(snapshotDirection('left')).toEqual([-1, 0, 0]);
    expect(snapshotDirection('right')).toEqual([1, 0, 0]);
    expect(snapshotDirection([1, 2, 3])).toEqual([1, 2, 3]);
  });

  it('keeps what lies below a section at z = 10, cutting away what is above', () => {
    const plane = sectionPlane({ origin: [0, 0, 10], normal: [0, 0, 2] });
    expect(plane.distanceToPoint(new Vector3(5, 5, 0))).toBeGreaterThan(0);
    expect(plane.distanceToPoint(new Vector3(5, 5, 20))).toBeLessThan(0);
    expect(plane.distanceToPoint(new Vector3(0, 0, 10))).toBeCloseTo(0);
  });
});
