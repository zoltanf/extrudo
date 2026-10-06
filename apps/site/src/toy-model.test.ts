import { describe, expect, it } from 'vitest';
import { DEFAULTS, DEPTH, facesViewer, grams, type P2, ring, trayMarkup, walls } from './toy-model';

const area = (points: P2[]) =>
  points.reduce((sum, p, i) => {
    const q = points[(i + 1) % points.length] as P2;
    return sum + (p[0] * q[1] - q[0] * p[1]) / 2;
  }, 0);

describe('the outline', () => {
  it('is the four corners of a sharp rectangle, counter-clockwise', () => {
    const points = ring(80, 60, 0);
    expect(points).toEqual([
      [40, 30],
      [-40, 30],
      [-40, -30],
      [40, -30],
    ]);
    expect(area(points)).toBeCloseTo(4800, 6);
  });

  it('rounds each corner with eleven points and stays inside the rectangle', () => {
    const points = ring(80, 60, 8);
    expect(points).toHaveLength(44);
    for (const [x, y] of points) {
      expect(Math.abs(x)).toBeLessThanOrEqual(40 + 1e-9);
      expect(Math.abs(y)).toBeLessThanOrEqual(30 + 1e-9);
    }
    // Four quarter-circle corners take (4 - pi) r² off the rectangle; a polygon a little more.
    expect(area(points)).toBeLessThan(4800 - (4 - Math.PI) * 64 + 1);
    expect(area(points)).toBeGreaterThan(4800 - (4 - Math.PI) * 64 - 6);
  });
});

describe('the walls the viewer sees', () => {
  it('are the two that face +x and +y on a sharp rectangle', () => {
    const front = walls(ring(80, 60, 0)).filter((wall) => wall.front);
    expect(front.map((wall) => [Math.round(wall.nx) + 0, Math.round(wall.ny) + 0])).toEqual([
      [0, 1],
      [1, 0],
    ]);
  });

  it('has an outward unit normal on every wall', () => {
    for (const wall of walls(ring(80, 60, 8))) {
      expect(Math.hypot(wall.nx, wall.ny)).toBeCloseTo(1, 9);
      // Outward: the wall's midpoint plus its normal lies further from the middle.
      const mx = (wall.p[0] + wall.q[0]) / 2;
      const my = (wall.p[1] + wall.q[1]) / 2;
      expect(Math.hypot(mx + wall.nx, my + wall.ny)).toBeGreaterThan(Math.hypot(mx, my));
    }
  });

  it('is a wall that points towards +x + y, and not one edge-on', () => {
    expect(facesViewer(1, 0)).toBe(true);
    expect(facesViewer(0.7, 0.7)).toBe(true);
    expect(facesViewer(-1, 0)).toBe(false);
    expect(facesViewer(1, -1)).toBe(false);
  });
});

describe('the weight', () => {
  it('is the volume of the tray in PLA', () => {
    // 80 x 60 x 28 less a 74 x 54 cavity 25 deep: 34.5 cm³ at 1.24 g/cm³.
    expect(grams({ width: 80, height: 28, fillet: 0 })).toBeCloseTo(34.5 * 1.24, 6);
  });

  it('grows with the width and the height, and shrinks with the fillet', () => {
    const base = grams(DEFAULTS);
    expect(grams({ ...DEFAULTS, width: 100 })).toBeGreaterThan(base);
    expect(grams({ ...DEFAULTS, height: 40 })).toBeGreaterThan(base);
    expect(grams({ ...DEFAULTS, fillet: 20 })).toBeLessThan(base);
  });

  it("holds at the sliders' extremes", () => {
    for (const width of [40, 120]) {
      for (const fillet of [0, 24]) {
        const g = grams({ width, height: 8, fillet });
        expect(Number.isFinite(g)).toBe(true);
        expect(g).toBeGreaterThan(0);
      }
    }
    expect(DEPTH / 2).toBeGreaterThan(24);
  });
});

describe('the drawing', () => {
  it('names the dimensions it shows and draws no style attribute', () => {
    const markup = trayMarkup(DEFAULTS);
    expect(markup).toContain('width 80');
    expect(markup).toContain('>R8<');
    expect(markup).not.toMatch(/\sstyle=/);
  });

  it('has no radius label for a sharp tray', () => {
    expect(trayMarkup({ ...DEFAULTS, fillet: 0 })).not.toContain('>R');
  });
});
