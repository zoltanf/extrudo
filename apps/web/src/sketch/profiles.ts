/**
 * A sketch's profiles (P1-11), detected once per version of its content.
 * The document is immutable, so the content object is the cache key: the
 * viewport's fills, the tool host's picking and the properties panel share
 * one detection. Text (P4-03) needs its font before it has ink, so the loaded
 * fonts' version is part of the key: fonts that arrive later redraw it.
 * A sketch whose curves cross too often, lie too far out or are too many has no profiles
 * (`sketchProfilesProblem` says why; ADR-0020's amendment of 2026-11-15).
 */
import {
  type FeatureId,
  parseProfileRefId,
  type SelectionItem,
  type SketchData,
} from '@extrudo/core';
import { detectProfiles, type Profile, ProfilesRefusedError } from '@extrudo/sketch/profiles';
import { fontsStore } from './fonts';

export { TOO_MANY_CROSSINGS } from '@extrudo/sketch/profiles';

interface Entry {
  profiles: readonly Profile[];
  /** The fonts' version the profiles were detected with. */
  version: number;
  /** Why `detectProfiles` refused the sketch (`ProfilesRefusedError`): there are no profiles. */
  refused?: string;
}

const cache = new WeakMap<SketchData, Entry>();

export function sketchProfiles(
  data: SketchData,
  version: number = fontsStore.getState().version,
): readonly Profile[] {
  return detected(data, version).profiles;
}

/**
 * Why the sketch has no profiles when `detectProfiles` refused it (its
 * curves cut each other too often, lie too far out or are too many), in the user's
 * words; `undefined` when it found them.
 */
export function sketchProfilesProblem(
  data: SketchData,
  version: number = fontsStore.getState().version,
): string | undefined {
  return detected(data, version).refused;
}

function detected(data: SketchData, version: number): Entry {
  const cached = cache.get(data);
  if (cached && cached.version === version) return cached;
  let entry: Entry;
  try {
    entry = { profiles: detectProfiles(data), version };
  } catch (error) {
    if (!(error instanceof ProfilesRefusedError)) throw error;
    entry = { profiles: [], version, refused: error.message };
  }
  cache.set(data, entry);
  return entry;
}

/** The regions of `feature` among selection items (IDs within the sketch). */
export function profileIdsIn(
  items: readonly (SelectionItem | undefined)[],
  feature: FeatureId,
): string[] {
  const out: string[] = [];
  for (const item of items) {
    if (item?.kind !== 'profile') continue;
    const ref = parseProfileRefId(item.id);
    if (ref?.feature === feature) out.push(ref.profile);
  }
  return out;
}
