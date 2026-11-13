/**
 * The open sheet's anchors (P6-24 S3, ADR-0143's S3 amendment): resolved by the kernel
 * (`Recomputer.resolveSheet`) after the model, a view or an item changes, kept across a
 * lost anchor (`keepLastAnchors`, so a detached dimension stays where it was drawn), and
 * handed to `layoutSheet`. Nothing of it is stored in the document: it lives in memory,
 * here, for the session.
 *
 * - **Waiting for the first answer**: an anchored item the kernel has not been asked about
 *   yet (a file just opened, an undo that brings one back) is left out of the layout until
 *   the answer comes, so nothing is drawn detached merely because the kernel has not
 *   answered (`drawnItems`). Without a kernel every item is drawn, detached.
 * - **Shared with the shell**: the browser's Dimensions rows and the status bar read what the
 *   workspace found (`sheetItemsStore`): each item's text, state and why, and the anchors
 *   drawn per sheet (a sheet opened again starts from them).
 * - **The export never keeps geometry** (`exportAnchorsOf`): it asks the kernel again and
 *   writes only what the model says now, so a lost dimension is "?" on paper, never the last
 *   value the screen kept.
 *
 * Pure parts and the store only: no `@extrudo/sheets` here (it stays in the lazy chunks).
 */
import {
  keepLastAnchors,
  type Sheet,
  type SheetAnchors,
  type SheetId,
  type SheetItemId,
  sheetViewFrame,
} from '@extrudo/core';
import { isAnchored, type SheetAnchorsKernel } from '@extrudo/kernel';
import { useEffect, useRef, useState } from 'react';
import { createStore } from 'zustand/vanilla';

const NONE: ReadonlySet<SheetItemId> = new Set();

// The export's half moved to the kernel (S6), where the CLI's export shares it.
export {
  EXPORT_UNMEASURED,
  exportAnchorsOf,
  isAnchored,
  type SheetAnchorsKernel,
} from '@extrudo/kernel';

/** How an item is doing, as the browser row and the status bar say it. */
export interface SheetItemRow {
  state: 'ok' | 'moved' | 'detached' | 'invalid';
  /** Why it is moved, detached or invalid. */
  message?: string;
  /** What it reads on the sheet now ("74", "Ø10", "?"). */
  text?: string;
}

export interface SheetItemsState {
  /** The sheet the rows are for: the open one. */
  sheet: SheetId | undefined;
  rows: ReadonlyMap<SheetItemId, SheetItemRow>;
  /** The anchors drawn on each sheet visited this session (kept geometry included): screen only. */
  kept: ReadonlyMap<SheetId, SheetAnchors>;
}

/** One per page: the workspace writes, the browser, the status bar and the export read. */
export const sheetItemsStore = createStore<SheetItemsState>()(() => ({
  sheet: undefined,
  rows: new Map(),
  kept: new Map(),
}));

/**
 * The sheet as layout draws it while anchors are awaited: without the anchored items the
 * kernel has not been asked about (`asked`); every item when `asked` is `'all'` (no kernel,
 * or a resolve that failed: those are drawn detached).
 */
export function drawnItems(sheet: Sheet, asked: ReadonlySet<SheetItemId> | 'all'): Sheet {
  if (asked === 'all') return sheet;
  const items = sheet.items.filter((item) => !isAnchored(item) || asked.has(item.id));
  return items.length === sheet.items.length ? sheet : { ...sheet, items };
}

/**
 * How many dimensions of `sheet` are detached with these anchors: their view is gone, or
 * an anchor on the model is lost or not reported. The export dialog's summary says so.
 */
export function detachedDimensions(sheet: Sheet, anchors: SheetAnchors | undefined): number {
  let n = 0;
  for (const item of sheet.items) {
    if (item.kind !== 'dimension') continue;
    if (!sheetViewFrame(sheet, item.view)) {
      n++;
      continue;
    }
    const reports = anchors?.[item.id];
    const lost = item.anchors.some(
      (anchor, i) => !('free' in anchor) && (reports?.[i]?.status ?? 'detached') === 'detached',
    );
    if (lost) n++;
  }
  return n;
}

export interface SheetAnchorsResult {
  /** The anchors to draw (`keepLastAnchors` across answers); undefined before the first. */
  anchors: SheetAnchors | undefined;
  /** The anchored items the kernel was asked about, or `'all'` to draw every item. */
  asked: ReadonlySet<SheetItemId> | 'all';
  /** Adds reports the caller already has (a dimension just placed with its tool's). */
  merge(reports: SheetAnchors): void;
}

/**
 * Keeps `sheet`'s anchors resolved: on a new sheet object (a view or an item changed)
 * and on every finished recompute (`model`: the features' statuses, new each time),
 * except while the model is being computed (`hold`: the kernel is about to replace it).
 * Answers older than the newest request are dropped.
 */
export function useSheetAnchors(
  kernel: SheetAnchorsKernel | undefined,
  sheet: Sheet | undefined,
  model: unknown,
  hold: boolean,
): SheetAnchorsResult {
  const [state, setState] = useState<{
    sheet: SheetId | undefined;
    anchors: SheetAnchors | undefined;
    asked: ReadonlySet<SheetItemId> | 'all';
  }>({ sheet: undefined, anchors: undefined, asked: NONE });
  const asking = useRef(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `model` is the trigger.
  useEffect(() => {
    if (!kernel || !sheet || hold) return;
    const ids = sheet.items.filter(isAnchored).map((i) => i.id);
    const n = ++asking.current;
    const id = sheet.id;
    void kernel.resolveSheet(sheet, { quiet: true }).then((next) => {
      if (n !== asking.current) return;
      setState((was) => {
        const previous = was.sheet === id ? was.anchors : sheetItemsStore.getState().kept.get(id);
        if (!next) {
          // The kernel can't say: keep what is drawn; with nothing yet, draw them detached.
          return { sheet: id, anchors: previous ?? {}, asked: previous ? was.asked : 'all' };
        }
        const anchors = keepLastAnchors(previous, next);
        const kept = new Map(sheetItemsStore.getState().kept);
        kept.set(id, anchors);
        sheetItemsStore.setState({ kept });
        return { sheet: id, anchors, asked: new Set(ids) };
      });
    });
  }, [kernel, sheet, model, hold]);
  const own = state.sheet === sheet?.id;
  const merge = (reports: SheetAnchors) =>
    setState((was) => {
      if (!sheet || was.sheet !== sheet.id) return was;
      const asked = was.asked === 'all' ? 'all' : new Set(was.asked);
      if (asked !== 'all') for (const id of Object.keys(reports)) asked.add(id as SheetItemId);
      return { ...was, anchors: { ...was.anchors, ...reports }, asked };
    });
  return {
    anchors: own ? state.anchors : undefined,
    asked: !kernel ? 'all' : own ? state.asked : NONE,
    merge,
  };
}
