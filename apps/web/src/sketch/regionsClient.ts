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
import { fillWork, type ProfileFill } from '../viewport/profileFills';
import { type FlatRegions, regionIndex, regionsBytes } from './flatRegions';
import { regionsOf } from './regionsJob';
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

/** A job that is no longer wanted keeps running this long before the worker is restarted. */
const DROP_AFTER_MS = 250;

/** What results of sketches no longer shown are kept for an undo, at most. */
const SPARE_BYTES = 64 * 1024 * 1024;

/** Crashes (not deadlines) after which the worker is given up for idle slices. */
const MAX_CRASHES = 3;

/** Bytes a fill keeps a vertex: 12 for its position, 4 for a drawing order (`fillLayout`). */
export const FILL_BYTES_PER_VERTEX = 16;

export interface RegionsEntry {
  /** done: found; refused: detection refused; stopped: past the deadline; failed: the worker died on it. */
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
}

/** What the client needs of a `Worker` (a fake one in tests). */
export interface RegionsWorkerLike {
  postMessage(message: RegionsRequest, transfer?: Transferable[]): void;
  terminate(): void;
  onmessage: ((event: MessageEvent<RegionsReply>) => void) | null;
  onerror: ((event: ErrorEvent | Event) => void) | null;
}

export interface RegionsProgress {
  /** When the current run of jobs began. */
  since: number;
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
  /** The most vertices a fill may have to be built at all. */
  maxFillVertices?: () => number;
  delay?: () => number | undefined;
  now?: () => number;
  setTimer?: (run: () => void, ms: number) => unknown;
  clearTimer?: (timer: unknown) => void;
  /** Runs `run` in an idle slice of the UI thread. */
  idle?: (run: () => void) => void;
}

export interface RegionsClient {
  /** The result for this data object, if it is still good for these fonts. */
  get(data: SketchData, version: number): RegionsEntry | undefined;
  /** The jobs the shell needs, in its order: replaces what was asked before. */
  want(jobs: readonly RegionsJob[]): void;
  /** Moves the job of this sketch feature to the front. */
  prefer(key: string): void;
  /** Lets go of what the budget doesn't grant: the fill unless shaded, everything unless picked. */
  keep(granted: ReadonlyMap<SketchData, 'shaded' | 'pickable' | 'none'>): void;
  addFont(id: string, bytes: ArrayBuffer): void;
  readonly store: StoreApi<RegionsState>;
  dispose(): void;
}

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

/** Whether the sketch has text that isn't construction: its regions depend on the fonts. */
export function hasText(data: SketchData): boolean {
  for (const id in data.entities) {
    const e = data.entities[id as keyof typeof data.entities];
    if (e?.type === 'text' && !e.construction) return true;
  }
  return false;
}

export function createRegionsClient(options: RegionsClientOptions = {}): RegionsClient {
  const spawn = options.spawn ?? defaultSpawn;
  const deadline = options.deadline ?? profilesDeadline;
  const maxFillVertices = options.maxFillVertices ?? (() => Number.POSITIVE_INFINITY);
  const delay =
    options.delay ??
    (() => (typeof window !== 'undefined' ? window.__extrudoProfilesDelay : undefined));
  const now = options.now ?? (() => performance.now());
  const setTimer = options.setTimer ?? ((run, ms) => setTimeout(run, ms));
  const clearTimer =
    options.clearTimer ?? ((t) => clearTimeout(t as ReturnType<typeof setTimeout>));
  const idle = options.idle ?? defaultIdle;

  const store = createStore<RegionsState>()(() => ({ version: 0, fallback: false }));
  const entries = new Map<SketchData, RegionsEntry>();
  const fonts = new Map<string, ArrayBuffer>();
  let queue: RegionsJob[] = [];
  let wanted = new Set<SketchData>();
  let current: { job: RegionsJob; id: number; started: number; timer: unknown } | undefined;
  let worker: RegionsWorkerLike | undefined;
  let nextId = 1;
  let crashes = 0;
  let fallback = false;
  let idlePending = false;
  let disposed = false;
  let progress: RegionsProgress | undefined;
  /** Work of the fills built on the UI thread for the shown sketches (fallback only). */
  const inlineWork = new Map<SketchData, number>();

  const valid = (entry: RegionsEntry | undefined, version: number) =>
    entry && (!entry.text || entry.version === version) ? entry : undefined;

  const notify = () => {
    const busy = current !== undefined || queue.length > 0;
    if (busy && progress)
      progress = { ...progress, total: progress.done + queue.length + (current ? 1 : 0) };
    if (!busy) progress = undefined;
    store.setState((s) => ({ version: s.version + 1, progress, fallback }));
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
    made.onerror = () => crashed(made);
    for (const [id, bytes] of fonts) made.postMessage({ type: 'font', id, bytes: bytes.slice(0) });
    return made;
  };

  const stopWorker = () => {
    worker?.terminate();
    worker = undefined;
  };

  const store_ = (job: RegionsJob, entry: Omit<RegionsEntry, 'version' | 'text'>) => {
    entries.delete(job.data);
    entries.set(job.data, { ...entry, version: job.version, text: job.text });
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
    const { job } = current;
    if (!wanted.has(job.data)) return finish(); // dropped
    if ('regions' in reply) {
      const { regions, fill, vertices } = reply;
      store_(job, {
        state: 'done',
        regions,
        ...(fill && {
          fill: { ...fill, ids: regions.ids, regions: regionIndex(regions) as Map<string, number> },
        }),
        regionBytes: regionsBytes(regions),
        fillBytes: FILL_BYTES_PER_VERTEX * vertices + 4 * (regions.ids.length + 1),
        fillable: fill !== undefined,
      });
    } else if ('refused' in reply) {
      store_(job, { state: 'refused', regionBytes: 0, fillBytes: 0, fillable: false });
    } else {
      store_(job, { state: 'failed', regionBytes: 0, fillBytes: 0, fillable: false });
    }
    finish();
  }

  function crashed(which: RegionsWorkerLike) {
    if (which !== worker) return;
    stopWorker();
    crashes++;
    if (crashes >= MAX_CRASHES) fallback = true;
    if (current) {
      const { job } = current;
      store_(job, { state: 'failed', regionBytes: 0, fillBytes: 0, fillable: false });
    }
    finish();
  }

  function timedOut(id: number) {
    if (!current || current.id !== id) return;
    stopWorker();
    store_(current.job, { state: 'stopped', regionBytes: 0, fillBytes: 0, fillable: false });
    finish();
  }

  function runInline(job: RegionsJob) {
    const used = [...inlineWork].reduce((n, [data, w]) => n + (wanted.has(data) ? w : 0), 0);
    let work = 0;
    const result = regionsOf(job.data, maxFillVertices(), (profiles) => {
      work = fillWork(profiles);
      return work <= MAX_FILL_WORK && used + work <= MAX_DESIGN_FILL_WORK;
    });
    if (result.fill) inlineWork.set(job.data, work);
    if (!result.regions) {
      store_(job, { state: 'refused', regionBytes: 0, fillBytes: 0, fillable: false });
      return;
    }
    const { regions, fill } = result;
    store_(job, {
      state: 'done',
      regions,
      ...(fill && {
        fill: { ...fill, ids: regions.ids, regions: regionIndex(regions) as Map<string, number> },
      }),
      regionBytes: regionsBytes(regions),
      fillBytes: FILL_BYTES_PER_VERTEX * result.vertices + 4 * (regions.ids.length + 1),
      fillable: fill !== undefined,
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
    current = { job, id, started: now(), timer: setTimer(() => timedOut(id), deadline()) };
    worker.postMessage({
      type: 'job',
      job: id,
      data: job.data,
      maxFillVertices: maxFillVertices(),
      ...(wait && { delay: wait }),
    });
  }

  return {
    store,
    get(data, version) {
      return valid(entries.get(data), version);
    },
    want(jobs) {
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
      if ((queue.length > 0 || current) && !progress)
        progress = { since: now(), done: 0, total: 0 };
      notify();
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
      for (const [data, entry] of [...entries].reverse()) {
        if (granted.has(data)) continue;
        spare += entry.regionBytes + (entry.fill ? entry.fillBytes : 0);
        if (spare > SPARE_BYTES) entries.delete(data);
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
