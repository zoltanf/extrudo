import type { SketchData } from '@extrudo/core';
import { detectProfiles } from '@extrudo/sketch/profiles';
import { describe, expect, it } from 'vitest';
import { flattenRegions } from './flatRegions';
import {
  createRegionsClient,
  hasText,
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
  /** Answers the last job as the real worker would. */
  answer(job = this.jobs().at(-1)) {
    if (!job) throw new Error('no job');
    const profiles = detectProfiles(job.data);
    const regions = flattenRegions(profiles);
    this.onmessage?.({
      data: { job: job.job, regions, vertices: 6 },
    } as MessageEvent<RegionsReply>);
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
  return { client, workers, advance, idle, worker: () => workers.at(-1) as FakeWorker };
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
});
