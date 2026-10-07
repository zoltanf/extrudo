# ADR-0075: Electron desktop app

- **Status:** Accepted, 2026-10-07
- **Task:** P6-01 (Phase 6: "Electron app: electron-vite; the Node-fs
  `ProjectStore`; native menus from the command registry; `.extrudo` file
  association; recent files; auto-update; builds for AppImage/deb, Windows and
  macOS (signing)"). **This ADR and its first slice cover the shell, the store
  and the platform**; menus, association, recent files, auto-update and
  packaging are later slices.
- **Builds on:** ADR-0006 (Electron over Tauri, the platform choice),
  ADR-0009 (storage: `ProjectStore` over `ProjectIndex` + `FileStore`, the
  `.extrudo` archive, autosave, the rescue copy), ADR-0036 (versions under the
  store's lock), ADR-0061/0066 (attachments beside the document), ADR-0065 §3
  (linked folders are optional on `Platform`), ADR-0062 (`openInSlicer` is
  optional and P6-02's), ADR-0054/0057 (the web app's COOP/COEP + CSP headers;
  the service worker is web-only), ADR-0070 (the app's own kernel worker entry
  with the script runner), ADR-0037 (the WASM assets).

## Context

The whole app is written behind `apps/web/src/platform/` interfaces precisely
so a desktop build can swap the browser's storage, files and dialogs for the
real file system (architecture §8; "Hard rules"). The kernel, the solver and
the script runner are Web Workers and WASM that run the same in Electron's
Chromium. The document, its commands and the recompute engine know nothing
about the platform.

What the web build cannot do: keep projects as real files a person can back
up, open in a slicer, or name in a native dialog. OPFS is sandboxed and
invisible; `showDirectoryPicker` is Chromium-specific and permissioned; a
download is a browser download. The desktop build gets all of that from the
operating system.

## Decision

### 1. `apps/desktop`, built with electron-vite; the renderer is the web app's own source

`apps/desktop` is the Electron app: **main**, **preload** and **renderer**
built by `electron-vite` (`electron.vite.config.ts`). The renderer is not a
fork of the UI: it is `apps/web/src` built again with a different entry
(`apps/desktop/src/renderer/main.tsx`), which boots `desktopPlatform()`
instead of `webPlatform()`. `apps/web` exposes what the entry needs through a
small **`apps/web/src/entry/`** pair:

- `entry/kit.tsx` re-exports `App`, `applyInitialTheme`, `ToastsOnly`,
  `TooltipProvider`, `StartupError`, `appNotifications`, the `Platform` types
  and `recoverRescued` (the shared kit);
- `entry/styles.ts` imports the bundled font faces and `app.css` (so the
  desktop renderer gets the same styles);
- `entry/desktop.tsx` imports the styles and exports `bootDesktop(platform)`
  (theme → `ToastsOnly` → `App`/`StartupError`, no service worker);
- `entry/web.tsx` is the web boot (styles, `webPlatform`, service worker) and
  `main.tsx` is its thin entry, so `apps/web/dist` is unchanged.

`apps/web` gains an `exports` map (`"."` → `entry/desktop.tsx`, plus the leaf
`"./notifications"`, `"./platform/folders"` and `"./platform/rescue"`) so the
desktop renderer can import what it needs without pulling the whole app into
Node tests. The boundaries rule gains
`@extrudo/desktop → @extrudo/web, @extrudo/storage, @extrudo/core`.

**The renderer keeps the web app's security posture.** `contextIsolation:
true`, `sandbox: true`, `nodeIntegration: false`; no `remote`. The CSP, COOP,
COEP, `nosniff`, `Referrer-Policy` and `Permissions-Policy` from
`apps/web/public/_headers`'s `/*` block ride on **every `app://` Response**
(`protocol.ts`'s `HEADERS`, compared with the file by a test so they can't
drift), with `session.defaultSession.webRequest.onHeadersReceived` kept as
belt and braces. There is no top-level navigation off `app://` (or the dev
origin), no new window and no webview (`will-navigate`,
`setWindowOpenHandler`, `will-attach-webview`), and every permission request
is denied; the renderer parses untrusted content, so it must not be able to
turn the window into a browser that loads another origin with this app's
preload attached. Every privileged thing goes through a **typed preload
bridge** (`contextBridge.exposeInMainWorld('extrudo', …)`) whose channels and
method names live in **one `src/shared/ipc.ts`** shared by main and preload;
the renderer never calls `ipcRenderer` directly. A store or folder error
crosses the bridge as data (`{ error: { name, message, … } }`,
`shared/errors.ts`) and the renderer rebuilds the class
(`renderer/errors.ts`), so `describeError`'s wording survives.

The renderer is served from the packaged `dist` over a **custom `app://`
protocol** (`protocol.handle`, a privileged standard scheme) with the right
MIME for `.wasm`, not `file://` (relative module-worker and WASM fetches need
a real origin). The service worker is **not** registered on desktop:
`platform/serviceWorker.ts`'s production check is made explicit (`bootDesktop`
never calls `registerServiceWorker`).

### 2. The Node-fs `ProjectStore` in `packages/storage`

A new Node-only entry `@extrudo/storage/node` (so the browser bundle never
pulls in `node:fs`):

- `nodeIndex(path)` implements `ProjectIndex` over `<dir>/index.json`, written
  **atomically** (write a temp file, then rename over the index);
- `nodeFiles(dir)` implements `FileStore` over `<dir>/projects/<id>/…` with
  the same layout OPFS has (document, thumbnail, versions, attachments);
- `nodeLock()` is a per-process async mutex (the existing `localLock`); one
  app instance owns the directory (a second is refused by
  `app.requestSingleInstanceLock()` and focuses the first);
- `createNodeProjectStore(dir, options)` combines them with the existing
  `createProjectStore`.

The directory is Electron's `app.getPath('userData')/projects`. There is **no
shared parametrised suite**: the Node store gets its own dedicated suite
(`packages/storage/src/node/node-project-store.test.ts`) over a real temp
directory — the store's methods (save/load/list/delete, versions, attachments,
thumbnails, export/import), an interrupted atomic index write and the shared
lock — and the browser suite is unchanged. Every id that reaches a path is
validated at the store boundary (`assertId`, `/^[A-Za-z0-9_-]{1,64}$/`), so a
document id from a hostile `.extrudo` cannot write outside the store.

### 3. `desktopPlatform()` through the bridge

`apps/desktop/src/renderer/platform.ts` implements `Platform` through the
preload bridge, with the privileged work in the main process:

- **preferences**: a JSON file under `userData`, read once through `invoke` at
  boot (the theme is applied when the read resolves) and written debounced;
- **projects**: the Node store lives in **main**; the renderer talks to it
  through an IPC proxy implementing `ProjectStore` method by method, with
  bytes as `Uint8Array` across `invoke` and Blobs rebuilt in the renderer.
  The proxy is written once, generically, and tested with a fake bridge, so
  the tests need no Electron;
- **storage**: persistent (always granted). The brief's "quota is the disk's
  free space via `fs.statfs`" was **dropped as a decision**: `StorageAccess`
  has no quota method and the home screen shows no quota, so there is nothing
  to answer; recorded here rather than left silent.
- **files**: native `dialog.showOpenDialog` / `showSaveDialog`; a download
  becomes a save dialog, and a failed write is a toast;
- **rescue**: a JSON file under `userData`, written **synchronously** on
  `pagehide`; `rescue.put` and `rescue.list` are the **only** synchronous
  calls (`ipcRenderer.sendSync`), the one place blocking IPC is right;
- **folders**: ADR-0065 §3's linked folders over the real file system (picked
  by dialog, listed/read/written by main, permission always granted, only
  `.extrudo` names accepted);
- **no `openInSlicer`** yet — P6-02.

### 4. Running it

`pnpm --filter @extrudo/desktop dev` starts electron-vite with the renderer
served by Vite (HMR); `pnpm --filter @extrudo/desktop build` writes the
packaged renderer, main and preload under `apps/desktop/out` (installers are
a later slice). The root `pnpm check` runs the new package's typecheck and
unit tests; CI does not download Electron — the store, the proxy and the
platform are tested in Node with a fake bridge.

### 5. The smoke script

`apps/desktop/scripts/smoke.mjs` spawns the built app **asynchronously** under
`xvfb-run` with `--remote-debugging-port`, connects over CDP, opens a new
design from the home screen ("New design"), waits for the kernel worker's first
recompute (`data-model-status="ready"`) and for the autosave's "Saved" status,
then quits and prints what it saw. It says which prerequisite is missing
(the build, a display/`xvfb-run`, Electron's binary, Playwright) when it can't
launch. It is documented as needing a display.

## Rejected

- **Tauri** — already rejected in ADR-0006 (WebKitGTK's weaker WebGL/WASM).
- **A forked desktop UI** — a second copy of every component diverges. The
  entry split keeps one UI.
- **`nodeIntegration: true` / the renderer reading `node:fs` directly** — the
  renderer is where untrusted content (a `.scad`, a script, a font) is parsed;
  it must not hold the file system. All privilege goes through `ipc.ts`.
- **Loading the renderer from `file://`** — WASM `fetch` and module workers
  need a real origin; `app://` gives one while staying local.
- **Keeping the store in the renderer over OPFS** — it works but gives no real
  files, no linked folder, no backup. The point of the desktop build is the
  file system.
- **`remote` / `@electron/remote`** — deprecated and unsafe; the typed bridge
  replaces it.
- **electron-builder now** — packaging, signing and auto-update are their own
  slices; slice 1 must build, not ship.

## Plan (the slices)

1. **Shell, store, platform** (this): `apps/desktop` on electron-vite; the
   `app://` protocol, CSP and typed bridge; `@extrudo/storage/node`; the IPC
   store proxy; `desktopPlatform`; the web entry split; the smoke script.
2. **Native menus from the command registry**: `buildCommands` drives the
   application menu and its accelerators (ADR-0023).
3. **`.extrudo` file association and recent files**: `open-file` events, a
   second-instance argument, `app.addRecentDocument`.
4. **Auto-update**: `electron-updater` against the release channel.
5. **Packaging**: `electron-builder` for AppImage/deb, Windows and macOS,
   with signing (and the slicer hand-off, P6-02, beside it).

## Consequences

- One UI, two builds: a web change reaches the desktop by rebuilding, and the
  platform interfaces stay the single seam.
- The desktop app needs the WASM bundled into `out/renderer` (electron-vite's
  renderer build does that with the same `?url` imports the web build uses).
- No offline service worker, no install prompt, no browser storage limits: the
  files live where the person put them.
- Every privileged call is one line in `ipc.ts`, so the attack surface is that
  file and the handlers behind it.
- Tests stay Electron-free: the Node store, the IPC proxy and the platform are
  pure and mocked, so CI installs no Electron binary.

## Results

- **Unit tests.** `apps/desktop` 5 files / 21 tests pass (the bridge's channels,
  the store proxy's marshalling, `desktopPlatform`'s adapters, the `app://` MIME
  map, the debounced preferences file). `packages/storage/src/node/node-project-store.test.ts`
  adds 7 passing tests over a real temp directory (save/load/list/delete,
  versions, attachments, thumbnails, export/import, an interrupted atomic index
  write, and a shared lock serialising two stores).
- **`pnpm check`** (2026-10-07): `Test Files 301 passed | 5 skipped (306)`,
  `Tests 3770 passed | 9 skipped (3779)`; `Package boundaries OK (13 packages)`;
  `License check: 172 production packages, all on the allow-list.` The desktop
  package typechecks, lints and tests with no Electron binary.
- **Builds.** `pnpm --filter @extrudo/desktop build` writes
  `out/main/index.cjs`, `out/preload/index.cjs` and `out/renderer/` (the web
  app rebuilt from `apps/web/src`); `pnpm build` (web + site) passes.
- **Smoke run: not run in this environment.** The machine is headless with
  **no `xvfb-run`** (`command -v xvfb-run` finds nothing, checked 2026-10-07)
  and `electron`'s binary is deliberately not downloaded
  (`pnpm-workspace.yaml`'s `allowBuilds: electron: false`), so
  `apps/desktop/scripts/smoke.mjs` cannot launch a window here. It is written
  to take a display and the binary, and to say which is missing otherwise. The
  store, the bridge, the proxy and the platform are proven in Node instead, and
  the web app's own hosting/PWA e2e specs were re-run against the unchanged
  web build.
- **What to check by hand on a machine with a display:** run
  `pnpm --filter @extrudo/desktop dev`, then the smoke script: the home screen
  lists projects from `userData/projects`, a new design reaches
  `data-model-status="ready"`, save/reopen works, an export opens the native
  save dialog, and linking a folder opens the native folder dialog.
- **Review fixes (2026-10-07).** A review of `ad2bd38` found two HIGH holes and
  a set of lower items; all were closed. **Path traversal:** every id that
  becomes a path is validated (`StorageError`, `assertId` in
  `project-store.ts`; the Node `full()` refuses `..`/absolute/separator/NUL
  segments and anything resolving outside `root`; `purge` of an unknown id
  throws `ProjectNotFoundError` without touching disk), covered by
  `node-project-store.test.ts`'s traversal tests. **Navigation:** `will-navigate`
  allows only `app://` and the dev origin, new windows are denied, webviews are
  refused and every permission request is denied (`navigation.ts`,
  `navigation.test.ts`). The CSP/COOP/COEP/`nosniff`/`Referrer-Policy`/
  `Permissions-Policy` now ride on every `app://` `Response` (`headers.ts`,
  checked equal to `_headers` by `headers.test.ts`; `decodeURIComponent`
  failures 404). Store and folder errors cross `invoke` as data and are rebuilt
  (`shared/errors.ts`, `renderer/errors.ts`, `store-call.test.ts`,
  `proxy.test.ts`). The index queue now holds the read-modify-write, the
  atomic writers `fsync` and clean up a failed rename, preferences are read
  through `invoke` (only rescue is synchronous), `folder:read`/`write` accept
  `.extrudo` names only, a failed download is a toast, `RescueFile.flush` is
  gone, and the store-call/folders/rescue comments have their real tests
  (`store-call.test.ts`, `folders.test.ts`, `rescue.test.ts`). The smoke script
  was rewritten to the flow above; **it still cannot be run here** (headless,
  no `xvfb-run`, no Electron binary).

## Amendment: slice 2 — native menus, the `.extrudo` association and recent files (2026-10-07)

Slice 2 makes the desktop build a real application, not a window on the web
UI: the application menu is the command registry, a `.extrudo` opens the app,
and the recent-files list is the OS's.

**The menus are a projection of `buildCommands`, not a second list.** The pure
`menuModel(commands, mode, { mac })` (`apps/web/src/shell/menuModel.ts`)
groups the same commands the palette uses into File, Edit, View (Panels and
Theme folded in), one menu per visible tab (Solid/Sketch, Insert, 3D Print),
the macOS Window menu and Help; a command with `unavailable` is a disabled
item. `toAccelerator` turns a `keymap.ts` key string into Electron's grammar
(`Mod+K` → `CmdOrCtrl+K`), and every item that has one sets it with
**`registerAccelerator: false`** so the web's own keydown handler still runs
the command and nothing double-fires. The shell sends the model over
`menu:set` (debounced in the renderer adapter) whenever the mode or the
availability changes, and `menu:reset` (a project page unmounting) returns to
a bare desktop menu. Main's `menuTemplate.ts` builds `Menu.buildFromTemplate`
with a mocked click for the tests; `index.ts` sets it. A clicked item sends
`menu:run` with the command id, and the shell runs it through the same
`command.run()` the palette uses.

**The desktop-only File entries live in main, not the model.** `Open…` opens
the native dialog and reads the file; `Open Recent` is main's list; `Save As…`
and `Quit` send `desktop:saveAs`/`desktop:quit` to the renderer (only it holds
the document). `Quit` runs `saveEverything()` first and only then confirms, the
way the update toast's Reload does (ADR-0054). The web File menu is unchanged.

**The association, argv and recent all come down one path.** `main/openPaths.ts`
holds a queue: a macOS `open-file`, a `second-instance` argv or the first
launch's argv is a path; it waits there until the renderer sends `app:ready`
(the renderer registers its handler in `bootDesktop`'s new `onPlatform` hook
before mounting). Main reads the bytes and sends `file:open-path`; the renderer
imports them (`openExternalFile` in `project/actions.ts`), **links the project
to that path** as a linked-folder file is (ADR-0065 §3) and opens it. A path
that can't be read is dropped from the recent list.

**Recent files are main's** (`main/recent.ts`, `userData/recent.json`, at most
10, deduplicated, missing files dropped when listed) and are also given to the
OS through `app.addRecentDocument`. `menu:set` carries the list so the Open
Recent submenu is built with the menu; `recent:list`/`recent:clear` and a
`recent:changed` event keep the renderer's copy fresh, and `recent:list` is
what `apps/web/src/platform/types`' `RecentEntry` names.

**Decisions the brief left open** (recorded rather than silent):

- **`Open…` is main-side.** The brief lists it with `importFile`; main has the
  store, so it picks and reads the file and lets the renderer import the bytes
  (which is also what the association does). The model's own "Import .extrudo…"
  command is untouched.
- **A new `file:save-as` channel.** "Save As…" needs the chosen path, which the
  existing `file:download` (fire-and-forget) has no way to return;
  `DialogFiles.saveAs` writes and answers `{ path, modified }`, and main records
  it in the recent list. `Platform.files.saveAs` is optional, so the browser
  File menu is unchanged.
- **`app:ready` and `menu:reset`.** Deliver-before-listening would silently
  lose an association open and a stale project menu on the home screen; both
  are closed with one message each rather than a timing guess.
- **`electron-builder.yml` is data only** (app id `org.extrudo.desktop`,
  product name "Extrudo", the `.extrudo` `fileAssociations`, the web icons).
  The build scripts, per-platform targets, signing and auto-update are slice 5.

**No web, kernel, schema or file-format change.** `Platform.menus` and
`FileAccess.saveAs` are optional; `apps/web/dist` behaves exactly as before,
which is why the hosting and PWA e2e specs need no change.

### Amendment Results

- **Unit tests** (2026-10-07): `apps/desktop` runs with the bridge, the platform,
  the recent store, the open queue, the menu template and the menu adapter
  mocked (no Electron binary); `apps/web` gains `menuModel.test.ts`, which walks
  the real keymap and checks every accelerator against Electron's grammar. The
  focused run: `Test Files 15 passed (15)`, `Tests 58 passed (58)`.
- **`pnpm check`** (2026-10-07): `Test Files 312 passed | 5 skipped (317)`,
  `Tests 3816 passed | 9 skipped (3825)`; `Package boundaries OK (13 packages)`;
  `License check: 172 production packages, all on the allow-list.`
- **Builds**: `pnpm build` (web + site) and
  `pnpm --filter @extrudo/desktop build` both write their output
  (`out/main/index.cjs`, `out/preload/index.cjs`, `out/renderer/`).
- **The web is unchanged**: `e2e/hosting.spec.ts` and `e2e/pwa.spec.ts` against
  the fresh build — `13 passed (37.7s)`.
- **CI**: run `37568089309` on `f392e8c` and `37569618109` on the merge head
  `8c1af34` both completed success.
- **What to check by hand on a machine with a display:** run
  `pnpm --filter @extrudo/desktop dev`; the application menu's accelerators
  (shown, but the web's own keys still run), File › Open… and Open Recent, File ›
  Save As… linking the project, and opening a `.extrudo` by double-click (the OS
  registration is slice 5). `SMOKE_OPEN=<file.extrudo> xvfb-run -a node
  apps/desktop/scripts/smoke.mjs` exercises the association path.

### Amendment review fixes (2026-10-07, slice 2)

A review of `5b0c2cf` found a set of defects; all were closed on `p6-01-s2`.

**The channel list, complete.** `shared/ipc.ts` is still the one contract. The
menu/association/recent channels are `menu:set` (the model only), `menu:run`,
`menu:reset`, **`menu:listening`** (the shell's `onRun` handler is live, so
main knows Save As…/Quit's behaviour), `file:open-path` (main→renderer, with an
`error` for a refused file), `recent:list`/`recent:clear`/**`recent:remove`**/
`recent:changed`, `app:ready`, `app:quit`, and the external-file write-back
**`file:write-path`**, **`file:stat-path`** and **`file:read-path`**. The
`desktop:saveAs`/`desktop:quit` ids are defined once in
`@extrudo/web/menu-model` and imported by main and the shell.

**Open Recent is main's, never the renderer's.** `menu:set` carries no recent
list; `applyMenu` builds the submenu from `recent.list()`. A compromised
renderer can no longer name an arbitrary path for main to `readFile`.

**The model is validated and roles whitelisted.** `shared/menuModel.ts`'s
`isMenuModel` checks the depth-2 shape (string labels/ids, boolean `enabled`,
accelerators in Electron's grammar) in main before `Menu.buildFromTemplate`,
and a malformed model is ignored with one `console.warn` rather than thrown
from `ipcMain.on`. `menuTemplate.ts` accepts `role` only from
`minimize`/`zoom`/`front`; anything else (`quit`, `toggleDevTools`) becomes a
plain disabled label, and every model-derived item sets
`registerAccelerator: false` so an allowed role's default accelerator never
registers. The three desktop File entries — Open… (`CmdOrCtrl+O`), Save As…
(`CmdOrCtrl+Shift+S`) and Quit (`CmdOrCtrl+Q`) — are the only accelerators
registered; every other accelerator is shown and left to the web's keydown
handling. On macOS the app menu is built item by item (About, Services, Hide,
Hide Others, Unhide, Quit) rather than `role: 'appMenu'`, whose raw Quit would
bypass `saveEverything()`; File has no second Quit there, and Cmd+Q routes
through the same save-then-quit handler.

**External-file links.** A project opened from a path (Open…, the association,
Open Recent) or Save-As'd is linked with `LinkedFile.external: true` and
`file` an absolute path — the project index only, no document or file-format
change. Main records every path it issued this session (`deliverOpen`,
`savedFile`) and `file:write-path`/`file:stat-path`/`file:read-path` refuse any
other with a `StorageError`, so a compromised renderer still reads and writes
nothing it wasn't handed. `linkedFolder.ts` dispatches an `external` link to
`Platform.externalFiles` (`write`/`stat`/`read`) with the same conflict rule,
throttle and Load-from-disk/Overwrite toast as a linked folder; the web has no
`externalFiles`, so an external link there reads as "not in the linked folder".
A second open of the same path navigates to the linked project rather than
importing a copy, and Save As… replaces the link and names the chosen basename.

**The other findings.** `desktopMenus.reset()` cancels the debounce and drops
the model; the shell sets on change and resets only on unmount (no flash of the
bare menu). `second-instance` pushes its path before the window check;
`open-file` and argv accept `.extrudo` names only, and `deliverOpen` stats the
file first and refuses anything over 100 MB with a message. Clear Recent calls
`app.clearRecentDocuments()`; a failed import drops its path (`recent:remove`);
`file:save-as` is wrapped in `guarded`; `recent.ts`'s writer `fsync`s and cleans
up a failed rename like slice 1's writers.

**Tests.** `isMenuModel`/`isElectronAccelerator`, the role whitelist,
`registerAccelerator`, Save As…'s enabled state and the macOS app menu
(`menuTemplate.test.ts`, `shared/menuModel.test.ts`); `createExternalFiles`'s
guard and read/write/stat (`externalFiles.test.ts`); the bridge's new channels
(`bridge.test.ts`); `openExternalFile` import/link/reuse and the external
write-back with its conflict rule (`actions.test.ts`, `linkedFolder.test.ts`);
`isExtrudoPath` (`openPaths.test.ts`).

