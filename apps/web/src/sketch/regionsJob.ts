/**
 * One sketch's regions and fill as the profile worker makes them (ADR-0154),
 * also run on the UI thread when no worker can start. Detection here never
 * remembers its result (`detectProfilesWork`), so nothing outlives the job.
 */
import type { SketchData } from '@extrudo/core';
import { detectProfilesWork, type Profile, profilesRefusal } from '@extrudo/sketch/profiles';
import { fillCost, profileFill } from '../viewport/profileFills';
import { type FlatRegions, flattenRegions, regionsBytes } from './flatRegions';

/** Bytes a fill keeps a vertex: 12 for its position, 4 for a drawing order (`fillLayout`). */
export const FILL_BYTES_PER_VERTEX = 16;

/**
 * What a fill of `vertices` vertices over `regions` regions keeps: the vertices,
 * each region's start (4 bytes) and its entry in the fill's index of regions
 * (a map entry and an ID slot, 64 bytes at most).
 */
export function fillBytes(vertices: number, regions: number): number {
  return FILL_BYTES_PER_VERTEX * vertices + 68 * (regions + 1);
}

export interface FoundRegions {
  profiles: Profile[];
  regions: FlatRegions;
  regionBytes: number;
  vertices: number;
}

/** The sketch's regions, flat, or why detection refused it. */
export function findRegions(data: SketchData): FoundRegions | { refused: string } {
  let profiles: Profile[];
  try {
    profiles = detectProfilesWork(data, { segments: 0, points: 0, tests: 0 });
  } catch (error) {
    const refusal = profilesRefusal(error);
    if (!refusal) throw error;
    return { refused: refusal.message };
  }
  const regions = flattenRegions(profiles);
  return { profiles, regions, regionBytes: regionsBytes(regions), vertices: fillCost(profiles) };
}

/** The fill of found regions, or `null` when it can't be built (no memory). */
export function buildFill(
  found: FoundRegions,
): { positions: Float32Array; starts: Uint32Array } | null {
  try {
    const built = profileFill(found.profiles);
    return { positions: built.positions, starts: built.starts };
  } catch {
    return null;
  }
}
