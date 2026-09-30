// Where pattern instances go (P3-07, ADR-0047): pure maths, no OCCT.
import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../kernel';
import { apply, determinant, turnTo } from './matrix';
import {
  circularPlacements,
  limitInstances,
  pathPlacements,
  rectangularPlacements,
  wholeCount,
} from './pattern-layout';
import { pathOf } from './pattern-path';

const X = { origin: [0, 0, 0], direction: [1, 0, 0] } as const;
const Y = { origin: [0, 0, 0], direction: [0, 1, 0] } as const;
const Z = { origin: [0, 0, 0], direction: [0, 0, 1] } as const;

const near = (a: Vec3, b: Vec3, digits = 6) => {
  for (let k = 0; k < 3; k++) expect(a[k]).toBeCloseTo(b[k] as number, digits);
};

describe('rectangular placements', () => {
  it('leaves the original out and moves by whole steps', () => {
    const list = rectangularPlacements({ line: X, count: 3, step: 25, symmetric: false });
    expect(list.map((p) => p.label)).toEqual(['1', '2']);
    expect(list.map((p) => apply(p.matrix, [0, 0, 0])[0])).toEqual([25, 50]);
  });

  it('a symmetric row has instances on both sides', () => {
    const list = rectangularPlacements({ line: X, count: 4, step: 10, symmetric: true });
    expect(list.map((p) => p.label)).toEqual(['m1', '1', '2']);
    expect(list.map((p) => apply(p.matrix, [0, 0, 0])[0])).toEqual([-10, 10, 20]);
  });

  it('a grid is the product of the rows, labelled by position', () => {
    const list = rectangularPlacements(
      { line: X, count: 2, step: 10, symmetric: false },
      { line: Y, count: 3, step: 5, symmetric: false },
    );
    expect(list.map((p) => p.label)).toEqual(['1x0', '0x1', '1x1', '0x2', '1x2']);
    near(apply(list[4]?.matrix as never, [0, 0, 0]), [10, 10, 0]);
    expect(new Set(list.map((p) => p.slot)).size).toBe(list.length);
  });

  it('a slanted second direction is used as it is; a parallel one is refused', () => {
    const slanted = { origin: [0, 0, 0], direction: [1, 1, 0] } as const;
    const [first] = rectangularPlacements(
      { line: X, count: 1, step: 0, symmetric: false },
      { line: slanted, count: 2, step: Math.SQRT2, symmetric: false },
    );
    near(apply(first?.matrix as never, [0, 0, 0]), [1, 1, 0]);
    expect(() =>
      rectangularPlacements(
        { line: X, count: 2, step: 1, symmetric: false },
        { line: X, count: 2, step: 1, symmetric: false },
      ),
    ).toThrow(/parallel/);
  });
});

describe('circular placements', () => {
  it('spreads a whole turn evenly and turns points about the axis', () => {
    const list = circularPlacements(Z, 4, 2 * Math.PI, 'total', false);
    expect(list).toHaveLength(3);
    near(apply(list[0]?.matrix as never, [10, 0, 0]), [0, 10, 0]);
    near(apply(list[1]?.matrix as never, [10, 0, 0]), [-10, 0, 0]);
    near(apply(list[2]?.matrix as never, [10, 0, 0]), [0, -10, 0]);
  });

  it('turns about an axis that does not pass through the origin', () => {
    const axis = { origin: [10, 0, 0], direction: [0, 0, 1] } as const;
    const [first] = circularPlacements(axis, 2, Math.PI, 'total', false);
    near(apply(first?.matrix as never, [20, 0, 0]), [0, 0, 0]);
  });

  it('a part of a turn ends on the angle, a step is between neighbours', () => {
    const total = circularPlacements(Z, 3, Math.PI / 2, 'total', false);
    near(apply(total[1]?.matrix as never, [1, 0, 0]), [0, 1, 0]);
    const step = circularPlacements(Z, 3, Math.PI / 4, 'step', false);
    near(apply(step[1]?.matrix as never, [1, 0, 0]), [0, 1, 0]);
  });
});

describe('path placements', () => {
  const line = pathOf([
    [0, 0, 0],
    [100, 0, 0],
  ]);

  it('moves by the way the path went from its start', () => {
    const list = pathPlacements(line, 3, 40, false);
    expect(list.map((p) => apply(p.matrix, [5, 5, 0])[0])).toEqual([45, 85]);
  });

  it('runs out of path with a message that says how long it is', () => {
    expect(() => pathPlacements(line, 4, 40, false)).toThrow(/100 mm long.*120 mm/);
  });

  it('aligned instances turn with the path about the path point', () => {
    const bend = pathOf([
      [0, 0, 0],
      [10, 0, 0],
      [10, 10, 0],
    ]);
    const [second] = pathPlacements(bend, 3, 10, true);
    // (5, 0, 0) turned a quarter about the start, then moved to the path point (10, 10, 0).
    const [, third] = pathPlacements(bend, 3, 10, true);
    near(apply(third?.matrix as never, [5, 0, 0]), [10, 15, 0]);
    near(apply(second?.matrix as never, [5, 0, 0]), [15, 0, 0]);
  });
});

describe('paths', () => {
  it('gives points and directions along the way', () => {
    const path = pathOf([
      [0, 0, 0],
      [10, 0, 0],
      [10, 20, 0],
    ]);
    expect(path.length).toBe(30);
    expect(path.closed).toBe(false);
    near(path.at(5).point, [5, 0, 0]);
    near(path.at(5).tangent, [1, 0, 0]);
    near(path.at(20).point, [10, 10, 0]);
    near(path.at(20).tangent, [0, 1, 0]);
    near(path.at(99).point, [10, 20, 0]);
  });

  it('notices a closed path and smooths only what turns a little', () => {
    const square = pathOf([
      [0, 0, 0],
      [10, 0, 0],
      [10, 10, 0],
      [0, 10, 0],
      [0, 0, 0],
    ]);
    expect(square.closed).toBe(true);
    near(square.at(9.999).tangent, [1, 0, 0], 3);
    near(square.at(10.001).tangent, [0, 1, 0], 3);
    // A gently curving polyline: the tangent between the samples is the curve's, not the chord's.
    const arc = pathOf(
      Array.from({ length: 91 }, (_, i): Vec3 => {
        const a = (i * Math.PI) / 180;
        return [Math.cos(a) * 100, Math.sin(a) * 100, 0];
      }),
    );
    const end = arc.at(arc.length);
    near(end.tangent, [-1, 0, 0], 4);
  });
});

describe('turning one direction to another', () => {
  it('is the identity for the same direction and a half turn for the opposite', () => {
    near(apply(turnTo([0, 0, 0], [1, 0, 0], [1, 0, 0]), [3, 4, 5]), [3, 4, 5]);
    const back = turnTo([0, 0, 0], [1, 0, 0], [-1, 0, 0]);
    near(apply(back, [1, 0, 0]), [-1, 0, 0]);
    expect(determinant(back)).toBeCloseTo(1, 9);
  });

  it('takes a direction to another about the pivot', () => {
    const m = turnTo([1, 1, 0], [1, 0, 0], [0, 1, 0]);
    near(apply(m, [2, 1, 0]), [1, 2, 0]);
  });
});

describe('counts', () => {
  it('are whole numbers from 1 and not too many', () => {
    expect(wholeCount(3, 'Count')).toBe(3);
    expect(() => wholeCount(2.5, 'Count')).toThrow(/whole number/);
    expect(() => wholeCount(0, 'Count')).toThrow(/at least 1/);
    expect(() => wholeCount(Number.NaN, 'Count')).toThrow(/whole number/);
    expect(() => limitInstances(1000)).not.toThrow();
    expect(() => limitInstances(1001)).toThrow(/1001/);
  });
});
