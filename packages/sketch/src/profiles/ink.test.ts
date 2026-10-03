import type { Vec2 } from '@extrudo/core';
import { describe, expect, it } from 'vitest';
import { interiorPoint, windingNumber } from './ink';

const squareCCW: Vec2[] = [
  [0, 0],
  [10, 0],
  [10, 10],
  [0, 10],
];
const squareCW: Vec2[] = [...squareCCW].reverse();
const ring: Vec2[] = [...squareCCW, [0, 0]];

function centroid(pts: readonly Vec2[]): Vec2 {
  const n = pts.length;
  return [pts.reduce((s, p) => s + p[0], 0) / n, pts.reduce((s, p) => s + p[1], 0) / n];
}

describe('windingNumber', () => {
  it('counts +1 inside a counter-clockwise contour', () => {
    expect(windingNumber([5, 5], [squareCCW])).toBe(1);
  });

  it('counts -1 inside a clockwise contour', () => {
    expect(windingNumber([5, 5], [squareCW])).toBe(-1);
  });

  it('counts 0 outside', () => {
    expect(windingNumber([15, 5], [squareCCW])).toBe(0);
    expect(windingNumber([-5, -5], [squareCW])).toBe(0);
  });

  it('gives 2 in the overlap of two counter-clockwise squares', () => {
    const other: Vec2[] = [
      [5, 0],
      [15, 0],
      [15, 10],
      [5, 10],
    ];
    expect(windingNumber([7.5, 5], [squareCCW, other])).toBe(2);
    expect(windingNumber([2, 5], [squareCCW, other])).toBe(1);
    expect(windingNumber([12, 5], [squareCCW, other])).toBe(1);
  });

  it('gives 0 in the counter of an o (outer CCW, inner CW)', () => {
    const outer: Vec2[] = [
      [0, 0],
      [20, 0],
      [20, 20],
      [0, 20],
    ];
    const inner: Vec2[] = [
      [5, 5],
      [5, 15],
      [15, 15],
      [15, 5],
    ];
    expect(windingNumber([10, 10], [outer, inner])).toBe(0);
    expect(windingNumber([2, 2], [outer, inner])).toBe(1);
  });

  it('handles a ray through a diamond\u2019s vertex', () => {
    const diamond: Vec2[] = [
      [0, 0],
      [2, 2],
      [4, 0],
      [2, -2],
    ];
    // The ray at y = 0 passes through two vertices.
    expect(windingNumber([3, 0], [diamond])).toBe(-1);
    expect(windingNumber([-1, 0], [diamond])).toBe(0);
    expect(windingNumber([5, 0], [diamond])).toBe(0);
  });

  it('treats a repeated closing point the same', () => {
    expect(windingNumber([5, 5], [ring])).toBe(1);
  });
});

describe('interiorPoint', () => {
  it('finds a point inside a square', () => {
    const p = interiorPoint(squareCCW) as Vec2;
    expect(windingNumber(p, [squareCCW])).toBe(1);
    expect(p[0]).toBeGreaterThan(0);
    expect(p[0]).toBeLessThan(10);
    expect(p[1]).toBeGreaterThan(0);
    expect(p[1]).toBeLessThan(10);
  });

  it('finds a point inside a C shape whose centroid is outside', () => {
    // A square with a notch cut from the right side; the centroid falls in the notch.
    const c: Vec2[] = [
      [0, 0],
      [30, 0],
      [30, 4],
      [4, 4],
      [4, 16],
      [30, 16],
      [30, 20],
      [0, 20],
    ];
    const p = interiorPoint(c) as Vec2;
    expect(windingNumber(p, [c])).toBe(1);
    expect(inside(p, c)).toBe(true);
    expect(inside(centroid(c), c)).toBe(false);
  });

  it('finds a point between a square and a big hole inside it', () => {
    const hole: Vec2[] = [
      [2, 2],
      [8, 2],
      [8, 8],
      [2, 8],
    ];
    const p = interiorPoint(squareCCW, [hole]) as Vec2;
    expect(windingNumber(p, [squareCCW, hole])).toBe(1);
    expect(p[0] < 2 || p[0] > 8 || p[1] < 2 || p[1] > 8).toBe(true);
  });

  it('finds a point inside a diamond', () => {
    const diamond: Vec2[] = [
      [0, 0],
      [20, -20],
      [40, 0],
      [20, 20],
    ];
    const p = interiorPoint(diamond) as Vec2;
    expect(windingNumber(p, [diamond])).toBe(1);
  });

  it('finds a point in a thin sliver far from the origin', () => {
    const sliver: Vec2[] = [
      [1000, 1000],
      [1010, 1000],
      [1000, 1000.2],
    ];
    const p = interiorPoint(sliver) as Vec2;
    expect(windingNumber(p, [sliver])).toBe(1);
  });

  it('accepts polyline rings that repeat their first point', () => {
    const p = interiorPoint(ring) as Vec2;
    expect(windingNumber(p, [ring])).toBe(1);
  });

  it('honours a margin when the region allows it', () => {
    const p = interiorPoint(squareCCW, [], 4) as Vec2;
    expect(p[0]).toBeGreaterThanOrEqual(4);
    expect(p[0]).toBeLessThanOrEqual(6);
    expect(p[1]).toBeGreaterThanOrEqual(4);
    expect(p[1]).toBeLessThanOrEqual(6);
  });

  it('returns undefined for regions without area', () => {
    expect(
      interiorPoint([
        [0, 0],
        [10, 0],
      ]),
    ).toBeUndefined();
    expect(
      interiorPoint([
        [0, 0],
        [0, 0],
        [0, 0],
      ]),
    ).toBeUndefined();
    expect(
      interiorPoint([
        [0, 0],
        [10, 10],
        [20, 20],
        [30, 30],
      ]),
    ).toBeUndefined();
  });
});

/** Even-odd containment, for cross-checking. */
function inside(p: Vec2, polygon: readonly Vec2[]): boolean {
  let insidePoly = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[j] as Vec2;
    const b = polygon[i] as Vec2;
    if (a[1] > p[1] !== b[1] > p[1]) {
      const x = a[0] + ((p[1] - a[1]) * (b[0] - a[0])) / (b[1] - a[1]);
      if (p[0] < x) insidePoly = !insidePoly;
    }
  }
  return insidePoly;
}
