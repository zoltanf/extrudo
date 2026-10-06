import { Plane, Vector3 } from 'three';
import type { SectionClip } from '../section/clip';

/** The clipping plane as three.js keeps it: it keeps what lies on its normal's side. */
export function planeOf(clip: SectionClip): Plane {
  const n = new Vector3(-clip.normal[0], -clip.normal[1], -clip.normal[2]);
  return new Plane(
    n,
    clip.normal[0] * clip.origin[0] +
      clip.normal[1] * clip.origin[1] +
      clip.normal[2] * clip.origin[2],
  );
}

/** Every section plane as three.js keeps it (several clip together: the model is their intersection). */
export function clipPlanes(clips: readonly SectionClip[] | undefined): Plane[] | undefined {
  if (!clips || clips.length === 0) return undefined;
  return clips.map(planeOf);
}
