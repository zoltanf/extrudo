import type { EvaluateResult, SketchData, UnitKind } from '@extrudo/core';

/**
 * The values of a sketch's driving dimensions for the solver: mm for
 * lengths, degrees for angles. Driven dimensions and those whose expression
 * doesn't evaluate are left out (the solver then skips them).
 */
export function dimensionValues(
  data: SketchData,
  evaluate: (expression: string, unit: UnitKind) => EvaluateResult,
): Record<string, number> {
  const values: Record<string, number> = {};
  for (const [id, d] of Object.entries(data.dimensions)) {
    if (d.driven) continue;
    const result = evaluate(d.expr, d.type === 'angle' ? 'angle' : 'length');
    if (result.ok) values[id] = result.value;
  }
  return values;
}
