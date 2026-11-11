/**
 * Drawing sheets' commands (P6-24, ADR-0143; plan §5.2). Every sheet edit is
 * its own command and undo step; IDs come in the payload (`newId()` in the
 * caller), so recipes stay deterministic. Each recipe checks the sheets it
 * leaves against the schema and `sheetProblems`, so a command never makes a
 * design the loader refuses; `sheets` goes when the last sheet does.
 *
 * Sheets are in no feature's cache key and the recompute never reads them.
 * Removing a feature or a body never touches a sheet: a view's `bodies` entry
 * that names no body is skipped when the view is drawn.
 */
import { CommandError, type CommandFactory, type DocumentDraft, defineCommand } from './commands';
import type { SheetId, SheetItemId, SheetViewId } from './ids';
import type { ExtrudoDocument } from './schema';
import {
  findSheetItem,
  findSheetView,
  projectedFrom,
  type Sheet,
  type SheetItem,
  SheetSchema,
  type SheetView,
  sheetItemView,
  sheetProblems,
} from './sheet-schema';
import { z } from './zod';

/** Changes to an object's fields: `undefined` leaves a field, `null` deletes an optional one. */
export type SheetChangesOf<T> = { [K in keyof T]?: T[K] | null };

/** What `updateSheet` changes: anything but the ID, the views and the items. */
export type SheetChanges = SheetChangesOf<Omit<Sheet, 'id' | 'views' | 'items'>>;
/** What `updateSheetView` changes: anything but the ID. */
export type SheetViewChanges = SheetChangesOf<Omit<SheetView, 'id'>>;
/** What `updateSheetItem` changes: anything but the ID and the kind, per kind. */
export type SheetItemChanges = SheetItem extends infer I
  ? I extends SheetItem
    ? SheetChangesOf<Omit<I, 'id' | 'kind'>>
    : never
  : never;

/** The sheet with this ID, if the design has one. */
export function sheetById(doc: Pick<ExtrudoDocument, 'sheets'>, id: SheetId): Sheet | undefined {
  return (doc.sheets ?? []).find((s) => s.id === id);
}

/** The sheet a view with this ID is on, if any. */
export function sheetOfView(
  doc: Pick<ExtrudoDocument, 'sheets'>,
  id: SheetViewId,
): Sheet | undefined {
  const at = findSheetView(doc.sheets ?? [], id);
  return at && doc.sheets?.[at.sheet];
}

const SheetsSchema = z.array(SheetSchema);

/** A copy of payload JSON, so the document never shares (and freezes) the caller's objects. */
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** Where a problem is, for a person: `Sheet "Layout", view "Front", name`. */
function where(sheets: readonly Sheet[], path: readonly PropertyKey[]): string {
  const [s, list, i, ...rest] = path;
  const sheet = typeof s === 'number' ? sheets[s] : undefined;
  const parts: string[] = [];
  if (sheet) parts.push(`Sheet "${sheet.name}"`);
  if (list === 'views' && typeof i === 'number') {
    const view = sheet?.views[i];
    parts.push(view ? `view "${view.name}"` : `view ${i + 1}`);
  } else if (list === 'items' && typeof i === 'number') {
    parts.push(`item ${i + 1}`);
  } else if (list !== undefined) {
    rest.unshift(...(i === undefined ? [] : [i]));
    rest.unshift(list);
  }
  const field = rest.map(String).join('.');
  return field ? `${parts.join(', ')}: ${field}` : parts.join(', ');
}

/** Drops the balloons whose parts list `sheet` no longer has (it was deleted with them). */
function dropOrphanBalloons(sheet: Sheet): void {
  const lists = new Set<string>(
    sheet.items.filter((item) => item.kind === 'partsList').map((item) => item.id),
  );
  if (sheet.items.some((item) => item.kind === 'balloon' && !lists.has(item.list))) {
    sheet.items = sheet.items.filter((item) => item.kind !== 'balloon' || lists.has(item.list));
  }
}

/** Refuses the change unless the sheets it leaves are valid; drops `sheets` when empty. */
function settle(draft: DocumentDraft): void {
  const sheets = (draft.sheets ?? []) as Sheet[];
  if (sheets.length === 0) {
    delete draft.sheets;
    return;
  }
  const parsed = SheetsSchema.safeParse(sheets);
  const issue = parsed.success ? sheetProblems(sheets)[0] : parsed.error.issues[0];
  if (issue) throw new CommandError(`${where(sheets, issue.path)} ${issue.message}.`);
}

function sheetsOf(draft: DocumentDraft): Sheet[] {
  draft.sheets ??= [];
  return draft.sheets as Sheet[];
}

function sheetAt(draft: DocumentDraft, id: SheetId): Sheet {
  const sheet = (draft.sheets as Sheet[] | undefined)?.find((s) => s.id === id);
  if (!sheet) throw new CommandError(`Sheet ${id} doesn't exist.`);
  return sheet;
}

function viewAt(draft: DocumentDraft, id: SheetViewId): { sheet: Sheet; view: SheetView } {
  const sheets = (draft.sheets ?? []) as Sheet[];
  const at = findSheetView(sheets, id);
  if (!at) throw new CommandError(`View ${id} doesn't exist.`);
  const sheet = sheets[at.sheet] as Sheet;
  return { sheet, view: sheet.views[at.view] as SheetView };
}

function itemAt(draft: DocumentDraft, id: SheetItemId): SheetItem {
  const sheets = (draft.sheets ?? []) as Sheet[];
  const at = findSheetItem(sheets, id);
  if (!at) throw new CommandError(`Sheet item ${id} doesn't exist.`);
  return (sheets[at.sheet] as Sheet).items[at.item] as SheetItem;
}

/** Applies `changes` to `target`: `null` deletes, `undefined` leaves; refuses the `fixed` keys. */
function merge(target: object, changes: object, fixed: readonly string[]): void {
  const into = target as Record<string, unknown>;
  for (const [key, value] of Object.entries(changes)) {
    if (value === undefined) continue;
    if (fixed.includes(key)) throw new CommandError(`The ${key} can't be changed.`);
    if (value === null) delete into[key];
    else into[key] = copy(value);
  }
}

function checkIndex(index: number, length: number): void {
  if (!Number.isInteger(index) || index < 0 || index > length) {
    throw new CommandError(`Position ${index} is outside 0 to ${length}.`);
  }
}

/**
 * A new sheet, at `index` (default: after the last). The caller gives the
 * whole sheet, views and items included (a copy of another sheet, a sheet an
 * agent built). One undo step.
 */
export const addSheet = defineCommand<{ sheet: Sheet; index?: number }>(
  'sheet.add',
  'New sheet',
  (draft, { sheet, index }) => {
    const sheets = sheetsOf(draft);
    if (sheets.some((s) => s.id === sheet.id)) {
      throw new CommandError(`Sheet ${sheet.id} already exists.`);
    }
    const at = index ?? sheets.length;
    checkIndex(at, sheets.length);
    sheets.splice(at, 0, copy(sheet));
    settle(draft);
  },
);

/** Changes a sheet's setup (name, size, orientation, scale, projection, decimals, border, title block). One undo step. */
export const updateSheet = defineCommand<{ id: SheetId; changes: SheetChanges }>(
  'sheet.update',
  'Sheet setup',
  (draft, { id, changes }) => {
    merge(sheetAt(draft, id), changes, ['id', 'views', 'items']);
    settle(draft);
  },
);

/** Deletes a sheet with its views and items; `sheets` goes with the last one. One undo step. */
export const removeSheet = defineCommand<{ id: SheetId }>(
  'sheet.remove',
  'Delete sheet',
  (draft, { id }) => {
    const sheets = sheetsOf(draft);
    sheets.splice(sheets.indexOf(sheetAt(draft, id)), 1);
    settle(draft);
  },
);

/** Moves a sheet to `index` in page order (0 is the first page). One undo step. */
export const moveSheet = defineCommand<{ id: SheetId; index: number }>(
  'sheet.move',
  'Move sheet',
  (draft, { id, index }) => {
    const sheets = sheetsOf(draft);
    checkIndex(index, sheets.length - 1);
    const [sheet] = sheets.splice(sheets.indexOf(sheetAt(draft, id)), 1);
    sheets.splice(index, 0, sheet as Sheet);
    settle(draft);
  },
);

/** A new view on a sheet, drawn after the others. One undo step. */
export const addSheetView = defineCommand<{ sheet: SheetId; view: SheetView }>(
  'sheet.view.add',
  'New view',
  (draft, { sheet, view }) => {
    if (findSheetView((draft.sheets ?? []) as Sheet[], view.id)) {
      throw new CommandError(`View ${view.id} already exists.`);
    }
    sheetAt(draft, sheet).views.push(copy(view));
    settle(draft);
  },
);

/** Changes a view: its name, place, direction or parent, scale, style, bodies, flags. One undo step. */
export const updateSheetView = defineCommand<{ id: SheetViewId; changes: SheetViewChanges }>(
  'sheet.view.update',
  'Edit view',
  (draft, { id, changes }) => {
    merge(viewAt(draft, id).view, changes, ['id']);
    settle(draft);
  },
);

/**
 * Deletes a view, the views projected from it (directly or not) and the
 * items that belong to any of them (and the balloons of a parts list that
 * goes with them), in one undo step.
 */
export const removeSheetView = defineCommand<{ id: SheetViewId }>(
  'sheet.view.remove',
  'Delete view',
  (draft, { id }) => {
    const { sheet } = viewAt(draft, id);
    const gone = new Set<SheetViewId>([id, ...projectedFrom(sheet, id)]);
    sheet.views = sheet.views.filter((v) => !gone.has(v.id));
    sheet.items = sheet.items.filter((item) => {
      const view = sheetItemView(item);
      return view === undefined || !gone.has(view);
    });
    dropOrphanBalloons(sheet);
    settle(draft);
  },
);

/** A new item on a sheet, drawn after the others. One undo step. */
export const addSheetItem = defineCommand<{ sheet: SheetId; item: SheetItem }>(
  'sheet.item.add',
  'New sheet item',
  (draft, { sheet, item }) => {
    if (findSheetItem((draft.sheets ?? []) as Sheet[], item.id)) {
      throw new CommandError(`Sheet item ${item.id} already exists.`);
    }
    sheetAt(draft, sheet).items.push(copy(item));
    settle(draft);
  },
);

/** Changes an item's fields (a text's place, text, size, width); its kind stays. One undo step. */
export const updateSheetItem = defineCommand<{ id: SheetItemId; changes: SheetItemChanges }>(
  'sheet.item.update',
  'Edit sheet item',
  (draft, { id, changes }) => {
    merge(itemAt(draft, id), changes, ['id', 'kind']);
    settle(draft);
  },
);

const deleteSheetItems = defineCommand<{ ids: readonly SheetItemId[] }>(
  'sheet.item.remove',
  'Delete sheet item',
  (draft, { ids }) => {
    for (const id of ids) itemAt(draft, id);
    const gone = new Set<string>(ids);
    for (const sheet of (draft.sheets ?? []) as Sheet[]) {
      if (sheet.items.some((item) => gone.has(item.id))) {
        sheet.items = sheet.items.filter((item) => !gone.has(item.id));
        dropOrphanBalloons(sheet);
      }
    }
    settle(draft);
  },
);

/** Deletes items from any of the sheets, and the balloons of a parts list deleted. One undo step. */
export const removeSheetItems: CommandFactory<{ ids: readonly SheetItemId[] }> = Object.assign(
  (payload: { ids: readonly SheetItemId[] }) => ({
    ...deleteSheetItems(payload),
    label: payload.ids.length === 1 ? 'Delete sheet item' : 'Delete sheet items',
  }),
  { type: deleteSheetItems.type },
);
