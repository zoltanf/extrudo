import { Kernel, type KernelStats } from './kernel';
import type { OcctModule } from './occt/types';
import { makeTestPart, type TestPart } from './test-part';

export interface KernelInfo {
  /** Time to fetch, compile and instantiate the WASM, in ms. */
  initMs: number;
  heapBytes: number;
}

/**
 * The kernel worker's RPC surface (architecture §5.1). P0-09 has the plumbing
 * and a debug command; recompute, preview and export arrive with Phase 2.
 */
export interface KernelApi {
  init(): Promise<KernelInfo>;
  /** Builds, measures and meshes the P0-02 test part. */
  debugTestPart(): Promise<TestPart>;
  /** Aborts the WASM instance, to exercise crash recovery (NFR-03). */
  debugCrash(): Promise<void>;
  stats(): Promise<KernelStats>;
}

/**
 * The WASM instance aborted (or the worker died). The kernel can't be used
 * again; KernelClient starts a new one.
 */
export class KernelCrashError extends Error {
  override name = 'KernelCrashError';
}

export function isKernelCrash(error: unknown): boolean {
  return error instanceof Error && error.name === 'KernelCrashError';
}

/**
 * Runs the kernel in the current thread: inside the worker in the app, or
 * directly in Node tests. Any WebAssembly.RuntimeError (an OCCT abort, an out
 * of memory trap) marks the instance dead and surfaces as KernelCrashError.
 */
export class KernelService implements KernelApi {
  readonly #load: () => Promise<OcctModule>;
  #kernel: Promise<Kernel> | undefined;
  #initMs = 0;
  #crashed: Error | undefined;

  constructor(load: () => Promise<OcctModule>) {
    this.#load = load;
  }

  async init(): Promise<KernelInfo> {
    const kernel = await this.#ready();
    return { initMs: this.#initMs, heapBytes: kernel.stats().heapBytes };
  }

  async debugTestPart(): Promise<TestPart> {
    return this.#run((kernel) => makeTestPart(kernel));
  }

  async debugCrash(): Promise<void> {
    await this.#run((kernel) => kernel.debugAbort());
  }

  async stats(): Promise<KernelStats> {
    return this.#run((kernel) => kernel.stats());
  }

  /** Frees the kernel's shapes. The OCCT instance itself goes with its worker. */
  async dispose(): Promise<void> {
    if (this.#crashed || !this.#kernel) return;
    (await this.#kernel).dispose();
  }

  #ready(): Promise<Kernel> {
    this.#kernel ??= (async () => {
      const start = performance.now();
      const kernel = new Kernel(await this.#load());
      this.#initMs = performance.now() - start;
      return kernel;
    })();
    return this.#kernel;
  }

  async #run<T>(task: (kernel: Kernel) => T): Promise<T> {
    if (this.#crashed) throw new KernelCrashError(`The kernel stopped: ${this.#crashed.message}`);
    const kernel = await this.#ready();
    try {
      return task(kernel);
    } catch (error) {
      if (error instanceof WebAssembly.RuntimeError) {
        this.#crashed = error;
        throw new KernelCrashError(`The kernel stopped: ${error.message}`);
      }
      throw error;
    }
  }
}
