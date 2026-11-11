/**
 * @extrudo/fcstd: reads FreeCAD `.FCStd` files (ADR-0144).
 *
 * ```ts
 * import { finalShapes, readFcstd, storedShapeText } from '@extrudo/fcstd';
 *
 * const doc = readFcstd(bytes);
 * doc.objects;                      // every object, typed properties, expressions
 * for (const s of finalShapes(doc)) // the shapes the author sees as the result
 *   storedShapeText(doc, s.source); // its B-rep text, for the import's own kernel
 * doc.problems;                     // what was left out, never silently
 * ```
 *
 * This layer decodes the file into plain data and knows nothing of Extrudo's
 * document, API or kernel. The format is in `FORMAT.md` beside the sources.
 */
export {
  type FcEntries,
  MAX_ENTRIES,
  MAX_ENTRY_BYTES,
  MAX_RATIO,
  MAX_TOTAL_BYTES,
  unzipFcstd,
} from './archive';
export { FcstdFormatError, finite } from './errors';
export {
  type FinalShape,
  type FinalShapeKind,
  finalShapes,
  invert,
  linkArrayProblem,
  linkedObjects,
  rotate,
} from './final-shapes';
export {
  type FcstdImportOptions,
  type FcstdImportReport,
  type FcstdImportResult,
  importFcstd,
  MAX_FCSTD_BYTES,
} from './import';
export type { ImportKernel, ShapeMeasure, StoredShapeStep } from './import-kernel';
export {
  binaryFormProblem,
  brepHasSolid,
  DYNAMIC_PROPERTY,
  enumString,
  type FcCell,
  type FcColourBytes,
  type FcDocument,
  type FcExpression,
  type FcGui,
  type FcObject,
  type FcPlacement,
  type FcProperty,
  type FcRecord,
  type FcSub,
  type FcUnit,
  type FcValue,
  objectNamed,
  parseVersion,
  placementOf,
  readFcstd,
  readFcstdEntries,
  storedShapeEntry,
  storedShapeText,
  type Vec3,
  versionAtLeast,
} from './model';
export { cleanName, clip, MAX_DETAIL_LENGTH, MAX_NAME_LENGTH, stepFileName } from './names';
export {
  BOX_TOLERANCE,
  disagreement,
  FREECAD_DEFAULT_COLOUR,
  hexColour,
  IMPORT_TIMEOUT_MS,
  type ImportedShape,
  importShapes,
  type LeftOutReason,
  type LeftOutShape,
  MAX_RESTARTS,
  MAX_SOLIDS_PER_SHAPE,
  NONSENSE_REPLY,
  SHAPE_TIMEOUT_MS,
  type ShapeImportOptions,
  type ShapeImportResult,
  saneReply,
  VOLUME_TOLERANCE,
  volumeDrift,
} from './shapes';
export {
  type DecodedSketch,
  decodeSketch,
  type FcConstraint,
  type FcGeometry,
  GEO_UNDEF,
  H_AXIS,
  MAX_BSPLINE_POLES,
  MAX_SKETCH_CONSTRAINTS,
  MAX_SKETCH_GEOMETRY,
  V_AXIS,
} from './sketch-decode';
export {
  arcEnds,
  CONSTRAINT_TYPES,
  type ConstraintOutcome,
  type LeftOut,
  MAX_CANDIDATES,
  MAX_VET_ROUNDS,
  mapSketch,
  type SketchMapOptions,
  type SketchMapResult,
  typeName,
} from './sketch-map';
export {
  BAD_FRAME,
  compose,
  frameIsSound,
  NO_PLANE,
  type PlaneKind,
  placeSketch,
  type SketchFrameOf,
  type SketchPlacement,
  sketchFrame,
} from './sketch-place';
export {
  type AddSketchOptions,
  type AddSketchResult,
  addSketch,
  type ExpressionBinding,
  type SketchOutcome,
  sketchObjects,
} from './sketches';
export {
  MAX_ATTRIBUTES,
  MAX_DEPTH,
  MAX_NODES,
  parseXml,
  parseXmlBytes,
  type XmlElement,
} from './xml';
