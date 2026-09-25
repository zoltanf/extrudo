// The built module comes from packages/kernel/occt/dist (`pnpm occt ensure`).
import { createInstance } from '../../occt/dist/init.js';
import type { OcctModule } from './types';

export interface LoadOptions {
  /**
   * URL of the .wasm file. Required in a bundled browser build (the worker
   * imports it with `?url`); Node finds it next to the glue by itself.
   */
  wasmUrl?: string;
  /** Receives OCCT's stdout and stderr (the STEP writer prints a banner). */
  log?: (line: string) => void;
}

/** Instantiates our OCCT WASM build: about 200 ms warm, per ADR-0001. */
export async function loadOcct(options: LoadOptions = {}): Promise<OcctModule> {
  const log = options.log ?? (() => {});
  const { wasmUrl } = options;
  const instance = await createInstance({
    print: log,
    printErr: log,
    ...(wasmUrl ? { locateFile: (file: string) => (file.endsWith('.wasm') ? wasmUrl : file) } : {}),
  });
  return instance as unknown as OcctModule;
}
