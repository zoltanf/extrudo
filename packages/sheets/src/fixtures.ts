/**
 * Sample sheets for the tests and the gated sample file (not exported): an
 * A3 landscape with zones, the full title block, texts and two views, an A4
 * portrait with the simple title block, and a small custom sheet with a text
 * alone.
 */

import type { Sheet, SheetId, SheetItemId, SheetViewId } from '@extrudo/core';
import type { Contour } from '@extrudo/io';
import type { SheetViewLines } from './layout';

export const IDS = {
  a3: '00000000-0000-4000-8000-000000000001' as SheetId,
  a4: '00000000-0000-4000-8000-000000000002' as SheetId,
  custom: '00000000-0000-4000-8000-000000000003' as SheetId,
  front: '00000000-0000-4000-8000-000000000011' as SheetViewId,
  top: '00000000-0000-4000-8000-000000000012' as SheetViewId,
  notes: '00000000-0000-4000-8000-000000000021' as SheetItemId,
  heading: '00000000-0000-4000-8000-000000000022' as SheetItemId,
  small: '00000000-0000-4000-8000-000000000023' as SheetItemId,
};

export const A3: Sheet = {
  id: IDS.a3,
  name: 'Assembly',
  size: 'A3',
  orientation: 'landscape',
  scale: [1, 2],
  projection: 'first',
  decimals: 1,
  border: { zones: true },
  titleBlock: {
    template: 'full',
    fields: {
      title: 'Box with a lid',
      drawnBy: 'J. Maker',
      date: '2026-11-11',
      units: 'mm',
      material: 'PLA',
      partNumber: 'BX-001',
    },
  },
  views: [
    {
      id: IDS.front,
      name: 'Front',
      at: [120, 110],
      from: { kind: 'base', direction: [0, 1, 0], up: [0, 0, 1] },
      label: true,
    },
    {
      id: IDS.top,
      name: 'Top',
      at: [120, 200],
      from: { kind: 'projected', parent: IDS.front, side: 'below' },
    },
  ],
  items: [
    { kind: 'text', id: IDS.heading, at: [250, 40], text: 'NOTES', size: 5 },
    {
      kind: 'text',
      id: IDS.notes,
      at: [250, 50],
      text: '1. The lid clears the box by 0.20 mm all round, Ø12 ±0.1 at 45°.\n2. Wall and floor 3 mm.',
      width: 120,
    },
  ],
};

export const A4: Sheet = {
  id: IDS.a4,
  name: 'Lid',
  size: 'A4',
  orientation: 'portrait',
  scale: [1, 1],
  projection: 'third',
  decimals: 2,
  border: {},
  titleBlock: { template: 'simple', fields: { title: 'Lid', version: 'V3' } },
  views: [],
  items: [],
};

export const CUSTOM: Sheet = {
  id: IDS.custom,
  name: 'Label',
  size: [100, 150],
  orientation: 'landscape',
  scale: [1, 1],
  projection: 'first',
  decimals: 0,
  views: [],
  items: [{ kind: 'text', id: IDS.small, at: [10, 10], text: 'Hello, sheet', size: 7 }],
};

export const SAMPLE_SHEETS: Sheet[] = [A3, A4, CUSTOM];

const line = (a: [number, number], b: [number, number]): Contour => ({
  start: a,
  segments: [{ type: 'line', to: b }],
  closed: false,
});

const box = (x0: number, y0: number, x1: number, y1: number): Contour => ({
  start: [x0, y0],
  segments: [
    { type: 'line', to: [x1, y0] },
    { type: 'line', to: [x1, y1] },
    { type: 'line', to: [x0, y1] },
    { type: 'line', to: [x0, y0] },
  ],
  closed: true,
});

/**
 * The front view's lines in its own frame (mm at 1:1, y up): a 160 × 80
 * plate with a hole, the hole's hidden sides and its centre line.
 */
export const FRONT_LINES: SheetViewLines = {
  curves: [
    { kind: 'visible', contours: [box(-80, -40, 80, 40)] },
    {
      kind: 'visible',
      contours: [
        {
          start: [30, 0],
          segments: [{ type: 'arc', center: [20, 0], sweep: 2 * Math.PI, to: [30, 0] }],
          closed: true,
        },
      ],
    },
    // An arc of a quarter turn, counter-clockwise in the view (y up): from +x to +y.
    {
      kind: 'visible',
      contours: [
        {
          start: [-50, 0],
          segments: [{ type: 'arc', center: [-60, 0], sweep: Math.PI / 2, to: [-60, 10] }],
          closed: false,
        },
      ],
    },
    { kind: 'hidden', contours: [line([-80, 30], [80, 30])] },
    { kind: 'centre', contours: [line([20, -48], [20, 48])] },
    { kind: 'tangent', contours: [line([-80, -30], [80, -30])] },
  ],
};
