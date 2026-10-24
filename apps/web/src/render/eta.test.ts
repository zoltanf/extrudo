/** The render's time left (ADR-0101 §6.2): the estimate and its wording. */
import { describe, expect, it } from 'vitest';
import { etaText, remainingSeconds } from './eta';

describe('remainingSeconds', () => {
  const start = { at: 1000, fraction: 0.1 };

  it('waits for three seconds and two percent of progress', () => {
    expect(remainingSeconds(start, 3999, 0.5)).toBeUndefined();
    expect(remainingSeconds(start, 10_000, 0.11)).toBeUndefined();
  });

  it('extrapolates the average rate since the phase began', () => {
    // 0.1 → 0.3 in 10 s: 0.02 a second, 0.7 left is 35 s.
    expect(remainingSeconds(start, 11_000, 0.3)).toBeCloseTo(35, 9);
  });

  it('is zero at the end, never negative', () => {
    expect(remainingSeconds(start, 11_000, 1)).toBe(0);
    expect(remainingSeconds(start, 11_000, 1.2)).toBe(0);
  });
});

describe('etaText', () => {
  it('rounds to what a person reads', () => {
    expect(etaText(4)).toBe('a few seconds left');
    expect(etaText(37)).toBe('about 35 s left');
    expect(etaText(52)).toBe('about 50 s left');
    expect(etaText(59)).toBe('about 1 min left');
    expect(etaText(150)).toBe('about 3 min left');
    expect(etaText(3600)).toBe('about 1 h left');
    expect(etaText(4200)).toBe('about 1 h 10 min left');
  });
});
