/**
 * A sketch's profiles (P1-11), detected once per version of its content.
 * The document is immutable, so the content object is the cache key: the
 * viewport's fills, the tool host's picking and the properties panel share
 * one detection. Text (P4-03) needs its font before it has ink, so the loaded
 * fonts' version is part of the key: fonts that arrive later redraw it.
 */
import {
  type FeatureId,
  parseProfileRefId,
  type SelectionItem,
  type SketchData,
} from '@extrudo/core';
import { detectProfiles, type Profile } from '@extrudo/sketch/profiles';
import { fontsStore } from './fonts';

interface Entry {
  profiles: readonly Profile[];
  /** The fonts' version the profiles were detected with. */
  version: number;
}

const cache = new WeakMap<SketchData, Entry>();

export function sketchProfiles(
  data: SketchData,
  version: number = fontsStore.getState().version,
): readonly Profile[] {
  const entry = cache.get(data);
  if (entry && entry.version === version) return entry.profiles;
  const profiles = detectProfiles(data);
  cache.set(data, { profiles, version });
  return profiles;
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
