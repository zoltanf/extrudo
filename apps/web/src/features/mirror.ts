/**
 * The Mirror dialog (P3-06, ADR-0044, FR-FT-11): bodies, the plane to
 * mirror about (an origin plane, a construction plane or a flat face,
 * picked like Create Sketch's plane), "Copy" (on by default: the originals
 * stay and the mirrored bodies are new) and, with a copy, "Join". Fields
 * are named like the feature's inputs (`MirrorInputs`).
 */
import { MIRROR_PLANE_KINDS, mirrorFeature } from '@extrudo/core';
import { defineFeatureDialog } from './spec';

export const mirrorDialog = defineFeatureDialog({
  ...mirrorFeature,
  command: 'mirror',
  fields: [
    {
      kind: 'selection',
      name: 'bodies',
      label: 'Bodies',
      accepts: ['body'],
      prompt: 'Pick bodies',
      hint: 'The bodies to mirror.',
    },
    {
      kind: 'selection',
      name: 'plane',
      label: 'Plane',
      accepts: MIRROR_PLANE_KINDS,
      max: 1,
      prompt: 'Pick a plane or flat face',
      hint: 'An origin plane, a construction plane or a flat face of a body.',
    },
    {
      kind: 'toggle',
      name: 'copy',
      label: 'Copy',
      default: true,
      hint: 'Keep the originals and add mirrored bodies. Off: mirror the bodies themselves.',
    },
    {
      kind: 'toggle',
      name: 'join',
      label: 'Join',
      default: false,
      hint: 'Fuse each mirrored copy into its original, so a symmetric part comes from half of it.',
      shown: (v) => v.toggles.copy ?? true,
    },
  ],
  // The result is new (or moved) bodies over the model's own.
  previewStyle: () => 'new',
});
