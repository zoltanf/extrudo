import { evaluateParameters, MAX_PARAMETER_DEPTH, parse } from '@extrudo/core';
import { describe, expect, it, vi } from 'vitest';
import type { ParameterValue } from './decode/parameters';
import { f3dToDesign } from './map';
import type { F3dDesign } from './model';

// Count the import's own evaluations and readings of expressions.
vi.mock('@extrudo/core', async (importOriginal) => {
  const original = await importOriginal<typeof import('@extrudo/core')>();
  return {
    ...original,
    evaluateParameters: vi.fn(original.evaluateParameters),
    parse: vi.fn(original.parse),
  };
});

const parameter = (p: Partial<ParameterValue> & Pick<ParameterValue, 'name'>): ParameterValue => ({
  id: 0,
  number: 1,
  expression: '',
  kind: 'User Parameter',
  comment: '',
  user: true,
  unit: 'mm',
  value: 0.1,
  ...p,
});

/** `p0 = abs(…abs(p1)…)`, … `p(n-1) = 1 mm`, each 255 levels around the next. */
function chain(n: number): F3dDesign {
  const nest = 254;
  return {
    parameters: [],
    userParameters: Array.from({ length: n }, (_, i) =>
      parameter({
        name: `p${i}`,
        number: i + 1,
        expression: i === n - 1 ? '1 mm' : `${'abs('.repeat(nest)}p${i + 1}${')'.repeat(nest)}`,
        value: 0.1,
      }),
    ),
    features: [],
    bodies: [],
    problems: [],
    unreadParameters: 0,
  } as unknown as F3dDesign;
}

function counted(n: number) {
  vi.mocked(evaluateParameters).mockClear();
  vi.mocked(parse).mockClear();
  const { design, report } = f3dToDesign(chain(n), 'Chain');
  return {
    evaluations: vi.mocked(evaluateParameters).mock.calls.length,
    parses: vi.mocked(parse).mock.calls.length,
    kept: report.notes.filter((note) => note.includes('kept as its value')).length,
    doc: design.toJSON(),
  };
}

describe('user parameters past the depth limit', () => {
  it('are found in one walk: the same evaluations however many chains of the limit there are', () => {
    const short = counted(50);
    const long = counted(800);
    // 800 parameters of 255 levels: a cut every 40 of them, the first 40 from the far end.
    const per = Math.floor((MAX_PARAMETER_DEPTH - 1) / 255) + 1;
    expect(long.kept).toBe(Math.floor(799 / per));
    expect(short.kept).toBe(1);
    expect(long.evaluations).toBe(short.evaluations);
    // Each expression is read once.
    expect(short.parses).toBe(50);
    expect(long.parses).toBe(800);
    const results = [...evaluateParameters(long.doc).parameters.values()].map((p) => p.result);
    expect(results.every((r) => r.ok)).toBe(true);
  });
});
