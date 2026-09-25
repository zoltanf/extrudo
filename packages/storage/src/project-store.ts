/**
 * The ProjectStore over an index and a file store (ADR-0009). Each project
 * is `projects/<id>/document.json` plus an optional `thumbnail.png`; the
 * index holds the summaries the home screen lists. A save writes the file
 * first and the index second, so the index never points at a document that
 * wasn't written.
 */
import {
  newId as coreNewId,
  type DocumentId,
  type ExtrudoDocument,
  loadDocument,
} from '@extrudo/core';
import { readArchive, writeArchive } from './archive';
import { type FileStore, memoryFiles } from './files';
import { memoryIndex, type ProjectIndex } from './idb';
import {
  ArchiveError,
  type ProjectId,
  ProjectNotFoundError,
  type ProjectStore,
  type ProjectSummary,
} from './types';

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
      const bytes = writeArchive(await load(id), await readThumbnail(id));
      return new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'application/zip' });
    },
    async importFile(file) {
      const archive = readArchive(new Uint8Array(await file.arrayBuffer()));
      const { doc, thumbnail } = archive;
      if (await index.get(doc.id)) return saveCopy(doc, doc.name, thumbnail);
      const summary = await save(doc);
      if (thumbnail) await writeThumbnail(doc.id, thumbnail);
      return { ...summary, hasThumbnail: !!thumbnail };
    },
  };
}

/** A project store held in memory, for tests. */
export function memoryProjectStore(options: Partial<ProjectStoreOptions> = {}): ProjectStore {
  return createProjectStore({ index: memoryIndex(), files: memoryFiles(), ...options });
}
