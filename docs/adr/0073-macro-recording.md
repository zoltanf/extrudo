# ADR-0073: Macro recording

- **Status:** Accepted, 2026-10-06
- **Task:** P5-05 (FR-PRG-04: "Macro recording: turn UI actions into a
  script").
- **Builds on:** ADR-0068 (the document API: one method per feature type,
  `d.sketch` with the builder, references as plain strings, deterministic
  IDs), ADR-0070 (the Script feature runs API code and its generated features
  are `<script>.f<n>`), ADR-0003 (every change is a command; the document is
  the source of truth), ADR-0016 (named dimensions are parameters).

## Context

A user who has modelled a part by hand wants the same steps as code: to
repeat them with other numbers, to turn a hand-made design into a Script
feature, or to learn the API from what they just did. Two facts decide how:

- **The document already is the record.** Every UI action is a command that
  leaves its result in the document (features with their inputs, sketches
  with solved positions, parameters). The order of features is the timeline.
  So the macro need not log UI events: the features added or changed between
  "Record" and "Stop" are the macro.
- **The API can express every feature.** `@extrudo/api` has a method per
  feature type generated from the same registry, and the sketch builder has
  every entity, constraint and dimension. What the API lacks is the
  **inverse**: from a stored feature to the call that makes it.

## Decision

### 1. The macro is emitted from the document, not from UI events

`@extrudo/api` gets an emitter, `emitScript(doc, options)` in
`packages/api/src/emit.ts`, which writes TypeScript that, run against a
`Design` (or inside a Script feature's `design`), adds the chosen features
again. `options.features` selects a contiguous run of the timeline (default:
all of it); `options.parameters` says whether to emit the user parameters
(`d.parameter`, default true for a whole design, false for a run). The
recorder (slice 2) is "remember the timeline index at Record; at Stop, emit
the features after it".

### 2. What the code looks like

- One statement per feature, in timeline order, each assigned to a variable
  named from the feature's name in camelCase (`sketch1`, `extrude1`,
  `plate`), de-duplicated with a suffix; a comment with the feature's name
  when it differs from the variable.
- **Inputs become the method's arguments** the way the API takes them: an
  expression input is its expression string (`'40 mm'`, `'width * 2'`), or
  `{ expr, paramName }` when it carries its own parameter name (`d1`) **and
  the whole design is emitted** — a run is replayed into a live design, where
  those model parameter names belong to the surrounding design and the
  recorded feature a "Keep both" leaves in place already has them, so a run
  leaves them out. An enum its value, a bool a boolean, a number input a
  number, `labels` a list, `code` a string; inputs equal to the method's
  default are left out. **A feature that reads a file (an import, a canvas
  image) is skipped with a comment**: a script can't carry the attachment, so
  there is no dangling ID (review fix).
- **References become handle expressions where a handle exists**, else
  `d.ref`: a profile of a recorded sketch is `sketch1.profileAt([x, y])` with
  a point inside that region (use the region's area centroid or an interior
  point of its boundary polygon, like the API's `profilesInside` logic), a
  whole-text reference is the sketch's text handle, a body of a recorded
  feature is `extrude1.body()`, a face, edge or vertex of a recorded feature
  is `extrude1.face('cap:end')` / `extrude1.edge(...)` when the name has that
  shape, and a construction feature is `plane1.constructionRef()`. **A
  reference to something made before the recorded run** (a face of an
  earlier feature, an origin plane, a stored profile) is emitted as it is
  stored: `d.origin.xy`, or `d.ref('face', 'extrude:f3:cap:end')`. Names
  that contain a recorded feature's ID are rewritten through the handle's own
  ID with a template literal (`` d.ref('edge', `e[extrude:${extrude1.id}:cap:end|...]`) ``),
  so the code works whatever IDs the run assigns (inside a Script feature
  they are `<script>.f<n>`).
- **Sketches are emitted as `d.sketch(plane, k => { … })`**: every entity with
  its stored (solved) coordinates, construction flag and `mode`/`rho` for
  splines, each assigned to a variable (`l1`, `c2`, `t1`); every constraint
  and dimension as the builder's calls on those variables, a named dimension
  with its `name`; projections are emitted as the entities they are with a
  comment (the solver holds them fixed, a script can't project); `text`
  entities with their string, font ID, size and alignment. Positions are
  already solved, so the script needs no solver (ADR-0070 §1).
- **Parameters** as `d.parameter(name, expr, { customizer })` in dependency
  order; configurations are not emitted (Deferred).
- Suppressed and hidden features keep those states through `d.suppress` /
  the API's visibility call where one exists; groups are emitted as
  `d.group` for runs that lie inside the selection.
- The output is formatted the way the repo's Biome config formats TypeScript
  (two spaces, single quotes, trailing commas) so a user who pastes it into
  a Script feature sees house style.

### 3. Round trip is the test

The emitted code, run through the runner's `Design` (and the script runner of
ADR-0070), must give the same document as the original **up to IDs and
names**: the same feature types and inputs, the same sketch geometry (every
entity's coordinates within 1e-9), the same constraints and dimensions, and,
recomputed, the same bodies (volume, box, face count). Every benchmark fixture
in `fixtures/benchmarks/*.extrudo` and the script fixture are round-tripped in
tests, which is also the proof that the API can express every feature.

### 4. Not stored, not a feature

The emitter is a pure function of the document; nothing new is stored. The
recorder's state (the start index) is session state in the app (slice 2),
and "Stop" opens the Script dialog with the code, offering to **replace** the
recorded features with the Script feature (one undo step; refused when a
feature after the run refers to them) or to keep both.

## Slices

1. **The emitter** (`@extrudo/api`): `emitScript`, the handle and reference
   rewriting, sketch emission, formatting; round-trip tests over every
   fixture; a `docs/api/emit.md` page; the CLI gets `extrudo script
   <file.extrudo>` that prints the design as a script (two lines in
   `packages/cli`).
2. **The app**: Record / Stop commands (Ctrl+K, the Solid tab's Script group
   beside the Script tool, a red dot in the status bar while recording), the
   Macro dialog (the code read-only with Copy, "Replace with a Script" and
   "Keep both"), "Export design as script…" in the File menu, e2e, docs.

## Rejected

- **Logging UI events or commands:** a command log would replay exactly what
  the user did, including undone and redone steps, dragged dimensions and
  cancelled tools; the document holds the result the user kept.
- **Emitting kernel-level geometry:** faces and bodies are derived; the
  script must add features.

## Deferred

- Configurations and attachments in the emitted code (a feature that reads an
  attachment is skipped with a comment, and a user font falls back to Inter); a
  script that keeps the original's IDs; emitting the macro for other languages.
- **Body names and appearance** (`doc.bodies`): the API has no call to name a
  body, so a round-tripped design's bodies come back as "Body1", "Body2"… with
  the default colour. The recompute test compares a body's box, volume and face
  count, not its name.

## Results: slice 1

The emitter is in, with `pnpm check` green: `emitScript(doc, options?)` in
`@extrudo/api` (`src/emit.ts` and `src/emit/{print,refs,sketch,context}.ts`),
the round-trip tests, `extrudo script <file.extrudo> [--features a..b]`, and
`docs/api/emit.md`.

**Every fixture round-trips.** The API test compares a document with the one
the emitted code builds, up to IDs and names, and the CLI test recomputes both
with the real kernel and compares body by body. Both hold for all eleven
benchmark fixtures and `fixtures/scripts/plate-holes.extrudo`: same feature
types and inputs, same sketch geometry and constraints and dimensions (to the
bit), and, recomputed, the same bodies (volume within 1e-6 relative, box to
1e-4 mm, face count). B9 (the two-thread bottle cap) is the slowest to emit at
**1.24 ms median** (6.1 ms worst of twenty runs, Node 24, warm); B2 0.79 ms,
B10 0.95 ms, the script fixture 0.14 ms.

What the emitted code does **not** keep, and why the tests say so:

- **Projections** (B2's Sketch2): a script cannot project (ADR-0031), so the
  projected curves are emitted as the ordinary entities they became, with a
  comment, and the comparison leaves `projections` out. The recompute is the
  same because nothing re-solves the sketch.
- **Per-entity construction flags**: the builder marks a whole sketch
  construction or none of it (`d.sketch`'s `construction` option); no fixture
  uses mixed construction, and the emitter emits the sketch-wide option when
  every curve is construction and a comment otherwise.
- **A feature input's own parameter name** (`d1`, … on a feature input) is
  **kept for a whole design**: the emitter writes the stored input as
  `{ expr, paramName }`, which the API's `plainInput` accepts, so an expression
  that reads `d1` still resolves after a round trip (B10's `d13`…`d26`, the
  review's `d1 / 2`). A **run** leaves it out, because it is added to a live
  design whose recorded feature already has that name (review fix 4). A
  sketch's named dimension keeps its name in either case (B2's `d5` chain
  round-trips).
- **Body names and appearance**: `doc.bodies` (the names the app writes when a
  body first shows, colours and opacity) is neither emitted nor compared, so a
  round-tripped design's bodies come back as "Body1", "Body2"… with the default
  appearance. This is in the Deferred list: the emitter can't set a body's name
  (the API has no call for it), so the loss is stated rather than tested.
- **Fingerprints, a dimension's label, `Feature.visible`, configurations and
  attachments**: out of the emitted code and out of the comparison (the ADR's
  Deferred list). A feature that reads an attachment (an import, a canvas image)
  is skipped with a comment, and a text with a user font keeps its string but
  falls back to the bundled Inter, with a comment naming the font (review
  fixes).

Decisions the brief and the ADR left open:

- **The design variable is `design`, not `d`.** The output is meant to be
  pasted into a Script feature, whose sandbox global is `design` (ADR-0070 §2);
  the ADR's own examples use `d` illustratively.
- **The writer is a small Biome-shaped printer** (`src/emit/print.ts`, 100
  columns, single quotes, trailing commas, last-argument expansion), because
  the emitter is pure and cannot call Biome at run time; the test runs
  `biome format` on every fixture's output and expects it unchanged.
- **A sketch entity is referenced from outside through a `SketchHandle`
  accessor** (`sketch.lines()[i].ref()`, `texts()[i].ref()`), since a builder
  variable lives inside the arrow's scope; `SketchHandle` gained
  `ellipses()`, `splines()` and `texts()` for that, and `SketchBuilder.text`
  gained `{ upright, height }` so the emitter can add the stored pair itself.
- **A body is emitted as `design.ref('body', \`${var.id}:0\`)`**, not
  `var.body()`: the kernel keys a body `<feature>:0` and that is what the stored
  reference is, while `FeatureHandle.body()` returns `<feature>` (a handles
  test pins that). Whether `.body()` resolves is a separate question; the
  emitter stays with the stored name.
- **A face role that embeds a sweep's or shell's source curve** is rebuilt from
  the sketch handle at run time (`\`side:${sketch1.lines()[2].id}\``), because
  that curve's ID changes with the run (B9's shell and threads).
- **`--features a..b`** takes indices or feature IDs; a run leaves the design's
  parameters out by default.

The API additions are small and documented on the pages:
`SketchHandle.ellipses/splines/texts`, `SketchBuilder.text`'s options,
`emitScript`/`EmitOptions`, and `docs/api/emit.md` (linked from the API index
and the CLI guide). The one thing a later change must keep: **a new feature or
input kind reaches the emitter through `meta({ input })` and the schema, and a
new reference kind needs a case in `emit/refs.ts`** — the emitter has no list of
its own.

**Review fixes** (from the review of slice 1, `ca75a33`/`c07d192`/`d34d554`):

- **An attachment can't travel in a script.** A feature with a `file` input
  (an import, a canvas image) is left out with `// Import1 reads an attachment,
  which a script can't carry: add it by hand.`, and references to it stay
  stored names (no dangling handle). A text whose font is
  `attachment:<id>` keeps its string and picks up the bundled Inter, with a
  comment naming the font. The old code emitted a dangling attachment ID, which
  either threw at the statement or produced a document the schema refuses.
- **Variable names are sanitised** (`variableBase`): JavaScript reserved words
  (a feature may be typed `import`), a leading digit, and the emitter's own
  `design` and `k` get a leading underscore, so `Design`, `New`, `4x4 grid`,
  `k` all declare.
- **The printer hugs a trailing object only when the earlier arguments are not
  objects or arrays**, matching Biome's rule; a renamed feature's
  `design.box({…}, { name })` now breaks every argument like Biome does.
- **A feature input's `paramName` is preserved** for a **whole design**
  (`{ expr, paramName }`); the API's `plainInput` accepts that plain object and
  keeps the name, and the round-trip comparison checks it, so B10's `d13`…
  `d26` and the review's `d1 / 2` evaluate after a round trip. **A run leaves
  it out**: it replays into a live design whose recorded feature (kept beside
  its Script by "Keep both") already has that name, so emitting it made two
  `d4`s and the Script error ("The name `d4` is used twice", `e2e/macro.spec.ts`).
  A sketch's named dimension is still emitted for a run, since it is what an
  expression inside the run reads.
- **A `file` input or an unknown input kind throws at emit time with the input
  named** (`inputExpr`), instead of crashing the printer or emitting a dangling
  reference.
- The low items: a conic with no stored `rho` keeps no `rho` (not `0.5`), and
  the tests add `labels` (a pattern's skip list), timeline groups, a `file`
  input and a suppressed feature to the corpus.

## Results: slice 2

The app records, stops and keeps macros (`apps/web/src/macro/`; `e2e/macro.spec.ts`).

- **Recording is session state.** `createMacroStore()` holds `recording: { from, base }`
  or nothing; the status bar shows a red dot and "Recording macro · 3 features"
  (`[data-macro-recording]`, the count follows the document); a reload or another
  project does not resume it. Undoing below `base` ends it with a notice.
- **A run starts at the marker, not at the end.** New features land at the
  timeline marker, so a design rolled back when Record is pressed (the Wall bracket
  template is) would make "the features after the start" the wrong ones. The
  recorder keeps `from` (the marker's index) and `base` (the timeline's length);
  the run is `features[from .. from + (length − base))`. At the end of the timeline
  the two are equal. Known limit: rolling the marker back *during* a recording
  and adding there makes the run the wrong slice; the brief's index-only form
  would have had the same problem, and storing feature IDs would be a later change.
- **Stop opens the Macro dialog** (`MacroDialog`, a `FloatingDialog`, region
  "Macro", `data-macro-dialog` = `ready`/`done`/`empty`): the code in the Script
  dialog's CodeMirror setup, read only (`CodeView` in `scriptEditor.tsx`, a lazy
  chunk; Tab leaves it), Copy (clipboard, toast "Copied"), "Replace with a Script",
  "Keep both" and Close. The emitter (`@extrudo/api`) is imported lazily too;
  the web app now depends on it (`check-boundaries.mjs` allows it for web).
- **Replace is one transaction**: the Script (`language: 'ts'`) is inserted at the
  first recorded feature's position, then the recorded features are removed last to
  first with `removeFeature`; any `CommandError` cancels the transaction and the
  dialog says why (`refusalMessage` words "Can't delete Extrude3: Fillet2 uses it…"
  as "Fillet2 still uses Extrude3: keep both, or move it."; the parameter case
  passes core's own message through). **Keep both** appends the Script
  **suppressed** and says so. After either the Script dialog is not opened.
- **Which refusal is reachable.** A feature that uses a recorded one is always
  later in the timeline, so it is always inside the run: through the UI a
  *feature* never refuses a Replace. What refuses is an expression outside the
  run that reads a recorded sketch's named dimension (a user parameter
  `twice = d1 * 2`), and the e2e covers that; the feature case is a unit test.
- **Export Design as Script…** (File menu, Ctrl+K, model mode) emits the whole
  design with its parameters and downloads `<design name>.ts` through
  `platform.files`, with a toast naming the file.
- **Tools and icons.** `recordMacro` and `stopMacro` are tools in Solid › Create's
  menu (two new icons, `record-macro`, `stop-macro`); the toolbar menu and
  `buildCommands` show Record while idle and Stop while recording
  (`CommandContext.macro`, `ToolbarProps.hidden`). None has a key and none is
  repeatable.
- **Proof.** The e2e records a sketch, an extrude and a fillet, Replaces them
  with one Script and gets the same body (size and face count, names aside: a
  script's body is a new body), one Ctrl+Z restores the three features, a
  recording of a box is kept beside its script suppressed and unsuppressing it
  makes one more body. The Macro dialog passes the axe audit in both themes.
