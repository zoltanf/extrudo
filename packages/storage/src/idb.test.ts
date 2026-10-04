import { createDocument, type DocumentId } from '@extrudo/core';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { beforeAll, describe, expect, it } from 'vitest';
import { idbHandles } from './handles';
import { DB_VERSION, idbFiles, idbIndex, openDatabase } from './idb';
import { createProjectStore } from './project-store';
import type { ProjectSummary } from './types';

beforeAll(() => {
  // idbFiles builds key ranges through the global, as it would in a browser.
  Object.assign(globalThis, { IDBKeyRange });
});

/** A database at one version, as another tab of this origin would hold it. */
function openAt(factory: IDBFactory, version: number): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open('extrudo', version);
    request.onupgradeneeded = () => {
      for (const store of ['projects', 'files']) {
        if (!request.result.objectStoreNames.contains(store)) {
          request.result.createObjectStore(
            store,
            store === 'projects' ? { keyPath: 'id' } : undefined,
          );
        }
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

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
    await files.write('projects/a/attachments/aa', new Uint8Array([3]));
    await files.write('projects/ab/document.json', new Uint8Array([4]));
    expect(await files.read('projects/a/document.json')).toEqual(new Uint8Array([1]));
    expect(await files.read('missing')).toBeUndefined();
    expect(await files.list('projects/a')).toEqual([
      'projects/a/attachments/aa',
      'projects/a/document.json',
      'projects/a/thumbnail.png',
    ]);
    expect(await files.list('projects/zz')).toEqual([]);
    await files.remove('projects/a');
    expect(await files.list('projects/a')).toEqual([]);
    expect(await files.read('projects/a/document.json')).toBeUndefined();
    expect(await files.read('projects/a/thumbnail.png')).toBeUndefined();
    // A sibling whose name starts the same survives.
    expect(await files.read('projects/ab/document.json')).toEqual(new Uint8Array([4]));
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
    expect([...db.objectStoreNames].sort()).toEqual(['files', 'handles', 'projects']);
    const index = idbIndex(db);
    await index.put(summary('a', '2026-01-01T00:00:00.000Z'));
    expect(await index.all()).toHaveLength(1);
  });

  it('keeps one browser handle, the linked folder (P4-09)', async () => {
    const handles = idbHandles(await openDatabase(new IDBFactory()));
    expect(await handles.get()).toBeUndefined();
    const handle = { kind: 'directory', name: 'Designs' };
    await handles.put(handle);
    expect(await handles.get()).toEqual(handle);
    await handles.put({ kind: 'directory', name: 'Other' });
    // One folder at a time (ADR-0065 §3): the new one replaces the old.
    expect(await handles.get()).toEqual({ kind: 'directory', name: 'Other' });
    await handles.delete();
    expect(await handles.get()).toBeUndefined();
  });

  it('upgrades a version 1 database to add the handles store', async () => {
    const factory = new IDBFactory();
    const older = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = factory.open('extrudo', 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore('projects', { keyPath: 'id' });
        request.result.createObjectStore('files');
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    older.close();
    const handles = idbHandles(await openDatabase(factory));
    await handles.put({ kind: 'directory', name: 'Designs' });
    expect(await handles.get()).toEqual({ kind: 'directory', name: 'Designs' });
  });

  it('says an upgrade is waiting for another tab, and finishes when it lets go', async () => {
    const factory = new IDBFactory();
    // A tab on the old code, holding a connection of the old version.
    const older = await openAt(factory, 1);
    let blocked = 0;
    let onWaiting: () => void = () => {};
    const waiting = new Promise<void>((resolve) => {
      onWaiting = resolve;
    });
    const opening = openDatabase(factory, 'extrudo', {
      onBlocked: () => {
        blocked++;
        onWaiting();
      },
    });
    // Nothing has let go yet, so the upgrade is still waiting.
    await waiting;
    expect(blocked).toBe(1);
    const settled = { done: false };
    void opening.then(() => {
      settled.done = true;
    });
    await Promise.resolve();
    expect(settled.done).toBe(false);

    older.close();
    const db = await opening;
    expect([...db.objectStoreNames].sort()).toEqual(['files', 'handles', 'projects']);
    db.close();
  });

  it('lets go of the database when another tab upgrades it', async () => {
    const factory = new IDBFactory();
    let changes = 0;
    const db = await openDatabase(factory, 'extrudo', {
      onVersionChange: () => void changes++,
    });
    // The tab that upgrades waits for this one to close: it does, so it opens.
    await openAt(factory, DB_VERSION + 1).then((upgrading) => upgrading.close());
    expect(changes).toBe(1);
    // Closed, so using it now throws rather than reading a stale database.
    expect(() => db.transaction('projects', 'readonly')).toThrow();
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
