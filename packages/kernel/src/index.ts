/**
 * @extrudo/kernel: the OCCT geometry kernel (architecture §5, ADR-0001).
 *
 * This entry is safe to import on the UI thread: it doesn't load OCCT. The
 * kernel itself runs in a worker (spawnBrowserKernel) or, in Node, through
 * `@extrudo/kernel/node`.
 */
export { spawnBrowserKernel, spawnDebugKernel } from './browser';
export {
  KernelClient,
  type KernelClientOptions,
  type KernelConnection,
  type KernelStatus,
  type SpawnKernel,
} from './client';
export type { ExtrudeOutputData } from './features/extrude';
export type { PrimitiveOutputData } from './features/primitives';
export type { RevolveOutputData } from './features/revolve';
export type { SketchOutputData, SketchProfileInfo } from './features/sketch';
export {
  decodeHistory,
  type HistoryRecord,
  type HistoryRelation,
  SUB_SHAPE_KINDS,
  type SubShapeKind,
  type SubShapeRef,
} from './history';
export {
  type Box,
  type Inspection,
  type InspectKind,
  type InspectTarget,
  type ItemMeasure,
  type Line3,
  type PairMeasure,
  pairMeasure,
  unionBox,
} from './inspect';
export {
  type Axis,
  type BooleanOptions,
  ChamferError,
  type ChamferProblem,
  type ChamferSpec,
  FilletError,
  type FilletProblem,
  Kernel,
  KernelError,
  type KernelStats,
  OffsetFaceError,
  type OffsetFaceProblem,
  type OperationResult,
  type ShapeHandle,
  type ShapeProperties,
  ShapeScope,
  ShellError,
  type ShellProblem,
  type ShellSide,
  type SurfaceGeometry,
  stepString,
  type Vec3,
} from './kernel';
export {
  type BodyMesh,
  EDGE_SEAM,
  type ExportMesh,
  type Measurements,
  type MeshOptions,
  meshBuffers,
} from './mesh';
export {
  type CurveType,
  compareGeometry,
  compoundSources,
  createdName,
  deriveNames,
  type EdgeInfo,
  edgeName,
  type FaceInfo,
  FINGERPRINT_THRESHOLD,
  faceEdgeSources,
  faceRelation,
  fingerprintOf,
  fingerprintScore,
  indexOfName,
  LostReferenceError,
  type NamedBody,
  type NamedShape,
  namedBoolean,
  namedPrism,
  namedRevolve,
  nameRelation,
  nameSweep,
  namesOf,
  type ParsedCompound,
  type ParsedFace,
  parseCompound,
  parseFace,
  positionalNames,
  propagateNames,
  type ResolvedRef,
  type ResolveOptions,
  resolveRef,
  type ShapeDescription,
  type SurfaceType,
  type SweepSource,
  type TopoNames,
  type VertexInfo,
  vertexName,
  withHistory,
} from './naming';
export type {
  PlanarCurve,
  PlanarFace,
  PlanarFacesResult,
  PlanarFrame,
  PlanarLoopEdge,
} from './planar';
export type {
  BodyAccess,
  BodyResult,
  EvalContext,
  FeatureOutput,
  KernelFeatureDefinition,
  PreviewRequest,
  PreviewTool,
  PreviewToolMesh,
  PreviewToolStyle,
  ProgressListener,
  RecomputeRequest,
  RecomputeResult,
  RecomputeStats,
} from './recompute/types';
export { type Preview, Recomputer, type RecomputerOptions } from './recomputer';
export {
  type BodyExportMesh,
  isKernelCrash,
  type KernelApi,
  KernelCrashError,
  type KernelInfo,
} from './service';
export { TEST_PART, type TestPart } from './test-part';
