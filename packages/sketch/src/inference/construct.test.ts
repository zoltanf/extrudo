import type { Vec2 } from '@extrudo/core';
import { describe, expect, it } from 'vitest';
import {
  arcAround,
  arcPolyline,
  arcThrough,
  arcWithRadius,
  circleThrough,
  tangentArc,
} from './construct';

const close = (a: Vec2, b: Vec2) => {
  expect(a[0]).toBeCloseTo(b[0], 9);
  expect(a[1]).toBeCloseTo(b[1], 9);
};
const at = (arc: { center: Vec2; radius: number }, angle: number): Vec2 => [
  arc.center[0] + arc.radius * Math.cos(angle),
  arc.center[1] + arc.radius * Math.sin(angle),
];

describe('circleThrough', () => {
  it('finds the circumcircle', () => {
    const c = circleThrough([5, 0], [0, 5], [-5, 0]);
    close(c?.center ?? [NaN, NaN], [0, 0]);
    expect(c?.radius).toBeCloseTo(5, 9);
    const d = circleThrough([12, 3], [2, 13], [-8, 3]);
    close(d?.center ?? [NaN, NaN], [2, 3]);
  });

  it('gives nothing for collinear or repeated points', () => {
    expect(circleThrough([0, 0], [1, 1], [2, 2])).toBeUndefined();
    expect(circleThrough([1, 1], [1, 1], [1, 1])).toBeUndefined();
  });
});

describe('arcThrough', () => {
  it('stores a counter-clockwise pick as is', () => {
    const arc = arcThrough([5, 0], [0, 5], [-5, 0]);
    expect(arc?.reversed).toBe(false);
    expect(arc?.from).toBeCloseTo(0, 9);
    expect(arc?.sweep).toBeCloseTo(Math.PI, 9);
  });

  it('swaps the ends of a clockwise pick', () => {
    const arc = arcThrough([-5, 0], [0, 5], [5, 0]);
    if (!arc) throw new Error('no arc');
    expect(arc.reversed).toBe(true);
    // Stored counter-clockwise: from the last point (5, 0) over the top.
    close(at(arc, arc.from), [5, 0]);
    close(at(arc, arc.from + arc.sweep), [-5, 0]);
  });

  it('passes through the middle point on the long way round', () => {
    const arc = arcThrough([5, 0], [0, -5], [0, 5]);
    if (!arc) throw new Error('no arc');
    // Clockwise from (5,0) through the bottom to (0,5): 270°.
    expect(arc.reversed).toBe(true);
    expect(arc.sweep).toBeCloseTo((3 * Math.PI) / 2, 9);
  });
});

describe('arcWithRadius', () => {
  it('bulges toward the side point', () => {
    const up = arcWithRadius([-3, 0], [3, 0], 5, [0, 10]);
    if (!up) throw new Error('no arc');
    close(up.center, [0, -4]);
    expect(up.reversed).toBe(true);
    const down = arcWithRadius([-3, 0], [3, 0], 5, [0, -10]);
    close(down?.center ?? [NaN, NaN], [0, 4]);
    expect(down?.reversed).toBe(false);
  });

  it('refuses a radius shorter than half the chord', () => {
    expect(arcWithRadius([-3, 0], [3, 0], 2, [0, 1])).toBeUndefined();
  });
});

describe('tangentArc', () => {
  it('leaves the start along the direction', () => {
    const left = tangentArc([0, 0], [1, 0], [1, 1]);
    if (!left) throw new Error('no arc');
    close(left.center, [0, 1]);
    expect(left.reversed).toBe(false);
    const right = tangentArc([0, 0], [2, 0], [1, -1]);
    close(right?.center ?? [NaN, NaN], [0, -1]);
    expect(right?.reversed).toBe(true);
  });

  it('turns back into a semicircle when the end is beside the start', () => {
    const arc = tangentArc([0, 0], [0, 1], [-4, 0]);
    close(arc?.center ?? [NaN, NaN], [-2, 0]);
    expect(arc?.sweep).toBeCloseTo(Math.PI, 9);
  });

  it('gives nothing when the end lies on the tangent line', () => {
    expect(tangentArc([0, 0], [1, 0], [5, 0])).toBeUndefined();
    expect(tangentArc([0, 0], [1, 0], [-5, 0])).toBeUndefined();
  });
});

describe('arcAround and arcPolyline', () => {
  it('samples an arc from its start to its end', () => {
    const arc = arcAround([0, 0], [2, 0], [0, 2], true);
    const points = arcPolyline(arc, 16);
    expect(points).toHaveLength(5);
    close(points[0] as Vec2, [2, 0]);
    close(points[4] as Vec2, [0, 2]);
  });
});
