/**
 * Persistent storage (FR-PRJ-05). Without it, the browser may delete the
 * site's data (our projects) when the disk runs low. Chromium grants it
 * silently based on how the site is used; Firefox asks the user.
 */
export type Persistence = 'persistent' | 'best-effort' | 'unsupported';

export interface StorageAccess {
  /** Whether storage is persistent now, without asking. */
  persistence(): Promise<Persistence>;
  /** Asks the browser for persistent storage and returns the outcome. */
  requestPersistence(): Promise<Persistence>;
}

export function webStorage(
  storage: StorageManager | undefined = globalThis.navigator?.storage,
): StorageAccess {
  const supported = () => typeof storage?.persist === 'function';
  return {
    async persistence() {
      if (!supported() || !storage) return 'unsupported';
      return (await storage.persisted()) ? 'persistent' : 'best-effort';
    },
    async requestPersistence() {
      if (!supported() || !storage) return 'unsupported';
      try {
        return (await storage.persist()) ? 'persistent' : 'best-effort';
      } catch {
        return 'best-effort';
      }
    },
  };
}
