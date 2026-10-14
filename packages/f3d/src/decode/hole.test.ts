import { describe, expect, it } from 'vitest';
import type { AsmSurface } from '../asm';
import {
  centresFromCylinders,
  MAX_FOUND_CENTRES,
  type ModelPlane,
  planeThrough,
  readHolePlacement,
} from './hole';
import { segment } from './test-segment';

const cylinder = (
  center: [number, number, number],
  axis: [number, number, number],
  radius: number,
): AsmSurface => ({
  kind: 'cone',
  center,
  axis,
  radius,
  cylinder: true,
  slope: 0,
});

// The face the holes start on: z = 0.5 cm, facing +Z.
const top: ModelPlane = { origin: [0, 0, 0.5], x: [1, 0, 0], y: [0, 1, 0] };

describe('centresFromCylinders', () => {
  it('puts a centre where each cylinder of the hole’s radius meets the face', () => {
    const got = centresFromCylinders(
      [
        cylinder([1, 2, -0.3], [0, 0, -1], 0.165),
        // The same wall in two halves, and as an earlier state kept it.
        cylinder([1, 2, 0.1], [0, 0, 1], 0.165),
        cylinder([3, 0.5, 0], [0, 0, -1], 0.165),
      ],
      top,
      0.165,
    );
    expect(got).toHaveLength(2);
    expect(got[0]?.map((v) => Number(v.toFixed(9)))).toEqual([1, 2, 0.5]);
    expect(got[1]?.map((v) => Number(v.toFixed(9)))).toEqual([3, 0.5, 0.5]);
  });

  it('leaves out other radii, cones, slanted axes and other surfaces', () => {
    const cone: AsmSurface = {
      kind: 'cone',
      center: [0, 0, 0],
      axis: [0, 0, 1],
      radius: 0.165,
      cylinder: false,
      slope: 0.5,
    };
    const plane: AsmSurface = { kind: 'plane', point: [0, 0, 0], normal: [0, 0, 1] };
    const got = centresFromCylinders(
      [cylinder([1, 1, 0], [0, 0, 1], 0.3), cone, cylinder([1, 1, 0], [0, 0.6, 0.8], 0.165), plane],
      top,
      0.165,
    );
    expect(got).toEqual([]);
  });

  it('gives at most MAX_FOUND_CENTRES and nothing for a degenerate plane', () => {
    const many = Array.from({ length: MAX_FOUND_CENTRES + 5 }, (_, i) =>
      cylinder([i, 0, 0], [0, 0, 1], 0.1),
    );
    expect(centresFromCylinders(many, top, 0.1)).toHaveLength(MAX_FOUND_CENTRES);
    const flat: ModelPlane = { origin: [0, 0, 0], x: [1, 0, 0], y: [1, 0, 0] };
    expect(centresFromCylinders(many, flat, 0.1)).toEqual([]);
  });
});

describe('readHolePlacement', () => {
  const f64s = (...v: number[]) => [...new Uint8Array(new Float64Array(v).buffer)];
  const placement = (head: number[]) =>
    segment([{ guid: 'F2A7590D-6654-4674-B393-A2AEF4FEC48A', id: 7, body: [0, 0, ...head] }]);

  it("reads the point on the start face and the face's normal", () => {
    const seg = placement([8, 0, 0, 0, ...f64s(11.56, 0.39, 0.38, 1, 0, 0), 0]);
    expect(readHolePlacement(seg, 7)).toEqual({ point: [11.56, 0.39, 0.38], normal: [1, 0, 0] });
  });

  it('gives nothing for another layout, a normal that is not unit or values that are not numbers', () => {
    expect(
      readHolePlacement(placement([16, 0, 0, 0, ...f64s(0, 0, 0, 1, 0, 0)]), 7),
    ).toBeUndefined();
    expect(
      readHolePlacement(placement([8, 0, 0, 0, ...f64s(0, 0, 0, 2, 0, 0)]), 7),
    ).toBeUndefined();
    expect(
      readHolePlacement(placement([8, 0, 0, 0, ...f64s(Number.NaN, 0, 0, 1, 0, 0)]), 7),
    ).toBeUndefined();
    expect(readHolePlacement(placement([8, 0, 0, 0, 1, 2]), 7)).toBeUndefined();
  });
});

describe('planeThrough', () => {
  it('makes unit directions in the plane whose cross product is the normal', () => {
    for (const n of [
      [1, 0, 0],
      [0, 0, -1],
      [0.98769, 0, -0.15643],
      [0, -0.87462, -0.48481],
    ] as [number, number, number][]) {
      const len = Math.hypot(...n);
      const N = n.map((v) => v / len) as [number, number, number];
      const { origin, x, y } = planeThrough([1, 2, 3], N);
      expect(origin).toEqual([1, 2, 3]);
      const cross = [
        x[1] * y[2] - x[2] * y[1],
        x[2] * y[0] - x[0] * y[2],
        x[0] * y[1] - x[1] * y[0],
      ];
      for (const [i, v] of cross.entries()) expect(v).toBeCloseTo(N[i] as number, 9);
      expect(Math.hypot(...x)).toBeCloseTo(1, 12);
      expect(x[0] * N[0] + x[1] * N[1] + x[2] * N[2]).toBeCloseTo(0, 12);
    }
  });
});
