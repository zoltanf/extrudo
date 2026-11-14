/**
 * The translator alone (ADR-0144 S10): FreeCAD's expression text, as the
 * truth table's part stores it (`PARAM_TRUTH`), written as Extrudo text and
 * evaluated by `@extrudo/core`. A row that is kept evaluates to the value
 * FreeCAD stored for its constraint; a row that isn't has its reason. The
 * import of the same part is in `parameters.test.ts`.
 */
import { evaluateExpression, type Quantity } from '@extrudo/core';
import { describe, expect, it } from 'vitest';
import { ANGLE, type EmitTarget, emitExtrudo, LENGTH, NONE, type Resolver } from './fc-emit';
import {
  FcSyntaxError,
  MAX_EXPRESSION_DEPTH,
  MAX_EXPRESSION_LENGTH,
  MAX_EXPRESSION_TOKENS,
  parseFcExpression,
} from './fc-expr';
import { PARAM_TRUTH } from './parameter-fixtures';

/** The truth table's sheet as the import makes it: `n` and `ratio` unitless, `len_mm` and `neg` lengths, `ang` an angle. */
const CELLS: Record<
  string,
  { value: number; kind: 'length' | 'angle' | 'unitless'; fc: 'none' | 'length' | 'angle' }
> = {
  n: { value: 30, kind: 'unitless', fc: 'none' },
  len_mm: { value: 8, kind: 'length', fc: 'length' },
  ang: { value: 60, kind: 'angle', fc: 'angle' },
  ratio: { value: 0.25, kind: 'unitless', fc: 'none' },
  neg: { value: -9, kind: 'length', fc: 'none' },
};
const dim = (k: string) => (k === 'length' ? LENGTH : k === 'angle' ? ANGLE : NONE);
const resolve: Resolver = (p) => {
  const [sheet, cell] = p.components;
  const c = cell && sheet?.name === 'Spreadsheet' ? CELLS[cell.name] : undefined;
  if (!c || p.components.length !== 2) return { reason: 'reference', detail: 'not a cell' };
  return { text: cell?.name as string, fc: dim(c.fc), ex: dim(c.kind) };
};
const values = new Map<string, Quantity>(
  Object.entries(CELLS).map(([name, c]) => [name, { value: c.value, dim: dim(c.kind) }]),
);

/** Translates and evaluates one stored expression for a constraint of `kind`. */
function run(text: string, kind: 'length' | 'angle') {
  let node: ReturnType<typeof parseFcExpression>;
  try {
    node = parseFcExpression(text);
  } catch (error) {
    if (error instanceof FcSyntaxError)
      return { reason: error.limit ? 'limit' : 'syntax' } as const;
    throw error;
  }
  const target: EmitTarget = { mode: 'constraint', dim: kind === 'length' ? LENGTH : ANGLE };
  const out = emitExtrudo(node, resolve, target);
  if (!out.ok) return { reason: out.reason } as const;
  const got = evaluateExpression(out.text, { values, kind });
  return { text: out.text, value: got.ok ? got.value : Number.NaN } as const;
}

/** Rows that stay numbers, by the expression as typed, with why. */
const NUMBERS: Record<string, string> = {
  'trunc(7.9)': 'function', // Extrudo has no trunc
  'exp(2)': 'function',
  'log(100)': 'function',
  'log10(1000)': 'function',
  'atan2(1; 1) / 5 deg': 'function', // no rewrite holds for every sign without a condition
  'atan2(1; 1)': 'function',
  '1 > 0 ? 7 : 9': 'operator',
  '(2 == 3) ? 7 : 9': 'operator',
};

describe('the truth table (ADR-0144 S10)', () => {
  it('has the 85 rows FreeCAD wrote, 3 of them refused by FreeCAD', () => {
    expect(PARAM_TRUTH).toHaveLength(85);
    expect(PARAM_TRUTH.filter((r) => !r[3]).map((r) => r[2])).toEqual([
      '(4 + 6) mm',
      'Spreadsheet.len_mm + 1',
      'Spreadsheet.n mm',
      'abs(Spreadsheet.neg) mm',
    ]);
  });

  for (const [kind, index, typed, accepted, stored, value] of PARAM_TRUTH) {
    if (!accepted || stored === null) {
      it(`refuses what FreeCAD refused: ${typed}`, () => {
        // FreeCAD left it out of the file; the typed text gets a reason here too.
        expect(['syntax', 'unit']).toContain((run(typed, kind) as { reason?: string }).reason);
      });
      continue;
    }
    const want = kind === 'angle' ? (value * 180) / Math.PI : value;
    const why = NUMBERS[typed];
    it(`${why ? 'leaves as a number' : 'keeps'} row ${index}: ${stored}`, () => {
      const got = run(stored, kind);
      if (why) {
        expect(got).toEqual({ reason: why });
        return;
      }
      expect('value' in got ? got.value : got).toBeCloseTo(want, 9);
      const v = (got as { value: number }).value;
      expect(Math.abs(v - want)).toBeLessThanOrEqual(1e-9 * Math.max(1, Math.abs(want)));
    });
  }

  it('writes what the two languages group differently with parentheses', () => {
    expect(run('2 ^ 3 ^ 2 / 10', 'length')).toMatchObject({ text: '(2 ^ 3) ^ 2 / 10 * 1 mm' });
    expect(run('-2 ^ 2 + 10', 'length')).toMatchObject({ text: '((-2) ^ 2 + 10) * 1 mm' });
    expect(run('1 / 2 in', 'length')).toMatchObject({ text: '1 / 2 in * 1 mm ^ 2' });
    expect(run('10 * sin(Spreadsheet.n)', 'length')).toMatchObject({
      text: '10 * sin(n * 1 deg) * 1 mm',
    });
    expect(run('Spreadsheet.n / 3', 'length')).toMatchObject({ text: 'n / 3 * 1 mm' });
    expect(run('17 % 5', 'length')).toMatchObject({ text: '(17 - 5 * floor(17 / 5)) * 1 mm' });
    expect(run('1 \' + 2 "', 'length')).toMatchObject({ text: '1 ft + 2 in' });
    expect(run('50 gon', 'angle')).toMatchObject({ text: '45 deg' });
    expect(run('0.5', 'length')).toMatchObject({ text: '0.5 mm' });
  });
});

describe('the parser’s limits (ADR-0144 S10)', () => {
  const reason = (text: string) => {
    try {
      parseFcExpression(text);
      return 'parsed';
    } catch (error) {
      return error instanceof FcSyntaxError ? (error.limit ? 'limit' : 'syntax') : 'threw';
    }
  };
  it('refuses past each limit, cleanly', () => {
    expect(reason('1'.repeat(MAX_EXPRESSION_LENGTH + 1))).toBe('limit');
    expect(reason(Array(MAX_EXPRESSION_TOKENS).fill('1').join('+'))).toBe('limit');
    expect(reason(`${'('.repeat(MAX_EXPRESSION_DEPTH)}1${')'.repeat(MAX_EXPRESSION_DEPTH)}`)).toBe(
      'limit',
    );
    expect(reason('-'.repeat(MAX_EXPRESSION_DEPTH + 1) + '1')).toBe('limit');
    expect(reason(`${'('.repeat(100_000)}1${')'.repeat(100_000)}`)).toBe('limit');
    expect(reason('x'.repeat(1024 * 1024))).toBe('limit');
  });
  it('reads what FreeCAD refuses as syntax', () => {
    expect(reason('Sheet.H')).toBe('syntax');
    expect(reason('.Constraints.W')).toBe('syntax');
    expect(reason('(4 + 6) mm')).toBe('syntax');
    expect(reason('nofunction(2)')).toBe('syntax');
    expect(reason('<<unterminated')).toBe('syntax');
    expect(reason('1 +')).toBe('syntax');
  });
  it('reads paths of every kind', () => {
    expect(parseFcExpression('<<Maße #1>>.width')).toMatchObject({
      kind: 'path',
      local: false,
      components: [
        { name: 'Maße #1', quoted: true },
        { name: 'width', quoted: false },
      ],
    });
    expect(parseFcExpression('Sketch.Constraints[11]')).toMatchObject({
      components: [{ name: 'Sketch' }, { name: 'Constraints', index: 11 }],
    });
    expect(parseFcExpression('.AttachmentOffset.Base.z')).toMatchObject({ local: true });
    expect(parseFcExpression('mod(17,5)')).toMatchObject({ kind: 'call', args: [{ value: 17.5 }] });
    expect(parseFcExpression('mod(17, 5)')).toMatchObject({
      kind: 'call',
      args: [{ value: 17 }, { value: 5 }],
    });
  });
});
