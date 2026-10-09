/**
 * Builds the exposed `ExtrudoApi` from an `ipcRenderer`-like object
 * (P6-01, ADR-0075 §1). Kept apart from `preload/index.ts` so the tests can
 * pass a fake `ipcRenderer` and prove the channel wiring — that a store call
 * refuses an unknown method, that the preference map is read once through
 * `invoke`, that only the rescue copy and its list are `sendSync`, and that the
 * menu/recent/open-file listeners register and unregister (P6-01 slice 2).
 */
import type { SlicerId } from '@extrudo/web/platform/slicer';
import {
  CHANNELS,
  type ExtrudoApi,
  type FolderEntry,
  isPluginMethod,
  isStoreMethod,
  type OpenedFile,
  type RecentEntry,
  type SavedFile,
  type UpdateStatus,
} from './ipc';

/** The slice of Electron's `ipcRenderer` this bridge needs. */
export interface IpcRendererLike {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>;
  send(channel: string, ...args: unknown[]): void;
  sendSync(channel: string, ...args: unknown[]): unknown;
  on(channel: string, listener: (event: unknown, ...args: unknown[]) => void): unknown;
  removeListener(channel: string, listener: (event: unknown, ...args: unknown[]) => void): unknown;
}

/** A `RecentEntry`-shaped row; the renderer's `Platform` type is structural. */
export function createApi(ipc: IpcRendererLike): ExtrudoApi {
  // One listener per event: `onRun` replaces the previous one, so a page that
  // registers again (a new AppShell) doesn't leave a stale handler behind.
  let runListener: ((event: unknown, id: unknown) => void) | undefined;
  let openListener: ((event: unknown, file: unknown) => void) | undefined;
  let changedListener: ((event: unknown) => void) | undefined;
  let statusListener: ((event: unknown, status: unknown) => void) | undefined;

  return {
    prefs: {
      read: () => ipc.invoke(CHANNELS.prefsRead) as Promise<Record<string, unknown>>,
      write: (key, value) => ipc.send(CHANNELS.prefsWrite, key, value),
    },
    store: {
      call: (method, args) =>
        isStoreMethod(method)
          ? ipc.invoke(CHANNELS.storeCall, method, args)
          : Promise.reject(new Error(`Unknown store method: ${String(method)}`)),
    },
    plugins: {
      call: (method, args) =>
        isPluginMethod(method)
          ? ipc.invoke(CHANNELS.pluginCall, method, args)
          : Promise.reject(new Error(`Unknown plugin method: ${String(method)}`)),
    },
    files: {
      download: (bytes, name) => ipc.invoke(CHANNELS.fileDownload, bytes, name) as Promise<void>,
      pick: (accept) =>
        ipc.invoke(CHANNELS.filePick, accept) as Promise<unknown> as Promise<
          { name: string; bytes: Uint8Array } | undefined
        >,
      saveAs: (bytes, name) =>
        ipc.invoke(CHANNELS.fileSaveAs, bytes, name) as Promise<SavedFile | undefined>,
      openDialog: () => ipc.send(CHANNELS.fileOpenDialog),
    },
    storage: {
      persistence: () => ipc.invoke(CHANNELS.storagePersistence) as Promise<'persistent'>,
      requestPersistence: () => ipc.invoke(CHANNELS.storageRequest) as Promise<'persistent'>,
    },
    docs: {
      open: (path) => ipc.send(CHANNELS.docsOpen, path),
    },
    rescue: {
      put: (id, raw) => ipc.sendSync(CHANNELS.rescuePut, id, raw) === true,
      clear: (id) => ipc.send(CHANNELS.rescueClear, id),
      list: () =>
        (ipc.sendSync(CHANNELS.rescueList) as { id: string; raw: string }[] | undefined) ?? [],
    },
    folders: {
      link: () => ipc.invoke(CHANNELS.foldersLink) as Promise<{ name: string } | undefined>,
      current: () => ipc.invoke(CHANNELS.foldersCurrent) as Promise<{ name: string } | undefined>,
      unlink: () => ipc.invoke(CHANNELS.foldersUnlink) as Promise<void>,
      permission: () =>
        ipc.invoke(CHANNELS.folderPermission) as ReturnType<ExtrudoApi['folders']['permission']>,
      request: () => ipc.invoke(CHANNELS.folderRequest) as Promise<boolean>,
      list: () => ipc.invoke(CHANNELS.folderList) as Promise<FolderEntry[]>,
      read: (name) =>
        ipc.invoke(CHANNELS.folderRead, name) as Promise<{ bytes: Uint8Array; modified: number }>,
      write: (name, bytes) =>
        ipc.invoke(CHANNELS.folderWrite, name, bytes) as Promise<{ modified: number }>,
    },
    menus: {
      set: (model) => ipc.send(CHANNELS.menuSet, model),
      reset: () => ipc.send(CHANNELS.menuReset),
      listening: (active) => ipc.send(CHANNELS.menuListening, active),
      onRun: (handler) => {
        if (runListener) ipc.removeListener(CHANNELS.menuRun, runListener);
        runListener = (_event, id) => handler(id as string);
        ipc.on(CHANNELS.menuRun, runListener);
      },
      offRun: () => {
        if (runListener) ipc.removeListener(CHANNELS.menuRun, runListener);
        runListener = undefined;
      },
      onOpenFile: (handler) => {
        if (openListener) ipc.removeListener(CHANNELS.fileOpenPath, openListener);
        openListener = (_event, file) => handler(file as OpenedFile);
        ipc.on(CHANNELS.fileOpenPath, openListener);
      },
      offOpenFile: () => {
        if (openListener) ipc.removeListener(CHANNELS.fileOpenPath, openListener);
        openListener = undefined;
      },
    },
    external: {
      write: (path, bytes) =>
        ipc.invoke(CHANNELS.fileWritePath, path, bytes) as Promise<{ modified: number }>,
      stat: (path) =>
        ipc.invoke(CHANNELS.fileStatPath, path) as Promise<{ modified: number } | undefined>,
      read: (path) =>
        ipc.invoke(CHANNELS.fileReadPath, path) as Promise<{
          bytes: Uint8Array;
          modified: number;
        }>,
    },
    recent: {
      list: () => ipc.invoke(CHANNELS.recentList) as Promise<RecentEntry[]>,
      names: () => ipc.invoke(CHANNELS.recentNames) as Promise<string[]>,
      open: (index, name) => ipc.send(CHANNELS.recentOpen, index, name),
      clear: () => ipc.invoke(CHANNELS.recentClear) as Promise<void>,
      remove: (path) => ipc.send(CHANNELS.recentRemove, path),
      onChanged: (handler) => {
        if (changedListener) ipc.removeListener(CHANNELS.recentChanged, changedListener);
        changedListener = () => handler();
        ipc.on(CHANNELS.recentChanged, changedListener);
      },
      offChanged: () => {
        if (changedListener) ipc.removeListener(CHANNELS.recentChanged, changedListener);
        changedListener = undefined;
      },
    },
    slicer: {
      list: () => ipc.invoke(CHANNELS.slicerList) as Promise<{ id: SlicerId; path: string }[]>,
      open: (file, id) => ipc.invoke(CHANNELS.slicerOpen, file, id) as Promise<boolean>,
    },
    app: {
      ready: () => ipc.send(CHANNELS.appReady),
      quit: () => ipc.send(CHANNELS.appQuit),
    },
    updates: {
      onStatus: (handler) => {
        if (statusListener) ipc.removeListener(CHANNELS.updateStatus, statusListener);
        statusListener = (_event, status) => handler(status as UpdateStatus);
        ipc.on(CHANNELS.updateStatus, statusListener);
      },
      offStatus: () => {
        if (statusListener) ipc.removeListener(CHANNELS.updateStatus, statusListener);
        statusListener = undefined;
      },
      check: () => ipc.send(CHANNELS.updateCheck),
      apply: () => ipc.send(CHANNELS.updateApply),
      openRelease: () => ipc.send(CHANNELS.updateRelease),
    },
  };
}
