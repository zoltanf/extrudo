import {
  dimensionUnit,
  type FeatureId,
  type ParameterEvaluation,
  type SketchData,
} from '@extrudo/core';

/**
 * The values of a sketch's driving dimensions for the solver: mm for
 * lengths, degrees for angles. They come from the parameter graph
 * (`evaluation.dimensions`, so `d1` and cycles resolve as everywhere else);
 * a dimension the document doesn't have yet (one being added) is evaluated
 * on its own. Driven dimensions and those whose expression doesn't evaluate
 * are left out (the solver then skips them).
 */
export function dimensionValues(
  data: SketchData,
  evaluation: Pick<ParameterEvaluation, 'dimensions' | 'evaluate'>,
  feature?: FeatureId,
): Record<string, number> {
  const known = feature === undefined ? undefined : evaluation.dimensions.get(feature);
  const values: Record<string, number> = {};
  for (const [id, d] of Object.entries(data.dimensions)) {
    if (d.driven) continue;
    const result = known?.get(id) ?? evaluation.evaluate(d.expr, dimensionUnit(d));
    if (result.ok) values[id] = result.value;
  }
  return values;
}
