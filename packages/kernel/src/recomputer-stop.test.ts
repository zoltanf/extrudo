// Stop while a design opens (ADR-0155), against a fake kernel the test drives:
// each recompute call waits until the test reports its features and finishes
// it, so the races (a Stop as the feature ends, twice, during the restart,
// while resources go out) can be put in order. A terminated worker never
// answers again, as a real one.
import {
  applyCommand,
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
import { type FontSource, Recomputer } from './recomputer';
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

  it('is offered only while opening: not during an update after an edit', async () => {
    const t = setup();
    await settle(t);
    expect(t.r.stops.get().opening).toBe(false);
    dispatch(t.store, renameFeature({ id: 'f1' as FeatureId, name: 'Renamed' }));
    const update = await t.call(2);
    update.report('f2' as FeatureId);
    await new Promise((r) => setTimeout(r, 10));
    expect(t.r.stops.get()).toMatchObject({ opening: false, stoppable: false });
    expect(await t.r.stop()).toBeUndefined();
    expect(t.workers).toHaveLength(1);
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
    expect(t.r.stops.get()).toMatchObject({ opening: false, stoppable: false });
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

  it('forgets it when the feature changes', async () => {
    const t = await stopped();
    dispatch(t.store, renameFeature({ id: 'f2' as FeatureId, name: 'Changed' }));
    await settle(t);
    expect(t.last().request.stopped).toEqual([]);
    expect(t.r.stops.get().stopped).toEqual([]);
  });

  it('forgets it when a feature before it changes', async () => {
    const t = await stopped();
    dispatch(t.store, renameFeature({ id: 'f1' as FeatureId, name: 'Earlier' }));
    await settle(t);
    expect(t.last().request.stopped).toEqual([]);
  });

  it('forgets it when the parameters change', async () => {
    const t = await stopped();
    t.store.setState((s) => ({ doc: { ...s.doc, parameters: [...s.doc.parameters] } }));
    await settle(t);
    expect(t.last().request.stopped).toEqual([]);
  });

  it('forgets it when it is suppressed, deleted or rolled past, and for good', async () => {
    let t = await stopped();
    dispatch(t.store, setFeatureSuppressed({ id: 'f2' as FeatureId, suppressed: true }));
    await settle(t);
    expect(t.r.isStopped('f2' as FeatureId)).toBe(false);
    t.store.getState().undo();
    await settle(t);
    expect(t.last().request.stopped).toEqual([]);

    t = await stopped();
    dispatch(t.store, removeFeature({ id: 'f2' as FeatureId }));
    await settle(t);
    expect(t.r.isStopped('f2' as FeatureId)).toBe(false);

    t = await stopped();
    dispatch(t.store, moveTimelineMarker({ index: 1 }));
    await settle(t);
    expect(t.r.isStopped('f2' as FeatureId)).toBe(false);
    dispatch(t.store, moveTimelineMarker({ index: 3 }));
    await settle(t);
    expect(t.last().request.stopped).toEqual([]);
  });

  it('keeps it out of a dialog preview, unless the dialog is its own', async () => {
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
    await t.r.preview(feature('f4'), 3);
    await t.r.preview(applyCommand(t.store.getState().doc, renameFeature({ id: 'f2' as FeatureId, name: 'Draft' })).doc.features[1] as Feature, 1);
    expect(seen[0]?.stopped).toEqual(['f2']);
    expect(seen[1]?.stopped).toBeUndefined();
  });
});
