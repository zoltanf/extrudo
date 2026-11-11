import {
  createDocument,
  createDocumentStore,
  createSessionStore,
  originPlaneRef,
  renameDocument,
  type SheetId,
  type SheetViewId,
} from '@extrudo/core';
import { describe, expect, it } from 'vitest';
import { memoryPreferences } from '../platform';
import { createSketchOn } from '../sketch/mode';
import { createViewportStore } from '../viewport/store';
import { copyName, copySheet, newSheet, nextSheetName, sheetNameProblem } from './defaults';
import {
  activeSheet,
  addNewSheet,
  createSheet,
  deleteSheet,
  duplicateSheet,
  finishDrawing,
  keepSheetOpen,
  moveSheetTo,
  openSheet,
  openSheets,
  renameSheet,
  stepSheet,
} from './mode';
import { sheetStatus } from './SheetTabs';
import { fitSheet, panSheet, sheetPoint, TRUE_SIZE, zoomSheetAt, zoomText } from './sheetView';

const DAY = new Date(2026, 10, 11);

function setup() {
  const store = createDocumentStore(createDocument());
  store.getState().dispatch(renameDocument({ name: 'Box with a lid' }));
  const stores = {
    store,
    session: createSessionStore(),
    viewport: createViewportStore({ preferences: memoryPreferences(), reducedMotion: () => true }),
  };
  return {
    stores,
    ...stores,
    sheets: () => store.getState().doc.sheets ?? [],
    names: () => (store.getState().doc.sheets ?? []).map((s) => s.name),
    mode: () => {
      const { mode, activeSheetId } = stores.session.getState();
      return { mode, activeSheetId };
    },
  };
}

describe('a new sheet (the mode’s defaults, plan §12)', () => {
  it('is A3 landscape, 1:1, first angle, one decimal, simple block, a border without zones', () => {
    const doc = { ...createDocument(), name: 'Box with a lid' };
    expect(newSheet(doc, 's1' as SheetId, DAY)).toEqual({
      id: 's1',
      name: 'Sheet 1',
      size: 'A3',
      orientation: 'landscape',
      scale: [1, 1],
      projection: 'first',
      decimals: 1,
      border: {},
      // The design's name, today and the units; never the author's name.
      titleBlock: {
        template: 'simple',
        fields: { title: 'Box with a lid', date: '2026-11-11', units: 'mm' },
      },
      views: [],
      items: [],
    });
  });

  it('takes the dialog’s choices; "none" leaves the title block out', () => {
    const doc = createDocument();
    const sheet = newSheet(doc, 's1' as SheetId, DAY, {
      size: 'A4',
      orientation: 'portrait',
      projection: 'third',
      titleBlock: 'none',
    });
    expect(sheet).toMatchObject({ size: 'A4', orientation: 'portrait', projection: 'third' });
    expect(sheet.titleBlock).toBeUndefined();
  });

  it('is named after the first free "Sheet n", names compared without case', () => {
    expect(nextSheetName([])).toBe('Sheet 1');
    expect(nextSheetName([{ name: 'sheet 2' }])).toBe('Sheet 3');
    expect(nextSheetName([{ name: 'Sheet 3' }, { name: 'Lid' }])).toBe('Sheet 4');
  });

  it('refuses a blank or taken name in the words of UI spec §8', () => {
    const sheets = [
      { id: 'a' as SheetId, name: 'Assembly' },
      { id: 'b' as SheetId, name: 'Lid' },
    ];
    expect(sheetNameProblem(sheets, 'a' as SheetId, '  ')).toBe('A sheet needs a name.');
    expect(sheetNameProblem(sheets, 'a' as SheetId, 'lid')).toBe(
      'There is a sheet named "Lid" already: pick another name.',
    );
    expect(sheetNameProblem(sheets, 'a' as SheetId, 'assembly')).toBeUndefined();
    expect(copyName(sheets, 'Lid')).toBe('Lid copy');
    expect(copyName([...sheets, { name: 'Lid copy' }], 'Lid')).toBe('Lid copy 2');
  });

  it('copies a sheet with new IDs, parents and item views following', () => {
    const doc = createDocument();
    const base = newSheet(doc, 's1' as SheetId, DAY);
    const front = 'v1' as SheetViewId;
    const sheet = {
      ...base,
      views: [
        {
          id: front,
          name: 'Front',
          at: [50, 50] as [number, number],
          from: { kind: 'base' as const, direction: [0, 1, 0], up: [0, 0, 1] },
        },
        {
          id: 'v2' as SheetViewId,
          name: 'Top',
          at: [50, 150] as [number, number],
          from: { kind: 'projected' as const, parent: front, side: 'below' as const },
        },
      ],
      items: [
        { kind: 'text' as const, id: 'i1' as never, at: [10, 10] as [number, number], text: 'Hi' },
      ],
    } as typeof base;
    let n = 0;
    const copy = copySheet(sheet, 'Sheet 1 copy', {
      sheet: 's2' as SheetId,
      view: () => `nv${++n}` as SheetViewId,
      item: () => 'ni' as never,
    });
    expect(copy.id).toBe('s2');
    expect(copy.views.map((v) => v.id)).toEqual(['nv1', 'nv2']);
    expect(copy.views[1]?.from).toEqual({ kind: 'projected', parent: 'nv1', side: 'below' });
    expect(copy.items[0]?.id).toBe('ni');
    // The source is untouched.
    expect(sheet.views[0]?.id).toBe('v1');
  });
});

describe('the drawing mode (P6-24, ADR-0143)', () => {
  it('New drawing adds one sheet as one undo step and opens it', () => {
    const t = setup();
    const id = createSheet(t.stores, { size: 'A4', orientation: 'portrait' }, DAY);
    expect(t.mode()).toEqual({ mode: 'sheet', activeSheetId: id });
    expect(t.sheets()).toHaveLength(1);
    expect(t.store.getState().undoLabel).toBe('New drawing');
    expect(activeSheet(t.stores)?.size).toBe('A4');
    // Undo takes the sheet away and, with none left, the drawing ends.
    t.store.getState().undo();
    expect(t.sheets()).toHaveLength(0);
    keepSheetOpen(t.stores, [{ id } as never]);
    expect(t.mode().mode).toBe('model');
  });

  it('finishes an open sketch before entering, and Finish is no undo step', () => {
    const t = setup();
    const id = createSheet(t.stores, {}, DAY);
    finishDrawing(t.stores);
    createSketchOn(t.stores, originPlaneRef('origin:xy'));
    expect(t.session.getState().mode).toBe('sketch');
    expect(openSheet(t.stores, id)).toBe(true);
    expect(t.mode()).toEqual({ mode: 'sheet', activeSheetId: id });
    expect(t.store.getState().transactionDepth).toBe(0);
    const steps = t.store.getState().undoLabel;
    finishDrawing(t.stores);
    expect(t.mode().mode).toBe('model');
    expect(t.store.getState().undoLabel).toBe(steps);
  });

  it('ends an open sketch before any sheet command, so each is an undo step of its own', () => {
    const t = setup();
    const a = createSheet(t.stores, {}, DAY);
    finishDrawing(t.stores);
    const features = () => t.store.getState().doc.features.length;
    const sketching = () => {
      createSketchOn(t.stores, originPlaneRef('origin:xy'));
      expect(t.store.getState().transactionDepth).toBe(1);
      return features();
    };
    const commands: [string, () => void][] = [
      ['Rename sheet', () => renameSheet(t.stores, a, 'Assembly')],
      ['Duplicate sheet', () => duplicateSheet(t.stores, a)],
      ['Move sheet', () => moveSheetTo(t.stores, a, 1)],
      ['Delete sheet', () => deleteSheet(t.stores, t.sheets()[0]?.id as SheetId)],
      ['New drawing', () => createSheet(t.stores, {}, DAY)],
    ];
    for (const [label, command] of commands) {
      const withSketch = sketching();
      const sheets = t.sheets();
      command();
      expect(t.store.getState().transactionDepth).toBe(0);
      expect(t.session.getState().mode).not.toBe('sketch');
      expect(t.store.getState().undoLabel).toBe(label);
      // One undo takes the sheet change back and leaves the sketch.
      t.store.getState().undo();
      expect(t.sheets()).toEqual(sheets);
      expect(features()).toBe(withSketch);
      t.store.getState().redo();
      finishDrawing(t.stores);
    }
  });

  it('opens the sheet edited last, or reports that there is none', () => {
    const t = setup();
    expect(openSheets(t.stores)).toBe(false);
    const first = createSheet(t.stores, {}, DAY);
    const second = addNewSheet(t.stores, DAY);
    expect(t.names()).toEqual(['Sheet 1', 'Sheet 2']);
    finishDrawing(t.stores);
    expect(openSheets(t.stores)).toBe(true);
    expect(t.mode().activeSheetId).toBe(second);
    openSheet(t.stores, first);
    finishDrawing(t.stores);
    openSheets(t.stores);
    expect(t.mode().activeSheetId).toBe(first);
  });

  it('adds New Sheet after the open one, and steps round the tabs', () => {
    const t = setup();
    const a = createSheet(t.stores, {}, DAY);
    const c = addNewSheet(t.stores, DAY);
    openSheet(t.stores, a);
    const b = addNewSheet(t.stores, DAY);
    expect(t.sheets().map((s) => s.id)).toEqual([a, b, c]);
    stepSheet(t.stores, 1);
    expect(t.mode().activeSheetId).toBe(c);
    stepSheet(t.stores, 1);
    expect(t.mode().activeSheetId).toBe(a);
    stepSheet(t.stores, -1);
    expect(t.mode().activeSheetId).toBe(c);
  });

  it('renames, duplicates, moves and deletes, each one undo step', () => {
    const t = setup();
    const a = createSheet(t.stores, {}, DAY);
    expect(renameSheet(t.stores, a, ' Assembly ')).toBeUndefined();
    expect(t.store.getState().undoLabel).toBe('Rename sheet');
    const copy = duplicateSheet(t.stores, a);
    expect(t.names()).toEqual(['Assembly', 'Assembly copy']);
    expect(t.mode().activeSheetId).toBe(copy);
    expect(renameSheet(t.stores, a, 'assembly COPY')).toMatch(/already/);
    moveSheetTo(t.stores, a, 1);
    expect(t.names()).toEqual(['Assembly copy', 'Assembly']);
    expect(t.store.getState().undoLabel).toBe('Move sheet');
    // Deleting the open sheet opens its neighbour.
    deleteSheet(t.stores, copy as SheetId);
    expect(t.names()).toEqual(['Assembly']);
    expect(t.mode().activeSheetId).toBe(a);
    deleteSheet(t.stores, a);
    expect(t.mode().mode).toBe('model');
    for (let i = 0; i < 2; i++) t.store.getState().undo();
    expect(t.names()).toEqual(['Assembly copy', 'Assembly']);
  });

  it('writes the status line', () => {
    const t = setup();
    const a = createSheet(t.stores, { size: 'A4' }, DAY);
    expect(sheetStatus(t.sheets(), a, 'mm')).toBe(
      'Editing drawing · sheet 1 of 1 · A4 landscape · 1:1 · mm',
    );
  });
});

describe('the sheet on screen (pan and zoom)', () => {
  const paper = { width: 420, height: 297 };
  const insets = { left: 248, right: 268, top: 0, bottom: 56 };

  it('fits the paper in the room beside the browser and the card, centred', () => {
    const view = fitSheet(paper, { width: 1440, height: 700 }, insets);
    const room = { w: 1440 - 248 - 268 - 56, h: 700 - 56 - 56 };
    expect(view.scale).toBeCloseTo(Math.min(room.w / 420, room.h / 297));
    expect(view.x + (420 * view.scale) / 2).toBeCloseTo(248 + 28 + room.w / 2);
    expect(view.y + (297 * view.scale) / 2).toBeCloseTo(28 + room.h / 2);
  });

  it('zooms at the pointer, keeping the sheet point under it', () => {
    const view = { x: 100, y: 50, scale: 2 };
    const before = sheetPoint(view, 400, 300);
    const after = zoomSheetAt(view, 1.5, 400, 300);
    expect(after.scale).toBe(3);
    expect(sheetPoint(after, 400, 300)[0]).toBeCloseTo(before[0]);
    expect(sheetPoint(after, 400, 300)[1]).toBeCloseTo(before[1]);
    expect(panSheet(view, 10, -5)).toEqual({ x: 110, y: 45, scale: 2 });
  });

  it('keeps the zoom between 5 % and 800 % of the true size', () => {
    expect(zoomText({ x: 0, y: 0, scale: TRUE_SIZE })).toBe('100%');
    expect(zoomSheetAt({ x: 0, y: 0, scale: TRUE_SIZE }, 1000, 0, 0).scale).toBeCloseTo(
      8 * TRUE_SIZE,
    );
    expect(zoomSheetAt({ x: 0, y: 0, scale: TRUE_SIZE }, 0.001, 0, 0).scale).toBeCloseTo(
      0.05 * TRUE_SIZE,
    );
  });
});
