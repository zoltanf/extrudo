/**
 * What `bind.ts` takes from `@extrudo/core` by its words, pinned here so a
 * change of wording in core fails a test (ADR-0144 S10's fix round), and
 * `sameOrNeg`'s stored 0.
 */
import {
  createDocument,
  evaluateExpression,
  evaluateParameters,
  MAX_CALL_ARGUMENTS,
  MAX_EXPRESSION_LENGTH,
  MAX_PARAMETER_DEPTH,
  type Parameter,
  type ParameterId,
} from '@extrudo/core';
import { describe, expect, it } from 'vitest';
import { CORE_DEPENDENT, coreReason, sameOrNeg } from './bind';

describe('core’s errors, as bind.ts tells them apart', () => {
  it('an expression that reads one with an error says "Uses `…`"', () => {
    const doc = createDocument({ name: 'x' });
    const parameters: Parameter[] = [
      { id: 'p1' as ParameterId, name: 'a', expression: 'b + 1', unit: 'unitless' },
      { id: 'p2' as ParameterId, name: 'b', expression: '1 / 0', unit: 'unitless' },
    ];
    const e = evaluateParameters({ ...doc, parameters });
    const a = e.parameters.get('a')?.result;
    expect(a?.ok).toBe(false);
    expect(a && !a.ok && a.error.message).toMatch(CORE_DEPENDENT);
    const b = e.parameters.get('b')?.result;
    expect(b && !b.ok && CORE_DEPENDENT.test(b.error.message)).toBe(false);
  });

  it('core’s limits are limits, by their code', () => {
    const long = `1${' '.repeat(MAX_EXPRESSION_LENGTH)}`;
    const many = `max(${Array(MAX_CALL_ARGUMENTS + 1)
      .fill('1')
      .join(', ')})`;
    const tall = Array(300).fill('1').join(' + ');
    for (const source of [long, many, tall]) {
      const r = evaluateExpression(source);
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.error.code).toBe('limit');
      expect(coreReason(r.error)).toBe('limit');
    }
    // Depth through parameters: `p0 = p1`, … `p10000 = 1`.
    const doc = createDocument({ name: 'x' });
    const n = MAX_PARAMETER_DEPTH + 1;
    const parameters = Array.from({ length: n }, (_, i) => ({
      id: `q${i}` as ParameterId,
      name: `p${i}`,
      expression: i === n - 1 ? '1' : `p${i + 1}`,
      unit: 'unitless' as const,
    }));
    const deep = evaluateParameters({ ...doc, parameters }).parameters.get('p0')?.result;
    expect(deep && !deep.ok && coreReason(deep.error)).toBe('limit');
  });

  it('a cycle by its code', () => {
    expect(coreReason({ code: 'cycle', message: 'x' })).toBe('cycle');
    expect(coreReason({ message: 'Division by zero.' })).toBe('differs');
  });
});

describe('sameOrNeg', () => {
  it('reads the sense off two numbers, never off a stored 0', () => {
    expect(sameOrNeg(5, 5)).toBe('same');
    expect(sameOrNeg(-5, 5)).toBe('neg');
    expect(sameOrNeg(0, 0)).toBe('zero');
    expect(sameOrNeg(0, -0)).toBe('zero');
    expect(sameOrNeg(4, 5)).toBeUndefined();
  });
});
