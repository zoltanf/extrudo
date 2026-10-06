/**
 * The modify tools' geometry (P1-10, ADR-0019): trim, break, extend,
 * fillet, chamfer, offset, copy, mirror, patterns and scale, as pure
 * operations on a sketch that return a change for `modifySketch`. No WASM:
 * the app imports this entry like `@extrudo/sketch/inference`.
 */
export { ChangeBuilder, ModifyError, type ModifyResult } from './change';
export {
  type Corner,
  chamfer,
  chamferEnds,
  cornerAtPoint,
  cornerOf,
  type FilletShape,
  fillet,
  filletPolyline,
  filletShape,
  maxChamfer,
  maxFilletRadius,
} from './corner';
export {
  type Chain,
  type ChainLink,
  chainOf,
  OFFSET_TOLERANCE,
  type OffsetOptions,
  offset,
  offsetPreview,
  offsetTo,
} from './offset';
export {
  breakCurve,
  breakPreview,
  extend,
  extendPreview,
  spanCuts,
  spanOf,
  splineCuts,
  splineSpanOf,
  trim,
  trimPreview,
} from './split';
export {
  axisOf,
  circularAngles,
  circularPattern,
  copy,
  mirror,
  objectsOf,
  placedPolylines,
  rectangularOffsets,
  rectangularPattern,
  reflect,
  rotation,
  scale,
  scaleExpression,
  translation,
} from './transform';
