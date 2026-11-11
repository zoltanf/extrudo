import { describe, expect, it } from 'vitest';
import { updateParameter } from './document-commands';
import type { ParameterId, SheetItemId } from './ids';
import type { ExtrudoDocument } from './schema';
import {
  fillSheetFields,
  mapSheetFieldTexts,
  renameSheetFieldReferences,
  sheetFieldExpressions,
} from './sheet-fields';
import type { Sheet, SheetItem } from './sheet-schema';
import { createDocumentStore } from './stores';
import { front, sampleDocument, sheet } from './testing';

const iid = (id: string) => id as SheetItemId;

describe('text fields in braces (ADR-0143, S5)', () => {
  const values = {
    name: 'Bracket',
    sheet: '2',
    sheets: '3',
    scale: '1:2',
    expression: (e: string) =>
      e === 'wall' ? '3.00 mm' : e === 'wall * 2' ? '6.00 mm' : undefined,
  };

  it('fills every field it has a value for and leaves the rest as typed', () => {
    expect(fillSheetFields('{name}, sheet {sheet} of {sheets} at {scale}', values)).toBe(
      'Bracket, sheet 2 of 3 at 1:2',
    );
    // No date or version in the values; an unknown field; a blank and a failing expression.
    expect(fillSheetFields('{date} {version} {author} {=} {= nope} {Name}', values)).toBe(
      '{date} {version} {author} {=} {= nope} {Name}',
    );
    expect(fillSheetFields('Wall {= wall}, twice {=wall * 2 }.', values)).toBe(
      'Wall 3.00 mm, twice 6.00 mm.',
    );
    expect(fillSheetFields('{ {name} }', values)).toBe('{ Bracket }');
  });

  it('finds the expressions and renames a parameter inside them only', () => {
    const text = 'wall is {= wall} and {= wall * 2 + wallet}; {name} wall';
    expect(sheetFieldExpressions(text)).toEqual(['wall', 'wall * 2 + wallet']);
    expect(renameSheetFieldReferences(text, 'wall', 'side')).toBe(
      'wall is {= side} and {= side * 2 + wallet}; {name} wall',
    );
  });

  it('maps the texts that take fields and keeps the other items and an unchanged sheet', () => {
    const items: SheetItem[] = [
      { kind: 'text', id: iid('t1'), at: [0, 0], text: 'T {sheet}' },
      {
        kind: 'leader',
        id: iid('n1'),
        view: 'v1' as never,
        anchor: { free: [0, 0] },
        at: [5, 5],
        text: 'L {sheet}',
      },
      { kind: 'table', id: iid('k1'), at: [0, 0], columns: [10, 10], rows: [['{sheet}', 'x']] },
      { kind: 'sticky', id: iid('s1'), at: [0, 0], size: [20, 20], text: 'S {sheet}' },
    ];
    const s = sheet('s1', 'A', {
      views: [front()],
      items,
      titleBlock: { template: 'simple', fields: { title: '{name}', date: '2026' } },
    });
    const out = mapSheetFieldTexts(s, (t) => fillSheetFields(t, values));
    expect(out.items.map((i) => ('text' in i ? i.text : 'rows' in i ? i.rows : i))).toEqual([
      'T 2',
      'L 2',
      [['2', 'x']],
      'S {sheet}',
    ]);
    expect(out.items[3]).toBe(items[3]);
    expect(out.titleBlock?.fields).toEqual({ title: 'Bracket', date: '2026' });
    expect(mapSheetFieldTexts(s, (t) => t)).toBe(s);
  });

  it('renaming a parameter rewrites it in sheet text, in the same undo step', () => {
    const items: SheetItem[] = [
      { kind: 'text', id: iid('t1'), at: [0, 0], text: 'Wall {= wall}, not wall' },
      { kind: 'table', id: iid('k1'), at: [0, 0], columns: [10], rows: [['{= 2 * wall}']] },
    ];
    const doc: ExtrudoDocument = {
      ...sampleDocument(),
      sheets: [
        sheet('s1', 'A', {
          views: [front()],
          items,
          titleBlock: { template: 'simple', fields: { title: 'Wall {=wall}' } },
        }),
      ],
    };
    const store = createDocumentStore(doc);
    store
      .getState()
      .dispatch(updateParameter({ id: 'p2' as ParameterId, changes: { name: 'side' } }));
    const [after] = store.getState().doc.sheets as Sheet[];
    expect(after?.items[0]).toMatchObject({ text: 'Wall {= side}, not wall' });
    expect(after?.items[1]).toMatchObject({ rows: [['{= 2 * side}']] });
    expect(after?.titleBlock?.fields.title).toBe('Wall {=side}');
    store.getState().undo();
    expect(store.getState().doc).toEqual(doc);
  });
});
