# ADR-0140: Insert Design (Copied)

- **Status:** Accepted, 2026-11-13 (the owner: ship Copied mode as piloted on
  2026-11-07, every recommendation taken; see "Decisions" at the end). Copied mode
  only; Linked mode is §7's later step.
- **Task:** P6-26 "Insert Design" (`docs/03-roadmap.md`), issue #75.
- **Builds on:** ADR-0003 (the document is JSON, commands, deterministic recipes),
  ADR-0004 (expressions and parameters), ADR-0005 (topological naming), ADR-0024
  (the recompute engine), ADR-0061 (attachments), ADR-0068 (the API), ADR-0070
  (the Script feature's expansion), ADR-0077 (plugin features, the second
  expansion), ADR-0081 (components), ADR-0083/0084 (the `.f3d` import).
- **Schema change:** a new feature type `insertDesign` and a new input kind
  `design` (`docs/file-format.md` §6.1 and §6.37). Both are additive: format 2 stays.

## Context

An assembly usually puts designs made elsewhere together (the assembly feedback
of 2026-10-18): a hinge printed into a box, the same knob on two lids. ADR-0081
gave a design components, but every body of a component had to be modelled in
that design. Issue #75 asks for **Insert Design**: another `.extrudo` file comes
in as one component named after the file, as one timeline feature, placed by
Move like any component. **Copied** first (no link to the file); **Linked**
later (re-read on open, a "changed on disk" notice and an Update action).

The constraints that shape the decision:

- **The document is JSON; geometry is derived** (hard rule, ADR-0003). Nothing
  may store a kernel shape as the truth.
- **IDs and parameter names must never clash.** Feature IDs are tokens inside
  persistent names (`extrude:<feature>:cap:end`, a body `<feature>:0`); the API
  writes short IDs (`f1`, `f12`), so two designs made by the API share IDs, and
  a design inserted into itself (or twice) shares all of them. Parameter names
  (`width`, the model parameters `d1`…) are one namespace per design (ADR-0004),
  and two designs commonly both have a `width`.
- **The engine already expands features** (ADR-0070 §1): a Script or a plugin
  feature returns features that are evaluated right after it, under IDs
  `<owner>.<id>`, as if they stood in the timeline; references into them are
  ordinary references and a dependency on the owner (`scriptOfGenerated`).
- **Components have no transform** (ADR-0081): placement is the timeline's.

## Decision

### 1. One feature, one component

An insert is one feature of type `insertDesign` with one input, `design`, and the
`component` stamp of a **new** component named after the file (the picked file's
name without `.extrudo`; a name the design already has becomes `<name> (2)`, as
Copy Component names a copy). The feature is named like its component. The
`insertDesign` command (core, `insert-design.ts`) adds the source's files, the
component, the feature at the marker and the copied bodies' metadata in **one
undo step**; every ID comes from the caller (`insertDesignPayload`, ADR-0003).

### 2. Storage: the source design embedded as JSON

The `design` input holds the source design **as JSON**: its name, its length
unit, its parameters and the features before its timeline marker, exactly as the
file stored them (an `EmbeddedDesign`). Nothing geometric is stored: the inserted
bodies are computed from these features on every recompute, like the host's own.
Left out: the source's components and joints (§5), views, groups, annotations,
configurations, render settings and its features after the marker (rolled back,
so not part of the design that was seen).

- The copied **bodies' metadata** (names, colours, opacity, visibility) is written
  into the host's `bodies` under the new body IDs (`<insert>.<feature>:<n>`), each
  in the new component; from then on the host's metadata is the truth, as for any
  body (ADR-0030). A body without metadata joins the component through the
  insert's stamp (`stampOfBody` → `scriptOfGenerated`, ADR-0081 §2 rule 3).
- The **files** the copy names (a text's font, an imported model) become the
  host's attachments, bytes stored before the document names them (ADR-0061 §2).
  The same bytes are one file (the host's ID is used); an ID the host already
  gives other bytes is renamed in the copy (`file` inputs and `attachment:<id>`
  fonts). The schema checks the copy's files and fonts against the host's
  attachments (`featuresWithEmbedded` in `schema.ts`), and `usedAttachments` /
  `removeAttachment` see the copy's texts.
- **The schema keeps nested inserts out**: an embedded feature's inputs are every
  kind but `design` (`EmbeddedInputSchema`), and it has no `component`.

### 3. Evaluation: an isolated expansion

The kernel's `insertDesign` definition **expands** (the `expand` hook of
ADR-0070): `insertedFeatures` (core, pure) turns the copy into the features to
walk, and the engine evaluates them right after the insert, each under its own
cache key, exactly like a Script's features. The insert's status is the Script's
kind (`status.script.generated`, one message per failing feature,
`<insert> › <feature>: …`).

The expansion is **isolated** (`Expansion.isolated`, engine `ownBodies` /
`mergeBodies`): each of its features sees only the bodies whose IDs start with
`<insert>.`, its result replaces only those, and its cache key carries the key of
the insert's own last body set instead of the whole design's. So:

- a `join`, `cut` or `intersect` of the copy that names no bodies (it acts on
  "the bodies it touches") never reaches the host's bodies, and the copy builds
  exactly the bodies it built in its own file;
- a change before the insert recomputes none of the copy's features (a kernel
  test checks `stats.evaluated`);
- the bodies come after the host's in the body order.

### 4. Nothing can clash, by construction

- **IDs.** Each feature of the copy is `<insert>.<id>` (`generatedFeatureId`),
  and every reference inside the copy (its `ref` inputs, a sketch's projections,
  a fingerprint's `adj` names) is rewritten **token by token** (`prefixIds`, the
  same separators as `timeline.ts`'s `SEPARATORS`): a token that is one of the
  copy's feature IDs gets the prefix, nothing else changes. So `f1` never catches
  `f12`, and `origin:xy` stays. A face of the insert is
  `extrude:<insert>.<feature>:cap:end`, a body `<insert>.<feature>:0`; a later
  host feature that refers to one depends on the insert (the timeline refuses to
  move it before the insert, `referencedFeatures`).
- **Parameter names.** The copy's numbers are evaluated against **its own**
  parameters, in **its own** unit (`evaluateParameters` over the copy alone), and
  reach the expansion as plain values with units (`20 mm`, `5 deg`, a plain
  number) without a `paramName`; the copy's named sketch dimensions lose their
  names the same way. The host's parameter table never sees a name of the copy,
  and the copy never reads one of the host's. A copied expression that fails
  makes the insert an error naming it (`Extrude1: distance: …`).

### 5. What an insert can't hold yet

`insertDesignProblem` refuses a source with nothing before its marker, or with an
unsuppressed Script, plugin feature or Insert Design there: each expands into
features of its own, and the engine runs no expansion inside an expansion ("A
script can't add a script"). The source's components flatten into the one new
component (nested components are an ADR-0081 deferral), and its joints are not
copied (they name the source's components).

### 6. The app

Solid › Assemble › **Insert Design** (tool `insertDesign`, between New Component
and Joint; Ctrl+K finds it by "assembly", "import", "copy") picks a file through
`Platform.files.pick` (web and desktop), reads it with storage's `readArchive`
(migrations included, so an older file is current before it is embedded), writes
the files the copy needs, and dispatches the command (`components/insertDesign.ts`).
A file that isn't `.extrudo` is refused with a pointer to Import Model. The agent
can't run it (`AGENT_DENIED_COMMANDS`: it opens a file dialog). The emitter skips
an insert like a feature with a file (a script can't carry a whole design).
There is no dialog: the copy has nothing to set, and Move places it.

### 7. Linked mode, later

Linked fits this storage without a format change to what Copied writes: a linked
insert is the same feature plus a `link` input (where the file is, and the
SHA-256 of the document it last read). On open the app re-reads the file; when
its hash differs it says "changed on disk" and **Update** replaces the `design`
input (one undo step, `updateFeatureInputs`) and re-runs `insertDesignPayload`'s
file and body-metadata steps. References into the insert keep resolving through
the topological naming of the copy's own features, which keep their IDs across
an update. Breaking the link drops the `link` input: the insert becomes Copied.

**A linked file that is gone** (deleted, moved, renamed, or on a drive that isn't
there; the owner, 2026-11-10):

1. **The last copy stays the truth.** A linked insert always keeps the `design`
   it last read, so a missing file never breaks the geometry: the insert keeps
   computing from that copy, exactly as a Copied one does, and nothing that
   refers to its faces or bodies is lost.
2. **The app says so and offers the way out** (to build with Linked mode): on
   open, a notice names the insert and the file it can't find, with
   **Relink…** (pick the file where it is now; the hash check then runs as for
   "changed on disk", so a relinked file that differs offers Update) and **Break
   link** (drop the `link` input: the insert becomes Copied, one undo step). The
   insert's status shows it too (a warning, not an error: its geometry is
   fine), so it isn't lost once the notice is closed.
3. **Where the link can be re-read.** The desktop stores a path and re-reads it
   on open. The web has no path to give: a link there needs a stored file handle
   (File System Access, which asks again for permission) or the design's linked
   folder (ADR-0075's), so Linked is likely desktop first, with the web offering
   Relink… each session or keeping inserts Copied.

### 8. The `.f3d` import's occurrences (not changed in this pass)

The `.f3d` import (ADR-0083) writes each of the file's components as features of
the one new design, each body in a component. The same mechanism could carry an
`.f3d` component that occurs several times: the component's features written once
as an `EmbeddedDesign` and one Insert Design per occurrence, each followed by a
Move. That needs occurrences (several inserts of one copy sharing it) and the
`.f3d` reader's per-occurrence transforms, both out of scope here; the import is
unchanged.

## Rejected approaches

- **A snapshot of the geometry** (the source exported to STEP as an attachment,
  read by the `import` feature). Simplest, and it reuses everything, but the
  inserted geometry would be stored, not derived; a mesh body or a colour that
  STEP drops would be lost, the copy could not be re-evaluated by a newer kernel,
  and Linked mode would have to re-export rather than re-read. Kept only for files
  of other programs (Import Model).
- **Writing the source's features into the host's timeline** (a paste with renamed
  IDs, folded into a group). The timeline floods with the copy's features, the
  insert is no longer one feature to suppress, delete or later update, Linked's
  Update would have to find and replace them, and the copy's parameters would
  have to join the host's table.
- **Namespacing parameter names into the host** (`Bracket.width`, or `width_2` on a
  clash) so the host can read and change them. It rewrites every expression of the
  copy, fills the host's parameter table and its customizer with the copy's names,
  and a rename on clash changes names the user knows. Overrides (§ open questions)
  give the useful half without it.
- **The source `.extrudo` (or its `document.json`) as an attachment** the kernel
  parses on each recompute. Content-addressed and close to Linked, but the copy
  would be invisible to the document's schema checks and migrations, and its own
  attachments would be a second, unchecked layer of references. The JSON in the
  input is validated with the document and migrated with it (§ Consequences).
- **Running the copy on the host's body set** (a plain Script-like expansion). A
  copied join or cut would act on the host's bodies, and every host edit before
  the insert would recompute the whole copy.

## Consequences

- `docs/file-format.md` §6.1 gains the `design` kind and §6.37 the `insertDesign`
  feature. An older Extrudo reads a design with an insert leniently: the unknown
  input is left out and the feature is "This version of Extrudo can't compute…".
- **A future format bump must migrate the features inside a `design` input too**
  (migrations run on raw JSON, `migrations.ts`), and the embedded copy is always
  written at the current format (the file is loaded through `loadDocument` first).
- `document.json` grows by the copy's size per insert (a sketch-heavy design is
  tens of kB); the same design inserted twice is stored twice.
- The copy can't be edited in place (its features have no chips of their own).
  Editing means changing the source and inserting it again (or Update, once Linked).
- Pilot tests: core `insert-design.test.ts` (payload, names, files, undo/redo,
  schema round trip, the expansion's IDs and values), kernel
  `features/insert-design.test.ts` (B4, B5, B10 and the hinge inserted into
  themselves; own parameters; isolation; no recompute of the copy; an `.extrudo`
  round trip), `e2e/insert-design.spec.ts`.

### Decisions (the owner, 2026-11-13)

1. **Storage:** the embedded JSON of §2, not a STEP snapshot or the source file as
   an attachment.
2. **No parameter overrides** for now (a follow-up, below).
3. **Name:** the component and the feature are named after the file
   (`b4-box-with-lid`), not after the design inside it.
4. **Placement:** the bodies land at the file's own coordinates; Move places them.
5. **Not insertable:** a source with a Script or a plugin feature (or an insert)
   is refused, as §5 says.
6. **No size cap** on the copy; storing one copy for several inserts comes with
   Linked mode (a follow-up).
7. **Not editable in place:** the copy's features have no chips of their own.
8. The tile's tooltip clip is recorded with the others (`docs/assets.md`).

### Follow-ups

- **Parameter overrides** (like an OpenSCAD import's `scadName`/`scadValue`: a
  copied parameter set to a host expression). The expansion would evaluate the
  copy with the override; a sketch dimension the override drives would need the
  sketch re-solved, which the kernel doesn't do today (sketches are solved by the
  app, ADR-0011).
- **One stored copy for several inserts** (content-addressed, with Linked mode and
  occurrences), instead of one copy per insert.
- **Linked mode** (§7), including the gone-file behaviour.
