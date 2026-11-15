/**
 * The translator for every value (ADR-0144 S10's fix round): the rule checks
 * an expression at the value the file stores, so a translation that is equal
 * there but means something else at another value would slip through. Each
 * sweep expression (`sweep-fixtures.ts`, FreeCAD's own values over 13 values
 * of a cell `n`) the emitter translates is evaluated by `@extrudo/core` with
 * `n` at each value and must give FreeCAD's number, and its unit; where FreeCAD
 * has an error Extrudo must have one too.
 */
import { evaluateExpression, type Quantity, UNITLESS } from '@extrudo/core';
import { describe, expect, it } from 'vitest';
import { BIND_TOLERANCE, within } from './bind';
import { emitExtrudo, NONE, type Resolver } from './fc-emit';
import { parseFcExpression } from './fc-expr';
import { SWEEP, SWEEP_N } from './sweep-fixtures';

const resolve: Resolver = (p) =>
  p.components.length === 1 && p.components[0]?.name === 'n'
    ? { text: 'n', fc: { length: 0, angle: 0 }, ex: NONE }
    : { reason: 'reference', detail: 'not n' };

/** The rows the emitter refuses, with the reason it gives. */
const REFUSED: Record<string, string> = {
  // Extrudo rounds a value with a unit in the display unit.
  'round(n * 1 mm)': 'function',
  'floor(n * 1 mm)': 'function',
  'ceil(n * 1 mm)': 'function',
  'trunc(n * 1 mm)': 'function',
  'round(n * 1 deg)': 'function',
  // Functions Extrudo's language doesn't have, and no rewrite holds for every value.
  'atan2(n; 2)': 'function',
  'exp(n / 10)': 'function',
  'log(abs(n) + 1)': 'function',
  'log10(abs(n) + 1)': 'function',
  'sinh(n / 10)': 'function',
  'cosh(n / 10)': 'function',
  'tanh(n / 10)': 'function',
  'n > 0 ? 1 : 2': 'operator',
  'n == 0 ? 5 : 6': 'operator',
};

describe('the sweep: every translation equal to FreeCAD at every value', () => {
  const table = { translated: 0, equal: 0, refused: 0 };
  for (const [expression, unit, values] of SWEEP) {
    it(expression, () => {
      const out = emitExtrudo(parseFcExpression(expression), resolve, { mode: 'any' });
      if (!out.ok) {
        table.refused++;
        expect(out.reason).toBe(REFUSED[expression]);
        return;
      }
      expect(REFUSED[expression], `${expression} translates`).toBeUndefined();
      table.translated++;
      SWEEP_N.forEach((n, i) => {
        const want = values[i];
        const got = evaluateExpression(out.text, {
          values: new Map<string, Quantity>([['n', { value: n, dim: UNITLESS }]]),
        });
        if (want === null || want === undefined) {
          // FreeCAD has an error here (a division by zero, a root of a negative number …).
          expect(got.ok, `${expression} at ${n}: ${out.text}`).toBe(false);
          return;
        }
        expect(got.ok, `${expression} at ${n}: ${out.text}`).toBe(true);
        if (!got.ok) return;
        expect(within(got.value, want), `${expression} at ${n}: ${got.value} for ${want}`).toBe(
          true,
        );
        const dim = unit === 'length' ? [1, 0] : unit === 'angle' ? [0, 1] : [0, 0];
        expect([got.dim.length, got.dim.angle], `${expression}'s unit`).toEqual(dim);
      });
      table.equal++;
    });
  }
  it('adds up: 55 translated and equal at all 13 values, 14 refused', () => {
    expect(BIND_TOLERANCE).toBe(1e-9);
    expect(table).toEqual({ translated: 55, equal: 55, refused: 14 });
  });
});
