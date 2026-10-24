import { useCallback, useSyncExternalStore } from 'react';
import type { Preferences } from '../platform';
import {
  DEFAULT_KEYMAP,
  defaultKeysFor,
  type KeymapOverrides,
  keymapOverrides,
  keysFor,
  setKeymapOverrides,
  subscribeKeymap,
} from './keymap';

/** The person's own keys (ADR-0082's 2026-10-18 amendment): only what they changed. */
export const KEYMAP_PREFERENCE = 'keymap.overrides';

/** The two modes a command can be offered in. */
export type KeymapMode = 'model' | 'sketch';

const sameKeys = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((key, i) => key === b[i]);

/** A stored value as overrides: string lists only, and none that equals its default. */
export function cleanOverrides(raw: unknown): KeymapOverrides {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, readonly string[]> = {};
  for (const [id, keys] of Object.entries(raw)) {
    if (!Array.isArray(keys) || !keys.every((k) => typeof k === 'string' && k !== '')) continue;
    if (id in DEFAULT_KEYMAP && sameKeys(keys, defaultKeysFor(id))) continue;
    out[id] = keys;
  }
  return out;
}

export interface KeymapStore {
  get(): KeymapOverrides;
  /** A command's keys; its default keys back remove the override. */
  set(id: string, keys: readonly string[]): void;
  /** Several commands at once (a Replace takes the key from another command too). */
  setMany(changes: Readonly<Record<string, readonly string[]>>): void;
  reset(id: string): void;
  resetAll(): void;
  subscribe(listener: () => void): () => void;
}

/**
 * One store per `Preferences`, like the print settings' (ADR-0082): creating it reads the
 * preference and hands it to `keysFor`, so `App` creates it before anything shows a key.
 */
const stores = new WeakMap<Preferences, KeymapStore>();

export function keymapStore(preferences: Preferences): KeymapStore {
  const found = stores.get(preferences);
  if (found) return found;
  let current = cleanOverrides(preferences.get<unknown>(KEYMAP_PREFERENCE, {}));
  setKeymapOverrides(current);
  const listeners = new Set<() => void>();
  const write = (next: KeymapOverrides) => {
    current = cleanOverrides(next);
    setKeymapOverrides(current);
    preferences.set(KEYMAP_PREFERENCE, current);
    for (const listener of listeners) listener();
  };
  const without = (id: string) => {
    const { [id]: _, ...rest } = current;
    return rest;
  };
  const store: KeymapStore = {
    get: () => current,
    set: (id, keys) => write({ ...current, [id]: keys }),
    setMany: (changes) => write({ ...current, ...changes }),
    reset: (id) => write(without(id)),
    resetAll: () => write({}),
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
  stores.set(preferences, store);
  return store;
}

/** The overrides, live: a new object after every change, for the lists built from `keysFor`. */
export function useKeymap(preferences: Preferences): KeymapOverrides {
  const store = keymapStore(preferences);
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}

/**
 * `keysFor` for a component's render: a lookup that changes identity with the
 * overrides, so a key label computed from it is recomputed after a change in
 * Settings › Keyboard. Under the React Compiler (ADR-0102 §5) a plain `keysFor(id)`
 * in render is memoised on `id` alone and goes stale until the page reloads.
 */
export function useKeysFor(): (id: string) => readonly string[] {
  const overrides = useSyncExternalStore(subscribeKeymap, keymapOverrides, keymapOverrides);
  return useCallback((id: string) => keysFor(id, overrides), [overrides]);
}

/**
 * Keys a recording refuses: the ones dialogs and fields need, and the browser's own tab and
 * window keys, which a web page never receives.
 */
const RESERVED = new Set([
  'Escape',
  'Tab',
  'Shift+Tab',
  'Enter',
  'Mod+W',
  'Mod+T',
  'Mod+N',
  'Mod+Shift+T',
  'Mod+Shift+N',
  'Mod+Tab',
]);

/** Whether `keys` (one combination or a chord "K H") can't be recorded. */
export function isReserved(keys: string): boolean {
  return keys.split(' ').some((part) => RESERVED.has(part));
}

/** A command as the conflict check sees it. */
export interface KeymapEntry {
  id: string;
  label: string;
  keys: readonly string[];
  modes: ReadonlySet<KeymapMode>;
}

export interface KeyConflict {
  id: string;
  label: string;
  /** The other command's key that clashes. */
  keys: string;
}

const first = (keys: string) => keys.split(' ')[0] as string;
const isChord = (keys: string) => keys.includes(' ');

/** Whether two keys can't both run: the same, or one is the other chord's first key. */
export function clash(a: string, b: string): boolean {
  if (a === b) return true;
  if (isChord(a) && !isChord(b)) return first(a) === b;
  if (isChord(b) && !isChord(a)) return first(b) === a;
  return false;
}

/**
 * What `keys` for command `id` clashes with: `blocking` in a mode both commands are offered
 * in (the key would run either), `shared` only across modes (allowed, shown as a note).
 */
export function conflictsFor(
  id: string,
  keys: string,
  entries: readonly KeymapEntry[],
): { blocking: KeyConflict[]; shared: KeyConflict[] } {
  const self = entries.find((e) => e.id === id);
  const blocking: KeyConflict[] = [];
  const shared: KeyConflict[] = [];
  for (const other of entries) {
    if (other.id === id) continue;
    const hit = other.keys.find((k) => clash(keys, k));
    if (!hit) continue;
    const together = !self || [...self.modes].some((m) => other.modes.has(m));
    (together ? blocking : shared).push({ id: other.id, label: other.label, keys: hit });
  }
  return { blocking, shared };
}
