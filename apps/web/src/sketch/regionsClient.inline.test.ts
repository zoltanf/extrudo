import type { SketchData } from '@extrudo/core';
import { detectProfiles } from '@extrudo/sketch/profiles';
import { describe, expect, it, vi } from 'vitest';
import { fillWork } from '../viewport/profileFills';
import { createRegionsClient, type RegionsJob } from './regionsClient';

// The design's fill work, lowered so one sketch's fill fits and two don't.
const limits = vi.hoisted(() => ({ design: Number.POSITIVE_INFINITY }));
vi.mock('@extrudo/sketch/profiles', async (original) => ({
  ...(await original<typeof import('@extrudo/sketch/profiles')>()),
  get MAX_DESIGN_FILL_WORK() {
    return limits.design;
  },
}));

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

describe('the profile client on the UI thread', () => {
  it("doesn't count a sketch's own earlier fill against it when it is asked again", () => {
    const data = rectangle(4);
    const work = fillWork(detectProfiles(data));
    expect(work).toBeGreaterThan(0);
    limits.design = 1.5 * work;
    const idle: (() => void)[] = [];
    const client = createRegionsClient({
      spawn: () => undefined,
      idle: (run) => idle.push(run),
      batch: 0,
    });
    const job: RegionsJob = { key: 'a', data, version: 0, text: false, allowance: 1e9 };
    const run = () => {
      client.want([job]);
      while (idle.length > 0) idle.shift()?.();
    };
    run();
    expect(client.get(data, 0)?.fill).toBeDefined();
    // Not shaded for a while, its fill goes; shaded again, it is asked for again and built.
    client.keep(new Map([[data, 'pickable']]));
    expect(client.get(data, 0)?.fill).toBeUndefined();
    run();
    expect(client.get(data, 0)?.fill).toBeDefined();
    expect(client.get(data, 0)?.fillable).toBe(true);
    client.dispose();
  });
});
