/**
 * The ProjectStore over an index and a file store (ADR-0009). Each project
 * is `projects/<id>/document.json` plus an optional `thumbnail.png` and its
 * versions (`versions.ts`, ADR-0036); the index holds the summaries the
 * home screen lists. A save writes the file first and the index second, so
 * the index never points at a document that wasn't written.
 */
import {
  newId as coreNewId,
  type DocumentId,
  type ExtrudoDocument,
  loadDocument,
} from '@extrudo/core';
import { gunzipSync, gzipSync } from 'fflate';
import { readArchive, writeArchive } from './archive';
import { type FileStore, memoryFiles } from './files';
import { memoryIndex, type ProjectIndex } from './idb';
import {
  ArchiveError,
  type ProjectId,
  ProjectNotFoundError,
  type ProjectStore,
  type ProjectSummary,
  type VersionSummary,
} from './types';
import {
  nextVersionNumber,
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
}

const documentPath = (id: ProjectId) => `projects/${id}/document.json`;
const thumbnailPath = (id: ProjectId) => `projects/${id}/thumbnail.png`;
const versionIndexPath = (id: ProjectId) => `projects/${id}/versions/index.json`;
const versionPath = (id: ProjectId, n: number) => `projects/${id}/versions/${n}.json.gz`;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function createProjectStore(options: ProjectStoreOptions): ProjectStore {
  const { index, files } = options;
  const now = options.now ?? (() => new Date().toISOString());
  const makeId = options.newId ?? (() => coreNewId<DocumentId>());

  const summaryOf = async (id: ProjectId) => {
    const summary = await index.get(id);
    if (!summary) throw new ProjectNotFoundError(id);
    return summary;
  };

  const load = async (id: ProjectId): Promise<ExtrudoDocument> => {
    await summaryOf(id);
    const bytes = await files.read(documentPath(id));
    if (!bytes) throw new ArchiveError('damaged', "This project's document is missing.");
    let raw: unknown;
    try {
      raw = JSON.parse(decoder.decode(bytes));
    } catch {
      throw new ArchiveError('damaged', "This project's document is damaged.");
    }
    return loadDocument(raw).doc;
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
    };
    await index.put(summary);
    return summary;
  };

  const readThumbnail = (id: ProjectId) => files.read(thumbnailPath(id));

  /** The version index, oldest first (none if there is no index yet). */
  const readVersions = async (id: ProjectId): Promise<VersionSummary[]> => {
    const bytes = await files.read(versionIndexPath(id));
    if (!bytes) return [];
    let raw: unknown;
    try {
      raw = JSON.parse(decoder.decode(bytes));
    } catch {
      raw = undefined;
    }
    const versions = readVersionIndex(raw);
    if (!versions) throw new ArchiveError('damaged', "This project's version list is damaged.");
    return versions;
  };

  /** Writes versions (their files, then the index) into a project that has none. */
  const writeVersions = async (id: ProjectId, versions: readonly StoredVersion[]) => {
    if (versions.length === 0) return;
    for (const { summary, doc } of versions) {
      await files.write(
        versionPath(id, summary.number),
        gzipSync(encoder.encode(JSON.stringify({ ...doc, id }))),
      );
    }
    await files.write(
      versionIndexPath(id),
      encoder.encode(JSON.stringify(writeVersionIndex(versions.map((v) => v.summary)))),
    );
  };

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

  /** Saves a document under a new ID, keeping the thumbnail if there is one. */
  const saveCopy = async (doc: ExtrudoDocument, name: string, thumbnail?: Uint8Array) => {
    const copy: ExtrudoDocument = {
      ...doc,
      id: makeId(),
      name,
      meta: { ...doc.meta, created: now() },
    };
    const summary = await save(copy);
    if (thumbnail) await writeThumbnail(copy.id, thumbnail);
    return { ...summary, hasThumbnail: !!thumbnail };
  };

  return {
    async list() {
      const all = await index.all();
      return all.sort((a, b) => b.modified.localeCompare(a.modified));
    },
    get: (id) => index.get(id),
    load,
    save,
    async saveVersion(doc, description) {
      await summaryOf(doc.id);
      const versions = await readVersions(doc.id);
      const summary = await save(doc);
      const version: VersionSummary = {
        number: nextVersionNumber(versions),
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
      await files.write(
        versionIndexPath(doc.id),
        encoder.encode(JSON.stringify(writeVersionIndex([...versions, version]))),
      );
      return version;
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
      return saveCopy(doc, `${doc.name} copy`, await readThumbnail(id));
    },
    async trash(id) {
      await index.put({ ...(await summaryOf(id)), trashed: now() });
    },
    async restore(id) {
      const { trashed: _, ...summary } = await summaryOf(id);
      await index.put(summary);
    },
    async purge(id) {
      // Index first: a crash then leaves an orphan folder, never a listed project without files.
      await index.delete(id);
      await files.remove(`projects/${id}`);
    },
    async thumbnail(id) {
      const bytes = await readThumbnail(id);
      return bytes ? new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'image/png' }) : null;
    },
    async setThumbnail(id, png) {
      await writeThumbnail(id, new Uint8Array(await png.arrayBuffer()));
    },
    async exportFile(id) {
      const bytes = writeArchive(await load(id), await readThumbnail(id), await allVersions(id));
      return new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'application/zip' });
    },
    async importFile(file) {
      const archive = readArchive(new Uint8Array(await file.arrayBuffer()));
      const { doc, thumbnail, versions } = archive;
      if (await index.get(doc.id)) {
        const copy = await saveCopy(doc, doc.name, thumbnail);
        await writeVersions(copy.id, versions);
        return copy;
      }
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
