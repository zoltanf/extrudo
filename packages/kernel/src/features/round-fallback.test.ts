// The fallback rules of `buildRound` (ADR-0038's and ADR-0043's amendments)
// with a stand-in for the kernel: which builds are tried, in what order, and
// what is warned. The real rounds are in fillet.test.ts and chamfer.test.ts.
import { describe, expect, it } from 'vitest';
import { buildRound, type RoundBuild, type RoundLimit } from './round-fallback';

interface Pick {
  index: number;
  size: number;
}

class Failed extends Error {
  constructor(
    readonly stuck: number[] = [],
    readonly blamed: number[] | undefined = undefined,
    readonly near: RoundLimit | undefined = undefined,
  ) {
    super('failed');
  }
}

/** A round whose `build` answers from `answer` and records what it was asked. */
function round(answer: (picks: readonly Pick[]) => Failed | undefined, skip = true) {
  const tried: string[] = [];
  const warnings: string[] = [];
  const options: RoundBuild<Pick, string> = {
    build: (kept) => {
      const key = kept.map((p) => `${p.index}@${Number(p.size.toPrecision(6))}`).join(' ');
      tried.push(key);
      const failure = answer(kept);
      if (failure) throw failure;
      return key;
    },
    blame: (error) => (error instanceof Failed ? error.blamed : undefined),
    reason: () => 'Because.',
    feature: 'fillet',
    skip,
    warn: (message) => warnings.push(message),
    limit: (error) => (error instanceof Failed ? error.near : undefined),
    stuck: (error) => (error instanceof Failed ? error.stuck : []),
    under: (pick, factor) => ({ ...pick, size: pick.size * factor }),
    size: (pick) => pick.size,
    sizeName: 'radius',
  };
  return { options, tried, warnings };
}

const picks: Pick[] = [
  { index: 0, size: 10 },
  { index: 1, size: 10 },
  { index: 2, size: 10 },
];

describe('buildRound', () => {
  it('leaves out edges no round can take, then builds the rest, however many they are', () => {
    const { options, tried, warnings } = round((kept) =>
      kept.some((p) => p.index > 0) ? new Failed([1, 2]) : undefined,
    );
    expect(buildRound(picks, options)).toBe('0@10');
    expect(tried).toEqual(['0@10 1@10 2@10', '0@10']);
    expect(warnings).toEqual([
      '2 of 3 edges left out of the fillet: Because. Use Fix References to pick other edges or a smaller size.',
    ]);
  });

  it('the rest still goes through the at-limit retry', () => {
    const { options, tried, warnings } = round((kept) => {
      if (kept.some((p) => p.index === 2)) return new Failed([2]);
      return kept.every((p) => p.size < 10)
        ? undefined
        : new Failed([], [], { edges: [0, 1], share: 0.9921875, together: true });
    });
    expect(buildRound(picks, options)).toBe('0@9.999 1@9.999');
    expect(tried).toEqual(['0@10 1@10 2@10', '0@10 1@10', '0@9.999 1@9.999']);
    expect(warnings).toEqual([
      'Fillet built at radius 9.999 mm, a hair under the 10 mm asked for, which is just too large where its edges meet.',
      '1 of 3 edges left out of the fillet: Because. Use Fix References to pick other edges or a smaller size.',
    ]);
  });

  it('when every edge is one no round can take, it fails with the error', () => {
    const { options } = round(() => new Failed([0, 1, 2]));
    expect(() => buildRound(picks, options)).toThrow(Failed);
  });

  it('a round that only fails together, well under its limit, is not built smaller', () => {
    const { options, tried } = round(
      (kept) => new Failed([], [], { edges: kept.map((p) => p.index), share: 0.5, together: true }),
    );
    expect(() => buildRound(picks, options)).toThrow(Failed);
    expect(tried).toEqual(['0@10 1@10 2@10']);
  });

  it('without skipLostEdges nothing is retried', () => {
    const { options, tried } = round(() => new Failed([1]), false);
    expect(() => buildRound(picks, options)).toThrow(Failed);
    expect(tried).toHaveLength(1);
  });
});
