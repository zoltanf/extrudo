/**
 * The features a pattern or mirror can repeat (P3-07, ADR-0047): the ones
 * before the draft in the timeline that make a solid, are not suppressed,
 * and join or cut (a feature that makes a new body has no tool to repeat:
 * pattern or mirror its body instead).
 */
import type { ExtrudoDocument, Feature, FeatureId } from '@extrudo/core';

export interface ListedFeature {
  id: FeatureId;
  name: string;
  /** What it does with its solid. */
  operation: 'join' | 'cut';
}

/**
 * The listable features of `doc` that come before position `index` (where
 * the draft sits), in timeline order, of these types.
 */
export function repeatableFeatures(
  doc: Pick<ExtrudoDocument, 'features'>,
  index: number,
  types: readonly string[],
): ListedFeature[] {
  const out: ListedFeature[] = [];
  doc.features.slice(0, index).forEach((feature) => {
    const operation = operationOf(feature);
    if (types.includes(feature.type) && !feature.suppressed && operation) {
      out.push({ id: feature.id, name: feature.name, operation });
    }
  });
  return out;
}

function operationOf(feature: Feature): 'join' | 'cut' | undefined {
  const input = feature.inputs.operation;
  const value = input?.kind === 'enum' ? input.value : undefined;
  return value === 'join' || value === 'cut' ? value : undefined;
}
