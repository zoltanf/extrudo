/**
 * The reasons the import gives people for a feature it left out (R3-18, the owner's UI review
 * 3): a few plain words, never the file's curve keys. The technical text stays in `detail` for
 * bug reports and `corpus.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import { MAX_REASON, skippedFeature, unmatchedRegion } from './map';

const keys = (n: number, from = 0) =>
  Array.from({ length: n }, (_, i) => `${1000 + from + i}|${2000 + from + i}|${3000 + from + i}`);

describe('a skipped feature’s reason', () => {
  it('says a profile region that could not be matched in plain words, keeping the keys as detail', () => {
    const raw = unmatchedRegion('Sketch3', keys(300), 412, keys(8, 500));
    expect(raw.length).toBeGreaterThan(4000);
    const skipped = skippedFeature('Extrude7', 'Extrude', raw);
    expect(skipped).toEqual({
      name: 'Extrude7',
      kind: 'Extrude',
      reason: "its profile couldn't be matched to Sketch3's curves",
      detail: raw,
    });
  });

  it('keeps a short plain reason as it is, with no detail', () => {
    expect(skippedFeature('Sweep1', 'Sweep', 'it follows only part of its path')).toEqual({
      name: 'Sweep1',
      kind: 'Sweep',
      reason: 'it follows only part of its path',
    });
  });

  it('words a long or technical message generally, keeping it as detail', () => {
    const thrown = `Fillet3.edges: ${'x'.repeat(200)}`;
    const long = skippedFeature('Fillet3', 'Fillet', thrown);
    expect(long.reason).toBe("it couldn't be rebuilt in Extrudo");
    expect(long.detail).toBe(thrown);
    const braces = skippedFeature('Hole1', 'Hole', 'centre {12|14} missing');
    expect(braces.reason).toBe("it couldn't be rebuilt in Extrudo");
    expect(braces.detail).toBe('centre {12|14} missing');
  });

  it('never gives people a reason over the limit or with a list in braces', () => {
    const raws = [
      unmatchedRegion('A sketch with a long name of its own', keys(50), 60, keys(8)),
      'x'.repeat(MAX_REASON + 1),
      `{${keys(3).join(' ')}}`,
      'its axis was not found',
    ];
    for (const raw of raws) {
      const { reason } = skippedFeature('F', 'Kind', raw);
      expect(reason.length).toBeLessThanOrEqual(MAX_REASON);
      expect(reason).not.toMatch(/[{}]/);
    }
  });
});
