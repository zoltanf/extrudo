/**
 * The shell dialog (P3-03, ADR-0046, FR-FT-06): faces to remove, a wall
 * thickness and the side the walls grow on. Fields are named like the
 * feature's inputs (`faces`, `bodies`, `thickness`, `direction`), so the
 * framework's default mapping turns them into inputs and back.
 *
 * With no face picked the body is hollowed closed (a sealed void), so the
 * Bodies field shows while no face is picked: a body selected before the
 * tool opens fills it. A failure shows its message in the dialog ("A 12 mm
 * wall is too thick for this body (max ≈ 9.9 mm)").
 */
import { SHELL_DIRECTIONS, SHELL_FACE_KINDS, shellFeature } from '@extrudo/core';
import { type DialogValues, defineFeatureDialog } from './spec';

const count = (values: DialogValues, field: string) => values.refs[field]?.length ?? 0;

const DIRECTION_LABELS: Record<(typeof SHELL_DIRECTIONS)[number], string> = {
  inside: 'Inside',
  outside: 'Outside',
};

export const shellDialog = defineFeatureDialog({
  ...shellFeature,
  command: 'shell',
  fields: [
    {
      kind: 'selection',
      name: 'faces',
      label: 'Faces to remove',
      accepts: SHELL_FACE_KINDS,
      min: 0,
      prompt: 'Pick faces',
      hint: 'The openings. Faces of several bodies are fine. Pick none to hollow a body out with a sealed void.',
    },
    {
      kind: 'selection',
      name: 'bodies',
      label: 'Body',
      accepts: ['body'],
      min: 0,
      prompt: 'Pick a body',
      hint: 'A body to hollow out with no opening. Bodies of the picked faces are shelled anyway.',
      shown: (v) => count(v, 'faces') === 0 || count(v, 'bodies') > 0,
    },
    {
      kind: 'expression',
      name: 'thickness',
      label: 'Thickness',
      unit: 'length',
      default: '2 mm',
      hint: 'The wall thickness.',
    },
    {
      kind: 'choice',
      name: 'direction',
      label: 'Direction',
      options: SHELL_DIRECTIONS.map((value) => ({ value, label: DIRECTION_LABELS[value] })),
      default: 'inside',
      hint: 'Inside keeps the outside of the body where it is; outside keeps its surface as the cavity, so the part grows.',
    },
  ],
  validate(values) {
    if (count(values, 'faces') === 0 && count(values, 'bodies') === 0) {
      return { field: 'faces', message: 'Pick a face to remove, or a body to hollow out.' };
    }
    return undefined;
  },
  // The result replaces the body it hollows: drawn as the body itself.
  previewStyle: () => 'new',
});
