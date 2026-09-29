import { describe, expect, it } from 'vitest';
import {
  GAP,
  LIST_MAX_HEIGHT,
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
  it('sums rows and separators, and stops at the cap', () => {
    expect(listHeight(0, 0)).toBe(0);
    expect(listHeight(3, 1)).toBe(3 * LIST_ROW + 9 + 8);
    expect(listHeight(40, 5)).toBe(LIST_MAX_HEIGHT);
  });
});

describe('placeMenu', () => {
  const view = { width: 1440, height: 900 };
  const list = { rows: 5, separators: 1 };

  it('centres the ring on the pointer, the list below it', () => {
    const p = placeMenu({ x: 700, y: 300 }, view, list);
    expect(p.center).toEqual({ x: 700, y: 300 });
    expect(p.list.top).toBe(300 + RING_OUTER + GAP);
    expect(p.list.height).toBe(listHeight(5, 1));
    // Centred under the ring.
    expect(p.list.left + p.list.width / 2).toBeCloseTo(700);
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
      expect(p.list.left).toBeGreaterThanOrEqual(MARGIN);
      expect(p.list.left + p.list.width).toBeLessThanOrEqual(view.width - MARGIN);
      expect(p.list.top).toBeGreaterThanOrEqual(MARGIN);
      expect(p.list.top + p.list.height).toBeLessThanOrEqual(view.height - MARGIN);
    }
  });

  it('puts the list above the ring when the bottom has no room', () => {
    const p = placeMenu({ x: 700, y: 760 }, view, { rows: 9, separators: 2 });
    expect(p.list.top + p.list.height).toBeLessThanOrEqual(p.center.y - RING_OUTER);
  });

  it('shortens the list (it scrolls) when neither side has room', () => {
    const small = { width: 800, height: 600 };
    const p = placeMenu({ x: 400, y: 300 }, small, { rows: 12, separators: 3 });
    expect(p.list.height).toBeLessThan(listHeight(12, 3));
    expect(p.list.top + p.list.height).toBeLessThanOrEqual(small.height - MARGIN);
  });

  it('opens the plain list at the pointer, moved in when it would leave the window', () => {
    const at = placeMenu({ x: 300, y: 200 }, view, list, null);
    expect(at.list.left).toBe(300);
    expect(at.list.top).toBe(200);
    const edge = placeMenu({ x: 1430, y: 890 }, view, list, null);
    expect(edge.list.left + edge.list.width).toBeLessThanOrEqual(view.width - MARGIN);
    expect(edge.list.top + edge.list.height).toBeLessThanOrEqual(view.height - MARGIN);
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
