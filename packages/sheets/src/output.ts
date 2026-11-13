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
 * sheets) when given, so exporting some sheets keeps their numbers. For an
 * export unless `context.output` says otherwise: a sticky note that isn't
 * printed is left out.
 */
export function sheetsToPdf(sheets: readonly Sheet[], context: SheetContext = {}): Uint8Array {
  const all: SheetContext = {
    ...context,
    sheets: context.sheets ?? sheets,
    output: context.output ?? 'export',
  };
  return writeDisplayPdf(
    sheets.map((sheet) => layoutSheet(sheet, all)),
    context.name ? { title: context.name } : {},
  );
}

/** One sheet as a standalone SVG at its true size, titled "<design> – <sheet>"; for an export, as `sheetsToPdf`. */
export function sheetToSvg(sheet: Sheet, context: SheetContext = {}): string {
  const title = context.name ? `${context.name} – ${sheet.name}` : sheet.name;
  return writeDisplaySvg(layoutSheet(sheet, { ...context, output: context.output ?? 'export' }), {
    title,
  });
}
