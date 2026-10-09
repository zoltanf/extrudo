/**
 * The main process's side of the bridge (P6-01, ADR-0075 §1): one handler per
 * channel in `shared/ipc.ts`. Nothing else in main answers the renderer, so the
 * privileged surface is exactly this file plus the modules it calls. The store,
 * the dialogs, the folders and the rescue file are injected, so the handlers
 * are thin.
 */
import { basename } from 'node:path';
import type { PluginStore, ProjectStore } from '@extrudo/storage';
import type { MenuModel } from '@extrudo/web/menu-model';
import { type BrowserWindow, dialog, ipcMain, type OpenDialogOptions } from 'electron';
import { type ErrorEnvelope, serializeError } from '../shared/errors';
import { CHANNELS, isPluginMethod, isStoreMethod, type StoreMethod } from '../shared/ipc';
import { isMenuModel } from '../shared/menuModel';
import type { DialogFiles } from './dialogs';
import type { ExternalFiles } from './externalFiles';
import type { Folders } from './folders';
import { pluginCall } from './plugin-call';
import type { PreferencesFile } from './preferences';
import { type RecentFile, recentPathAt } from './recent';
import type { RescueFile } from './rescue';
import type { SlicerService } from './slicerService';
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
  /** The installed plugins, under `userData/plugins` (P6-03 slice 2). */
  plugins: PluginStore;
  files: DialogFiles;
  rescue: RescueFile;
  folders: Folders;
  /** Writing back to a path main itself issued this session (finding 3). */
  externalFiles: ExternalFiles;
  /** The native application menu: the renderer's model, and the desktop default. */
  /** Whether this platform has an application menu (macOS only). */
  hasMenu: boolean;
  menu: { set(model: MenuModel[]): void; reset(): void; setListening(active: boolean): void };
  /** The recent-files list; `savedFile` records a Save As… and tells the renderer. */
  recent: RecentFile;
  savedFile(path: string): void;
  recentChanged(): void;
  /** The renderer's menu/open-file handlers are registered; deliver what waited. */
  rendererReady(): void;
  /** Open File… (ADR-0075, 2026-10-09): the native dialog, then the usual open path. */
  openFileDialog(): void;
  /** Opens a path from main's recent list (already looked up). */
  openRecent(path: string): void;
  /** Save-then-quit asked from the native menu; the renderer confirmed. */
  quit(): void;
  /** Slicer detection and launch (P6-02). */
  slicers: SlicerService;
  getWindow: () => BrowserWindow | null;
  /** Auto-update (P6-01 slice 4): a check, an install, and the release page main built. */
  updates: { check(): void; apply(): boolean; openRelease(): void };
  /** The docs pages (P6-06 S9): a whitelisted path, the URL main builds itself. */
  docs: { open(path: unknown): void };
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

  // The installed plugins (P6-03 slice 2): the whitelist is checked again here,
  // and `pluginCall` checks each method's arguments and returns errors as data.
  ipcMain.handle(CHANNELS.pluginCall, (_event, method: unknown, args: unknown) =>
    guarded(() => {
      if (!isPluginMethod(method)) throw new Error(`Unknown plugin method: ${String(method)}`);
      return pluginCall(deps.plugins, method, Array.isArray(args) ? args : []);
    }),
  );

  ipcMain.handle(CHANNELS.fileDownload, (_event, bytes: Uint8Array, name: string) =>
    deps.files.download(bytes, name),
  );
  ipcMain.handle(CHANNELS.filePick, (_event, accept: string) => deps.files.pick(accept));
  // Through `guarded`: a failed write must cross as `describeError`'s wording,
  // not Electron's "Error invoking remote method…" (finding 6).
  ipcMain.handle(CHANNELS.fileSaveAs, (_event, bytes: Uint8Array, name: string) =>
    guarded(async () => {
      const result = await deps.files.saveAs(bytes, name);
      if (result) deps.savedFile(result.path);
      return result;
    }),
  );

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

  // Menus, the file association and recent files (P6-01 slice 2, ADR-0075 §2).
  // The model is validated before it reaches `Menu.buildFromTemplate`: a
  // malformed one is ignored with one warning rather than thrown from
  // `ipcMain.on`, which has no `try/catch` in main (finding 2).
  ipcMain.on(CHANNELS.menuSet, (_event, model: unknown) => {
    if (!isMenuModel(model)) {
      console.warn('Ignoring a malformed menu model from the renderer.');
      return;
    }
    // Windows and Linux have no application menu (ADR-0075, 2026-10-09): nothing to set.
    if (!deps.hasMenu) return;
    deps.menu.set(model);
  });
  ipcMain.on(CHANNELS.menuReset, () => deps.menu.reset());
  ipcMain.on(CHANNELS.menuListening, (_event, active: unknown) =>
    deps.menu.setListening(active === true),
  );
  ipcMain.handle(CHANNELS.recentList, () => deps.recent.list());
  ipcMain.on(CHANNELS.fileOpenDialog, () => deps.openFileDialog());
  ipcMain.handle(CHANNELS.recentNames, () => deps.recent.list().map((entry) => entry.name));
  ipcMain.on(CHANNELS.recentOpen, (_event, index: unknown, name: unknown) => {
    const path = recentPathAt(deps.recent.list(), index, name);
    if (path) deps.openRecent(path);
  });
  ipcMain.handle(CHANNELS.recentClear, () => {
    deps.recent.clear();
    deps.recentChanged();
  });
  // A path whose import failed leaves the list (finding 6): a corrupt file
  // must not stay to fail again on the next click.
  ipcMain.on(CHANNELS.recentRemove, (_event, path: unknown) => {
    if (typeof path !== 'string') return;
    deps.recent.remove(path);
    deps.recentChanged();
  });
  // Writing back to an opened/Save-As'd file. `externalFiles` refuses a path
  // main didn't issue, so a compromised renderer can't reach another file.
  ipcMain.handle(CHANNELS.fileWritePath, (_event, path: string, bytes: Uint8Array) =>
    guarded(() => deps.externalFiles.write(path, bytes)),
  );
  ipcMain.handle(CHANNELS.fileStatPath, (_event, path: string) =>
    guarded(() => deps.externalFiles.stat(path)),
  );
  ipcMain.handle(CHANNELS.fileReadPath, (_event, path: string) =>
    guarded(() => deps.externalFiles.read(path)),
  );
  // Arguments are checked in the service; a malformed one crosses as the error envelope.
  ipcMain.handle(CHANNELS.slicerList, () => guarded(() => deps.slicers.list()));
  ipcMain.handle(CHANNELS.slicerOpen, (_event, file: unknown, id: unknown) =>
    guarded(() => deps.slicers.open(file, id)),
  );
  ipcMain.on(CHANNELS.appReady, () => deps.rendererReady());
  ipcMain.on(CHANNELS.appQuit, () => deps.quit());

  // Auto-update (P6-01 slice 4). None of these takes an argument: `apply` is
  // refused in main unless an update is downloaded (the renderer has saved
  // first), and the release page is the URL main built from the tag, so the
  // renderer can't make main open a page of its choosing.
  ipcMain.on(CHANNELS.updateCheck, () => deps.updates.check());
  ipcMain.on(CHANNELS.updateApply, () => void deps.updates.apply());
  ipcMain.on(CHANNELS.updateRelease, () => deps.updates.openRelease());

  // The docs pages (P6-06 S9): the path is matched in `deps.docs`, the URL is
  // main's own, so the renderer can't make main open a page of its choosing.
  ipcMain.on(CHANNELS.docsOpen, (_event, path: unknown) => deps.docs.open(path));
}
