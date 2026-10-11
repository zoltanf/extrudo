/**
 * Edge geometry from surfaces (cm in, mm out): a box edge, a box edge ended
 * by fillets, a fillet's arc where it meets a side, and a hole's rim.
 */
import { describe, expect, it } from 'vitest';
import type { AsmSurface } from './asm';
import type { Vec3 } from './decode/sketch-geometry';
import { edgeShape } from './edge-shape';
import type { F3dEdge, F3dFace } from './model';

const face = (surface: AsmSurface): F3dFace => ({ tags: [], surface });
const plane = (point: Vec3, normal: Vec3) => face({ kind: 'plane', point, normal });
const cylinder = (center: Vec3, axis: Vec3, radius: number) =>
  face({ kind: 'cone', center, axis, radius, cylinder: true, slope: 0 });
const cone = (center: Vec3, axis: Vec3, radius: number, slope: number) =>
  face({ kind: 'cone', center, axis, radius, cylinder: false, slope });
const edge = (a: F3dFace, b: F3dFace, bounds: F3dFace[]): F3dEdge => ({ faces: [a, b], bounds });

describe('edgeShape', () => {
  it('ends a line where the bounding planes cross it', () => {
    // A 4 × 2 × 1 cm box's top edge along X, at y = 2, z = 1.
    const e = edge(plane([0, 0, 1], [0, 0, 1]), plane([0, 2, 0], [0, 1, 0]), [
      plane([0, 0, 0], [-1, 0, 0]),
      plane([4, 0, 0], [1, 0, 0]),
    ]);
    expect(edgeShape(e)).toMatchObject({
      type: 'line',
      at: [20, 20, 10],
      dir: [1, 0, 0],
      size: 40,
    });
  });

  it('ends a line where it touches the fillets at its ends', () => {
    // The same edge, with 0.5 cm fillets along the box's two upright ends.
    const e = edge(plane([0, 0, 1], [0, 0, 1]), plane([0, 2, 0], [0, 1, 0]), [
      cylinder([0.5, 1.5, 0], [0, 0, 1], 0.5),
      cylinder([3.5, 1.5, 0], [0, 0, 1], 0.5),
    ]);
    expect(edgeShape(e)).toMatchObject({ type: 'line', at: [20, 20, 10], size: 30 });
  });

  it('takes the quarter arc where a fillet meets a side', () => {
    // A 0.5 cm fillet along Y on the top edge x = 4, z = 1; the side y = 0 cuts it.
    const e = edge(plane([0, 0, 0], [0, -1, 0]), cylinder([3.5, 0, 0.5], [0, 1, 0], 0.5), [
      plane([0, 0, 1], [0, 0, 1]),
      plane([4, 0, 0], [1, 0, 0]),
    ]);
    const s = edgeShape(e);
    const h = 5 * Math.SQRT1_2;
    expect(s?.type).toBe('circle');
    expect(s?.dir).toEqual([0, 1, 0]);
    expect(s?.at[0]).toBeCloseTo(35 + h, 5);
    expect(s?.at[1]).toBeCloseTo(0, 6);
    expect(s?.at[2]).toBeCloseTo(5 + h, 5);
    expect(s?.size).toBeCloseTo((Math.PI / 2) * 5, 5);
  });

  it('gives a whole circle its centre and circumference', () => {
    const e = edge(plane([0, 0, 1], [0, 0, 1]), cylinder([1, 1, 0], [0, 0, -1], 0.25), []);
    const s = edgeShape(e);
    expect(s).toMatchObject({ type: 'circle', at: [10, 10, 10], dir: [0, 0, 1] });
    expect(s?.size).toBeCloseTo(Math.PI * 5, 6);
    expect(s?.ends).toBeUndefined();
  });

  it("finds a countersink's rims on the top face and on the hole", () => {
    // 90°, drilled down from z = 1.2: radius 0.4 cm at z = 1.075, narrowing downwards.
    const sink = cone([2, 5, 1.075], [0, 0, -1], 0.4, -1);
    const top = edgeShape(edge(plane([0, 0, 1.2], [0, 0, 1]), sink, []));
    expect(top).toMatchObject({ type: 'circle', at: [20, 50, 12], dir: [0, 0, 1] });
    expect(top?.size).toBeCloseTo(2 * Math.PI * 5.25, 6);
    const hole = edgeShape(edge(sink, cylinder([2, 5, 0], [0, 0, 1], 0.25), []));
    expect(hole).toMatchObject({ type: 'circle', at: [20, 50, 9.25] });
    expect(hole?.size).toBeCloseTo(2 * Math.PI * 2.5, 6);
  });
});
