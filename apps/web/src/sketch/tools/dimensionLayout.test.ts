import type {
  SketchData,
  SketchDimension,
  SketchEntity,
  SketchEntityId,
  Vec2,
} from '@extrudo/core';
import { describe, expect, it } from 'vitest';
import { dimensionShape, dimensionText, labelOffset } from './dimensionLayout';

const e = (id: string) => id as SketchEntityId;

function sketch(): SketchData {
  const entities: Record<string, SketchEntity> = {
    a0: { type: 'point', x: 0, y: 0 },
    a1: { type: 'point', x: 20, y: 0 },
    a: { type: 'line', start: e('a0'), end: e('a1'), construction: false },
    s0: { type: 'point', x: 0, y: 0 },
    s1: { type: 'point', x: 30, y: 40 },
    s: { type: 'line', start: e('s0'), end: e('s1'), construction: false },
    c: { type: 'point', x: 50, y: 0 },
    hole: { type: 'circle', center: e('c'), radius: 5, construction: false },
  };
  return { entities, constraints: {}, dimensions: {} } as SketchData;
}

const dim = (d: Partial<SketchDimension> & Pick<SketchDimension, 'type'>) =>
  ({ expr: '0', driven: false, ...d }) as SketchDimension;

const close = (actual: Vec2 | undefined, expected: Vec2) => {
  expect(actual?.[0]).toBeCloseTo(expected[0], 9);
  expect(actual?.[1]).toBeCloseTo(expected[1], 9);
};

describe('dimensionShape', () => {
  it('puts a length above its line by default, with extension lines and arrows', () => {
    const shape = dimensionShape(
      sketch(),
      dim({ type: 'distance', orientation: 'aligned', a: e('a') }),
      4,
    );
    close(shape?.label, [10, 4]);
    // Two extension lines (overshooting by 20 % of the gap), then the dimension line.
    expect(shape?.lines).toHaveLength(3);
    close(shape?.lines[0]?.[1], [0, 4.8]);
    close(shape?.lines[2]?.[0], [0, 4]);
    close(shape?.lines[2]?.[1], [20, 4]);
    close(shape?.arrows[0]?.dir, [-1, 0]);
    close(shape?.arrows[1]?.dir, [1, 0]);
  });

  it('runs a horizontal dimension of a slanted line through its label, reaching out to it', () => {
    const shape = dimensionShape(
      sketch(),
      dim({
        type: 'distance',
        orientation: 'horizontal',
        a: e('s'),
        label: { x: 30, y: 30 }, // anchor (15, 20) → label (45, 50), right of the span
      }),
      4,
    );
    close(shape?.label, [45, 50]);
    // Vertical extension lines up to y = 50.
    close(shape?.lines[0]?.[0], [0, 0]);
    close(shape?.lines[0]?.[1], [0, 50.8]);
    close(shape?.lines[1]?.[0], [30, 40]);
    // The dimension line reaches the label at x = 45.
    close(shape?.lines[2]?.[0], [0, 50]);
    close(shape?.lines[2]?.[1], [45, 50]);
  });

  it('draws a diameter through the center towards the label', () => {
    const shape = dimensionShape(
      sketch(),
      dim({ type: 'diameter', curve: e('hole'), label: { x: 10, y: 0 } }),
      4,
    );
    close(shape?.label, [60, 0]);
    close(shape?.lines[0]?.[0], [45, 0]);
    close(shape?.lines[0]?.[1], [60, 0]);
    close(shape?.arrows[0]?.tip, [55, 0]);
    close(shape?.arrows[1]?.tip, [45, 0]);
  });

  it('draws an angle as an arc through the label, in the sector of its pair of angles', () => {
    const data = sketch();
    const shape = dimensionShape(
      data,
      dim({ type: 'angle', a: e('a'), b: e('s'), label: { x: 10, y: 5 } }),
      4,
    );
    const arc = shape?.arcs[0] ?? [];
    const radius = Math.hypot(10, 5);
    close(arc[0], [radius, 0]);
    close(arc.at(-1), [radius * 0.6, radius * 0.8]);
    // The supplement's arc runs from the other side of line a.
    const other = dimensionShape(
      data,
      dim({ type: 'angle', a: e('a'), b: e('s'), supplement: true, label: { x: -10, y: 5 } }),
      4,
    );
    const back = other?.arcs[0] ?? [];
    close(back[0], [-radius, 0]);
    close(back.at(-1), [radius * 0.6, radius * 0.8]);
  });

  it('gives nothing when its geometry is gone', () => {
    expect(dimensionShape(sketch(), dim({ type: 'radius', curve: e('nope') }), 4)).toBeUndefined();
  });

  it('stores a placed label as an offset from the anchor', () => {
    expect(
      labelOffset(sketch(), dim({ type: 'distance', orientation: 'aligned', a: e('a') }), [12, 7]),
    ).toEqual({ x: 2, y: 7 });
  });
});

describe('dimensionText', () => {
  const settings = { units: 'mm' as const, precision: 2 };
  it('shows the value at the document precision, marked by type', () => {
    const length = dim({ type: 'distance', orientation: 'aligned', a: e('a'), expr: '20' });
    expect(dimensionText(length, 20, settings)).toBe('20.00');
    expect(dimensionText(dim({ type: 'radius', curve: e('hole'), expr: '5' }), 5, settings)).toBe(
      'R5.00',
    );
    expect(
      dimensionText(dim({ type: 'diameter', curve: e('hole'), expr: '10 mm' }), 10, settings),
    ).toBe('⌀10.00');
    expect(
      dimensionText(dim({ type: 'angle', a: e('a'), b: e('s'), expr: '45' }), 45, settings),
    ).toBe('45.00°');
  });

  it('marks expressions, driven dimensions and document units', () => {
    const length = dim({ type: 'distance', orientation: 'aligned', a: e('a'), expr: 'w * 2' });
    expect(dimensionText(length, 20, settings)).toBe('fx: 20.00');
    expect(dimensionText({ ...length, driven: true }, 20, settings)).toBe('(20.00)');
    expect(dimensionText({ ...length, expr: '1' }, 25.4, { units: 'in', precision: 3 })).toBe(
      '1.000',
    );
    expect(dimensionText(length, undefined, settings)).toBe('?');
  });
});
