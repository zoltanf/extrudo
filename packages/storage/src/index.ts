/**
 * @extrudo/storage: the ProjectStore interface, its OPFS + IndexedDB
 * implementation and the `.extrudo` zip format (P0-08, ADR-0009).
 */
export {
  type Archive,
  attachmentNotices,
  type Manifest,
  readArchive,
  writeArchive,
} from './archive';
export {
  type BrowserProjectStore,
  type BrowserProjectStoreOptions,
  createBrowserProjectStore,
} from './browser';
export { type FileStore, memoryFiles, opfsFiles } from './files';
export { FOLDER_HANDLE_KEY, type HandleStore, idbHandles, memoryHandles } from './handles';
export {
  idbFiles,
  idbIndex,
  memoryIndex,
  type OpenOptions,
  openDatabase,
  type ProjectIndex,
} from './idb';
export {
  createProjectStore,
  memoryProjectStore,
  type ProjectStoreOptions,
} from './project-store';
export { SHA256_PATTERN, sha256Hex } from './sha256';
export {
  ArchiveError,
  type ArchiveErrorCode,
  type LinkedFile,
  type LoadOptions,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS_BYTES,
  type ProjectId,
  ProjectNotFoundError,
  type ProjectStore,
  type ProjectSummary,
  type VersionSummary,
} from './types';
export type { StoredVersion } from './versions';
