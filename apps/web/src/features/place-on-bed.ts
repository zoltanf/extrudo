/**
 * The Place on Bed dialog (P3-10, ADR-0048, FR-3DP-04): one flat face. The
 * body it belongs to turns so that face lies on the build plate (XY, z = 0),
 * facing down; the live preview shows the placed body over the model. Also
 * reachable from a flat face's context list, which starts the dialog with
 * the face already picked (pre-selection).
 */
import { placeOnBedFeature } from '@extrudo/core';
import { defineFeatureDialog } from './spec';

export const placeOnBedDialog = defineFeatureDialog({
  ...placeOnBedFeature,
  command: 'placeOnBed',
  fields: [
    {
      kind: 'selection',
      name: 'face',
      label: 'Face',
      accepts: ['face'],
      max: 1,
      prompt: 'Pick a flat face',
      hint: 'The face goes down onto the bed (the XY plane) and its body turns with it.',
    },
  ],
  // The turned body over the model's own, which stays drawn where it is.
  previewStyle: () => 'new',
});
