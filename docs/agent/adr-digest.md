# ADR digest: what each decision means for a change

Moved out of `CLAUDE.md` on 2026-10-12. One paragraph per ADR, in the order the work was done, with the rules a change must keep. The ADRs in `docs/adr/` are the full record; search this file (`grep -n "ADR-0047"`) for the one you touch.

**Status (2026-10-07):** Phase 0 is done (P0-01 to P0-09); Phase 1 is
done (P1-01 to P1-15, v0.1 exit met: benchmark B1 passes end to end in
`e2e/benchmark-b1.spec.ts`). Phase 2 has started: P2-01 (recompute
engine), P2-02 (sketch → kernel), P2-03 (3D selection), P2-04
(topological naming), P2-05 (feature dialogs), P2-06 (extrude), P2-07
(revolve), P2-08 (bodies), P2-09 (sketch on face, Project), P2-10
(primitives), P2-11 (timeline v2), P2-12 (STL, 3MF, STEP export),
P2-13 (measure and inspect), P2-14 (version history), P2-15 (WASM
size and startup, offline precache), P2-16 (file-format spec,
`docs/file-format.md`) and P2-17 (benchmarks B2 and B3 as e2e specs and
fixtures) are done. Phase 3: P3-01 (fillet), P3-02 (chamfer), P3-03
(shell), P3-04 (hole), P3-05 (construction geometry), P3-06 (combine,
move/copy, mirror), P3-07 (patterns, mirrored features), P3-08 (press/pull,
offset face, then split body, scale, draft: both halves), P3-09 (section
analysis), P3-10 (3D-print aids), P3-11 (marking menu, context menus),
P3-12 (onboarding), P3-13 (hardening), P3-14 (benchmarks B4 to B7), P3-15
(public release prep, ADR-0054: done except the owner's release steps),
P3-16 (notification history) and P3-17 (polish, both parts) are done: **Phase 3 is
complete** (version 0.3.0). Phase 5 is **complete**: P5-01 (the public document
API, `packages/api`, its generated reference and the site's `/docs/api/` pages,
ADR-0068), P5-02 (the Script feature, the QuickJS sandbox and the app's editor,
ADR-0070), P5-03 (the headless CLI, `packages/cli` and the `extrudo` command,
ADR-0069), P5-04 (OpenSCAD import, `packages/openscad`, both slices, ADR-0071),
P5-05 (macro recording: the emitter and the app's Record, Stop and Macro dialog,
ADR-0073) and P5-06 (the wall-thickness check, ADR-0072). Phase 4: P4-01 (sweep, loft, coil), P4-02
(modeled threads), P4-03 (sketch text, bundled fonts), P4-03b (user fonts
as attachments), P4-04 (emboss, deboss), P4-05 (control-point splines,
conics), P4-07 (customizer, configurations), P4-08 (print tolerance,
slicer hand-off), P4-09 (timeline groups, linked folders) and P4-10 (rib/web,
variable-radius fillet) are done; P4-11
(benchmarks B8–B10) is **done** on 2026-10-04 — B9 (the threaded bottle cap and
thread adapter), B8 (the name tag) and B10 (the cable chain link) — and P4-06
(import: drawings into a sketch, STEP as a base body, mesh bodies with
manifold-3d booleans, canvas images) is **done** on 2026-10-05, all five slices
(ADR-0066). **Phase 4 is therefore complete apart from P4-12's backlog**, of
which the hardening (ADR-0067), Print Info's walls/infill/cost, fillet and
chamfer depth, the pattern skip list and handles, primitives placement and the
**construction backlog (ADR-0040's amendment, 2026-10-06)** and **Project's
backlog** (silhouettes of every surface, vertices and bodies, Intersect, Include:
ADR-0031's amendment, 2026-10-06) are done. Phase 6: P6-01 (the Electron
desktop app, four slices and the Homebrew cask, ADR-0075), P6-02 (the slicer
launch), P6-03 (the plugin API, four slices, ADR-0077) and P6-07 (auto-project,
ADR-0074) and P6-06 (the docs site, tutorials and examples, ADR-0080; done
2026-10-09) and P6-05 (components and as-built joints, ADR-0081; done
2026-10-11) are done; P6-04 (i18n) is deferred (owner, 2026-10-11: English only for now).
ADR-0001 chose
our own trimmed libcascade build with a small C++ facade that owns OCCT memory
(`docs/adr/0001-geometry-kernel.md`); P0-09 built it in `packages/kernel`
(facade, TS `Kernel`, worker, `KernelClient` with crash restart, memory test,
debug page at `#/debug/kernel`). The `delete()` leak behind the facade
(taucad/opencascade.js#40) is fixed in libcascade 3.1.0, and we build with
toolchain 3.1.0 since 2026-10-16 (ADR-0001's addendum of that day): `delete()`
frees for real, so never delete a handle OCCT still references. The facade
stays the only binding (ADR-0037); the only OCCT `delete()` in
`packages/kernel/src` is the facade's own in `Kernel.dispose()`, after
`releaseAll()`. ADR-0002 chose planegcs from our own WASM build, one solver system per independent sketch component
(`docs/adr/0002-sketch-solver.md`). ADR-0003 (P0-06) set the document model in
`packages/core`: strict zod schema, migrations on raw JSON, deterministic
commands with Immer patches, nested undo transactions, vanilla Zustand stores.
ADR-0004 (P0-07) set the expression language: Pratt parser in
`packages/core/src/expr/`, length/angle dimensions, plain numbers take the
context unit, parameter graph with cycle paths; `<ExpressionInput>` and the
Parameters dialog live in `apps/web/src/parameters/`. ADR-0007 (P0-04) set the
design system (`apps/web/src/design-system/`: tokens → Tailwind v4, Radix
wrappers, icon pipeline) and the shell (`apps/web/src/shell/`), which opens a
sample document in memory until storage exists. ADR-0008 (P0-05) set the
viewport (`apps/web/src/viewport/`): Z-up world in mm, our own camera
controller (target + quaternion + size, both projections), mouse presets (Spindle the
default, Crank, Glide, Blender, Trackpad; Shift swaps orbit and pan in Spindle and Crank; in
the app menu's Mouse controls ▸ since R3-03/R3-04, ADR-0008's amendment) as
tables, shader grid, CSS 3D ViewCube, a viewport store with display settings
as preferences. **Named views (ADR-0008's amendment, 2026-10-10)** save and
restore the camera: core's `saveView`/`updateView`/`removeView` commands over
`doc.views` (a view camera is `projection`/`position`/`target`/`up`, plus
`size` for orthographic only; the conversion is `viewport/namedView.ts`), the
nav bar's Named views menu and the browser's rows restore, update, rename and
delete (one undo step; restoring is view state, never a command). ADR-0009 (P0-08) set storage (`packages/storage`):
`ProjectStore` over an IndexedDB index and OPFS files, `.extrudo` zips through
core's migrations; in the web app, an async `webPlatform()` with projects,
persistent storage and file download/pick, autosave (`project/autosave.ts`;
unsaved edits get a synchronous rescue copy on `pagehide`, recovered at
startup: `platform/rescue.ts`),
routes `#/` (home screen, `home/`) and `#/p/<id>` (`project/ProjectPage.tsx`).
ADR-0010 (P1-01) set the sketch data model in `packages/core/src/sketch/`:
the plane is a `ref` input, `SketchData` holds points, lines, circles and
arcs (each point owned by at most one curve; coincident constraints join
them) plus every constraint and dimension type, as records keyed by ID;
origin plane frames match the ViewCube. Sketch mode (`apps/web/src/sketch/`)
is session state plus one undo transaction; the viewport draws sketches,
makes the origin planes pickable and puts the grid on the sketch plane.
ADR-0011 (P1-03) built the solver adapter in `packages/sketch/src/solver/`:
`SketchSolver.solve(sketch, values)` maps every type to planegcs, treats
fixed geometry as constants, keeps one system per component and solves only
what changed; `beginDrag`/`drag`/`endDrag`; `check()` test-solves a new
constraint. Our planegcs WASM (`packages/sketch/planegcs/`) builds in CI per
input hash like OCCT. A closed gear outline drags at ~1 s per step (risk
register). ADR-0012 (P1-02) set the tool framework: `infer()` in
`@extrudo/sketch/inference` (import that entry in the app, not the main one,
or planegcs's glue lands in the main chunk) with auto-constraints that
`check()` vets before `addToSketch` commits them with solved positions;
tools are plain state machines (`apps/web/src/sketch/tools/`) driven by a
host store; picking uses `viewRay`/`rayPlane` in `viewport/camera.ts`; an
SVG overlay draws preview, guides, snap glyphs and the heads-up box. The
Line tool (`L`) is the reference tool. ADR-0013 (P1-04) added rectangles,
circles, arcs (one tool ID per mode; variants in the Create menu), points,
the Line tool's tangent-arc drag (tools opt into drags with `dragStart`),
shared builders in `sketch/tools/build.ts`, and the construction toggle
(`X`, host state, resets when the sketch closes). ADR-0014 (P1-05) added
polygons and slots (lines, arcs, construction circles/centerlines), and two
entity types: `ellipse` (center, major and minor points; the solver maps it
with a solver-only focus and ordinary constraints) and fit-point `spline`
(points only; `fitSpline` in `core/src/sketch/curves.ts` interpolates the
B-spline). The drawing tools and the overlay are a lazy chunk loaded when a
project opens; `sketch/tools/ids.ts` lists the tool IDs for the shell.
ADR-0015 (P1-06) added the 13 constraint tools (`sketch/tools/constrain.ts`,
tools with `picks: true` that pick entities via `ToolContext.pick`); the host
test-solves a user's constraint (`SketchEdit.verify`) and refuses a redundant,
conflicting or curve-collapsing one; glyphs (`tools/glyphs.ts` placement,
`ConstraintGlyphs.tsx` buttons over the view, `data-view-passthrough` lets
navigation through) select into the session as kind `constraint`, and Delete
runs `removeFromSketch`. ADR-0016 (P1-07) added the Dimension tool
(`sketch/tools/dimension.ts`, a picking tool), labels and the in-place
editor (`tools/DimensionLabels.tsx`, layout in `tools/dimensionLayout.ts`),
measuring and anchors in `core/src/sketch/dimensions.ts`; named driving
dimensions are model parameters (owner type `dimension`,
`evaluation.dimensions` feeds the solver). **Anything that changes a
dimension's value or a parameter goes through `ToolHost.apply`**, which
re-solves the affected sketches in the same undo step. ADR-0017 (P1-08)
added constraint status: our planegcs patch exposes the diagnosis's
dependent parameters (`get_dependent_params`), the solver reports which
entities can still move (`ComponentReport.free`), `sketchStatus` (pure, in
the inference entry) makes each entity free/fixed/conflict, and the host
keeps `status` for the open sketch; the viewport draws three colour layers,
the palette counts DOF, and a new over-constraining dimension waits for
`OverConstrainedDialog` (`overConstrained`, `resolveOverConstrained`).
ADR-0018 (P1-09) added selection: with no tool running the host picks
(hover → session `hover`, click/Shift-click, kind `sketchEntity`), a drag
on geometry moves it or the selection (solver `beginDrag(ids)`/`dragBy`,
steps stored in a nested `Move` transaction; Esc → `cancelMove`), and a
drag nobody takes is a window/crossing box (`onDragStart` returns whether
it is taken; `SketchBox`, `boxSelect`). `removeFromSketch` takes entities
and cleans up (`entityRemoval`); `SelectionPanel` (bottom-left of the
view) edits X/Y (`moveTo`), radius (`setRadius`) and construction.
ADR-0019 (P1-10) added the modify tools: pure operations in
`@extrudo/sketch/modify` (trim/break/extend split a curve into pieces of
its parameter, the first keeping its ID; fillet/chamfer leave a virtual
sharp point that inherits the corner's constraints and dimensions; offset
works on joined chains; copies and patterns bring their constraints and
dimensions; mirror adds symmetric constraints; scale re-expresses
dimensions) return a `SketchChange` that core's `modifySketch` applies as
one named undo step. A tool's `SketchEdit` can now carry `update`,
`replace`, `remove`, `exprs`, `links` (a new dimension's expression is
another new one's parameter), `auto` dimensions, `hold`, `move` (Move
drags with the solver), `label` and `error`. Tools in
`sketch/tools/split.ts`, `corner.ts`, `offset.ts`, `transform.ts`.
ADR-0020 (P1-11) added profile detection: `detectProfiles` in
`@extrudo/sketch/profiles` (pure; import it like `/inference`) cuts exact
lines/arcs/circles and ellipse/spline polylines where they cross, touch or
end on each other (0.1 µm vertex tolerance), traces faces with half-edges
and nests groups as holes; region IDs hash the boundary's (curve,
direction) set. The app caches per `SketchData` (`sketch/profiles.ts`),
shades them (`--x-profile-fill`, palette "Show profiles"), and with no
tool the host hovers/selects a profile where no entity is (kind
`profile`, ID `profileRefId(sketch, region)`); the properties panel shows
the area. ADR-0021 (P1-12) added the timeline and browser menus
(`shell/featureActions.ts` shared by both, `FeatureMenu.tsx`, design
system `ContextMenu`): rename (F2, popover on a chip, field in a row),
optional `Feature.visible` (`setFeatureVisibility`, one undo step per eye
or folder eye), suppress, delete (refused while another feature refers to
it or an outside expression uses its named dimensions; suppress/delete
wait until an open sketch is finished), and hover (session hover kind
`feature` draws the sketch in the accent). ADR-0022 (P1-13) added export:
`@extrudo/io` (MIT, no internal deps) has a neutral 2D `Drawing` (layers,
contours of exact lines, arcs, elliptical arcs, Béziers; mm, y up) and
`writeSvg` (mm width/height, bbox viewBox, y negated) / `writeDxf` (R12;
ellipses and splines flattened, fill layers as closed bulge polylines);
`@extrudo/sketch/export` (pure; `sketch → core, io`) builds drawings of a
sketch's curves or profiles, splines as Bézier pieces. The app's
`sketch/ExportSketchDialog.tsx` opens from the Sketch tab's Export tile
and a sketch's feature menu (`FeatureActions.exportSketch`). ADR-0023 (P1-14)
added commands: **keys are declared only in `commands/keymap.ts`**
(`DEFAULT_KEYMAP`, `keysFor`; tool IDs are command IDs; toolbar and menus
read it); `shell/commands.tsx` `buildCommands(ctx)` lists the commands
offered in the current mode (shown tabs' tools, edit, view, panels, file,
theme) and drives the shortcuts and **one search** (ADR-0023's amendment,
UI review 3 R3-05: `shell/CommandSearch.tsx` on the design system's
`FloatingDialog`, opened centred by Ctrl+K (`search`), at the pointer by S
(`searchAtPointer`) or dropped from the top bar's Search button; fuzzy scorer
in `commands/search.ts`; pins in the `toolbox.pins` preference, at most ten
shown, `shell/searchPins.ts`). A new command goes in `buildCommands`. **Chords** (ADR-0023's
amendment, 2026-10-18): a keymap entry may be two combos, `'K H'`; the 13 constraints are
K plus a letter. `commands/shortcuts.ts` `matchChord` (pure) and `useShortcuts` (returns
the pending prefix): Escape or any other key cancels and is swallowed, bare modifiers
are ignored, blur / pointerdown / the chord no longer offered also end it, no timeout;
`shell/ChordHint.tsx` (`data-chord-hint`) lists the second keys from the offered
commands. A chord runs the tile's command (a pick tool; tiles ignore a preselection).
Rules: a chord's prefix may not be a single key offered in the same mode
(`commands.test.ts`); `menuModel` gives chords no native accelerator; labels go through
`shortcutLabel`, which maps each part. ADR-0024 (P2-01) added
the recompute engine (`packages/kernel/src/recompute/engine.ts`): a
feature is a `KernelFeatureDefinition` (core's definition + `evaluate` +
`bodyAccess`) registered in `kernelFeatures()` (`src/features/`; the
sketch evaluator only checks its plane until P2-02); its result is cached
under a hash of type, ID, inputs, expression values, referenced features'
keys (`<feature>/…` ref IDs) and, unless `bodyAccess` is `none`, the body
set before it. Shapes in the cache are reference-counted; **an evaluator
must release every shape it doesn't return** (`kernel.scope()`,
`ShapeScope.keep`); the engine checks the live shape count per evaluation
(`strictLeaks` in tests). A newer request cancels a running one at the
yield before each evaluation; `preview` walks a trial timeline. On the UI
thread `Recomputer` (`src/recomputer.ts`, started by `useRecompute` in
`project/ProjectPage.tsx`) owns the kernel client, fills the model store,
and marks a feature that crashed the kernel as an error until it changes.
Timeline chips show ✕/⚠ with the message in the tooltip; the status bar
counts errors and shows the kernel state. Engine tests use the test
features in `recompute/testing.ts` (real OCCT, call counters). ADR-0025
(P2-02) turned sketches into faces: the evaluator
(`src/features/sketch.ts`) stages exact curves in entity ID order
(`planarCurves`), `Kernel.planarFaces` (`src/planar.ts`, facade
`sketch*`/`sketchProfiles`) splits them with General Fuse, drops bridges
and dangling pieces, and makes one face per region placed in the plane;
`profileFaceIds` keys each face with `@extrudo/sketch/profiles`'
`profileKey`/`profileIds`, so **kernel region IDs equal `detectProfiles`
IDs** (a geometric fallback covers the rest; tests expect none). The
output's `shapes` are the faces by region ID, `data` a
`SketchOutputData` (frame; per profile area, holes and the sketch curve
of each face edge). ADR-0026 (P2-03) added model-mode selection
(`apps/web/src/selection/`): topology items `{kind, body, index}` in the
session selection as `<body>:<index>`, `GeomRef`s via
`topologyRef`/`selectionRefs` from `BodyMesh.faceIds/edgeIds/vertexIds`
(never store `index:` fallback refs), pure picking (`pick.ts`: indirect
three-mesh-bvh faces, screen-space edges 6 px / vertices 8 px, an
occlusion ray; `pickTop`/`pickStack`/`pickBox`), face tints through a
colour attribute, "Select other…" (long press / right-click), the
selection filter beside the nav bar's Select (session state), the status
bar summary; pointer input for both modes is `viewport/pointer.ts`.
ADR-0005 (P2-04) added topological naming (`packages/kernel/src/naming/`):
faces named `op:feature:role[:source]` plus `#n` and carried through
OCCT history, edges and vertices `e[faces]`/`v[faces]` plus `@n`;
evaluators return `FeatureOutput.names` built with `namedPrism`,
`namedRevolve`, `namedBoolean`, `withHistory`, and **resolve every face,
edge or vertex reference with `ctx.resolve`** (exact name, related name,
fingerprint with a warning, else an error; a related face is a piece of it
or, since 2026-10-23, a name made from a related nested name: the round of an
edge and the round of a piece of it, `topo-id.ts` `nestedRelated`);
`KernelApi.reference` turns a pick into a `GeomRef` with a fingerprint. ADR-0027 (P2-05) added feature
dialogs: a declarative `FeatureDialogSpec` (`apps/web/src/features/`:
selection/expression/choice/toggle fields, `toInputs`/`fromInputs`,
`validate`, `manipulators`, `previewStyle`) registered in
`featureDialogs()` makes its tool run a generic draggable dialog; one
controller per project (`features/dialog.ts`) does pre-selection, picks
as persistent refs, per-dialog `dN` names, live previews through the
`Recomputer` (evaluators may return `previewTools`, meshed as `tools`;
`preview(…, base)` gives the bodies before an edited feature) and OK as
one command. ADR-0028 (P2-06) added extrude: `packages/core/src/extrude.ts`
(optional inputs with shared defaults, `extrudeSettings`/`extrudeInputs`),
the evaluator `packages/kernel/src/features/extrude.ts` (profiles unioned
before the sweep, taper through `DraftAngle` in the facade `prism`,
to-object trim (**P4-12**: a curved face or a body too — the sweep is cut
back where it first meets the face's surface extended past it, facade
`extendFace` + boolean op 3 `Kernel.split`, or the body, `cut`; the pieces
touching the profile stay, `trimSweep` in `features/to-object.ts`, shared
with revolve; `offset`/`offset2` move the target along the sweep; the new
ends are `cap:end`, a mesh target is refused), through all, participants by `distance`, one body per
solid, `previewTools`) and the dialog `apps/web/src/features/extrude.ts`
(fields named like the inputs; per-side arrows, symmetric at half
length, taper arcs; press-pull through the spec's `propose` hook: join
outwards, cut inwards until the user picks an operation). **P4-12's
second amendment (2026-10-06)** added **`symmetricMeasure`** (`whole` —
`distance` is the whole length, the default — or `half`, the length of
each side; `revolve`'s symmetric `angle` takes the same input; read only
when symmetric, stored only when `half`): the dialogs' Measure select
shows while Direction is Symmetric and the arrows reach the value each
way with `half`. **P4-12 (2026-10-07)** added the taper on ellipse and
B-spline sides: `prism` keeps `DraftAngle` for lines and arcs and takes
`taperLoft` otherwise — a ruled loft between the profile and its 2D offset
(`BRepOffsetAPI_MakeOffset` with `GeomAbs_Arc`, `ThruSections` per wire
pair, caps sewn in) — with a prism's names, refusing an offset that
crosses itself or closes a hole. **Each profile wire is lofted to its own
offset** (the offset wire holding the edges `MakeOffset::Generated` gives
for its edges, never by size or order: the review of 2026-10-07 found a
box-area sort swapping a slot and a hole), and an offset that splits a wire
is refused ("The taper pinches the outline in two…"). The browser
lists the model's live bodies (`shell/bodies.ts`). The Wall bracket
template computes a real bracket. ADR-0029 (P2-07) added revolve
(`packages/core/src/revolve.ts`, `packages/kernel/src/features/revolve.ts`,
`apps/web/src/features/revolve.ts`): profiles or flat faces about an
axis `{kind:'axis', id:'origin:x|y|z'}` (`ORIGIN_AXES`, `originAxisRef`
in `sketch/planes.ts`), a sketch line (`<sketch>/<line>`, placed by
`SketchOutputData.frame` and `.lines`) or a straight edge; the axis
must lie in the profiles' plane; 360° is a whole turn (no caps);
**P4-12**: `extent: 'to-object'` + `toObject` (face, body or plane) turns
one side until it first meets it, no offset;
symmetric and two-sided are one sweep from a rotated start; side 1
turns right-handed about the axis. Extrude's body operations and
sources moved to `features/operation.ts` and `sources.ts` (shared
input pieces in core `feature-inputs.ts`); **a new solid feature calls
`splitSolids(ctx, scope, operate(…))`**. Origin axes are pickable
(`PickScene.axes`, ranked after profiles and faces); pre-selection
fills every selection field that takes part of it, in field order.
ADR-0030 (P2-08) added bodies: every live body gets stored
`doc.bodies` metadata when a recompute first shows it
(`followBodyNames`: `nameBodies` amended into the latest undo step via
`DocumentState.amend`; names "Body<n>", never reused); deleting a body
adds a Remove feature (`packages/core/src/remove.ts`, `kernelRemove`);
`splitSolids` (`packages/kernel/src/features/bodies.ts`) makes one body
per solid (the largest keeps the ID, others the feature's next
`<feature>:<n>`); the browser's Bodies folder has a count badge,
rename, eye, Appearance (colour swatches, opacity via
`BodyMeta.opacity`) and rows that pick into the selection; wireframe
and hidden-edge styles draw silhouettes of curved faces
(`viewport/silhouette.ts`). **ADR-0030's amendment (2026-10-09) added ghost
bodies**: `BodyMeta.ghost` (stored only as `true`, only with `visible: false`;
`updateBody` keeps the pair, `bodyDisplay` names shown/ghost/hidden) draws a
body as a vague grey shape at 30 % opacity through a separate `GhostBodies`
component that takes no part in picking, Fit or any analysis — **no edge lines, a soft
halo** round its outline since R3-06 (`viewport/ghostHalo.ts`: three back-face shells
pushed out 2, 4 and 7 CSS px along welded normals in clip space, drawn only where the
ghost's faces didn't set stencil bit 0x80; baseline `e2e/bodies.spec.ts-snapshots/ghost-body`); **since
2026-10-15 a depth-only pass first, so only the nearest surface is blended** (no stacking where
its faces overlap; render orders 6.5/6.6/6.7 for depth, faces, halo: after the depth-tested
overlays, up to 6, and before the ones drawn on top, 7 and up — keep that gap); the browser
row's eye cycles shown → ghost → hidden (`EyeDashed`), `data-ghost-bodies`
names the ghosts, and the body and marking menus offer the states a body is
not in. ADR-0031 (P2-09) added sketches on flat
faces (`faceSketchFrame` in core: world origin projected on the plane,
X along world X on faces within 40° of horizontal, else Y up the face;
the kernel reports frames through `FeatureOutput.report` →
`ModelState.sketches`, the fingerprint's frame until then) and the
Project tool (`P`; `SketchData.projections` records whose curves are
ordinary entities the solver holds fixed; the kernel projects through
facade `edgeGeometry`/`faceSilhouettes`; `ToolHost.syncProjections`
catches the sketch up after a recompute and re-solves, amended into
the latest undo step). **P4-12 (ADR-0031's amendment)**: `faceSilhouettes`
covers every curved surface (cylinders and cones in closed form, the rest
through TKHLR's `Contap_Contour`: exact lines and circles — a sphere's outline
is its great circle — and walked polylines on the surface) and returns
**curve pieces** (`[0, a, b]` line, `[1, …]` circle arc, `[2, n, …]` polyline,
`[3, …]` ellipse arc; `decodeCurvePieces`), which `projectPieces` joins (arcs of
one circle, polylines that meet smoothly) and turns into lines, arcs, circles or
**control-point splines** (`fitControlPoles` in core, within 1 µm, split at
cusps; a closed one in two). Project also takes a **vertex** (a fixed point, key
`vertex`) and a **body** (by its browser row: outline edges, every face's
silhouettes `sil:<face>:<n>`, and the sharp edges the facade's `edgeVisibility`
— `HLRBRep_Algo` from the normal's side — says are seen); the tool **Intersect**
(`intersect`, `Shift+P` in a sketch) stores `mode: 'intersect'` and the kernel
cuts the face or body with the sketch plane (facade `sectionWithPlane`, keys
`cut:<n>`); and the tools' panel's **"Keep linked"** off stores `linked: false`,
which `ToolHost.syncProjections` turns into plain entities (`includedCurves`,
`includeProjection`) amended into the same step and **relabelled** "Include
<n> curves" (`DocumentState.amend(command, { relabel })`). `withoutRepeats` drops
a curve that repeats an earlier one. **The sketch palette's Slice is done
(2026-10-07, §5 of the P4-12 amendment)**: with a sketch open and the
`sketch.slice` display setting on, the bodies are clipped at the sketch
plane, the camera's side removed — view state, one more `SectionClip` in
`useSection`'s list, last after the person's own planes; the removed side
is decided once per sketch or Slice turn-on (the session's
`sketchSliceFlip`) and kept while the camera orbits. Native harness:
`spikes/p4-12-project/` (`run.sh`, `run.sh leaks 100`). **In the app a sketch's frame comes only from
`sketchFrame(feature, plane, model.sketches)`** (`sketch/frame.ts`),
never `planeFrame()` alone. ADR-0032 (P2-10) added the primitives
`box`, `cylinder`, `sphere`, `torus` (`packages/core/src/primitives.ts`,
kernel `features/primitives.ts`, dialogs `apps/web/src/features/primitives.ts`):
own feature types (= tool IDs), placement `plane` (origin plane or flat
face; default XY) + `x`/`y` in its sketch frame + `offset` (+ a box's
`rotation`); solids are planar faces swept by `namedPrism`/whole-turn
`namedRevolve` (names like `box:<id>:side:front`, `cylinder:<id>:side:wall`,
`sphere:<id>:side:surface`), no facade primitives. A dialog whose pick
field accepts `plane` gets Create Sketch's plane-or-face picker
(`features/planePicker.ts`) instead of the model selection. **P4-12's
amendment (2026-10-06)** gave every primitive dialog **position handles**
(`positionManipulators`: X from the plane's origin along its X, Y from there
along its Y to the centre, Offset along the normal up to the base; after the
size handles in `data-manipulators`), a **click-to-place** (`placeAt`:
`primitivePlaceAt`, X and Y from the click in the plane's frame, as the
hole's) and the Box's **Two corners** button (`features/primitiveCorners.tsx`,
a `spec.extra`; its marks are `cornersStore`, drawn through the view's
calibration marks); the torus's **`axis`** (normal, the default — or `x`/
`y`, the ring on edge) and **`seat`** (`centre`, the default — or `plane`,
resting on the plane, `offset` still adding on top) are P4-12's second
amendment's inputs, stored only when not the default. ADR-0034
(P2-12) added export: facade `exportMesh` (meshes a
`BRepBuilderAPI_Copy` at the export's deflection, so the display
triangulation is untouched, and welds nodes through each edge's
`Poly_PolygonOnTriangulation`: closed, manifold), `writeStep` (AP242,
mm, `DESTEP_Parameters` per transfer, products renamed to body names,
`WriteStream`, OCCT printers removed) and `readStep`; `Kernel.exportMesh`
/ `writeStep` / `readStep`, `stepString` (non-ASCII as `\X2\`);
`KernelApi.exportMeshes`/`exportStep` export the engine's
`latestBody` shapes (last finished recompute). **P4-12 (ADR-0034's
amendment) added colours**: `stageStepColor(r, g, b)` per part (−1 none) makes
`writeStep` go through XDE (`STEPCAFControl_Writer`, an XCAF document per call,
one label transferred at a time so products are renamed as before) only when a
part has a colour — uncoloured exports are byte-identical — and
`readStepColors(text)` gives per solid (in `readStep`'s solid order) its own,
part's or assembly instance's colour, face colours only counted; `exportStep`
takes `{ id, name, color? }` (`StepBody`). **ADR-0034's second amendment
(2026-10-12)** added **STEP part names as body names**: a sibling facade read
`readStepNames(text)` (same XDE walk, name mode on, names through
`readNamesPtr/Size` joined by `'\0'`, never an OCCT type) gives, per solid in
`readStep` order, the solid's own `TDataStd_Name`, else its part's, else its
assembly instance's; the import feature reads it only when the text has a
`PRODUCT('…` name, matches the count to `solids(read)` or drops the names, and
puts them in **`ImportReport.names`** (`Record<BodyId, string>`, empty when
none): trimmed, empty/generic (`SOLID`, `PART`, `Body`, OCCT's translator
name)/all-digits names dropped, repeats numbered `" (2)"`. **The app's
`followBodyNames` gives a body the report's name in place of "Body n" once,
when it first names it, so a renamed body keeps its name on recompute** (the
colours rule). No schema change. `@extrudo/io` has
`TriangleMesh`, `checkManifold`, `writeStl`/`readStl` (binary) and
`write3mf`/`read3mf` (fflate; colours as `m:colorgroup` with object
`pid`/`pindex` and per-triangle `pid`/`p1`). The app's
`apps/web/src/export/` (`ExportModelDialog`, `modelExport.ts`) opens from
3D Print › Export, Home › Export Model (ADR-0079) and a body's menu. ADR-0033
(P2-11) added timeline v2 (**P4-12 draws the ghost of lost geometry**: the
fingerprint stored with a lost or guessed reference becomes dashed
`--x-error` marks, `viewport/ghostGeometry.ts` pure and `Ghosts.tsx`, for the
hovered chip or row, the feature whose Fix References is open and the picked
chips only, `data-ghosts`; ADR-0005's and ADR-0033's amendments):
`packages/core/src/timeline.ts` (a feature
depends on the features whose IDs appear in its stored references:
profiles, bodies, face/edge names; `moveFeature` refuses a move that
breaks that, the marker stays between the same other features;
`replaceReferences`; expressions don't order features),
`redefineSketchPlane`; the kernel lists lost/guessed references in
`FeatureStatus.refs` (**throw `LostReferenceError` with the reference
for anything an evaluator can't find**, so Fix References can offer it);
the marker is a slider with drag and keys, chips drag to reorder, menus
have Roll Back to Here, Move to End, Redefine Plane, Fix References
(`dialog.edit(id, { fix })` or Redefine Plane for a sketch) and Keep
Closest Match. **Its 2026-10-11 amendment** records that a reference lost only on a warning (a fillet or chamfer built without the edges its `skipLostEdges` dropped, ADR-0038's and ADR-0043's amendments) still goes in `FeatureStatus.refs`, so Fix References and the ghosts of lost geometry work on it as on an error. ADR-0035 (P2-13) added measuring: `KernelApi.inspect(targets)`
(topology items of the last finished recompute, like export) returns an
`Inspection` (`packages/kernel/src/inspect.ts`: per item exact volume,
area, length, radii, normal/axis, centre, tight box; for two, the
distance with closest points, the angle, the centre distance) from new
facade calls (`distance` leaves the closest points, `properties`,
`surfaceGeometry`); **`measure()` keeps its loose, fast box** for
extrude. The app's `apps/web/src/measure/` has `useInspection` (the
status bar's "Selection size"), the Measure tool (`I`, session tool
`measure`, two plain clicks pick two things: `createMeasureSelect`), its
panel and the in-view line. ADR-0036 (P2-14) added versions:
`ProjectStore.saveVersion`/`versions`/`loadVersion`
(`projects/<id>/versions/index.json` + `<n>.json.gz`; `.extrudo` files
carry `versions/`), core's `restoreVersion` command (one undo step; ID,
name and dates stay), `apps/web/src/project/versions.ts` (restore keeps
the current state as a version first; Open copy makes a new design) and
`VersionsDialog.tsx` (Ctrl+S, Home › Versions, the clock beside the name).
ADR-0037 (P2-15) added the offline precache: a hand-written service
worker (`apps/web/pwa/sw.js`; `pwa/precache-plugin.ts` lists the build's
files into `dist/sw.js` and versions it; registration in
`platform/serviceWorker.ts`, production web builds only), a web app
manifest and icons; `scripts/measure-startup.mjs` measures size and
startup against NFR-02 (all three targets hold with a wide margin). It
also found that the kernel uses no raw OCCT bindings, so the build's
binding list is now just `ExtrudoFacade` (built by CI: WASM 20.61 MB raw,
6.67 MB gzip, 4.64 MB brotli (Node's zlib at its best settings), after
P4-04/P4-05/P4-10's facade methods, P4-12's `DYNAMIC_EXECUTION: 0`, P4-12
§H3's `integrateVolume`, P4-12's split boolean and `extendFace` (about 10 kB)
and P4-12's `shellFaces`, `pushWall`/`clearWalls` and the shell's plugs (about
30 kB) and P4-12 Project's `sectionWithPlane`/`edgeVisibility` and the contour
finder in `faceSilhouettes` (TKHLR's `Contap_Contour` and `HLRBRep_Algo`: 388 kB
raw, 0.08 MB brotli; 18.80 / 6.13 / 4.26 MB before) and P4-12's STEP colours
(XDE's reader, writer and XCAF document: +0.83 MB raw, +0.16 MB brotli; 19.19 /
6.25 / 4.34 MB before) and P4-12's emboss faces (`wrapOnCone`, `coneFace`,
`projectOnFace`: +26 kB raw, under 0.01 MB brotli; 20.01 / 6.48 / 4.50 MB
before) and P4-12's taper on ellipse and spline sides (`taperLoft`:
`BRepOffsetAPI_MakeOffset` and a ruled `ThruSections`: +0.48 MB raw, +0.10 MB
brotli; 20.04 / 6.49 / 4.50 MB before) and the taper caps' point-to-plane
match (2026-10-07, under 0.01 MB) and the taper review's identity pairing
(2026-10-07, −19 kB raw; 20.52 / 6.62 / 4.60 MB before) and P4-12's exact
conics (`sketchConic`, the Gauss–Kronrod volume and `GCPnts_AbscissaPoint`:
+75 kB raw, +34 kB brotli; 20.50 / 6.62 / 4.60 MB before) and P4-12's tapered
threads (`threadFace` on cones, `threadSweep`'s taper, `helixWire`: +339 bytes
raw, +1.3 kB brotli, 20.57 / 6.66 / 4.63 MB unchanged) and P6-05's STEP
assemblies (`pushStepGroup`, `writeStepAssembly`: +4.9 kB raw, +3 kB brotli;
20.57 / 6.66 / 4.63 MB before) and P6-05's pose proximity (`proximityOpen`,
`proximityPose`, `proximityClose`: +32.6 kB raw, +10.1 kB brotli; 20.58 / 6.66
/ 4.63 MB before, 20.61 / 6.67 / 4.64 MB after) and the 8 MB stack, its guard
and ADR-0038's rod refusal (2026-10-11: +12.3 kB raw, +3 kB gzip; 20.62 / 6.67 /
4.64 MB after) and ADR-0051's seam retry and far-face check (2026-10-11: +13.2 kB
raw, +9.2 kB gzip; 20.64 / 6.68 MB after); the 15.76 MB / 3.69 MB brotli
of ADR-0037 was P2-15's; OCCT input hash
`e67295b269ca` (release `occt-e67295b269ca`); **the WASM stack is 8 MB**
(`STACK_SIZE` in `libcascade.config.ts`; Emscripten's default 64 kB was run past
by booleans and chamfers on B-spline faces, silently corrupting static data until
a later call trapped: ADR-0001's amendment of 2026-10-11), and the facade aborts
when anything reaches the stack's lowest 64 kB (`checkStackGuard` in `beginOp`
and `store`); **don't
expose an OCCT type in a facade method**, and no raw access from JS: the
memory test's leak control leaks through the facade).
ADR-0039 (P2-17) built benchmarks B2 and B3 through the UI
(`e2e/benchmark-b2.spec.ts`, `-b3`, shared steps in
`e2e/benchmark-helpers.ts`) and keeps the designs of B1, B2 and B3 as
`.extrudo` fixtures the app exported (`fixtures/benchmarks/`,
`WRITE_FIXTURES=1` rewrites them), recomputed headless in
`packages/kernel/src/benchmarks.test.ts` (B3 merges its two bodies with a
real Combine since P3-06). Its amendment (P3-14) adds B4, B5 and B7 the
same way, B4 and B5 from primitives so every parameter changes headless
too; B4's headless test checks the lid's fit exactly (no shared volume,
lifted 1 mm it is `clearance` from the box). ADR-0038
(P3-01) added fillet: `packages/core/src/fillet.ts` (`FILLET_MAX_SETS` edge
sets as plain inputs `edges`/`radius`, `edges2`/`radius2` …: `filletSets`,
`filletInputs`; **32 sets since P4-12**, a document with fewer reads
unchanged), the evaluator `packages/kernel/src/features/fillet.ts`
(edges by `ctx.resolve`, one body at a time, faces `fillet:<id>:from:(<edge>)`
through `withHistory`), the facade's `fillet(shape)` (staged edge indices
+ one radius per edge, builder on the C++ stack, result checked with
`BRepCheck_Analyzer`; on failure it **diagnoses**: which chains fail alone
and the largest radius that works by bisection, or all radii scaled together,
or an edge that can't be filleted, or two radii in one chain, read through
`Kernel.fillet`'s `FilletError.problems`) and `tangentChain(shape, edge)`
(OCCT rounds the whole tangent chain of any edge you add, so a set is whole
chains: `KernelApi.tangentChain`, and `SelectionField.tangentChain` makes the
dialog add or remove a picked edge's chain). Messages are worded in the
evaluator ("Radius 50 mm is too large for edge 12 (max ≈ 19 mm)", maximum
rounded down to two digits so it works). The Wall bracket's Fillet1 has two
sets (inside corner `wall / 2`, outside `wall * 1.5`), its edges named from
Extrude1's id and Sketch1's lines, and the bracket has 12 faces. **P4-12
(ADR-0038's amendment) added a `distance` handle on set 1's Radius**
(`features/edgeHandles.ts`): the middle of the set's first edge and the
unit bisector of its two faces' outward normals there, read from the model
meshes through the edge's own name (`e[<face>|<face>]`, `parseCompound`), so
dragging away from the body grows the round (the bisector points into the
void whether the corner is convex or concave). **No handle** where it can't
be read honestly: a seam (one face), more than two faces, a face the meshes
don't have, or normals within 60° of each other. The handle stands on the
edge's middle, so re-picking that edge takes a click a little along it.
**P4-12's second part (2026-10-05)** gave **every set with edges** its own
arrow (`radius2` …; empty sets compute nothing; `DistanceManipulator.quiet`
and `follows`: the overlay draws the arrow whose field or `follows` field was
touched last as before, the others small and faint,
`data-manipulator-state="active|quiet"`; `pickInto` also sets `activeField`;
heads within 12 px lift 14 px apart) and a **variable set two arrows**, Radius
and End radius at the two free ends of the tangent chain (`chainEnds`: the
round starts at the end the edges' own polylines flow away from — measured in
`kernel/src/features/fillet-variable-start.test.ts`, not documented OCCT; a
closed, broken or mixed-direction chain gives **no** arrows; swapped, the
`radius` arrow stands at the end). The handles also found a bug of their own: a dialog's heads-up box took
**every** plain digit while it was open, Shift+1…7 (the view commands) with
them, since its keydown listener runs before the shell's and prevented the
default — which is why B8's fourth fillet edge (picked from the back view)
found nothing. A key with a modifier is a command, so the box takes plain
typing only (`e2e/fillet.spec.ts` covers Shift+4). **Amendments of 2026-10-11 and 2026-10-12 added `skipLostEdges`** (the chamfer takes the same input, ADR-0043's amendments): an optional bool input; with it true the evaluator resolves the edges and builds from the ones still found, and a `too-large`/`unfilletable` diagnosis drops at most a third of the edges (the chains that build), warning which were left out instead of failing the whole feature; the `.f3d` import sets it on every round it writes (`docs/file-format.md` §6.9). **Amendments of 2026-10-14** (`round-fallback.ts`, all only with `skipLostEdges`): before any chain is dropped, edges OCCT can't round at any size (`unfilletable`/`unchamferable`: smooth, or not between two faces) are left out first and don't count toward the third; then a round whose every problem is `too-large` with a share ≥ `NEAR_LIMIT` (0.99), or a lone `together` with a factor ≥ 0.99, is built a hair under (× `UNDER_LIMIT`), else at the share found working, with a warning; only then are chains dropped. Keep the order (a round at its limit is built smaller, not dropped). Rejected with numbers in ADR-0038's amendment: two passes, another edge order, healing unsound OCCT results (it broke a later offset), relaxing `filletRollsOff`.
ADR-0041 (P3-16) added the notification history: the toasts'
store (`design-system/notifications.ts`, vanilla Zustand, `useToasts()`
returns it as `notifications`) records every `push` for the session
(repeats merged with a count, at most 100), the bell at the
status bar's right edge (`NotificationHistory.tsx`, the last item of
`Timeline`'s bottom row, always drawn, quiet when empty; moved there
2026-10-10, `Toasts` no longer renders it) and the command "Notification History" open a popover with errors grouped on
top; a `ToastAction` may carry `available()` so the history disables a
stale button. **A new toast action should say whether it still applies.**
Session only.
ADR-0040 (P3-05) added construction geometry: nine feature types
(`offsetPlane`, `planeAtAngle`, `midplane`, `planeThroughPoints`,
`tangentPlane`, `axisThroughPoints`, `axisThroughCylinder`,
`axisAlongEdge`, `constructionPoint`; `packages/core/src/construction.ts`,
kernel `features/construction.ts`, dialogs `apps/web/src/features/construction.ts`)
that make no body but a plane, axis or point, **referred to by the
feature's own ID** (`{kind: 'plane'|'axis'|'point', id: <feature ID>}`,
`constructionRef`), so the engine's dependencies, timeline ordering and
Fix References work unchanged. The kernel computes them in TypeScript from
`describe`/`surfaceGeometry`/`edgeGeometry` (no facade change) and reports
a `ConstructionReport` (`FeatureOutput.report`/`data`, `ModelState.construction`,
`Preview.construction`); a plane's frame is `faceSketchFrame` of the plane
alone. **A kernel evaluator that takes a plane, axis or point reference
reads it with `planeOf`/`lineOf`/`pointOf`** (`features/references.ts`);
in the app use `planeFrame(ref, construction)` / `sketchFrame(…, construction)`.
The view draws them (`viewport/Construction.tsx`, steady size) and picks them
(`PickScene.planes/points/axes`; planes also in `sketchTargetAt`);
the browser has a Construction folder. **P4-12 (2026-10-06) added four more
types and box selection**: `pointOnPath` and `planeAlongPath` (a `by`
`position`/`length`, `position`/`distance`, `flip`, along a path of sketch
curves and edges through `pathFromRefs`; the plane's normal is the path's
tangent and its frame follows `faceSketchFrame`, so a Sweep section can be
sketched on it), `pointAtIntersection` (`entities`, up to three of
`edge`/`plane`/`face`: two edges through `closestPoints` of their edge
sub-shapes, an edge crossed with a plane, or three planes solved in
TypeScript) and `midplaneAngled` (`planes`, two non-parallel, `flip`; parallel
ones are refused pointing at `midplane`). `tangentPlane` gained a `point`: the
face point nearest it (a torus analytically, a free-form face from its display
mesh, `basis: 'mesh'` in the report); a point/plane report also carries
`path` (`from`/`tangent`/`length`/`straight`) so the app draws a distance
handle from the path's start along a straight path. `pickBox` takes
construction planes/axes/points as a `construction` kind last in `BOX_ORDER`.
No facade change. **2026-10-07 addendum**: `tangentPlane`'s `point` on a cone is the exact foot on the nearest generatrix (the apex past it; a point on the axis warns and follows the angle), and `pointAtIntersection` takes an edge and a **curved** face (`edgeMeetsFace`, closest points within 1 µm). **2026-10-15 addendum (facade change)**: `pointAtIntersection`'s three-reference case also takes curved faces — the facade's `facesMeetPlane` sections the two faces (or a face and a plane) and cuts the curve with a plane (`planeOf`'s origin/normal; two curved faces cut with the flat's plane, one curved face and a flat face sectioned with the flat face and cut with the other flat, one curved face and two planes sectioned with the first and cut with the second), 0 points is "The faces don't meet on that plane.", several crossings take the point nearest the plane's `anchor` and warn "`n` points meet there; the one nearest the plane's centre was taken.", and three curved faces are refused with "At least one of the three must be a plane or a flat face."
ADR-0042 (P3-11) added the right-click marking menu:
`design-system/MarkingMenu.tsx` draws eight wedges, alone, or one list in the list
style (R3-08, ADR-0042's 2026-10-11 amendment: the ring has no list under it, and the
list shows every row, scrolling only in a window shorter than it; pure geometry in
`marking.ts`); **a wedge is a command ID** in the two tables in
`commands/marking.ts` (`MODEL_SLOTS`, `SKETCH_SLOTS`; `resolveSlots` matches
them with `buildCommands`, a missing or `unavailable` command leaves its
wedge dimmed, so **a task that adds Move, Press Pull or Fillet only adds
the command** and drops `comesWith`); the list is `shell/contextEntries.tsx`
(pure; reuses commands, `BodyActions`, `FeatureActions`); `shell/viewMenu.tsx`
`useViewMenu` answers the view's request (`viewport/viewMenu.ts`), selecting
what is under the pointer; `PointerHandlers.onContextMenu` is the right-click
without movement (`onMenu` stays the long press, "Select other…", and the
right-click where no `viewMenu` is passed: dialogs, Measure, Create
Sketch). "Repeat last" is the `repeatLast` command (`ctx.repeat`, the last
tool through `runTool`/`run`, `isRepeatable`). Preference `marking.radial`.
Browser folders, origin rows, Parameters rows and home cards have context
menus. **P4-12 made the wedges remappable** (ADR-0042's amendment): the
preference `marking.slots` (`{ model?, sketch? }`, eight command IDs or `null`
each, `MarkingOverrides`; `useMarkingSlots`) is the third argument of
`resolveSlots`, where an override takes the command's own label and icon and an
ID the mode doesn't offer stays dimmed with the ID as its label; the command
`customizeMarkingMenu` ("Customize Marking Menu…", Panels, no key) opens
Settings › Marking menu, which renders `shell/MarkingMenuEditor.tsx` inline
(ADR-0090 §2; a ring per mode, a wedge opens the mode's
command search, Reset wedge / Reset all, written at once; its command lists
come from `buildCommands` with the `listing` flag in `AppShell`).
ADR-0043 (P3-02) added chamfer: `packages/core/src/chamfer.ts`
(`CHAMFER_MAX_SETS` edge sets as plain inputs, **each set with its own
type**: `edges`, `mode` = equal / two-distances / distance-angle, `distance`,
`distanceB`, `angle`, `flip`, then `edges2`, `mode2` …: `chamferSets`,
`chamferInputs`; **32 sets and a `face` per set since P4-12**, ADR-0043's
amendment: `face`, `face2` … is a one-face ref that names the face taking
`distance` for the two unequal modes, and the evaluator turns it into the
`flip` the facade understands ("the picked face is not the lower-numbered of
this edge's two faces", from `ctx.describe`'s edge→faces), refusing a face
that touches no edge of the set; an equal set ignores it and the dialog
hides Flip while a face is picked),
the evaluator `packages/kernel/src/features/chamfer.ts` (same shape as
fillet's; faces `chamfer:<id>:from:(<edge>)`), the facade's
`chamfer(shape)` (staged edges + four numbers each: mode, a, b, flip; the
reference face of an edge is the lower-numbered of its two faces, `flip`
takes the other; on failure a fillet-style diagnosis whose too-large value
is a **factor** the distances scale by, read through `Kernel.chamfer`'s
`ChamferError.problems`; it uses `largestThatWorks` and the fillet's tangent
chain query) and the dialog `apps/web/src/features/chamfer.ts` (a Type
dropdown per set, a Reference face under it, and a Distance handle per set as
ADR-0038's amendments have it: the unequal types run Distance along the
reference face and two distances a **Second distance** arrow along the other
(`faceDirections`; the directions are read locally at the edge's middle, so a
curved edge and a curved face work too, else the single bisector arrow;
ADR-0043's second and fourth amendments), and a distance-and-angle set's
**Angle** an arc from the reference face's direction towards the other face's
about the edge (`cross(first, second)` signed so that turn is positive; its
head sits on the chamfer face; none where the directions can't be read;
ADR-0043's third amendment)). The Chamfer tile has no default key. **It also takes the fillet's `skipLostEdges`** (ADR-0038's amendments of 2026-10-11 and 2026-10-12; `docs/file-format.md` §6.9), on the same terms: edges it can still find build, up to a third may be left out with a warning, and the `.f3d` import sets it on every chamfer it writes.
ADR-0044 (P3-06) added three body features: `combine` (target body + tool
bodies, join/cut/intersect through `namedBoolean`, tools used up unless
`keepTools`, strict messages instead of silent no-ops; `core/src/combine.ts`,
`kernel/src/features/combine.ts`), `move` (modes `free`: turns about the
world axes through the bodies' box centre then a move, `rotate`: about an
axis, `point-to-point`; `copy` adds `<feature>:<n>` bodies) and `mirror`
(about a plane or flat face, `copy` default true, `join` fuses copy and
original; features are mirrored since P3-07), Move and Mirror in
`kernel/src/features/transform.ts` on the facade's `transform(shape)` (12
staged numbers, a 3×4 matrix built in `features/matrix.ts`;
`BRepBuilderAPI_Transform` with copy = true, so the result is rebuilt
geometry, and history records every sub-shape as modified). **A copy's faces
are renamed `<op>:<feature>:from:(<name>)`**: with the original's names
`resolveRef` sees two exact matches and guesses by fingerprint. The gizmo is
the dialog framework's manipulators (`apps/web/src/features/move.ts`:
`moveManipulators`, an arrow per axis from its box face and a ring per axis
at the box centre); the Modify tab has a Transform group (Move `M`, Mirror,
Combine, Split Body, Scale; ADR-0079) and bodies selected before a tool fill its fields in order.
The marking menu's Move wedge is the `move` command (ADR-0042).
ADR-0045 (P3-09) added section analysis (`apps/web/src/section/`, no kernel
or schema change): **the section is view state** (`viewport.section`:
`SectionState` = a plane `GeomRef` (origin plane, construction plane or
flat face, resolved each render by `sectionFrame` so a face follows the
model), an `offset` expression, `flip`, `on`), not in the document and not
undoable; `useSection` (called in `AppShell`) turns it into a
`SectionClip` (origin and the normal of the **removed** side) that
`Viewport` takes as `sectionClip` and puts in the pick scene
(`PickScene.clip`). Bodies, edges, silhouettes and dialog previews get
three.js clipping planes (`clipPlanes`, `localClippingEnabled` only while
on; **every drawn plane comes from `planeOf`, which sets it `CLIP_INSET`
(1e-3 mm) into the kept side** so a face lying in the plane is cut away
whole and capped, not speckled by float rounding); the grid, origin and sketches stay unclipped; the cut is capped per
body by the stencil method in `viewport/SectionCap.tsx` (the canvas asks
for `stencil: true`), tinted through `capColors`. **`pick.ts` skips what
is clipped and treats what lies behind a cap as occluded** (`capDepth`),
so a new pick path must go through `pickStack`/`pickBox`. The tool is
Construct › Inspect › Section Analysis (ADR-0079, R3-10; `Shift+S`, session tool `section`,
panel `SectionPanel`, arrow `SectionOverlay`), the browser has an
Analysis folder while a section exists, and a selected flat face takes it
at once ("Section Here" in the context list). **P4-12 (ADR-0045's amendment)
made it several planes and a box**: `viewport.section` is a **list** of up to
three `SectionState`s (`MAX_SECTIONS`; `setSection` still takes one state, read as
a list of one, plus `addSection`/`updateSection(patch, index)`/`removeSection`)
and `viewport.sectionBox` (`SectionBoxState`: centre and half-size expressions)
is exclusive with them (a box counts as six planes; setting one clears the
other). `useSection` gives `rows` (a plane's state, frame, offset, clip), `box`
(values in mm) and `clips` (a `readonly SectionClip[]`: every plane, or the box's
six from `boxClips`); **the view, `PickScene.clip` and the thickness mark take
the list** (`isClippedAny`: outside any plane is clipped), `capDepth` finds a
cap per plane only where the other planes keep the crossing, and `SectionCap`
draws **one cap per plane**: its stencil passes clip by that plane alone (the
count of faces behind the plane decides "inside the solid") and its quad
shader discards what the other planes cut (a uniform array). **The sketch
palette's Slice (P4-12, ADR-0031 §5) is a fourth clip source**: the open
sketch's plane, the camera's side removed, appended to `clips` while a sketch
is open and `viewport.sketchSlice` (the `sketch.slice` preference) is on —
and with it on, the person's own planes keep clipping in sketch mode too.
The panel lists
rows (plane, Offset, Flip, Show, Change, Remove from the second row) with "Add
plane" and "Box"; `SectionOverlay` has one handle per drawn plane or box face;
`SectionBoxWire` draws the box's edges. Section Here adds a plane (replaces
the only one, the last at the limit, a box).
ADR-0046 (P3-03) added shell: `packages/core/src/shell.ts` (inputs `faces`,
`bodies` (bodies hollowed closed), `thickness`, `direction` inside/outside:
`shellSettings`, `shellInputs`), the evaluator
`packages/kernel/src/features/shell.ts` (faces by `ctx.resolve`, one body at
a time, `nameShell`: **the outer skin keeps the original face names in both
directions**, new faces are `shell:<id>:inner|rim|round:(<source>)`) and the
facade's `shell(shape, thickness, outside)` (`MakeThickSolid` on the stack
and **on a copy of the body**; a result must pass
`BRepCheck_Analyzer`, a positive volume and **a minimum distance from the
offset faces to their originals of at least the thickness**, because OCCT
builds valid junk for a wall thicker than a curved face's radius; with no
removed face OCCT returns only the skin, so the solid with a void is assembled
by hand; on failure the thickness is bisected: `[status, value]` read through
`Kernel.shell`'s `ShellError.problems`). The Shell tile has no default key.
**P4-12 (ADR-0046's amendment)** added **wall sets** — `wallFaces`/`wallThickness`
… `wallFaces8`/`wallThickness8` (`SHELL_MAX_WALLS`, `shellWallSets`; the
dialog's "Wall faces"/"Wall thickness", set n + 1 shown once set n has faces,
`tangentChain`) — built by the facade's **`shellFaces`** (walls staged with
`clearWalls()`/`pushWall(face, thickness)`; `BRepOffset_MakeOffset` with
`SetOffsetOnFace`, **sharp joins**, because round joins spread a face's offset
over every diverging edge; a smooth chain takes one thickness, two sets in one
chain are refused, and a body with a sharp edge inside a smooth chain is
refused before OCCT runs, ADR-0051's trap); `Kernel.shell(…, walls)` calls it
only when there are walls, so a shell without sets computes as before. And a
removed face that runs smoothly into a neighbour (`touchesTangentFace`) is no
longer refused when it is **flat, each other edge meets a neighbour that runs
smoothly into it or is flat (square or slanted), and it touches no other
removed face** (`openingRoute`, `pluggable`): the body
is hollowed closed and the opening cut as a **plug** (`buildPlugged`: the
face's prism in common with the cavity moved out by two walls; history through
`recordPlugged`, the plug's faces are the rim). The old refusal's heap trap
didn't reproduce in about 3,000 unguarded builds (mimalloc `-O3` and
`emmalloc-memvalidate` too); OCCT simply never builds those openings, so
the faces plugs can't open stay refused (status 6). Native harness:
`spikes/p4-12-shell-faces/` (`run.sh`, `run.sh sweep`, `run.sh sweep2`).
**ADR-0046's second amendment (2026-10-12)** widened `pluggable` from "square"
to "flat" (a crease at any angle): the plug's lateral boundary is the removed
face's own outline, and the moved cavity only has to land on the neighbour's
planar inner surface, so an **opening past a slanted neighbour** next to a
fillet computes (case 2, the harness's `run.sh slanted` corpus). It also adds
a **corner plug** where two removed faces share an edge (or three share a
vertex): their prisms in common, in common with the cavity moved out along
the **sum of their normals**, so the bar between the openings is removed
(case 3, `run.sh corners`); the plugs are **fused** into one tool before the
cut (a compound cut drops the shared region) and `recordPlugged` carries the
corner plugs' faces into the first removed face's rim. An opening through a
**curved** face and **round joins with wall sets** stay refused (status 6).
ADR-0048 (P3-10) added the 3D-print aids (`apps/web/src/print/`, no
facade or schema-version change): **Place on Bed is its own feature
`placeOnBed`** (`core/src/place-on-bed.ts`, kernel `features/place-on-bed.ts`,
dialog `features/place-on-bed.ts`; flat `face` inputs, one per body, and an
optional `spin` angle about the vertical through the face's centre (P3-17);
the kernel works out the smallest turn and the drop to z = 0 with `faceDown`
in `features/matrix.ts` on every recompute, through the same
`transformBodies` as Move, so names survive; warns when the faces are already
on the bed or a body reaches below it; also a flat face's context entry).
**Print Info** (`usePrintInfo`, `PrintInfoPanel`) sums `KernelApi.inspect`
body volumes **and areas** and turns them into the printed volume, weight,
filament length and cost (`printEstimate` in `material.ts`; the walls, line
width, infill, price and the material are the `print.material` preference, not
a document setting: `skin = min(volume, area × walls × lineWidth)` per body,
`printed = skin + interior × infill`, at 100 % infill exactly P3-10's solid
numbers; every field is a plain number of its own unit — the line width is mm
whatever the document's units — checked by `checkPrintField`; support volume
needs a slicer, so it is not modelled (P4-12)). **Overhang analysis is view state** (`viewport.overhang`,
`OverhangState`: an angle expression, a `down` axis or a picked flat `face`
(its outward normal is down, its plane the bed; P3-17), `on`), classified
per triangle on the CPU for the counts (`print/overhang.ts`: normal ·
down > sin N, bed contact excluded; `data-overhang`) and shaded per fragment
by a patch of the face material (`viewport/overhangShading.ts`,
`onBeforeCompile`, colour token `--x-error`); a row in the browser's
Analysis folder next to the section's.
ADR-0072 (P5-06) added the **wall-thickness check** (`apps/web/src/print/`,
no facade, kernel, schema or file-format change): **thickness is a ray per
triangle of the display mesh** (`print/thickness.ts`: from the centroid
`1e-4 mm` inside along the triangle's inward normal to the first hit on the
same body's mesh, `NaN` where the ray misses and never flagged; thin is
strictly below the minimum), cast once per mesh and cached by its identity
(`measureThickness`; a new minimum only re-classifies), against the **picking
BVH** (`meshBvh` in `selection/pick.ts`, one per mesh, built on demand so the
home screen's bundle keeps out of three-mesh-bvh). The analysis is **view
state** like the overhang's (`viewport.thickness`: `ThicknessState` = `min`
length expression, `on`; the default minimum is two line widths of
`print.material`, "0.9 mm" at 0.45 mm) and follows every recompute. The
panel is 3D Print › Prepare › **Wall Thickness** (`wallThickness`, no key;
`WallThicknessPanel`, `useThickness`): Minimum as an `<ExpressionInput>`, a
"Show thin walls" checkbox, "Thinnest wall: 0.80 mm" and "Thin area: 226 mm²
in 2 bodies" or "No wall is thinner than 0.9 mm.", Done and Remove. Thin
triangles are shaded `--x-error` through a **per-node `aThin` attribute** on
the face material (`viewport/thicknessShading.ts`, always in the geometry,
mixed at `<alphatest_fragment>` so it runs after the overhang's
`<color_fragment>`: **thin wins** where both flag a triangle), the thinnest
spot is marked on a leader (`print/ThicknessOverlay.tsx`, hidden where a
section clips it or it is behind the camera), `data-thickness="min=0.9
thin=12 area=226 thinnest=0.8 bodies=1"` (`… off` while the shading is off,
`pending` while measuring, absent with no analysis) and a row in the
browser's Analysis folder (`data-thickness-row`, eye "Hide/Show wall
thickness"). **Hidden bodies are not measured or counted** (the attribute's
`bodies` is the measured count; the panel's "in N bodies" the ones with thin
area), a mesh body measures like any other, and the numbers are view-side
estimates on the display tessellation (a wall within the mesh deflection of
the minimum can be classified either way). Above `SLICE_AT` (15,000)
triangles the rays are cast in slices across animation frames with the panel
on "Measuring…" (ADR-0072's 400,000 was over its own 50 ms at the measured
300,000 rays a second — see its Results).
ADR-0047 (P3-07) added patterns: `rectangularPattern`, `circularPattern` and
`pathPattern` (`packages/core/src/pattern.ts`, kernel `features/pattern.ts`,
`pattern-layout.ts`, `pattern-path.ts`, dialogs `apps/web/src/features/pattern.ts`;
the tools are Solid › Pattern's tiles since ADR-0079). The **original counts as an instance**
(count 3 = two copies). `objects` is `bodies` (copies, or `join` into the
original) or `features`: the tool a solid feature that joins or cuts made
(`operate`'s `PreviewTool` now carries its `names`) is copied to every
placement and applied by `operate` again. A feature is referred to by
`{kind: 'feature', id}` (a new `GeomRefKind`; the engine's and the timeline's
dependency rules follow its ID, so ordering, delete-refusal and Fix
References just work; `EvalContext.featureName` is for messages). Every layout
is a list of `Placement`s (`Matrix12`, label, slot; `seriesOf`, `seriesStep`,
`angularStep`, `slotOf` in core are the shared maths); **instance faces are
`pattern:<id>:<label>:from:(<name>)` and copy body IDs come from the
instance's position, so both survive a growing count**. Many instances are
one boolean: `mergeTools` fuses instances that interfere in trees and passes
the groups as one compound (OCCT refuses a compound argument whose solids
interfere); **a pattern of a cut colours the interference graph and cuts one
class at a time** (`toolSet`, `ToolSet` in `features/operation.ts`; P3-17),
and **`operate` finds the bodies a tool touches solid by solid**
(`touchingBodies`: boxes first, then the exact distance to the solids whose
boxes meet). **P4-12's amendment made that search cheaper**: a pattern's copies
(and a mirror's) are grouped on their **boxes alone** (`mergeTools`, no exact
`distance`; over-grouping only fuses an instance that needn't have been, a
valid boolean argument) and `toolSet` colours its graph on boxes alone too,
while a feature's own tool parts (thread, hole, emboss) keep the exact test — a
10 × 10 join went 2.5 s → 1.7 s. A path is a polyline (`pathFromRefs`; the sketch output has
`curves`). Mirror's `objects: 'features'` uses the same `replayFeatures`.
The dialogs have a new field kind `features` (a checkbox list of
`repeatableFeatures`). No facade change.
**P4-12 added a skip list, count handles and a path handle** (ADR-0047's
amendment, no facade change): all three types take an optional `skip` input, the
**position labels** (`"2"`, `"m1"`, `"1x3"`) of the instances they leave out, as
the new `labels` input kind (`skipLabels`, `toggleSkip`, `isOriginalLabel` in
core). **A label names a position, so nothing in the list can go stale**: the
kernel drops those placements before any boolean (`splitSkip`; the rest is
exactly what the pattern would have made), the original can't be skipped ("The
original can't be skipped."), a label past the count is ignored **and kept**,
every instance skipped warns, and a skipped instance is previewed as a faint
ghost (the new `PreviewToolStyle` `skip`, drawn beside the rest of the preview,
never instead of it). The evaluators **report the layout** (`PatternReport`:
every instance's centre, its label and whether it is skipped, plus a
`PatternSeries` per direction — direction, step, count and where its first and
last instances are; `rectangularSeries`/`circularSeries`/`pathSeries` and
`patternReport` are pure in `pattern-layout.ts`), which comes through
`Preview.pattern` for the dialogs, so the app never repeats the layout maths
(the path pattern cannot work it out at all: its points come from OCCT). Three
new manipulator kinds: **`toggle`** (a dot on every instance's centre, filled
while it is made and a ring with a slash while it is skipped, a click skips or
keeps it; off above `MAX_PATTERN_TOGGLES` = 100 instances), **`count`** (a
handle on the last instance of each series, dragged along the row or round the
arc: `draggedCount` makes it the nearest whole number of steps reached, or, when
the measure is an extent, the count scaled by the share of it the drag reached)
and the path's **`distance`** handle at the last instance (its scale is
`count - 1`, since with the distance read between neighbours the arrow spans the
whole run). **A pattern's handles carry a `lift` (14 px)** — drawn across the
shaft, or straight out from the axis for a turn, with a tick back — because an
arrow's tip and a count handle land on an instance's centre, where its dot is;
a lifted drag measures from the origin, since where a lifted head was pressed
says nothing about the value. A `labels` **field** kind is the read-only
"Skipped" line with a Clear button; an empty list makes **no input at all**, so
every existing pattern file is unchanged. **The `labels` input kind reaches
`@extrudo/api` too** (ADR-0068): `generate.ts`'s `readInput` gives it the type
column `string[]` and `inputs.ts` maps a call's plain list to it
(`d.rectangularPattern({ …, skip: ['2'] })`), like `file` has no metadata of its
own, so **a new input kind needs a case in both**.
ADR-0049 (P3-04) added hole: `packages/core/src/hole.ts` (one feature type
that **always cuts**: `plane`, `points`, `x`/`y`, `type` simple /
counterbore / countersink, `extent` blind / through, `diameter`, `depth`,
`tipAngle`, `cb*`, `cs*`, `flip`; `holeSettings`, `holeInputs`, and
`HOLE_PRESETS`: M2 to M8 normal-fit clearance with counterbore and
countersink sizes, M2 to M5 heat-set inserts), the evaluator
`packages/kernel/src/features/hole.ts` (**no facade change**: each hole is a
half section `holeSection` turned by `namedRevolve`, the holes merged by
`mergeTools` and cut by `operate`; depth is to the end of the full diameter,
the drill point adds to it; faces `hole:<id>:side:wall|tip|floor|cbwall|
cbfloor|cone`, prefixed `<point>.` with sketch points; a hole that cuts
nothing is an error, some of several a warning) and the dialog
`apps/web/src/features/hole.ts`. **A click on a face places the hole**: the
plane picker passes the pick ray's world point (`SketchTarget.at`), and a
spec's `placeAt` turns it into X and Y (and makes a click add, not toggle,
the face); `FeatureDialogSpec.onChange` lets the Preset dropdown fill the
sizes (the preset is not an input: `presetOf` shows the preset the sizes
match). **Sketch points** are `sketchEntity` refs to points
(`SketchOutputData.points`); a dialog field with `sketchPoints: true` turns
on the hidden selection-filter key `sketchPoints`, the view then draws and
picks the points of the shown sketches. A hole is a patternable feature
(`repeatableFeatures` counts it as a cut).
ADR-0050 (P3-13) hardened things: `packages/kernel/src/fuzz.test.ts` makes
seeded random edits on `fixtures/benchmarks/*.extrudo` as the app would
(solve, recompute warm with `strictLeaks`, sync projections) and fails on a
crash, an "Internal error", a leak or a warm/cold difference (add new
fixtures to its list). **Big sketch changes are solved in steps**
(`solveGradually` in `@extrudo/sketch/inference`, used by the host's
`settle` and `settleProjections`): planegcs takes the nearest solution and
dimensions are unsigned, so one solve put B2's inner wall on the far side of
an edge that moved further than the wall. `loadDocument` **leaves out
unknown keys** (`LoadResult.dropped`) and reads a newer format version when
only keys are new; `loadNotice` words it, `ProjectStore.load`/`importFile`
take `{ onNotice }`, the app shows it when the project opens; the engine
ignores unknown feature input names with a warning. Versions: the index is
rewritten under `ProjectStoreOptions.lock` (Web Locks in the browser),
records `next`, and `deleteVersions` exists (Delete, "Delete older
versions"). A recompute's first new error is a **quiet** notification
(`ToastOptions.quiet`: history only) with Edit (`shell/recomputeErrors.ts`).
`exportMeshes(…, onProgress)` meshes body by body; `false` cancels;
**`RecomputeEngine.hold(bodies)` keeps shapes alive across yields**.
Silhouettes use `silhouettePlan` (facing per node). `e2e/a11y.spec.ts` is an
axe audit of the main screens in both themes (`KNOWN` is empty since P3-17).
ADR-0051 (P3-08, first half) added **Offset Face** and **Press Pull**:
`packages/core/src/offset-face.ts` (feature `offsetFace`: `faces`, `distance`,
**positive moves along the outward normal**, so a pad grows and a hole's wall
closes in), the evaluator `packages/kernel/src/features/offset-face.ts`
(**every face keeps its name**: the facade's face-to-face `generated` is read
as `modified`, `facesKeepNames`) and the facade's `offsetFaces(shape,
distance)` (`BRepOffset_MakeOffset` with a global offset of 0, `SetOffsetOnFace`
on the picked faces, sharp `GeomAbs_Intersection` joins, on a copy, builder on
the stack; the skin is closed into a solid by hand; a result must be valid,
have grown or shrunk the right way and keep the moved faces at least the
distance from their images, since OCCT returns valid junk for a wall pushed
past a cylinder's axis; bisection gives `[status, value]` read through
`OffsetFaceError.problems`; solids with a sealed void are refused, and **so are
bodies where one smooth chain has a sharp edge inside it** (two fillets
meeting at a corner, `smoothChains`): OCCT's offset traps the wasm heap on
them whichever face is offset, even the floor). **ADR-0051's amendment
(2026-10-11)**: a notch across a cylinder's seam made OCCT's offset return a
null shape for every face, so a body with a seam is retried on a copy with its
closed faces divided (`ShapeUpgrade_ShapeDivideClosed`) and merged back
(`UnifySameDomain`), the history composed through the three steps
(`DividedOffset`), and `offsetIsGood` also asks `farFacesKept` (a face neither
moving nor next to a moving one keeps its area and centre), which refuses the
valid junk OCCT can make of a face pushed through the body.
**ADR-0051's amendment (2026-10-14): a round next to a moved face keeps its
radius.** The evaluator passes the unpicked fillet rounds (name `fillet:…` or a
copy of one, cylinder or torus) of the picked faces' smooth chains
(`roundsNextTo`; `Kernel.offsetFaces(…, blends)`, facade `pushBlend`, cleared by
`clearArgs`); the facade first tries `buildReblendedOffset` (remove the rounds
next to a moving face with `BRepAlgoAPI_Defeaturing`, offset the picked faces,
re-fillet each round at its radius between its two smooth sides; the moving set
doesn't pass through a round, so faces past it stay) with the history composed
in `ReblendedOffset` and **each old round face recorded as modified into its new
face** (keeps its name); any failure falls back to the plain offset unchanged.
A picked round is offset as before. **ADR-0051's second amendment
(2026-10-14): only with the input `keepRounds` on** (`bool`, optional;
absent or off passes no rounds, so every offset saved before computes as it
did; no format bump, no migration). The dialog, `offsetFaceInputs` and the
`.f3d` import write it on; the dialog's toggle "Keep rounds' radius" (read as
off for an old offset, `fromInputs`) makes the face field (`keepRounds:
'keepRounds'` on the selection field) pick through the kernel's `smoothFaces`
(`features/offset-face.ts`; engine, service, `KernelApi`, `Recomputer`): the
chain walked across shared edges but not into a kept round (`isKeptRound`, the
`roundsNextTo` rule), a click on a round takes its whole chain, walls are
started first; the kept rounds' face IDs live in the values' labels under
`keptRoundsKey(field)` (no input) for the info line "N rounds keep their
radius", re-asked after each pick, on edit and when the toggle changes (which
re-picks: on drops rounds, off adds whole chains).
**OCCT moves the faces that run smoothly into a picked face together** (angle
under 4 degrees), so the facade's `tangentFaces` and `KernelApi.tangentChain(…,
kind)` let the dialog's face field (`tangentChain: true`) pick the whole chain
like fillet's edges. **Press Pull (`Q`) is a command, not a feature**
(`features/pressPull.ts`, `pressPullTarget`; `AppShell.run`): it opens the
dialog that fits the selection with it filled in, a profile Extrude, a face
Offset Face, an edge Fillet, or toasts what to select. **Extrude and Revolve
propose their operation through one rule** (`features/operation.ts`:
`proposeSweep`, `isOnBody`; `extrudeTravel`, `revolveTravel` say which way the
sweep leaves the face): new body for plain profiles, join out of a body or both
ways, cut into it, for faces and for profiles of a sketch on a face. Patterns
of faces did not fall out of Offset Face and stay open.
ADR-0053 (P3-08, second half; B6 of P3-14) added **Split Body**, **Scale** and
**Draft** (core `split-body.ts`, `scale.ts`, `draft.ts`; kernel
`features/split-body.ts`, `scale.ts`, `draft.ts`; dialogs of the same names;
tools in the Modify tab since ADR-0079: Split Body and Scale in Transform, Draft in Modify; no keys). **Split Body needs no facade
change**: each side is the `common` of the body and a box on that side of the
plane (placed by `transform`), the two sides named as one compound so a face
cut in two is `#1`/`#2` (names stay unique across bodies, which `resolveRef`
needs) and the plane's faces `split:<id>:cut:above|below`; `splitSolids` gives
the largest piece the body's ID; `keep` both/above/below (above = along the
plane's normal). **Scale** is the facade's `scale(shape)` (six staged numbers:
centre and X/Y/Z factors > 0; centre default the bodies' box centre,
`centreOf`): equal factors through `gp_Trsf`, unequal through
`BRepBuilderAPI_GTransform`, **which makes every surface and curve a B-spline**;
`restoreCanonical` puts flat faces back on planes and straight edges between
them on lines (`BRepTools_ReShape`), history through `ModifiedShape` (its
`Modified` is broken) in `recordImages`. **Draft** is the facade's
`draft(shape, point, normal, angle)` (staged faces; neutral plane through the
point, its normal the pull, `flip` reverses; positive narrows along the pull):
`BRepOffsetAPI_DraftAngle` on a copy (`ConnectedFaces` throws: don't call it),
faces other than planes, cylinders and cones and planes parallel to the
neutral plane refused before OCCT runs, **results whose faces crossed refused**
(edge ends out of order through their vertices' images, a cone's tip inside
its face), the largest angle by bisection, `DraftError.problems`. Every face
keeps its name through all three; Scale copies are renamed like Move's. The
Draft dialog's angle arc starts along the pull. B6 (wall hook) is three joined
boxes, Draft1 on the arm about the plate's front face, Fillet1 on the plate's
top edges and the inside corner (`e2e/benchmark-b6.spec.ts`, fixture
`b6-wall-hook.extrudo`, in the fuzzer's list).
ADR-0052 (P3-12) added onboarding (`apps/web/src/onboarding/`, no kernel,
facade or schema change). **The tutorial reads the design, never clicks**:
`tutorial.ts` has five steps (sketch, a sketch with four lines, a dimension, an
extrude, a fillet/chamfer/shell) as pure `done({doc, mode, activeTool})`
functions, the current step is the first undone one at or after the "Skip step"
floor, so undo steps it back and any route works; **a new step needs a
`done` over document facts, not a flag**. The card (`TutorialCard`) is not
modal, takes no focus, is an `aria-live` region and hangs under the toolbar
tile `[data-tool="<id>"]` (every tile has `data-tool`; `useTargetBox` polls
it), Esc closes it while focus is in it. It runs on an empty design: the home
card, the Menu's Tutorial and the Ctrl+K command `tutorial` start it (a design
with features gets a new one: `FileActions.startTutorial`, `requestTutorial`
taken once by `useTutorial`); the `onboarding.tour` preference (`new` shows
the home card, `started`, `dismissed`, `done`) is all it remembers. An
empty design shows no hint (`ViewportHint` was removed in the owner's UI review 3,
R3-15; ADR-0052's amendment). **The
home screen's gallery is `home/gallery.ts`** (the Wall bracket from code, B2,
B4, B5 from `fixtures/benchmarks/*.extrudo` as hashed assets through
`readArchive`, so migrations apply and they are precached; each opens as a copy
under a new ID with its checked-in `home/templates/*.png` as thumbnail).
**Tooltips take a `demo` slot** (`ToolDemo`, a muted looping `<video>` of
`public/demos/<toolId>.webm`, rendered only while the tooltip is open, a still
under reduced motion, removed on a load error); **demos are not precached**
(`SKIPPED` in `precache-plugin.ts`, and `sw.js` leaves `/demos/` to the
network); `DEMO_TOOLS` in `demos.ts` lists the tools that have one (every tile of the Solid, Modify, Construct, 3D Print and
Sketch tabs since the owner's UI review 3, R3-16; `WHOLE_TABS` in `demos.test.ts` checks it per
tab) and `demos.test.ts` checks it against the files (150 kB each, 4 MB in all). **`pnpm demos`**
(`scripts/record-demos.mjs` → `e2e/record-assets.spec.ts`, which skips itself
without `RECORD_ASSETS=1`; `-g "demo: extrude$"` records one) records the clips and the template pictures through
the real app: a screenshot loop (`e2e/demo-recorder.ts`) piped into Playwright's
own ffmpeg (`playwright install ffmpeg`: MJPEG in, VP8 out, `crop`/`scale`
filters), a drawn cursor in the page. **A clip is framed round the action**
(ADR-0052's amendment of 2026-10-11): a 400 × 250 px region (`FRAME`) that
`frameWorld` zooms the geometry into and pans clear of the browser, toolbar and dialog
(`safeArea`), no chrome and no text the clip depends on; each scene imports its small
design from `fixtures/demos/<tool>.extrudo` (written through `@extrudo/api` by
`packages/cli/src/demo-designs.test.ts`, `WRITE_FIXTURES=1`), pans with the nav bar's
Pan tool and a left drag (a right drag opens the marking menu), and is encoded again
at a lower bitrate when it is over 140 kB (200 kbit/s first). Look at three frames of every clip at 236 px before
committing it. **A scene that picks planes keeps its bodies in front of the origin planes**
(x > 0, y < 0 in the home view): their squares show while a field picks planes and take the
click (`constructScene`); a sketch scene draws its shapes with Ctrl held so nothing is
inferred (`sketchScene`); Send to Slicer's clip is the Export dialog, because the web build
that records has no slicer (ADR-0052's amendment of 2026-10-15).
ADR-0054 (P3-15) prepared the public release: **hosting is Cloudflare Pages**,
deployed by `.github/workflows/deploy.yml` (after CI succeeds on main; skips
cleanly without the secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`;
the owner's steps are in `docs/deploy.md`). **`apps/web/public/_headers` is
the host's header file and is also applied by `vite preview`** (the global
`/*` block, read by `pwa/headers.ts`), so every e2e spec runs under COOP
`same-origin`, COEP `require-corp` (the app loads nothing from other origins:
fonts are bundled) and a CSP; **a new feature must not load a cross-origin
resource or evaluate strings**: script-src has had no `'unsafe-eval'` since
ADR-0067 §H1 (both WASM builds with `DYNAMIC_EXECUTION: 0`, zod's JIT off),
and `e2e/hosting.spec.ts` fails on any violation. Cloudflare **joins** the
headers of every matching rule, so Cache-Control rules must not overlap (tested).
**The app's public address is `SITE_URL`** (`pwa/site.ts`, default
`https://app.extrudo.org` since ADR-0057; `__SITE_URL__` in `index.html`):
never hard-code a domain (`extrudo.app` was taken). **The service worker never serves a redirected response** (Pages
redirects `/index.html` to `/`; Chrome fails such a navigation with
`ERR_FAILED`: `plain` in `sw.js`, ADR-0054 amendment). **The service worker waits** instead of
`skipWaiting()` on update: `platform/updates.ts` watches the registration,
`useUpdateNotice` (home and project pages) shows "A new version of Extrudo is
ready." with Reload, which runs `saveEverything()` (`project/autosave.ts`, every
live autosaver) before activating and reloading, and refuses when a save
failed. `scripts/check-licenses.mjs` (in `pnpm lint`) allow-lists the
production dependencies' licenses; **a new dependency with a new license needs
the allow-list and `NOTICE`**. The repo has README, CONTRIBUTING,
CODE_OF_CONDUCT (contact `conduct@extrudo.org`, forwarded by Cloudflare
Email Routing: `docs/deploy.md`), SECURITY (GitHub private reporting), issue
forms and a PR template; `docs/file-format.md` is MIT.
ADR-0057 (2026-10-03) split the addresses: **`extrudo.org` is a landing page**
(`apps/site`: static Vite page, brand tokens, no internal packages, its own
stricter `_headers` (which allows Cloudflare Web Analytics' two hosts, the
amendment; the app has no analytics), addresses (and the contact email) from
`apps/site/addresses.ts`), **the stable app is
`app.extrudo.org`** (Pages project `extrudo`, production, deployed only by a `v*`
tag whose commit passed CI on main, or "Run workflow" target `stable`) and **the
latest build is `edge.extrudo.org`** (branch `edge` of `extrudo`, every green main
run, with the landing page in project `extrudo-site`); `deploy.yml` has `plan`,
`app` (per channel) and `site` jobs. The site's **`public/sw.js` retires the
app's old service worker** at extrudo.org (skipWaiting, delete caches,
unregister, reload; handles the old app's `SKIP_WAITING`), and `#/<route>` links
go on to the app. The walkthrough's nine pictures
(`apps/site/src/images/walkthrough/`) are recorded from the real app
(`pnpm demos -g walkthrough`, `e2e/record-assets.spec.ts`). **The amendment of
2026-10-05 made the landing page dark only** (`site.css` re-declares the dark
tokens with `:root:root`; `tokens.css` and the API docs still follow the system
theme), put its content in `index.html` (no runtime DOM building; **no `style`
attribute anywhere**: category colours are `.cat-*` classes, icons an SVG sprite
used with `<use>`, scripts write only through the CSSOM), added **the parametric
toy** in the hero (`toy-model.ts` pure and unit-tested, `toy.ts`; the build writes
the default tray into the page) and **a pinned scroll stage** instead of the sticky
side-by-side walkthrough (`walkthrough.ts`: the app's window tilted below the
hero, the scroll deals the nine pictures like a deck, a timeline rail of chips with
the amber marker; the `ol` of figures stays, visually hidden, for screen readers).
ADR-0055 (P4-01) added **Sweep, Loft and Coil** (core `sweep.ts`, `loft.ts`,
`coil.ts`; kernel `features/sweep.ts`, `loft.ts`, `coil.ts`; dialogs of the
same names, Solid › Create's tiles since ADR-0079, no keys; all three patternable). The
facade's `pathSketch` (curves staged with `sketch*`, placed in a frame: paths
stay exact; the sketch output's `exact` curves feed it), `pathEdge`,
`pathWire` (chains pieces in any order), `helix` (**one edge per turn**: one edge for all turns made booleans slow and wrong), `sweep` (MakePipeShell per
wire, holes cut out with history; follow = corrected Frenet, fixed, binormal
for coils; **twist through an auxiliary spine** on a rotation-minimising
frame, refused on sharp paths; **scale through a `Law_Linear`**; a failed pipe
is retried from another section edge, since OCCT's result depends on the
wire's first edge) and `loft` (ThruSections; **a closed ring needs the
sections lined up by `BRepFill_CompatibleWires` first**, or OCCT caps it; rings
skip the self-intersection check, which flags their seams). **The profile
travels from the path's end nearer to it**, so it need not touch the path — but
it lands exactly where its sketch drew it, so a sweep **warns** when its
centroid is more than max(1 % of the path's length, 0.5 mm) from the path's
start line (`PROFILE_PLACEMENT`, `placementOffset` in `features/sweep.ts`:
measured across the path, so a section drawn anywhere along it is fine and only
its offset is wrong — B10 got 6 mm walls instead of 3). **The placement line
(ADR-0055's amendment, 2026-10-07)**: the evaluator also reports a
`SweepReport` (`{ kind: 'sweep', offset, limit, pathLength }` through
`Preview.sweep` as the emboss report travels) and the dialog's read-only
Placement line (`[data-info="placement"]`) says "Profile on the path's
start." or "Profile 6.2 mm from the path's start: the sweep carries it where
it is drawn." before OK.
Names: `sweep|loft|coil:<id>:cap:start|end`, `side:<source>` (`#n` per path
piece; a loft side after its earliest section's edge, `nameLoft`). `helixSweep`
(`features/coil.ts`: frame, radius, pitch, turns, taper, hand, any section
curves) could later serve P4-02's threads, which use their own `threadSweep`. Native harness: `spikes/p4-01-harness`
(`run.sh`, `run.sh leaks [n]`, `syntax.sh`, `occt-src.sh`). **Feature patterns
skip repeats that lie on the original** (`distinctPlacements`: a coil cut
repeated at distance 0 took OCCT 44 s). The fuzzer also edits
`fixtures/benchmarks/p4-01-sweep-loft-coil.extrudo` (written by
`features/sweep-loft-coil-fixture.test.ts` with `WRITE_FIXTURES=1`).
ADR-0056 (P4-02) added **modeled threads**: feature `thread` (`core/src/thread.ts`:
`faces`, `diameter`/`pitch` (**both absent: the kernel fits the ISO coarse thread
to each face**, `autoThread`), `extent` full/length, `length`, `offset`, `flip`,
`hand`, `tolerance` (radial, into the part's material; default 0.1 mm, the dialog
proposes the parameter `tolerance` when the document has one), `chamfer`;
`THREAD_PRESETS` ISO coarse/fine, UNC, UNF; `threadRadii` the ISO 68-1 basic
profile). **P4-12 (ADR-0056's amendment)** added a `profile` input (`iso`
default, `trapezoidal`, `buttress` with `loadFlank`, `bottle`) and the one
profile table `threadProfile(profile, pitch)` in `core/src/thread.ts` (lines
and arcs in (axial, radial) plus the depth), which the kernel's `toothSection`
stages so it knows no angles; `threadRadii(profile, …)` places the depth and
`THREAD_PRESETS` gains a Trapezoidal group and PCO-1881. The evaluator
(`kernel/src/features/thread.ts`) cuts ring − tooth per
face: the tooth swept by the facade's `threadSweep` (one helix edge per turn: one
long edge broke the boolean), lead-ins where the facade's `threadFace` says an
end is open; it always cuts, so it is patternable. Faces
`thread:<id>:side:f<k>.crest|flank0|flank1|root|end0|end1|lead0|lead1`. **P4-12 (ADR-0056's second amendment, 2026-10-07)** added **multi-start threads**: an optional `starts` input (unitless `expr`, 1 to 8, stored only when not 1) makes the helix's lead `starts × pitch` while the tooth keeps `pitch`; each piece has one tooth per start (the same section a pitch higher, faces `f<k>.s<j>.<role>`), the teeth one compound cut in one boolean, and `MAX_TURNS` counts turns per helix. **Its third amendment (2026-10-07)** added **tapered threads**: no input, the face decides — `threadFace` reads a cone too (`ThreadFace.taper`, the half angle signed along the axis, `radius` at `from`), the radii hold at the cone's small end (`ThreadPlan.anchor`) and every section moves by `shiftAt` with the slope, `threadSweep`'s trailing `taper` sweeps the tooth on a conical helix (`helixWire`, shared with `helix`, each keeping its own construction so straight threads and coils are bit for bit as before), an **NPT** preset group (`npt-1q8` … `npt-1`, `taper: NPT_TAPER`) fits a cone within 0.2° of 1:16 with Size `auto` (`autoTaperThread`), NPT on another taper warns and is cut with the face's, and the report (`ThreadReport`) gives the dialog's Thread line ("NPT 1/2", "Ø20 × 1.5, taper 5°"); BSPT is deferred. Native harness `spikes/p4-12-thread-taper/`. About
0.1 s per turn (booleans); **the facade's booleans used to build twice** (fixed
in `finishBoolean`). Native harness: `spikes/p4-02-harness/`.
ADR-0058 (P4-03) added **sketch text**: the `text` sketch entity (`core/src/sketch/schema.ts`,
sized and placed by two points, so its height is the cap height and its
direction the rotation), shaped by opentype.js **only in `@extrudo/sketch/text`**
behind core's shaper registry (`registerTextShaper`, `placeText`,
`textPolylines`; the curves are `<text>.<n>` sub-IDs of lines and exact
B-splines, so no facade change). Rules a change must keep: **a font ID never
changes its file** (`family-style@n` in `packages/fonts`), **the whole-text
reference is `{kind:'sketchEntity', id:'<sketch>/<text>'}`** (`partsOf` in
`kernel/src/features/sources.ts`: every ink region of that text, and it survives
editing the string, the font and the size — per-letter profile IDs don't),
**ink regions are marked** (`Profile.text`: a region whose whole boundary is one
text's sub-curves and whose interior has a non-zero winding number; counters
have winding 0 and stay open), and **`KernelApi.addFont` sends a font before the
recompute that needs it** (`Recomputer`, and `fonts.ts` on the UI thread, which
bumps a version every text-geometry cache keys on). The tool is `text`
(Shift+T) in the Create group with its panel in `panels.tsx`; the draft lives in
`textDraft.ts` so the panel doesn't pull the tools' chunk in with it.
**Amendment of 2026-10-21:** five more bundled fonts, stand-ins with the widths of the
families `.f3d` files use most (ADR-0083's amendment of the same day): `arimo-regular@1`,
`arimo-bold@1`, `archivo-narrow-regular@1`, `archivo-narrow-bold@1` and
`sofia-sans-extra-condensed-bold@1` (the one subset with Cyrillic `U+0400-045F` too).
They are ordinary bundled fonts (picker, CLI, precache). Re-running `build-fonts.sh` gives
every pinned font new bytes: commit only the new files (`packages/fonts/README.md`);
`index.test.ts` checks that the manifest lists exactly the files in `fonts/` and each
family has its `OFL-<family>.txt`.
ADR-0059 (P4-07) added the **Customizer and configurations**: a user parameter
carries an optional `customizer` (`min`, `max`, `step`, `group`) that exposes it
for changing, and a design holds named value sets (`configurations[]`). Core is
`packages/core/src/customizer.ts` (commands `setParameterCustomizer`,
`addConfiguration`, `updateConfiguration`, `removeConfiguration` and
`setParameterExpressions`; pure helpers `customizerRows`,
`configurationChanges`, `currentConfigurations`, `capturedValues`,
`isPlainValue`; `removeParameter` drops a deleted parameter from every
configuration). The app is `apps/web/src/customizer/` (the panel, its
controller) plus the Parameters dialog's star and its Min/Max/Step/Group row with
a Clear button each (since ADR-0086: an inspector with a Customizer switch, ranges as
expressions, the group on the parameter). **Every parameter write goes through the shell's `apply`**,
applying a configuration included (so the sketches whose dimensions use a
parameter are re-solved in the same undo step, ADR-0016); **no stored active
configuration** — one goes stale after any edit or undo, so the panel shows the
one whose values the document has ("Custom" when none); **ranges are slider
ranges, not limits** (a value outside is kept and the row warns); **a slider drag
is one undo step** (a transaction, which is why `useShortcuts` asks
`ownsKeys`, so Ctrl+Z after a focused slider still undoes the drag);
**the templates' exposure lives in `home/gallery.ts`**, not in the fixtures (the
benchmark e2e specs rewrite those), applied to the copy through core's commands.
ADR-0060 (P4-04) added **emboss and deboss**: one `emboss` feature
(`core/src/emboss.ts`) with a `mode`, which puts the profiles or a whole text of
a sketch in any plane **parallel** to a face **onto** that face in one step —
Emboss joins material outwards, Deboss cuts inwards, and only the body that owns
the face is touched. A **flat** face's profiles are moved onto its plane (a
translation along its outward normal) and swept with `namedPrism`; a
**cylindrical** face's are **wrapped round it** through `Kernel.wrapOnCylinder`
(the evaluator `kernel/src/features/emboss.ts`), where the map `(s, z) →
(s / R, z)` is exact: a line to a line, a circle to an ellipse, a B-spline pole
by pole, both caps exact surfaces on R and R ± depth and the walls between them
exactly radial. **The frame rule**: the sketch plane's normal must be square to
the axis (within 1e-6), `r` points from the axis towards the sketch plane,
`across = a × r` and `corner` is the foot of the axis on the plane (the plane's
distance from the axis doesn't matter); which way round the wall the letters
grow is the face itself, read with `Kernel.threadFace` — a boss's wall is convex,
a hole's concave — so an emboss on a hole fills its free space in and a deboss
cuts into the material round it. Names are the prism's: `emboss:<id>:cap:end` and
`…:side:<sketch curve>` per wall (`namedWrap`, whose history is a prism's).
**P4-12 (ADR-0060's amendment)**: a **cone** wraps the same way (facade
`wrapOnCone`, the cylinder's map with the frame on the axis at the profiles'
area centroid's height, `z` along the generator; `coneFace` gives convex or
concave), and **any other face** (sphere, torus, free-form) takes the profiles
**projected** along the sketch's normal (`projectOnFace`: the prism `common`
the face's thick piece, a sphere's or torus's exactly concentric; refused past
the face's edge or outline as seen from the sketch); the method is no input but
an `EmbossReport` (`Preview.emboss`, the dialog's read-only "Method" line). A
wrap may run up to a whole turn ("The profile is wider than the face's
circumference."); "tangent to the face" and several faces stay deferred. Native
harness `spikes/p4-12-emboss-faces/`. The tool is `emboss`, a tile of Solid ›
Features (ADR-0079), no key; `e2e/emboss.spec.ts` covers both kinds of face
in both modes. Native harness: `spikes/p4-04-harness/`.
ADR-0061 (P4-03b) added **user fonts as attachments**: `doc.attachments` holds
only what each file *is* (name, file name, media type, SHA-256, size) and the
bytes live beside the document — `projects/<id>/attachments/<sha256>` in the
project store, `attachments/<sha256>` in the `.extrudo` file, one copy however
many attachments or versions name that hash. Rules a change must keep: **the
bytes are written before the document that names them** (`writeAttachment` then
`addAttachment`, and `importFile` likewise; one design must never name a file
that isn't there), **a text's `attachment:<id>` font must exist in
`attachments`** (the schema refuses the document, so don't route it through a
command to "repair" it), **WOFF2 is refused** from the file name (opentype.js
can't read it), **garbage collection runs only from `saveVersion` /
`deleteVersions`** (`collectAttachments`, under the version lock — never per
autosave), and **the size limits live in storage** (`writeAttachment`: 10 MB a
file, 50 MB a design, plus "these bytes are not the file they claim to be").
On the app side `fontBytes` reads `attachment:<id>` through a project-scoped
resolver that `ProjectPage` sets (`useFontAttachments`, the cache follows the
project), so the UI thread and the `Recomputer` need no other change; both Font
selects list the design's fonts and offer "Add font…"
(`sketch/addFont.ts`, which parses the bytes with `fontName` before storing
anything). The Text tool's anchor click lives in `textDraft.ts`
(`TextDraft.placedAt`), because adding a font changes the document and the host
starts a tool afresh on any document change.
ADR-0062's P6-02 amendment added **the slicer launch on desktop**: `apps/desktop/src/main/slicers.ts` (pure over an injected environment: `findSlicers` per OS, the `slicers.paths` preference override, `openInSlicer` writing `<temp>/extrudo-slicer/<sanitised name>` and spawning detached, true unless ENOENT or a non-zero exit within 1.5 s), channels `slicer:list`/`slicer:open`, `desktopPlatform` setting `openInSlicer` and the new optional `Platform.installedSlicers`, which the Export dialog uses to disable missing slicers; the Send to Slicer tile is ready where `openInSlicer` exists. ADR-0062 (P4-08) added **print tolerance**: the document parameter named
`tolerance` (`TOLERANCE_PARAMETER`, thread's constant, re-exported from core's
`tolerance.ts`), set from the 3D Print tab's Tolerance panel (a field, the
Tight 0.1 / Normal 0.2 / Loose 0.3 mm buttons and a usage count from
`toleranceUsage`); **every parameter write goes through the shell's `apply`**, so
each change is one command and one undo step. **Hole presets add the tolerance
to every diameter they write** (`presetSizes(preset, hasTolerance)` →
`"3.4 mm + 2 * tolerance"`, depths plain; `presetMatches` recognises both forms,
whitespace apart), and the dialog's `onChange` takes a `Pick<DialogContext,
'doc'>` for it. The slicer hand-off is **desktop-only**: `Platform.openInSlicer`
is optional, the web platform leaves it out and the Export dialog's Slicer
select and "Open in slicer" button appear only where it exists (the launch is
P6-02, above).
ADR-0063 (P4-05) added **control-point splines and conics**: still one
`spline` entity, with `mode` (`fit`, absent in P1-05 files, `control` or
`conic`) and, for a conic, `rho` (0 < rho < 1, and then exactly three points:
start, shoulder, end). **Every entity spline's curve comes from `splineCurve`**
(`sketch/curves.ts`), which dispatches on the mode: `controlSpline` for poles,
`fitSpline` for fit, `conicSpline` for a conic. A conic's own curve is a
*rational* quadratic, which the facade's `sketchSpline` cannot take (no facade
change, so no OCCT build), so the conic is **stored exactly** (three points and
rho) and drawn as a **non-rational cubic within 1e-5 mm**
(`CONIC_TOLERANCE`, a tenth of the profile detection's vertex tolerance):
cubic Hermite pieces of the exact curve over parameter intervals that are
**subdivided adaptively** (over the tolerance → split at the middle, breadth
first, `CONIC_MAX_PIECES` = 160), joined as one cubic B-spline with **double
interior knots at the pieces' parameters** — so `splinePoint(spline, t)` is
the exact conic at every join — whose poles are the pieces' control points
with each join's shared point dropped. Every rho the UI offers reaches the
tolerance: 4 poles for the one-span parabola (rho 0.5), 66 for rho 0.3 and 290
for the fullest (rho 0.95, whose speed swings 19:1 between its ends). Because
the pieces are short, `curvePolyline` gives a conic **four segments per span**
(at least 96 in all), so a full conic is drawn, picked and profiled in under
600 points; fit-point and control-point splines keep sixteen.
Transforms (mirror, scale, copy, patterns) carry `mode` and `rho` over
unchanged (B-splines and conics are affine-invariant in their control points,
and rho doesn't change under an affine map); trim, break, extend and offset
refuse every spline mode as they refuse fit splines; projections stay fit.
The tools are `splineControl` and `conic` (`sketch/tools/conics.ts`), the
control polygon is `sketchSegments(…, controlPolygons)` and the panel's Rho
field writes core's `setSplineRho` through `ToolHost.apply`.
**P4-12's amendment (2026-10-06)**: a control spline may store its own `knots`
(the full clamped cubic vector, `points + 4`), and fit and control splines may
be `closed` — the periodic curve is emitted as the clamped B-spline that is
exactly it (`closedFitSpline`, `closedControlSpline`, `periodicToClamped`), so
nothing downstream has a new curve kind; the tools close on a click back on the
first point and the panel has a Closed checkbox (`setSplineClosed`). Trim and
break cut fit, control and closed splines by **knot insertion** (`splineRange`)
into control splines with knots, exactly their part of the curve (a trimmed fit
spline is a control spline from then on; dropped points take their constraints
with them); offset makes a **fit spline** through offset samples checked to
`OFFSET_TOLERANCE` (1e-3 mm), refused past the tightest bend, a chain with a
spline getting no dimension and a fixed offset spline. Extend and cutting a
conic stay refused.
**P4-12's second amendment (2026-10-07)**: **the conic is exact in the
kernel** — `planarCurve` stages a `mode: 'conic'` spline as a `PlanarCurve`
`{ kind: 'conic', start, shoulder, end, rho }` and `Kernel.#stageCurve` sends
it to the facade's **`sketchConic`** (the rational quadratic Bézier as a
degree-2 B-spline with weights `(1, rho / (1 − rho), 1)`), in profiles and in
sweep paths alike; profile IDs are unchanged and **the app still draws, picks
and detects profiles on the cubic** (`conicSpline`), export keeps its Béziers.
Because OCCT's fixed Gauss order is not exact on a rational edge, the facade's
`hasRationalCurve` makes `integrateVolume` use Gauss–Kronrod, `integrateArea`
go face by face (bounded on a plane with a rational edge) and a rational
edge's length `GCPnts_AbscissaPoint` (`edgeLength`; `LinearProperties` has no
error bound); a shape with no rational edge integrates as before. Native
harness `spikes/p4-12-conics/` (`run.sh`, `run.sh probe`, `run.sh leaks 300`).
**P4-12's third amendment (2026-10-16)**: an **open fit spline** may store
`tangents: { start?, end? }`, its end **derivative vectors** (mm per unit of the
0..1 parameter; `fitSpline(points, tangents)` adds a pole and a Piegl & Tiller
§9.2.2 row per end, and **without tangents runs the old code bit for bit**), and
a **control spline** a `degree` 1 to 5 (not closed, at least `degree + 1`
points; stored `knots` are checked by `knotProblem(…, degree)` and dropped by
`setSplineDegree`); closing drops both, transforms turn `tangents` by their
linear part, trim/break drop them and keep `degree`, degree 4/5 export as cubics
within 1e-3 mm (`cubicApproximation`). The grips (`apps/web/src/sketch/splineEnds.ts`,
at `start + D0/3` and `end − Dn/3`) are **not solver points**: the host drags
them in a cancelled transaction and applies one `setSplineTangent`. Extending a
spline stays rejected (A3).
ADR-0064 (P4-10, slice 1) added the **rib**: a thin wall from one sketch
**line** to the body beside it (a gusset, a web; the stiffening triangle in a
bracket's corner). Core holds the definition (`curve`, `thickness`, `side`,
`flip`) and lists the type as patternable; the kernel builds a **slab** around
the line — the line extended by the bodies' box diagonal at both ends, swept
that far to one side of it, prisms the rectangle along the plane normal by the
thickness with `namedPrism` — **cuts every body out of the slab** and keeps
**the piece at the line's midpoint** moved `1e-4 · L` into the material side at
mid-thickness (the exact distance of a 1 µm probe box is 0 inside or on), then
`operate` joins it into the bodies it touches. Two errors, worded for the
user: a line inside a body ("The rib's line lies inside the body.") and a
piece that would run past the body instead of closing on it ("The rib doesn't
close against the body: make the line's ends reach it, or flip the rib."). The
slab-minus-bodies rule means nothing is placed by hand: the wall stops where
it meets the body, and the ribs of a bracket are the triangles its diagonals
cut. `d` (which side of the line the wall grows on) is `n × u` signed by the
bodies' **centre of mass**, not the middle of their box as the ADR's first
draft said: an L's legs are on the corner side of its diagonal, which the box's
middle is not. The dialog's Flip carries a **direction arrow** — the new
manipulator kind `kind: 'arrow'` (`spec.ts`, drawn by `DialogOverlay`), whose
head a click turns. **Straight lines only** (chains of lines and arcs are
ADR-0064's Deferred), and the rib's faces are named as the prism's under
`rib:<id>`: `…:side:<sketch line>`, `…:cap:start`, `…:cap:end`.
ADR-0064 (P4-10, slice 2) added the **variable-radius fillet**: each edge set
takes an optional end radius (`radiusEnd<n>`, expr length) and `swap<n>`
(bool), so the round tapers along its tangent chain from `radius<n>` to the end
radius (core: `filletEndKey` / `filletSwapKey`; `filletSets` reports them, a
set with an end radius is **variable**). The evaluator calls the facade's new
`filletVariable` **only** when some set is variable (staging every edge with a
pair, the constant sets as `(r, r)` and a swapped one as `(end, start)`), so a
constant document takes `fillet` and computes exactly as before. `fillet` and
`filletVariable` share `filletBuild`/`addFillets`/`filletWorks`/`explainFillet`
(per-edge radius count 1 or 2); a taper's diagnosis is only the scale factor
(status 4), since which chain is too large depends on the direction the radius
runs in. Names and the two ends' messages are unchanged. The dialog's per-set
**Variable** toggle is not an input: a set is variable exactly when it has an
end radius, so the toggle off drops `radiusEnd`/`swap` again.
ADR-0065 (P4-09, slice 1) added **timeline groups**: a run of neighbouring
features under one name, folded into one chip or open on a band. A group is
stored as its **two ends** (`doc.groups[]`: `id`, `name`, `first`, `last`,
`collapsed` — `docs/file-format.md` §4.6), never as a list of members, so it
stays contiguous: its members are what is between its ends, a feature that
lands between them joins it, an end that moves or is deleted shifts to the next
member inside, an end whose ends swap makes the group run from the earlier to
the later one, a group with no members is dropped (key and all) and a group
that would share a feature with an earlier one is too. **`normalizeGroups`
(`packages/core/src/groups.ts`) is the one place those rules live**, and every
command that reorders or removes features ends with it (`moveFeature`,
`moveFeatures`, `removeFeature`, `restoreVersion`; `removeFeature` also calls
`dropFeatureFromGroups` first, while it still knows the deleted feature's
index). The engine, the naming and the recompute ignore groups. The commands
are `groupFeatures`, `ungroup`, `renameGroup`, `setGroupCollapsed`,
`groupSuppressed` and `groupVisibility`, one undo step each; the app's are
`groupActions.ts`. **Chips count features, not chips**: every drawn chip
carries `data-feature-from`/`data-feature-to`, so the marker skips a folded
group whole, a drop can never land inside one, and dragging a group's chip
moves all of it in one `moveFeatures`. **The marker never rests inside a folded
group**: `openGroupAtMarker` (`timelineGroups.ts`) gives the command that opens
the one the marker landed in, and `AppShell` amends it into the step that moved
the marker, so undo takes the opening with it. The picked chips and the picked
group are a small store (`createTimelineSelectionStore`) the timeline and the
marking menu's list share; Group is in the chip menu and in that list.
ADR-0065 §3 (P4-09, slice 2) added **linked folders**: a folder of `.extrudo`
files on disk, beside the browser's own copy, which stays primary (permission
lapses, other browsers lack the API). **`Platform.folders` is optional** and
only where `window.showDirectoryPicker` exists, so the app behaves as it did in
Firefox and Safari (`platform/folders.ts`: `link()`, `current()`, `unlink()`,
and `permission`/`request`/`list`/`read`/`write` on a link; the handle is in
its own IndexedDB store, `packages/storage/src/handles.ts`, because a
`FileSystemHandle` survives a reload). **The link lives in the project index**
(`ProjectSummary.linked` = `{ file, modified }`, `ProjectStore.link`), never in
the document: it is about this browser, not the design, so nothing in
`docs/file-format.md` changes. **A linked project writes its file after every
successful autosave**, throttled to once every 10 s with the throttle trailing
(the newest state goes) and once more when it closes; the bytes are
`ProjectStore.archiveBytes`, the same builder Home › Export Design uses. The
decisions are pure (`project/linkedSync.ts`: `createLinkSync`), and a save
inside the throttle only *schedules* the write — which is why the context
carries `report(outcome)`: a trailing write the caller didn't await still has to
be able to say that the file changed on disk. **The conflict rule**: before
writing, the file's own `lastModified` is compared with the recorded one, and a
difference means nothing is written and a toast says `<file> changed on disk.`
with "Load from disk" (one undo step through `restoreDocument`, ADR-0036's
path, keeping what you had as a version) and "Overwrite" — a toast can carry
several buttons (`ToastOptions.actions`, with `action` the first of them), both
with `available()`. Errors (permission lost, file removed) are toasts. The home
screen's "Linked folder" section opens a file as a project **linked** to it;
"Save to Linked Folder" (Home › Export tile, Ctrl+K) links an unlinked one, refusing a
name that is already in the folder.

ADR-0066 (P4-06, slice 1) added **drawings into a sketch**: `@extrudo/io`
gained `readSvg` / `readDxf` (`xml.ts` is our own small tokenizer, no
dependency), which give a `DrawingImport` — the same `Drawing` the writers
take, in **millimetres with y up**, plus the unit the file declared and what
was left out (`{ text: 4, image: 1 }`). **Units:** the root's `width` (or
`height`) with its `viewBox` give mm per user unit, without a unit a user unit
is a pixel (96 to the inch), a DXF's `$INSUNITS` gives its own (unitless as
mm), and SVG's y is mirrored on the way out. The SVG reader takes `path` (every
command, `A` through the endpoint-to-centre conversion with the radii grown
when they are too small), `rect` (with `rx`/`ry`), `circle`, `ellipse`, `line`,
`polyline` and `polygon` at any depth, with `transform` composed down the tree;
under a transform that doesn't keep circles a circle becomes an elliptical arc
(`transform.ts` takes an ellipse's image from the singular values of
`L·R(θ)·diag(rx,ry)`), and a `display:none` subtree is skipped. The DXF reader
takes LINE, ARC, CIRCLE, LWPOLYLINE and POLYLINE (bulges as arcs, the closed
flag), ELLIPSE, SPLINE (knot insertion, exactly, for a non-rational spline of
degree ≤ 3; sampled into cubics for a rational one), POINT and INSERT
(position, scale, rotation and row and column counts, eight levels deep); a −z
extrusion mirrors in x and any other extrusion is skipped and counted.
`@extrudo/sketch/import` (entry `"./import"`) has `drawingToSketch(drawing,
sketch, { scale, offset, fixed, ids })`: a line is a line, a whole turn a
circle, a whole ellipse an ellipse entity, and an elliptical arc or Bézier a
`mode: 'control'` spline of four poles (ADR-0063), one cubic per ≤ 45° of an
ellipse, so nothing is flattened. **Fixed by default** (one `fix` per curve
and no coincident constraints: profile detection joins ends by geometry); with
`fixed` off the ends within 1e-6 mm get coincident constraints. Exact
duplicates and zero-length lines are left out, **5,000 curves is refused**
("This drawing has 12,400 curves; Extrudo imports up to 5,000."), and the IDs
come from the caller, so the change is a deterministic recipe (ADR-0003). The
tool is `importDrawing` (no key) in the Sketch tab's Create menu; it picks the
file (`platform.files.pick('.svg,.dxf')`) and shows the panel "Import drawing"
(`importDraft.ts` holds the draft, `pickDrawing.ts` reads the file): the file
name, **Units** (the detected one preselected), **Scale** (an
`<ExpressionInput>`), **Position** (the drawing's origin or centred on the
sketch origin), **Fixed**, and `[data-import-summary]` ("312 curves · skipped 4
texts"); OK commits the change through `ToolHost` as one undo step ("Import
<file name>"), and a reader error or the limit shows in the panel with OK
disabled. A nested region is a hole of its parent **and** a region of its own
(ADR-0020), so a plate with a Ø10 circle reads `profiles=2 holes=1`.
ADR-0066 (P4-06, slice 2) added **attachments for imports and STEP import**:
core's `media-types.ts` holds the ten media types and `mediaTypeOf(fileName)`
(extensions, never `File.type`; `addFont.ts` uses it too), an attachment may
carry 25 MB a file and 100 MB a design, and a new `file` input kind
(`{ kind: 'file', id }`) names an attachment — the document schema checks it
exists and has a media type the feature reads (`FILE_INPUT_MEDIA_TYPES`,
keyed by feature type). **Files reach the worker like fonts**:
`KernelApi.addFile(id, bytes, mediaType)` keeps a `Map` for the session,
`EvalContext.file(id)` / `fileType(id)` read it (`MissingFileError` is a
`KernelError`, so a file the design names and the worker lacks is the feature's
error), and the `Recomputer`'s `#sendResources` sends every attachment an
`import` names before the recompute **or the preview's draft**, once per
kernel (`FileSource.bytes`; the app side is `attachmentBytes` from
`sketch/fonts.ts`, with `putAttachmentBytes` for a file just picked). The
`import` feature (core `import.ts`, kernel `features/import.ts`, STEP branch
only) is `readStep` → the `up` turn (`transform`) → `splitSolids`, faces
`import:<id>:face:<n>` from the file's face order, mesh media types refused
with "Mesh import comes in a later version."; **no facade change**. **P4-12**:
a file that names a colour reports an `ImportReport` (`colors` per body ID,
found through each body's first face name; `ModelState.imports`), and
`followBodyNames` takes it into `BodyMeta.color` **only when it first names the
body**, so the user's colour and a later Up change are never repainted. The UI is
the **Insert tab** (it replaces the `insertSvg` placeholder; `importDrawing`
joins it and is unavailable outside a sketch; since ADR-0079 the three are Home ›
Files' tiles): `importBody` (also the old File menu's "Import
STEP or mesh…") writes the bytes **before** the dialog opens, so the preview
finds them, and OK adds the attachment record and the feature in one undo step
through the dialog framework's `commitWith` hook (a transaction around both).
The dialog grew a read-only `info` field kind and `shown(values, ctx)` (a
mesh's `units` depends on the document). The fixture is B3's two bodies
through our own `writeStep` (`fixtures/imports/b3.step`, `WRITE_FIXTURES=1`).
ADR-0066 (P4-06, slice 3) added **mesh bodies**: a mesh is a `ShapeHandle` at
`MESH_HANDLE_BASE` (2^30) kept in `Kernel.#meshes` as a manifold-3d 3.5.4
`Manifold`, so the engine, the cache, `hold`, scopes and strict leaks are
unchanged and a leaked mesh fails a test like a leaked shape (`release` sends a
mesh to the map and a shape to OCCT). `meshFrom(mesh)` splits surfaces that
touch along an edge or at a vertex (`splitNonManifoldEdges`, its 2026-10-09
amendment) and welds the corners
(`Mesh.merge()`) and refuses a mesh that isn't closed with `checkManifold`'s
counts on a `MeshError`; `mesh`, `exportMesh`, `measure`, `properties`,
`describe`, `count`, `solids` and `transform` have a mesh branch, and **every
other public method that takes a shape throws `MeshBodyError`** naming the
operation for the user ("Shell needs a solid body: this body is a mesh
(imported, or combined with a mesh)."; booleans no longer refuse, see slice 4).
A mesh body is **one face** of all its triangles, flat across a 30°
crease and smooth elsewhere, its creases are its edges with the new `EDGE_MESH`
flag (drawn, never picked: `pick.ts`'s `UNPICKABLE`), and its centre is the
centre of its box (manifold has no centre of mass). The module loads only for
a design that needs it: `KernelApi.enableMeshes()` (the worker's
`manifold-3d/manifold.wasm?url`) called by the `Recomputer` beside
`#sendResources`, and `loadManifold` in Node — a design without a mesh import
downloads 0.54 MB less. `import`'s mesh branch parses with `@extrudo/io`
(`readStl` reads ASCII STL, the new `readObj`, `read3mf`), `units` scales the
coordinates (`auto` = a 3MF's own unit), `up` is Move's turn, each piece is a
body (the largest keeps `ctx.bodyId(0)`) named `mesh:<feature>` and `#2`, `#3`…
for the rest, and the errors name the file: "open.stl isn't a closed solid (3
open edges): repair it in your slicer…". The browser tags a mesh body "Mesh"
(`data-body-mesh`), the Export dialog leaves it out of a STEP file, and
`addFile` carries the file's **name** (a previewed file has no record yet), read
back through `EvalContext.fileName`. Fixtures in `fixtures/imports/`:
`cube.stl`, `open.stl`, `two-parts.3mf` (centimetres) and `ascii-cube.stl`
through our own writers (`WRITE_FIXTURES=1`), plus a hand-written Y-up OBJ.
ADR-0066 (P4-06, slice 4) added **booleans and transforms with mesh bodies**:
`Kernel.boolean` dispatches to manifold-3d when either operand is a mesh, with
the B-rep one meshed through `exportMesh` at `MESH_BOOLEAN_DEFLECTION`
(0.01 mm, 0.1 rad) into a temporary `Manifold` that is deleted again, and **the
result is a mesh body** with no history — so `operate` (extrude, revolve,
sweep, hole, pattern instances, rib joins), Combine and Mirror's join work on
meshes. `features/mesh-bodies.ts` holds the three rules that follow from a
result having one face and no history: a mesh body a **boolean** made is named
`mesh:<feature>` (`#2`, `#3`… over the bodies that feature touched,
`nameMeshBodies` at the end of an evaluator, which leaves a **transform's**
names alone — a move keeps the body's name, a copy keeps ADR-0044's or ADR-0047's
copy rule), a solid that became a mesh says so **once** per
feature (`MESH_WARNING`, "A solid body was combined with a mesh and is a mesh
from here on: fillets and face picks no longer work on it.", through `ctx.warn`,
so the engine's own de-duplication makes it once), and `transformedNames` gives
a move the name the body had (a reference to its face still resolves) and a copy
ADR-0044's copy rule (`move:M1:from:(mesh:Import1)`). `touchingBodies` asks a
pair with a mesh in it `Kernel.minGap` (manifold's `minGap`, `bodiesTouch`,
`MESH_TOUCH` 1e-6 mm) instead of OCCT's distance, so Combine's join order and a
Mirror's copy do too; `Kernel.splitByPlane` cuts a mesh body (Split Body writes
both halves out itself, the larger keeping the body's ID, since fusing them
would give the body back) and `splitSolids` splits a mesh with `decompose()`;
`Kernel.scale` dispatches a mesh to `transform` with the scale matrix about the
centre, and `transform` keeps a reflection's triangles facing out
(`#outward` is the net). A hole on a mesh face, Place on Bed and Rib still
refuse with `meshBodyMessage` naming them. With P4-12's hardening merged
(ADR-0067), `mergeTools`'s heavy-tool rule short-circuits before the mesh-aware
`bodiesTouch` (a heavy B-rep pair never asks for a distance; a mesh pair still
asks manifold's `minGap`), `stats()` reads the facade's heap through
`Kernel.heap()` and still counts a leaked mesh, and a **recycled** worker
(ADR-0067 §H4) gets `enableMeshes()` and every file again through the same
`#resend` a crash takes (`recomputer-recycle.test.ts` covers the file and the
module going to each worker before its recompute). Measured: a 204,800-triangle STL
less a Ø10 mm B-rep cylinder in 193 ms, to 0.001 % of the exact volume and
closed (`BENCH=1 pnpm vitest run packages/kernel/src/mesh-boolean-bench`).
ADR-0066 (P4-06, slice 5) added **canvas images**: feature `canvas` (no body)
with `plane`, `image`, `x`, `y`, `width`, `rotation`, `opacity` and `flip`; the
kernel's evaluator reads the plane with `planeOf` and reports a `CanvasReport`
(`ModelState.canvases`), so no image bytes reach the worker, and the app draws
one textured quad per canvas from `createImageBitmap` (never picked), while the
dialog writes `width` from the picture's pixels at 100 dpi and **Calibrate** sets
it from two clicks on the plane and their real distance.
ADR-0067 §H1 (P4-12) took **`'unsafe-eval'` out of the content policy**:
`packages/core/src/zod.ts` is the only place zod is imported from and calls
`z.config({ jitless: true })` before any schema exists (every schema module
imports `z` from it; `zod.test.ts` proves it with a `Function` that records
every attempt), `DYNAMIC_EXECUTION: 0` sits beside the other emcc settings in
`packages/kernel/occt/libcascade.config.ts` and in planegcs's link flags in
`planegcs.patch`, and `_headers` keeps only `'wasm-unsafe-eval'`.
**Embind then builds its invokers as closures**, which the ADR measures: the
solver's drag and the B1-B5 recomputes came out within noise (ADR-0067 §Results).
`e2e/hosting.spec.ts` asserts the served `script-src` and walks a whole session
(template, sketch, extrude, Ctrl+K, 3MF) under the real headers, failing on any
`securitypolicyviolation` or console error. **§H3** (also on this branch) made
the facade's `measure`/`properties` integrate BRepGProp with an error bound
(`MASS_EPS = 1e-7`) where a B-spline surface makes OCCT's fixed-order integral
wrong, and kept the cheap form where the bound is *worse* (a prism wall, a
surface of revolution: there the volume integral's terms cancel), so
`needsTolerance` asks the shape, not the call site. **§H4** added
`KernelApi.heap()` (the facade's `heapTop()` and the WASM memory size), read
after every recompute: over `HEAP_RECYCLE_BYTES` (1 GiB,
`RecomputerOptions.heapRecycleBytes`) and with no dialog open, the `Recomputer`
ends the kernel worker and boots a new one through `KernelClient.restart()`,
which re-sends the fonts and recomputes cold; the model store keeps showing the
result it has, and the app notes it in the notification history quietly
(`useRecompute`'s `onRecycle`). It only replaces a worker whose heap has been
under the limit since the last one, so a limit below a fresh WASM's own heap
can't loop, and it re-sends the fonts **and the files** of a document that
imports a mesh, and calls `enableMeshes()` again (`Recomputer`'s `#resend`
clears its resource list, P4-06 §0/§3). **§H2** found the ~400-turn thread trap to
be OCCT running out of the 32-bit WASM heap, so the tooth is cut out of the
ring in pieces (`THREAD_CHUNK`), and `mergeTools` merges two **heavy** tools
(over `HEAVY_TOOL_FACES` = 200 faces) whose boxes overlap without asking for
their distance (`isHeavyTool` in `operation.ts`; `bodiesTouch` still asks for a
mesh pair's `minGap`, P4-06 §4). **§H5** warns when a swept profile is drawn
away from the path's start. **P4-12's fillet/chamfer item** (2026-10-05, ADR-0038
and ADR-0043 amendments) is on `p4-12-fillet`: 32 edge sets each, a chamfer
set's `face` that decides `flip` in the kernel, and radius and distance
handles on every set's first edge, a variable set's two ends and a chamfer's
face directions (`features/edgeHandles.ts`, branch `p4-12-set-handles`).

ADR-0068 (P5-01, all three slices) added **the public document API**,
`packages/api` (`@extrudo/api`, GPL-3.0-or-later): `Design.create`/`Design.from`,
`d.parameter`/`setParameter`, `d.configuration`/`applyConfiguration`, one method
per feature type generated from core's registry, `d.add`, `remove`, `suppress`,
`rename`, `move`, `group`, `transaction`, `validate`, `toJSON`/`toFile`, and the
references a call needs without a kernel (`d.origin.*`, `handle.ref()`,
`handle.constructionRef()`, `handle.body()`/`bodies()`, `handle.face`/`edge`/
`vertex`, `d.ref(kind, id)`). Rules a change must keep: **every change is a
core command on the `DocumentState`** (`design.state` is there for the rest) and
inputs are checked with the feature's own schema before anything is dispatched,
so a bad call throws `ApiError` with the input path and nothing changes; **IDs
are deterministic** (a counter per kind, `f1`, `p1`, `s1`, `c1`, `d1`, …, seeded
from a loaded document so a new ID never collides, `options.ids` to inject — the
same calls must give byte-identical JSON, P5-02 runs a script on every
recompute); **names follow the app** (`nextFeatureName`, and a new driving
dimension takes the next `d<n>` like the app's host gives it); the references
are the kernel's persistent names, built as plain strings (`src/names.ts`, the
grammar of `packages/kernel/src/naming/topo-id.ts`), so **a new feature's
methods must not need geometry**. **The feature methods are generated**:
`pnpm api:generate` (`scripts/generate-api.mjs`, run through
`scripts/ts-import.mjs`, which resolves the extensionless imports core's
TypeScript uses) reads core's `documentFeatures()` and writes
`packages/api/src/generated/features.ts` from the input schemas' `.describe()`
texts, and **the reference pages under `docs/api/`** (`docs/api/features/<type>.md`
per type and their index, from `packages/api/src/pages.ts`) — **a new feature
input needs a `.describe()`** or the generator fails, and `generated.test.ts` and
`docs.test.ts` fail with "run pnpm api:generate" until the files are
regenerated. Every page's example call is the line the generator writes into a
generated `featureExamples(d)`, so **`tsc` checks every example** and
`packages/api/src/docs.test.ts` runs them against a real `Design` (a new feature
type needs an entry in `EXAMPLE_INPUTS`, `packages/api/src/example-calls.ts`, and
its example may not leave out a required input); the same test compiles every
```ts block of the three hand-written pages (`docs/api/README.md`, `sketch.md`,
`references.md`) with the package's own strictness. Each input schema also says what it is under `meta({ input })`
(core's `feature-inputs.ts`), which is how a call turns `'10 mm'`, a reference
or `true` into a stored input. **Import zod only through core's `zod.ts`**
(`import { z } from '@extrudo/core'`), like the kernel's golden tables do.
Remove and Move are the document commands, so their features' methods are
`removeBodies` and `moveBodies`; `sketch` has no generated method.

**Sketches (slice 2):** `d.sketch(plane, build, options?)` runs `build` with a
`SketchBuilder` — every entity kind of the schema, one method per constraint
type, and `k.dimension(target, value, { name })` for each kind of dimension —
and the entities, constraints and dimensions come from
**`@extrudo/sketch/build`**, the pure builders the drawing tools use, which
moved there out of `apps/web/src/sketch/tools/build.ts` (the tools import them
from there now; `BuildIds` is an ID factory and the construction flag, which a
`ToolContext` already is). **Nothing is solved** (the solver needs planegcs,
which the API keeps out); profile IDs don't depend on positions, so a later
solve keeps them. Profile references are `s.profiles()`, `s.profileAt([x, y])`
(throws where there is none), `s.profilesInside(...)`, and a sketch handle lists
its `lines()`, `circles()`, `arcs()`, `points()`.

**Face roles (slice 2):** every body-making feature definition in core lists the
roles its faces are named with (`faceRoles: { pattern, description }[]`, patterns
with `<…>` for what varies, in `packages/core/src/face-roles.ts`), filled in from
what the kernel evaluator really names. **A new body-making feature needs its
roles**, or `packages/core/src/face-roles.test.ts` and the kernel's
`features/face-roles.test.ts` (which builds one of every feature and checks every
face name it makes) say so. The roles type `handle.face(role)`/`faceName(role)`
through the generated `FaceRoleName<T>` and appear in the methods' doc comments.

**Docs site (slice 3):** `apps/site` builds `docs/api/**/*.md` into static pages
under `/docs/api/` at build time (`apps/site/src/docs.ts` reads the front matter,
rewrites relative links and renders with `marked`, a **build-only** devDependency;
`src/docs-plugin.ts` emits the pages, the brand's stylesheet — `src/tokens.css`,
which `site.css` imports too — and the two font faces with hashed names). **A docs
page carries no script at all** (plain `<pre>`, a sidebar, the brand's colours),
which is what the site's stricter `_headers` asks for; `tabindex="0"` on the
sidebar, the tables and the code blocks keeps the scrollable regions reachable.
The landing page's footer links to `/docs/api/`. Rules a change must keep: **a
docs page needs no internal package** (ADR-0057), so anything the sidebar needs
comes from the Markdown's front matter (`title`, `section`, `category`, `order`),
and **the pages are the repository's Markdown**, so a link that names a `.md`
file is a bug (`docs.test.ts` fails on one). Since ADR-0080 the build serves `/docs/` from `docs/guide/` through collections (`COLLECTIONS` in `docs.ts`, the deepest folder wins; the API's addresses unchanged). The examples page `docs/guide/examples.md` is generated from `fixtures/examples/examples.json` by `pnpm docs:generate`, and its pictures under `docs/guide/images/examples/` are recorded by `e2e/record-assets.spec.ts` (`RECORD_ASSETS=1`, `-g "picture of the"`).

**Examples (slice 2):** `docs/api/examples/*.ts` are tests, run by
`packages/api/src/examples.test.ts` — the Wall bracket, benchmark B1 (equal to
the fixture the app exported, up to its IDs, and recomputed headless) and a
parametric box with a customizer and two configurations. The kernel is a
devDependency of the API package for that one test and nothing else.

ADR-0070 (P5-02, slice 1) added **the script runner**, `packages/script`
(`@extrudo/script`; api, core, QuickJS, `sucrase`):
`loadScriptRunner()` (`wasmUrl` for the browser's own asset — Emscripten's
`locateFile` — or the package's own release-sync file in Node) and
`runner.run({ code, language, design, featureId, params?, limits? })`. User code
runs in **QuickJS in WASM** (ADR-0067: `'wasm-unsafe-eval'` and nothing else; no
`eval` or `new Function` on the host), with TypeScript stripped by sucrase, which
keeps every line — so a runtime error's line is the line in the editor. The
sandbox is ADR-0070 §2's list and nothing else: `design` (a `Design` restricted
to adds: `remove`, `move`, `rename`, `suppress`, `group`, the parameter calls,
`transaction` and `toFile` are refused by name with "A script can only add
features: …"; `removeBodies` and `moveBodies` are adds and stay), `params`
frozen, `console.log` (200 lines, 100,000 characters), `Math.random` seeded from
the feature ID, a `Date` at 0. The limits are 2 s (an interrupt handler with a
deadline), 64 MB (`setMemoryLimit`), 1,000 features (counted in the one `add`
every call comes down to) and 100,000 characters of source; each has its own
message. **Rules a change must keep:** a call's arguments cross as JSON in both
directions, and a **handle** — a `FeatureHandle`, a `SketchHandle`, a
`SketchBuilder`, an entity handle or a composite one (a rectangle, a polyline, a
slot, a polygon) — crosses as a *proxy* built by reflecting the host object
(`src/bridge.ts`) and marked `@@extrudo`, so an argument comes back as the handle
it stands for (`k.dimension(plate.bottom, '40 mm')`); `handles.test.ts` fails
when the API publishes a handle class the bridge doesn't know. **Every QuickJS
handle must be disposed** (as every OCCT shape must be): a run keeps them in a
`Scope` and frees them, then the context, then the runtime, and QuickJS asserts
at `JS_FreeRuntime` — a leaked handle aborts the process instead of failing a
test, which is what `runner.test.ts`'s last test (100 runs) is. A host function
in QuickJS is **not** a constructor, so the frozen `Date` is a small constant of
`sandbox.ts` evaluated inside the sandbox. quickjs-emscripten 0.31 types a host
function as `(this, ...args)` but passes the arguments alone; every argument goes
through `Bridge.newFunction`, with a cast and a comment saying why. The runner
depends on `quickjs-emscripten-core` and `@jitl/quickjs-wasmfile-release-sync`
only (slice 2).
ADR-0070 (P5-02, slice 2) added **the `script` feature**: core's `script.ts`
(inputs `code` — a new input kind `{ kind: 'code', value }`, `codeOf(max)` — and
`language`; not patternable, no `faceRoles`) and the engine's one hook,
**`KernelFeatureDefinition.expand(ctx)`**: the engine runs it instead of
`evaluate` and splices what it returns into its walk right after the feature,
each generated feature **under its own cache key**, at a fractional timeline
position past its script; the run itself is cached (32, no shapes) under code,
ID, name, the document before it and the parameter values. Rules a change must
keep: **the kernel never imports the runner** — it defines `ScriptHost`
(`script-host.ts`), `KernelServiceOptions.scripts` (a loader) and
`KernelApi.enableScripts()`, and whoever starts a kernel injects one: the app's
own worker entry (`apps/web/src/project/kernelWorker.ts` → `serveKernel` from
`@extrudo/kernel/worker`, spawned by `spawnProjectKernel`; the kernel's own
`worker.ts` has no runner and is the debug page's), and the CLI; **the
`Recomputer` calls `enableScripts()` for a document or draft with a script**,
once per kernel and again after `#resend`. **Generated IDs are
`<script>.f<n>` from a fresh, unseeded API counter** (`@extrudo/script`'s
`host.ts`; sketch entities etc. inside are the plain counter), names "Script1 ›
Box1" per type within the script; core's **`scriptOfGenerated`** (the part before
the last `.`, only for a token that isn't a feature ID) makes a stored reference
into a script's geometry a dependency on the script (`referencedFeatures`, so
moves are refused, and `removeFeature` refuses a used script, faces and edges
included). **The result lists the script, never its generated features**; their
statuses are in `FeatureStatus.script` (`ScriptRunStatus`: `generated`, `log`,
`line`, `column`), the script's message each failing one's own prefixed
"Script1 › Fillet1: …" (no Fix References for them); `reports` keep the generated
features' own under their IDs. A failed run makes nothing; a run without a
runner (`NO_SCRIPT_HOST`) is not cached. **The app's workers are `es` bundles**
(`worker: { format: 'es' }`), so a worker's dynamic imports (the runner,
opentype.js, manifold's glue) stay lazy chunks. Tests with both the runner and
the real kernel live in **`packages/cli`** (`scripts.test.ts`, `script-cli.test.ts`;
the only package allowed both): the plate-with-holes equivalence, a later fillet
by name, call counters, errors by line, cancel, the examples
`docs/api/examples/script-*.ts` and seeded random edits; the fixture is
`fixtures/scripts/plate-holes.extrudo` (`WRITE_FIXTURES=1`). The kernel's fuzzer
can't load the runner, so it has no script fixture.

**Slice 3 (the app):** `features/script.tsx` is the small dialog spec; its
`extra` dynamically imports `scriptEditor.tsx` and renders the loaded component
directly (never `React.lazy`). CodeMirror and the API completion support stay
lazy. The framework's `wide` makes it 560 px, `initialValues` supplies a working
box, and `previewDelay` debounces 500 ms. Source text is `values.choices.code`,
mapped to the core `code` input through `scriptInputs`/`scriptSettings`; **OK
waits for a script's current preview**, so a half-typed program cannot commit.
The editor reads the preview's `FeatureStatus.script` for diagnostics, console
output and Made N features; the chip's tooltip reads its generated count. The
completion names come from `@extrudo/script/methods`' allowed list (no refused
mutations or nested scripts), descriptions from the API generator's
`FEATURE_METHOD_DESCRIPTIONS`, and parameter values from `evaluateParameters`.
The editor owns key events and text undo. **Esc closes completion first; another
Esc enables CodeMirror's Tab-focus mode**, so Tab leaves; focus or typing restores
indentation. Theme colours mix the brand tokens with ink for AA contrast in
both themes. `docs/api/scripts.md` is a hand-written guide whose TypeScript
blocks the API's docs test compiles. Performance measures:
`extrudo-preview` (feature type in `detail`) in the page and
`extrudo-script-host-load` in the worker.
**Script-generated imports** take the same async `prepare` path as stored ones
(ADR-0071), reporting the Script ID as progress. App and CLI send model attachments
for a design or draft with a script, since its generated imports aren't stored;
the relevant compiler/mesh loader is enabled and resent after worker replacement.
The script-run cache includes attachment metadata. `script-cli.test.ts` covers a
generated `.scad` import, cache reuse and a parameter override; the recycle test
checks the file and both loaders precede each worker's recompute.

**The headless CLI (ADR-0069):** `packages/cli` (`@extrudo/cli`, GPL,
`"bin": { "extrudo": "./bin/extrudo.mjs" }`) is the library plus the command.
`src/headless.ts` is `openDesign(bytes | path)` (the archive with its
attachments, thumbnail and versions), `setParameters` /
`applyConfiguration` (**re-solve**), `compute()` (every feature's status and
every body's name, volume, box and face count), `export({ format, bodies,
resolution })`, `save(path)`, `dispose()` (frees the kernel, reports what it
held). `src/cli.ts` is the four commands and their exit codes; `bin/extrudo.mjs`
registers the same resolve hook `scripts/ts-import.mjs` does (Node strips the
types) and runs it, so the binary needs no build step. Rules a change must
keep: **the re-solve is `@extrudo/sketch`'s `settleSketches`** (the app's rule
moved out of `apps/web/src/sketch/tools/host.ts`, with `dimensionValues` and
`collapses`; the host calls it and turns `SketchSettleError` into a
`CommandError`) — its `scope` is `'changed'` in the app (only a sketch whose own
driving dimension values moved is solved, and a movement is stored, so a
parameter write costs a solve per sketch it moves: every step of a customizer
slider drag goes through it) and `'all'` in the CLI (`setParameters` and
`applyConfiguration`), where every sketch is solved so one something else moved
is repaired rather than exported stale — a sketch whose own values changed is
*refused* when it can't take the change in either scope.
`--param` names a user parameter or a driving dimension's own parameter (a
feature input's own parameter is refused with a message); **the export is the
app's** (`@extrudo/kernel`'s `model-export.ts`, which the app's
`modelExport.ts` now re-exports, Blob and slicer hand-off aside), so the
presets, file names, 3MF metadata and colours are one code path. Kernel
resources go the way `Recomputer` sends them: bundled fonts from
`@extrudo/fonts` on disk, the design's own attachments as `addFile`, and
`enableMeshes()` when a mesh file is among them. **Node runs the workspace's
TypeScript as it is**, so a constructor parameter property is out (the error
classes and `SketchChange` use fields) and the packages the CLI loads stay free
of it. The exit codes are 0/1 usage/2 the design has errors/3 a file
(`HeadlessError`, `ParameterError`, `FileError`). Tests: `headless.test.ts`
(every benchmark fixture, B4 with `clearance`, B2's offset sketch, a
configuration, a user font, a STEP and a mesh import, the errors) and
`cli.test.ts` (spawns the binary; also prints the export times). Docs:
`docs/cli.md`.

**OpenSCAD import (ADR-0071, P5-04; slice 1: kernel, Node, CLI):** a `.scad`
file is an attachment (`application/x-openscad`, `SCAD_MEDIA_TYPE`,
`isScadMediaType`; `isMeshMediaType` is true for it too, since it becomes a mesh
body) read by the **existing `import` feature**, whose `.scad` branch compiles it
and then takes ADR-0066's mesh path unchanged. `packages/openscad`
(`@extrudo/openscad`, nothing internal) holds OpenSCAD's own WebAssembly
**snapshot**, pinned by date and sha256 in `openscad.mjs` (a `wasmRelease` whose
"build" downloads, checks and patches; CI's `openscad` job mirrors it as
`openscad-<hash>`, `pnpm wasm` fetches it, `ensure` builds when the mirror is
missing; `dist/` is not in git). Rules a change must keep: **OpenSCAD never runs
in the kernel's thread** — `createNodeCompiler` (`worker_threads`) and
`createBrowserCompiler` (a nested module worker) run it in a worker of its own,
**one fresh instance per compile** from the compiled module (no state or cache
carried from file to file), one compile at a time, stopped by `terminate()` after
`DEFAULT_TIMEOUT_MS` (60 s) or at `DEFAULT_HEAP_MAX_BYTES` (1 GiB; the glue's
`getHeapMax` is patched to read `Module.heapMax`); **the kernel imports only
types** from it (the worker entry's `openscad` option `import()`s the browser
compiler on the first `enableOpenscad()`, Node callers pass `createNodeCompiler`
through `KernelServiceOptions.openscad`), and `enableOpenscad()` enables meshes
too. **The compile is asynchronous, evaluators are not**, so a definition may
have **`prepare(ctx)`**, which the engine awaits right before `evaluate` (only on
a cache miss, cancellation checked after it) and `evaluate` reads as
`ctx.prepared`; a `KernelError` it throws is the feature's error, and it makes no
shapes. The overrides are **numbered pairs** `scadName`/`scadValue` …
`scadName32`/`scadValue32` (`scadOverrides`, `SCAD_MAX_OVERRIDES`): the name an
`enum` input with no listed values (the API generator types it `string`), the
value an `expr` of **any** unit (not `exprOf`: a length reaches OpenSCAD in mm,
an angle in degrees); half a pair or a name twice is an error, a name the source
never assigns a warning. Compiles are cached by the engine's key and, per
compiler, by file digest and definitions (`compileOnce`, 16 kept). OpenSCAD's
log is worded in `packages/openscad/src/messages.ts` (`explainRun`: "gear.scad,
line 4: syntax error.", a missing `include`/`use`/`import()` is an **error**
naming the file, 2D/empty results explained, at most `MAX_SCAD_WARNINGS` echoes
and warnings). Fixtures: `fixtures/imports/*.scad`; tests
`packages/openscad/src/compiler.test.ts`, `kernel/src/features/import-scad.test.ts`
(the kernel's program has no Node types, so it loads `@extrudo/openscad/node`
through a name the checker doesn't follow), the CLI's `headless.test.ts` and
`cli.test.ts`. **Slice 2** is the app: Insert › Import (Home › Import since ADR-0079)
takes `.scad`, and the Import dialog lists the
file's customizer variables as rows (`features/ScadOverrides.tsx`, the spec's
`extra`; the pure part `features/scadRows.ts`) from **`KernelApi.scadParameters
(fileId)`** (`ScadCompiler.parameters`: the list without compiling the model),
asked once per attachment (`scadParameterStore`) through the `Recomputer`, which
sends a just-picked file first. A row's text is `exprs['scad:<name>']`, the
order `labels.scad` (the file's, then stored overrides the list lacks, which
keep a row with a warning); `toInputs` **packs** the non-empty rows into the
pairs (emptying a row removes its pair, no holes) and stores each value with the
unit its expression evaluates to (unitless, then length, then angle: `24` is
unitless whatever the document's units). **`scadValue<n>`'s `unit` is required**
(the schema refuses one without; file format §6.28), and the API's `plainInput`
gives a `ParameterHandle` its own unit for an input whose meta says `anyUnit`.
The `Recomputer` calls `enableOpenscad()` once per kernel for a document or
draft that names a `.scad` attachment (it brings manifold with it), reset by
`#resend`. **`openscad-*.wasm` is cached at run time**: `sw.js` answers it from
the cache `extrudo-openscad`, else fetches and keeps it; activation keeps only
the build's own (`RUNTIME`, filled by `precache-plugin.ts`) and leaves that
cache alone. A failed fetch in `browser-worker.ts` is replied `offline: true`
and worded "OpenSCAD isn't downloaded yet: connect to the internet once to
compile gear.scad." (the module isn't kept, so the next compile tries again).

ADR-0073 (P5-05, slice 1) added **the macro emitter**: `emitScript(doc,
options?)` in `@extrudo/api` (`src/emit.ts` plus `src/emit/{print,refs,sketch,
context}.ts`) writes a design back as the TypeScript that makes it again, so a
hand-made design becomes a Script or a reusable program. **The document is the
record**: the emitter walks the timeline (or a run `[from, to]`,
`options.features`, parameters left out of a run) and inverts the API. Rules a
change must keep: inputs become the method's plain values (an `expr` string, an
enum's value, a bool, `labels`, `code`, a file's attachment ID, one ref or an
array by the schema's `meta({ input })`); references become the handle
expression where one exists (`sketch1.profileAt(interior)`,
`box1.face('cap:end')`, `box1.edge([…])`, `plane1.constructionRef()`; a body is
emitted as `design.ref('body', …)` because the kernel keys a body
`<feature>:0`), and **a name that embeds a recorded feature's ID** — a Script's
generated `<script>.f1`, a face's `side:<curve>` source — is a **template
literal through the handle's own `.id`**, rewritten boundary-aware so the `f1`
in `f1.f1` only takes the script's part. A sketch is emitted as
`design.sketch(plane, k => { … })` with its **solved** coordinates, every
constraint and dimension as builder calls (a named dimension keeps its
`paramName`, so expressions reading it resolve), and text with
`{ upright: false, height: false }` (the stored pair is emitted itself;
`SketchBuilder.text` gained the option, and `SketchHandle` gained
`ellipses()`/`splines()`/`texts()`). **Projections are emitted as the curves
they became** with a comment (a script can't project), so a round trip does not
keep `projections` or per-entity construction flags (the builder has only the
sketch-wide `construction` option); configurations, attachments, visibility and
a script's generated features are Deferred. The output is printed by a small
Biome-shaped writer (`src/emit/print.ts`), and the test runs `biome format` on
it expecting no change. The proof is the round trip: `packages/api/src/
emit.test.ts` compares the document up to IDs and names (dropping fingerprints,
labels, feature-input `paramName` and projections, and canonicalising profile
regions and sorted edge faces), and `packages/cli/src/emit-recompute.test.ts`
recomputes every benchmark and the script fixture body by body. `extrudo script
<file.extrudo> [--features a..b]` prints the code; `docs/api/emit.md` is the
page. **A new feature or input kind reaches the emitter through
`meta({ input })` and the schema; a new reference kind needs a case in
`emit/refs.ts`.**
**Slice 2 (the app, `apps/web/src/macro/`):** recording is session state
(`createMacroStore`: `recording: { from, base }` — `from` is the timeline
marker's index at Record, `base` its length, because new features land at the
marker; the run is `features[from .. from + length − base)`, and an undo below
`base` ends it); the status bar's `[data-macro-recording]` counts; the tools
`recordMacro`/`stopMacro` (Solid › Program's tiles since ADR-0079; `CommandContext.macro` and
`ToolbarProps.hidden` show one at a time) and `exportScript` (Home › Export, Ctrl+K)
are in `AppShell.run`/`buildCommands`. **Stop** emits through a lazy `@extrudo/api`
import (the web app depends on it only for this) and opens `MacroDialog` (region
"Macro", code in `CodeView`, `scriptEditor.tsx`'s read-only editor). **Replace is
one transaction** (insert the Script at the first recorded feature, then
`removeFeature` last to first, `cancelTransaction` and the reason on any
`CommandError`); **Keep both** appends the Script suppressed. A feature using a
recorded one is always inside the run, so only an expression outside it (a user
parameter reading a recorded sketch's `d1`) refuses a Replace in the UI. *Export Design
as Script…* (amendment ADR-0088, 2026-10-18) opens `export/ExportScriptDialog.tsx`,
TypeScript by default (`designCode(doc)` for the whole design); the rules are in ADR-0088.

ADR-0074 (P6-07) added **auto-project** (a body edge a sketch tool snaps to is
projected into the sketch as reference): while a drawing, constraint or
dimension tool runs, the view offers the shown bodies' edges and vertices under
the pointer behind the sketch's own geometry
(`apps/web/src/sketch/autoProject.ts`'s `modelSnapAt` through `pickStack` with an edges-and-vertices filter, a vertex before an
edge, visible before hidden; `autoProjectSnap` gates it on the preference
`viewport.autoProject`, **on** by default, whose sketch-palette checkbox and
`toggleAutoProject` command turn it off). The snap reaches the tool as
`PlanePointer.model` / `ToolContext.model()` and `infer` as
`InferenceOptions.model` (a vertex is a point target, an edge an `onCurve`
one, both carrying `Snap.model`); `Snap.point` is the vertex projected onto
the plane or the nearest point of the edge's **display polyline**, so the
exact curve arrives from the kernel on the next recompute. A point the tool
placed on it carries a `ModelAttachment` (`SketchEdit.models`, written by
`@extrudo/sketch/build`'s `place`); `ToolHost.commit` finds or adds the
projection record (`addProjection`, amended into the step that added the
geometry, an already-projected ref reused) and remembers a **pending
constraint** (session state, `PendingModelConstraint`, pinned to that step's
id) that `syncProjections` turns into a `coincident`/`pointOnCurve` on the
projected entity the kernel reported (querying `SketchSolver.check`, dropping
a refused one) and joins to that step through `DocumentState.amendInto`
(`UndoHistory.stepId`/`amendInto`/`hasStep`) — so undoing the drawing takes
its constraint, projection and follow-on solve with it, and a pending whose
step, projection (missing or `lost`) or feature is gone is dropped.
**Slice 2 (ADR-0074's amendment, 2026-10-06)**: the constraint and
dimension tools pick a body edge or vertex directly through
`ToolContext.pickModel` (behind the sketch's own geometry; a `ModelSnap`'s
optional `line` is the edge's display polyline ends, used as a stand-in),
carrying a `ModelAttachment.placeholder` for the constraint's or dimension's
side; the whole constraint or dimension is set aside in a
`PendingModelEdit` and, in `syncProjections`, has its placeholder replaced by
the projected entity, is test-solved (or measured and labelled) and joins the
same step. **The review's fixes (ADR-0074's 2026-10-07 amendment)**: a
`ModelSnap` carries `straight` and `pickModel` refuses a **curved** body edge
with "Pick a straight edge, or project the edge first (P)." (curved edges stay
snappable for *placing points* through `infer`; `tangent`/`smooth` to a model
edge is Deferred), one ref gets one projection per commit, a fresh snap
**revives** a curve the user deleted (`reviveProjectionCurve`), and
`resolvePending*` run on every `syncProjections` and turn any throw into the
host's error. Dimension's `#pickAt` never takes a model pick for the
click that would place a sketch line's label (so an existing line's length
still places); a model edge first pick still takes a second model edge, and a
sketch point takes a model vertex or edge.
`viewport.autoProjectFace` (off) also projects a flat face's
outline in `createSketchOn` when a sketch starts on it. No file-format or
kernel change. `data-sketch-projected` now also lists a point-only projected
vertex (`curves=0`).

ADR-0075 (P6-01, slice 1) added **the Electron desktop app** (`apps/desktop`,
GPL): electron-vite builds main, preload and renderer, the **renderer being the
web app's own source** with a different entry (`apps/web/src/entry/desktop.tsx`'s
`bootDesktop`, exported through `@extrudo/web`; `main.tsx` is the web entry) so
there is no forked UI. The renderer keeps the web's posture (`contextIsolation`,
`sandbox`, no `nodeIntegration`), the web's CSP + COOP/COEP + `nosniff` on
**every `app://` Response** (`HEADERS` in `main/headers.ts`, kept equal to
`apps/web/public/_headers` by a test; the `webRequest` hook stays as belt and
braces), no top-level navigation off `app://` (or the dev origin), no new
windows and no webview (`main/navigation.ts`), and `app://` (a privileged
standard scheme) serves the packaged `dist` (`.wasm` as `application/wasm`)
because `file://` breaks module workers and WASM fetches.
**Every privileged call goes through `shared/ipc.ts`'s channels**: that one file
lists the channels and the `ProjectStore` method whitelist, `preload/` exposes
them with `contextBridge`, and main's `ipc.ts` answers them (no `remote`); a
store or folder error crosses as `{ error: { name, message, … } }` and the
renderer rebuilds the class (`shared/errors.ts`, `renderer/errors.ts`). The
Node-fs store is `@extrudo/storage/node`'s `createNodeProjectStore(dir)`
(`index.json` written atomically by temp + rename + fsync, a `FileStore` over
`<dir>/projects/<id>/…`, a per-process lock) with `dir = userData/projects`; the
renderer reaches it through a method-by-method IPC proxy (`renderer/proxy.ts`).
`desktopPlatform()` adds preferences (a JSON file under `userData`, read once,
written debounced), storage (persistent), files (native open/save dialogs),
rescue (a file written synchronously through `sendSync` on `pagehide`), linked
folders over the real file system, and no `openInSlicer` yet (P6-02). The service
worker is never registered on desktop. Run it with `pnpm --filter @extrudo/desktop
dev` (electron-vite dev) or `build` (output under `apps/desktop/out`); auto-update
and packaging are later slices. **Slice 2** builds the native menu from the
command registry (`apps/web/src/shell/menuModel.ts`'s pure `menuModel`/`toAccelerator`,
a projection of `buildCommands`, sent over `menu:set` and validated in main by
`shared/menuModel.ts`; main's `menuTemplate.ts` accepts only the Window roles
`minimize`/`zoom`/`front` and builds `Menu.buildFromTemplate` with
`registerAccelerator: false` on every model item so the web's own keys still
run, while Open…/Save As…/Quit register theirs; a clicked id returns over
`menu:run`), opens a `.extrudo` from the OS association, `argv` or the Open
Recent list (`file:open-path`, delivered after the renderer sends `app:ready`),
and keeps `userData/recent.json` — P6-02 adds `slicer:list`/`slicer:open` (`main/slicerService.ts` validates the arguments; `will-quit` empties the temp directory); main's `recent.ts` fills `recent.json` and
main builds the Open Recent submenu from its own `list()`, never the
renderer's. A project opened from a path (Open…, the association, Open Recent)
or Save-As'd is linked as an **external file** (`LinkedFile.external`, the
index only) and written back through paths main issued (kept across restarts in
`userData/external-paths.json`, seeded from `recent.json`; ADR-0075's 2026-10-12 amendment)
(`file:write-path`/`file:stat-path`/`file:read-path`, `apps/desktop/src/main/externalFiles.ts`);
`apps/desktop/electron-builder.yml`
already carries the `.extrudo` association as data for the packaging slice. Unit
tests (the Node store, the bridge, the proxy, the platform, the `app://` MIME map,
the `_headers` parity, the navigation rules, preferences, folders, rescue, the
menu model, the recent store, the open queue, the menu template) run in Node with a
fake bridge — CI downloads no Electron binary (`pnpm-workspace.yaml`'s
`allowBuilds` keeps `electron: false`). On a headless machine the smoke script
needs `xvfb-run -a`.
**Slice 3 (packaging, unsigned)** adds `electron-builder` (`electron-builder.yml`:
AppImage + deb, NSIS + a **portable exe** (`…-win-<arch>-portable.exe`, 2026-10-18 amendment: electron-builder's `portable` target sets `PORTABLE_EXECUTABLE_DIR`, which main reads to put `userData`/`sessionData` in `Extrudo-data` beside the exe and to pass `portable: true` to `createUpdates`; `EXTRUDO_USER_DATA` still wins), dmg + zip, `extrudo-<version>-<os>-<arch>.<ext>`, asar with
nothing unpacked) and `.github/workflows/desktop.yml` (a `v*` tag or a manual
run, never per push: three OS runners; a tag attaches the installers to a
**draft** release; the Linux job smoke-tests the AppImage with `smoke.mjs --app`,
`EXTRUDO_USER_DATA` being main's throwaway data directory; on a release tag (or a manual run with `windows_smoke`), the Windows packaging job installs the NSIS installer silently and runs `smoke.mjs --app` against the installed exe, then against the portable exe on `SMOKE_PORT=9334` (2026-10-18)). Rules a change must
keep: the desktop's workspace packages are `devDependencies` and **`electron`
stays explicitly external** in main and preload, **no two files may differ only by
case** (macOS and Windows builds resolve `./Grid` to `grid.ts`), checked by scripts/check-boundaries.mjs since v0.4.1 (ADR-0078's `modelProgress.ts` beside `ModelProgress.tsx` broke the v0.4.0 desktop build; the rules are `viewport/progressRules.ts`), and signing is
**deferred** (owner, 2026-10-07: no certificates until the app has users;
macOS through Homebrew), so the installers stay unsigned and macOS only
notifies of updates (`docs/desktop.md`).
**Slice 4 (auto-update)** adds `electron-updater` (a devDependency, bundled into
`out/main`) against the **published** GitHub releases (a draft is invisible, so
publishing ships the update; no prereleases). `main/updates.ts`'s
`createUpdates` is pure over an injected `UpdaterLike`: started only when
`app.isPackaged` and `EXTRUDO_DISABLE_UPDATES` is unset (the smoke sets it), a
check 10 s after start, every 6 h and on focus after an hour; **an AppImage
(`process.env.APPIMAGE`) and NSIS download and install on quit**, **a deb,
the portable Windows exe and macOS only `notify`** (version + the release page main builds from the tag;
never `downloadUpdate`/`quitAndInstall`). Status goes over `update:status`;
`update:check`, `update:apply` (refused unless `ready`) and `update:release`
(main opens **its own** URL) take no argument. Check for Updates… (the Menu strip's Check now since ADR-0090) is
main's (`menuTemplate.ts`, disabled where the updater isn't running) and a
manual check within a minute answers "Extrudo is up to date.". On the renderer
side **`Platform.updates?: PlatformUpdates`** (`store` with `waiting`/`version`,
`apply()`, `action`) is the web's update-toast seam: `webPlatform()` sets
`appUpdates`, `useUpdateNotice(push, platform)` reads it, and the desktop's
`renderer/updates.ts` follows `update:status` (Restart, the notify toast once
per version, a quiet error). The `desktop` workflow uploads `latest*.yml`.
The atomic writer (`writeAtomic`) flushes the temp file through the **writable** handle it wrote with; an fsync through a read-only handle fails with EPERM on Windows (2026-10-17).
**The Homebrew cask (P6-01's amendment, 2026-10-07)**: on a tag the `desktop`
workflow's `homebrew` job renders `apps/desktop/homebrew/extrudo.rb.template`
from the arm64 mac zip with `render.mjs` and pushes `Casks/extrudo.rb` to the
`zoltanf/homebrew-extrudo` tap (`HOMEBREW_TAP_TOKEN`, skipped cleanly without
it), which is macOS's install and update path since the updater only notifies
there. **The cask's `postflight_steps` removes `com.apple.quarantine` from
`{{appdir}}/Extrudo.app`** after every install and upgrade (2026-10-16
amendment); `{{appdir}}` is Homebrew's token, so `render.mjs` must keep filling
only the upper-case placeholders, and stanzas stay in `brew style` order
(`caveats` last).

**ADR-0075's amendment (2026-10-09)**: **Windows and Linux have no menu bar** (`hasApplicationMenu`: `buildMenuTemplate` is `[]` off macOS, main sets `Menu.setApplicationMenu(null)`, removes the window's menu and ignores `menu:set`; macOS keeps the native menu). What only the menu had is in the app, desktop only: Open File… (`Ctrl+O`) and Save As… (`Ctrl+Shift+S`) are Home › Design tiles (`openFile` is a `FILE_COMMANDS` entry hidden where `FileActions.openFile` is absent), Open Recent is the Design group's ▾ (`Toolbar`'s `recentFiles`; `recent:names`/`recent:open` take an index and a name, main's `recentPathAt` looks the path up itself), Check for Updates… is in Help (`Platform.updates.check`) and Quit (`Ctrl+Q`) a command that saves first; `Platform.desktop` (`DesktopApp`, `nativeMenu` true on macOS) is the seam, and **on macOS the renderer binds no key for them and `NATIVE_MENU_OWN` keeps their commands out of the menu projection**. `main/updateErrors.ts` classifies a failed update check (`no-release`, `offline`, `other`): an automatic check is silent for the first two, a manual one answers in a sentence, anything else is the error's first line (140 characters), never headers.

ADR-0076 (WebGL fallback) made the app survive a browser without hardware WebGL:
`viewport/webglSupport.ts` (`detectWebgl(create?)` → `hardware`/`software`/`none`,
memoised by `webglSupport(refresh?)`, probe contexts lost again); the Canvas never
sets `failIfMajorPerformanceCaveat`, renders `software` at `dpr` 1 without
antialiasing (stencil stays) and retries once without antialiasing (`createRenderer`);
`none` draws `viewport/NoWebgl.tsx` (region "3D view unavailable", `data-webgl="none"`; in Chromium it leads with `[data-swiftshader-command]`, built by the pure `viewport/swiftshader.ts` for a separate software-GL profile);
`design-system/ErrorBoundary.tsx` is used by `viewport/ViewportBoundary.tsx` (AppShell
and the kernel debug page) and `RootBoundary.tsx` (both entries; "Something went
wrong", saves then Reload; `#/debug/crash` throws for the e2e); a lost context shows
`[data-webgl="lost"]` with "Reload view". The software notice is the status bar's
`[data-renderer="software"]` plus a one-time toast (`platform/renderNotice.ts`,
preference `render.softwareNotice = 'dismissed'`, `useSoftwareNotice`). Desktop:
`main/rendering.ts` (`enable-unsafe-swiftshader`; `--software-rendering` /
`EXTRUDO_SOFTWARE_RENDERING=1` disable the GPU). No file-format change.

ADR-0077 (P6-03, slice 1) added **the plugin API's core, sandbox, kernel and
CLI**. A plugin is a `.extrudo-plugin` zip of `plugin.json` (core's strict
`PluginManifestSchema` in `packages/core/src/plugin.ts`: `id`, `name`, semver
`version`, `description`, `author`, SPDX `license`, `main` = `main.ts`|`main.js`,
`commands[]` and `features[]` whose `inputs[]` have the kinds `expr` (`unit`
length/angle/none), `bool`, `enum` (`options`), `ref` (`accepts`, `multiple`);
`parsePluginManifest` throws `PluginManifestError` "plugin.json › features[0] ›
inputs[2] › kind: …"), the module and an optional `README.md`/`LICENSE`, read
**only** by `@extrudo/storage`'s `readPluginFile` (`@extrudo/storage/plugin`, the
one storage entry the kernel may import: 1 MB packed, 4 MB unpacked, no path
outside the root, 200,000 characters of module; `writePluginFile` packs with a
fixed mtime). A design that uses one carries the file as an attachment of media
type `application/x-extrudo-plugin` (`PLUGIN_MEDIA_TYPE`, not a model type; its
record's `name` is "<plugin name> <version>"). The **`plugin` feature**
(`plugin-feature.ts`, file format §6.32) has `plugin` (file), `handler` (enum, the
manifest's feature `type`) and the plugin's inputs as **`in:<name>`** stored inputs
of those four kinds; any other key is reported `unrecognized_keys`.
`FeatureDefinition.openInputs` is how the API generator and `storedInputs` take
them as one object, `d.plugin({ plugin, handler, inputs: { width: '60 mm' } })` —
a string is an expression with its unit read off it, **a number a plain number**,
a choice `{ kind: 'enum', value }`. `makesFeatures(type)` (Script or plugin) is
the predicate for "needs the runner, references into it depend on it". The
sandbox's **`ScriptRunner.runPlugin`** evaluates the module afresh with sucrase's
`imports` transform into a global `exports` (no ES module evaluation, no global
`design`/`params`), calls `exports.features[type](design, inputs, ctx)` or
`exports.commands[id](design, ctx)` with `inputs` and `ctx` frozen deep, refusals
"A plugin can only add features: …", "main.ts exports no `features['x']`.". The
kernel's `ScriptHost` has **`runPlugin`** beside `run`; `features/plugin.ts`
`expand`s like the Script (shared `checkedGenerated`), checks each input against
the manifest, resolves face/edge/vertex refs with **`ctx.resolve`** — so
`ExpandContext` now has `value`, `file`/`fileType`/`fileName`, `resolve` and `warn`,
the engine's resolver is `#references` (shared with `#evaluate`), a lost ref gives
`refs` for Fix References and a guess warns — and words its failures "Name plate
1.0.0, main.ts line 3: …". The `Recomputer` and `headless.ts` send the plugin file
(`pluginFileOf`) and enable the runner. Example: `examples/plugins/name-plate/`
(typechecked by `packages/cli`), run headless by `packages/cli/src/plugins.test.ts`
(the 60 × 20 × 3 rounded plate: 10 faces, 3535.619 mm³). **Slice 2** added
the person's **installed plugins**: `@extrudo/storage`'s `PluginStore`
(`createPluginStore(files, index?)`, `plugins/<id>/plugin.extrudo-plugin` +
`plugins/index.json` `{ next, plugins: [{ id, name, version, enabled,
installedAt, sha256 }] }`; `install` refuses the same or an older version by
core's `compareSemver`, bytes before the index on install, index before the
folder on remove; `createNodePluginStore(userData)` with `nodePluginIndex`'s
atomic write, `writeAtomic` shared with the project index) — **never part of a
design or the file format**. `Platform.plugins` is required: the web's over
`BrowserProjectStore.files` (OPFS beside `projects/`), the desktop's
`createPluginProxy` over **one channel `plugin:call`** with the whitelist
**`PLUGIN_METHODS`** (`list`, `install`, `remove`, `setEnabled`, `bytes`, `read`)
in `shared/ipc.ts`, answered by `main/plugin-call.ts` (arguments checked, errors
as data). **Settings › Plugins** (`apps/web/src/plugins/PluginsList.tsx`, `PluginsSection` in the
`dialog` "Settings" since ADR-0090 §2; command `plugins` "Plugins…" in Ctrl+K opens it; session state
`createPluginsStore`) installs (`files.pick('.extrudo-plugin')`, a refusal in the
status line "Plugins status"), enables ("Enabled: <name>"), removes (`alertdialog`
"Remove <name>?"), shows README/LICENSE **as plain text** and lists a design's
plugins that aren't installed ("In this design, not installed", **Install**;
`designPlugins`). **Plugin commands** are `CommandContext.plugins`
(`plugin:<plugin>:<command>`, group "Plugins › <name>", model mode only, no key,
built in `AppShell` from the enabled manifests); running one
(`plugins/runCommand.ts`) asks **`Recomputer.runPluginCommand`**, which sends the
bytes once per kernel as `addFile('plugin:<id>@<version>', …)` (a `#resources`
key, so a recycled worker gets them again) and calls
**`KernelApi.runPluginCommand({ fileId, commandId, doc, selection })`** with the
document up to the marker; the worker (`plugin-command.ts`) runs
`ScriptHost.runPlugin` with owner `cmd` and answers a `ScriptRunResult` (failures
as data, "Tiny 1.2.0, main.ts line 3: …"). The app inserts the features **at the
marker in one transaction** named "<plugin name>: <command label>" after core's
**`remintFeatures`** (fresh `newId()`s, the app's names, every reference token
naming an old ID rewritten). **Slice 3 (custom features in the app)**:
`apps/web/src/plugins/featureSpecs.ts` builds one `FeatureDialogSpec` per manifest
feature (`type: 'plugin'`, command `plugin:<plugin>:feature:<type>`, fields from the
inputs, `toInputs`/`fromInputs` through `in:<name>`, an info line "Plugin: <name>
<version>"); the static `featureDialogs()` is unchanged and the **dynamic registry** is
`pluginFeatureEntries(installed)` (Ctrl+K `dialogCommands`, Solid › Create ▾'s "Plugins"
items via `Toolbar`'s `pluginItems`, `run`) plus the controller's `startSpec(spec)` and
`specFor(feature)` option, which `edit` asks when the registry has none:
`specForPluginFeature` builds a stored feature's dialog from **the design's own copy**
of the file (`useDesignPluginFiles`). Running a plugin feature's command first calls
`preparePluginAttachment` (the design's attachment with the same hash, else new bytes
written and cached **before** the dialog opens; `plugins/pending.ts` holds it and
`features/import.ts`'s `fileMediaType`/`fileName` answer for it), and the spec's
`commitWith` adds the record in the feature's undo step. "Update to <version>" is
`designPlugins`' `update` entry and `updatePluginInDesign` (`plugins/update.ts`, one
undo step over every feature of that plugin). `docs/plugins.md` is the guide,
`docs/api/plugins.md` the API page. **Slice 4 (the review's fixes)** bounds the file reader: `readPluginFile` inflates through fflate's streaming `Unzip` in 1 kB pushes and throws once the *real* output passes 4 MB (a header's `originalSize` is never trusted), at most 64 entries, no control characters in names, README/LICENSE 256 kB; manifest strings refuse control and bidi characters; main caps `install`'s bytes at 1 MB; a foreign `in:` kind is the feature's error (`reportFiles` ignores `in:`), generated IDs may not collide with the document's, and a plugin that replaces `Date`/`Math.random` is refused at the end of its run.

ADR-0078 (2026-10-08) made opening a design say what it is doing: the view's
top left has a **progress notice** (`viewport/ModelProgress.tsx`, pure rules in
`progressRules.ts`; "Preparing your design…" until a recompute has finished,
"Updating the model…" after 800 ms of a later one, an animated cube, "Computing
<n> features") and the browser lists the bodies the last session made as
**pending rows** before the kernel answers. The source is the **model cache**,
`projects/<id>/model-cache.json` (`{ version: 1, bodies }`, `ProjectStore.
readModelCache`/`writeModelCache`, written by `project/modelCache.ts` only when
the live body IDs change). Rules a change must keep: **the cache is derived
data, safe to lose**: never in the document, the `.extrudo` file or a version
(no file-format change), a bad file reads as `undefined`, and nothing may depend
on it existing; **the notice never takes pointer events**; pending rows are the
browser's alone (`pendingBodyEntries`: names from `doc.bodies`, no selection or
menu), the view and the commands only ever see computed bodies.

ADR-0079 (the owner's UI review, 2026-10-08) made **one top bar with the tabs**:
`shell/AppBar.tsx` is one 40 px row — the logo, the tabs (`ToolbarTabs`), Undo, Redo
and Search commands, then the design's name, version history, save state, settings,
help and theme — and `shell/Toolbar.tsx` the selected tab's groups below it (the tab is
`useToolbarTab(mode)` in `AppShell`). **The File menu is gone**: its items are the
**Home** tab's tiles (Design, Versions, **Import** — Import .extrudo, Import Model,
Import Drawing, Canvas — and **Export** — Export .extrudo, Export as Script, Export
Model, Save to Linked Folder — since R3-09, in that order since 2026-10-18, Parameters with Customizer); **Plugins…
is in the app menu** and Ctrl+K (R3-12; on macOS the app menu, beside
Settings…: `APP_MENU_IDS` in `apps/desktop/src/main/menuTemplate.ts`); the tabs are
**Home, Solid (Create, Primitives, Features, Pattern, Program, Component), Modify
(Modify, Transform), Construct (Planes, Axes, Points, Inspect — Measure and Section
Analysis, R3-10: there is no Inspect tab), 3D Print** in the model and **Home,
Sketch** in a sketch (3D Print went in the owner's UI review 3, R3-11; `visibleTabs`, `defaultTab`, `tabOfTool` in `shell/tools.ts`); there is no
Insert tab. **Home's file actions are commands, not tools**: `TOOLS` lists them (category
`file`, token `--x-cat-file`, nine new icons) and `FILE_COMMANDS` names the
`FileActions` method each runs (`AppShell.run` for a tile, `fileCommand` in
`buildCommands`), with the old command IDs; an absent method hides the tile and the
command. Command groups follow the tabs ("Home › Import", "Construct › Inspect"), and the **desktop menu maps
Home to its File menu** (`menuModel`'s `topMenu`). **Toolbars fit the window**: the pure
`fitToolbar` (`shell/toolbarFit.ts`) moves the last tile of the fullest group (ties: the
earlier group) into its ▾ until the row fits, never below one tile; the toolbar measures
tile widths once per set of tiles and refits on resize (`data-toolbar-fit`). **A group's
▾ lists only what isn't a tile** (moved tiles, `more`, plugin features). The tutorial
points at a tool's tab when its tile isn't shown (`toolOrTabSelector`). e2e:
**`pickTool(page, name)` finds a tool anywhere** (a tile by accessible name or its
`data-label` — the tool's full name —, another tab's tile, a group menu's item),
`fileAction(page, label)` runs a Home command, `selectTab(page, name)` selects a tab;
`e2e/topbar.spec.ts` measures the baselines and the fit.
**Round 2 (2026-10-08)**: the default theme is `system` (`DEFAULT_THEME`;
`playwright.config.ts` sets `colorScheme: 'dark'` because Playwright reports a light
system theme and the baselines are dark), the gear is a **Settings menu**
(`SettingsMenu` in `AppBar.tsx`: General — Auto-project body edges / face outline on the
viewport store, **Radial right-click menu** (a checkbox on the same state as the `Right-Click Menu: Use a List / Use the Ring` command, `markingStyle`; 2026-10-09), Customize Marking Menu… — and Theme; the bar's theme button is gone,
`ThemeMenu` remains on the home screen), the cluster is **Search, Undo, Redo** (R3-05:
Search drops the one search from the button, `onSearch(at)`; no Toolbox button), the right
side is Version history, Settings, Help, and the name plus the save dot are one `TitleGroup`
centred between the cluster and Version history; the pure `titleFit`
(`shell/titleFit.ts`) drops the save word first (`data-title-fit="dot"`), then truncates
the name (`truncate`, `title` = full name). The separator after the cluster is gone.
**Round 5 (2026-10-14, the owner's recording)**: the gear is the **app menu**
(`shell/AppMenu.tsx`, button "Menu", four squares), shared by the design's bar and the home
screen's: Settings…, Plugins…, then submenus **Behaviour ▸** (the auto-project
checkboxes, Radial right-click menu, Customize Marking Menu… where a design is open),
**Mouse controls ▸**, **Theme ▸**, and last **Quit** (Ctrl+Q, desktop only, `platform.menus`)
or **Close design** (the web, in a design: back to Home; a page can't close its tab). It reads
and writes the display settings through `DisplayAccess` (`storeAccess` in a design,
`preferencesAccess` on Home). `ThemeMenu` is gone. (ADR-0090 replaced the dropdown and
the Help menu with one panel; see its paragraph.) Help ends with **Source on GitHub**. The
home bar is a design's (h-10, logo 20, wordmark 16 px) with Docs and GitHub as tab-styled
links that open through the platform (`Platform.openSite`, `openDocs`): the desktop sends
only the name over `site:open` and main holds the URLs (`SITE_URLS` in `main/docs.ts`), as
for the docs; the web's address takes `VITE_REPO_URL` for a fork. **ADR-0085's amendment**
made the bar's About a button that opens the About dialog (not the landing site) and
dropped `about` from `SiteLink`/`SITE_URLS`, so `openSite` keeps only `repo`; there is no
Help menu on the home screen (the macOS About Extrudo still runs the dialog through the
home screen's `menu:run` listener). **Tiles first**: Home's file groups have no fixed `more` (Import: Import Design, Import Model — `importBody`, full label "Import STEP, mesh, OpenSCAD or .f3d…" —, Import Drawing, Canvas; Export: Export Design, Export Model, Export as Script, Save to Linked Folder; one Files group until R3-09), Construct › Planes shows all seven planes as tiles, and a tile is a fixed 64 px wide, its label the tool's full name wrapped onto up to two 11 px lines when it fits, its short name otherwise (ADR-0079 round 3).

ADR-0080 (P6-06, slice S1) made the docs site one site: `apps/site/src/docs.ts`'s
`COLLECTIONS` map `docs/guide` → `/docs/`, `guide/tutorials` → `/docs/tutorials/`,
`guide/tools` → `/docs/tools/` and `docs/api` → `/docs/api/` (a file goes to the deepest
match; `index.md` or `README.md` is a folder's page), with one sidebar (Guide, Tutorials,
Tools, Examples, API; empty sections hidden; front matter `section` picks a guide page's
section, in the API it is still the sub-group). A relative image or `<video>` is emitted once
as a hashed asset and a missing file fails the build (`docs/guide/x.md: missing image …`);
`demo:<toolId>` is `apps/web/public/demos/<id>.webm`; **the only raw HTML is `<video>`** with
a fixed attribute list; `{{APP_URL}}`/`{{SITE_URL}}`/`{{EDGE_URL}}` come from `addresses.ts`.
Tools, examples and tutorials are later slices (the ADR lists S1–S10). **Slice
S2** added the generated tool reference: `pnpm docs:generate`
(`scripts/generate-docs.mjs` → `apps/web/src/shell/toolDocs.ts`) writes
`docs/guide/tools/<id>.md` and the index from `TOOLS`/`TABS`/`keysFor`/
`DEMO_TOOLS`, **notes between the `<!-- notes -->` markers survive
regeneration**, and `toolDocs.test.ts` fails with "run pnpm docs:generate" when
the pages are stale. **Slice S9** put the links in the app: the Help menu's
(the Menu panel's Learn column since ADR-0090) four docs items and the `help` command (**F1**, the hovered or focused
toolbar tile's tool page, else the guide) go through **`Platform.openDocs`
**(required; `shell/docsLinks.ts` builds the `docsPath` results, `VITE_DOCS_URL`
overridable at build time), and on the desktop over the channel `docs:open`,
where **main builds its own URL** from a whitelist and opens it through injected
`shell.openExternal` — never a URL from the renderer; a tile's tooltip carries
a muted "F1 for more" line (`Tooltip`'s `footer`, plain text). **Slice S10**
(the review's fixes, P6-06 closed 2026-10-09): the docs build refuses a link
whose scheme isn't relative, `#`, https, http or mailto (a `link` renderer in
`docs.ts`; `<file>: link scheme not allowed: <href>`), the `.md`-link and
no-script tests walk every collection and hostile fixtures, a malformed `%`
in `#/p/…` or `#/example/…` is `not-found`, **F1 is `inFields`** (the `help`
command's `AppCommand.inFields`), a tile that unmounts while hovered released
`toolUnderPointer` (`releaseTool`; both gone since ADR-0090's review: F1 reads `lastHoveredTool()`), the Help menu's **Help for This Tool** carries
F1 (User Guide has no key), the guide's pictures are recorded by `pnpm demos
-g guide` (`e2e/guide-shots.spec.ts`, like `-g tutorials`) and the tutorials are
numbered 1 first-part, 2 storage-box, 3 name-tag, 4 bottle-cap.

ADR-0082 (2026-10-10) added **the Settings screen** (`apps/web/src/settings/`, no
kernel, schema or file-format change): the dialog "Settings" (`SettingsDialog`;
app menu › Settings…, **Ctrl+,** `openSettings` in `commands/keymap.ts`, the Ctrl+K command,
the home screen's app menu) with sections General (Appearance since ADR-0090), View and navigation, Sketch, 3D
printing, Export, Desktop and Agents (MCP) (`desktop` and `agents` shown only where
`platform.desktop` exists; remembered in `settings.section`). Rules a change must keep: **every
preference key lives in one section of `settings/inventory.ts` or in
`NOT_IN_SETTINGS` with a reason** (`inventory.test.ts` scans the source for keys,
`viewport` expanding to its `DEFAULT_SETTINGS` fields, and fails on one that is in
neither), **the dialog edits the same state as the quick controls** (the project's
viewport store through `storeAccess`, the preference itself on the home screen
through `preferencesAccess`; `print.material` through `print/materialStore.ts`,
one store per `Preferences` that Print Info and the dialog share, so never keep a
copy of it in component state), and **a preset material's density is an
override**: `print.material.densities` holds only what a person changed
(`withDensity`/`withoutDensity`, writing the built-in number removes the entry),
so an untouched material follows `MATERIALS`; `density` stays the Custom
material's own (default `1.24`). Print Info's Density field shows for every
material. Slicer paths are the desktop preference `slicers.paths` main reads per
call; there is no auto-update switch (the updater has none) and no zoom setting. Its
2026-10-18 amendment added **Settings › Keyboard** (`settings/KeyboardPage.tsx`): the
`keymap.overrides` preference holds **only changed commands** (an empty list = no key;
writing the default back removes the entry, `cleanOverrides`), and **`keysFor` is the one
reader** (override, else `DEFAULT_KEYMAP`); `defaultKeysFor` is for what must not follow a
browser (the generated tool pages). `commands/keymapStore.ts` is one store per
`Preferences`, created in `App` before anything shows a key; `AppShell`'s command,
dialog-command and Settings command lists take `useKeymap`'s value as a dependency, so a
new list built from `keysFor` is how a change reaches the toolbar, menus, search and the
native menu (whose `toItem` skips keys Electron can't take, such as chords).
`conflictsFor` blocks a key, or a chord's first key, that another command uses in a mode
both are offered in, and only notes a cross-mode share; `isReserved` refuses Escape, Tab,
Enter and the browser's own Ctrl+W/T/N/Tab.

ADR-0081 (P6-05, 2026-10-10 to 11) added **components and as-built joints**: a
component is a named set of bodies (`doc.components[]`: ID, name, display; **no
transform**: placement stays the timeline's, so Move/Copy/Place Component are
the Move and Place on Bed features, Place on Bed's `carry` input taking the
others along), membership is `BodyMeta.component` plus `Feature.component` (the
stamp of the active component) with `componentOfBody` (stored metadata, else the
body a piece broke off through the kernel's `origins`, else the stamp) as the one
rule; **components never enter a reference**. Session state: `activeComponent`
and `isolatedComponent`, followed by `followComponentSession`; every app insert
goes through `withActiveComponent` (a source-reading test lists the sites).
Export: 3MF `<components>` and STEP assemblies behind "Keep components
together"; Print Info's rows per component (`PrintInfo.components`, split by
`BodyEntry.component`). **Joints** (`doc.joints[]`: rigid, revolute, slider; side
`a` moves, `b` stays; frames are ordinary `GeomRef`s) are resolved at the marker
after the walk (`ModelState.joints`, uncached); **the pose is view state**
(`viewport.jointPose`, reset by any tool, posed bodies unpickable) and the
clearance check is `KernelApi.checkJoint` on existing kernel calls
(`packages/kernel/src/joints/`, ADR-0081's Results). The API has `d.component` and
`d.joint` (a suppressed joint stored only as `true`), the emitter writes them
and the CLI has `check --joints`. Guide: `docs/guide/components.md`. **Amendment
2026-10-21 (#74):** the Solid tab's group is **Assemble** (tiles, IDs and keys unchanged; Ctrl+K
group "Solid › Assemble"; search finds them by "assembly" through `TOOL_KEYWORDS`), and the Bodies
folder ends with the **assembly hint** (`[data-assembly-hint]`) while `offersAssembly` holds (two or
more non-pending bodies, no component), model mode only, closed for good through the preference
`browser.assemblyHint` (in `NOT_IN_SETTINGS`).

ADR-0083 (the owner, 2026-10-10) added **`.f3d` import**, `packages/f3d`
(`@extrudo/f3d`, pure TS; deps `@extrudo/api`, core, sketch, `fflate`,
`fzstd`; kernel test-only). `readF3d` decodes the archive into plain data
(parameters, timeline, sketches, extrudes with their profile regions,
fillet/chamfer edges as tagged ASM faces), `f3dToDesign` writes it through the
API and returns a report (imported, skipped with why, notes); the format is in
`packages/f3d/FORMAT.md`. Home › Import › **Import Model** takes an `.f3d` too
(`importF3dFile` in `project/actions.ts`, its own lazy chunk) and makes a new
design of it (no separate tile, 2026-10-11). The home screen's one **Import…** card
(Start row; `importAnyFile`) takes `.extrudo`, `.f3d` and model files; a model file makes a
new design that opens with the Import dialog on it (`requestModelImport`). No sample files in the repo: `F3D_SAMPLES=<dir>` runs
`corpus.test.ts` (`F3D_REPORT=<file>` writes what each file left out, with the technical
detail). A skipped feature's `reason` is plain words for people (at most `MAX_REASON`, 120
characters, never a list in braces: `skippedFeature`, R3-18) and `detail` the technical text. **Amendments of 2026-10-11 and 2026-10-12** closed most of the original gaps: components (each a component of the design, ADR-0081), mirrors, rectangular and path patterns, sweeps, splits, modeled threads, naming a copied face, sketch constraints and dimensions, elliptical arcs as exact conics, fillet and chamfer edges read where the file has them, `skipLostEdges` on every round and chamfer (ADR-0038's and ADR-0043's amendments) and reading the segment under the `[Active]` folder (`activeDesignSegment` in `model.ts`). What still does not come across is in the ADR's Consequences (for example faces given as an extrude's profile that cannot be named).
**Amendment of 2026-10-14 (skipped features):** an edge recipe whose first face has a negative token runs between its second face and the single one after it (`edgeFaces`, `decode/edges.ts`); a fillet/chamfer none of whose edges passes the weak-edge rule gets one second try (`loose`) by its two faces' names alone, no fingerprint, relying on `skipLostEdges`; a profile region nothing finds is left out with a note only while the operand's other regions are found (else the extrude is skipped as before); a hole without centre points takes them from its own cylinders' axes (`centresFromCylinders`, at most `MAX_FOUND_CENTRES`, never a pattern's copies), and a hole on a body face takes its placement's point and normal only when the recipe's B-rep plane agrees (`readHolePlacement`, `planeThrough`); an extrude head is also looked for at offset 57, after every other offset.
Parameter value records are read in class versions 5–7 and 9 (2026-10-20, #93). A decode problem must never be silent: `F3dDesign.problems` reach `ImportReport.problems` and one `importNotices` line, and a through-all fallback for a missing distance (`throughAll` in `map.ts`) adds a note when `unreadParameters > 0`.

**Amendment of 2026-10-15 (hostile files, round 2):** every reader stays linear in its input. `readAsm` shares one-byte values and small ints (frozen objects: never mutate an `AsmValue`), needs a class per record and caps values (1 per 4 bytes, 16 M), records (1 per 16 bytes); `asmFaceTags` returns a per-stream shared array (don't mutate it) and, like `asmFaces`' loop walk, spends a per-stream budget; `asm-body` reads each surface, curve and edge record once per stream (`Walk.surfaces/curves/edges`), `asm-spline` each B-spline block once (WeakMap by values array), and `brep-step` writes a B-spline once per body (`shared`, keyed by the spline object; analytic geometry per use) within `MAX_STEP_BYTES`. `archive.ts` inflates streaming into the declared size and must fill it, refuses a declared size over `MAX_RATIO` × compressed + 4 kB before allocating, and walks a Zstandard frame's headers first (one frame, no dictionary, window ≤ `MAX_ZSTD_WINDOW`). `readSegment`: `readOperationTable` spends one budget per segment; timeline items and type-table ids are deduplicated; `scopeOf` memoises `readScope`; `madeBy` is indexed; `refsOf` frames a record under `tryDecode`. Numbers from the file go through `finite` (`bytes.ts`) at decode. Core's expression parser refuses nesting past `MAX_DEPTH` = 256 (parser depth and node height). A new reader keeps to this: no per-byte objects, no walk repeated per referrer, a budget where a search tries every offset.

**Amendment of 2026-10-16 (import in a worker):** the app never calls `importF3d` on the UI thread: `importF3dFile` takes an `ImportRunner` (`project/f3dImport.ts`; tests pass one that runs inline), and the default starts `f3dWorker.ts` per import, transfers the bytes, gets `{ result }` with the design as its document (rebuilt with `Design.from`) or `{ error }`, and terminates the worker on answer, `error` event or `F3D_IMPORT_TIMEOUT_MS` (30 s, about 6× the corpus's slowest import). Anything added to `ImportResult` must stay structured-cloneable, or be converted at that boundary. A JS-heap OOM in a worker crashes the renderer without an error event (measured): only the time budget stops it.

**Amendment of 2026-10-14 (torus, sweep faces, further records):** a torus primitive's matrix is in its plane's frame (`decode/torus.ts`: centre = matrix origin, axis = matrix Z, through the geometry operand's model plane); `readTorus` refuses it when the B-rep keeps a torus the feature made elsewhere; it maps only onto the origin plane square to its axis. Sweep faces are told by geometry, never by token (`sweep-faces.ts`): only for a path that chains, is flat and crosses the profile's plane square to it, at most `MAX_PATH_PIECES` pieces; along a spline only a plane at one height; `cap:start` is the cap at the path end nearer the profile. A feature's further records in other components (`decode/feature-records.ts`, `12D00AC0…`) map faces to the timeline feature only through that list (`timelineFeature`), never by a shared name; their bodies are added to a join/cut that names bodies (`allParticipants`), and a feature naming none keeps none.

**Amendment of 2026-10-16 (target bodies, extrude extents):** a body of a feature that made several maps to `<feature>:k` only through `bodyOrder` (`map.ts`): a new-body extrude of one region operand, the file's body i (by index) = region group i, k = the rank of that group's outline-box centre (x, y, z, as `newBodies`; a tie is ≤ 1e-6 mm, the kernel's `ORDER_TOLERANCE`, and passes to the next axis except for spline/ellipse outlines; a deciding gap under `ORDER_SLACK` 0.01 mm is unknown; neighbours checked after sorting, centres must be finite); anything uncertain (another feature kind, several operands, a region not found, a taper, a to-object extent, a file body count other than the group count) drops the whole target list as before, with a note. After a join naming several bodies their IDs are unknown (`splitSolids`): later features naming one get no list, none of them is hidden, put in another component (a Body to Component moving one gets a note) or hinted; the join itself names them in Extrudo's default order. A start face's `ProfileOffset` runs along the face's normal, a start plane's (`startPlane` in `model.ts`, read only with no face operand and no up-to face, never degenerate) along the sketch normal; a slanted start is handled for a cut from a body face only (sketch copy moved past the face, `to-object` the face's plane plus the distance, that plane made only with the extrude); an up-to-face offset of a one-sided extrude from a start face is negated (two-sided: the file's sign); up to a parallel face stays a distance (the named face measured worse).

**Amendment of 2026-10-21 (text in fonts that fit the file's):** `fontFor` (`map.ts`) draws a family that has a stand-in in it (`STAND_INS`: Arial → Arimo, Arial Narrow → Archivo Narrow, regular and bold; DIN Condensed → Sofia Sans Extra Condensed Bold), anything else as before (Inter, or the serif, mono, stencil face). A stand-in is drawn at the file's font size: Extrudo's height (the capitals') is the size × the stand-in's own cap height over its em (`TextFont.cap`, from its OS/2 `sCapHeight`; an older text's height is Arial's capitals, so its font size is that / `CAP_HEIGHT`); without a stand-in the capitals are the size × `CAP_HEIGHT` (Arial's 0.716). A newer text record's byte after the angle is its bold flag, an older record's weight ≥ 700 is bold (`decode/text.ts`, `SketchText.bold`). Newer texts stay centred in the file's box (the box is the ink's width; centring lands closer than the box corner). A new stand-in needs the width measurement of the ADR's amendment and must be a bundled font (ADR-0058 §3: unmodified, its own ID).

**Amendment of 2026-10-23 (face deletions decoded):** the timeline record `29EF07D3…` is the source app's face deletion (its scope `kind` is `DeleteFace`), decoded as `DeleteFaces`/`delete-faces` but mapped by phase 2 (`map.ts` `deleteFaces` makes a `removeFaces` step; left out when a face is copied by a pattern/mirror or not all faces can be named; on the bumper 20 of 28 import but none takes effect in the replay, their fillets fail first). Its layout is Offset faces' (`D087EFE5…`) without the distance: an operand group (`2CA5A1CD…`) of face operands (`5662F619…`), each recipe naming its face first; twelve zero bytes and a `u32 1` sit where Offset faces writes its distance reference and a `u32 1`. `model.ts` reads the faces through a shared `faceOperands` helper (Offset faces uses it too), each recipe with `tryDecode`. Phase 2 maps it once `removeFaces` (ADR-0099) lands; of the corpus's 28 such records (all in the issue's second file, one face each), 20 name every face through `faceName`.

**Amendment of 2026-10-23 (round faces and moved faces):** a round's face (`faceName` → `nearestEdge`, `map.ts`) goes to the round's edge whose points (ends and midpoint, or eight around a whole circle) lie nearest the face's own surface (`surfaceGap`: cylinder, cone, sphere, torus; planes and splines keep the hint rule); ties within `GAP_TIE` go to the edge nearest the hint, then the token; **every edge with a shape takes part, named or not**, so a face of an unnamed edge is a miss, never a neighbour's name. A face's tags in a recipe are the operations it had when picked (making id, then negative ids of later changes); `model.ts` `statesOf` takes the stored state (`.smb` and `.smbh`) whose tags differ least from the recipe's (states with a known surface first, ties to the solved body) as `surface`, keeps the others, distinct, in `F3dFace.states` and the solved one in `F3dFace.solved` where it differs; `faceName` retries the states when `surface` names nothing — **except `offsetFaces`**, which names by `solved ?? surface` with no states, exactly as before (offsets newly named that way hung Offset Face for 15+ minutes on one design and broke a thread on another). Kernel: `faceRelation` (`topo-id.ts`) relates two stems `head(x)`/`head(y)` with the same head whose nested names relate (`nestedRelated`), so the round of an edge resolves to the round of a piece of it. On the bumper all 28 deletions import, 5 take effect; the rest fail on kernel limits (Offset Face's `sharp-chain` guard and "too far", Remove Faces on one face of a round loop).

**Amendment of 2026-10-23 (failed face deletions leave the timeline):** after the probe's recompute, `failedDeletions(design, features)` (`body-check.ts`) lists the `removeFaces` steps that ended in error; `checkF3dBodies` puts them in `BodyPlan.dropped`, `applyBodyPlan` removes them first and `saveF3dImport` moves them from `imported` to `skipped` (kind `DeleteFace`, reason `Extrudo couldn't remove its faces: <kernel message, first sentence>`). Only face deletions; no geometry changes, so the plan must stay identical with and without (test). No written body, no check, deletions stay.

ADR-0084 (the owner, 2026-10-14) **checks each body an `.f3d` import rebuilt against the
file's own B-rep body** and brings the file's shape in where the replay misses. Pure parts in
`packages/f3d/src/body-check.ts` (`probeDocument`, `measureProbe`, `fileBodies`, `planBodies`,
`applyBodyPlan`, `bodyFiles`, `bodyOutcomes`), shared with the private corpus tooling; the
app's runner is `checkF3dBodies` (`apps/web/src/project/f3dCheck.ts`, lazy with the importer)
and the wiring `saveF3dImport` in `project/actions.ts`. Rules: pair **by geometry only**
(volume within 0.5 %, tight box within 0.05 mm; the creator hint only picks what to take out);
the check runs **before the first save** in a throwaway worker that is always disposed, never
writes the model cache, starts no kernel when no body was written and gives up after
`CHECK_TIMEOUT_MS` (a failure keeps today's import plus one notice); a body with an
inward-signed sphere/torus face was left unchecked until 2026-10-14, when the writer's
loop-winding fix (ADR-0083's amendment of the same day) lifted that rule (the `inward`
field, `hasInwardFace` and `INWARD_REASON` are gone); mismatches are taken out with **one Remove
"Remove rebuilt bodies"** (never hide, suppress or delete) and brought in as **one `import
"Import Body<n>"` per body** with its own attachment and component stamp; save order is replay
doc, then STEP attachments, then the final doc; a STEP over 25 MB or past 100 MB in total
stays unchecked; missing bodies are counted, never named. No schema change.

ADR-0085 (the owner, 2026-10-14) **gives every build a version and an About dialog**
(`apps/web/pwa/build-info.ts`, `src/version.ts`, `src/shell/AboutDialog.tsx`,
`systemInfo.ts`, `aboutLinks.ts`, `AppMenu.tsx` (was `HelpMenu.tsx`), `apps/desktop/src/main/links.ts`).
Rules: the version is `git describe` from the last `v*` tag: plain `0.6.1` at the
tag or on stable, `+edge.N` / `+dev.N` build metadata otherwise (never a
pre-release suffix); `EXTRUDO_CHANNEL` (`edge` | `stable`, else `dev`) is set by the
workflows, whose app builds check out with `fetch-depth: 0`; `BUILD.version` is for
display only, **documents keep `APP_VERSION`** (the package version, `meta.appVersion`);
**every About link is in `aboutLinks.ts`**, and an address that is new must also be in
main's allow-list (a test fails otherwise); **links on the desktop go only through
`Platform.openLink`** (`link:open`, main checks https, no credentials or port, host
and path prefix); the dialog adds no cross-origin load and no string evaluation; the
Help menu was `HelpMenu` with optional handlers (since ADR-0090 the Menu panel's About
Extrudo item); macOS's About runs the `about` command in the renderer. **Amendment
(2026-10-14, merged with ADR-0079 round 5): the home bar's About is a button
that opens the dialog (the `TopLink` look, `TopLinkButton`), there is no Help
menu on the home screen (its `menu:run` listener stays for the macOS About),
and both link mechanisms stay — `openSite(name)` for the fixed named pages
(only `repo` now) and `openLink(url)` for the dialog's URLs that carry a
hash; folding them into one was rejected for now.** No schema change.

ADR-0086 (the owner, 2026-10-15) **makes the Parameters dialog a list and an inspector,
puts groups on parameters and keeps slider ranges as formulas** (format **2**, the first
bump). Files: core `schema.ts` (`Parameter.group`, `CustomizerSchema` of strings, no
min/max check), `customizer.ts` (`evaluateRange`, `setParameterGroup`, `moveParameter`,
`RANGE_FIELDS`; `customizerRows(doc, evaluation)` takes the whole evaluation),
`document-commands.ts` (`parameterUsers`, `refuseIfUsed` built on it, renames reach
ranges), `migrations.ts` (`v1ToV2`), `format.ts`; the app's `parameters/ParametersDialog.tsx`
(list, drag), `ParameterInspector.tsx`, `list.ts` (`listSections`, `dropIndex`,
`stepIndex`, `labelOfUse`, `starCommand`). Rules: **`min`/`max`/`step` are expressions
in the parameter's unit, stored as typed**; a range may use other parameters but **never
the parameter or one of its dependents** (`evaluateRange` refuses; `customizerRows`
leaves out an end that stopped evaluating, and both ends when min > max, so no slider
rather than a wrong one); **the group is the parameter's** (`parameter.group`, 1–40
characters, also for unexposed parameters) and the panel and the dialog group by it
(no group first, "General" in the dialog, then groups by first appearance; flat list
while no parameter has a group); **`doc.parameters` order is the dialog's and the
panel's order** (`moveParameter` = one undo step, a group change included; order never
changes a value; the macro emitter keeps dependency order); **"Used by" and the delete
refusal come from the same `parameterUsers`** (ranges count as users); a formula
parameter has no range fields. A migration from format 1 spells out the base unit
(`25.4` → `25.4 mm`, `30` → `30 deg`) and moves `customizer.group`. e2e: rows are
`[data-parameter-row="<name>"]` (`aria-current` when selected), sections
`[data-parameter-section]`; select a row before its fields exist (`selectParameter`,
`parameterExpression`, `addUserParameter` in `e2e/helpers.ts`).

ADR-0087 (P6-08, 2026-10-15) added **the desktop MCP server and its skill** (no
schema or file-format change). **Main** hosts it (`apps/desktop/src/main/mcp/`):
`server.ts`'s `createMcpServer` (Node `http` bound to the literal `127.0.0.1`,
default port 7474, path `/mcp`, the SDK's `StreamableHTTPServerTransport` in front
of a low-level `Server` per session, at most 16), `admit.ts`'s pure `admit` (in
this order: **403** for a `Host` other than `127.0.0.1:<port>`/`localhost:<port>`
or an `Origin` other than `http://127.0.0.1[:port]`/`http://localhost[:port]`,
**413** over 1 MB, **401** `{"error":"Unauthorized."}` without the bearer token,
compared in constant time), `token.ts` (`userData/mcp-token`, 64 hex, mode 0600,
read on every request so Regenerate applies at once), `service.ts` (the
preferences `mcp.enabled` (true) and `mcp.port` (7474, 1024–65535) read by main
itself; a `prefs:write` of an `mcp.*` key reconfigures: **off closes the port**;
one change at a time; a bind error is the status's `error`), `exports.ts`
(`userData/agent-exports/<stem>-<n>.<ext>`, never overwriting, 20 MB cap) and
`skill.ts`/`skillFiles.ts` (the skill bundled with `import.meta.glob` `?raw`).
**Main never touches the document and knows no tool**: the renderer sends the
tool list (`extrudo:mcp:tools`), each call is `extrudo:mcp:request` → renderer →
`extrudo:mcp:respond` (checked by `shared/mcp.ts`'s `isToolDefinitionList`/
`isToolResponse`; text and PNG image content only; 60 s timeout; "Extrudo's window
isn't open." while no page has said `app:ready` since its last full navigation —
a hash route keeps it), status goes out over `extrudo:mcp:status` (`{ enabled,
port, url, listening, clients, error? }`, `clients` = sessions with a stream open
or a request in the last 30 s), `status-read`, `config` and `regenerate-token` are
invokes; the one exception is `get_skill`, answered by main from the skill it
serves. **Settings › Agents (MCP)** (its own section since the amendment of 2026-10-18;
`agent/clientSetup.ts`'s pure `agentSetups({ url, token })` gives the text per agent:
Claude Code, Codex CLI, opencode, the `mcpServers` JSON, a sentence for the agent;
add a new agent there with a test, never in the dialog) shows them in a read-only
textbox with Copy and Regenerate token, and a Skill row with **Install skill / Update
skill** (`main/mcp/skillInstall.ts`: `skillsHome` per agent, `skillState` by sha256 of every
file, `installSkill` under `<dir>/extrudo`; **always through the folder dialog**
`createFolderPicker`, preset to the agent's folder, never a path written unasked) or
**Save skill to…** for agents without a known folder. **Main allows the renderer one permission,
`clipboard-sanitized-write`** (`main/permissions.ts`; every Copy button needs it) and
denies every other. **Only `apps/desktop/src/main` and `apps/desktop/scripts` may import the
SDK** (`check-boundaries.mjs`); it is a devDependency bundled into `out/main`,
and `check-licenses.mjs`'s `BUNDLED_DEV` walks its dependency tree (NOTICE §4).
**The tools are the web app's** (`apps/web/src/agent/`): `schemas.ts` (one zod
schema per tool through core's `z`; `toolDefinitions()` via `z.toJSONSchema`),
`tools.ts`'s `runTool` over an `AgentContext` and the open design's `AgentHost`
(`host.ts`; `AppShell` registers it with `useAgentHost` while mounted, desktop
only; `useAgentBridge` in `App` answers calls and sends the list), so
`list_designs`, `new_design`, `open_design` work from the home screen. Rules a
change must keep: **every change is one undo transaction `Agent: <what>`**
(refused with `BUSY` while a transaction is open or a sketch is being edited, so
it never joins the person's), **parameter writes go through the shell's
`apply`**, **features come from `@extrudo/api`** run on `Design.from(document)`
and go in at the marker after `remintFeatures` and `withActiveComponent`, through
`apply` (`insertFromApi`; a name the agent asked for is kept when free), a bad
input answers `ApiError`'s `path: message` and changes nothing, a change waits for
the recompute (`settled`) and answers the features in error or warning
(`problems`), with no design open a design tool answers "No design is open: call
open_design first." as `isError`, never a throw; screenshots are paced to one a
second and exports to one per 2 s (`createPacer`); the renderer never names a
path (an export's bytes go to main). `add_sketch` draws shapes (dimensioned
rectangles, circles with a diameter dimension, lines, polylines, arcs, slots) and
answers the profiles; **`run_command` runs outside any agent transaction** (a
command that opens a dialog or a sketch answers `{ command, opened }` and change
tools wait for it), refuses `undo`/`redo`, and **`AGENT_DENIED_COMMANDS`** (quit,
native dialogs and pickers, outside pages, app settings; plus `openRecent*`) is
left out of `list_commands` and answers "Not available to agents."; `{ edgeBetween: [face, face] }` is the one input shorthand
(`expandShorthands`, the API's `edgeName`). The top bar's `AgentIndicator`
("Agent connected", `data-agent-clients`) shows while `clients > 0`; Settings ›
Desktop › Agents has the switch, a plain numeric port field (an app setting, not
a model value), the state line ("Listening on …", "Off.", the bind error), Copy
client config (`clientConfig`) and Regenerate token. **The skill** is
`apps/desktop/skill/extrudo/` (`SKILL.md` with `name: extrudo`; `references/api.md`
from `pnpm api:generate`'s `skillPages()` and `references/tools.md` from
`apps/web/src/agent/toolsPage.ts`, both stale-checked; `examples.md` hand-written,
its JSON calls parsed, checked against the schemas and run through the tools by
`skill.test.ts`), served per **SEP-2640 (Final)**: `capabilities.extensions
["io.modelcontextprotocol/skills"] = { directoryRead: true }`, `skills/list`,
`skills/get`, `skill://extrudo/<path>` resources and `resources/directory/read` as
custom handlers, `instructions` "Read skill://extrudo/SKILL.md before modelling.".
`desktop.yml`'s Linux job zips it as `extrudo-skill-<version>.zip` (attached to a
tag's draft release). `apps/desktop/scripts/mcp-client.mjs --launch` (under
`xvfb-run -a`; Chromium's headless Ozone crashes Electron's main) is the
acceptance client, `--examples` runs the worked examples in the real kernel.

ADR-0087's amendment of 2026-10-19 (#83–#89): **body references are
`<feature id>:<n>`** (the API's `handle.body()` is `<feature>:0`); the tools'
`resolveBodyRefs` checks every body reference in `add_feature`/`edit_feature`
inputs against the computed bodies (a bare feature id for its one body, an
unknown or ambiguous one refused with its input path, unchecked only while
the model isn't computed). New tools: `set_body_appearance` (one
`updateBody` step) and `check_interference` (kernel `interferences()`,
`KernelService.interference`, `AgentHost.interference`; touching pairs aren't
listed). `add_sketch`/`get_feature` answer `regions` in `profiles`' order and
the sketch's `frame`; curves carry their `sketchEntity` ref. `screenshot`
options go through `SnapshotOptions` (`viewport/snapshotView.ts`): own camera
and render target, body groups named `body:<id>`, sketches and construction
inside `snapshot-overlay` groups (keep new overlays there), a section is a
renderer clipping plane with faces double-sided for the shot; with no options
the snapshot path is the thumbnail's, unchanged. Tests:
`agent/tools.kernel.test.ts` runs the tools on the real kernel
(`agent/kernelTesting.ts`); add a case there for anything that depends on
body ids, profiles or frames. A join's picked bodies that the tool doesn't
touch stay separate with a warning (`operate`, #87).

ADR-0087's amendment of 2026-10-22 (#103–#105): **`add_sketch` coordinates
(and a slot's `width`) take expressions**; `shapeDrawer` in `agent/tools.ts`
evaluates them (`evaluateParameters`) to draw, then dimensions each
non-plain coordinate horizontally or vertically from one fixed point at the
sketch origin (`-(<expr>)` when negative; dimensions are unsigned). Plain
numbers stay undimensioned; an arc's `through` only places it; a closed
polyline gets a closing coincident. **The API's `arc(start, end, through)`
runs on `through`'s side** (stored reversed when that is clockwise). New tool
`rename_design` (one step, then `save`). `kernelTesting.ts`'s `apply`
re-solves sketches as the shell's does (`settleSketches`), so a kernel test
can change a parameter and see the geometry follow.

ADR-0088 (P6-09, slice 1 2026-10-15) added **the OpenSCAD export**:
`packages/kernel/src/scad-export/` (`ir.ts`, `print.ts`, `context.ts`,
`versions.ts`, `mesh.ts`, `file.ts`, `number.ts`), `RecomputeEngine.exportScad`
over `AtMarker.steps`, `exportScad` on `KernelService`/`KernelApi`/`Recomputer`,
and `extrudo export --format scad`. Rules a change must keep: **the recompute
only records** (`steps` holds references to each write feature's inputs,
values and body maps, on the recompute channel); hooks and meshing run at
export time only. **A feature's `csg(ctx)` hook** returns a node per body of
`ctx.changed` built from `ctx.body(id)` (earlier versions) and numbers or
`ctx.scalar(name)`, or `null`/`ctx.unsupported(reason)`; it changes nothing,
releases what it makes and decides bodies from `before`/`after`, not the
inputs. **Fallback to a polyhedron** (a mesh version, listed in the header
with its reason): no hook, `null`, a body left out, a body broken into pieces
(`origins` from a body that existed before: source and pieces), or a
`KernelError` from the hook; later features build on it with CSG again. Only
versions the exported bodies reach are written and meshed; a tool used twice
or more is a `<Feature>_tool` module. **Deterministic**: every number through
`scadNumber`, polyhedron points rounded to 1e-4 mm in first-use order with
faces clockwise from outside, module names from body/feature names in
timeline order (`<Body>_v<n>`), no date. Scalars are `number | { expr, value,
refs }` (slice 4b): the engine passes `liveScalar` (a named model input's
variable, else `translateExpression`, else the value) and `scadParameters` as
`ScadSource.scalar`/`parameters`; `writeScad` writes `parameterBlock` after
`$fa`/`$fs` from the refs in the written nodes (`used`) and `parameterUse`'s
`fixed`. **A hook reads every live scalar through `ctx.scalar(name)`** and
builds on it only with the IR helpers (`half`, `negate`, `absolute`, `sum`:
they keep `refs` and brackets); an expression input it doesn't read that way,
every input of a mesh version's feature, and the expressions of body-less
features they build on (sketch dimensions, construction planes) count as
held fixed and get the Customizer note. **Document text that lands in a comment goes through `commentText`
(print.ts); group headers through `groupName` (params.ts).** A script's features write values.
Slice 3 added hooks for the primitives,
Move, Mirror, Scale and the rectangular and circular patterns of bodies.
**A solid feature's hook builds its tool in place and hands it to
`operationCsg(ctx, operation, tool)`** (`scad-export/operation.ts`, read from
`changed`/`removed`). **Hooks reuse the evaluators' placement math, never a
copy of it:** `lineOf`/`planeOf`/`pointOf` take a `GeometryReader`,
`centreOf`/`existing` a `Pick` of `EvalContext` that `CsgContext` also
satisfies (it has `bodies` and `bodyId`), and Move's `moveMotion`, Scale's
`scaleCentre`, the patterns' `rectangularRows`/`circularTurns` plus
`splitSkip`, and `torusFrame` serve both; a primitive's frame comes from its
output. Placements are numbers (`placed`, `frameMatrix`, `about` in `ir.ts`),
sizes, distances, angles and factors `ctx.scalar` (through `half`, `negate`,
`absolute`); pattern instances are unrolled. Slice 4a added hooks for Extrude
and Revolve. **A profile becomes 2D nodes from the sketch's own
`detectProfiles`** (`scad-export/profile.ts`, `SketchOutputData.sketch`): a
`polygon(points, paths)` per region (outer loop and holes), a whole-circle
loop a `circle`, lines two points, arcs sampled with
**`CsgContext.fragments(radius)`** (OpenSCAD's `$fa`/`$fs` circle count,
`writeScad` builds it into `ScadSource.fragments`), other curves the detected
polyline. Extrude is a `linear_extrude` per side placed by the sketch frame,
its distances `ctx.scalar` signed with `absolute`/`negate`/`half` and a
`translate`; `through-all` (cut/intersect) reaches past `ctx.bounds()`.
Revolve is a `rotate_extrude` in (radius, axis) with the axis as OpenSCAD's
Z; `flip` reverses the axis; the shared `axisOf` takes a `GeometryReader`. Ranges come from core's `customizerRows` (evaluated, base units; none when a range doesn't evaluate or min > max) and the section from `parameter.group` (ADR-0086). Accepted 2026-10-16; the acceptance tests live in `scad-export/acceptance.test.ts` and the CLI's "AC 5" test (`packages/cli/src/headless.test.ts`). Amendment 2026-10-18: **Export Design as Script…** is a dialog (`export/ExportScriptDialog.tsx`, `ExportScriptForm` for the unit test), TypeScript or OpenSCAD. Rules a change must keep: **the preview text is the exported text** (up to 400 lines in a scrolling box; none while OpenSCAD can't be written; written once, 120 ms after a choice, a superseded result dropped; Export downloads that file, Copy copies all of it, both disabled without one); OpenSCAD writes only while the model is current; the dialog remembers `export.script` (`{ language, resolution, deviation, angle }`, an unknown language is TypeScript); **the shared fields live in `export/exportFields.tsx`** (`BodiesField`, `ResolutionField`, `useBodyRows`, `useChosenBodies`, `useResolutionEvaluate`, `useTessellation`), used by Export Model and Export as script: change a field there, not in a dialog.

ADR-0089 (2026-10-16) added **changelog fragments**: a change describes itself
in its own one-line file under **`docs/changelog.d/`** instead of a line in
`docs/CHANGELOG.md`, so concurrent pull requests never conflict there (they used
to, every PR touching the top of `## Unreleased`). **`scripts/changelog-collect.mjs`**
(`pnpm changelog`, release step) folds the fragments above the lines already
under `## Unreleased` (newest first by the date in the line, ties by file name)
and deletes them; it creates the section above the first `## v` heading when a
release renamed it. **`scripts/check-changelog.mjs`** runs in `pnpm lint` and
CI's check job (`--base "origin/<base_ref>"` on pull requests; the check job's
checkout is `fetch-depth: 0` so the three-dot diff has the merge base).
**Rules a change must keep:** a fragment is `YYYY-MM-DD-<slug>.md` (the date the
change was finished, a kebab-case slug; `README.md` in the folder is the
permanent explainer and is never collected) and its content is exactly one line
matching `- \d{4}-\d{2}-\d{2} · **[^*]+**…` — no heading, no blank lines, no
second paragraph; **a pull request never edits `docs/CHANGELOG.md`** (CI refuses
it; the release commit's rename in `docs/release-checklist.md` step 2 is the one
edit, made after `pnpm changelog`), and a fragment whose line is already in the
changelog is refused, so a folded-in line is not duplicated by re-adding it.

ADR-0090 (P6-10, the owner, 2026-10-17, amended the same day) made **one app menu**:
`apps/web/src/shell/AppMenu.tsx` (the Radix Popover `dialog` "Menu" behind the
four-squares `IconButton` "Menu"; `MenuPanel` is the content, rendered alone by
`AppMenu.test.tsx`), `shell/mouseIcons.tsx` (the preset and ring glyphs), used by
`AppBar.tsx` and `home/HomeScreen.tsx`; `HelpMenu.tsx` is gone and the bar has no Help
button. **Rules a change must keep:** one panel, as wide as its rail (`w-max`, capped at
the window minus 16 px; the columns and the strip are `w-0 min-w-full` so they never
widen it); three bands: the **rail** (`inline-flex gap-3`: the `radiogroup` "Mouse
controls" in the order **Crank, Spindle, Glide, Blender, Slicer, Trackpad** — its own
order, not `NAV_PRESETS`'; Spindle stays the default —, a divider, the three toggles
Auto-project body edges / face outline / Radial right-click menu with `aria-pressed`, a
second divider, the `radiogroup` "Theme"), every rail control with a `Tooltip` (label
"Mouse controls: Crank", hint the preset's `summary` or the toggle's state and Settings
hint); **Slicer is disabled** (`aria-disabled`, still focusable so its tooltip shows) and
is **not a `NavPreset`** until its behaviour lands; **two columns always**, `menu`s "App"
(Search… where commands exist, Settings…, About Extrudo, then Close design on the web /
Quit on the desktop) and "Learn" (**Help for \<tool\>** first, from
`lastHoveredTool()` in `Toolbar.tsx` — the last tile hovered or focused, kept after the
pointer leaves; **F1 (the `help` command) reads the same**, so both name one tool and the
guide opens only before any tile was hovered — and the command label, absent when no
tile was hovered; then User Guide, Tutorial, **Online Tutorials** (the `docsTutorials`
label everywhere), Examples, Tool Reference); the **strip** `[data-update-strip]`
(`data-update-word`: "Update ready: <v>" / "Checking…" / "Up to date" / nothing, from
`UpdateState.waiting` and the new `UpdateState.check` the desktop's `desktopUpdates`
sets; a dot colour plus the word, never colour alone), the version, **Check now**
(desktop only, stays open) and **GitHub**. Rail controls change preferences through
`display.set`, `onThemeChange` and the marking toggle and leave the panel open; an item
closes it and keeps the focus where it went (`onCloseAutoFocus`); Escape returns it to
the Menu button. On open the panel itself takes the focus (no tooltip opens); arrows
move within a group (`rove`, `data-rove`), Tab between groups. The home screen's panel
has no Search…, Close design or Help for \<tool\>. **§2:** Settings gained the sections
**Plugins** (`PluginsSection`; Ctrl+K "Plugins…" and macOS's Plugins… open it,
`SettingsDialog`'s `section` prop) and **Marking menu** (the Radial switch above
`MarkingMenuEditor`; Ctrl+K "Customize Marking Menu…" opens it; on the home screen the
editor is replaced by a line, there are no commands); `PluginsDialog` and the
`CustomizeMarkingMenu` dialog are gone, and General (id `general`, labelled
**Appearance**, summary "Theme.") keeps the theme alone.

ADR-0091 (P6-11, the owner, 2026-10-18) made **a Docker image of the app**, published to
`ghcr.io/<owner>/extrudo`. Files: `Dockerfile` (nginx alpine, `COPY` only, **no `RUN`**),
`.dockerignore`, `docker/nginx/` (`default.conf` by hand; `maps.conf`, `headers.conf`
generated), `docker/compose.yml`, `scripts/nginx-headers.mjs` (+ its test, `pnpm docker:headers`),
`scripts/docker-smoke.sh`, the `docker` jobs in `ci.yml` and `deploy.yml`. **Rules:**
`apps/web/public/_headers` is the only source of the response headers: after changing it run
`pnpm docker:headers` and commit `docker/nginx/` (the test fails otherwise). **No `add_header`
inside a `location`** (it replaces the server-level ones, dropping the security headers): path
rules are `map $uri` entries sent by one `add_header … always`. The Dockerfile has no `RUN`, so
the second architecture needs no emulation; the app is built outside (`pnpm build`), the image
is **the app only**, not the landing page. CI's job builds and smoke-tests, pushes nothing;
deploy's job publishes (`edge`; `X.Y.Z`, `X.Y`, `latest` from `git describe`) and is **not gated
on the Cloudflare secrets**. Pin nginx to a minor, bump by hand.

ADR-0092 (issue #76, 2026-10-18) made **handle drags live**. Files:
`packages/kernel/src/recomputer.ts` (`preview`, `#runPreview`), `apps/web/src/features/dialog.ts`
(`requestPreview`, `shownSequence`, `previewInputs`/`previewOf`, `withGhost`),
`useFeatureDialogs.ts` (`shellParts`, `DialogShell`, `useViewPreview`), `ghost.ts`,
`viewport/Preview.tsx`, `shell/AppShell.tsx` (`DialogViewport`). **Rules:** the `Recomputer`
runs **one preview at a time** and keeps only the newest waiting draft (no trailing debounce;
`previewDelayMs` only while idle); a running preview still answers, `endPreview` drops it. The
dialog **shows an older draft's answer as `pending`** but never one older than it shows; a
dialog with `previewDelay` shows only its current draft's. The shell subscribes to
**`shellParts` (no expressions)**, the view to `previewInputs`; `shown` rules get
**`ShownValues`** (no `exprs`). A handle declares how the ghost follows it: distance arrows
`ghost: 'stretch'` (from the plane at `origin` across `direction`, new ÷ shown, never through
zero) or `'move'`, angle arcs `'turn'`; the dialog keeps the hints of the draft each preview
came from and `ghostMatrix` moves the shown shapes by the change since, **none while invalid or
refused**. Marked: one-side and symmetric extrude distance, box length/width/height/rotation,
cylinder height, primitive X/Y/Offset, Move's free arrows and rotate-mode angle. Not marked
(wrong as a rigid change): two-sided extrude, diameters, Move's free rings. Coarse meshing
while dragging was rejected (saves 4–8 ms of ~34).

ADR-0092 (P6-12, the owner, 2026-10-19) added **Help › Report a Bug…** (command `reportBug`,
before About; the app menu's App column has "Report a bug" before About Extrudo (owner, 2026-10-19); the About
footer's "Report a bug" button (when `onReportBug` is given) closes About and opens the same
dialog): the opener (`AppShell`, `HomeScreen`) captures the screenshot **before** opening, so
the dialog is not in it (the viewport's `snapshot(1600)`; on the desktop
`desktop.capturePage()`, the whole window, falling back to the viewport; the home screen has
only the desktop capture). **Retake** closes the dialog, waits two animation frames, captures
and reopens; the field state lives in `BugReportDialog` (always mounted) and resets only when
the dialog reports closed. `BugReportDialog.tsx` gathers
`systemInfo()`'s "Running on" rows, `BUILD` and the shell's error ring buffer, and drafts the
report. **Rules:** the pure parts (`bugReport.ts`: `buildReport`, `issueFields`, `issueUrl`,
the error buffer, `timelineSummary`) stay DOM-free and tested. **No backend, no token, no
GitHub API call:** "Open GitHub draft" copies the PNG to the clipboard and opens
`ISSUES_URL?template=bug_report.yml&title=…&what=…&steps=…&version=…&browser=…&os=…&console=…`
through `platform.openLink`; the person pastes the image and submits. `issueUrl` keeps the URL
under 8,000 characters by cutting `console`, then `steps`, then `what` (never the others), each
cut ending "… (cut: see the copied report)"; "Copy report" carries the full Markdown. The
report carries the "Running on" rows (not "Memory and storage"), the last 10 error **messages**
(feature errors and uncaught `error`/`unhandledrejection`; **no stack traces**, which name
`file://` paths on the desktop) and, only with the "Include the timeline" box ticked (off by
default), feature names and types. Never file paths, the design's name, parameter values or
the document. The issue form's field ids are an interface: `bugReport.test.ts` reads
`.github/ISSUE_TEMPLATE/bug_report.yml` and checks the ids it uses exist. The prefilled URL is
on the desktop allow-list by its path (`links.test.ts` has a case with a query string).

ADR-0094 (the owner's test, 2026-10-19): **aligned edges infer Collinear**. `AnchorEntities.along`
(`packages/sketch/src/inference/constraints.ts`) names the new lines leaving a placed point along
each axis; `alignmentConstraints(alignments, point, anchor, sketch)` makes an alignment with a
sketch point **Collinear between the new line and the line the source point ends** when both run
along the guide's axis (`lineAlong`: geometry within 1e-6 relative, the source's coincident points
count), and `place` (`packages/sketch/src/build/inference.ts`) then **drops the new line's own
Horizontal/Vertical from the edit** (the Collinear implies it; both would be redundant). Point
pairs stay for a circle centre, a lone point, an arc end, a slanted line's end, or no new
axis-parallel line. **Rules:** only the Rectangle tool's axis-aligned modes pass `along` (edges 0
and 2 horizontal, 1 and 3 vertical at each corner; never the 3-point mode); `alignmentConstraints`
stays pure and the host's test-solve (`SketchSolver.check`) stays. A Horizontal/Vertical **between
two points** (`b` set) shows **one glyph halfway between them** (a point-style anchor, `entity` its
`a`) with the icons `horizontal-points`/`vertical-points` and the label "Horizontal (points)" /
"Vertical (points)"; `glyphFace(c)` in `apps/web/src/sketch/tools/glyphs.ts` is the only place
that picks a glyph's icon and label (`ConstraintGlyphs.tsx` draws `PlacedGlyph.icon`/`label`).
Amendment 2026-10-20: a pair anchor carries a `normal` (up for level, right for plumb) and `pair: true`;
`layoutGlyphs(anchors, project, curves)` takes the normal's side unless a curve from `glyphCurves(sketch)`
(non-point entities, construction lines in, datum axes out) is closer than `GLYPH_SIZE / 2 + 2` px and the
other side is clearer; a pair has its own row key `m:<midpoint>`; other glyphs place as before.
ADR-0093 (issue #61, 2026-10-19) lets **the dimension and constraint tools pick the origin and
axes**. Files: `packages/core/src/sketch/projection.ts` (`PROJECTABLE`, `DATUM_SPAN`,
`isDatumRef`, `syncProjections`' construction flag), `sketch/schema.ts` (`PROJECTABLE`,
`POINT_SOURCES`), `packages/kernel/src/features/sketch.ts` (`projectSource`, `SOURCE_NOUN`),
`features/projection.ts` (`projectAxis`), `apps/web/src/sketch/datums.ts` (`datumSnapsAt`),
`sketch/tools/host.ts` (`pickModel`, `datumsAt`, `pickSketch`, `PlanePointer.frame`),
`tools/tool.ts` (`modelStandIn`), `tools/dimension.ts` (`#pickAt`),
`@extrudo/sketch/inference` (`ModelSnapKind`, `isPointSnap`). **Rules:** a projection's `ref` may
be kind `axis` or `point` in `project` mode only (never `intersect`); the kernel projects a point
to key `point`, an axis to a **`DATUM_SPAN` (100 mm) line keyed `axis` centred on the projection
of the axis's origin**, or to key `point` when it runs along the normal (|cos| ≥ `PARALLEL`); the
web stand-in must match that line exactly. Curves of `axis`/`point` projections are added
**construction** (never split a profile); edge/face curves stay as before. A `ModelSnap`'s
`kind` is also its projection's curve key (`vertex`, `edge`, `point`, `axis`), so the host
looks curves up by `kind`, and point kinds (`isPointSnap`) make `coincident`, the others
`pointOnCurve`. `pickModel` order: the sketch's own geometry, datum points, **body vertices**,
datum axes, body edges (a vertex on an axis stays a vertex: this refines the ADR's "datums
before body geometry"); datums come with auto-project off too, never when the browser's eye
hides them (`viewport.origin`), and are measured against the infinite axis. A projected axis's
line **gives way to a datum point** under the pointer (`pickSketch`), so the origin stays
pickable after an axis was projected. Datums reach only the picking tools (`pickModel`), not
the drawing tools' inference. In Dimension, after a sketch line a datum point or a **parallel** datum
axis is the second pick (projected or not); an axis **across** the line, body edges and vertices
there still place the length (a centred line's label lands on the other axis: this narrows the
ADR's §4, which also took a crossing axis for an angle; pick the axis first for that). The frame comes from the
pointer (`PlanePointer.frame`, set by the view), falling back to the origin plane's
(`planeFrame`) in tests. Slice 2 adds construction axes and points (`lineOf`/`pointOf` already
resolve them in the kernel): the host takes a `constructionDatums` getter (`DatumSource`s, read
from current state at every pick), and `constructionDatumSources` in `datums.ts` offers only the
features **before the active sketch in the timeline**, before the marker, not suppressed and
shown, whose report is an axis or a point — a later one would make the sketch depend on a later
feature. Owner's test (2026-10-19): a datum **axis** with a parallel line or a point commits at
the second pick (`DimensionTool.#datumCursor`; label via `lineAxisCursor`/`pointAxisCursor` in
`dimensionLayout.ts`), with no placement click; origin/datum points and angles keep it.
`sketchSegments` skips the entities of datum projections (and their points) unless `datums`
(`curveSegments`, the hover/selection overlay, passes it). In the constraint tools
(`tools/constrain.ts`), an axis has no length or middle: **Equal, Midpoint and
Horizontal/Vertical refuse a datum axis line** — a fresh `kind: 'axis'` model pick or a sketch
line that is a datum projection's curve (`isDatumLine`, `NO_DATUM_LINE`), on all three `#pickAt`
paths — with the message "An axis has no length or middle; pick a sketch line." through the
`SketchEdit.error` path; the origin point is still accepted by all of them, and Collinear,
Perpendicular, Symmetric and Tangent take an axis line.
A line's distance to an axis hangs on the line: `distanceEnds` runs from the sketch line's middle to its foot on the axis whichever was picked first (an axis's middle is arbitrary). The Dimension tool keeps the hovered pick visible: with a line picked, `preview()` hides the length dimension while a second pick is under the cursor (`tools/dimension.ts`). A fresh axis pick counts as a datum in the tool's view: `DimensionTool.#view` adds a stand-in projection (`view:<pick id>` → `{ ref, curves: { axis } }`) for a synthetic line pick whose model is a datum, so its stand-in line is treated like the stored axis (anchor, measure) and the label placed for it stays put once the axis is stored; the host's pending-dimension re-measure keeps `projections` in its view for the same reason (`tools/host.ts` `resolveEdit`). A stored datum axis line is never drawn as a segment, even highlighted: `EntityHighlight` skips `isDatumLine(sketch, id)` (core, `dimensions.ts`) and `curveSegments` hides datum lines; Dimension and Constraint tools show the fresh-axis marker instead (`storedDatumMarker` in `tools/tool.ts`, `Pick.marker` → `modelHover`/`modelPicked`); the origin keeps its point highlight.

ADR-0095 (2026-10-20) keeps **hidden and ghost bodies out of an extrude's or revolve's
automatic join, cut and intersect** without teaching the kernel about visibility.
`operate()` (`packages/kernel/src/features/operation.ts`) **always reports**
`OperationReport.touching` (the bodies the tool touches; `[]` for a new body, and for
picked bodies cut or intersected, which skips the distance query); extrude and revolve
pass it as `FeatureOutput.report`, `PreviewResult.operation` carries it, and
`dialog.ts` keeps it in `DialogPreview.operation` and gives it to `propose`/`validate` as
`DialogContext.draftOperation`; a preview whose report differs re-runs `refresh` once.
`apps/web/src/features/operationBodies.ts` (`proposeBodies`, `proposeWithBodies`,
`allHidden`) is shared by extrude and revolve. **Rules:** the kernel stays visibility-blind
(an eye toggle never changes a recompute); the proposal never overrides a chosen pick
(`chosen('operation')` decides which operation it reads; an edited feature that stores
picks proposes nothing); with a hidden body among `touching` and at least one shown, it
proposes the shown ones; otherwise it proposes "automatic" (`bodies: []`) **only when the
current pick is non-empty**, else `undefined` (`changedFields` compares by JSON, and
`undefined` against `[]` would count as a change, marking an edited feature's empty pick
as chosen); an empty `touching` proposes nothing; `validate` refuses (field `bodies`)
when the operation isn't a new body, the pick is empty and every touching body is hidden.
A ghost is stored with `visible: false`, so it counts as hidden.

ADR-0096 (2026-10-20, #77) adds **parameter name completion to `<ExpressionInput>`**.
`ExpressionNamesProvider` (`apps/web/src/parameters/expressionNames.tsx`) wraps `AppShell`
and provides a getter of the document's parameters (name, `formatQuantity` value),
cached per document; `completion.ts` has `wordAt` (the identifier around the caret, none
inside a number or in a unit's place after one) and `matching` (contains, ignoring case:
exact, then prefix, then the rest, in document order). **Rules:** a field filters names by
**its own `evaluate`**: offered unless `evaluate(name)` fails with `ExprError.code`
`'unknown-name'` or `'cycle'` (a unit mismatch stays in scope), cached per name per focus;
keep those codes on the evaluator's "Unknown name" and the graph's "refers to itself"
errors; no call site passes names. No list opens by typing when its only entry is the
word itself (it would cover the dialog's OK button; B5's `2 * py`). Enter without an arrow pick commits as before; Tab
inserts the pick or the first name (not when nothing is picked and the word is already the
first name); Esc closes the list before it reverts the field, and is stopped there;
Ctrl+Space opens the list on an empty word. The list is a Radix Popover (portalled,
`role="listbox"` named `Parameters for <label>`, options `role="option"` with
`aria-selected`, `onEscapeKeyDown` prevented, no auto focus); the field keeps the
`textbox` role with `aria-autocomplete`, `aria-controls`, `aria-activedescendant`, and
`data-keep-escape` while the list is open.

ADR-0099 (2026-10-23, #78, P4-13) adds **Remove Faces** (`removeFaces`,
`packages/core/src/remove-faces.ts`, evaluator `packages/kernel/src/features/remove-faces.ts`,
facade `removeFaces` with `BRepAlgoAPI_Defeaturing`). Rules: **all or nothing** (any
"unable to remove" warning refuses the step; never a partial removal); the result is one valid
solid that differs from the input; **no `UnifySameDomain`** after it (it renames faces);
removed faces' names are gone (a later reference is a `LostReferenceError`), **extended
neighbours keep their names** (history `modified`); a pick of every face is refused before OCCT
runs. Picks (`removeFacesPick`, TypeScript over the shape description, `threadFace` and
`coneFace`; no facade query): a hole wall takes the coaxial faces within the hole's radius
(bottom, counterbore, countersink, drill point; **the amendment, 2026-10-23: two passes**, the
faces on the axis connected to the wall, then the radius from every inside cylinder or cone among
them, so a click on a counterbore's narrow wall takes the step and the wide wall; pure function
`removeFacesPick(starts, description, surface, chain)`, tested without WASM), a round takes its smooth chain through
non-planar faces only, anything else is itself; the feature stores the faces it got. Delete on
a selection of only solid-body faces makes the feature in one step (`Remove Faces N`). The
refusal names how many faces to add (unpicked faces of the failed faces' chains or holes).
`.f3d` face deletions map to it (ADR-0083's amendment; `map.ts` `deleteFaces`, all faces named or the deletion is skipped; a deletion the kernel refuses stays in the timeline as an errored feature). Facade `removeFaces(shape)` takes the faces
by `pushArg`, works on a copy and on refusal lists the failed features' faces (0-based) in the
lookup buffer (`RemoveFacesError.failed`); the evaluator refuses an empty pick and a pick of
every face before OCCT runs. The engine's `removeFacesPick(body, faces, base)` goes through the
service, `KernelApi` and `Recomputer` like `smoothFaces`. The dialog is
`apps/web/src/features/remove-faces.ts` (Solid › Modify, after Offset Face; the tile in
`apps/web/src/shell/tools.ts` with search words "defeature", "delete face", "remove fillet",
"remove hole", "simplify"): one multi-pick face field whose **`pick: 'removeFaces'` option**
(`apps/web/src/features/spec.ts`) routes its picks through `removeFacesPick` the way
`keepRounds` routes through `smoothFaces` — a field's value is the union, without duplicates,
and its info line counts what the pick holds. Delete's face path is `createFaceActions` in
`apps/web/src/shell/bodies.ts` beside `createBodyActions` (sketch mode refuses like deleting a
body; the removed faces leave the selection and the hover); mesh bodies' faces never apply. The
tooltip clip's scene starts from `fixtures/demos/removeFaces.extrudo`
(`packages/cli/src/demo-designs.test.ts`).

ADR-0100 (P6-13, the owner, 2026-10-23) set **performance budgets for the main
thread and the guardrails that keep them**. `e2e/perf.spec.ts` drives the
pcb-enclosure (B5) and knurled-knob (B7) examples through opening, orbiting, a
parameter edit and its undo, and the first hover and click, with a
`PerformanceObserver` (`longtask`; `event` with `durationThreshold: 16`) and a
`requestAnimationFrame` counter installed by `page.addInitScript`, and asserts
ADR-0100's budgets, attaching the raw numbers (and the WebGL renderer string)
to the report as `perf.json`; an edit's round trip is one `MutationObserver`
over both `[data-model-status]` and `[data-bodies]`, armed **before** the edit
(the expression field applies while typing). §4 (2026-10-23, after CI's SwiftShader run measured the rasteriser, not the
app — a CPU profile shows a SwiftShader frame's long task is 97 %+ native
GPU-process wait) moved the budgets onto the **app's own main-thread time**:
`RenderMeterProbe` (`apps/web/src/viewport/Viewport.tsx`) pushes every render
call's `{ start, ms }` into `window.__extrudoRenderLog` when that array
exists — the spec's init script sets it, a normal visit never does — and
`e2e/perf.spec.ts` computes per long task the **JS time inside it**: the
merged union of the `long-animation-frame` observer's script durations (the
frame's JS: module evaluation, worker message handlers, rAF callbacks,
timers), the render log and the event handlers' own spans
(`processingStart…processingEnd`), budgeted as `appMax`/`appTotal`
(`longMax`/`longTotal` and the window's `renderTotal`/`jsTotal` kept for the
record); the round trips subtract their window's JS total (`roundTripAppMs`);
the worst input event is the one with the largest handler time, budgeted
instead of the paint-inflated duration; the fps floor (≥ 20) only holds with
a GPU — on a renderer string containing `SwiftShader` or `llvmpipe` the spec
records the fps and skips it with a `software rendering` annotation. The spec
no longer runs serially (both examples report even when one fails).
Development builds count long tasks:
`apps/web/src/debug/longTasks.ts` (`startLongTaskObserver`), the viewport
store's `longTaskCount`/`noteLongTask`/`resetLongTasks`, `formatLongTasks` in
`viewport/renderMeter.ts` shown by `RenderRate` (`shell/Timeline.tsx`,
`· n long`), started and reset in `project/ProjectPage.tsx`.
`scripts/measure-startup.mjs` opens the folded template gallery and writes
`--json`; the release checklist runs it (step 3). Files also:
`e2e/timings.json`, `docs/release-checklist.md`.
**Rules:** the budgets live in `e2e/perf.spec.ts` and are widened only with a
measurement in the commit message, and they bind the app's own main-thread
time (ADR-0100 §4): the JS inside each long task (LoAF scripts ∪ render log ∪
event-handler spans, merged), an input event's handler time instead of its
duration — sizes: open appMax < 400 and appTotal < 1200, orbit appMax < 100,
**edit appMax < 500** (widened from §1's 150 against the measured 248–499 ms
grooves-edit kernel-message/autosave handlers), undo appMax < 150, hover and
click worst handler time < 250; `__extrudoRenderLog` must be set only by the spec's init script — a
normal visit never logs renders; the fps floor is skipped only when the
renderer string says software (the annotation names it). The long-task
observer never ships in
production — dev builds only (`import.meta.env.DEV`), and `grep -c longtask
apps/web/dist/assets/*.js` after `pnpm build` must sum to 0 — and the status
bar's `· n long` is dev builds only; `measure-startup.mjs` runs per release
and is compared with the ADR's baseline: a jump is a release blocker to
investigate, a drift is noted in the release notes.
