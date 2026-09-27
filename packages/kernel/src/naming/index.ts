/**
 * Topological naming (architecture §5.2, ADR-0005): persistent names for
 * faces, edges and vertices, carried through operations by OCCT history,
 * fingerprints, and reference resolution.
 */
export {
  type CurveType,
  decodeDescription,
  type EdgeInfo,
  type FaceInfo,
  type ShapeDescription,
  type SurfaceType,
  type VertexInfo,
} from './description';
export { FINGERPRINT_THRESHOLD, fingerprintOf, fingerprintScore } from './fingerprint';
export {
  compareGeometry,
  deriveNames,
  type HistoryNaming,
  nameSweep,
  namesOf,
  positionalNames,
  propagateNames,
  type SweepNaming,
  type TopoNames,
} from './names';
export {
  compoundSources,
  faceEdgeSources,
  indexOfName,
  type NamedBooleanOptions,
  type NamedShape,
  namedBoolean,
  namedPrism,
  namedRevolve,
  type PrismOptions,
  type RevolveOptions,
  type SweepSource,
  withHistory,
} from './ops';
export { type NamedBody, type ResolvedRef, type ResolveOptions, resolveRef } from './resolve';
export {
  createdName,
  edgeName,
  faceRelation,
  indexedName,
  nameRelation,
  type ParsedCompound,
  type ParsedFace,
  parseCompound,
  parseFace,
  sourceToken,
  splitName,
  vertexName,
} from './topo-id';
