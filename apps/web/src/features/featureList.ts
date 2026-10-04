/**
 * The features a pattern or mirror can repeat (P3-07, ADR-0047): the ones
 * before the draft in the timeline that make a solid, are not suppressed,
 * and join or cut (a feature that makes a new body has no tool to repeat:
 * pattern or mirror its body instead).
 */
import {
  EMBOSS_TYPE,
  type ExtrudoDocument,
  type Feature,
  type FeatureId,
  HOLE_TYPE,
  RIB_TYPE,
  THREAD_TYPE,
} from '@extrudo/core';

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
  // A hole and a thread have no operation input: they always cut.
  if (feature.type === HOLE_TYPE || feature.type === THREAD_TYPE) return 'cut';
  // A rib has none either: it always joins the bodies it reaches.
  if (feature.type === RIB_TYPE) return 'join';
  // An emboss has a `mode` instead of an `operation`: it joins or cuts.
  if (feature.type === EMBOSS_TYPE) {
    const mode = feature.inputs.mode;
    return mode?.kind === 'enum' && mode.value === 'deboss' ? 'cut' : 'join';
  }
  const input = feature.inputs.operation;
  const value = input?.kind === 'enum' ? input.value : undefined;
  return value === 'join' || value === 'cut' ? value : undefined;
}
