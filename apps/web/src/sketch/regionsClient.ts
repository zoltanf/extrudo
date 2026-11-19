/**
 * The profile worker's client (ADR-0154): the regions and fills of sketches
 * that aren't open are found in a worker, one sketch at a time, and come back
 * as flat arrays kept by the exact sketch data object (and the fonts' version
 * for a sketch with text). The shell asks for what it shows (`want`), in
 * timeline order; a hovered sketch (`prefer`) and a newly shown one go first.
 * A job that is no longer wanted is dropped, a late answer ignored, a job past
 * the deadline stopped (the worker is terminated and a new one started), and
 * when no worker can start or it keeps dying, the jobs run on the UI thread in
 * idle slices, within the work limits.
 */
import type { SketchData } from '@extrudo/core';
import { MAX_DESIGN_FILL_WORK, MAX_FILL_WORK } from '@extrudo/sketch/profiles';
import { createStore, type StoreApi } from 'zustand/vanilla';
import { fillWork, type ProfileFill, type RegionVerdict } from '../viewport/profileFills';
import { type FlatRegions, fromWire, regionIndex } from './flatRegions';
import { hasText, logProfileWork } from './profiles';
import { buildFill, FILL_BYTES_PER_VERTEX, fillBytes, findRegions } from './regionsJob';

export { FILL_BYTES_PER_VERTEX };

import type { RegionsReply, RegionsRequest } from './regionsProtocol';

declare global {
  interface Window {
    /** A shorter deadline for the profile worker, set by e2e tests before the app loads. */
    __extrudoProfilesDeadline?: number;
    /** A delay before each answer of the profile worker: e2e tests only. */
    __extrudoProfilesDelay?: number;
    /** No profile worker: the UI thread finds the profiles, e2e tests only. */
    __extrudoNoProfilesWorker?: boolean;
  }
}

/**
 * How long the worker may take for one sketch before it is stopped and the
 * sketch goes without shading or picking (ADR-0154). The slowest sketch of the
 * repository's designs takes a few milliseconds; a plate with 1,000 round holes
 * of 5 mm about 4 s on the machine it was measured on.
 */
export const PROFILES_DEADLINE_MS = 10_000;

/**
 * Results that arrive within this long reach the shell together: each time it hears of
 * one it lays out every shown sketch again, so a design of many quick sketches would
 * otherwise do that once a sketch.
 */
export const RESULT_BATCH_MS = 150;

/** How long a new worker may take to start before its first job counts as stopped. */
const START_MS = 20_000;

/** A job that is no longer wanted keeps running this long before the worker is restarted. */
const DROP_AFTER_MS = 250;

/** What results of sketches no longer shown are kept for an undo, at most: bytes, and how many. */
const SPARE_BYTES = 64 * 1024 * 1024;
const MAX_SPARE = 64;

/** Deaths (not deadlines) after which the worker is given up for idle slices. */
const MAX_DEATHS = 3;

export interface RegionsEntry {
  /**
   * done: found (its fill may have been stopped at the deadline: `fillable` false);
   * refused: detection refused; stopped: past the deadline before its regions were
   * found; failed: the worker died on it.
   */
  state: 'done' | 'refused' | 'stopped' | 'failed';
  /** The fonts' version it was found with; only a sketch with text depends on it. */
  version: number;
  text: boolean;
  regions?: FlatRegions;
  fill?: ProfileFill;
  /** What its regions keep, kept or not. */
  regionBytes: number;
  /** What its fill keeps (`FILL_BYTES_PER_VERTEX` a vertex), built or not. */
  fillBytes: number;
  /** Whether a fill can be had: false when it was too large or failed to build. */
  fillable: boolean;
}

export interface RegionsJob {
  /** The sketch feature, for `prefer`. */
  key: string;
  data: SketchData;
  version: number;
  /** The sketch has text: its result depends on the fonts. */
  text: boolean;
  /** What the budget has left for it, bytes: arrays that don't fit aren't sent or built. */
  allowance?: number;
}

/** What the client needs of a `Worker` (a fake one in tests). */
export interface RegionsWorkerLike {
  postMessage(message: RegionsRequest, transfer?: Transferable[]): void;
  terminate(): void;
  onmessage: ((event: MessageEvent<RegionsReply>) => void) | null;
  onerror: ((event: ErrorEvent | Event) => void) | null;
}

export interface RegionsProgress {
  /** When the first job of the current run began in the worker; unset until then. */
  since?: number;
  done: number;
  total: number;
}

export interface RegionsState {
  /** Bumped with every result the shell should read. */
  version: number;
  /** While jobs wait or run. */
  progress?: RegionsProgress;
  /** The worker was given up: jobs run on the UI thread. */
  fallback: boolean;
}

export interface RegionsClientOptions {
  /** Starts a worker; `undefined` when none can start. */
  spawn?: () => RegionsWorkerLike | undefined;
  deadline?: () => number;
  delay?: () => number | undefined;
  now?: () => number;
  setTimer?: (run: () => void, ms: number) => unknown;
  clearTimer?: (timer: unknown) => void;
  /** Runs `run` in an idle slice of the UI thread. */
  idle?: (run: () => void) => void;
  /** Results within this many ms reach the shell together (`RESULT_BATCH_MS`); 0 at once. */
  batch?: number;
}

export interface RegionsClient {
  /** The result for this data object, if it is still good for these fonts. */
  get(data: SketchData, version: number): RegionsEntry | undefined;
  /** The jobs the shell needs, in its order: replaces what was asked before. */
  want(jobs: readonly RegionsJob[]): void;
  /** Moves the job of this sketch feature to the front. */
  prefer(key: string): void;
  /**
   * Lets go of what the budget doesn't grant: the fill unless shaded, everything unless
   * picked. `granted` holds every shown sketch that has an entry, whatever its state
   * (`closedSketchShows`' `keep`): only the others' entries are spare.
   */
  keep(granted: ReadonlyMap<SketchData, 'shaded' | 'pickable' | 'none'>): void;
  addFont(id: string, bytes: ArrayBuffer): void;
  readonly store: StoreApi<RegionsState>;
  dispose(): void;
}

/**
 * What a sketch that isn't open shows of its result under the budget's verdict
 * (ADR-0154): its regions as soon as they are here and granted (a fill on its
 * way doesn't hold them back), its fill when shaded, and whether to ask again for
 * what the budget grants but was let go of.
 */
export function closedSketchShows(
  entry: RegionsEntry,
  verdict: RegionVerdict | undefined,
): {
  regions?: FlatRegions;
  fill?: ProfileFill;
  unshaded: boolean;
  unpickable: boolean;
  ask: boolean;
  /** What the client keeps of the entry (`keep`): a shown sketch's entry is never spare. */
  keep: RegionVerdict;
} {
  if (entry.state === 'stopped' || entry.state === 'failed') {
    return { unshaded: true, unpickable: true, ask: false, keep: 'none' };
  }
  if (entry.state !== 'done' || !verdict) {
    return { unshaded: false, unpickable: false, ask: false, keep: 'none' };
  }
  const regions = verdict !== 'none' ? entry.regions : undefined;
  const ask =
    (verdict !== 'none' && !entry.regions) ||
    (verdict === 'shaded' && entry.fillable && !entry.fill);
  if (ask) {
    return { ...(regions && { regions }), unshaded: false, unpickable: false, ask, keep: verdict };
  }
  const fill = verdict === 'shaded' ? entry.fill : undefined;
  return {
    ...(regions && { regions }),
    ...(fill && { fill }),
    unshaded: !fill,
    unpickable: verdict === 'none',
    ask: false,
    keep: verdict,
  };
}

/** A store with nothing in it, for while the shell has no client yet. */
export const idleRegions = createStore<RegionsState>()(() => ({ version: 0, fallback: false }));

function defaultSpawn(): RegionsWorkerLike | undefined {
  if (typeof Worker === 'undefined') return undefined;
  if (typeof window !== 'undefined' && window.__extrudoNoProfilesWorker) return undefined;
  try {
    return new Worker(new URL('./regionsWorker.ts', import.meta.url), {
      type: 'module',
      name: 'extrudo-profiles',
    }) as unknown as RegionsWorkerLike;
  } catch {
    return undefined;
  }
}

/** The deadline; a test may only shorten it. */
export function profilesDeadline(): number {
  const lower = typeof window !== 'undefined' ? window.__extrudoProfilesDeadline : undefined;
  return typeof lower === 'number' && Number.isFinite(lower) && lower > 0
    ? Math.min(lower, PROFILES_DEADLINE_MS)
    : PROFILES_DEADLINE_MS;
}

function defaultIdle(run: () => void): void {
  if (typeof requestIdleCallback === 'function') requestIdleCallback(() => run(), { timeout: 500 });
  else setTimeout(run, 0);
}

export { hasText };

export function createRegionsClient(options: RegionsClientOptions = {}): RegionsClient {
  const spawn = options.spawn ?? defaultSpawn;
  const deadline = options.deadline ?? profilesDeadline;
  const delay =
    options.delay ??
    (() => (typeof window !== 'undefined' ? window.__extrudoProfilesDelay : undefined));
  const now = options.now ?? (() => performance.now());
  const setTimer = options.setTimer ?? ((run, ms) => setTimeout(run, ms));
  const clearTimer =
    options.clearTimer ?? ((t) => clearTimeout(t as ReturnType<typeof setTimeout>));
  const idle = options.idle ?? defaultIdle;
  const batch = options.batch ?? RESULT_BATCH_MS;
  let batched: unknown;

  const store = createStore<RegionsState>()(() => ({ version: 0, fallback: false }));
  const entries = new Map<SketchData, RegionsEntry>();
  const fonts = new Map<string, ArrayBuffer>();
  let queue: RegionsJob[] = [];
  let wanted = new Set<SketchData>();
  let current:
    | { job: RegionsJob; id: number; started: number; timer: unknown; awaitingFill?: boolean }
    | undefined;
  let worker: RegionsWorkerLike | undefined;
  let nextId = 1;
  let deaths = 0;
  let fallback = false;
  let idlePending = false;
  let disposed = false;
  let progress: RegionsProgress | undefined;
  /** Work of the fills built on the UI thread for the shown sketches (fallback only). */
  const inlineWork = new Map<SketchData, number>();

  const valid = (entry: RegionsEntry | undefined, version: number) =>
    entry && (!entry.text || entry.version === version) ? entry : undefined;

  /**
   * Tells the shell. Only a result bumps the version (the shell reads results and asks
   * again); a new count of jobs only changes the progress, or asking would loop.
   */
  const notify = (result = true) => {
    const busy = current !== undefined || queue.length > 0;
    const total = (progress?.done ?? 0) + queue.length + (current ? 1 : 0);
    if (busy && progress && progress.total !== total) progress = { ...progress, total };
    if (!busy) progress = undefined;
    const state = store.getState();
    if (result && batch > 0 && busy) {
      // More results are coming: tell the shell once for all of them, soon.
      if (batched === undefined) {
        batched = setTimer(() => {
          batched = undefined;
          store.setState((s) => ({ version: s.version + 1, progress, fallback }));
        }, batch);
      }
      if (state.progress !== progress) store.setState({ progress });
      return;
    }
    if (result && batched !== undefined) {
      clearTimer(batched);
      batched = undefined;
    }
    if (!result && state.progress === progress && state.fallback === fallback) return;
    store.setState((s) => ({ version: result ? s.version + 1 : s.version, progress, fallback }));
  };

  const startWorker = (): RegionsWorkerLike | undefined => {
    if (fallback) return undefined;
    const made = spawn();
    if (!made) {
      fallback = true;
      store.setState({ fallback });
      return undefined;
    }
    made.onmessage = ({ data }) => answer(data);
    made.onerror = () => died(made);
    for (const [id, bytes] of fonts) made.postMessage({ type: 'font', id, bytes: bytes.slice(0) });
    return made;
  };

  const stopWorker = () => {
    worker?.terminate();
    worker = undefined;
  };

  /** What results have kept since the shell last shared out the budget: later jobs get that much less. */
  let accepted = 0;

  const store_ = (job: RegionsJob, entry: Omit<RegionsEntry, 'version' | 'text'>) => {
    entries.delete(job.data);
    entries.set(job.data, { ...entry, version: job.version, text: job.text });
    accepted += (entry.regions ? entry.regionBytes : 0) + (entry.fill ? entry.fillBytes : 0);
  };

  const finish = () => {
    if (current) clearTimer(current.timer);
    current = undefined;
    if (progress) progress = { ...progress, done: progress.done + 1 };
    notify();
    pump();
  };

  function answer(reply: RegionsReply) {
    if (!current || reply.job !== current.id) return; // late
    if ('started' in reply) {
      // The deadline runs from here: a new worker's start-up isn't the sketch's.
      clearTimer(current.timer);
      const id = current.id;
      current.timer = setTimer(() => timedOut(id), deadline());
      if (progress && progress.since === undefined) {
        progress = { ...progress, since: now() };
        notify(false);
      }
      return;
    }
    const { job } = current;
    if (!wanted.has(job.data)) return finish(); // dropped
    if ('regionBytes' in reply) {
      const regions = reply.regions && fromWire(reply.regions);
      store_(job, {
        state: 'done',
        ...(regions && { regions }),
        regionBytes: reply.regionBytes,
        fillBytes: fillBytes(reply.vertices, reply.count),
        // A fill left out for want of room can still be had: asked for again when it fits.
        fillable: true,
      });
      // The regions can be picked already; the fill follows.
      if (reply.fill) {
        current.awaitingFill = true;
        notify();
        return;
      }
    } else if ('fill' in reply) {
      const entry = entries.get(job.data);
      if (entry?.regions) {
        const { fill } = reply;
        if (fill) accepted += entry.fillBytes;
        entries.set(job.data, {
          ...entry,
          ...(fill && {
            fill: {
              ...fill,
              ids: entry.regions.ids,
              regions: regionIndex(entry.regions) as Map<string, number>,
            },
          }),
          fillable: fill !== null,
        });
      }
    } else if ('refused' in reply) {
      store_(job, { state: 'refused', regionBytes: 0, fillBytes: 0, fillable: false });
    } else {
      store_(job, { state: 'failed', regionBytes: 0, fillBytes: 0, fillable: false });
    }
    finish();
  }

  function died(which: RegionsWorkerLike) {
    if (which !== worker) return;
    stopWorker();
    deaths++;
    if (deaths >= MAX_DEATHS) fallback = true;
    if (current) {
      const { job } = current;
      store_(job, { state: 'failed', regionBytes: 0, fillBytes: 0, fillable: false });
    }
    finish();
  }

  function timedOut(id: number) {
    if (!current || current.id !== id) return;
    // A page busy past the deadline may hold the answer in its queue: look once more first.
    current.timer = setTimer(() => stop(id), 0);
  }

  function stop(id: number) {
    if (!current || current.id !== id) return;
    stopWorker();
    const entry = entries.get(current.job.data);
    if (current.awaitingFill && entry) {
      // The regions came in time: they still pick; the sketch goes without a fill.
      entries.set(current.job.data, { ...entry, fillable: false });
    } else {
      store_(current.job, { state: 'stopped', regionBytes: 0, fillBytes: 0, fillable: false });
    }
    finish();
  }

  function runInline(job: RegionsJob) {
    const since = performance.now();
    const found = findRegions(job.data);
    logProfileWork(since);
    if ('refused' in found) {
      store_(job, { state: 'refused', regionBytes: 0, fillBytes: 0, fillable: false });
      return;
    }
    const { regions, regionBytes, vertices } = found;
    const allowance = Math.max(0, (job.allowance ?? Number.POSITIVE_INFINITY) - accepted);
    const bytes = fillBytes(vertices, regions.ids.length);
    const used = [...inlineWork].reduce((n, [data, w]) => n + (wanted.has(data) ? w : 0), 0);
    const fits = regionBytes + bytes <= allowance;
    const work = fits ? fillWork(found.profiles) : 0;
    const mayFill = fits && work <= MAX_FILL_WORK && used + work <= MAX_DESIGN_FILL_WORK;
    const fill = mayFill ? buildFill(found) : null;
    if (fill) inlineWork.set(job.data, work);
    store_(job, {
      state: 'done',
      ...(regionBytes <= allowance && { regions }),
      ...(fill && {
        fill: { ...fill, ids: regions.ids, regions: regionIndex(regions) as Map<string, number> },
      }),
      regionBytes,
      fillBytes: bytes,
      // Left out for want of room it can still be had; too slow or failed, it can't.
      fillable: fill !== null || !fits,
    });
  }

  function pump() {
    if (disposed || current || queue.length === 0) return;
    if (!fallback && !worker) worker = startWorker();
    if (fallback || !worker) {
      if (idlePending) return;
      idlePending = true;
      idle(() => {
        idlePending = false;
        if (disposed || current) return;
        const job = queue.shift();
        if (!job) return notify();
        if (progress && progress.since === undefined) progress = { ...progress, since: now() };
        try {
          runInline(job);
        } catch {
          store_(job, { state: 'failed', regionBytes: 0, fillBytes: 0, fillable: false });
        }
        if (progress) progress = { ...progress, done: progress.done + 1 };
        notify();
        pump();
      });
      return;
    }
    const job = queue.shift() as RegionsJob;
    const id = nextId++;
    const wait = delay();
    // Until the worker says it has begun, only a start-up that never ends counts.
    current = {
      job,
      id,
      started: now(),
      timer: setTimer(() => timedOut(id), deadline() + START_MS),
    };
    worker.postMessage({
      type: 'job',
      job: id,
      data: job.data,
      maxBytes: Math.max(0, (job.allowance ?? Number.POSITIVE_INFINITY) - accepted),
      ...(wait && { delay: wait }),
    });
  }

  // Started at once, so it has loaded by the time the design's first sketches arrive.
  worker = startWorker();

  return {
    store,
    get(data, version) {
      return valid(entries.get(data), version);
    },
    want(jobs) {
      // The shell's allowances count every result it has seen.
      accepted = 0;
      const before = wanted;
      wanted = new Set(jobs.map((j) => j.data));
      // The running job isn't queued again; a newly shown sketch goes before the others.
      const waiting = jobs.filter((j) => !(current && current.job.data === j.data));
      queue = [
        ...waiting.filter((j) => !before.has(j.data)),
        ...waiting.filter((j) => before.has(j.data)),
      ];
      if (current && !wanted.has(current.job.data) && now() - current.started > DROP_AFTER_MS) {
        clearTimer(current.timer);
        current = undefined;
        stopWorker();
      }
      if ((queue.length > 0 || current) && !progress) progress = { done: 0, total: 0 };
      notify(false);
      pump();
    },
    prefer(key) {
      const at = queue.findIndex((j) => j.key === key);
      if (at > 0) queue = [queue[at] as RegionsJob, ...queue.slice(0, at), ...queue.slice(at + 1)];
    },
    keep(granted) {
      for (const [data, verdict] of granted) {
        const entry = entries.get(data);
        if (!entry) continue;
        if (verdict !== 'shaded' && entry.fill) entries.set(data, { ...entry, fill: undefined });
        if (verdict === 'none' && entry.regions) {
          entries.set(data, { ...entry, fill: undefined, regions: undefined });
        }
      }
      // Results of sketches no longer shown stay for an undo, the newest first, within a bound.
      let spare = 0;
      let count = 0;
      for (const [data, entry] of [...entries].reverse()) {
        if (granted.has(data) || wanted.has(data)) continue;
        spare += (entry.regions ? entry.regionBytes : 0) + (entry.fill ? entry.fillBytes : 0);
        count++;
        if (spare > SPARE_BYTES || count > MAX_SPARE) entries.delete(data);
      }
      for (const data of [...inlineWork.keys()]) if (!entries.has(data)) inlineWork.delete(data);
    },
    addFont(id, bytes) {
      if (fonts.has(id)) return;
      fonts.set(id, bytes);
      worker?.postMessage({ type: 'font', id, bytes: bytes.slice(0) });
    },
    dispose() {
      disposed = true;
      if (current) clearTimer(current.timer);
      current = undefined;
      stopWorker();
    },
  };
}
