import type { BodyId, FeatureRegistry, GeomRef } from '@extrudo/core';
import { kernelFeatures } from './features';
import type { SmoothKind, SubShapeKind } from './history';
import { type Inspection, type InspectTarget, inspectShapes } from './inspect';
import { type HeapUsage, Kernel, KernelError, type KernelStats, type ShapeHandle } from './kernel';
import type { ExportMesh, MeshOptions } from './mesh';
import type { OcctModule } from './occt/types';
import { type EngineOptions, RecomputeEngine, yieldToEvents } from './recompute/engine';
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
   * Registers a font for sketch text under its versioned ID (P4-03,
   * ADR-0058 §4): the sketch evaluator shapes text with the fonts sent here.
   * The first call imports the shaper; a repeated ID is a no-op. The app
   * sends every font a document uses before it recomputes, so no font is
   * part of a cache key.
   */
  addFont(id: string, bytes: ArrayBuffer): Promise<void>;
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
   * The edges of the chain of tangent-continuous edges around an edge of a
   * body (indices in the body's mesh, the edge itself included; `base` as
   * for `reference`): what a fillet rounds together (P3-01, ADR-0038).
   * Undefined if the body is gone.
   */
  tangentChain(
    body: BodyId,
    index: number,
    base?: boolean,
    kind?: SmoothKind,
  ): Promise<number[] | undefined>;
  /**
   * Bodies of the last finished recompute tessellated for STL and 3MF
   * (P2-12, ADR-0034): welded meshes at `tessellation`, in the order
   * asked. Rejects if a body is no longer in the model. Meshes one body at
   * a time (P3-13) and lets other calls in between (a recompute waits for
   * one body, not the whole export); before each body and at the end it
   * calls `onProgress(done, total)`, and a `false` from it stops the export
   * with an `ExportCancelledError`.
   */
  exportMeshes(
    bodies: readonly BodyId[],
    tessellation: MeshOptions,
    onProgress?: ExportProgress,
  ): Promise<BodyExportMesh[]>;
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
  /**
   * How much of the WASM heap is in use (P4-12 H4, ADR-0067 §H4): the top of
   * its malloc heap and the size of the WASM memory. The Recomputer asks after
   * each recompute and replaces the worker when the top passes its limit, so
   * this has to be cheap.
   */
  heap(): Promise<HeapUsage>;
}

/** Hears how far an export is; returns `false` to stop it (it may be async, across the worker). */
export type ExportProgress = (
  done: number,
  total: number,
) => boolean | undefined | Promise<boolean | undefined>;

/** An export stopped by its `onProgress` (P3-13). */
export class ExportCancelledError extends Error {
  override name = 'ExportCancelledError';
  constructor() {
    super('The export was cancelled.');
  }
}

export function isExportCancelled(error: unknown): boolean {
  return error instanceof Error && error.name === 'ExportCancelledError';
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

  /**
   * Font bytes for sketch text (ADR-0058 §4). The shaper (`@extrudo/sketch/
   * text`, opentype.js) loads lazily on the first font, so a worker without
   * text never parses fonts. Doesn't touch the kernel: parsing can't crash
   * the WASM, and a font may arrive before `init`.
   */
  async addFont(id: string, bytes: ArrayBuffer): Promise<void> {
    const text = await import('@extrudo/sketch/text');
    // A second call with the same ID is a no-op: the bytes never change
    // under an ID (ADR-0058 §3).
    if (!text.hasFont(id)) text.loadFont(id, new Uint8Array(bytes));
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

  tangentChain(
    body: BodyId,
    index: number,
    base = false,
    kind: SmoothKind = 'edge',
  ): Promise<number[] | undefined> {
    return this.#run(() => this.#engineOf().tangentChain(body, index, base, kind));
  }

  exportMeshes(
    bodies: readonly BodyId[],
    tessellation: MeshOptions,
    onProgress?: ExportProgress,
  ): Promise<BodyExportMesh[]> {
    return this.#run(async (kernel) => {
      const held = this.#engineOf().hold(bodies);
      try {
        if (held.shapes.some((h) => h === undefined)) {
          throw new KernelError('A body to export is no longer in the model. Try again.');
        }
        const out: BodyExportMesh[] = [];
        for (const [i, id] of bodies.entries()) {
          if ((await onProgress?.(i, bodies.length)) === false) throw new ExportCancelledError();
          out.push({ id, mesh: kernel.exportMesh(held.shapes[i] as ShapeHandle, tessellation) });
          // A recompute, or the caller's cancel, gets its turn between bodies.
          if (i < bodies.length - 1) await yieldToEvents();
        }
        await onProgress?.(bodies.length, bodies.length);
        return out;
      } finally {
        held.release();
      }
    });
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

  async heap(): Promise<HeapUsage> {
    return this.#run((kernel) => kernel.heap());
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
