import { describe, expect, it } from 'vitest';
import { capColors, parseCssColor } from './colors';

describe('parseCssColor', () => {
  it.each([
    ['#ffb23e', { r: 1, g: 178 / 255, b: 62 / 255, a: 1 }],
    ['#FFFFFF80', { r: 1, g: 1, b: 1, a: 128 / 255 }],
    ['rgb(255 255 255 / 5%)', { r: 1, g: 1, b: 1, a: 0.05 }],
    ['rgba(17, 19, 24, 0.06)', { r: 17 / 255, g: 19 / 255, b: 24 / 255, a: 0.06 }],
    [' rgb(195 202 214 / 70%) ', { r: 195 / 255, g: 202 / 255, b: 214 / 255, a: 0.7 }],
    ['rgb(10, 20, 30)', { r: 10 / 255, g: 20 / 255, b: 30 / 255, a: 1 }],
  ])('%s', (text, expected) => {
    const c = parseCssColor(text);
    if (!c) throw new Error('not parsed');
    for (const k of ['r', 'g', 'b', 'a'] as const) expect(c[k]).toBeCloseTo(expected[k], 9);
  });

  it.each(['', 'red', '#fff', 'rgb(1 2)', 'hsl(0 0% 0%)', 'rgb(a b c)'])('rejects %j', (text) => {
    expect(parseCssColor(text)).toBeUndefined();
  });
});

describe('capColors', () => {
  const body = { r: 0.8, g: 0.8, b: 0.85, a: 1 };
  const teal = { r: 0.06, g: 0.62, b: 0.67, a: 1 };

  it('tints the body colour towards the section teal and hatches with ink', () => {
    const light = { r: 0.07, g: 0.08, b: 0.1, a: 1 };
    const { fill, hatch } = capColors(body, teal, light);
    // Between the body and the teal, opaque; the hatch is darker than the fill on a light body.
    expect(fill.r).toBeLessThan(body.r);
    expect(fill.r).toBeGreaterThan(teal.r);
    expect(fill.a).toBe(1);
    expect(hatch.r).toBeLessThan(fill.r);
  });

  it('gives each body its own cap colour, and lets a light ink lift the hatch in the dark theme', () => {
    const red = capColors({ r: 0.9, g: 0.2, b: 0.2, a: 1 }, teal, teal).fill;
    expect(red).not.toEqual(capColors(body, teal, teal).fill);
    const dark = { r: 0.12, g: 0.13, b: 0.15, a: 1 };
    const { fill, hatch } = capColors(dark, teal, { r: 0.95, g: 0.96, b: 0.98, a: 1 });
    expect(hatch.r).toBeGreaterThan(fill.r);
  });
});
