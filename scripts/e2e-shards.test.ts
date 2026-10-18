import { describe, expect, it } from 'vitest';
import { parseShard, planShards } from './e2e-shards';

describe('planShards', () => {
  it('deals the longest files first to the least loaded shard', () => {
    const plan = planShards(['a', 'b', 'c', 'd', 'e'], { a: 10, b: 8, c: 6, d: 4, e: 2 }, 2);
    // a→1 (10), b→2 (8), c→2 (14), d→1 (14), e→1 (16).
    expect(plan).toEqual([
      { files: ['a', 'd', 'e'], seconds: 16 },
      { files: ['b', 'c'], seconds: 14 },
    ]);
  });

  it('gives an unknown file the median of the known ones and does not depend on input order', () => {
    const timings = { a: 1, b: 5, c: 100 };
    const forward = planShards(['a', 'b', 'c', 'new'], timings, 2);
    const backward = planShards(['new', 'c', 'b', 'a'], timings, 2);
    expect(forward).toEqual(backward);
    expect(forward.reduce((sum, shard) => sum + shard.seconds, 0)).toBe(111);
  });

  it('spreads files with no timings at all by count', () => {
    const plan = planShards(['a', 'b', 'c', 'd', 'e'], {}, 3);
    expect(plan.map((shard) => shard.files.length)).toEqual([2, 2, 1]);
  });

  it('places every file exactly once', () => {
    const files = Array.from({ length: 23 }, (_, i) => `f${i}`);
    const timings = Object.fromEntries(files.map((f, i) => [f, (i * 7) % 11]));
    const plan = planShards(files, timings, 3);
    expect(plan.flatMap((shard) => shard.files).sort()).toEqual([...files].sort());
  });
});

describe('parseShard', () => {
  it('reads <current>/<total> and rejects the rest', () => {
    expect(parseShard(undefined)).toBeUndefined();
    expect(parseShard('')).toBeUndefined();
    expect(parseShard('2/3')).toEqual({ current: 2, total: 3 });
    for (const bad of ['3/2', '0/2', 'x', '1-2']) expect(() => parseShard(bad)).toThrow();
  });
});
