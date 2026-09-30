// Pure (no WASM): the constraint tools set a new tangent's side with it (P1-06).

// Pure too: the host solves parameter changes and projection syncs in steps (P3-13).
export { MAX_STEPS, solveGradually, stepsBetween } from '../solver/gradual';
// Pure too: the tool host turns a solve into sketch colours with it (P1-08).
export {
  DIMENSION_TOLERANCE,
  type EntityStatus,
  type SketchStatus,
  sketchStatus,
  unmetDimensions,
} from '../solver/status';
export { tangentReversed } from '../solver/tangent';
export { type AnchorEntities, alignmentConstraints, snapConstraints } from './constraints';
export {
  type ArcShape,
  arcAround,
  arcPolyline,
  arcThrough,
  arcWithRadius,
  type CircleShape,
  circleThrough,
  tangentArc,
} from './construct';
export {
  type Curve,
  intersectCurves,
  intersectRay,
  nearestOnCurve,
  type Ray,
  sketchCurves,
} from './geometry';
export {
  type Alignment,
  type AlignmentSource,
  type Inference,
  type InferenceOptions,
  infer,
  type Snap,
  type SnapKind,
  snapToGrid,
} from './inference';
export { boxSelect, insideConvex, type PickFilter, pickEntity, polylineDistance } from './pick';
