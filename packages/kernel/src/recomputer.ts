/**
 * Keeps the model store in step with the document (architecture §5.1,
 * ADR-0024). Runs on the UI thread and owns the kernel client of one open
 * document.
 *
 * Changes are gathered for `delayMs` and sent together; a request sent
 * while another runs cancels it in the worker. Meshes of bodies that didn't
 * change stay here: each request says which versions it has. When a feature
 * crashes the kernel, it is marked as an error and skipped until it changes.
 */
import {
  type BodyId,
  type ConstructionReport,
  type DocumentStore,
  type ExtrudoDocument,
  type Feature,
  type FeatureId,
  type FeatureStatus,
  type GeomRef,
  isConstructionReport,
  type ModelStore,
  type SketchReport,
} from '@extrudo/core';
import {
  KernelClient,
  type KernelClientOptions,
  type KernelStatus,
  type SpawnKernel,
} from './client';
import type { SmoothKind, SubShapeKind } from './history';
import type { Inspection, InspectTarget } from './inspect';
import type { BodyMesh, MeshOptions } from './mesh';
import type { BodyResult, PreviewToolMesh, RecomputeResult } from './recompute/types';
import { type BodyExportMesh, type ExportProgress, isKernelCrash } from './service';

export interface RecomputerOptions {
  spawn: SpawnKernel;
  document: DocumentStore;
  model: ModelStore<BodyMesh>;
  /** Changes within this time go out as one request. Default 30 ms. */
  delayMs?: number;
  /** A preview waits this long for the draft to settle. Default 60 ms. */
  previewDelayMs?: number;
  /**
   * Heap top, in bytes, over which the kernel worker is replaced between
   * recomputes (P4-12 H4, ADR-0067 §H4). Default `HEAP_RECYCLE_BYTES`;
   * 0 never recycles.
   */
  heapRecycleBytes?: number;
  client?: Omit<KernelClientOptions, 'onRestart'>;
  onKernelStatus?(status: KernelStatus, detail?: string): void;
  /**
   * Says the worker was replaced to free memory (P4-12 H4). The app puts it in
   * the notification history, quietly.
   */
  onRecycle?(): void;
  /**
   * The fonts sketch text needs (P4-03, ADR-0058 §4): which font IDs the
   * document uses and where their bytes are. Each one the kernel doesn't have
   * yet is sent before the recompute that needs it. Without this the kernel
   * warns about a font it hasn't got and draws no ink for it.
   */
  fonts?: FontSource;
}

/**
 * Heap top over which the kernel worker is thrown away and replaced between
 * recomputes (P4-12 H4). The heap of a long session grows about 11 MB per 100
 * recomputes of a revolve document (ADR-0050 §6), and a worker that reaches
 * the browser's limit dies; ending the worker frees it all at once.
 */
export const HEAP_RECYCLE_BYTES = 1024 * 1024 * 1024;

export interface FontSource {
  used(doc: ExtrudoDocument): Iterable<string>;
  /** A font's bytes, or undefined for an ID no source knows. */
  bytes(id: string): Promise<ArrayBuffer | undefined>;
}

export interface Preview {
  features: Record<FeatureId, FeatureStatus>;
  /** The bodies after the draft. Unchanged ones are the model store's own meshes (same objects). */
  bodies: Record<BodyId, BodyMesh>;
  /** The draft's preview tools (ADR-0027); empty when it has none. */
  tools: PreviewToolMesh[];
  /** With `base`: the bodies before the draft (editing a feature shows the model rolled back to it). */
  base?: Record<BodyId, BodyMesh>;
  /** The draft's plane, axis or point when it is a construction feature that computed (P3-05). */
  construction?: ConstructionReport;
}

export class Recomputer {
  readonly client: KernelClient;
  readonly #document: DocumentStore;
  readonly #model: ModelStore<BodyMesh>;
  readonly #fontSource: FontSource | undefined;
  readonly #delayMs: number;
  readonly #previewDelayMs: number;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #unsubscribe: (() => void) | undefined;
  #sent: ExtrudoDocument | undefined;
  #sequence = 0;
  /** The feature the kernel was computing, to blame for a crash. */
  #current: FeatureId | undefined;
  /** Features that crashed the kernel, as they were then. */
  readonly #crashed = new Map<FeatureId, Feature>();
  /** Meshes held, with the version the kernel gave each. */
  #meshes = new Map<BodyId, { version: string; mesh: BodyMesh }>();
  /** The base meshes of the open dialog's last preview (editing), kept while it is open. */
  #baseMeshes = new Map<BodyId, { version: string; mesh: BodyMesh }>();
  #preview:
    | {
        timer: ReturnType<typeof setTimeout>;
        resolve(preview: Preview | undefined): void;
      }
    | undefined;
  #previewSequence = 0;
  #disposed = false;
  /** A feature dialog's draft is open, so the worker is left alone (P4-12 H4). */
  #drafting = false;
  /** A recycle is running; the heap is asked once per finished recompute. */
  #recycling = false;
  /** The heap has been under the limit since the last recycle, so one is due. */
  #recycleArmed = true;
  readonly #heapRecycleBytes: number;
  readonly #onRecycle: (() => void) | undefined;
  /** The fonts this kernel has: a restart forgets them (ADR-0058 §4). */
  readonly #fonts = new Set<string>();

  constructor(options: RecomputerOptions) {
    this.#document = options.document;
    this.#model = options.model;
    this.#fontSource = options.fonts;
    this.#delayMs = options.delayMs ?? 30;
    this.#previewDelayMs = options.previewDelayMs ?? 60;
    this.#heapRecycleBytes = options.heapRecycleBytes ?? HEAP_RECYCLE_BYTES;
    this.#onRecycle = options.onRecycle;
    this.client = new KernelClient(options.spawn, {
      ...options.client,
      onStatus: (status, detail) => {
        options.client?.onStatus?.(status, detail);
        options.onKernelStatus?.(status, detail);
        if (status === 'failed' && !this.#disposed) {
          this.#model.getState().failed(`The kernel couldn't start: ${detail ?? 'unknown error'}`);
        }
      },
      onRestart: () => this.#resend(),
    });
  }

  /** Starts the kernel, computes the document and follows its changes. */
  start(): void {
    this.#unsubscribe ??= this.#document.subscribe((state, previous) => {
      if (state.doc !== previous.doc) this.#schedule();
    });
    this.#schedule();
  }

  /** Stops following the document and shuts the kernel down. */
  dispose(): void {
    this.#disposed = true;
    this.#unsubscribe?.();
    clearTimeout(this.#timer);
    this.#endPreview();
    this.client.dispose();
  }

  /**
   * Previews a feature dialog's draft at `index` in the timeline, once the
   * draft has stayed the same for `previewDelayMs`. Resolves `undefined`
   * when a newer preview (or `endPreview`) supersedes it or it fails.
   */
  preview(
    draft: Feature,
    index: number,
    options: { base?: boolean } = {},
  ): Promise<Preview | undefined> {
    this.#supersedePreview();
    // A dialog is open from its first draft until it closes: the worker is not
    // thrown away under it (P4-12 H4).
    this.#drafting = true;
    const sequence = ++this.#previewSequence;
    return new Promise((resolve) => {
      const timer = setTimeout(async () => {
        this.#preview = undefined;
        try {
          const doc = this.#document.getState().doc;
          const have = { ...this.#have(), ...this.#baseHave() };
          const result = await this.client.call((api) =>
            api.preview({ doc, draft, index, have, ...(options.base && { base: true }) }),
          );
          if (sequence !== this.#previewSequence || result.status !== 'done') {
            resolve(undefined);
            return;
          }
          const bodies: Record<BodyId, BodyMesh> = {};
          for (const body of result.bodies) {
            const mesh = body.mesh ?? this.#held(body) ?? this.#heldBase(body);
            if (mesh) bodies[body.id] = mesh;
          }
          let base: Record<BodyId, BodyMesh> | undefined;
          if (result.base) {
            base = {};
            const held = new Map<BodyId, { version: string; mesh: BodyMesh }>();
            for (const body of result.base) {
              const mesh = body.mesh ?? this.#held(body) ?? this.#heldBase(body);
              if (!mesh) continue;
              base[body.id] = mesh;
              held.set(body.id, { version: body.version, mesh });
            }
            this.#baseMeshes = held;
          }
          const own = result.reports[draft.id];
          resolve({
            features: result.features,
            bodies,
            tools: result.tools ?? [],
            ...(base && { base }),
            ...(isConstructionReport(own) && { construction: own }),
          });
        } catch {
          resolve(undefined);
        }
      }, this.#previewDelayMs);
      this.#preview = { timer, resolve };
    });
  }

  /**
   * The persistent reference of a face, edge or vertex of a body the model
   * store shows (by its mesh index), or with `base` of the last preview's
   * base, with its fingerprint (ADR-0005): what a feature dialog's
   * selection field stores. Undefined if the kernel no longer has it or
   * can't be reached.
   */
  async reference(
    body: BodyId,
    kind: SubShapeKind,
    index: number,
    base = false,
  ): Promise<GeomRef | undefined> {
    try {
      return await this.client.call((api) => api.reference(body, kind, index, base));
    } catch {
      return undefined;
    }
  }

  /**
   * The edges (mesh indices, the edge itself included) of the tangent
   * chain around an edge of a body the model store shows (P3-01): what a
   * fillet rounds together. Undefined if the kernel can't say.
   */
  async tangentChain(
    body: BodyId,
    index: number,
    base = false,
    kind: SmoothKind = 'edge',
  ): Promise<number[] | undefined> {
    try {
      return await this.client.call((api) => api.tangentChain(body, index, base, kind));
    } catch {
      return undefined;
    }
  }

  /**
   * Bodies the model store shows, tessellated for STL and 3MF (P2-12):
   * welded meshes at `tessellation`. Rejects if the kernel can't do it.
   */
  exportMeshes(
    bodies: readonly BodyId[],
    tessellation: MeshOptions,
    onProgress?: ExportProgress,
  ): Promise<BodyExportMesh[]> {
    return this.client.call((api) => api.exportMeshes(bodies, tessellation, onProgress));
  }

  /** Bodies the model store shows as one STEP AP242 file, each a product with its name. */
  exportStep(bodies: readonly { id: BodyId; name: string }[]): Promise<string> {
    return this.client.call((api) => api.exportStep(bodies));
  }

  /**
   * Measures what the model store shows (P2-13): bodies, faces, edges and
   * vertices by mesh index. Rejects if the kernel can't do it.
   */
  inspect(targets: readonly InspectTarget[]): Promise<Inspection> {
    return this.client.call((api) => api.inspect(targets));
  }

  /** The dialog closed: drops a pending preview. */
  endPreview(): void {
    this.#endPreview();
    this.client.call((api) => api.endPreview()).catch(() => {});
  }

  #endPreview(): void {
    this.#supersedePreview();
    this.#previewSequence++;
    this.#drafting = false;
    this.#baseMeshes = new Map();
  }

  #supersedePreview(): void {
    if (!this.#preview) return;
    clearTimeout(this.#preview.timer);
    this.#preview.resolve(undefined);
    this.#preview = undefined;
  }

  #schedule(): void {
    if (this.#timer !== undefined || this.#disposed) return;
    this.#timer = setTimeout(() => {
      this.#timer = undefined;
      void this.#send();
    }, this.#delayMs);
  }

  /** After a kernel restart: the new kernel has an empty cache and needs the document again. */
  #resend(): void {
    this.#sent = undefined;
    // The new kernel has no fonts either (ADR-0058 §4).
    this.#fonts.clear();
    this.#schedule();
  }

  /**
   * Sends the document's fonts this kernel doesn't have (P4-03): the sketch
   * evaluator shapes text with them, and a font ID that never changes under
   * its ID, so once is enough. An ID no source knows is left out, and the
   * sketch warns about it.
   */
  async #sendFonts(doc: ExtrudoDocument): Promise<void> {
    const source = this.#fontSource;
    if (!source) return;
    for (const id of source.used(doc)) {
      if (this.#fonts.has(id) || this.#disposed) continue;
      const data = await source.bytes(id);
      if (this.#disposed) return;
      if (!data) continue;
      await this.client.call((api) => api.addFont(id, data));
      this.#fonts.add(id);
    }
  }

  async #send(): Promise<void> {
    const doc = this.#document.getState().doc;
    if (doc === this.#sent || this.#disposed) return;
    this.#sent = doc;
    const sequence = ++this.#sequence;
    this.#model.getState().computing();
    const crashed = this.#stillCrashed(doc);
    let result: RecomputeResult;
    try {
      await this.#sendFonts(doc);
      if (sequence !== this.#sequence || this.#disposed) return;
      result = await this.client.call((api) =>
        api.recompute({ doc, have: this.#have(), crashed }, (id) => {
          if (sequence === this.#sequence) this.#current = id;
        }),
      );
    } catch (error) {
      if (sequence !== this.#sequence || this.#disposed) return;
      if (isKernelCrash(error)) {
        const culprit = this.#current && doc.features.find((f) => f.id === this.#current);
        if (culprit) this.#crashed.set(culprit.id, culprit);
        // KernelClient restarts the kernel and #resend follows, unless it gave up.
        if (this.client.status !== 'failed') return;
      }
      this.#model.getState().failed(error instanceof Error ? error.message : String(error));
      return;
    } finally {
      if (sequence === this.#sequence) this.#current = undefined;
    }
    if (sequence !== this.#sequence || result.status !== 'done' || this.#disposed) return;

    const meshes = new Map<BodyId, { version: string; mesh: BodyMesh }>();
    let missing = false;
    for (const body of result.bodies) {
      const mesh = body.mesh ?? this.#held(body);
      if (mesh) meshes.set(body.id, { version: body.version, mesh });
      else missing = true;
    }
    this.#meshes = meshes;
    if (missing) {
      // The kernel thought we had a mesh we don't: ask again for everything.
      this.#resend();
      return;
    }
    // Unchanged records keep their identity, so views that read them don't redraw.
    const previous = this.#model.getState();
    // Construction features report their plane, axis or point; sketches their frame (P3-05).
    const sketches: Record<string, unknown> = {};
    const construction: Record<string, unknown> = {};
    for (const [id, report] of Object.entries(result.reports)) {
      (isConstructionReport(report) ? construction : sketches)[id] = report;
    }
    const bodies = Object.fromEntries([...meshes].map(([id, { mesh }]) => [id, mesh]));
    this.#model.getState().computed({
      features: sameStatuses(previous.features, result.features)
        ? previous.features
        : result.features,
      bodies: sameRecord(previous.bodies, bodies) ? previous.bodies : bodies,
      sketches: sameReports(previous.sketches, sketches)
        ? previous.sketches
        : (sketches as Record<FeatureId, SketchReport>),
      construction: sameReports(previous.construction, construction)
        ? previous.construction
        : (construction as Record<FeatureId, ConstructionReport>),
      stats: {
        ms: result.stats.ms,
        evaluated: result.stats.evaluated.length,
        reused: result.stats.reused,
      },
      doc,
    });
    // Between recomputes, never under a dialog: a worker whose heap has grown
    // too large is thrown away and the new one recomputes cold, while the model
    // store keeps showing this result until it arrives (P4-12 H4).
    void this.#recycleIfBig();
  }

  /**
   * Replaces the kernel worker when its heap top has passed the limit (P4-12
   * H4). The result the model store has is untouched: `restart` goes through
   * the client's restart path, so the fonts are sent again and the document
   * recomputed cold by the next send.
   */
  async #recycleIfBig(): Promise<void> {
    if (this.#disposed || this.#recycling || this.#drafting || this.#heapRecycleBytes <= 0) return;
    let top: number;
    try {
      ({ top } = await this.client.call((api) => api.heap()));
    } catch {
      // A kernel that can't answer is the crash path's business, not this one.
      return;
    }
    // Under the limit: a later growth past it is worth a fresh worker.
    if (top <= this.#heapRecycleBytes) {
      this.#recycleArmed = true;
      return;
    }
    // Over it, but not since it was under: a fresh worker whose own heap
    // already passes the limit (the limit is below what the WASM starts with)
    // must not put the restart loop going.
    if (!this.#recycleArmed || this.#disposed || this.#drafting) return;
    this.#recycleArmed = false;
    this.#recycling = true;
    try {
      await this.client.restart();
      this.#onRecycle?.();
    } catch {
      // Restarting failed; the status bar says so through the kernel status.
    } finally {
      this.#recycling = false;
    }
  }

  /** Crashed features that haven't changed since; forgets the others. */
  #stillCrashed(doc: ExtrudoDocument): FeatureId[] {
    const current = new Map(doc.features.map((f) => [f.id, f]));
    for (const [id, feature] of this.#crashed) {
      if (current.get(id) !== feature) this.#crashed.delete(id);
    }
    return [...this.#crashed.keys()];
  }

  #have(): Record<BodyId, string> {
    return Object.fromEntries([...this.#meshes].map(([id, { version }]) => [id, version]));
  }

  /** The held base meshes a preview may leave out (where the model has another version). */
  #baseHave(): Record<BodyId, string> {
    const have: Record<BodyId, string> = {};
    for (const [id, { version }] of this.#baseMeshes) {
      if (this.#meshes.get(id)?.version !== version) have[id] = version;
    }
    return have;
  }

  #heldBase(body: BodyResult): BodyMesh | undefined {
    const held = this.#baseMeshes.get(body.id);
    return held?.version === body.version ? held.mesh : undefined;
  }

  #held(body: BodyResult): BodyMesh | undefined {
    const held = this.#meshes.get(body.id);
    return held?.version === body.version ? held.mesh : undefined;
  }
}

function sameRecord<T>(a: Readonly<Record<string, T>>, b: Readonly<Record<string, T>>): boolean {
  const keys = Object.keys(a);
  const other = Object.keys(b);
  return (
    keys.length === other.length && keys.every((key, i) => other[i] === key && a[key] === b[key])
  );
}

/** Whether the kernel's reports (plain JSON) say what the model store already has. */
function sameReports(a: Readonly<Record<string, unknown>>, b: Readonly<Record<string, unknown>>) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function sameStatuses(
  a: Readonly<Record<string, FeatureStatus>>,
  b: Readonly<Record<string, FeatureStatus>>,
): boolean {
  const keys = Object.keys(a);
  const other = Object.keys(b);
  return (
    keys.length === other.length &&
    keys.every((key, i) => {
      const [x, y] = [a[key], b[key]];
      return (
        other[i] === key &&
        x?.status === y?.status &&
        x?.message === y?.message &&
        JSON.stringify(x?.refs) === JSON.stringify(y?.refs)
      );
    })
  );
}
