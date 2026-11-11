import { describe, expect, it } from 'vitest';
import type { BodyId, SheetItemId, SheetViewId } from './ids';
import { loadDocument, loadNotice } from './migrations';
import { DocumentSchema, type ExtrudoDocument } from './schema';
import {
  dimensionProblems,
  mapSheetItemAnchors,
  projectedFrom,
  type Sheet,
  type SheetDimensionItem,
  type SheetItem,
  sheetItemAnchors,
  sheetItemProblems,
  sheetItemView,
  sheetPaperSize,
} from './sheet-schema';
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
  /** A file as a newer Extrudo would write it: a balloon between two texts, a table. */
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
      kind: 'table',
      id: 'k1',
      at: [1, 1],
      columns: [40],
      rows: [['later']],
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

describe('dimension items (ADR-0143, S3)', () => {
  const fp = { type: 'line', at: [0, 0, 5] as [number, number, number], size: 10 };
  const edge = (id = 'e[a|b]') => ({ ref: { kind: 'edge' as const, id, fingerprint: fp } });
  const face = (id = 'f[c]') => ({
    ref: {
      kind: 'face' as const,
      id,
      fingerprint: { type: 'cylinder', at: [0, 0, 0] as [number, number, number] },
    },
  });
  const vertex = {
    ref: {
      kind: 'vertex' as const,
      id: 'v[a|b|c]',
      fingerprint: { type: 'point', at: [1, 2, 3] as [number, number, number] },
    },
  };
  const dim = (extra: Partial<SheetDimensionItem> = {}): SheetDimensionItem => ({
    kind: 'dimension',
    id: iid('d1'),
    view: vid('v1'),
    type: 'linear',
    anchors: [edge()],
    at: [0, 20],
    ...extra,
  });
  const on = (...items: SheetDimensionItem[]) =>
    withSheets([sheet('s1', 'A', { views: [front()], items })]);

  it('reads back every type and anchor kind, with every option, through JSON', () => {
    const doc = on(
      dim({ direction: 'horizontal', decimals: 2, before: '2× ', after: ' max', reference: true }),
      dim({ id: iid('d2'), anchors: [{ ...edge(), at: 'start' }, vertex] }),
      dim({ id: iid('d3'), anchors: [{ free: [5, 5] }, { ...edge(), at: 'centre' }] }),
      dim({ id: iid('d4'), type: 'radius', anchors: [edge()] }),
      dim({ id: iid('d5'), type: 'diameter', anchors: [face()] }),
      dim({
        id: iid('d6'),
        type: 'diameter',
        anchors: [
          { ...face(), silhouette: 1 },
          { ...face(), silhouette: -1 },
        ],
      }),
      dim({ id: iid('d7'), type: 'angle', anchors: [edge('e1'), { ...face(), silhouette: 1 }] }),
    );
    const parsed = DocumentSchema.safeParse(JSON.parse(JSON.stringify(doc)));
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    expect(parsed.data).toEqual(doc);
    expect(sheetItemView(dim())).toBe('v1');
  });

  it('refuses a ref without a fingerprint, an index ref, and a kind no anchor takes', () => {
    const bare = { ref: { kind: 'edge', id: 'e1' } };
    const index = { ref: { ...edge().ref, id: 'index:edge:3' } };
    const plane = { ref: { kind: 'plane', id: 'origin:xy', fingerprint: fp } };
    const found = [bare, index, plane].map((anchor) =>
      issues(on(dim({ anchors: [anchor as never] }))).join('\n'),
    );
    expect(found[0]).toMatch(/sheets\.0\.items\.0\.anchors\.0/);
    expect(found[1]).toMatch(/index reference/);
    expect(found[2]).toMatch(/sheets\.0\.items\.0\.anchors\.0/);
  });

  it('refuses a view of another sheet or none, and a direction on anything but a linear one', () => {
    const other = withSheets([
      sheet('s1', 'A', { views: [front()] }),
      sheet('s2', 'B', { items: [dim()] }),
    ]);
    expect(issues(other)).toEqual([
      'sheets.1.items.0.view is v1, which is not a view of this sheet',
    ]);
    expect(issues(on(dim({ type: 'radius', direction: 'aligned' })))).toEqual([
      'sheets.0.items.0.direction is set on a radius dimension: only a linear one has a direction',
    ]);
  });

  it('refuses anchors that do not fit the type', () => {
    const cases: [Partial<SheetDimensionItem>, string][] = [
      [{ anchors: [vertex] }, "anchors don't fit a linear dimension"],
      [{ anchors: [{ ...edge(), at: 'middle' }] }, "anchors don't fit a linear dimension"],
      [{ anchors: [face()] }, "anchors don't fit a linear dimension"],
      [{ type: 'radius', anchors: [edge(), edge('e2')] }, "anchors don't fit a radius"],
      [{ type: 'radius', anchors: [{ ...face(), silhouette: 1 }] }, "anchors don't fit a radius"],
      [
        { type: 'diameter', anchors: [edge(), { ...face(), silhouette: 1 }] },
        "anchors don't fit a diameter",
      ],
      [{ type: 'angle', anchors: [edge()] }, "anchors don't fit an angle"],
      [{ type: 'angle', anchors: [edge(), { free: [0, 0] }] }, "anchors don't fit an angle"],
      [{ anchors: [{ ...vertex, at: 'start' }, edge()] }, 'anchors.0 takes the start of a vertex'],
      [{ anchors: [{ ...face(), at: 'centre' }, edge()] }, 'anchors.0 takes the centre of a face'],
      [{ anchors: [{ ...edge(), silhouette: 1 }, edge()] }, 'anchors.0 is an outline of an edge'],
    ];
    for (const [extra, message] of cases) {
      expect(issues(on(dim(extra))).join('\n'), JSON.stringify(extra)).toMatch(
        new RegExp(`sheets\\.0\\.items\\.0\\.${message}`),
      );
    }
    expect(issues(on(dim({ anchors: [] })))).not.toEqual([]);
    expect(issues(on(dim({ anchors: [edge(), edge(), edge()] })))).not.toEqual([]);
    expect(dimensionProblems(dim({ type: 'angle', anchors: [edge(), edge('e2')] }))).toEqual([]);
  });

  it('refuses out-of-range decimals and a long affix', () => {
    expect(issues(on(dim({ decimals: 5 })))).not.toEqual([]);
    expect(issues(on(dim({ decimals: 1.5 })))).not.toEqual([]);
    expect(issues(on(dim({ before: 'x'.repeat(101) })))).not.toEqual([]);
  });

  it('accepts an anchor whose geometry the design no longer has (it is drawn detached)', () => {
    expect(issues(on(dim({ anchors: [edge('e[gone|gone]')] })))).toEqual([]);
  });
});

describe('notes and centre lines (ADR-0143, S4)', () => {
  const fp = { type: 'line', at: [0, 0, 5] as [number, number, number], size: 10 };
  const edge = (id = 'e[a|b]') => ({ ref: { kind: 'edge' as const, id, fingerprint: fp } });
  const face = (id = 'f[c]') => ({
    ref: {
      kind: 'face' as const,
      id,
      fingerprint: { type: 'cylinder', at: [0, 0, 0] as [number, number, number] },
    },
  });
  const vertex = {
    ref: {
      kind: 'vertex' as const,
      id: 'v[a|b|c]',
      fingerprint: { type: 'point', at: [1, 2, 3] as [number, number, number] },
    },
  };
  const leader = (extra: Partial<Extract<SheetItem, { kind: 'leader' }>> = {}): SheetItem => ({
    kind: 'leader',
    id: iid('n1'),
    view: vid('v1'),
    anchor: edge(),
    at: [20, 20],
    text: '4× Ø5 through\nCountersunk',
    ...extra,
  });
  const sticky = (extra: Partial<Extract<SheetItem, { kind: 'sticky' }>> = {}): SheetItem => ({
    kind: 'sticky',
    id: iid('k1'),
    at: [300, 30],
    size: [50, 30],
    text: 'Check the fit',
    ...extra,
  });
  const centre = (
    kind: 'centreMark' | 'centreLine',
    anchors: Extract<SheetItem, { kind: 'centreMark' }>['anchors'],
    id = 'c1',
  ): SheetItem => ({ kind, id: iid(id), view: vid('v1'), anchors });
  const on = (...items: SheetItem[]) => withSheets([sheet('s1', 'A', { views: [front()], items })]);

  it('reads back every kind with every option through JSON, and says which view each is in', () => {
    const doc = on(
      leader(),
      leader({ id: iid('n2'), anchor: face() }),
      leader({ id: iid('n3'), anchor: { free: [1, 2] } }),
      leader({ id: iid('n4'), anchor: { ...edge(), at: 'centre' } }),
      leader({ id: iid('n5'), anchor: { ...face(), silhouette: -1 } }),
      sticky({ color: 'pink', print: true }),
      sticky({ id: iid('k2') }),
      centre('centreMark', [edge()]),
      centre('centreMark', [face()], 'c2'),
      centre('centreLine', [edge(), { ...face(), silhouette: 1 }], 'c3'),
      centre('centreLine', [face()], 'c4'),
    );
    const parsed = DocumentSchema.safeParse(JSON.parse(JSON.stringify(doc)));
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    expect(parsed.data).toEqual(doc);
    expect(sheetItemView(leader())).toBe('v1');
    expect(sheetItemView(centre('centreLine', [face()]))).toBe('v1');
    expect(sheetItemView(sticky())).toBeUndefined();
  });

  it("lists each kind's anchors in one place, and maps them in the same order", () => {
    expect(sheetItemAnchors(leader())).toEqual([edge()]);
    expect(sheetItemAnchors(centre('centreLine', [edge('e1'), edge('e2')]))).toEqual([
      edge('e1'),
      edge('e2'),
    ]);
    expect(sheetItemAnchors(sticky())).toEqual([]);
    expect(sheetItemAnchors({ kind: 'text', id: iid('t'), at: [0, 0], text: 'x' })).toEqual([]);
    const renamed = mapSheetItemAnchors(leader(), () => ({ free: [9, 9] }));
    expect(renamed).toEqual({ ...leader(), anchor: { free: [9, 9] } });
    const s = sticky();
    expect(mapSheetItemAnchors(s, () => ({ free: [0, 0] }))).toBe(s);
  });

  it('refuses a sticky note out of range, in an unknown colour, printed as false, or blank', () => {
    expect(issues(on(sticky({ size: [4, 30] })))).not.toEqual([]);
    expect(issues(on(sticky({ size: [50, 1001] })))).not.toEqual([]);
    expect(issues(on(sticky({ color: 'red' as never })))).not.toEqual([]);
    expect(issues(on(sticky({ print: false as never })))).not.toEqual([]);
    expect(issues(on(sticky({ text: '  ' })))).not.toEqual([]);
    expect(issues(on(leader({ text: '' })))).not.toEqual([]);
    // A sticky note may not name a view: it belongs to the sheet.
    expect(issues(on({ ...sticky(), view: 'v1' } as never))).not.toEqual([]);
  });

  it("refuses a note's or a centre line's view on another sheet", () => {
    const other = withSheets([
      sheet('s1', 'A', { views: [front()] }),
      sheet('s2', 'B', { items: [leader(), centre('centreMark', [edge()])] }),
    ]);
    expect(issues(other)).toEqual([
      'sheets.1.items.0.view is v1, which is not a view of this sheet',
      'sheets.1.items.1.view is v1, which is not a view of this sheet',
    ]);
  });

  it('refuses anchors that do not fit the kind', () => {
    const cases: [SheetItem, string][] = [
      [leader({ anchor: { ...vertex, at: 'start' } }), 'anchor takes the start of a vertex'],
      [leader({ anchor: { ...edge(), silhouette: 1 } }), 'anchor is an outline of an edge'],
      [centre('centreMark', [vertex]), "anchors don't fit a centre mark"],
      [centre('centreMark', [{ ...edge(), at: 'centre' }]), "anchors don't fit a centre mark"],
      [centre('centreMark', [{ ...face(), silhouette: 1 }]), "anchors don't fit a centre mark"],
      [centre('centreMark', [edge(), edge('e2')]), "anchors don't fit a centre mark"],
      [centre('centreMark', [{ free: [0, 0] }]), "anchors don't fit a centre mark"],
      [centre('centreLine', [edge()]), "anchors don't fit a centre line"],
      [centre('centreLine', [face(), face('f2')]), "anchors don't fit a centre line"],
      [centre('centreLine', [edge(), { free: [0, 0] }]), "anchors don't fit a centre line"],
      [centre('centreLine', [edge(), vertex]), "anchors don't fit a centre line"],
      [centre('centreLine', [{ ...vertex, at: 'end' }]), 'anchors.0 takes the end of a vertex'],
    ];
    for (const [item, message] of cases) {
      expect(issues(on(item)).join('\n'), JSON.stringify(item)).toMatch(
        new RegExp(`sheets\\.0\\.items\\.0\\.${message}`),
      );
    }
    expect(issues(on(centre('centreLine', [])))).not.toEqual([]);
    expect(sheetItemProblems(centre('centreLine', [edge(), edge('e2')]))).toEqual([]);
    expect(sheetItemProblems(leader({ anchor: vertex }))).toEqual([]);
  });

  it('accepts anchors whose geometry the design no longer has (they are drawn detached)', () => {
    expect(issues(on(leader({ anchor: edge('e[gone|gone]') })))).toEqual([]);
    expect(issues(on(centre('centreMark', [edge('e[gone|gone]')])))).toEqual([]);
  });
});
