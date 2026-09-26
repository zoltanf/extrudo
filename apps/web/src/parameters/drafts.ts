import type { DimensionId, ExtrudoDocument, FeatureId } from '@extrudo/core';

/**
 * The document with one sketch dimension's expression replaced, for
 * evaluating a draft before it is committed (cycles, units, parameters).
 * Returns `doc` itself if there is no such dimension.
 */
export function withDimensionExpr(
  doc: ExtrudoDocument,
  feature: FeatureId,
  input: string,
  id: DimensionId,
  expr: string,
): ExtrudoDocument {
  let changed = false;
  const features = doc.features.map((f) => {
    const value = f.id === feature ? f.inputs[input] : undefined;
    const d = value?.kind === 'sketchData' ? value.sketch.dimensions[id] : undefined;
    if (value?.kind !== 'sketchData' || !d) return f;
    changed = true;
    const dimensions = { ...value.sketch.dimensions, [id]: { ...d, expr } };
    return {
      ...f,
      inputs: { ...f.inputs, [input]: { ...value, sketch: { ...value.sketch, dimensions } } },
    };
  });
  return changed ? { ...doc, features } : doc;
}
