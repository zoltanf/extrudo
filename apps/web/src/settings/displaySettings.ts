import { useSyncExternalStore } from 'react';
import type { Preferences } from '../platform';
import {
  DEFAULT_SETTINGS,
  loadSettings,
  type ViewportSettings,
  type ViewportStore,
} from '../viewport/store';

/** The display settings as the Settings dialog sees them: read, change, follow. */
export interface DisplayAccess {
  get(): ViewportSettings;
  set(patch: Partial<ViewportSettings>): void;
  subscribe(listener: () => void): () => void;
}

/** Over a project's live viewport store: the store itself persists a change. */
export function storeAccess(store: ViewportStore): DisplayAccess {
  let cached: { state: object; settings: ViewportSettings } | undefined;
  return {
    get() {
      const state = store.getState();
      if (cached?.state !== state) {
        const picked = {} as Record<string, unknown>;
        for (const key of Object.keys(DEFAULT_SETTINGS)) {
          picked[key] = (state as unknown as Record<string, unknown>)[key];
        }
        cached = { state, settings: picked as unknown as ViewportSettings };
      }
      return cached.settings;
    },
    set: (patch) => store.setState(patch),
    subscribe: (listener) => store.subscribe(listener),
  };
}

const PREFERENCES_KEY = 'viewport';
const byPreferences = new WeakMap<Preferences, DisplayAccess>();

/** Straight over the preference, for the home screen, where no viewport exists. */
export function preferencesAccess(preferences: Preferences): DisplayAccess {
  const found = byPreferences.get(preferences);
  if (found) return found;
  let current = loadSettings(preferences);
  const listeners = new Set<() => void>();
  const access: DisplayAccess = {
    get: () => current,
    set(patch) {
      current = { ...current, ...patch };
      preferences.set(PREFERENCES_KEY, current);
      for (const listener of listeners) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
  byPreferences.set(preferences, access);
  return access;
}

export function useDisplaySettings(access: DisplayAccess): ViewportSettings {
  return useSyncExternalStore(access.subscribe, access.get, access.get);
}
