# ADR-0065: Timeline groups and linked folders

- **Status:** Implemented, 2026-10-04 (both slices, see Results)
- **Task:** P4-09 (FR-TL-06 "Group features"; FR-PRJ-06 "Optionally link a real
  folder on disk (File System Access API, Chromium only)").
- **Builds on:** ADR-0003 (commands, undo), ADR-0009 (storage, platform,
  autosave, home screen), ADR-0021 (timeline and browser menus), ADR-0033
  (timeline v2: `moveFeature`, the marker), ADR-0036 (versions), ADR-0041
  (toasts and their actions), ADR-0050 (lenient loading), ADR-0061
  (attachments in `.extrudo` files).

## Context

Long timelines need folding: Fusion groups neighbouring features into one chip
that opens and closes. Separately, people who keep their designs in a synced
folder (git, Dropbox, a NAS) want Extrudo to read and write `.extrudo` files
there, not only in the browser's private storage. Chromium's File System Access
API gives a directory handle that can be stored in IndexedDB and re-permitted
after a reload with a user gesture; Firefox and Safari don't have it.

## Decision

### 1. Groups are ranges of the timeline, stored in the document

```ts
doc.groups?: Array<{
  id: GroupId;
  name: string;          // 1..100 chars
  first: FeatureId;      // the group runs from first to last, inclusive,
  last: FeatureId;       // in timeline order
  collapsed: boolean;
}>
```

- A group is a **contiguous range** given by its ends, so it stays contiguous
  whatever moves: a feature moved between `first` and `last` joins the group;
  moving or deleting an end moves that end to the next feature inside; a group
  left with no features is dropped. One pure function `normalizeGroups(doc)` in
  core applies these rules, and every command that reorders or removes features
  (`moveFeature`, `removeFeature`, Remove-feature deletion, `restoreVersion`)
  ends with it. Groups don't nest and don't overlap (document-level check, path to
  the group).
- Commands (`packages/core/src/groups.ts`, one undo step each):
  `groupFeatures({ id, name, features })` (refused unless the features are
  neighbours in the timeline and none is already grouped: "Group features that
  sit next to each other." / "… is already in a group."), `ungroup({ id })`,
  `renameGroup({ id, name })`, `setGroupCollapsed({ id, collapsed })` (stored and
  undoable like a feature's visibility), and `groupSuppressed({ id, suppressed })`
  / `groupVisibility` as one undo step over the members through the existing
  per-feature commands' logic.
- Default name "Group<n>", never reused, like bodies.
- Nothing else reads groups: the engine, naming and recompute ignore them.

### 2. The timeline

- Chips: Shift-click selects a range of chips (if the timeline has no multi-select
  yet, add it: click selects one, Shift-click extends, Esc clears; selection is
  session state). The chip menu (and the marking menu's list) gets **Group** for
  a selected range, and a group's own menu has Rename (F2), Ungroup, Suppress /
  Unsuppress, Show / Hide, Expand / Collapse.
- A **collapsed** group draws as one chip (a folder glyph, its name, the member
  count, the worst member status: error > warning > ok); double-click or its arrow
  expands it. An **expanded** group draws its member chips on a tinted band with
  the name as a small label and a collapse arrow.
- The marker can't stop inside a collapsed group: dragging or stepping it moves
  past the whole group; rolling back into a group (Roll Back to Here on a member,
  or undoing to that state) expands it. Chip drag moves single features as now
  (the group adapts by §1); dragging a collapsed group's chip moves all its members
  together (one `moveFeature` per member in one transaction, refused as a whole if
  any single move is).
- Hover and selection highlight every member's geometry for a group chip.

### 3. Linked folders (Chromium only)

- Platform (`apps/web/src/platform/`): an optional `folders?: LinkedFolders`
  interface, present only where `window.showDirectoryPicker` exists:
  `link(): Promise<FolderLink | undefined>` (the picker), `current():
  Promise<FolderLink | undefined>` (the stored handle, from IndexedDB),
  `unlink()`, and on a `FolderLink`: `name`, `permission(): Promise<'granted' |
  'prompt' | 'denied'>`, `request(): Promise<boolean>` (needs a click),
  `list(): Promise<{ name: string; modified: number; size: number }[]>` (the
  `.extrudo` files at the top level), `read(name): Promise<{ bytes; modified }>`,
  `write(name, bytes): Promise<{ modified }>`. One folder at a time.
- Home screen: a "Linked folder" section under the projects: "Link a folder…"
  (when none), else the folder's name, its `.extrudo` files as cards (name, date),
  "Reconnect" while permission is `prompt`, and "Unlink". Opening a file imports it
  as a project (through `ProjectStore.importFile`, attachments included) **linked
  to that file**: the project index entry records `linked: { file: name, modified
  }` (storage index, not the document: the link is about this browser, not the
  design).
- Writing back: after each successful autosave of a linked project, the archive
  (`writeArchive`, with versions and attachments as an export makes it) is written
  to the file, at most once every 10 s (trailing), and when the project closes.
  Before writing, the file's `modified` is compared with the recorded one: if the
  file changed on disk, nothing is written and a toast says "<name> changed on
  disk." with "Load from disk" (replaces the project's document with the file's,
  one undo step through `restoreVersion`'s path, keeping the current state as a
  version first) and "Overwrite". `available()` on both says whether they still
  apply (ADR-0041).
- A project that isn't linked gets the command "Save to Linked Folder" (File menu,
  Ctrl+K; present only with a linked folder): writes `<project name>.extrudo`
  (refused if the name exists: "A file named … is already there.") and links it.
- Errors (permission lost, file removed) are toasts, never data loss: the browser
  copy is always the primary one.

## Slices

1. Groups: core (schema, `normalizeGroups`, commands, file format), timeline UI,
   menus, marker rules, e2e (`e2e/timeline-groups.spec.ts`).
2. Linked folders: platform interface and web implementation, home section,
   write-back with the conflict toast, "Save to Linked Folder", e2e
   (`e2e/linked-folder.spec.ts`) with `showDirectoryPicker` stubbed by an init
   script that returns an OPFS directory (`navigator.storage.getDirectory()` then
   `getDirectoryHandle('linked', { create: true })`; OPFS handles lack
   `queryPermission`/`requestPermission`, so the stub adds both, answering
   `granted` or a value the test sets).

## Results

### 1. Groups (slice 1, done 2026-10-04)

- **Core.** `GroupId` in `ids.ts`; `GroupSchema` and the optional `doc.groups`
  in `schema.ts`, with the document check on the path of the group (an end that
  is not a feature, `last` before `first`, an overlap; group IDs unique).
  `packages/core/src/groups.ts` holds `normalizeGroups` (pure: it answers "what
  would the groups be" as well as repairing a draft),
  `normalizeGroupsInPlace` for the commands, `groupOf`, `groupMembers`,
  `nextGroupName`, and the six commands of §1, one undo step each.
  `moveFeature`, `moveFeatures`, `removeFeature` and `restoreVersion` end with
  it; `removeFeature` also calls `dropFeatureFromGroups` first, because the rule
  for a deleted end is only exact while the command still knows the index.
- **Tests.** `packages/core/src/groups.test.ts` (17 cases: the schema, every
  command with undo and every refusal, `normalizeGroups`' cases, and a seeded
  property test that runs 40 × 25 random `moveFeature`s over two groups and
  checks the document stays valid and every group contiguous). `docs/file-format.md`
  §4.6, and its document test checks the new keys are all described.
- **The timeline.** `apps/web/src/shell/timelineGroups.ts` is the pure half
  (what the list draws, the gaps the marker may take, the feature index a drop
  lands at, which features a hover lights up) and
  `apps/web/src/shell/groupActions.ts` the commands the menus run. The rules
  that needed a decision:
  - **Counting in features, not chips.** Every drawn chip carries the feature
    indices it stands for (`data-feature-from`/`-to`), and both the marker's gap
    and a drop count those. A folded group is one chip of several features, so
    stepping, dragging and dropping pass it whole without special cases.
  - **The marker opens the group it lands in, as an amend.** The invariant
    "the marker never rests inside a folded group" holds for every route into
    that state — a menu, the keyboard, an undo, a loaded file — because it is
    applied where the document changes (`openGroupAtMarker`, amended into the
    step that moved the marker, so undo takes the opening with it) rather than
    at each call site.
  - **One command for a group's move.** §2 said "one `moveFeature` per member in
    one transaction"; core's `moveFeatures` (P3-17) already does exactly that and
    refuses as a whole, so a group's drag is that one command.
  - **Hover and the single hover slot.** The session holds one hover item, so a
    group chip hovers its first member and the view expands a hovered feature to
    its whole group (`hoveredFeatureIds`): the group's geometry lights up as the
    ADR asks, and hovering one member lights the rest of its group as well.
    Selection is drawn on the chips (a picked group marks its members).
  - **A new group is open, not folded.** Folding is stored (`collapsed`), and
    grouping leaves the band visible so the user sees what it took in.
- **E2E.** `e2e/timeline-groups.spec.ts`: group a picked run, fold and unfold,
  rename (F2) and reload, the marker stepping over a folded group, folding a
  group the marker is inside, suppress/hide/ungroup from the group's menu, a
  group chip dragged with its members, and the marking menu's entry.
- **Name reuse.** `nextGroupName` numbers above every group the document still
  has, so a name is never handed out twice while a group carries it; bodies can
  promise more (ADR-0030) only because `doc.bodies` keeps entries for bodies
  that are gone, and a group `normalizeGroups` drops leaves nothing behind.

### 2. Linked folders (slice 2, done 2026-10-04)

The browser's copy stays primary and the folder mirrors it, as §3's last
bullet requires: permission can lapse at any reload, and nothing the folder
holds is ever the only copy.

- **Platform.** `apps/web/src/platform/folders.ts` has `LinkedFolders`
  (`link()`, `current()`, `unlink()`) and on a `FolderLink` the `name`,
  `permission()`, `request()`, `list()`, `read()` and `write()` of §3.
  `Platform.folders` is optional and `webPlatform()` fills it only where
  `window.showDirectoryPicker` exists (Chromium), so the app behaves exactly as
  it did in Firefox and Safari. The handle lives in its own IndexedDB store
  (`packages/storage/src/handles.ts`, database version 2) because a
  `FileSystemHandle` is structured-cloneable — that is what makes the folder
  still linked after a reload, which a name could not be.
- **The link is in the index, not the document.** `ProjectSummary.linked` is
  `{ file, modified }` (optional, so no migration: the records that don't have
  it are still valid), with `ProjectStore.link(id, file)` to set or clear it
  and `save()` carrying it over, since autosave rewrites the entry every few
  seconds. Nothing in the document, in an `.extrudo` file or in the file
  format changes: the link is about this browser, not the design.
- **One archive builder.** `ProjectStore.archiveBytes(id)` is what both the
  download (`exportFile`) and a linked file are written from — the same bytes
  by construction, versions and attachments included. There is no second
  `.extrudo` writer.
- **The decisions are pure.** `apps/web/src/project/linkedSync.ts` is
  `createLinkSync(context)`: given the link, what the file's `lastModified` is
  and how to write bytes, it answers write / conflict / skip / error, with the
  10 s trailing throttle behind an injectable timer so a test fires the
  trailing write itself. `apps/web/src/project/linkedFolder.ts` is the other
  half: the folder, the project index, the archive and the toasts.
  `report(outcome)` is part of the context because **a write the caller didn't
  await must still be able to speak**: the trailing write runs ten seconds after
  the last save, and a conflict it finds is exactly as important as one found
  at once. (The first e2e run failed for want of this.)
- **The conflict toast has two buttons.** `ToastOptions.actions` (with
  `action` kept as the first of them, so everything that knows one button still
  works) is what the ADR's "Load from disk" and "Overwrite" needed; both carry
  `available()`, so both go disabled once one of them has run. "Load from disk"
  goes through ADR-0036's restore path with the file's document in hand
  (`restoreDocument`, which `restoreVersion` now shares): what you had is kept
  as a version first, the file's attachments are stored before the document
  that names them (ADR-0061 §2), and the shell's guard (a sketch or a dialog
  ends first, since the step must not join a transaction) is registered in
  `project/restoreGuard.ts` because the button is clicked from the
  notification store, outside the shell's tree.
- **Where the throttle is measured.** From the last save, not the last write:
  a burst of edits postpones the write rather than queueing a dozen of them,
  and the project closing writes whatever is left.
- **Home.** The "Linked folder" section sits under the designs: "Link a
  folder…", then the folder's name, a refresh, "Unlink" and the `.extrudo`
  files as cards with their dates. The cards are a component of its own with
  the state passed in (`home/LinkedFolder.tsx`), so each state — none, needs
  permission, ready, unreadable — is checked as static markup. Opening a file
  imports it as a project and links it to that file. **Unlinking clears the
  link of every project that had one**, so nothing is left pointing at a folder
  the app has forgotten.
- **A design not linked yet** gets "Save to Linked Folder" (File menu, Ctrl+K;
  `keys` is empty, so no keymap entry): it writes `<project name>.extrudo`,
  refuses a name that is already there ("A file named … is already there."),
  links the project and says it worked, like an export does.
- **A file removed or a permission lost is a toast**, never an error thrown
  into autosave and never data loss.
- **Tests.** `platform/folders.test.ts` (the handle store, the listing, a write
  read back, a file that is gone, `granted`/`prompt`/`denied`, an OPFS handle
  with no permission methods), `project/linkedSync.test.ts` (the write, the
  throttle with the newest state, a conflict, a file that is gone, permission
  lost, a closing write, and a reported trailing write),
  `project/linkedFolder.test.ts` (linking, refusing a name, the conflict and
  both its answers, loading from disk, a folder it may not write to),
  `home/LinkedFolder.test.tsx`, the command in `shell/commands.test.ts`, the
  index entry and `archiveBytes` in `packages/storage/src/project-store.test.ts`,
  and `e2e/linked-folder.spec.ts` with `showDirectoryPicker` stubbed over an
  OPFS directory (as the Slices item says): link, save to the folder, the
  throttled write after an edit, opening a file from the folder as a linked
  project, the conflict toast and Overwrite, Reconnect after a permission
  prompt, and unlinking. The stub needed two more shims than the Slices item
  lists, both found in the Playwright image CI runs in: **an OPFS handle
  cannot be deserialised out of IndexedDB in that Chromium build** (the `put`
  succeeds and the `get` crashes the renderer), so the stub keeps the folder's
  name in the handle store and answers the app's read with a live handle
  rebuilt from it — the app's own code is untouched, it still puts what the
  picker gave it and gets a directory handle back; and a file being written
  through `createWritable` is briefly not there, so the spec's polls treat
  that as "not yet" rather than "gone".
- **The upgrade of that database version, and the tabs that hold it up.** A tab
  holding a version-1 connection holds up a new tab's upgrade for ever, and
  IndexedDB says nothing while it waits, so the app's first screen simply never
  appeared. `openDatabase` takes two callbacks now: the open request's
  `blocked` fires `onBlocked` (the request keeps waiting and succeeds when the
  other tabs let go), and every connection it opens gets `onversionchange` →
  `onVersionChange()` and then closes. The app words both: "Close Extrudo's
  other tabs to finish updating." (taken back as soon as the open goes
  through) and, in the tab that lets go, "Extrudo was updated in another tab.
  Reload this tab to keep working." with a Reload button that saves first and
  refuses when a save fails. That tab's storage is closed, so `webPlatform`
  hands the app a store that turns **only** the browser's closed-connection
  `InvalidStateError` into that same message, leaving every other error (a
  damaged archive, a missing project, a full disk) as it was. The toast needs a
  page before the app is mounted, which is why the notification store is now
  one per page (`appNotifications`) and `main.tsx` draws the toast stack while
  the platform opens. `fake-indexeddb` covers both callbacks in
  `packages/storage/src/idb.test.ts`, and `e2e/storage.spec.ts` has two pages
  of one context: the second stands in for a newer build, upgrades the database,
  and the first tab asks for a reload and then fails to save.
- **Two bugs the e2e caught**, both worth remembering: `handle.values()`
  yields the entries alone, so a listing that destructured `[name, entry]` out
  of it worked on an empty folder and broke on any folder with a file in it
  (`entries()` is the one that pairs), and a trailing write's outcome was
  dropped on the floor, which is where a conflict found ten seconds after a
  save went to die.
- **Deviations from §3, and what they cost.** None of the behaviour; three
  additions it didn't ask for: a "Saved `<file>` to the linked folder." toast
  after the command (an export says it worked, so this does), a "Refresh the
  linked folder" button (the API has no change events, so the list is read
  again on demand), and the unreadable-folder state. The
  "Linked folder" section is drawn in Chromium for everybody, which changed the
  two home-screen screenshot baselines (`e2e/storage.spec.ts-snapshots/`): they
  were regenerated in the Playwright Ubuntu image, which renders like CI, so
  they still fail with the system Chrome on the Ubuntu machine (as the other
  shots made on the Arch workstation do).
  A closing write is asynchronous, so a reload that ends the page may lose the
  last few seconds: the browser copy has them.
- **Not here.** The Electron implementation of the same interface, several
  folders, sub-folders, and watching the folder for changes (the API has no
  change events in stable Chromium; the check before each write and the home
  screen's list are what §3 settled for).

## Rejected

- **Groups as a list of member IDs:** moves could split a group; ranges stay
  contiguous by construction.
- **Groups as a feature type:** the engine and every feature list would have to
  skip them.
- **Nested groups:** no request for them; the schema leaves room (`parent`).
- **The linked folder as the primary store:** permission can lapse at any reload
  and other browsers lack the API; the browser copy stays primary and the folder
  mirrors it.
- **Watching the folder for changes:** the API has no change events in stable
  Chromium; the check before each write and the home screen's list on open are
  enough.

## Deferred

- Several linked folders, sub-folders, a desktop (Electron) implementation of the
  same interface (Phase 6), nested groups, groups in the browser panel.
