import { planeFrame, type SketchData, type SketchFrame } from '@extrudo/core';
import { detectProfiles } from '@extrudo/sketch/profiles';
import { describe, expect, it } from 'vitest';
import {
  boundsOfPositions,
  CIRCLE_SEGMENTS,
  curveSegments,
  profileTriangles,
  sketchSegments,
  unionBounds,
} from './sketchGeometry';

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
    expect(xz.bounds).toEqual({
      center: [2.5, 0, 4],
      radius: 2.5,
      box: { min: [1, 0, 2], max: [4, 0, 6] },
    });
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
  it('take in placed dimension labels, so "Fit" keeps them in view', () => {
    const data = {
      ...sketch({
        a: { type: 'point', x: -20, y: 0 },
        b: { type: 'point', x: 20, y: 0 },
        l: { type: 'line', start: 'a', end: 'b', construction: false },
      }),
      dimensions: {
        d: {
          type: 'distance',
          orientation: 'aligned',
          a: 'l',
          expr: '40',
          driven: false,
          label: { x: 0, y: 12 },
        },
        // A label at its default spot has no position of its own to add.
        e: { type: 'distance', orientation: 'aligned', a: 'l', expr: '40', driven: false },
      },
    } as SketchData;
    expect(sketchSegments(data, frame('origin:xy')).bounds?.box).toEqual({
      min: [-20, 0, 0],
      max: [20, 12, 0],
    });
  });

  it('are at least 1 mm across', () => {
    expect(boundsOfPositions([[3, 4, 5]])).toEqual({
      center: [3, 4, 5],
      radius: 0.5,
      box: { min: [3, 4, 5], max: [3, 4, 5] },
    });
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

describe('profileTriangles', () => {
  /** A 10 × 10 square on XZ (front) with a square hole of 4 × 4 in the middle. */
  const square = (id: string, x: number, y: number, s: number) => {
    const pts: [number, number][] = [
      [x, y],
      [x + s, y],
      [x + s, y + s],
      [x, y + s],
    ];
    const out: Record<string, unknown> = {};
    pts.forEach(([px, py], i) => {
      const [qx, qy] = pts[(i + 1) % 4] as [number, number];
      out[`${id}a${i}`] = { type: 'point', x: px, y: py };
      out[`${id}b${i}`] = { type: 'point', x: qx, y: qy };
      out[`${id}l${i}`] = {
        type: 'line',
        start: `${id}a${i}`,
        end: `${id}b${i}`,
        construction: false,
      };
    });
    return out;
  };
  const profiles = detectProfiles(sketch({ ...square('o', 0, 0, 10), ...square('i', 3, 3, 4) }));

  /** Total area of xyz triangles, projected on the sketch plane's world axes (x and z for XZ). */
  const area = (tri: Float32Array) => {
    let sum = 0;
    for (let i = 0; i < tri.length; i += 9) {
      const [ax, , az, bx, , bz, cx, , cz] = tri.subarray(i, i + 9) as unknown as number[];
      sum +=
        Math.abs(
          ((bx as number) - (ax as number)) * ((cz as number) - (az as number)) -
            ((cx as number) - (ax as number)) * ((bz as number) - (az as number)),
        ) / 2;
    }
    return sum;
  };

  it('triangulates regions with their holes, on the sketch plane', () => {
    const t = profileTriangles(profiles, frame('origin:xz'));
    expect(area(t.normal)).toBeCloseTo(100 - 16 + 16, 4);
    // Every vertex lies on the XZ plane.
    for (let i = 1; i < t.normal.length; i += 3) expect(t.normal[i]).toBeCloseTo(0, 9);
    expect(t.hover).toHaveLength(0);
  });

  it('shades the hovered and selected regions apart', () => {
    const [ring, inner] = profiles as [(typeof profiles)[number], (typeof profiles)[number]];
    const t = profileTriangles(profiles, frame('origin:xz'), inner.id, [ring.id]);
    expect(area(t.selected)).toBeCloseTo(84, 4);
    expect(area(t.hover)).toBeCloseTo(16, 4);
    expect(t.normal).toHaveLength(0);
    // Selected wins over hover.
    const both = profileTriangles(profiles, frame('origin:xz'), ring.id, [ring.id]);
    expect(area(both.selected)).toBeCloseTo(84, 4);
    expect(both.hover).toHaveLength(0);
  });
});

describe('curveSegments', () => {
  it('draws only the named curves, construction or not', () => {
    const data = sketch({
      a: { type: 'point', x: 0, y: 0 },
      b: { type: 'point', x: 10, y: 0 },
      c: { type: 'point', x: 10, y: 5 },
      l1: { type: 'line', start: 'a', end: 'b', construction: false },
      l2: { type: 'line', start: 'b', end: 'c', construction: true },
    });
    const xy = frame('origin:xy');
    expect(pairs(curveSegments(data, xy, ['l1']))).toEqual([
      [0, 0, 0],
      [10, 0, 0],
    ]);
    expect(pairs(curveSegments(data, xy, ['l2']))).toEqual([
      [10, 0, 0],
      [10, 5, 0],
    ]);
    expect(curveSegments(data, xy, [])).toHaveLength(0);
  });
});

describe('projected curves (P2-09)', () => {
  it('draw apart from the status colours, and count for Fit', () => {
    const data = {
      ...sketch({
        a: { type: 'point', x: 0, y: 0 },
        b: { type: 'point', x: 40, y: 0 },
        c: { type: 'point', x: 0, y: 0 },
        d: { type: 'point', x: 0, y: 5 },
        edge: { type: 'line', start: 'a', end: 'b', construction: false },
        mine: { type: 'line', start: 'c', end: 'd', construction: false },
      }),
      projections: { p: { ref: { kind: 'edge', id: 'e[x]' }, curves: { edge: 'edge' } } },
    } as SketchData;
    const s = sketchSegments(data, frame('origin:xy'));
    expect(pairs(s.projected)).toEqual([
      [0, 0, 0],
      [40, 0, 0],
    ]);
    expect(pairs(s.curves.free)).toEqual([
      [0, 0, 0],
      [0, 5, 0],
    ]);
    expect(s.bounds?.box?.max[0]).toBe(40);
  });
});
