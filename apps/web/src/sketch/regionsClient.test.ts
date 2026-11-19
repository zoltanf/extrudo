import type { SketchData } from '@extrudo/core';
import { detectProfiles } from '@extrudo/sketch/profiles';
import { describe, expect, it } from 'vitest';
import { flattenRegions, toWire } from './flatRegions';
import {
  closedSketchShows,
  createRegionsClient,
  hasText,
  type RegionsEntry,
  type RegionsJob,
  type RegionsWorkerLike,
} from './regionsClient';
import type { RegionsReply, RegionsRequest } from './regionsProtocol';

const rectangle = (w: number): SketchData =>
  ({
    entities: {
      a: { type: 'point', x: 0, y: 0 },
      b: { type: 'point', x: w, y: 0 },
      c: { type: 'point', x: w, y: 5 },
      d: { type: 'point', x: 0, y: 5 },
      ab: { type: 'line', start: 'a', end: 'b', construction: false },
      bc: { type: 'line', start: 'b', end: 'c', construction: false },
      cd: { type: 'line', start: 'c', end: 'd', construction: false },
      da: { type: 'line', start: 'd', end: 'a', construction: false },
    },
    constraints: {},
    dimensions: {},
  }) as unknown as SketchData;

class FakeWorker implements RegionsWorkerLike {
  onmessage: ((event: MessageEvent<RegionsReply>) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  sent: RegionsRequest[] = [];
  terminated = false;
  postMessage(message: RegionsRequest) {
    this.sent.push(message);
  }
  terminate() {
    this.terminated = true;
  }
  jobs() {
    return this.sent.filter((m) => m.type === 'job') as Extract<RegionsRequest, { type: 'job' }>[];
  }
  /** Says the last job has begun, as the real worker does first. */
  start(job = this.jobs().at(-1)) {
    if (!job) throw new Error('no job');
    this.onmessage?.({ data: { job: job.job, started: true } } as MessageEvent<RegionsReply>);
  }
  /** Answers the last job as the real worker would: its regions, and a fill when `fill`. */
  answer(job = this.jobs().at(-1), fill = false) {
    if (!job) throw new Error('no job');
    const profiles = detectProfiles(job.data);
    const regions = flattenRegions(profiles);
    const count = regions.ids.length;
    const reply = {
      job: job.job,
      regions: toWire(regions),
      regionBytes: 200,
      count,
      vertices: 6,
      fill,
    };
    this.onmessage?.({ data: reply } as MessageEvent<RegionsReply>);
  }
  /** Sends the fill after the regions. */
  fill(job = this.jobs().at(-1)) {
    if (!job) throw new Error('no job');
    const fill = { positions: new Float32Array(18), starts: new Uint32Array([0, 6]) };
    this.onmessage?.({ data: { job: job.job, fill } } as MessageEvent<RegionsReply>);
  }
}

function setup(options: { spawn?: () => RegionsWorkerLike | undefined; batch?: number } = {}) {
  const workers: FakeWorker[] = [];
  let time = 0;
  const timers = new Map<number, { at: number; run: () => void }>();
  let nextTimer = 1;
  const idle: (() => void)[] = [];
  const client = createRegionsClient({
    spawn:
      options.spawn ??
      (() => {
        const w = new FakeWorker();
        workers.push(w);
        return w;
      }),
    deadline: () => 1000,
    delay: () => undefined,
    now: () => time,
    setTimer: (run, ms) => {
      const id = nextTimer++;
      timers.set(id, { at: time + ms, run });
      return id;
    },
    clearTimer: (id) => timers.delete(id as number),
    idle: (run) => idle.push(run),
    batch: options.batch ?? 0,
  });
  const advance = (ms: number) => {
    time += ms;
    for (const [id, t] of [...timers]) {
      if (t.at <= time) {
        timers.delete(id);
        t.run();
      }
    }
  };
  /** Runs the next timer, at its time; false when none is set. */
  const step = () => {
    const next = [...timers].sort((x, y) => x[1].at - y[1].at)[0];
    if (!next) return false;
    timers.delete(next[0]);
    time = Math.max(time, next[1].at);
    next[1].run();
    return true;
  };
  return { client, workers, advance, step, idle, worker: () => workers.at(-1) as FakeWorker };
}

const job = (key: string, data: SketchData, version = 0): RegionsJob => ({
  key,
  data,
  version,
  text: hasText(data),
});

describe('createRegionsClient', () => {
  const a = rectangle(1);
  const b = rectangle(2);
  const c = rectangle(3);

  it('runs one job at a time in the order asked, and keeps each result by its data', () => {
    const { client, worker } = setup();
    client.want([job('a', a), job('b', b), job('c', c)]);
    expect(
      worker()
        .jobs()
        .map((j) => j.data),
    ).toEqual([a]);
    const before = client.store.getState().version;
    worker().answer();
    expect(client.store.getState().version).toBeGreaterThan(before);
    expect(
      worker()
        .jobs()
        .map((j) => j.data),
    ).toEqual([a, b]);
    worker().answer();
    worker().answer();
    expect(client.get(a, 0)?.state).toBe('done');
    expect(client.get(c, 0)?.regions?.ids).toHaveLength(1);
    expect(client.store.getState().progress).toBeUndefined();
  });

  it('moves a hovered sketch to the front', () => {
    const { client, worker } = setup();
    client.want([job('a', a), job('b', b), job('c', c)]);
    client.prefer('c');
    worker().answer();
    expect(worker().jobs().at(-1)?.data).toBe(c);
  });

  it('puts a newly shown sketch before the others', () => {
    const { client, worker } = setup();
    client.want([job('a', a), job('b', b)]);
    client.want([job('a', a), job('b', b), job('c', c)]);
    worker().answer();
    expect(worker().jobs().at(-1)?.data).toBe(c);
  });

  it('drops a job no longer wanted and ignores its answer', () => {
    const { client, worker } = setup();
    client.want([job('a', a), job('b', b)]);
    client.want([job('b', b)]);
    worker().answer(worker().jobs()[0]);
    expect(client.get(a, 0)).toBeUndefined();
    expect(worker().jobs().at(-1)?.data).toBe(b);
  });

  it('restarts the worker for a dropped job that has run a while', () => {
    const { client, workers, advance } = setup();
    client.want([job('a', a), job('b', b)]);
    advance(300);
    client.want([job('b', b)]);
    expect(workers[0]?.terminated).toBe(true);
    expect(workers[1]?.jobs().map((j) => j.data)).toEqual([b]);
  });

  it('ignores a late answer', () => {
    const { client, worker } = setup();
    client.want([job('a', a), job('b', b)]);
    const first = worker().jobs()[0];
    worker().answer();
    worker().answer(first);
    expect(
      worker()
        .jobs()
        .map((j) => j.data),
    ).toEqual([a, b]);
    expect(client.get(b, 0)).toBeUndefined();
  });

  it('stops a job past the deadline, starts a new worker with the fonts and goes on', () => {
    const { client, workers, advance } = setup();
    client.addFont('f@1', new Uint8Array([1, 2, 3]).buffer);
    client.want([job('a', a), job('b', b)]);
    // A new worker's start-up doesn't count against the sketch.
    advance(5000);
    expect(workers[0]?.terminated).toBe(false);
    workers[0]?.start();
    advance(999);
    expect(workers[0]?.terminated).toBe(false);
    advance(1);
    // One more look, for an answer that waited behind a busy page.
    advance(0);
    expect(workers[0]?.terminated).toBe(true);
    expect(client.get(a, 0)?.state).toBe('stopped');
    expect(workers[1]?.sent[0]).toMatchObject({ type: 'font', id: 'f@1' });
    expect(workers[1]?.jobs().map((j) => j.data)).toEqual([b]);
  });

  it('keeps a result for an undo while the sketch is no longer shown', () => {
    const { client, worker } = setup();
    client.want([job('a', a)]);
    worker().answer();
    client.want([job('b', b)]);
    client.keep(new Map());
    expect(client.get(a, 0)?.state).toBe('done');
  });

  it('lets go of what the budget does not grant, and remembers what it took', () => {
    const { client, worker } = setup();
    client.want([job('a', a), job('b', b)]);
    worker().answer();
    worker().answer();
    client.keep(
      new Map([
        [a, 'pickable'],
        [b, 'none'],
      ]),
    );
    expect(client.get(a, 0)?.regions).toBeDefined();
    expect(client.get(a, 0)?.fill).toBeUndefined();
    expect(client.get(b, 0)?.regions).toBeUndefined();
    expect(client.get(b, 0)?.regionBytes).toBeGreaterThan(0);
  });

  it('keeps the result of a sketch with text for its fonts only', () => {
    const text = {
      ...rectangle(4),
      entities: { ...rectangle(4).entities, t: { type: 'text', construction: false } },
    } as unknown as SketchData;
    const { client, worker } = setup();
    client.want([job('t', text, 1), job('a', a, 1)]);
    worker().onmessage?.({
      data: { job: worker().jobs()[0]?.job as number, refused: 'none' },
    } as MessageEvent<RegionsReply>);
    expect(client.get(text, 1)).toBeDefined();
    expect(client.get(text, 2)).toBeUndefined();
    worker().answer();
    expect(client.get(a, 2)).toBeDefined();
  });

  it('marks the sketch a worker died on, and gives the worker up after repeated deaths', () => {
    const d = rectangle(9);
    const { client, workers, idle } = setup();
    client.want([job('a', a), job('b', b), job('c', c), job('d', d)]);
    for (let i = 0; i < 3; i++) workers.at(-1)?.onerror?.(new Event('error'));
    expect(client.get(a, 0)?.state).toBe('failed');
    expect(client.get(c, 0)?.state).toBe('failed');
    expect(client.store.getState().fallback).toBe(true);
    expect(workers).toHaveLength(3);
    // The rest runs on the UI thread in idle slices, and fills still come.
    while (idle.length) idle.shift()?.();
    expect(client.get(d, 0)?.fill?.positions.length).toBeGreaterThan(0);
  });

  it('runs every job on the UI thread when no worker can start, with fills', () => {
    const { client, idle } = setup({ spawn: () => undefined });
    client.want([job('a', a), job('b', b)]);
    expect(client.store.getState().fallback).toBe(true);
    while (idle.length) idle.shift()?.();
    expect(client.get(a, 0)?.fill?.positions.length).toBeGreaterThan(0);
    expect(client.get(b, 0)?.state).toBe('done');
  });

  it('counts its progress for the status bar', () => {
    const { client, worker } = setup();
    client.want([job('a', a), job('b', b), job('c', c)]);
    expect(client.store.getState().progress).toMatchObject({ done: 0, total: 3 });
    // The hint's clock starts with the first job the worker begins.
    expect(client.store.getState().progress?.since).toBeUndefined();
    worker().start();
    expect(client.store.getState().progress?.since).toBe(0);
    worker().answer();
    expect(client.store.getState().progress).toMatchObject({ done: 1, total: 3 });
    worker().answer();
    worker().answer();
    expect(client.store.getState().progress).toBeUndefined();
  });

  it('tells the shell once for results that arrive close together, and at once for the last', () => {
    const { client, worker, advance } = setup({ batch: 150 });
    client.want([job('a', a), job('b', b), job('c', c)]);
    const start = client.store.getState().version;
    worker().answer();
    worker().answer();
    expect(client.store.getState().version).toBe(start);
    advance(150);
    expect(client.store.getState().version).toBe(start + 1);
    worker().answer();
    expect(client.store.getState().version).toBe(start + 2);
    expect(client.get(c, 0)?.state).toBe('done');
  });

  it('keeps the regions to pick while the fill is still being built, then takes the fill', () => {
    const { client, worker } = setup();
    client.want([job('a', a), job('b', b)]);
    worker().answer(undefined, true);
    expect(client.get(a, 0)?.regions).toBeDefined();
    expect(client.get(a, 0)?.fill).toBeUndefined();
    expect(worker().jobs()).toHaveLength(1);
    worker().fill();
    expect(client.get(a, 0)?.fill?.positions).toHaveLength(18);
    expect(worker().jobs().at(-1)?.data).toBe(b);
  });

  it('keeps the regions when the fill is stopped at the deadline', () => {
    const { client, workers, advance } = setup();
    client.want([job('a', a), job('b', b)]);
    workers[0]?.start();
    workers[0]?.answer(undefined, true);
    advance(1000);
    advance(0);
    expect(workers[0]?.terminated).toBe(true);
    expect(client.get(a, 0)).toMatchObject({ state: 'done', fillable: false });
    expect(client.get(a, 0)?.regions).toBeDefined();
    expect(workers[1]?.jobs().map((j) => j.data)).toEqual([b]);
  });

  it('takes an answer that waited behind a busy page past the deadline', () => {
    const { client, workers, advance } = setup();
    client.want([job('a', a)]);
    workers[0]?.start();
    advance(1000);
    workers[0]?.answer();
    advance(0);
    expect(workers[0]?.terminated).toBe(false);
    expect(client.get(a, 0)?.state).toBe('done');
  });

  it('counts a reply whose regions name a string it lacks as a failure', () => {
    const { client, worker } = setup();
    client.want([job('a', a)]);
    const last = worker().jobs()[0] as Extract<RegionsRequest, { type: 'job' }>;
    const wire = toWire(flattenRegions(detectProfiles(a)));
    const reply = {
      job: last.job,
      regions: { ...wire, idOf: Uint32Array.from(wire.idOf, () => wire.strings.length) },
      regionBytes: 200,
      count: wire.idOf.length,
      vertices: 6,
      fill: false,
    };
    worker().onmessage?.({ data: reply } as MessageEvent<RegionsReply>);
    expect(client.get(a, 0)?.state).toBe('failed');
    expect(client.get(a, 0)?.regions).toBeUndefined();
  });

  it('tells the worker what the budget has left for the sketch', () => {
    const { client, worker } = setup();
    client.want([{ ...job('a', a), allowance: 1234 }]);
    expect(worker().jobs()[0]?.maxBytes).toBe(1234);
  });

  it('keeps no more than a bounded number of results of sketches no longer shown', () => {
    const { client, worker } = setup();
    const versions = Array.from({ length: 300 }, (_, i) => rectangle(10 + i));
    for (const [i, data] of versions.entries()) {
      client.want([job(`v${i}`, data)]);
      const last = worker().jobs().at(-1) as Extract<RegionsRequest, { type: 'job' }>;
      if (i % 2) worker().answer(last);
      else
        worker().onmessage?.({
          data: { job: last.job, refused: 'no' },
        } as MessageEvent<RegionsReply>);
      client.keep(new Map());
    }
    client.want([]);
    client.keep(new Map());
    const kept = versions.filter((data) => client.get(data, 0) !== undefined);
    expect(kept.length).toBeLessThanOrEqual(64);
    // The newest are the ones kept, for an undo.
    expect(client.get(versions.at(-1) as SketchData, 0)).toBeDefined();
  });

  it('takes what results kept since the last pass off the room of the next jobs', () => {
    const { client, worker } = setup();
    client.want([
      { ...job('a', a), allowance: 1000 },
      { ...job('b', b), allowance: 1000 },
    ]);
    // The first result keeps its regions (200 bytes by the fake worker).
    worker().answer();
    expect(worker().jobs().at(-1)?.maxBytes).toBe(800);
    // A new pass has counted it: the shell's allowance holds again.
    client.want([
      { ...job('b', b), allowance: 700 },
      { ...job('c', c), allowance: 700 },
    ]);
    worker().answer();
    expect(worker().jobs().at(-1)?.maxBytes).toBe(500);
  });
});

describe('a shell that asks again on every result', () => {
  type Ending = 'done' | 'refused' | 'stopped' | 'failed';

  /**
   * Shows sketches that end as `endings` says, and does what the shell does on each
   * bump of the store (`closedSketchShows`, `want`, `keep`) until nothing moves.
   */
  function shown(endings: readonly Ending[]) {
    const { client, workers, step } = setup({ batch: 150 });
    const sketches = endings.map((ending, i) => ({ key: `s${i}`, data: rectangle(1 + i), ending }));
    const endingOf = new Map(sketches.map((s) => [s.data, s.ending]));
    const served = new Map<FakeWorker, number>();
    const shell = () => {
      const jobs: RegionsJob[] = [];
      const granted = new Map<SketchData, 'shaded' | 'pickable' | 'none'>();
      for (const s of sketches) {
        const entry = client.get(s.data, 0);
        const shows =
          entry && closedSketchShows(entry, entry.state === 'done' ? 'shaded' : undefined);
        if (shows) granted.set(s.data, shows.keep);
        if (!shows || shows.ask) jobs.push({ ...job(s.key, s.data), allowance: 1e9 });
      }
      client.want(jobs);
      client.keep(granted);
    };
    // Answers the jobs the worker hasn't seen yet as their sketches end.
    const serve = () => {
      const w = workers.at(-1);
      if (!w || w.terminated) return false;
      const jobs = w.jobs();
      const from = served.get(w) ?? 0;
      if (from >= jobs.length) return false;
      served.set(w, jobs.length);
      for (const j of jobs.slice(from)) {
        w.start(j);
        const ending = endingOf.get(j.data);
        if (ending === 'done') {
          w.answer(j, true);
          w.fill(j);
        } else if (ending === 'refused' || ending === 'failed') {
          const reply = ending === 'refused' ? { refused: 'no' } : { error: 'no' };
          w.onmessage?.({ data: { job: j.job, ...reply } } as MessageEvent<RegionsReply>);
        }
        // A stopped one never answers: the deadline stops it.
      }
      return true;
    };
    let seen = -1;
    const settle = () => {
      for (let i = 0; i < 100_000; i++) {
        const version = client.store.getState().version;
        if (version !== seen) {
          seen = version;
          shell();
        } else if (!serve() && !step()) return;
      }
      throw new Error('never settled');
    };
    settle();
    const posted = () => workers.reduce((n, w) => n + w.jobs().length, 0);
    const again = (passes: number) => {
      for (let i = 0; i < passes; i++) {
        shell();
        settle();
      }
    };
    return { client, sketches, posted, again };
  }

  it('asks once for each of 70 sketches stopped at the deadline and 5 after them', () => {
    const { client, sketches, posted, again } = shown([
      ...Array<Ending>(70).fill('stopped'),
      ...Array<Ending>(5).fill('done'),
    ]);
    expect(posted()).toBe(75);
    again(10);
    expect(posted()).toBe(75);
    for (const s of sketches.slice(70)) {
      const entry = client.get(s.data, 0);
      expect(entry?.regions).toBeDefined();
      expect(entry?.fill).toBeDefined();
    }
  });

  it('asks once for each of 200 refused sketches, however often the shell looks again', () => {
    const { posted, again } = shown(Array<Ending>(200).fill('refused'));
    expect(posted()).toBe(200);
    again(10);
    expect(posted()).toBe(200);
  });

  it('asks no more after the first round for any mix of endings', () => {
    const endings: Ending[] = ['done', 'refused', 'stopped', 'failed'];
    const mix = Array.from({ length: 150 }, (_, i) => endings[(i * 7 + (i >> 3)) % 4] as Ending);
    const { posted, again } = shown(mix);
    expect(posted()).toBe(150);
    again(10);
    expect(posted()).toBe(150);
  });
});

describe('closedSketchShows', () => {
  const entry = (more: Partial<RegionsEntry>): RegionsEntry => ({
    state: 'done',
    version: 0,
    text: false,
    regionBytes: 10,
    fillBytes: 10,
    fillable: true,
    ...more,
  });
  const regions = flattenRegions(detectProfiles(rectangle(1)));

  it('shows the regions while the fill is still on its way', () => {
    const shows = closedSketchShows(entry({ regions }), 'shaded');
    expect(shows.regions).toBe(regions);
    expect(shows.fill).toBeUndefined();
    expect(shows.ask).toBe(true);
  });

  it('shows regions and fill when shaded, regions alone when pickable, nothing when neither', () => {
    const fill = {
      positions: new Float32Array(),
      starts: new Uint32Array(),
      ids: [],
      regions: new Map(),
    };
    expect(closedSketchShows(entry({ regions, fill }), 'shaded')).toMatchObject({
      regions,
      fill,
      unshaded: false,
    });
    expect(closedSketchShows(entry({ regions, fill }), 'pickable')).toMatchObject({
      regions,
      unshaded: true,
    });
    const none = closedSketchShows(entry({ regions }), 'none');
    expect(none.regions).toBeUndefined();
    expect(none).toMatchObject({ unshaded: true, unpickable: true });
  });

  it('counts a stopped sketch as not shaded and not pickable', () => {
    expect(closedSketchShows(entry({ state: 'stopped' }), undefined)).toMatchObject({
      unshaded: true,
      unpickable: true,
    });
  });

  it('asks again for a fill left out for want of room once the room is there', () => {
    const one = rectangle(1);
    const { client, worker } = setup();
    client.want([{ ...job('a', one), allowance: 100 }]);
    // Regions only: the fill didn't fit what was left.
    worker().answer(undefined, false);
    const entry = client.get(one, 0) as RegionsEntry;
    expect(entry.fill).toBeUndefined();
    expect(entry.fillable).toBe(true);
    expect(closedSketchShows(entry, 'shaded').ask).toBe(true);
  });
});
