/**
 * The Offset Face dialog (P3-08, ADR-0051, FR-FT-12): faces of a body and a
 * distance to move them along their normals, positive out of the body (it
 * grows there, a hole's wall closes in), negative into it. Fields are named
 * like the feature's inputs (`faces`, `distance`), so the framework's
 * default mapping turns them into inputs and back. Picking a face brings the
 * faces that run smoothly into it (`tangentChain`), because OCCT moves them
 * together, up to the fillet rounds next to it while Keep rounds' radius is
 * on (`keepRounds`, ADR-0051's second amendment, 2026-10-14): a wall is
 * picked without its rounds, which are made again at their radius, and a
 * line under the box counts them. On by default for a new offset; an offset
 * saved before the option has none, which reads as off. A distance arrow
 * stands on the first face (curved faces too: on a point of the surface).
 * The press-pull command (`features/pressPull.ts`) opens this dialog for a
 * selected face.
 */
import { type FeatureInputs, OFFSET_FACE_KINDS, offsetFaceFeature, type Vec3 } from '@extrudo/core';
import { surfaceFrame } from './geometry';
import {
  type DialogValues,
  defineFeatureDialog,
  keptRoundsKey,
  type Manipulator,
  type ManipulatorContext,
} from './spec';
import { defaultFromInputs } from './values';

export const offsetFaceDialog = defineFeatureDialog({
  ...offsetFaceFeature,
  command: 'offsetFace',
  fields: [
    {
      kind: 'selection',
      name: 'faces',
      label: 'Faces',
      accepts: OFFSET_FACE_KINDS,
      prompt: 'Pick faces',
      tangentChain: true,
      keepRounds: 'keepRounds',
      hint: 'Faces of a body, flat or curved. Picking a face takes the faces that run smoothly into it too: they move together.',
    },
    {
      kind: 'expression',
      name: 'distance',
      label: 'Distance',
      unit: 'length',
      default: '2 mm',
      hint: 'Positive moves the faces out along their normals (the body grows), negative moves them in.',
    },
    {
      kind: 'toggle',
      name: 'keepRounds',
      label: 'Keep rounds’ radius',
      default: true,
      hint: 'Rounded edges next to a moved face keep their radius and follow it. Off, the rounds move with the face and grow or shrink.',
    },
    {
      kind: 'info',
      name: 'keptRounds',
      label: 'Rounds',
      text: (values) => keptRoundsText(values),
      shown: (values) => (values.labels[KEPT]?.length ?? 0) > 0,
    },
  ],
  // An offset saved before Keep rounds' radius has no such input: it is off.
  fromInputs: (inputs: FeatureInputs) => {
    const values = defaultFromInputs(offsetFaceDialog, inputs);
    const keep = inputs.keepRounds;
    return {
      ...values,
      toggles: { ...values.toggles, keepRounds: keep?.kind === 'bool' && keep.value },
    };
  },
  manipulators: (values, ctx) => offsetManipulators(values, ctx),
  // The result replaces the body it reshapes: drawn as the body itself.
  previewStyle: () => 'new',
});

const KEPT = keptRoundsKey('faces');

/** "2 rounds keep their radius": the rounds next to the picked faces. */
export function keptRoundsText(values: DialogValues): string {
  const count = values.labels[KEPT]?.length ?? 0;
  return `${count} ${count === 1 ? 'round keeps its' : 'rounds keep their'} radius`;
}

/** A distance arrow from the first picked face, along its outward normal. */
export function offsetManipulators(values: DialogValues, ctx: ManipulatorContext): Manipulator[] {
  const ref = values.refs.faces?.[0];
  const frame = ref && surfaceFrame(ctx.bodies, ref);
  if (!frame) return [];
  const direction: Vec3 = frame.normal;
  return [{ kind: 'distance', field: 'distance', origin: frame.origin, direction }];
}
