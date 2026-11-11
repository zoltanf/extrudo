/**
 * The open sheet's parts lists and text fields (P6-24 S5, ADR-0143's S5 amendments): what
 * layout needs besides the views and anchors.
 *
 * - **Rows from the model** (`useSheetParts`): each parts list's bodies and their measures,
 *   asked of the kernel (`Recomputer.sheetParts`) the way anchors are: quietly, when the
 *   sheet's lists or views or the model change, never while the model is being computed,
 *   older answers dropped; a failed answer keeps the last. Nothing of it is stored.
 * - **The export never keeps them** (`exportPartsOf`): it asks again and writes what the
 *   model says now.
 * - **Fields** (`sheetFieldContext`): what `{date}`, `{version}` and `{= expr}` write, and the
 *   filament's density for Mass; the same for the screen and the export.
 *
 * Pure parts and a hook only: no `@extrudo/sheets` here (it stays in the lazy chunks).
 */
import {
  type EvaluateResult,
  type ExtrudoDocument,
  evaluateParameters,
  type Sheet,
  type SheetId,
  type SheetParts,
} from '@extrudo/core';
import { useEffect, useMemo, useRef, useState } from 'react';
import { checkPrintField, chosenDensity, type MaterialChoice } from '../print/material';
import { isoDate } from './defaults';

/** What the parts lists need of the kernel: `Recomputer.sheetParts`. */
export interface SheetPartsKernel {
  sheetParts(sheet: Sheet, options?: { quiet?: boolean }): Promise<SheetParts | undefined>;
}

/** Whether `sheet` has a parts list (only then is the kernel asked). */
export const hasPartsLists = (sheet: Sheet) => sheet.items.some((i) => i.kind === 'partsList');

/**
 * What the kernel's answer for `sheet` depends on, as a string: each list's view and the
 * views' directions and bodies. A text typed, a dimension placed or a list moved doesn't
 * change it, so those don't ask the kernel again.
 */
export function partsAskKey(sheet: Sheet): string {
  const lists = sheet.items.flatMap((i) => (i.kind === 'partsList' ? [[i.id, i.view]] : []));
  if (lists.length === 0) return '';
  const views = sheet.views.map((v) => [v.id, v.from, v.bodies ?? null]);
  return JSON.stringify([sheet.id, lists, views]);
}

/** `a` with `b`'s lists and measures over it (a list just placed, with its tool's answer). */
export function mergeParts(a: SheetParts | undefined, b: SheetParts): SheetParts {
  return {
    lists: { ...a?.lists, ...b.lists },
    bodies: { ...a?.bodies, ...b.bodies },
  };
}

export interface SheetPartsResult {
  /** The lists' bodies, undefined before the first answer (the lists are their headers). */
  parts: SheetParts | undefined;
  /** Adds what the caller already has (a list just placed: its tool's answer). */
  merge(parts: SheetParts): void;
}

/**
 * Keeps `sheet`'s parts lists answered: when what they depend on changes (`partsAskKey`) and
 * on every finished recompute (`model`), except while the model is being computed (`hold`).
 * Answers older than the newest request are dropped; one the kernel can't give keeps the last.
 */
export function useSheetParts(
  kernel: SheetPartsKernel | undefined,
  sheet: Sheet | undefined,
  model: unknown,
  hold: boolean,
): SheetPartsResult {
  const [state, setState] = useState<{ sheet: SheetId | undefined; parts?: SheetParts }>({
    sheet: undefined,
  });
  const asking = useRef(0);
  const key = sheet ? partsAskKey(sheet) : '';
  const latest = useRef(sheet);
  latest.current = sheet;
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` and `model` are the triggers.
  useEffect(() => {
    const now = latest.current;
    if (!kernel || !now || hold || key === '') return;
    const n = ++asking.current;
    const id = now.id;
    void kernel.sheetParts(now, { quiet: true }).then((next) => {
      if (n !== asking.current || !next) return;
      setState({ sheet: id, parts: next });
    });
  }, [kernel, key, model, hold]);
  const own = state.sheet === sheet?.id;
  const merge = (parts: SheetParts) =>
    setState((was) =>
      sheet
        ? {
            sheet: sheet.id,
            parts: mergeParts(was.sheet === sheet.id ? was.parts : undefined, parts),
          }
        : was,
    );
  return { parts: own ? state.parts : undefined, merge };
}

/** Why an export stops when the kernel can't read a sheet's parts lists. */
export const EXPORT_UNLISTED =
  "its parts lists couldn't be read from the model. Try again once the model is computed.";

/**
 * The parts lists' bodies to export `sheets` with: what the kernel says now, never what the
 * screen kept. Sheets without a parts list aren't asked about. Throws `EXPORT_UNLISTED` when
 * the kernel can't answer for one.
 */
export async function exportPartsOf(
  kernel: SheetPartsKernel,
  sheets: readonly Sheet[],
): Promise<SheetParts> {
  let out: SheetParts = { lists: {}, bodies: {} };
  for (const sheet of sheets) {
    if (!hasPartsLists(sheet)) continue;
    const fresh = await kernel.sheetParts(sheet, { quiet: true });
    if (!fresh) throw new Error(EXPORT_UNLISTED);
    out = mergeParts(out, fresh);
  }
  return out;
}

/** What the app knows that a sheet's fields and Mass need, and the document doesn't hold. */
export interface SheetFieldExtras {
  /** The filament's density, g/cm³ (the `print.material` preference); absent: no Mass. */
  density?: number;
  /** The newest saved version's name ("V3"); absent: `{version}` stays as typed. */
  version?: string;
  /** Today, for `{date}`; absent: now. */
  today?: Date;
}

/**
 * The density Mass is worked out with: the filament Print Info uses (the `print.material`
 * preference), its expression evaluated against the design's parameters.
 */
export function sheetDensity(doc: ExtrudoDocument, choice: MaterialChoice): number | undefined {
  const evaluation = evaluateParameters(doc);
  return chosenDensity(choice, (field, expression) =>
    checkPrintField(field, expression, evaluation.evaluate(expression, 'unitless')),
  );
}

/** The part of `layoutSheet`'s context that fills fields and Mass (`SheetContext`'s keys). */
export interface SheetFieldContext {
  date: string;
  version?: string;
  density?: number;
  evaluate(expression: string): EvaluateResult;
}

/**
 * What `{date}` (today, `YYYY-MM-DD`), `{version}` and `{= expr}` (the design's parameters
 * with their units) write, and the density Mass is worked out with.
 */
export function sheetFieldContext(
  doc: ExtrudoDocument,
  extras: SheetFieldExtras = {},
): SheetFieldContext {
  const evaluation = evaluateParameters(doc);
  return {
    date: isoDate(extras.today ?? new Date()),
    ...(extras.version !== undefined && { version: extras.version }),
    ...(extras.density !== undefined && { density: extras.density }),
    evaluate: (expression) => evaluation.evaluate(expression),
  };
}

/** `sheetFieldContext` kept for a document and extras: the screen's. */
export function useSheetFieldContext(
  doc: ExtrudoDocument,
  extras: SheetFieldExtras,
): SheetFieldContext {
  const { density, version } = extras;
  // A day's date is read when the document or the extras change; a sheet left open over
  // midnight shows the new date at the next change, and an export always writes today's.
  return useMemo(
    () =>
      sheetFieldContext(doc, {
        ...(density !== undefined && { density }),
        ...(version !== undefined && { version }),
      }),
    [doc, density, version],
  );
}
