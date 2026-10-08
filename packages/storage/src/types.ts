import type { DocumentId, ExtrudoDocument } from '@extrudo/core';

/** A project is identified by its document's ID. */
export type ProjectId = DocumentId;

/**
 * How much of a design's attachments storage takes (ADR-0061 §2; P4-06,
 * ADR-0066 §0): one file at most 25 MB, all of them together 100 MB. Both are
 * refused with a message for the user, checked in `writeAttachment`, so every
 * way in is covered (adding a font, importing a STEP file or a mesh,
 * duplicating a project). The limits are for the files imports bring: a
 * binary STL of 200,000 triangles is 10 MB on its own.
 */
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
export const MAX_ATTACHMENTS_BYTES = 100 * 1024 * 1024;

/**
 * A file in the linked folder that a project is written back to (FR-PRJ-06,
 * P4-09, ADR-0065 §3). The link is in the index rather than the document: it
 * is about this browser and this folder, not about the design, and it travels
 * nowhere in an `.extrudo` file.
 */
export interface LinkedFile {
  /**
   * The file's name in the linked folder (`<project name>.extrudo`), or — when
   * `external` is `true` — the absolute path of a file the desktop app was
   * handed (Open…, an association or Save As…; P6-01 slice 2).
   */
  file: string;
  /** When we last wrote (or read) it, ms since the epoch; the conflict check (ADR-0065 §3). */
  modified: number;
  /**
   * The link is to a real path main issued this session, not a file in the
   * linked folder (P6-01 slice 2). Only the desktop app writes these, through
   * the paths main handed out; the browser never sees one.
   */
  external?: true;
}

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
  /** The file it is linked to in the linked folder, when it is (P4-09). */
  linked?: LinkedFile;
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
 * `saveVersion`, `versions`, `loadVersion`; `deleteVersions` (P3-13).
 * Attachments (P4-03b, ADR-0061): `writeAttachment`, `readAttachment`,
 * `collectAttachments`.
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
   * Stores a file's bytes under its SHA-256 (`projects/<id>/attachments/<sha>`),
   * which is what they must hash to (ADR-0061 §2). Call it before saving the
   * document that names the file: a design must never name bytes that aren't
   * there. Refuses a file over `MAX_ATTACHMENT_BYTES`, a design over
   * `MAX_ATTACHMENTS_BYTES` in total, and bytes that don't match the hash.
   */
  writeAttachment(id: ProjectId, sha256: string, bytes: Uint8Array): Promise<void>;
  /**
   * A file's bytes, or `undefined` when the project has none under that hash
   * (a name that isn't a hash never has).
   */
  readAttachment(id: ProjectId, sha256: string): Promise<Uint8Array | undefined>;
  /**
   * Deletes the files of attachments that neither the document nor any saved
   * version names: what an undone add left behind. Storage runs this when a
   * version is saved or deleted, not on autosave (ADR-0061 §2).
   */
  collectAttachments(id: ProjectId): Promise<void>;
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
  /**
   * Deletes versions for good (P3-13): the index first, then their files.
   * Numbers that aren't there are ignored; later versions keep their numbers
   * and new ones never reuse a deleted number. Throws `ProjectNotFoundError`.
   */
  deleteVersions(id: ProjectId, numbers: readonly number[]): Promise<void>;
  /**
   * Links the project to a file in the linked folder, or clears the link with
   * `undefined` (P4-09, ADR-0065 §3). `modified` is what we last wrote or read,
   * which is what the next write compares the file's own time against.
   */
  link(id: ProjectId, file: LinkedFile | undefined): Promise<ProjectSummary>;
  /**
   * The whole project as `.extrudo` bytes, versions and attachments included:
   * what `exportFile` downloads and what a linked file is written with.
   */
  archiveBytes(id: ProjectId): Promise<Uint8Array>;
  rename(id: ProjectId, name: string): Promise<ProjectSummary>;
  /** A copy with a new ID, named "<name> copy". */
  duplicate(id: ProjectId): Promise<ProjectSummary>;
  /** Moves a project to the in-app trash; `restore` brings it back. */
  trash(id: ProjectId): Promise<void>;
  restore(id: ProjectId): Promise<void>;
  /** Deletes a project for good. */
  purge(id: ProjectId): Promise<void>;
  /**
   * The model cache (ADR-0078): the live body IDs of the last finished
   * recompute, derived data that lives beside the document (never in it, in
   * the `.extrudo` file or in a version). `undefined` when the file is
   * missing, unreadable or of another version: never throws for a bad cache.
   */
  readModelCache(id: ProjectId): Promise<ModelCache | undefined>;
  writeModelCache(id: ProjectId, cache: ModelCache): Promise<void>;
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

/** `projects/<id>/model-cache.json` (ADR-0078). */
export interface ModelCache {
  version: 1;
  /** The live body IDs of the last finished recompute, in browser order. */
  bodies: string[];
}

export interface LoadOptions {
  /** Called with a message for the user when the file needed leniency (P3-13). */
  onNotice?: (message: string) => void;
}

export class ProjectNotFoundError extends Error {
  override readonly name = 'ProjectNotFoundError';
  // A field and not a constructor parameter, so the package's TypeScript can
  // be run by Node as it is (P5-03's CLI reads archives with it).
  readonly id: string;
  constructor(id: string) {
    super("This project doesn't exist. It may have been deleted.");
    this.id = id;
  }
}

/**
 * A document or version id the store refuses before it builds a path from it
 * (P6-01, ADR-0075's review): an id becomes `projects/<id>/…` on the real file
 * system, so a `..` or a separator in it would climb out of the store's
 * directory. Raised at the store boundary (every backend), so the renderer
 * cannot turn a `.extrudo`'s document id into an arbitrary read, write or
 * delete.
 */
export class StorageError extends Error {
  override readonly name = 'StorageError';
  /** The id that was refused, as it arrived. */
  readonly id: string;
  constructor(id: string, message?: string) {
    super(message ?? `${id || 'An empty string'} isn't a valid project ID.`);
    this.id = id;
  }
}

export type ArchiveErrorCode = 'not-a-zip' | 'not-extrudo' | 'damaged';

/** A file that isn't a readable `.extrudo` archive. The message is for people. */
export class ArchiveError extends Error {
  override readonly name = 'ArchiveError';
  // A field and not a constructor parameter, so Node can run this package's
  // TypeScript as it is (P5-03's CLI reads archives with it).
  readonly code: ArchiveErrorCode;
  constructor(code: ArchiveErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}
