/**
 * A sketch's profiles (P1-11), detected once per version of its content.
 * The document is immutable, so the content object is the cache key: the
 * viewport's fills, the tool host's picking and the properties panel share
 * one detection.
 */
import {
  type FeatureId,
  parseProfileRefId,
  type SelectionItem,
  type SketchData,
} from '@extrudo/core';
import { detectProfiles, type Profile } from '@extrudo/sketch/profiles';

const cache = new WeakMap<SketchData, readonly Profile[]>();

export function sketchProfiles(data: SketchData): readonly Profile[] {
  let profiles = cache.get(data);
  if (!profiles) {
    profiles = detectProfiles(data);
    cache.set(data, profiles);
  }
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
