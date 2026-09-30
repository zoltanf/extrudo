/**
 * The Offset Face dialog (P3-08, ADR-0051, FR-FT-12): faces of a body and a
 * distance to move them along their normals, positive out of the body (it
 * grows there, a hole's wall closes in), negative into it. Fields are named
 * like the feature's inputs (`faces`, `distance`), so the framework's
 * default mapping turns them into inputs and back. Picking a face brings the
 * faces that run smoothly into it (`tangentChain`), because OCCT moves them
 * together: a pad's top takes the fillets around it along. A distance arrow
 * stands on the first face (curved faces too: on a point of the surface).
 * The press-pull command (`features/pressPull.ts`) opens this dialog for a
 * selected face.
 */
import { OFFSET_FACE_KINDS, offsetFaceFeature, type Vec3 } from '@extrudo/core';
import { surfaceFrame } from './geometry';
import {
  type DialogValues,
  defineFeatureDialog,
  type Manipulator,
  type ManipulatorContext,
} from './spec';

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
  ],
  manipulators: (values, ctx) => offsetManipulators(values, ctx),
  // The result replaces the body it reshapes: drawn as the body itself.
  previewStyle: () => 'new',
});

/** A distance arrow from the first picked face, along its outward normal. */
export function offsetManipulators(values: DialogValues, ctx: ManipulatorContext): Manipulator[] {
  const ref = values.refs.faces?.[0];
  const frame = ref && surfaceFrame(ctx.bodies, ref);
  if (!frame) return [];
  const direction: Vec3 = frame.normal;
  return [{ kind: 'distance', field: 'distance', origin: frame.origin, direction }];
}
