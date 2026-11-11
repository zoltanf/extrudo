/**
 * Sheets as files (ADR-0143 §7): the display lists `layoutSheet` makes,
 * through io's writers. One PDF page per sheet at its true size, in the order
 * given, titled with the design's name; one SVG per sheet.
 */
import type { Sheet } from '@extrudo/core';
import { writeDisplayPdf, writeDisplaySvg } from '@extrudo/io';
import { layoutSheet, type SheetContext } from './layout';

/**
 * `sheets` as one PDF. "Sheet n of N" counts `context.sheets` (the design's
 * sheets) when given, so exporting some sheets keeps their numbers.
 */
export function sheetsToPdf(sheets: readonly Sheet[], context: SheetContext = {}): Uint8Array {
  const all = { ...context, sheets: context.sheets ?? sheets };
  return writeDisplayPdf(
    sheets.map((sheet) => layoutSheet(sheet, all)),
    context.name ? { title: context.name } : {},
  );
}

/** One sheet as a standalone SVG at its true size, titled "<design> – <sheet>". */
export function sheetToSvg(sheet: Sheet, context: SheetContext = {}): string {
  const title = context.name ? `${context.name} – ${sheet.name}` : sheet.name;
  return writeDisplaySvg(layoutSheet(sheet, context), { title });
}
