/**
 * Exporting the drawing (P6-24, plan §4.5, mock-up 4): the chosen sheets as one PDF (a page
 * per sheet) or as SVG files (one per sheet), through the platform's `files.download`.
 * `@extrudo/sheets` (and the text shaper under it) loads here, lazily, so it never reaches
 * the entry chunk (ADR-0058 §4). The names and the summary are pure (`sheetExportPlan`).
 */
import type { ExtrudoDocument, Sheet, SheetId } from '@extrudo/core';
import type { FileAccess } from '../platform/files';
import { safeFileName } from '../platform/files';
import { ensureUiFonts } from '../sketch/fonts';
import { sizeLabel } from './defaults';

export type SheetExportFormat = 'pdf' | 'svg';

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
 * for "sheet n of N". Returns the file names.
 */
export async function exportSheets(
  doc: Pick<ExtrudoDocument, 'name' | 'sheets'>,
  files: Pick<FileAccess, 'download'>,
  plan: SheetExportPlan,
  format: SheetExportFormat,
): Promise<string[]> {
  if (plan.sheets.length === 0) throw new Error('Choose at least one sheet to export.');
  const all = doc.sheets ?? [];
  const sheets = await import('@extrudo/sheets');
  await ensureUiFonts(sheets.SHEET_FONTS);
  const context = { name: doc.name, sheets: all };
  if (format === 'pdf') {
    const bytes = sheets.sheetsToPdf(plan.sheets, context);
    files.download(new Blob([bytes as BlobPart], { type: 'application/pdf' }), plan.files[0] ?? '');
  } else {
    plan.sheets.forEach((sheet, i) => {
      const svg = sheets.sheetToSvg(sheet, context);
      files.download(new Blob([svg], { type: 'image/svg+xml' }), plan.files[i] ?? '');
    });
  }
  return plan.files;
}
