/**
 * The limits of profile detection (ADR-0020's amendment of 2026-11-15): a
 * sketch with more than `MAX_PROFILE_CUTS` cuts inside its curves, or more
 * cuts of any kind than that plus `PROFILE_CUTS_PER_SEGMENT` per segment, is
 * refused while it is being cut, cheaply; one with a curve past
 * `MAX_PROFILE_COORDINATE` before any pair is tested; one with too many
 * segments, sample points or tests of things near each other
 * (`MAX_PROFILE_SEGMENTS`, `MAX_PROFILE_POINTS`, `MAX_PROFILE_TESTS`) as soon
 * as it has them. A sketch under the limits gives exactly the regions it gave
 * before they existed.
 */
import { createHash } from 'node:crypto';
import type { SketchData } from '@extrudo/core';
import { describe, expect, it, vi } from 'vitest';
import { gear, plate, SketchBuilder } from '../fixtures';
import * as geometry from '../inference/geometry';
import * as pairs from './pairs';
import {
  detectProfiles,
  detectProfilesAllPairs,
  detectProfilesWork,
  MAX_PROFILE_COORDINATE,
  MAX_PROFILE_CUTS,
  MAX_PROFILE_POINTS,
  MAX_PROFILE_SEGMENTS,
  MAX_PROFILE_TESTS,
  PROFILE_CUTS_PER_SEGMENT,
  ProfilesRefusedError,
  profilesRefusal,
  TOO_LARGE_COORDINATES,
  TOO_MANY_CROSSINGS,
  TOO_MANY_CURVES,
  type Work,
} from './profiles';

// Counts the crossing tests, the work the refusal must cut short, and the
// pair searches by grid.
vi.mock('../inference/geometry', async (original) => {
  const actual = await original<typeof geometry>();
  return { ...actual, intersectCurves: vi.fn(actual.intersectCurves) };
});
vi.mock('./pairs', async (original) => {
  const actual = await original<typeof pairs>();
  return { ...actual, nearPairsWithin: vi.fn(actual.nearPairsWithin) };
});
const intersections = vi.mocked(geometry.intersectCurves);
const grids = vi.mocked(pairs.nearPairsWithin);

/** What `detectProfiles` threw, or `undefined`. */
function refusalOf(data: SketchData): ProfilesRefusedError | undefined {
  try {
    detectProfiles(data);
  } catch (error) {
    if (error instanceof ProfilesRefusedError) return error;
    throw error;
  }
  return undefined;
}

/** A closed polyline of `n` short lines around a circle of radius `r`, each starting where the last ends. */
function polyline(b: SketchBuilder, n: number, r = 1000): SketchBuilder {
  const at = (k: number): [number, number] => {
    const a = (2 * Math.PI * k) / n;
    return [r * Math.cos(a), r * Math.sin(a)];
  };
  for (let k = 0; k < n; k++) b.line(...at(k), ...at(k + 1));
  return b;
}

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
  it('is 20,000 cuts: about 10,000 crossings', () => {
    expect(MAX_PROFILE_CUTS).toBe(20_000);
  });

  it('accepts a sketch with exactly the limit and refuses one cut more', () => {
    // 100 rows crossing MAX_PROFILE_CUTS / 200 columns: exactly the limit.
    const rows = 100;
    const columns = MAX_PROFILE_CUTS / (2 * rows);
    const b = grid(rows, columns);
    const at = detectProfiles(b.sketch);
    expect(at).toHaveLength((rows - 1) * (columns - 1));
    // A short line from inside a cell to a grid line: one cut more (its own end is not inside it).
    b.line(1.5, 1.5, 1.5, 2);
    expect(refusalOf(b.sketch)?.reason).toBe('crossings');
  }, 60_000);

  it('counts only cuts inside curves against the limit: a 60,000-line polyline passes', () => {
    expect(detectProfiles(polyline(new SketchBuilder(), 60_000).sketch)).toHaveLength(1);
  }, 60_000);

  it('bounds the cuts of curves that only meet at their ends too', () => {
    // n lines from one point: each pair cuts four times at it, none inside a curve.
    const star = (n: number, stacked = false) => {
      const b = new SketchBuilder();
      for (let i = 0; i < n; i++) {
        const a = stacked ? 0 : (2 * Math.PI * i) / n;
        b.line(0, 0, 10 * Math.cos(a), 10 * Math.sin(a));
      }
      return b.sketch;
    };
    const under = Math.floor(Math.sqrt(MAX_PROFILE_CUTS / 2)) - 10;
    const over = Math.ceil(Math.sqrt(MAX_PROFILE_CUTS / 2)) + 20;
    expect(2 * under * (under - 1)).toBeLessThan(MAX_PROFILE_CUTS);
    expect(2 * over * (over - 1)).toBeGreaterThan(
      MAX_PROFILE_CUTS + PROFILE_CUTS_PER_SEGMENT * over,
    );
    expect(detectProfiles(star(under))).toHaveLength(0);
    for (const data of [star(over), star(over, true)]) {
      intersections.mockClear();
      expect(refusalOf(data)?.reason).toBe('crossings');
      expect(intersections.mock.calls.length).toBeLessThan(MAX_PROFILE_CUTS);
    }
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
    expect(error).toBeInstanceOf(ProfilesRefusedError);
    expect((error as Error).message).toBe(TOO_MANY_CROSSINGS);
    // Each pair of chords crosses once (two cuts): the limit is reached
    // after about half as many pairs as it allows cuts.
    expect(intersections.mock.calls.length).toBeLessThan(MAX_PROFILE_CUTS);
  }, 60_000);

  it('says so in the user’s words, and is known again behind a cause', () => {
    expect(TOO_MANY_CROSSINGS).toBe(
      'This sketch has too many curve crossings to find its profiles. Remove or simplify curves.',
    );
    expect(TOO_LARGE_COORDINATES).toBe(
      'This sketch has coordinates too large to find its profiles.',
    );
    expect(new ProfilesRefusedError('size').message).toBe(TOO_LARGE_COORDINATES);
    const refusal = new ProfilesRefusedError('crossings');
    expect(profilesRefusal(refusal)).toBe(refusal);
    expect(profilesRefusal(new Error('wrapped', { cause: refusal }))).toBe(refusal);
    expect(profilesRefusal(new Error(TOO_MANY_CROSSINGS))).toBeUndefined();
  });
});

describe('the coordinate limit', () => {
  it('is 1,000 km', () => {
    expect(MAX_PROFILE_COORDINATE).toBe(1e9);
  });

  it('accepts curves out to the limit and refuses one past it before testing any pair', () => {
    const square = (r: number) => {
      const b = new SketchBuilder();
      b.line(-r, -r, r, -r);
      b.line(r, -r, r, r);
      b.line(r, r, -r, r);
      b.line(-r, r, -r, -r);
      return b;
    };
    expect(detectProfiles(square(MAX_PROFILE_COORDINATE).sketch)).toHaveLength(1);
    // A large polyline and one line far out (past any grid, too).
    const far = polyline(new SketchBuilder(), 40_000);
    far.line(0, 0, 2 * MAX_PROFILE_COORDINATE, 0);
    const circle = new SketchBuilder();
    circle.circle(0, 0, 2 * MAX_PROFILE_COORDINATE);
    const long = new SketchBuilder();
    for (let i = 0; i < 50; i++) long.line(0, i * 1e148, 1.5e154, -(i * 1e148) / 9);
    for (const data of [far.sketch, circle.sketch, long.sketch]) {
      intersections.mockClear();
      const refusal = refusalOf(data);
      expect(refusal?.reason).toBe('size');
      expect(refusal?.message).toBe(TOO_LARGE_COORDINATES);
      expect(intersections).not.toHaveBeenCalled();
    }
  }, 60_000);

  it('passes over a curve at no number, keeping the grid and the regions', () => {
    // A degenerate line (NaN) meets nothing: it stays out of the pair search.
    const b = polyline(new SketchBuilder(), 2_000);
    b.line(Number.NaN, 0, 5, 5);
    grids.mockClear();
    const found = detectProfiles(b.sketch);
    expect(grids).toHaveBeenCalledTimes(1);
    expect(found).toHaveLength(1);
    expect(found).toStrictEqual(detectProfilesAllPairs(b.sketch));
  }, 60_000);
});

/** What detection did for `data`, refused or not. */
function workOf(data: SketchData): Work & { reason?: string } {
  const work: Work = { segments: 0, points: 0, tests: 0 };
  try {
    detectProfilesWork(data, work);
  } catch (error) {
    if (error instanceof ProfilesRefusedError) return { ...work, reason: error.reason };
    throw error;
  }
  return work;
}

/** `n` circles of one centre, each inside the next: no curve cuts another. */
function nested(n: number, step = 0.01): SketchData {
  const b = new SketchBuilder();
  for (let i = 0; i < n; i++) b.circle(0, 0, 1 + i * step);
  return b.sketch;
}

describe('the curve limits', () => {
  it('are 200,000 segments, 2 million points and 10 million tests', () => {
    expect(MAX_PROFILE_SEGMENTS).toBe(200_000);
    expect(MAX_PROFILE_POINTS).toBe(2_000_000);
    expect(MAX_PROFILE_TESTS).toBe(10_000_000);
  });

  it('counts a line as one segment and one point, a circle by its samples', () => {
    expect(workOf(polyline(new SketchBuilder(), 1000).sketch)).toMatchObject({
      segments: 1000,
      points: 1000,
    });
    const big = new SketchBuilder();
    big.circle(0, 0, 1000);
    const small = new SketchBuilder();
    small.circle(0, 0, 1);
    expect(workOf(big.sketch)).toMatchObject({ segments: 1, points: 2048 });
    expect(workOf(small.sketch)).toMatchObject({ segments: 1, points: 96 });
  });

  it('refuses one segment more than the limit before testing any pair', () => {
    const data = polyline(new SketchBuilder(), MAX_PROFILE_SEGMENTS + 1).sketch;
    intersections.mockClear();
    const refusal = refusalOf(data);
    expect(refusal?.reason).toBe('curves');
    expect(refusal?.message).toBe(TOO_MANY_CURVES);
    expect(intersections).not.toHaveBeenCalled();
  }, 60_000);

  it('refuses circles of more points than the limit before testing any pair', () => {
    // Circles of 1 m, apart: 2,048 points each.
    const circles = (n: number) => {
      const b = new SketchBuilder();
      for (let i = 0; i < n; i++) b.circle((i % 40) * 2100, Math.floor(i / 40) * 2100, 1000);
      return b.sketch;
    };
    const over = Math.floor(MAX_PROFILE_POINTS / 2048) + 1;
    intersections.mockClear();
    expect(refusalOf(circles(over))?.reason).toBe('curves');
    expect(intersections).not.toHaveBeenCalled();
    expect(workOf(circles(100))).toMatchObject({ points: 204_800 });
  });

  it('counts each pair of curves whose boxes meet, and each nesting test', () => {
    // 100 nested circles: every pair's boxes meet, and each circle's
    // outline is tested against the regions around it.
    const work = workOf(nested(100));
    expect(work.reason).toBeUndefined();
    expect(work.tests).toBeGreaterThan((100 * 99) / 2);
    // Apart, they cost a few tests each.
    const b = new SketchBuilder();
    for (let i = 0; i < 3000; i++) b.circle((i % 60) * 3, Math.floor(i / 60) * 3, 1);
    expect(workOf(b.sketch).tests).toBeLessThan(20 * 3000);
  });

  it('charges the pair search, not only the pairs whose boxes meet', () => {
    // Short lines packed in one cell of the longer lines: no two boxes meet.
    const b = new SketchBuilder();
    const n = 3000;
    const side = Math.ceil(Math.sqrt(n));
    for (let k = 0; k < n; k++) {
      const x = (k % side) * 1e-3;
      const y = Math.floor(k / side) * 1e-3;
      b.line(x, y, x + 2e-4, y);
    }
    for (let k = 0; k < n + 2; k++) b.line(1000, 100 + k, 1010, 100 + k);
    const work = workOf(b.sketch);
    expect(work.tests).toBeGreaterThan(work.segments);
    expect(work.tests).toBeLessThan(20 * work.segments);
  });

  it('refuses curves nested too deep once the tests pass the limit', () => {
    // About 4,500 circles make 10 million pairs whose boxes meet.
    const work = workOf(nested(4500));
    expect(work.reason).toBe('curves');
    // Refused as the tests pass the limit, one cell's boxes at most later.
    expect(work.tests).toBeGreaterThan(MAX_PROFILE_TESTS);
    expect(work.tests).toBeLessThan(MAX_PROFILE_TESTS + 4500);
    // Nested squares of lines: their boxes don't meet, the outlines' tests count.
    const squares = new SketchBuilder();
    for (let i = 0; i < 4000; i++) {
      const r = 1 + i * 0.01;
      squares.line(-r, -r, r, -r);
      squares.line(r, -r, r, r);
      squares.line(r, r, -r, r);
      squares.line(-r, r, -r, -r);
    }
    expect(workOf(squares.sketch).reason).toBe('curves');
  }, 60_000);

  it('says so in the user’s words', () => {
    expect(TOO_MANY_CURVES).toBe(
      'This sketch has too many curves to find its profiles. Remove or simplify curves.',
    );
    expect(new ProfilesRefusedError('curves').message).toBe(TOO_MANY_CURVES);
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
      data: () => plate({ entities: 90, layout: 'anchored' }).builder.sketch,
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
