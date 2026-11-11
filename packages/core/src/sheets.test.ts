import { describe, expect, it } from 'vitest';
import { type Command, CommandError } from './commands';
import { removeFeature, restoreVersion } from './document-commands';
import type { BodyId, FeatureId, SheetId, SheetItemId, SheetViewId } from './ids';
import { remintSheets } from './remint';
import { DocumentSchema, type ExtrudoDocument } from './schema';
import type { Sheet, SheetTextItem } from './sheet-schema';
import {
  addSheet,
  addSheetItem,
  addSheetView,
  moveSheet,
  removeSheet,
  removeSheetItems,
  removeSheetView,
  sheetById,
  sheetOfView,
  updateSheet,
  updateSheetItem,
  updateSheetView,
} from './sheets';
import { createDocumentStore } from './stores';
import { feature, front, projected, sampleDocument, sheet } from './testing';

const sid = (id: string) => id as SheetId;
const vid = (id: string) => id as SheetViewId;
const iid = (id: string) => id as SheetItemId;

const text = (id: string, value = 'Note'): SheetTextItem => ({
  kind: 'text',
  id: iid(id),
  at: [10, 10],
  text: value,
});

const withSheets = (...sheets: Sheet[]): ExtrudoDocument => ({ ...sampleDocument(), sheets });

/** Dispatches `command`, checks the result is valid, that it is one undo step and that redo gives it back. */
function roundTrip(doc: ExtrudoDocument, command: Command<unknown>): ExtrudoDocument {
  const store = createDocumentStore(doc);
  store.getState().dispatch(command);
  const after = store.getState().doc;
  const parsed = DocumentSchema.safeParse(JSON.parse(JSON.stringify(after)));
  expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
  store.getState().undo();
  expect(store.getState().doc).toEqual(doc);
  expect(store.getState().canUndo).toBe(false);
  store.getState().redo();
  expect(store.getState().doc).toEqual(after);
  return after;
}

function refused(doc: ExtrudoDocument, command: Command<unknown>): string {
  const store = createDocumentStore(doc);
  try {
    store.getState().dispatch(command);
  } catch (error) {
    expect(error).toBeInstanceOf(CommandError);
    expect(store.getState().doc).toBe(doc);
    return (error as Error).message;
  }
  throw new Error('the command was not refused');
}

describe('addSheet', () => {
  it('adds the first sheet, then one at a given position', () => {
    let doc = roundTrip(sampleDocument(), addSheet({ sheet: sheet('s1', 'Sheet 1') }));
    expect(doc.sheets).toEqual([sheet('s1', 'Sheet 1')]);
    doc = roundTrip(doc, addSheet({ sheet: sheet('s2', 'Cover'), index: 0 }));
    expect(doc.sheets?.map((s) => s.id)).toEqual(['s2', 's1']);
  });

  it("doesn't share the caller's object with the document", () => {
    const mine = sheet('s1', 'Sheet 1');
    const doc = roundTrip(sampleDocument(), addSheet({ sheet: mine }));
    expect(doc.sheets?.[0]).not.toBe(mine);
    expect(Object.isFrozen(mine)).toBe(false);
  });

  it('refuses a taken ID, a taken name, a bad position and an invalid sheet', () => {
    const doc = withSheets(sheet('s1', 'Sheet 1'));
    expect(refused(doc, addSheet({ sheet: sheet('s1', 'Other') }))).toBe(
      'Sheet s1 already exists.',
    );
    expect(refused(doc, addSheet({ sheet: sheet('s2', 'SHEET 1') }))).toBe(
      'Sheet "SHEET 1": name is "SHEET 1", which another sheet has.',
    );
    expect(refused(doc, addSheet({ sheet: sheet('s2', 'B'), index: 3 }))).toBe(
      'Position 3 is outside 0 to 1.',
    );
    expect(refused(doc, addSheet({ sheet: sheet('s2', 'B', { decimals: 9 }) }))).toMatch(
      /^Sheet "B": decimals /,
    );
  });
});

describe('updateSheet', () => {
  it('changes the setup, sets and deletes the optional parts', () => {
    let doc = roundTrip(
      withSheets(sheet('s1', 'Sheet 1')),
      updateSheet({
        id: sid('s1'),
        changes: {
          name: 'Bracket',
          size: 'A4',
          orientation: 'portrait',
          scale: [1, 5],
          projection: 'third',
          decimals: 2,
          border: { zones: true },
          titleBlock: { template: 'simple', fields: { title: 'Bracket' } },
        },
      }),
    );
    expect(sheetById(doc, sid('s1'))).toEqual({
      ...sheet('s1', 'Bracket'),
      size: 'A4',
      orientation: 'portrait',
      scale: [1, 5],
      projection: 'third',
      decimals: 2,
      border: { zones: true },
      titleBlock: { template: 'simple', fields: { title: 'Bracket' } },
    });
    doc = roundTrip(
      doc,
      updateSheet({ id: sid('s1'), changes: { border: null, name: undefined } }),
    );
    expect(sheetById(doc, sid('s1'))?.border).toBeUndefined();
    expect(sheetById(doc, sid('s1'))?.name).toBe('Bracket');
  });

  it('refuses an unknown sheet, a taken name, deleting a required field, and the ID', () => {
    const doc = withSheets(sheet('s1', 'A'), sheet('s2', 'B'));
    expect(refused(doc, updateSheet({ id: sid('nope'), changes: { name: 'C' } }))).toBe(
      "Sheet nope doesn't exist.",
    );
    expect(refused(doc, updateSheet({ id: sid('s2'), changes: { name: 'a' } }))).toBe(
      'Sheet "a": name is "a", which another sheet has.',
    );
    expect(refused(doc, updateSheet({ id: sid('s2'), changes: { scale: null } }))).toMatch(
      /^Sheet "B": scale /,
    );
    const sneaky = { views: [] } as unknown as Parameters<typeof updateSheet>[0]['changes'];
    expect(refused(doc, updateSheet({ id: sid('s2'), changes: sneaky }))).toBe(
      "The views can't be changed.",
    );
  });
});

describe('removeSheet and moveSheet', () => {
  it('removes a sheet, and the key with the last one', () => {
    let doc = roundTrip(
      withSheets(sheet('s1', 'A'), sheet('s2', 'B')),
      removeSheet({ id: sid('s1') }),
    );
    expect(doc.sheets?.map((s) => s.id)).toEqual(['s2']);
    doc = roundTrip(doc, removeSheet({ id: sid('s2') }));
    expect('sheets' in doc).toBe(false);
    expect(refused(doc, removeSheet({ id: sid('s2') }))).toBe("Sheet s2 doesn't exist.");
  });

  it('moves a sheet in page order', () => {
    const doc = withSheets(sheet('s1', 'A'), sheet('s2', 'B'), sheet('s3', 'C'));
    expect(roundTrip(doc, moveSheet({ id: sid('s3'), index: 0 })).sheets?.map((s) => s.id)).toEqual(
      ['s3', 's1', 's2'],
    );
    expect(roundTrip(doc, moveSheet({ id: sid('s1'), index: 2 })).sheets?.map((s) => s.id)).toEqual(
      ['s2', 's3', 's1'],
    );
    expect(refused(doc, moveSheet({ id: sid('s1'), index: 3 }))).toBe(
      'Position 3 is outside 0 to 2.',
    );
  });
});

describe('sheet views', () => {
  it('adds a base view and a projected one, and finds their sheet', () => {
    let doc = roundTrip(
      withSheets(sheet('s1', 'A')),
      addSheetView({ sheet: sid('s1'), view: front() }),
    );
    doc = roundTrip(doc, addSheetView({ sheet: sid('s1'), view: projected('v2', 'v1', 'Right') }));
    expect(sheetById(doc, sid('s1'))?.views).toEqual([front(), projected('v2', 'v1', 'Right')]);
    expect(sheetOfView(doc, vid('v2'))?.id).toBe('s1');
    expect(sheetOfView(doc, vid('v9'))).toBeUndefined();
  });

  it('refuses a taken view ID, a taken name, a parent elsewhere, and an unknown sheet', () => {
    const doc = withSheets(sheet('s1', 'A', { views: [front()] }), sheet('s2', 'B'));
    expect(refused(doc, addSheetView({ sheet: sid('s2'), view: front('v1', 'Other') }))).toBe(
      'View v1 already exists.',
    );
    expect(refused(doc, addSheetView({ sheet: sid('s1'), view: front('v2', 'front') }))).toBe(
      'Sheet "A", view "front": name is "front", which another view of this sheet has.',
    );
    expect(refused(doc, addSheetView({ sheet: sid('s2'), view: projected('v2', 'v1') }))).toBe(
      'Sheet "B", view "v2": from.parent is v1, which is not a view of this sheet.',
    );
    expect(refused(doc, addSheetView({ sheet: sid('s9'), view: front('v2') }))).toBe(
      "Sheet s9 doesn't exist.",
    );
  });

  it('updates a view, sets and deletes its options', () => {
    const doc0 = withSheets(sheet('s1', 'A', { views: [front()] }));
    let doc = roundTrip(
      doc0,
      updateSheetView({
        id: vid('v1'),
        changes: {
          name: 'Top',
          at: [50, 60],
          from: { kind: 'base', direction: [0, 0, -1], up: [0, 1, 0] },
          scale: [1, 1],
          style: 'visible',
          bodies: ['f2:0' as BodyId],
          tangentEdges: false,
          label: true,
        },
      }),
    );
    expect(sheetById(doc, sid('s1'))?.views[0]).toEqual({
      id: 'v1',
      name: 'Top',
      at: [50, 60],
      from: { kind: 'base', direction: [0, 0, -1], up: [0, 1, 0] },
      scale: [1, 1],
      style: 'visible',
      bodies: ['f2:0'],
      tangentEdges: false,
      label: true,
    });
    doc = roundTrip(
      doc,
      updateSheetView({ id: vid('v1'), changes: { scale: null, bodies: null, label: null } }),
    );
    expect(sheetById(doc, sid('s1'))?.views[0]).toEqual({
      id: 'v1',
      name: 'Top',
      at: [50, 60],
      from: { kind: 'base', direction: [0, 0, -1], up: [0, 1, 0] },
      style: 'visible',
      tangentEdges: false,
    });
  });

  it('refuses a view made its own ancestor, or given a scale while projected', () => {
    const doc = withSheets(sheet('s1', 'A', { views: [front(), projected('v2', 'v1', 'Right')] }));
    const cycle = updateSheetView({
      id: vid('v1'),
      changes: { from: { kind: 'projected', parent: vid('v2'), side: 'left' } },
    });
    expect(refused(doc, cycle)).toMatch(/makes a cycle/);
    expect(refused(doc, updateSheetView({ id: vid('v2'), changes: { scale: [1, 1] } }))).toBe(
      'Sheet "A", view "Right": scale is set on a projected view, which takes its parent\'s scale.',
    );
    expect(refused(doc, updateSheetView({ id: vid('v9'), changes: { name: 'x' } }))).toBe(
      "View v9 doesn't exist.",
    );
  });

  it('removes a view with the views projected from it, in one step, and keeps the texts', () => {
    const views = [
      front(),
      projected('v2', 'v1', 'Right'),
      projected('v3', 'v2', 'Right of right'),
      front('v4', 'Other'),
      projected('v5', 'v4', 'Below other'),
    ];
    const doc = withSheets(sheet('s1', 'A', { views, items: [text('t1')] }));
    const after = roundTrip(doc, removeSheetView({ id: vid('v1') }));
    expect(sheetById(after, sid('s1'))?.views.map((v) => v.id)).toEqual(['v4', 'v5']);
    expect(sheetById(after, sid('s1'))?.items).toEqual([text('t1')]);
    const middle = roundTrip(doc, removeSheetView({ id: vid('v2') }));
    expect(sheetById(middle, sid('s1'))?.views.map((v) => v.id)).toEqual(['v1', 'v4', 'v5']);
    expect(refused(doc, removeSheetView({ id: vid('v9') }))).toBe("View v9 doesn't exist.");
  });
});

describe('sheet items', () => {
  it('adds, edits and removes texts, each one step', () => {
    let doc = withSheets(sheet('s1', 'A'), sheet('s2', 'B'));
    doc = roundTrip(doc, addSheetItem({ sheet: sid('s1'), item: text('t1', 'Hello') }));
    doc = roundTrip(doc, addSheetItem({ sheet: sid('s2'), item: text('t2') }));
    doc = roundTrip(doc, addSheetItem({ sheet: sid('s2'), item: text('t3') }));
    doc = roundTrip(
      doc,
      updateSheetItem({
        id: iid('t1'),
        changes: { at: [30, 40], text: 'Hi\nthere', size: 7, width: 50 },
      }),
    );
    expect(sheetById(doc, sid('s1'))?.items).toEqual([
      { kind: 'text', id: 't1', at: [30, 40], text: 'Hi\nthere', size: 7, width: 50 },
    ]);
    doc = roundTrip(doc, updateSheetItem({ id: iid('t1'), changes: { width: null } }));
    expect(sheetById(doc, sid('s1'))?.items[0]).not.toHaveProperty('width');
    doc = roundTrip(doc, removeSheetItems({ ids: [iid('t1'), iid('t3')] }));
    expect(doc.sheets?.map((s) => s.items.map((i) => i.id))).toEqual([[], ['t2']]);
  });

  it('labels the step by how many items go', () => {
    expect(removeSheetItems({ ids: [iid('a')] }).label).toBe('Delete sheet item');
    expect(removeSheetItems({ ids: [iid('a'), iid('b')] }).label).toBe('Delete sheet items');
  });

  it('refuses a taken ID, a blank text, an unknown item and a change of kind', () => {
    const doc = withSheets(sheet('s1', 'A', { items: [text('t1')] }));
    expect(refused(doc, addSheetItem({ sheet: sid('s1'), item: text('t1') }))).toBe(
      'Sheet item t1 already exists.',
    );
    expect(refused(doc, updateSheetItem({ id: iid('t1'), changes: { text: '  ' } }))).toBe(
      'Sheet "A", item 1: text is blank.',
    );
    expect(refused(doc, removeSheetItems({ ids: [iid('t1'), iid('t9')] }))).toBe(
      "Sheet item t9 doesn't exist.",
    );
    const kind = { kind: 'balloon' } as unknown as Parameters<typeof updateSheetItem>[0]['changes'];
    expect(refused(doc, updateSheetItem({ id: iid('t1'), changes: kind }))).toBe(
      "The kind can't be changed.",
    );
  });
});

describe('sheets and the rest of the document', () => {
  const shown = (body: string): Sheet =>
    sheet('s1', 'A', { views: [{ ...front(), bodies: [body as BodyId] }], items: [text('t1')] });

  it('restoreVersion brings back the version’s sheets, or none', () => {
    const version = withSheets(shown('f2:0'));
    const now = withSheets(sheet('s9', 'Later'));
    expect(roundTrip(now, restoreVersion({ doc: version })).sheets).toEqual(version.sheets);
    const restored = roundTrip(now, restoreVersion({ doc: sampleDocument() }));
    expect('sheets' in restored).toBe(false);
  });

  it('removing a feature whose body a view shows leaves the sheet as it was', () => {
    const doc = withSheets(shown('f3:0'));
    const after = roundTrip(doc, removeFeature({ id: 'f3' as FeatureId }));
    expect(after.sheets).toEqual(doc.sheets);
  });

  it('remintSheets renames the bodies of copied features and leaves the rest', () => {
    const copied = [feature('cmd.f1'), feature('cmd.f2')];
    const ids = ['new1', 'new2'] as FeatureId[];
    const views = [
      { ...front(), bodies: ['cmd.f2:0', 'cmd.f1:1', 'f2:0'] as BodyId[] },
      projected('v2', 'v1'),
    ];
    const [out] = remintSheets([sheet('s1', 'A', { views, items: [text('t1')] })], copied, ids);
    expect(out?.views[0]?.bodies).toEqual(['new2:0', 'new1:1', 'f2:0']);
    expect(out?.views[1]).toEqual(projected('v2', 'v1'));
    expect(out?.items).toEqual([text('t1')]);
    expect(() => remintSheets([], copied, ['x'] as FeatureId[])).toThrow(/One new ID per feature/);
  });
});
