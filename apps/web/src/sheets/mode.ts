/**
 * The drawing mode (P6-24, ADR-0143's S1 mode amendment): entering and finishing it, and
 * the sheet commands its controls run. Plain functions over the stores, like
 * `sketch/mode.ts`, so they run in unit tests and any control (toolbar, browser, sheet
 * tabs, shortcuts) can call them.
 *
 * - **Entering** a sheet, and every sheet command (from the browser's Drawings folder or
 *   Ctrl+K while sketching), ends an open sketch first (its edits become one undo step, as
 *   version restore does) and a waiting Create Sketch (`leaveSketch`), so a sheet change
 *   is never part of the sketch's undo step; the shell cancels an open feature dialog when
 *   the mode changes (`mode !== 'model'`).
 * - **Every sheet edit is its own command and undo step**: there is no transaction, and
 *   **Finish Drawing** only leaves the mode (decision 13). Nothing is asked on the way out.
 * - The sheet opened last is remembered per document store, so Make › Drawing and Open
 *   Drawing come back to it.
 */
import {
  addSheet,
  type Command,
  CommandError,
  type DocumentStore,
  moveSheet,
  newId,
  removeSheet,
  type Sheet,
  type SheetChanges,
  type SheetId,
  type SheetItemId,
  type SheetScale,
  type SheetView,
  type SheetViewId,
  updateSheet,
} from '@extrudo/core';
import { clearHelpTarget } from '../shell/helpTarget';
import { cancelCreateSketch, finishSketch, type SketchModeStores } from '../sketch/mode';
import { copyName, copySheet, type NewSheetOptions, newSheet, sheetNameProblem } from './defaults';

/** The tools that run on the sheet (the session's `activeTool`) until they finish or Esc. */
export const SHEET_TOOLS: ReadonlySet<string> = new Set(['baseView', 'projectedView']);

/** The stores the drawing mode works on: the sketch mode's (it may have to finish a sketch). */
export type SheetModeStores = SketchModeStores;

/** The sheet each document store had open last (session state: not saved). */
const lastSheet = new WeakMap<DocumentStore, SheetId>();

const sheetsOf = (store: DocumentStore): readonly Sheet[] => store.getState().doc.sheets ?? [];

/** The sheet shown now, while the drawing is open. */
export function activeSheet({ store, session }: SheetModeStores): Sheet | undefined {
  const { mode, activeSheetId } = session.getState();
  if (mode !== 'sheet') return undefined;
  return sheetsOf(store).find((s) => s.id === activeSheetId);
}

/**
 * Ends an open sketch (committing its transaction) and a waiting Create Sketch. Every sheet
 * command calls it before its first dispatch, so its undo step stands on its own.
 */
export function leaveSketch(stores: SheetModeStores): void {
  if (stores.session.getState().mode === 'sketch') finishSketch(stores);
  cancelCreateSketch(stores);
}

/**
 * Opens sheet `id` (switching sheets when the drawing is open already). Returns `false`,
 * changing nothing, if the design has no such sheet.
 */
export function openSheet(stores: SheetModeStores, id: SheetId): boolean {
  const { store, session } = stores;
  if (!sheetsOf(store).some((s) => s.id === id)) return false;
  const current = session.getState();
  if (current.mode === 'sheet' && current.activeSheetId === id) return true;
  leaveSketch(stores);
  session.getState().enterMode('sheet', { activeSheetId: id });
  lastSheet.set(store, id);
  // The remembered help target named the closed context (ADR-0116 §4).
  clearHelpTarget();
  return true;
}

/**
 * Make › Drawing and Open Drawing: the sheet edited last, else the first. Returns `false`
 * when the design has no sheet (the caller opens New drawing instead).
 */
export function openSheets(stores: SheetModeStores): boolean {
  const sheets = sheetsOf(stores.store);
  const last = lastSheet.get(stores.store);
  const id = sheets.find((s) => s.id === last)?.id ?? sheets[0]?.id;
  return id !== undefined && openSheet(stores, id);
}

/** Back to the model. Not an undo step: every sheet edit already is one. */
export function finishDrawing({ store, session }: SheetModeStores): void {
  const { mode, activeSheetId } = session.getState();
  if (mode !== 'sheet') return;
  if (activeSheetId) lastSheet.set(store, activeSheetId);
  session.getState().exitMode();
  clearHelpTarget();
}

/**
 * Keeps the mode on a sheet that exists: after an undo, a redo or a restore took the open
 * sheet away, the one at its place (or the last) opens; with none left the drawing ends.
 */
export function keepSheetOpen(stores: SheetModeStores, previous: readonly Sheet[]): void {
  const { session } = stores;
  const { mode, activeSheetId } = session.getState();
  if (mode !== 'sheet') return;
  const sheets = sheetsOf(stores.store);
  if (sheets.some((s) => s.id === activeSheetId)) return;
  if (sheets.length === 0) {
    finishDrawing(stores);
    return;
  }
  const was = previous.findIndex((s) => s.id === activeSheetId);
  const next = sheets[Math.min(Math.max(was, 0), sheets.length - 1)];
  if (next) session.getState().enterMode('sheet', { activeSheetId: next.id });
}

/** Runs a sheet command; a refusal comes back as its message, for the caller to show. */
function run(store: DocumentStore, command: Command): string | undefined {
  try {
    store.getState().dispatch(command);
    return undefined;
  } catch (error) {
    if (error instanceof CommandError) return error.message;
    throw error;
  }
}

/**
 * New drawing (mock-up 2): a sheet with the dialog's choices and what it starts with (its
 * scale and views: `standardViews.ts`), as one undo step "New drawing", then opens it.
 * Returns its ID.
 */
export function createSheet(
  stores: SheetModeStores,
  options: NewSheetOptions,
  today = new Date(),
  content: { scale?: SheetScale; views?: SheetView[] } = {},
): SheetId {
  const { store } = stores;
  leaveSketch(stores);
  const id = newId<SheetId>();
  const sheet: Sheet = {
    ...newSheet(store.getState().doc, id, today, options),
    ...(content.scale && { scale: content.scale }),
    ...(content.views && { views: content.views }),
  };
  store.getState().dispatch({ ...addSheet({ sheet }), label: 'New drawing' });
  openSheet(stores, id);
  return id;
}

/** New Sheet: an empty sheet with the mode's defaults after the open one, which it opens. */
export function addNewSheet(stores: SheetModeStores, today = new Date()): SheetId {
  const { store, session } = stores;
  leaveSketch(stores);
  const id = newId<SheetId>();
  const sheets = sheetsOf(store);
  const at = sheets.findIndex((s) => s.id === session.getState().activeSheetId);
  const sheet = newSheet(store.getState().doc, id, today);
  store.getState().dispatch(addSheet({ sheet, ...(at >= 0 && { index: at + 1 }) }));
  openSheet(stores, id);
  return id;
}

/** Duplicate: a copy of sheet `id` after it, with new IDs and "… copy" for a name; opens it. */
export function duplicateSheet(stores: SheetModeStores, id: SheetId): SheetId | undefined {
  const { store, session } = stores;
  const sheets = sheetsOf(store);
  const at = sheets.findIndex((s) => s.id === id);
  const source = sheets[at];
  if (!source) return undefined;
  leaveSketch(stores);
  const sheet = copySheet(source, copyName(sheets, source.name), {
    sheet: newId<SheetId>(),
    view: () => newId<SheetViewId>(),
    item: () => newId<SheetItemId>(),
  });
  store.getState().dispatch({ ...addSheet({ sheet, index: at + 1 }), label: 'Duplicate sheet' });
  if (session.getState().mode === 'sheet') openSheet(stores, sheet.id);
  return sheet.id;
}

/**
 * Deletes sheet `id` (one undo step). The open sheet's neighbour opens in its place; the
 * drawing ends with the last sheet.
 */
export function deleteSheet(stores: SheetModeStores, id: SheetId): void {
  const { store } = stores;
  const previous = sheetsOf(store);
  if (!previous.some((s) => s.id === id)) return;
  leaveSketch(stores);
  store.getState().dispatch({ ...removeSheet({ id }), label: 'Delete sheet' });
  keepSheetOpen(stores, previous);
}

/** Renames sheet `id`. Returns why it can't (UI spec §8's words), or `undefined` when done. */
export function renameSheet(
  stores: SheetModeStores,
  id: SheetId,
  name: string,
): string | undefined {
  const { store } = stores;
  const sheet = sheetsOf(store).find((s) => s.id === id);
  if (!sheet) return undefined;
  const problem = sheetNameProblem(sheetsOf(store), id, name);
  if (problem) return problem;
  const trimmed = name.trim();
  if (trimmed === sheet.name) return undefined;
  leaveSketch(stores);
  return run(store, { ...updateSheet({ id, changes: { name: trimmed } }), label: 'Rename sheet' });
}

/** Moves sheet `id` to position `index` among the sheets (the tabs' drag). */
export function moveSheetTo(stores: SheetModeStores, id: SheetId, index: number): void {
  const sheets = sheetsOf(stores.store);
  const from = sheets.findIndex((s) => s.id === id);
  if (from < 0) return;
  const to = Math.min(Math.max(Math.round(index), 0), sheets.length - 1);
  if (to === from) return;
  leaveSketch(stores);
  stores.store.getState().dispatch({ ...moveSheet({ id, index: to }), label: 'Move sheet' });
}

/** Ctrl+PageDown / Ctrl+PageUp: the next or previous sheet, round the ends like tabs. */
export function stepSheet(stores: SheetModeStores, delta: 1 | -1): void {
  const sheets = sheetsOf(stores.store);
  if (sheets.length < 2) return;
  const at = sheets.findIndex((s) => s.id === stores.session.getState().activeSheetId);
  if (at < 0) return;
  const next = sheets[(at + delta + sheets.length) % sheets.length];
  if (next) openSheet(stores, next.id);
}

/**
 * One change of Sheet Setup as one command and undo step, labelled for the history
 * ("Sheet size"). Returns a refusal's message, or `undefined` when done.
 */
export function changeSheet(
  stores: SheetModeStores,
  id: SheetId,
  changes: SheetChanges,
  label: string,
): string | undefined {
  leaveSketch(stores);
  return run(stores.store, { ...updateSheet({ id, changes }), label });
}
