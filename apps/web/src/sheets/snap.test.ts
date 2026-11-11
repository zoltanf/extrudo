import type { DisplayList, DisplayText } from '@extrudo/io';
import { describe, expect, it } from 'vitest';
import type { SheetBox } from './selection';
import { dimensionRows, guidePath, ROW_STEP, snapMove, snapPoint, snapTargets } from './snap';

const box = (minX: number, minY: number, maxX: number, maxY: number): SheetBox => ({
  minX,
  minY,
  maxX,
  maxY,
});

describe('snapping a move to other boxes', () => {
  const other = box(100, 100, 140, 120);

  it('takes the nearest edge or middle within the tolerance, each axis on its own', () => {
    // The moved box's left lands 0.6 mm right of the other's left: it snaps back.
    const r = snapMove([box(0, 0, 20, 10)], [other], 100.6, 50, 1);
    expect(r.dx).toBeCloseTo(100);
    expect(r.dy).toBe(50);
    expect(r.guides).toEqual([{ x1: 100, y1: 50, x2: 100, y2: 120 }]);
  });

  it('lines up middles, and right edges', () => {
    // Middle 10 + dx against 120: dx 109.7 snaps to 110.
    expect(snapMove([box(0, 0, 20, 10)], [other], 109.7, 0, 1).dx).toBeCloseTo(110);
    // Bottom 10 + dy against the other's bottom 120.
    expect(snapMove([box(0, 0, 20, 10)], [other], 0, 110.4, 1).dy).toBeCloseTo(110);
  });

  it('leaves a move alone that is not near anything', () => {
    expect(snapMove([box(0, 0, 20, 10)], [other], 50, 50, 1)).toEqual({
      dx: 50,
      dy: 50,
      guides: [],
    });
  });

  it('does not snap to the moved targets themselves', () => {
    const boxes = new Map([
      ['item:a', box(0, 0, 10, 10)],
      ['item:b', other],
    ]);
    expect(snapTargets(boxes, new Set(['item:a']))).toEqual([other]);
  });
});

describe('dimension rows 10 mm apart', () => {
  it('a level dimension snaps to another level row, or 10, 20 … mm from it', () => {
    const rows = [{ axis: 'y' as const, at: 200 }];
    const own = { axis: 'y' as const, at: 150 };
    // Moving 59.3 down puts the row at 209.3: snaps to 210 (one step below).
    const r = snapMove([box(0, 145, 40, 152)], [], 0, 59.3, 1, own, rows);
    expect(r.dy).toBeCloseTo(60);
    expect(r.guides[0]).toMatchObject({ y1: 210, y2: 210 });
    // Onto the same row.
    expect(snapMove([box(0, 145, 40, 152)], [], 0, 49.5, 1, own, rows).dy).toBeCloseTo(50);
    expect(ROW_STEP).toBe(10);
  });

  it('an upright row only snaps to upright rows', () => {
    const rows = [{ axis: 'y' as const, at: 200 }];
    const own = { axis: 'x' as const, at: 30 };
    expect(snapMove([box(25, 0, 35, 40)], [], 0, 50.4, 1, own, rows).dy).toBe(50.4);
  });

  it('reads each dimension’s row from its first text: level is y, upright is x', () => {
    const text = (key: string, at: [number, number], angle?: number): DisplayText => ({
      type: 'text',
      text: '10',
      outline: [],
      at,
      height: 3.5,
      width: 4,
      key,
      ...(angle !== undefined && { angle }),
    });
    const list: DisplayList = {
      width: 420,
      height: 297,
      items: [
        text('item:a', [10, 50]),
        text('item:a', [10, 60]),
        text('item:b', [80, 90], -Math.PI / 2),
        text('item:c', [0, 0], 0.3),
        text('item:t', [5, 5]),
      ],
    };
    const rows = dimensionRows(list, new Set(['item:a', 'item:b', 'item:c']));
    expect([...rows]).toEqual([
      ['item:a', { axis: 'y', at: 50 }],
      ['item:b', { axis: 'x', at: 80 }],
    ]);
  });
});

describe('placing a point', () => {
  it("snaps a text's corner to another item's left edge, with its guide", () => {
    const { point, guides } = snapPoint([100.5, 30], [box(100, 60, 140, 80)], 1);
    expect(point).toEqual([100, 30]);
    expect(guidePath(guides)).toBe('M100 30L100 80');
  });
});
