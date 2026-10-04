/**
 * @extrudo/io: file-format readers and writers, format-level and
 * geometry-agnostic. MIT-licensed: must not import GPL packages.
 *
 * P1-13: a 2D `Drawing` (contours of exact segments on layers) and its SVG
 * and DXF R12 writers. P2-12: triangle meshes, binary STL, 3MF and a
 * manifold check. P4-06: the SVG and DXF readers drawings are imported from.
 */
export {
  type Bounds,
  type Contour,
  type Drawing,
  type DrawingImport,
  type DrawingUnit,
  drawingBounds,
  flattenContour,
  flattenSegment,
  type Layer,
  type Point,
  type Segment,
  type Shape,
  UNIT_MM,
} from './drawing';
export { type DxfOptions, writeDxf } from './dxf';
export { type DxfCode, type DxfEntity, DxfError, type DxfReadOptions, readDxf } from './dxf-read';
export { num } from './format';
export {
  checkManifold,
  type ManifoldReport,
  type MeshObject,
  mergeMeshes,
  meshBounds,
  type TriangleMesh,
  triangleNormal,
} from './mesh';
export { readStl, type StlFile, type StlOptions, writeStl } from './stl';
export { type SvgOptions, writeSvg } from './svg';
export { readSvg, SvgError, type SvgReadOptions } from './svg-read';
export {
  MODEL_PATH,
  modelXml,
  read3mf,
  type ThreeMfModel,
  type ThreeMfObject,
  type ThreeMfOptions,
  write3mf,
} from './threemf';
