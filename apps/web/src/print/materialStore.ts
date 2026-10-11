import { useSyncExternalStore } from 'react';
import type { Preferences } from '../platform';
import { type MaterialChoice, resolveMaterialChoice } from './material';

/** The preference the Print Info panel and the Settings dialog share (ADR-0048, ADR-0082). */
export const MATERIAL_PREFERENCE = 'print.material';

export interface MaterialStore {
  get(): MaterialChoice;
  /** Merges a change and writes the preference. */
  set(change: Partial<MaterialChoice>): void;
  /** Replaces the whole choice (a reset). */
  replace(next: MaterialChoice): void;
  subscribe(listener: () => void): () => void;
}

/**
 * One store per `Preferences`, so every view of the print settings (the Print Info panel, the
 * Settings dialog) reads and writes the same value and sees a change at once.
 */
const stores = new WeakMap<Preferences, MaterialStore>();

export function materialStore(preferences: Preferences): MaterialStore {
  const found = stores.get(preferences);
  if (found) return found;
  let current = resolveMaterialChoice(
    preferences.get<Partial<MaterialChoice>>(MATERIAL_PREFERENCE, {}),
  );
  const listeners = new Set<() => void>();
  const write = (next: MaterialChoice) => {
    current = next;
    preferences.set(MATERIAL_PREFERENCE, next);
    for (const listener of listeners) listener();
  };
  const store: MaterialStore = {
    get: () => current,
    set: (change) => write(resolveMaterialChoice({ ...current, ...change })),
    replace: (next) => write(resolveMaterialChoice(next)),
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
  stores.set(preferences, store);
  return store;
}

/** The print settings, live. */
export function useMaterialChoice(preferences: Preferences): MaterialChoice {
  const store = materialStore(preferences);
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}
