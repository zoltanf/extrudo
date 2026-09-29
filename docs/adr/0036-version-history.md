# ADR-0036: Version history

- **Status:** Accepted, 2026-09-29
- **Task:** P2-14 (version history; FR-PRJ-03). Code: `VersionSummary`,
  `ProjectStore.saveVersion` / `versions` / `loadVersion`
  (`packages/storage/src/types.ts`, `project-store.ts`), the on-disk
  layout (`packages/storage/src/versions.ts`), versions in `.extrudo`
  files (`archive.ts`); core's `restoreVersion` command
  (`packages/core/src/document-commands.ts`); the app's
  `apps/web/src/project/versions.ts` (`saveVersion`, `restoreVersion`,
  `openVersionCopy`) and `VersionsDialog.tsx`, opened by Ctrl+S
  (`saveVersion` in `commands/keymap.ts`), File › Save version… and
  Version history…, the history button beside the project name, and the
  command palette.
- **Builds on:** ADR-0003 (commands and undo), ADR-0009 (project storage,
  autosave; its plan for P2-14: gzipped copies under
  `projects/<id>/versions/`, Ctrl+S).
- **Affects:** P2-16 (the file-format spec documents `versions/`), the
  desktop build (Phase 6: the same layout on disk), P3-16 (notification
  history), later cloud sync.

## Context

FR-PRJ-03: autosave with a visible save state (done in P0-08), plus an
explicit "Save version" with a description that keeps a history like
Fusion's, and restoring any version. Autosave already writes the working
document shortly after every change, so a version isn't about not losing
work; it is a named state to come back to. The undo history lives only
while the page is open.

## Decision

1. **Storage keeps versions next to the document**:
   `projects/<id>/versions/<n>.json.gz` (the document as it was, gzipped
   with fflate, which storage already uses for zips) and
   `projects/<id>/versions/index.json` (`{ versions: VersionSummary[] }`,
   oldest first: number, description, ISO time, the design's name then).
   The version file is written before the index, so the index never
   lists a version that wasn't written; a damaged index or version file
   is an `ArchiveError('damaged')` with a plain message. Purge removes
   the folder, versions and all. No IndexedDB change: the home screen's
   index doesn't need versions.
2. **`saveVersion(doc, description)` saves the document and the version
   in one call**, the version a copy of exactly what `save` stored
   (stamps included), numbered after the highest so far (V1, V2, …;
   numbers are never reused). The app waits for autosave to finish
   first, so the two never write at once. `loadVersion(id, n)` goes
   through core's migrations and validation like `load`, and returns the
   document with the project's ID.
3. **`.extrudo` files carry the versions** (`versions/index.json` and
   `versions/<n>.json`, plain JSON inside the zip), so export and import
   move a whole project (FR-PRJ-04). Files without them still load.
   Importing into a copy keeps the versions under the copy's ID.
   Duplicate doesn't copy them (a duplicate starts its own history).
4. **Restoring is a document command**, `restoreVersion({ doc })`: it
   brings back settings, parameters, features, the timeline marker,
   bodies and views, and keeps the document's ID, name and dates, as one
   undo step ("Restore version"). Before it runs, what the design holds
   now is saved as a version ("Before restoring V2") unless the newest
   version already holds exactly that, so a restore never loses work even
   after the page is closed. The app ends an open sketch, Create Sketch's
   plane pick and any feature dialog first, so the step doesn't join a
   transaction.
5. **"Open copy" opens a version as a separate design** ("Bracket V1",
   new ID, created now) and navigates to it; the open design is left
   alone. That is how to look at an old version without changing
   anything.
6. **One dialog, "Versions"** (design system `Dialog`, new `medium`
   size): a Description field with Save version on top (Ctrl+S opens it
   there; Enter saves and closes, a toast says "Saved V3."), then the
   saved versions newest first with the description (or "No
   description"), when (relative, the exact time in the tooltip) and the
   name if it has changed since, and Open copy and Restore per row. The
   File menu's Save version… (now enabled) and Version history…, the
   history icon beside the project name and the palette's Save Version…
   and Version History… all open it.

## Consequences

- Versions cost a gzipped document each (a few KB for the Wall
  bracket); nothing prunes them yet. A delete-version action and limits
  can come when projects get big (attachments, P4).
- No thumbnails per version yet, and no preview of a version's model
  inside the open design (open a copy instead).
- Two tabs on one project: the index is read and rewritten per save, so
  two tabs saving versions at the same moment could lose one index entry
  (the version file stays). Same last-write-wins caveat as ADR-0009.
- Ctrl+S in a text field still reaches the browser (shortcuts skip
  fields); outside fields it never opens the browser's Save Page.

## Rejected

- **`save(doc, { asVersion })`** as ADR-0009 sketched: the caller needs
  the version's number back, and a separate method says what it does.
- **Restoring by replacing the store's document**
  (`DocumentStore.replaceDocument`): it clears the undo history. A
  command keeps Undo working, and the kept version covers the rest.
- **Restoring the version's name too**: renaming is its own command;
  the project keeps the name it has now (the list shows the old name).
- **Versions in the IndexedDB index**: the desktop build keeps projects
  as files, and a folder per project already holds everything else.
- **Asking for confirmation before Restore**: it is undoable and keeps
  what was there as a version; a dialog would only slow it down.
