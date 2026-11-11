/**
 * What a sheet's outputs need of the model now (P6-24 S6, ADR-0143's S6
 * amendment): every view drawn exactly, every anchor resolved and every parts
 * list's bodies read again, nothing kept from an earlier answer. The CLI's
 * export calls it with its kernel service, and the desktop app's agent tools
 * with the project's `Recomputer`; `@extrudo/sheets`' `sheetFiles` then turns
 * the answer into a PDF or SVGs. An export never writes stale geometry: a
 * lost dimension is its text with "?".
 *
 * `exportAnchorsOf` and `isAnchored` are the app's (`sheets/sheetAnchors.ts`),
 * moved here unchanged so both callers share them.
 */
import {
  type BodyId,
  type ExtrudoDocument,
  type Sheet,
  type SheetAnchors,
  type SheetItem,
  type SheetParts,
  type SheetViewId,
  sheetItemAnchors,
} from '@extrudo/core';
import { sheetViewLines, sheetViewWants, type ViewLines } from './lines';
import type { SheetViewProgress, SheetViewRequest, SheetViewResult } from './views';

/** What resolving needs of the kernel: `KernelApi.resolveSheet`, `Recomputer.resolveSheet`. */
export interface SheetAnchorsKernel {
  resolveSheet(sheet: Sheet, options?: { quiet?: boolean }): Promise<SheetAnchors | undefined>;
}

/** What the parts lists need of the kernel: `KernelApi.sheetParts`, `Recomputer.sheetParts`. */
export interface SheetPartsKernel {
  sheetParts(sheet: Sheet, options?: { quiet?: boolean }): Promise<SheetParts | undefined>;
}

/** Everything `sheetModelNow` asks: the kernel service, or the app's `Recomputer`. */
export interface SheetModelKernel extends SheetAnchorsKernel, SheetPartsKernel {
  sheetViews(
    requests: readonly SheetViewRequest[],
    onView?: SheetViewProgress,
    options?: { label?: string; quiet?: boolean },
  ): Promise<SheetViewResult[]>;
}

/** Whether an item has anchors the kernel resolves (a dimension, a leader, a centre mark or line). */
export function isAnchored(item: SheetItem): boolean {
  return sheetItemAnchors(item).length > 0 && 'view' in item;
}

/** Why an export stops when the kernel can't measure a sheet's items (the dialog says it). */
export const EXPORT_UNMEASURED =
  "its dimensions couldn't be measured from the model. Try again once the model is computed.";

/** Why an export stops when the kernel can't read a sheet's parts lists. */
export const EXPORT_UNLISTED =
  "its parts lists couldn't be read from the model. Try again once the model is computed.";

/**
 * The anchors to export `sheets` with: only what the kernel says now, never geometry the
 * screen kept, so a lost dimension is written as its text with "?" and nothing of the model
 * as it was. Sheets without anchored items aren't asked about. Throws `EXPORT_UNMEASURED`
 * when the kernel can't answer for one: a file is never written from what the screen had.
 */
export async function exportAnchorsOf(
  kernel: SheetAnchorsKernel,
  sheets: readonly Sheet[],
): Promise<SheetAnchors> {
  const out: SheetAnchors = {};
  for (const sheet of sheets) {
    if (!sheet.items.some(isAnchored)) continue;
    const fresh = await kernel.resolveSheet(sheet, { quiet: true });
    if (!fresh) throw new Error(EXPORT_UNMEASURED);
    Object.assign(out, fresh);
  }
  return out;
}

/**
 * The parts lists' bodies to export `sheets` with: what the kernel says now. Sheets
 * without a parts list aren't asked about. Throws `EXPORT_UNLISTED` when the kernel
 * can't answer for one.
 */
export async function exportPartsOf(
  kernel: SheetPartsKernel,
  sheets: readonly Sheet[],
): Promise<SheetParts> {
  const out: SheetParts = { lists: {}, bodies: {} };
  for (const sheet of sheets) {
    if (!sheet.items.some((i) => i.kind === 'partsList')) continue;
    const fresh = await kernel.sheetParts(sheet, { quiet: true });
    if (!fresh) throw new Error(EXPORT_UNLISTED);
    Object.assign(out.lists, fresh.lists);
    Object.assign(out.bodies, fresh.bodies);
  }
  return out;
}

/** The model as `sheets` draw it now: what `@extrudo/sheets`' `sheetFiles` takes. */
export interface SheetModelNow {
  /** Each view's exact lines, by view ID; a view that couldn't be drawn is not here (its frame is drawn). */
  views: Map<SheetViewId, ViewLines>;
  /** Why a view couldn't be drawn, by view ID. */
  errors: Map<SheetViewId, string>;
  anchors: SheetAnchors;
  parts: SheetParts;
}

/**
 * Every view of `sheets` drawn exactly from the bodies at the marker (`bodies`: their IDs,
 * the last recompute's), then the items' anchors and the parts lists read again, in that
 * order: the kernel answers one call at a time, so all three see the same model.
 * `onProgress` hears each view (`done` of `total`). Throws `EXPORT_UNMEASURED` or
 * `EXPORT_UNLISTED` when the kernel can't answer; rejects with `isSheetViewsCancelled`
 * when the views are cancelled.
 */
export async function sheetModelNow(
  kernel: SheetModelKernel,
  doc: ExtrudoDocument,
  sheets: readonly Sheet[],
  bodies: Iterable<BodyId>,
  onProgress?: (done: number, total: number) => void,
): Promise<SheetModelNow> {
  const live = [...bodies];
  const wants = sheets.flatMap((sheet) => sheetViewWants(doc, sheet, live));
  const views = new Map<SheetViewId, ViewLines>();
  const errors = new Map<SheetViewId, string>();
  onProgress?.(0, wants.length);
  if (wants.length > 0) {
    let done = 0;
    const results = await kernel.sheetViews(
      wants.map((w) => w.request),
      () => {
        onProgress?.(++done, wants.length);
        return undefined;
      },
      { label: 'Drawing the views for the export…', quiet: true },
    );
    for (const result of results) {
      const id = result.id as SheetViewId;
      if ('error' in result) errors.set(id, result.error);
      else views.set(id, sheetViewLines(result.geometry));
    }
  }
  const anchors = await exportAnchorsOf(kernel, sheets);
  const parts = await exportPartsOf(kernel, sheets);
  return { views, errors, anchors, parts };
}
