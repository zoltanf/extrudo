/**
 * The recompute engine (architecture §5.1, ADR-0024): walks the timeline in
 * the kernel worker, evaluates each active feature or takes its result from
 * the cache, and meshes the bodies at the marker.
 *
 * A feature's cache key hashes everything its result depends on: its type,
 * ID and inputs, the values of its expressions, the keys of the features it
 * refers to and, unless it ignores bodies, the key of the body set before
 * it. An edit therefore re-evaluates the edited feature and what depends on
 * it; undo and scrubbing back to an earlier value hit the cache.
 *
 * Shapes in the cache are reference-counted: a body passed on unchanged is
 * shared by the entries of every feature it passes through, and goes back to
 * the kernel when the last entry holding it is evicted.
 */
import {
  type BodyId,
  type EvaluateResult,
  type ExtrudoDocument,
  evaluateParameters,
  type Feature,
  type FeatureId,
  type FeatureRegistry,
  type FeatureStatus,
  type GeomRef,
  type ReferenceIssue,
} from '@extrudo/core';
import type { SubShapeKind } from '../history';
import { type Kernel, KernelError, type ShapeHandle } from '../kernel';
import type { MeshOptions } from '../mesh';
import type { ShapeDescription } from '../naming/description';
import { fingerprintOf } from '../naming/fingerprint';
import { namesOf, positionalNames, type TopoNames } from '../naming/names';
import { LostReferenceError, resolveRef } from '../naming/resolve';
import { hashOf } from './hash';
import type {
  BodyResult,
  EvalContext,
  FeatureOutput,
  KernelFeatureDefinition,
  PreviewRequest,
  PreviewToolMesh,
  ProgressListener,
  RecomputeRequest,
  RecomputeResult,
} from './types';

export const DEFAULT_TESSELLATION: MeshOptions = { linearDeflection: 0.05, angularDeflection: 0.3 };

export interface EngineOptions {
  /** Cache entries kept besides those the latest recompute and preview use. Default 256. */
  maxEntries?: number;
  /**
   * Throw when an evaluator leaves shapes behind (tests). Otherwise the
   * leak is reported through `onLeak` (default: `console.warn`).
   */
  strictLeaks?: boolean;
  onLeak?(feature: Feature, shapes: number): void;
}

interface Entry {
  key: string;
  status: FeatureStatus;
  /** Absent when the feature failed. */
  output: FeatureOutput | undefined;
  /** Shapes this entry holds a reference to. */
  handles: ShapeHandle[];
}

/** What the walk knows about a feature it has passed. */
type Passed = { state: 'done'; entry: Entry } | { state: 'failed' } | { state: 'suppressed' };

type Channel = 'recompute' | 'preview';

const EMPTY_BODIES = 'bodies:none';

export class RecomputeEngine {
  readonly #kernel: Kernel;
  readonly #registry: FeatureRegistry<KernelFeatureDefinition>;
  readonly #options: EngineOptions;
  /** In least-recently-used order: a hit moves its entry to the end. */
  readonly #entries = new Map<string, Entry>();
  readonly #refs = new Map<ShapeHandle, number>();
  /** Version of each body shape the cache holds (see BodyResult.version). */
  readonly #versions = new Map<ShapeHandle, string>();
  /** Which feature made each body shape, for mesh errors. */
  readonly #makers = new Map<ShapeHandle, FeatureId>();
  /** Naming table of each body shape the cache holds (ADR-0005). */
  readonly #names = new Map<ShapeHandle, TopoNames>();
  /** Descriptions of shapes the cache holds, made on first use. */
  readonly #descriptions = new Map<ShapeHandle, ShapeDescription>();
  /** The bodies at the marker of the last finished recompute (not preview). */
  #latest: ReadonlyMap<BodyId, ShapeHandle> = new Map();
  /** The bodies before the draft of the last finished preview (pinned with it). */
  #previewBase: ReadonlyMap<BodyId, ShapeHandle> = new Map();
  readonly #pinned: Record<Channel, Set<string>> = { recompute: new Set(), preview: new Set() };
  readonly #generation: Record<Channel, number> = { recompute: 0, preview: 0 };
  /** Keys used by walks still running: eviction must not free shapes they hold. */
  readonly #inFlight = new Set<Set<string>>();

  constructor(
    kernel: Kernel,
    registry: FeatureRegistry<KernelFeatureDefinition>,
    options: EngineOptions = {},
  ) {
    this.#kernel = kernel;
    this.#registry = registry;
    this.#options = options;
  }

  /** Cache entries held, and shapes they hold. */
  get size(): { entries: number; shapes: number } {
    return { entries: this.#entries.size, shapes: this.#refs.size };
  }

  /**
   * Recomputes the document up to its timeline marker. A newer call cancels
   * this one between two features; it then resolves `cancelled`.
   */
  recompute(request: RecomputeRequest, onFeature?: ProgressListener): Promise<RecomputeResult> {
    const generation = ++this.#generation.recompute;
    const { doc } = request;
    return this.#walk(
      doc,
      doc.timelineMarker,
      request,
      'recompute',
      generation,
      onFeature,
      undefined,
    );
  }

  /**
   * Evaluates the timeline before `index` and then `draft` in its place:
   * the live preview of a feature dialog. Its results stay in the cache, so
   * pressing OK with the same inputs costs nothing. A newer preview cancels
   * this one; recomputes don't.
   */
  preview(request: PreviewRequest, onFeature?: ProgressListener): Promise<RecomputeResult> {
    const generation = ++this.#generation.preview;
    const { doc, draft, index } = request;
    const features = [...doc.features.slice(0, index), draft];
    const trial: ExtrudoDocument = { ...doc, features, timelineMarker: features.length };
    return this.#walk(trial, features.length, request, 'preview', generation, onFeature, draft.id);
  }

  /** The dialog closed: cancels a running preview and lets the cache evict its results. */
  endPreview(): void {
    this.#generation.preview++;
    this.#pinned.preview = new Set();
    this.#previewBase = new Map();
  }

  /**
   * A reference to one face, edge or vertex of a body of the last finished
   * recompute (its sub-shape index as in the body's mesh), or with `base`
   * of the last preview's bodies before its draft (editing a feature): its
   * persistent name and fingerprint, ready to store in a feature's `ref`
   * input. Undefined if there is no such body or sub-shape.
   */
  reference(body: BodyId, kind: SubShapeKind, index: number, base = false): GeomRef | undefined {
    const shape = (base ? this.#previewBase : this.#latest).get(body);
    const names = shape === undefined ? undefined : this.#names.get(shape);
    if (shape === undefined || !names) return undefined;
    const id = namesOf(names, kind)[index];
    if (id === undefined) return undefined;
    const fingerprint = fingerprintOf(this.#describe(shape), names, kind, index);
    return { kind, id, fingerprint };
  }

  /**
   * The edges (sub-shape indices, the edge itself included) of the chain of
   * tangent-continuous edges around one edge of a body of the last finished
   * recompute, or with `base` of the last preview's base: what a fillet
   * rounds together (P3-01). Undefined if there is no such body.
   */
  tangentChain(body: BodyId, edge: number, base = false): number[] | undefined {
    const shape = (base ? this.#previewBase : this.#latest).get(body);
    if (shape === undefined || edge < 0 || edge >= this.#kernel.count(shape, 'edge')) {
      return undefined;
    }
    return this.#kernel.tangentChain(shape, edge);
  }

  /**
   * The shape of a body of the last finished recompute (what the model
   * store shows), for export. It stays the cache's: don't release it.
   */
  latestBody(body: BodyId): ShapeHandle | undefined {
    return this.#latest.get(body);
  }

  /** Empties the cache and gives every shape back to the kernel. */
  clear(): void {
    for (const entry of this.#entries.values()) this.#drop(entry);
    this.#entries.clear();
    this.#latest = new Map();
    this.#previewBase = new Map();
    this.#pinned.recompute.clear();
    this.#pinned.preview.clear();
  }

  async #walk(
    doc: ExtrudoDocument,
    end: number,
    request: RecomputeRequest,
    channel: Channel,
    generation: number,
    onFeature: ProgressListener | undefined,
    draft: FeatureId | undefined,
  ): Promise<RecomputeResult> {
    const used = new Set<string>();
    this.#inFlight.add(used);
    try {
      return await this.#run(doc, end, request, channel, generation, onFeature, used, draft);
    } finally {
      this.#inFlight.delete(used);
    }
  }

  async #run(
    doc: ExtrudoDocument,
    end: number,
    request: RecomputeRequest,
    channel: Channel,
    generation: number,
    onFeature: ProgressListener | undefined,
    used: Set<string>,
    draft: FeatureId | undefined,
  ): Promise<RecomputeResult> {
    const start = performance.now();
    const cancelled = () => this.#generation[channel] !== generation;
    const parameters = evaluateParameters(doc);
    const crashed = new Set(request.crashed ?? []);
    const index = new Map(doc.features.map((f, i) => [f.id, i]));
    const passed = new Map<FeatureId, Passed>();
    const features: Record<FeatureId, FeatureStatus> = {};
    const reports: Record<FeatureId, unknown> = {};
    const evaluated: FeatureId[] = [];
    let reused = 0;
    let bodies: ReadonlyMap<BodyId, ShapeHandle> = new Map();
    let bodiesKey = EMPTY_BODIES;

    /** The bodies before the draft (previews). */
    let base: ReadonlyMap<BodyId, ShapeHandle> | undefined;

    for (const feature of doc.features.slice(0, end)) {
      if (feature.id === draft) base = bodies;
      if (feature.suppressed) {
        passed.set(feature.id, { state: 'suppressed' });
        continue;
      }
      const fail = (message: string) => {
        features[feature.id] = { status: 'error', message };
        passed.set(feature.id, { state: 'failed' });
      };
      if (crashed.has(feature.id)) {
        fail('The kernel stopped while computing this feature. Change it to try again.');
        continue;
      }
      const definition = this.#registry.get(feature.type);
      if (!definition) {
        fail(`This version of Extrudo can't compute ${typeLabel(feature.type)} features.`);
        continue;
      }
      const parsed = definition.inputsSchema.safeParse(feature.inputs);
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        fail(`Invalid inputs: ${issue?.path.join('.') || 'inputs'} ${issue?.message ?? ''}`.trim());
        continue;
      }
      const values = expressionValues(parameters.inputs.get(feature.id));
      if (typeof values === 'string') {
        fail(values);
        continue;
      }
      const dependencies = featureDependencies(feature, index);
      const problem = dependencyProblem(dependencies, passed, index, doc, index.get(feature.id));
      if (problem) {
        fail(problem);
        continue;
      }
      const upstream = dependencies.map((id) => (passed.get(id) as { entry: Entry }).entry);
      const access = definition.bodyAccess?.(parsed.data) ?? 'write';
      const key = hashOf(
        feature.type,
        feature.id,
        feature.inputs,
        values,
        upstream.map((e) => e.key),
        access === 'none' ? null : bodiesKey,
      );

      let entry = this.#entries.get(key);
      if (!entry) {
        await yieldToEvents();
        if (cancelled()) return { status: 'cancelled' };
        // Another walk (a preview, say) may have computed it meanwhile.
        entry = this.#entries.get(key);
      }
      if (entry) {
        reused++;
        this.#entries.delete(key);
        this.#entries.set(key, entry);
      } else {
        onFeature?.(feature.id);
        const outputs = new Map(dependencies.map((id, i) => [id, upstream[i]?.output]));
        entry = this.#evaluate(definition, feature, parsed.data, values, bodies, outputs, key);
        evaluated.push(feature.id);
      }
      used.add(key);
      features[feature.id] = entry.status;
      if (!entry.output) {
        passed.set(feature.id, { state: 'failed' });
        continue;
      }
      passed.set(feature.id, { state: 'done', entry });
      if (entry.output.report !== undefined) reports[feature.id] = entry.output.report;
      if (access === 'write' && entry.output.bodies) {
        bodies = entry.output.bodies;
        bodiesKey = key;
      }
    }

    if (cancelled()) return { status: 'cancelled' };
    this.#pinned[channel] = new Set(used);
    if (channel === 'recompute') this.#latest = bodies;
    if (channel === 'preview') this.#previewBase = base ?? new Map();
    const results = this.#meshAll(bodies, request, features);
    const tools = draft === undefined ? undefined : this.#toolMeshes(passed.get(draft), request);
    const wantsBase = channel === 'preview' && (request as PreviewRequest).base === true;
    const baseResults = wantsBase ? this.#meshAll(base ?? new Map(), request, features) : undefined;
    this.#evict();
    return {
      status: 'done',
      features,
      bodies: results,
      reports,
      ...(tools && { tools }),
      ...(baseResults && { base: baseResults }),
      stats: {
        evaluated,
        reused,
        ms: performance.now() - start,
        liveShapes: this.#kernel.stats().liveShapes,
      },
    };
  }

  /** Meshes of bodies, left out where the caller `have`s their version. */
  #meshAll(
    bodies: ReadonlyMap<BodyId, ShapeHandle>,
    request: RecomputeRequest,
    features: Record<FeatureId, FeatureStatus>,
  ): BodyResult[] {
    const results: BodyResult[] = [];
    for (const [id, shape] of bodies) {
      const version = this.#versions.get(shape) ?? hashOf('shape', shape);
      if (request.have?.[id] === version) {
        results.push({ id, version });
        continue;
      }
      try {
        const mesh = this.#kernel.mesh(shape, request.tessellation ?? DEFAULT_TESSELLATION);
        const names = this.#names.get(shape);
        if (names) {
          mesh.faceIds = [...names.faces];
          mesh.edgeIds = [...names.edges];
          mesh.vertexIds = [...names.vertices];
        }
        results.push({ id, version, mesh });
      } catch (error) {
        if (!(error instanceof KernelError)) throw error;
        const maker = this.#makers.get(shape);
        if (maker) {
          features[maker] = {
            status: 'error',
            message: `Couldn't display a body this feature made: ${error.message}`,
          };
        }
      }
    }
    return results;
  }

  /**
   * The preview tools of a preview's draft, meshed. A tool that can't be
   * meshed is left out: the preview is a hint, the feature's status says
   * what went wrong with the feature itself.
   */
  #toolMeshes(state: Passed | undefined, request: RecomputeRequest): PreviewToolMesh[] | undefined {
    const tools = state?.state === 'done' ? state.entry.output?.previewTools : undefined;
    if (!tools?.length) return undefined;
    const out: PreviewToolMesh[] = [];
    for (const { shape, style } of tools) {
      try {
        out.push({
          mesh: this.#kernel.mesh(shape, request.tessellation ?? DEFAULT_TESSELLATION),
          style,
        });
      } catch (error) {
        if (!(error instanceof KernelError)) throw error;
      }
    }
    return out;
  }

  #evaluate(
    definition: KernelFeatureDefinition,
    feature: Feature,
    inputs: Feature['inputs'],
    values: Record<string, number>,
    bodies: ReadonlyMap<BodyId, ShapeHandle>,
    outputs: ReadonlyMap<FeatureId, FeatureOutput | undefined>,
    key: string,
  ): Entry {
    const kernel = this.#kernel;
    const warnings: string[] = [];
    // References it lost or guessed (ADR-0033), by kind and ID; a loss outranks a guess.
    const issues = new Map<string, ReferenceIssue>();
    const note = (ref: GeomRef, state: ReferenceIssue['state'], now?: GeomRef) => {
      const key = `${ref.kind} ${ref.id}`;
      if (issues.get(key)?.state === 'lost') return;
      issues.set(key, { ref: { kind: ref.kind, id: ref.id }, state, ...(now && { now }) });
    };
    const bodyNames = (id: BodyId): TopoNames => {
      const shape = bodies.get(id);
      const names = shape === undefined ? undefined : this.#names.get(shape);
      if (!names) throw new Error(`${feature.name} has no body ${id} before it.`);
      return names;
    };
    const describe = (shape: ShapeHandle) => this.#describe(shape);
    const ctx: EvalContext = {
      kernel,
      feature,
      inputs,
      bodies,
      names: bodyNames,
      describe,
      resolve(ref, options) {
        const named = [...bodies].map(([id, shape]) => ({ id, shape, names: bodyNames(id) }));
        let resolved: ReturnType<typeof resolveRef>;
        try {
          resolved = resolveRef(ref, named, describe, options);
        } catch (error) {
          if (error instanceof LostReferenceError) note(error.ref, 'lost');
          throw error;
        }
        if (resolved.warning) {
          warnings.push(resolved.warning);
          // What it took instead, as a reference that would resolve exactly ("Keep closest match").
          const now: GeomRef | undefined =
            resolved.id === ref.id
              ? undefined
              : {
                  kind: resolved.kind,
                  id: resolved.id,
                  fingerprint: fingerprintOf(
                    describe(resolved.shape),
                    bodyNames(resolved.body),
                    resolved.kind,
                    resolved.index,
                  ),
                };
          note(ref, 'guessed', now);
        }
        return resolved;
      },
      warn(message) {
        warnings.push(message);
      },
      value(input) {
        const value = values[input];
        if (value === undefined) throw new Error(`${feature.name} has no expression "${input}".`);
        return value;
      },
      output(id) {
        const output = outputs.get(id);
        if (!output) throw new Error(`${feature.name} doesn't refer to feature ${id}.`);
        return output;
      },
      bodyId: (n = 0) => `${feature.id}:${n}` as BodyId,
    };

    const before = kernel.stats().liveShapes;
    let output: FeatureOutput | undefined;
    let status: FeatureStatus;
    try {
      output = definition.evaluate(ctx);
      this.#checkNames(output, bodies);
      const all = [...new Set([...warnings, ...(output.warnings ?? [])])];
      status = all.length ? { status: 'warning', message: all.join(' ') } : { status: 'ok' };
    } catch (error) {
      // A WASM abort kills the kernel; the service turns it into a crash.
      if (error instanceof WebAssembly.RuntimeError) throw error;
      if (error instanceof LostReferenceError) note(error.ref, 'lost');
      if (!(error instanceof KernelError)) console.error(error);
      const message = error instanceof Error ? error.message : String(error);
      status = {
        status: 'error',
        message: error instanceof KernelError ? message : `Internal error: ${message}`,
      };
      output = undefined;
    }
    if (status.status !== 'ok' && issues.size > 0)
      status = { ...status, refs: [...issues.values()] };

    const handles = output ? outputHandles(output) : [];
    const fresh = handles.filter((h) => !this.#refs.has(h));
    const leaked = kernel.stats().liveShapes - before - fresh.length;
    if (leaked !== 0) {
      if (this.#options.strictLeaks) {
        throw new Error(`${feature.type} "${feature.name}" left ${leaked} shape(s) behind.`);
      }
      (this.#options.onLeak ?? warnLeak)(feature, leaked);
    }
    for (const h of handles) this.#refs.set(h, (this.#refs.get(h) ?? 0) + 1);
    for (const [id, h] of output?.bodies ?? []) {
      // A shape another output holds (a profile face as a sheet body) has
      // no table yet either.
      if (!this.#names.has(h)) {
        const names = output?.names?.get(id) ?? this.#positional(feature, h);
        if (names) this.#names.set(h, names);
      }
      if (!fresh.includes(h)) continue;
      this.#versions.set(h, hashOf(key, id));
      this.#makers.set(h, feature.id);
    }
    const entry: Entry = { key, status, output, handles };
    this.#entries.set(key, entry);
    return entry;
  }

  /** Names by position for a body its feature didn't name; none if OCCT can't describe it. */
  #positional(feature: Feature, shape: ShapeHandle): TopoNames | undefined {
    try {
      return positionalNames(feature.type, feature.id, this.#describe(shape));
    } catch (error) {
      if (!(error instanceof KernelError)) throw error;
      return undefined;
    }
  }

  /** A shape's description; kept while the cache holds the shape. */
  #describe(shape: ShapeHandle): ShapeDescription {
    const known = this.#descriptions.get(shape);
    if (known) return known;
    const description = this.#kernel.describe(shape);
    if (this.#refs.has(shape)) this.#descriptions.set(shape, description);
    return description;
  }

  /**
   * Checks that the naming tables an output gives match its bodies. A
   * mismatch is a bug in the evaluator; its new shapes are released and the
   * feature fails.
   */
  #checkNames(output: FeatureOutput, before: ReadonlyMap<BodyId, ShapeHandle>): void {
    for (const [id, names] of output.names ?? []) {
      const shape = output.bodies?.get(id);
      const problem =
        shape === undefined
          ? `names a body it doesn't output (${id})`
          : (['face', 'edge', 'vertex'] as const).find(
                (kind) => namesOf(names, kind).length !== this.#kernel.count(shape, kind),
              )
            ? `gives body ${id} a naming table that doesn't match its shape`
            : undefined;
      if (!problem) continue;
      const known = new Set([...before.values(), ...this.#refs.keys()]);
      for (const h of outputHandles(output)) if (!known.has(h)) this.#kernel.release(h);
      throw new Error(problem);
    }
  }

  /** Drops least recently used entries that no current result uses, down to `maxEntries`. */
  #evict(): void {
    const max = this.#options.maxEntries ?? 256;
    let excess = this.#entries.size - max;
    if (excess <= 0) return;
    for (const [key, entry] of this.#entries) {
      if (excess <= 0) break;
      if (this.#pinned.recompute.has(key) || this.#pinned.preview.has(key)) continue;
      if ([...this.#inFlight].some((keys) => keys.has(key))) continue;
      this.#entries.delete(key);
      this.#drop(entry);
      excess--;
    }
  }

  #drop(entry: Entry): void {
    for (const h of entry.handles) {
      const refs = (this.#refs.get(h) ?? 0) - 1;
      if (refs > 0) {
        this.#refs.set(h, refs);
        continue;
      }
      this.#refs.delete(h);
      this.#versions.delete(h);
      this.#makers.delete(h);
      this.#names.delete(h);
      this.#descriptions.delete(h);
      this.#kernel.release(h);
    }
  }
}

/** Every shape an output holds, once each: bodies, named shapes and preview tools. */
function outputHandles(output: FeatureOutput): ShapeHandle[] {
  return [
    ...new Set([
      ...(output.bodies?.values() ?? []),
      ...Object.values(output.shapes ?? {}),
      ...(output.previewTools ?? []).map((t) => t.shape),
    ]),
  ];
}

/** The values of a feature's `expr` inputs, or the first error as a message. */
function expressionValues(
  inputs: ReadonlyMap<string, EvaluateResult> | undefined,
): Record<string, number> | string {
  const values: Record<string, number> = {};
  for (const [name, result] of inputs ?? []) {
    if (!result.ok) return `${inputLabel(name)}: ${result.error.message}`;
    values[name] = result.value;
  }
  return values;
}

/**
 * Features this one refers to through `ref` inputs: references whose ID
 * starts with a feature's ID and a slash (a profile is `<sketch>/<region>`).
 * Faces and edges come from the body set instead.
 */
export function featureDependencies(
  feature: Feature,
  index: ReadonlyMap<FeatureId, number>,
): FeatureId[] {
  const found = new Set<FeatureId>();
  for (const input of Object.values(feature.inputs)) {
    if (input.kind !== 'ref') continue;
    for (const ref of input.refs) {
      const slash = ref.id.indexOf('/');
      const id = (slash > 0 ? ref.id.slice(0, slash) : ref.id) as FeatureId;
      if (id !== feature.id && (slash > 0 || index.has(id))) found.add(id);
    }
  }
  return [...found];
}

function dependencyProblem(
  dependencies: readonly FeatureId[],
  passed: ReadonlyMap<FeatureId, Passed>,
  index: ReadonlyMap<FeatureId, number>,
  doc: ExtrudoDocument,
  own: number | undefined,
): string | undefined {
  for (const id of dependencies) {
    const at = index.get(id);
    if (at === undefined) return 'Refers to a feature that no longer exists.';
    const name = doc.features[at]?.name ?? id;
    const state = passed.get(id);
    if (!state || (own !== undefined && at > own)) {
      return `Refers to ${name}, which comes later in the timeline.`;
    }
    if (state.state === 'suppressed') return `Needs ${name}, which is suppressed.`;
    if (state.state === 'failed') return `Needs ${name}, which has an error.`;
  }
  return undefined;
}

/** "extrude" → "Extrude", "sweep-path" → "Sweep path". */
function typeLabel(type: string): string {
  const words = type.replace(/[-_]+/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** "distance" → "Distance", "taperAngle" → "Taper angle". */
function inputLabel(name: string): string {
  const words = name.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function warnLeak(feature: Feature, shapes: number): void {
  console.warn(`[kernel] ${feature.type} "${feature.name}" left ${shapes} shape(s) behind.`);
}

/**
 * Lets queued messages run: a newer request arrives here and cancels this
 * one. A message channel instead of setTimeout, which browsers clamp to 4 ms
 * when nested.
 */
export function yieldToEvents(): Promise<void> {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      resolve();
    };
    channel.port2.postMessage(null);
  });
}
