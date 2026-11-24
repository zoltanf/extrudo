import type { BodyId } from '@extrudo/core';
import { useMemo } from 'react';
import type { OverhangView } from '../print/overhang';
import type { SectionClip } from '../section/clip';
import type { SceneColors } from './colors';

/**
 * What the scene hands `Bodies` besides the meshes: the accent and the analyses' objects, each
 * the same object while its parts are (ADR-0159 §5). The scene renders on every hover and every
 * document change; a new accent there made every body and each of its marks render with it.
 */
export function useBodyProps({
  colors,
  overhang,
  thin,
  collisions,
  sectionClip,
}: {
  colors: SceneColors;
  overhang: OverhangView | undefined;
  thin: Record<BodyId, Float32Array> | undefined;
  collisions: Readonly<Record<BodyId, readonly number[]>> | undefined;
  sectionClip: readonly SectionClip[] | undefined;
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
  return { accent, overhang: overhangLook, thickness, collisions: collisionLook, section };
}
