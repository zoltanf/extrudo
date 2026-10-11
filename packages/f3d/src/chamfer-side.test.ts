/**
 * Which face a two-size chamfer's first distance goes on, from the chamfer
 * face the file made (cm): a box edge and a ring's rim.
 */
import { describe, expect, it } from 'vitest';
import type { AsmSurface } from './asm';
import { firstFace } from './chamfer-side';
import type { Vec3 } from './decode/sketch-geometry';
import { edgeShape } from './edge-shape';
import type { F3dEdge, F3dFace } from './model';

const face = (surface: AsmSurface): F3dFace => ({ tags: [], surface });
const plane = (point: Vec3, normal: Vec3): AsmSurface => ({ kind: 'plane', point, normal });

describe('firstFace', () => {
  // The top edge of a box along X at y = 0, z = 1; the top (z = 1) and the front (y = 0).
  const edge: F3dEdge = {
    faces: [face(plane([0, 0, 1], [0, 0, 1])), face(plane([0, 0, 0], [0, -1, 0]))],
    bounds: [face(plane([0, 0, 0], [-1, 0, 0])), face(plane([4, 0, 0], [1, 0, 0]))],
  };
  const shape = edgeShape(edge);
  /** The chamfer plane through (y = a on the top) and (z = 1 − b on the front). */
  const bevel = (a: number, b: number): AsmSurface => {
    const n = Math.hypot(a, b);
    return plane([0, a, 1], [0, -b / n, a / n]);
  };

  it('finds the face whose distance is the first', () => {
    if (!shape) throw new Error('no shape');
    expect(firstFace(edge, shape, [bevel(0.2, 0.3)], 0.2, 0.3)).toBe(0);
    expect(firstFace(edge, shape, [bevel(0.3, 0.2)], 0.2, 0.3)).toBe(1);
  });

  it('says nothing when no chamfer face fits the sizes', () => {
    if (!shape) throw new Error('no shape');
    expect(firstFace(edge, shape, [bevel(0.25, 0.25)], 0.2, 0.3)).toBeUndefined();
    expect(firstFace(edge, shape, [], 0.2, 0.3)).toBeUndefined();
  });

  it('reads a cone round a rim', () => {
    // A 1 cm cylinder about Z with its top at z = 0; the bevel 0.1 in on the
    // top and 0.3 down the side.
    const rim: F3dEdge = {
      faces: [
        face({
          kind: 'cone',
          center: [0, 0, 0],
          axis: [0, 0, 1],
          radius: 1,
          cylinder: true,
          slope: 0,
        }),
        face(plane([0, 0, 0], [0, 0, 1])),
      ],
      bounds: [],
    };
    const cone: AsmSurface = {
      kind: 'cone',
      center: [0, 0, 0],
      axis: [0, 0, 1],
      radius: 0.9,
      cylinder: false,
      slope: -1 / 3,
    };
    const s = edgeShape(rim);
    if (!s) throw new Error('no shape');
    expect(firstFace(rim, s, [cone], 0.1, 0.3)).toBe(1);
    expect(firstFace(rim, s, [cone], 0.3, 0.1)).toBe(0);
  });
});
