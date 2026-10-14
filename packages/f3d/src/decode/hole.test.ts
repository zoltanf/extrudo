import { describe, expect, it } from 'vitest';
import type { AsmSurface } from '../asm';
import { centresFromCylinders, MAX_FOUND_CENTRES, type ModelPlane } from './hole';

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
