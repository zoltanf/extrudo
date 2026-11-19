/**
 * A sketch's profiles (P1-11) on the UI thread, detected once per version of
 * its content. The document is immutable, so the content object is the key.
 * Text (P4-03) needs its font before it has ink, so for a sketch with text the
 * loaded fonts' version is part of the key: fonts that arrive later redraw it.
 * A sketch whose curves cross too often, lie too far out or are too many has no profiles
 * (`sketchProfilesProblem` says why; ADR-0020's amendment of 2026-11-15).
 *
 * What is kept is bounded (ADR-0154): the open sketch's result always stays, outside
 * the budget (`pinOpenSketch`); other results share the thread's budget of detection
 * results (`MAX_KEPT_PROFILE_BYTES`, `KeptResults`) and are found again when let
 * go of. A feature dialog's handles need only where each region's centre is
 * (`regionCentroid`, `inkCentroids`): for a sketch that isn't open those are
 * kept, not its profiles.
 */
import {
  type FeatureId,
  parseProfileRefId,
  type SelectionItem,
  type SketchData,
  type SketchEntityId,
  type Vec2,
} from '@extrudo/core';
import {
  detectProfilesWork,
  KeptResults,
  keptBytes,
  type Profile,
  ProfilesRefusedError,
  profileCentroid,
  stringBytes,
} from '@extrudo/sketch/profiles';
import { type FlatRegions, flatBytesOf, flattenRegions } from './flatRegions';
import { fontsStore } from './fonts';

export { TOO_MANY_CROSSINGS } from '@extrudo/sketch/profiles';

interface Entry {
  profiles: readonly Profile[];
  /** The fonts' version the profiles were detected with. */
  version: number;
  /** The sketch has text: only then does the version matter. */
  text: boolean;
  /** Why detection refused the sketch (`ProfilesRefusedError`): there are no profiles. */
  refused?: string;
  /** The regions flat, made when first asked for (counted from the start). */
  flat?: FlatRegions;
}

/** Each region's centre, and the text whose ink it is: all a dialog's handles need. */
interface Marks {
  version: number;
  text: boolean;
  centroids: ReadonlyMap<string, Vec2>;
  ink: ReadonlyMap<string, readonly Vec2[]>;
}

const cache = new KeptResults<SketchData, Entry>();
const marksCache = new KeptResults<SketchData, Marks>();
/** The open sketch, and its result once found: kept whatever the budget says, outside it. */
let pinned: { data: SketchData; entry?: Entry } | undefined;

declare global {
  interface Window {
    /**
     * Set to an array by e2e tests: every detection on the UI thread pushes its time, ms
     * (the open sketch's, a dialog's, the profile worker's fallback). A normal visit logs nothing.
     */
    __extrudoProfileLog?: number[];
  }
}

/** Notes a detection on the UI thread for e2e tests, when they asked (`__extrudoProfileLog`). */
export function logProfileWork(since: number): void {
  const log = typeof window !== 'undefined' ? window.__extrudoProfileLog : undefined;
  if (Array.isArray(log)) log.push(Math.round(performance.now() - since));
}

/** Whether the sketch has text that isn't construction: its regions depend on the fonts. */
export function hasText(data: SketchData): boolean {
  for (const id in data.entities) {
    const e = data.entities[id as SketchEntityId];
    if (e?.type === 'text' && !e.construction) return true;
  }
  return false;
}

export function sketchProfiles(
  data: SketchData,
  version: number = fontsStore.getState().version,
): readonly Profile[] {
  return detected(data, version).profiles;
}

/**
 * The sketch open now: its result, when found, is kept outside the budget until it
 * closes or its data is replaced (the profiles hidden or not). The one before goes
 * to the budget, if it fits.
 */
export function pinOpenSketch(data: SketchData): void {
  if (pinned?.data === data) return;
  closeOpenSketch();
  pinned = { data };
}

/** The open sketch's profiles: found here, as sketch mode needs them at once, and always kept. */
export function openSketchProfiles(
  data: SketchData,
  version: number = fontsStore.getState().version,
): readonly Profile[] {
  pinOpenSketch(data);
  return detected(data, version).profiles;
}

/** No sketch is open: its result goes to the budget, if it fits. */
export function closeOpenSketch(): void {
  if (pinned?.entry) cache.set(pinned.data, pinned.entry, entryBytes(pinned.entry));
  pinned = undefined;
}

/** The sketch's regions, flat (the open sketch's, for picking and the budget). */
export function sketchRegions(
  data: SketchData,
  version: number = fontsStore.getState().version,
): FlatRegions {
  const entry = detected(data, version);
  entry.flat ??= flattenRegions(entry.profiles);
  return entry.flat;
}

/** The sketch's profiles and, when detection refused it, why: both from one lookup. */
export function sketchProfilesFound(
  data: SketchData,
  version: number = fontsStore.getState().version,
): { profiles: readonly Profile[]; refused?: string } {
  return detected(data, version);
}

/**
 * Why the sketch has no profiles when detection refused it (its curves cut each
 * other too often, lie too far out or are too many), in the user's words;
 * `undefined` when it found them.
 */
export function sketchProfilesProblem(
  data: SketchData,
  version: number = fontsStore.getState().version,
): string | undefined {
  return detected(data, version).refused;
}

/** The centre of the region `id` (a feature dialog's handle), or `undefined`. */
export function regionCentroid(
  data: SketchData,
  id: string,
  version: number = fontsStore.getState().version,
): Vec2 | undefined {
  return marks(data, version).centroids.get(id);
}

/** The centres of the regions that are ink of the text `entity`. */
export function inkCentroids(
  data: SketchData,
  entity: string,
  version: number = fontsStore.getState().version,
): readonly Vec2[] {
  return marks(data, version).ink.get(entity) ?? [];
}

function valid<T extends { text: boolean; version: number }>(
  entry: T | undefined,
  version: number,
): T | undefined {
  return entry && (!entry.text || entry.version === version) ? entry : undefined;
}

function entryBytes(entry: Entry): number {
  return keptBytes(entry.profiles) + flatBytesOf(entry.profiles);
}

function detect(data: SketchData, version: number): Entry {
  const since = performance.now();
  const text = hasText(data);
  let entry: Entry;
  try {
    // Never the package's remembered copy: what the app keeps, it counts here.
    const profiles = detectProfilesWork(data, { segments: 0, points: 0, tests: 0 });
    entry = { profiles, version, text };
  } catch (error) {
    if (!(error instanceof ProfilesRefusedError)) throw error;
    entry = { profiles: [], version, text, refused: error.message };
  }
  logProfileWork(since);
  return entry;
}

/** The result at hand for `data`, if any: the open sketch's, or one still kept. */
function known(data: SketchData, version: number): Entry | undefined {
  if (pinned?.data !== data) return valid(cache.get(data), version);
  pinned.entry = valid(pinned.entry, version) ?? valid(cache.get(data), version);
  if (pinned.entry) cache.delete(data);
  return pinned.entry;
}

function detected(data: SketchData, version: number): Entry {
  const found = known(data, version);
  if (found) return found;
  const entry = detect(data, version);
  if (pinned?.data === data) pinned.entry = entry;
  else cache.set(data, entry, entryBytes(entry));
  return entry;
}

function marksOf(profiles: readonly Profile[], version: number, text: boolean): Marks {
  const centroids = new Map<string, Vec2>();
  const ink = new Map<string, Vec2[]>();
  for (const p of profiles) {
    const c = profileCentroid(p);
    centroids.set(p.id, c);
    if (!p.text) continue;
    const list = ink.get(p.text);
    if (list) list.push(c);
    else ink.set(p.text, [c]);
  }
  return { version, text, centroids, ink };
}

function marks(data: SketchData, version: number): Marks {
  const kept = valid(marksCache.get(data), version);
  if (kept) return kept;
  // A result already at hand (the open sketch's, or one still kept) needs no detection.
  const entry = known(data, version) ?? detect(data, version);
  const found = marksOf(entry.profiles, version, entry.text);
  let bytes = 128;
  for (const id of found.centroids.keys()) bytes += stringBytes(id) + 96;
  // A text's list: its ID, the list and a slot for each centre (the centres are counted above).
  for (const [id, list] of found.ink) bytes += stringBytes(id) + 64 + 8 * list.length;
  marksCache.set(data, found, bytes);
  return found;
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
