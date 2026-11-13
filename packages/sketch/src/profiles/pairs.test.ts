import type { SketchData } from '@extrudo/core';
import { describe, expect, it } from 'vitest';
import { SketchBuilder } from '../fixtures';
import { nearPairsWithin } from './pairs';
import { detectProfiles, detectProfilesAllPairs } from './profiles';

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
      const kind = round % 4;
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
        }
        boxes.set([x, y, x + w, y + h], 4 * i);
      }
      expect([...nearPairsWithin(boxes)]).toStrictEqual(allPairs(boxes));
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
  });
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
