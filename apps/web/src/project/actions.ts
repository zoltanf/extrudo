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

/**
 * Saves a new project (blank, or the given document, with a picture for its card
 * if there is one) and returns its ID.
 */
export async function createProject(
  platform: Platform,
  doc: ExtrudoDocument = createDocument({ appVersion: APP_VERSION }),
  thumbnail?: Blob,
): Promise<ProjectId> {
  await platform.projects.save(doc);
  if (thumbnail) await platform.projects.setThumbnail(doc.id, thumbnail).catch(() => {});
  // Ask for persistent storage once there is something worth keeping (FR-PRJ-05).
  void platform.storage.requestPersistence();
  return doc.id;
}

/** A new empty design for the tutorial (P3-12), named for what it builds. */
export function createTutorialProject(platform: Platform): Promise<ProjectId> {
  return createProject(platform, createDocument({ name: 'My first box', appVersion: APP_VERSION }));
}

/**
 * Messages for a project that is about to open (P3-13): what reading its
 * file needed to leave out. Opening a project navigates, so they wait here
 * until the project's page shows them (`takeOpenNotices`).
 */
const openNotices = new Map<string, string[]>();

export function noteOnOpen(id: ProjectId, message: string): void {
  openNotices.set(id, [...(openNotices.get(id) ?? []), message]);
}

/** The messages waiting for a project, once. */
export function takeOpenNotices(id: ProjectId): string[] {
  const notices = openNotices.get(id) ?? [];
  openNotices.delete(id);
  return notices;
}

/** Loads a project, keeping what reading it had to leave out for its page. */
export function loadProject(platform: Platform, id: ProjectId): Promise<ExtrudoDocument> {
  return platform.projects.load(id, { onNotice: (m) => noteOnOpen(id, m) });
}

/** Lets the user pick an `.extrudo` file and imports it; `undefined` if they cancel. */
export async function importProject(platform: Platform): Promise<ProjectSummary | undefined> {
  const file = await platform.files.pick(`${FILE_EXTENSION},application/zip`);
  if (!file) return undefined;
  const notices: string[] = [];
  const summary = await platform.projects.importFile(file, { onNotice: (m) => notices.push(m) });
  for (const notice of notices) noteOnOpen(summary.id, notice);
  return summary;
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
