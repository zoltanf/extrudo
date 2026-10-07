/**
 * The Electron main process (P6-01, ADR-0075 §1). It owns everything
 * privileged: the `userData` directory the Node store, preferences, rescue
 * copies and linked folder live in; the `app://` renderer protocol and the
 * content policy; the native dialogs; the application menu, the `.extrudo`
 * association and the recent-files list (slice 2); and the one window. The
 * renderer reaches it only through `ipc.ts`.
 *
 * One instance owns the directory: a second launch focuses the first and quits
 * (`app.requestSingleInstanceLock`), so the store's per-process lock is enough.
 * A second launch or an `open-file` event can name a `.extrudo`; that path goes
 * through `openQueue`, which waits until the renderer says it is listening.
 */
import { readFile, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { createNodeProjectStore } from '@extrudo/storage/node';
import type { MenuModel } from '@extrudo/web/menu-model';
import { app, BrowserWindow, dialog, Menu, type OpenDialogOptions, session, shell } from 'electron';
import { autoUpdater } from 'electron-updater';
import { CHANNELS } from '../shared/ipc';
import { createDialogFiles } from './dialogs';
import { createExternalFiles, createExternalPaths } from './externalFiles';
import { createFolders } from './folders';
import { HEADERS } from './headers';
import { registerIpcHandlers } from './ipc';
import { buildMenuTemplate, type MenuHandlers, QUIT_ID, SAVE_AS_ID } from './menuTemplate';
import { isAllowedNavigation } from './navigation';
import { createOpenQueue, extrudoPathFromArgv, isExtrudoPath } from './openPaths';
import { createPreferencesFile } from './preferences';
import { APP_URL, handleAppProtocol, registerAppScheme } from './protocol';
import { createRecentFile } from './recent';
import { createRescueFile } from './rescue';
import { createUpdates, type UpdaterLike } from './updates';

// Before `app.whenReady()`: a privileged scheme cannot be registered later.
registerAppScheme();

// A throwaway data directory for the packaged-app smoke test (and nothing
// else): it must be set before the single-instance lock, which lives in it.
if (process.env.EXTRUDO_USER_DATA) app.setPath('userData', process.env.EXTRUDO_USER_DATA);

/** A `.extrudo` larger than this is refused before it is read (finding 5). */
const MAX_OPEN_BYTES = 100 * 1024 * 1024;

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  main();
}

function main(): void {
  const userData = app.getPath('userData');
  const store = createNodeProjectStore(join(userData, 'projects'), {
    appVersion: app.getVersion(),
  });
  const preferences = createPreferencesFile(join(userData, 'preferences.json'));
  const rescue = createRescueFile(join(userData, 'rescue.json'));
  const folders = createFolders(join(userData, 'linked-folder.json'));
  const recent = createRecentFile(join(userData, 'recent.json'));
  const openQueue = createOpenQueue();
  // The paths main itself chose this session (deliverOpen, Save As…): the only
  // ones the renderer may read or write back through `file:*path` (finding 3).
  const paths = createExternalPaths();
  const externalFiles = createExternalFiles(paths);

  let window: BrowserWindow | null = null;
  const getWindow = () => window;
  const send = (channel: string, ...args: unknown[]) => window?.webContents.send(channel, ...args);
  const notifyRecentChanged = () => send(CHANNELS.recentChanged);

  // Auto-update (P6-01 slice 4). `autoUpdater` is a lazy getter in
  // electron-updater, so a dev run (never started) doesn't construct one.
  const updates = createUpdates({
    updater: () => autoUpdater as unknown as UpdaterLike,
    platform: process.platform,
    isAppImage: Boolean(process.env.APPIMAGE),
    packaged: app.isPackaged,
    disabled: Boolean(process.env.EXTRUDO_DISABLE_UPDATES),
    send: (status) => send(CHANNELS.updateStatus, status),
    log: console,
  });

  let menuModel: MenuModel[] = [];
  /** Whether a project page has registered its `menu:run` handler (finding 4). */
  let menuListening = false;
  const applyMenu = () => {
    Menu.setApplicationMenu(
      Menu.buildFromTemplate(
        buildMenuTemplate(menuModel, {
          // Open Recent is main's list, never the renderer's (finding 1).
          recent: recent.list(),
          handlers: menuHandlers,
          platform: process.platform,
          menuListening,
          updates: updates.running,
        }),
      ),
    );
  };
  /** The recent list changed: tell the renderer and rebuild the submenu. */
  const recentChanged = () => {
    notifyRecentChanged();
    applyMenu();
  };
  const menuHandlers: MenuHandlers = {
    run: (id) => send(CHANNELS.menuRun, id),
    open: () => void openDialog(),
    openRecent: (path) => openQueue.push(path),
    clearRecent: () => {
      recent.clear();
      // The OS keeps its own recent-documents list; clear it too (finding 6).
      app.clearRecentDocuments();
      recentChanged();
    },
    saveAs: () => send(CHANNELS.menuRun, SAVE_AS_ID),
    quit: () => {
      // A project page saves everything and calls back `app:quit`; with no
      // listener (the home screen) there is nothing to save, so quit directly.
      if (menuListening) send(CHANNELS.menuRun, QUIT_ID);
      else app.quit();
    },
    checkForUpdates: () => updates.check(),
  };

  /** Opens a `.extrudo` a person picked in the native Open… dialog. */
  async function openDialog(): Promise<void> {
    const options: OpenDialogOptions = {
      properties: ['openFile'],
      filters: [{ name: 'Extrudo', extensions: ['extrudo'] }],
    };
    const win = getWindow();
    const result = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options);
    const path = result.filePaths[0];
    if (!result.canceled && path) openQueue.push(path);
  }

  /** Reads an opened path and hands it to the renderer; a stale path drops out. */
  async function deliverOpen(path: string): Promise<void> {
    const name = basename(path);
    try {
      // Only an `.extrudo`, and not a huge one: `stat` first so a multi-GB file
      // is refused without reading it into memory (finding 5).
      if (!isExtrudoPath(path)) {
        send(CHANNELS.fileOpenPath, {
          path,
          name,
          bytes: new Uint8Array(),
          modified: 0,
          error: `${name} isn't an .extrudo file.`,
        });
        return;
      }
      const info = await stat(path);
      if (info.size > MAX_OPEN_BYTES) {
        send(CHANNELS.fileOpenPath, {
          path,
          name,
          bytes: new Uint8Array(),
          modified: info.mtimeMs,
          error: `${name} is too large to open (over 100 MB).`,
        });
        return;
      }
      const bytes = await readFile(path);
      // Main chose this path, so the renderer may write it back later.
      paths.issue(path);
      recent.add(path);
      app.addRecentDocument(path);
      send(CHANNELS.fileOpenPath, {
        path,
        name,
        bytes: new Uint8Array(bytes),
        modified: info.mtimeMs,
      });
      recentChanged();
    } catch {
      // The file is gone or unreadable: forget it rather than keep a dead entry.
      recent.remove(path);
      recentChanged();
    }
  }

  // A macOS `open-file` can arrive before the window exists; the queue holds it.
  app.on('open-file', (event, path) => {
    event.preventDefault();
    if (isExtrudoPath(path)) openQueue.push(path);
  });

  app.on('second-instance', (_event, argv) => {
    // Push the path before the window check: with the window closed the file
    // still has to open (finding 5).
    const path = extrudoPathFromArgv(argv.slice(1));
    if (path) openQueue.push(path);
    if (!window) return;
    if (window.isMinimized()) window.restore();
    window.focus();
  });

  app.whenReady().then(() => {
    // `app://` serves the packaged build; the policy rides on its responses
    // (protocol.ts). This hook stays as belt and braces for any response that
    // didn't come through `protocol.handle`.
    handleAppProtocol(join(__dirname, '../renderer'));
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      const responseHeaders = details.responseHeaders ?? {};
      if (details.url.startsWith('app://')) {
        for (const [name, value] of Object.entries(HEADERS)) responseHeaders[name] = [value];
      }
      callback({ responseHeaders });
    });
    // Nothing in the app needs a camera, a microphone, a location or a device:
    // deny every permission request rather than leave the default.
    session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) =>
      callback(false),
    );

    registerIpcHandlers({
      preferences,
      store,
      files: createDialogFiles(getWindow),
      rescue,
      folders,
      recent,
      externalFiles,
      menu: {
        set: (model) => {
          menuModel = model;
          applyMenu();
        },
        reset: () => {
          menuModel = [];
          applyMenu();
        },
        setListening: (active) => {
          menuListening = active;
          // Save As… enables and the Quit path changes with a document open.
          applyMenu();
        },
      },
      savedFile: (path) => {
        // Save As… wrote to a path main chose; the renderer may write it back.
        paths.issue(path);
        recent.add(path);
        app.addRecentDocument(path);
        recentChanged();
      },
      recentChanged: () => recentChanged(),
      rendererReady: () => {
        openQueue.ready();
        // A reloaded renderer starts with no update state: say what main knows.
        if (updates.status.state !== 'idle') send(CHANNELS.updateStatus, updates.status);
      },
      quit: () => app.quit(),
      getWindow,
      updates: {
        check: () => updates.check(),
        apply: () => updates.apply(),
        openRelease: () => {
          const url = updates.releaseUrl();
          if (url) void shell.openExternal(url);
        },
      },
    });
    createWindow();
    // Before the first menu, so Help › Check for Updates… knows whether it runs.
    updates.start();
    // The window exists now; a queued open waits for the renderer's `app:ready`.
    openQueue.deliverWith((path) => void deliverOpen(path));
    applyMenu();

    // A file named on the first launch's command line (Windows/Linux).
    const initial = extrudoPathFromArgv(process.argv.slice(1));
    if (initial) openQueue.push(initial);

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('before-quit', () => {
    updates.dispose();
    preferences.flush();
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  function createWindow(): void {
    window = new BrowserWindow({
      width: 1440,
      height: 900,
      minWidth: 960,
      minHeight: 600,
      backgroundColor: '#1B1F27',
      show: false,
      webPreferences: {
        preload: join(__dirname, '../preload/index.cjs'),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
      },
    });
    window.on('ready-to-show', () => window?.show());
    // A design stays open for days: focus checks again when the last is old.
    window.on('focus', () => updates.focused());
    window.on('closed', () => {
      window = null;
    });

    // A compromised renderer must not turn this window into a browser: no
    // top-level navigation off `app://` (or the dev server's origin), no new
    // windows, and no webview (P6-01's review). The preload runs in every
    // document, so this is what keeps the bridge out of an attacker's page.
    window.webContents.on('will-navigate', (event, url) => {
      if (!isAllowedNavigation(url, process.env.ELECTRON_RENDERER_URL)) event.preventDefault();
    });
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-attach-webview', (event) => event.preventDefault());

    const devUrl = process.env.ELECTRON_RENDERER_URL;
    if (devUrl) void window.loadURL(devUrl);
    else void window.loadURL(APP_URL);
  }
}
