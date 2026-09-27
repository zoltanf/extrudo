# ADR-0009: Project storage, autosave and the home screen

- **Status:** Accepted, 2026-09-25
- **Task:** P0-08 (project storage). Code: `packages/storage/`,
  `apps/web/src/platform/`, `apps/web/src/project/`, `apps/web/src/home/`.
- **Affects:** P2-14 (version history), P3-12 (templates), Phase 6
  (desktop storage over the file system), every E2E test (they now open a
  stored project).

## Context

FR-PRJ-01, -02, -04 and -05 ask for a home screen (thumbnail, name,
modified date; new, open, rename, duplicate, delete to a trash), local
storage in OPFS + IndexedDB behind an interface the desktop app can
implement too, `.extrudo` export and import, and a persistent-storage
request with a warning when it's denied. FR-PRJ-03's autosave with a visible
save state is part of the task; its version history is P2-14. The
architecture sketched the `ProjectStore` interface (§6.1) and the `.extrudo`
zip (§6.2).

## Decision

1. **`packages/storage` holds the interface and the implementations**
   (depends on core only; `fflate` for zip). A project is identified by its
   document's ID. `ProjectStore`: `list`, `get`, `load` (through core's
   migrations and validation), `save` (stamps `meta.modified` and
   `meta.appVersion` on the stored copy, never on the caller's document),
   `rename`, `duplicate` ("<name> copy", new ID, thumbnail kept), `trash` /
   `restore` / `purge`, `thumbnail` / `setThumbnail`, `exportFile`,
   `importFile`. Version methods wait for P2-14.
2. **Two small seams under it:** a `ProjectIndex` (summaries for the home
   screen) and a `FileStore` (bytes under paths). `createProjectStore({ index,
   files })` combines them; each has an in-memory version for tests and Node.
   Layout: `projects/<id>/document.json` and `projects/<id>/thumbnail.png`.
   A save writes the document before the index entry; a purge deletes the
   index entry before the files. A crash can leave an orphaned folder, but
   never a listed project without a document.
3. **Browser:** one IndexedDB database `extrudo` with object stores
   `projects` (the index) and `files`. Documents and thumbnails go to OPFS
   when `FileSystemFileHandle.createWritable` exists (it writes a swap file
   and replaces the original on `close()`, so writes are atomic), otherwise
   to the IndexedDB `files` store. `openDatabase` repairs a database that
   exists without its stores by upgrading it one version.
4. **`.extrudo` files** are zips of `manifest.json` (`format`,
   `formatVersion`, `appVersion`, `created`, `units`), `document.json` and an
   optional `thumbnail.png` (stored, not deflated). Reading checks the
   manifest, then loads the document through core's migrations. Errors are
   plain sentences (`ArchiveError`: not a zip, not an Extrudo file, damaged;
   core's `DocumentLoadError` for invalid or too-new documents). Importing a
   project that already exists makes a copy with a new ID rather than
   overwriting it.
5. **Platform interfaces** (`apps/web/src/platform/`): `projects`
   (`ProjectStore`), `storage` (persisted / request persistence), `files`
   (download, pick). `webPlatform()` is async (IndexedDB opens
   asynchronously); `main.tsx` applies the theme first, then renders once the
   platform is ready, or a plain error page if the browser blocks storage.
6. **Autosave** (`project/autosave.ts`): a vanilla store with `saved`,
   `unsaved`, `saving` and `error`. It saves 800 ms after the last document
   change (undo and redo included), saves again right away if the document
   changed during a save, keeps `error` with a plain message until a later
   save succeeds, and has `flush()` / `retry()`. The project page flushes
   when the tab is hidden, on `pagehide` and when it closes (and keeps a
   rescue copy first, see the amendment below);
   `allSaved()` lets the home screen wait for that last save before it lists
   projects. The app bar shows the state as a word plus a dot; "Couldn't
   save" is a retry button.
7. **Thumbnails** come from the viewport: it registers a `snapshot()` in the
   viewport store that renders a frame and crops it to a 256 px square PNG.
   The background is transparent; the home card draws the viewport glow
   behind it, so a thumbnail suits both themes. A new project gets one once
   its viewport has drawn, and each autosave refreshes it.
8. **Routes:** `#/` home, `#/p/<id>` a project, `#/debug/kernel`; anything
   else goes home. The sample document became the "Wall bracket" template on
   the home screen's Start row (the gallery grows with P3-12).
9. **The home screen** (`home/`): New design and template cards, the
   project grid (thumbnail over the glow, name, "Edited 5 minutes ago", a
   menu with open, rename, duplicate, export, move to trash), search, sort by
   last edited or name, Import, and a trash view with restore and "Delete
   forever" behind a confirmation. The whole card is the open link (a
   stretched link), so there's one link per project for screen readers.
10. **Persistent storage** (FR-PRJ-05) is requested when the home screen
    opens and when a project is created. The header shows "Stored on this
    device" or a warning, "Storage may be cleared", with a tooltip that says
    what that means and suggests exporting.

## Rejected options

- **Everything in IndexedDB:** simpler, but OPFS is what the architecture
  chose for documents: file semantics, atomic replace, and the same shape
  as the desktop folder layout. IndexedDB stays as the fallback.
- **An index file in OPFS instead of IndexedDB:** listing would read and
  rewrite one JSON file on every save, with no transactions.
- **Overwriting on import when the ID exists:** it silently loses the local
  project; a copy is safe and the user can delete one.
- **Validating the document on every save:** commands keep it valid, and
  `load` validates anyway; a schema pass per autosave buys little.
- **Saving on every change without a delay:** a drag of the timeline marker
  would write dozens of files a second.
- **`localStorage` for projects:** 5 MB, synchronous, strings only.

## Consequences

- **Two tabs on the same project:** the last save wins. A BroadcastChannel
  lock or a "changed elsewhere" notice can come later.
- **Orphaned folders** after a crash mid-purge are not cleaned up yet.
- **E2E tests** open a project through the home screen (`e2e/helpers.ts`);
  each test's browser context starts with empty storage.
- **Screenshot baselines:** `--update-snapshots` only rewrites shots that
  fail, and a small text change (the save state) stays inside the 0.1 %
  tolerance. Use `--update-snapshots=all` after a visible change.
- **P2-14** adds `save(doc, { asVersion })`, `versions` and `loadVersion`
  (gzipped copies under `projects/<id>/versions/`), and wires Ctrl+S.
- **Desktop (Phase 6)** implements `ProjectStore` over plain `.extrudo`
  files in a folder through Electron IPC.

## Amendment (2026-09-27): rescue copies

An edit made less than 800 ms before a reload, or while a save was still
writing, was lost: the flush on `pagehide` starts an asynchronous IndexedDB
and OPFS write that the unloading page never finishes (found by P1-15's
benchmark test, which reloaded right after an edit).

- A new platform interface, `Platform.rescue` (`platform/rescue.ts`), keeps
  a copy of a document **synchronously**: localStorage on the web
  (`extrudo.rescue.<id>`), a plain file write on the desktop later.
- The project page writes the copy when the tab is hidden, on `pagehide`
  and when the page closes, only if the autosaver isn't `saved`, then
  flushes as before. Every save that leaves nothing unsaved clears it.
- `webPlatform()` runs `recoverRescued` before the app renders: each copy
  left behind goes through core's `loadDocument` (migrations, validation)
  and is saved as its project, then dropped. A copy that isn't a document
  is dropped; one that fails to save is kept for the next start. The copy
  always wins over the stored project: it was taken from the open document
  when the page went away, after anything that page could have saved.
- Rejected: a `beforeunload` "Leave site?" prompt while unsaved (a prompt
  for every quick reload); making the
  save itself synchronous (IndexedDB and OPFS have no synchronous API on
  the main thread). localStorage's 5 MB limit applies to one copy per
  unsaved project, not to projects; a document too big for it is reported
  by `put` returning false and falls back to the old behaviour.
- Test: `e2e/storage.spec.ts` "an edit made just before a reload is kept"
  (fails without the recovery).
