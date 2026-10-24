/** The workbench's cutting mat: where its grid lies, how fine it is, its numbers. */
import { Box3, Texture, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { cuttingMat, gridStep, MAT_THICKNESS, matLayout, matNumber } from './mat';
import type { Placement } from './scenes';

/** A placement for a model whose design box is [lo, hi] (like `placeModel`). */
function placed(lo: [number, number, number], hi: [number, number, number]): Placement {
  const sides = new Vector3(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]);
  const size = Math.max(sides.x, sides.y, sides.z);
  return {
    offset: new Vector3(-(lo[0] + hi[0]) / 2, -(lo[1] + hi[1]) / 2, -lo[2]),
    centre: new Vector3(0, 0, sides.z / 2),
    radius: sides.length() / 2,
    size,
    extent: sides.clone().multiplyScalar(0.5),
    s: Math.max(size, 50),
  };
}

describe('gridStep', () => {
  it('keeps 10 mm on a mat up to 60 cells across, then 50, 100, 500 mm', () => {
    expect(gridStep(600)).toBe(10);
    expect(gridStep(601)).toBe(50);
    expect(gridStep(3000)).toBe(50);
    expect(gridStep(3001)).toBe(100);
    expect(gridStep(6001)).toBe(500);
  });
});

describe('matLayout', () => {
  it("covers the footprint and a margin, on the design's 10 mm grid", () => {
    // A 40 × 20 × 10 part from (5, 5, 0): the margin is 15 mm (0.25 · 40 = 10 is less).
    const layout = matLayout(placed([5, 5, 0], [45, 25, 10]));
    expect(layout.step).toBe(10);
    expect(layout.major).toBe(50);
    expect([layout.x0, layout.x1, layout.y0, layout.y1]).toEqual([-10, 60, -10, 40]);
    for (const edge of [layout.x0, layout.x1, layout.y0, layout.y1])
      expect(Math.abs(edge % 10)).toBe(0);
    // A small mat numbers every line.
    expect(layout.label).toBe(10);
  });

  it('numbers only the major lines on a busy mat and steps the grid up for a big model', () => {
    // 250 mm: a 62.5 mm margin, 39 cells across.
    expect(matLayout(placed([0, 0, 0], [250, 250, 20])).label).toBe(50);
    // 3000 mm: a 750 mm margin, 4500 mm across.
    const big = matLayout(placed([0, 0, 0], [3000, 1000, 100]));
    expect(big.step).toBe(100);
    expect(big.major).toBe(500);
  });

  it("puts the design's origin where the model's offset says", () => {
    const layout = matLayout(placed([5, 5, 0], [45, 25, 10]));
    const mat = cuttingMat(layout, new Texture());
    mat.updateMatrixWorld(true);
    const box = new Box3().setFromObject(mat);
    // The grid's x0 (design −10) lands at −10 + offset.x (−25) = −35, plus the border.
    expect(box.min.x).toBeCloseTo(-35 - layout.border, 9);
    expect(box.min.y).toBeCloseTo(-25 - layout.border, 9);
    expect(box.max.z).toBeCloseTo(0, 9);
    expect(box.min.z).toBeCloseTo(-MAT_THICKNESS, 9);
  });
});

describe('matNumber', () => {
  it('writes millimetres with a real minus sign', () => {
    expect(matNumber(0)).toBe('0');
    expect(matNumber(150)).toBe('150');
    expect(matNumber(-20)).toBe('−20');
  });
});
