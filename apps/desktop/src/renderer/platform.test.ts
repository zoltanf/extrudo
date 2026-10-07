import type { DocumentId, ExtrudoDocument } from '@extrudo/core';
import { describe, expect, it } from 'vitest';
import type { ExtrudoApi } from '../shared/ipc';
import {
  desktopFiles,
  desktopFolders,
  desktopPlatform,
  desktopPreferences,
  desktopRescue,
} from './platform';

function fakeApi(overrides: Partial<ExtrudoApi> = {}) {
  const api: ExtrudoApi = {
    prefs: { read: async () => ({ theme: 'dark' }), write: () => {} },
    store: { call: async () => undefined },
    files: { download: async () => {}, pick: async () => undefined },
    storage: {
      persistence: async () => 'persistent',
      requestPersistence: async () => 'persistent',
    },
    rescue: { put: () => true, clear: () => {}, list: () => [] },
    folders: {
      link: async () => undefined,
      current: async () => ({ name: 'Models' }),
      unlink: async () => {},
      permission: async () => 'granted',
      request: async () => true,
      list: async () => [{ name: 'Bracket.extrudo', modified: 10, size: 20 }],
      read: async () => ({ bytes: new Uint8Array([1]), modified: 3 }),
      write: async () => ({ modified: 4 }),
    },
    ...overrides,
  };
  return api;
}

const id = '00000000-0000-4000-8000-000000000001' as DocumentId;

describe('desktopPlatform (ADR-0075 §3)', () => {
  it('reads and caches preferences, sending each write on', async () => {
    const written: [string, unknown][] = [];
    const api = fakeApi({
      prefs: { read: async () => ({ theme: 'dark' }), write: (k, v) => written.push([k, v]) },
    });
    const prefs = await desktopPreferences(api);
    expect(prefs.get('theme', 'light')).toBe('dark');
    expect(prefs.get('missing', 42)).toBe(42);
    prefs.set('panel', 300);
    expect(prefs.get('panel', 0)).toBe(300);
    expect(written).toEqual([['panel', 300]]);
  });

  it('picks a file as a File and saves a Blob through the bridge', async () => {
    const saved: { bytes: Uint8Array; name: string }[] = [];
    const api = fakeApi({
      files: {
        download: async (bytes, name) => {
          saved.push({ bytes, name });
        },
        pick: async () => ({ name: 'part.svg', bytes: new Uint8Array([1, 2]) }),
      },
    });
    const files = desktopFiles(api);
    const picked = await files.pick('.svg');
    expect(picked).toBeInstanceOf(File);
    expect(picked?.name).toBe('part.svg');
    files.download(new Blob([new Uint8Array([9])]), 'out.3mf');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(saved).toEqual([{ bytes: new Uint8Array([9]), name: 'out.3mf' }]);
  });

  it('writes rescue copies synchronously and parses them back at startup', () => {
    const kept: Record<string, string> = {};
    const api = fakeApi({
      rescue: {
        put: (key, raw) => {
          kept[key] = raw;
          return true;
        },
        clear: () => {},
        list: () => [
          { id, raw: '{"name":"Bracket"}' },
          { id: 'bad', raw: 'not json' },
        ],
      },
    });
    const rescue = desktopRescue(api);
    const doc = { id, name: 'Bracket' } as ExtrudoDocument;
    expect(rescue.put(doc)).toBe(true);
    expect(kept[id]).toBe(JSON.stringify(doc));
    expect(rescue.list()).toEqual([
      { id, raw: { name: 'Bracket' } },
      { id: 'bad', raw: null },
    ]);
  });

  it('wraps the linked folder and lists its files', async () => {
    const api = fakeApi();
    const folders = desktopFolders(api);
    const link = await folders.current();
    expect(link?.name).toBe('Models');
    expect(await link?.list()).toEqual([{ name: 'Bracket.extrudo', modified: 10, size: 20 }]);
    expect(await link?.read('Bracket.extrudo')).toEqual({
      bytes: new Uint8Array([1]),
      modified: 3,
    });
  });

  it('assembles the whole Platform, recovering no rescue copies', async () => {
    const platform = await desktopPlatform(fakeApi());
    expect(Object.keys(platform).sort()).toEqual([
      'files',
      'folders',
      'preferences',
      'projects',
      'rescue',
      'storage',
    ]);
    expect(await platform.storage.persistence()).toBe('persistent');
  });
});
