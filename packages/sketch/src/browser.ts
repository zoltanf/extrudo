/**
 * @extrudo/sketch/browser: loads the solver in a Vite build, where the .wasm
 * is an emitted asset rather than a file next to the glue.
 */
import wasmUrl from '../planegcs/dist/planegcs.wasm?url';
import { loadPlanegcs } from './solver/module';
import { SketchSolver } from './solver/solver';

export * from './index';

/** Instantiates planegcs (about 20 ms) and returns a solver for one sketch. */
export async function loadSketchSolver(): Promise<SketchSolver> {
  return new SketchSolver(await loadPlanegcs({ wasmUrl }));
}
