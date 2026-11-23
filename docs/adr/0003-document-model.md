# ADR-0003: Document model, commands and undo

- **Status:** Accepted, 2026-09-25
- **Task:** P0-06 (document model and commands). Code: `packages/core/src/`.
- **Affects:** every task that changes the document: P0-07 (parameters), P0-08
  (storage), P1 (sketches), P2 (features, timeline, topological naming),
  P5 (scripting).

This is the "document as JSON, geometry as cache" ADR planned in architecture
§10, together with the command and undo design that follows from it.

## Context

Extrudo is history-based: the design is an ordered list of features plus
parameters, and the B-rep is recomputed from it. Every change must be undoable
(FR-TL-07), including edits inside a sketch, which collapse into one step when
the sketch is finished (§4.4). Files must keep opening after the schema
changes, and a script must be able to produce the same features as the UI
(FR-PRG-01). The kernel runs in a worker and can crash, so nothing in the
document may depend on live kernel objects.

## Decision

1. **The document is plain JSON; geometry is derived.** `ExtrudoDocument`
   (`schema.ts`) holds settings, parameters, the feature list, the timeline
   marker, body metadata (name, colour, visibility), named views and meta
   data. It never holds shapes or meshes; those live in the model store and the
   kernel's cache and can always be rebuilt. The `.extrudo` zip may carry an
   optional B-rep cache later, dropped when stale (§6.2).

2. **Zod validates it on load, with strict objects.** An unknown key in a
   version-1 document is treated as a bug and rejected, not silently dropped.
   Newer formats carry a higher `formatVersion`, and `loadDocument` refuses
   them with "saved by a newer Extrudo". Adding an optional field needs no
   version bump; any other change bumps `FORMAT_VERSION` and adds a migration.
   Document-level invariants are checked too: the timeline marker lies within
   the timeline, and feature IDs, parameter IDs, parameter names and view IDs
   are unique.

3. **Migrations run on raw JSON, one version step each** (`migrations.ts`).
   They never import the current schema types, so an old migration keeps
   working after later changes. They are pure: new IDs and timestamps come
   from a `MigrationContext`, which tests pin. The v0 format is a synthetic
   pre-v1 draft (no release wrote it), with the fixture
   `packages/core/fixtures/v0-bracket.json`, so the chain has a real first step
   from day one.

4. **Commands are data plus a recipe** (`commands.ts`). A command has a type
   (`feature.rename`), a label for the undo menu, a serialisable payload and an
   Immer recipe that edits a draft. `applyCommand` returns the new document
   and forward/inverse patches. Recipes are deterministic: the caller creates
   new IDs (`newId()`) and puts them in the payload, so redo and replay give
   the same document. An invalid change throws `CommandError`, and Immer
   discards the draft. The built-in commands (`document-commands.ts`) cover
   document settings, parameters, feature insert/edit/rename/suppress/delete,
   the timeline marker and body metadata; feature-specific commands come with
   their features.

5. **Undo stores Immer patch pairs, in nested transaction levels**
   (`history.ts`). While a transaction is open (sketch mode, a feature dialog),
   undo and redo step only through that level's entries. Commit collapses them
   into one entry of the enclosing level (forward patches concatenated,
   inverse patches in reverse order) under the transaction's label. Cancel
   reverts them. A command that changes nothing leaves no step. The top level
   keeps 500 steps.

6. **`meta.modified` is set by storage when it saves**, not by commands.
   Otherwise every command would carry a timestamp patch, and undo would move
   the modified time backwards.

7. **The feature registry is split by layer** (`features.ts`). Core defines
   the data part of a definition: type, label, category, icon ID and the
   inputs schema. The kernel and the web app extend it (`evaluate`; dialog and
   manipulators) and keep their own `FeatureRegistry<Extended>` keyed by the
   same type. `FeatureRegistry.check` validates each feature's inputs against
   its definition; the document schema only knows the generic input kinds
   (`expr`, `enum`, `bool`, `ref`, `sketchData`). There is no raw-number input
   kind, since every number is an expression.

8. **Three vanilla Zustand stores, created per document** (`stores.ts`):
   - *document*: the deep-frozen document and its history. `dispatch(command)`
     is the only way to change it; `undo`, `redo`, the transaction calls and
     `replaceDocument` (open, restore a version) complete it;
   - *session*: mode, active sketch, active tool, selection and hover, which
     are not saved and not undoable;
   - *model*: the kernel's results (status per feature, body meshes), generic
     over the mesh type so core doesn't depend on the kernel.

   They are factories rather than singletons, work without React (tests,
   workers) and are read in the app through `useStore`.

## Rejected options

- **Snapshot undo (keep whole documents).** With Immer's structural sharing it
  would be cheap too. Patches win because they are serialisable (they can be
  persisted or sent to a worker), because they say what changed (the paths
  name the features and parameters, which incremental recompute can use), and
  because the architecture already planned them.
- **Hand-written inverse operations per command.** Easy to get wrong, and the
  error only shows after several undo/redo steps. Immer derives the inverses.
- **Zustand's Immer middleware on the document store.** It would let
  components change the document without going through a command, so without
  an undo step. The store calls `produceWithPatches` itself instead.
- **Lenient (key-stripping) zod objects.** They silently drop data written by
  a buggy or newer writer. Strict objects plus the version gate make both
  cases visible.
- **Generating IDs inside recipes.** Redo or a replayed command would create
  different IDs, and references to the new entity would break.
- **The whole feature definition in core** (with `evaluate` and the dialog).
  Core would then depend on the kernel and React, against the package rules.

## Consequences

- **Test coverage:** a round trip for every built-in command, a seeded
  400-step random edit session that undoes to the start and redoes to the end
  (checking the schema after every step), nested transactions, and the v0
  fixture migration.
- **Placeholders to fill in later:** `SketchData` is an open record until P1-01
  defines the sketch schema; `GeomRef` gains its fingerprint in P2-04. Both
  are additions, so they need no version bump while unreleased.
- **Not done yet:** dependency checks on delete (a parameter used in an
  expression, a feature referenced by a later one) come with P0-07 and P2.
  Neither is coalescing rapid edits, such as scrubbing a parameter, into one
  undo step; add it when the first UI needs it. Reordering (FR-TL-04) is P2.
- **Commands are pure and serialisable**, so they can later be logged, sent to
  a worker or produced by scripts (FR-PRG-01) without changes.

## Amendment, 2026-11-23: a length limit for IDs

IDs are keys in many places (maps, caches, the messages to the kernel's
worker, references), so their length is limited.

Now every ID schema (`ids.ts`: document, feature, parameter, body, view,
group, configuration, sketch entity, constraint, dimension, projection,
attachment, component, joint, annotation, sheet, sheet view, sheet item) takes
at most `MAX_ID_LENGTH` = 1,000 characters, as a field and as a record key,
and a feature's ID at most `MAX_FEATURE_ID_LENGTH` = 980.
`loadDocument` refuses a document with a longer one in plain words
(`ID_TOO_LONG_TEXT`: "This design has an ID too long to open: an ID may
have at most 1,000 characters, a feature's 980.", code `invalid`), for a newer
format version too (it is not called newer for it). IDs inside a feature's
inputs (a sketch's entities) meet the schema when the API checks the inputs.

A feature's ID leaves room (`BODY_ID_ROOM` = 20) for the IDs made from it that
a document stores: its bodies are `<feature>:<n>`, and the app stores every
body it shows in `bodies` (`nameBodies`), so the colon and the body's number
(a safe integer, at most 16 digits) must fit too. The same 980 holds every
feature ID the engine runs, so each of their bodies fits as well, and the
refusal comes when the feature runs, never when the design is opened again:
a script's or plugin's feature (`<script>.<id>`, its whole ID, in
`checkedGenerated`: "The script made a feature with an ID longer than 980
characters.") and an inserted design's (`<insert>.<id>`, `insertedFeatures`;
the insert command refuses such a copy at once). An inserted design's stored
body key that would pass 1,000 characters under the insert is no body of the
copy and is left out.

Why 1,000: the app makes UUIDs (36 characters), the API and the importers
counters (`f12`, `s340`, `fcp3`) and UUIDs for attachments, the kernel body IDs
`<feature>:<n>`; the longest, an inserted design's body, is under 100. The
repository's fixtures, demos and benchmark designs hold at most 39 (a body
of a UUID feature), and the designs imported from the f3d corpus, before and
after their bodies are checked, at most 36 (a UUID).

The API holds every ID it takes to the same limits when the call is made
(`checkedId` in `packages/api/src/ids.ts`, one helper): a caller's
`options.id` (feature, parameter, configuration, component, joint,
annotation, sheet, sheet view, sheet item, the document's own), every ID its
factory hands out (a script's `<script>.f1` too) and a body's ID a call names
(`setBody`, a component's or sheet view's bodies, a parts list's rows). A
longer one is an `ApiError` whose path names the argument (`id`, `body`,
`bodies`, `rows`; "A feature's ID may have at most 980 characters.", "An ID
may have at most 1,000 characters."), and an inserted design whose features
would run past 980 under the new insert's ID is refused with path `design`
and the insert command's sentence (`longInsertedId`), before anything is
dispatched,
so the CLI and the MCP tools refuse it at once and the design is never saved
with it.

Not covered: a reference's `id` (`GeomRef`) is a persistent name, which nests
the names it is made from, and keeps no limit of its own here.

Rejected: a lower limit (256), which leaves less room for documents other
tools write; refusing only past the document's own size limit, which is what
there was.
