/**
 * Platform interfaces (architecture §8, NFR-08). Everything the browser and
 * Electron do differently goes through here: preferences, project storage,
 * persistent-storage permission, files the user downloads or picks, and
 * rescue copies of unsaved documents. Opening the export in a slicer is
 * optional and desktop-only (`openInSlicer`, ADR-0062); native dialogs come
 * later.
 */
import { createBrowserProjectStore, type ProjectStore } from '@extrudo/storage';
import { APP_VERSION } from '../version';
import { type FileAccess, webFiles } from './files';
import { type Preferences, webPreferences } from './preferences';
import { type RescueStore, recoverRescued, webRescue } from './rescue';
import type { OpenInSlicer } from './slicer';
import { type StorageAccess, webStorage } from './storage';

export interface Platform {
  preferences: Preferences;
  projects: ProjectStore;
  storage: StorageAccess;
  files: FileAccess;
  rescue: RescueStore;
  /**
   * Opens an exported file in a slicer (ADR-0062). The web platform leaves it
   * undefined: a slicer can't fetch a `blob:` URL, and designs stay local. The
   * Electron build implements it (Phase 6); the Export dialog shows its
   * controls only when it exists.
   */
  openInSlicer?: OpenInSlicer;
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
export { offlineSupported, registerServiceWorker } from './serviceWorker';
export {
  type OpenInSlicer,
  SLICERS,
  type SlicerFile,
  type SlicerId,
} from './slicer';
export { type Persistence, type StorageAccess, webStorage } from './storage';
