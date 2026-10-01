/**
 * The Draft dialog (P3-08, FR-FT-12): faces to tilt, the neutral plane they
 * turn about (an origin plane, a construction plane or a flat face; its
 * normal is the pull direction), the angle and Flip. Fields are named like
 * the feature's inputs (`DraftInputs`), so the framework's default mapping
 * turns them into inputs and back. Picking a face brings the faces that run
 * smoothly into it (`tangentChain`), because OCCT tilts them together.
 *
 * In the view an angle arc stands where the first face meets the neutral
 * plane: it starts along the pull direction (so it shows which way that
 * is) and turns towards the inside of the face by the angle; dragging it
 * sets the angle.
 */
import { DRAFT_FACE_KINDS, DRAFT_PLANE_KINDS, draftFeature, type Vec3 } from '@extrudo/core';
import { surfaceFrame } from './geometry';
import { cross } from './manipulate';
import { placementFrame } from './primitives';
import {
  type DialogValues,
  defineFeatureDialog,
  type Manipulator,
  type ManipulatorContext,
} from './spec';

export const draftDialog = defineFeatureDialog({
  ...draftFeature,
  command: 'draft',
  fields: [
    {
      kind: 'selection',
      name: 'faces',
      label: 'Faces',
      accepts: DRAFT_FACE_KINDS,
      prompt: 'Pick faces',
      tangentChain: true,
      hint: 'Flat, cylindrical or conical faces. Faces that run smoothly into a picked one tilt with it.',
    },
    {
      kind: 'selection',
      name: 'plane',
      label: 'Plane',
      accepts: DRAFT_PLANE_KINDS,
      max: 1,
      prompt: 'Pick the neutral plane',
      hint: 'The faces turn about where they meet this plane (an origin or construction plane, or a flat face). Its normal is the pull direction.',
    },
    {
      kind: 'expression',
      name: 'angle',
      label: 'Angle',
      unit: 'angle',
      default: '3 deg',
      hint: 'Positive narrows the body along the pull, as a part drawn out of a mould; negative widens it.',
    },
    {
      kind: 'toggle',
      name: 'flip',
      label: 'Flip',
      default: false,
      hint: 'Pull the other way: against the plane’s normal.',
    },
  ],
  manipulators: (values, ctx) => draftManipulators(values, ctx),
  // The result replaces the body it reshapes: drawn as the body itself.
  previewStyle: () => 'new',
});

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit = (v: Vec3): Vec3 | undefined => {
  const length = Math.hypot(v[0], v[1], v[2]);
  return length > 1e-9 ? [v[0] / length, v[1] / length, v[2] / length] : undefined;
};

/**
 * The angle arc: at the first face's centre dropped onto the neutral plane
 * along the pull, turning about the line the face tilts about (face normal ×
 * pull) from the pull direction towards the face's inside, which is how a
 * positive draft turns it. None until a face and a plane are picked, or for
 * a face parallel to the plane.
 */
export function draftManipulators(values: DialogValues, ctx: ManipulatorContext): Manipulator[] {
  const face = values.refs.faces?.[0];
  const plane = placementFrame(values.refs.plane?.[0], ctx);
  const frame = face && surfaceFrame(ctx.bodies, face);
  if (!frame || !plane) return [];
  const flip = values.toggles.flip ?? false;
  const pull: Vec3 = flip
    ? [0 - plane.normal[0], 0 - plane.normal[1], 0 - plane.normal[2]]
    : plane.normal;
  const axis = unit(cross(frame.normal, pull));
  if (!axis) return [];
  const height = dot(sub(frame.origin, plane.origin), pull);
  const origin: Vec3 = [
    frame.origin[0] - pull[0] * height,
    frame.origin[1] - pull[1] * height,
    frame.origin[2] - pull[2] * height,
  ];
  return [{ kind: 'angle', field: 'angle', origin, axis, zero: pull }];
}
