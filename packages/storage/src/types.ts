import type { DocumentId, ExtrudoDocument } from '@extrudo/core';

/** A project is identified by its document's ID. */
export type ProjectId = DocumentId;

/** What the home screen shows about a project, without loading it. */
export interface ProjectSummary {
  id: ProjectId;
  name: string;
  /** ISO timestamps. */
  created: string;
  modified: string;
  /** When the project was moved to the trash; absent if it isn't there. */
  trashed?: string;
  hasThumbnail: boolean;
}

/**
 * Where projects live (docs/02-architecture.md §6.1, FR-PRJ-02). The web app
 * uses OPFS + IndexedDB; the desktop app (Phase 6) will implement the same
 * interface over the file system. Version history (`save` as a version,
 * `versions`, `loadVersion`) arrives with P2-14.
 */
export interface ProjectStore {
  /** Every project, trashed ones included, most recently modified first. */
  list(): Promise<ProjectSummary[]>;
  get(id: ProjectId): Promise<ProjectSummary | undefined>;
  /** The saved document, migrated and validated. Throws `ProjectNotFoundError`. */
  load(id: ProjectId): Promise<ExtrudoDocument>;
  /** Creates or overwrites a project. Sets `meta.modified` on the stored copy. */
  save(doc: ExtrudoDocument): Promise<ProjectSummary>;
  rename(id: ProjectId, name: string): Promise<ProjectSummary>;
  /** A copy with a new ID, named "<name> copy". */
  duplicate(id: ProjectId): Promise<ProjectSummary>;
  /** Moves a project to the in-app trash; `restore` brings it back. */
  trash(id: ProjectId): Promise<void>;
  restore(id: ProjectId): Promise<void>;
  /** Deletes a project for good. */
  purge(id: ProjectId): Promise<void>;
  thumbnail(id: ProjectId): Promise<Blob | null>;
  setThumbnail(id: ProjectId, png: Blob): Promise<void>;
  /** The whole project as an `.extrudo` file (FR-PRJ-04). */
  exportFile(id: ProjectId): Promise<Blob>;
  /**
   * Adds a project from an `.extrudo` file. If a project with the same ID
   * exists, the import becomes a copy with a new ID. Throws `ArchiveError`
   * or core's `DocumentLoadError` for files it can't read.
   */
  importFile(file: Blob): Promise<ProjectSummary>;
}

export class ProjectNotFoundError extends Error {
  override readonly name = 'ProjectNotFoundError';
  constructor(readonly id: string) {
    super("This project doesn't exist. It may have been deleted.");
  }
}

export type ArchiveErrorCode = 'not-a-zip' | 'not-extrudo' | 'damaged';

/** A file that isn't a readable `.extrudo` archive. The message is for people. */
export class ArchiveError extends Error {
  override readonly name = 'ArchiveError';
  constructor(
    readonly code: ArchiveErrorCode,
    message: string,
  ) {
    super(message);
  }
}
