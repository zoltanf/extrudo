/**
 * Exporting the drawing (P6-24, plan §4.5, mock-up 4): the chosen sheets as one PDF (a page
 * per sheet) or as SVG files (one per sheet), through the platform's `files.download`.
 * `@extrudo/sheets` (and the text shaper under it) loads here, lazily, so it never reaches
 * the entry chunk (ADR-0058 §4). The names and the summary are pure (`sheetExportPlan`).
 */
import type {
  BodyId,
  ExtrudoDocument,
  Sheet,
  SheetAnchors,
  SheetId,
  SheetViewId,
} from '@extrudo/core';
import type { SheetViewLines } from '@extrudo/sheets';
import type { FileAccess } from '../platform/files';
import { safeFileName } from '../platform/files';
import { ensureUiFonts } from '../sketch/fonts';
import { sizeLabel } from './defaults';
import { exportAnchorsOf, type SheetAnchorsKernel } from './sheetAnchors';
import {
  exportPartsOf,
  type SheetFieldExtras,
  type SheetPartsKernel,
  sheetFieldContext,
} from './sheetParts';
import type { SheetViewsKernel } from './viewRunner';

/**
 * The model the views are drawn from: the project's kernel, the bodies at the marker, and
 * who hears how far the views are (`done` of `total`).
 */
export interface SheetExportViews {
  kernel: SheetViewsKernel;
  bodies: readonly BodyId[];
  /** The anchors call: dimensions and notes are resolved before the file is written (S3). */
  anchors?: SheetAnchorsKernel;
  /** The parts lists' call: their rows are read from the model again before writing (S5). */
  parts?: SheetPartsKernel;
  onProgress?: (done: number, total: number) => void;
}

export type SheetExportFormat = 'pdf' | 'svg';

/** The export dialog's switches besides the format. */
export interface SheetExportOptions {
  /**
   * Every sticky note goes into the file, those on screen only as well (S4). Off: only the
   * notes whose Print switch is on, as the document says.
   */
  stickies?: boolean;
  /**
   * What the fields and Mass need besides the document (S5): the newest version's name and
   * the filament's density, read when the export starts. `{date}` is today's.
   */
  fields?: SheetFieldExtras;
}

/** The sheet as an export with every sticky note writes it (a copy: nothing is stored). */
export function withEveryStickyNote(sheet: Sheet): Sheet {
  if (!sheet.items.some((i) => i.kind === 'sticky' && !i.print)) return sheet;
  return {
    ...sheet,
    items: sheet.items.map((i) => (i.kind === 'sticky' && !i.print ? { ...i, print: true } : i)),
  };
}

/** The preference that remembers the export dialog's format. */
export const SHEET_EXPORT_KEY = 'export.sheets';

export interface SheetExportPlan {
  /** The chosen sheets, in the drawing's order. */
  sheets: Sheet[];
  /** One name for a PDF; one per sheet for SVG ("Box - Lid.svg" when there are several). */
  files: string[];
  /** The dialog's summary line: "2 pages · A3 landscape". */
  summary: string;
}

/** The name a file starts with: the design's, and the sheet's when one of several is exported. */
export function defaultExportName(
  doc: Pick<ExtrudoDocument, 'name' | 'sheets'>,
  ids?: readonly SheetId[],
): string {
  const all = doc.sheets ?? [];
  const one = ids?.length === 1 && all.length > 1 ? all.find((s) => s.id === ids[0]) : undefined;
  return one ? `${doc.name} - ${one.name}` : doc.name;
}

/** What exporting `ids` in `format` under `base` writes, and the line that says so. */
export function sheetExportPlan(
  doc: Pick<ExtrudoDocument, 'sheets'>,
  ids: ReadonlySet<SheetId>,
  format: SheetExportFormat,
  base: string,
): SheetExportPlan {
  const sheets = (doc.sheets ?? []).filter((s) => ids.has(s.id));
  if (sheets.length === 0) return { sheets, files: [], summary: 'Choose at least one sheet.' };
  const papers = [...new Set(sheets.map((s) => `${sizeLabel(s.size)} ${s.orientation}`))];
  const count = sheets.length;
  const files =
    format === 'pdf'
      ? [safeFileName(base, '.pdf')]
      : count === 1
        ? [safeFileName(base, '.svg')]
        : sheets.map((s) => safeFileName(`${base} - ${s.name}`, '.svg'));
  const what =
    format === 'pdf'
      ? `${count} ${count === 1 ? 'page' : 'pages'}`
      : `${count} ${count === 1 ? 'SVG file' : 'SVG files'}`;
  return { sheets, files, summary: `${what} · ${papers.join(', ')}` };
}

/**
 * Writes the plan: one PDF of its sheets, or an SVG per sheet. The other sheets still count
 * for "sheet n of N". With `views`, every view of the chosen sheets is drawn exactly from
 * the model first (S2: an export never holds the quick placeholder); a view that can't be
 * drawn is its frame, and the items' anchors are resolved again, nothing kept (S3: a lost
 * dimension is its text with "?"; the export fails when the kernel can't measure them).
 * The parts lists' rows are read again too (S5), and the fields are filled as of now
 * (`options.fields`: the newest version, the filament's density).
 * With `options.stickies` every sticky note is written, else only those switched to print.
 * Rejects with `isSheetViewsCancelled` when that is cancelled. Returns the file names.
 */
export async function exportSheets(
  doc: ExtrudoDocument,
  files: Pick<FileAccess, 'download'>,
  plan: SheetExportPlan,
  format: SheetExportFormat,
  views?: SheetExportViews,
  options: SheetExportOptions = {},
): Promise<string[]> {
  if (plan.sheets.length === 0) throw new Error('Choose at least one sheet to export.');
  const chosen = options.stickies ? plan.sheets.map(withEveryStickyNote) : plan.sheets;
  const all = doc.sheets ?? [];
  const sheets = await import('@extrudo/sheets');
  await ensureUiFonts(sheets.SHEET_FONTS);
  let lines: Map<SheetViewId, SheetViewLines> | undefined;
  if (views) {
    const { sheetViewRunner } = await import('./viewRunner');
    const { sheetViewWants } = await import('./viewLines');
    const wants = plan.sheets.flatMap((sheet) => sheetViewWants(doc, sheet, views.bodies));
    lines = await sheetViewRunner(views.kernel).exact(wants, views.onProgress);
  }
  // The items' anchors at the model now, nothing kept: a lost dimension is written as "?".
  const anchors: SheetAnchors | undefined = views?.anchors
    ? await exportAnchorsOf(views.anchors, plan.sheets)
    : undefined;
  // The parts lists' rows from the model now, and the fields filled as of now (S5).
  const parts = views?.parts ? await exportPartsOf(views.parts, plan.sheets) : undefined;
  const context = {
    name: doc.name,
    sheets: all,
    units: doc.settings.units,
    ...(lines && { views: lines }),
    ...(anchors && { anchors }),
    ...(parts && { parts: sheets.sheetPartBodies(doc, parts) }),
    ...sheetFieldContext(doc, options.fields),
  };
  if (format === 'pdf') {
    const bytes = sheets.sheetsToPdf(chosen, context);
    files.download(new Blob([bytes as BlobPart], { type: 'application/pdf' }), plan.files[0] ?? '');
  } else {
    chosen.forEach((sheet, i) => {
      const svg = sheets.sheetToSvg(sheet, context);
      files.download(new Blob([svg], { type: 'image/svg+xml' }), plan.files[i] ?? '');
    });
  }
  return plan.files;
}
