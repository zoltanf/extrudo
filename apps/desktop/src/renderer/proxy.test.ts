import type { DocumentId, ExtrudoDocument } from '@extrudo/core';
import { ArchiveError, ProjectNotFoundError, StorageError } from '@extrudo/storage';
import { describe, expect, it } from 'vitest';
import type { ExtrudoApi, Noticed } from '../shared/ipc';
import { createStoreProxy } from './proxy';

/** A fake bridge that records store calls and answers from a map. */
function fakeApi(answers: Partial<Record<string, unknown>> = {}) {
  const calls: { method: string; args: unknown[] }[] = [];
  const api: ExtrudoApi = {
    prefs: { read: async () => ({}), write: () => {} },
    store: {
      call: async (method, args) => {
        calls.push({ method, args });
        return answers[method];
      },
    },
    files: {
      download: async () => {},
      pick: async () => undefined,
      saveAs: async () => undefined,
    },
    storage: {
      persistence: async () => 'persistent',
      requestPersistence: async () => 'persistent',
    },
    rescue: { put: () => true, clear: () => {}, list: () => [] },
    folders: {
      link: async () => undefined,
      current: async () => undefined,
      unlink: async () => {},
      permission: async () => 'granted',
      request: async () => true,
      list: async () => [],
      read: async () => ({ bytes: new Uint8Array(), modified: 0 }),
      write: async () => ({ modified: 0 }),
    },
    menus: {
      set: () => {},
      reset: () => {},
      listening: () => {},
      onRun: () => {},
      offRun: () => {},
      onOpenFile: () => {},
      offOpenFile: () => {},
    },
    external: {
      write: async () => ({ modified: 0 }),
      stat: async () => undefined,
      read: async () => ({ bytes: new Uint8Array(), modified: 0 }),
    },
    recent: {
      list: async () => [],
      clear: async () => {},
      remove: () => {},
      onChanged: () => {},
      offChanged: () => {},
    },
    app: { ready: () => {}, quit: () => {} },
    updates: {
      onStatus: () => {},
      offStatus: () => {},
      check: () => {},
      apply: () => {},
      openRelease: () => {},
    },
  };
  return { api, calls };
}

const id = '00000000-0000-4000-8000-000000000001' as DocumentId;

describe('the store proxy (ADR-0075 §3)', () => {
  it('passes plain methods straight through', async () => {
    const { api, calls } = fakeApi({ list: [{ id, name: 'A' }], save: { id, name: 'A' } });
    const store = createStoreProxy(api);
    expect(await store.list()).toEqual([{ id, name: 'A' }]);
    const doc = { id, name: 'A' } as ExtrudoDocument;
    await store.save(doc);
    expect(calls).toEqual([
      { method: 'list', args: [] },
      { method: 'save', args: [doc] },
    ]);
  });

  it('replays the leniency notices main collected for load and importFile', async () => {
    const { api } = fakeApi({
      load: { value: { id, name: 'A' }, notices: ['one', 'two'] } satisfies Noticed<unknown>,
      importFile: { value: { id, name: 'B' }, notices: ['copy'] } satisfies Noticed<unknown>,
    });
    const store = createStoreProxy(api);
    const notices: string[] = [];
    const doc = await store.load(id, { onNotice: (m) => notices.push(m) });
    expect(doc).toEqual({ id, name: 'A' });
    await store.importFile(new Blob([new Uint8Array([1, 2])]), {
      onNotice: (m) => notices.push(m),
    });
    expect(notices).toEqual(['one', 'two', 'copy']);
  });

  it('rebuilds the Blobs the interface returns and sends bytes for a thumbnail', async () => {
    const { api, calls } = fakeApi({
      thumbnail: new Uint8Array([137, 80]),
      exportFile: new Uint8Array([80, 75]),
    });
    const store = createStoreProxy(api);
    const thumb = await store.thumbnail(id);
    expect(thumb).toBeInstanceOf(Blob);
    expect(new Uint8Array(await (thumb as Blob).arrayBuffer())).toEqual(new Uint8Array([137, 80]));
    const file = await store.exportFile(id);
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(new Uint8Array([80, 75]));

    await store.setThumbnail(id, new Blob([new Uint8Array([9, 9])]));
    expect(calls.at(-1)?.method).toBe('setThumbnail');
    expect(calls.at(-1)?.args[1]).toEqual(new Uint8Array([9, 9]));

    const none = createStoreProxy(fakeApi({ thumbnail: null }).api);
    expect(await none.thumbnail(id)).toBeNull();
  });

  it('sends importFile bytes, not a Blob', async () => {
    const { api, calls } = fakeApi({ importFile: { value: { id }, notices: [] } });
    const store = createStoreProxy(api);
    await store.importFile(new Blob([new Uint8Array([7, 8, 9])]));
    expect(calls[0]?.method).toBe('importFile');
    expect(calls[0]?.args[0]).toEqual(new Uint8Array([7, 8, 9]));
  });

  it('rebuilds an error the main process serialised', async () => {
    const notFound = createStoreProxy(
      fakeApi({
        load: {
          error: { name: 'ProjectNotFoundError', message: "This project doesn't exist.", id },
        },
      }).api,
    );
    await expect(notFound.load(id)).rejects.toBeInstanceOf(ProjectNotFoundError);
    await expect(notFound.load(id)).rejects.toMatchObject({ id });

    const archive = createStoreProxy(
      fakeApi({
        importFile: {
          error: { name: 'ArchiveError', message: 'not a zip', code: 'not-a-zip' },
        },
      }).api,
    );
    await expect(archive.importFile(new Blob())).rejects.toBeInstanceOf(ArchiveError);
    await expect(archive.importFile(new Blob())).rejects.toMatchObject({ code: 'not-a-zip' });

    const storage = createStoreProxy(
      fakeApi({
        writeAttachment: { error: { name: 'StorageError', message: 'bad', id: '../../x' } },
      }).api,
    );
    await expect(
      storage.writeAttachment(id, 'a'.repeat(64), new Uint8Array()),
    ).rejects.toBeInstanceOf(StorageError);
  });

  it('covers every method the store interface has', () => {
    const { api } = fakeApi();
    const store = createStoreProxy(api);
    const expected = [
      'list',
      'get',
      'load',
      'save',
      'link',
      'archiveBytes',
      'writeAttachment',
      'readAttachment',
      'collectAttachments',
      'saveVersion',
      'versions',
      'loadVersion',
      'deleteVersions',
      'rename',
      'duplicate',
      'trash',
      'restore',
      'purge',
      'thumbnail',
      'setThumbnail',
      'exportFile',
      'importFile',
    ];
    for (const method of expected)
      expect(typeof store[method as keyof typeof store]).toBe('function');
  });
});
