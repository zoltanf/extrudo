import { afterEach, describe, expect, it } from 'vitest';
import { SketchBuilder } from '../fixtures';
import {
  KeptResults,
  keptBytes,
  keptTotals,
  MAX_KEPT_PROFILE_BYTES,
  MAX_KEPT_PROFILE_RESULTS,
  setKeptLimits,
} from './kept';
import { detectProfiles } from './profiles';

afterEach(() => setKeptLimits());

describe('KeptResults', () => {
  it('keeps what every cache holds within one budget of bytes, the least recently used going first', () => {
    setKeptLimits(300, 100);
    const a = new KeptResults<object, string>();
    const b = new KeptResults<object, string>();
    const k = [{}, {}, {}, {}];
    a.set(k[0] as object, 'a0', 100);
    b.set(k[1] as object, 'b1', 100);
    a.set(k[2] as object, 'a2', 100);
    expect(a.get(k[0] as object)).toBe('a0'); // now the most recent
    b.set(k[3] as object, 'b3', 100);
    expect(b.get(k[1] as object)).toBeUndefined();
    expect(a.get(k[0] as object)).toBe('a0');
    expect(keptTotals().bytes).toBeLessThanOrEqual(300);
  });

  it('keeps no more results than the count, however small', () => {
    setKeptLimits(1e9, 3);
    const c = new KeptResults<object, number>();
    const keys = Array.from({ length: 10 }, () => ({}));
    keys.forEach((key, i) => {
      c.set(key, i, 0);
    });
    expect(keys.filter((key) => c.get(key) !== undefined)).toHaveLength(3);
    expect(keptTotals().results).toBeLessThanOrEqual(3);
  });

  it('does not keep a result larger than the budget', () => {
    setKeptLimits(100, 10);
    const c = new KeptResults<object, string>();
    const key = {};
    c.set(key, 'big', 101);
    expect(c.get(key)).toBeUndefined();
  });

  it('has a real budget of 64 MB and 256 results', () => {
    expect(MAX_KEPT_PROFILE_BYTES).toBe(64 * 1024 * 1024);
    expect(MAX_KEPT_PROFILE_RESULTS).toBe(256);
  });

  it('counts at least two bytes a character of every ID and 96 bytes a point', () => {
    const b = new SketchBuilder();
    b.line(0, 0, 10, 0);
    b.line(10, 0, 10, 10);
    b.line(10, 10, 0, 10);
    b.line(0, 10, 0, 0);
    b.circle(5, 5, 2);
    const profiles = detectProfiles(b.sketch);
    let points = 0;
    for (const p of profiles)
      for (const l of [p.outer, ...p.holes]) for (const e of l.edges) points += e.points.length;
    expect(keptBytes(profiles)).toBeGreaterThan(96 * points);
  });

  it('bounds what the package remembers of frozen sketches', () => {
    setKeptLimits(1e9, 2);
    const sketches = Array.from({ length: 5 }, (_, i) => {
      const b = new SketchBuilder();
      b.line(0, 0, 10 + i, 0);
      b.line(10 + i, 0, 10 + i, 10);
      b.line(10 + i, 10, 0, 10);
      b.line(0, 10, 0, 0);
      return Object.freeze({
        ...b.sketch,
        entities: Object.freeze(
          Object.fromEntries(
            Object.entries(b.sketch.entities).map(([id, e]) => [id, Object.freeze(e)]),
          ),
        ),
      }) as typeof b.sketch;
    });
    for (const data of sketches) detectProfiles(data);
    expect(keptTotals().results).toBeLessThanOrEqual(2);
  });
});
