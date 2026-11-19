/**
 * One sketch's regions and fill as the profile worker makes them (ADR-0154),
 * also run on the UI thread when no worker can start. Detection here never
 * remembers its result (`detectProfilesWork`), so nothing outlives the job.
 */
import type { SketchData } from '@extrudo/core';
import { detectProfilesWork, type Profile, profilesRefusal } from '@extrudo/sketch/profiles';
import { fillCost, profileFill } from '../viewport/profileFills';
import { type FlatRegions, flattenRegions } from './flatRegions';

export interface RegionsResult {
  regions?: FlatRegions;
  /** The most vertices the fill takes (`fillCost`), built or not. */
  vertices: number;
  fill?: { positions: Float32Array; starts: Uint32Array };
  /** Why detection refused the sketch. */
  refused?: string;
}

/**
 * The sketch's regions, flat, and its fill when it has at most
 * `maxFillVertices` and `mayBuild` agrees. A failed fill (no memory) leaves
 * the regions without one.
 */
export function regionsOf(
  data: SketchData,
  maxFillVertices: number,
  mayBuild: (profiles: readonly Profile[]) => boolean = () => true,
): RegionsResult {
  let profiles: Profile[];
  try {
    profiles = detectProfilesWork(data, { segments: 0, points: 0, tests: 0 });
  } catch (error) {
    const refusal = profilesRefusal(error);
    if (!refusal) throw error;
    return { vertices: 0, refused: refusal.message };
  }
  const regions = flattenRegions(profiles);
  const vertices = fillCost(profiles);
  if (vertices > maxFillVertices || !mayBuild(profiles)) return { regions, vertices };
  try {
    const built = profileFill(profiles);
    return { regions, vertices, fill: { positions: built.positions, starts: built.starts } };
  } catch {
    return { regions, vertices };
  }
}
