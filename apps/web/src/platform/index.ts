/**
 * Platform interfaces (architecture §8, NFR-08). Everything the browser and
 * Electron do differently goes through here: preferences, project storage,
 * persistent-storage permission, files the user downloads or picks, and
 * rescue copies of unsaved documents. Dialogs and slicer launch come later.
 */
import { createBrowserProjectStore, type ProjectStore } from '@extrudo/storage';
import { APP_VERSION } from '../version';
import { type FileAccess, webFiles } from './files';
import { type Preferences, webPreferences } from './preferences';
import { type RescueStore, recoverRescued, webRescue } from './rescue';
import { type StorageAccess, webStorage } from './storage';

export interface Platform {
  preferences: Preferences;
  projects: ProjectStore;
  storage: StorageAccess;
  files: FileAccess;
  rescue: RescueStore;
}

/**
 * The web platform. Async because opening IndexedDB is, and because edits a
 * closed page couldn't save are recovered before anything opens.
 */
export async function webPlatform(): Promise<Platform> {
  const projects = await createBrowserProjectStore({ appVersion: APP_VERSION });
  const rescue = webRescue();
  await recoverRescued(projects, rescue);
  return {
    preferences: webPreferences(),
    projects,
    storage: webStorage(),
    files: webFiles(),
    rescue,
  };
}

export { type FileAccess, safeFileName, webFiles } from './files';
export { memoryPreferences, type Preferences, webPreferences } from './preferences';
export { memoryRescue, type RescueStore, recoverRescued, webRescue } from './rescue';
export { type Persistence, type StorageAccess, webStorage } from './storage';
