/**
 * The loft dialog (P4-01, ADR-0055, FR-FT-14): sections picked in order
 * (sketch profiles, flat faces, and a point at either end: a construction
 * point, a body vertex or a sketch point), smooth or ruled, open or closed
 * into a ring; new body, join, cut or intersect. Fields are named like the
 * feature's inputs (`LoftInputs`), so the framework's default mapping turns
 * them into inputs and back.
 */
import { LOFT_SECTION_KINDS, loftFeature } from '@extrudo/core';
import { proposeSweep } from './operation';
import { defineFeatureDialog } from './spec';
import { operationFields, previewStyleOf } from './sweep';

export const loftDialog = defineFeatureDialog({
  ...loftFeature,
  command: 'loft',
  fields: [
    {
      kind: 'selection',
      name: 'sections',
      label: 'Sections',
      accepts: LOFT_SECTION_KINDS,
      min: 2,
      sketchPoints: true,
      noun: ['section', 'sections'],
      prompt: 'Pick sections in order',
      hint: 'Profiles or flat faces on different planes, in the order the loft goes through them. A point can start or end it.',
    },
    {
      kind: 'toggle',
      name: 'ruled',
      label: 'Ruled',
      default: false,
      hint: 'Straight between neighbouring sections, instead of smooth through them all.',
    },
    {
      kind: 'toggle',
      name: 'closed',
      label: 'Closed',
      default: false,
      hint: 'Join the last section back to the first: a ring, with no end faces.',
    },
    ...operationFields('loft'),
  ],
  validate(values) {
    const sections = values.refs.sections ?? [];
    if (values.toggles.closed && sections.length > 0 && sections.length < 3) {
      return { field: 'sections', message: 'A closed loft needs at least three sections.' };
    }
    return undefined;
  },
  propose(values, ctx) {
    const sections = (values.refs.sections ?? []).filter(
      (ref) => ref.kind === 'profile' || ref.kind === 'face',
    );
    const operation = proposeSweep(sections, 'both', ctx.doc);
    return operation ? { choices: { operation } } : undefined;
  },
  previewStyle: previewStyleOf,
});
