/**
 * Lists on a sheet (P6-24 S5, ADR-0143's S5 amendment): a parts list's rows
 * from the bodies of its view, a free table, and balloons numbered by a
 * parts list, as display items. Nothing here is stored: the rows come from
 * the model each time (`KernelApi.sheetParts` measures the bodies,
 * `sheetPartBodies` adds their names from the document), and only what a
 * person typed over a row is in the document.
 *
 * Frames: a parts list's and a table's `at` are sheet mm (top-left, y down);
 * a balloon's `at` and its anchor are in its view's own mm, as a leader's.
 */
import {
  type BodyId,
  type ExtrudoDocument,
  type LengthUnit,
  lengthFactor,
  SHEET_PARTS_COLUMNS,
  type Sheet,
  type SheetAnchors,
  type SheetBalloonItem,
  type SheetItemId,
  type SheetPartMeasure,
  type SheetParts,
  type SheetPartsColumn,
  type SheetPartsListItem,
  type SheetTableItem,
  sheetViewFrame,
  type Vec2,
} from '@extrudo/core';
import type { Contour, DisplayItem, Point } from '@extrudo/io';
import { num } from '@extrudo/io';
import {
  add,
  anchorsState,
  closest,
  Drawing,
  followAnchors,
  len,
  placeAnchors,
  type Shape,
  type SheetItemState,
  scale,
  sub,
  unit,
  viewToSheet,
} from './anchored';
import { fitLine, LINE_SPACING, textRun, textWidth, wrapText } from './text';

/** Paper sizes of tables and balloons, mm. */
export const SHEET_TABLE = {
  /** A row's height with one line of text, the header's too. */
  row: 7,
  /** Cell text and a balloon's number (`SHEET_TEXT_SIZE`). */
  text: 3.5,
  /** A parts list's header labels, in capitals. */
  label: 2.2,
  /** Between a cell's text and its left and right lines. */
  padding: 2,
  /** The grid's lines and the outline's (`SHEET_LINE.hidden`, `.visible`). */
  grid: 0.25,
  outline: 0.5,
  /** A parts list column is at least this wide, and a name or material at most this. */
  minColumn: 8,
  maxText: 60,
  /** The smallest a parts list cell's text shrinks to before it is cut. */
  minText: 2.5,
  /** The header row's fill. */
  header: '#eef1f5',
  /** A balloon's smallest radius; it grows to hold its number. */
  balloon: 4,
  /** A balloon's leader: line width, arrowhead, the dot on a face. */
  line: 0.18,
  arrow: 3,
  arrowWidth: 1,
  dot: 0.75,
} as const;

// Rows from the model -----------------------------------------------------------------

/** One body of a parts list's view: its name and component (the document's) and its measure (the kernel's). */
export interface SheetPartBody {
  id: BodyId;
  name: string;
  /** The name of the component it belongs to, if any. */
  component?: string;
  /** Absent when the kernel couldn't measure it: no size, no mass, never merged. */
  measure?: SheetPartMeasure;
}

/** Each parts list's bodies, by list ID: what layout takes (`SheetContext.parts`). */
export type SheetPartsBodies = Readonly<Record<SheetItemId, readonly SheetPartBody[]>>;

/** The kernel's report joined with the names the document gives the bodies and their components. */
export function sheetPartBodies(
  doc: Pick<ExtrudoDocument, 'bodies' | 'components'>,
  parts: SheetParts,
): Record<SheetItemId, SheetPartBody[]> {
  const components = new Map<string, string>((doc.components ?? []).map((c) => [c.id, c.name]));
  const out: Record<SheetItemId, SheetPartBody[]> = {};
  for (const [list, ids] of Object.entries(parts.lists) as [SheetItemId, BodyId[]][]) {
    out[list] = ids.map((id) => {
      const meta = doc.bodies[id];
      const component = meta?.component ? components.get(meta.component) : undefined;
      const measure = parts.bodies[id];
      return {
        id,
        name: meta?.name ?? id,
        ...(component !== undefined && { component }),
        ...(measure && { measure }),
      };
    });
  }
  return out;
}

/** One row of a parts list, before it is written. */
export interface SheetPartsRowData {
  /** The item number, from 1 in row order: what a balloon shows. */
  item: number;
  /** The bodies the row stands for, in the list's order; the first keys what was typed over it. */
  bodies: BodyId[];
  qty: number;
  /** Typed over the row, else the body's name (a merged row's shared name stem, or its component's). */
  name: string;
  /** Typed over the row, else empty. */
  material: string;
  /** The box's three sides, mm, longest first; absent when the body wasn't measured. */
  size?: [number, number, number];
  /** One piece's volume, mm³. */
  volume?: number;
}

/** A name without the number that tells copies apart: "Shelf 2", "Shelf_3", "Shelf (4)" are "Shelf". */
export function sheetNameStem(name: string): string {
  const stem = name.trim().replace(/[\s_.#-]*\(?\d+\)?$/, '');
  return stem === '' ? name.trim() : stem;
}

const sides = (m: SheetPartMeasure): [number, number, number] =>
  [0, 1, 2]
    .map((i) => Math.abs((m.box.max[i] ?? 0) - (m.box.min[i] ?? 0)))
    .sort((a, b) => b - a) as [number, number, number];

/** Equal volumes (to a millionth) and boxes (to a thousandth of a mm, in any orientation). */
function sameMeasure(a: SheetPartMeasure, b: SheetPartMeasure): boolean {
  const dv = Math.abs(a.volume - b.volume);
  if (dv > 1e-6 * Math.max(1, Math.abs(a.volume), Math.abs(b.volume))) return false;
  const [sa, sb] = [sides(a), sides(b)];
  return sa.every((s, i) => Math.abs(s - (sb[i] ?? 0)) <= 1e-3);
}

/**
 * A parts list's rows (plan §4.5): its view's bodies in their order, a body
 * merged into an earlier row when both have equal volumes and boxes and
 * either the same component name or the same name stem, the quantity
 * counting them. A row's name is what was typed over it (under any of its
 * bodies, the first that has one), else its one body's name, else the
 * merged bodies' shared stem, else their component's name; the material is
 * typed or empty. Rows are numbered from 1 in order.
 */
export function sheetPartsRows(
  list: Pick<SheetPartsListItem, 'rows'>,
  bodies: readonly SheetPartBody[],
): SheetPartsRowData[] {
  const groups: SheetPartBody[][] = [];
  const seen = new Set<string>();
  for (const body of bodies) {
    if (seen.has(body.id)) continue;
    seen.add(body.id);
    const group = groups.find(([first]) => {
      if (!first?.measure || !body.measure || !sameMeasure(first.measure, body.measure)) {
        return false;
      }
      if (first.component !== undefined && first.component === body.component) return true;
      return sheetNameStem(first.name).toLowerCase() === sheetNameStem(body.name).toLowerCase();
    });
    if (group) group.push(body);
    else groups.push([body]);
  }
  return groups.map((group, i) => {
    const [first] = group as [SheetPartBody, ...SheetPartBody[]];
    const typed = (key: 'name' | 'material') =>
      group.map((b) => list.rows?.[b.id]?.[key]).find((v) => v !== undefined);
    const stems = new Set(group.map((b) => sheetNameStem(b.name)));
    const own =
      group.length === 1
        ? first.name
        : stems.size === 1
          ? sheetNameStem(first.name)
          : (first.component ?? first.name);
    return {
      item: i + 1,
      bodies: group.map((b) => b.id),
      qty: group.length,
      name: typed('name') ?? own,
      material: typed('material') ?? '',
      ...(first.measure && { size: sides(first.measure), volume: first.measure.volume }),
    };
  });
}

export interface SheetPartsOptions {
  /** The design's length unit, which sizes are written in; absent: mm. */
  units?: LengthUnit;
  /** The decimals sizes show (the sheet's). */
  decimals?: number;
  /** The filament's density, g/cm³ (an app preference); absent: the Mass cells are empty. */
  density?: number;
}

/** A column's header as the sheet writes it (in capitals). */
export function sheetPartsHeader(column: SheetPartsColumn, units: LengthUnit = 'mm'): string {
  switch (column) {
    case 'item':
      return 'Item';
    case 'qty':
      return 'Qty';
    case 'name':
      return 'Name';
    case 'material':
      return 'Material';
    case 'size':
      return `Size (${units})`;
    case 'mass':
      return 'Mass (g)';
  }
}

/** One piece's mass in grams as written: two decimals under 10 g, one under 100 g, else whole. */
function grams(volume: number, density: number): string {
  const g = (volume / 1000) * density;
  return num(g, g < 10 ? 2 : g < 100 ? 1 : 0);
}

/** A row's cell texts for `columns`. */
export function sheetPartsCells(
  row: SheetPartsRowData,
  columns: readonly SheetPartsColumn[],
  options: SheetPartsOptions = {},
): string[] {
  const k = lengthFactor(options.units ?? 'mm');
  const decimals = options.decimals ?? 0;
  return columns.map((column) => {
    switch (column) {
      case 'item':
        return String(row.item);
      case 'qty':
        return String(row.qty);
      case 'name':
        return row.name;
      case 'material':
        return row.material;
      case 'size':
        return row.size ? row.size.map((s) => (s / k).toFixed(decimals)).join(' × ') : '';
      case 'mass':
        return row.volume !== undefined && options.density !== undefined && options.density > 0
          ? grams(row.volume, options.density)
          : '';
    }
  });
}

// Layout --------------------------------------------------------------------------------

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

const segment = (a: Point, b: Point): Contour => ({
  start: a,
  segments: [{ type: 'line', to: b }],
  closed: false,
});

/** A grid of `widths` and `heights` from `at`: its inner lines and its outline. */
function grid(at: Point, widths: readonly number[], heights: readonly number[], key: string) {
  const [x0, y0] = at;
  const w = widths.reduce((a, b) => a + b, 0);
  const h = heights.reduce((a, b) => a + b, 0);
  const inner: Contour[] = [];
  let x = x0;
  for (const width of widths.slice(0, -1)) {
    x += width;
    inner.push(segment([x, y0], [x, y0 + h]));
  }
  let y = y0;
  for (const height of heights.slice(0, -1)) {
    y += height;
    inner.push(segment([x0, y], [x0 + w, y]));
  }
  const out: DisplayItem[] = [];
  if (inner.length > 0) {
    out.push({
      type: 'path',
      contours: inner,
      stroke: { width: SHEET_TABLE.grid, cap: 'butt' },
      key,
    });
  }
  out.push({
    type: 'path',
    contours: [rect(x0, y0, x0 + w, y0 + h)],
    stroke: { width: SHEET_TABLE.outline, join: 'miter' },
    key,
  });
  return out;
}

/**
 * A parts list in sheet mm, keyed `item:<id>`: a header row (filled, its
 * labels in small capitals), then one row per `sheetPartsRows` row, 7 mm
 * each, one line per cell. A column is as wide as its widest text (at least
 * 8 mm); a name or material at most 60 mm, a longer one shrinking to 2.5 mm
 * letters and then cut with "…". With no bodies (or none known yet) it is
 * its header alone.
 */
export function layoutSheetPartsList(
  item: SheetPartsListItem,
  bodies: readonly SheetPartBody[] | undefined,
  options: SheetPartsOptions = {},
): DisplayItem[] {
  const key = `item:${item.id}`;
  const columns = item.columns ?? SHEET_PARTS_COLUMNS;
  const rows = sheetPartsRows(item, bodies ?? []).map((row) =>
    sheetPartsCells(row, columns, options),
  );
  const headers = columns.map((c) => sheetPartsHeader(c, options.units).toUpperCase());
  const { row: h, text: size, label, padding: pad } = SHEET_TABLE;
  const widths = columns.map((column, c) => {
    const natural = Math.max(
      textWidth(headers[c] as string, label),
      ...rows.map((r) => textWidth(r[c] as string, size)),
    );
    const capped = column === 'name' || column === 'material' ? SHEET_TABLE.maxText : Infinity;
    return Math.max(SHEET_TABLE.minColumn, Math.min(capped, natural + 2 * pad));
  });
  const [x0, y0] = item.at;
  const total = widths.reduce((a, b) => a + b, 0);
  const out: DisplayItem[] = [
    {
      type: 'path',
      contours: [rect(x0, y0, x0 + total, y0 + h)],
      fill: { color: SHEET_TABLE.header },
      key,
    },
  ];
  out.push(...grid(item.at, widths, [h, ...rows.map(() => h)], key));
  const lefts = widths.map((_, c) => x0 + widths.slice(0, c).reduce((a, b) => a + b, 0) + pad);
  headers.forEach((text, c) => {
    out.push(
      textRun(text, [lefts[c] as number, y0 + h / 2 + label / 2], label, {
        color: '#5b6375',
        key,
      }),
    );
  });
  rows.forEach((cells, r) => {
    const baseline = y0 + (r + 1) * h + h / 2 + size / 2;
    cells.forEach((text, c) => {
      if (text.trim() === '') return;
      const room = (widths[c] as number) - 2 * pad;
      const fitted = fitLine(text, size, room, SHEET_TABLE.minText);
      out.push(
        textRun(
          fitted.text,
          [lefts[c] as number, baseline - (size - fitted.height) / 2],
          fitted.height,
          { key },
        ),
      );
    });
  });
  return out;
}

/** A free table's row heights: 7 mm, or more for a cell with more lines. */
function tableLines(item: SheetTableItem): { lines: string[][][]; heights: number[] } {
  const { row: h, text: size, padding: pad } = SHEET_TABLE;
  const lines = item.rows.map((row) =>
    row.map((text, c) => wrapText(text, size, Math.max(1, (item.columns[c] ?? 0) - 2 * pad))),
  );
  const heights = lines.map((row) => {
    const n = Math.max(1, ...row.map((cell) => cell.length));
    return h + (n - 1) * size * LINE_SPACING;
  });
  return { lines, heights };
}

/**
 * A free table in sheet mm, keyed `item:<id>`: its columns as stored, each
 * cell's text wrapped inside the column (between words, or inside a word
 * too long for it), a row as tall as its tallest cell (7 mm for one line,
 * a line spacing more per line), the text from the cell's top-left. No
 * header: the first row is a row like the others.
 */
export function layoutSheetTable(item: SheetTableItem): DisplayItem[] {
  const key = `item:${item.id}`;
  const { row: h, text: size, padding: pad } = SHEET_TABLE;
  const { lines, heights } = tableLines(item);
  const out = grid(item.at, item.columns, heights, key);
  const [x0, y0] = item.at;
  let top = y0;
  lines.forEach((row, r) => {
    let left = x0;
    row.forEach((cell, c) => {
      cell.forEach((line, i) => {
        if (line.trim() === '') return;
        const baseline = top + h / 2 + size / 2 + i * size * LINE_SPACING;
        out.push(textRun(line, [left + pad, baseline], size, { key }));
      });
      left += item.columns[c] ?? 0;
    });
    top += heights[r] ?? h;
  });
  return out;
}

// Balloons ------------------------------------------------------------------------------

const LOST_BALLOON =
  'This balloon lost what it points at: drag its end onto the part, or delete it.';
const NOT_LISTED = "This balloon points at a body that isn't in its parts list.";

export interface SheetBalloonStatus {
  state: SheetItemState;
  message?: string;
  /** Its number: the item of its body's row; `?` when that isn't known. */
  number: string;
}

interface SolvedBalloon extends SheetBalloonStatus {
  at: Vec2;
  shape?: Shape;
}

function solveBalloon(
  sheet: Sheet,
  item: SheetBalloonItem,
  anchors: SheetAnchors | undefined,
  parts: SheetPartsBodies | undefined,
): SolvedBalloon {
  const frame = sheetViewFrame(sheet, item.view);
  if (!frame) {
    return { state: 'detached', message: "The balloon's view is gone.", at: item.at, number: '?' };
  }
  const reports = anchors?.[item.id];
  const at = followAnchors(item.at, [item.anchor], reports, frame);
  let state = anchorsState([item.anchor], reports);
  const placed = placeAnchors([item.anchor], reports, frame);
  const shape = placed.shapes?.[0];
  let message = placed.problem ?? (shape ? undefined : LOST_BALLOON);
  if (placed.problem) state = 'invalid';
  else if (!shape) state = 'detached';
  else if (state === 'detached') message = LOST_BALLOON;
  // The number: the row of the body the anchor is on, in the list's rows now.
  const body = reports?.[0]?.body;
  const list = sheet.items.find((it) => it.id === item.list);
  const bodies = parts?.[item.list];
  let number = '?';
  if (body && list?.kind === 'partsList' && bodies) {
    const row = sheetPartsRows(list, bodies).find((r) => r.bodies.includes(body));
    if (row) number = String(row.item);
    else if (state !== 'detached') {
      state = 'invalid';
      message = NOT_LISTED;
    }
  }
  return { state, at, number, ...(shape && { shape }), ...(message && { message }) };
}

/** A balloon's state, why, and its number, as the browser row and the status bar say them. */
export function sheetBalloonStatus(
  sheet: Sheet,
  item: SheetBalloonItem,
  anchors: SheetAnchors | undefined,
  parts: SheetPartsBodies | undefined,
): SheetBalloonStatus {
  const { state, message, number } = solveBalloon(sheet, item, anchors, parts);
  return { state, number, ...(message && { message }) };
}

/** Where on `shape` a leader from `from` lands (view mm), as a leader note's. */
function tipOf(shape: Shape, from: Vec2): Vec2 {
  switch (shape.kind) {
    case 'point':
      return shape.p;
    case 'line':
      return closest(shape, from);
    case 'circle':
      return shape.at(unit(sub(from, shape.centre)) ?? [1, 0]);
  }
}

/**
 * A balloon in sheet mm, keyed `item:<id>`: a circle (4 mm radius, more for
 * a long number) round `at` with its number in the middle, and a leader
 * from the circle's edge to what the anchor names, ending in a filled
 * arrowhead on an edge or a point and in a dot on a face, as a leader
 * note's. A lost balloon with no geometry kept is its circle alone; the
 * number is `?` until its body's row is known. Every item carries the
 * state unless it is `ok`.
 */
export function layoutSheetBalloon(
  sheet: Sheet,
  item: SheetBalloonItem,
  anchors: SheetAnchors | undefined,
  parts: SheetPartsBodies | undefined,
): DisplayItem[] {
  const view = sheet.views.find((v) => v.id === item.view);
  if (!view) return [];
  const { S } = viewToSheet(sheet, view);
  const solved = solveBalloon(sheet, item, anchors, parts);
  const { text: size, arrow, dot } = SHEET_TABLE;
  const draw = new Drawing(`item:${item.id}`, solved.state, {
    line: SHEET_TABLE.line,
    arrow,
    arrowWidth: SHEET_TABLE.arrowWidth,
    text: size,
    lift: 0,
  });
  const c = S(solved.at);
  const w = textWidth(solved.number, size);
  const r = Math.max(SHEET_TABLE.balloon, w / 2 + 1.5);
  const start: Point = [c[0] + r, c[1]];
  draw.arc(c, start, 2 * Math.PI, start);
  if (solved.shape) {
    const tip = S(tipOf(solved.shape, solved.at));
    const towards = unit(sub(tip, c));
    const face =
      'ref' in item.anchor && !('silhouette' in item.anchor) && item.anchor.ref.kind === 'face';
    if (towards && len(sub(tip, c)) > r + (face ? dot : arrow)) {
      const from = add(c, scale(towards, r));
      if (face) {
        draw.dot(tip, dot);
        draw.line(from, sub(tip, scale(towards, dot)));
      } else {
        draw.arrow(tip, towards);
        draw.line(from, sub(tip, scale(towards, arrow / 2)));
      }
    }
  }
  draw.run(textRun(solved.number, [c[0] - w / 2, c[1] + size / 2], size));
  return draw.items();
}
