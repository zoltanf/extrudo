/**
 * The Place on Bed dialog (P3-10, ADR-0048, FR-3DP-04): flat faces, one per
 * body. Each body turns so its face lies on the build plate (XY, z = 0),
 * facing down, and an optional Spin turns it about the vertical through the
 * face's centre (P3-17); the live preview shows the placed bodies over the
 * model. Also reachable from a flat face's context list, which starts the
 * dialog with the face already picked (pre-selection).
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
      prompt: 'Pick a flat face',
      hint: 'The face goes down onto the bed (the XY plane) and its body turns with it. Pick one face on each body to place several.',
    },
    {
      kind: 'expression',
      name: 'spin',
      label: 'Spin',
      unit: 'angle',
      default: '0 deg',
      hint: 'Turns the body about the vertical through the middle of its face, once it lies on the bed.',
    },
  ],
  // The turned bodies over the model's own, which stay drawn where they are.
  previewStyle: () => 'new',
});
