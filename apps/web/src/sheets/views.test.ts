import {
  createDocument,
  createDocumentStore,
  createSessionStore,
  type Sheet,
  type SheetId,
  type SheetView,
  type SheetViewId,
  sheetStandardFrom,
} from '@extrudo/core';
import { describe, expect, it } from 'vitest';
import { memoryPreferences } from '../platform';
import { createViewportStore } from '../viewport/store';
import { createSheet } from './mode';
import { viewDeltas } from './selection';
import { sheetRoom, standardLayout, standardSides } from './standardViews';
import {
  fitScale,
  projectedAt,
  projectedName,
  projectedSide,
  rescaleSheetView,
  SCALES_DOWN,
} from './views';

const F = 'f' as SheetViewId;
const R = 'r' as SheetViewId;
const T = 't' as SheetViewId;
const I = 'i' as SheetViewId;
const RR = 'rr' as SheetViewId;

/** Front with its right side, its top below and an isometric; the right side's own right. */
const VIEWS: SheetView[] = [
  { id: F, name: 'Front', at: [100, 100], from: sheetStandardFrom('front') },
  { id: R, name: 'Left', at: [200, 100], from: { kind: 'projected', parent: F, side: 'right' } },
  { id: T, name: 'Top', at: [100, 200], from: { kind: 'projected', parent: F, side: 'below' } },
  {
    id: I,
    name: 'Isometric',
    at: [300, 50],
    from: { kind: 'projected', parent: F, side: 'iso-above-right' },
  },
  { id: RR, name: 'Back', at: [300, 100], from: { kind: 'projected', parent: R, side: 'right' } },
];

const SHEET: Sheet = {
  id: 's1' as SheetId,
  name: 'Sheet 1',
  size: 'A3',
  orientation: 'landscape',
  scale: [1, 1],
  projection: 'first',
  decimals: 1,
  border: {},
  views: VIEWS,
  items: [],
};

describe('Projected View: the side, the place and the name from the pointer', () => {
  it('chooses beside, above or below near an axis and an isometric on a diagonal', () => {
    expect(projectedSide(10, 1)).toBe('right');
    expect(projectedSide(-10, -4)).toBe('left');
    // Sheet y goes down: a point above the parent has a negative dy.
    expect(projectedSide(1, -10)).toBe('above');
    expect(projectedSide(-4, 10)).toBe('below');
    expect(projectedSide(10, -10)).toBe('iso-above-right');
    expect(projectedSide(-10, 8)).toBe('iso-below-left');
  });

  it('keeps a view beside or above its parent exactly on the parent’s line', () => {
    const bounds = { min: [-10, 0], max: [10, 20] };
    // Beside: the parent's at.y; the middle of its lines under the pointer across.
    expect(projectedAt('right', [250, 87], [100, 100], bounds, 2)).toEqual([250, 100]);
    // Below: the parent's at.x.
    expect(projectedAt('below', [97, 230], [100, 100], bounds, 2)).toEqual([100, 250]);
    // An isometric one goes where the pointer is.
    expect(projectedAt('iso-below-left', [40, 220], [100, 100], bounds, 2)).toEqual([40, 240]);
  });

  it('names the view after the standard view it is', () => {
    expect(projectedName('below', [0, 0, -1])).toBe('Top');
    expect(projectedName('iso-above-right', [1, 1, 1])).toBe('Isometric');
    expect(projectedName('right', [0.6, 0.8, 0])).toBe('Projected');
  });
});

describe('moving projected views (plan §4.2)', () => {
  const sheets = [SHEET];

  it('keeps a projected view on its parent’s line unless Alt frees it', () => {
    expect(viewDeltas(sheets, ['view:r'], 5, 7).get(R)).toEqual([5, 0]);
    expect(viewDeltas(sheets, ['view:t'], 5, 7).get(T)).toEqual([0, 7]);
    expect(viewDeltas(sheets, ['view:i'], 5, 7).get(I)).toEqual([5, 7]);
    expect(viewDeltas(sheets, ['view:r'], 5, 7, true).get(R)).toEqual([5, 7]);
  });

  it('carries the views projected from a moved view along the line they share, at any depth', () => {
    const moves = viewDeltas(sheets, ['view:f'], 5, 7);
    expect(Object.fromEntries(moves)).toEqual({
      f: [5, 7],
      r: [0, 7],
      t: [5, 0],
      i: [5, 7],
      rr: [0, 7],
    });
  });

  it('moves a projected view fully when its parent moves with it', () => {
    expect(viewDeltas(sheets, ['view:f', 'view:r'], 5, 7).get(R)).toEqual([5, 7]);
  });
});

function stores() {
  const store = createDocumentStore(createDocument());
  return {
    store,
    session: createSessionStore(),
    viewport: createViewportStore({ preferences: memoryPreferences(), reducedMotion: () => true }),
  };
}

describe('a view’s scale', () => {
  it('rescales a base view about its middle and its projected views with it, one undo step', () => {
    const s = stores();
    const id = createSheet(s, {}, new Date(2026, 10, 11), { views: VIEWS });
    const sheet = () => s.store.getState().doc.sheets?.find((x) => x.id === id) as Sheet;
    // The front's lines from (0,0) to (20,20): their middle at (110, 90) on the sheet.
    expect(rescaleSheetView(s, sheet(), F, [2, 1], { min: [0, 0], max: [20, 20] })).toBeUndefined();
    const at = (v: SheetViewId) => sheet().views.find((x) => x.id === v)?.at;
    expect(sheet().views.find((x) => x.id === F)?.scale).toEqual([2, 1]);
    expect(at(F)).toEqual([90, 110]);
    // Each one keeps its place against the front, doubled.
    expect(at(R)).toEqual([290, 110]);
    expect(at(T)).toEqual([90, 310]);
    expect(at(I)).toEqual([490, 10]);
    // One undo puts every view back; the next takes the sheet away.
    s.store.getState().undo();
    expect(sheet().views.map((v) => v.at)).toEqual(VIEWS.map((v) => v.at));
    expect(sheet().views.find((x) => x.id === F)?.scale).toBeUndefined();
    s.store.getState().undo();
    expect(s.store.getState().doc.sheets ?? []).toHaveLength(0);
  });

  it('fits the largest standard scale, else the smallest', () => {
    expect(fitScale(100, 50, 380, 200)).toEqual([2, 1]);
    expect(fitScale(100, 50, 90, 200)).toEqual([1, 2]);
    expect(fitScale(1e6, 1, 380, 200)).toEqual(SCALES_DOWN.at(-1));
  });
});

describe('Standard views (New drawing)', () => {
  const room = { x: 20, y: 20, width: 380, height: 200 };
  const boxes = {
    front: { min: [-50, 0], max: [50, 50] },
    top: { min: [-50, -40], max: [50, 0] },
    side: { min: [-20, 0], max: [20, 50] },
    iso: { min: [-40, -10], max: [40, 70] },
  };

  it('lays the four out lined up at the largest scale that fits, centred', () => {
    const { scale, fit, at } = standardLayout(room, boxes, 'first');
    // Across 100 + 40 + 80 and two gaps; down 80 + 40 and a gap: 2:1 is 480 mm wide.
    expect(scale).toEqual([1, 1]);
    expect(fit).toEqual([1, 1]);
    expect(at.top[0]).toBe(at.front[0]);
    expect(at.side[1]).toBe(at.front[1]);
    // First angle: the top view below the front.
    expect(at.top[1]).toBeGreaterThan(at.front[1]);
    // The grid (260 × 140 mm) is centred in the room: the front's left edge at 80.
    expect(at.front[0] - 50).toBe(80);
  });

  it('puts the top view above in third angle, and takes a given scale', () => {
    const { scale, fit, at } = standardLayout(room, boxes, 'third', [1, 2]);
    expect(scale).toEqual([1, 2]);
    expect(fit).toEqual([1, 1]);
    expect(at.top[1]).toBeLessThan(at.front[1]);
    expect(standardSides('third').top).toBe('above');
    expect(standardSides('first').top).toBe('below');
  });

  it('keeps clear of the border and the title block', () => {
    const none = sheetRoom({ size: 'A3', orientation: 'landscape' }, 'none');
    const simple = sheetRoom({ size: 'A3', orientation: 'landscape' }, 'simple');
    expect(none.width).toBe(simple.width);
    expect(simple.height).toBeLessThan(none.height);
    expect(none.x).toBeGreaterThan(10);
  });
});
