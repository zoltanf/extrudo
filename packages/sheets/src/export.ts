/**
 * A design's sheets as files, outside the app (P6-24 S6, ADR-0143's S6
 * amendment): the CLI's `export --format pdf|svg` and, next, the desktop
 * app's agent tools. The model's half comes in already gathered (the
 * kernel's `sheetModelNow`: exact views, anchors resolved now, the parts
 * lists' bodies), so this stays pure and kernel-free: it fills the layout
 * context the way the app's export does (`apps/web/src/sheets/exportSheets.ts`)
 * and writes one PDF or one SVG per sheet.
 *
 * What the document can't know is the caller's to give: `date` for `{date}`,
 * `version` for `{version}`, `density` for a parts list's Mass. Left out,
 * those fields stay as typed and Mass is empty, so the same design and
 * options always write the same bytes.
 */
import {
  type EvaluateResult,
  type ExtrudoDocument,
  evaluateParameters,
  type Sheet,
  type SheetAnchors,
  type SheetId,
  type SheetParts,
  type SheetViewId,
} from '@extrudo/core';
import type { SheetContext, SheetViewLines } from './layout';
import { sheetsToPdf, sheetToSvg } from './output';
import { sheetPartBodies } from './parts';

/** The model's half of an export: the kernel's `SheetModelNow`. */
export interface SheetModel {
  views: ReadonlyMap<SheetViewId, SheetViewLines>;
  anchors: SheetAnchors;
  parts: SheetParts;
}

export interface SheetFileOptions {
  format: 'pdf' | 'svg';
  /** The sheets to write, in page order; absent: every sheet of the design. */
  sheets?: readonly SheetId[];
  /** What `{date}` writes (`YYYY-MM-DD`); absent: left as typed. */
  date?: string;
  /** What `{version}` writes (the newest saved version's name); absent: left as typed. */
  version?: string;
  /** The density Mass is worked out with, g/cm³; absent: no Mass. */
  density?: number;
  /** Every sticky note, those on screen only too; absent: only those switched to print. */
  stickies?: boolean;
}

export type SheetFiles =
  | { format: 'pdf'; sheets: Sheet[]; pdf: Uint8Array }
  | { format: 'svg'; sheets: Sheet[]; svgs: string[] };

/** The sheet as an export with every sticky note writes it (a copy: nothing is stored). */
export function withEveryStickyNote(sheet: Sheet): Sheet {
  if (!sheet.items.some((i) => i.kind === 'sticky' && !i.print)) return sheet;
  return {
    ...sheet,
    items: sheet.items.map((i) => (i.kind === 'sticky' && !i.print ? { ...i, print: true } : i)),
  };
}

/** The sheets `ids` names among `doc`'s, in page order (all of them without `ids`). */
export function chosenSheets(
  doc: Pick<ExtrudoDocument, 'sheets'>,
  ids?: readonly SheetId[],
): Sheet[] {
  const all = doc.sheets ?? [];
  if (!ids) return [...all];
  const wanted = new Set(ids);
  return all.filter((s) => wanted.has(s.id));
}

/** The layout context of an export: the model now, the design's units and parameters, the fields. */
export function sheetFileContext(
  doc: ExtrudoDocument,
  model: SheetModel,
  options: Omit<SheetFileOptions, 'format' | 'sheets' | 'stickies'> = {},
): SheetContext {
  const evaluation = evaluateParameters(doc);
  return {
    name: doc.name,
    sheets: doc.sheets ?? [],
    units: doc.settings.units,
    views: model.views,
    anchors: model.anchors,
    parts: sheetPartBodies(doc, model.parts),
    evaluate: (expression: string): EvaluateResult => evaluation.evaluate(expression),
    ...(options.date !== undefined && { date: options.date }),
    ...(options.version !== undefined && { version: options.version }),
    ...(options.density !== undefined && { density: options.density }),
  };
}

/**
 * The chosen sheets as one PDF (a page each) or one SVG each. "Sheet n of N"
 * counts every sheet of the design. The fonts (`SHEET_FONTS`) must be loaded.
 */
export function sheetFiles(
  doc: ExtrudoDocument,
  model: SheetModel,
  options: SheetFileOptions,
): SheetFiles {
  const sheets = chosenSheets(doc, options.sheets);
  const drawn = options.stickies ? sheets.map(withEveryStickyNote) : sheets;
  const context = sheetFileContext(doc, model, options);
  if (options.format === 'pdf') return { format: 'pdf', sheets, pdf: sheetsToPdf(drawn, context) };
  return { format: 'svg', sheets, svgs: drawn.map((sheet) => sheetToSvg(sheet, context)) };
}
