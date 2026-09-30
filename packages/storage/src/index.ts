/**
 * @extrudo/storage: the ProjectStore interface, its OPFS + IndexedDB
 * implementation and the `.extrudo` zip format (P0-08, ADR-0009).
 */
export { type Archive, type Manifest, readArchive, writeArchive } from './archive';
export { type BrowserProjectStore, createBrowserProjectStore } from './browser';
export { type FileStore, memoryFiles, opfsFiles } from './files';
export { idbFiles, idbIndex, memoryIndex, openDatabase, type ProjectIndex } from './idb';
export {
  createProjectStore,
  memoryProjectStore,
  type ProjectStoreOptions,
} from './project-store';
export {
  ArchiveError,
  type ArchiveErrorCode,
  type LoadOptions,
  type ProjectId,
  ProjectNotFoundError,
  type ProjectStore,
  type ProjectSummary,
  type VersionSummary,
} from './types';
export type { StoredVersion } from './versions';
