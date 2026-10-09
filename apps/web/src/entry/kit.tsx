/**
 * The shared entry kit (P6-01, ADR-0075 §1): what a renderer entry — the web
 * one and the Electron one — needs from inside the app, exported from one
 * place so `apps/desktop` can boot the very same UI without importing the
 * app's internals by path.
 */
export { App } from '../App';
export {
  applyInitialTheme,
  appNotifications,
  ToastsOnly,
  TooltipProvider,
} from '../design-system';
export type {
  DesktopApp,
  DesktopMenus,
  ExternalFiles,
  FileAccess,
  FolderFile,
  FolderLink,
  FolderPermission,
  LinkedFolders,
  OpenedFile,
  OpenInSlicer,
  Persistence,
  Platform,
  Preferences,
  RecentEntry,
  RecentListing,
  RescueStore,
  StorageAccess,
} from '../platform';
export {
  folderAccess,
  LinkedFileError,
  memoryPreferences,
  memoryRescue,
  offlineSupported,
  recoverRescued,
  safeFileName,
} from '../platform';
export { openExternalFile } from '../project/actions';
export { StartupError } from '../StartupError';
