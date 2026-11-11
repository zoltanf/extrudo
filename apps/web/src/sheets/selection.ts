/**
 * Selecting on the sheet (P6-24, plan §4.2), by what the display list says each drawn item
 * belongs to (its `key`), so it knows no item kind: a target is `item:<id>` (any sheet item:
 * a text today, a dimension or a note later), `view:<id>` or `title-block` (its fields'
 * keys fold into it). The paper and the border are not selectable. Pure: the canvas and the
 * shell call these.
 *
 * In the session a target is the selection item `{ kind: 'sheet', id: <target> }`.
 */
import {
  type Command,
  type DocumentStore,
  findSheetItem,
  findSheetView,
  removeSheetItems,
  removeSheetView,
  type SelectionItem,
  type Sheet,
  type SheetItemId,
  type SheetViewId,
  sheetItemView,
  updateSheetItem,
  updateSheetView,
} from '@extrudo/core';
import { type DisplayList, flattenContour } from '@extrudo/io';

export type SheetTarget = string;

/** A box on the sheet, mm, y down. */
export interface SheetBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** The target a display key belongs to, or `undefined` for what can't be selected. */
export function sheetTarget(key: string | undefined): SheetTarget | undefined {
  if (!key) return undefined;
  if (key === 'title-block' || key.startsWith('title-block:')) return 'title-block';
  if (key.startsWith('item:') || key.startsWith('view:')) return key;
  return undefined;
}

/** Whether the display key `key` is drawn as part of `target` (the canvas moves those). */
export function keyOfTarget(key: string | undefined, target: SheetTarget): boolean {
  return sheetTarget(key) === target;
}

/** The selection items of the targets. */
export const sheetSelection = (targets: readonly SheetTarget[]): SelectionItem[] =>
  targets.map((id) => ({ kind: 'sheet', id }));

/** The targets in a session selection. */
export const selectedTargets = (selection: readonly SelectionItem[]): SheetTarget[] =>
  selection.filter((item) => item.kind === 'sheet').map((item) => item.id);

/** Each target's box: the union of its drawn items, strokes included. */
export function targetBoxes(list: DisplayList): Map<SheetTarget, SheetBox> {
  const boxes = new Map<SheetTarget, SheetBox>();
  for (const item of list.items) {
    const target = sheetTarget(item.key);
    if (!target) continue;
    const contours = item.type === 'text' ? item.outline : item.contours;
    const pad = item.type === 'path' ? (item.stroke?.width ?? 0) / 2 : 0;
    let box = boxes.get(target);
    for (const contour of contours) {
      for (const [x, y] of flattenContour(contour, 0.2)) {
        box = box
          ? {
              minX: Math.min(box.minX, x - pad),
              minY: Math.min(box.minY, y - pad),
              maxX: Math.max(box.maxX, x + pad),
              maxY: Math.max(box.maxY, y + pad),
            }
          : { minX: x - pad, minY: y - pad, maxX: x + pad, maxY: y + pad };
      }
    }
    if (box) boxes.set(target, box);
  }
  return boxes;
}

/**
 * The target under the sheet point (`x`, `y`): of the boxes it lies in (grown by `slack`
 * mm), the smallest, so a text inside a view's frame wins over the view.
 */
export function hitTarget(
  boxes: ReadonlyMap<SheetTarget, SheetBox>,
  x: number,
  y: number,
  slack: number,
): SheetTarget | undefined {
  let best: SheetTarget | undefined;
  let area = Number.POSITIVE_INFINITY;
  for (const [target, b] of boxes) {
    if (x < b.minX - slack || x > b.maxX + slack || y < b.minY - slack || y > b.maxY + slack) {
      continue;
    }
    const a = (b.maxX - b.minX) * (b.maxY - b.minY);
    if (a < area) {
      area = a;
      best = target;
    }
  }
  return best;
}

/** The targets whose boxes lie wholly inside `rect` (a box select on empty paper). */
export function targetsInside(
  boxes: ReadonlyMap<SheetTarget, SheetBox>,
  rect: SheetBox,
): SheetTarget[] {
  return [...boxes]
    .filter(
      ([, b]) =>
        b.minX >= rect.minX && b.maxX <= rect.maxX && b.minY >= rect.minY && b.maxY <= rect.maxY,
    )
    .map(([target]) => target);
}

/** Whether a target can be moved: items and views; the title block sits in its corner. */
export const movable = (target: SheetTarget) =>
  target.startsWith('item:') || target.startsWith('view:');

const round = (n: number) => Math.round(n * 100) / 100;

/**
 * The scale view `id` is drawn at (model mm to sheet mm): its base view's, else the sheet's,
 * as `@extrudo/sheets` draws it (that package loads lazily, so not imported here).
 */
function viewScale(sheet: Sheet, id: SheetViewId): number {
  const seen = new Set<SheetViewId>();
  let view = sheet.views.find((v) => v.id === id);
  while (view && view.from.kind === 'projected' && !seen.has(view.id)) {
    seen.add(view.id);
    const parent: SheetViewId = view.from.parent;
    view = sheet.views.find((v) => v.id === parent);
  }
  const [a, b] = (view?.from.kind === 'base' && view.scale) || sheet.scale;
  return a / b;
}

/**
 * The commands that move the targets by (`dx`, `dy`) sheet mm: each view's `at`, and each
 * item's. An item tied to a view (a dimension) keeps its `at` in the view's own frame
 * (model mm, y up), so its move is scaled and flipped; it moves with its view when that is
 * moved too.
 */
export function moveCommands(
  sheets: readonly Sheet[],
  targets: readonly SheetTarget[],
  dx: number,
  dy: number,
): Command[] {
  const out: Command[] = [];
  const views = new Set(targets.filter((t) => t.startsWith('view:')).map((t) => t.slice(5)));
  for (const target of targets) {
    if (target.startsWith('item:')) {
      const id = target.slice(5) as SheetItemId;
      const at = findSheetItem(sheets, id);
      const sheet = at && sheets[at.sheet];
      const item = at && sheet?.items[at.item];
      // A centre mark or line has no place of its own: it sits on its geometry.
      if (!sheet || !item || !('at' in item)) continue;
      const [x, y] = item.at;
      const view = sheetItemView(item);
      if (view === undefined) {
        out.push(updateSheetItem({ id, changes: { at: [round(x + dx), round(y + dy)] } }));
      } else if (!views.has(view)) {
        const k = viewScale(sheet, view);
        out.push(updateSheetItem({ id, changes: { at: [round(x + dx / k), round(y - dy / k)] } }));
      }
    } else if (target.startsWith('view:')) {
      const id = target.slice(5) as SheetViewId;
      const at = findSheetView(sheets, id);
      const view = at && sheets[at.sheet]?.views[at.view];
      if (!view) continue;
      out.push(
        updateSheetView({ id, changes: { at: [round(view.at[0] + dx), round(view.at[1] + dy)] } }),
      );
    }
  }
  return out;
}

/** One step of a change: the command for the document as it is now, or none. */
type Step = (sheets: readonly Sheet[]) => Command | undefined;

/**
 * Runs the steps against the current document one by one as one undo step called `label`
 * (a single command needs no transaction). A step whose target an earlier one removed
 * gives no command.
 */
export function runAsOneStep(store: DocumentStore, label: string, steps: readonly Step[]): void {
  if (steps.length === 0) return;
  const transaction = steps.length > 1;
  if (transaction) store.getState().beginTransaction(label);
  try {
    for (const step of steps) {
      const command = step(store.getState().doc.sheets ?? []);
      if (command) store.getState().dispatch(transaction ? command : { ...command, label });
    }
    if (transaction) store.getState().commitTransaction();
  } catch (error) {
    if (transaction) store.getState().cancelTransaction();
    throw error;
  }
}

/** Moves the targets by (`dx`, `dy`) mm as one undo step (a drag, an arrow key). */
export function moveTargets(
  store: DocumentStore,
  targets: readonly SheetTarget[],
  dx: number,
  dy: number,
): void {
  const commands = moveCommands(store.getState().doc.sheets ?? [], targets, dx, dy);
  runAsOneStep(
    store,
    'Move on sheet',
    commands.map((command) => () => command),
  );
}

/**
 * Deletes the targets as one undo step: the items in one command, each view with what
 * belongs to it (its items, the views projected from it). The title block is not deleted
 * here (Sheet Setup's Title block "None" does that).
 */
export function deleteTargets(store: DocumentStore, targets: readonly SheetTarget[]): void {
  const items = targets.filter((t) => t.startsWith('item:')).map((t) => t.slice(5) as SheetItemId);
  const views = targets.filter((t) => t.startsWith('view:')).map((t) => t.slice(5) as SheetViewId);
  const steps: Step[] = views.map(
    (id) => (sheets) => (findSheetView(sheets, id) ? removeSheetView({ id }) : undefined),
  );
  if (items.length > 0) {
    // Items of a removed view went with it.
    steps.push((sheets) => {
      const left = items.filter((id) => findSheetItem(sheets, id));
      return left.length > 0 ? removeSheetItems({ ids: left }) : undefined;
    });
  }
  runAsOneStep(store, 'Delete from sheet', steps);
}

/** A person's name for a target, for the selection card and the view tag. */
export function targetName(sheet: Sheet | undefined, target: SheetTarget): string {
  if (target === 'title-block') return 'Title block';
  if (target.startsWith('view:')) {
    return sheet?.views.find((v) => v.id === target.slice(5))?.name ?? 'View';
  }
  const item = sheet?.items.find((i) => i.id === target.slice(5));
  if (!item) return 'Item';
  if (item.kind === 'text') return `Text “${item.text.split('\n')[0]?.slice(0, 40)}”`;
  return item.kind === 'dimension' ? 'Dimension' : 'Item';
}
