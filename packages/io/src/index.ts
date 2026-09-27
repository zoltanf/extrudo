/**
 * @extrudo/io: file-format readers and writers, format-level and
 * geometry-agnostic. MIT-licensed: must not import GPL packages.
 *
 * P1-13: a 2D `Drawing` (contours of exact segments on layers) and its SVG
 * and DXF R12 writers.
 */
export {
  type Bounds,
  type Contour,
  type Drawing,
  drawingBounds,
  flattenContour,
  flattenSegment,
  type Layer,
  type Point,
  type Segment,
  type Shape,
} from './drawing';
export { type DxfOptions, writeDxf } from './dxf';
export { num } from './format';
export { type SvgOptions, writeSvg } from './svg';
