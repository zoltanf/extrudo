import { originPlane, type SketchInputs, sketchFeature } from '@extrudo/core';
import { KernelError } from '../kernel';
import type { KernelFeatureDefinition } from '../recompute/types';

/**
 * The sketch feature in the kernel. The sketch is solved on the UI thread
 * and stored solved (ADR-0010), so there is nothing to solve here. P2-02
 * turns its curves into OCCT edges and profile faces; for now it checks
 * that its plane exists.
 */
export const kernelSketch: KernelFeatureDefinition<SketchInputs> = {
  ...sketchFeature,
  // A sketch on a face follows that face, so it depends on the bodies.
  bodyAccess: (inputs) => (inputs.plane.refs[0]?.kind === 'face' ? 'read' : 'none'),
  evaluate({ inputs }) {
    const plane = inputs.plane.refs[0];
    if (plane?.kind === 'face') {
      throw new KernelError("This version of Extrudo can't place a sketch on a face.");
    }
    if (!plane || !originPlane(plane.id)) {
      throw new KernelError("Can't find this sketch's plane. Edit the sketch to pick another.");
    }
    return {};
  },
};
