// Dimensions measured and laid out from resolved anchors (P6-24 S3,
// ADR-0143's S3 amendment), with the anchors' geometry given by hand: a
// front view (looking along +Y, Z up, so view x is world X and view y world
// Z) at (100, 100) on the sheet. `dimensions.kernel.test.ts` does the same
// from shapes the kernel builds.
import { readFileSync, writeFileSync } from 'node:fs';
import {
  keepLastAnchors,
  type Sheet,
  type SheetAnchorReport,
  type SheetAnchors,
  type SheetDimensionItem,
  type SheetId,
  type SheetItemId,
  type SheetViewId,
  sheetStandardFrom,
  type Vec3,
} from '@extrudo/core';
import type { DisplayItem, DisplayPath, DisplayText } from '@extrudo/io';
import { loadFont } from '@extrudo/sketch/text';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  layoutSheetDimension,
  measureSheetDimension,
  SHEET_DIMENSION,
  sheetDimensionText,
} from './dimensions';
import { layoutSheet } from './layout';
import { sheetToSvg } from './output';
import { SHEET_FONT, textWidth } from './text';

beforeAll(() => {
  const fonts = new URL('../../fonts/fonts/', import.meta.url);
  loadFont(SHEET_FONT.regular, readFileSync(new URL('inter-regular.ttf', fonts)));
  loadFont(SHEET_FONT.bold, readFileSync(new URL('inter-bold.ttf', fonts)));
});

const FRONT = 'front' as SheetViewId;

function sheetOf(items: SheetDimensionItem[], scale: [number, number] = [1, 1]): Sheet {
  return {
    id: 's1' as SheetId,
    name: 'Sheet 1',
    size: [200, 150],
    orientation: 'landscape',
    scale,
    projection: 'first',
    decimals: 1,
    views: [
      {
        id: FRONT,
        name: 'Front',
        at: [100, 100],
        from: sheetStandardFrom('front'),
      },
    ],
    items,
  };
}

const fp = (at: [number, number, number]) => ({ type: 'line', at });
const edge = (id: string, at: [number, number, number] = [0, 0, 0]) => ({
  ref: { kind: 'edge' as const, id, fingerprint: fp(at) },
});
const line = (start: Vec3, end: Vec3): SheetAnchorReport => ({
  status: 'ok',
  geometry: { type: 'line', start, end },
});
const point = (p: Vec3): SheetAnchorReport => ({
  status: 'ok',
  geometry: { type: 'point', point: p },
});
/** A circle facing the front view. */
const circle = (centre: Vec3, radius: number): SheetAnchorReport => ({
  status: 'ok',
  geometry: { type: 'circle', centre, axis: [0, 1, 0], xDirection: [1, 0, 0], radius },
});

function dim(
  id: string,
  type: SheetDimensionItem['type'],
  at: [number, number],
  anchors: SheetDimensionItem['anchors'],
  more: Partial<SheetDimensionItem> = {},
): SheetDimensionItem {
  return { kind: 'dimension', id: id as SheetItemId, view: FRONT, type, anchors, at, ...more };
}

const paths = (items: DisplayItem[]) => items.filter((i): i is DisplayPath => i.type === 'path');
const texts = (items: DisplayItem[]) => items.filter((i): i is DisplayText => i.type === 'text');
const r2 = (v: number) => Math.round(v * 100) / 100 + 0;
const pt = (p: readonly number[]) => `${r2(p[0] as number)},${r2(p[1] as number)}`;
/** Each line of the dimension's line path, as "x,y-x,y". */
const lines = (items: DisplayItem[]) =>
  (paths(items).find((p) => p.stroke)?.contours ?? []).map((c) => {
    const last = c.segments.at(-1);
    return `${pt(c.start)}-${pt(last?.to ?? c.start)}`;
  });
/** Each arrowhead's tip. */
const tips = (items: DisplayItem[]) =>
  (paths(items).find((p) => p.fill)?.contours ?? []).map((c) => pt(c.start));

/** A 10 × 30 box's front: its top edge from (−5, 30) to (5, 30), its left edge from (−5, 0) up. */
const TOP_EDGE = line([-5, -10, 30], [5, -10, 30]);
const LEFT_EDGE = line([-5, -10, 0], [-5, -10, 30]);

describe('linear dimensions', () => {
  it('measures an edge horizontally: extension lines, the line, arrowheads in, the text above', () => {
    const item = dim('d1', 'linear', [0, 40], [edge('top')]);
    const sheet = sheetOf([item]);
    const anchors: SheetAnchors = { [item.id]: [TOP_EDGE] };
    expect(measureSheetDimension(sheet, item, anchors)).toEqual({
      value: 10,
      text: '10.0',
      state: 'ok',
    });
    const out = layoutSheetDimension(sheet, item, anchors);
    expect(out.every((i) => i.key === 'item:d1' && i.state === undefined)).toBe(true);
    // The top edge is at sheet y 70; the dimension line at 60 (view y 40).
    expect(lines(out)).toEqual(['95,69-95,58', '105,69-105,58', '95,60-105,60']);
    expect(tips(out)).toEqual(['95,60', '105,60']);
    const [text] = texts(out);
    expect(text?.text).toBe('10.0');
    expect(text?.height).toBe(SHEET_DIMENSION.text);
    expect(r2((text?.at[0] ?? 0) + (text?.width ?? 0) / 2)).toBe(100);
    expect(text?.at[1]).toBeCloseTo(59, 9);
    expect(text?.angle).toBeUndefined();
    const stroke = paths(out).find((p) => p.stroke)?.stroke;
    expect(stroke?.width).toBe(0.18);
  });

  it('keeps the value at another scale and draws at that scale', () => {
    const item = dim('d1', 'linear', [0, 40], [edge('top')]);
    const sheet = sheetOf([item], [1, 2]);
    const anchors: SheetAnchors = { [item.id]: [TOP_EDGE] };
    expect(measureSheetDimension(sheet, item, anchors).value).toBe(10);
    // At 1:2 the edge is 5 mm long at y 85, the line at y 80; arrowheads outside (no room).
    const out = layoutSheetDimension(sheet, item, anchors);
    expect(lines(out)).toEqual(['97.5,84-97.5,78', '102.5,84-102.5,78', '92.5,80-107.5,80']);
    expect(tips(out)).toEqual(['97.5,80', '102.5,80']);
  });

  it('measures vertically with its text reading from the right, and chooses the direction by where it is', () => {
    const item = dim('d2', 'linear', [-20, 15], [edge('left')]);
    const sheet = sheetOf([item]);
    const anchors: SheetAnchors = { [item.id]: [LEFT_EDGE] };
    expect(measureSheetDimension(sheet, item, anchors).text).toBe('30.0');
    const out = layoutSheetDimension(sheet, item, anchors);
    expect(lines(out)).toEqual(['94,100-78,100', '94,70-78,70', '80,100-80,70']);
    const [text] = texts(out);
    expect(text?.angle).toBeCloseTo(-Math.PI / 2, 9);
    // Two corners: beside them it is vertical, above them horizontal, elsewhere aligned.
    const corners = [point([-5, -10, 0]), point([5, -10, 30])];
    const at = (at: [number, number], direction?: SheetDimensionItem['direction']) => {
      const d = dim('d3', 'linear', at, [edge('a'), edge('b')], direction ? { direction } : {});
      return measureSheetDimension(sheetOf([d]), d, { [d.id]: corners }).value;
    };
    expect(at([20, 15])).toBe(30);
    expect(at([0, 45])).toBe(10);
    expect(at([20, 45])).toBeCloseTo(Math.hypot(10, 30), 9);
    expect(at([20, 45], 'horizontal')).toBe(10);
    expect(at([0, 45], 'vertical')).toBe(30);
    expect(at([0, 45], 'aligned')).toBeCloseTo(Math.hypot(10, 30), 9);
  });

  it('measures an aligned distance between two points, its text along the line', () => {
    const item = dim('d4', 'linear', [10, 25], [edge('a', [0, 0, 0]), { free: [30, 40] }], {
      direction: 'aligned',
    });
    const sheet = sheetOf([item]);
    const anchors: SheetAnchors = { [item.id]: [point([0, 0, 0]), { status: 'ok' }] };
    expect(measureSheetDimension(sheet, item, anchors).value).toBeCloseTo(50, 9);
    const [text] = texts(layoutSheetDimension(sheet, item, anchors));
    // Up and to the right on the sheet: 53.13° above the horizontal.
    expect(text?.angle).toBeCloseTo(-Math.atan2(40, 30), 9);
  });

  it('measures from a point to a line, between parallel lines, and refuses lines that are not', () => {
    const toLine = dim('d5', 'linear', [0, 50], [edge('p'), edge('l')]);
    const value = (item: SheetDimensionItem, reports: SheetAnchorReport[]) =>
      measureSheetDimension(sheetOf([item]), item, { [item.id]: reports });
    expect(value(toLine, [point([0, 0, 10]), TOP_EDGE]).value).toBe(20);
    const across = dim('d6', 'linear', [0, 50], [edge('a'), edge('b')]);
    expect(value(across, [line([-5, 0, 0], [5, 0, 0]), TOP_EDGE]).value).toBe(30);
    expect(value(across, [LEFT_EDGE, TOP_EDGE])).toMatchObject({
      value: undefined,
      text: '?',
      state: 'invalid',
      message: expect.stringMatching(/aren't parallel/),
    });
    // A circle's whole edge stands for its centre.
    expect(value(across, [circle([0, 0, 0], 3), circle([0, 0, 25], 3)]).value).toBe(25);
  });
});

describe('radius, diameter and angle', () => {
  it('draws a radius from the centre through the rim to a shelf under its text', () => {
    const item = dim('r1', 'radius', [10, 25], [edge('rim')]);
    const sheet = sheetOf([item]);
    const anchors: SheetAnchors = { [item.id]: [circle([0, -10, 15], 5)] };
    expect(measureSheetDimension(sheet, item, anchors)).toMatchObject({ value: 5, text: 'R5.0' });
    const out = layoutSheetDimension(sheet, item, anchors);
    // Centre (100, 85); the rim towards the text at 45°; the text at (110, 75).
    expect(tips(out)).toEqual(['103.54,81.46']);
    const w = textWidth('R5.0', SHEET_DIMENSION.text);
    expect(lines(out)).toEqual(['100,85-110,75', `110,75-${pt([110 + w + 1, 75])}`]);
    const [text] = texts(out);
    expect(text?.at[0]).toBeCloseTo(110.5, 9);
    expect(text?.at[1]).toBeCloseTo(74, 9);
  });

  it('draws a diameter across the circle with two arrowheads, of a face or of two outlines', () => {
    const item = dim('r2', 'diameter', [-10, 5], [edge('rim')]);
    const sheet = sheetOf([item]);
    const anchors: SheetAnchors = { [item.id]: [circle([0, -10, 15], 5)] };
    expect(measureSheetDimension(sheet, item, anchors).text).toBe('Ø10.0');
    const out = layoutSheetDimension(sheet, item, anchors);
    expect(tips(out)).toEqual(['96.46,88.54', '103.54,81.46']);
    // A cylinder from the side: across its outlines, like a linear dimension.
    const sides = dim('r3', 'diameter', [0, 25], [
      { ...edge('wall'), silhouette: 1 },
      { ...edge('wall'), silhouette: -1 },
    ] as SheetDimensionItem['anchors']);
    const outline = (x: number): SheetAnchorReport => ({
      status: 'ok',
      geometry: { type: 'silhouette', start: [x, 0, 0], end: [x, 0, 20] },
    });
    const both = { [sides.id]: [outline(-5), outline(5)] };
    expect(measureSheetDimension(sheetOf([sides]), sides, both)).toMatchObject({
      value: 10,
      text: 'Ø10.0',
    });
    expect(tips(layoutSheetDimension(sheetOf([sides]), sides, both))).toEqual(['95,75', '105,75']);
  });

  it('measures the angle between two edges in the sector its text is in', () => {
    const item = dim('a1', 'angle', [8, 3], [edge('a'), edge('b')]);
    const sheet = sheetOf([item]);
    const anchors: SheetAnchors = {
      [item.id]: [line([0, 0, 0], [10, 0, 0]), line([0, 0, 0], [10, 0, 10])],
    };
    const measured = measureSheetDimension(sheet, item, anchors);
    expect(measured.value).toBeCloseTo(45, 9);
    expect(measured.text).toBe('45.0°');
    const out = layoutSheetDimension(sheet, item, anchors);
    const arc = paths(out).find((p) => p.stroke)?.contours[0]?.segments[0];
    expect(arc).toMatchObject({ type: 'arc', center: [100, 100] });
    expect((arc as { sweep: number }).sweep).toBeCloseTo(-Math.PI / 4, 9);
    // The other side of the first line: 135°.
    const obtuse = { ...item, at: [-8, 3] as [number, number] };
    expect(measureSheetDimension(sheetOf([obtuse]), obtuse, anchors).value).toBeCloseTo(135, 9);
    expect(
      measureSheetDimension(sheet, item, { [item.id]: [TOP_EDGE, line([0, 0, 0], [3, 0, 0])] }),
    ).toMatchObject({ state: 'invalid', text: '?°' });
  });
});

describe('text', () => {
  it('takes the decimals of the item or the sheet, before and after, brackets, and the unit', () => {
    const base = dim('t1', 'linear', [0, 0], [edge('e')]);
    expect(sheetDimensionText({ decimals: 1 }, base, 12.345)).toBe('12.3');
    expect(sheetDimensionText({ decimals: 1 }, { ...base, decimals: 3 }, 12.345)).toBe('12.345');
    expect(sheetDimensionText({ decimals: 0 }, base, -0.2)).toBe('0');
    expect(sheetDimensionText({ decimals: 2 }, base, 25.4, { units: 'in' })).toBe('1.00');
    expect(
      sheetDimensionText(
        { decimals: 1 },
        { ...base, type: 'diameter', before: '4× ', after: ' H7', reference: true },
        6,
      ),
    ).toBe('(4× Ø6.0 H7)');
    expect(sheetDimensionText({ decimals: 0 }, { ...base, type: 'angle' }, 30)).toBe('30°');
    expect(sheetDimensionText({ decimals: 1 }, { ...base, type: 'radius' }, undefined)).toBe('R?');
  });
});

describe('moved and detached anchors', () => {
  it('a moved anchor draws as usual, marked moved, its text following the geometry', () => {
    const item = dim('m1', 'linear', [0, 40], [edge('top', [0, -10, 30])]);
    const sheet = sheetOf([item]);
    // The edge rose by 10 since it was picked.
    const moved: SheetAnchorReport = {
      status: 'moved',
      geometry: { type: 'line', start: [-5, -10, 40], end: [5, -10, 40] },
      resolved: { kind: 'edge', id: 'top2', fingerprint: fp([0, -10, 40]) },
    };
    const out = layoutSheetDimension(sheet, item, { [item.id]: [moved] });
    expect(out.every((i) => i.state === 'moved')).toBe(true);
    // The line 10 mm higher too: y 50 where it was 60.
    expect(tips(out)).toEqual(['95,50', '105,50']);
    expect(measureSheetDimension(sheet, item, { [item.id]: [moved] }).state).toBe('moved');
  });

  it('a detached one with no geometry is its text alone at `at`, marked detached', () => {
    const item = dim('x1', 'radius', [10, 25], [edge('rim')]);
    const sheet = sheetOf([item]);
    for (const anchors of [undefined, { [item.id]: [{ status: 'detached' }] } as SheetAnchors]) {
      const out = layoutSheetDimension(sheet, item, anchors);
      expect(out).toHaveLength(1);
      expect(out[0]).toMatchObject({ type: 'text', text: 'R?', state: 'detached', key: 'item:x1' });
      const t = out[0] as DisplayText;
      expect(r2(t.at[0] + t.width / 2)).toBe(110);
      expect(measureSheetDimension(sheet, item, anchors)).toMatchObject({
        value: undefined,
        state: 'detached',
        message: expect.stringMatching(/lost its edge/),
      });
    }
  });

  it('a detached one keeps the geometry the app last had (keepLastAnchors), still detached', () => {
    const item = dim('x2', 'linear', [0, 40], [edge('top', [0, -10, 30])]);
    const sheet = sheetOf([item]);
    const before: SheetAnchors = {
      [item.id]: [
        { ...TOP_EDGE, resolved: { kind: 'edge', id: 'top', fingerprint: fp([0, -10, 30]) } },
      ],
    };
    const now = keepLastAnchors(before, { [item.id]: [{ status: 'detached' }] });
    expect(now[item.id]?.[0]?.status).toBe('detached');
    const out = layoutSheetDimension(sheet, item, now);
    expect(out.every((i) => i.state === 'detached')).toBe(true);
    expect(tips(out)).toEqual(['95,60', '105,60']);
    expect(measureSheetDimension(sheet, item, now)).toMatchObject({ value: 10, state: 'detached' });
    // Resolved again, it is the fresh report.
    expect(keepLastAnchors(now, before)).toEqual(before);
  });

  it('a detached one says the kernel’s reason when it has one, kept geometry or not', () => {
    const item = dim('x4', 'linear', [0, 40], [edge('top', [0, -10, 30])]);
    const sheet = sheetOf([item]);
    const why =
      'Pocket, the feature this was measured on, has an error. Fix it to show the dimension again.';
    const lost: SheetAnchors = { [item.id]: [{ status: 'detached', message: why }] };
    expect(measureSheetDimension(sheet, item, lost)).toMatchObject({
      state: 'detached',
      message: why,
    });
    const before: SheetAnchors = { [item.id]: [TOP_EDGE] };
    expect(measureSheetDimension(sheet, item, keepLastAnchors(before, lost))).toMatchObject({
      value: 10,
      state: 'detached',
      message: why,
    });
  });

  it('an anchor that resolves but gives nothing is invalid, with the kernel’s reason', () => {
    const item = dim('x3', 'linear', [0, 40], [{ ...edge('top'), at: 'centre' }, { free: [0, 0] }]);
    const sheet = sheetOf([item]);
    const anchors: SheetAnchors = {
      [item.id]: [
        { status: 'ok', message: 'The edge has no centre: it is not a circle or an ellipse.' },
        { status: 'ok' },
      ],
    };
    expect(measureSheetDimension(sheet, item, anchors)).toMatchObject({
      state: 'invalid',
      message: expect.stringMatching(/no centre/),
    });
    expect(layoutSheetDimension(sheet, item, anchors)).toHaveLength(1);
  });
});

describe('in layoutSheet', () => {
  it('draws the dimensions after the views, in order, and leaves out one whose view is gone', () => {
    const a = dim('d1', 'linear', [0, 40], [edge('top')]);
    const b = { ...dim('d2', 'linear', [0, 40], [edge('top')]), view: 'gone' as SheetViewId };
    const sheet = sheetOf([a, b]);
    const list = layoutSheet(sheet, { anchors: { [a.id]: [TOP_EDGE], [b.id]: [TOP_EDGE] } });
    const keys = [...new Set(list.items.map((i) => i.key))];
    expect(keys).toEqual(['paper', 'view:front', 'item:d1']);
  });

  it('matches the golden file of a small sheet with each type', () => {
    const items = [
      dim('d1', 'linear', [0, 40], [edge('top')]),
      dim('d2', 'linear', [-20, 15], [edge('left')]),
      dim('d3', 'radius', [20, 25], [edge('rim')]),
      dim('d4', 'diameter', [-15, 0], [edge('rim')], { reference: true }),
      dim('d5', 'angle', [12, 5], [edge('a'), edge('b')]),
    ];
    const sheet = sheetOf(items);
    const anchors: SheetAnchors = {
      d1: [TOP_EDGE],
      d2: [LEFT_EDGE],
      d3: [circle([0, -10, 15], 4)],
      d4: [circle([0, -10, 15], 4)],
      d5: [line([5, -10, 0], [-5, -10, 0]), line([5, -10, 0], [5, -10, 30])],
    } as SheetAnchors;
    const box = {
      curves: [
        {
          kind: 'visible' as const,
          contours: [
            {
              start: [-5, 0] as const,
              segments: [
                { type: 'line' as const, to: [5, 0] as const },
                { type: 'line' as const, to: [5, 30] as const },
                { type: 'line' as const, to: [-5, 30] as const },
                { type: 'line' as const, to: [-5, 0] as const },
              ],
              closed: true,
            },
          ],
        },
      ],
    };
    const svg = sheetToSvg(sheet, { views: new Map([[FRONT, box]]), anchors });
    const path = new URL('./golden/dimensions.svg', import.meta.url);
    if (process.env.UPDATE_GOLDEN) writeFileSync(path, svg);
    expect(svg).toBe(readFileSync(path, 'utf8'));
  });
});
