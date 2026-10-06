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
  type ModelAttachment,
  type ModelSnap,
  type Snap,
  type SnapKind,
  snapToGrid,
} from './inference';
export { boxSelect, insideConvex, type PickFilter, pickEntity, polylineDistance } from './pick';
// Pure too: the app's tool host and the CLI (ADR-0069) re-solve the sketches a
// parameter change moved with this, so a parameter drives geometry the same way
// in the app and headless. The scope says whether a sketch the change doesn't
// move is solved as well: `'changed'` (the default) is the app's, `'all'` the
// CLI's.
export {
  collapses,
  dimensionValues,
  type SettleScope,
  type SketchSettleChange,
  SketchSettleError,
  settleSketches,
} from './settle';
