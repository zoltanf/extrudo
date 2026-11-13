// Parts lists, balloons, tables and text fields laid out (P6-24 S5, ADR-0143's
// S5 amendment), with the bodies' measures and the anchors' geometry given by
// hand: a front view (looking along +Y, Z up, so view x is world X and view y
// world Z) at (100, 100) on the sheet, 1:1. `parts.kernel.test.ts` does the
// same from a part the kernel builds.
import { readFileSync, writeFileSync } from 'node:fs';
import {
  type BodyId,
  createDocument,
  type DocumentId,
  evaluateParameters,
  type ParameterId,
  type Sheet,
  type SheetAnchorReport,
  type SheetAnchors,
  type SheetBalloonItem,
  type SheetId,
  type SheetItem,
  type SheetItemId,
  type SheetPartMeasure,
  type SheetPartsListItem,
  type SheetTableItem,
  type SheetViewId,
  sheetStandardFrom,
} from '@extrudo/core';
import type { DisplayItem, DisplayPath, DisplayText } from '@extrudo/io';
import { loadFont } from '@extrudo/sketch/text';
import { beforeAll, describe, expect, it } from 'vitest';
import { layoutSheet } from './layout';
import { sheetItemStatus } from './notes';
import { sheetToSvg } from './output';
import {
  layoutSheetBalloon,
  layoutSheetPartsList,
  layoutSheetTable,
  SHEET_TABLE,
  type SheetPartBody,
  sheetBalloonStatus,
  sheetNameStem,
  sheetPartBodies,
  sheetPartsCells,
  sheetPartsRows,
  sheetTableGrid,
} from './parts';
import { SHEET_FONT, textWidth } from './text';

beforeAll(() => {
  const fonts = new URL('../../fonts/fonts/', import.meta.url);
  loadFont(SHEET_FONT.regular, readFileSync(new URL('inter-regular.ttf', fonts)));
  loadFont(SHEET_FONT.bold, readFileSync(new URL('inter-bold.ttf', fonts)));
});

const FRONT = 'front' as SheetViewId;
const bid = (id: string) => id as BodyId;
const iid = (id: string) => id as SheetItemId;

function sheetOf(items: SheetItem[], extra: Partial<Sheet> = {}): Sheet {
  return {
    id: 's1' as SheetId,
    name: 'Sheet 1',
    size: [200, 150],
    orientation: 'landscape',
    scale: [1, 1],
    projection: 'first',
    decimals: 0,
    views: [{ id: FRONT, name: 'Front', at: [100, 100], from: sheetStandardFrom('front') }],
    items,
    ...extra,
  };
}

/** A box's measure: its sides along x, y, z and a volume (a solid box's unless given). */
const box = (x: number, y: number, z: number, volume = x * y * z): SheetPartMeasure => ({
  volume,
  box: { min: [0, 0, 0], max: [x, y, z] },
});
const body = (
  id: string,
  name: string,
  measure?: SheetPartMeasure,
  component?: string,
): SheetPartBody => ({
  id: bid(id),
  name,
  ...(measure && { measure }),
  ...(component && { component }),
});

const list = (extra: Partial<SheetPartsListItem> = {}): SheetPartsListItem => ({
  kind: 'partsList',
  id: iid('p1'),
  view: FRONT,
  at: [10, 10],
  ...extra,
});

/** A base frame: a top, two legs (the second turned a quarter, so its box is turned too), a rail. */
const FRAME: SheetPartBody[] = [
  body('top:0', 'Top', box(600, 400, 18)),
  body('leg1:0', 'Leg 1', box(50, 50, 700)),
  body('leg2:0', 'Leg 2', box(50, 50, 700)),
  body('rail:0', 'Rail', box(500, 18, 80)),
];

describe('parts list rows (plan §4.5)', () => {
  it('takes the name without its number as the stem', () => {
    expect(
      ['Shelf 2', 'Shelf_3', 'Shelf (4)', 'Shelf-5', 'Body12', 'Top', '42'].map(sheetNameStem),
    ).toEqual(['Shelf', 'Shelf', 'Shelf', 'Shelf', 'Body', 'Top', '42']);
  });

  it('merges two identical bodies into one row with a quantity, numbered in order', () => {
    const rows = sheetPartsRows(list(), FRAME);
    expect(rows.map(({ item, qty, name, bodies }) => ({ item, qty, name, bodies }))).toEqual([
      { item: 1, qty: 1, name: 'Top', bodies: ['top:0'] },
      { item: 2, qty: 2, name: 'Leg', bodies: ['leg1:0', 'leg2:0'] },
      { item: 3, qty: 1, name: 'Rail', bodies: ['rail:0'] },
    ]);
    expect(rows[1]?.size).toEqual([700, 50, 50]);
    expect(rows[0]?.volume).toBe(600 * 400 * 18);
  });

  it('merges a turned copy, and keeps apart other sizes, other names and unmeasured bodies', () => {
    const turned = { volume: 500 * 18 * 80, box: { min: [0, 0, 0], max: [18, 500, 80] } } as const;
    const rows = sheetPartsRows(list(), [
      body('a:0', 'Rail 1', box(500, 18, 80)),
      body('b:0', 'Rail 2', turned as SheetPartMeasure),
      body('c:0', 'Rail 3', box(500, 18, 81)),
      body('d:0', 'Batten', box(500, 18, 80)),
      body('e:0', 'Rail 4'),
      body('f:0', 'Rail 5'),
      // A hollow one: the same box, less volume.
      body('g:0', 'Rail 6', box(500, 18, 80, 1000)),
    ]);
    expect(rows.map((r) => r.bodies)).toEqual([
      ['a:0', 'b:0'],
      ['c:0'],
      ['d:0'],
      ['e:0'],
      ['f:0'],
      ['g:0'],
    ]);
  });

  it('merges bodies of one component name whatever their names, and names the row after it', () => {
    const rows = sheetPartsRows(list(), [
      body('l:0', 'Left side', box(400, 18, 300), 'Side'),
      body('r:0', 'Right side', box(400, 18, 300), 'Side'),
      body('o:0', 'Other', box(400, 18, 300), 'Door'),
    ]);
    expect(rows.map(({ qty, name }) => ({ qty, name }))).toEqual([
      { qty: 2, name: 'Side' },
      { qty: 1, name: 'Other' },
    ]);
  });

  it('takes a typed name and material over a row, under any of its bodies', () => {
    const typed = list({
      rows: { [bid('leg2:0')]: { name: 'Leg, front' }, [bid('top:0')]: { material: 'Birch ply' } },
    });
    const rows = sheetPartsRows(typed, FRAME);
    expect(rows.map(({ name, material }) => [name, material])).toEqual([
      ['Top', 'Birch ply'],
      ['Leg, front', ''],
      ['Rail', ''],
    ]);
    // A typed name never splits a merged row.
    expect(rows[1]?.qty).toBe(2);
  });

  it('writes the cells: size in the unit at the decimals, mass from a density or nothing', () => {
    const [top, legs] = sheetPartsRows(list(), FRAME);
    const all = ['item', 'qty', 'name', 'material', 'size', 'mass'] as const;
    expect(sheetPartsCells(top as never, all)).toEqual(['1', '1', 'Top', '', '600 × 400 × 18', '']);
    expect(sheetPartsCells(legs as never, ['qty', 'size', 'mass'], { density: 1.24 })).toEqual([
      '2',
      '700 × 50 × 50',
      // 50 × 50 × 700 mm³ = 1750 cm³ at 1.24 g/cm³, one piece.
      '2170',
    ]);
    expect(sheetPartsCells(top as never, ['size'], { units: 'in', decimals: 2 })).toEqual([
      '23.62 × 15.75 × 0.71',
    ]);
    const small = sheetPartsRows(list(), [body('w:0', 'Washer', box(10, 10, 1, 50))])[0];
    expect(sheetPartsCells(small as never, ['mass'], { density: 1.24 })).toEqual(['0.06']);
  });

  it("joins the kernel's report with the document's names and components", () => {
    const doc = {
      bodies: {
        [bid('a:0')]: { name: 'Leg 1', visible: true, component: 'c1' as never },
        [bid('b:0')]: { name: 'Leg 2', visible: true },
      },
      components: [{ id: 'c1', name: 'Frame' }] as never,
    };
    const parts = {
      lists: { [iid('p1')]: [bid('a:0'), bid('b:0'), bid('x:0')] },
      bodies: { [bid('a:0')]: box(1, 2, 3) },
    };
    expect(sheetPartBodies(doc, parts)).toEqual({
      p1: [
        { id: 'a:0', name: 'Leg 1', component: 'Frame', measure: box(1, 2, 3) },
        { id: 'b:0', name: 'Leg 2' },
        { id: 'x:0', name: 'x:0' },
      ],
    });
  });
});

const texts = (items: readonly DisplayItem[]) =>
  items.filter((i): i is DisplayText => i.type === 'text').map((t) => t.text);
const runs = (items: readonly DisplayItem[]) =>
  items.filter((i): i is DisplayText => i.type === 'text');
const paths = (items: readonly DisplayItem[]) =>
  items.filter((i): i is DisplayPath => i.type === 'path');

describe('parts list layout', () => {
  it('draws a filled header row and one 7 mm row per row, columns as wide as their text', () => {
    const item = list({ columns: ['item', 'qty', 'name', 'size'] });
    const out = layoutSheetPartsList(item, FRAME);
    expect(out.every((i) => i.key === 'item:p1')).toBe(true);
    expect(texts(out)).toEqual([
      'ITEM',
      'QTY',
      'NAME',
      'SIZE (MM)',
      '1',
      '1',
      'Top',
      '600 × 400 × 18',
      '2',
      '2',
      'Leg',
      '700 × 50 × 50',
      '3',
      '1',
      'Rail',
      '500 × 80 × 18',
    ]);
    const [fill, , outline] = paths(out);
    const { padding: pad, row, text: size, minColumn } = SHEET_TABLE;
    // As wide as the widest of the header (2.2 mm capitals) and the cells, padded, at least 8 mm.
    const natural = (header: string, cells: string[]) =>
      Math.max(
        minColumn,
        textWidth(header, SHEET_TABLE.label) + 2 * pad,
        ...cells.map((c) => textWidth(c, size) + 2 * pad),
      );
    const widths = [
      natural('ITEM', ['1', '2', '3']),
      natural('QTY', ['1', '2', '1']),
      natural('NAME', ['Top', 'Leg', 'Rail']),
      natural('SIZE (MM)', ['600 × 400 × 18', '700 × 50 × 50', '500 × 80 × 18']),
    ];
    const total = widths.reduce((a, b) => a + b, 0);
    expect(fill?.fill?.color).toBe(SHEET_TABLE.header);
    expect(fill?.contours[0]?.start).toEqual([10, 10]);
    // The outline: 4 rows of 7 mm.
    const corner = outline?.contours[0]?.segments[1];
    expect(corner?.type === 'line' && corner.to[0]).toBeCloseTo(10 + total, 6);
    expect(corner?.type === 'line' && corner.to[1]).toBeCloseTo(10 + 4 * row, 6);
    // Each cell's text 2 mm from its column's left, its capitals centred in the row.
    const legSize = runs(out).find((t) => t.text === '700 × 50 × 50');
    expect(legSize?.at[0]).toBeCloseTo(
      10 + (widths[0] ?? 0) + (widths[1] ?? 0) + (widths[2] ?? 0) + pad,
      6,
    );
    expect(legSize?.at[1]).toBeCloseTo(10 + 2 * row + row / 2 + size / 2, 6);
  });

  it('shows all six columns by default, keeps a name to 60 mm, and is its header alone with no bodies', () => {
    const long = 'A very long name for a part that nobody would ever want to read on a sheet';
    const out = layoutSheetPartsList(list(), [body('a:0', long, box(1, 1, 1))]);
    expect(texts(out).slice(0, 6)).toEqual([
      'ITEM',
      'QTY',
      'NAME',
      'MATERIAL',
      'SIZE (MM)',
      'MASS (G)',
    ]);
    const name = runs(out).find((t) => t.text.startsWith('A very'));
    expect(name?.width).toBeLessThanOrEqual(SHEET_TABLE.maxText - 2 * SHEET_TABLE.padding + 1e-9);
    expect(name?.text.endsWith('…')).toBe(true);
    expect(texts(layoutSheetPartsList(list(), undefined))).toHaveLength(6);
  });
});

describe('table layout', () => {
  const table: SheetTableItem = {
    kind: 'table',
    id: iid('k1'),
    at: [20, 30],
    columns: [30, 60],
    rows: [
      ['Clearance', '0.2 mm all round'],
      ['Finish', 'Sand to 240 grit, then two coats of oil'],
      ['', ''],
    ],
  };

  it('wraps a cell inside its column and makes its row as tall as its lines', () => {
    const out = layoutSheetTable(table);
    const { row, text: size, padding: pad } = SHEET_TABLE;
    const lines = runs(out).filter((t) => t.at[0] > 20 + 30);
    // The second column's cells: one line, then the long one wrapped into n lines.
    const n = lines.length - 1;
    expect(n).toBeGreaterThanOrEqual(2);
    expect(lines[0]?.text).toBe('0.2 mm all round');
    expect(
      lines
        .slice(1)
        .map((t) => t.text)
        .join(' '),
    ).toBe('Sand to 240 grit, then two coats of oil');
    for (const t of lines) {
      expect(t.width).toBeLessThanOrEqual(60 - 2 * pad);
      expect(t.at[0]).toBe(20 + 30 + pad);
    }
    expect(lines.map((t) => t.at[1])).toEqual([
      30 + row / 2 + size / 2,
      ...Array.from({ length: n }, (_, i) => 30 + row + row / 2 + size / 2 + i * size * 1.6),
    ]);
    // The outline: rows of 7, 7 + (n − 1) lines, 7 mm.
    const outline = paths(out).at(-1);
    const corner = outline?.contours[0]?.segments[1];
    expect(corner?.type === 'line' && corner.to).toEqual([
      110,
      30 + 3 * row + (n - 1) * size * 1.6,
    ]);
    expect(out.every((i) => i.key === 'item:k1')).toBe(true);
  });

  it("gives the cells' places as drawn, a wrapped row taller (the app's typing in place)", () => {
    const grid = sheetTableGrid(table);
    const { row, text: size } = SHEET_TABLE;
    const n = runs(layoutSheetTable(table)).filter((t) => t.at[0] > 50).length - 1;
    expect(grid.lefts).toEqual([20, 50]);
    expect(grid.widths).toEqual([30, 60]);
    expect(grid.heights).toEqual([row, row + (n - 1) * size * 1.6, row]);
    expect(grid.tops).toEqual([30, 30 + row, 30 + 2 * row + (n - 1) * size * 1.6]);
  });
});

describe('balloons', () => {
  const EDGE: SheetAnchorReport = {
    status: 'ok',
    geometry: { type: 'line', start: [-20, 0, 10], end: [20, 0, 10] },
    body: bid('leg2:0'),
  };
  const FACE: SheetAnchorReport = {
    status: 'ok',
    geometry: { type: 'point', point: [0, 0, 5] },
    body: bid('rail:0'),
  };
  const fingerprint = { type: 'line', at: [0, 0, 10] as [number, number, number] };
  const balloon = (
    id: string,
    at: [number, number],
    kind: 'edge' | 'face' = 'edge',
  ): SheetBalloonItem => ({
    kind: 'balloon',
    id: iid(id),
    view: FRONT,
    anchor: { ref: { kind, id: `${kind}-ref`, fingerprint } },
    at,
    list: iid('p1'),
  });
  const parts = { [iid('p1')]: FRAME };

  it("shows its body's item, its leader ending in an arrow on an edge and a dot on a face", () => {
    const b1 = balloon('b1', [30, 30]);
    const b2 = balloon('b2', [-30, -20], 'face');
    const sheet = sheetOf([list(), b1, b2]);
    const anchors = { b1: [EDGE], b2: [FACE] } as SheetAnchors;
    const one = layoutSheetBalloon(sheet, b1, anchors, parts);
    expect(texts(one)).toEqual(['2']);
    const [lines, fills] = paths(one);
    // The circle round (130, 70) on the sheet, then the leader towards the edge's nearest point (120, 90).
    expect(lines?.contours[0]?.start).toEqual([130 + SHEET_TABLE.balloon, 70]);
    expect(fills?.contours[0]?.start).toEqual([120, 90]);
    const number = runs(one)[0];
    expect(number?.at[0]).toBeCloseTo(130 - (number?.width ?? 0) / 2, 9);
    expect(number?.at[1]).toBeCloseTo(70 + SHEET_TABLE.text / 2, 9);
    const two = layoutSheetBalloon(sheet, b2, anchors, parts);
    expect(texts(two)).toEqual(['3']);
    // A dot on the face's point (100, 95).
    const dot = paths(two)[1]?.contours[0];
    expect(dot?.segments[0]?.type).toBe('arc');
    expect(dot?.start).toEqual([100 + SHEET_TABLE.dot, 95]);
    expect(sheetItemStatus(sheet, b1, anchors, { parts })).toEqual({ state: 'ok' });
  });

  it('shows ? until its list is known, and is invalid on a body the list lacks or lost with nothing kept', () => {
    const b1 = balloon('b1', [30, 30]);
    const sheet = sheetOf([list(), b1]);
    expect(sheetBalloonStatus(sheet, b1, { b1: [EDGE] } as SheetAnchors, undefined)).toEqual({
      state: 'ok',
      number: '?',
    });
    const other = { b1: [{ ...EDGE, body: bid('shelf:0') }] } as SheetAnchors;
    expect(sheetBalloonStatus(sheet, b1, other, parts)).toEqual({
      state: 'invalid',
      number: '?',
      message: "This balloon points at a body that isn't in its parts list.",
    });
    const lost = { b1: [{ status: 'detached' }] } as SheetAnchors;
    const out = layoutSheetBalloon(sheet, b1, lost, parts);
    expect(texts(out)).toEqual(['?']);
    expect(paths(out)).toHaveLength(1);
    expect(out.every((i) => i.state === 'detached')).toBe(true);
    expect(sheetItemStatus(sheet, b1, lost, { parts }).message).toMatch(/lost what it points at/);
  });
});

describe('text fields in layout', () => {
  const doc = {
    ...createDocument({ id: 'd' as DocumentId, name: 'Frame', now: '2026-11-11T10:00:00.000Z' }),
    parameters: [
      { id: 'p' as ParameterId, name: 'clearance', expression: '0.2 mm', unit: 'length' as const },
    ],
  };
  const evaluate = evaluateParameters(doc).evaluate;
  const items: SheetItem[] = [
    { kind: 'text', id: iid('t1'), at: [10, 10], text: 'Sheet {sheet} of {sheets}, {scale}' },
    {
      kind: 'text',
      id: iid('t2'),
      at: [10, 20],
      text: 'Gap {= clearance}, twice {= 2 * clearance}',
    },
    { kind: 'text', id: iid('t3'), at: [10, 30], text: '{date} {version} {author} {= nope}' },
    { kind: 'table', id: iid('k1'), at: [10, 40], columns: [40], rows: [['{name}']] },
  ];

  it('fills fields from the sheets and the context, and leaves what has no value as typed', () => {
    const sheet = sheetOf(items, {
      decimals: 2,
      titleBlock: { template: 'simple', fields: { title: '{name}', version: '{version}' } },
    });
    const second = { ...sheet, id: 's2' as SheetId, name: 'Two' };
    const list = layoutSheet(sheet, { name: 'Frame', sheets: [second, sheet], evaluate });
    const all = texts(list.items);
    expect(all).toContain('Sheet 2 of 2, 1:1');
    expect(all).toContain('Gap 0.20 mm, twice 0.40 mm');
    expect(all).toContain('{date} {version} {author} {= nope}');
    expect(texts(list.items.filter((i) => i.key === 'item:k1'))).toEqual(['Frame']);
    expect(texts(list.items.filter((i) => i.key === 'title-block:title'))).toEqual([
      'TITLE',
      'Frame',
    ]);
    const dated = layoutSheet(sheet, { date: '2026-11-11', version: 'V3', units: 'in' });
    expect(texts(dated.items)).toContain('2026-11-11 V3 {author} {= nope}');
    expect(texts(dated.items)).toContain('Gap {= clearance}, twice {= 2 * clearance}');
    expect(texts(dated.items.filter((i) => i.key === 'title-block:version'))).toEqual([
      'VERSION',
      'V3',
    ]);
    // In inches, at the sheet's decimals.
    const inches = layoutSheet(sheet, { evaluate, units: 'in' });
    expect(texts(inches.items)).toContain('Gap 0.01 in, twice 0.02 in');
  });
});

describe('golden files', () => {
  // One small golden file per kind (UPDATE_GOLDEN=1 rewrites them).
  const golden = (name: string, sheet: Sheet, context: Parameters<typeof sheetToSvg>[1]) => {
    const svg = sheetToSvg(sheet, context);
    const path = new URL(`./golden/${name}.svg`, import.meta.url);
    if (process.env.UPDATE_GOLDEN) writeFileSync(path, svg);
    expect(svg).toBe(readFileSync(path, 'utf8'));
  };

  it('matches the golden file of a parts list', () => {
    const item = list({ rows: { [bid('top:0')]: { material: 'Birch ply' } } });
    golden('parts-list', sheetOf([item]), { parts: { [iid('p1')]: FRAME }, density: 0.68 });
  });

  it('matches the golden file of a table', () => {
    const item: SheetTableItem = {
      kind: 'table',
      id: iid('k1'),
      at: [10, 10],
      columns: [30, 50],
      rows: [
        ['Clearance', '0.2 mm'],
        ['Finish', 'Sand to 240 grit, then oil'],
      ],
    };
    golden('table', sheetOf([item]), {});
  });

  it('matches the golden file of balloons', () => {
    const fingerprint = { type: 'line', at: [0, 0, 10] as [number, number, number] };
    const b = (id: string, at: [number, number], kind: 'edge' | 'face'): SheetItem => ({
      kind: 'balloon',
      id: iid(id),
      view: FRONT,
      anchor: { ref: { kind, id: `${kind}-ref`, fingerprint } },
      at,
      list: iid('p1'),
    });
    const sheet = sheetOf([
      { ...list(), at: [10, 120] },
      b('b1', [40, 30], 'edge'),
      b('b2', [-40, -15], 'face'),
    ]);
    golden('balloon', sheet, {
      parts: { [iid('p1')]: FRAME },
      anchors: {
        b1: [
          {
            status: 'ok',
            geometry: { type: 'line', start: [-20, 0, 10], end: [20, 0, 10] },
            body: bid('leg1:0'),
          },
        ],
        b2: [{ status: 'ok', geometry: { type: 'point', point: [0, 0, 5] }, body: bid('top:0') }],
      } as SheetAnchors,
    });
  });
});
