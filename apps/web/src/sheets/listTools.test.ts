import {
  type BodyId,
  createDocument,
  type DocumentId,
  type ParameterId,
  type Sheet,
  type SheetBalloonItem,
  type SheetId,
  type SheetItem,
  type SheetItemId,
  type SheetPartsListItem,
  type SheetRefAnchor,
  type SheetTableItem,
  type SheetViewId,
  sheetItemProblems,
  sheetStandardFrom,
} from '@extrudo/core';
import { describe, expect, it } from 'vitest';
import { sheetFieldChoices } from './controls';
import type { SheetHit, SheetPick, SheetPickable } from './dimensionTool';
import {
  balloonAccepts,
  balloonItem,
  balloonListOf,
  balloonLists,
  balloonStep,
  newTable,
  partsListItem,
  partsListName,
  partsListStep,
  tableCellAt,
  withCell,
  withColumnAdded,
  withColumnRemoved,
  withColumnShown,
  withRowAdded,
  withRowRemoved,
  withRowText,
  withWidth,
} from './listTools';
import { repickAccepts } from './noteTools';
import { itemRepick } from './RepickHandles';
import { moveCommands, targetName } from './selection';

const FRONT = 'v1' as SheetViewId;
const TOP = 'v2' as SheetViewId;
const LIST = 'l1' as SheetItemId;
const TOP_BODY = 'Top:0' as BodyId;
const LEG1 = 'Leg1:0' as BodyId;
const LEG2 = 'Leg2:0' as BodyId;
const ref: SheetRefAnchor['ref'] = {
  kind: 'edge',
  id: 'e1',
  fingerprint: { type: 'line', at: [0, 0, 0] },
};

function sheetWith(items: SheetItem[]): Sheet {
  return {
    id: 's1' as SheetId,
    name: 'Frame',
    size: 'A3',
    orientation: 'landscape',
    scale: [1, 10],
    projection: 'first',
    decimals: 0,
    views: [
      { id: FRONT, name: 'Front', at: [100, 150], from: sheetStandardFrom('front') },
      { id: TOP, name: 'Top', at: [100, 250], from: sheetStandardFrom('top') },
    ],
    items,
  };
}

function hit(body: BodyId, view = FRONT): SheetHit {
  const pickable: SheetPickable = {
    key: `${view}|${body}|edge|e1`,
    view,
    body,
    kind: 'edge',
    name: 'e1',
    shape: { type: 'line', a: [0, 0], b: [10, 0] },
    paths: [],
    ends: [],
  };
  return { pickable };
}

const pick: SheetPick = {
  kind: 'edge',
  view: FRONT,
  key: 'k',
  ref,
  shape: { type: 'line', a: [0, 0], b: [10, 0] },
};

describe('Parts List', () => {
  it('makes a list of the clicked view at the click, every column, and says what comes next', () => {
    const item = partsListItem(LIST, FRONT, [300, 28]);
    expect(item).toEqual({ kind: 'partsList', id: LIST, view: FRONT, at: [300, 28] });
    expect(sheetItemProblems(sheetWith([item]), item)).toEqual([]);
    expect(partsListStep(undefined)).toBe('Click a view: its bodies become the rows.');
    expect(partsListStep('Front')).toBe(
      'Click where the list of Front goes (its top-left corner).',
    );
  });

  it('shows and hides columns in the default order, never none', () => {
    expect(withColumnShown(undefined, 'mass', false)).toEqual([
      'item',
      'qty',
      'name',
      'material',
      'size',
    ]);
    expect(withColumnShown(['size', 'item'], 'qty', true)).toEqual(['item', 'qty', 'size']);
    // All six again: the key goes.
    expect(withColumnShown(['item', 'qty', 'name', 'material', 'size'], 'mass', true)).toBeNull();
    expect(withColumnShown(['name'], 'name', false)).toBe(
      'A parts list shows at least one column.',
    );
  });

  it("writes what is typed over a row under its first body, and goes back to the model's", () => {
    const legs = [LEG1, LEG2];
    let rows = withRowText(undefined, legs, 'material', 'Pine');
    expect(rows).toEqual({ [LEG1]: { material: 'Pine' } });
    rows = withRowText(rows ?? undefined, legs, 'name', 'Leg, planed');
    expect(rows).toEqual({ [LEG1]: { material: 'Pine', name: 'Leg, planed' } });
    // Typed under the second body (an older file): read, and moved to the first.
    expect(withRowText({ [LEG2]: { name: 'Old' } }, legs, 'material', 'Oak')).toEqual({
      [LEG1]: { name: 'Old', material: 'Oak' },
    });
    // Other rows are kept; blank text is the model's own; nothing left is `null`.
    const both = { [TOP_BODY]: { material: 'Birch' }, [LEG1]: { name: 'Leg, planed' } };
    expect(withRowText(both, legs, 'name', '  ')).toEqual({ [TOP_BODY]: { material: 'Birch' } });
    expect(withRowText({ [LEG1]: { name: 'X' } }, legs, 'name', undefined)).toBeNull();
  });

  it('names a list by its view, numbered when a view has two', () => {
    const a = partsListItem(LIST, FRONT, [0, 0]);
    const b = partsListItem('l2' as SheetItemId, FRONT, [0, 50]);
    expect(partsListName(sheetWith([a]), a)).toBe('Parts list of Front');
    expect(partsListName(sheetWith([a, b]), b)).toBe('Parts list 2 of Front');
    expect(targetName(sheetWith([a]), `item:${LIST}`)).toBe('Parts list of Front');
  });

  it('moves on the sheet by sheet mm, not in its view’s frame', () => {
    const sheet = sheetWith([partsListItem(LIST, FRONT, [300, 28])]);
    expect(moveCommands([sheet], [`item:${LIST}`], 5, -2)).toEqual([
      expect.objectContaining({ payload: { id: LIST, changes: { at: [305, 26] } } }),
    ]);
  });
});

describe('Balloon', () => {
  const list = partsListItem(LIST, FRONT, [300, 28]);
  const parts = { lists: { [LIST]: [TOP_BODY, LEG1, LEG2] }, bodies: {} };

  it('takes one pick on a body its view’s list shows', () => {
    const sheet = sheetWith([list]);
    expect(balloonAccepts(sheet, parts, hit(LEG1), [])).toBe(true);
    expect(balloonAccepts(sheet, parts, hit(LEG1), [pick])).toBe(false);
    // A body the list doesn't show, a view without a list.
    expect(balloonAccepts(sheet, parts, hit('Other:0' as BodyId), [])).toBe(false);
    expect(balloonAccepts(sheet, parts, hit(LEG1, TOP), [])).toBe(false);
    // The list's bodies not known yet: any body of the view.
    expect(balloonAccepts(sheet, undefined, hit('Other:0' as BodyId), [])).toBe(true);
  });

  it('is numbered by the first list of the picked view, its circle at the click', () => {
    const second = partsListItem('l2' as SheetItemId, FRONT, [300, 80]);
    const sheet = sheetWith([list, second]);
    expect(balloonListOf(sheet, FRONT)?.id).toBe(LIST);
    expect(balloonListOf(sheet, TOP)).toBeUndefined();
    const item = balloonItem('b1' as SheetItemId, [pick], [12, 30], LIST) as SheetBalloonItem;
    expect(item).toEqual({
      kind: 'balloon',
      id: 'b1',
      view: FRONT,
      anchor: { ref },
      at: [12, 30],
      list: LIST,
    });
    expect(sheetItemProblems(sheet, item)).toEqual([]);
    expect(balloonItem('b1' as SheetItemId, [], [0, 0], LIST)).toBeUndefined();
    expect(balloonItem('b1' as SheetItemId, [pick], [0, 0], undefined)).toBeUndefined();
    expect(balloonLists(sheet)).toEqual([
      "Front has 2 parts lists: balloons take the first one placed; a balloon's card can choose another.",
    ]);
    expect(balloonLists(sheetWith([list]))).toEqual(['Front: numbered by its parts list.']);
  });

  it('says what to do, and first that a list is needed', () => {
    expect(balloonStep(sheetWith([]), [])).toBe(
      'This sheet has no parts list yet: place one with Parts List first.',
    );
    expect(balloonStep(sheetWith([list]), [])).toBe(
      'Pick a part in a view with a parts list: an edge, a point or a face.',
    );
    expect(balloonStep(sheetWith([list]), [pick])).toBe('Click where the balloon goes.');
  });

  it('is picked again like a leader note: any geometry, the anchor replaced', () => {
    const item = balloonItem('b1' as SheetItemId, [pick], [0, 0], LIST) as SheetBalloonItem;
    expect(repickAccepts(item, hit(LEG2))).toBe(true);
    const face: SheetPick = { kind: 'face', view: FRONT, key: 'f', ref: { ...ref, kind: 'face' } };
    expect(itemRepick(item, 0, face)).toEqual({ anchor: { ref: { ...ref, kind: 'face' } } });
    expect(targetName(sheetWith([item]), 'item:b1')).toBe('Balloon');
  });
});

describe('Table', () => {
  const ID = 't1' as SheetItemId;

  it('places a small empty table that the document takes', () => {
    const table = newTable(ID, [322, 200]);
    expect(table).toEqual({
      kind: 'table',
      id: ID,
      at: [322, 200],
      columns: [25, 45],
      rows: [
        ['', ''],
        ['', ''],
        ['', ''],
      ],
    });
    expect(sheetItemProblems(sheetWith([table]), table)).toEqual([]);
    expect(targetName(sheetWith([table]), 'item:t1')).toBe('Table');
  });

  it('finds the cell under a point from the drawn grid', () => {
    const table: SheetTableItem = {
      ...newTable(ID, [10, 20]),
      rows: [
        ['a', 'b'],
        ['', 'c'],
      ],
    };
    // As `sheetTableGrid` gives it for this table (one line per cell).
    const grid = { lefts: [10, 35], widths: [25, 45], tops: [20, 27], heights: [7, 7] };
    expect(tableCellAt(grid, [12, 22])).toEqual({ row: 0, column: 0 });
    expect(tableCellAt(grid, [50, 30])).toEqual({ row: 1, column: 1 });
    expect(tableCellAt(grid, [5, 22])).toBeUndefined();
    expect(tableCellAt(grid, [12, 40])).toBeUndefined();
    expect(withCell(table, 1, 0, 'd')).toEqual([
      ['a', 'b'],
      ['d', 'c'],
    ]);
  });

  it('adds and removes rows and columns at the end, never the last one', () => {
    const table: SheetTableItem = { ...newTable(ID, [0, 0]), rows: [['a', 'b']] };
    expect(withRowAdded(table)).toEqual({
      rows: [
        ['a', 'b'],
        ['', ''],
      ],
    });
    expect(withRowRemoved(table)).toBe('A table keeps at least one row: delete the table instead.');
    expect(withColumnAdded(table)).toEqual({ columns: [25, 45, 25], rows: [['a', 'b', '']] });
    expect(withColumnRemoved(table)).toEqual({ columns: [25], rows: [['a']] });
    expect(withColumnRemoved({ ...table, columns: [25], rows: [['a']] })).toBe(
      'A table keeps at least one column: delete the table instead.',
    );
    expect(withWidth(table, 1, 60)).toEqual([25, 60]);
    const grown = withRowAdded(table, 0);
    expect(
      typeof grown !== 'string' && sheetItemProblems(sheetWith([]), { ...table, ...grown }),
    ).toEqual([]);
  });
});

describe('fields to insert', () => {
  it('offers the sheet fields, then each parameter as an expression', () => {
    const doc = {
      ...createDocument({ id: 'd' as DocumentId, name: 'Frame', now: '2026-11-11T10:00:00Z' }),
      parameters: [
        { id: 'p' as ParameterId, name: 'legs', expression: '700 mm', unit: 'length' as const },
      ],
    };
    expect(sheetFieldChoices(doc).map((c) => c.token)).toEqual([
      '{name}',
      '{sheet}',
      '{sheets}',
      '{scale}',
      '{date}',
      '{version}',
      '{= legs}',
    ]);
  });
});

// A parts list's typed rows stay valid for the document.
it('typed rows keep the parts list valid', () => {
  const list: SheetPartsListItem = {
    ...partsListItem(LIST, FRONT, [0, 0]),
    rows: withRowText(undefined, [LEG1], 'material', 'Pine') ?? {},
  };
  expect(sheetItemProblems(sheetWith([list]), list)).toEqual([]);
});
