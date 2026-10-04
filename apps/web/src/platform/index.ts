/**
 * Platform interfaces (architecture §8, NFR-08). Everything the browser and
 * Electron do differently goes through here: preferences, project storage,
 * persistent-storage permission, files the user downloads or picks, a folder
 * on disk linked to the app where the browser has the API for it
 * (`folders`, FR-PRJ-06), and rescue copies of unsaved documents. Opening the
 * export in a slicer is optional and desktop-only (`openInSlicer`, ADR-0062);
 * native dialogs come later.
 */
import { createBrowserProjectStore, type ProjectStore } from '@extrudo/storage';
import { appNotifications } from '../design-system/notifications';
import { saveEverything } from '../project/autosave';
import { APP_VERSION } from '../version';
import {
  closedStorage,
  STORAGE_CLOSED_TEXT,
  showBlocked,
  showUpdatedElsewhere,
} from './databaseNotice';
import { type FileAccess, webFiles } from './files';
import { folderAccess, type LinkedFolders, webFolders } from './folders';
import { type Preferences, webPreferences } from './preferences';
import { type RescueStore, recoverRescued, webRescue } from './rescue';
import type { OpenInSlicer } from './slicer';
import { type StorageAccess, webStorage } from './storage';
import { UPDATE_UNSAVED_TEXT } from './updateNotice';

export interface Platform {
  preferences: Preferences;
  projects: ProjectStore;
  storage: StorageAccess;
  files: FileAccess;
  rescue: RescueStore;
  /**
   * A folder on disk the app reads and writes `.extrudo` files in (P4-09,
   * ADR-0065 §3). Absent where the browser has no File System Access API
   * (Firefox, Safari): the home screen then shows no linked folder, and the
   * "Save to Linked Folder" command is not offered. The Electron build
   * implements it over the real file system (Phase 6).
   */
  folders?: LinkedFolders;
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
 *
 * Another tab of this origin can hold the database up: an upgrade waits for the
 * tabs on the old version to close, and the tabs on the old version hear about
 * it and close so the upgrade can go on (P4-09's follow-up). Both are told,
 * through the page's toasts — an upgrade waiting in silence looks like a hang,
 * and a closed connection used silently looks like lost work.
 */
export async function webPlatform(): Promise<Platform> {
  const { push, dismiss } = appNotifications.getState();
  let waiting: number | undefined;
  const opened = await createBrowserProjectStore({
    appVersion: APP_VERSION,
    onBlocked: () => {
      waiting = showBlocked(push);
    },
    onVersionChange: () =>
      showUpdatedElsewhere({
        push,
        saveEverything,
        reload: () => globalThis.location.reload(),
        unsaved: () => push('error', UPDATE_UNSAVED_TEXT),
      }),
  });
  // The open went through (the other tab let go, or there was nothing to wait
  // for): the notice has done its job.
  if (waiting !== undefined) dismiss(waiting);
  const projects = closedStorage(opened, STORAGE_CLOSED_TEXT);
  const rescue = webRescue();
  await recoverRescued(opened, rescue);
  // Only where the browser can: the folder's handle lives in the project's own
  // IndexedDB database, through the store that opened it.
  const folders = folderAccess() ? webFolders(opened.handles) : undefined;
  return {
    preferences: webPreferences(),
    projects,
    storage: webStorage(),
    files: webFiles(),
    rescue,
    ...(folders && { folders }),
  };
}

export {
  BLOCKED_TEXT,
  closedStorage,
  DATABASE_TOAST_MS,
  STORAGE_CLOSED_TEXT,
  showBlocked,
  showUpdatedElsewhere,
  UPDATED_ELSEWHERE_TEXT,
} from './databaseNotice';
export { type FileAccess, safeFileName, webFiles } from './files';
export {
  type FolderFile,
  type FolderLink,
  type FolderPermission,
  folderAccess,
  LinkedFileError,
  type LinkedFolders,
  webFolders,
} from './folders';
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
