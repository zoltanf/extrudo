import type { BodyId } from '@extrudo/core';
import { useMemo } from 'react';
import type { ViewRegions } from '../features/preview';
import type { OverhangView } from '../print/overhang';
import type { SectionClip } from '../section/clip';
import type { SceneColors } from './colors';

/**
 * What the scene hands `Bodies` besides the meshes: the accent, the analyses' objects and the
 * region preview's, each the same object while its parts are (ADR-0159 §5). The scene renders
 * on every hover and every document change; a new accent there made every body and each of its
 * marks render with it.
 */
export function useBodyProps({
  colors,
  overhang,
  thin,
  collisions,
  sectionClip,
  regions,
}: {
  colors: SceneColors;
  overhang: OverhangView | undefined;
  thin: Record<BodyId, Float32Array> | undefined;
  collisions: Readonly<Record<BodyId, readonly number[]>> | undefined;
  sectionClip: readonly SectionClip[] | undefined;
  regions: ViewRegions | undefined;
}) {
  const accent = useMemo(() => ({ ...colors.preselect, a: 1 }), [colors]);
  const overhangLook = useMemo(
    () => overhang && { view: overhang, color: colors.overhang },
    [overhang, colors],
  );
  const thickness = useMemo(() => thin && { thin, color: colors.thickness }, [thin, colors]);
  const collisionLook = useMemo(
    () => collisions && { faces: collisions, color: colors.thickness },
    [collisions, colors],
  );
  const section = useMemo(
    () => sectionClip && { clips: sectionClip, color: colors.section, hatch: colors.sectionHatch },
    [sectionClip, colors],
  );
  const regionLook = useMemo(
    () =>
      regions && {
        view: regions,
        plane: colors.regionPlane,
        curved: colors.regionCurved,
        unfit: colors.regionUnfit,
      },
    [regions, colors],
  );
  return {
    accent,
    overhang: overhangLook,
    thickness,
    collisions: collisionLook,
    section,
    regions: regionLook,
  };
}
