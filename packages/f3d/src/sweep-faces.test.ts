import { describe, expect, it } from 'vitest';
import type { AsmSurface } from './asm';
import type { Vec3 } from './decode/sketch-geometry';
import {
  MAX_PATH_PIECES,
  type PathPiece,
  type ProfileCurve,
  sweptCap,
  sweptFaces,
  sweptHolds,
  sweptSides,
} from './sweep-faces';

// A path in the plane y = 0: 4 cm up Z from (2, 0, 0), then a quarter turn
// of radius 10 towards −X, ending at (−8, 0, 14) heading −X.
const line: PathPiece = { kind: 'line', a: [2, 0, 0], b: [2, 0, 4] };
const arc: PathPiece = {
  kind: 'arc',
  a: [2, 0, 4],
  b: [-8, 0, 14],
  centre: [-8, 0, 4],
  axis: [0, -1, 0],
};
// The same arc walked the other way.
const back: PathPiece = {
  kind: 'arc',
  a: [-8, 0, 14],
  b: [2, 0, 4],
  centre: [-8, 0, 4],
  axis: [0, 1, 0],
};
// The profile on z = 0, across the path's start: its bottom on the path's plane,
// its outer side at x = 3, a round of radius 0.25 at (2, 0.5).
const curves: ProfileCurve[] = [
  { name: 'bottom', kind: 'line', a: [1, 0, 0], b: [3, 0, 0] },
  { name: 'outer', kind: 'line', a: [3, 0, 0], b: [3, 1, 0] },
  { name: 'round', kind: 'arc', centre: [2, 0.5, 0], radius: 0.25 },
];
const profile = { origin: [0, 0, 0] as Vec3, normal: [0, 0, 1] as Vec3 };

const plane = (point: Vec3, normal: Vec3): AsmSurface => ({ kind: 'plane', point, normal });
const cylinder = (center: Vec3, axis: Vec3, radius: number): AsmSurface => ({
  kind: 'cone',
  center,
  axis,
  radius,
  cylinder: true,
  slope: 0,
});

describe('sweptFaces', () => {
  // Given out of order, the arc backwards: chained from the profile's end.
  const sw = sweptFaces([back, line], profile, curves);

  it('names the sides each profile curve sweeps, along lines and arcs', () => {
    if (!sw) throw new Error('no swept faces');
    // The bottom: the path's own plane, the whole way.
    expect(sweptSides(plane([0, 0, 0], [0, -1, 0]), sw)).toEqual(['bottom']);
    // The outer side: a plane along the line, a cylinder of radius 11 round the arc.
    expect(sweptSides(plane([3, 0, 0], [1, 0, 0]), sw)).toEqual(['outer']);
    expect(sweptSides(cylinder([-8, 0, 4], [0, 1, 0], 11), sw)).toEqual(['outer']);
    // The round: a cylinder along the line, a torus round the arc.
    expect(sweptSides(cylinder([2, 0.5, 0], [0, 0, 1], 0.25), sw)).toEqual(['round']);
    const torus: AsmSurface = {
      kind: 'torus',
      center: [-8, 0.5, 4],
      axis: [0, 1, 0],
      ref: [1, 0, 0],
      major: 10,
      minor: 0.25,
      inward: false,
    };
    expect(sweptSides(torus, sw)).toEqual(['round']);
    // Not a side: another radius, a plane the profile doesn't sweep.
    expect(sweptSides(cylinder([-8, 0, 4], [0, 1, 0], 12), sw)).toEqual([]);
    expect(sweptSides(plane([5, 0, 0], [1, 0, 0]), sw)).toEqual([]);
  });

  it('names the cap on the profile start and the one across the far end', () => {
    if (!sw) throw new Error('no swept faces');
    expect(sweptCap(plane([0, 0, 0], [0, 0, -1]), sw)).toBe('start');
    expect(sweptCap(plane([-8, 7, 14], [-1, 0, 0]), sw)).toBe('end');
    expect(sweptCap(plane([0, 0, 2], [0, 0, 1]), sw)).toBeUndefined();
  });

  it('tells which line a point on a shared plane lies across from', () => {
    if (!sw) throw new Error('no swept faces');
    expect(sweptHolds(sw, 'bottom', [2.5, 0, 2])).toBe(true);
    expect(sweptHolds(sw, 'bottom', [3.5, 0, 2])).toBe(false);
    // Round the arc, 10.5 off its axis: across the bottom line.
    expect(sweptHolds(sw, 'bottom', [-8 + 10.5 * Math.SQRT1_2, 0, 4 + 10.5 * Math.SQRT1_2])).toBe(
      true,
    );
  });

  it('knows only planes at one height along a spline', () => {
    const spline: PathPiece = {
      kind: 'curve',
      a: [2, 0, 4],
      b: [6, 0, 8],
      ta: [0, 0, 1],
      tb: [1, 0, 0],
      points: [
        [2, 0, 4],
        [2, 0, 8],
        [6, 0, 8],
      ],
    };
    const sw2 = sweptFaces([line, spline], profile, curves);
    if (!sw2) throw new Error('no swept faces');
    expect(sweptSides(plane([0, 0, 0], [0, -1, 0]), sw2)).toEqual(['bottom']);
    expect(sweptSides(cylinder([2, 0.5, 0], [0, 0, 1], 0.25), sw2)).toEqual(['round']);
    expect(sweptCap(plane([6, 0, 8], [1, 0, 0]), sw2)).toBe('end');
  });

  it('gives nothing for a path that is not flat, broken, too long, or not across the profile', () => {
    const lifted: PathPiece = { kind: 'line', a: [2, 0, 4], b: [2, 3, 6] };
    const turn: PathPiece = { kind: 'line', a: [2, 3, 6], b: [5, 3, 6] };
    expect(sweptFaces([line, lifted, turn], profile, curves)).toBeUndefined();
    expect(
      sweptFaces([line, { kind: 'line', a: [9, 0, 0], b: [9, 0, 1] }], profile, curves),
    ).toBeUndefined();
    const many = Array.from(
      { length: MAX_PATH_PIECES + 1 },
      (_, i): PathPiece => ({
        kind: 'line',
        a: [2, 0, i],
        b: [2, 0, i + 1],
      }),
    );
    expect(sweptFaces(many, profile, curves)).toBeUndefined();
    const aside = { origin: [0, 0, -5] as Vec3, normal: [1, 0, 0] as Vec3 };
    expect(sweptFaces([line, arc], aside, curves)).toBeUndefined();
  });
});
