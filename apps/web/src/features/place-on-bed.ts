/**
 * The Place on Bed dialog (P3-10, ADR-0048, FR-3DP-04): flat faces, one per
 * body. Each body turns so its face lies on the build plate (XY, z = 0),
 * facing down, and an optional Spin turns it about the vertical through the
 * face's centre (P3-17); the live preview shows the placed bodies over the
 * model. Also reachable from a flat face's context list, which starts the
 * dialog with the face already picked (pre-selection).
 */
import { placeOnBedFeature } from '@extrudo/core';
import { defineFeatureDialog, type FeatureDialogSpec } from './spec';
import { defaultInputs } from './values';

// Bound after its definition, so `toInputs` can use the default mapping.
let spec: FeatureDialogSpec;
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
    {
      kind: 'selection',
      name: 'carry',
      label: 'Carry along',
      accepts: ['body'],
      min: 0,
      prompt: 'Pick bodies to place with the face',
      hint: "Bodies that take the same turn and drop as the face's body, so a component is placed as one. One face only.",
    },
  ],
  // `carry` is stored only when a body is picked (ADR-0081 §3: optional), so
  // a place that carries nothing reads as it always did.
  toInputs(values, ctx) {
    const inputs = { ...defaultInputs(spec, values, ctx) };
    const carry = inputs.carry;
    if (carry?.kind === 'ref' && carry.refs.length === 0) delete inputs.carry;
    return inputs;
  },
  // The turned bodies over the model's own, which stay drawn where they are.
  previewStyle: () => 'new',
});
spec = placeOnBedDialog;
