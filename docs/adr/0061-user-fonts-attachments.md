# ADR-0061: User fonts as attachments

- **Status:** Accepted, 2026-10-03; implemented (on branch `p4-03b-user-fonts`,
  in the two slices below)
- **Task:** P4-03b (FR-SK-13, "font picker: bundled open fonts **plus user
  fonts**"; ADR-0058 Deferred). First use of the `.extrudo` file's
  `attachments/` folder that `docs/02-architecture.md` §6.2 reserved.

## Context

Sketch text (ADR-0058) uses six bundled fonts, referred to by versioned IDs
(`inter-regular@1`) whose files never change. A design with someone's own font
must carry that font, or it changes shape on another computer. The font can't
live in the document JSON (megabytes of base64 in every undo step and
autosave), so it is a file next to the document, referred to from it.

## Decision

### 1. Attachments in the document: metadata only

```ts
DocumentSchema += {
  /** Files that travel with the design (ADR-0061); the bytes live beside the document. */
  attachments: z.record(AttachmentIdSchema, z.strictObject({
    name: z.string().min(1).max(200),        // what the user sees, e.g. "Comic Neue Bold"
    fileName: z.string().min(1).max(255),    // the original file name
    mediaType: z.enum(['font/ttf', 'font/otf', 'font/woff']),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    size: z.int().positive(),
  })).optional(),
}
```

- `AttachmentId` is a branded ID like the others (`newId()` in the caller).
- **Bytes are content-addressed** by SHA-256: the same font added twice, or kept
  in several versions, is stored once.
- `FontIdSchema` (core) accepts `attachment:<AttachmentId>` besides the bundled
  `name@n` IDs. The schema check: a text whose font is `attachment:<id>` needs
  that ID in `doc.attachments`.
- Commands: `addAttachment({ id, attachment })` and `removeAttachment({ id })`
  (refused while a text uses it: "Fonts in use can't be removed: <names of
  the sketches>"). One undo step each. Undoing an add leaves the bytes in
  storage (harmless, collected later: §2).
- WOFF2 is not accepted: opentype.js can't read it. TTF, OTF (CFF) and WOFF are.
- `formatVersion` stays 1 (optional key; an older app drops it with the newer
  file notice and shows such texts as missing fonts).

### 2. Storage

- **Project store:** `projects/<id>/attachments/<sha256>` in OPFS (or the
  IndexedDB `files` store), written **before** the document that refers to it
  is saved. `ProjectStore.writeAttachment(projectId, sha256, bytes)`,
  `readAttachment(projectId, sha256)`, and on `delete(projectId)` the folder
  goes too. Versions reuse the same files (no copies).
- **Garbage collection:** when a project is saved, attachment files that
  neither the document nor any saved version refers to are deleted (cheap: a
  directory listing and a set). Not at every autosave: at most once per
  session per project, or on explicit save (Ctrl+S); pick the simplest
  correct place and say which.
- **`.extrudo` archive:** `attachments/<sha256>` entries (stored, no zip
  compression: fonts are already compressed). `writeArchive` takes the bytes
  of every attachment the document or a version refers to; `readArchive`
  returns them; import writes them into the new project before its document.
  An archive whose document names an attachment that the zip lacks loads with
  a notice ("1 font is missing from the file; its texts show without
  letters") instead of failing.
- **Limits:** one font at most 10 MB, all attachments of a design at most 50
  MB; refused with a clear message.

### 3. Fonts in the app and the worker

- `apps/web/src/sketch/fonts.ts` `fontBytes(id)` handles `attachment:<id>`:
  reads `readAttachment(projectId, sha256)` through the platform's project
  store (it needs the open project; pass a resolver from `ProjectPage`).
  Everything else (UI `loadFont`, the Recomputer sending `addFont`, profile
  caches by `fontsStore.version`) works unchanged, because the ID is just a
  string to them.
- **Adding a font:** the Font select (Text panel and selection panel) gets a
  last entry "Add font…" that opens the platform file picker (`.ttf, .otf,
  .woff`). The app reads the bytes, checks size, **parses them with `loadFont`
  first** (a bad file is refused with the parser's message, nothing stored),
  takes the name from the font's family and subfamily names, writes the bytes,
  dispatches `addAttachment`, and selects it. The select lists the design's
  fonts under a separator after the bundled ones.
- A hint under the select when a design font is chosen: "Saved inside this
  design. Only add fonts whose licence allows embedding." (Plain words, no
  legal advice beyond that.)
- Fonts are per design, not per browser: a font added in one design isn't in
  another until added there.

## Slices

1. **Core and storage:** schema, IDs, `FontIdSchema`, commands, project store
   read/write/delete/GC, archive write/read/import with the missing-file
   notice, limits; tests; file format (§4 `attachments`, §6.2-style container
   description of `attachments/`, §7's `font` field).
2. **App, e2e and docs:** `fontBytes` for attachments, "Add font…" in both
   panels, the hint, `e2e/user-fonts.spec.ts` (add a font from a file, a text
   in it, extrude, export `.extrudo`, import it as a new design: the text still
   has its letters; a bad file is refused), CLAUDE.md, CHANGELOG, roadmap,
   this ADR's results.

## Results

Implemented on branch `p4-03b-user-fonts` in the two slices above, all pushed.

### Code map (one line per file group, per slice)

1. **Core and storage** — `packages/core/src/attachments.ts` (`addAttachment`,
   `removeAttachment`, `usedAttachments`, `attachmentHashes`),
   `packages/core/src/ids.ts` (`AttachmentId`), `packages/core/src/schema.ts`
   (`AttachmentSchema`, `doc.attachments`, the strict check),
   `packages/core/src/sketch/schema.ts` (`attachment:<id>` in `FontIdSchema`,
   `attachmentFontId`),
   `packages/storage/src/sha256.ts`, `types.ts` (`writeAttachment`,
   `readAttachment`, `collectAttachments`, the two limits),
   `project-store.ts` (write/read/GC, the archive's bytes, `duplicate`),
   `archive.ts` (`ATTACHMENT_FOLDER`, `readAttachments`, `attachmentNotices`),
   `docs/file-format.md` §2, §4.5 and §7, and their tests.
2. **App, e2e and docs** — `apps/web/src/sketch/fonts.ts`
   (`AttachmentFonts`, `setAttachmentFonts`, `useFontAttachments`,
   `fontBytes`, `textModule`), `apps/web/src/project/ProjectPage.tsx`
   (`useFontAttachments` before the recomputer),
   `apps/web/src/sketch/addFont.ts` (`addFontFile`, `FontPicker`, `FONT_ACCEPT`,
   `FONT_HINT`), `packages/sketch/src/text/index.ts` (`fontName`, a readable
   parse error), `apps/web/src/sketch/panels.tsx` (`FontSelect` in the Text
   panel and in `TextFields`), `apps/web/src/shell/AppShell.tsx` (`fontPicker`),
   `sketch/textDraft.ts` and `tools/text.ts` (the anchor belongs to the draft),
   `e2e/user-fonts.spec.ts`, the unit tests
   (`apps/web/src/sketch/{addFont,fonts}.test.ts`,
   `sketch/tools/text.test.ts`, `packages/sketch/src/text/text.test.ts`) and the
   docs (this section, `docs/02-architecture.md` §6.1, the roadmap tick,
   CHANGELOG and CLAUDE.md).

### Decisions taken while implementing

- **SHA-256 in pure TypeScript** (`packages/storage/src/sha256.ts`) rather than
  `crypto.subtle.digest`: `readArchive` is synchronous (it reads an unzipped
  buffer), and Web Crypto is only there in a *secure* context, which a
  browser CAD may well be served from (`http://192.168.10.5`, say). A test
  checks every result against `crypto.subtle.digest`, so the two must agree.
  Hashing a few megabytes is a moment's work; a 10 MB file is refused anyway.
- **The document check is strict**: a text shaped with `attachment:<id>` that
  the document doesn't carry is refused by `DocumentSchema` ("… is the font of
  attachment "x", which this design doesn't carry"), not a warning at load. A
  design that names a file it doesn't have is broken in a way the user can't
  fix by editing the text, and the same rule catches a hand-edited file.
- **Garbage collection runs where a version changes**: `collectAttachments` is
  called from `saveVersion` and `deleteVersions`, under the version lock, not on
  autosave. An undone add therefore leaves its bytes until the next version save,
  which is the cheapest place that is not on a timer: a directory listing and a
  set of hashes (ADR-0050's lesson about per-autosave work).
- **`duplicate` copies the bytes** (through `saveCopy`, as `importFile` does):
  a copy is a separate project with its own folder, so it needs its own
  attachment files; the *hashes* are shared between a project's document and its
  versions, which is where the "one copy" promise matters.
- **Limits are checked in the store, once** (`writeAttachment`): one file at
  most 10 MB, a design at most 50 MB, and bytes that must hash to the name they
  are stored under. The app shows whatever the store says rather than repeating
  the numbers, so importing an `.extrudo` file, duplicating a project and adding
  a font are all covered by the same message.
- **"Add font…" parses before it stores**: the file's bytes go through
  `fontName` (opentype.js) before a hash, a file or a document entry exists, so
  a file that isn't a readable font leaves nothing behind — and the shaper has
  proved it can shape with what the design will keep. The font's name comes from
  its own family and subfamily names ("Comic Neue Bold"), with a subfamily that
  adds nothing left out; a file with no family name falls back to the file name.
  WOFF2 is refused from its name, before the parser is asked.
- **The same file twice is the same attachment**: the hash finds the record the
  design already has, so the second "Add font…" only selects it.
- **The anchor click belongs to the draft** (`TextDraft.placedAt`): the host
  starts a tool afresh on *any* document change, and adding a font is one, which
  would have thrown away the click that placed a text being typed. Other tools
  lose their points on undo by design; a font added to the design changes
  nothing about the sketch, so the Text tool takes its anchor from the draft
  store instead of the tool instance.
- **The hint is one sentence**, under the select, only while the design's own
  font is chosen: "Saved inside this design. Only add fonts whose licence allows
  embedding." — no legal advice beyond that.

### Still open after this task

- Other attachment kinds (P4-06's canvas images and imported meshes reuse §1
  and §2 with their own media types; the media-type-specific wording of
  `attachmentNotices` and the "WOFF2" refusal then need their own cases), a
  design-wide "Fonts" list with remove, and system fonts as a source for
  "Add font…".

## Rejected

- **Fonts as base64 in the document:** every undo step, autosave and version
  would carry megabytes.
- **Per-browser font library** shared by all designs: designs wouldn't be
  self-contained; a file sent to someone else would lose its fonts.
- **System fonts** (Local Font Access API): Chromium-only, needs a permission
  prompt, and the design still has to carry the bytes; maybe later as a
  source for "Add font…".
- **WOFF2:** needs a Brotli decoder in the page for little gain; convert first.

## Deferred

- Other attachment kinds (canvas images and imported STEP/mesh files of P4-06
  reuse §1 and §2 with new media types); a design-wide "Fonts" list in the
  browser with remove; system fonts as a source.
