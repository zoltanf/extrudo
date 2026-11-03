# ADR-0126: Annotations: numbered notes on geometry, for people and agents

- **Status:** Proposed, 2026-11-03 (the owner asked for the spec, display
  options and the slices; S1 may start before the display option is chosen)
- **Task:** P6-23 (`docs/03-roadmap.md`).
- **Builds on:** ADR-0003 (commands, undo), ADR-0005 (topological naming,
  `GeomRef`, fingerprints), ADR-0068 (the document API), ADR-0069 (the CLI),
  ADR-0087 (the desktop MCP server and its skill), the named-views and joints
  collections (`doc.views`, `doc.joints`) as the model for a document-level
  list.
- **Schema change:** two new optional top-level keys, `annotations` and
  `annotationCounter` (section 1). No `formatVersion` bump: older readers drop
  the keys and report them in `LoadResult.dropped`.

## Context

A person modelling with an agent over the MCP server has no way to point at
something. "The hole on the left" is ambiguous; a face name such as
`extrude:f3:side:l2` is nothing a person types. Other CAD tools solve this with
callouts, balloons and comments pinned to geometry. We want the same, in both
the 3D view and sketches, with one property the others don't have: **every
annotation has a short, unique, running number (#1, #2, …)**, so that "make the
hole at #3 M4" is a complete instruction. The agent reads the annotations,
resolves #3 to the geometry it is on, and acts; it can also leave annotations
of its own ("#7: this wall is 0.8 mm, thinner than the nozzle").

Annotations must survive edits (they follow the geometry they are on through
the topological-naming service), be hideable (people hide them for screenshots
and when they clutter), and be plain document data (saved in the `.extrudo`
file, undoable, visible to the CLI and the API).

The word "annotation" already names the sketch dimension labels and constraint
glyphs in one place (`apps/web/src/sketch/tools/annotationMenu.tsx`,
`useAnnotationMenu`, ADR-0042). That file is renamed to `glyphMenu.tsx`
(`useGlyphMenu`) in S1 so the word means one thing.

## Decision

### 1. The model

Two new optional keys on the document (`packages/core/src/schema.ts`,
`DocumentSchema`), after `joints`:

```ts
annotations?: Annotation[]       // absent when there are none
annotationCounter?: number       // the highest number ever given; absent until the first
```

```ts
interface Annotation {
  id: AnnotationId;              // uuid, newId() in the caller (brand in core/src/ids.ts)
  number: number;                // int ≥ 1, unique in the document, never reused
  text: string;                  // 1..2000 characters, plain text, may contain newlines
  anchor: AnnotationAnchor;
  offset?: [number, number];     // the bubble's offset from the anchor in screen px; default [28, -28]
  hidden?: true;                 // this one annotation is not drawn (undoable, saved)
  done?: true;                   // ticked off; drawn muted, listed last
}

type AnnotationAnchor =
  | { kind: 'model'; ref: GeomRef; at: Vec3 }           // on geometry, world mm
  | { kind: 'free'; at: Vec3 }                           // a point in space, world mm
  | { kind: 'sketch'; sketch: FeatureId; at: Vec2; entity?: SketchEntityId };  // sketch mm in that sketch's frame
```

- `model.ref` is a `GeomRef` **with a fingerprint**, of kind `face`, `edge`,
  `vertex`, `body`, `plane`, `axis`, `point` or `sketchEntity` (model-mode
  form `<sketch>/<entity>`). Never an `index:` ref.
- `model.at` is where the annotation touches the geometry (the clicked point
  on a face, a point on an edge, the vertex itself), so a face annotation can
  sit on the feature of interest, not at the face centroid.
- Document-wide rules (`DocumentSchema`'s `superRefine`): `number` unique (a
  row in the `unique` table), every `number ≤ annotationCounter`, every
  `sketch` anchor names an existing sketch feature (`reportAnnotations`,
  like `reportJoints`).
- Every key, enum value and anchor kind is documented in
  `docs/file-format.md` (new section 4.10 after joints; the top-level key
  table; the "additive changes" list), and
  `packages/storage/src/file-format-doc.test.ts` gets `...keys(AnnotationSchema)`
  and the anchor schemas in its `words` list.
- `restoreVersion` (`document-commands.ts`) copies every top-level field by
  name: add `annotations` and `annotationCounter` (and `components` and
  `joints`, which it misses today; note the fix in the report).

### 2. Numbering

`number = (draft.annotationCounter ?? 0) + 1`, and the counter is set to it in
the same recipe. Deleting an annotation never frees its number; undo restores
the annotation with its number and the counter as it was (the counter is in
the document, so undo keeps it consistent). Numbers are shown as **#n**
everywhere a person reads them (lists, the status bar, agent answers) and as
the bare digits inside the marker badge.

### 3. Commands (`packages/core/src/annotations.ts`, exported from `index.ts`)

| Command | Type | Payload | Rules |
|---|---|---|---|
| `addAnnotation` | `annotation.add` | `{ id, text, anchor, offset? }` | assigns the number (section 2); refuses an empty text, an unknown sketch, an `index:` ref |
| `updateAnnotation` | `annotation.update` | `{ id, changes: { text?, offset?, hidden?, done? } }` | label "Edit annotation"; refuses an empty text |
| `moveAnnotation` | `annotation.move` | `{ id, anchor }` | re-anchors (drag onto other geometry, the agent's `anchor` edit); keeps the number |
| `removeAnnotation` | `annotation.remove` | `{ ids }` | label "Delete annotation(s)"; deletes `annotations` when the list empties, keeps the counter |

Cascades, in the commands that already exist:

- `removeFeature` of a **sketch** feature removes that sketch's `sketch`
  anchored annotations in the same recipe (undoable together). It is not
  refused because of annotations.
- `removeFeature` of any other feature leaves `model` annotations alone: they
  become **detached** at the next recompute (section 4), which is how a person
  sees that the note lost its subject.
- `removeFromSketch` / `entityRemoval` clear `entity` on annotations anchored
  to a removed entity; the annotation stays at its last `at` in that sketch.
- `remintFeatures` (`core/remint.ts`) rewrites `anchor.ref.id` and
  `anchor.sketch` like any other ref, so inserting at the marker keeps the
  anchors.

A recompute is scheduled on every document change, but annotations are in no
feature's cache key (like joints), so an annotation edit recomputes nothing.

### 4. Where an annotation is drawn: resolution at the marker

The kernel resolves `model` anchors after each recompute, in the pass that
resolves joints (`RecomputeEngine`, `engine.ts` around the `joints` block),
against the bodies at the marker, with `resolveRef` (exact name, related
name, fingerprint ≥ 0.6, in that order) and returns

```ts
interface AnnotationReport {
  id: AnnotationId;
  status: 'ok' | 'moved' | 'detached';   // moved = resolved by fingerprint or related name (warning)
  at?: Vec3;                              // where to draw it now, world mm
  normal?: Vec3;                          // the face normal at `at` when the ref is a face
  resolved?: { ref: GeomRef; body: BodyId };  // the current name and body, for the agent
}
```

- The drawn point is `anchor.at` shifted by the fingerprint delta: `at +
  (now.fingerprint.at − stored.fingerprint.at)` for a face, edge or body, the
  vertex position itself for a vertex, the point for `point`, and the sketch
  frame's transform of `anchor.at` for a `sketchEntity`. So a note on a hole's
  rim follows the hole when a parameter moves it.
- `detached`: nothing resolves (the face is gone, the feature was deleted,
  the marker is before the feature). The marker is drawn hollow and dashed at
  the stored `anchor.at`, the text is kept, and the status bar says
  "Annotation #n lost its geometry: drag it onto something or delete it."
- `free` and `sketch` anchors need no kernel: the UI places them (a sketch
  anchor through the sketch feature's frame, `sketchToWorld`; with `entity`
  set, shifted by that entity's reference point since creation: a point's
  position, a line's midpoint, a circle's or arc's centre, a text's anchor).
  The reference point at creation is stored implicitly: `at` is the offset
  from it, not an absolute, when `entity` is set.
- The model store exposes `annotations: Record<AnnotationId, AnnotationReport>`
  next to `joints`; the overlay reads it.

### 5. Visibility

Two layers, both existing patterns:

- **Global, per user:** `ViewportSettings.annotations: boolean` (default
  true), persisted with the other viewport preferences (interface, defaults,
  setter, both lists in the persisting subscribe). Shown as the eye of a new
  **Annotations** folder in the browser (below Analysis), as a `Notes` switch
  in the sketch palette's Show section, and as a `toggleAnnotations` command
  (App menu › Toggles; no default key).
- **Per annotation, in the document:** `hidden: true` (per-row eye in the
  folder, "Hide" in the marker's menu), undoable like `Feature.visible`.

Snapshots and thumbnails never contain DOM overlays, so annotations are not in
them by default; the agent's `screenshot` tool gets an `annotations` option
(S4) that composites the badges onto the PNG.

### 6. The marker and the tool (3D view, S2)

The display option is the owner's choice (section "Display options"); the
mechanics are the same for all of them:

- A DOM/SVG overlay `AnnotationsOverlay` (`apps/web/src/annotations/`), a
  child of `DialogViewport` next to `MeasureOverlay`, z-[4], projecting with
  `viewProject` every frame (imperative `store.subscribe` + `style.transform`,
  the `ViewCubeView` pattern, so many markers don't re-render React per
  frame). Buttons carry `data-view-passthrough=""` so the wheel and the
  middle/right buttons still orbit. Behind the camera: not drawn.
- The **badge**: a 20 px circle with the number, accent colour, white digits;
  `done` muted, `detached` hollow and dashed, selected with a ring, hovered
  brighter. A **leader** (1 px SVG line) from the anchor point to the badge
  when `offset` is non-zero; a 4 px dot at the anchor point.
- The **bubble**: the text in a `rounded-control border border-line
  shadow-raised` box (the dimension-label styling), wrapped at 36 ch, with
  the number as a `#n` prefix. When it is shown depends on the option.
- **Interaction:** click selects (`SelectionItem { kind: 'annotation', id }`,
  added to `SelectionItem.kind`, `PICKED`, `NOUNS`, `itemLabel`,
  `selectionKey`, `pruneSelection`); Delete removes; double-click edits the
  text in place (a `textarea` with Enter to commit, Shift+Enter for a
  newline, Esc to cancel); drag moves the badge (`offset`, one undo step);
  drag the anchor dot onto other geometry re-anchors (`moveAnnotation`;
  S4). Right-click: Edit, Hide, Done, Delete.
- **The Annotate tool** (`id: 'annotate'`, Inspect tab after Measure, key
  `N`, tooltip clip per ADR-0052). While active: hovering highlights what the
  click will attach to (face, edge, vertex, body, plane, axis, point, a sketch
  curve); a click on geometry creates a `model` annotation at the hit point
  (`pickStack` depth → world point; the ref from `kernel.reference(body,
  kind, index)` with its fingerprint), a click on nothing creates a `free`
  annotation on the grid plane under the pointer, and the text editor opens
  at once with the number already given. Esc leaves the tool. The tool stays
  active for the next annotation until Esc, like Measure.
- The **Annotations folder** in the browser lists `#n  first line of the
  text`, per-row eye (hidden) and a tick (done), click selects and looks at
  it (`lookAtSelection`), double-click edits; the folder's own eye is the
  global toggle; its menu has "Delete all done".

### 7. Sketch mode (S3)

- In an open sketch the overlay draws that sketch's `sketch` annotations
  (through the frame) **and** the model's other annotations, both subject to
  the global toggle; other sketches' annotations only when their sketch
  feature is visible.
- The Annotate tool in the sketch tab (key `N` there too): a click on a
  sketch point, curve or text anchors to it (`entity`), a click on empty
  plane makes a free sketch annotation at that sketch position.
- In model mode a sketch's annotations are drawn through the sketch plane
  when the sketch feature is visible, like its curves.

### 8. The agent, the API and the CLI (S1)

**MCP tools** (`apps/web/src/agent/schemas.ts`, `tools.ts`; all document
changes through `change()` as one `Agent: …` transaction):

| Tool | Input | Answer |
|---|---|---|
| `list_annotations` | `{ includeDone?: boolean }` | `[{ number, text, done, hidden, anchor }]`, where `anchor` is agent-readable: `{ kind, status, at, normal?, face?: '<name>', edge?, vertex?, body?: '<feature>:<n>', feature?: '<id>' (the feature that made the face), sketch?, sketchEntity?: '<sketch>/<entity>' }`, so the answer can be pasted into `add_feature`/`edit_feature` refs |
| `add_annotation` | `{ text, anchor }` with `anchor` one of `{ face: '<name>' }`, `{ edge: '<name>' \| edgeBetween: [f, f] }`, `{ vertex }`, `{ body: '<feature>:<n>' }`, `{ sketchEntity: '<sketch>/<entity>' }`, `{ at: [x, y, z] }` (free), `{ sketch: '<id>', at: [x, y] }`; `at` on a geometry anchor optional (default: the fingerprint centroid) | `{ number, id }`; refuses an unresolvable name with the input path (`resolveBodyRefs`-style check against the computed model) |
| `edit_annotation` | `{ number, text?, done?, hidden?, anchor? }` | the annotation |
| `remove_annotation` | `{ numbers: number[] }` | `{ removed }` |

- `get_design`'s summary gets `annotations: [{ number, text, status }]`
  (short, every call), so an agent sees them without asking.
- `SKILL.md` gets a section "Annotations (#n)": the person may say "#3";
  call `list_annotations`, use the `face`/`edge`/`body` names from the
  answer as references; leave notes with `add_annotation` and tick them
  with `done` when the person agrees; never delete a person's annotation
  unasked. `references/examples.md` gets one worked exchange (parsed and run
  by `skill.test.ts`). `references/tools.md` is regenerated.
- **API** (`packages/api/src/design.ts`, hand-written like `joint`):
  `design.annotate(text, anchor, options?)` → `AnnotationHandle { number,
  id, text, setText, done, remove }`, `design.annotations`,
  `design.annotation(number)`. `ids.ts` gets the `n` prefix (`IdKind`,
  `PREFIX`, `StoredIdDocument`), `generate.ts`'s `RESERVED_NAMES` the
  names, `emit.ts` emits them, `restricted.ts`'s `REFUSED_METHODS` refuses
  them in scripts ("a script can only add features"). `docs/api/README.md`
  gets a short section (its `ts` blocks compile in `docs.test.ts`).
- **CLI:** `extrudo info` prints an `annotations` list (number, text, status)
  in text and `--json`; `set` keeps them; `docs/cli.md` updated.

### 9. Slices

| Slice | What | Done when |
|---|---|---|
| **S1 Model and agents** | Sections 1–4 (schema, ids, commands, cascades, remint, restoreVersion, kernel resolution and report, model store), section 8 (MCP tools, summary, skill, API, CLI), `glyphMenu` rename, file-format doc, ADR digest, changelog line, roadmap tick | unit tests for every command and rule, `tools.test.ts` + `tools.kernel.test.ts` cases (a face annotation follows a parameter change; a deleted feature detaches it), `skill.test.ts` green with the new example, `pnpm check` green, CI green by SHA |
| **S2 3D view** | Sections 5–6 in the chosen display option: overlay, tool, selection kind, folder, toggle, in-place editor, context menu, `N` key, tooltip clip | `e2e/annotations.spec.ts`: add on a face, number shown, text edited, hidden by the eye, follows a parameter change, detached after deleting the feature, deleted with Delete; `docs/agent/e2e-notes.md` heading; `docs/04-ui-spec.md` section; `docs/guide/` page |
| **S3 Sketch mode** | Section 7 | the e2e spec extended: an annotation on a sketch point follows the point; shown in model mode through the plane |
| **S4 Polish** | re-anchor by dragging the anchor dot; `screenshot { annotations: true }` composites the badges; "Delete all done"; a `.extrudo` example with annotations in `fixtures/examples` | e2e for re-anchoring; `tools.test.ts` for the screenshot option |

S1 can start now; S2 waits for the display option.

## Display options (the owner's choice)

All options share the badge (numbered circle at or near the anchor), the
leader and the browser folder; they differ in **when the text is visible**.

1. **Pins: text on hover or selection.** Only badges are on screen; hovering
   or selecting a badge opens its bubble; double-click edits. Least clutter,
   the numbers are what people and agents talk about anyway. A `Show text`
   entry in the folder menu pins every bubble open for a review pass.
   **Recommended.**
2. **Callouts: text always visible.** Every annotation is a badge plus a
   bubble, placed at `offset` and draggable. Reads like an engineering
   drawing and needs no interaction, but ten notes cover the model; the
   global toggle becomes the main way to see the part.
3. **Pins plus panel.** Badges only in the view, the text only in the
   Annotations folder (and the status bar on hover). Zero view clutter, but
   the eye has to travel between the model and the panel, and the folder is
   hidden with the browser.

Sub-choices (defaults in bold, change by number): badge colour **accent
blue** / amber "sticky"; badge shape **circle** / rounded tag; a `done`
annotation **muted grey** / hidden by default.

## Rejected

- **Storing sketch annotations inside `sketchData`.** It would change the
  sketch feature's cache key and recompute everything downstream on every
  note edit, and sketch data is geometry. A top-level list with a `sketch`
  anchor keeps notes out of every key.
- **Numbers as `max + 1`.** Reuses a number as soon as the latest annotation
  is deleted, which is exactly when an agent and a person disagree about
  what "#5" is. A stored counter costs one optional key.
- **Mesh-index anchors.** Valid only for the current mesh; the naming service
  with fingerprints exists for this.
- **Drawing markers in three.js** (sprites or glyph curves). DOM markers are
  crisp, accessible, themed, and every existing label in the app is DOM;
  snapshots lose them, which the `screenshot` option covers where it matters.
- **A per-annotation `visible` in the viewport store** (not saved). People
  hide specific notes on purpose and expect it to stay hidden after a reload
  and to be shared with the file.
