import { describe, expect, it } from 'vitest';
import type { BodyId, SheetItemId, SheetViewId } from './ids';
import { loadDocument, loadNotice } from './migrations';
import { DocumentSchema, type ExtrudoDocument } from './schema';
import { projectedFrom, type Sheet, sheetItemView, sheetPaperSize } from './sheet-schema';
import { front, projected, sampleDocument, sheet } from './testing';

const vid = (id: string) => id as SheetViewId;
const iid = (id: string) => id as SheetItemId;

const withSheets = (sheets: Sheet[]): ExtrudoDocument => ({ ...sampleDocument(), sheets });

/** The issues of a document, as `path message` lines. */
function issues(doc: unknown): string[] {
  const parsed = DocumentSchema.safeParse(doc);
  return parsed.success ? [] : parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`);
}

/** A sheet with every field set, a base view with every option and a projected view, and a text. */
function full(): Sheet {
  return sheet('s1', 'Assembly', {
    size: [500, 300],
    orientation: 'portrait',
    projection: 'third',
    decimals: 4,
    border: { zones: true },
    titleBlock: { template: 'full', fields: { title: 'Bracket', drawnBy: '' } },
    views: [
      {
        ...front(),
        scale: [2, 1],
        style: 'visible',
        bodies: ['f2:0' as BodyId],
        tangentEdges: false,
        centreLines: false,
        label: true,
      },
      projected('v2', 'v1', 'Right'),
      {
        ...projected('v3', 'v2', 'Iso'),
        from: { kind: 'projected', parent: vid('v2'), side: 'iso-above-right' },
      },
    ],
    items: [
      { kind: 'text', id: iid('t1'), at: [10, 10], text: 'Line one\nline two', size: 5, width: 80 },
      { kind: 'text', id: iid('t2'), at: [10, 30], text: 'Plain' },
    ],
  });
}

describe('SheetSchema in the document', () => {
  it('reads back a sheet with every field, through JSON', () => {
    const doc = withSheets([full(), sheet('s2', 'Sheet 2')]);
    const raw = JSON.parse(JSON.stringify(doc));
    const parsed = DocumentSchema.safeParse(raw);
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    expect(parsed.data).toEqual(doc);
  });

  it('is absent when there are none, and an empty list is still valid', () => {
    expect(issues(sampleDocument())).toEqual([]);
    expect('sheets' in sampleDocument()).toBe(false);
    expect(issues(withSheets([]))).toEqual([]);
  });

  it('refuses a duplicate sheet ID and, case-insensitively, a duplicate name', () => {
    expect(issues(withSheets([sheet('s1', 'Layout'), sheet('s1', 'Other')]))).toEqual([
      'sheets.1.id is s1, which another sheet has',
    ]);
    expect(issues(withSheets([sheet('s1', 'Layout'), sheet('s2', 'layout')]))).toEqual([
      'sheets.1.name is "layout", which another sheet has',
    ]);
  });

  it('refuses view and item IDs given twice in the design, and a view name twice in a sheet', () => {
    const text = {
      kind: 'text' as const,
      id: iid('t1'),
      at: [0, 0] as [number, number],
      text: 'a',
    };
    expect(
      issues(
        withSheets([
          sheet('s1', 'A', { views: [front('v1')], items: [text] }),
          sheet('s2', 'B', { views: [front('v1')], items: [text] }),
        ]),
      ),
    ).toEqual([
      'sheets.1.views.0.id is v1, which another view has',
      'sheets.1.items.0.id is t1, which another item has',
    ]);
    expect(
      issues(withSheets([sheet('s1', 'A', { views: [front('v1'), front('v2', 'FRONT')] })])),
    ).toEqual(['sheets.0.views.1.name is "FRONT", which another view of this sheet has']);
    // The same view name on two sheets is fine.
    expect(
      issues(
        withSheets([
          sheet('s1', 'A', { views: [front('v1')] }),
          sheet('s2', 'B', { views: [front('v2')] }),
        ]),
      ),
    ).toEqual([]);
  });

  it('refuses a parent that is the view itself, on another sheet, missing, or in a cycle', () => {
    const self = projected('v2', 'v2');
    expect(issues(withSheets([sheet('s1', 'A', { views: [front(), self] })]))).toEqual([
      'sheets.0.views.1.from.parent is the view itself',
    ]);
    expect(
      issues(
        withSheets([
          sheet('s1', 'A', { views: [front()] }),
          sheet('s2', 'B', { views: [projected('v2', 'v1')] }),
        ]),
      ),
    ).toEqual(['sheets.1.views.0.from.parent is v1, which is not a view of this sheet']);
    const cycle = [
      front(),
      projected('a', 'b', 'A'),
      projected('b', 'c', 'B'),
      projected('c', 'a', 'C'),
    ];
    expect(issues(withSheets([sheet('s1', 'S', { views: cycle })]))).toEqual([
      'sheets.0.views.1.from.parent makes a cycle: "A" is projected from itself through "C"',
      'sheets.0.views.2.from.parent makes a cycle: "B" is projected from itself through "A"',
      'sheets.0.views.3.from.parent makes a cycle: "C" is projected from itself through "B"',
    ]);
  });

  it('refuses a scale or a style on a projected view', () => {
    const views = [
      front(),
      { ...projected('v2', 'v1'), scale: [1, 1] as [number, number], style: 'hidden' as const },
    ];
    expect(issues(withSheets([sheet('s1', 'A', { views })]))).toEqual([
      "sheets.0.views.1.scale is set on a projected view, which takes its parent's scale",
      "sheets.0.views.1.style is set on a projected view, which takes its parent's style",
    ]);
  });

  it('refuses a base view looking nowhere or with up along its direction', () => {
    const along = (direction: [number, number, number], up: [number, number, number]) =>
      withSheets([
        sheet('s1', 'A', { views: [{ ...front(), from: { kind: 'base', direction, up } }] }),
      ]);
    expect(issues(along([0, 0, 0], [0, 0, 1]))).toEqual([
      'sheets.0.views.0.from.direction is zero',
    ]);
    expect(issues(along([0, 1, 0], [0, 0, 0]))).toEqual(['sheets.0.views.0.from.up is zero']);
    expect(issues(along([0, 1, 0], [0, -3, 0]))).toEqual([
      'sheets.0.views.0.from.up is parallel to the direction',
    ]);
  });

  it('refuses a body named twice in a view, and an empty bodies list', () => {
    const body = 'f2:0' as BodyId;
    expect(
      issues(withSheets([sheet('s1', 'A', { views: [{ ...front(), bodies: [body, body] }] })])),
    ).toEqual(['sheets.0.views.0.bodies.1 names body f2:0 twice']);
    expect(
      issues(withSheets([sheet('s1', 'A', { views: [{ ...front(), bodies: [] }] })])),
    ).toHaveLength(1);
  });

  it("accepts a body the design doesn't have (it is skipped when drawn)", () => {
    const views = [{ ...front(), bodies: ['gone:0' as BodyId] }];
    expect(issues(withSheets([sheet('s1', 'A', { views })]))).toEqual([]);
  });

  it('refuses out-of-range layout numbers and a blank text', () => {
    expect(issues(withSheets([sheet('s1', 'A', { decimals: 5 })]))).toHaveLength(1);
    expect(issues(withSheets([sheet('s1', 'A', { scale: [0, 1] })]))).toHaveLength(1);
    expect(issues(withSheets([sheet('s1', 'A', { size: [5, 300] })]))).toHaveLength(1);
    const blank = {
      kind: 'text' as const,
      id: iid('t1'),
      at: [0, 0] as [number, number],
      text: ' \n ',
    };
    expect(issues(withSheets([sheet('s1', 'A', { items: [blank] })]))).toEqual([
      'sheets.0.items.0.text is blank',
    ]);
    const field = { template: 'simple' as const, fields: { 'drawn by': 'x' } };
    expect(issues(withSheets([sheet('s1', 'A', { titleBlock: field })]))).toHaveLength(1);
  });
});

describe('sheet helpers', () => {
  it('gives the paper size for the orientation, named or custom', () => {
    expect(sheetPaperSize({ size: 'A4', orientation: 'portrait' })).toEqual({
      width: 210,
      height: 297,
    });
    expect(sheetPaperSize({ size: 'A3', orientation: 'landscape' })).toEqual({
      width: 420,
      height: 297,
    });
    expect(sheetPaperSize({ size: [300, 500], orientation: 'landscape' })).toEqual({
      width: 500,
      height: 300,
    });
    expect(sheetPaperSize({ size: 'letter', orientation: 'portrait' })).toEqual({
      width: 215.9,
      height: 279.4,
    });
  });

  it('finds the views projected from a view, through other projected views', () => {
    const s = full();
    expect(projectedFrom(s, vid('v1')).sort()).toEqual(['v2', 'v3']);
    expect(projectedFrom(s, vid('v2'))).toEqual(['v3']);
    expect(projectedFrom(s, vid('v3'))).toEqual([]);
  });

  it('places a text on the sheet, not in a view', () => {
    expect(sheetItemView(full().items[0] as Sheet['items'][number])).toBeUndefined();
  });
});

describe('loading a sheet item of a kind this version does not know (ADR-0143)', () => {
  /** A file as a newer Extrudo would write it: a balloon between two texts. */
  function newer(): Record<string, unknown> {
    const doc = withSheets([full(), sheet('s2', 'Sheet 2')]);
    const raw = JSON.parse(JSON.stringify(doc));
    raw.sheets[0].items.splice(1, 0, {
      kind: 'balloon',
      id: 'b1',
      view: 'v1',
      at: [5, 5],
      list: 'p1',
    });
    raw.sheets[1].items.push({
      kind: 'sticky',
      id: 'k1',
      at: [1, 1],
      size: [40, 40],
      text: 'later',
    });
    return raw;
  }

  it('drops the item, keeps everything else, and reports it like an unknown key', () => {
    const result = loadDocument(newer());
    expect(result.dropped).toEqual(['sheets.1.items.0', 'sheets.0.items.1']);
    expect(result.doc).toEqual(withSheets([full(), sheet('s2', 'Sheet 2')]));
    expect(loadNotice(result, 'drops')).toContain('2 settings this version doesn');
  });

  it('drops an unknown key inside a known item in the same load', () => {
    const raw = newer() as { sheets: { items: Record<string, unknown>[] }[] };
    (raw.sheets[0]?.items[2] as Record<string, unknown>).align = 'centre';
    const result = loadDocument(raw);
    expect(result.dropped.sort()).toEqual([
      'sheets.0.items.1',
      'sheets.0.items.2.align',
      'sheets.1.items.0',
    ]);
    expect(result.doc.sheets?.[0]?.items.map((i) => i.id)).toEqual(['t1', 't2']);
  });

  it('still refuses an item with no kind, or a known kind that is damaged', () => {
    const raw = newer() as { sheets: { items: Record<string, unknown>[] }[] };
    raw.sheets[0]?.items.push({ id: 'x', at: [0, 0] });
    expect(() => loadDocument(raw)).toThrow(/damaged/);
    const damaged = JSON.parse(JSON.stringify(withSheets([full()])));
    damaged.sheets[0].items[0].size = -1;
    expect(() => loadDocument(damaged)).toThrow(/damaged/);
  });
});
