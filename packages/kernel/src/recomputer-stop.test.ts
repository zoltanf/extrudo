// Stop while a design opens (ADR-0155), against a fake kernel the test drives:
// each recompute call waits until the test reports its features and finishes
// it, so the races (a Stop as the feature ends, twice, during the restart,
// while resources go out) can be put in order. A terminated worker never
// answers again, as a real one.
import {
  type Command,
  createDocument,
  createDocumentStore,
  createModelStore,
  type DocumentStore,
  type ExtrudoDocument,
  type Feature,
  type FeatureId,
  type FeatureStatus,
  moveTimelineMarker,
  removeFeature,
  renameFeature,
  setFeatureSuppressed,
} from '@extrudo/core';
import { afterEach, describe, expect, it } from 'vitest';
import type { KernelConnection } from './client';
import type { BodyMesh } from './mesh';
import {
  type ProgressListener,
  type RecomputeRequest,
  type RecomputeResult,
  STOPPED_MESSAGE,
} from './recompute/types';
import { type FontSource, LONG_FEATURE_MS, Recomputer } from './recomputer';
import { type KernelApi, KernelCrashError } from './service';

const until = async (condition: () => boolean, ms = 10_000) => {
  const end = Date.now() + ms;
  while (!condition()) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 2));
  }
};

const CRASH_MESSAGE = 'The kernel stopped while computing this feature. Change it to try again.';

/** One recompute call as the fake kernel holds it. */
interface Call {
  request: RecomputeRequest;
  worker: number;
  /** Reports a feature as started (or `undefined`: past the features). */
  report(id: FeatureId | undefined): void;
  /** Answers with every active feature ok, the stopped and crashed ones failed. */
  finish(): void;
  /** Rejects as a crash of the kernel inside this call. */
  crash(): void;
}

interface Worker {
  id: number;
  terminated: boolean;
  fatal?: (error: Error) => void;
}

function resultOf(request: RecomputeRequest): RecomputeResult {
  const features: Record<FeatureId, FeatureStatus> = {};
  const { doc } = request;
  for (const f of doc.features.slice(0, doc.timelineMarker)) {
    if (f.suppressed) continue;
    if (request.stopped?.includes(f.id)) {
      features[f.id] = { status: 'error', message: STOPPED_MESSAGE };
    } else if (request.crashed?.includes(f.id)) {
      features[f.id] = { status: 'error', message: CRASH_MESSAGE };
    } else features[f.id] = { status: 'ok' };
  }
  return {
    status: 'done',
    features,
    bodies: [],
    origins: {},
    reports: {},
    stats: { evaluated: [], reused: 0, ms: 1, liveShapes: 0 },
  };
}

const feature = (id: string, name = id): Feature =>
  ({ id: id as FeatureId, type: 'box', name, suppressed: false, inputs: {} }) as Feature;

function threeFeatures(): ExtrudoDocument {
  const doc = createDocument({ name: 'Stops' });
  return { ...doc, features: [feature('f1'), feature('f2'), feature('f3')], timelineMarker: 3 };
}

let live: Recomputer[] = [];
afterEach(() => {
  for (const r of live) r.dispose();
  live = [];
});

/** The recomputer's clock in these tests: moved by hand, never read from the machine. */
const clock = { now: 1_000_000 };

function setup(doc: ExtrudoDocument = threeFeatures(), options: { fonts?: FontSource } = {}) {
  const calls: Call[] = [];
  const workers: Worker[] = [];
  const spawn = (): KernelConnection => {
    const worker: Worker = { id: workers.length + 1, terminated: false };
    workers.push(worker);
    const never = new Promise<never>(() => {});
    const api = {
      init: async () => (worker.terminated ? never : { version: 'fake' }),
      addFont: async () => {},
      recompute: (request: RecomputeRequest, onFeature?: ProgressListener) =>
        new Promise<RecomputeResult>((resolve, reject) => {
          calls.push({
            request,
            worker: worker.id,
            report: (id) => {
              if (!worker.terminated) onFeature?.(id);
            },
            finish: () => {
              if (!worker.terminated) resolve(resultOf(request));
            },
            crash: () => {
              if (!worker.terminated) reject(new KernelCrashError('memory access out of bounds'));
            },
          });
        }),
      preview: (request: RecomputeRequest) => Promise.resolve(resultOf(request)),
      inspect: () => new Promise(() => {}),
      endPreview: async () => {},
    } as unknown as KernelApi;
    return {
      api,
      terminate: () => {
        worker.terminated = true;
      },
      onFatal: (listener) => {
        worker.fatal = listener;
      },
    };
  };
  const store = createDocumentStore(doc);
  const model = createModelStore<BodyMesh>();
  const r = new Recomputer({
    spawn,
    document: store,
    model,
    delayMs: 1,
    heapRecycleBytes: 0,
    longFeatureMs: LONG_FEATURE_MS,
    now: () => clock.now,
    ...(options.fonts && { fonts: options.fonts }),
  });
  live.push(r);
  r.start();
  /** The newest call. */
  const last = () => calls[calls.length - 1] as Call;
  /** Waits for call number `n` (1-based). */
  const call = async (n: number) => {
    await until(() => calls.length >= n);
    return calls[n - 1] as Call;
  };
  const ready = () => model.getState().status === 'ready';
  return { r, store, model, calls, workers, last, call, ready };
}

/** Finishes calls as they come until the model is ready for the current document. */
async function settle(t: ReturnType<typeof setup>) {
  await until(() => {
    const c = t.last();
    if (c && !t.workers[c.worker - 1]?.terminated) c.finish();
    return t.ready() && t.model.getState().doc === t.store.getState().doc;
  });
}

const status = (t: ReturnType<typeof setup>, id: string) =>
  t.model.getState().features[id as FeatureId];

// biome-ignore lint/suspicious/noExplicitAny: any command
function dispatch(store: DocumentStore, command: Command<any>) {
  store.getState().dispatch(command as Command<unknown>);
}

describe('Stop while a design opens (ADR-0155)', () => {
  it('ends the running call by replacing the worker and computes without that feature', async () => {
    const t = setup();
    const doc = t.store.getState().doc;
    const first = await t.call(1);
    first.report('f1' as FeatureId);
    first.report('f2' as FeatureId);
    await until(() => t.r.stops.get().stoppable);
    expect(t.r.stops.get()).toMatchObject({ opening: true, stoppable: true, stopping: false });

    const stopped = t.r.stop();
    expect(t.r.stops.get().stopping).toBe(true);
    expect(await stopped).toBe('f2');
    expect(t.workers[0]?.terminated).toBe(true);
    expect(t.workers).toHaveLength(2);

    const second = await t.call(2);
    expect(second.worker).toBe(2);
    expect(second.request.stopped).toEqual(['f2']);
    // Not a crash: nothing blamed, nothing counted.
    expect(second.request.crashed).toEqual([]);
    expect(t.r.client.restarts).toBe(0);
    second.finish();
    await until(t.ready);
    expect(status(t, 'f2')).toEqual({ status: 'error', message: STOPPED_MESSAGE });
    expect(status(t, 'f1')?.status).toBe('ok');
    expect(status(t, 'f3')?.status).toBe('ok');
    expect(t.r.isStopped('f2' as FeatureId)).toBe(true);
    expect(t.r.stops.get()).toMatchObject({ stopped: ['f2'], opening: false, stoppable: false });
    // The document is untouched: same object, no undo step.
    expect(t.store.getState().doc).toBe(doc);
    expect(t.store.getState().canUndo).toBe(false);
  });

  it('stops the first feature and the last one', async () => {
    const t = setup();
    (await t.call(1)).report('f1' as FeatureId);
    await until(() => t.r.stops.get().stoppable);
    expect(await t.r.stop()).toBe('f1');
    const second = await t.call(2);
    expect(second.request.stopped).toEqual(['f1']);
    second.report('f2' as FeatureId);
    second.report('f3' as FeatureId);
    await until(() => t.r.stops.get().stoppable);
    expect(await t.r.stop()).toBe('f3');
    const third = await t.call(3);
    expect(third.request.stopped).toEqual(['f1', 'f3']);
    third.finish();
    await until(t.ready);
    expect(status(t, 'f1')?.message).toBe(STOPPED_MESSAGE);
    expect(status(t, 'f3')?.message).toBe(STOPPED_MESSAGE);
    expect(status(t, 'f2')?.status).toBe('ok');
  });

  it('never counts a stop as a crash: five in a row keep the kernel alive', async () => {
    const t = setup();
    for (let n = 1; n <= 5; n++) {
      const c = await t.call(n);
      c.report('f2' as FeatureId);
      await until(() => t.r.stops.get().stoppable);
      expect(await t.r.stop()).toBe('f2');
      await t.call(n + 1);
      // Try again, so the next call computes f2 once more.
      if (n < 5) expect(t.r.retry('f2' as FeatureId)).toBe(true);
      // The retry's send supersedes the call the restart made.
      if (n < 5) await until(() => t.calls.length >= n + 2);
      if (n < 5) t.calls.splice(n, 1);
    }
    expect(t.r.client.status).toBe('ready');
    expect(t.r.client.restarts).toBe(0);
  });

  it('handles a real crash during Try again as a crash', async () => {
    const t = setup();
    (await t.call(1)).report('f2' as FeatureId);
    await until(() => t.r.stops.get().stoppable);
    await t.r.stop();
    (await t.call(2)).finish();
    await until(t.ready);
    expect(t.r.retry('f2' as FeatureId)).toBe(true);
    expect(t.r.stops.get().opening).toBe(true);
    const retry = await t.call(3);
    expect(retry.request.stopped).toEqual([]);
    retry.report('f2' as FeatureId);
    retry.crash();
    const after = await t.call(4);
    expect(after.request.crashed).toEqual(['f2']);
    expect(after.request.stopped).toEqual([]);
    after.finish();
    await until(t.ready);
    expect(status(t, 'f2')?.message).toBe(CRASH_MESSAGE);
    expect(t.r.client.restarts).toBe(1);
  });

  it('ignores a second Stop while the first is under way, and a Stop during the restart', async () => {
    const t = setup();
    (await t.call(1)).report('f2' as FeatureId);
    await until(() => t.r.stops.get().stoppable);
    const one = t.r.stop();
    const two = t.r.stop();
    expect(await two).toBeUndefined();
    expect(await one).toBe('f2');
    expect(t.workers).toHaveLength(2);
    // Before the new worker's call reports a feature there is nothing to stop.
    expect(await t.r.stop()).toBeUndefined();
    expect(t.workers).toHaveLength(2);
  });

  it('stops nothing when the feature finished before the worker could be ended', async () => {
    // Another feature started.
    let t = setup();
    let c = await t.call(1);
    c.report('f2' as FeatureId);
    await until(() => t.r.stops.get().stoppable);
    let stop = t.r.stop();
    c.report('f3' as FeatureId);
    expect(await stop).toBeUndefined();
    expect(t.workers[0]?.terminated).toBe(false);
    expect(t.r.isStopped('f2' as FeatureId)).toBe(false);
    c.finish();
    await until(t.ready);
    expect(status(t, 'f2')?.status).toBe('ok');

    // The walk got past its features (meshing).
    t = setup();
    c = await t.call(1);
    c.report('f3' as FeatureId);
    await until(() => t.r.stops.get().stoppable);
    stop = t.r.stop();
    c.report(undefined);
    expect(await stop).toBeUndefined();
    expect(t.r.stops.get().stoppable).toBe(false);

    // The result came.
    t = setup();
    c = await t.call(1);
    c.report('f3' as FeatureId);
    await until(() => t.r.stops.get().stoppable);
    stop = t.r.stop();
    c.finish();
    expect(await stop).toBeUndefined();
    await until(t.ready);
    expect(t.workers).toHaveLength(1);
    expect(status(t, 'f3')?.status).toBe('ok');
  });

  it('has nothing to stop while the fonts are still going out', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const t = setup(threeFeatures(), {
      fonts: {
        used: () => ['font-1'],
        bytes: async () => {
          await gate;
          return new ArrayBuffer(4);
        },
      },
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(t.r.stops.get()).toMatchObject({ opening: true, stoppable: false });
    expect(await t.r.stop()).toBeUndefined();
    // No worker was replaced (none may have started yet: the font call comes first).
    expect(t.workers.filter((w) => w.terminated)).toHaveLength(0);
    expect(t.workers.length).toBeLessThanOrEqual(1);
    release();
    (await t.call(1)).finish();
    await until(t.ready);
  });

  it('leaves nothing behind when the design closes right after a Stop', async () => {
    const t = setup();
    (await t.call(1)).report('f2' as FeatureId);
    await until(() => t.r.stops.get().stoppable);
    const stop = t.r.stop();
    // The next design opens at once: this one is disposed of mid-Stop.
    await new Promise((r) => setTimeout(r, 0));
    t.r.dispose();
    await stop;
    await new Promise((r) => setTimeout(r, 30));
    expect(t.calls).toHaveLength(1);
    expect(t.model.getState().status).toBe('computing');
    expect(t.r.isStopped('f2' as FeatureId)).toBe(false);

    const next = setup();
    (await next.call(1)).finish();
    await until(next.ready);
    expect(next.model.getState().doc).toBe(next.store.getState().doc);
    expect(next.calls[0]?.request.stopped).toEqual([]);
    // The old design's model was never written after its disposal.
    expect(t.model.getState().status).toBe('computing');
  });

  it('during an update after an edit, allows Stop only once the feature has taken long (ADR-0161)', async () => {
    const t = setup();
    await settle(t);
    expect(t.r.stops.get().opening).toBe(false);
    dispatch(t.store, renameFeature({ id: 'f1' as FeatureId, name: 'Renamed' }));
    const update = await t.call(2);
    update.report('f2' as FeatureId);
    await until(() => t.r.stops.get().stoppable);
    // A feature is running, so the notice may offer Stop once it has taken long; not yet.
    expect(t.r.stops.get()).toMatchObject({ opening: false, stoppable: true });
    clock.now += LONG_FEATURE_MS - 1;
    expect(await t.r.stop()).toBeUndefined();
    expect(t.workers).toHaveLength(1);
    clock.now += 1;
    expect(await t.r.stop()).toBe('f2');
    expect(t.workers).toHaveLength(2);
    // The rebuild belongs to the update: not "opening" again, so Cancel still applies.
    expect(t.r.stops.get().opening).toBe(false);
    const rebuild = await t.call(3);
    expect(rebuild.request.stopped).toEqual(['f2']);
    expect(rebuild.request.doc.features[0]?.name).toBe('Renamed');
    rebuild.finish();
    await until(t.ready);
    expect(status(t, 'f2')?.message).toBe(STOPPED_MESSAGE);
    expect(status(t, 'f2')?.message).toBe(
      'Stopped: this feature took too long. Try again to build it.',
    );
    // The edit is kept in the document and the history; Stop added no step.
    expect(t.store.getState().doc.features[0]?.name).toBe('Renamed');
    expect(t.r.canRevertToShown()).toBe(false);
    t.store.getState().undo();
    await settle(t);
    expect(t.store.getState().doc.features[0]?.name).toBe('f1');
  });

  it('counts the long rule from the running feature’s start, not from the update', async () => {
    const t = setup();
    await settle(t);
    dispatch(t.store, renameFeature({ id: 'f1' as FeatureId, name: 'Renamed' }));
    const update = await t.call(2);
    update.report('f1' as FeatureId);
    await until(() => t.r.stops.get().stoppable);
    clock.now += LONG_FEATURE_MS - 10;
    update.report('f2' as FeatureId);
    await until(() => t.model.getState().progress?.feature === 'f2');
    clock.now += 20;
    // f2 has run 20 ms: not long, though the update has run 30 s.
    expect(await t.r.stop()).toBeUndefined();
    clock.now += LONG_FEATURE_MS;
    expect(await t.r.stop()).toBe('f2');
  });

  it('Try again computes the feature with Stop offered again; an edit meanwhile ends that', async () => {
    const t = setup();
    (await t.call(1)).report('f2' as FeatureId);
    await until(() => t.r.stops.get().stoppable);
    await t.r.stop();
    (await t.call(2)).finish();
    await until(t.ready);
    expect(t.r.retry('f3' as FeatureId)).toBe(false);
    expect(t.r.retry('f2' as FeatureId)).toBe(true);
    const retry = await t.call(3);
    retry.report('f2' as FeatureId);
    await until(() => t.r.stops.get().stoppable);
    expect(t.r.stops.get().opening).toBe(true);
    // An edit during the Try again makes it an update: Cancel's, not Stop's.
    dispatch(t.store, renameFeature({ id: 'f3' as FeatureId, name: 'Edited' }));
    const edit = await t.call(4);
    edit.report('f2' as FeatureId);
    await new Promise((r) => setTimeout(r, 10));
    // An update now: Stop waits for the long rule.
    expect(t.r.stops.get()).toMatchObject({ opening: false, stoppable: true });
    expect(await t.r.stop()).toBeUndefined();
  });
});

describe("the model's last step (ADR-0155's amendment of 2026-11-19)", () => {
  it('reports "building" past the last feature, with nothing to stop', async () => {
    const t = setup();
    const c = await t.call(1);
    c.report('f3' as FeatureId);
    await until(() => t.model.getState().progress?.feature === 'f3');
    const since = t.model.getState().progress?.since;
    c.report(undefined);
    await until(() => t.model.getState().progress?.building === true);
    expect(t.model.getState().progress).toEqual({
      done: 2,
      total: 3,
      feature: 'f3',
      since,
      building: true,
    });
    expect(t.r.stops.get().stoppable).toBe(false);
    c.finish();
    await until(t.ready);
    expect(t.model.getState().progress).toBeUndefined();
  });

  it('says nothing about building when no feature was computed (all from the cache)', async () => {
    const t = setup();
    const c = await t.call(1);
    c.report(undefined);
    await new Promise((r) => setTimeout(r, 30));
    expect(t.model.getState().progress).toBeUndefined();
  });
});

describe('forgetting a stop (ADR-0155)', () => {
  async function stopped() {
    const t = setup();
    (await t.call(1)).report('f2' as FeatureId);
    await until(() => t.r.stops.get().stoppable);
    await t.r.stop();
    await settle(t);
    expect(t.r.isStopped('f2' as FeatureId)).toBe(true);
    return t;
  }

  it('keeps it when a later feature changes', async () => {
    const t = await stopped();
    dispatch(t.store, renameFeature({ id: 'f3' as FeatureId, name: 'Later' }));
    await settle(t);
    expect(t.last().request.stopped).toEqual(['f2']);
  });

  it('leaves it out while the feature differs, and brings it back with the same values (amendment of 2026-11-23)', async () => {
    const t = await stopped();
    dispatch(t.store, renameFeature({ id: 'f2' as FeatureId, name: 'Changed' }));
    await settle(t);
    expect(t.last().request.stopped).toEqual([]);
    expect(t.r.stops.get().stopped).toEqual([]);
    expect(t.r.isStopped('f2' as FeatureId)).toBe(false);
    // Undo builds new objects with the old values: the stop applies again.
    t.store.getState().undo();
    await settle(t);
    expect(t.last().request.stopped).toEqual(['f2']);
    expect(t.r.isStopped('f2' as FeatureId)).toBe(true);
  });

  it('leaves it out while a feature before it differs; a Cancel back brings it back (review probe A)', async () => {
    const t = await stopped();
    dispatch(t.store, renameFeature({ id: 'f1' as FeatureId, name: 'Earlier' }));
    const update = await t.call(t.calls.length + 1);
    expect(update.request.stopped).toEqual([]);
    // Cancel: back to the step the shown model was computed at.
    expect(t.r.canRevertToShown()).toBe(true);
    expect(t.r.revertToShown()).toBe(true);
    await settle(t);
    expect(t.last().request.stopped).toEqual(['f2']);
    expect(status(t, 'f2')?.message).toBe(STOPPED_MESSAGE);
  });

  it('leaves it out when the parameters change, and back with the same values', async () => {
    const t = await stopped();
    t.store.setState((s) => ({
      doc: { ...s.doc, parameters: [{ name: 'w', expr: '1 mm' } as never] },
    }));
    await settle(t);
    expect(t.last().request.stopped).toEqual([]);
    t.store.setState((s) => ({ doc: { ...s.doc, parameters: [] } }));
    await settle(t);
    expect(t.last().request.stopped).toEqual(['f2']);
  });

  it('leaves it out while suppressed, deleted or rolled past; undo or rolling forward brings it back', async () => {
    let t = await stopped();
    dispatch(t.store, setFeatureSuppressed({ id: 'f2' as FeatureId, suppressed: true }));
    await settle(t);
    expect(t.r.isStopped('f2' as FeatureId)).toBe(false);
    t.store.getState().undo();
    await settle(t);
    expect(t.last().request.stopped).toEqual(['f2']);

    t = await stopped();
    dispatch(t.store, removeFeature({ id: 'f2' as FeatureId }));
    await settle(t);
    expect(t.r.isStopped('f2' as FeatureId)).toBe(false);
    t.store.getState().undo();
    await settle(t);
    expect(t.r.isStopped('f2' as FeatureId)).toBe(true);

    t = await stopped();
    dispatch(t.store, moveTimelineMarker({ index: 1 }));
    await settle(t);
    expect(t.r.isStopped('f2' as FeatureId)).toBe(false);
    dispatch(t.store, moveTimelineMarker({ index: 3 }));
    await settle(t);
    expect(t.last().request.stopped).toEqual(['f2']);
  });

  it('forgets it for good on Try again, even when the values come back', async () => {
    const t = await stopped();
    expect(t.r.retry('f2' as FeatureId)).toBe(true);
    await settle(t);
    dispatch(t.store, renameFeature({ id: 'f2' as FeatureId, name: 'Changed' }));
    await settle(t);
    t.store.getState().undo();
    await settle(t);
    expect(t.last().request.stopped).toEqual([]);
    // Try again applies only to a stop that applies now.
    expect(t.r.retry('f2' as FeatureId)).toBe(false);
  });

  it('checks a stop by value only when the objects changed (the fast path reads no inputs)', async () => {
    // f1's inputs count their reads: the value key reads every feature before the stop.
    let reads = 0;
    const f1 = feature('f1');
    const inputs = f1.inputs;
    Object.defineProperty(f1, 'inputs', {
      enumerable: true,
      get: () => {
        reads++;
        return inputs;
      },
    });
    const doc = threeFeatures();
    const t = setup({ ...doc, features: [f1, ...doc.features.slice(1)] });
    (await t.call(1)).report('f2' as FeatureId);
    await until(() => t.r.stops.get().stoppable);
    await t.r.stop();
    await settle(t);
    reads = 0;
    // A later feature changed: f2 and f1 are the same objects, so no key is computed.
    dispatch(t.store, renameFeature({ id: 'f3' as FeatureId, name: 'Later' }));
    await settle(t);
    expect(t.last().request.stopped).toEqual(['f2']);
    expect(reads).toBe(0);
  });

  it('keeps it out of a dialog preview, and out of its own dialog until a value changes', async () => {
    const t = await stopped();
    const seen: RecomputeRequest[] = [];
    const api = t.r.client;
    const original = api.call.bind(api);
    (api as { call: typeof api.call }).call = (task) =>
      original((k) => {
        const preview = k.preview.bind(k);
        return task({
          ...k,
          preview: (request) => {
            seen.push(request);
            return preview(request);
          },
        } as KernelApi);
      });
    const f2 = t.store.getState().doc.features[1] as Feature;
    await t.r.preview(feature('f4'), 3);
    // Edit Feature on it: the same values, rebuilt as new objects in another key order.
    const same = {
      ...f2,
      name: 'Draft',
      inputs: { ...f2.inputs, size: undefined },
    } as unknown as Feature;
    await t.r.preview(same, 1);
    // A value changed: its own dialog builds it.
    const changed = {
      ...f2,
      inputs: { ...f2.inputs, count: { kind: 'expr', expr: '3' } },
    } as Feature;
    await t.r.preview(changed, 1);
    expect(seen[0]?.stopped).toEqual(['f2']);
    expect(seen[1]?.stopped).toEqual(['f2']);
    expect(seen[2]?.stopped).toBeUndefined();
    // Previews never forget the stop.
    expect(t.r.isStopped('f2' as FeatureId)).toBe(true);
  });
});

describe('Stop after a document change while the old call still runs (ADR-0155, review finding 1)', () => {
  /** Opening with f2 running, then a change the store sends while the worker is still on f2. */
  async function changedWhileRunning(change: (store: DocumentStore) => void) {
    const t = setup();
    (await t.call(1)).report('f2' as FeatureId);
    await until(() => t.r.stops.get().stoppable);
    change(t.store);
    // The change's call is with the kernel and has reported nothing: the worker is still on f2.
    await t.call(2);
    return t;
  }

  it('keeps Stop offered, and records the edited feature in its new version', async () => {
    const t = await changedWhileRunning((store) =>
      dispatch(store, renameFeature({ id: 'f2' as FeatureId, name: 'Edited' })),
    );
    expect(t.r.stops.get()).toMatchObject({ opening: true, stoppable: true });
    expect(await t.r.stop()).toBe('f2');
    const third = await t.call(3);
    expect(third.request.stopped).toEqual(['f2']);
    expect(third.request.doc.features[1]?.name).toBe('Edited');
    third.finish();
    await until(t.ready);
    expect(status(t, 'f2')?.message).toBe(STOPPED_MESSAGE);
  });

  for (const [what, change] of [
    ['rolled past', (store: DocumentStore) => dispatch(store, moveTimelineMarker({ index: 1 }))],
    [
      'suppressed',
      (store: DocumentStore) =>
        dispatch(store, setFeatureSuppressed({ id: 'f2' as FeatureId, suppressed: true })),
    ],
    [
      'deleted',
      (store: DocumentStore) => dispatch(store, removeFeature({ id: 'f2' as FeatureId })),
    ],
  ] as const) {
    it(`ends the old call when the running feature was ${what}, and records nothing`, async () => {
      const t = await changedWhileRunning(change);
      expect(t.r.stops.get().stoppable).toBe(true);
      // Nothing recorded, so no "was stopped" toast: the app tells only of a recorded stop.
      expect(await t.r.stop()).toBeUndefined();
      expect(t.workers[0]?.terminated).toBe(true);
      expect(t.r.isStopped('f2' as FeatureId)).toBe(false);
      const third = await t.call(3);
      expect(third.worker).toBe(2);
      expect(third.request.stopped).toEqual([]);
      third.finish();
      await until(t.ready);
      expect(t.r.client.restarts).toBe(0);
    });
  }

  it('stops nothing once the old call came back', async () => {
    const t = await changedWhileRunning((store) =>
      dispatch(store, renameFeature({ id: 'f3' as FeatureId, name: 'Later' })),
    );
    // The old call ends (cancelled by the newer send) before the click.
    t.calls[0]?.finish();
    await until(() => !t.r.stops.get().stoppable);
    expect(await t.r.stop()).toBeUndefined();
    expect(t.workers).toHaveLength(1);
  });

  it('does not swallow a Stop when a send starts during its first turn (review finding 7)', async () => {
    const t = setup();
    (await t.call(1)).report('f2' as FeatureId);
    await until(() => t.r.stops.get().stoppable);
    // An edit whose send fires before Stop's turn ends.
    dispatch(t.store, renameFeature({ id: 'f3' as FeatureId, name: 'Later' }));
    expect(await t.r.stop()).toBe('f2');
    expect(t.workers[0]?.terminated).toBe(true);
  });

  it('Try Again during the restart: the stop is gone when it ends (review finding 3)', async () => {
    const t = setup();
    (await t.call(1)).report('f2' as FeatureId);
    await until(() => t.r.stops.get().stoppable);
    // Try Again lands while the new worker starts.
    const client = t.r.client as { restart(): Promise<void> };
    const restart = client.restart.bind(client);
    let retried: boolean | undefined;
    client.restart = async () => {
      const started = restart();
      retried = t.r.retry('f2' as FeatureId);
      await started;
    };
    const stop = t.r.stop();
    await until(() => retried !== undefined);
    expect(retried).toBe(true);
    // Nothing to tell: `stop()` says so, and `stopAndTell` checks `isStopped` too.
    expect(await stop).toBeUndefined();
    expect(t.r.isStopped('f2' as FeatureId)).toBe(false);
  });
});

describe('Stop while Cancel waits (ADR-0161)', () => {
  /** A model on screen, an edit of f1, its update on f2, then Cancel while f2 runs. */
  async function cancelledWhileRunning() {
    const t = setup();
    await settle(t);
    dispatch(t.store, renameFeature({ id: 'f1' as FeatureId, name: 'Renamed' }));
    const update = await t.call(2);
    update.report('f2' as FeatureId);
    await until(() => t.r.stops.get().stoppable);
    expect(t.r.stops.get().cancelling).toBe(false);
    expect(t.r.revertToShown()).toBe(true);
    // The document is back at once; the kernel is still on the edited document's f2.
    expect(t.store.getState().doc.features[0]?.name).toBe('f1');
    expect(t.r.stops.get()).toMatchObject({ cancelling: true, stoppable: true });
    // Cancel's own request is with the kernel, behind f2.
    const reverted = await t.call(3);
    expect(reverted.request.doc.features[0]?.name).toBe('f1');
    return t;
  }

  it('offers Stop at once; it replaces the worker and marks nothing as stopped', async () => {
    const t = await cancelledWhileRunning();
    // No long time has passed: the waiting Cancel alone allows Stop.
    expect(await t.r.stop()).toBeUndefined();
    expect(t.workers).toHaveLength(2);
    expect(t.workers[0]?.terminated).toBe(true);
    expect(t.r.isStopped('f2' as FeatureId)).toBe(false);
    expect(t.r.stops.get()).toMatchObject({ stopped: [], cancelling: false, opening: false });
    // The new worker computes the document Cancel went back to, with nothing skipped.
    const rebuild = await t.call(4);
    expect(rebuild.worker).toBe(2);
    expect(rebuild.request.stopped).toEqual([]);
    expect(rebuild.request.doc.features[0]?.name).toBe('f1');
    rebuild.finish();
    await until(t.ready);
    expect(status(t, 'f2')?.status).toBe('ok');
    expect(t.r.client.restarts).toBe(0);
    // Cancel's step stays: Redo brings the edit back.
    expect(t.store.getState().canRedo).toBe(true);
  });

  it('marks nothing even when the feature has also run long', async () => {
    const t = await cancelledWhileRunning();
    clock.now += LONG_FEATURE_MS;
    expect(await t.r.stop()).toBeUndefined();
    expect(t.r.stops.get().stopped).toEqual([]);
    expect((await t.call(4)).request.stopped).toEqual([]);
  });

  it('ends when the running call comes back: then Stop is the long rule’s again', async () => {
    const t = await cancelledWhileRunning();
    t.calls[1]?.finish();
    await until(() => !t.r.stops.get().cancelling);
    expect(await t.r.stop()).toBeUndefined();
    expect(t.workers).toHaveLength(1);
  });

  it('ends when the document changes again', async () => {
    const t = await cancelledWhileRunning();
    dispatch(t.store, renameFeature({ id: 'f3' as FeatureId, name: 'Later' }));
    await until(() => !t.r.stops.get().cancelling);
    // f2 still runs, but has not taken long: no Stop.
    expect(await t.r.stop()).toBeUndefined();
    expect(t.workers).toHaveLength(1);
  });

  it('is not entered when no feature is running', async () => {
    const t = setup();
    await settle(t);
    dispatch(t.store, renameFeature({ id: 'f1' as FeatureId, name: 'Renamed' }));
    await t.call(2);
    expect(t.r.revertToShown()).toBe(true);
    expect(t.r.stops.get().cancelling).toBe(false);
  });
});
