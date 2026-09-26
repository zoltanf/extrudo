import { planeFrame, type SketchData, type SketchFrame } from '@extrudo/core';
import { describe, expect, it } from 'vitest';
import { boundsOfPositions, CIRCLE_SEGMENTS, sketchSegments, unionBounds } from './sketchGeometry';

const frame = (id: string) => planeFrame({ kind: 'plane', id }) as SketchFrame;

function sketch(entities: Record<string, unknown>): SketchData {
  return { entities, constraints: {}, dimensions: {} } as SketchData;
}

/** Segment pairs as rounded [x, y, z] points. */
function pairs(array: Float32Array): number[][] {
  const out: number[][] = [];
  for (let i = 0; i < array.length; i += 3) {
    out.push([...array.subarray(i, i + 3)].map((c) => Math.round(c * 1e4) / 1e4 + 0));
  }
  return out;
}

describe('sketchSegments', () => {
  it('places lines and points on the sketch plane', () => {
    const data = sketch({
      a: { type: 'point', x: 1, y: 2 },
      b: { type: 'point', x: 4, y: 6 },
      l: { type: 'line', start: 'a', end: 'b', construction: false },
    });
    const xz = sketchSegments(data, frame('origin:xz'));
    expect(pairs(xz.solid)).toEqual([
      [1, 0, 2],
      [4, 0, 6],
    ]);
    expect(pairs(xz.points)).toEqual([
      [1, 0, 2],
      [4, 0, 6],
    ]);
    expect(xz.construction).toHaveLength(0);
    expect(xz.bounds).toEqual({ center: [2.5, 0, 4], radius: 2.5 });
  });

  it('draws construction curves separately', () => {
    const data = sketch({
      c: { type: 'point', x: 0, y: 0 },
      k: { type: 'circle', center: 'c', radius: 5, construction: true },
    });
    const s = sketchSegments(data, frame('origin:xy'));
    expect(s.solid).toHaveLength(0);
    expect(s.construction).toHaveLength(CIRCLE_SEGMENTS * 6);
    const points = pairs(s.construction);
    for (const [x, y] of points) expect(Math.hypot(x ?? 0, y ?? 0)).toBeCloseTo(5, 3);
  });

  it('runs arcs counter-clockwise from start to end, across the ±180° seam', () => {
    const data = sketch({
      c: { type: 'point', x: 0, y: 0 },
      s: { type: 'point', x: 0, y: 10 },
      e: { type: 'point', x: 0, y: -10 },
      arc: { type: 'arc', center: 'c', start: 's', end: 'e', construction: false },
    });
    const points = pairs(sketchSegments(data, frame('origin:xy')).solid);
    // A half circle through the left side (−X), in CIRCLE_SEGMENTS / 2 segments.
    expect(points).toHaveLength(CIRCLE_SEGMENTS);
    expect(points[0]).toEqual([0, 10, 0]);
    expect(points.at(-1)).toEqual([0, -10, 0]);
    expect(Math.min(...points.map(([x]) => x ?? 0))).toBeCloseTo(-10, 4);
    expect(Math.max(...points.map(([x]) => x ?? 0))).toBeCloseTo(0, 4);
  });

  it('draws ellipses and splines through their points (P1-05)', () => {
    const data = sketch({
      c: { type: 'point', x: 0, y: 0 },
      M: { type: 'point', x: 0, y: 8 },
      m: { type: 'point', x: -3, y: 0 },
      oval: { type: 'ellipse', center: 'c', major: 'M', minor: 'm', construction: false },
      f1: { type: 'point', x: 20, y: 0 },
      f2: { type: 'point', x: 25, y: 5 },
      f3: { type: 'point', x: 30, y: 0 },
      wave: { type: 'spline', points: ['f1', 'f2', 'f3'], construction: true },
    });
    const s = sketchSegments(data, frame('origin:xy'));
    const oval = pairs(s.solid);
    expect(oval).toHaveLength(CIRCLE_SEGMENTS * 2);
    for (const [x, y] of oval) expect(((x ?? 0) / 3) ** 2 + ((y ?? 0) / 8) ** 2).toBeCloseTo(1, 3);
    const wave = pairs(s.construction);
    expect(wave[0]).toEqual([20, 0, 0]);
    expect(wave.at(-1)).toEqual([30, 0, 0]);
    expect(wave.some(([x, y]) => x === 25 && y === 5)).toBe(true);
  });

  it('skips curves whose points are missing, and has no bounds when empty', () => {
    const data = sketch({ l: { type: 'line', start: 'a', end: 'b', construction: false } });
    const s = sketchSegments(data, frame('origin:xy'));
    expect(s.solid).toHaveLength(0);
    expect(s.bounds).toBeUndefined();
  });
});

describe('bounds', () => {
  it('are at least 1 mm across', () => {
    expect(boundsOfPositions([[3, 4, 5]])).toEqual({ center: [3, 4, 5], radius: 0.5 });
  });

  it('unite two spheres', () => {
    const a = { center: [0, 0, 0] as const, radius: 1 };
    const b = { center: [10, 0, 0] as const, radius: 1 };
    expect(unionBounds(a, b)).toEqual({ center: [5, 0, 0], radius: 6 });
    expect(unionBounds(a, { center: [0.5, 0, 0], radius: 0.25 })).toBe(a);
    expect(unionBounds(undefined, b)).toBe(b);
    expect(unionBounds(a, undefined)).toBe(a);
  });
});
