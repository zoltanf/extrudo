/**
 * A sketch's profiles (P1-11), detected once per version of its content.
 * The document is immutable, so the content object is the cache key: the
 * viewport's fills, the tool host's picking and the properties panel share
 * one detection. Text (P4-03) needs its font before it has ink, so the loaded
 * fonts' version is part of the key: fonts that arrive later redraw it.
 * A sketch whose curves cross too often has no profiles
 * (`sketchProfilesRefused` says so; ADR-0020's amendment of 2026-11-15).
 */
import {
  type FeatureId,
  parseProfileRefId,
  type SelectionItem,
  type SketchData,
} from '@extrudo/core';
import { detectProfiles, type Profile, TooManyCrossingsError } from '@extrudo/sketch/profiles';
import { fontsStore } from './fonts';

export { TOO_MANY_CROSSINGS } from '@extrudo/sketch/profiles';

interface Entry {
  profiles: readonly Profile[];
  /** The fonts' version the profiles were detected with. */
  version: number;
  /** The curves cross too often to find the profiles (`MAX_PROFILE_CUTS`): there are none. */
  refused?: true;
}

const cache = new WeakMap<SketchData, Entry>();

export function sketchProfiles(
  data: SketchData,
  version: number = fontsStore.getState().version,
): readonly Profile[] {
  return detected(data, version).profiles;
}

/** Whether the sketch's curves cross too often for its profiles to be found (it then has none). */
export function sketchProfilesRefused(
  data: SketchData,
  version: number = fontsStore.getState().version,
): boolean {
  return detected(data, version).refused === true;
}

function detected(data: SketchData, version: number): Entry {
  const cached = cache.get(data);
  if (cached && cached.version === version) return cached;
  let entry: Entry;
  try {
    entry = { profiles: detectProfiles(data), version };
  } catch (error) {
    if (!(error instanceof TooManyCrossingsError)) throw error;
    entry = { profiles: [], version, refused: true };
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
