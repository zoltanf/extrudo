import type { SketchData } from '@extrudo/core';
import { describe, expect, it } from 'vitest';
import { SketchBuilder } from '../fixtures';
import { BoxesAt, nearPairsWithin, type PairSearchStats } from './pairs';
import { detectProfiles, detectProfilesAllPairs, MAX_PROFILE_COORDINATE } from './profiles';

/** mulberry32: a small seeded generator, so a failure repeats. */
function random(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Every pair of boxes that are not apart, in the order of a test of every pair. */
function allPairs(boxes: Float64Array): [number, number][] {
  const n = boxes.length / 4;
  const out: [number, number][] = [];
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++) {
      const apart =
        (boxes[4 * i] as number) > (boxes[4 * j + 2] as number) ||
        (boxes[4 * j] as number) > (boxes[4 * i + 2] as number) ||
        (boxes[4 * i + 1] as number) > (boxes[4 * j + 3] as number) ||
        (boxes[4 * j + 1] as number) > (boxes[4 * i + 3] as number);
      if (!apart) out.push([i, j]);
    }
  return out;
}

describe('nearPairsWithin', () => {
  it('yields the pairs a test of every pair finds, in its order', () => {
    const rnd = random(7);
    for (let round = 0; round < 300; round++) {
      const n = 1 + Math.floor(rnd() * 400);
      const kind = round % 7;
      const boxes = new Float64Array(4 * n);
      for (let i = 0; i < n; i++) {
        // Short boxes on a lattice (they touch and repeat), a few long ones,
        // a dense cluster far from an outlier, and boxes of no size.
        const lattice = (v: number) => Math.round(v * 8) / 8;
        let x = lattice(rnd() * 20);
        let y = lattice(rnd() * 20);
        let w = lattice(rnd() * (rnd() < 0.1 ? 20 : 1));
        let h = lattice(rnd() * (rnd() < 0.1 ? 20 : 1));
        if (kind === 1) {
          x = rnd() * 0.01;
          y = rnd() * 0.01;
          w = rnd() * 0.001;
          h = rnd() * 0.001;
          if (i === 0) x = 1e6;
        } else if (kind === 2) {
          w = 0;
          h = rnd() < 0.5 ? 0 : h;
        } else if (kind === 3) {
          y = 0;
          h = rnd() * 1e-6;
          w = rnd() < 0.05 ? 100 : 0.01;
        } else if (kind >= 4) {
          // Grids of several levels: long and tall boxes of many lengths
          // among short ones, which meet in a wider level's grid or in one
          // only as wide as one of them; far out too (kind 6).
          const r = rnd();
          const long = lattice(2 ** Math.floor(rnd() * 8) * (0.5 + rnd()));
          if (r < 0.25) w = long;
          else if (r < 0.5) h = long;
          else if (r < 0.6) {
            w = long;
            h = lattice(2 ** Math.floor(rnd() * 8) * rnd());
          }
          if (kind === 5) {
            x = lattice(rnd() * 200) - 100;
            y = lattice(rnd() * 200) - 100;
          }
          if (kind === 6 && i < 2) x = i === 0 ? 1e9 : -1e9;
        }
        boxes.set([x, y, x + w, y + h], 4 * i);
      }
      expect([...nearPairsWithin(boxes)]).toStrictEqual(allPairs(boxes));
    }
  });
});

describe('BoxesAt', () => {
  it('gives the boxes that hold a point, ascending, as a test of every box does', () => {
    const rnd = random(11);
    for (let round = 0; round < 200; round++) {
      const n = 1 + Math.floor(rnd() * 300);
      const lattice = (v: number) => Math.round(v * 4) / 4;
      const boxes = new Float64Array(4 * n);
      for (let i = 0; i < n; i++) {
        const x = lattice(rnd() * 50);
        const y = lattice(rnd() * 50);
        const w = lattice(rnd() * (rnd() < 0.2 ? 60 : 3));
        const h = lattice(rnd() * (rnd() < 0.2 ? 60 : 3));
        boxes.set([x, y, x + w, y + h], 4 * i);
        if (round % 5 === 0 && i === 0) boxes[0] = Number.NaN;
      }
      const index = new BoxesAt(boxes);
      for (let k = 0; k < 50; k++) {
        const p: [number, number] = [lattice(rnd() * 60 - 5), lattice(rnd() * 60 - 5)];
        const every: number[] = [];
        for (let i = 0; i < n; i++) {
          const x0 = boxes[4 * i] as number;
          const y0 = boxes[4 * i + 1] as number;
          const x1 = boxes[4 * i + 2] as number;
          const y1 = boxes[4 * i + 3] as number;
          if (Number.isNaN(x0) || (x0 <= p[0] && p[0] <= x1 && y0 <= p[1] && p[1] <= y1))
            every.push(i);
        }
        expect(index.at(p)).toStrictEqual(every);
      }
    }
  });
});

/** A random sketch on a coarse lattice, so curves cross, touch, overlap and share ends. */
function randomSketch(rnd: () => number): SketchData {
  const b = new SketchBuilder();
  const p = () => Math.round(rnd() * 8) as number;
  const curves = 3 + Math.floor(rnd() * 25);
  for (let k = 0; k < curves; k++) {
    const kind = rnd();
    if (kind < 0.45) {
      const x = p();
      const y = p();
      // Axis-aligned half the time: collinear overlaps and T-junctions.
      if (rnd() < 0.5) b.line(x, y, rnd() < 0.5 ? x : p(), rnd() < 0.5 ? y : p());
      else b.line(x, y, p(), p());
    } else if (kind < 0.6) {
      b.circle(p(), p(), 1 + Math.floor(rnd() * 3));
    } else if (kind < 0.75) {
      const from = (Math.floor(rnd() * 8) * Math.PI) / 4;
      b.arc(
        p(),
        p(),
        1 + Math.floor(rnd() * 3),
        from,
        from + (1 + Math.floor(rnd() * 7)) * (Math.PI / 4),
      );
    } else {
      const poles = 3 + Math.floor(rnd() * 6);
      const points = Array.from({ length: poles }, () => [p(), p()] as [number, number]);
      b.spline(points, { mode: rnd() < 0.5 ? 'control' : 'fit', closed: rnd() < 0.2 });
    }
  }
  return b.sketch;
}

/** The boxes a detection hands the pair search for these lines (with its padding of twice the tolerance). */
function lineBoxes(lines: readonly [number, number, number, number][]): Float64Array {
  const boxes = new Float64Array(4 * lines.length);
  lines.forEach(([x0, y0, x1, y1], i) => {
    boxes.set(
      [
        Math.min(x0, x1) - 2e-4,
        Math.min(y0, y1) - 2e-4,
        Math.max(x0, x1) + 2e-4,
        Math.max(y0, y1) + 2e-4,
      ],
      4 * i,
    );
  });
  return boxes;
}

function pairTests(boxes: Float64Array): { tests: number; pairs: number } {
  const stats: PairSearchStats = { tests: 0 };
  let pairs = 0;
  for (const _ of nearPairsWithin(boxes, stats)) pairs++;
  return { tests: stats.tests, pairs };
}

describe('nearPairsWithin compares a few boxes per box', () => {
  /** A closed polyline of n lines on a circle of radius 1 m. */
  const polyline = (n: number) =>
    Array.from({ length: n }, (_, k): [number, number, number, number] => {
      const at = (k: number) => [
        1000 * Math.cos((2 * Math.PI * k) / n),
        1000 * Math.sin((2 * Math.PI * k) / n),
      ];
      return [...at(k), ...at(k + 1)] as [number, number, number, number];
    });

  it("keeps its cell size whatever the sketch's extent", () => {
    const n = 20_000;
    const near = pairTests(lineBoxes(polyline(n)));
    const far = pairTests(
      lineBoxes([
        ...polyline(n),
        [MAX_PROFILE_COORDINATE - 1, 0, MAX_PROFILE_COORDINATE, 0],
        [-MAX_PROFILE_COORDINATE, 0, -MAX_PROFILE_COORDINATE + 1, 0],
      ]),
    );
    expect(far.pairs).toBe(near.pairs);
    // Each box: its cells made and looked up, and the boxes there.
    expect(near.tests).toBeLessThan(10 * n);
    expect(far.tests).toBeLessThan(15 * n);
  });

  it('tests a box much longer than most only against the boxes near it', () => {
    // n short dashes, and n long lines 0.01 mm apart: no two boxes meet.
    const n = 5000;
    const lines: [number, number, number, number][] = [];
    for (let i = 0; i <= n; i++) {
      const x = -100 + (i % 100) * 0.05;
      const y = -10 - Math.floor(i / 100) * 0.05;
      lines.push([x, y, x + 0.01, y]);
    }
    for (let i = 0; i < n; i++) lines.push([0, i * 0.01, 1000, i * 0.01]);
    const { tests, pairs } = pairTests(lineBoxes(lines));
    expect(pairs).toBe(0);
    expect(tests).toBeLessThan(10 * lines.length);
  });

  it('tests long and tall boxes of a hatch only against the boxes near them', () => {
    // Long lines left, tall lines right, short dashes below: none meet.
    const n = 3000;
    const lines: [number, number, number, number][] = [];
    for (let i = 0; i < n; i++) lines.push([0, i * 0.01, 500, i * 0.01]);
    for (let i = 0; i < n; i++) lines.push([600 + i * 0.01, 0, 600 + i * 0.01, 500]);
    for (let i = 0; i <= 2 * n; i++) lines.push([i * 0.05, -10, i * 0.05 + 0.01, -10]);
    const { tests, pairs } = pairTests(lineBoxes(lines));
    expect(pairs).toBe(0);
    expect(tests).toBeLessThan(20 * lines.length);
  });
});

describe('nearPairsWithin charges all its work', () => {
  it('puts boxes much smaller than most in finer cells: a few tests per box', () => {
    // n tiny boxes 0.001 mm apart in one 0.3 mm square, and n + 2 lines of
    // 10 mm elsewhere that set the base cell: none meet.
    const n = 4000;
    const lines: [number, number, number, number][] = [];
    const side = Math.ceil(Math.sqrt(n));
    for (let k = 0; k < n; k++) {
      const x = (k % side) * 1e-3;
      const y = Math.floor(k / side) * 1e-3;
      lines.push([x, y, x + 2e-4, y]);
    }
    for (let k = 0; k < n + 2; k++) lines.push([1000, 100 + k, 1010, 100 + k]);
    const { tests, pairs } = pairTests(lineBoxes(lines));
    expect(pairs).toBe(0);
    expect(tests).toBeLessThan(20 * lines.length);
  });

  it('charges every level a box looks in, and every box kept in a wider level', () => {
    // Long flat lines of many widths far off, and many short tall lines:
    // each tall line looks in every wider level of its height.
    const lines: [number, number, number, number][] = [];
    const widths = 20;
    for (let a = 1; a <= widths; a++) lines.push([-1e6, -1 - a, -1e6 + 2 ** a, -1 - a]);
    const n = 2000;
    for (let k = 0; k < n; k++) lines.push([k, 0, k, 50]);
    for (let k = 0; k < n; k++) lines.push([k + 0.5, 60, k + 0.5 + 1e-3, 60]);
    const { tests } = pairTests(lineBoxes(lines));
    expect(tests).toBeGreaterThan(n * widths);
  });

  it('keeps cell numbers exact when every box lies within one base side', () => {
    // Half the boxes span the whole extent, the rest are points in it.
    const n = 200;
    const boxes = new Float64Array(4 * n);
    for (let i = 0; i < n; i++) {
      const v = i / n;
      boxes.set(i % 2 ? [0, 0, 1, 1] : [v, v, v, v], 4 * i);
    }
    expect([...nearPairsWithin(boxes)]).toStrictEqual(allPairs(boxes));
  });

  it('refuses through its budget as soon as the work passes it', () => {
    const lines: [number, number, number, number][] = [];
    for (let k = 0; k < 5000; k++) lines.push([k, 0, k + 0.5, 0]);
    const stats: PairSearchStats = { tests: 0 };
    let refused = 0;
    expect(() => {
      for (const _ of nearPairsWithin(lineBoxes(lines), stats, {
        limit: 1000,
        refuse: () => {
          refused = stats.tests;
          throw new Error('over');
        },
      }));
    }).toThrow('over');
    expect(refused).toBeGreaterThan(1000);
    expect(refused).toBeLessThan(1100);
  });
});

describe('detectProfiles with the pair search', () => {
  it('finds the same regions as testing every pair, to the last bit (fixed seed)', () => {
    const rnd = random(20261110);
    let regions = 0;
    for (let round = 0; round < 250; round++) {
      const data = randomSketch(rnd);
      const found = detectProfiles(data);
      // toStrictEqual tells 0 from -0 and compares every coordinate exactly.
      expect(found).toStrictEqual(detectProfilesAllPairs(data));
      regions += found.length;
    }
    expect(regions).toBeGreaterThan(1000);
    // 3.7–5.5 s on CI's runners for the same code: past Vitest's default 5 s.
  }, 20_000);
});

/** Two splines of `n` control points zig-zagging across each other along x. */
function crossingSplines(n: number): SketchData {
  const b = new SketchBuilder();
  for (const phase of [0, 1])
    b.spline(
      Array.from({ length: n }, (_, i) => [(10 * i) / (n - 1), ((i + phase) % 2) * 0.5]),
      { mode: 'control' },
    );
  return b.sketch;
}

describe('large sketches (ADR-0020, amendment of 2026-11-10)', () => {
  it('two crossing splines of 2,000 poles each take seconds, not minutes', () => {
    // Every pair of their 64,000 segments took over a minute before.
    const t = performance.now();
    const profiles = detectProfiles(crossingSplines(2000));
    expect(profiles).toHaveLength(1998);
    expect(performance.now() - t).toBeLessThan(15_000);
  }, 30_000);

  it('takes a spline of more segments than a call takes arguments', () => {
    // 10,000 poles: 160,000 segments, a RangeError (a spread) before.
    const b = new SketchBuilder();
    const n = 10_000;
    b.spline(
      Array.from({ length: n }, (_, i) => [(100 * i) / (n - 1), (i % 2) * 0.5]),
      { mode: 'control' },
    );
    b.line(100, 0.5, 0, 0);
    const profiles = detectProfiles(b.sketch);
    expect(profiles.length).toBeGreaterThan(0);
  }, 30_000);
});
