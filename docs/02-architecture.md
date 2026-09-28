# 02 — Architecture and Technical Stack

## 1. Stack at a glance

| Concern | Choice | Why |
|---|---|---|
| Language | **TypeScript** (strict) everywhere | One language for UI, core, workers, CLI and Electron. |
| Package manager / repo | **pnpm workspaces** monorepo (install via `mise use -g pnpm`; Node 26 no longer bundles corepack) | Fast, strict dependency isolation, good for multiple packages. |
| Build / dev server | **Vite** | Fast HMR. First-class Web Worker and WASM support. Electron-friendly (`electron-vite` later). |
| UI framework | **React 19** | Largest ecosystem, best three.js integration (R3F), agents know it well. |
| UI primitives | **Radix UI** (headless) + **Tailwind CSS v4** with design tokens | Accessible menus, dialogs, popovers and tooltips. We own the look. |
| Icons | **Lucide** for generic UI + a **custom CAD icon set** (own SVGs, same grid and stroke) | Lucide has no CAD tool icons. Custom icons give the playful identity. |
| Motion | **Motion** (`motion/react`) | Small UI animations, panel transitions. |
| App state | **Zustand** + **Immer** (patches drive undo/redo) | Simple, fast, works outside React (workers, tests). |
| Schema / validation | **Zod** | Validates the document on load. Versioned migrations. |
| 3D rendering | **three.js** via **@react-three/fiber** + **drei**; **three-mesh-bvh** for picking; `LineSegments2` for crisp B-rep edges | Industry-standard WebGL2 renderer with a WebGPU path later. drei has gizmo and helper building blocks. |
| Geometry kernel | **OpenCascade (OCCT) compiled to WASM**, via the maintained `libcascade` package (the taucad fork of opencascade.js, OCCT 8.x), inside a **Web Worker** | The only mature open-source B-rep kernel usable in the browser. Real fillets, chamfers, shells, booleans, sweeps and lofts, plus STEP I/O. LGPL-2.1 with an exception. |
| Kernel convenience layer | **Our own trimmed OCCT build** (`@libcascade/toolchain`) with a **small C++ facade** that owns OCCT memory and returns results and history as flat arrays, under a thin TypeScript layer; raw libcascade bindings for the rest. **replicad** and **brepjs** are code references, not dependencies (ADR-0001) | The P0-02 spike showed that only raw OCCT gives face *and* edge history, which topological naming needs (§5.2). replicad's API drops the builders; brepjs/occt-wasm tracks faces only. |
| Mesh booleans (secondary) | **manifold-3d** (WASM) | Fast, robust booleans on imported STL meshes and OpenSCAD output, where B-rep does not apply. |
| Sketch constraint solver | **planegcs** (FreeCAD's PlaneGCS in WASM, LGPL-2.1-or-later), **our own build** of `@salusoft89/planegcs` with memory growth, two pivoting patches and a binding for its dependent parameters (per-entity constraint status, ADR-0017); one solver system per independent sketch component (ADR-0002) | Proven solver with the constraint set we need. JSON primitives. Reports DOF and conflicting/redundant constraints. The published build's 16 MB heap and dense matrices limit large sketches; per-component solving keeps the usual sketch sub-millisecond. |
| Worker RPC | **Comlink** | Typed, promise-based worker calls. Transferable typed arrays. |
| Fonts → curves | **opentype.js** | Text tool (Phase 4). |
| Storage (web) | **OPFS** for project blobs + **IndexedDB** (via `idb`) for the index and metadata | Fast, large quota, works offline. `navigator.storage.persist()`. |
| Zip | **fflate** | Project files and 3MF are zip containers. |
| Code editor (Phase 5) | **Monaco** | TypeScript IntelliSense for script features. |
| Tests | **Vitest** (unit, kernel-in-Node), **Playwright** (E2E and screenshot tests) | Kernel and solver run in Node, so geometry is testable headless. |
| Lint / format | **Biome** | One fast tool. |
| Desktop (Phase 6) | **Electron** (+ electron-builder) | Same Chromium on Linux, Windows and macOS, so WebGL, WASM and OPFS behave the same everywhere. Tauri was rejected: it uses WebKitGTK on Linux, which has weaker WebGL/WASM performance and consistency. |
| Hosting | Static site as a **PWA**; host to be decided (leaning Hetzner) | No backend needed. The host must allow COOP/COEP headers. |

### Licensing note

OCCT and planegcs are LGPL. We load them as separate, replaceable `.wasm`
files, which keeps the LGPL obligations simple. The app is GPL-3.0-or-later;
the file-format spec and the `io`/`api` packages are MIT (decided 2026-09-25,
see *Open decisions* in `03-roadmap.md`).

## 2. High-level architecture

```
┌──────────────────────────── Main thread (UI) ─────────────────────────────┐
│  React app shell  ─ toolbar, browser tree, timeline, dialogs, palettes    │
│        │                                                                  │
│  Zustand stores:  documentStore (the saved design, JSON, undoable)        │
│                   sessionStore  (selection, active tool, UI)              │
│                   viewportStore (camera, display settings; ADR-0008)      │
│                   modelStore    (latest recompute results: meshes, errs)  │
│        │                                                                  │
│  Sketch session:  sketch tools ⇄ planegcs (WASM, main thread, sub-ms)     │
│        │                                                                  │
│  Viewport (R3F):  scene graph built from modelStore + sketch session      │
│                   picking via three-mesh-bvh + topology maps              │
│        │  Comlink RPC (structured clone + transferables)                  │
└────────┼──────────────────────────────────────────────────────────────────┘
         ▼
┌──────────────────────────── Kernel worker ────────────────────────────────┐
│  Recompute engine: walks the timeline, evaluates features incrementally   │
│  Feature evaluators (extrude, revolve, fillet, …) → OCCT operations       │
│  Shape cache (featureId + input hash → TopoDS_Shape), memory-capped       │
│  Topological naming service (persistent IDs + fingerprints)               │
│  Tessellator → Float32Array/Uint32Array + face/edge ID maps               │
│  Exporters: STL, 3MF, STEP                                                │
└───────────────────────────────────────────────────────────────────────────┘
         ▲
┌────────┴──────── Storage adapter (interface) ─────────────────────────────┐
│  Web: OPFS + IndexedDB        Desktop (later): Node fs via Electron IPC   │
└───────────────────────────────────────────────────────────────────────────┘
```

Key rule: **the document is plain JSON, and geometry is derived.** The saved
design is the list of features and parameters. B-rep shapes and meshes are
caches that can always be rebuilt. This keeps saving, undo, diffing, migrations
and scripting simple.

## 3. Monorepo layout

```
3d-composer-app/
├─ apps/
│  ├─ web/                 Vite + React app (UI shell, viewport, tools, dialogs)
│  │  └─ src/
│  │     ├─ shell/         app bar, toolbar, browser tree, timeline
│  │     ├─ viewport/      R3F scene, camera controls, ViewCube, nav bar,
│  │     │                 picking, gizmos (P0-05, ADR-0008)
│  │     ├─ sketch/        sketch mode UI + interactive tools (state machines)
│  │     ├─ features/      one folder per feature: dialog UI + manipulators
│  │     ├─ commands/      command registry, shortcuts, marking menu, palette
│  │     ├─ design-system/ tokens, Radix wrappers, icon set (P0-04, ADR-0007)
│  │     ├─ parameters/    <ExpressionInput>, Parameters dialog (P0-07)
│  │     ├─ home/          home screen: project grid, templates, trash (P0-08)
│  │     ├─ project/       project page, autosave, templates (P0-08)
│  │     └─ platform/      web implementations of platform interfaces
│  └─ desktop/             Electron shell (Phase 6): main, preload, fs adapter
├─ packages/
│  ├─ core/                document schema (zod), migrations, feature registry
│  │                       types, expressions and parameters, undo, IDs.
│  │                       Pure TS, no DOM, no WASM.
│  ├─ sketch/              sketch model, planegcs adapter, profile detection,
│  │                       inference and snapping math, SVG/DXF export
│  ├─ kernel/              kernel worker: OCCT loader, feature evaluators,
│  │                       recompute engine, topo naming, tessellation, exporters.
│  │                       Runs in a browser worker AND in Node.
│  ├─ io/                  STL/3MF/OBJ/SVG/DXF readers and writers
│  │                       (format-level, geometry-agnostic)
│  ├─ storage/             ProjectStore interface + OPFS/IndexedDB impl +
│  │                       .extrudo zip (de)serializer
│  └─ cli/                 (Phase 5) headless recompute and export
├─ fixtures/               sample projects, benchmark models (B1–B10), golden values
├─ docs/                   these documents + adr/ (architecture decision records)
└─ e2e/                    Playwright tests
```

Dependency direction (enforced by lint rule): `apps/* → packages/*`;
`kernel → core, sketch` (and `io` in its tests only, a devDependency:
P2-12's export tests check meshes with it); `sketch → core, io` (P1-13:
sketch export builds `io` drawings); `storage → core`; `core` and `io`
depend on nothing internal (`io` uses fflate for 3MF).

## 4. The document model

### 4.1 Shape of the data

```ts
interface ExtrudoDocument {
  format: 'extrudo'; formatVersion: number;       // migrations key off this
  id: string; name: string;
  settings: { units: 'mm'|'cm'|'m'|'in'; precision: number };
  parameters: Parameter[];                        // user parameters
  features: Feature[];                            // THE timeline, in order
  timelineMarker: number;                         // count of active features; the rest are rolled back
  bodies: Record<BodyId, BodyMeta>;               // name, colour, opacity, visibility (geometry is derived; ADR-0030)
  views: NamedView[];
  meta: { created: string; modified: string; appVersion: string };  // storage sets `modified`
}

interface Parameter { id: string; name: string; expression: string; unit: UnitKind; comment?: string }
// P4 adds `exposed` (customizer ranges, FR-PAR-05) as an optional field.

interface FeatureBase {
  id: FeatureId;                 // stable UUID, never reused
  type: FeatureType;             // 'sketch' | 'extrude' | 'revolve' | 'fillet' | …
  name: string;                  // "Extrude1", user-renamable
  suppressed: boolean;
  visible?: boolean;             // false hides its own geometry (a sketch); absent = shown (P1-12)
  inputs: Record<string, Input>; // typed per feature type (zod schema per type)
}
type Input =
  | { kind: 'expr'; expr: string; paramName?: string }   // becomes model parameter d17
  | { kind: 'enum'; value: string }
  | { kind: 'bool'; value: boolean }
  | { kind: 'ref'; refs: GeomRef[] }                     // faces/edges/profiles/planes…
  | { kind: 'sketchData'; sketch: SketchData };
```

The zod schema in `packages/core/src/schema.ts` is the authority (P0-06,
ADR-0003). Its objects are strict, and it checks document invariants: the
marker lies within the timeline, IDs and parameter names are unique. Loading
goes through `loadDocument`, which refuses newer format versions and runs the
migrations (one step per version, on raw JSON) before validating.

Sketch features hold their own `SketchData`: entities, constraints and
dimensions; the sketch's plane is a separate `ref` input. The **solved
coordinates are stored** too, so a sketch renders instantly and the solver
starts from the last solution. That keeps solutions stable: no flipping
between equivalent solutions on reload.

As built in P1-01 (ADR-0010, `packages/core/src/sketch/`): entities are
points, lines, circles and arcs; curves refer to their own points (a point
belongs to at most one curve, coincident constraints join them). Entities,
constraints and dimensions are records keyed by ID, one ID space per sketch.
Every FR-SK-07 constraint and FR-SK-08 dimension has a shape; dimension
values are expressions. The schema checks references (existence, kinds) on
load; geometry is the solver's job. Origin planes have fixed 2D frames that
match the ViewCube views.
P1-05 (ADR-0014) added ellipses (center, major-axis and minor-axis points)
and fit-point splines (a list of points). Both are shaped by
`sketch/curves.ts`: the spline is a cubic B-spline interpolated through its
points, and that B-spline (poles and knots), not the fit points, is what the
kernel will get.
P1-06 (ADR-0015) added the constraint tools and glyphs: a constraint the
user asks for is test-solved and refused if it is redundant, conflicts, or
collapses a curve; `removeFromSketch` deletes constraints and dimensions.
P1-07 (ADR-0016) added the Dimension tool and labels. Named driving
dimensions are model parameters in the parameter graph, which also
evaluates every driving dimension for the solver. A dimension stores its
label as an offset from its anchor, and an angle which pair of angles it
measures (`supplement`). A change to a value (in place, or a parameter a
dimension uses) and the solves of the sketches it moves are one undo step
(`ToolHost.apply`).

### 4.2 Feature registry (extension point)

Every feature type registers one object. Adding a feature means adding one
folder in `packages/kernel/features/` and one in `apps/web/src/features/`.

```ts
interface FeatureDefinition<I> {
  type: FeatureType;
  inputsSchema: ZodType<I>;              // validation + defaults
  icon: IconId; category: 'create'|'modify'|'construct'|…;
  evaluate(ctx: EvalContext, inputs: ResolvedInputs<I>): EvalResult;  // kernel side
  dialog: React.ComponentType<FeatureDialogProps<I>>;                // UI side
  manipulators?: …;                                                  // in-canvas handles
}
```

Core (P0-06) holds the data part (`type`, `label`, `category`, `icon`,
`inputsSchema`) as `FeatureDefinition`; the kernel adds `evaluate` and the web
app adds `dialog` and `manipulators`, each in its own
`FeatureRegistry<Extended>` keyed by the same type, so core depends on neither.
The same definitions later form the public scripting API (FR-PRG-01). A script
calling `doc.extrude({profile, distance: 'h'})` produces exactly the feature
the dialog would.

As built in P2-05 (ADR-0027): the web app's part is a declarative
`FeatureDialogSpec` (`apps/web/src/features/spec.ts`) extending core's
definition with `command` (a toolbar tool or its own), `fields`
(selection, expression, choice, toggle; optionally `shown`), and pure
`toInputs`/`fromInputs` (default: inputs named like the fields),
`validate`, `manipulators` (distance arrows and angle arcs in world mm)
and `previewStyle`. Specs are registered in `featureDialogs()`
(`features/registry.ts`); one generic dialog and one controller per
project (`features/dialog.ts`) do pre-selection, picking into fields
(persistent references with fingerprints), model parameter names, checks,
the live preview and OK/Cancel (one command).

As built for extrude (P2-06, ADR-0028): `packages/core/src/extrude.ts` holds
the inputs schema, where every input but `profiles` is optional with a
default (`extrudeSettings` fills them in; the kernel and the UI read the same
defaults) and inputs a direction doesn't use are ignored rather than refused,
so a dialog can keep them. Cross-field rules are the evaluator's and come
back as the feature's status. `extrudeInputs(profiles, options)` builds the
inputs from plain options, which is what a script call will do.

### 4.3 Expressions and parameters

- Small hand-written Pratt parser in `core/expr` (not mathjs, which is too big).
  It does dimensional analysis on length, angle and unitless.
- Model parameters (`d1`, `d2`…) are created automatically for every `expr`
  input. User parameters are global to the document.
- Evaluation builds a dependency graph (parameters ↔ parameters and features)
  with cycle detection. Changing a parameter marks dependent features dirty.
- As built in P0-07 (ADR-0004): `core/src/expr/` holds the parser (spans on
  every node), the evaluator (dimensions as length/angle exponents, values in
  mm and degrees; plain numbers take the context's unit), and
  `evaluateParameters(doc)`, which evaluates user and model parameters and
  every `expr` input, reports cycles with their path, and answers
  `dependents()` and `featuresAffectedBy()`. `ExprInput` carries an optional
  `unit` (default `length`). The UI side is `<ExpressionInput>` and the
  Parameters dialog in `apps/web/src/parameters/`.

### 4.4 Undo / redo

Every document mutation goes through a **command**
(`applyCommand(doc, cmd) → patches`). Immer produces forward and inverse
patches, which feed the undo stack. A sketch editing session is a nested
transaction: while in sketch mode, undo steps through sketch edits; on
"Finish sketch" they collapse into one timeline-level step.

As built in P0-06 (ADR-0003): a command is `{ type, label, payload, recipe }`
from `defineCommand`; recipes are deterministic (callers create IDs) and
reject invalid changes with `CommandError`. `UndoHistory` keeps one level per
open transaction; commit concatenates the level's patches into one entry,
cancel reverts them. The document store (`createDocumentStore`) holds the
deep-frozen document and exposes `dispatch`, `undo`, `redo` and the transaction
calls; the session store holds mode, tool, selection and hover; the model
store holds the kernel's results.

## 5. Geometry kernel design

### 5.1 Worker protocol (Comlink)

```ts
interface KernelApi {
  init(): Promise<KernelInfo>;
  recompute(req: { doc: ExtrudoDocument; dirtyFrom: number; tessellation: TessOpts })
    : Promise<RecomputeResult>;                      // cancellable via token
  preview(req: { doc; featureDraft: Feature }): Promise<PreviewResult>;  // live dialog preview
  profilesForSketch(sketch: SketchData, plane): Promise<ProfileRegion[]>;
  // P2-12 (ADR-0034), bodies of the last finished recompute:
  exportMeshes(bodies: BodyId[], tessellation: MeshOptions): Promise<{ id; mesh: ExportMesh }[]>;
  exportStep(bodies: { id: BodyId; name: string }[]): Promise<string>;   // AP242, mm
  measure(req: MeasureQuery): Promise<MeasureResult>;
}
interface RecomputeResult {
  perFeature: Record<FeatureId, { status: 'ok'|'warning'|'error'; message?: string }>;
  bodies: BodyMesh[];    // transferable arrays
  construction: …;       // planes, axes, points
}
interface BodyMesh {       // packages/kernel/src/mesh.ts (P0-09); all flat, all transferable
  positions: Float32Array; normals: Float32Array; indices: Uint32Array;
  faceRanges: Uint32Array;          // [firstTriangle, count] per face → face picking
  edgePoints: Float32Array;         // edge polylines, xyz per point
  edgeRanges: Uint32Array;          // [firstPoint, count] per edge
  vertices: Float32Array;           // xyz per B-rep vertex
  faceIds?: string[]; edgeIds?: string[]; vertexIds?: string[];  // TopoIds (P2-04)
}
// Faces, edges and vertices are in the kernel's sub-shape order. The TopoIds
// (ADR-0005) are parallel to the ranges; recompute fills them for every body.
// Later: bbox, volume and area per body.
```

P0-09 implements the plumbing: `KernelApi` has `init`, `stats` and two debug
commands (`debugTestPart` renders the P0-02 test part at `#/debug/kernel`,
`debugCrash` aborts the WASM). The worker side is `KernelService`; the UI side
is `KernelClient`, which restarts the worker after a crash.

- **Incremental recompute:** each feature's output is cached under
  `hash(feature inputs + resolved parameter values + upstream output hash)`.
  Undo and parameter scrubbing often hit the cache.
- **Cancellation:** a new recompute request cancels the running one between
  features. Previews are debounced (about 60 ms).
- **Previews (P2-05, ADR-0027):** `preview({ doc, draft, index, base? })`
  walks the timeline before `index`, then the draft. An evaluator may add
  `previewTools: { shape, style: 'new'|'join'|'cut'|'intersect' }[]` to
  its output (owned by the cache like its other shapes); a preview result
  carries the draft's tools meshed (`tools: { mesh, style }[]`), and with
  `base` the bodies before the draft (`base: BodyResult[]`, for editing a
  feature). `recompute` ignores tools. `reference(body, kind, index,
  base?)` fingerprints a sub-shape of the last recompute's bodies, or of
  the last preview's base.
- As built in P2-01 (ADR-0024, `packages/kernel/src/recompute/`): the
  engine walks the whole active timeline and each feature is found by its
  key, so there is no dirty index; "upstream" is the features it refers to
  (`<feature>/…` reference IDs) plus the body set before it, unless its
  evaluator declares `bodyAccess: 'none'`. Shapes in the cache are
  reference-counted; the engine checks each evaluation for leaked shapes.
  `recompute(request, onFeature)` returns per-feature status and the bodies
  at the marker, meshing only those whose `version` the caller doesn't
  `have`, and each feature's optional `report` (plain JSON for the UI:
  a sketch's frame and projections, P2-09). The UI side is `Recomputer`
  (one `KernelClient` per open project), which fills the model store.
- **Memory:** OCCT objects in Emscripten are not garbage-collected. All
  evaluator code uses a `using`/`scope.track()` disposal pattern, and the cache
  deletes shapes on eviction. This is a hard coding rule.
- **Crash recovery:** a WASM abort kills the kernel. `KernelClient` restarts
  the worker (at most 3 times a minute) and calls `onRestart`, where Phase 2
  re-sends the document and marks the feature that crashed as an error.
- **Building the WASM:** `packages/kernel/occt/` holds the build config and the
  C++ facade. CI builds each input hash once and publishes it as a release;
  `pnpm occt ensure` downloads it (see that folder's README).

### 5.2 Topological naming: the hardest problem

Features such as fillet, chamfer, shell, "sketch on face" and "extrude to
face" reference faces and edges of earlier results. When an upstream edit
changes the topology, those references must still resolve to the right
geometry. FreeCAD suffered from this for years. We design for it from Phase 2,
not as an afterthought.

Strategy, following the approach used by Onshape and the FreeCAD 1.0 TNP work:

1. **Persistent IDs at creation.** Each face and edge produced by a feature
   gets an ID derived from *why it exists*, not its index. For example
   `extrude:<fid>:side:<sketchCurveId>`, `extrude:<fid>:cap:end`,
   `fillet:<fid>:face:<edgeRefId>`. Sketch entity IDs are stable UUIDs, so
   extrude side faces stay named when the sketch changes.
2. **Propagate through operations** using OCCT history
   (`BRepBuilderAPI_MakeShape::Modified/Generated/IsDeleted`,
   `BRepAlgoAPI_*` history). Split faces get suffixed IDs (`…#1`, `…#2`)
   ordered by a deterministic geometric rule.
3. **Fingerprint fallback.** Each stored reference also keeps a fingerprint:
   surface type, normal or axis, centroid, area or length, and adjacent
   persistent IDs. If the ID doesn't resolve, the best fingerprint match above a
   threshold is used and the feature gets a **warning**.
4. **Repair UI.** An unresolved reference turns the feature red. "Fix
   references" shows the old geometry as a ghost and lets the user re-pick.

The topo-naming service gets its own test suite: edit a sketch dimension or add
and remove a sketch edge, then assert the fillet still sits on the "same" edges.

As built in P2-04 (ADR-0005, `packages/kernel/src/naming/`):

- **Faces are named, edges and vertices after their faces.** A face name is
  `op:feature:role[:source]` plus `#n` split numbers
  (`extrude:E:cap:end`, `extrude:E:side:<curveId>`,
  `fillet:F:from:(<edge name>)`, `extrude:E:cap:end#2`); an edge is
  `e[<faces, sorted>]`, a vertex `v[…]`, with `@n` where several share
  their faces. Nested names go in parentheses; names never contain `/`.
  `#n` and `@n` follow one geometric order: position (x, y, z within
  1e-6 mm), then size, then index.
- **Naming tables** (`TopoNames`, one name per face/edge/vertex in
  sub-shape order) come back from evaluators in `FeatureOutput.names`; the
  engine keeps them per cached shape, fills `BodyMesh.faceIds/edgeIds/
  vertexIds`, and names bodies without a table by position.
- **Operations that name** (`namedPrism`, `namedRevolve`, `namedBoolean`,
  `withHistory`): the facade's `prism`/`revolve` record `generated`,
  `first` and `last` per sub-shape of the swept face; booleans and
  fillets `modified`/`kept`/`generated`/`deleted` per input. A face keeps
  its source's name; merged faces keep the target's; generated faces are
  named after their source.
- **Fingerprints** in `GeomRef.fingerprint` (optional): type, centroid or
  midpoint, normal or axis, area or length, neighbouring face names, from
  the facade's `describe`. `KernelApi.reference(body, kind, index)` makes a
  reference with its fingerprint for a picked sub-shape.
- **Resolution** (`EvalContext.resolve`): exact name; else a related name
  (a piece of the face, or the whole it was a piece of; for edges and
  vertices, face by face), silent if unique; else the best fingerprint
  scoring ≥ 0.6. Guesses turn the feature into a warning; no match fails
  it with a message that says to pick again.

As built in P2-06 (ADR-0028, `packages/kernel/src/features/extrude.ts`):
the extrude unions its profiles and faces into one planar source (a 2D
fuse that carries edge sources through history), sweeps it with the
facade's `prism`, whose optional taper runs `BRepOffsetAPI_DraftAngle` on
the side faces and returns the straight sweep's history carried through
the draft (checked for sides that cross or cones past their tip), trims a
side at an inclined "to object" face with a box whose face in the plane is
named as the end cap, and makes new bodies (one per solid) or joins, cuts
or intersects the participants (automatic: the bodies it touches, by the
facade's `distance`). A tapered symmetric or two-sided extrude is two
prisms from the sketch plane, side 2's faces named `side2:<source>`.
`FeatureOutput.previewTools` carries the swept tool of a join, cut or
intersect for the dialog's preview; the cache owns those handles like any
output shape.

Revolve (P2-07, ADR-0029, `packages/kernel/src/features/revolve.ts`)
shares extrude's sources (`features/sources.ts`: profiles and flat faces
united into one planar source) and body operations
(`features/operation.ts`: new bodies, join, cut, intersect, explicit
bodies). Its axis is an origin axis (`{ kind: 'axis', id: 'origin:x' }`),
a sketch line (`sketchEntity`, `<sketch>/<line>`, placed by the sketch
output's frame and its new `lines` table, so the engine's dependency
hashing sees the sketch) or a straight body edge (`ctx.resolve` +
`describe`). It must lie in the profiles' plane, and every profile on one
side of it (each part's overlap with a half-plane face). A turn that
doesn't start at the profile (symmetric, two sides) first turns the
profile to its start (the end face of a revolve by the start angle, edge
sources carried through its `last` history), so the result is one sweep
named like a one-sided one. Like extrude's, its result goes through
`splitSolids` (P2-08).

Primitives (P2-10, ADR-0032, `packages/kernel/src/features/primitives.ts`):
`box`, `cylinder`, `sphere` and `torus` sit on an origin plane or a flat
face (resolved by name; the face's sketch frame, `faceSketchFrame`) at x,
y and an offset in that frame. They are planar faces from `planarFaces`
swept by `namedPrism` (box, cylinder) or a whole-turn `namedRevolve` (a
half disc, a circle), so every face is named (`box:<id>:side:front`…),
then go through extrude's `operate` and `splitSolids`. No facade
primitives: `makeBox`/`makeCylinder` have no history.

Bodies (P2-08, ADR-0030, `packages/kernel/src/features/bodies.ts`): a
body the feature made or changed that holds several separate solids is
split into one body per solid (`splitSolids`, called on the evaluator's
result): the largest piece keeps the body ID, the others take the
feature's next free `<feature>:<n>` in geometric order, each with the
whole's face names. Deleting a body is a **Remove** feature (`remove`,
`bodyAccess: 'write'`): the body set without the bodies it names. On the
UI thread, a recompute result names the document it is for
(`ModelState.doc`); `followBodyNames` then stores metadata for live
bodies without any, **amended into the latest undo step**
(`DocumentState.amend`, `UndoHistory.amend`), so names ("Body3") never
renumber and undo and redo take them along with the step that made the
bodies.

### 5.3 Sketch → geometry

- Solving happens in the main thread. The kernel receives solved geometry
  only. The `sketch` adapter (`SketchSolver`, P1-03, ADR-0011) keeps one
  planegcs system per independent component (geometry linked through
  constraints; fixed geometry has no unknowns and links nothing), so a drag
  or an edit re-solves only its component. `solve(sketch, values)` takes the
  whole sketch each time and, per component, skips it (same input objects),
  writes new values into its system (a dimension, an undo) or rebuilds it
  (its equations changed). A drag binds temporary coordinate constraints to
  two sketch parameters and updates them per frame, without rebuilding the
  system: 0.18 ms per step at 198 entities in 22 components, 11.4 ms for one
  99-entity component. One large coupled component is slow, because
  planegcs uses dense matrices, and a closed loop of arcs worst of all (a
  104-curve gear: about 1 s per drag step; ADR-0011). Before a constraint is
  committed, `check()` test-solves its component in a scratch system.
- Profile detection: a fast TS planar-arrangement pass gives instant hover
  shading while drawing. The authoritative regions come from OCCT
  (`BOPAlgo_Builder` on sketch edges → faces), which handles splines and
  tangencies robustly. Region IDs are derived from their bounding sketch-curve
  IDs, which makes them persistent. P1-11 built the TypeScript pass
  (`@extrudo/sketch/profiles`, ADR-0020). P2-02 built the OCCT faces
  (ADR-0025): the sketch evaluator stages exact curves in the facade,
  which splits them with General Fuse and makes faces with
  `BOPAlgo_BuilderFace`; each face is keyed from its outer wire's curves
  and directions with the arrangement's own `profileKey`/`profileIds`, so
  a profile the user picks is the face an extrude gets
  (`ctx.output(sketch).shapes[region]`).
- A sketch's plane is a reference (origin plane, construction plane or a face's
  persistent ID), re-derived on each recompute, so a sketch on a face follows
  that face. P2-09 (ADR-0031) built it: the evaluator resolves the face
  with `ctx.resolve` and takes its frame by one rule (`faceSketchFrame`:
  origin = world origin on the plane; floors and roofs X along world X,
  walls Y up the face), published as `SketchOutputData.frame` and as the
  sketch's report to the UI (`FeatureOutput.report` →
  `RecomputeResult.reports` → `ModelState.sketches`); until the kernel
  answers, the UI uses the frame of the reference's fingerprint.
- Projected geometry (FR-SK-12, ADR-0031) is stored: a projection record
  (`SketchData.projections`: the source edge or face as a `GeomRef`, and
  its curves by source key) plus ordinary entities the solver holds fixed.
  The kernel projects the sources on every recompute (exact edge geometry
  and cylinder/cone silhouettes from the facade) and reports the curves;
  profiles and faces come from the stored curves. The app brings the
  sketch in line (`projectionSync`, then a solve) and amends that into the
  undo step whose edit moved the model.

### 5.4 Tessellation and rendering

- `BRepMesh_IncrementalMesh` with deflection tied to the model size. Export
  (P2-12, ADR-0034) meshes a topology copy at its own deflection (presets
  0.1 / 0.02 / 0.005 mm) and welds nodes along edges through
  `Poly_PolygonOnTriangulation`, so a solid gives one closed, manifold
  mesh; the display mesh keeps per-face nodes.
- Faces are rendered as one merged `BufferGeometry` per body, with `faceRanges`
  for picking and highlight (highlight via a vertex-colour/attribute update, not
  separate meshes).
- Edges are rendered as `LineSegments2` (screen-space width). Silhouette
  edges of curved faces (P2-08, ADR-0030, `viewport/silhouette.ts`) are the
  zero line of `n · (eye − p)` over the mesh's smooth normals, one segment
  per triangle whose nodes change sign, recomputed in the frame loop when
  the camera moves; drawn in the wireframe and hidden-edge styles only.
- Bodies take their stored colour and opacity (a see-through body doesn't
  write depth).
- Picking: three-mesh-bvh raycast for faces, with a screen-space distance test
  against edge polylines and vertices. Selection priority follows the active
  filter.
- As built in P2-03 (ADR-0026, `apps/web/src/selection/`): picking is pure
  maths over the meshes (an indirect BVH per mesh, so the index stays in
  `faceRanges` order); edges within 6 px and vertices within 8 px of the
  pointer, hidden ones (a face between the camera and them) only offered by
  "Select other…"; priority vertex, edge or sketch curve, profile or face,
  body. Faces are tinted through a `color` attribute on the merged geometry
  (only the changed faces' nodes are rewritten and uploaded); hovered and
  selected edges and vertices are small accent overlays, and vertices only
  show as dots while hovered or selected. The selection is the session
  store's: faces, edges and vertices as `{ kind, id: "<body>:<index>" }`,
  turned into `GeomRef`s through the mesh's `faceIds`/`edgeIds`/`vertexIds`
  (P2-04) by `topologyRef`/`selectionRefs`.
- P2-07 (ADR-0029) adds the origin axes to model picking: `PickScene.axes`
  (drawn axes only), picked by the ray's closest approach like edges, after
  edges, profiles and faces, as `{ kind: 'axis', id: 'origin:x' }` items; `Origin.tsx` draws a
  hovered or selected axis in the accent.

## 6. Storage and file format

### 6.1 ProjectStore interface

As built in P0-08 (ADR-0009, `packages/storage`); a project is identified by
its document's ID:

```ts
interface ProjectStore {
  list(): Promise<ProjectSummary[]>;          // trashed ones too, newest first
  get(id): Promise<ProjectSummary | undefined>;
  load(id): Promise<ExtrudoDocument>;         // migrated and validated
  save(doc): Promise<ProjectSummary>;         // stamps meta.modified on the stored copy
  rename/duplicate(id); trash/restore/purge(id);
  thumbnail(id): Promise<Blob | null>; setThumbnail(id, png): Promise<void>;
  exportFile(id): Promise<Blob>;              // .extrudo
  importFile(blob): Promise<ProjectSummary>;  // a copy if the ID exists
}
// P2-14 adds save(doc, { asVersion }), versions(id), loadVersion(id, v).
```

- **Web:** IndexedDB (`extrudo`) holds the project index. OPFS holds
  `projects/<id>/document.json` and `thumbnail.png` (later `versions/` and
  attachments); where OPFS can't write files, an IndexedDB `files` store
  does. `createWritable` replaces a file atomically on `close()`. The
  document is written before the index entry.
- **Desktop (Phase 6):** the same interface over Node `fs` through Electron IPC.
  Projects are plain `.extrudo` files in a user folder, with recent-files and
  file associations.

### 6.2 `.extrudo` file (zip)

```
manifest.json      { format:"extrudo", formatVersion, appVersion, created, units }
document.json      the ExtrudoDocument (source of truth)
thumbnail.png      256×256
attachments/       fonts, canvas images, imported STEP/STL referenced by features
cache/             OPTIONAL: brep per body, dropped if stale/unknown version
```

Why our own format: Fusion's `.f3d` is proprietary and undocumented. STEP
stores only final geometry, not history or parameters. So `.extrudo` is the
editable source, and STEP, STL and 3MF are exports. The format spec is
published in `docs/file-format.md` (written in Phase 2) so other tools can read
it.

## 7. Web platform details

- **Single-threaded WASM first.** Multi-threaded OCCT needs
  `SharedArrayBuffer`, which needs COOP/COEP headers. GitHub Pages can't set
  those; Cloudflare Pages can (`_headers`). Stay single-threaded until profiling
  shows a need.
- **WASM size:** the full prebuilt libcascade build is 42.7 MB raw, 8.2 MB
  brotli, and takes about 0.8 s to initialise. Our own trimmed build (P0-02,
  198 bindings) is 19.9 MB raw, 4.34 MB brotli, and starts in about 0.2 s.
  From P0-09 on we ship our own build. Target under 8 MB brotli. Serve with long-lived caching plus the service
  worker.
- **PWA:** a service worker (Workbox via `vite-plugin-pwa`) precaches the app
  and WASM for offline use and install.

## 8. Electron readiness checklist (applies from day one)

- No direct `window.showSaveFilePicker`, `localStorage` or `fetch` to our own
  origin from feature code. Go through `platform/` interfaces
  (`FileDialogs`, `ProjectStore`, `SlicerLauncher`, `Clipboard`). As of
  P0-08: `Platform.preferences`, `.projects`, `.storage`, `.files`; `.rescue`
  (synchronous copies of unsaved documents, ADR-0009 amendment).
- No reliance on URL routing that needs a server. Use hash routing or in-app
  state.
- Asset URLs are relative (Vite `base: './'`).
- Keyboard shortcuts go through one registry, so desktop menus can reuse them.

## 9. Testing strategy

| Layer | What | Tool |
|---|---|---|
| core | expression parser, units, migrations, undo patches, schema | Vitest |
| sketch | solver adapter: every constraint type, DOF counts, conflict reporting; profile detection; SVG and DXF export golden files (`src/export/golden/`) | Vitest (planegcs in Node) |
| io | format writers: number formatting, bounds, flattening tolerance, SVG arc flags and size, DXF entities and bulges | Vitest |
| kernel | each feature: result valid (`BRepCheck_Analyzer`), volume, area, bbox and face count against golden values; topo-naming stability suite; STL is manifold (edge-manifold check); 3MF opens (schema) | Vitest (OCCT in Node) |
| app | tool state machines, command registry | Vitest + Testing Library |
| E2E | benchmark models B1–B10 built through the UI; screenshot diffs of key screens | Playwright |
| perf | recompute timings for fixtures; sketch solve timings; bundle size budget | Vitest bench, CI budget check |

CI (GitHub Actions): typecheck, lint, unit, kernel tests, E2E on Chromium,
bundle-size budget. Every agent task must leave CI green.

## 10. Architecture decision records

`docs/adr/NNNN-title.md`, one per significant decision. Initial ADRs to write:

- **ADR-0001** Geometry kernel: OCCT WASM (`libcascade`) raw vs replicad vs
  brepjs. **Written 2026-09-25:** own trimmed libcascade build with a C++
  facade.
- **ADR-0002** Sketch solver: planegcs on the main thread. **Written
  2026-09-25:** our own planegcs build, one solver system per independent
  component.
- **ADR-0003** Document-as-JSON, geometry-as-cache. **Written 2026-09-25**
  as "Document model, commands and undo": strict zod schema with migrations on
  raw JSON, deterministic commands with Immer patches, nested undo
  transactions, three vanilla Zustand stores.
- **ADR-0004** Expression language, units and parameters. **Written
  2026-09-25** (P0-07): Pratt parser, length/angle dimensions in mm and
  degrees, plain numbers take the context unit, one namespace for user and
  model parameters, cycle paths, rename-safe commands.
- **ADR-0005** Topological naming strategy (§5.2). **Written 2026-09-27**
  (P2-04): faces named by their feature and carried by OCCT history,
  edges and vertices named after their faces, geometric numbering of
  repeats, naming tables in the shape cache, fingerprints in `GeomRef`,
  resolution by exact name, related name, then fingerprint.
- **ADR-0006** Electron over Tauri for desktop.
- **ADR-0007** Design system and app shell. **Written 2026-09-25** (P0-04):
  tokens as CSS variables through Tailwind v4 `@theme inline`, Radix
  wrappers, raw-SVG icon pipeline with a rules test, platform preferences,
  one shortcut registry, screenshot tests checked in the Ubuntu image.
- **ADR-0008** Viewport, camera and navigation. **Written 2026-09-25**
  (P0-05): Z-up world, our own camera controller (target + quaternion +
  size, both projections), mouse presets as tables, shader grid, CSS 3D
  ViewCube, viewport store in the web app with settings as preferences.
- **ADR-0009** Project storage, autosave and the home screen. **Written
  2026-09-25** (P0-08): `ProjectStore` over an IndexedDB index and OPFS
  files, `.extrudo` zip through core's migrations, autosave with a save
  state, thumbnails from the viewport, hash routes, home screen.
- **ADR-0010** Sketch data model and sketch mode. **Written 2026-09-25**
  (P1-01): plane as a `ref` input, points as entities owned by one curve,
  records keyed by ID, every constraint and dimension type, origin plane
  frames, sketch mode as an undo transaction.
- **ADR-0011** Sketch solver adapter. **Written 2026-09-26** (P1-03): the
  planegcs build in CI per input hash, the mapping of every type, fixed
  geometry as constants, incremental solving per component, drag, the
  test-solve, and the gear-outline measurement.
- **ADR-0024** Recompute engine. **Written 2026-09-27** (P2-01):
  content-keyed feature cache, body access per evaluator, reference-counted
  shapes, cancellation at yields, previews, the `Recomputer`, status
  display.
- **ADR-0025** Sketch to kernel. **Written 2026-09-27** (P2-02): exact
  edges in the facade, General Fuse and the face builder, bridges and
  dangling pieces dropped, touching wires as one loop, faces keyed by the
  arrangement's own rule, a geometric safety net.
- **ADR-0026** B-rep rendering and 3D selection. **Written 2026-09-28**
  (P2-03): one session selection with topology items by mesh index,
  references from persistent IDs, pure picking with a BVH and screen-space
  edges and vertices, occlusion by a second ray, one kind per box, face
  tints through a colour attribute, "Select other…", the selection filter
  with Select.
- **ADR-0027** Feature dialog framework. **Written 2026-09-28** (P2-05):
  declarative dialog specs in the web app's registry, one controller per
  project, pre-selection, selection fields of persistent references with
  their own filter, model parameter names per dialog, live previews
  through the `Recomputer` with the kernel's preview tools (ghosts, cut
  red, join green) and the bodies before an edited feature, dimmed on
  invalid input, manipulators (distance arrow, angle arc) with a heads-up
  box, OK as one command, e2e on `#/debug/dialog`.
- **ADR-0028** Extrude. **Written 2026-09-28** (P2-06, kernel and document
  part): optional inputs with shared defaults, profiles unioned before the
  sweep, taper through `DraftAngle` with history and sanity checks, two
  prisms for tapered two-sided extrudes, trimming at inclined objects,
  participants by distance, one body per solid, preview tools in the
  feature output.
- **ADR-0029** Revolve. **Written 2026-09-28** (P2-07): origin axes,
  sketch lines and straight edges as axes, the one-side check by
  half-plane overlap, symmetric and two-sided turns as one sweep from the
  profile turned to its start, extrude's sources and body operations
  shared, origin axes pickable in the model, arcs that go on round.
- **ADR-0030** Bodies. **Written 2026-09-28** (P2-08): stored body names
  amended into the undo step that made the bodies, one body per solid
  (the largest keeps the ID), the Remove feature, colour swatches and
  opacity, browser rows that pick into the selection, silhouettes of
  curved faces.
- **ADR-0031** Sketch on face and Project. **Written 2026-09-28** (P2-09):
  the face frame rule (world origin on the plane, X along world X on
  floors, Y up walls, switching at 40°), frames reported to the UI with a
  fingerprint fallback, Create Sketch picking the nearer of a flat face
  and an origin plane, projection records with curves as fixed ordinary
  entities, exact projection and cylinder/cone silhouettes in the kernel,
  and the app's sync amended into the undo step that moved the model.
- **ADR-0032** Primitives. **Written 2026-09-28** (P2-10): four feature
  types with a shared placement (plane or flat face, x/y in its sketch
  frame, offset, a box's rotation), solids from named prisms and revolves
  of planar faces, proposals (XY, the face's centre, join/cut), and
  Create Sketch's plane-or-face picker reused for a dialog's Plane field.
