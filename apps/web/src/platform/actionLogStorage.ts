/**
 * Where an edge or dev build keeps the recent-actions log (ADR-0127): one
 * localStorage key in the web build and in the desktop renderer alike (not
 * `Preferences`, whose desktop writes go to main's settings file). Storage
 * errors (private mode, quota) are ignored: the log is a diagnostic.
 */
import type { ActionEntry, ActionLogStorage } from '../shell/actionLog';

export const ACTION_LOG_KEY = 'extrudo.recentActions';

export function webActionLogStorage(
  storage: Storage | undefined = globalThis.localStorage,
): ActionLogStorage {
  return {
    read() {
      try {
        const raw = storage?.getItem(ACTION_LOG_KEY);
        return raw ? (JSON.parse(raw) as unknown) : undefined;
      } catch {
        return undefined;
      }
    },
    write(entries) {
      try {
        storage?.setItem(ACTION_LOG_KEY, JSON.stringify(entries));
      } catch {
        // Losing the log is fine; the page keeps working.
      }
    },
  };
}

/** In-memory storage, for tests: `value` is what was last written. */
export function memoryActionLogStorage(initial?: unknown): ActionLogStorage & {
  value: unknown;
  writes: number;
} {
  const store = {
    value: initial,
    writes: 0,
    read: () => store.value,
    write(entries: readonly ActionEntry[]) {
      store.writes++;
      store.value = JSON.parse(JSON.stringify(entries)) as unknown;
    },
  };
  return store;
}
