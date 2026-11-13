/**
 * Profile-region matching against crafted sketches that cost more than their
 * size: two splines of many poles laid over each other, so every piece of one
 * is near every piece of the other (hand-built, no real file's bytes).
 */
import { describe, expect, it } from 'vitest';
import type { ProfileOperand } from './decode/extrude';
import type { SketchSpline, Vec3 } from './decode/sketch-geometry';
import { type SketchEntry, selectProfiles, TOO_MANY_CROSSINGS } from './map';
import { type F3dSketch, IDENTITY } from './model';
import { MAX_PIECE_WORK, regionPieces, sketchPieces } from './regions';

/** A clamped cubic B-spline through `n` poles along x, zig-zagging in y. */
function zigzag(tag: bigint, n: number, phase: number): SketchSpline {
  const degree = 3;
  const poles: Vec3[] = Array.from(
    { length: n },
    (_, i) => [(10 * i) / (n - 1), ((i + phase) % 2) * 0.5, 0] as Vec3,
  );
  const inner = n - degree - 1;
  const knots = [
    ...Array(degree + 1).fill(0),
    ...Array.from({ length: inner }, (_, i) => (i + 1) / (inner + 1)),
    ...Array(degree + 1).fill(1),
  ];
  return {
    id: Number(tag),
    tag,
    secondary: 0n,
    degree,
    knots,
    weights: [],
    poles,
    construction: false,
  };
}

const sketchOf = (n: number): F3dSketch => ({
  id: 5,
  frame: IDENTITY,
  points: [],
  lines: [],
  circulars: [],
  splines: [zigzag(110n, n, 0), zigzag(111n, n, 1)],
  texts: [],
});

/** The mapping's view of the sketch: no Extrudo regions (the sketch package's own cost is not this test's). */
function entryOf(n: number): SketchEntry {
  return {
    handle: { id: 's', name: 'Sketch1', regions: [], profiles: () => [] },
    placement: { map: (u: number, v: number) => [u, v] },
    tags: new Map(),
    curves: new Map(),
    texts: new Map(),
    source: sketchOf(n),
    profileCurves: new Set(),
  } as unknown as SketchEntry;
}

const operand = (): ProfileOperand => ({
  id: 30,
  sketch: 5,
  regions: [
    {
      outer: [[110n, 111n]],
      inner: [],
      outerPieces: [[110n, 111n].map((tag) => ({ tag, secondary: 0n, piece: 2, of: 3 }))],
      innerPieces: [],
    },
  ],
});

describe('region matching budget', () => {
  it('cuts two crossing splines of a few hundred poles as before', () => {
    const pieces = sketchPieces(sketchOf(200), new Set());
    expect(pieces.overBudget).toBeUndefined();
    // Each zig-zag crosses the other once per pole span or so.
    const hits = pieces.byKey.get('110:0')?.hits.length ?? 0;
    expect(hits).toBeGreaterThan(100);
  });

  // Before the budget, 2,000 poles took 40 s and 5,000 minutes; 20,000 overflowed the stack.
  it.each([5_000, 20_000])('refuses two overlapping %i-pole splines within about a second', (n) => {
    const t = performance.now();
    const pieces = sketchPieces(sketchOf(n), new Set());
    expect(pieces.overBudget).toBe(true);
    expect(pieces.budget.work).toBeGreaterThan(MAX_PIECE_WORK);
    expect(regionPieces(pieces, [[{ tag: 110n, secondary: 0n, piece: 1, of: 1 }]])).toBeUndefined();
    // About a second alone; slack for a loaded machine.
    expect(performance.now() - t).toBeLessThan(3000);
  });

  it('leaves a feature on their region unresolved with a reason', () => {
    const t = performance.now();
    const entry = entryOf(20_000);
    expect(selectProfiles([operand()], () => entry)).toBe(TOO_MANY_CROSSINGS);
    // Asked again (another feature on the same sketch): refused at once.
    const again = performance.now();
    expect(selectProfiles([operand()], () => entry)).toBe(TOO_MANY_CROSSINGS);
    expect(performance.now() - again).toBeLessThan(50);
    expect(performance.now() - t).toBeLessThan(3000);
  });
});
