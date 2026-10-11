import { type FeatureInputs, SKIP_LOST_EDGES_KEY } from '@extrudo/core';
import type { DialogField } from './spec';

/**
 * The fillet's and chamfer's "Skip lost edges" toggle (ADR-0038's and
 * ADR-0043's amendments, 2026-10-11): the last field of both dialogs. On, the
 * feature is built from the edges that are found and warns about the others
 * instead of failing; it is stored only while on (`withoutSkipOff`), so a
 * feature made with it off stores what it always did.
 */
export const skipLostEdgesField: DialogField = {
  kind: 'toggle',
  name: SKIP_LOST_EDGES_KEY,
  label: 'Skip lost edges',
  default: false,
  hint: "Build with the edges that can still be found and warn about the ones that can't, instead of failing.",
};

/** The inputs without the toggle while it is off. */
export function withoutSkipOff(inputs: FeatureInputs): FeatureInputs {
  const skip = inputs[SKIP_LOST_EDGES_KEY];
  if (skip?.kind === 'bool' && !skip.value) delete inputs[SKIP_LOST_EDGES_KEY];
  return inputs;
}
