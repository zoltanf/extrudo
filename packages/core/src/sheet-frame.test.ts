import { describe, expect, it } from 'vitest';
import type { SheetViewId } from './ids';
import {
  SHEET_STANDARD_VIEWS,
  type SheetViewFrame,
  sheetBaseFrame,
  sheetProjectedFrame,
  sheetStandardFrom,
  sheetViewFrame,
  toSheetView,
} from './sheet-frame';
import type { Sheet, SheetView } from './sheet-schema';
import type { Vec3 } from './sketch/planes';

const close = (a: readonly number[], b: readonly number[]) => {
  for (const [i, v] of a.entries()) expect(v).toBeCloseTo(b[i] as number, 12);
};
const same = (a: SheetViewFrame, b: SheetViewFrame) => {
  close(a.direction, b.direction);
  close(a.up, b.up);
  close(a.right, b.right);
};
const standard = (name: keyof typeof SHEET_STANDARD_VIEWS) => {
  const { direction, up } = SHEET_STANDARD_VIEWS[name];
  return sheetBaseFrame(direction, up);
};
const front = standard('front');

/** The corners of a 10 × 20 × 30 box at the origin that a view shows at its extremes. */
const BOX: Vec3 = [10, 20, 30];

describe('sheetBaseFrame', () => {
  it('makes unit, square, right-handed axes and turns up square to the direction', () => {
    const f = sheetBaseFrame([0, 5, 0], [0, 1, 3]);
    close(f.direction, [0, 1, 0]);
    close(f.up, [0, 0, 1]);
    close(f.right, [1, 0, 0]);
  });

  it('refuses a zero direction and an up along it', () => {
    expect(() => sheetBaseFrame([0, 0, 0], [0, 0, 1])).toThrow(/no length/);
    expect(() => sheetBaseFrame([0, 0, 2], [0, 0, -1])).toThrow(/parallel/);
  });

  it('draws the front view of the box with x to the right and z up', () => {
    expect(toSheetView(front, BOX)).toEqual([10, 30]);
    // Depth (y) doesn't show.
    expect(toSheetView(front, [10, 0, 30])).toEqual([10, 30]);
  });

  it('gives the six standard views their usual axes', () => {
    close(standard('back').right, [-1, 0, 0]);
    close(standard('left').right, [0, -1, 0]);
    close(standard('right').right, [0, 1, 0]);
    close(standard('top').right, [1, 0, 0]);
    close(standard('top').up, [0, 1, 0]);
    close(standard('bottom').right, [1, 0, 0]);
    close(standard('bottom').up, [0, -1, 0]);
  });
});

describe('sheetProjectedFrame, third angle', () => {
  it('shows what is on the side the view is placed on', () => {
    same(sheetProjectedFrame(front, 'third', 'right'), standard('right'));
    same(sheetProjectedFrame(front, 'third', 'left'), standard('left'));
    same(sheetProjectedFrame(front, 'third', 'above'), standard('top'));
    same(sheetProjectedFrame(front, 'third', 'below'), standard('bottom'));
  });

  it('keeps the box lined up with the front view and its front face towards it', () => {
    const right = sheetProjectedFrame(front, 'third', 'right');
    // Same height as in the front view; the front face (y = 0) on the side
    // next to the front view (x = 0), the back face (y = 20) away from it.
    expect(toSheetView(right, [10, 0, 30])[1]).toBeCloseTo(30, 12);
    expect(toSheetView(right, [10, 0, 30])[0]).toBeCloseTo(0, 12);
    expect(toSheetView(right, [10, 20, 30])[0]).toBeCloseTo(20, 12);
    const top = sheetProjectedFrame(front, 'third', 'above');
    // Same x as the front view; the front face at the bottom, next to it.
    expect(toSheetView(top, [10, 0, 30])).toEqual([10, 0]);
    expect(toSheetView(top, [10, 20, 30])).toEqual([10, 20]);
  });

  it('goes round: right of the right view is the back, above the top is the back upside down', () => {
    const right = sheetProjectedFrame(front, 'third', 'right');
    same(sheetProjectedFrame(right, 'third', 'right'), standard('back'));
    const top = sheetProjectedFrame(front, 'third', 'above');
    const over = sheetProjectedFrame(top, 'third', 'above');
    close(over.direction, [0, -1, 0]);
    close(over.up, [0, 0, -1]);
  });
});

describe('sheetProjectedFrame, first angle', () => {
  it('shows what is on the opposite side', () => {
    same(sheetProjectedFrame(front, 'first', 'right'), standard('left'));
    same(sheetProjectedFrame(front, 'first', 'left'), standard('right'));
    same(sheetProjectedFrame(front, 'first', 'above'), standard('bottom'));
    same(sheetProjectedFrame(front, 'first', 'below'), standard('top'));
  });

  it('puts the front face away from the front view', () => {
    const placedRight = sheetProjectedFrame(front, 'first', 'right');
    // The left view: the front face (y = 0) on its right, the far side from the front view.
    expect(toSheetView(placedRight, [0, 0, 30])[0]).toBeCloseTo(0, 12);
    expect(toSheetView(placedRight, [0, 20, 30])[0]).toBeCloseTo(-20, 12);
  });
});

describe('sheetProjectedFrame, isometric sides', () => {
  const s = 1 / Math.sqrt(3);
  it('looks from the corner the view is placed towards, in both angles', () => {
    for (const projection of ['first', 'third'] as const) {
      const iso = sheetProjectedFrame(front, projection, 'iso-above-right');
      // From the front, right and top: looking towards (−1, 1, −1).
      close(iso.direction, [-s, s, -s]);
      // Z stays as close to up as it can.
      expect(iso.up[2]).toBeGreaterThan(0.8);
      expect(iso.up[0]).toBeCloseTo(-iso.up[1], 12);
      close(sheetProjectedFrame(front, projection, 'iso-above-left').direction, [s, s, -s]);
      close(sheetProjectedFrame(front, projection, 'iso-below-right').direction, [-s, s, s]);
      close(sheetProjectedFrame(front, projection, 'iso-below-left').direction, [s, s, s]);
    }
  });

  it('is a true isometric: the three box axes foreshorten equally', () => {
    const iso = sheetProjectedFrame(front, 'third', 'iso-above-right');
    const lengths = (
      [
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
      ] as Vec3[]
    ).map((a) => Math.hypot(...toSheetView(iso, a)));
    for (const l of lengths) expect(l).toBeCloseTo(Math.sqrt(2 / 3), 12);
  });
});

describe('sheetViewFrame', () => {
  const view = (id: string, from: SheetView['from']): SheetView => ({
    id: id as SheetViewId,
    name: id,
    at: [0, 0],
    from,
  });
  const base = view('a', sheetStandardFrom('front'));
  const sheet = (projection: Sheet['projection'], views: SheetView[]) => ({ projection, views });

  it('follows the parents', () => {
    const views = [
      base,
      view('b', { kind: 'projected', parent: 'a' as SheetViewId, side: 'right' }),
      view('c', { kind: 'projected', parent: 'b' as SheetViewId, side: 'right' }),
    ];
    same(sheetViewFrame(sheet('third', views), 'c') as SheetViewFrame, standard('back'));
    same(sheetViewFrame(sheet('first', views), 'b') as SheetViewFrame, standard('left'));
  });

  it('is undefined for a missing view or parent and for a cycle', () => {
    expect(sheetViewFrame(sheet('first', [base]), 'x')).toBeUndefined();
    const orphan = view('b', { kind: 'projected', parent: 'x' as SheetViewId, side: 'left' });
    expect(sheetViewFrame(sheet('first', [orphan]), 'b')).toBeUndefined();
    const loop = [
      view('b', { kind: 'projected', parent: 'c' as SheetViewId, side: 'left' }),
      view('c', { kind: 'projected', parent: 'b' as SheetViewId, side: 'left' }),
    ];
    expect(sheetViewFrame(sheet('first', loop), 'b')).toBeUndefined();
  });
});
