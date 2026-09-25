/**
 * Small per-user UI preferences (theme, panel sizes). A platform interface
 * (architecture §8): the web build keeps them in localStorage, the desktop
 * build (Phase 6) will use a settings file. Feature code never touches
 * localStorage directly.
 */
export interface Preferences {
  /** The stored value, or `fallback` if none is stored or it can't be read. */
  get<T>(key: string, fallback: T): T;
  set(key: string, value: unknown): void;
}

const PREFIX = 'extrudo.';

/** Web preferences in localStorage. Storage errors (private mode, quota) are ignored. */
export function webPreferences(
  storage: Storage | undefined = globalThis.localStorage,
): Preferences {
  return {
    get<T>(key: string, fallback: T): T {
      try {
        const raw = storage?.getItem(PREFIX + key);
        return raw === null || raw === undefined ? fallback : (JSON.parse(raw) as T);
      } catch {
        return fallback;
      }
    },
    set(key, value) {
      try {
        storage?.setItem(PREFIX + key, JSON.stringify(value));
      } catch {
        // Preferences are a convenience; losing one is fine.
      }
    },
  };
}

/** In-memory preferences, for tests. */
export function memoryPreferences(initial: Record<string, unknown> = {}): Preferences {
  const values = new Map(Object.entries(initial));
  return {
    get: <T>(key: string, fallback: T) => (values.has(key) ? (values.get(key) as T) : fallback),
    set: (key, value) => void values.set(key, value),
  };
}
