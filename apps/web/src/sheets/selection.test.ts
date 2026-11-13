import {
  addSheet,
  createDocument,
  createDocumentStore,
  type Sheet,
  type SheetDimensionItem,
  type SheetId,
  type SheetItem,
  type SheetItemId,
  type SheetView,
  type SheetViewId,
} from '@extrudo/core';
import type { Contour, DisplayList } from '@extrudo/io';
import { describe, expect, it } from 'vitest';
import {
  deleteTargets,
  hitTarget,
  keyOfTarget,
  movable,
  moveCommands,
  moveTargets,
  selectedTargets,
  sheetSelection,
  sheetTarget,
  targetBoxes,
  targetName,
  targetsInside,
} from './selection';

/** A closed rectangle, mm, y down. */
function rect(x0: number, y0: number, x1: number, y1: number): Contour {
  return {
    start: [x0, y0],
    segments: [
      { type: 'line', to: [x1, y0] },
      { type: 'line', to: [x1, y1] },
      { type: 'line', to: [x0, y1] },
      { type: 'line', to: [x0, y0] },
    ],
    closed: true,
  };
}

/** The paper, the border, a view's frame with a text inside it, and a title-block field. */
const LIST: DisplayList = {
  width: 420,
  height: 297,
  items: [
    { type: 'path', key: 'paper', contours: [rect(0, 0, 420, 297)], fill: { color: '#ffffff' } },
    { type: 'path', key: 'border', contours: [rect(10, 10, 410, 287)], stroke: { width: 0.5 } },
    { type: 'path', key: 'view:v1', contours: [rect(50, 50, 150, 120)], stroke: { width: 0.4 } },
    {
      type: 'text',
      key: 'item:t1',
      text: 'Note',
      outline: [rect(60, 60, 80, 65)],
      at: [60, 65],
      height: 5,
      width: 20,
    },
    {
      type: 'text',
      key: 'title-block:title',
      text: 'Bracket',
      outline: [rect(300, 260, 340, 265)],
      at: [300, 265],
      height: 5,
      width: 40,
    },
  ],
};

const sheet: Sheet = {
  id: 's1' as SheetId,
  name: 'Sheet 1',
  size: 'A3',
  orientation: 'landscape',
  scale: [1, 1],
  projection: 'first',
  decimals: 1,
  views: [
    {
      id: 'v1' as SheetViewId,
      name: 'Front',
      at: [100, 85],
      from: { kind: 'base', direction: [0, 1, 0], up: [0, 0, 1] },
    },
    {
      id: 'v2' as SheetViewId,
      name: 'Right',
      at: [220, 85],
      from: { kind: 'projected', parent: 'v1' as SheetViewId, side: 'right' },
    },
  ],
  items: [
    { kind: 'text', id: 't1' as SheetItemId, at: [60, 60], text: 'Note\nsecond line' },
    { kind: 'text', id: 't2' as SheetItemId, at: [20, 200], text: 'Other' },
  ],
};

function withSheet() {
  const store = createDocumentStore(createDocument());
  store.getState().dispatch(addSheet({ sheet }));
  const now = () => store.getState().doc.sheets?.[0] as Sheet;
  return { store, now };
}

/** An item's `at`, for the kinds that have one (a centre mark or line has none). */
const atOf = (item: unknown) => (item as { at?: unknown } | undefined)?.at;

describe('sheet targets (selection by display key, P6-24)', () => {
  it('maps display keys to targets; the paper and the border are not selectable', () => {
    expect(sheetTarget('item:t1')).toBe('item:t1');
    expect(sheetTarget('view:v1')).toBe('view:v1');
    expect(sheetTarget('title-block')).toBe('title-block');
    expect(sheetTarget('title-block:title')).toBe('title-block');
    expect(sheetTarget('paper')).toBeUndefined();
    expect(sheetTarget('border')).toBeUndefined();
    expect(sheetTarget(undefined)).toBeUndefined();
    expect(keyOfTarget('title-block:date', 'title-block')).toBe(true);
    expect(keyOfTarget('item:t2', 'item:t1')).toBe(false);
  });

  it('round-trips through the session selection, ignoring other kinds', () => {
    const selection = [...sheetSelection(['item:t1', 'view:v1']), { kind: 'body', id: 'b' }];
    expect(selectedTargets(selection as never)).toEqual(['item:t1', 'view:v1']);
  });

  it('boxes each target, hits the smallest box under the point, and box-selects whole boxes', () => {
    const boxes = targetBoxes(LIST);
    expect([...boxes.keys()]).toEqual(['view:v1', 'item:t1', 'title-block']);
    // The stroke widens the view's box by half its width.
    expect(boxes.get('view:v1')).toEqual({ minX: 49.8, minY: 49.8, maxX: 150.2, maxY: 120.2 });
    // The text inside the view's frame wins over the view.
    expect(hitTarget(boxes, 70, 62, 0)).toBe('item:t1');
    expect(hitTarget(boxes, 120, 100, 0)).toBe('view:v1');
    expect(hitTarget(boxes, 200, 200, 0)).toBeUndefined();
    // The slack reaches a box just outside the point.
    expect(hitTarget(boxes, 320, 268, 0)).toBeUndefined();
    expect(hitTarget(boxes, 320, 268, 4)).toBe('title-block');
    expect(targetsInside(boxes, { minX: 55, minY: 55, maxX: 90, maxY: 70 })).toEqual(['item:t1']);
    expect(targetsInside(boxes, { minX: 0, minY: 0, maxX: 200, maxY: 200 })).toEqual([
      'view:v1',
      'item:t1',
    ]);
  });

  it('moves items and views, never the title block, as one undo step', () => {
    const { store, now } = withSheet();
    expect(movable('item:t1') && movable('view:v1')).toBe(true);
    expect(movable('title-block')).toBe(false);
    moveTargets(store, ['item:t1', 'view:v1', 'title-block'], 2.5, -1.25);
    expect(atOf(now().items[0])).toEqual([62.5, 58.75]);
    expect(now().views[0]?.at).toEqual([102.5, 83.75]);
    expect(store.getState().undoLabel).toBe('Move on sheet');
    store.getState().undo();
    expect(now()).toEqual(sheet);
    // One target is a single command, with the same label.
    moveTargets(store, ['item:t2'], 1, 0);
    expect(atOf(now().items[1])).toEqual([21, 200]);
    expect(store.getState().undoLabel).toBe('Move on sheet');
  });

  it("moves a dimension in its view's frame (model mm, y up), and not again with its view", () => {
    const store = createDocumentStore(createDocument());
    const front = { ...(sheet.views[0] as SheetView), scale: [1, 2] as [number, number] };
    const dimension: SheetDimensionItem = {
      kind: 'dimension',
      id: 'd1' as SheetItemId,
      view: 'v2' as SheetViewId,
      type: 'linear',
      anchors: [{ free: [0, 0] }, { free: [20, 0] }],
      at: [10, 8],
    };
    store.getState().dispatch(
      addSheet({
        sheet: { ...sheet, views: [front, sheet.views[1] as SheetView], items: [dimension] },
      }),
    );
    const now = () => store.getState().doc.sheets?.[0] as Sheet;
    // The projected view draws at its base view's 1:2: 2 mm right on the sheet is 4 model mm,
    // 3 mm down is 6 model mm down (y up).
    moveTargets(store, ['item:d1'], 2, 3);
    expect(atOf(now().items[0])).toEqual([14, 2]);
    // With its view selected too, only the view moves; the dimension follows it.
    moveTargets(store, ['view:v2', 'item:d1'], 5, 0);
    expect(now().views[1]?.at).toEqual([225, 85]);
    expect(atOf(now().items[0])).toEqual([14, 2]);
    expect(targetName(now(), 'item:d1')).toBe('Dimension');
  });

  it('leaves a centre mark where it is: it sits on its geometry and has no place of its own', () => {
    const store = createDocumentStore(createDocument());
    const mark: SheetItem = {
      kind: 'centreMark',
      id: 'c1' as SheetItemId,
      view: 'v1' as SheetViewId,
      anchors: [
        {
          ref: { kind: 'edge', id: 'e[a|b]', fingerprint: { type: 'circle', at: [0, 0, 0] } },
        },
      ],
    };
    store.getState().dispatch(addSheet({ sheet: { ...sheet, items: [mark] } }));
    expect(moveCommands(store.getState().doc.sheets ?? [], ['item:c1'], 2, 3)).toEqual([]);
  });

  it('deletes items and views (with the views projected from them) as one undo step', () => {
    const { store, now } = withSheet();
    deleteTargets(store, ['view:v1', 'item:t1', 'title-block']);
    expect(now().views).toEqual([]);
    expect(now().items.map((i) => i.id)).toEqual(['t2']);
    expect(store.getState().undoLabel).toBe('Delete from sheet');
    store.getState().undo();
    expect(now()).toEqual(sheet);
    // The title block alone deletes nothing.
    deleteTargets(store, ['title-block']);
    expect(store.getState().canRedo).toBe(true);
  });

  it('names targets for the selection card', () => {
    expect(targetName(sheet, 'title-block')).toBe('Title block');
    expect(targetName(sheet, 'view:v2')).toBe('Right');
    expect(targetName(sheet, 'item:t1')).toBe('Text “Note”');
    expect(targetName(sheet, 'item:gone')).toBe('Item');
  });
});
