import { describe, expect, it } from 'vitest';
import { parseCssColor } from './colors';

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
