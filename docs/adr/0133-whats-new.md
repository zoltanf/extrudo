# ADR-0133: What's new after an update

- **Status:** Accepted, 2026-11-06 (the owner: show the changelog after an update, desktop
  and web; a small toast that opens a dialog; held v0.10.0 for it).
- **Builds on:** ADR-0054 (the web's update toast), ADR-0075 slice 4 (the desktop
  updater), ADR-0082 (the Settings inventory), ADR-0085 (About).
- **No schema or file-format change.** One preference, `whatsNew.lastVersion`.

## Context

An update arrives silently: the web's service worker or the desktop's updater
installs it, and the next start runs the new version. Nothing said what changed;
About's "What's new" linked to `docs/CHANGELOG.md` on GitHub, which a person
seldom opens. A release's section is long (66 entries for v0.10.0), so it needs a
short summary first.

## Decision

1. **The notes are built in.** `apps/web/pwa/release-notes.ts` serves the virtual
   module `virtual:release-notes` for the package version X.Y.Z: the bullets of
   `docs/release-highlights/X.Y.Z.md` (hand-written, the same text as the GitHub
   release's Highlights) and the bullets of the CHANGELOG's `## vX.Y.Z` section,
   without their date prefix. The app imports it lazily (its own chunk, precached
   like the rest, so it works offline). A version without a highlights file has no
   notes (`null`) and the app says nothing about it.
2. **Once per update.** `whatsNew.ts`'s `checkWhatsNew` keeps the last version
   that ran in the preference `whatsNew.lastVersion` (X.Y.Z, no build suffix). A
   newer version records itself and announces; the same or an older one records
   and stays quiet. No stored version means either a first install or someone
   updating from a version before this ADR: `returning` tells them apart (a
   stored design, or the tour answered), and only a returning person hears
   about the update. Whichever page mounts first (`useWhatsNew`, once per
   session) lists the designs at once, before a click can create one, so a
   design made in this session never counts.
3. **Edge stays quiet** and records nothing: its version moves with every
   commit. `dev` builds behave as stable, so the e2e suite and a hand-built
   desktop app show it.
4. **A toast, then a dialog.** The announcement is an info toast "Updated to
   Extrudo X.Y.Z." with a What's new button (30 s, like the update toast); the
   dialog shows the highlights and, behind "Full changelog (N changes)", the
   section. About › What's new opens the same dialog. Its open state is one
   store (`whatsNewStore`), so the toast and About open it on whichever page is
   mounted (the home screen and the project shell each mount `WhatsNewDialog`).
   The toast goes to the page that ran the check.
5. **Markdown inline only.** A notes line renders `**bold**` and `` `code` ``;
   everything else is text (no HTML, no link rendering).

## Rejected

- **The dialog opening by itself** on the first start after an update: it
  interrupts whatever the person opened the app for (the owner chose the toast).
- **Shipping the whole CHANGELOG** (`?raw` import, 210 kB): only this version's
  section is shown.
- **Fetching the notes from GitHub**: a cross-origin load (CSP), and offline
  would show nothing.
- **The desktop's updater event** (`update-downloaded`) as the trigger: the web
  has no such event, and the new version, not the old one, knows its own notes.

## Consequences

- Every release adds `docs/release-highlights/X.Y.Z.md` in its release commit
  (`docs/release-checklist.md` step 3); the owner approves it with the release
  notes. A release without one updates quietly.
- People who update from v0.9.0 to v0.10.0 see it: v0.9.0 wrote no
  `lastVersion`, so `returning` decides.
