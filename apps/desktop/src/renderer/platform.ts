/**
 * `desktopPlatform()` (P6-01, ADR-0075 §3): the `Platform` the web UI is
 * written against, implemented through the preload bridge. Privileged work
 * happens in main; this file composes the proxy and the small adapters, so the
 * UI is unaware it is on the desktop.
 */

import type { ProjectId } from '@extrudo/storage';
import type {
  ExternalFiles,
  FileAccess,
  FolderFile,
  FolderLink,
  LinkedFolders,
  Platform,
  Preferences,
  RescueStore,
  StorageAccess,
} from '@extrudo/web';
// The leaf modules, not `@extrudo/web`: the UI stays out of the test path.
import { appNotifications } from '@extrudo/web/notifications';
import { recoverRescued } from '@extrudo/web/platform/rescue';
import type { ExtrudoApi, FolderEntry } from '../shared/ipc';
import { unwrap } from './errors';
import { desktopMenus } from './menus';
import { createStoreProxy } from './proxy';

/** The preference map, read once; the boot and `desktopPlatform` share it. */
let prefsPromise: Promise<Record<string, unknown>> | undefined;

/** Reads the whole preference map once through `invoke` (P6-01's review). */
export function readDesktopPreferences(api: ExtrudoApi): Promise<Record<string, unknown>> {
  // A failed read leaves defaults; preferences are a convenience.
  prefsPromise ??= api.prefs.read().catch(() => ({}));
  return prefsPromise;
}

/** Preferences from a map already read; each write updates it and is sent on. */
export function preferencesFrom(api: ExtrudoApi, values: Record<string, unknown>): Preferences {
  return {
    get<T>(key: string, fallback: T): T {
      const value = values[key];
      return (value === undefined ? fallback : value) as T;
    },
    set(key, value) {
      values[key] = value;
      api.prefs.write(key, value);
    },
  };
}

/** Preferences read once from main; each write updates the cache and is sent on. */
export async function desktopPreferences(api: ExtrudoApi): Promise<Preferences> {
  return preferencesFrom(api, await readDesktopPreferences(api));
}

export function desktopFiles(api: ExtrudoApi): FileAccess {
  return {
    download(file, name) {
      void file
        .arrayBuffer()
        .then((buffer) => api.files.download(new Uint8Array(buffer), name))
        .catch((error: unknown) => {
          // A failed save (disk full, a removed drive) must not be silent: the
          // export has already toasted success (P6-01's review).
          const message = error instanceof Error ? error.message : String(error);
          appNotifications.getState().push('error', `Couldn't save the file: ${message}`);
        });
    },
    async pick(accept) {
      const picked = await api.files.pick(accept);
      return picked ? new File([picked.bytes as Uint8Array<ArrayBuffer>], picked.name) : undefined;
    },
    async saveAs(file, name) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      return unwrap(await api.files.saveAs(bytes, name));
    },
  };
}

export function desktopStorage(api: ExtrudoApi): StorageAccess {
  return {
    persistence: () => api.storage.persistence(),
    requestPersistence: () => api.storage.requestPersistence(),
  };
}

/** Rescue copies over the synchronous bridge call (the web one writes synchronously too). */
export function desktopRescue(api: ExtrudoApi): RescueStore {
  return {
    put(doc) {
      return api.rescue.put(doc.id, JSON.stringify(doc));
    },
    clear(id) {
      api.rescue.clear(id);
    },
    list() {
      return api.rescue.list().map(({ id, raw }) => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(raw);
        } catch {
          parsed = null;
        }
        return { id: id as ProjectId, raw: parsed };
      });
    },
  };
}

function folderFile(entry: FolderEntry): FolderFile {
  return { name: entry.name, modified: entry.modified, size: entry.size };
}

function folderLink(api: ExtrudoApi, name: string): FolderLink {
  return {
    name,
    permission: async () => unwrap(await api.folders.permission()),
    request: async () => unwrap(await api.folders.request()),
    list: async () => (await unwrap(await api.folders.list())).map(folderFile),
    read: async (file) => unwrap(await api.folders.read(file)),
    write: async (file, bytes) => unwrap(await api.folders.write(file, bytes)),
  };
}

export function desktopFolders(api: ExtrudoApi): LinkedFolders {
  return {
    async link() {
      const folder = await unwrap(await api.folders.link());
      return folder ? folderLink(api, folder.name) : undefined;
    },
    async current() {
      const folder = await unwrap(await api.folders.current());
      return folder ? folderLink(api, folder.name) : undefined;
    },
    unlink: async () => {
      unwrap(await api.folders.unlink());
    },
  };
}

/** Writing back to a path main issued this session (P6-01 slice 2, finding 3). */
export function desktopExternalFiles(api: ExtrudoApi): ExternalFiles {
  return {
    write: async (path, bytes) => unwrap(await api.external.write(path, bytes)),
    stat: async (path) => unwrap(await api.external.stat(path)),
    read: async (path) => unwrap(await api.external.read(path)),
  };
}

export async function desktopPlatform(api: ExtrudoApi = window.extrudo): Promise<Platform> {
  const preferences = await desktopPreferences(api);
  const projects = createStoreProxy(api);
  const rescue = desktopRescue(api);
  await recoverRescued(projects, rescue);
  return {
    preferences,
    projects,
    storage: desktopStorage(api),
    files: desktopFiles(api),
    rescue,
    folders: desktopFolders(api),
    externalFiles: desktopExternalFiles(api),
    menus: desktopMenus(api),
  };
}
