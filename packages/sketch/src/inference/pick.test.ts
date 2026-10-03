import { readFileSync } from 'node:fs';
import type { SketchEntityId } from '@extrudo/core';
import { beforeAll, describe, expect, it } from 'vitest';
import { SketchBuilder } from '../fixtures';
import { loadFont } from '../text/index.js';
import { boxSelect, insideConvex, pickEntity, polylineDistance } from './pick';

const FONTS_DIR = new URL('../../../fonts/fonts/', import.meta.url);
beforeAll(() => loadFont('inter-regular@1', readFileSync(new URL('inter-regular.ttf', FONTS_DIR))));

/** A text entity (P4-03) from (x, y) up to (x, y + 10): upright, left-aligned. */
function addText(b: SketchBuilder, text = 'A', x = 0, y = 0): SketchEntityId {
  const anchor = b.point(x, y);
  const top = b.point(x, y + 10);
  const id = b.id('x');
  b.entities[id] = {
    type: 'text',
    anchor: anchor as never,
    top: top as never,
    text,
    font: 'inter-regular@1',
    align: 'left',
    construction: false,
  } as never;
  return id as SketchEntityId;
}

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

describe('picking text (P4-03)', () => {
  const b = new SketchBuilder();
  const text = addText(b, 'A', 0, 0);

  it('picks a text by any of its glyph curves', () => {
    // The left stem of the A runs up from the anchor; the crossbar is at half the height.
    expect(pickEntity(b.sketch, [2.9, 5], 1)).toBe(text);
    expect(pickEntity(b.sketch, [2.9, 0.4], 1)).toBe(text);
    // Its two points stay pickable as points.
    expect(pickEntity(b.sketch, [0, 10.4], 1)).not.toBe(text);
    // Empty space beside the letter isn't it: only its curves are.
    expect(pickEntity(b.sketch, [25, 5], 1)).toBeUndefined();
  });

  it('boxes a text as one entity', () => {
    const corners: [number, number][] = [
      [-5, -5],
      [20, -5],
      [20, 20],
      [-5, 20],
    ];
    expect(boxSelect(b.sketch, corners, 'window')).toContain(text);
    // A box over empty space next to it takes nothing of it.
    const beside: [number, number][] = [
      [30, -5],
      [50, -5],
      [50, 20],
      [30, 20],
    ];
    expect(boxSelect(b.sketch, beside, 'window')).not.toContain(text);
  });

  it('shapes nothing without a font, and says so', () => {
    const bare = new SketchBuilder();
    const missing = bare.id('x');
    bare.entities[missing] = {
      type: 'text',
      anchor: bare.point(0, 0) as never,
      top: bare.point(0, 10) as never,
      text: 'A',
      font: 'nothing-has-this@1',
      align: 'left',
      construction: false,
    } as never;
    expect(pickEntity(bare.sketch, [3, 5], 1)).toBeUndefined();
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

describe('boxSelect', () => {
  const b = new SketchBuilder();
  const line = b.line(0, 0, 10, 0);
  const circle = b.circle(30, 0, 5);
  const lone = b.point(5, 20);
  const { sketch } = b;
  const box = (x0: number, y0: number, x1: number, y1: number): [number, number][] => [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ];
  const sorted = (ids: string[]) => [...ids].sort();

  it('takes what lies wholly inside a window, points included', () => {
    expect(sorted(boxSelect(sketch, box(-1, -1, 11, 1), 'window'))).toEqual(
      sorted([line.id, line.start, line.end]),
    );
    // Half of the circle is not enough; its center is.
    expect(boxSelect(sketch, box(20, -10, 31, 10), 'window')).toEqual([circle.center]);
  });

  it('takes what a crossing box touches, even with no vertex inside', () => {
    expect(sorted(boxSelect(sketch, box(4, -1, 6, 1), 'crossing'))).toEqual([line.id]);
    expect(sorted(boxSelect(sketch, box(20, -10, 26, 10), 'crossing'))).toEqual([circle.id]);
    // Inside the circle without touching it: nothing.
    expect(boxSelect(sketch, box(29, -1, 29.5, 1), 'crossing')).toEqual([]);
    expect(boxSelect(sketch, box(4, 19, 6, 21), 'crossing')).toEqual([lone]);
  });

  it('works for a tilted quadrilateral of either winding', () => {
    const diamond: [number, number][] = [
      [5, -8],
      [13, 0],
      [5, 8],
      [-3, 0],
    ];
    expect(sorted(boxSelect(sketch, diamond, 'window'))).toEqual(
      sorted([line.id, line.start, line.end]),
    );
    expect(insideConvex([...diamond].reverse(), [5, 0])).toBe(true);
    expect(insideConvex(diamond, [12, 7])).toBe(false);
  });
});
