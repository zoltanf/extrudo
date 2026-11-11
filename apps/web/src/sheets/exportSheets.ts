/**
 * Export PDF (P6-24, plan §4.5): the drawing's sheets as one PDF, a page per sheet, through
 * the platform's `files.download`. `@extrudo/sheets` (and the text shaper under it) loads
 * here, lazily, so it never reaches the entry chunk (ADR-0058 §4).
 */
import type { ExtrudoDocument, SheetId } from '@extrudo/core';
import type { FileAccess } from '../platform/files';
import { safeFileName } from '../platform/files';
import { ensureUiFonts } from '../sketch/fonts';

/**
 * Writes the sheets `ids` (every sheet when absent), in the drawing's order, as one PDF
 * named after the design (and the sheet, for one sheet of several). Returns the file name.
 */
export async function exportSheetsPdf(
  doc: Pick<ExtrudoDocument, 'name' | 'sheets'>,
  files: Pick<FileAccess, 'download'>,
  ids?: readonly SheetId[],
): Promise<string> {
  const all = doc.sheets ?? [];
  const chosen = ids ? all.filter((s) => ids.includes(s.id)) : all;
  if (chosen.length === 0) throw new Error('The drawing has no sheet to export.');
  const sheets = await import('@extrudo/sheets');
  await ensureUiFonts(sheets.SHEET_FONTS);
  const bytes = sheets.sheetsToPdf(chosen, { name: doc.name, sheets: all });
  const one = chosen.length === 1 && all.length > 1 ? chosen[0] : undefined;
  const name = safeFileName(one ? `${doc.name} - ${one.name}` : doc.name, '.pdf');
  files.download(new Blob([bytes as BlobPart], { type: 'application/pdf' }), name);
  return name;
}
