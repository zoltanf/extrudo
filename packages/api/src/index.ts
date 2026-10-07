/**
 * `@extrudo/api`: the public document API (ADR-0068).
 *
 * ```
 * import { Design } from '@extrudo/api';
 *
 * const d = Design.create({ name: 'Bracket', units: 'mm' });
 * const wall = d.parameter('wall', '3 mm', { customizer: { min: 1, max: 10, step: 0.5 } });
 * d.box({ length: '40 mm', width: '20 mm', height: wall });
 * ```
 *
 * A document and the commands that change it, nothing else: no DOM, no WASM, no
 * kernel, so it runs in Node (P5-03's CLI), in a worker (P5-02's script
 * sandbox) and in the app. Geometry is derived by the kernel, never stored here
 * (ADR-0003); computing it is the consumer's job.
 */

/**
 * The document's own types, re-exported so a script needs nothing but this
 * package: what `toJSON` returns, what a reference is, and the IDs a call takes.
 */
export type {
  Attachment,
  AttachmentId,
  Customizer,
  ExtrudoDocument,
  Feature,
  FeatureId,
  FeatureInputs,
  GeomFingerprint,
  GeomRef,
  GeomRefKind,
  GroupId,
  Parameter,
  ParameterId,
  SketchData,
  SketchEntityId,
  Vec2,
} from '@extrudo/core';
export {
  Design,
  type DesignOptions,
  type FeatureLike,
  type FeatureOptions,
  type FileOptions,
  type ParameterLike,
  type ParameterOptions,
} from './design';
export { type EmitOptions, emitScript } from './emit';
export { ApiError } from './error';
export { inferUnit } from './expr';
export {
  FEATURE_METHOD_DESCRIPTIONS,
  FEATURE_TYPES,
  type FeatureMethods,
  type FeatureMethodTarget,
  type FeatureType,
  featureMethods,
} from './generated/features';
export {
  FeatureHandle,
  type OriginRefs,
  originRefs,
  ParameterHandle,
  ref,
} from './handles';
export { CounterIds, type IdFactory, type IdKind } from './ids';
export type {
  ApiInputs,
  ExprValue,
  FeatureInputValue,
  InputMeta,
  OpenInputValue,
  OpenInputValues,
  RefValue,
} from './inputs';
export {
  createdName,
  edgeName,
  indexedName,
  sourceToken,
  splitName,
  vertexName,
} from './names';
export {
  ArcHandle,
  CircleHandle,
  type ControlSplineOptions,
  DimensionHandle,
  type DimensionOptions,
  type DimensionOrientation,
  type DimValue,
  EllipseHandle,
  type EntityLike,
  LineHandle,
  PointHandle,
  PolygonHandle,
  PolylineHandle,
  RectangleHandle,
  SketchBuilder,
  type SketchDimensionInput,
  SketchEntityHandle,
  SketchHandle,
  type SketchOptions,
  SlotHandle,
  SplineHandle,
  type SplineOptions,
  type TextContent,
  TextHandle,
} from './sketch';

/**
 * The API's version (ADR-0068 §7). It rises when a change breaks a call: a
 * renamed or retyped input keeps the old form working and is mapped, like a
 * document migration.
 */
export const API_VERSION = 1;
