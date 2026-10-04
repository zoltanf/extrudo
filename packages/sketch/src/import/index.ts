/**
 * Importing drawings into a sketch (P4-06, ADR-0066 §1): the pure side, its
 * own entry like `/export` (no WASM, so the app can import this entry directly).
 */
export {
  COINCIDENT_TOLERANCE,
  drawingBounds,
  drawingCurves,
  drawingToSketch,
  ELLIPSE_PIECE,
  ellipsePieces,
  ImportLimitError,
  type ImportOptions,
  importLimitMessage,
  MAX_IMPORT_CURVES,
  UNIT_MM,
} from './import';
