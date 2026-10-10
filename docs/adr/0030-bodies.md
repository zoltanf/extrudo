# ADR-0030: Bodies

- **Status:** Accepted, 2026-09-28.
- **Task:** P2-08 (Bodies; FR-VP-07's Bodies folder, FR-VP-03's styles).
  Code: `packages/core/src/document-commands.ts` (`updateBody` with
  `clear`, `nameBodies`, `newBodyNames`, `featuresReferring` for body
  references), `packages/core/src/history.ts` (`UndoHistory.amend`),
  `packages/core/src/stores.ts` (`DocumentState.amend`, `ModelState.doc`),
  `packages/core/src/remove.ts` (the Remove feature),
  `packages/core/src/schema.ts` (`BodyMeta.opacity`),
  `packages/kernel/src/features/bodies.ts` (`splitSolids`, `kernelRemove`),
  one call in `features/extrude.ts`, `recomputer.ts` (passes `doc`),
  `apps/web/src/shell/bodies.ts` (`bodyEntries`, `followBodyNames`,
  `createBodyActions`, `BODY_COLORS`, `BODY_OPACITIES`),
  `shell/BrowserPanel.tsx` (`BodyLeaf`, `AppearancePanel`, the folder
  badge), `shell/AppShell.tsx` (wiring, Delete in the model),
  `shell/tools.ts` and `design-system/icons/svg/remove.svg` (the chip),
  `viewport/silhouette.ts`, `viewport/Bodies.tsx` (opacity,
  `Silhouettes`), `viewport/Viewport.tsx` (`data-body-appearance`,
  `data-silhouettes`). Tests: `core` `commands.test.ts`,
  `history.test.ts`, `stores.test.ts`, `remove.test.ts`;
  `kernel/src/features/bodies.test.ts`, `recomputer.test.ts`;
  `shell/bodies.test.ts`, `viewport/silhouette.test.ts`;
  `e2e/bodies.spec.ts`.
- **Builds on:** ADR-0003 (commands, patches, transactions), ADR-0008
  (visual styles, seams hidden), ADR-0021 (browser menus, rename, eyes),
  ADR-0024 (`ctx.bodyId`, body access), ADR-0005 (names through
  booleans), ADR-0026 (the `body` selection kind), ADR-0028 (new bodies
  per solid; its open items on body metadata and split cuts).
- **Affects:** every feature that makes bodies (revolve, P2-07, uses the
  same `ctx.bodyId(n)` and should call `splitSolids` too), exports that
  pick bodies and write names and colours (P2-12's 3MF), later body
  features (combine, split body, move/copy: P3).

## Context

Until now a body's name was derived: "Body1", "Body2"… numbered in
timeline order among bodies without stored metadata, so removing Body1
turned Body2 into Body1, and a colour or a hidden eye stayed with an ID
while the name moved. P2-08 asks for real metadata, a browser folder that
renames, hides, colours and deletes bodies, deletion as a timeline
feature, a count, silhouettes in the line styles, and (from ADR-0028) an
answer to a cut that leaves one body in several pieces.

The constraints: the document is JSON and bodies are derived, so body
IDs come from the kernel (`<feature>:<n>`); every document change is a
deterministic command with patches; the number of bodies a feature makes
is known only after the kernel runs, and later edits (a sketch change, a
cut that now splits) create body IDs no command ever saw.

## Decision

### 1. When a body gets its name: amended into the step that made it

A body gets stored metadata (`doc.bodies[id]`, `{ name, visible: true }`)
**the first time a recompute of the current document shows it**. The
web app follows the model store (`followBodyNames`): when a result
arrives whose `ModelState.doc` is the document now in the store, every
live body without metadata is named in one `nameBodies` command, and that
command is **amended** into the latest undo step (`DocumentState.amend` →
`UndoHistory.amend`): its patches join that step's patches, its inverse
patches go in front of the step's. So:

- The name is stored in the step that made the body (Extrude's OK, a
  sketch edit that made an extrude split, a marker moved forward). Undo
  takes the body and its name away together; redo brings both back with
  the same name; nothing adds an undo step of its own ("Undo" never
  just un-names a body, which the next recompute would name again).
- Names are the lowest "Body<n>" that no stored entry uses
  (`newBodyNames`), **gone bodies included**, in timeline order. The
  browser shows the same name before it is stored (`bodyEntries` uses the
  same function), so nothing flickers.
- A result for an older document is skipped (`source !== doc`); the
  recompute of the current one follows and names what is still new.
- While a transaction is open with no step of its own (a sketch just
  opened), the change joins the enclosing level's latest step, so a
  cancelled transaction leaves it (it belongs to the step before). With no
  step anywhere (a document just opened, a template, an old file) the
  change is applied without an undo step: like loading, it has nothing to
  undo to. Autosave stores it like any change.
- Metadata of bodies that no longer exist is kept. A Remove rolled back,
  a suppressed feature brought back, a sketch edit undone: the body
  returns with its name, colour and eye.

`updateBody` stays the command for user changes (rename, eye, colour,
opacity; it creates metadata for a body that has none yet) and gains
`clear` (back to the default colour, opaque again), since a serialisable
payload can't say "set to undefined".

### 2. Deleting a body: the Remove feature

`remove` (core `removeBodiesFeature`, inputs `{ bodies: ref body[] }`,
at least one; kernel `kernelRemove`, `bodyAccess: 'write'`) outputs the
body set without the bodies it names, and fails ("The body to remove no
longer exists…") when one is missing. The browser's Delete (a row's key,
its menu) and Delete in the view with bodies selected insert one Remove
at the timeline marker for all of them (`BodyActions.remove`), named
"Remove1"…, a Modify chip with its own icon. It has no dialog yet (edit
means delete it and remove again). Removed bodies leave the selection.

Deleting a feature is now also refused while a later feature refers to a
body it made (`<feature>:<n>` body references in any `ref` input: a
Remove, an extrude's picked Bodies), like profile references (ADR-0021).

### 3. One body per solid; IDs of the pieces

`splitSolids(ctx, scope, output)` runs on an evaluator's result: every
body the feature made or changed (it has a naming table in `names`) that
holds several separate solids becomes one body per solid. **The largest
piece keeps the body's ID** (ties: the first in geometric order), so its
name, colour, eye and the references to it stay with the bulk of the
part; the other pieces get the feature's next free body IDs
(`ctx.bodyId(n)`, skipping IDs already in the output), in geometric
order (bounding-box centre by x, then y, then z). Each piece keeps the
face names of the whole (split faces keep their `#n`), edges and
vertices are named again (`deriveNames`), and pieces come right after
the body they came from. Bodies passed on unchanged are never looked at.
The whole compound goes back to the scope, unless the output still holds
it (a preview tool).

Extrude calls it once, around `operate`. New bodies were already one per
solid (ADR-0028 §5), so their IDs don't change and neither did the
108-case golden table. Revolve (P2-07) should wrap its operation result
the same way.

### 4. Appearance for v0.2: colour and opacity

`BodyMeta` has `color` (`#rrggbb`, absent: the theme's `body-default`)
and a new optional `opacity` (0.1…1, absent: opaque; no format bump).
The Appearance popover (right-click › Appearance…, anchored on the row's
colour dot) offers ten swatches (Default and the mid-tone category hues,
White, Charcoal; docs/05-brand.md §3.4) and four opacities (Opaque, 75 %,
50 %, 25 %). Each click is one undo step. A see-through body doesn't
write depth, so what is behind it shows; it still takes picks and
occludes picks behind it. Materials (roughness, metal) wait for a
renderer that makes them worth it; 3MF export (P2-12) gets names and
colours from here.

### 5. The browser

The Bodies folder lists live bodies in timeline order with a count badge
(`data-folder-count`). A row: colour dot, name (a button, `aria-pressed`
when the body is selected), eye. A click goes through the view's current
`ModelSelect` as `{ kind: 'body', id }`: the session's selection, or an
open feature dialog's field (an extrude's Bodies), Shift/Ctrl toggling;
the pointer on a row sets the hover, so the view tints the body. F2
renames in place (`RenameField`, as for sketches), Delete removes. The
right-click menu matches the feature menus: Rename, Hide/Show,
Appearance…, Delete. The folder's eye hides or shows every body in one
undo step.

### 6. Silhouettes

In the wireframe and hidden-edge styles, each body draws the silhouette
of its curved faces for the current camera (`viewport/silhouette.ts`):
the zero line of `f = n · (eye − p)` (perspective) or `−n · d`
(orthographic) over the mesh's smooth node normals, one segment per
triangle whose nodes change sign, between the two points where `f`
crosses zero along its edges. Flat faces are skipped up front
(`curvedFaces`: faces whose node normals differ). It is a contour line,
so it needs no edge adjacency and is smooth on spheres and cones, and it
crosses seams (where OCCT duplicates nodes) without gaps. `Silhouettes`
in `Bodies.tsx` recomputes in the frame loop when the camera's matrix or
projection changed (one pass over the curved faces' triangles into a
preallocated buffer) and draws with the body's edge materials, hidden
parts faint in the hidden-edge style.

### 7. Test hooks

The Viewport region's `data-body-appearance` ("Bracket:#5b7cff:0.5",
name:colour-or-`default`:opacity per drawn body) and `data-silhouettes`
(silhouette segments drawn, absent when none); the browser's
`[data-folder-count]` badge and `[data-body]` rows.

## Consequences

- Names are stable and part of the document; `doc.bodies` grows by one
  entry per body ever made (a few bytes each). A long-gone body's name
  stays taken, so a new body after Body1 was removed is Body2, not Body1
  (Fusion reuses; we prefer never to show two different bodies under one
  name in one session's history).
- Amending is a new, narrow history operation: only body naming uses it.
  A future automatic follow-up of the same kind (default appearance of an
  imported body) can reuse it.
- One Remove per delete action. Removing and restoring several times
  adds chips; the user can delete the Remove chip to bring the body back.
- The e2e suite gained `e2e/bodies.spec.ts` (rename surviving a reload,
  eye, colour and opacity with undo, Delete through a Remove and undo,
  the menu's Delete, the badge, a split cut making two bodies with
  stable names, silhouettes in wireframe and hidden edges following the
  camera).

## Rejected

- **Naming bodies in the command that creates the feature** (the dialog's
  OK writes `doc.bodies` from the preview's result). Covers only dialog
  OKs: sketch edits, parameter changes, undo and suppression also create
  body IDs (a cut that now splits), which would still need a fallback,
  and a preview may be stale when OK is pressed.
- **A separate undo step "Name bodies"** after each recompute. Undo would
  first remove the names, and the next recompute would add them again: an
  undo that does nothing, forever.
- **Writing names outside the history** (a "silent" document change).
  Breaks "every change is a command"; and undo would leave names of
  bodies that no longer exist lying around with no way to tell which step
  made them. (Only the no-step-at-all case at load does this, and it is
  still a command.)
- **Stable derived names** (from the feature: "Extrude1", "Extrude1 (2)").
  No stored entry, so renaming, colours and eyes still need one; and
  renaming the feature would rename the body.
- **Split pieces keeping the first ID in geometric order** instead of the
  largest. A small chip cut off one end would take the part's name and
  colour whenever it happened to lie at lower x.
- **Piece IDs derived from the parent** (`<body>~<k>`): two features
  splitting the same body would make the same ID. **IDs with a `/`**
  would be read as feature dependencies by the engine
  (`featureDependencies`).
- **Deleting a body by writing to the document** (a `hidden: true` or a
  deleted flag in `doc.bodies`). The body would still exist for later
  features (a through-all would still go through it); a Remove takes it
  out of the model at a point in the timeline, like Fusion's.
- **Silhouettes from mesh edges** (edges between a front- and a
  back-facing triangle). Needs adjacency across duplicated seam nodes and
  zig-zags along a sphere's outline; the contour line needs neither.
- **Silhouettes in the shaded styles.** Shading already shows the
  outline, and "Shaded with edges" means B-rep edges.
- **Materials (roughness, metalness presets)** for "appearance": little
  to see under the current lighting and nothing for 3MF; opacity helps
  see inside a part.

## Open

- ~~A Remove dialog (edit which bodies it removes); the Remove chip opens
  nothing yet.~~ Done in P3-17 (amendment below).
- ~~Custom colours (a colour field) beyond the swatches.~~ Done in P3-17
  (amendment below).
- Piece IDs shift when an earlier participant of the same feature splits
  into a different number of pieces (a multi-body cut); names follow the
  IDs.
- Silhouettes are recomputed per frame of a camera move on the UI
  thread; fine for Phase 2 models, measure with P2-15 on big meshes.
- ~~Revolve (P2-07) should call `splitSolids` on its result.~~ Done: revolve
  calls `splitSolids`.

## Amendment (P3-17)

- **A custom colour beside the swatches.** Appearance has the system colour
  picker and a hex field below the swatches. **No schema change**:
  `BodyMeta.color` was always any `#rrggbb`, the swatches only a choice of
  values, so there is no new key, no migration and no format version.
  The picker commits on its native `change` (when the choice is made), not
  on every `input` while it is dragged, so a pick is one undo step; the
  hex field commits on Enter or blur, takes `#rgb` or `#rrggbb` with or
  without `#` (`parseBodyColor`), stores lower case and marks anything else
  invalid without committing. While the colour is none of the swatches
  (`isSwatch`), no swatch is checked and the custom picker is outlined
  (`data-custom-colour`).
- **A Remove dialog** (`features/remove.ts`): one selection field, Bodies,
  named like the input, so the framework's default mapping reads and writes
  it. Registering it makes the Remove chip and Fix References open it (a
  lost body is taken out of the field and the field waits for a pick), and
  it brings a command of its own, "Remove Bodies" (Solid › Modify, Ctrl+K;
  no toolbar tile, no key), that makes a Remove from picked or pre-selected
  bodies, as Delete does at once. No new feature type: it is the existing
  `remove`. The preview is the model without the bodies.

**Amendment (2026-10-09): the face material is keyed on its transparency
mode.** A body drawn opaque and then made see-through stayed opaque: three
bakes `#define OPAQUE` into the shader program while `transparent` is false,
`WebGLRenderer` doesn't notice the prop change (it compares `material.version`)
and R3F never sets `needsUpdate`. `Body`'s `<meshStandardMaterial>` has
`key={opacity < 1 ? 'see-through' : 'opaque'}`, so a flip builds a new material
(and back again gets a fresh opaque one with `depthWrite`). Autosave's
thumbnail (a render target without tone mapping) recompiles every program and
hid the bug after about a second, so `e2e/bodies.spec.ts` keeps it from drawing.

**Amendment (2026-10-09): ghost bodies, a third display state.** The owner
asked for a state between shown and hidden: a **ghost** body is drawn as a
vague grey shape at about 30 % opacity and **affects nothing else** — no
picking, no selection highlight, no Fit, no silhouettes, no print or thickness
checks, no export default. Sketches, construction features, origin rows and
folders keep their two-state eyes.

- **Stored in the document, undoable**, like hiding. `BodyMetaSchema` gains
  `ghost: z.boolean().optional()`, stored **only as `true` and only with
  `visible: false`**. So every reader that already checks `visible` (picking,
  Fit and bounds, Print Info, the wall-thickness and overhang checks, box
  selection, Measure, export defaults) treats a ghost as hidden, which is
  exactly right; and an older Extrudo opens the file and shows the body
  hidden (ADR-0050's lenient reading leaves the unknown key out). No
  migration, no format version bump.
- **`updateBody` keeps the pair** (core's `document-commands.ts`): whenever
  the result is `visible: true`, `ghost` is deleted; whenever `ghost: true`
  is set, `visible` becomes `false`; `ghost` joins `ClearableBodyField`, so
  hiding a ghost passes `clear: ['ghost']`. No caller can store the invalid
  pair. A pure `bodyDisplay(meta?)` (`'shown' | 'ghost' | 'hidden'`, absent
  meta `'shown'`) names the three states and is exported from core.
- **The app** (`shell/bodies.ts`): `BodyActions.setDisplay(ids, display)`,
  one undo step for several ids and labelled "Show body" / "Ghost body" /
  "Hide body" (plural for several). `setVisible` stays two-state (shown or
  hidden) and is what the Bodies folder's eye calls; showing all clears
  ghosts too.
- **The browser row's eye cycles shown → ghost → hidden** (`BrowserPanel.tsx`):
  `Eye` while shown, `EyeDashed` while a ghost, `EyeOff` while hidden, the
  label saying what the click does next ("Show as ghost", "Hide", "Show").
  The row carries `data-body-display`; its text is dimmed for ghost and
  hidden alike. The body's browser menu and the marking menu's list entry
  (`contextEntries.tsx`) are built from `BodyActions`, so they offer the
  states the bodies are not all in as entries `showBody` / `ghostBody` /
  `hideBody` ("Show Body" / "Show as Ghost" / "Hide Body", plural "Bodies");
  a mixed selection offers all three. No new command was needed: the marking
  menu's list reuses `BodyActions` directly (`MarkingEntry.id` becomes the
  `data-marking-entry`).
- **Drawing** (`viewport/GhostBodies.tsx`): a small separate component, never
  through `Body`, so none of the selection, analysis or section-cap machinery
  touches it. Faces are one flat grey (`--x-body-ghost`, both themes) through
  `MeshStandardMaterial` at opacity 0.3, `transparent` from creation (never
  toggled — the opacity fix above), `depthWrite: false`; edges at about a
  quarter of the edge colour's alpha; clipped by the section planes with no
  section cap. `PickScene` gets only shown bodies, so a ghost takes no picks
  and draws no highlight. `data-ghost-bodies` on the Viewport region names
  the ghosted bodies (absent when there are none). The pure parts
  (`ghostBodies`, `ghostBodiesSummary`) live in `viewport/bodyGhosts.ts`,
  so unit tests don't load React Three Fiber.

Rejected: a `display: 'shown' | 'ghost' | 'hidden'` enum replacing `visible`
(needs a migration, and older readers would refuse or mis-read the file);
view state outside the document (the owner treats it like hiding, which is
stored); a "ghost" command in the command registry (the menus are built from
`BodyActions`, so an entry is enough, and there is no toolbar tile or key).
