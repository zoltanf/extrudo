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
export { BIND_TOLERANCE, Binder, MAX_BIND_ROUNDS } from './bind';
export {
  type BodyHistory,
  type BodyWalkOptions,
  bodyChain,
  type HistoryStop,
  importBodies,
  MAX_BODY_FEATURES,
  MAX_BODY_ID_LENGTH,
  MAX_FEATURE_EXPRESSIONS,
  MAX_FILE_FEATURES,
  MAX_PROFILE_CURVES,
  MAX_PROFILE_REGIONS,
  MAX_REBUILD_BODIES,
  type MappedFeature,
  profileRefs,
  saneRebuild,
} from './bodies';
export { type BudgetOptions, type CallOutcome, KernelBudget } from './budget';
export {
  combined,
  type Drift,
  drift,
  HISTORY_AREA_TOLERANCE,
  HISTORY_BOX_TOLERANCE,
  HISTORY_VOLUME_TOLERANCE,
  historyDisagreement,
} from './check';
export {
  type ComponentMade,
  type ComponentsReport,
  MAX_IMPORT_COMPONENTS,
} from './components';
export {
  type CompoundImport,
  type CompoundReason,
  MAX_COMPOUND_OBJECTS,
} from './compounds';
export { FcstdFormatError, finite } from './errors';
export {
  EXPRESSION_REASONS,
  type ExpressionReason,
  emitExtrudo,
  MAX_EMITTED_LENGTH,
} from './fc-emit';
export {
  FcSyntaxError,
  MAX_EXPRESSION_DEPTH,
  MAX_EXPRESSION_LENGTH,
  MAX_EXPRESSION_TOKENS,
  parseFcExpression,
} from './fc-expr';
export {
  type DecodedAxis,
  type DecodedFeature,
  type DecodedSide,
  decodeFeature,
  FEATURE_TYPES,
  type FeatureContext,
  type FeatureDecode,
  type FeatureKind,
  type FeatureRefusal,
  MAX_FEATURE_LENGTH,
} from './features';
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
  type BodyImport,
  type FcstdImportOptions,
  type FcstdImportReport,
  type FcstdImportResult,
  importFcstd,
  MAX_FCSTD_BYTES,
} from './import';
export type {
  ImportKernel,
  RebuildResult,
  ShapeMeasure,
  StoredShapeStep,
} from './import-kernel';
export {
  type LinkImport,
  type LinkReason,
  MAX_ARRAY_ELEMENTS,
  MAX_LINK_COPIES,
  readPlacementList,
} from './links';
export { type LooseChain, looseChains, MAX_LOOSE_CHAINS } from './loose-chains';
export { MAX_MESH_FACETS, type MeshFacts, meshFacts, readMeshKernel } from './mesh-read';
export { MAX_IMPORT_MESHES, type MeshImport } from './meshes';
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
  MAX_STORED_BREP_BYTES,
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
  type ExpressionOutcome,
  type ParametersReport,
  parameterCounts,
} from './parameters-report';
export {
  type ImportedParameter,
  MAX_COMMENT_LENGTH,
  MAX_GROUP_LENGTH,
  MAX_IMPORT_EXPRESSIONS,
  MAX_IMPORT_PARAMETERS,
  MAX_OBJECT_EXPRESSIONS,
  MAX_PARAMETER_NAME,
  MAX_RENAME_TRIES,
  MAX_SHEET_CELLS,
  type NameChange,
  type ParameterKind,
  type ParameterLeftOut,
  prepareParameters,
} from './params';
export {
  eulerXYZ,
  importTrees,
  MAX_OPERAND_BODIES,
  MAX_TREE_FEATURES,
  MAX_TREE_PASSES,
  type TreeImport,
  type TreeNodeReport,
  type TreeReason,
} from './part-import';
export { MAX_PART_DRESSUP_EDGES, type PartDressUpEdge, readPartDressUpEdges } from './part-read';
export {
  isTreeTop,
  type LeafReason,
  MAX_IMPORT_TREE_NODES,
  MAX_MULTI_OPERANDS,
  MAX_TREE_NODES,
  type PartNodeKind,
  type PartPlan,
  type PlannedNode,
  type PlannedTree,
  partTrees,
} from './part-tree';
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
  saneMeasure,
  saneReply,
  setBodies,
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
  containerChain,
  forgetRemovedPlanes,
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
