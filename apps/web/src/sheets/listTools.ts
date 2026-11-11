/**
 * The list tools' pure parts (P6-24 S5, plan §4.1, §4.5): what Parts List, Balloon and Table
 * make, the words their panels say, and the changes their cards make.
 *
 * - **Parts List**: a click on a view chooses it, then the list follows the pointer and a
 *   click places its top-left corner (sheet mm). Its rows are that view's bodies.
 * - **Balloon**: one pick of anything on a body of a view that has a parts list (an edge
 *   whole, a vertex, an outline, a face), as a leader note's; the balloon then follows the
 *   pointer with its number and a click places it. **Which list**: the first parts list of
 *   the picked view in the sheet's order (the one placed first); its card can choose another
 *   list of the sheet.
 * - **Table**: a click places a small free table (two columns, three empty rows); its cells
 *   are typed in place.
 */
import {
  type BodyId,
  SHEET_PARTS_COLUMNS,
  SHEET_TABLE_COLUMNS_MAX,
  SHEET_TABLE_ROWS_MAX,
  type Sheet,
  type SheetBalloonItem,
  type SheetItemId,
  type SheetParts,
  type SheetPartsColumn,
  type SheetPartsListItem,
  type SheetPartsRow,
  type SheetTableItem,
  type SheetViewId,
  type Vec2,
} from '@extrudo/core';
import { pickAnchor, type SheetHit, type SheetPick } from './dimensionTool';

// Parts lists ---------------------------------------------------------------------------

/** A new parts list of `view` with its top-left corner at `at` (sheet mm): every column. */
export function partsListItem(id: SheetItemId, view: SheetViewId, at: Vec2): SheetPartsListItem {
  return { kind: 'partsList', id, view, at: [at[0], at[1]] };
}

/** The parts lists of `sheet`, in its order. */
export const partsListsOf = (sheet: Sheet): SheetPartsListItem[] =>
  sheet.items.filter((i): i is SheetPartsListItem => i.kind === 'partsList');

/** What the Parts List tool's panel asks for next. */
export function partsListStep(view: string | undefined): string {
  return view === undefined
    ? 'Click a view: its bodies become the rows.'
    : `Click where the list of ${view} goes (its top-left corner).`;
}

/**
 * A parts list's columns with `column` shown or hidden: always in the default order, `null`
 * when all six are shown (the document leaves the key out then), or why not (the last one).
 */
export function withColumnShown(
  columns: readonly SheetPartsColumn[] | undefined,
  column: SheetPartsColumn,
  on: boolean,
): SheetPartsColumn[] | null | string {
  const shown = new Set(columns ?? SHEET_PARTS_COLUMNS);
  if (on) shown.add(column);
  else shown.delete(column);
  if (shown.size === 0) return 'A parts list shows at least one column.';
  const next = SHEET_PARTS_COLUMNS.filter((c) => shown.has(c));
  return next.length === SHEET_PARTS_COLUMNS.length ? null : next;
}

/**
 * A parts list's typed-over rows with a row's `field` set to `text` (written under the row's
 * first body) or, for `undefined` or blank text, back to the model's own (removed under every
 * body of the row, since a typed text under any of them counts). `null` when nothing is left.
 */
export function withRowText(
  rows: SheetPartsListItem['rows'],
  bodies: readonly BodyId[],
  field: keyof SheetPartsRow,
  text: string | undefined,
): Record<BodyId, SheetPartsRow> | null {
  const next: Record<BodyId, SheetPartsRow> = {};
  const [first] = bodies;
  // The row's own typed values, from whichever body they were under (the first in order).
  const typed: SheetPartsRow = {};
  for (const body of [...bodies].reverse()) Object.assign(typed, rows?.[body]);
  for (const [id, row] of Object.entries(rows ?? {}) as [BodyId, SheetPartsRow][]) {
    if (!bodies.includes(id)) next[id] = row;
  }
  const value = text?.trim() ? text : undefined;
  const own: SheetPartsRow = { ...typed };
  if (value === undefined) delete own[field];
  else own[field] = value;
  if (first && Object.keys(own).length > 0) next[first] = own;
  return Object.keys(next).length > 0 ? next : null;
}

// Balloons ------------------------------------------------------------------------------

/** The parts list a balloon on `view` takes its number from: the first of that view's. */
export function balloonListOf(sheet: Sheet, view: SheetViewId): SheetPartsListItem | undefined {
  return partsListsOf(sheet).find((l) => l.view === view);
}

/**
 * Whether a click on `hit` is a balloon's pick: the first pick, on a view with a parts list,
 * and on a body that list shows (when the list's bodies are known yet).
 */
export function balloonAccepts(
  sheet: Sheet,
  parts: SheetParts | undefined,
  hit: SheetHit,
  picks: readonly SheetPick[],
): boolean {
  if (picks.length > 0) return false;
  const list = balloonListOf(sheet, hit.pickable.view);
  if (!list) return false;
  const bodies = parts?.lists[list.id];
  return bodies === undefined || bodies.includes(hit.pickable.body);
}

/** The balloon a pick makes, numbered by `list`, its circle at `at` (view mm). */
export function balloonItem(
  id: SheetItemId,
  picks: readonly SheetPick[],
  at: Vec2,
  list: SheetItemId | undefined,
): SheetBalloonItem | undefined {
  const [first] = picks;
  if (!first || !list) return undefined;
  return {
    kind: 'balloon',
    id,
    view: first.view,
    anchor: pickAnchor(first),
    at: [at[0], at[1]],
    list,
  };
}

/** What the Balloon tool's panel asks for next. */
export function balloonStep(sheet: Sheet, picks: readonly SheetPick[]): string {
  if (partsListsOf(sheet).length === 0) {
    return 'This sheet has no parts list yet: place one with Parts List first.';
  }
  return picks.length === 0
    ? 'Pick a part in a view with a parts list: an edge, a point or a face.'
    : 'Click where the balloon goes.';
}

/**
 * Which list numbers the balloons of each view that has one, for the panel: "Front: its
 * parts list", or, with two or more, that the first one placed is taken.
 */
export function balloonLists(sheet: Sheet): string[] {
  const out: string[] = [];
  for (const view of sheet.views) {
    const lists = partsListsOf(sheet).filter((l) => l.view === view.id);
    if (lists.length === 1) out.push(`${view.name}: numbered by its parts list.`);
    else if (lists.length > 1) {
      out.push(
        `${view.name} has ${lists.length} parts lists: balloons take the first one placed; a balloon's card can choose another.`,
      );
    }
  }
  return out;
}

/** A person's name for a parts list: "Parts list of Front". */
export function partsListName(sheet: Sheet, list: Pick<SheetPartsListItem, 'view' | 'id'>): string {
  const view = sheet.views.find((v) => v.id === list.view)?.name ?? 'no view';
  const same = partsListsOf(sheet).filter((l) => l.view === list.view);
  const n = same.findIndex((l) => l.id === list.id);
  return same.length > 1 ? `Parts list ${n + 1} of ${view}` : `Parts list of ${view}`;
}

// Free tables ---------------------------------------------------------------------------

/** A new table's column widths, mm, and its rows. */
export const NEW_TABLE = { columns: [25, 45], rows: 3 } as const;
/** A column added on a card, mm. */
export const NEW_COLUMN_WIDTH = 25;

/** A new free table at `at` (its top-left, sheet mm): two columns, three empty rows. */
export function newTable(id: SheetItemId, at: Vec2): SheetTableItem {
  return {
    kind: 'table',
    id,
    at: [at[0], at[1]],
    columns: [...NEW_TABLE.columns],
    rows: Array.from({ length: NEW_TABLE.rows }, () => NEW_TABLE.columns.map(() => '')),
  };
}

/** The cell (row, column) under `p` (sheet mm), from the table's grid (`sheetTableGrid`). */
export function tableCellAt(
  grid: {
    lefts: readonly number[];
    widths: readonly number[];
    tops: readonly number[];
    heights: readonly number[];
  },
  p: Vec2,
): { row: number; column: number } | undefined {
  const column = grid.lefts.findIndex((x, i) => p[0] >= x && p[0] <= x + (grid.widths[i] ?? 0));
  const row = grid.tops.findIndex((y, i) => p[1] >= y && p[1] <= y + (grid.heights[i] ?? 0));
  return row < 0 || column < 0 ? undefined : { row, column };
}

/** The table's rows with one cell's text set. */
export function withCell(
  item: SheetTableItem,
  row: number,
  column: number,
  text: string,
): string[][] {
  return item.rows.map((r, i) => (i === row ? r.map((c, j) => (j === column ? text : c)) : [...r]));
}

/** The changes that add an empty row after row `after` (at the end when absent), or why not. */
export function withRowAdded(item: SheetTableItem, after?: number): { rows: string[][] } | string {
  if (item.rows.length >= SHEET_TABLE_ROWS_MAX)
    return `A table has at most ${SHEET_TABLE_ROWS_MAX} rows.`;
  const at = after === undefined ? item.rows.length : after + 1;
  const rows = item.rows.map((r) => [...r]);
  rows.splice(
    at,
    0,
    item.columns.map(() => ''),
  );
  return { rows };
}

/** The changes that remove row `row` (the last when absent), or why not. */
export function withRowRemoved(item: SheetTableItem, row?: number): { rows: string[][] } | string {
  if (item.rows.length <= 1) return 'A table keeps at least one row: delete the table instead.';
  const at = row ?? item.rows.length - 1;
  return { rows: item.rows.filter((_, i) => i !== at).map((r) => [...r]) };
}

/** The changes that add an empty column after `after` (at the end when absent), or why not. */
export function withColumnAdded(
  item: SheetTableItem,
  after?: number,
): { columns: number[]; rows: string[][] } | string {
  if (item.columns.length >= SHEET_TABLE_COLUMNS_MAX) {
    return `A table has at most ${SHEET_TABLE_COLUMNS_MAX} columns.`;
  }
  const at = after === undefined ? item.columns.length : after + 1;
  const columns = [...item.columns];
  columns.splice(at, 0, NEW_COLUMN_WIDTH);
  const rows = item.rows.map((r) => {
    const next = [...r];
    next.splice(at, 0, '');
    return next;
  });
  return { columns, rows };
}

/** The changes that remove column `column` (the last when absent), or why not. */
export function withColumnRemoved(
  item: SheetTableItem,
  column?: number,
): { columns: number[]; rows: string[][] } | string {
  if (item.columns.length <= 1)
    return 'A table keeps at least one column: delete the table instead.';
  const at = column ?? item.columns.length - 1;
  return {
    columns: item.columns.filter((_, i) => i !== at),
    rows: item.rows.map((r) => r.filter((_, i) => i !== at)),
  };
}

/** The table's widths with column `column` at `width` mm. */
export function withWidth(item: SheetTableItem, column: number, width: number): number[] {
  return item.columns.map((w, i) => (i === column ? width : w));
}
