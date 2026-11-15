/**
 * The app's cached profiles of a sketch (P1-11): a sketch whose curves cross
 * too often (`MAX_PROFILE_CUTS`, ADR-0020's amendment of 2026-11-15) has
 * none, and says so, instead of freezing the tab; without those curves its
 * profiles are back.
 */
import { SketchBuilder } from '@extrudo/sketch/fixtures';
import { TOO_LARGE_COORDINATES, TOO_MANY_CROSSINGS } from '@extrudo/sketch/profiles';
import { describe, expect, it } from 'vitest';
import { sketchProfiles, sketchProfilesProblem } from './profiles';

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
});
