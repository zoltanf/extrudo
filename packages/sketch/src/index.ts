/**
 * @extrudo/sketch: the sketch solver (planegcs adapter, P1-03) and the
 * inference engine for drawing (P1-02); profile detection and SVG/DXF export
 * follow in Phase 1. Runs in the browser and in
 * Node. In a bundled browser build, load the solver through
 * `@extrudo/sketch/browser`, which knows where the WASM ended up.
 */
export * from './inference';
export { type Component, type Split, splitComponents } from './solver/components';
export {
  arcAngles,
  type DimensionValues,
  docId,
  type Item,
  type MappedSketch,
  mapSketch,
} from './solver/mapping';
export { type LoadOptions, loadPlanegcs, type PlanegcsModule } from './solver/module';
export {
  applySolution,
  type CheckResult,
  type ComponentReport,
  type DragResult,
  type SketchSolution,
  SketchSolver,
  type SolveResult,
  type Vec2,
} from './solver/solver';
export {
  DIMENSION_TOLERANCE,
  type EntityStatus,
  type SketchStatus,
  sketchStatus,
  unmetDimensions,
} from './solver/status';
