/**
 * Where a sketch lies (P2-09, ADR-0031): the frame of its plane. An origin
 * plane's is fixed; a construction plane's comes from the kernel's report on
 * it (P3-05), a face's from the kernel, which follows the face
 * through every recompute (`ModelState.sketches`). Until the kernel has
 * answered (a project just opened), or when it can't find the face any
 * more, the face's fingerprint gives the frame it had when it was picked.
 */
import {
  type ConstructionReports,
  type FeatureId,
  fingerprintFrame,
  type GeomRef,
  planeFrame,
  type SketchFrame,
  type SketchReport,
} from '@extrudo/core';

export type SketchReports = Readonly<Record<FeatureId, SketchReport>>;

export function sketchFrame(
  feature: FeatureId,
  plane: GeomRef,
  reports: SketchReports | undefined,
  construction?: ConstructionReports,
): SketchFrame | undefined {
  return planeFrame(plane, construction) ?? reports?.[feature]?.frame ?? fingerprintFrame(plane);
}
