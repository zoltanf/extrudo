import { createDocument, type DocumentId } from '@extrudo/core';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { beforeAll, describe, expect, it } from 'vitest';
import { idbFiles, idbIndex, openDatabase } from './idb';
import { createProjectStore } from './project-store';
import type { ProjectSummary } from './types';

beforeAll(() => {
  // idbFiles builds key ranges through the global, as it would in a browser.
  Object.assign(globalThis, { IDBKeyRange });
});

const summary = (id: string, modified: string): ProjectSummary => ({
  id: id as DocumentId,
  name: id,
  created: modified,
  modified,
  hasThumbnail: false,
});

describe('IndexedDB', () => {
  it('keeps the project index', async () => {
    const index = idbIndex(await openDatabase(new IDBFactory()));
    await index.put(summary('a', '2026-01-01T00:00:00.000Z'));
    await index.put(summary('b', '2026-01-02T00:00:00.000Z'));
    await index.put({ ...summary('a', '2026-01-03T00:00:00.000Z'), name: 'A' });
    expect((await index.get('a' as DocumentId))?.name).toBe('A');
    expect((await index.all()).map((s) => s.id).sort()).toEqual(['a', 'b']);
    await index.delete('a' as DocumentId);
    expect(await index.get('a' as DocumentId)).toBeUndefined();
  });

  it('stores files, and removes a folder with everything in it', async () => {
    const files = idbFiles(await openDatabase(new IDBFactory()));
    await files.write('projects/a/document.json', new Uint8Array([1]));
    await files.write('projects/a/thumbnail.png', new Uint8Array([2]));
    await files.write('projects/ab/document.json', new Uint8Array([3]));
    expect(await files.read('projects/a/document.json')).toEqual(new Uint8Array([1]));
    expect(await files.read('missing')).toBeUndefined();
    await files.remove('projects/a');
    expect(await files.read('projects/a/document.json')).toBeUndefined();
    expect(await files.read('projects/a/thumbnail.png')).toBeUndefined();
    // A sibling whose name starts the same survives.
    expect(await files.read('projects/ab/document.json')).toEqual(new Uint8Array([3]));
  });

  it('repairs a database that exists without its object stores', async () => {
    const factory = new IDBFactory();
    await new Promise<void>((resolve, reject) => {
      const request = factory.open('extrudo', 1);
      request.onsuccess = () => {
        request.result.close();
        resolve();
      };
      request.onerror = () => reject(request.error);
    });
    const db = await openDatabase(factory);
    expect(db.version).toBe(2);
    expect([...db.objectStoreNames].sort()).toEqual(['files', 'projects']);
    const index = idbIndex(db);
    await index.put(summary('a', '2026-01-01T00:00:00.000Z'));
    expect(await index.all()).toHaveLength(1);
  });

  it('backs a working project store, and survives reopening the database', async () => {
    const factory = new IDBFactory();
    const open = async () => {
      const db = await openDatabase(factory);
      return { db, store: createProjectStore({ index: idbIndex(db), files: idbFiles(db) }) };
    };
    const first = await open();
    const doc = createDocument({ name: 'Bracket' });
    await first.store.save(doc);
    first.db.close();

    const second = await open();
    expect((await second.store.list()).map((s) => s.name)).toEqual(['Bracket']);
    expect((await second.store.load(doc.id)).name).toBe('Bracket');
  });
});
