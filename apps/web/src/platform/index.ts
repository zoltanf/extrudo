/**
 * Platform interfaces (architecture §8, NFR-08). Everything the browser and
 * Electron do differently goes through here: preferences, project storage,
 * persistent-storage permission, and files the user downloads or picks.
 * Dialogs and slicer launch come later.
 */
import { createBrowserProjectStore, type ProjectStore } from '@extrudo/storage';
import { APP_VERSION } from '../version';
import { type FileAccess, webFiles } from './files';
import { type Preferences, webPreferences } from './preferences';
import { type StorageAccess, webStorage } from './storage';

export interface Platform {
  preferences: Preferences;
  projects: ProjectStore;
  storage: StorageAccess;
  files: FileAccess;
}

/** The web platform. Async because opening IndexedDB is. */
export async function webPlatform(): Promise<Platform> {
  return {
    preferences: webPreferences(),
    projects: await createBrowserProjectStore({ appVersion: APP_VERSION }),
    storage: webStorage(),
    files: webFiles(),
  };
}

export { type FileAccess, safeFileName, webFiles } from './files';
export { memoryPreferences, type Preferences, webPreferences } from './preferences';
export { type Persistence, type StorageAccess, webStorage } from './storage';
