// The built module comes from packages/sketch/planegcs/dist (`pnpm planegcs ensure`).

import type { GcsSystem } from '@salusoft89/planegcs/dist/planegcs_dist/gcs_system.js';
import init from '../../planegcs/dist/planegcs.js';

/** Our planegcs WASM build (ADR-0002), narrowed to what the adapter uses. */
export interface PlanegcsModule {
  GcsSystem: new () => GcsSystem;
}

export interface LoadOptions {
  /**
   * URL of the .wasm file. Required in a bundled browser build (the
   * `@extrudo/sketch/browser` entry passes it); Node finds it next to the glue.
   */
  wasmUrl?: string;
  /** Receives planegcs's stdout and stderr. The adapter sets `NoDebug`, so normally nothing. */
  log?: (line: string) => void;
}

/** Instantiates our planegcs build: about 20 ms (ADR-0002). */
export async function loadPlanegcs(options: LoadOptions = {}): Promise<PlanegcsModule> {
  const log = options.log ?? (() => {});
  const { wasmUrl } = options;
  const instance = await init({
    print: log,
    printErr: log,
    ...(wasmUrl ? { locateFile: (file: string) => (file.endsWith('.wasm') ? wasmUrl : file) } : {}),
  });
  return instance as PlanegcsModule;
}
