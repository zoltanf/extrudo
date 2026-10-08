# Extrudo — agent context

Open-source, browser-based parametric CAD for the 3D-printing community, with a
Fusion 360-style workflow (sketch → features → timeline, parameters everywhere)
and a playful modern UI. Web first (PWA). An Electron desktop build comes later
from the same codebase.

**Repo:** <https://github.com/zoltanf/extrudo>. **Public** since 2026-10-04
(P3-15 prepared it; `docs/release-checklist.md` lists the owner's remaining
steps). CI runs on every push and pull request, on GitHub-hosted runners (a
self-hosted backup exists, off by default: `docs/deploy.md`).

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
ADR-0074) are done; P6-04 (i18n), P6-05 (components) and P6-06 (docs site,
tutorials) are open.
ADR-0001 chose
our own trimmed libcascade build with a small C++ facade that owns OCCT memory
(`docs/adr/0001-geometry-kernel.md`); P0-09 built it in `packages/kernel`
(facade, TS `Kernel`, worker, `KernelClient` with crash restart, memory test,
debug page at `#/debug/kernel`). ADR-0002 chose planegcs from our own WASM
build, one solver system per independent sketch component
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
controller (target + quaternion + size, both projections), mouse presets as
tables, shader grid, CSS 3D ViewCube, a viewport store with display settings
as preferences. ADR-0009 (P0-08) set storage (`packages/storage`):
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
theme) and drives the shortcuts, the Ctrl+K palette and the S toolbox
(`shell/CommandSearch.tsx` on the design system's `FloatingDialog`;
fuzzy scorer in `commands/search.ts`; pins in the `toolbox.pins`
preference). A new command goes in `buildCommands`. ADR-0024 (P2-01) added
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
fingerprint with a warning, else an error); `KernelApi.reference` turns a
pick into a `GeomRef` with a fingerprint. ADR-0027 (P2-05) added feature
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
(`viewport/silhouette.ts`). ADR-0031 (P2-09) added sketches on flat
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
takes `{ id, name, color? }` (`StepBody`). `@extrudo/io` has
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
Closest Match. ADR-0035 (P2-13) added measuring: `KernelApi.inspect(targets)`
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
binding list is now just `ExtrudoFacade` (built by CI: WASM 20.57 MB raw,
6.66 MB gzip, 4.63 MB brotli (Node's zlib at its best settings), after
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
raw, +1.3 kB brotli, 20.57 / 6.66 / 4.63 MB unchanged); the 15.76 MB / 3.69 MB brotli
of ADR-0037 was P2-15's; OCCT input hash
`ec62df7eead4` (release `occt-ec62df7eead4`); **don't
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
typing only (`e2e/fillet.spec.ts` covers Shift+4).
ADR-0041 (P3-16) added the notification history: the toasts'
store (`design-system/notifications.ts`, vanilla Zustand, `useToasts()`
returns it as `notifications`) records every `push` for the session
(repeats merged with a count, at most 100), the bell button below the
toasts (`NotificationHistory.tsx`, drawn once something was notified) and
the command "Notification History" open a popover with errors grouped on
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
No facade change. **2026-10-07 addendum**: `tangentPlane`'s `point` on a cone is the exact foot on the nearest generatrix (the apex past it; a point on the axis warns and follows the angle), and `pointAtIntersection` takes an edge and a **curved** face (`edgeMeetsFace`, closest points within 1 µm); a point where two curved faces and a plane meet stays open (it needs a face-face section the facade lacks).
ADR-0042 (P3-11) added the right-click marking menu:
`design-system/MarkingMenu.tsx` draws eight wedges and a list (pure
geometry in `marking.ts`); **a wedge is a command ID** in the two tables in
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
`shell/CustomizeMarkingMenu.tsx` (a ring per mode, a wedge opens the mode's
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
(`faceDirections`; flat faces and a straight edge only, else the single
bisector arrow; ADR-0043's second amendment), and a distance-and-angle set's
**Angle** an arc from the reference face's direction towards the other face's
about the edge (`cross(first, second)` signed so that turn is positive; its
head sits on the chamfer face; none where the directions can't be read;
ADR-0043's third amendment)). The Chamfer tile has no default key.
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
on); the grid, origin and sketches stay unclipped; the cut is capped per
body by the stencil method in `viewport/SectionCap.tsx` (the canvas asks
for `stencil: true`), tinted through `capColors`. **`pick.ts` skips what
is clipped and treats what lies behind a cap as occluded** (`capDepth`),
so a new pick path must go through `pickStack`/`pickBox`. The tool is
Inspect › Inspect › Section Analysis (ADR-0079; `Shift+S`, session tool `section`,
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
longer refused when it is **flat, its other edges meet their neighbours square
and it touches no other removed face** (`openingRoute`, `pluggable`): the body
is hollowed closed and the opening cut as a **plug** (`buildPlugged`: the
face's prism in common with the cavity moved out by two walls; history through
`recordPlugged`, the plug's faces are the rim). The old refusal's heap trap
didn't reproduce in about 3,000 unguarded builds (mimalloc `-O3` and
`emmalloc-memvalidate` too); OCCT simply never builds those openings, so
the faces plugs can't open stay refused (status 6). Native harness:
`spikes/p4-12-shell-faces/` (`run.sh`, `run.sh sweep`, `run.sh sweep2`).
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
them whichever face is offset, even the floor).
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
card, Help › Tutorial and the Ctrl+K command `tutorial` start it (a design
with features gets a new one: `FileActions.startTutorial`, `requestTutorial`
taken once by `useTutorial`); the `onboarding.tour` preference (`new` shows
the home card, `started`, `dismissed`, `done`) is all it remembers.
`ViewportHint` points at Create Sketch while `doc.features` is empty. **The
home screen's gallery is `home/gallery.ts`** (the Wall bracket from code, B2,
B4, B5 from `fixtures/benchmarks/*.extrudo` as hashed assets through
`readArchive`, so migrations apply and they are precached; each opens as a copy
under a new ID with its checked-in `home/templates/*.png` as thumbnail).
**Tooltips take a `demo` slot** (`ToolDemo`, a muted looping `<video>` of
`public/demos/<toolId>.webm`, rendered only while the tooltip is open, a still
under reduced motion, removed on a load error); **demos are not precached**
(`SKIPPED` in `precache-plugin.ts`, and `sw.js` leaves `/demos/` to the
network); `DEMO_TOOLS` in `demos.ts` lists the thirteen that have one and
`demos.test.ts` checks it against the files (150 kB each). **`pnpm demos`**
(`scripts/record-demos.mjs` → `e2e/record-assets.spec.ts`, which skips itself
without `RECORD_ASSETS=1`) records the clips and the template pictures through
the real app: a screenshot loop (`e2e/demo-recorder.ts`) piped into Playwright's
own ffmpeg (`playwright install ffmpeg`: MJPEG in, VP8 out, `crop`/`scale`
filters), a drawn cursor in the page.
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
a Clear button each. **Every parameter write goes through the shell's `apply`**,
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
"Save to Linked Folder" (Home › Files tile, Ctrl+K) links an unlinked one, refusing a
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
mesh to the map and a shape to OCCT). `meshFrom(mesh)` welds the corners
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
file is a bug (`docs.test.ts` fails on one). Since ADR-0080 the build serves `/docs/` from `docs/guide/` through collections (`COLLECTIONS` in `docs.ts`, the deepest folder wins; the API's addresses unchanged).

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
`ToolbarProps.hidden` show one at a time) and `exportScript` (Home › Files, Ctrl+K)
are in `AppShell.run`/`buildCommands`. **Stop** emits through a lazy `@extrudo/api`
import (the web app depends on it only for this) and opens `MacroDialog` (region
"Macro", code in `CodeView`, `scriptEditor.tsx`'s read-only editor). **Replace is
one transaction** (insert the Script at the first recorded feature, then
`removeFeature` last to first, `cancelTransaction` and the reason on any
`CommandError`); **Keep both** appends the Script suppressed. A feature using a
recorded one is always inside the run, so only an expression outside it (a user
parameter reading a recorded sketch's `d1`) refuses a Replace in the UI.

ADR-0074 (P6-07) added **auto-project** (Fusion's "auto project edges on
reference"): while a drawing, constraint or dimension tool runs, the view
offers the shown bodies' edges and vertices under the pointer behind the
sketch's own geometry (`apps/web/src/sketch/autoProject.ts`'s `modelSnapAt`
through `pickStack` with an edges-and-vertices filter, a vertex before an
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
index only) and written back through paths main issued this session
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
AppImage + deb, NSIS, dmg + zip, `extrudo-<version>-<os>-<arch>.<ext>`, asar with
nothing unpacked) and `.github/workflows/desktop.yml` (a `v*` tag or a manual
run, never per push: three OS runners; a tag attaches the installers to a
**draft** release; the Linux job smoke-tests the AppImage with `smoke.mjs --app`,
`EXTRUDO_USER_DATA` being main's throwaway data directory). Rules a change must
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
(`process.env.APPIMAGE`) and NSIS download and install on quit**, **a deb and
macOS only `notify`** (version + the release page main builds from the tag;
never `downloadUpdate`/`quitAndInstall`). Status goes over `update:status`;
`update:check`, `update:apply` (refused unless `ready`) and `update:release`
(main opens **its own** URL) take no argument. Help › Check for Updates… is
main's (`menuTemplate.ts`, disabled where the updater isn't running) and a
manual check within a minute answers "Extrudo is up to date.". On the renderer
side **`Platform.updates?: PlatformUpdates`** (`store` with `waiting`/`version`,
`apply()`, `action`) is the web's update-toast seam: `webPlatform()` sets
`appUpdates`, `useUpdateNotice(push, platform)` reads it, and the desktop's
`renderer/updates.ts` follows `update:status` (Restart, the notify toast once
per version, a quiet error). The `desktop` workflow uploads `latest*.yml`.
**The Homebrew cask (P6-01's amendment, 2026-10-07)**: on a tag the `desktop`
workflow's `homebrew` job renders `apps/desktop/homebrew/extrudo.rb.template`
from the arm64 mac zip with `render.mjs` and pushes `Casks/extrudo.rb` to the
`zoltanf/homebrew-extrudo` tap (`HOMEBREW_TAP_TOKEN`, skipped cleanly without
it), which is macOS's install and update path since the updater only notifies
there.

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
as data). The **Plugins dialog** (`apps/web/src/plugins/PluginsDialog.tsx`, the
`dialog` "Plugins", command `plugins` "Plugins…" in File and Ctrl+K; session state
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
**Home** tab's tiles (Design, Versions, Files with Import / Import Drawing / Canvas /
Export Design / Export Model / Export as Script ▾ Import .extrudo, Save to Linked
Folder, Parameters with Customizer, Extend with Plugins); the tabs are **Home, Solid
(Create, Primitives, Features, Pattern, Program), Modify (Modify, Transform), Construct
(Planes, Axes, Points), Inspect, 3D Print** in the model and **Home, Sketch, 3D Print**
in a sketch (`visibleTabs`, `defaultTab`, `tabOfTool` in `shell/tools.ts`); there is no
Insert tab. **Home's file actions are commands, not tools**: `TOOLS` lists them (category
`file`, token `--x-cat-file`, nine new icons) and `FILE_COMMANDS` names the
`FileActions` method each runs (`AppShell.run` for a tile, `fileCommand` in
`buildCommands`), with the old command IDs; an absent method hides the tile and the
command. Command groups follow the tabs ("Home › Files"), and the **desktop menu maps
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
viewport store, Customize Marking Menu… — and Theme; the bar's theme button is gone,
`ThemeMenu` remains on the home screen), the cluster is **Undo, Redo, Toolbox, Search**
(Toolbox opens the S toolbox at the button: `onSearch('toolbox', at)`), the right side is
Version history, Settings, Help, and the name plus the save dot are one `TitleGroup`
centred between the cluster and Version history; the pure `titleFit`
(`shell/titleFit.ts`) drops the save word first (`data-title-fit="dot"`), then truncates
the name (`truncate`, `title` = full name). The separator after the cluster is gone. **Tiles first**: Home › Files has no fixed `more` (Import Design, Import Model — `importBody`, full label "Import STEP, mesh or OpenSCAD…" —, Import Drawing, Canvas, Export Design, Export Model, Export as Script, Save to Linked Folder), Construct › Planes shows all seven planes as tiles, and tile text is `short` on one line (never truncated).

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
the pages are stale.

Next (tasks may run in parallel on separate branches and worktrees, merged to
main one at a time): Phases 0, 1, 2, 3 and 5 are complete, Phase 4 is complete
apart from **P4-12's remaining backlog** (the items `docs/03-roadmap.md` still
lists as open: a chamfer's handles on curved faces or edges, shell openings
through curved faces, a point where two curved faces and a plane meet, and the
rest), and Phase 6 has P6-04 (i18n), P6-05 (components) and P6-06 (docs site,
tutorials) left. **P6-04 and P6-06 wait for the owner's walk through the UI**
(owner, 2026-10-07). The repository is public (2026-10-04); the first public
release is **v0.4.0** (no v0.3.0 tag): the owner does the slicer check and a
fresh look on edge, the agent then bumps the versions to 0.4.0, and **the owner
tags** (`docs/release-checklist.md`; don't tag yourself).

## Commands

```sh
pnpm install      # after pulling
pnpm dev          # app at http://localhost:5173
pnpm check        # typecheck + Biome + package boundaries + license allow-list + Vitest. Must pass.
pnpm e2e          # build + Playwright (run `pnpm e2e:install` once)
pnpm format       # Biome auto-fix
pnpm wasm         # download the OCCT, planegcs and OpenSCAD WASM for the current inputs (check/dev/build do this)
pnpm occt build   # build OCCT locally with Docker (~11 min; Arch workstation only); see packages/kernel/occt/README.md
pnpm planegcs build  # build planegcs locally with Docker (~2 min; Arch workstation only); see packages/sketch/planegcs/README.md
pnpm openscad build  # download OpenSCAD's pinned WASM snapshot into packages/openscad/dist (ADR-0071; no Docker)
pnpm api:generate   # rewrite @extrudo/api's generated methods and docs/api pages (ADR-0068)
pnpm docs:generate  # rewrite docs/guide/tools/ from the app's tool list (ADR-0080, P6-06 S2)
pnpm extrudo        # the headless CLI: info, export, set, check (ADR-0069); `pnpm extrudo --help`
pnpm --filter @extrudo/desktop dev     # the Electron app, renderer with HMR (ADR-0075)
pnpm --filter @extrudo/desktop build   # main + preload + renderer into apps/desktop/out
pnpm --filter @extrudo/desktop package   # build + electron-builder for this OS, unsigned, into apps/desktop/release (docs/desktop.md)
```

Package dependency rules live in `scripts/check-boundaries.mjs` (run by
`pnpm lint`). Add every new workspace package there. `packages/io` is MIT and
must never depend on the GPL packages.

## Read first

| Doc | What |
|---|---|
| `docs/01-requirements.md` | Vision, principles, functional requirements (IDs like FR-SK-07), NFRs, benchmark models B1–B10 |
| `docs/02-architecture.md` | Stack, package layout, document model, kernel worker, topological naming, storage, file format, testing |
| `docs/03-roadmap.md` | Phases, tasks with acceptance criteria, risks, open decisions. **Tick tasks here.** |
| `docs/04-ui-spec.md` | Layout, interactions, sketch mode, shortcuts, error-message style |
| `docs/05-brand.md` | Logo, colour tokens (Slate dark default + light), type, icon brief, voice. Logo SVGs in `docs/brand/` |
| `docs/file-format.md` | The `.extrudo` file and document JSON, field by field, with an example; a test (`packages/storage/src/file-format-doc.test.ts`) fails when the schema gets a key the doc lacks. **Update it with any schema change.** |
| `docs/deploy.md`, `docs/release-checklist.md` | How the site is deployed (the owner's one-time Cloudflare steps) and the owner's checklist for the v0.4.0 release |
| `docs/references.md` | Other open-source projects we looked at, what to borrow from each, and their licenses |
| `docs/adr/` | Architecture decision records. ADR-0001: geometry kernel (libcascade). ADR-0002: sketch solver (planegcs). ADR-0003: document model, commands and undo. ADR-0004: expressions, units and parameters. ADR-0007: design system and shell. ADR-0008: viewport, camera and navigation. ADR-0009: project storage, autosave, home screen. ADR-0010: sketch data model and sketch mode. ADR-0011: sketch solver adapter. ADR-0012: sketch tool framework and inference. ADR-0013: basic drawing tools, tangent arcs, construction. ADR-0014: polygons, slots, ellipses, fit-point splines, lazy tool chunk. ADR-0015: constraint tools, glyphs, deleting constraints. ADR-0016: sketch dimensions, dimension parameters, re-solving on value changes. ADR-0017: constraint status, colours, over-constraint dialog. ADR-0018: selection, dragging and deleting in sketch mode. ADR-0019: sketch modify tools. ADR-0020: sketch profile detection. ADR-0021: timeline and browser menus, rename, visibility, hover. ADR-0022: sketch export to SVG and DXF. ADR-0023: command search, keymap and shortcuts. ADR-0024: recompute engine. ADR-0025: sketch to kernel, profile faces. ADR-0005: topological naming. ADR-0026: B-rep rendering and 3D selection. ADR-0027: feature dialog framework. ADR-0028: extrude. ADR-0029: revolve. ADR-0030: bodies. ADR-0031: sketch on face and Project. ADR-0032: primitives. ADR-0033: timeline v2, reorder, fix references. ADR-0034: STL, 3MF and STEP export. ADR-0035: measure and inspect. ADR-0036: version history. ADR-0037: WASM size, startup and the offline precache. ADR-0038: fillet. ADR-0039: benchmarks B2 and B3, fixtures, B4 to B7, B8 to B10. ADR-0040: construction geometry. ADR-0041: notification history. ADR-0042: marking menu and context menus. ADR-0043: chamfer. ADR-0044: combine, move/copy, mirror. ADR-0045: section analysis. ADR-0046: shell. ADR-0047: patterns. ADR-0048: 3D-print aids. ADR-0049: hole. ADR-0050: hardening (fuzzing, lenient reading, version locks, chunked export, NFR-01 numbers, axe). ADR-0051: press/pull, offset face. ADR-0052: onboarding (tutorial, templates, hint, tooltip demos). ADR-0053: split body, scale, draft, benchmark B6. ADR-0054: public release (Cloudflare Pages, headers and CSP, deploy workflow, update toast, community files, audit). ADR-0055: sweep, loft and coil. ADR-0056: modeled threads. ADR-0057: landing page at extrudo.org, the app at app. (stable) and edge. (latest). ADR-0058: sketch text. ADR-0059: customizer and configurations. ADR-0060: emboss and deboss. ADR-0061: user fonts as attachments. ADR-0062: print tolerance and slicer hand-off. ADR-0063: control-point splines and conics. ADR-0064: rib and variable-radius fillet. ADR-0065: timeline groups and linked folders. ADR-0066: import (drawings, STEP, meshes) and canvas images (0006 is reserved). ADR-0067: hardening before Phase 5 (no 'unsafe-eval', threads, mass properties, heap growth, sweep placement). ADR-0068: the public document API (`@extrudo/api`). ADR-0069: the headless CLI (`extrudo`). ADR-0070: the Script feature (QuickJS sandbox, `@extrudo/script`). ADR-0071: OpenSCAD import (`.scad` attachments as mesh bodies, `@extrudo/openscad`, async preparation and runtime WASM caching). ADR-0072: wall-thickness check. ADR-0073: macro recording (the document-to-script emitter, `@extrudo/api`; Record, Stop and the Macro dialog in the app). ADR-0074: auto-project (a body edge or vertex a sketch tool snaps to is projected into the sketch on the fly; `viewport.autoProject`/`autoProjectFace`; its amendment, 2026-10-06, has the constraint and dimension tools pick body geometry directly; its 2026-10-07 amendment pins a pending to its own undo step, refuses curved edges to picking tools and revives a deleted projection). ADR-0076: WebGL fallback (software rendering notice, no-WebGL panel, error boundaries, context loss, desktop SwiftShader switch). ADR-0075: the Electron desktop app (electron-vite main/preload/renderer built from the web app's own source; the `@extrudo/storage/node` store; `desktopPlatform` through one typed preload bridge, `shared/ipc.ts`; slice 2 adds the native menus from the command registry, the `.extrudo` association and recent files; slice 3 unsigned installers; slice 4 auto-update through `electron-updater` and `Platform.updates`) ADR-0077: the plugin API (`.extrudo-plugin` files: a strict manifest and one module; the `plugin` feature with `in:<name>` inputs, expanded like a Script through `ScriptHost.runPlugin`; the design carries the plugin as an attachment; slice 2 the installed plugins (`PluginStore`, the Plugins dialog) and commands run in the worker; slice 3 the generated dialogs, the Create menu's Plugins items, Update to <version>). ADR-0078: model progress notice and the model cache (pending body rows before the first recompute). ADR-0079: one top bar with the tabs, a Home tab instead of the File menu, toolbars that fit the window (the pure `fitToolbar`). ADR-0080: docs site, tutorials and examples (collections under `/docs/`, one sidebar, asset emission, generated tool pages, examples registry, tutorials as e2e specs). |

## Stack summary

TypeScript strict · pnpm monorepo · Vite · React 19 · Radix + Tailwind v4 ·
Zustand + Immer · Zod · three.js via @react-three/fiber + drei ·
OCCT WASM (`libcascade`) in a Web Worker via Comlink · planegcs sketch solver ·
Vitest + Playwright · Biome. Desktop later: Electron.

## Hard rules

- **The document is JSON; geometry is derived.** Never store kernel shapes as
  the source of truth.
- **Every document change goes through a command** (undoable). No direct store
  mutation from components. Recipes are deterministic: create IDs with
  `newId()` in the caller and pass them in the payload.
- **The kernel runs only in the worker.** The UI thread never calls OCCT.
- **OCCT objects must be disposed of** (disposal scope / `using`). Leaks are bugs.
  With libcascade, `delete()` from JS often doesn't free what the C++ object
  owns, so heavy OCCT work goes through our C++ facade (ADR-0001). When using
  raw bindings, call `Clear()` before `delete()` on every `BRepAlgoAPI_*`.
- **Face and edge references use the topological-naming service**, never raw
  indices.
- **Platform APIs** (files, storage, dialogs, slicer launch) go through
  `apps/web/src/platform/` interfaces. This keeps the Electron port cheap.
- **Every numeric input is an `<ExpressionInput>`** (expressions and
  parameters, with units).
- **Fusion 360 is a conceptual reference only.** Never copy its code, icons,
  images, text or branding.
- `packages/core` has no DOM and no WASM. `packages/kernel` and
  `packages/sketch` must run in Node (for tests and the CLI).

## Workflow per task

1. Take the next unchecked roadmap task whose dependencies are done.
2. Implement it with tests. `pnpm check` must pass, plus `pnpm e2e` if UI flows
   changed.
3. Tick the task in the roadmap, add a line to `docs/CHANGELOG.md`, and write
   an ADR for any significant decision. Record rejected approaches too.

## Environment notes

### Dev machines

The project is developed on two machines. Check which one you are on first
(`grep ^ID= /etc/os-release`, `command -v docker`), because the OCCT and
planegcs builds, screenshot baselines and some tools only work on one of
them. Notes further down that name a machine apply to that machine only.

| | **Arch workstation** (original) | **Ubuntu machine** (since 2026-09-29) |
|---|---|---|
| OS | Arch Linux | Ubuntu 26.04, 4 cores |
| Node, pnpm | Node 26 + pnpm 12 from mise (`~/.config/mise/config.toml`) | Node 24 + pnpm 12 from nvm (no mise) |
| Docker | Yes (`docker` group; socket-activated daemon) | Yes since 2026-09-29 (`docker.io` from Ubuntu; `docker` group). Until the next login, run it through `sg docker -c '…'` (`sg`/`newgrp` come from `util-linux-extra`). No emscripten outside the image, no sudo for agents |
| OCCT / planegcs WASM | `pnpm occt build` / `pnpm planegcs build` locally, or CI | Prefer CI (`gh workflow run ci.yml --ref <branch>`, below): a local build competes for the 4 cores. Local builds are possible but not tried yet |
| Facade checks | `em++ -fsyntax-only` and the native harness in the image | Same, through `sg docker -c`: the pinned image `ghcr.io/taucad/opencascade.js:3.0.2-single-threaded` is pulled; the syntax check takes about 8 s |
| Playwright browser | Playwright's own Chromium (`pnpm e2e:install`) | System Chrome: `PLAYWRIGHT_CHROMIUM_PATH=/usr/bin/google-chrome-stable` |
| Screenshot baselines | Regenerate, then check in the Playwright Ubuntu docker image | Some shots fail locally (Chrome renders differently; they pass in CI): `shell.spec.ts:35` dark/light, `sketch.spec.ts:140`, the home screen in `storage.spec.ts` dark/light, and `print-aids.spec.ts`'s overhang shading (about 1 % of pixels). New baselines: take them from CI's `playwright-report-1`/`-2` artifacts (one per e2e shard; `gh run download <id>`) |
| E2E load | Full parallel run fine | Only one full e2e at a time, `--workers=2`; under load timeouts give false failures. Prefer single specs locally and the full suite through CI on the branch. With its NVIDIA GPU, `E2E_GPU=1` makes viewport-heavy specs 17-39 % faster (screenshot specs excluded: they need SwiftShader) |
| Inkscape, rsvg-convert | Installed | Not installed |
| Slicers, FreeCAD | `prusa-slicer`, `orca-slicer`, `freecadcmd` | Not installed |
| `brotli` CLI | – | Not installed (`scripts/measure-startup.mjs` uses Node's zlib) |
| Electron desktop (P6-01) | `pnpm --filter @extrudo/desktop dev` runs | Headless: no display and **no `xvfb-run`** (checked 2026-10-07), and `electron`'s binary is not downloaded (`pnpm-workspace.yaml`'s `allowBuilds` keeps `electron: false`), so `apps/desktop/scripts/smoke.mjs` can't run here. Packaging and the packaged-app smoke run in CI only (`desktop.yml`, slice 3); `electron-builder --linux --dir` does build here (it downloads its own Electron). The desktop unit tests run in Node without Electron |
- **Git identity:** check `git config user.email` before committing. The
  Ubuntu machine had none set, so its first commits carried the machine's
  hostname as the author address; set the same name and address as the
  Arch workstation's commits (`git log --format='%an <%ae>'`), per repo if
  need be. A hostname in history is a home-network detail (see below).
- CI uses Node 24 LTS; `engines.node` is `>=24`. Both machines' Node
  versions work.
- **pnpm 12 refuses packages published less than a day or so ago**
  (`minimumReleaseAge`). If an install adds a `minimumReleaseAgeExclude` entry
  to `pnpm-workspace.yaml`, don't keep it: relax the version range (e.g.
  `^8.3.0` instead of `^8.3.1`) so pnpm picks an older release.
- **Playwright `webServer` must not start through pnpm.** `pnpm --filter …
  preview` and `pnpm exec` leave Vite running after the tests, and the run
  never ends. The config starts `node node_modules/vite/bin/vite.js` with
  `cwd: 'apps/web'`, bound to `127.0.0.1` (Vite otherwise binds IPv6 `::1`
  only while Playwright polls IPv4).
- **`biome migrate` rewrote `"recommended": true` into `"preset": "none"`**,
  which silently disables all rules. The config uses `"preset": "recommended"`.
- Playwright's own Chromium headless shell works on the Arch workstation. If
  it ever breaks, set `PLAYWRIGHT_CHROMIUM_PATH=/usr/bin/chromium`. The
  Ubuntu machine uses `/usr/bin/google-chrome-stable` (see Dev machines).
- Don't use `pkill -f <pattern>` in a compound shell command: the pattern
  matches the shell itself and kills it. Kill by PID or port instead.
- This project is intended to become **public open source**. Unlike the rest
  of `~/Work`, it must never contain credentials, home-network details or
  personal data.
- **Spikes** live in `spikes/<task>/` as standalone packages outside the
  workspace (`pnpm install --ignore-workspace`); Biome ignores `spikes/`.
  Node 26 runs their `.ts` files directly (type stripping), and `using` works.
- **libcascade's `delete()` often doesn't free C++-owned memory** (found in
  P0-02): a 100k-point `NCollection_Array1` leaks its 2.4 MB buffer on every
  delete; `BRepAlgoAPI_Cut` leaks unless `Clear()` is called first;
  `BRepFilletAPI_MakeFillet` leaks and `Reset()` doesn't help. Reproduce with
  `spikes/p0-02-kernel/src/node/leak-bisect.ts` (`LIB=custom` for the trimmed
  build). The WASM heap only grows once its initial slack is used up (128 MB
  for the prebuilt build, 23 MB for ours), so run leak tests on a small heap,
  for ≥ 1000 iterations, with a leak control that must fail. A
  `malloc`-address probe was tried and is too noisy; `OSD_MemInfo` and
  embind's instance counters aren't exported. Reported upstream as
  [taucad/opencascade.js#40](https://github.com/taucad/opencascade.js/issues/40); check it before P0-09.
- **brepjs `*WithEvolution` returns empty maps unless the input faces carry
  metadata** (for example `tagFaces`): brepjs only sends face hashes to the
  kernel when there is something to propagate.
- **Custom OCCT builds need Docker** (2.4 GB image, about 12 minutes per
  build), so they run locally only on the Arch workstation; elsewhere use CI
  (the CI note below). On the Arch workstation the user is in the `docker`
  group (since 2026-09-25; plain `docker` works since the next login, seen
  2026-09-27). The daemon is socket-activated.
- **Prototype facade code natively first** (P2-02, Arch workstation): the image has OCCT's
  static WASM libraries (`/opencascade.js/build/occt-libraries/libTK*.a`)
  and node. A `harness.cpp` that `#include`s `extrudo_facade.cpp` and
  calls its methods from `main()` builds with `em++ -std=c++17 -O1
  -fwasm-exceptions -I/opencascade.js/build/occt-includes harness.cpp
  -sALLOW_MEMORY_GROWTH -sENVIRONMENT=node <libs: TKBO TKBool TKFillet
  TKOffset TKPrim TKShHealing TKTopAlgo TKGeomAlgo TKBRep TKGeomBase TKG3d
  TKG2d TKMath TKernel TKMesh>` and runs with `node` in the container in
  about 3 s, versus 12 minutes for `pnpm occt build`. Leak checks work
  there too (`heapTop()` over 300 vs 1500 iterations). `MODULARIZE` +
  `EXPORT_ES6` and the three exception helpers in `EXPORTED_RUNTIME_METHODS`
  are required.
- **The planegcs WASM is not in git either** (`packages/sketch/planegcs/dist/`):
  CI's `planegcs` job publishes `planegcs-<hash>`, `pnpm wasm` fetches both
  builds. After changing `build.sh`, the `Dockerfile` or the patch, run
  `pnpm planegcs build` (Arch workstation; through `newgrp docker` if
  needed) or let CI build it (preferred on the Ubuntu machine). Its clone lives in `packages/sketch/node_modules/.cache/planegcs-build/`,
  under node_modules so Vitest skips the clone's own tests (it ran them when
  the clone sat in `planegcs/.work/`). Sketch tests
  import `../../planegcs/dist/planegcs.js`; the browser loads it through
  `@extrudo/sketch/browser` (`?url`).
- **Solver drag speed depends on iterations, not size alone** (P1-03): with
  temporary constraints planegcs runs an SQP from an identity Hessian every
  call. A chained 99-entity plate drags in 11 ms, a 52-curve gear loop in
  120 ms. Benchmark with an off-path pointer (a pointer on the feasible path
  converges in a few iterations and hides this):
  `BENCH=1 pnpm vitest run packages/sketch/src/solver/perf.test.ts`.
- **The OCCT WASM is not in git.** `packages/kernel/occt/dist/` is built by CI
  once per input hash (config + `facade/` + toolchain version) and published as
  the GitHub release `occt-<hash>`; `pnpm occt ensure` downloads it with `gh`.
  After changing the config or the facade, run `pnpm occt build` locally
  (Arch workstation; through `newgrp docker` until the next login) or let CI
  build it (preferred on the Ubuntu machine: the CI note below).
  The CI path is proven (run 36179601320, 2026-09-25): the `occt` job took
  about 16 minutes and published the release before the tests ran. After a
  local rebuild, restart the dev server: it keeps serving the old WASM.
- **Facade C++ (`packages/kernel/occt/facade/`):** the toolchain binds every
  class in the file, so it holds one class with no overloaded names. Check it
  in seconds with `em++ -fsyntax-only` inside the image (README, Arch
  workstation) before a 10-minute build. OCCT 8 deprecates `TopTools_*`/`TColStd_*` typedefs (use
  `NCollection_*`), `Standard_False`, and `Standard_Failure::GetMessageString`
  (use `what()`); `DynamicType()` isn't available on `Standard_Failure`.
  `mallinfo()` doesn't link, so the memory probe is `sbrk(0)` (`heapTop()`).
- **Screenshot baselines** (`e2e/*-snapshots/`) are made locally on the Arch
  workstation and must pass in the Playwright Ubuntu image, which renders
  like CI (on the Ubuntu machine take them from CI's artifact instead: Dev
  machines). Check with
  `echo "docker run --rm --ipc=host -e CI=1 -v $PWD:/work -w /work --user
  $(id -u):$(id -g) -e HOME=/tmp mcr.microsoft.com/playwright:v1.63.0-noble
  node node_modules/@playwright/test/cli.js test e2e/shell.spec.ts" | newgrp
  docker` (after `pnpm build`). Arch and Ubuntu differ by about 12 pixels per
  shot; the tolerance is 0.1 %.
- **E2E tests start on the home screen with empty storage** (each test has
  its own browser context). Open a project with `openProject(page)` or
  `openProject(page, 'wall-bracket')` from `e2e/helpers.ts`; reloads reopen
  the same stored project. Stub browser APIs with a string init script (for
  example `navigator.storage.persist`), since e2e/ has no DOM types.
- **Regenerate screenshots with `--update-snapshots=all`.** Plain
  `--update-snapshots` only rewrites shots that fail, and a small change (the
  save-state text) stays inside the 0.1 % tolerance, leaving a stale baseline.
- **Viewport tests read the camera from data attributes** on the Viewport
  region (`data-camera-direction`, `-up`, `-target`, `-size`) and wait for
  `data-ready` (first frame drawn; the viewport is a lazy chunk). WebGL runs
  on SwiftShader in headless Chromium (unless `E2E_GPU=1`) and renders the
  same in the Arch and Ubuntu images.
- Biome needs `css.parser.tailwindDirectives` for Tailwind's `@theme` and
  `@custom-variant`, and the icon sources are exempt from
  `noSvgWithoutTitle` (they are decorative; controls carry the label).
- E2E specs typecheck without the DOM library: pass browser-side code to
  `page.evaluate` as a string (`'document.fonts.ready.then(() => true)'`).
- **Vite's watcher can miss a second edit to a file made within about a
  second of the first** (seen with two scripted edits in a row): the dev
  server keeps serving the old transform. `touch` the file, then reload.
- **Sketch e2e tests read the open sketch from the tool overlay's
  `data-sketch-summary`** ("points=8 lines=4 … constraints=8 dimensions=0"),
  and map sketch mm to page pixels from the camera attributes in the Top
  view (`sketchOnXY` in `e2e/helpers.ts`). The overlay exists only while a
  drawing tool runs. Tool unit tests use `sketch/tools/testing.ts`
  (`setup({ tool })`, real planegcs).
- **The browser pane's `left_click_drag` sends press and release with no
  move between**, and its screenshots can lag one action behind; read state
  with `javascript_tool` (the summary attribute) rather than trusting a
  screenshot taken right after an action. The viewport treats a press and
  release more than 5 px apart as a drag even without moves.
- **planegcs's `internal_alignment_point2ellipse` does nothing useful in our
  build** (converges without moving, wrong DOF count; P1-05). Ellipses use
  ordinary constraints instead (ADR-0014). Vitest swallows `console.log` in
  probe tests: write to a file in the scratchpad to see output.
- **planegcs "solves" some contradictions by collapsing geometry** (P1-06):
  two horizontal lines made perpendicular become dots 0.0001 mm long, with
  `ok: true`, and `check()` accepts the constraint. The host refuses a user
  constraint whose solve shrinks a curve below 1 µm (`collapses` in
  `sketch/tools/host.ts`).
- **planegcs names redundant equations, not constraints** (P1-06): a
  multi-equation constraint (collinear, some midpoints) can be partly
  redundant and still remove a freedom, and duplicates get their redundancy
  spread over both. `SketchSolver.check` therefore decides "not needed" by
  comparing DOF with and without the constraint whenever any redundancy
  shows (`#dofWithout`); reports have `redundant` (all equations) and
  `partlyRedundant`.
- **planegcs "solves" contradicting dimension values** (P1-08): a line
  10 mm long by one dimension and 20 mm by another solves with `ok: true`,
  the second listed as redundant and simply unmet. Check that dimensions
  hold by measuring (`unmetDimensions` in `packages/sketch/src/solver/status.ts`).
  Constraints on fixed geometry alone come back as redundant too
  (`overdetermined`); the status ignores them.
- **Sketch e2e tests read the selection** from the selection overlay's
  `data-selected-entities` (IDs) and `data-hover-entity`; it also carries
  `data-sketch-summary` while no tool runs. `page.mouse.click` takes no
  `modifiers`: hold Shift with `keyboard.down`/`up`. Shortcuts (Ctrl+Z)
  don't fire while a panel control has focus; `blur()` it first.
- **Sketch e2e tests read constraint status** from the Viewport region's
  `data-sketch-status` ("free=… fixed=… conflict=…") and the palette's
  `data-constraint-state`/`data-dof`. The browser pane may not draw the
  WebGL viewport at all (no `data-ready`); take screenshots with Playwright.
- **The Claude browser pane freezes its page while the pane is hidden**:
  input times out ("Timed out getting the tab ready") and scripts hang for
  45 s. That's not an app hang; reload, or check the flow in Playwright.
- **Don't render tool UI through `React.lazy`**: a suspended boundary is held
  back for up to ~300 ms, and keys typed into the heads-up box in that time
  are lost (flaky e2e). Load the module and render the component directly.
- **The Claude browser pane's `type` action inserts text without keydown
  events**, so it can't test "typing goes into the heads-up box"; use `key`
  presses, or Playwright's `keyboard.type`, which do fire keydown.
- Playwright's `toHaveAccessibleDescription` reads nothing from an
  `<output>` element referenced by `aria-describedby`; use a `<div>` with
  `aria-live` for field messages.
- Vitest 5 takes test options as the **second** argument:
  `it(name, { timeout }, fn)`; the old third-argument form throws.
- **planegcs (P0-03):** the published `@salusoft89/planegcs` WASM has a fixed
  16 MB heap and aborts with `Aborted(OOM)` at about 100 entities in one
  system; we build our own (`spikes/p0-03-solver/planegcs-build/build.sh`).
  Its bindings generator needs tree-sitter, which doesn't compile on Node 26:
  it runs in a `node:20-bookworm` container. Endpoint tangency must be
  `angle_via_point`: `tangent_la` + coincident endpoints gives false
  redundancies and a wrong DOF from a solved state. Set
  `debug_mode = DebugMode.NoDebug` or it prints to stdout. Adding or removing a
  constraint re-runs the full diagnosis (QR); changing parameter values doesn't.
- **SolveSpace's `slvs` npm package (3.1.0-dev.14)** is an old dev build:
  fixed heap, `tangent()` aborts, no `setParamValue`, entity objects without
  `point`. Rejected in P0-03; don't re-evaluate it without a newer build.
- **`LineSegments2.computeLineDistances()` throws on an empty geometry**
  ("reading 'count'": no `instanceStart` attribute yet). Call it only after
  `setPositions` with at least one segment.
- **R3F can deliver `pointerout` for the plane behind after `pointermove` on
  the one in front** (propagation stopped). Clear a hover only if it still
  names the object that was left (read the store, not the render closure).
- **A `fix` constraint holds whatever position the sketch stores** (P1-10):
  move a fixed point in the same change and the solve accepts it where it
  moved. Refuse such changes yourself (Scale does); a solve won't.
  `dimensionValues` reads cached parameter values first, so a dimension
  whose expression a change rewrites must be evaluated directly (the host
  does this for `exprs`).
- **Sketch e2e tests read profiles** from the Viewport region's
  `data-sketch-profiles` ("profiles=2 holes=1", absent while "Show
  profiles" is off) and the selection overlay's `data-selected-profiles` /
  `data-hover-profile` (region IDs). Snap to grid is on in e2e: put test
  geometry on grid points (10 mm steps in the default Top view) or it
  lands elsewhere (a circle snapped against a side made it no hole).
- **A constraint glyph can sit over a corner and take a click meant for
  the point** (only in CI's Ubuntu image, P1-10's select test): uncheck
  "Show constraints" (then `blur()` it) before clicking corners in e2e.
- **Toolbar menu items' accessible names end with the shortcut** ("Trim T"):
  in Playwright match them with a regex, not `exact: true`.
- **The dev server takes an assigned port** (`.claude/launch.json` has
  `autoPort` and `--port "${PORT:-5173}"`), so a second session can run its
  own server while another holds 5173.
- **Timeline and browser e2e tests** read drawn sketches from the
  Viewport region's `data-sketches` (IDs) and the highlighted one from
  `data-highlight`; chip names end with "(rolled back, suppressed)".
  A browser row locator `listitem.filter({ has: button })` also matches
  the folder's `<li>`: take `.last()`. Radix `asChild` triggers nested
  through our wrappers need the wrapper to pass props and ref on
  (`Tooltip` does); anchor popovers on a plain element.
- **Export golden files** (`packages/sketch/src/export/golden/`) are
  rewritten with `UPDATE_GOLDEN=1 pnpm vitest run packages/sketch/src/export`;
  review the diff. Inkscape is installed on the Arch workstation
  (2026-09-27; not on the Ubuntu machine): `inkscape
  --query-width f.svg` gives px at 96/in (377.953 = 100 mm), and
  `--export-type=png --export-dpi=25.4 --export-area-page` makes 1 px = 1 mm
  (`rsvg-convert -d 25.4 -p 25.4` works too). ezdxf isn't installed; a throwaway venv in the scratchpad
  (`python3 -m venv … && pip install ezdxf`) audits DXF files. E2E export
  tests read the dialog's `data-export-summary` and the file from
  `page.waitForEvent('download')`. The Sketch tab's Export tile is named
  "Export" (its short label): find it inside the "Export" group.
- **The browser floats over the view** (ADR-0007/0008 amendments,
  2026-09-28): the Viewport region spans the whole work area, the
  browser covers its left edge, and fit centres the model in the open
  part through `View.shift` (the Viewport region's `data-camera-shift`,
  NDC). Map view px with `mapping()`/`projector()` from `e2e/helpers.ts`
  (they read the shift); code that assumes the origin at the box's
  middle is off by `shift × width / 2`. Toggling the browser doesn't
  move the camera; the next fit uses the new width.
- **The collapsed browser is invisible and inert, not removed** (design
  review, ADR-0007 amendment): the complementary "Browser" still exists;
  check it with `toBeHidden()`, and "Show browser" is a small tab over the
  viewport. Toggling animates (200 ms); read widths with `expect.poll`.
- **The status bar's render rate** (`[data-render-stats]`, "58 fps · 1.4
  ms" or "idle · …") varies between runs: `e2e/screenshot.css` hides it in
  every `toHaveScreenshot` (`stylePath` in `playwright.config.ts`). Put
  anything else that varies there too.
- **OCCT profile facts** (P2-02): General Fuse (`BOPAlgo_Builder`) refuses
  a single argument and never splits an edge at its own crossing;
  `BOPAlgo_BuilderFace` keeps dangling edges and bridges inside faces and
  makes a circle touching the outline from inside a second wire of the
  same face (sharing a vertex). The facade handles all four; see ADR-0025.
- OCCT's STEP writer prints a banner to stdout from inside WASM. Route
  Emscripten's `print` to a logger (or ignore it in tests).
- **Command search e2e** (`e2e/commands.spec.ts`): the palette is
  `dialog` "Command palette", the toolbox `dialog` "Toolbox" with a
  "Pinned" region; results are `option`s whose names end with their group
  and key ("3-Point Rectangle Sketch › Create"), so match with `/^…/`.
  Only the current mode's commands are listed: Extrude isn't found inside
  a sketch, and a sketch tool's pin is hidden after a reload (the project
  reopens outside the sketch).
- **The default Top view doesn't show a 100 × 80 mm sketch** (P1-15): at
  1440 × 900 it is 3.5 px/mm around the origin, the sketch palette covers
  x > ~95 mm and y = 80 mm is above the view; clicks there are lost. Zoom
  out first, **one `mouse.wheel` at a time**, waiting for
  `data-camera-size` to change (headless Chromium delivers wheel deltas
  unevenly: one `wheel(0, 200)` zoomed 1.06×, eight in a row about 9×),
  then call `mapping(viewport)` again. The snap grid stays at 10 mm up to
  0.83 mm per pixel (`gridStep`). `newSketchOnXY` opens a sketch in a
  project that is already open (after setting up parameters, say).
- **An edit right before `page.reload()` survives** through the rescue
  copy (`platform/rescue.ts`, ADR-0009 amendment), which the next start
  saves; tests that check the stored project itself (the home screen,
  exports) may still wait for the save status "Saved" first.
- **Every open project starts a kernel worker** (P2-01), so every e2e test
  compiles the OCCT WASM. Wait for the first recompute with
  `kernelReady(page)` (`e2e/helpers.ts`: the status bar's "Kernel" output,
  `data-model-status="ready"`) before screenshots or status checks. The
  Wall bracket template computes one body, "Bracket" (40×80×60 mm, 12
  faces); Fillet1 computes since P3-01, and only rolling forward brings in
  Plane1, the template's placeholder of the old `plane` type, which stays an
  error on purpose ("Plane1 (error)", "6 features · mm · 1 error";
  "(rolled back)" Plane1 has no status).
  Sketch1/Sketch2 can't be deleted while the extrudes use them. Error
  toasts have role `alert` and sit in the view's bottom-right corner (at
  the foot of the sketch palette in a sketch): dismiss them ("Dismiss")
  before clicking there. An **open feature dialog moves that corner's
  toast stack clear of its own column** (`DIALOG_COLUMN`), so a click on
  the dialog's OK is never swallowed by the 12-second "Sketch1 is hidden…"
  notice (P4-11; before that, a second extrude's OK click waited out the
  toast and cost the flow ~11 s). Under the full parallel run B1 takes
  about 27 s (60 s timeout).
- **Pointer modes** (ADR-0008 amendment): the nav bar's "Select" button
  is `aria-pressed` when no nav tool or command runs. The viewport's
  pointer surface (`div.touch-none` in the Viewport region) carries the
  cursor as an inline style and `data-cursor` (orbit/pan/zoom); check
  with `toHaveCSS('cursor', 'grab')`, not a class. A menu-only tool marks
  its group's trigger (e.g. "Create") with `data-active`.
- **Model-selection e2e** (P2-03) reads the Viewport region's
  `data-model-selection` / `data-model-hover` (space-separated `kind:id`,
  faces as `face:<body>:<index>`) and the status bar's
  `output[aria-label="Selection"]` ("2 faces ·"). Map world mm to page px
  with `projector(viewport)` from `e2e/helpers.ts` (switch to
  Orthographic first for exact numbers). "Selection filter" contains
  "Select": match the nav bar's Select button with `exact: true`.
- **three-mesh-bvh must be built with `{ indirect: true }`**: the default
  BVH reorders the geometry's index buffer, which breaks `faceRanges`.
- Importing `@react-three/fiber` into a module a node unit test imports
  makes Vitest print `THREE_CJS_DEPRECATED`; keep such modules free of
  R3F hooks.
- **Feature dialog e2e** (P2-05) reads `data-preview` /
  `data-preview-dimmed` on the Viewport region, `data-dialog-valid` /
  `data-preview-status` on the dialog region ("<Label> dialog", "Edit
  <Name> dialog"), and drags handles at `[data-manipulator-handle]`
  (`cx`/`cy` in view px). `#/debug/dialog` is the shell with
  `spawnDebugKernel` (the engine's test features) and "Press Pull (test)"
  in Ctrl+K. Expression fields commit every keystroke that evaluates, so
  Esc in a field cancels the dialog unless its text doesn't evaluate. A
  unit test that resolves a fake preview right after a pick must `await
  settle()` first (the fingerprint arrives and asks for a newer preview).
- **OCCT history facts** (P2-04, P2-06): `BRepPrimAPI_MakeRevol::Generated`
  returns nothing for edges square to the axis in a full revolution (the
  facade asks `Revol().Shape(edge)`); a boolean's `Generated(face)` gives
  section edges and vertices, never faces; without `SimplifyResult`,
  coplanar overlapping faces get split; use
  `MapShapesAndUniqueAncestors` (a seam edge lists its face twice
  otherwise); `BRepAlgoAPI_BuilderAlgo::Clear()` is protected (builders
  on the stack free themselves; the `Clear()` rule is for builders deleted
  from JS); `BRepOffsetAPI_DraftAngle` calls tilted faces *generated*
  (use `ModifiedShape`) and returns "valid" solids whose sides have
  crossed (the facade checks); `BRepExtrema_DistShapeShape` detects
  "inside" only for a top-level SOLID. OCCT sources are in the image at
  `/opencascade.js/deps/OCCT/src/`; in the native harness, run the
  container as root to write the emscripten cache, and `#define private
  public` reaches private helpers.
- **Kernel test suites**: topological naming `pnpm vitest run
  packages/kernel/src/naming`; the extrude option golden table
  (`packages/kernel/src/features/golden/extrude-options.json`, 108
  combinations) is a file snapshot: update with `pnpm vitest run -u
  packages/kernel/src/features/extrude` and review the diff. The kernel
  tsconfig has no node types: use `toMatchFileSnapshot`, not `node:fs`.
- **Parallel worktrees**: `E2E_PORT` sets Playwright's port (default
  4173); give each checkout its own, or `reuseExistingServer` tests
  another checkout's build. A new worktree needs the WASM `dist` folders
  (copy them, or `pnpm wasm` once CI has published the release).
- **Extrude e2e** (`e2e/extrude.spec.ts`; P4-12 adds the textbox "Offset"
  (`exact`, "0 mm") under "To object", whose prompt is "Pick a face, a body
  or a vertex", and a test extruding a square on XY up to a Ø30 cylinder
  lying on XZ above it, picked from below with Shift+3: `Body2:<n>:20,20,18.8`,
  20.8 with Offset 2 mm; To object takes planes, so it picks through the plane
  picker — no `data-model-hover`, just click — and its `curvedFaces` flag lets
  a curved face in; mind the Taper heads-up box beside the profile, which
  takes a click on it. P4-12's second amendment adds the combobox "Measure"
  ("whole" default, "half"), shown while Direction is Symmetric: the test
  commits 10 mm with Each side (`Body1:6:60,40,20`) and edits back to Whole
  length (`…,10`). P4-12's taper on ellipse and spline sides is the test
  drawing a 40 × 20 ellipse and tapering it 10° over 20 mm:
  `Body1:<n>:47.1,27.1,20` (each side grows by 20·tan 10°), and the 3MF's
  volume matches the kernel test's Steiner value). The Viewport region's
  `data-bodies` lists drawn bodies as `name:faces:x,y,z` (bbox size in
  mm, e.g. "Body1:7:60,40,15"). The dialog is the region "Extrude
  dialog" / "Edit Extrude1 dialog", its operation the combobox
  "Operation", the pick field the button "Profiles" ("1 profile", "1
  face"). In the Top view the extrude arrow points at the camera and
  can't be dragged: type into the heads-up box, or press Shift+1 (home
  view) and wait for the camera to settle before dragging or picking
  faces with `projector`.
- **Bodies e2e** (`e2e/bodies.spec.ts`) reads the Viewport region's
  `data-body-appearance` ("Name:#rrggbb|default:opacity") and
  `data-silhouettes`, the browser's `[data-folder-count]` and
  `[data-body]` rows (name button `aria-pressed` when selected). A new
  sketch opens fitted to what is drawn (a 40 × 20 plate gives about
  ±13 mm of height at 1440 × 900): keep later geometry inside that, and
  wait for the camera to stop (poll `data-camera-size`, target,
  direction) before `mapping()`. Pick a sketch profile next to a body
  in Orthographic, or the body's edge takes the click. `Bodies.tsx`
  uses `useFrame`: pure helpers go in `viewport/bodyGeometry.ts`.
  `data-silhouettes` sums the hairline-free outlines per body; a node
  within `EDGE_ON` (0.006°) of edge-on counts as **facing** whatever
  the sign of the float noise in its normal is
  (`viewport/silhouette.ts`), so a fillet's tangent line, a wall seen
  exactly from the side or a cylinder's outline in a named view are the
  same every run. The Top view of the bracket is that case: the tapered
  walls of its holes face up, so what is left is the outside fillet's
  tangent line (2 segments), where a run once reported 0, 2 or 4.
- **Body names and projection syncs are amended into the latest undo
  step** (`DocumentState.amend`): a test that dispatches a feature and
  then calls `model.computed({…, doc})` sees the names join that step,
  and `undo` removes both.
- **Sketch on face / Project e2e** (`e2e/sketch-on-face.spec.ts`, 90 s
  timeout) reads the Viewport region's `data-sketch-frames`
  (`<id>:<origin>:<normal>`) and `data-sketch-projected`
  (`<id>:curves=N:x=a..b:y=c..d`). Projected curves appear one
  recompute after `addProjection`: poll in e2e, and call
  `host.syncProjections(reports)` in unit tests. Code that rebuilds a
  `SketchData` must keep `projections` (spread `...data`) or the
  solver frees projected geometry. The kernel builds sketch faces from
  the stored curves, not fresh projections. While Create Sketch waits,
  the view (not R3F plane events) picks planes and faces
  (`PlanePicker.faces`). An XY sketch under a body is hidden behind its
  faces (depth test). **P4-12** (`e2e/project.spec.ts`): the tools' panel is
  the region "Project" or "Intersect" (`exact`) with the checkbox "Keep linked"
  and "Done"; Intersect is `Shift+P` in a sketch; a body is picked by its
  browser row (`complementary` "Browser", button "Body2", `exact`); the
  summary's bounds are the curves' **points**, so a projected circle reads
  `curves=1:x=0..0:y=0..0` (its centre); projected curves are fixed in
  `data-sketch-status` (`free=0 fixed=2` for a circle), an include's free
  (`free=12 fixed=0` for four lines) with no `data-sketch-projected`. A sketch
  on XY over a body below it opens fitted to the body in **perspective**, so
  the sketch plane's curves can be off-screen: `zoomOutTo` and map through
  `projector` at z = 0 before dragging them. An angled construction plane for
  Intersect is the Angled Midplane of a Box's front and top faces, made
  **before** the next body changes the home view's fit.
- **Revolve e2e** (`e2e/revolve.spec.ts`): the dialog is the region
  "Revolve dialog", the axis field the button "Axis" ("Y axis", "1
  sketch curve"); origin axes appear in `data-model-hover` /
  `data-model-selection` as `axis:origin:y`. In the default Top view
  the Y axis is pickable at sketch (0, 45); the status bar says "1
  profile, 1 axis". An origin axis behind a profile can take a click
  meant for the profile in sketch-mode tests; use "Select other…" or
  click off the axis. The revolve golden table updates with `pnpm
  vitest run -u packages/kernel/src/features/revolve`.
- **WASM heap growth with a warm cache** (P2-07, closed 2026-10-06): a worker
  that reaches the browser's limit is replaced between recomputes (P4-12 §H4,
  `Recomputer`'s `heapRecycleBytes`, 1 GiB by default), which frees the whole
  heap but recomputes cold.  The growth itself is **mesher fragmentation under
  mimalloc**, not a leak: the revolve document's top moves 10.7 MB per 100
  recomputes, all of it in `mesh` (`HEAP_ATTRIBUTE=1`, which now skips
  `heap`/`stats` or it recurses), and it needs **fresh** shapes going through
  `BRepMesh_IncrementalMesh` while the cache holds live triangulations (no mesh,
  or re-meshing one shape, is flat). The mesher's transient
  `NCollection_IncAllocator` blocks are freed each mesh but not reused, because
  the cached triangulations are interleaved with them. `spikes/p4-12-heap-growth`
  (facade `#include`d, `heapTop()`; `run.sh`/`sweep.sh`/`sweep-minimal.sh`,
  `NOMESH`/`MODE=same`/`CLEAN`/`COPY`/`MI`) reproduces and tried the cures:
  `BRepTools::Clean`, meshing a copy, dlmalloc and the mimalloc options
  (`mi_collect`, `purge_delay`, `page_full_retain`) — none flat; OCCT's
  `MEMORY_BLOCK_SIZE_HUGE` can't be patched (no toolchain hook). It stays
  bounded by the recycle (1 GiB, ~8,500 recomputes; a lower default was
  rejected because a cold B9 recompute is 8 s, `HEAP_BOUND=1 … heap-bound`).
  The warm-cache probe checks 20 MB/100 and `mesh-golden.test.ts` fingerprints
  every fixture body's mesh. Memory tests of big booleans clear the engine each
  run and warm up through every value first.
- **Primitives e2e** (`e2e/primitives.spec.ts`): the dialogs are the
  regions "Box dialog"… (from `pickTool(page, 'Box')`), the Plane field
  the button "Plane" ("XY plane", "XZ plane", "1 face"). While Plane is the
  pick field the view picks planes and faces like Create Sketch, so
  `data-model-selection`/`-hover` are absent; click origin planes at world
  points with x ≥ 0, y ≤ 0, z ≥ 0 inside the square (view size × 0.16) in
  the home view, where no other plane is in front, and faces the same way.
  **P4-12:** that click also sets X and Y to the point (a face click lands within
  about a millimetre of the projected point: don't assert tighter), the dialogs'
  handles are `[data-manipulator-handle="x"|"y"|"offset"]` (`cx`/`cy` in view px;
  heads that meet are lifted 14 px by the overlay, so a head can sit 14 px off
  where its value says), and the Box's **"Two corners"** button carries
  `[data-corners]` (`off`, `0`, `1`: the corners marked); the next two clicks on
  the plane set X, Y, Length and Width (the height stays; a turned box goes back
  to 0°) and disarm; Esc with focus in the dialog disarms. The right side of the
  home view is under the dialog: pick points with a negative y of about
  −0.2 h or more. P4-12's second amendment gives the Torus dialog the
  comboboxes "Axis" (`normal`/`x`/`y`) and "Seat" (`centre`/`plane`; `plane`
  rests it on the plane, `offset` still adding): the test sets Axis X +
  Seat On the plane and reads `Body1:1:10,50,50` (one face). The kernel golden table updates with `pnpm vitest run -u
  packages/kernel/src/features/primitives`.
- **Export e2e** (`e2e/export-3d.spec.ts`): the dialog is `dialog`
  "Export model"; bodies are checkboxes by name, formats radios
  (`/^3MF/`, `/^STL/`, `/^STEP/`), resolutions `/^Coarse/`…`/^Custom/`
  with textboxes "Deviation" and "Angle". The summary's
  `data-export-summary` reads "1 body, 620 triangles, watertight" once
  meshed (poll it before Export). e2e imports `../packages/io/src/index`
  to read and check downloads. The format and resolution are remembered
  in the `export.model` preference (per browser context). `exportModel(page,
  'STEP')` (`e2e/benchmark-helpers.ts`) waits for "exact geometry" instead
  of "watertight"; a coloured body's STEP has one `COLOUR_RGB` per colour
  (P4-12), an uncoloured one none.
- **Slicers on the Arch workstation** (2026-09-28; none on the Ubuntu
  machine): `prusa-slicer --info
  f.3mf|f.stl` prints `manifold = yes`, facets, volume per object;
  `orca-slicer --datadir <scratch> --outputdir <dir> --export-3mf out.3mf
  f.3mf` re-exports (`Metadata/model_settings.config` has names and
  `mesh_stat` repair counts; its CLI ignores file colours). `freecadcmd
  script.py` with `Import.insert` reads STEP names and solids. lib3mf
  installs with pip in a scratchpad venv (`lib3mf.get_wrapper()`, reader
  `SetStrictModeActive(True)`, `IsManifoldAndOriented`). Bambu Studio
  isn't installed.
- **Export meshes weld through the topology, not by position** (P2-12):
  every edge's polygon on each face's triangulation lists that face's
  nodes along it; BRepMesh discretises an edge once, so both faces'
  polygons match node for node. A degenerate edge (pole, apex) collapses
  to its vertex, and triangles that become degenerate are dropped. Mesh
  a copy (`BRepBuilderAPI_Copy(s, false, false)`): BRepMesh keeps an
  existing triangulation that is fine enough, so meshing the cached shape
  would leave coarse exports fine and refine the display.
- **Timeline v2 e2e** (`e2e/timeline-v2.spec.ts`; P4-12: the Viewport region's
  `data-ghosts` lists `<featureId>:<type>:<x,y,z>` — in the lost-face test, hovering
  Sketch2's chip gives `<id>:plane:0,-10,15` and it stays while Redefine Plane is
  open): the marker is the
  slider "Timeline marker" (`aria-valuenow` = active features,
  `aria-valuetext` "After Extrude1"); while it is dragged the real marker
  stays and `[data-marker-ghost]` holds the target index. A dragged chip
  shows `[data-drop-index]` (and `data-drop-refused`); drag with
  `mouse.down` and several `mouse.move` steps (> 4 px), dropping at a
  chip's left edge + 3 px lands before it. Chips carry
  `data-feature-status` and names like "Sketch2 (warning)". Redefine
  Plane is the region "Redefine Plane". The "Sketch1 is hidden" toast
  covers the first chips: dismiss it before right-clicking them. Snap to
  grid moves off-grid clicks (5 mm snapped to 10 in a zoomed-out view).
- **Measure e2e** (`e2e/measure.spec.ts`): the panel is the region
  "Measure" (`data-measure-state` empty/pending/ready/error), values are
  `[data-measure-row="<section>/<label>"]` ("Between/Distance",
  "Face 6 · Body1/Area": face numbers follow the kernel's order, so
  match item rows by suffix), the line is `[data-measure-line]` ("x1,y1
  x2,y2" in view px); the status bar's `output[aria-label="Selection
  size"]` reads "40.00 × 20.00 × 0.00 mm ·". Measure isn't in the Sketch
  tab (bodies only).
- **Construction e2e** (`e2e/construction.spec.ts`, P3-05): the Viewport
  region's `data-construction` lists the drawn construction features
  (`Offset_Plane1:plane:<origin>:<normal>`, `…:axis:<point>:<direction>`,
  `…:point:<x,y,z>`, spaces in names as `_`, a dialog's preview
  `preview:`-prefixed); the browser's Construction rows carry
  `data-construction="<feature id>"` and eyes ("Hide Offset Plane1").
  The tools are the Construct tab's (ADR-0079: Planes, Axes, Points; Plane
  Through 3 Points, Plane Along Path and Angled Midplane tiles in Planes): run them
  with `pickTool(page, '<full name>')`; its dialogs are the regions
  "Offset Plane dialog", "Axis Through 2 Points dialog"… A plane field
  picks like Create Sketch (click a plane's square, `clickAt` a world
  point with x ≥ 0, y ≤ 0, z = 0 in the home view); the axis and point
  fields pick in the model. Create Sketch lists construction planes as
  buttons in the group "Construction planes". **An extrude hides its
  sketch**, so `data-sketch-frames` is empty until "Show Sketch1". A
  construction axis lying on an origin axis loses the pick to the origin
  one: offset it. `sketchOnXY` opens a *new* project; use `newSketchOnXY`
  in an open one. **P4-12** adds four tests: a Point on Path on a Box primitive'
  bottom front edge (its `data-construction` reads the midpoint; the
  `[data-manipulator-handle="position"]` handle drags along the edge — blur the
  Position field before reading it), a Plane Along Path on a sketch line
  (`plane:20,0,0:1,0,0`), an Angled Midplane of a Box's front and top faces
  (normal `0,-0.707,0.707`), and a box selection in the top view that takes the
  Offset Plane's square (`data-model-selection` lists `plane:<id>`; a window
  excludes the longer origin axes).
- **Versions e2e** (`e2e/versions.spec.ts`): Ctrl+S opens the dialog
  "Versions" with the textbox "Description" focused; the list is
  "Saved versions" (items carry `data-version`), buttons "Restore V1",
  "Open V1 as a copy"; toasts "Saved V1.", "Restored V1. What you had is
  kept as V2…". The app bar has a "Version history" button beside the
  name (it moved the centred name a little: shell/sketch baselines).

- **Fillet e2e** (`e2e/fillet.spec.ts`, P3-01): the dialog is the region
  "Fillet dialog" / "Edit Fillet1 dialog", set 1 the buttons "Edges"
  (`exact: true`: "Edges 2" contains it; text "1 edge", "7 edges", or the
  prompt "Pick edges" when empty) and the textbox "Radius" (`exact`), set 2
  "Edges 2" / "Radius 2" once set 1 has edges. A message in the region
  "Feature status" (role `status`), OK disabled while the preview errors.
  Pick edges the way `model-select.spec.ts` does: hover a couple of pixels
  below the projected midpoint until `data-model-hover` is an `edge:…`,
  then click. On a cube from the Box tool (x, y ±10, z 0…20; home view
  from +X, −Y, +Z) the midpoints (0, −10, 20), (10, 0, 20) and (10, −10,
  10) are visible. A picked edge brings its tangent chain a moment later
  (a kernel call): poll the count. The Cancel button's name is "Cancel
  Esc" (the dialog header also has an icon "Cancel"). Kernel-side, the
  fillet golden table is `pnpm vitest run -u packages/kernel/src/features/fillet`.
  A failing fillet is diagnosed by rebuilding it (about a second per
  failing build when 12 edges collide): keep such cases out of previews
  and tests that run many times. P4-10 adds the checkbox **"Variable"** and,
  while it is on, the textbox "End radius" and the checkbox "Swap ends" (set
  n's carry the number, "End radius 2"); the toggle is no input, so opening a
  stored taper shows it on and unchecking it hides the other two. The
  variable test's volumes come from four `exportModel(page, '3MF')` calls
  (each leaves the 3D Print tab open, so `solidTab(page)` before a dialog).
  P4-12's second part: a second set's handle is `[data-manipulator-handle="radius2"]`
  (`data-manipulators="distance:radius distance:radius2"`), a variable set's are
  `radius` and `radiusEnd` (one per end of the edge; **Swap ends changes their
  places**) and `arrowState(viewport, field)` in the specs reads
  `[data-manipulator-state]:has([data-manipulator-handle=…])` (`active` or `quiet`;
  focusing a field or the set's Edges button makes its arrow active). Nearer an end
  than the middle, so measure a head against the nearer of the edge's two end
  points. P4-12 adds the radius handle: the overlay reads
  `viewport.locator('[data-manipulators]')` with `data-manipulators="distance:radius"`,
  and `[data-manipulator-handle="radius"]` carries its centre in `cx`/`cy`
  (px in the view) — drag it **away from the edge** (the head is `radius`
  from the edge's middle, up-left of it in the home view) and the Radius
  field follows. **Blur the field after `fill`** before reading it: an
  `ExpressionInput` keeps the user's own text while it has the focus (the
  field is in `editing` mode), so a dragged value only shows blurred. The
  handle stands on the edge's middle, so a pick *there* while the dialog is
  open is the handle's: click a little along the edge to unpick it.
- **Chamfer e2e** (`e2e/chamfer.spec.ts`, P3-02; P4-12's second part adds
  `distance2` for a second set and, for two distances, `distance` and
  `distanceB` handles along the two faces — in the home view the one on the front
  face points straight down the screen, the one on the top face up and right, and
  **which is Distance is the body mesh's face order**, so the spec reads the top
  face's footprint from a 3MF to check it; P4-12's third amendment adds the
  angle arc: a distance-and-angle set's `data-manipulators` reads
  `distance:distance angle:angle`, and the drag turns the Angle by going along
  the arc — perpendicular to its radius on screen, either way round): the tool has no key: click
  the toolbar's Chamfer tile (`getByRole('button', { name: /^Chamfer/ })`,
  after picking an edge for pre-selection). The dialog is the region
  "Chamfer dialog" / "Edit Chamfer1 dialog"; set 1 has the button "Edges"
  (`exact: true`), the combobox "Type" (options "Equal distance", "Two
  distances", "Distance and angle": a Radix select, click it, then the
  option) and the textboxes "Distance", "Second distance" (two distances),
  "Angle" (distance and angle), the button **"Reference face"** (P4-12:
  "Automatic" while empty, "1 face" once picked; it shows for the two
  unequal types, and while it holds a face the checkbox "Flip" is gone) and
  the checkbox "Flip" (both non-equal types); set 2 names get " 2" ("Edges
  2", "Type 2", "Distance 2" …). Fields of other types aren't in the DOM.
  The message is in the region "Feature status". P4-12's reference-face test
  picks the top face for the 2 mm and the front one for the 6 mm of one
  two-distance chamfer and reads the top face's footprint and the volume
  from a `3MF` export (its triangles in the plane z = 20); the distance
  handle works as the fillet's radius handle. Kernel-side, the golden table is
  `pnpm vitest run -u packages/kernel/src/features/chamfer`; a chamfer's
  failed build is diagnosed by rebuilding it like fillet's (keep failing
  cases out of previews that run often).
- **Shell e2e** (`e2e/shell-feature.spec.ts`, P3-03; not `shell.spec.ts`, the
  app shell's): the tool has no key: click the toolbar's Shell tile
  (`getByRole('button', { name: /^Shell/ })`) after picking the top face
  (hover until `data-model-hover` is a `face:`, then click at world (0, 0, 20)
  of the Box tool's cube). The dialog is the region "Shell dialog" / "Edit
  Shell1 dialog": the button "Faces to remove" ("1 face", prompt "Pick
  faces"), the button "Body" ("1 body"; it shows only while no face is
  picked), the textbox "Thickness" (`exact`, default "2 mm") and the combobox
  "Direction" (`inside`/`outside`, `selectOption`). A cube shelled inside
  with its top removed is `Body1:11:20,20,20` in `data-bodies`, outside
  `Body1:<n>:24,24,22`, hollowed closed `Body1:12:20,20,20`. A 12 mm wall on
  the 20 mm cube says "(max ≈ 9.9 mm)". Kernel-side, the golden table is
  `pnpm vitest run -u packages/kernel/src/features/shell`. A shell that fails
  is diagnosed by rebuilding it (7 builds, about 80 ms for a box); a removed
  face next to a fillet that a plug can't open (curved, a slanted neighbour,
  touching another removed face) is refused without running OCCT. **P4-12's
  wall sets:** the button "Wall faces" (`exact`, prompt "Pick faces for
  another thickness") and, once it has faces, the textbox "Wall thickness"
  (`exact`, default "4 mm"), then "Wall faces 2"…; the spec picks the cube's
  floor for it from below (Shift+3, world (0, 0, 0)): `Body1:11:20,20,20`
  still, and the 3MF's volume is exact (`solidFacts`): 3904 mm³ at 4 mm, 4416
  at 6 mm.
- **Facade checks with Docker on the Ubuntu machine** (since 2026-09-29;
  `sg docker -c '…'` until the shell has the group): `em++
  -fsyntax-only` and the native harness both run in
  `ghcr.io/taucad/opencascade.js:3.0.2-single-threaded` (`--user 0`, harness
  in the scratchpad, `-sERROR_ON_UNDEFINED_SYMBOLS=0` and `TKDESTEP TKXSBase
  TKDE` among the libs so the whole facade links). Real OCCT 8.0.1 headers
  are also at `https://raw.githubusercontent.com/Open-Cascade-SAS/OCCT/b8f597c677811d1f9f4d8a97f5ae2825c0353a42/src/…`
  (the tag's tarball works for grepping the sources: `src/ModelingAlgorithms/TKFillet/…`).
  Changing the facade changes the OCCT input hash, so `pnpm build`/`pnpm
  wasm` fail until CI has published it; `pnpm --filter @extrudo/web build`
  and Vitest/Playwright still work with the `dist/` you have.
- **Service worker and e2e** (P2-15, `e2e/pwa.spec.ts`): the config sets
  `serviceWorkers: 'block'` for every test (each fresh context would
  otherwise cache 20 MB of WASM); `pwa.spec.ts` opts in with
  `test.use({ serviceWorkers: 'allow' })`. Wait for
  `navigator.serviceWorker.ready` (resolves after the whole precache);
  the cache is `extrudo-precache`, its keys absolute URLs, and
  `context.setOffline(true)` + `page.reload()` proves the offline path. The
  cache is matched with `ignoreVary` because `vite preview` sends
  `Vary: Origin`. The worker exists only in `pnpm build` output
  (`dist/sw.js`), never in dev. Agent worktrees in `.claude/worktrees/`
  are gitignored, so Biome (which reads `.gitignore`) skips their nested
  `biome.json`.
- **Hosting e2e** (`e2e/hosting.spec.ts`, P3-15): `e2e/static-host.ts`
  (`startStaticHost(dir)`) serves `apps/web/dist` the way Cloudflare Pages does
  (the build's own `_headers` with path rules, **`.html` paths 308-redirected**
  (`/index.html` → `/`), `index.html` fallback, `.wasm` as `application/wasm`) on a random port, with `override(path, body)` to serve a
  changed file; `watchPolicy(page)` collects `securitypolicyviolation` events and
  console errors. `vite preview` (the webServer) applies only the `/*` block, which
  already includes COOP/COEP and the CSP: if a spec fails with "kernel stopped"
  after a change, look for an `EvalError` or a blocked cross-origin load first
  (the debug route `#/debug/kernel` prints why the kernel didn't start). A CSP
  violation in the page is also a console error. The build must be fresh
  (`pnpm build`): the specs read `apps/web/dist`.
- **Landing page e2e** (`e2e/site.spec.ts`, ADR-0057): serves `apps/site/dist`
  (fresh `pnpm build` builds it with the app) through `startStaticHost`; the
  heading "Parametric CAD for 3D printing, in your browser." (spans `.hl-sketch`
  and `.hl-solid`), the nav's links (Features, Changelog, GitHub, Open Extrudo),
  the `.soon` pill, links "Open Extrudo" (`[data-open-app]`,
  `https://app.extrudo.org/`) and "Try the latest build", the scroll stage.
  `[data-walkthrough]` gains `data-enhanced` when `walkthrough.ts` runs; it builds
  `.scrolly-track` > `[data-walkthrough-stage]` (the pinned, `aria-hidden` stage:
  `img[data-step]` with `data-active` on the current one, `.caption[data-active]`,
  `[data-walkthrough-counter]` "Step n of 9", `.chip`s with `data-active`/`data-done`
  and the `.marker`) from the `li.step[data-step]` list, which stays as a
  visually hidden `ol` (width 1 px) with `aria-current="step"` on the current item
  and `data-active-step` on the section. **A test drives the scroll position**: the
  track is `n - 0.4` stretches long and a step's picture rests for the first 0.4 of
  its stretch (`scrollToStep(page, n, extra)` in the spec scrolls with
  `behavior: 'instant'`, since the page has `scroll-behavior: smooth`); a resting
  picture's computed `transform` is `none`, a half-dealt one's a matrix; the
  stage's `--tilt` is 12 below the hero and 0 pinned or under reduced motion; a
  chip's click scrolls to its step. The deck never deals past a picture that
  isn't decoded, so reaching step 9 proves all nine loaded. **The toy** is
  `[data-toy]` (`[data-toy-drawing]`, `[data-toy-weight]`, sliders named "width",
  "height", "fillet radius"; hidden without scripting): the tests use the keyboard
  (End/Home) and a mouse drag, and the breathing stops on the first `input`.
  `StaticHost.serve(dir)` switches the host's build
  (the app first, its worker installed, then the site): the retiring `sw.js`
  sometimes waits behind the open tab, and the old app's update toast (Reload)
  sends `SKIP_WAITING`; the spec takes that path when the page didn't switch by
  itself. Routes to the app are fulfilled with `page.route`. "Cloudflare Web
  Analytics runs under the landing page's content policy" serves the built
  `index.html` with the beacon tag injected before `</body>` through
  `host.override` (which takes a content type, as `/` has no extension) and stubs
  both Cloudflare hosts with `page.route`: the script (which then posts to the RUM
  endpoint) must load, or the site's policy has stopped allowing analytics.
  "Every text on the landing page meets WCAG AA contrast against what is painted
  behind it" makes every glyph transparent (through the CSSOM: the policy refuses
  an injected `<style>`), screenshots the page and reads the pixels behind each
  text box in a blank page of its own (a data-URL image on a canvas, 2 px inside
  the box, the 2nd/98th luminance percentile), under both system themes at 1280
  and 375 px (the page is dark in both): axe calls text over the body's gradient
  *incomplete*. SVG text (the toy's labels) is read by `fill`, and the headline's
  dashed underline is hidden for the measurement (it hangs into the next line's
  box). Text on the hero's glow takes `--x-glow-muted`/`--x-glow-link`
  (`apps/site/src/tokens.css`); **a hidden caption is `visibility: hidden`, not
  just `opacity: 0`**, or the test (which counts any translucent text as a failure)
  reports it. "The landing page is dark under a light system theme, the docs are
  not" proves the split.
  **Docs site e2e** (ADR-0068 §6, the same spec): the footer's "API docs" link
  (`[data-api-docs]`, `/docs/api/`), the docs index's sidebar (`nav[aria-label="API
  docs"]`, with a "Create" group) and a feature page's inputs table (`table th`:
  "Input", "Type", "Required or default", "What it does"), its face roles and its
  example code, the sidebar link that navigates (`aria-current="page"` on the page's
  own entry), **no `script` element at all** and no policy violation
  (`watchPolicy`), plus an axe audit of both themes on `/docs/api/` and a feature
  page. The pages come from `docs/api/**.md` at build time, so run `pnpm
  api:generate` before `pnpm build` when the Markdown changed, and the unit tests
  are `apps/site/src/docs.test.ts` (every file becomes a page, links point to
  pages, the sidebar's order).
- **Update toast e2e** (`e2e/pwa.spec.ts`, "an update is waiting"): the host
  swaps `/sw.js` for a copy with another `VERSION`, `registration.update()` makes
  the browser install it, and it **waits** (the old version stays active:
  `activeVersion` reads the `x-extrudo-version` header the worker stamps on
  `.previous-precache` when it activates); the toast "A new version of Extrudo is
  ready." has the button "Reload" (`exact: true`). After it the new version is
  active and the page reloaded; a project rename made just before survives.
  Unit tests: `platform/updates.test.ts`, `updateNotice.test.ts`,
  `project/autosave.test.ts` (`saveEverything`).
- **OCCT builds through CI** (the preferred way on the 4-core Ubuntu
  machine; works from either machine): push a branch (only `main` and pull requests trigger CI by
  themselves) and run `gh workflow run ci.yml --ref <branch>`; the `occt`
  job builds that branch's inputs in about 14 minutes and publishes
  `occt-<hash>`, then `pnpm occt ensure` downloads it. The dispatch needs the
  workflow file on `main`; runs of one ref cancel each other, so run
  experiments from separate branches (and delete the branch afterwards).
- **`node scripts/measure-startup.mjs`** prints the size table and times a
  first visit, a repeat visit and an offline visit under CDP throttling
  (`--mbit`, `--no-browser`); it uses `PLAYWRIGHT_CHROMIUM_PATH` for a
  system Chromium (on the Ubuntu machine `/usr/bin/google-chrome`). The
  ADR-0037 numbers were measured on the Ubuntu machine.
- **Benchmark e2e** (`e2e/benchmark-b1.spec.ts`, `-b2`, `-b3`; helpers in
  `e2e/benchmark-helpers.ts`): a new parameter's unit is the New parameter
  row's select (`Length` unless you pass `'angle'` to `addParameter`), and
  `floor` is an expression function: don't name a parameter that. In a
  sketch on a face the camera is perspective and looks at the body's
  middle, not the plane, so map sketch points with `projector(viewport)`
  at the plane's world coordinates (`flat([x, y, z])`), never the flat
  `mapping()`; a face sketch opens fitted so tight that its edges sit
  under the nav bar: `zoomOutTo(page, point, 150)` first, one wheel step
  at a time. On a YZ sketch the sketch x is world Y and y is world Z
  (camera direction `-1,0,0`). The origin is no entity: a Point tool click
  at (0, 0) is auto-fixed and dimensions can start from it. Offset takes a
  whole projected face outline (its ends that meet are one joint, P3-17; B2
  uses it): `o`, click a side, move to the inside, type a number (letters
  don't go to the heads-up box: `wall` would start the Line tool), Enter,
  then double-click a dimension label and fill in `wall` (the other three
  follow the first).
  A `d` dimension on two parallel lines is their distance; on two lines
  that meet it is the angle (the label's sector picks it). The Constraints
  group ("Parallel") lives in the toolbar, not the palette. `data-bodies`
  rounds sizes to 0.1 mm. `exportProject(page, 'b2-storage-box.extrudo')`
  writes `fixtures/benchmarks/` only with `WRITE_FIXTURES=1`. Each spec
  takes about 20 s alone (B3 about 30 s); on the Ubuntu machine run with
  `PLAYWRIGHT_CHROMIUM_PATH=/usr/bin/google-chrome-stable` (no Playwright
  browser installed there).
- **Benchmarks B4–B7** (`e2e/benchmark-b4.spec.ts`, `-b5`, `-b6`, `-b7`,
  P3-14; B6 with P3-08's Draft): shared steps in `e2e/benchmark-helpers.ts`:
  `primitive(page, 'Box', fields, operation)` fills a primitive on XY and
  commits it, `turnView(page, 'Shift+3')` turns and returns a settled
  `projector`, `clickEdge`/`clickWhere` poll `data-model-hover` before the
  click, `pickAxis` tries points along an origin axis, `extentOf(mesh,
  keep)` measures the nodes that pass a filter (B4's lip and cavity), and
  `solidTab(page)` returns after `exportModel` (which leaves the 3D Print tab
  open); Parameters is a Home tile since ADR-0079, so `pickTool(page,
  'Parameters')` finds it from any tab. While a Hole's or primitive's
  Plane field picks, the view has no `data-model-hover`: `clickAt` with a
  short wait instead. Faces seen from below (Shift+3) sit under the dialog
  on the right at the fitted zoom: `zoomOutTo` first. An origin axis behind
  a body isn't pickable: try its points in front (negative Y in the home
  view). The YZ plane inside a closed body can't be clicked: hide the body
  that covers it (B5 hides the lid over the open tray). A construction
  plane's field text is its name ("Offset Plane1"); pick it where it lies
  over an open cavity (it wins over the floor behind it). In a sketch,
  dimensioning a rectangle side moves the opposite side: pick the next
  side where it is now. Body rows rename with `renameBody` (F2); the 3MF's
  object names are the body names.
- **Combine and Move/Mirror e2e** (`e2e/combine.spec.ts`,
  `e2e/move-mirror.spec.ts`, P3-06): the Modify tab's Transform group's tiles
  are the buttons "Move", "Mirror" and "Combine" (`pickTool(page, 'Combine')`
  selects the tab; `exact: true`: a chip "Move1" matches a regex); dialogs are the regions "Combine dialog", "Move dialog",
  "Mirror dialog". Select bodies first with `selectBodies(page, ['Body1',
  'Body2'])` (`e2e/benchmark-helpers.ts`: a click, then Shift-clicks on the
  browser rows): the first is the Combine target, the rest its tools, both
  fields read "1 body" (buttons "Target" and "Tools", `exact: true`, since
  "Clear Target" also matches). A Move that moves nothing previews as a
  *warning* ("Nothing moves"), so wait for `data-preview-status` /^(ok|warning)$/.
  The gizmo is `data-manipulators="distance:dx angle:rx distance:dy …"`
  with handles `[data-manipulator-handle="dx"]`; in the home view drag an
  arrow along the projected axis (the value snaps, so 80 px gave 4.6 mm
  there). Positions are read from the 3MF export (`exportModel` +
  `objectsOf3mf` + `meshBounds`; it opens the 3D Print tab; `pickTool`
  selects the Modify tab again). Picking the X axis for Rotate: try points along it until
  `data-model-hover` is `axis:origin:x` (the dialog covers the right
  edge). The plane picker for Mirror works as in the primitives spec
  (click a plane's square, `[0, -h·0.6, h·0.6]` for YZ). Kernel tests:
  `pnpm vitest run -u packages/kernel/src/features/combine` and
  `…/transform` rewrite the golden tables.
- **The scratchpad is shared between agents in one session**: put harness
  files in your own subfolder (`<scratchpad>/<task>/`); `harness.js` from
  another task once ran in place of a fresh build. Shell commands that
  mix `&&`, heredocs and `python3 -` are sometimes refused by the worktree
  guard: write scripts with the Write tool and run them as one plain
  command.
- **Notification history e2e** (`e2e/notifications.spec.ts`): the bell is the
  button "Notification history…" (its name adds ", 2 new, 1 error"; it carries
  `data-unread` and `data-unread-errors`, and doesn't exist until something
  was notified); the panel is `dialog` "Notification history" with regions
  "Errors" and "Earlier", rows `[data-notification="error|info|success"]`
  (a repeat has `[data-count]`), and a stale action is a disabled button named
  "Show (no longer applies)". The bell sits in the view's bottom-right
  corner, under the toasts: dismiss the toasts (`Dismiss`) before clicking
  near there. Unit tests use `createNotifications({ now, later })` with injected
  clock and timers; `renderToStaticMarkup` sees only the store's initial state.
- **Marking menu e2e** (`e2e/marking-menu.spec.ts`; P4-12: Ctrl+K "customize marking" opens the
  region "Customize Marking Menu" with tabs Model/Sketch, wedge buttons
  `[data-slot-button="model:2"]` (`data-slot-command`, `data-slot-custom`), the
  combobox "Search commands", options by label and "Reset all"): right-click without
  movement opens `menu` "Marking menu" (`data-marking-menu="radial|list"`)
  with wedges `[data-marking-slot="<command id>"]` (`aria-disabled` when
  dimmed; `[data-wedge="n"]` in the ring's SVG carries `data-active` under
  the pointer) and list rows `[data-marking-entry="<id>"]` (`selectOther`,
  `sketchOnFace`, `measure`, `hideBody`, `appearance`, `fit`, `projection`,
  `delete`, `cancelTool`...); the ring is `[data-marking-ring]`, the list
  `[data-marking-list]`. Wedges pick on pointer release from the pointer's
  direction, so click them or press-move-release from the ring's centre
  (`ringCentre`). A right-click selects what is under it: the pointer at the
  middle of the wall bracket often hovers an edge, so `overFace` scans for
  `data-model-hover` `face:`. The sketch ring has no Delete wedge (the list
  does). While a sketch tool runs the selection overlay
  (`[data-selected-entities]`) is gone; `[data-sketch-summary]` is on both
  overlays. The debug kernel page has no `viewMenu`, so its right-click is
  still "Select other…" (`model-select.spec.ts`).
- **Section analysis e2e** (`e2e/section.spec.ts`): the Viewport region's
  `data-section` ("origin:xy offset=30 mm on", "… flipped on", "… off",
  "face:<id> offset=… on"; absent with no section; **several sections joined by
  `;` in the order added**, a box `box=cx,cy,cz:hx,hy,hz on` in mm as evaluated)
  and `data-section-clip` (the plane while it clips: `0,0,30:0,0,1` = origin,
  then the unit normal of the **removed** side; absent while off and in sketch
  mode; one entry per plane joined by `;`, the box's six in the order +x −x +y −y
  +z −z; the sketch Slice's clip last while a sketch is open and
  `sketch.slice` is on, which also brings the person's planes into sketch
  mode; the region then also carries `data-sketch-slice="on|off"`, absent
  with no sketch open — `e2e/sketch-slice.spec.ts` walks it). **P4-12:** each plane is a `fieldset` `[data-section-index="<n>"]`
  (legend "Plane 2") holding its own "Offset", "Flip", "Show section", "Change"
  and, from two rows on, "Remove" (`exact: true`: the footer reads "Remove", or
  "Remove all" with several rows); the buttons "Add plane" (`exact`) and "Box"
  (`exact`) switch the choosing state, the panel has `data-section-mode`
  (`planes`/`box`), the box's textboxes are "Centre X/Y/Z" and "Half-size X/Y/Z"
  (`exact`), handles are `[data-section-handle="0"|"1"|"2"|"box:+x"…]` and
  `[data-section-arrow]` (on the overlay's div) lists every arrowhead `x,y;x,y`
  in drawing order (drag a handle along the line to its arrowhead to grow the
  cut; the spec's `dragHandle` does it). **Esc closes the panel**: don't press
  it between clicks. The browser row reads "Section · 2 planes" or "Section ·
  Box". The panel
  is the region "Section Analysis" (`data-section-state` `choosing`, `lost`,
  `on`, `off`; buttons "XY plane"…, "Change", "Done", "Remove"; textbox
  "Offset" with `exact: true`; checkboxes "Flip" and "Show section"); the
  arrow's handle is `[data-section-handle]` (`cx`/`cy` in view px, drag it
  with `mouse.down` and several small `move`s); the browser's row is
  `[data-section-row="on|off"]` (eye "Hide section" / "Show section"). While
  the panel is open with no section it is *choosing*, and a click in the view
  picks a plane or face for the section: press Done (Remove closes it)
  before clicking model faces. On the Wall bracket a click at (2.4, 0, z) on
  the inside wall lands on Sketch1's outline (a sketch curve on the same
  plane): use y = 20. Sketch mode leaves the camera looking at the sketch:
  press Shift+1 and re-read the projector. The two `section-*.png`
  screenshots (full page, dark and light) come from CI's image.
- **Print aids e2e** (`e2e/print-aids.spec.ts`, P3-10): the 3D Print tab's
  Prepare group has the buttons "Place on Bed", "Print Info" and
  "Overhangs" (`/^Overhang/`). The Print Info panel is the region "Print
  Info" (`data-print-state` `empty`/`pending`/`ready`/`error`, rows
  `[data-print-row="volume|printed|weight|filament|cost"]`, the native selects and
  fields "Material" (`selectOption('petg')`, `'custom'`), the textboxes
  "Density", "Walls", "Line width", "Infill" and "Price per kg" and the radios
  "1.75 mm" / "2.85 mm"; a density of 0 or an infill of 150 shows the
  expression error and isn't taken). The material test sets Infill to 100
  first, so its numbers are P3-10's solid ones; the walls/infill/cost test
  (P4-12) makes the Box tool's 20 mm cube (8 cm³, 2400 mm² → 3.04 cm³ printed
  at 2 × 0.45 mm and 15 %, 3.8 g of PLA, 0.09 at 25 per kg), changes the walls,
  the line width and the price, rounds a decimal wall count, and checks that
  Ctrl+Z undoes the Box but not the settings and that a reload keeps them. The
  Overhang panel is the region
  "Overhang Analysis" (textbox "Angle" with `exact: true`, combobox "Down"
  with `selectOption('+z')`, checkbox "Show overhangs", buttons "Done" and
  "Remove"); the Viewport region's `data-overhang` reads "down=-z angle=45
  faces=1 triangles=11 area=226 bed=90" (counts are over the shown bodies;
  `… off` while the shading is off; absent with no analysis), the
  browser row is `[data-overhang-row="on|off"]` (eye "Hide overhang").
  The wall bracket is an L in XZ extruded ±40 mm along Y: its outer wall
  face (x = 0, 80 × 60) is the one to lay down; look at it with Shift+6 and
  click (0, 0, 30) after the camera settles (a point 1 mm from the
  L-shaped end faces or the wall's thin edges hits an edge or the wrong
  face). Laying it down makes `data-bodies` "Bracket:12:60,80,40". The
  dialog is the region "Place on Bed dialog" (button "Face"); the
  context entry is `[data-marking-entry="placeOnBed"]`. The dialog also has
  the textbox "Spin" (`exact`, an angle; 90 deg swaps the bracket's X and Y
  extents: "Bracket:12:80,60,40") and its Face field takes several faces.
  The Overhang panel's "Use selected face" button (enabled while one flat
  face is selected) makes its outward direction "down": `data-overhang`
  reads `down=face(-1,0,0) angle=45 …`, the Down combobox has the value
  `face` ("Picked face") and the browser row says "Overhangs · Face · 45°".
  The overhang shading itself is a shader patch, so it isn't in the counts:
  `overhang-shading-chromium-linux.png` (the Viewport region, +Z down in the
  home view) is checked in, made in CI's image like the section shots.
  Kernel-side tests:
  `pnpm vitest run packages/kernel/src/features/place-on-bed`.
- **Wall thickness e2e** (`e2e/wall-thickness.spec.ts`, P5-06): the 3D Print
  tab's Prepare tile "Wall Thickness" opens the region **"Wall Thickness"**
  (`data-thickness-state` `on`/`off`): the textbox **"Minimum"** (`exact`,
  default "0.9 mm"), the checkbox "Show thin walls", the result lines in
  `[data-thickness-result]` ("No wall is thinner than 0.9 mm.", "Thinnest
  wall: 1.00 mm", "Thin area: 3200 mm² in 1 body") and the buttons "Done" and
  "Remove". The Viewport region's **`data-thickness`** reads `min=1.5 thin=4
  area=3200 thinnest=1 bodies=1` (`… off` while the shading is off, `pending`
  while measuring, absent with no analysis, `thinnest=none` with nothing
  measured), the browser row is `[data-thickness-row="on|off"]` (eye "Hide
  wall thickness" / "Show wall thickness", label "Wall thickness · 0.9 mm").
  The numbers are display-mesh estimates: a 40 × 40 × 1 plate is `thinnest=1`
  with `area=3200` at a 1.5 mm minimum, a 20 mm cube shelled to 2 mm
  `thinnest=2` (its rim measures the wall's height, not its thickness). The
  spec logs the Wall bracket's time from click to counts for ADR-0072's
  Results and fails on any console error (the shading is a shader patch: a
  broken one shows there, not in the counts).
- **Hole e2e** (`e2e/hole.spec.ts`, P3-04): press `h` (after Shift+1 and a
  settled `projector`); the dialog is the region "Hole dialog" / "Edit Hole1
  dialog". While Plane is the pick field a click on a face picks it **and
  places the hole** at the clicked point (`X`/`Y` textboxes read "4.98 mm":
  compare with `toBeCloseTo`, or `fill` exact values). The Box tool's cube with
  Length, Width and Height 40 mm has its top at z = 40 (click world
  `(x, y, 40)`). Fields: buttons "Plane" ("XY plane", "1 face") and "Points"
  ("Or pick sketch points", "2 points"), comboboxes "Preset" (`selectOption({
  label: 'M4 clearance' })`, values `m4-clearance`, `m3-insert`, `custom`),
  "Type" (`simple`/`counterbore`/`countersink`) and "Extent"
  (`through`/`blind`), textboxes "Diameter" and "Depth" (`exact`), "Drill
  point", "Counterbore diameter"… and the checkbox "Flip". X and Y are gone
  once points are picked; Depth and Drill point show only for Blind. A
  through hole in the cube is `Body1:7:40,40,40`, a blind one with a cone 8,
  a counterbore adds two faces. Sketch points on the cube's bottom (an XY
  sketch) are occluded from above: click Points, press Shift+3 and pick them
  from below with a settled `projector`. Volumes from the 3MF are a
  tessellation short (`toBeCloseTo(v, -2)` for several holes). A hole that only
  touches the body says "The cut doesn't remove anything". Kernel-side, the
  golden table is `pnpm vitest run -u packages/kernel/src/features/hole`.
- **Pattern e2e** (`e2e/pattern.spec.ts`, P3-07): the tools are Solid ›
  Pattern's tiles (`pickTool(page, 'Rectangular Pattern' | 'Circular Pattern' | 'Path
  Pattern')`); dialogs are the regions "Rectangular Pattern dialog"…, fields
  the buttons "Direction"/"Axis"/"Path" (`exact: true`) and textboxes "Count",
  "Distance" (`exact`), the combobox "Pattern" (Mirror's is "Mirror") with
  `bodies`/`features`, and for features a list of checkboxes named like
  `Cylinder1 cut` (`[data-feature]`). The ghosts are `data-preview` ("new
  new" for two copies, one `cut` for a repeated hole, "cut skip" with a
  skipped instance); handles `data-manipulators="distance:distance1
  count:count1 toggle:skip"` / `"angle:angle count:count toggle:skip"` /
  `"distance:distance toggle:skip"` (each kind and field listed **once**, even
  with a dot per instance). **P4-12's handles:** an instance's dot is
  `[data-instance-toggle="1x1"]` (with `data-skipped` on it), the count handle
  and the path's distance handle are `[data-manipulator-handle="count1"|"count"|
  "distance"]` whose `cx`/`cy` are px in the viewport, and the read-only
  "Skipped" line is `[data-labels="skip"]` (its text, "None" when empty, with a
  "Clear Skipped" button). A pattern's handles are drawn 14 px clear of the
  geometry (`lift`), so a drag must start where the handle is drawn but is
  measured from the origin: drag to the projection of a point on the *shaft*
  (the direction line's origin is the report's `series.first`, which for a
  features pattern is the *tool's* centre, not the body's), and take the count
  or the distance from what the drag reads, not from where the head was. The
  three new tests: a 3 × 2 pattern of a cut with a dot clicked out (five holes,
  one undo step), a count handle dragged two spacings (count 5), a circular
  one round the arc, and the path's distance handle. After switching to
  Features the pick field is stale: click the "Axis"/"Plane" button first. The
  Z axis is pickable above a 20 mm cube at (0, 0, 25…45) in the home view; a
  mirror plane at YZ needs a click where no body is in front (the spec tries
  a few points). Volumes read from a 3MF are a tessellation short of exact
  (`toBeCloseTo(v, -1)` for a cylinder hole). A copy body is "Body2" and so
  on in creation order.
- **Press/Pull e2e** (`e2e/press-pull.spec.ts`, P3-08): with a face selected
  (hover until `data-model-hover` is a `face:`, then click; the cube from the
  Box tool has its top at (0, 0, 20)) press `q`: the dialog is the region
  "Offset Face dialog" / "Edit Offset Face1 dialog" (the chip's name has a
  space, `chip(page, 'Offset Face1')`), the pick field the button "Faces"
  (`exact: true`: "1 face", or more once a smooth chain came along: a cube's
  faces are alone, a rounded body's are not) and the textbox "Distance"
  (`exact`, 2 mm by default, positive out). A cube pulled 5 mm is
  `Body1:6:20,20,25`; a too-far distance says "can't move in by 25 mm: that is
  too far for this body (max ≈ 15 mm)" in the region "Feature status". A
  cylinder's wall is picked at `(r·0.707, −r·0.707, h/2)` in the home view. `q`
  on an edge opens "Fillet dialog" ("1 edge"), on a profile selected in the
  model "Extrude dialog"; with nothing selected a toast says "Select a face to
  move, an edge to round or a sketch profile to extrude, then press Q." The
  marking menu's wedge is `[data-marking-slot="pressPull"]` (enabled since
  P3-08). Kernel-side: `pnpm vitest run -u packages/kernel/src/features/offset-face`
  rewrites the golden table; the facade's native harness lives in the
  scratchpad (`#define private public` over `extrudo_facade.cpp`, sweeps of
  every face at eight distances found no heap trap, unlike the shell's).
- **Fuzzing** (`packages/kernel/src/fuzz.test.ts`, P3-13): 200 seeded steps
  per fixture in CI; `FUZZ_STEPS=1500 FUZZ_REPORT=1` for a long run with a
  report (counts of every feature message, warm recompute times; the report
  shows as a soft failure), `FUZZ_SEED` for another sequence, `FUZZ_ONLY=B9`
  for one fixture (a slow one on its own), `FUZZ_HEAP=n` for heap samples. Warm-cache heap of the revolve document: `HEAP_RUNS=n
  … memory.test.ts -t "warm cache"` (about 0.3 s a run; `HEAP_MAX_ENTRIES`,
  `HEAP_ONLY=G|R|F|GF|RF|GR`): it grows about 11 MB per 100 recomputes with
  all three revolves, not with any subset (ADR-0050 §6's 2026-10-06 amendment,
  the item closed): `HEAP_ATTRIBUTE=1` prints which `Kernel` call grew the top,
  and it is `mesh` alone, on **fresh** shapes (`spikes/p4-12-heap-growth` is
  the harness; `NOMESH`/`MODE=same` are flat). Cold recompute times per fixture:
  `HEAP_BOUND=1 … kernel/src/heap-bound`, and the display mesh's fingerprint:
  `pnpm vitest run -u packages/kernel/src/mesh-golden`. **Our OCCT
  build already links mimalloc** (the toolchain default); cures tried and
  rejected are in the ADR (dlmalloc grows smoothly at the same rate and is 30 %
  slower; `BRepTools::Clean`, meshing a copy and the mimalloc options don't
  cure it). Silhouette
  cost: `BENCH=1 … viewport/silhouette.test.ts`; booleans of many tools:
  `BENCH=1 … kernel/src/boolean-bench.test.ts`. A native OCCT harness for
  such experiments builds in the image by its digest (the tag shows as
  `<none>` on the Arch workstation): `docker run --rm --user 0 -v
  <dir>:/w -w /w --entrypoint sh <image id> -c 'em++ … && node h.js'`.
- **The fuzzer covers B1-B10 (B8 and B10 since P4-11) plus the P4-01 sweep
  fixture** (P3-17, ADR-0038/0047 amendments; B8 and B10 at the full 200
  steps — 70 s and 14 s — and both load the bundled font first, as the worker
  does, so B8's emboss has ink to stand on while it is edited). **B9 is back in
  the default run since P4-12 (ADR-0067 §H2) at 200 steps with its own 60 s
  step limit, and B8 has a 30 s one**; `FUZZ_ONLY=B9` runs a single fixture.
  The old reason B9 was out (`FUZZ_B9=1`, 6 steps) was two things, both fixed
  or known: `mergeTools` asked OCCT for the exact distance between two thread
  tools, and a thread of about 400 turns corrupted the WASM heap. B9 runs 120
  steps at a 90 s step limit (measured on a 4-core machine: 5 ms median, 18 s at
  the 95th percentile, 39 s the slowest, which builds a thread), B8 gets 40 s
  (its `× 10000` dimension took 11.8 s).
  **`mergeTools` now merges two tools whose boxes overlap without that distance
  when either has more than `HEAVY_TOOL_FACES` (200) faces**
  (`operation.ts`'s `isHeavyTool`); light tools still get the exact test, which
  matters: the distance between the tools of two 36- and 30-turn threads is
  **277 s** in one call (`thread.test.ts` times every `Kernel` method to find
  it), while B9's own few-turn threads cost seconds. **The 400-turn heap trap is
  OCCT running out of memory, not a bug** (`spikes/p4-12-threads/` bisected it:
  `IntCurvesFace_Intersector`'s constructor unwinding into a virtual call on a
  null object, the heap 403 MB → 1903 MB at 350 turns and over 2 GB at 400),
  and the tooth is now cut out of the ring in pieces of `THREAD_CHUNK` turns,
  so a boolean only meets one piece's faces (600 turns build that way);
  `MAX_TURNS` stays 150 because a piece-wise cut costs 0.35 s a turn, so 150 is
  already 25-40 s:
  B5's `FUZZ_SEED=7` and `FUZZ_SEED=2026` at `FUZZ_STEPS=1000` reached a
  pattern of 2 × 20 instances that took 55 s; it takes 2.4 s since `operate`
  finds targets solid by solid (`pattern-bench.test.ts`: `BENCH=1`, prints the
  time per `Kernel` method), and both sequences run in the default test.
  **A wasm trap (`RuntimeError: null function or function signature
  mismatch`) is a null-pointer call inside OCCT**: find it by dumping the
  failing body (`kernel.writeStep` in a wrapper around the call), reading it
  back in a native harness built with `-g2 -sNODERAWFS=1` (function names
  appear in the trace) and sweeping the parameter in separate processes. The
  fillet one is `Geom2dAdaptor_Curve::EvalD1` under `ChFi3d_Builder::StartSol`
  when a round's contact line leaves a face through a wall parallel to the
  edge; the facade refuses it first (`filletRollsOff`). **Never `scope.keep`
  inside a loop or round that can still throw**: keep after the last thing
  that can fail (a later failure leaks what was kept; strict leaks catches it).
- **Accessibility e2e** (`e2e/a11y.spec.ts`): axe per screen, both themes;
  a new violation fails with its node HTML. Add an entry to `KNOWN` only with
  a reason. Toasts behind a modal dialog are inert for assistive tech (and
  for `getByRole`): say results inside the dialog (the Versions dialog's
  status line "Versions status").
- **Versions e2e** (P3-13): per-row "Delete V3" buttons and "Delete older
  versions" (shown past 10) open an `alertdialog` "Delete V3?" / "Delete
  V1?" with Cancel/Delete.
- **IndexedDB and the second tab** (P4-09's follow-up): the database is at
  version 2 (the linked folder's handle store), and an upgrade is held up by
  **every other tab of this origin** — silently, or the app never finishes
  opening. `openDatabase(factory?, name?, { onBlocked, onVersionChange })` is
  how storage says both (the `blocked` request keeps waiting and succeeds when
  the others let go; a connection gets `onversionchange` → the callback, then
  closes), and `webPlatform()` words them through `platform/databaseNotice.ts`:
  "Close Extrudo's other tabs to finish updating." while the open waits, and in
  the tab that lets go "Extrudo was updated in another tab. Reload this tab to
  keep working." with a Reload button that saves first. Its store is wrapped in
  `closedStorage`, which replaces **only** the browser's closed-connection
  `InvalidStateError`. The toasts need a page before the app is mounted: the
  notification store is one per page (`appNotifications`) and `main.tsx` draws
  `ToastsOnly` while `webPlatform()` runs. `e2e/storage.spec.ts` covers it with
  two pages of one context: the second tab's init script makes
  `indexedDB.open` throw (so it holds no connection of its own) and keeps the
  real one as `window.__idbOpen`, which then upgrades the database by one
  version.
- **Newer files in e2e**: write `projects/<id>/document.json` in OPFS from
  `page.evaluate` (see `storage.spec.ts`) to simulate a newer Extrudo.
- **Split Body, Scale and Draft e2e** (`e2e/split-body.spec.ts`,
  `scale.spec.ts`, `draft.spec.ts`, P3-08): the tools are the Modify tab's tiles
  (ADR-0079: `pickTool(page, 'Split Body' | 'Scale' | 'Draft')`); dialogs are the regions
  "Split Body dialog", "Scale dialog", "Draft dialog" (and "Edit Split Body1
  dialog"…). Split: buttons "Bodies" and "Plane", combobox "Keep"
  (`both`/`above`/`below`); a cube from the Box tool split by YZ is
  `Body1:6:10,20,20 Body2:6:10,20,20`. Scale: combobox "Scale type"
  (`uniform`/`non-uniform`), textboxes "Scale factor", "X factor"… (`exact`),
  checkbox "Create copy"; a factor of 1 previews as a *warning*. Draft: buttons
  "Faces" (`exact`) and "Plane", textbox "Angle" (`exact`, default "3 deg"),
  checkbox "Flip", `data-manipulators="angle:angle"`. A plane field picks like
  Create Sketch (no `data-model-hover`): click an origin plane's square beside
  the body in the view a new design opens with (the camera is wide enough
  there; after Shift+1 the cube covers the squares). Kernel golden tables:
  `pnpm vitest run -u packages/kernel/src/features/split-body` (`scale`,
  `draft`). The facade's native harness for these lives in the scratchpad
  (sweeps of 5,544 drafts and the scales of 11 bodies trapped nothing).
- **Benchmark B6 e2e** (`e2e/benchmark-b6.spec.ts`): three Box dialogs with
  parameter expressions (Operation `join` for the arm and the lip), Draft
  faces picked in the home view and the arm's far side from Shift+5, the
  plane picked on the plate's front face, five fillet edges picked in the home
  view. Radius 3 mm is refused on the 5 mm plate (its front and back top
  fillets meet), which the spec avoids. About 18 s alone.
- **Benchmark B9 e2e** (`e2e/benchmark-b9.spec.ts`, P4-11): a threaded bottle
  cap and its thread adapter, 240 s timeout, about 60 s alone. Facts a later
  agent needs: **a Shell that removes the bottom face leaves the cup open
  below and closed at the top**, so the inside wall is only pickable from the
  bottom view (Shift+3, still the current one after the shell) and only *on the
  wall itself* — a point inside the hollow picks the flat lid above it and the
  Thread dialog answers "Pick round faces: a shaft's side or a hole's wall"
  (the message is the Faces field's hint, not the region "Feature status").
  Sketch2 is drawn on 10 mm grid points (0,−30) (10,−30) (10,−20) (20,−20)
  (20,−10) (0,−10) (0,−30) after `zoomOutTo` around the **middle of the view**
  (a point of the model can be under the palette, and a `wheel` at a panel
  doesn't zoom), and its five dimensions are picked with the label placement
  deciding the orientation (above/below a slanted pair = x, beside it = y);
  the label's click must be on screen and on empty space — z = −40 mm is off
  the screen at the fitted zoom. **Five dimensions fix the section, a sixth is
  over-constraining.** Bodies are named `Body1`, `Cap`, `Adapter`: the free
  `Body1` is the adapter's once the cap's row is renamed. Sizes after the
  threads: `Cap:<n>:32,32,14` (an internal thread leaves the outside alone)
  and `Adapter:<n>:23.8,23.8,20` — each thread turns its step down to its
  crests (M20 → Ø19.8, M24 → Ø23.8, so the Ø28 collar as drawn ends at
  Ø23.8). The parameter change is `capDia = 40 mm`, `adapterLow = 24 mm`: the
  cap becomes `Cap:<n>:40,40,14` and the adapter `Adapter:<n>:35.8,35.8,20`
  (M39 in the cap's Ø36 bore, M24 on the spigot, M36 on the Ø36 collar — the
  coarse series goes to M64 since P4-11, so `autoThread` has a fit for every
  bore a bottle cap has).
- **Benchmark B8 e2e** (`e2e/benchmark-b8.spec.ts`, P4-11): a name tag, 19 s
  alone, 180 s timeout. Facts a later agent needs: **a plate thin enough to
  snap hides one corner's vertical edge from any one view**, so Fillet1 takes
  three picks in the home view (Shift+1) and the fourth in the back view
  (Shift+5, whose far corner is the home view's hidden one); zoom out only
  *after* the dialog is open, because with no dialog the pick takes vertices and
  a zoomed-out 3 mm edge has the display mesh's own vertices inside the 8 px
  tolerance (`clickEdge` on a midpoint then fails). **A text sketched on the face
  it is embossed onto is pickable in the model** (`pickStack` ranks a whole text
  before a face for coplanar hits), so the Emboss tool's pre-selection fills
  "1 text" with no construction plane — unlike `e2e/emboss.spec.ts`, whose
  letters have to be clickable in the clear. The text's anchor needs "Snap to
  grid" off (the grid would snap it to the origin) and its ink is read from
  `data-text-bounds`: `EXTRUDO` at an 8 mm cap height is 50.8 mm wide, so it is
  centred on x = 4 to fit between the hole's edge and the plate's end (on x = 5
  the last letter overhangs the plate by 0.3 mm). The 3MF's volume sits between
  the plate's (exact: four fillets, one hole) and the plate's plus the letters'
  ink area × `letters` (about 32 % of its bounding box in Inter).
- **Benchmark B10 e2e** (`e2e/benchmark-b10.spec.ts`, P4-11): a cable chain
  link, 31 s alone, 240 s timeout. Facts a later agent needs: **a sweep carries
  its profile exactly where its sketch drew it** (the facade's no-contact
  `pipe.Add` leaves OCCT's placement cancelled), so the section has to be
  *centred on the path* — drawn centred on the sketch's origin instead, the
  link's walls came out 6 mm thick (`Link:<n>:29,10,26` and a volume 11.7 % over
  the centreline's perimeter × the section); centred on the path's own line it is
  `Link:<n>:26,10,23` and 2425.5 mm³, exact. **The first curve picked is where
  the sweep starts** (the facade's `pathWire` starts the wire with the first
  piece), every path pick must be ≥ 5 mm off the section's own curves (both are
  sketch curves, nearest first), and the *profile* has to be clicked in the half
  of the section the path is not in front of (from the home view the ray meets
  the YZ plane before the XZ one for a point at negative y). **A side face is
  picked in the view that looks square at it** (the front view, Shift+4): the
  plane picker takes an origin plane unless the face is at least as near, and an
  origin plane lies in front of a vertical face in an oblique view — the hole's
  plane comes out "YZ plane" however exactly you click. A hole on a picked face
  defaults to `through`, so set Extent to blind before its Depth field exists.
  The Ø(`pin` + 2 x `tolerance`) hole is wider than the 3 mm wall it is drilled
  into and severs it (the link stays one solid, 32 → 26 faces as the hole grows):
  a printable link needs `wall` ≥ `pin`. The pattern's copies are named from
  their instance: `Link`, `Body1`, `Body2` (P3-07), and their y positions step
  `pitch` in one direction (−5, 25, 55 at 30 mm). Reading the hole's diameter
  after the parameter change: open its chip (double-click) and read the
  expression input's value line, "= 5.60 mm".
- **Thread e2e** (`e2e/thread.spec.ts`, P4-02): Modify › Modify › Thread
  (`pickTool(page, 'Thread')`, ADR-0079); the dialog is the region "Thread
  dialog" / "Edit Thread1 dialog": button "Faces" (`exact`, "1 face"), combobox
  "Size" (values `auto`, `m8`, `m16x1.5`, `unc-1q4-20`…, `custom`; Diameter and
  Pitch exist only off `auto`), "Profile" (values `iso` default, `trapezoidal`,
  `buttress`, `bottle`) and, only for `buttress`, "Load flank" (`start`/`end`),
  "Extent", "Hand", textboxes "Length", "Offset", "Starts" (`exact`, unitless, "1"; 2 gives the same
  `19.8,19.8,20` with more faces),
  "Tolerance" (`exact`), checkboxes "From the other end", "Lead-in chamfer". A
  thread takes seconds to preview (wait up to 60 s). The default Ø20 cylinder
  threaded to fit is `Body1:<n>:19.8,19.8,20` (M20 less twice the tolerance);
  Size `auto` fits ISO 261 coarse from M2 to M64 (`METRIC_COARSE` in
  `packages/core/src/thread.ts`: a bore takes the thread just above it, a shaft
  the largest thread inside it), and a thread of more than `MAX_TURNS` (150,
  `packages/kernel/src/features/thread.ts`) turns is refused before anything is
  built — over `MAX_TURNS` it takes minutes of booleans, and above about 400
  turns OCCT's boolean runs out of memory and traps (ADR-0067 §H2).
  Kernel: `pnpm vitest run -u packages/kernel/src/features/thread` rewrites the
  golden table; `BENCH=1` times threads (`features/thread-bench.test.ts` times
  B9's `capDia` × 2). P4-12's taper test (ADR-0056's third amendment) drafts a
  Ø21.97 Cylinder 1.79 deg about XY (Draft, `e2e/draft.spec.ts`'s way: its
  wall at (0, −10.985, 10), the plane on XY's square), picks the cone's wall at
  half height and sets Size `npt-1q2` (Pitch reads "1 in / 14"): the dialog's
  `[data-info="designation"]` reads "NPT 1/2" and `data-bodies` keeps z = 20
  with x and y at least 0.1 under the drafted cylinder's (whose display box
  reads 21.9 or 22 across).
- **Customizer e2e** (`e2e/customizer.spec.ts`, P4-07): the panel is the region
  "Customizer" with `data-customizer-state` (`empty`, `parameters`), rows
  `[data-customizer-row="<name>"]` (`data-out-of-range`), the sliders
  `[data-customizer-slider="<name>"]`, the groups as regions named after their
  group ("Size", "Walls"), the combobox "Configuration" and the button
  "Configuration actions" (Save as…/Update/Rename/Delete). A row's value field is
  the textbox "Expression of `<name>`"; in the Parameters dialog a row's star is
  the button "Show `<name>` in customizer" and the details row adds the textboxes
  "Min/Max/Step of `<name>`" and the icon buttons "Clear Min/Max/Step of
  `<name>`". The Configuration select has no option text hook: read the selected
  option's text through `evaluate` (e2e/ has no DOM library, so cast the element
  to `{options, selectedIndex}`). **A slider drag is real**: down, several
  moves, up on `[data-customizer-slider]`; the value steps from the range, and
  **Ctrl+Z right after it undoes the whole drag** — the slider keeps the focus,
  so `useShortcuts`' `ownsKeys` is what lets the key through. `data-bodies` sizes
  are rounded to 0.1 mm and drop trailing zeros ("Body1:6:40,20,20"), so compare
  numbers, not strings, after a drag. The Storage box template opens at
  `Body1:11:80,60,40` with width/depth/height/wall exposed and "Small"/"Large"
  configurations; the home card is `getByRole('button', { name: 'Start from the
  Storage box template' })`.
- **Onboarding e2e** (`e2e/tutorial.spec.ts`, `e2e/onboarding.spec.ts`, P3-12):
  the home screen now has the button "Take the tour" (and "Dismiss the tour"; it
  shows until the `onboarding.tour` preference isn't `new`, so a fresh context
  always has it; it doesn't match "New design") and the list "Templates" with
  the buttons "Start from the Wall bracket | Storage box | Box with a lid | PCB
  enclosure template" (their description is the one line). The tutorial card is
  the region "Tutorial" (`data-tutorial-step` `sketch`, `rectangle`, `dimension`,
  `extrude`, `round`, `finished`; text "Step 2 of 5"; buttons "Skip step", "Close
  tutorial", "Keep designing"), the ring round the control it points at is
  `[data-tutorial-ring="<tool id>"]`, the empty-design hint `[data-viewport-hint]`.
  Toolbar tiles carry `data-tool`. A tooltip is `getByRole('tooltip')` with a
  `kbd` and, for the thirteen tools with a clip, `video[data-tool-demo="<id>"]`
  (`data-playing` false under reduced motion). **Radix keeps a tooltip open
  when the pointer jumps away in one move** (its grace area): move with
  `mouse.move(x, y, { steps: 5 })` before expecting it gone. The tour walks
  the real flow in about 11 s: rectangle corners at (−20, −10) and (20, 10), a
  dimension on the bottom side labelled at (0, −16), the profile picked at the
  world origin in the home view, an edge picked at (0, −10, 15) for the fillet.
  `e2e/record-assets.spec.ts` (RECORD_ASSETS=1 only) is the demo recorder.
- **Sweep, loft and coil e2e** (`e2e/sweep-loft-coil.spec.ts`, P4-01): the tools
  are Solid › Create's tiles (`pickTool(page, 'Sweep' | 'Loft')`, `startPrimitive(page,
  'Coil')`); dialogs are the regions "Sweep dialog", "Loft dialog", "Coil dialog"
  ("Edit Sweep1 dialog"…). Sweep: buttons "Profiles" and "Path" (`exact: true`;
  "1 edge"), combobox "Orientation" (`follow`/`fixed`), textboxes "Twist" and
  "End scale". Loft: button "Sections" ("2 sections"), checkboxes "Ruled" and
  "Closed". Coil: button "Plane" ("XY plane"), comboboxes "Type", "Direction",
  "Section", "Section position", textboxes "Diameter", "Revolutions", "Height",
  "Pitch" (the one the type doesn't use is absent), "Taper angle", "Section
  size", `data-manipulators="distance:diameter distance:height"`. The Sweep
  dialog's read-only Placement line is `[data-info="placement"]`
  ("Profile on the path's start." or "Profile 31.6 mm from the path's start:
  the sweep carries it where it is drawn."). The default
  coil is `Body1:7:22,22,22` (a face per turn; the wire is centred on the start height, half of
  it below the plane). The spec's profile is a circle at (40, 0) beside a Box
  cube, swept along the cube's edge at (10, −10, 10): the profile need not
  touch the path. Kernel-side, the golden tables are `pnpm vitest run -u
  packages/kernel/src/features/sweep-loft-coil`; the facade's native harness is
  `bash spikes/p4-01-harness/run.sh` (and `run.sh leaks 600`, about 15 min).
- **Text e2e** (`e2e/text.spec.ts`, P4-03): the tool is `text` (Shift+T) in the
  Create menu (`menuitem` `/^Text/`, "Text Shift+T"); its panel is the region
  "Text" with the textarea "Text", the `Font` select (values like
  `inter-regular@1`), the three `aria-pressed` alignment buttons and the
  `Height` textbox (`10 mm`), plus "OK Ctrl+↵" and "Cancel Esc". It appears
  only **after** the click places the anchor (the first Esc closes the panel,
  the second ends the tool), and a font other than Inter is fetched when it is
  picked, so the ink (and `data-text-bounds`) arrives a moment after OK. A text
  in the model is one pick whatever letter was hit: `data-model-selection` is
  `sketchEntity:<sketch>/<text>`, and the extrude's `Profiles` field reads
  **"1 text"**. "Extrudo" at 10 mm is `profiles=9 holes=2` and extrudes 2 mm
  into 7 bodies, all `…:…,2` in `data-bodies`; the `o` is the four-face one
  (two caps plus its counter, so the counter is a hole, not a body). The
  selection panel's `Text` textarea and `Height` textbox edit a placed text
  (commit on blur); reopening a sketch by double-clicking its chip rolls the
  extrude back, and Finish Sketch rolls it forward. The Viewport region's
  **`data-text-bounds`** is `<sketchId>.<textId>:x=min..max:y=min..max` in
  sketch mm per drawn text — the alignment and height assertions read it, and
  a text without its font has none (the attribute is absent).
- **User fonts e2e** (`e2e/user-fonts.spec.ts`, P4-03b): both Font selects
  (`Font` in the Text panel and in the Selection panel) list the bundled fonts,
  then an `optgroup` "This design" with the document's attachments, then
  "Add font…" (`value="add"`); choosing it opens the platform file picker, so
  the test waits for `page.waitForEvent('filechooser')` beside the
  `selectOption({ label: 'Add font…' })` and calls `chooser.setFiles(path)`
  (an existing file, or `{ name, mimeType, buffer }` written to
  `info.outputPath()`). What comes back: the select's value becomes
  `attachment:<id>`, `data-font-hint` is under the select, and "Hi" in
  `packages/fonts/fonts/fredoka-semibold.ttf` is `profiles=3 holes=0` (its own
  name reads "Fredoka Light", and its dot is a solid of its own), which
  extrudes 2 mm into **3 bodies**; an export and an import of the design keep
  them, with nothing saying a font is missing (the missing-font notice is a
  `status` toast: "1 font is missing from the file; its texts show without
  letters"). A file that isn't a font is refused with a toast
  ("This file isn't a font Extrudo can read: it doesn't look like a font
  file.") and the select keeps the font it had.
- **Tolerance e2e** (`e2e/tolerance.spec.ts`, P4-08): the panel is the region
  "Print tolerance" (`data-tolerance` `unset`/`set`, `data-tolerance-usage` for
  the count line) with the textbox "Print tolerance" and the `aria-pressed`
  buttons "Tight 0.1 mm", "Normal 0.2 mm", "Loose 0.3 mm"; the tile is
  "Tolerance" (`exact`) in the 3D Print tab's Prepare group and **toggles** the
  panel, so close it (Done) before another dialog covers it. The Parameters
  dialog is a **Home** tile since ADR-0079, so `pickTool(page, 'Parameters')`; there the row's field is "Expression of tolerance" and its value
  shows as "= 0.20 mm" under it. One Ctrl+Z per change (the panel's write is one
  command): the edit, then the parameter. A hole's M3 clearance preset then reads
  `3.4 mm + 2 * tolerance` (counterbore diameter `6 mm + 2 * tolerance`, depth
  plain `3.3 mm`) with the combobox still on `m3-clearance`, and without the
  parameter `3.4 mm`. Picking the hole's face follows `e2e/hole.spec.ts`: the
  home view (**Shift+1**, not Shift+2) and `projector` — the projected surface
  point is the click in any view.
- **Spline and conic e2e** (`e2e/spline-conic.spec.ts`, P4-05): both tools come
  from the Create menu (`pickTool(page, 'Control Point Spline')` and `'Conic'`;
  neither has a key). A control-point spline is four clicks on grid points and
  Enter (`counts` then reads `splines: 1 points: 4`), a line from its last
  control point back to the first closes the region
  (`data-sketch-profiles` is `profiles=1 holes=0`), and a click on the dome's
  apex selects the curve, so the panel says "Control points: 4". A conic is
  three clicks (the heads-up box shows Rho from the first), the panel's Rho
  field takes 0.3 (`getByRole('textbox', { name: 'Rho' })`, `0.5` to `0.3`),
  a line closes it, and Finish Sketch then a profile pre-selection
  (`data-model-selection` starting `profile:`) and E extrudes 5 mm into one body
  40 mm wide whose height is the rho's share of the shoulder's (0.3 × 15 mm).
  A filled-in conic takes a moment to preview: `data-preview-status` polls up
  to 30 s. **P4-12**: a control spline clicked round (−30, −10) (30, −10)
  (30, 30) (−30, 30) and back on (−30, −10) is closed (the panel's checkbox
  "Closed" is checked; select it at (0, −8.33), where the periodic curve runs
  between the two lower poles) and alone is `profiles=1 holes=0`; a fit wave
  through (−40, 0) (−20, 20) (0, 0) (20, 20) (40, 0) trimmed with `t` at (20, 20)
  against a line at x = 10 shows "Control points" (the point count can stay the
  same: the piece has as many poles as the fit had points), and a click at a
  fit point after Ctrl+Z selects the **point** (points win the pick); `o` on
  the wave at (−20, 20), the pointer above and `2` makes `splines: 2` with no
  dimension.
- **Rib e2e** (`e2e/rib.spec.ts`, P4-10): the tool is `rib`, a tile of Solid ›
  Features after Emboss (`pickTool(page, 'Rib')`, no key); its dialog is the region "Rib
  dialog" / "Edit Rib1 dialog" with the button "Line" (`exact: true`: a sketch
  line reads **"Line · Sketch3"**, the sketch it is in), the `Thickness`
  textbox (`exact`), the `Thickness side` combobox (`both`/`one`/`other`) and
  the `Flip` checkbox; `data-manipulators` reads `distance:thickness
  arrow:flip`. The Line field takes a sketch line **selected in the view**
  (pre-selection) or one picked while the dialog is open; the hover reads
  `sketchEntity:`. Two things to know: the Line tool's key is `l` (`r` is the
  Rectangle, and a rectangle's profile takes the pick in front of a line on the
  same plane), and it needs **two Escapes** (the first ends the chain). The
  Wall bracket's own sketch lies in the same plane as a new sketch on XZ and its
  profile face takes every pick along a diagonal, so the spec hides it and
  Sketch2 with their eyes for the pick. The volume is read from a 3MF export
  (`exportModel` + `objectsOf3mf`, the signed volume of each triangle's
  tetrahedron); the bracket is `Bracket:12:40,80,60` and the rib takes it to 16
  faces. Flipped, the preview errors: the region "Feature status" inside the
  dialog says "The rib doesn't close against the body", `data-preview-status`
  is `error`, `data-dialog-valid` is **absent** (it is there only while the
  dialog can commit) and OK is disabled; the bodies drawn are the ones from
  before the draft.
- **Timeline groups e2e** (`e2e/timeline-groups.spec.ts`, P4-09): the Wall
  bracket template (Sketch1 Extrude1 Sketch2 Extrude2 Fillet1 | Plane1). A run
  is picked with `chip.click()` then `click({ modifiers: ['Shift'] })` and
  grouped from the chip's right-click menu, whose first item reads **"Group 2
  features"**; an open group is `[data-group-band]` with `[data-group-label]`
  holding its name, a folded one `[data-group][data-group-collapsed]` with the
  accessible name **"Group1, 2 features"** (folder glyph, count, worst status)
  and an `IconButton` "Expand Group1" beside it. F2 renames a chip (focus it,
  then the textbox "Rename Group1"); the group's own menu (`click({ button:
  'right' })`) has Rename, Expand/Collapse, Hide/Show, Suppress/Unsuppress and
  "Ungroup 2 features". The marker slider skips a folded group's gaps: Step
  back from 6 goes 5, 4, 3, 1 (never 2), and folding a group the marker is
  inside opens it again. The marking menu's list carries
  `[data-marking-entry="group"]` after two chips are picked. The bracket's
  members grouped are Extrude1 + Sketch2 (adjacent, so the group may straddle
  the marker), and suppressing them leaves the view with no bodies: the features
  after them lose the references they had.
- **Linked folder e2e** (`e2e/linked-folder.spec.ts`, P4-09): the File System
  Access API doesn't exist for a person in headless Chromium, so the spec
  stubs `showDirectoryPicker` with an init script over an OPFS directory
  (`navigator.storage.getDirectory()` then `getDirectoryHandle('linked', {create:
  true})`) — **OPFS handles have no `queryPermission`/`requestPermission`, so
  the stub adds both on `FileSystemDirectoryHandle.prototype`**, answering
  `window.__linkedFolder.permission` ('granted' by default; a second init
  script sets 'prompt' to see Reconnect). **Two traps in that stub, both found
  in the Playwright Ubuntu image CI uses**: an OPFS handle cannot be
  *deserialised* out of IndexedDB there (it crashes the renderer — `put` works,
  the `get` kills the tab), so the stub keeps the folder's **name** in the
  `handles` store and answers the read with a live handle rebuilt from that
  name (it patches `IDBObjectStore.prototype.put`/`get` and hands back a
  stand-in request); and a file being written through `createWritable` is
  briefly *not there*, so the spec's polls read it through `nameIn()`, which
  answers `undefined` instead of failing. Reading and writing those files from
  the test goes through `readArchive`/`writeArchive` imported from
  `../packages/storage/src/archive`, with the bytes base64'd across
  `page.evaluate` (**a `page.evaluate` string must end in `()` or Playwright
  evaluates it as a bare function**). The section is the region "Linked folder"
  with `data-linked-folder` (`none`/`needs-permission`/`ready`/`loading`) and
  file cards `[data-linked-file="<name>"]`; "Link a folder…", "Reconnect",
  "Unlink the folder" and "Refresh the linked folder" are its buttons; the
  project's own command is Home › Files tile "Save to Linked Folder" (ADR-0079;
  `fileAction`, and `hasFileAction` is false once the project is linked) and says "Saved <file> to the linked
  folder.". **The write-back is throttled**, so a test that edits and waits
  must wait 12 s for the trailing write; the file's bytes are read out of OPFS
  and `readArchive`d (check `doc.name`). A conflict is a `role="alert"` toast
  with "Load from disk" and "Overwrite".
- **Import drawing e2e** (`e2e/import-drawing.spec.ts`, P4-06 slice 1): the tool
  is `importDrawing` in the Sketch tab's Create menu ("Import Drawing…", no
  key); it opens the file dialog at once, so the spec waits for the
  `filechooser` **beside** the click (`chooser.setFiles('packages/io/src/
  fixtures/rect-circle.svg')`, the fixtures `@extrudo/io`'s own tests read). The
  panel is the region "Import drawing": the file's name, the comboboxes "Units"
  (the file's own preselected: `mm`, `in`) and "Position" (`origin`/`centre`),
  the "Scale" textbox (an `ExpressionInput`, so `fill('2')`), the "Fixed"
  checkbox, `[data-import-summary]` ("5 curves", or the reason it can't be
  imported, with `data-import-summary="error"` and OK disabled), and OK/Cancel.
  After OK: `data-sketch-summary` reads `lines=4 circles=1 points=9
  constraints=5` (one `fix` per curve), `data-sketch-profiles` reads
  `profiles=2 holes=1` (ADR-0020: the hole is a region of its own), and one
  Ctrl+Z takes the whole import out (the step is named "Import <file>"). A
  profile is picked in the model **outside** the circle (at sketch (−10, 0)),
  pressed with E, and `data-bodies` gives `40,20,5`; with Scale 2, `80,40,5`;
  and `square-inches.dxf` ($INSUNITS 1) gives 25.4 × 25.4 mm.
- **Import mesh e2e** (`e2e/import-mesh.spec.ts`, P4-06 slices 3 and 4): the
  same Home › Import flow (the old Insert tab's, ADR-0079) with `fixtures/imports/cube.stl` (Units "auto",
  the preview's `data-preview-status="ok"` needs manifold-3d in the worker),
  `two-parts.3mf` (two bodies at ×10 for centimetres, the largest first),
  `bracket-y-up.obj` (read as Z-up, then Up `y` from the chip swaps y and z),
  `open.stl` (the error in "Feature status" with OK disabled), a Fillet whose
  Edges field stays "Pick edges" (the creases don't pick) and a Shell that says
  "Shell needs a solid body", and an STL and 3MF export read back with
  `@extrudo/io` (one closed object, 8000 mm³) while the Export dialog under
  STEP disables the body. Slice 4's four tests: a **Ø6 circle sketched on XY and
  extruded as a cut through all** (the profile is picked in the model and `e`
  pressed; the Operation and Extent comboboxes read `cut` and `through-all`; the
  body stays one face of triangles tagged "Mesh" and its 3MF is closed at
  7434 mm³ ±0.5 %), a Box overlapping the cube **joined with Combine** (the
  Target and Tools buttons take the picks, the warning is the region's whole
  text, one body of 25 × 20 × 20 mm), a **Move** by 10 mm along X (the field is
  "X distance"; the exported mesh's lowest x is 10) and a **Split Body** by YZ
  (the browser row selected, then Modify › Split Body; the YZ plane picked on
  its square at `[0, −half · 0.75, half · 0.75]` as `e2e/split-body.spec.ts`
  does it, and two bodies of 10 × 20 × 20 mm whose volumes add up). **9 tests,
  20.7 s** (1.7 s to 6.8 s each; a cut, a join, a move and a split each take a
  mesh boolean), green with `--repeat-each=3`. Two things the four needed: the
  circle's diameter is **typed into the tool's heads-up box** (the group
  "Heads-up input", textbox "Diameter", Enter finishes the circle — the grid
  would snap a drawn radius), and the circle is sketched on a construction plane
  **10 mm below** the cube so its profile is in front of the body from the
  bottom view (Shift+3) and can be picked. Combine picks its target and tool in
  the view (`Target` then the box's top face at `[22, 10, 10]`, `Tools` then the
  cube's top at `[10, 10, 20]`): with pre-selection the *target* is the first
  body **in creation order**, so a mesh target and a solid tool warn about
  nothing.
- **Import OpenSCAD e2e** (`e2e/import-scad.spec.ts`, P5-04 slice 2): the
  Home tab's Import (ADR-0079) with `fixtures/imports/customizer-plate.scad` (a 40 × 30 ×
  4 mm plate with two Ø4 holes; groups Size: `width`, `depth` and Holes:
  `holes`, `hole`, plus a string `label` and a boolean `rounded`). The dialog
  "Import dialog" has `[data-info="file"]` ("customizer-plate.scad · 1 kB ·
  OpenSCAD") and the group "OpenSCAD variables" with
  `[data-scad-overrides="loading|ready|error"]` (`[data-scad-error]` holds an
  error's text), headings `[data-scad-group]` and rows `[data-scad-row="<name>"]`
  (`data-scad-readonly` for a non-number, "(not editable yet)";
  `data-scad-missing` for a stored override the file doesn't list); a row's
  textbox is named after the **variable** (`width`, `exact: true`) and its
  placeholder is the file's value. The first list and preview take a moment
  (the nested worker, the WASM): wait up to 90 s for `ready` and
  `data-preview-status="ok"`. The body is a mesh body, `Body1:1:40,30,4` in
  `data-bodies`. A typed parameter name (`plateWidth`) shows "= 50.00 mm" under
  the row; the Customizer's slider on it recompiles each step (the Customizer is
  a Home tile since ADR-0079: `pickTool(page, 'Customizer')`). `syntax-error.scad`
  says "syntax-error.scad, line 4: syntax error." in "Feature status" with OK
  `aria-disabled` (don't click it: Playwright waits for it to be enabled). Three
  tests, 9.3 s, 10.5 s and 3.4 s; `hosting.spec.ts` has the
  same import under the served headers and `pwa.spec.ts` the runtime cache
  (`caches.open('extrudo-openscad')`), the offline reload after first use and
  the "isn't downloaded yet" message offline before it.
- **Macro e2e** (`e2e/macro.spec.ts`, P5-05 slice 2): `pickTool(page, 'Record Macro')`
  / `'Stop Macro'` (menuitems of Create; only the one that applies is in the menu).
  The status bar's `[data-macro-recording]` holds the count ("Recording macro · 3
  features"). The dialog is the region "Macro" (`exact: true`) with
  `data-macro-dialog` (`ready`, `done`, `empty`), the read-only editor "Macro code",
  buttons "Copy", "Replace with a Script", "Keep both", "Close" (`exact: true`) and
  `[data-macro-outcome]` (`ok`/`refused`) with the message. **The dialog is modal, so
  the Viewport region leaves the accessibility tree while it is open**: read
  `data-bodies` before Stop or after Close. CodeMirror renders only the lines in view:
  read the whole code through Copy (`context.grantPermissions(['clipboard-read',
  'clipboard-write'])`, then `navigator.clipboard.readText()`). A script's body is a
  new body, so compare `data-bodies` without the names. Replace is checked against the
  recorded body's size and face count, one Ctrl+Z, then Ctrl+Shift+Z; Keep both
  gives "Script2" suppressed (unsuppress from the chip's right-click menu). The
  refusal test records a sketch with a dimension (`d1`) and adds the parameter
  `twice = d1 * 2`. Export Design as Script is Home › "Export as Script" (`fileAction(page,
  'Export Design as Script…')`, ADR-0079). 4 tests, 2.4-9.4 s each.
- **WebGL fallback e2e** (`e2e/webgl-fallback.spec.ts`, `webgl-fallback-nogl.spec.ts`,
  ADR-0076): the e2e browser draws in software (SwiftShader), so `playwright.config.ts`
  pre-sets `render.softwareNotice` to `dismissed` through `use.storageState` (key
  `extrudo.render.softwareNotice`, JSON value) and `screenshot.css` hides `[data-renderer]`;
  the software test clears the storage state (`test.use({ storageState: { cookies: [],
  origins: [] } })`). "No WebGL" is an init script making `getContext` return null for
  `webgl`/`webgl2`; the region "3D view unavailable" has "Try again". A launch option forces
  a worker, so the `--disable-gpu --disable-software-rasterizer` test has its own file (`--disable-gpu --disable-software-rasterizer`, default `--enable-unsafe-swiftshader` ignored, does yield no WebGL in Chrome here; `--disable-gpu` alone does not). The root boundary is `#/debug/crash`; a context that fails after detection (probe canvases detached, the page's canvas null) reproduces three.js's "Error creating WebGL context"; a lost context
  is `WEBGL_lose_context` on the canvas, `[data-webgl="lost"]`.
- **Auto-project e2e** (`e2e/auto-project.spec.ts`, P6-07): a Box primitive
  40 × 40 × 20, then Create Sketch on its top face (world (0,0,20)); the face
  sketch opens fitted tight, so `zoomOutTo(page, at(0,0), 150)` before clicking
  the top-right corner (a body vertex). The Line tool's first click at sketch
  (20,20) snaps to that vertex; after the kernel recompute the sketch palette's
  `data-sketch-summary` counts the `coincident` (the projected vertex is a
  point, so `data-sketch-projected` reads `<id>:curves=0:x=20..20:y=20..20` —
  **the summary now lists a point-only projected vertex**, `curves=0`); one
  Ctrl+Z after Finish Sketch takes the line, the projection and the constraint
  away and Ctrl+Shift+Z brings them back; the palette's checkbox "Auto-project"
  (`exact`, the second checkbox is "Auto-project face outline") off leaves the
  corner a plain grid snap with no projection; checking "Auto-project face
  outline" first makes the next sketch on the face start with
  `<id>:curves=4`. **Slice 2** adds three tests: with a Line drawn with Ctrl
  held (no inference; endpoints at (5,0)-(5,10)), the **Coincident** tool
  (group "Constraints") picks the line's end and the Box's (20,20) vertex, the
  **Parallel** tool picks the line and the top face's far edge at (0,20), and
  the **Dimension** tool (`d`) picks the line's end, the vertex and a label
  spot; each shows in `data-sketch-summary` (`constraints=1`/`dimensions=1`)
  and `data-sketch-projected` after the recompute, and one Ctrl+Z takes it and
  its projection away. A constraint tool's click is the point/line nearest the
  cursor first, so click the body geometry where no sketch entity is near.
  The 2026-10-07 review adds a test snapping a Line end to a Ø40 Cylinder's
  **curved** top rim (a point on a curved edge is still allowed): it projects
  the circle (`<id>:curves=1`) and holds the point on it.
  `--repeat-each=2`. `openSketch` (moved to `e2e/helpers.ts`) waits for a
  sketch id that was not shown before the call — the last `data-sketch-frames`
  entry can still be an older sketch's while the new one's face pick resolves
  its kernel reference (`sketchOnFace`), and that wrong id was the face-outline
  test's CI flake (plane picks are synchronous, so the snapshot already names
  them and it falls back to the last shown).
- **Canvas e2e** (`e2e/canvas.spec.ts`, P4-06 slice 5): the picture is a
  200 × 100 PNG **built in the page** with an `OffscreenCanvas` (as a string:
  the e2e specs typecheck without the DOM) and handed to the file chooser as
  `{ name: 'plan.png', mimeType: 'image/png', buffer }`; the tile is the
  **Home** tab's button "Canvas" (`exact: true`; the Insert tab's before ADR-0079) and the dialog is "Canvas
  dialog" / "Edit Canvas1 dialog": `[data-info="image"]`, the button "Plane"
  (`exact: true`, "1 face"), the textboxes "X", "Y", "Width", "Rotation" and
  "Opacity" (**all `exact: true`**: "Y" also matches "Opacity"), the checkbox
  "Flip" and the button "Calibrate" (which reads "Calibrating…" while it runs,
  so match it with a regex). The Viewport's `data-canvases` reads
  `<feature id>:<w>x<h>:<origin>` per drawn canvas in mm to 0.01 ("…:20x10:0,0,20")
  and is **absent until the picture is decoded** (its height is the picture's
  aspect), so poll it. Calibrate counts its marked points on `[data-calibrate]`
  ("0", "1", "2"), the dialog then shows `<measured> mm apart on the picture.`
  and a "Real distance" textbox with "Apply". **Fit the view (F6) before
  clicking on the picture**: the origin planes' squares are 0.16 × the view
  size, and a click on one of them picks it instead of the face. While a
  dialog's Plane field is the pick field the view has no `data-model-hover`
  (that belongs to the model picker). The browser's rows carry `data-canvas`,
  like the construction rows' `data-construction`.
- **Script e2e** (`e2e/script.spec.ts`, P5-02): `pickTool(page, 'Script')` opens
  the region "Script dialog"; a chip double-click opens "Edit Script1 dialog".
  The editor is the textbox "Script code" (`.cm-content`, contenteditable): click,
  `Control+a`, then `page.keyboard.insertText(code)` for bulk source; use real
  `keyboard.type('.')` for completion and real keys for undo/Esc/Tab. Read code
  with `innerText()` (CodeMirror lines are separate divs, so `toHaveText` joins
  them without newlines). Wait for `data-preview-status="ok"` before OK, up to
  30 s for the first runner load; `data-preview` on the viewport shows the body.
  Line errors have `.cm-lintRange-error` inside `.cm-line` (zero-based locator
  position); "Feature status" says "Line 3: …" and OK has `aria-disabled`.
  The "Script output" region contains console text; `[data-script-made]` reads
  "Made N features". Completion is `.cm-tooltip-autocomplete`. The loop test's
  60 × 60 × 5 mm plate has 10 faces at count 4, 12 at count 6, and 13 after the
  stored fillet. Both hosting's whole-session walk and axe's two-theme dialog
  audit include Script. The first test prints editor-open, request-to-preview
  and worker-load timings from the performance measures (ADR-0070 slice 3).
- **Tutorials e2e** (`e2e/tutorials/<name>.spec.ts`, ADR-0080 §4, P6-06 S5): a page
  in `docs/guide/tutorials/<name>.md` has a `<!-- step: <slug> -->` marker, a `###`
  heading, text and `![alt](./images/<name>/<slug>.png)` per step; the spec does
  `const { step } = tutorial(page, '<name>')` (`e2e/tutorials/step.ts`) and one
  `await step('<slug>', actions, check)` per marker, in the same order
  (`apps/site/src/tutorials.test.ts` checks the pairing, the pictures and names the
  slug). Without `RECORD_ASSETS` a step only checks; **`pnpm demos -g tutorials`**
  (`scripts/record-demos.mjs`, `--skip-build` when `dist` is current) runs the folder with
  `RECORD_ASSETS=1`, which saves the whole 1440 × 900 page, reduced to 256 colours
  (80-105 kB; full colour was 570 kB), to `docs/guide/tutorials/images/<name>/`. **Look at every picture**, and
  dismiss toasts before it (the recorder does). The Viewport region leaves the
  accessibility tree under a modal dialog, so step.ts settles on `[data-camera-size]`.
  Tutorial 1 (`first-part`) is B1's flow plus an extrude and an STL export; the shared
  `dimension()` helper lives in `benchmark-helpers.ts`.
- **Import STEP e2e** (`e2e/import-step.spec.ts`, P4-06 slice 2): the tile is
  `importBody` in the **Home tab** (ADR-0079: `selectTab(page, 'Home')`, then the
  button "Import Model", `exact: true`; `data-tool="importBody"`; `fileAction(page,
  'Import Model')` runs the same command). It opens the file dialog at
  once, so wait for the `filechooser` beside the click and
  `setFiles('fixtures/imports/b3.step')` (B3's two bodies through our own
  `writeStep`). The dialog is the region "Import dialog" / "Edit Import1
  dialog": `[data-info="file"]` ("b3.step · 30 kB"), the "Up" combobox
  (`z`/`y`; **no** "Units" for a STEP file, it converts its own units),
  `data-preview-status` (the preview takes a moment: read up to 60 s) and
  `data-dialog-valid`. OK gives `data-bodies` **"Body1:6:60,80,10
  Body2:6:60,31.8,60"** (sizes are rounded to 0.1 mm) and the chip "Import1";
  one Ctrl+Z takes the feature and the file's record away together and
  Ctrl+Shift+z brings them back. Editing from the chip (dblclick) turns Up `y`
  and the sizes' y and z swap: "60,60,31.8" and "60,10,80". A file that isn't
  a STEP file says so in the dialog's "Feature status" with `data-dialog-valid`
  absent. Exporting the design and importing it as a new one brings the bodies
  back (the attachment travels), as in the user-fonts spec. **P4-12's colour
  test**: the Wall bracket recoloured through its Appearance panel's "Hex
  colour" (`#c81e28`; Esc closes the panel with focus on the "Opaque" radio),
  exported with `exportModel(page, 'STEP')`, written to `info.outputPath` and
  imported into a new design reads `data-body-appearance`
  `Body1:#c81e28:1` (`Body1:<n>:40,80,60`); recoloured `#22b3c2` and its chip's
  Up set to `y` (`40,60,80`), it stays `#22b3c2`.
  Slice 5 added the **canvas** (`features/canvas.tsx`, `viewport/Canvas.tsx`,
  `viewport/canvasGeometry.ts`, `viewport/canvasImages.ts`): a canvas is **view
  geometry from a report, never picked** — the kernel evaluator reads the plane
  (`planeOf`) and reports its frame as a `CanvasReport`
  (`ModelState.canvases`), and `canvasGeometry.ts` reads the picture, centre,
  width, turn and opacity from the feature's own inputs through core's
  `canvasNumbers` (the kernel feeds it `ctx.value`, the view the document's
  evaluation). The picture's bytes are decoded on the UI thread
  (`createImageBitmap`, so the CSP is untouched) and its texture goes with the
  last canvas using it; the width is the picture's pixel width × 0.1 mm, which
  **only the app can know**, and Calibrate (its UI is `spec.extra`, a spec's
  own component under the fields; its clicks stay out of the Plane field
  through `spec.placeAtOnly`) writes `width × real / measured`. `spec.info` is
  slice 2's field kind.
- **Model progress e2e** (`e2e/model-progress.spec.ts`, ADR-0078): with no cache an empty Bodies folder shows `[data-bodies-computing]` ("Computing bodies…", `aria-busy`) until the first recompute; the notice is
  `[data-model-progress="preparing|updating"]` (absent otherwise; text "Preparing
  your design…", "Computing 6 features"), the icon `[data-progress-icon]`, and a
  pending body row `[data-body-pending]` (`aria-busy`) in the browser. To make the
  window before the kernel is ready long enough, the spec reloads with
  `page.route('**/extrudo_occt*.wasm', …)` delaying the OCCT WASM by 4 s (routes
  cover the worker's fetch, and the e2e service worker is blocked); wait for
  the cache file in OPFS (`projects/<id>/model-cache.json`, written after the
  recompute, fire and forget) before reloading. Under reduced motion
  `getAnimations({ subtree: true })` on the icon is empty (pass it as a string).
- **Emboss e2e** (`e2e/emboss.spec.ts`, P4-04): the tool is `emboss` in Create's
  menu (`menuitem` "Emboss", no key); its dialog is the region "Emboss dialog" /
  "Edit Emboss1 dialog" with the buttons "Profiles" and "Face" (`exact: true`:
  **"1 text"**, **"1 face"**), the `Depth` textbox (`exact`) and the `Mode`
  combobox (`emboss`/`deboss`); P4-12 adds the read-only line
  `[data-info="method"]` ("Wrapped round the cone", "Projected onto the face",
  after the first preview) and two tests: 'AB' on a Cylinder drafted 10° about
  XY (Modify › Draft, the wall picked at (0, −10, 10), the plane on XY's square)
  and a Ø6 circle typed into the heads-up box on a plane 40 mm over a Sphere
  primitive, its profile picked at z = 40 (the field reads "Profile · Sketch1")
  and the sphere at 10/√3 (1, −1, 1); the sphere's display box is
  `Body1:1:20,19.9,20`, an emboss makes its height 21 and a deboss 19.5 (the cut
  takes the top away). **Sketch on a construction plane clear of the
  body**: the letters have to be clickable in the model, and a sketch through
  the body (an XZ sketch inside a cylinder) puts them behind its faces, where a
  click is refused as occluded (the text spec's `inkPoints` scan over
  `data-text-bounds` finds a letter; the `Create Sketch` dialog's
  "Construction planes" group takes the plane). A 10 × 4 mm pad of straight
  edges and a letter "O" are exact to 1e-7 (`toBeCloseTo(x, 6)`), a B-spline
  wall (a curved profile, a letter's outline) only to 1-2 %: since **P4-12
  §H3** a wrap's volume is integrated to a tolerance, so a wrap of a *profile*
  is within 1e-5 of `area × depth × (R ± depth/2) / R` (`wrap.test.ts`, which
  used to allow 2 %) and the e2e can hold 1-2 % for the letters' own outline
  area. The names are the prism's: `emboss:EM:cap:end` and
  `emboss:EM:side:<sketch curve>`; `cap:start` merges into the face it stands
  on. A wrap of one profile is one tool (`mergeTools` hands it back as it is,
  already tracked by the scope — **don't track it again**, that releases it
  twice).
