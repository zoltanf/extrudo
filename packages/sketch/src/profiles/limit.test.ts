/**
 * The crossing limit of profile detection (ADR-0020's amendment of
 * 2026-11-15): a sketch with more than `MAX_PROFILE_CUTS` cuts inside its
 * curves is refused while it is being cut, cheaply, and a sketch under the
 * limit gives exactly the regions it gave before the limit existed.
 */
import { createHash } from 'node:crypto';
import type { SketchData } from '@extrudo/core';
import { describe, expect, it, vi } from 'vitest';
import { gear, plate, SketchBuilder } from '../fixtures';
import * as geometry from '../inference/geometry';
import {
  detectProfiles,
  isTooManyCrossings,
  MAX_PROFILE_CUTS,
  TOO_MANY_CROSSINGS,
  TooManyCrossingsError,
} from './profiles';

// Counts the crossing tests, the work the refusal must cut short.
vi.mock('../inference/geometry', async (original) => {
  const actual = await original<typeof geometry>();
  return { ...actual, intersectCurves: vi.fn(actual.intersectCurves) };
});
const intersections = vi.mocked(geometry.intersectCurves);

/**
 * `rows` horizontal and `columns` vertical lines, each crossing every line of
 * the other kind away from both ends: 2 · rows · columns cuts inside curves.
 */
function grid(rows: number, columns: number): SketchBuilder {
  const b = new SketchBuilder();
  for (let i = 1; i <= rows; i++) b.line(0, i, columns + 1, i);
  for (let j = 1; j <= columns; j++) b.line(j, 0, j, rows + 1);
  return b;
}

/** `n` chords of a circle that all cross each other: about n²/2 crossings. */
function chords(n: number): SketchData {
  const b = new SketchBuilder();
  for (let i = 0; i < n; i++) {
    const a = (Math.PI * i) / n;
    b.line(
      100 * Math.cos(a),
      100 * Math.sin(a),
      -100 * Math.cos(a + 0.3),
      -100 * Math.sin(a + 0.3),
    );
  }
  return b.sketch;
}

describe('the crossing limit', () => {
  it('is 100,000 cuts: about 50,000 crossings', () => {
    expect(MAX_PROFILE_CUTS).toBe(100_000);
  });

  it('accepts a sketch with exactly the limit and refuses one cut more', () => {
    // 200 × 250 crossings: 100,000 cuts.
    const b = grid(200, 250);
    const at = detectProfiles(b.sketch);
    expect(at).toHaveLength(199 * 249);
    // A short line from inside a cell to a grid line: one cut more (its own end is not inside it).
    b.line(1.5, 1.5, 1.5, 2);
    expect(() => detectProfiles(b.sketch)).toThrow(TooManyCrossingsError);
  }, 60_000);

  it('counts only cuts inside curves: curves meeting end to end cut nothing', () => {
    // A closed polyline of 60,000 short lines, each starting where the last ends.
    const b = new SketchBuilder();
    const n = 60_000;
    const at = (k: number): [number, number] => {
      const a = (2 * Math.PI * k) / n;
      return [1000 * Math.cos(a), 1000 * Math.sin(a)];
    };
    for (let k = 0; k < n; k++) b.line(...at(k), ...at(k + 1));
    expect(detectProfiles(b.sketch)).toHaveLength(1);
  }, 60_000);

  it('refuses 100,000 crossing lines after a few crossing tests, not 5 billion', () => {
    const data = chords(100_000);
    intersections.mockClear();
    let error: unknown;
    try {
      detectProfiles(data);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(TooManyCrossingsError);
    expect((error as Error).message).toBe(TOO_MANY_CROSSINGS);
    // Each pair of chords crosses once (two cuts): the limit is reached
    // after about half as many pairs as it allows cuts.
    expect(intersections.mock.calls.length).toBeLessThan(MAX_PROFILE_CUTS);
  }, 60_000);

  it('says so in the user’s words, and is known again behind a cause', () => {
    expect(TOO_MANY_CROSSINGS).toBe(
      'This sketch has too many curve crossings to find its profiles. Remove or simplify curves.',
    );
    const refusal = new TooManyCrossingsError();
    expect(isTooManyCrossings(refusal)).toBe(true);
    expect(isTooManyCrossings(new Error('wrapped', { cause: refusal }))).toBe(true);
    expect(isTooManyCrossings(new Error(TOO_MANY_CROSSINGS))).toBe(false);
  });
});

/** The whole output of `detectProfiles`, as a digest: IDs, areas, loops, edges and their points. */
function digest(data: SketchData): string {
  const json = JSON.stringify(detectProfiles(data), (_, v) =>
    typeof v === 'number' && !Number.isFinite(v) ? String(v) : Object.is(v, -0) ? '-0' : v,
  );
  return createHash('sha256').update(json).digest('hex').slice(0, 16);
}

/**
 * Sketches under the limit are as they were (recorded on the code before
 * the limit): the same regions, IDs and points, to the bit.
 */
describe('sketches under the limit', () => {
  const weave = () => {
    const b = new SketchBuilder();
    for (let i = 0; i < 12; i++)
      b.spline(
        Array.from({ length: 10 }, (_, j): [number, number] => [
          10 * j,
          10 * Math.sin(j * 0.9 + i * 2.39996),
        ]),
      );
    return b.sketch;
  };
  const circles = () => {
    const b = new SketchBuilder();
    for (let i = 0; i < 20; i++) {
      const a = (2 * Math.PI * i) / 20;
      b.circle(5 * Math.cos(a), 5 * Math.sin(a), 30);
    }
    return b.sketch;
  };
  const CASES: Record<string, { data: () => SketchData; regions: number; digest: string }> = {
    plate: {
      data: () => plate({ entities: 90 }).builder.sketch,
      regions: 30,
      digest: '29abdbde9dff4d9b',
    },
    gear: {
      data: () => gear({ teeth: 12 }).builder.sketch,
      regions: 1,
      digest: 'fa36811417539c00',
    },
    grid: { data: () => grid(20, 30).sketch, regions: 551, digest: 'c0ef028188368e8f' },
    chords: { data: () => chords(60), regions: 1696, digest: '78539f7b2dd72e76' },
    circles: { data: circles, regions: 381, digest: '1c5a028c7f17f9f1' },
    splines: { data: weave, regions: 160, digest: 'ee1ac73708529425' },
  };
  for (const [name, c] of Object.entries(CASES)) {
    it(`${name}: ${c.regions} regions, unchanged`, () => {
      const data = c.data();
      expect(detectProfiles(data)).toHaveLength(c.regions);
      expect(digest(data)).toBe(c.digest);
    });
  }
});
