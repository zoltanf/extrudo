/** Project actions shared by the home screen and the File menu. */
import {
  createDocument,
  DocumentLoadError,
  type ExtrudoDocument,
  FILE_EXTENSION,
} from '@extrudo/core';
import {
  ArchiveError,
  type ProjectId,
  ProjectNotFoundError,
  type ProjectSummary,
} from '@extrudo/storage';
import { type Platform, safeFileName } from '../platform';
import { APP_VERSION } from '../version';

/** Saves a new project (blank, or the given document) and returns its ID. */
export async function createProject(
  platform: Platform,
  doc: ExtrudoDocument = createDocument({ appVersion: APP_VERSION }),
): Promise<ProjectId> {
  await platform.projects.save(doc);
  // Ask for persistent storage once there is something worth keeping (FR-PRJ-05).
  void platform.storage.requestPersistence();
  return doc.id;
}

/** Lets the user pick an `.extrudo` file and imports it; `undefined` if they cancel. */
export async function importProject(platform: Platform): Promise<ProjectSummary | undefined> {
  const file = await platform.files.pick(`${FILE_EXTENSION},application/zip`);
  if (!file) return undefined;
  return platform.projects.importFile(file);
}

/** Downloads a project as `<name>.extrudo` and returns the file name. */
export async function exportProject(platform: Platform, id: ProjectId, name: string) {
  const file = await platform.projects.exportFile(id);
  const fileName = safeFileName(name, FILE_EXTENSION);
  platform.files.download(file, fileName);
  return fileName;
}

/** A plain-language message for a storage or file error (UI spec §8). */
export function describeError(error: unknown): string {
  if (error instanceof ArchiveError || error instanceof ProjectNotFoundError) return error.message;
  if (error instanceof DocumentLoadError) {
    if (error.code === 'too-new') {
      return 'This design was made with a newer Extrudo. Update the app to open it.';
    }
    return error.message;
  }
  if (error instanceof DOMException && error.name === 'QuotaExceededError') {
    return 'The browser is out of storage space for this site.';
  }
  return error instanceof Error ? error.message : String(error);
}
