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
 * A saved version of a project (FR-PRJ-03, P2-14): a copy of the document
 * as it was, with a description, kept until the project is deleted.
 */
export interface VersionSummary {
  /** 1, 2, 3… in the order the versions were saved ("V3"). */
  number: number;
  /** What the person saving it wrote; may be empty. */
  description: string;
  /** ISO time it was saved. */
  created: string;
  /** The project's name then. */
  name: string;
}

/**
 * Where projects live (docs/02-architecture.md §6.1, FR-PRJ-02). The web app
 * uses OPFS + IndexedDB; the desktop app (Phase 6) will implement the same
 * interface over the file system. Version history (P2-14, ADR-0036):
 * `saveVersion`, `versions`, `loadVersion`.
 */
export interface ProjectStore {
  /** Every project, trashed ones included, most recently modified first. */
  list(): Promise<ProjectSummary[]>;
  get(id: ProjectId): Promise<ProjectSummary | undefined>;
  /**
   * The saved document, migrated and validated. Throws `ProjectNotFoundError`.
   * A document a newer Extrudo saved is read as far as this one understands
   * it, and `onNotice` gets what to tell the user (core's `loadNotice`).
   */
  load(id: ProjectId, options?: LoadOptions): Promise<ExtrudoDocument>;
  /** Creates or overwrites a project. Sets `meta.modified` on the stored copy. */
  save(doc: ExtrudoDocument): Promise<ProjectSummary>;
  /**
   * Saves `doc` like `save`, and keeps a copy of it as the project's next
   * version with `description`. Throws `ProjectNotFoundError` for a project
   * that was never saved.
   */
  saveVersion(doc: ExtrudoDocument, description: string): Promise<VersionSummary>;
  /** The project's versions, newest first; none for a project without any. */
  versions(id: ProjectId): Promise<VersionSummary[]>;
  /**
   * A version's document, migrated and validated, with the project's ID.
   * Throws `ProjectNotFoundError`, or `ArchiveError` if it is missing or damaged.
   */
  loadVersion(id: ProjectId, number: number): Promise<ExtrudoDocument>;
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
  /** The whole project as an `.extrudo` file (FR-PRJ-04), its versions included. */
  exportFile(id: ProjectId): Promise<Blob>;
  /**
   * Adds a project from an `.extrudo` file. If a project with the same ID
   * exists, the import becomes a copy with a new ID. Throws `ArchiveError`
   * or core's `DocumentLoadError` for files it can't read; `onNotice` as for `load`.
   */
  importFile(file: Blob, options?: LoadOptions): Promise<ProjectSummary>;
}

export interface LoadOptions {
  /** Called with a message for the user when the file needed leniency (P3-13). */
  onNotice?: (message: string) => void;
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
