import { describe, expect, it } from 'vitest';
import { CHEVRON, fitToolbar, groupWidth } from './toolbarFit';

const tiles = (n: number, w = 60) => Array.from({ length: n }, () => w);

describe('fitToolbar (ADR-0079 §3)', () => {
  const groups = [
    { tiles: tiles(6), menu: false },
    { tiles: tiles(4), menu: false },
    { tiles: tiles(3), menu: false },
  ];

  it('hides nothing when the groups fit', () => {
    expect(fitToolbar(groups, 13 * 60 + 20, 20)).toEqual([0, 0, 0]);
    expect(fitToolbar(groups, 10_000, 20)).toEqual([0, 0, 0]);
  });

  it('takes from the fullest group first, one tile at a time', () => {
    // One tile too wide: the 6-tile group gives one.
    expect(fitToolbar(groups, 12 * 60 + 20, 20)).toEqual([1, 0, 0]);
    // Down to 4 + 4 + 3: the first group gave two, then the tie decides.
    expect(fitToolbar(groups, 11 * 60 + 20, 20)).toEqual([2, 0, 0]);
  });

  it('breaks a tie towards the earlier group', () => {
    // After [2, 0, 0] both of the first two groups show 4: the first gives.
    expect(fitToolbar(groups, 10 * 60 + 20, 20)).toEqual([3, 0, 0]);
    expect(fitToolbar(groups, 9 * 60 + 20, 20)).toEqual([3, 1, 0]);
    expect(
      fitToolbar(
        [
          { tiles: tiles(2), menu: false },
          { tiles: tiles(2), menu: false },
        ],
        180,
        0,
      ),
    ).toEqual([1, 0]);
  });

  it('never leaves a group without a tile', () => {
    expect(fitToolbar(groups, 0, 20)).toEqual([5, 3, 2]);
    expect(fitToolbar([{ tiles: [400], menu: true }], 100, 0)).toEqual([0]);
  });

  it('is monotonic: a wider toolbar never hides more', () => {
    const mixed = [
      { tiles: [72, 64, 64, 80, 56, 60], menu: true, label: 50 },
      { tiles: [48, 64, 60, 52], menu: false, label: 70 },
      { tiles: [44, 56, 40], menu: false, label: 60 },
      { tiles: [90, 70, 80], menu: false, label: 56 },
      { tiles: [60, 90], menu: false, label: 64 },
    ];
    let previous = fitToolbar(mixed, 0, 30);
    for (let w = 0; w <= 1600; w += 7) {
      const next = fitToolbar(mixed, w, 30);
      for (const [i, n] of next.entries()) expect(n).toBeLessThanOrEqual(previous[i] ?? 0);
      previous = next;
    }
    expect(previous).toEqual([0, 0, 0, 0, 0]);
  });

  it('counts a label wider than the tiles left, with its ▾ once a tile is hidden', () => {
    const g = { tiles: [40, 40], menu: false, label: 70 };
    expect(groupWidth(g, 0)).toBe(80);
    expect(groupWidth(g, 1)).toBe(70 + CHEVRON);
    expect(groupWidth({ ...g, menu: true }, 0)).toBe(70 + CHEVRON);
    // Hiding a tile behind a label this wide saves nothing more: the group stops there.
    expect(fitToolbar([g], 60, 0)).toEqual([1]);
  });
});
