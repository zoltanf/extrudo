/**
 * The app's cached profiles of a sketch (P1-11): a sketch whose curves cross
 * too often (`MAX_PROFILE_CUTS`, ADR-0020's amendment of 2026-11-15) has
 * none, and says so, instead of freezing the tab; without those curves its
 * profiles are back.
 */
import { SketchBuilder } from '@extrudo/sketch/fixtures';
import {
  keptBytes,
  keptTotals,
  setKeptLimits,
  TOO_LARGE_COORDINATES,
  TOO_MANY_CROSSINGS,
  TOO_MANY_CURVES,
} from '@extrudo/sketch/profiles';
import { afterEach, describe, expect, it } from 'vitest';
import {
  closeOpenSketch,
  inkCentroids,
  openSketchProfiles,
  regionCentroid,
  sketchProfiles,
  sketchProfilesProblem,
} from './profiles';

function sketch(crossing: boolean) {
  const b = new SketchBuilder();
  b.line(0, 0, 20, 0);
  b.line(20, 0, 20, 10);
  b.line(20, 10, 0, 10);
  b.line(0, 10, 0, 0);
  // 330 chords of a circle, all crossing: 54,000 crossings.
  if (crossing)
    for (let i = 0; i < 330; i++) {
      const a = (Math.PI * i) / 330;
      b.line(
        500 + 100 * Math.cos(a),
        100 * Math.sin(a),
        500 - 100 * Math.cos(a + 0.3),
        -100 * Math.sin(a + 0.3),
      );
    }
  return b.sketch;
}

describe('sketchProfiles', () => {
  it('gives no profiles for a sketch with too many crossings, and says why', () => {
    const data = sketch(true);
    expect(sketchProfiles(data, 0)).toEqual([]);
    expect(sketchProfilesProblem(data, 0)).toBe(TOO_MANY_CROSSINGS);
  });

  it('gives the profiles back without the crossing curves', () => {
    const data = sketch(false);
    expect(sketchProfiles(data, 0)).toHaveLength(1);
    expect(sketchProfilesProblem(data, 0)).toBeUndefined();
  });

  it('gives no profiles for a sketch with coordinates too large, and says why', () => {
    const b = new SketchBuilder();
    b.circle(0, 0, 5);
    b.line(0, 0, 2e9, 0);
    expect(sketchProfiles(b.sketch, 0)).toEqual([]);
    expect(sketchProfilesProblem(b.sketch, 0)).toBe(TOO_LARGE_COORDINATES);
  });

  it('gives no profiles for a sketch with too many curves, and says why', () => {
    // A thousand circles of 1 m, apart: two million points.
    const b = new SketchBuilder();
    for (let i = 0; i < 1000; i++) b.circle((i % 40) * 2100, Math.floor(i / 40) * 2100, 1000);
    expect(sketchProfiles(b.sketch, 0)).toEqual([]);
    expect(sketchProfilesProblem(b.sketch, 0)).toBe(TOO_MANY_CURVES);
  });

  it('keeps the list of a frozen sketch without text when fonts arrive: its fill stays', () => {
    const data = Object.freeze({
      ...sketch(false),
      entities: Object.freeze(
        Object.fromEntries(
          Object.entries(sketch(false).entities).map(([id, e]) => [id, Object.freeze(e)]),
        ),
      ),
    }) as ReturnType<typeof sketch>;
    const first = sketchProfiles(data, 1);
    expect(first.length).toBeGreaterThan(0);
    expect(sketchProfiles(data, 2)).toBe(first);
  });
});

/** A plate with `holes` holes, `dx` mm to the right. */
function plate(holes: number, dx = 0) {
  const b = new SketchBuilder();
  b.line(dx, 0, dx + 200, 0);
  b.line(dx + 200, 0, dx + 200, 100);
  b.line(dx + 200, 100, dx, 100);
  b.line(dx, 100, dx, 0);
  for (let i = 0; i < holes; i++)
    b.circle(dx + 10 + (i % 18) * 10, 10 + Math.floor(i / 18) * 10, 3);
  return b.sketch;
}

describe('what the UI thread keeps of detection', () => {
  afterEach(() => {
    closeOpenSketch();
    setKeptLimits();
  });

  it('keeps only the centres a dialog needs for a sketch that is not open, and finds them once', () => {
    const reference = sketchProfiles(plate(40), 0);
    const full = keptBytes(reference);
    const id = reference[0]?.id as string;
    const data = plate(40);
    const before = keptTotals().bytes;
    const centre = regionCentroid(data, id, 0);
    expect(centre).toBeDefined();
    expect(regionCentroid(data, id, 0)).toBe(centre);
    // The centres keep far less than the profiles would.
    expect(keptTotals().bytes - before).toBeLessThan(full / 4);
  });

  it('gives no ink centres for a sketch without text', () => {
    expect(inkCentroids(plate(2), 'no-such-text', 0)).toEqual([]);
  });

  it('keeps what all callers ask for within the budget, whatever many sketches are asked about', () => {
    setKeptLimits(200_000, 1000);
    for (let i = 0; i < 40; i++) {
      const data = plate(30, i * 300);
      sketchProfiles(data, 0);
      regionCentroid(data, 'x', 0);
    }
    expect(keptTotals().bytes).toBeLessThanOrEqual(200_000);
  });

  it('always keeps the open sketch, whatever else is asked for', () => {
    setKeptLimits(50_000, 4);
    const open = plate(60);
    const profiles = openSketchProfiles(open, 0);
    for (let i = 0; i < 20; i++) sketchProfiles(plate(30, (i + 1) * 300), 0);
    expect(sketchProfiles(open, 0)).toBe(profiles);
    closeOpenSketch();
    for (let i = 0; i < 20; i++) sketchProfiles(plate(30, (i + 30) * 300), 0);
    expect(sketchProfiles(open, 0)).not.toBe(profiles);
  });
});
