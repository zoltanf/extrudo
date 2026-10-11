import { describe, expect, it } from 'vitest';
import {
  GAP,
  LIST_BORDER,
  LIST_ROW,
  listHeight,
  MARGIN,
  placeMenu,
  RING_INNER,
  RING_OUTER,
  SLOT_COUNT,
  slotAt,
  slotCenter,
  wedgePath,
} from './marking';

describe('slotAt', () => {
  it('numbers the wedges clockwise from straight up', () => {
    const r = 80;
    const d = r * Math.SQRT1_2;
    expect([
      slotAt(0, -r), // up
      slotAt(d, -d), // up-right
      slotAt(r, 0), // right
      slotAt(d, d), // down-right
      slotAt(0, r), // down
      slotAt(-d, d), // down-left
      slotAt(-r, 0), // left
      slotAt(-d, -d), // up-left
    ]).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it('gives a wedge 45 degrees, centred on its direction', () => {
    const at = (degrees: number) => {
      const a = (degrees * Math.PI) / 180;
      return slotAt(Math.sin(a) * 90, -Math.cos(a) * 90);
    };
    expect(at(-22)).toBe(0);
    expect(at(22)).toBe(0);
    expect(at(23)).toBe(1);
    expect(at(67)).toBe(1);
    expect(at(68)).toBe(2);
    expect(at(-23)).toBe(7);
    expect(at(359)).toBe(0);
  });

  it('picks nothing inside the dead zone, however it is pointed', () => {
    expect(slotAt(0, 0)).toBeUndefined();
    expect(slotAt(RING_INNER - 1, 0)).toBeUndefined();
    expect(slotAt(RING_INNER, 0)).toBe(2);
    expect(slotAt(3, 3, 10)).toBeUndefined();
  });

  it('keeps picking however far the flick goes', () => {
    expect(slotAt(0, -900)).toBe(0);
    expect(slotAt(500, 500)).toBe(3);
  });
});

describe('slotCenter', () => {
  it('puts each label on the direction its wedge points at', () => {
    for (let i = 0; i < SLOT_COUNT; i++) {
      const { x, y } = slotCenter(i, 90);
      expect(slotAt(x, y)).toBe(i);
      expect(Math.hypot(x, y)).toBeCloseTo(90);
    }
    expect(slotCenter(0, 100).y).toBeCloseTo(-100);
    expect(slotCenter(2, 100).x).toBeCloseTo(100);
  });
});

describe('listHeight', () => {
  it('sums rows, separators, padding and border, with no cap (R3-08)', () => {
    expect(listHeight(0, 0)).toBe(0);
    expect(listHeight(3, 1)).toBe(3 * LIST_ROW + 9 + 8 + LIST_BORDER);
    // A long list is as tall as its rows: it scrolls only where the window is shorter.
    expect(listHeight(40, 5)).toBe(40 * LIST_ROW + 5 * 9 + 8 + LIST_BORDER);
  });
});

describe('placeMenu', () => {
  const view = { width: 1440, height: 900 };
  const list = { rows: 5, separators: 1 };
  const inside = (p: ReturnType<typeof placeMenu>, v = view) => {
    expect(p.list.left).toBeGreaterThanOrEqual(MARGIN);
    expect(p.list.left + p.list.width).toBeLessThanOrEqual(v.width - MARGIN);
    expect(p.list.top).toBeGreaterThanOrEqual(MARGIN);
    expect(p.list.top + p.list.height).toBeLessThanOrEqual(v.height - MARGIN);
  };

  it('centres the ring on the pointer, with no list under it (R3-08)', () => {
    const p = placeMenu({ x: 700, y: 300 }, view, list);
    expect(p.center).toEqual({ x: 700, y: 300 });
    expect(p.list.height).toBe(0);
  });

  it('keeps the whole ring in the window in every corner', () => {
    for (const at of [
      { x: 0, y: 0 },
      { x: 1440, y: 0 },
      { x: 0, y: 900 },
      { x: 1440, y: 900 },
    ]) {
      const p = placeMenu(at, view, list);
      expect(p.center.x - RING_OUTER).toBeGreaterThanOrEqual(MARGIN);
      expect(p.center.x + RING_OUTER).toBeLessThanOrEqual(view.width - MARGIN);
      expect(p.center.y - RING_OUTER).toBeGreaterThanOrEqual(MARGIN);
      expect(p.center.y + RING_OUTER).toBeLessThanOrEqual(view.height - MARGIN);
    }
  });

  it('opens the list below the pointer when all of it fits there', () => {
    const p = placeMenu({ x: 300, y: 200 }, view, { rows: 14, separators: 3 }, null);
    expect(p.list).toMatchObject({ left: 300, top: 200, side: 'below' });
    expect(p.list.height).toBe(listHeight(14, 3));
    inside(p);
  });

  it('opens the list above the pointer when only the top has room for all of it', () => {
    const p = placeMenu({ x: 300, y: 820 }, view, { rows: 14, separators: 3 }, null);
    expect(p.list.side).toBe('above');
    expect(p.list.top + p.list.height).toBe(820);
    expect(p.list.height).toBe(listHeight(14, 3));
    inside(p);
  });

  it('opens the list beside the pointer when neither side has room for all of it', () => {
    // 20 rows are 693 px: the window has room for them, but not above or below y = 450.
    const rows = { rows: 20, separators: 3 };
    const p = placeMenu({ x: 300, y: 450 }, view, rows, null);
    expect(p.list.side).toBe('beside');
    expect(p.list.left).toBe(300 + GAP);
    expect(p.list.height).toBe(listHeight(20, 3));
    inside(p);
    // At the right edge it goes to the pointer's left.
    const right = placeMenu({ x: 1400, y: 450 }, view, rows, null);
    expect(right.list.side).toBe('beside');
    expect(right.list.left + right.list.width).toBe(1400 - GAP);
    inside(right);
  });

  it('scrolls only when the window is shorter than the whole list', () => {
    const small = { width: 800, height: 400 };
    const p = placeMenu({ x: 400, y: 200 }, small, { rows: 14, separators: 3 }, null);
    expect(p.list.side).toBe('short');
    expect(p.list.height).toBe(small.height - 2 * MARGIN);
    inside(p, small);
  });

  it('moves the list in at the window’s edges', () => {
    const edge = placeMenu({ x: 1430, y: 890 }, view, list, null);
    inside(edge);
  });
});

describe('wedgePath', () => {
  it('draws a closed sector inside the ring for each wedge', () => {
    for (let i = 0; i < SLOT_COUNT; i++) {
      const path = wedgePath(i);
      expect(path.startsWith('M')).toBe(true);
      expect(path.endsWith('Z')).toBe(true);
      const numbers = (path.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
      expect(Math.max(...numbers)).toBeLessThanOrEqual(2 * RING_OUTER + 0.01);
      expect(Math.min(...numbers)).toBeGreaterThanOrEqual(-0.01);
    }
  });
});
