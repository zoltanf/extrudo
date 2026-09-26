import { describe, expect, it } from 'vitest';
import { SketchBuilder } from '../fixtures';
import { pickEntity, polylineDistance } from './pick';

describe('pickEntity', () => {
  const b = new SketchBuilder();
  const line = b.line(0, 0, 20, 0);
  const circle = b.circle(40, 0, 5);
  const arc = b.arc(0, 30, 10, 0, 90);
  const ellipse = b.ellipse(60, 30, 8, 4);
  const spline = b.spline([
    [0, 60],
    [10, 65],
    [20, 60],
  ]);
  const { sketch } = b;

  it('picks points before the curves they end', () => {
    expect(pickEntity(sketch, [0.5, 0.3], 1)).toBe(line.start);
    expect(pickEntity(sketch, [10, 0.5], 1)).toBe(line.id);
    expect(pickEntity(sketch, [10, 3], 1)).toBeUndefined();
  });

  it('measures to every kind of curve', () => {
    expect(pickEntity(sketch, [45.5, 0], 1)).toBe(circle.id);
    const r = 10 * Math.SQRT1_2;
    expect(pickEntity(sketch, [r + 0.4, 30 + r + 0.4], 1)).toBe(arc.id);
    // Inside the arc's circle but off the arc: nothing.
    expect(pickEntity(sketch, [-10, 30], 1)).toBeUndefined();
    expect(pickEntity(sketch, [64, 33.9], 1)).toBe(ellipse.id);
    expect(pickEntity(sketch, [15, 63.2], 1)).toBe(spline.id);
  });

  it('skips what the filter refuses', () => {
    const curvesOnly = (e: { type: string }) => e.type !== 'point';
    expect(pickEntity(sketch, [0.5, 0.3], 1, curvesOnly)).toBe(line.id);
    expect(pickEntity(sketch, [0.5, 0.3], 1, (e) => e.type === 'circle')).toBeUndefined();
  });

  it('takes the nearest of several candidates', () => {
    const c = new SketchBuilder();
    const low = c.line(0, 0, 10, 0);
    const high = c.line(0, 1, 10, 1);
    expect(pickEntity(c.sketch, [5, 0.4], 1)).toBe(low.id);
    expect(pickEntity(c.sketch, [5, 0.6], 1)).toBe(high.id);
  });
});

describe('polylineDistance', () => {
  it('measures to the nearest segment, ends included', () => {
    const line: [number, number][] = [
      [0, 0],
      [10, 0],
      [10, 10],
    ];
    expect(polylineDistance(line, [5, 2])).toBeCloseTo(2);
    expect(polylineDistance(line, [13, 5])).toBeCloseTo(3);
    expect(polylineDistance(line, [-3, -4])).toBeCloseTo(5);
  });
});
