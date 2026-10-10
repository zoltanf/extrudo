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
import { type OpenedFile, type Platform, safeFileName } from '../platform';
import { navigate, projectHref } from '../routes';
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

/**
 * Lets the user pick an `.extrudo` file and imports it; `undefined` if they
 * cancel. A Fusion `.f3d` picked here is imported as one too.
 */
export async function importProject(
  platform: Platform,
): Promise<Pick<ProjectSummary, 'id'> | undefined> {
  const file = await platform.files.pick(`${FILE_EXTENSION},application/zip,${F3D_ACCEPT}`);
  if (!file) return undefined;
  if (/\.f3d$/i.test(file.name)) {
    const id = await importFusionFile(platform, file);
    return id ? { id } : undefined;
  }
  const notices: string[] = [];
  const summary = await platform.projects.importFile(file, { onNotice: (m) => notices.push(m) });
  for (const notice of notices) noteOnOpen(summary.id, notice);
  return summary;
}

/** What a Fusion `.f3d` file is picked as. */
export const F3D_ACCEPT = '.f3d';

/**
 * Lets the user pick an Autodesk Fusion `.f3d` file and imports it as a new
 * design; `undefined` if they cancel. The importer loads only now (its own
 * chunk). What it could not bring over is left for the design's page.
 */
export async function importFusionFile(
  platform: Platform,
  picked?: File,
): Promise<ProjectId | undefined> {
  const file = picked ?? (await platform.files.pick(F3D_ACCEPT));
  if (!file) return undefined;
  const bytes = new Uint8Array(await file.arrayBuffer());
  const { f3dPreview, importF3d } = await import('@extrudo/f3d');
  const name = file.name.replace(/\.f3d$/i, '') || 'Imported design';
  const { design, report } = importF3d(bytes, name, {
    id: crypto.randomUUID(),
    appVersion: APP_VERSION,
  });
  const doc = design.toJSON();
  const preview = f3dPreview(bytes);
  const id = await createProject(
    platform,
    doc,
    preview ? new Blob([preview as Uint8Array<ArrayBuffer>], { type: 'image/png' }) : undefined,
  );
  for (const message of importNotices(report)) noteOnOpen(id, message);
  return id;
}

/** The import report as a few readable notices. */
function importNotices(report: {
  imported: string[];
  skipped: { name: string; kind: string; reason: string }[];
}): string[] {
  const skipped = report.skipped.filter((s) => s.reason !== 'suppressed in Fusion');
  const total = report.imported.length + skipped.length;
  const out = [`Imported from Fusion: ${report.imported.length} of ${total} timeline features.`];
  if (skipped.length > 0) {
    const shown = skipped.slice(0, 6).map((s) => `${s.name} (${s.reason})`);
    const more = skipped.length - shown.length;
    out.push(`Not imported: ${shown.join('; ')}${more > 0 ? `; and ${more} more` : ''}.`);
  }
  return out;
}

/** Downloads a project as `<name>.extrudo` and returns the file name. */
export async function exportProject(platform: Platform, id: ProjectId, name: string) {
  const file = await platform.projects.exportFile(id);
  const fileName = safeFileName(name, FILE_EXTENSION);
  platform.files.download(file, fileName);
  return fileName;
}

/**
 * Opens a `.extrudo` file the desktop app was handed (Open…, an association,
 * argv or the Open Recent list; P6-01 slice 2). Main already read the bytes;
 * the project is imported and linked to that file, as a linked-folder file is
 * (ADR-0065 §3), then opened. Leaves the notices for the project's page, the
 * way `importProject` does.
 */
export async function openExternalFile(
  platform: Platform,
  file: OpenedFile,
): Promise<ProjectSummary> {
  // A file already linked to a project opens that project rather than importing
  // a second copy (P6-01 slice 2, finding 3): the desktop links an opened path
  // `external`, so a second open (a re-launch, a double-click) navigates to it.
  const existing = (await platform.projects.list()).find(
    (summary) => !summary.trashed && summary.linked?.external && summary.linked.file === file.path,
  );
  if (existing) {
    navigate(projectHref(existing.id));
    return existing;
  }
  const notices: string[] = [];
  const summary = await platform.projects.importFile(
    new Blob([file.bytes as Uint8Array<ArrayBuffer>]),
    {
      onNotice: (message) => notices.push(message),
    },
  );
  await platform.projects.link(summary.id, {
    file: file.path,
    modified: file.modified,
    external: true,
  });
  for (const notice of notices) noteOnOpen(summary.id, notice);
  navigate(projectHref(summary.id));
  return summary;
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
