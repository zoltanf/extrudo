import { type FeatureInputs, SKIP_LOST_EDGES_KEY } from '@extrudo/core';
import type { DialogField, DialogValues } from './spec';

/**
 * The fillet's and chamfer's "Skip lost edges" toggle (ADR-0038's and
 * ADR-0043's amendments, 2026-10-11): the last field of both dialogs. On, the
 * feature is built from the edges that are found and warns about the others
 * instead of failing; it is stored only while on (`withoutSkipOff`), so a
 * feature made with it off stores what it always did.
 *
 * **Shown only for a feature that has it on** (the owner, 2026-10-11): an
 * imported one, or one an API call or a macro made. Opening such a feature
 * marks the dialog (`withSkipShown`), so the box stays while the dialog is
 * open even after it is unticked and can be ticked back; a fresh fillet or
 * chamfer never shows it.
 */
export const skipLostEdgesField: DialogField = {
  kind: 'toggle',
  name: SKIP_LOST_EDGES_KEY,
  label: 'Skip lost edges',
  default: false,
  hint: "Build with the edges that can still be found and warn about the ones that can't, instead of failing.",
  shown: (values) =>
    values.toggles[SKIP_SHOWN] === true || values.toggles[SKIP_LOST_EDGES_KEY] === true,
};

/** The dialog's own mark that the feature opened with the toggle on; no input. */
const SKIP_SHOWN = 'skipLostEdgesShown';

/** The values read from a stored feature, marked to show the toggle when it is on. */
export function withSkipShown(values: Partial<DialogValues>): Partial<DialogValues> {
  if (values.toggles?.[SKIP_LOST_EDGES_KEY] !== true) return values;
  return { ...values, toggles: { ...values.toggles, [SKIP_SHOWN]: true } };
}

/** The inputs without the toggle while it is off. */
export function withoutSkipOff(inputs: FeatureInputs): FeatureInputs {
  const skip = inputs[SKIP_LOST_EDGES_KEY];
  if (skip?.kind === 'bool' && !skip.value) delete inputs[SKIP_LOST_EDGES_KEY];
  return inputs;
}
