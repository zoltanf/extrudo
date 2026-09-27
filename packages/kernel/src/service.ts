import type { FeatureRegistry } from '@extrudo/core';
import { kernelFeatures } from './features';
import { Kernel, type KernelStats } from './kernel';
import type { OcctModule } from './occt/types';
import { type EngineOptions, RecomputeEngine } from './recompute/engine';
import type {
  KernelFeatureDefinition,
  PreviewRequest,
  ProgressListener,
  RecomputeRequest,
  RecomputeResult,
} from './recompute/types';
import { makeTestPart, type TestPart } from './test-part';

export interface KernelInfo {
  /** Time to fetch, compile and instantiate the WASM, in ms. */
  initMs: number;
  heapBytes: number;
}

/**
 * The kernel worker's RPC surface (architecture §5.1). P0-09 has the plumbing
 * and the debug commands, P2-01 recompute and preview; export arrives later
 * in Phase 2.
 */
export interface KernelApi {
  init(): Promise<KernelInfo>;
  /**
   * Recomputes the document (ADR-0024). A newer call cancels a running one
   * between features. `onFeature` hears of each feature before it is
   * evaluated, so the caller knows which one crashed the kernel.
   */
  recompute(request: RecomputeRequest, onFeature?: ProgressListener): Promise<RecomputeResult>;
  /** Evaluates a feature dialog's draft in its place in the timeline. */
  preview(request: PreviewRequest, onFeature?: ProgressListener): Promise<RecomputeResult>;
  /** The dialog closed: cancels a running preview and releases its results to the cache. */
  endPreview(): Promise<void>;
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
export interface KernelServiceOptions {
  /** The feature types to compute. Default: every type the kernel knows. */
  features?: FeatureRegistry<KernelFeatureDefinition>;
  engine?: EngineOptions;
}

export class KernelService implements KernelApi {
  readonly #load: () => Promise<OcctModule>;
  readonly #options: KernelServiceOptions;
  #kernel: Promise<Kernel> | undefined;
  #engine: RecomputeEngine | undefined;
  #initMs = 0;
  #crashed: Error | undefined;

  constructor(load: () => Promise<OcctModule>, options: KernelServiceOptions = {}) {
    this.#load = load;
    this.#options = options;
  }

  async init(): Promise<KernelInfo> {
    const kernel = await this.#ready();
    return { initMs: this.#initMs, heapBytes: kernel.stats().heapBytes };
  }

  recompute(request: RecomputeRequest, onFeature?: ProgressListener): Promise<RecomputeResult> {
    return this.#run(() => this.#engineOf().recompute(request, onFeature));
  }

  preview(request: PreviewRequest, onFeature?: ProgressListener): Promise<RecomputeResult> {
    return this.#run(() => this.#engineOf().preview(request, onFeature));
  }

  async endPreview(): Promise<void> {
    this.#engine?.endPreview();
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
    this.#engine?.clear();
    (await this.#kernel).dispose();
  }

  /** Only called inside #run, once the kernel is ready. */
  #engineOf(): RecomputeEngine {
    if (!this.#engine) throw new Error('The kernel is not ready.');
    return this.#engine;
  }

  #ready(): Promise<Kernel> {
    this.#kernel ??= (async () => {
      const start = performance.now();
      const kernel = new Kernel(await this.#load());
      this.#engine = new RecomputeEngine(
        kernel,
        this.#options.features ?? kernelFeatures(),
        this.#options.engine,
      );
      this.#initMs = performance.now() - start;
      return kernel;
    })();
    return this.#kernel;
  }

  async #run<T>(task: (kernel: Kernel) => T | Promise<T>): Promise<T> {
    if (this.#crashed) throw new KernelCrashError(`The kernel stopped: ${this.#crashed.message}`);
    const kernel = await this.#ready();
    try {
      return await task(kernel);
    } catch (error) {
      if (error instanceof WebAssembly.RuntimeError) {
        this.#crashed = error;
        throw new KernelCrashError(`The kernel stopped: ${error.message}`);
      }
      throw error;
    }
  }
}
