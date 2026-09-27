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
    expect(pairs(xz.curves.free)).toEqual([
      [1, 0, 2],
      [4, 0, 6],
    ]);
    expect(pairs(xz.points.free)).toEqual([
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
    expect(s.curves.free).toHaveLength(0);
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
    const points = pairs(sketchSegments(data, frame('origin:xy')).curves.free);
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
    const oval = pairs(s.curves.free);
    expect(oval).toHaveLength(CIRCLE_SEGMENTS * 2);
    for (const [x, y] of oval) expect(((x ?? 0) / 3) ** 2 + ((y ?? 0) / 8) ** 2).toBeCloseTo(1, 3);
    const wave = pairs(s.construction);
    expect(wave[0]).toEqual([20, 0, 0]);
    expect(wave.at(-1)).toEqual([30, 0, 0]);
    expect(wave.some(([x, y]) => x === 25 && y === 5)).toBe(true);
  });

  it('groups curves and points by constraint status (P1-08), construction aside', () => {
    const data = sketch({
      a: { type: 'point', x: 0, y: 0 },
      b: { type: 'point', x: 10, y: 0 },
      l: { type: 'line', start: 'a', end: 'b', construction: false },
      c: { type: 'point', x: 0, y: 5 },
      d: { type: 'point', x: 10, y: 5 },
      m: { type: 'line', start: 'c', end: 'd', construction: false },
      e: { type: 'point', x: 0, y: 9 },
      f: { type: 'point', x: 10, y: 9 },
      n: { type: 'line', start: 'e', end: 'f', construction: true },
    });
    const s = sketchSegments(data, frame('origin:xy'), {
      a: 'fixed',
      b: 'fixed',
      l: 'fixed',
      c: 'fixed',
      d: 'conflict',
      m: 'conflict',
      n: 'fixed',
    });
    expect(pairs(s.curves.fixed)).toEqual([
      [0, 0, 0],
      [10, 0, 0],
    ]);
    expect(pairs(s.curves.conflict)).toEqual([
      [0, 5, 0],
      [10, 5, 0],
    ]);
    expect(s.curves.free).toHaveLength(0);
    expect(s.construction).toHaveLength(6);
    expect(pairs(s.points.fixed)).toHaveLength(3);
    expect(pairs(s.points.conflict)).toEqual([[10, 5, 0]]);
    // Entities without a status (drawn since the last solve) are free.
    expect(pairs(s.points.free)).toEqual([
      [0, 9, 0],
      [10, 9, 0],
    ]);
  });

  it('skips curves whose points are missing, and has no bounds when empty', () => {
    const data = sketch({ l: { type: 'line', start: 'a', end: 'b', construction: false } });
    const s = sketchSegments(data, frame('origin:xy'));
    expect(s.curves.free).toHaveLength(0);
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
