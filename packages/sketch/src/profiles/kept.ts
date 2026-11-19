/**
 * What detection results a thread keeps, bounded in sum (ADR-0154). Every
 * cache of detection results (the package's own for frozen sketch data, the
 * app's) keeps its entries here: looked up by their key object, like a
 * `WeakMap`, but all of them share one budget of bytes and a count, and the
 * least recently used go first. An entry is let go of when its budget runs out
 * or its key is collected, whichever comes first; what is let go of is found
 * again when asked.
 */
import type { Profile } from './profiles';

/**
 * The most bytes the detection results kept by all caches of a thread may take
 * together, by `keptBytes`' estimate (an upper bound). A sketch whose result alone
 * is larger is found again each time it is asked for; its caller keeps what it needs.
 */
export const MAX_KEPT_PROFILE_BYTES = 64 * 1024 * 1024;

/** The most results kept, however small: each also keeps its key's entry alive until let go. */
export const MAX_KEPT_PROFILE_RESULTS = 256;

interface Slot {
  key: WeakRef<object>;
  owner: WeakMap<object, Slot>;
  value: unknown;
  bytes: number;
}

/** Every kept entry of every cache, least recently used first. */
const order = new Map<Slot, true>();
let total = 0;
const limits = { bytes: MAX_KEPT_PROFILE_BYTES, results: MAX_KEPT_PROFILE_RESULTS };

/** Smaller limits for a test; no arguments puts the real ones back. */
export function setKeptLimits(
  bytes = MAX_KEPT_PROFILE_BYTES,
  results = MAX_KEPT_PROFILE_RESULTS,
): void {
  limits.bytes = bytes;
  limits.results = results;
  evict();
}

function evict(): void {
  for (const slot of order.keys()) {
    if (total <= limits.bytes && order.size <= limits.results) return;
    order.delete(slot);
    total -= slot.bytes;
    const key = slot.key.deref();
    if (key && slot.owner.get(key) === slot) slot.owner.delete(key);
  }
}

/** A cache of detection results by key object, within the shared budget. */
export class KeptResults<K extends object, V> {
  readonly #map = new WeakMap<object, Slot>();

  get(key: K): V | undefined {
    const slot = this.#map.get(key);
    if (!slot) return undefined;
    order.delete(slot);
    order.set(slot, true);
    return slot.value as V;
  }

  /** Keeps `value` for `key`, counted as `bytes`, and lets go of the oldest past the budget. */
  set(key: K, value: V, bytes: number): void {
    this.delete(key);
    const slot: Slot = { key: new WeakRef(key), owner: this.#map, value, bytes };
    this.#map.set(key, slot);
    order.set(slot, true);
    total += bytes;
    evict();
  }

  delete(key: K): void {
    const slot = this.#map.get(key);
    if (!slot) return;
    this.#map.delete(key);
    if (order.delete(slot)) total -= slot.bytes;
  }
}

/** What all caches keep now, by estimate, and how many results: for tests. */
export function keptTotals(): { bytes: number; results: number } {
  return { bytes: total, results: order.size };
}

/** What a string keeps: two bytes a character and a header. */
export const stringBytes = (text: string) => 2 * text.length + 32;

/**
 * An upper bound of what a list of regions keeps: per point (its `[x, y]` array,
 * its slot in an edge's list and in the polygon), per edge, loop and region (the
 * objects, their lists and the region's ID). Measured against the heap it holds:
 * 79 bytes a point for the largest lists without pointer compression, so 96 leaves room.
 */
export function keptBytes(profiles: readonly Profile[]): number {
  let bytes = 64;
  for (const profile of profiles) {
    bytes += 256 + stringBytes(profile.id);
    for (const loop of [profile.outer, ...profile.holes]) {
      bytes += 128 + 8 * loop.polygon.length;
      for (const edge of loop.edges) bytes += 96 + 96 * edge.points.length;
    }
  }
  return bytes;
}
