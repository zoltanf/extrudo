/**
 * The main process's side of the bridge (P6-01, ADR-0075 §1): one handler per
 * channel in `shared/ipc.ts`. Nothing else in main answers the renderer, so the
 * privileged surface is exactly this file plus the modules it calls. The store,
 * the dialogs, the folders and the rescue file are injected, so the handlers
 * are thin.
 */
import { basename } from 'node:path';
import type { ProjectStore } from '@extrudo/storage';
import { type BrowserWindow, dialog, ipcMain, type OpenDialogOptions } from 'electron';
import { type ErrorEnvelope, serializeError } from '../shared/errors';
import { CHANNELS, isStoreMethod, type StoreMethod } from '../shared/ipc';
import type { DialogFiles } from './dialogs';
import type { Folders } from './folders';
import type { PreferencesFile } from './preferences';
import type { RescueFile } from './rescue';
import { storeCall } from './store-call';

/**
 * The folders handlers throw for a missing link or a bad file name; serialise
 * those the way `store-call.ts` does, so the renderer rebuilds the class
 * instead of seeing Electron's IPC prefix (P6-01's review).
 */
async function guarded<T>(run: () => T | Promise<T>): Promise<T | ErrorEnvelope> {
  try {
    return await run();
  } catch (error) {
    return { error: serializeError(error) };
  }
}

export interface IpcDependencies {
  preferences: PreferencesFile;
  store: ProjectStore;
  files: DialogFiles;
  rescue: RescueFile;
  folders: Folders;
  getWindow: () => BrowserWindow | null;
}

export function registerIpcHandlers(deps: IpcDependencies): void {
  // Preferences: the whole map is read once through `invoke` at boot (the
  // theme is applied after this promise), each write is scheduled and flushed
  // debounced in main. Only the rescue copy's put/list are synchronous.
  ipcMain.handle(CHANNELS.prefsRead, () => deps.preferences.read());
  ipcMain.on(CHANNELS.prefsWrite, (_event, key: string, value: unknown) => {
    deps.preferences.set(key, value);
  });

  ipcMain.handle(CHANNELS.storeCall, (_event, method: string, args: unknown[]) =>
    isStoreMethod(method)
      ? storeCall(deps.store, method as StoreMethod, args)
      : Promise.reject(new Error(`Unknown store method: ${method}`)),
  );

  ipcMain.handle(CHANNELS.fileDownload, (_event, bytes: Uint8Array, name: string) =>
    deps.files.download(bytes, name),
  );
  ipcMain.handle(CHANNELS.filePick, (_event, accept: string) => deps.files.pick(accept));

  ipcMain.handle(CHANNELS.storagePersistence, () => 'persistent');
  ipcMain.handle(CHANNELS.storageRequest, () => 'persistent');

  // The rescue copy is synchronous: `pagehide` has to write before it returns.
  ipcMain.on(CHANNELS.rescuePut, (event, id: string, raw: string) => {
    event.returnValue = deps.rescue.put(id, raw);
  });
  ipcMain.on(CHANNELS.rescueClear, (_event, id: string) => deps.rescue.clear(id));
  ipcMain.on(CHANNELS.rescueList, (event) => {
    event.returnValue = deps.rescue.list();
  });

  ipcMain.handle(CHANNELS.foldersLink, () =>
    guarded(async () => {
      const options: OpenDialogOptions = { properties: ['openDirectory', 'createDirectory'] };
      const win = deps.getWindow();
      const result = win
        ? await dialog.showOpenDialog(win, options)
        : await dialog.showOpenDialog(options);
      const path = result.filePaths[0];
      if (result.canceled || !path) return undefined;
      deps.folders.set(path);
      return { name: basename(path) };
    }),
  );
  ipcMain.handle(CHANNELS.foldersCurrent, () => guarded(() => deps.folders.current()));
  ipcMain.handle(CHANNELS.foldersUnlink, () => guarded(() => deps.folders.unlink()));
  ipcMain.handle(CHANNELS.folderPermission, () => guarded(() => deps.folders.permission()));
  ipcMain.handle(CHANNELS.folderRequest, () =>
    guarded(() => deps.folders.permission() === 'granted'),
  );
  ipcMain.handle(CHANNELS.folderList, () => guarded(() => deps.folders.list()));
  ipcMain.handle(CHANNELS.folderRead, (_event, name: string) =>
    guarded(() => deps.folders.read(name)),
  );
  ipcMain.handle(CHANNELS.folderWrite, (_event, name: string, bytes: Uint8Array) =>
    guarded(() => deps.folders.write(name, bytes)),
  );
}
