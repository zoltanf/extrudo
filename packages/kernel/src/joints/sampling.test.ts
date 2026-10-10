// Where the clearance check samples a joint's motion (P6-05 J3, ADR-0081 §4).
import { describe, expect, it } from 'vitest';
import {
  coarseSamples,
  JOINT_SAMPLES,
  MAX_JOINT_SAMPLES,
  narrowBoundary,
  narrowMinimum,
} from './sampling';

describe('coarseSamples', () => {
  it('includes both ends, evenly spaced', () => {
    const s = coarseSamples({ min: 0, max: 90 }, 10);
    expect(s).toHaveLength(10);
    expect(s[0]).toBe(0);
    expect(s.at(-1)).toBe(90);
    expect((s[1] as number) - (s[0] as number)).toBeCloseTo(10, 9);
  });

  it('includes 0 when the range straddles it', () => {
    const s = coarseSamples({ min: -45, max: 100 }, JOINT_SAMPLES.revolute);
    expect(s).toContain(0);
    expect(s[0]).toBe(-45);
    expect(s.at(-1)).toBe(100);
    expect([...s].sort((a, b) => a - b)).toEqual(s);
  });

  it('a whole turn at 10°', () => {
    const s = coarseSamples({ min: -180, max: 180 }, JOINT_SAMPLES.revolute);
    expect(s).toContain(0);
    expect(s.length).toBeLessThanOrEqual(JOINT_SAMPLES.revolute + 1);
  });

  it('is capped', () => {
    const straddling = coarseSamples({ min: -10, max: 10 }, 500);
    expect(straddling.length).toBeLessThanOrEqual(MAX_JOINT_SAMPLES);
    expect(straddling).toContain(0);
    expect(coarseSamples({ min: 0, max: 10 }, 500)).toHaveLength(MAX_JOINT_SAMPLES);
  });

  it('an empty range is its one value', () => {
    expect(coarseSamples({ min: 5, max: 5 }, 25)).toEqual([5]);
  });
});

describe('narrowMinimum', () => {
  it("finds a parabola's minimum to the step", () => {
    const found = narrowMinimum((v) => (v - 3.3) ** 2 + 0.2, 0, 10, 0.01, 40);
    expect(Math.abs(found.at - 3.3)).toBeLessThan(0.01);
    expect(found.gap).toBeCloseTo(0.2, 4);
    expect(found.used).toBeLessThanOrEqual(40);
  });

  it('stops at its budget', () => {
    let calls = 0;
    const found = narrowMinimum(
      (v) => {
        calls++;
        return Math.abs(v - 1);
      },
      0,
      10,
      1e-9,
      8,
    );
    expect(calls).toBe(8);
    expect(found.used).toBe(8);
  });
});

describe('narrowBoundary', () => {
  it('bisects a step function to the step, from either side', () => {
    const up = narrowBoundary((v) => v >= 64.2, 60, 70, 0.1, 20);
    expect(up.at).toBeGreaterThanOrEqual(64.2);
    expect(up.at - 64.2).toBeLessThanOrEqual(0.1);
    const down = narrowBoundary((v) => v <= 81, 90, 80, 0.1, 20);
    expect(down.at).toBeLessThanOrEqual(81);
    expect(81 - down.at).toBeLessThanOrEqual(0.1);
  });

  it('stops at its budget', () => {
    let calls = 0;
    const found = narrowBoundary(
      (v) => {
        calls++;
        return v > 5;
      },
      0,
      10,
      1e-9,
      8,
    );
    expect(calls).toBe(8);
    expect(found.used).toBe(8);
  });
});
