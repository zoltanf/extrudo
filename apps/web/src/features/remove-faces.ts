/**
 * The Remove Faces dialog (P4-13, ADR-0099 §6): faces of a body taken out
 * of it, their neighbours extended or trimmed to close the gap, so a hole
 * closes up and a round becomes a sharp edge again. The one field
 * multi-picks faces through the kernel's `removeFacesPick` (`pick`), so a
 * click takes a whole round or hole; an info line counts them. No
 * manipulator; the live preview comes from the framework. Fields are named
 * like the feature's inputs (`faces`), so the framework's default mapping
 * turns them into inputs and back.
 */
import { REMOVE_FACES_KINDS, removeFacesFeature } from '@extrudo/core';
import { type DialogValues, defineFeatureDialog } from './spec';

export const removeFacesDialog = defineFeatureDialog({
  ...removeFacesFeature,
  command: 'removeFaces',
  fields: [
    {
      kind: 'selection',
      name: 'faces',
      label: 'Faces',
      accepts: REMOVE_FACES_KINDS,
      prompt: 'Pick faces',
      pick: 'removeFaces',
      hint: 'Faces of a body. A click takes a whole round or hole.',
    },
    {
      kind: 'info',
      name: 'picked',
      label: 'Picked',
      text: (values) => pickedFacesText(values),
    },
  ],
});

/** "1 face" / "N faces": what the pick holds for the removal. */
export function pickedFacesText(values: DialogValues): string {
  const count = values.refs.faces?.length ?? 0;
  return count === 1 ? '1 face' : `${count} faces`;
}
