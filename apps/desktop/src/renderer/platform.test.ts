import type { DocumentId, ExtrudoDocument } from '@extrudo/core';
import { createNotifications } from '@extrudo/web/notifications';
import { showUpdateReady, UPDATE_TOAST_MS } from '@extrudo/web/platform/updateNotice';
import { describe, expect, it, vi } from 'vitest';
import type { ExtrudoApi, UpdateStatus } from '../shared/ipc';
import {
  desktopFiles,
  desktopFolders,
  desktopPlatform,
  desktopPreferences,
  desktopRescue,
} from './platform';
import { desktopUpdates } from './updates';

function fakeApi(overrides: Partial<ExtrudoApi> = {}) {
  const api: ExtrudoApi = {
    prefs: { read: async () => ({ theme: 'dark' }), write: () => {} },
    store: { call: async () => undefined },
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
      current: async () => ({ name: 'Models' }),
      unlink: async () => {},
      permission: async () => 'granted',
      request: async () => true,
      list: async () => [{ name: 'Bracket.extrudo', modified: 10, size: 20 }],
      read: async () => ({ bytes: new Uint8Array([1]), modified: 3 }),
      write: async () => ({ modified: 4 }),
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
      write: async () => ({ modified: 1 }),
      stat: async () => undefined,
      read: async () => ({ bytes: new Uint8Array(), modified: 1 }),
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
        saveAs: async () => undefined,
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

  it('saves a Blob as with a path through the bridge (P6-01 slice 2)', async () => {
    const calls: { bytes: Uint8Array; name: string }[] = [];
    const api = fakeApi({
      files: {
        download: async () => {},
        pick: async () => undefined,
        saveAs: async (bytes, name) => {
          calls.push({ bytes, name });
          return { path: '/tmp/Bracket.extrudo', modified: 42 };
        },
      },
    });
    const files = desktopFiles(api);
    const result = await files.saveAs?.(new Blob([new Uint8Array([7, 8])]), 'Bracket.extrudo');
    expect(calls).toEqual([{ bytes: new Uint8Array([7, 8]), name: 'Bracket.extrudo' }]);
    expect(result).toEqual({ path: '/tmp/Bracket.extrudo', modified: 42 });
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
      'externalFiles',
      'files',
      'folders',
      'menus',
      'preferences',
      'projects',
      'rescue',
      'storage',
      'updates',
    ]);
    expect(platform.updates?.action).toBe('Restart');
    expect(await platform.storage.persistence()).toBe('persistent');
  });

  describe('updates (P6-01 slice 4)', () => {
    function setup() {
      let emit: (status: UpdateStatus) => void = () => {};
      const apply = vi.fn();
      const openRelease = vi.fn();
      const api = fakeApi({
        updates: {
          onStatus: (handler) => {
            emit = handler;
          },
          offStatus: () => {},
          check: () => {},
          apply,
          openRelease,
        },
      });
      const notifications = createNotifications({ later: () => {} });
      const updates = desktopUpdates(api, notifications.getState().push);
      return { emit: (s: UpdateStatus) => emit(s), apply, openRelease, notifications, updates };
    }

    it('waits while main says ready, and apply sends update:apply only then', async () => {
      const { emit, apply, updates } = setup();
      expect(await updates.apply()).toBe(false);
      expect(apply).not.toHaveBeenCalled();
      emit({ state: 'downloading', version: '0.5.0', percent: 50 });
      expect(updates.store.getState().waiting).toBe(false);
      emit({ state: 'ready', version: '0.5.0' });
      expect(updates.store.getState()).toEqual({ waiting: true, version: '0.5.0' });
      expect(await updates.apply()).toBe(true);
      expect(apply).toHaveBeenCalledOnce();
    });

    it('the ready toast says the version and restarts after saving', async () => {
      const { emit, apply, notifications, updates } = setup();
      emit({ state: 'ready', version: '0.5.0' });
      const saveEverything = vi.fn(async () => true);
      showUpdateReady({ updates, saveEverything, push: notifications.getState().push });
      const toast = notifications.getState().toasts.at(-1);
      expect(toast?.text).toBe('Extrudo 0.5.0 is ready.');
      expect(toast?.action?.label).toBe('Restart');
      toast?.action?.run();
      await vi.waitFor(() => expect(apply).toHaveBeenCalledOnce());
      expect(saveEverything).toHaveBeenCalledBefore(apply);
    });

    it('shows the notify-only toast once per version, its button asking main for the page', () => {
      const { emit, openRelease, notifications } = setup();
      const url = 'https://github.com/zoltanf/extrudo/releases/tag/v0.5.0';
      emit({ state: 'notify', version: '0.5.0', url });
      emit({ state: 'notify', version: '0.5.0', url });
      const toasts = notifications.getState().toasts;
      expect(toasts.map((t) => t.text)).toEqual(['Extrudo 0.5.0 is available.']);
      expect(toasts[0]?.lifetime).toBe(UPDATE_TOAST_MS);
      expect(toasts[0]?.action?.label).toBe('Open the release page');
      toasts[0]?.action?.run();
      // Main opens the URL it built; nothing crosses from here.
      expect(openRelease).toHaveBeenCalledWith();
      emit({ state: 'notify', version: '0.6.0', url });
      expect(notifications.getState().toasts.map((t) => t.text)).toEqual([
        'Extrudo 0.5.0 is available.',
        'Extrudo 0.6.0 is available.',
      ]);
    });

    it('a failed check is a quiet notification; a manual answer is a toast', () => {
      const { emit, notifications } = setup();
      emit({ state: 'error', message: 'net::ERR_INTERNET_DISCONNECTED' });
      expect(notifications.getState().toasts).toEqual([]);
      expect(notifications.getState().history.map((n) => [n.tone, n.text])).toEqual([
        ['error', "Couldn't check for updates: net::ERR_INTERNET_DISCONNECTED"],
      ]);
      emit({ state: 'idle' });
      expect(notifications.getState().toasts).toEqual([]);
      emit({ state: 'idle', message: 'Extrudo is up to date.' });
      expect(notifications.getState().toasts.map((t) => t.text)).toEqual([
        'Extrudo is up to date.',
      ]);
    });
  });
});
