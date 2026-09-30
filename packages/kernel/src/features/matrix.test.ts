import { describe, expect, it } from 'vitest';
import { apply, compose, determinant, IDENTITY, mirror, rotation, translation } from './matrix';

const close = (a: readonly number[], b: readonly number[]) => {
  a.forEach((v, i) => {
    expect(v).toBeCloseTo(b[i] as number, 9);
  });
};

describe('transform matrices', () => {
  it('translates', () => {
    close(apply(translation([1, 2, 3]), [10, 10, 10]), [11, 12, 13]);
  });

  it('turns right-handed about a line through a point', () => {
    // 90° about Z through the origin: X goes to Y.
    close(apply(rotation([0, 0, 0], [0, 0, 1], Math.PI / 2), [1, 0, 0]), [0, 1, 0]);
    // The same about a line through (10, 0, 0): (11, 0, 0) goes to (10, 1, 0); the line stays.
    const m = rotation([10, 0, 0], [0, 0, 2], Math.PI / 2);
    close(apply(m, [11, 0, 0]), [10, 1, 0]);
    close(apply(m, [10, 0, 5]), [10, 0, 5]);
    expect(determinant(m)).toBeCloseTo(1, 12);
  });

  it('mirrors in a plane through a point, with determinant -1', () => {
    const m = mirror([5, 0, 0], [2, 0, 0]);
    close(apply(m, [8, 3, 4]), [2, 3, 4]);
    close(apply(m, [5, 1, 1]), [5, 1, 1]);
    expect(determinant(m)).toBeCloseTo(-1, 12);
  });

  it('composes: the second argument acts first', () => {
    const m = compose(translation([10, 0, 0]), rotation([0, 0, 0], [0, 0, 1], Math.PI / 2));
    // (1, 0, 0) turns to (0, 1, 0), then moves to (10, 1, 0).
    close(apply(m, [1, 0, 0]), [10, 1, 0]);
    close(compose(IDENTITY, translation([1, 2, 3])), translation([1, 2, 3]));
  });
});
