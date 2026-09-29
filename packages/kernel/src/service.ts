import type { BodyId, FeatureRegistry, GeomRef } from '@extrudo/core';
import { kernelFeatures } from './features';
import type { SubShapeKind } from './history';
import { type Inspection, type InspectTarget, inspectShapes } from './inspect';
import { Kernel, KernelError, type KernelStats } from './kernel';
import type { ExportMesh, MeshOptions } from './mesh';
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
 * and the debug commands, P2-01 recompute and preview, P2-12 export.
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
  /**
   * A reference to a face, edge or vertex of a body the last recompute
   * returned (its index in the body's mesh), or with `base` one the last
   * preview returned as its base (editing a feature), with its persistent
   * name and fingerprint (ADR-0005): what a feature's `ref` input stores.
   * Undefined if the body or the sub-shape is gone.
   */
  reference(
    body: BodyId,
    kind: SubShapeKind,
    index: number,
    base?: boolean,
  ): Promise<GeomRef | undefined>;
  /**
   * Bodies of the last finished recompute tessellated for STL and 3MF
   * (P2-12, ADR-0034): welded meshes at `tessellation`, in the order
   * asked. Rejects if a body is no longer in the model.
   */
  exportMeshes(bodies: readonly BodyId[], tessellation: MeshOptions): Promise<BodyExportMesh[]>;
  /** Bodies of the last finished recompute as one STEP AP242 file, each a named product. */
  exportStep(bodies: readonly { id: BodyId; name: string }[]): Promise<string>;
  /**
   * Measures bodies, faces, edges and vertices of the last finished
   * recompute (P2-13, ADR-0035): each item's properties, the box around
   * them and, for two, their distance and angle. Rejects if a body is no
   * longer in the model.
   */
  inspect(targets: readonly InspectTarget[]): Promise<Inspection>;
  /** Builds, measures and meshes the P0-02 test part. */
  debugTestPart(): Promise<TestPart>;
  /** Aborts the WASM instance, to exercise crash recovery (NFR-03). */
  debugCrash(): Promise<void>;
  stats(): Promise<KernelStats>;
}

/** A body's export mesh (`KernelApi.exportMeshes`). */
export interface BodyExportMesh {
  id: BodyId;
  mesh: ExportMesh;
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

  reference(
    body: BodyId,
    kind: SubShapeKind,
    index: number,
    base = false,
  ): Promise<GeomRef | undefined> {
    return this.#run(() => this.#engineOf().reference(body, kind, index, base));
  }

  exportMeshes(bodies: readonly BodyId[], tessellation: MeshOptions): Promise<BodyExportMesh[]> {
    return this.#run((kernel) =>
      bodies.map((id) => ({ id, mesh: kernel.exportMesh(this.#bodyShape(id), tessellation) })),
    );
  }

  exportStep(bodies: readonly { id: BodyId; name: string }[]): Promise<string> {
    return this.#run((kernel) =>
      kernel.writeStep(bodies.map(({ id, name }) => ({ shape: this.#bodyShape(id), name }))),
    );
  }

  inspect(targets: readonly InspectTarget[]): Promise<Inspection> {
    return this.#run((kernel) =>
      inspectShapes(
        kernel,
        targets.map((target) => ({ body: this.#bodyShape(target.body, 'measure'), target })),
      ),
    );
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

  /** A body of the last recompute. Only called inside #run. */
  #bodyShape(id: BodyId, purpose: 'export' | 'measure' = 'export') {
    const shape = this.#engineOf().latestBody(id);
    if (shape === undefined) {
      throw new KernelError(`A body to ${purpose} is no longer in the model. Try again.`);
    }
    return shape;
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
