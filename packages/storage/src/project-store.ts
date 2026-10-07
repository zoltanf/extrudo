/**
 * The ProjectStore over an index and a file store (ADR-0009). Each project
 * is `projects/<id>/document.json` plus an optional `thumbnail.png`, its
 * versions (`versions.ts`, ADR-0036) and its attachments
 * (`attachments/<sha256>`, ADR-0061); the index holds the summaries the
 * home screen lists. A save writes the file first and the index second, so
 * the index never points at a document that wasn't written.
 */
import {
  attachmentHashes,
  newId as coreNewId,
  type DocumentId,
  type ExtrudoDocument,
  loadDocument,
  loadNotice,
} from '@extrudo/core';
import { gunzipSync, gzipSync } from 'fflate';
import { attachmentNotices, readArchive, writeArchive } from './archive';
import { type FileStore, memoryFiles } from './files';
import { memoryIndex, type ProjectIndex } from './idb';
import { SHA256_PATTERN, sha256Hex } from './sha256';
import {
  ArchiveError,
  type LinkedFile,
  type LoadOptions,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS_BYTES,
  type ProjectId,
  ProjectNotFoundError,
  type ProjectStore,
  type ProjectSummary,
  StorageError,
  type VersionSummary,
} from './types';
import {
  nextVersionNumber,
  readNextVersion,
  readVersionIndex,
  type StoredVersion,
  writeVersionIndex,
} from './versions';

export interface ProjectStoreOptions {
  index: ProjectIndex;
  files: FileStore;
  /** Written into `meta.appVersion` on save. Defaults to the document's own. */
  appVersion?: string;
  /** Clock, for tests. */
  now?: () => string;
  /** ID generator, for tests. */
  newId?: () => DocumentId;
  /**
   * Runs `task` holding the lock `name`, one holder at a time (P3-13). The
   * browser store passes the Web Locks API, which holds across tabs; the
   * default holds within this store only.
   */
  lock?: <T>(name: string, task: () => Promise<T>) => Promise<T>;
}

/** A lock per name within one page: tasks run one after another, failures don't block the next. */
export function localLock(): <T>(name: string, task: () => Promise<T>) => Promise<T> {
  const tails = new Map<string, Promise<unknown>>();
  return (name, task) => {
    const run = (tails.get(name) ?? Promise.resolve()).then(task, task);
    const tail = run.catch(() => undefined);
    tails.set(name, tail);
    void tail.then(() => {
      if (tails.get(name) === tail) tails.delete(name);
    });
    return run;
  };
}

const documentPath = (id: ProjectId) => {
  assertId(id);
  return `projects/${id}/document.json`;
};
const thumbnailPath = (id: ProjectId) => {
  assertId(id);
  return `projects/${id}/thumbnail.png`;
};
const attachmentFolder = (id: ProjectId) => {
  assertId(id);
  return `projects/${id}/attachments`;
};
const attachmentPath = (id: ProjectId, sha256: string) => `${attachmentFolder(id)}/${sha256}`;
const versionIndexPath = (id: ProjectId) => {
  assertId(id);
  return `projects/${id}/versions/index.json`;
};
const versionPath = (id: ProjectId, n: number) => {
  assertVersionNumber(n);
  assertId(id);
  return `projects/${id}/versions/${n}.json.gz`;
};
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const MB = 1024 * 1024;
const megabytes = (bytes: number) => `${Math.ceil((bytes / MB) * 10) / 10} MB`;

/**
 * The one shape a project id may have (P6-01, ADR-0075's review): `newId()`
 * makes a UUID, and the store's own tests use short ids like `p1`; both fit.
 * An id is put straight into `projects/<id>/…`, so anything with a `..`, a
 * path separator, a NUL or a leading `.` is refused here — every backend (the
 * Node store and the browser store alike) shares this, so a document id from a
 * hostile `.extrudo` can never reach the file system.
 */
const PROJECT_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/** Refuses an id that could climb out of the store's directory. */
export function assertId(id: ProjectId): void {
  if (!PROJECT_ID_PATTERN.test(id)) throw new StorageError(id);
}

/** Refuses a negative or fractional version number before it reaches a path. */
function assertVersionNumber(number: number): void {
  if (!Number.isInteger(number) || number < 0) {
    throw new Error(`"${number}" isn't a version number.`);
  }
}

const projectFolder = (id: ProjectId) => {
  assertId(id);
  return `projects/${id}`;
};

/** An index entry without its link (clearing one leaves every other key). */
const omitLink = ({ linked: _linked, ...summary }: ProjectSummary): ProjectSummary => summary;

export function createProjectStore(options: ProjectStoreOptions): ProjectStore {
  const { index, files } = options;
  const now = options.now ?? (() => new Date().toISOString());
  const makeId = options.newId ?? (() => coreNewId<DocumentId>());
  const lock = options.lock ?? localLock();
  /** The version index of a project is read and rewritten only under this lock. */
  const withVersions = <T>(id: ProjectId, task: () => Promise<T>) =>
    lock(`extrudo:versions:${id}`, task);

  const summaryOf = async (id: ProjectId) => {
    const summary = await index.get(id);
    if (!summary) throw new ProjectNotFoundError(id);
    return summary;
  };

  const load = async (id: ProjectId, options?: LoadOptions): Promise<ExtrudoDocument> => {
    await summaryOf(id);
    const bytes = await files.read(documentPath(id));
    if (!bytes) throw new ArchiveError('damaged', "This project's document is missing.");
    let raw: unknown;
    try {
      raw = JSON.parse(decoder.decode(bytes));
    } catch {
      throw new ArchiveError('damaged', "This project's document is damaged.");
    }
    const result = loadDocument(raw);
    const notice = loadNotice(result, 'drops');
    if (notice) options?.onNotice?.(notice);
    return result.doc;
  };

  const save = async (doc: ExtrudoDocument): Promise<ProjectSummary> => {
    const modified = now();
    const stored: ExtrudoDocument = {
      ...doc,
      meta: { ...doc.meta, modified, appVersion: options.appVersion ?? doc.meta.appVersion },
    };
    await files.write(documentPath(doc.id), encoder.encode(JSON.stringify(stored)));
    const previous = await index.get(doc.id);
    const summary: ProjectSummary = {
      id: doc.id,
      name: doc.name,
      created: doc.meta.created,
      modified,
      hasThumbnail: previous?.hasThumbnail ?? false,
      ...(previous?.trashed ? { trashed: previous.trashed } : {}),
      // A save is not an unlink: the file in the linked folder stays the one
      // this project is written back to (P4-09, ADR-0065 §3).
      ...(previous?.linked ? { linked: previous.linked } : {}),
    };
    await index.put(summary);
    return summary;
  };

  const readThumbnail = (id: ProjectId) => files.read(thumbnailPath(id));

  /** The version index, oldest first, and the next number (none if there is no index yet). */
  const readIndex = async (
    id: ProjectId,
  ): Promise<{ versions: VersionSummary[]; next: number }> => {
    const bytes = await files.read(versionIndexPath(id));
    if (!bytes) return { versions: [], next: 1 };
    let raw: unknown;
    try {
      raw = JSON.parse(decoder.decode(bytes));
    } catch {
      raw = undefined;
    }
    const versions = readVersionIndex(raw);
    if (!versions) throw new ArchiveError('damaged', "This project's version list is damaged.");
    return { versions, next: nextVersionNumber(versions, readNextVersion(raw)) };
  };
  const readVersions = async (id: ProjectId) => (await readIndex(id)).versions;
  const writeIndex = (id: ProjectId, versions: readonly VersionSummary[], next: number) =>
    files.write(
      versionIndexPath(id),
      encoder.encode(JSON.stringify(writeVersionIndex(versions, next))),
    );

  /** Writes versions (their files, then the index) into a project that has none. */
  const writeVersions = (id: ProjectId, versions: readonly StoredVersion[]) =>
    withVersions(id, async () => {
      if (versions.length === 0) return;
      for (const { summary, doc } of versions) {
        await files.write(
          versionPath(id, summary.number),
          gzipSync(encoder.encode(JSON.stringify({ ...doc, id }))),
        );
      }
      await writeIndex(
        id,
        versions.map((v) => v.summary),
        nextVersionNumber(versions.map((v) => v.summary)),
      );
    });

  const loadVersion = async (id: ProjectId, number: number): Promise<ExtrudoDocument> => {
    await summaryOf(id);
    const bytes = await files.read(versionPath(id, number));
    if (!bytes) throw new ArchiveError('damaged', `Version ${number} of this project is missing.`);
    let raw: unknown;
    try {
      raw = JSON.parse(decoder.decode(gunzipSync(bytes)));
    } catch {
      throw new ArchiveError('damaged', `Version ${number} of this project is damaged.`);
    }
    return { ...loadDocument(raw).doc, id };
  };

  /** Every version with its document, oldest first (for export). */
  const allVersions = async (id: ProjectId): Promise<StoredVersion[]> => {
    const out: StoredVersion[] = [];
    for (const summary of await readVersions(id)) {
      out.push({ summary, doc: await loadVersion(id, summary.number) });
    }
    return out;
  };

  const writeThumbnail = async (id: ProjectId, png: Uint8Array) => {
    const summary = await summaryOf(id);
    await files.write(thumbnailPath(id), png);
    await index.put({ ...summary, hasThumbnail: true });
  };

  /**
   * Stores a file's bytes under its SHA-256 (ADR-0061 §2), which must be what
   * they hash to: one file is kept once however many attachments or versions
   * name it. Refuses a file over `MAX_ATTACHMENT_BYTES` and a design that
   * would go over `MAX_ATTACHMENTS_BYTES` in total.
   *
   * The total is the sum of the sizes the *stored* document records, since the
   * document naming this file is only saved after it (the app adds a font
   * and autosaves a moment later), which is exact as soon as the document is
   * saved and an attachment's own size is never counted twice. The bytes go
   * before the document on purpose: a design must never name a file that isn't
   * there. Garbage collection (ADR-0061 §2) takes the ones nothing names any
   * more, such as the bytes of an undone add.
   */
  const writeAttachment = async (id: ProjectId, sha256: string, bytes: Uint8Array) => {
    if (!SHA256_PATTERN.test(sha256)) {
      throw new Error(
        `"${sha256}" isn't a SHA-256 hash, so no file can be stored under that name.`,
      );
    }
    if (bytes.length > MAX_ATTACHMENT_BYTES) {
      throw new Error(
        `This file is ${megabytes(bytes.length)}; one file may be at most ${megabytes(MAX_ATTACHMENT_BYTES)}.`,
      );
    }
    const digest = sha256Hex(bytes);
    if (digest !== sha256) {
      throw new Error(`These bytes are not the file ${sha256}: they hash to ${digest}.`);
    }
    const sizes = await storedAttachmentSizes(id);
    const total =
      bytes.length +
      [...sizes].reduce((sum, [hash, size]) => (hash === sha256 ? sum : sum + size), 0);
    if (total > MAX_ATTACHMENTS_BYTES) {
      throw new Error(
        `This design's files would be ${megabytes(total)} altogether; they may be at most ${megabytes(MAX_ATTACHMENTS_BYTES)}.`,
      );
    }
    await files.write(attachmentPath(id, sha256), bytes);
  };

  const readAttachment = (id: ProjectId, sha256: string) =>
    SHA256_PATTERN.test(sha256)
      ? files.read(attachmentPath(id, sha256))
      : Promise.resolve(undefined);

  /** The attachment sizes the stored document records, by hash. */
  const storedAttachmentSizes = async (id: ProjectId): Promise<Map<string, number>> => {
    const bytes = await files.read(documentPath(id));
    if (!bytes) return new Map();
    try {
      const raw = JSON.parse(decoder.decode(bytes)) as {
        attachments?: Record<string, { sha256?: unknown; size?: unknown }>;
      };
      const sizes = new Map<string, number>();
      for (const record of Object.values(raw.attachments ?? {})) {
        if (typeof record?.sha256 === 'string' && typeof record.size === 'number') {
          sizes.set(record.sha256, record.size);
        }
      }
      return sizes;
    } catch {
      // A document that can't be read tells us nothing about the limit; the
      // file's own size limit still applies.
      return new Map();
    }
  };

  /**
   * Deletes the files of attachments that neither the document nor any saved
   * version names (ADR-0061 §2): the bytes of an undone add, or of a font a
   * version that has been deleted used. Storage runs it where a file stops
   * being needed by name (saving or deleting a version), never on autosave:
   * an autosave runs every few seconds while someone types, and this reads
   * and validates every version document. A project whose document can't be
   * read keeps all its files rather than guessing what is in use.
   */
  const collectAttachments = (id: ProjectId) =>
    withVersions(id, async () => {
      const bytes = await files.read(documentPath(id));
      if (!bytes) return;
      let keep: Set<string>;
      try {
        keep = attachmentHashes(loadDocument(JSON.parse(decoder.decode(bytes))).doc);
        for (const version of await allVersions(id)) {
          for (const hash of attachmentHashes(version.doc)) keep.add(hash);
        }
      } catch {
        return;
      }
      for (const path of await files.list(attachmentFolder(id))) {
        if (!keep.has(path.slice(path.lastIndexOf('/') + 1))) await files.remove(path);
      }
    });

  /** The bytes of every file the document or a version names, read once each. */
  const attachmentBytes = async (
    id: ProjectId,
    doc: ExtrudoDocument,
    versions: readonly StoredVersion[],
  ): Promise<Map<string, Uint8Array>> => {
    const out = new Map<string, Uint8Array>();
    const wanted = new Set<string>(attachmentHashes(doc));
    for (const version of versions)
      for (const hash of attachmentHashes(version.doc)) wanted.add(hash);
    for (const hash of wanted) {
      const bytes = await files.read(attachmentPath(id, hash));
      if (bytes) out.set(hash, bytes);
    }
    return out;
  };

  /**
   * Saves a document under a new ID: its attachment bytes first, then the
   * document that names them, then the thumbnail.
   */
  const saveCopy = async (
    doc: ExtrudoDocument,
    name: string,
    extra: { thumbnail?: Uint8Array; attachments?: ReadonlyMap<string, Uint8Array> } = {},
  ) => {
    const copy: ExtrudoDocument = {
      ...doc,
      id: makeId(),
      name,
      meta: { ...doc.meta, created: now() },
    };
    for (const [sha256, bytes] of extra.attachments ?? []) {
      await writeAttachment(copy.id, sha256, bytes);
    }
    const summary = await save(copy);
    if (extra.thumbnail) await writeThumbnail(copy.id, extra.thumbnail);
    return { ...summary, hasThumbnail: !!extra.thumbnail };
  };

  /**
   * The project as `.extrudo` bytes: the document as stored, its thumbnail, its
   * versions and the attachment bytes they name. One builder for the download
   * and for a linked folder's file (P4-09, ADR-0065 §3), so the two are the
   * same file by construction.
   */
  const archiveBytes = async (id: ProjectId): Promise<Uint8Array> => {
    const doc = await load(id);
    const versions = await allVersions(id);
    const attachments = await attachmentBytes(id, doc, versions);
    return writeArchive(doc, await readThumbnail(id), versions, attachments);
  };

  /** Records the linked file in the index entry, or takes the link off. */
  const link = async (id: ProjectId, file: LinkedFile | undefined): Promise<ProjectSummary> => {
    const summary = await summaryOf(id);
    const next = file ? { ...summary, linked: file } : omitLink(summary);
    await index.put(next);
    return next;
  };

  return {
    async list() {
      const all = await index.all();
      return all.sort((a, b) => b.modified.localeCompare(a.modified));
    },
    get: (id) => index.get(id),
    load,
    save,
    link,
    archiveBytes,
    writeAttachment,
    readAttachment,
    collectAttachments,
    saveVersion: async (doc, description) => {
      const version = await withVersions(doc.id, async () => {
        await summaryOf(doc.id);
        const { versions, next } = await readIndex(doc.id);
        const summary = await save(doc);
        const version: VersionSummary = {
          number: next,
          description: description.trim(),
          created: summary.modified,
          name: doc.name,
        };
        // The same document `save` stored, with its stamps.
        const stored = await load(doc.id);
        await files.write(
          versionPath(doc.id, version.number),
          gzipSync(encoder.encode(JSON.stringify(stored))),
        );
        await writeIndex(doc.id, [...versions, version], version.number + 1);
        return version;
      });
      // Outside the versions lock, which `collectAttachments` takes itself:
      // an explicit version save is where files nobody names any more go.
      await collectAttachments(doc.id);
      return version;
    },
    deleteVersions: async (id, numbers) => {
      await withVersions(id, async () => {
        await summaryOf(id);
        const { versions, next } = await readIndex(id);
        const gone = new Set(numbers);
        const kept = versions.filter((v) => !gone.has(v.number));
        if (kept.length === versions.length) return;
        // The index first: a crash then leaves an unlisted file, never a listed version without one.
        await writeIndex(id, kept, next);
        for (const v of versions)
          if (gone.has(v.number)) await files.remove(versionPath(id, v.number));
      });
      // Deleting a version can be what frees the files only it named.
      await collectAttachments(id);
    },
    async versions(id) {
      await summaryOf(id);
      return (await readVersions(id)).reverse();
    },
    loadVersion,
    async rename(id, name) {
      const trimmed = name.trim();
      if (!trimmed) throw new Error('A project needs a name.');
      return save({ ...(await load(id)), name: trimmed });
    },
    async duplicate(id) {
      const doc = await load(id);
      return saveCopy(doc, `${doc.name} copy`, {
        thumbnail: await readThumbnail(id),
        attachments: await attachmentBytes(id, doc, []),
      });
    },
    async trash(id) {
      await index.put({ ...(await summaryOf(id)), trashed: now() });
    },
    async restore(id) {
      const { trashed: _, ...summary } = await summaryOf(id);
      await index.put(summary);
    },
    async purge(id) {
      // An invalid id is refused first (a `..` is a StorageError), then an
      // unknown one (ProjectNotFoundError): either way nothing on disk is
      // touched (P6-01's review).
      assertId(id);
      await summaryOf(id);
      // Index first: a crash then leaves an orphan folder, never a listed project without files.
      // The whole folder goes, `attachments/` with it.
      await index.delete(id);
      await files.remove(projectFolder(id));
    },
    async thumbnail(id) {
      const bytes = await readThumbnail(id);
      return bytes ? new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'image/png' }) : null;
    },
    async setThumbnail(id, png) {
      await writeThumbnail(id, new Uint8Array(await png.arrayBuffer()));
    },
    async exportFile(id) {
      const bytes = await archiveBytes(id);
      return new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'application/zip' });
    },
    async importFile(file, options) {
      const archive = readArchive(new Uint8Array(await file.arrayBuffer()));
      const notice = loadNotice(archive, 'copy');
      if (notice) options?.onNotice?.(notice);
      for (const message of attachmentNotices(archive)) options?.onNotice?.(message);
      const { doc, thumbnail, versions, attachments } = archive;
      if (await index.get(doc.id)) {
        const copy = await saveCopy(doc, doc.name, { thumbnail, attachments });
        await writeVersions(copy.id, versions);
        return copy;
      }
      // The bytes before the document: a design must never name a file that
      // isn't stored, and the sizes the limit is checked against come with it.
      for (const [sha256, bytes] of attachments) await writeAttachment(doc.id, sha256, bytes);
      const summary = await save(doc);
      if (thumbnail) await writeThumbnail(doc.id, thumbnail);
      await writeVersions(doc.id, versions);
      return { ...summary, hasThumbnail: !!thumbnail };
    },
  };
}

/** A project store held in memory, for tests. */
export function memoryProjectStore(options: Partial<ProjectStoreOptions> = {}): ProjectStore {
  return createProjectStore({ index: memoryIndex(), files: memoryFiles(), ...options });
}
