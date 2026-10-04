# Extrudo — agent context

Open-source, browser-based parametric CAD for the 3D-printing community, with a
Fusion 360-style workflow (sketch → features → timeline, parameters everywhere)
and a playful modern UI. Web first (PWA). An Electron desktop build comes later
from the same codebase.

**Repo:** <https://github.com/zoltanf/extrudo>. **Private** until the owner
makes it public (P3-15 prepared everything: `docs/release-checklist.md` lists the
owner's steps). CI runs on every push and pull request.

**Status (2026-10-03):** Phase 0 is done (P0-01 to P0-09); Phase 1 is
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
complete** (version 0.3.0). Phase 4: P4-01 (sweep, loft, coil), P4-02
(modeled threads), P4-03 (sketch text, bundled fonts), P4-03b (user fonts
as attachments), P4-05 (control-point splines, conics), P4-07 (customizer,
configurations) and P4-08 (print tolerance, slicer hand-off) are done.
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
to-object trim, through all, participants by `distance`, one body per
solid, `previewTools`) and the dialog `apps/web/src/features/extrude.ts`
(fields named like the inputs; per-side arrows, symmetric at half
length, taper arcs; press-pull through the spec's `propose` hook: join
outwards, cut inwards until the user picks an operation). The browser
lists the model's live bodies (`shell/bodies.ts`). The Wall bracket
template computes a real bracket. ADR-0029 (P2-07) added revolve
(`packages/core/src/revolve.ts`, `packages/kernel/src/features/revolve.ts`,
`apps/web/src/features/revolve.ts`): profiles or flat faces about an
axis `{kind:'axis', id:'origin:x|y|z'}` (`ORIGIN_AXES`, `originAxisRef`
in `sketch/planes.ts`), a sketch line (`<sketch>/<line>`, placed by
`SketchOutputData.frame` and `.lines`) or a straight edge; the axis
must lie in the profiles' plane; 360° is a whole turn (no caps);
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
the latest undo step). **In the app a sketch's frame comes only from
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
(`features/planePicker.ts`) instead of the model selection. ADR-0034
(P2-12) added export: facade `exportMesh` (meshes a
`BRepBuilderAPI_Copy` at the export's deflection, so the display
triangulation is untouched, and welds nodes through each edge's
`Poly_PolygonOnTriangulation`: closed, manifold), `writeStep` (AP242,
mm, `DESTEP_Parameters` per transfer, products renamed to body names,
`WriteStream`, OCCT printers removed) and `readStep`; `Kernel.exportMesh`
/ `writeStep` / `readStep`, `stepString` (non-ASCII as `\X2\`);
`KernelApi.exportMeshes`/`exportStep` export the engine's
`latestBody` shapes (last finished recompute). `@extrudo/io` has
`TriangleMesh`, `checkManifold`, `writeStl`/`readStl` (binary) and
`write3mf`/`read3mf` (fflate; colours as `m:colorgroup` with object
`pid`/`pindex` and per-triangle `pid`/`p1`). The app's
`apps/web/src/export/` (`ExportModelDialog`, `modelExport.ts`) opens from
3D Print › Export, the File menu and a body's menu. ADR-0033
(P2-11) added timeline v2: `packages/core/src/timeline.ts` (a feature
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
`VersionsDialog.tsx` (Ctrl+S, File menu, the clock beside the name).
ADR-0037 (P2-15) added the offline precache: a hand-written service
worker (`apps/web/pwa/sw.js`; `pwa/precache-plugin.ts` lists the build's
files into `dist/sw.js` and versions it; registration in
`platform/serviceWorker.ts`, production web builds only), a web app
manifest and icons; `scripts/measure-startup.mjs` measures size and
startup against NFR-02 (all three targets hold with a wide margin). It
also found that the kernel uses no raw OCCT bindings, so the build's
binding list is now just `ExtrudoFacade` (built by CI: WASM 15.76 MB raw,
3.69 MB brotli, was 20.19/4.52; OCCT input hash `3df02e42e490`; **don't
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
(P3-01) added fillet: `packages/core/src/fillet.ts` (up to 8 edge sets as
plain inputs `edges`/`radius`, `edges2`/`radius2` …: `filletSets`,
`filletInputs`), the evaluator `packages/kernel/src/features/fillet.ts`
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
Extrude1's id and Sketch1's lines, and the bracket has 12 faces.
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
the browser has a Construction folder.
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
menus.
ADR-0043 (P3-02) added chamfer: `packages/core/src/chamfer.ts` (up to 8
edge sets as plain inputs, **each set with its own type**: `edges`,
`mode` = equal / two-distances / distance-angle, `distance`, `distanceB`,
`angle`, `flip`, then `edges2`, `mode2` …: `chamferSets`, `chamferInputs`),
the evaluator `packages/kernel/src/features/chamfer.ts` (same shape as
fillet's; faces `chamfer:<id>:from:(<edge>)`), the facade's
`chamfer(shape)` (staged edges + four numbers each: mode, a, b, flip; the
reference face of an edge is the lower-numbered of its two faces, `flip`
takes the other; on failure a fillet-style diagnosis whose too-large value
is a **factor** the distances scale by, read through `Kernel.chamfer`'s
`ChamferError.problems`; it uses `largestThatWorks` and the fillet's tangent
chain query) and the dialog `apps/web/src/features/chamfer.ts` (a Type
dropdown per set). The Chamfer tile has no default key.
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
at the box centre); the Solid tab has a Transform group (Move `M`, Mirror,
Combine) and bodies selected before a tool fill its fields in order.
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
Solid › Inspect › Section Analysis (`Shift+S`, session tool `section`,
panel `SectionPanel`, arrow `SectionOverlay`), the browser has an
Analysis folder while a section exists, and a selected flat face takes it
at once ("Section Here" in the context list).
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
builds valid junk for a wall thicker than a curved face's radius; a removed
face tangent to a neighbour is **refused before OCCT runs** since OCCT
corrupts the wasm heap there, `touchesTangentFace`; with no removed face OCCT
returns only the skin, so the solid with a void is assembled by hand; on
failure the thickness is bisected: `[status, value]` read through
`Kernel.shell`'s `ShellError.problems`). The Shell tile has no default key.
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
body volumes and turns them into weight and filament length
(`material.ts`; the material is the `print.material` preference, not a
document setting). **Overhang analysis is view state** (`viewport.overhang`,
`OverhangState`: an angle expression, a `down` axis or a picked flat `face`
(its outward normal is down, its plane the bed; P3-17), `on`), classified
per triangle on the CPU for the counts (`print/overhang.ts`: normal ·
down > sin N, bed contact excluded; `data-overhang`) and shaded per fragment
by a patch of the face material (`viewport/overhangShading.ts`,
`onBeforeCompile`, colour token `--x-error`); a row in the browser's
Analysis folder next to the section's.
ADR-0047 (P3-07) added patterns: `rectangularPattern`, `circularPattern` and
`pathPattern` (`packages/core/src/pattern.ts`, kernel `features/pattern.ts`,
`pattern-layout.ts`, `pattern-path.ts`, dialogs `apps/web/src/features/pattern.ts`;
the tools sit in Solid › Create's menu). The **original counts as an instance**
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
interfere); **a pattern of a cut instead colours the interference graph and
cuts one class at a time** (`toolSet`, `ToolSet` in `features/operation.ts`;
P3-17; joins still fuse, which measured faster), and **`operate` finds the
bodies a tool touches solid by solid** (`touchingBodies`: boxes first, then
the exact distance to the solids whose boxes meet). A path is a polyline (`pathFromRefs`; the sketch output has
`curves`). Mirror's `objects: 'features'` uses the same `replayFeatures`.
The dialogs have a new field kind `features` (a checkbox list of
`repeatableFeatures`). No facade change.
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
tools in Solid › Modify's menu, no keys). **Split Body needs no facade
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
network); `DEMO_TOOLS` in `demos.ts` lists the twelve that have one and
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
resource or evaluate strings** (script-src still has `'unsafe-eval'` for the
embind glue of both WASM builds, a P4-12 item). Cloudflare **joins** the
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
stricter `_headers`, addresses from `apps/site/addresses.ts`), **the stable app is
`app.extrudo.org`** (Pages project `extrudo`, production, deployed only by a `v*`
tag whose commit passed CI on main, or "Run workflow" target `stable`) and **the
latest build is `edge.extrudo.org`** (branch `edge` of `extrudo`, every green main
run, with the landing page in project `extrudo-site`); `deploy.yml` has `plan`,
`app` (per channel) and `site` jobs. The site's **`public/sw.js` retires the
app's old service worker** at extrudo.org (skipWaiting, delete caches,
unregister, reload; handles the old app's `SKIP_WAITING`), and `#/<route>` links
go on to the app. The intro video `apps/site/public/media/intro.webm` is recorded
from the real app (`pnpm demos -g intro`, `e2e/record-assets.spec.ts`).
ADR-0055 (P4-01) added **Sweep, Loft and Coil** (core `sweep.ts`, `loft.ts`,
`coil.ts`; kernel `features/sweep.ts`, `loft.ts`, `coil.ts`; dialogs of the
same names in Solid › Create's menu, no keys; all three patternable). The
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
travels from the path's end nearer to it**, so it need not touch the path.
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
profile). The evaluator (`kernel/src/features/thread.ts`) cuts ring − tooth per
face: the tooth swept by the facade's `threadSweep` (one helix edge per turn: one
long edge broke the boolean), lead-ins where the facade's `threadFace` says an
end is open; it always cuts, so it is patternable. Faces
`thread:<id>:side:f<k>.crest|flank0|flank1|root|end0|end1|lead0|lead1`. About
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
ADR-0062 (P4-08) added **print tolerance**: the document parameter named
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
Phase 6, P6-02).
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
Next, one task at a time (not parallel tracks, since 2026-09-30): **P4-04**
(emboss/deboss) then P4-06 onward in `docs/03-roadmap.md`; ADR-0063's Deferred
(exact rational conics in the kernel, closed splines, trimming and offsetting
splines) is P4-12 backlog. The owner's own release steps (slicer check, making
the
repository public, Cloudflare, domain, tag v0.3.0) are in
`docs/release-checklist.md`; don't do them. Deeper carried-over items are the
P4-12 backlog.

## Commands

```sh
pnpm install      # after pulling
pnpm dev          # app at http://localhost:5173
pnpm check        # typecheck + Biome + package boundaries + license allow-list + Vitest. Must pass.
pnpm e2e          # build + Playwright (run `pnpm e2e:install` once)
pnpm format       # Biome auto-fix
pnpm wasm         # download the OCCT and planegcs WASM for the current inputs (check/dev/build do this)
pnpm occt build   # build OCCT locally with Docker (~11 min; Arch workstation only); see packages/kernel/occt/README.md
pnpm planegcs build  # build planegcs locally with Docker (~2 min; Arch workstation only); see packages/sketch/planegcs/README.md
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
| `docs/deploy.md`, `docs/release-checklist.md` | How the site is deployed (the owner's one-time Cloudflare steps) and the owner's checklist for v0.3.0 and going public |
| `docs/references.md` | Other open-source projects we looked at, what to borrow from each, and their licenses |
| `docs/adr/` | Architecture decision records. ADR-0001: geometry kernel (libcascade). ADR-0002: sketch solver (planegcs). ADR-0003: document model, commands and undo. ADR-0004: expressions, units and parameters. ADR-0007: design system and shell. ADR-0008: viewport, camera and navigation. ADR-0009: project storage, autosave, home screen. ADR-0010: sketch data model and sketch mode. ADR-0011: sketch solver adapter. ADR-0012: sketch tool framework and inference. ADR-0013: basic drawing tools, tangent arcs, construction. ADR-0014: polygons, slots, ellipses, fit-point splines, lazy tool chunk. ADR-0015: constraint tools, glyphs, deleting constraints. ADR-0016: sketch dimensions, dimension parameters, re-solving on value changes. ADR-0017: constraint status, colours, over-constraint dialog. ADR-0018: selection, dragging and deleting in sketch mode. ADR-0019: sketch modify tools. ADR-0020: sketch profile detection. ADR-0021: timeline and browser menus, rename, visibility, hover. ADR-0022: sketch export to SVG and DXF. ADR-0023: command search, keymap and shortcuts. ADR-0024: recompute engine. ADR-0025: sketch to kernel, profile faces. ADR-0005: topological naming. ADR-0026: B-rep rendering and 3D selection. ADR-0027: feature dialog framework. ADR-0028: extrude. ADR-0029: revolve. ADR-0030: bodies. ADR-0031: sketch on face and Project. ADR-0032: primitives. ADR-0033: timeline v2, reorder, fix references. ADR-0034: STL, 3MF and STEP export. ADR-0035: measure and inspect. ADR-0036: version history. ADR-0037: WASM size, startup and the offline precache. ADR-0038: fillet. ADR-0039: benchmarks B2 and B3, fixtures. ADR-0040: construction geometry. ADR-0041: notification history. ADR-0042: marking menu and context menus. ADR-0043: chamfer. ADR-0044: combine, move/copy, mirror. ADR-0045: section analysis. ADR-0046: shell. ADR-0047: patterns. ADR-0048: 3D-print aids. ADR-0049: hole. ADR-0050: hardening (fuzzing, lenient reading, version locks, chunked export, NFR-01 numbers, axe). ADR-0051: press/pull, offset face. ADR-0052: onboarding (tutorial, templates, hint, tooltip demos). ADR-0053: split body, scale, draft, benchmark B6. ADR-0054: public release (Cloudflare Pages, headers and CSP, deploy workflow, update toast, community files, audit). ADR-0055: sweep, loft and coil. ADR-0056: modeled threads. ADR-0057: landing page at extrudo.org, the app at app. (stable) and edge. (latest). ADR-0058: sketch text. ADR-0059: customizer and configurations. ADR-0061: user fonts as attachments. ADR-0062: print tolerance and slicer hand-off. ADR-0063: control-point splines and conics (0006 is reserved) |

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
| Screenshot baselines | Regenerate, then check in the Playwright Ubuntu docker image | 5 shots fail locally (Chrome renders differently; they pass in CI): `shell.spec.ts:35` dark/light, `sketch.spec.ts:140`, `storage.spec.ts:223` dark/light. New baselines: take them from CI's `playwright-report-1`/`-2` artifacts (one per e2e shard; `gh run download <id>`) |
| E2E load | Full parallel run fine | Only one full e2e at a time, `--workers=2`; under load timeouts give false failures. Prefer single specs locally and the full suite through CI on the branch. With its NVIDIA GPU, `E2E_GPU=1` makes viewport-heavy specs 17-39 % faster (screenshot specs excluded: they need SwiftShader) |
| Inkscape, rsvg-convert | Installed | Not installed |
| Slicers, FreeCAD | `prusa-slicer`, `orca-slicer`, `freecadcmd` | Not installed |
| `brotli` CLI | – | Not installed (`scripts/measure-startup.mjs` uses Node's zlib) |

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
  before clicking there. Under the full parallel run B1 takes
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
- **Extrude e2e** (`e2e/extrude.spec.ts`): the Viewport region's
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
  faces (depth test).
- **Revolve e2e** (`e2e/revolve.spec.ts`): the dialog is the region
  "Revolve dialog", the axis field the button "Axis" ("Y axis", "1
  sketch curve"); origin axes appear in `data-model-hover` /
  `data-model-selection` as `axis:origin:y`. In the default Top view
  the Y axis is pickable at sketch (0, 45); the status bar says "1
  profile, 1 axis". An origin axis behind a profile can take a click
  meant for the profile in sketch-mode tests; use "Select other…" or
  click off the axis. The revolve golden table updates with `pnpm
  vitest run -u packages/kernel/src/features/revolve`.
- **WASM heap growth with a warm cache** (P2-07): OCCT 8's booleans and
  mesher ask for blocks of up to 16 MB, so with cached shapes alive the
  heap top steps up 16 MB about every 350 recomputes of a revolve
  document (not levelling off in 1200); each op alone stays flat, and
  clearing the cache each run is flat, so it looks like fragmentation.
  Memory tests of big booleans clear the engine each run and warm up
  through every value first. To find which op grows, wrap
  `Kernel.prototype` methods and log `heapTop` jumps (done in P3-17:
  `HEAP_ATTRIBUTE=1`; it is `mesh`). Unmeasured in a real long session.
- **Primitives e2e** (`e2e/primitives.spec.ts`): the dialogs are the
  regions "Box dialog"… (from `pickTool(page, 'Box')`), the Plane field
  the button "Plane" ("XY plane", "XZ plane", "1 face"). While Plane is the
  pick field the view picks planes and faces like Create Sketch, so
  `data-model-selection`/`-hover` are absent; click origin planes at world
  points with x ≥ 0, y ≤ 0, z ≥ 0 inside the square (view size × 0.16) in
  the home view, where no other plane is in front, and faces the same way.
  The kernel golden table updates with `pnpm vitest run -u
  packages/kernel/src/features/primitives`.
- **Export e2e** (`e2e/export-3d.spec.ts`): the dialog is `dialog`
  "Export model"; bodies are checkboxes by name, formats radios
  (`/^3MF/`, `/^STL/`, `/^STEP/`), resolutions `/^Coarse/`…`/^Custom/`
  with textboxes "Deviation" and "Angle". The summary's
  `data-export-summary` reads "1 body, 620 triangles, watertight" once
  meshed (poll it before Export). e2e imports `../packages/io/src/index`
  to read and check downloads. The format and resolution are remembered
  in the `export.model` preference (per browser context).
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
- **Timeline v2 e2e** (`e2e/timeline-v2.spec.ts`): the marker is the
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
  The Construct group's tiles are "Offset Plane", "2-Point Axis" and
  "Point" (the others sit in its menu); its dialogs are the regions
  "Offset Plane dialog", "Axis Through 2 Points dialog"… A plane field
  picks like Create Sketch (click a plane's square, `clickAt` a world
  point with x ≥ 0, y ≤ 0, z = 0 in the home view); the axis and point
  fields pick in the model. Create Sketch lists construction planes as
  buttons in the group "Construction planes". **An extrude hides its
  sketch**, so `data-sketch-frames` is empty until "Show Sketch1". A
  construction axis lying on an origin axis loses the pick to the origin
  one: offset it. `sketchOnXY` opens a *new* project; use `newSketchOnXY`
  in an open one.
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
  and tests that run many times.
- **Chamfer e2e** (`e2e/chamfer.spec.ts`, P3-02): the tool has no key: click
  the toolbar's Chamfer tile (`getByRole('button', { name: /^Chamfer/ })`,
  after picking an edge for pre-selection). The dialog is the region
  "Chamfer dialog" / "Edit Chamfer1 dialog"; set 1 has the button "Edges"
  (`exact: true`), the combobox "Type" (options "Equal distance", "Two
  distances", "Distance and angle": a Radix select, click it, then the
  option) and the textboxes "Distance", "Second distance" (two distances),
  "Angle" (distance and angle) and the checkbox "Flip" (both non-equal
  types); set 2 names get " 2" ("Edges 2", "Type 2", "Distance 2" …). Fields
  of other types aren't in the DOM. The message is in the region "Feature
  status". Kernel-side, the golden table is
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
  face next to a fillet is refused without running OCCT (its offset traps the
  wasm heap: a `RuntimeError: memory access out of bounds` that can show up
  calls later, so never let a probe reach it).
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
  heading "Parametric CAD for 3D printing, in your browser.", links "Open Extrudo"
  (`[data-open-app]`, `https://app.extrudo.org/`) and "Try the latest build", the
  intro `video[data-intro]`. `StaticHost.serve(dir)` switches the host's build
  (the app first, its worker installed, then the site): the retiring `sw.js`
  sometimes waits behind the open tab, and the old app's update toast (Reload)
  sends `SKIP_WAITING`; the spec takes that path when the page didn't switch by
  itself. Routes to the app are fulfilled with `page.route`.
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
  open, where the Parameters button isn't). While a Hole's or primitive's
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
  `e2e/move-mirror.spec.ts`, P3-06): the Transform group's tiles are the
  buttons "Move", "Mirror" and "Combine" (`exact: true`: a chip "Move1"
  matches a regex); dialogs are the regions "Combine dialog", "Move dialog",
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
  `objectsOf3mf` + `meshBounds`; it opens the 3D Print tab, click "Solid"
  again). Picking the X axis for Rotate: try points along it until
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
- **Marking menu e2e** (`e2e/marking-menu.spec.ts`): right-click without
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
  "face:<id> offset=… on"; absent with no section) and `data-section-clip`
  (the plane while it clips: `0,0,30:0,0,1` = origin, then the unit normal
  of the **removed** side; absent while off and in sketch mode). The panel
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
  `[data-print-row="volume|weight|filament"]`, the native selects and
  fields "Material" (`selectOption('petg')`, `'custom'`), the textbox
  "Density" and the radios "1.75 mm" / "2.85 mm"; a density of 0 shows the
  expression error and isn't taken). The Overhang panel is the region
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
- **Pattern e2e** (`e2e/pattern.spec.ts`, P3-07): the tools are in Create's
  menu (`pickTool(page, 'Rectangular Pattern' | 'Circular Pattern' | 'Path
  Pattern')`); dialogs are the regions "Rectangular Pattern dialog"…, fields
  the buttons "Direction"/"Axis"/"Path" (`exact: true`) and textboxes "Count",
  "Distance" (`exact`), the combobox "Pattern" (Mirror's is "Mirror") with
  `bodies`/`features`, and for features a list of checkboxes named like
  `Cylinder1 cut` (`[data-feature]`). The ghosts are `data-preview` ("new
  new" for two copies, one `cut` for a repeated hole); handles
  `data-manipulators="distance:distance1"` / `angle:angle`. After switching to
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
  shows as a soft failure), `FUZZ_SEED` for another sequence, `FUZZ_HEAP=n`
  for heap samples. Warm-cache heap of the revolve document: `HEAP_RUNS=n
  … memory.test.ts -t "warm cache"` (about 0.3 s a run; `HEAP_MAX_ENTRIES`,
  `HEAP_ONLY=G|R|F|GF|RF|GR`): it grows about 11 MB per 100 recomputes with
  all three revolves, not with any subset (ADR-0050 §6, P4-12 backlog):
  `HEAP_ATTRIBUTE=1` prints which `Kernel` call grew the top, and it is
  `mesh` alone (a `BRepTools::Clean` after meshing didn't cure it). **Our OCCT
  build already links mimalloc** (the toolchain default); `MALLOC:
  'dlmalloc'` in `libcascade.config.ts` builds (grows smoothly, 30 % slower). Silhouette
  cost: `BENCH=1 … viewport/silhouette.test.ts`; booleans of many tools:
  `BENCH=1 … kernel/src/boolean-bench.test.ts`. A native OCCT harness for
  such experiments builds in the image by its digest (the tag shows as
  `<none>` on the Arch workstation): `docker run --rm --user 0 -v
  <dir>:/w -w /w --entrypoint sh <image id> -c 'em++ … && node h.js'`.
- **The fuzzer covers B1-B5 and B7** (P3-17, ADR-0038/0047 amendments);
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
- **Newer files in e2e**: write `projects/<id>/document.json` in OPFS from
  `page.evaluate` (see `storage.spec.ts`) to simulate a newer Extrudo.
- **Split Body, Scale and Draft e2e** (`e2e/split-body.spec.ts`,
  `scale.spec.ts`, `draft.spec.ts`, P3-08): the tools are in the Solid tab's
  Modify menu (`getByRole('button', { name: 'Modify', exact: true })`, then
  `menuitem` `/^Split Body/`, `/^Scale/`, `/^Draft/`); dialogs are the regions
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
- **Thread e2e** (`e2e/thread.spec.ts`, P4-02): Solid › Modify (`button`
  "Modify", `exact`) › `menuitem` `/^Thread/`; the dialog is the region "Thread
  dialog" / "Edit Thread1 dialog": button "Faces" (`exact`, "1 face"), combobox
  "Size" (values `auto`, `m8`, `m16x1.5`, `unc-1q4-20`…, `custom`; Diameter and
  Pitch exist only off `auto`), "Extent", "Hand", textboxes "Length", "Offset",
  "Tolerance" (`exact`), checkboxes "From the other end", "Lead-in chamfer". A
  thread takes seconds to preview (wait up to 60 s). The default Ø20 cylinder
  threaded to fit is `Body1:<n>:19.8,19.8,20` (M20 less twice the tolerance).
  Kernel: `pnpm vitest run -u packages/kernel/src/features/thread` rewrites the
  golden table; `BENCH=1` times threads.
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
  `kbd` and, for the twelve tools with a clip, `video[data-tool-demo="<id>"]`
  (`data-playing` false under reduced motion). **Radix keeps a tooltip open
  when the pointer jumps away in one move** (its grace area): move with
  `mouse.move(x, y, { steps: 5 })` before expecting it gone. The tour walks
  the real flow in about 11 s: rectangle corners at (−20, −10) and (20, 10), a
  dimension on the bottom side labelled at (0, −16), the profile picked at the
  world origin in the home view, an edge picked at (0, −10, 15) for the fillet.
  `e2e/record-assets.spec.ts` (RECORD_ASSETS=1 only) is the demo recorder.
- **Sweep, loft and coil e2e** (`e2e/sweep-loft-coil.spec.ts`, P4-01): the tools
  are in Create's menu (`pickTool(page, 'Sweep' | 'Loft')`, `startPrimitive(page,
  'Coil')`); dialogs are the regions "Sweep dialog", "Loft dialog", "Coil dialog"
  ("Edit Sweep1 dialog"…). Sweep: buttons "Profiles" and "Path" (`exact: true`;
  "1 edge"), combobox "Orientation" (`follow`/`fixed`), textboxes "Twist" and
  "End scale". Loft: button "Sections" ("2 sections"), checkboxes "Ruled" and
  "Closed". Coil: button "Plane" ("XY plane"), comboboxes "Type", "Direction",
  "Section", "Section position", textboxes "Diameter", "Revolutions", "Height",
  "Pitch" (the one the type doesn't use is absent), "Taper angle", "Section
  size", `data-manipulators="distance:diameter distance:height"`. The default
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
  dialog is on the **Solid** tab, so `solidTab(page)` first (as in the print
  aids spec); there the row's field is "Expression of tolerance" and its value
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
  to 30 s.
