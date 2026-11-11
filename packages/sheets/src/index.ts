/**
 * @extrudo/sheets (P6-24, ADR-0143 §7): drawing sheets laid out as display
 * lists and written as PDF and SVG. No DOM; runs in Node. The text comes from
 * `@extrudo/sketch/text`: load `SHEET_FONTS` there (`loadFont`) first.
 */

export {
  layoutSheetDimension,
  measureSheetDimension,
  SHEET_DIMENSION,
  type SheetDimensionMeasure,
  type SheetDimensionOptions,
  type SheetDimensionState,
  sheetDimensionText,
} from './dimensions';
export {
  formatSheetScale,
  layoutSheet,
  SHEET_LINE,
  SHEET_LINE_KINDS,
  SHEET_MUTED,
  SHEET_PAPER,
  SHEET_TEXT_SIZE,
  type SheetContext,
  type SheetDisplayKey,
  type SheetLineKind,
  type SheetViewCurve,
  type SheetViewLines,
  sheetMargin,
  sheetViewScale,
  VIEW_PLACEHOLDER,
} from './layout';
export { sheetsToPdf, sheetToSvg } from './output';
export {
  LINE_SPACING,
  SHEET_FONT,
  SHEET_FONTS,
  type SheetFont,
  textRun,
  textWidth,
  wrapText,
} from './text';
export {
  SHEET_TITLE_BLOCKS,
  type SheetTitleBlockTemplate,
  type SheetTitleCell,
  type SheetTitleDerived,
  type SheetTitleTemplate,
  sheetTitleFields,
} from './title-block';
