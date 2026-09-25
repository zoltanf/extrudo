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
| Sketch constraint solver | **planegcs** (FreeCAD's PlaneGCS in WASM, LGPL-2.1-or-later), **our own build** of `@salusoft89/planegcs` with memory growth and two pivoting patches; one solver system per independent sketch component (ADR-0002) | Proven solver with the constraint set we need. JSON primitives. Reports DOF and conflicting/redundant constraints. The published build's 16 MB heap and dense matrices limit large sketches; per-component solving keeps the usual sketch sub-millisecond. |
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
│                   sessionStore  (selection, active tool, camera, UI)      │
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
│  │     ├─ shell/         app bar, toolbar, browser tree, timeline, nav bar
│  │     ├─ viewport/      R3F scene, camera controls, ViewCube, picking, gizmos
│  │     ├─ sketch/        sketch mode UI + interactive tools (state machines)
│  │     ├─ features/      one folder per feature: dialog UI + manipulators
│  │     ├─ commands/      command registry, shortcuts, marking menu, palette
│  │     ├─ design-system/ tokens, Radix wrappers, icon set
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
`kernel → core, sketch`; `sketch → core`; `storage → core`; `core` depends on
nothing internal.

## 4. The document model

### 4.1 Shape of the data

```ts
interface ExtrudoDocument {
  format: 'extrudo'; formatVersion: number;       // migrations key off this
  id: string; name: string;
  settings: { units: 'mm'|'cm'|'m'|'in'; precision: number };
  parameters: Parameter[];                        // user parameters
  features: Feature[];                            // THE timeline, in order
  timelineMarker: number;                         // index; features after it are rolled back
  bodies: Record<BodyId, BodyMeta>;               // name, colour, visibility (geometry is derived)
  views: NamedView[];
  meta: { created: string; modified: string; appVersion: string };
}

interface Parameter { id: string; name: string; expression: string; unit: UnitKind; comment?: string; exposed?: ExposeOpts }

interface FeatureBase {
  id: FeatureId;                 // stable UUID, never reused
  type: FeatureType;             // 'sketch' | 'extrude' | 'revolve' | 'fillet' | …
  name: string;                  // "Extrude1", user-renamable
  suppressed: boolean;
  inputs: Record<string, Input>; // typed per feature type (zod schema per type)
}
type Input =
  | { kind: 'expr'; expr: string; paramName?: string }   // becomes model parameter d17
  | { kind: 'enum'; value: string }
  | { kind: 'bool'; value: boolean }
  | { kind: 'ref'; refs: GeomRef[] }                     // faces/edges/profiles/planes…
  | { kind: 'sketchData'; sketch: SketchData };
```

Sketch features hold their own `SketchData`: entities, constraints, dimensions
and plane reference. The **solved coordinates are stored** too, so a sketch
renders instantly and the solver starts from the last solution. That keeps
solutions stable: no flipping between equivalent solutions on reload.

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

The same definitions later form the public scripting API (FR-PRG-01). A script
calling `doc.extrude({profile, distance: 'h'})` produces exactly the feature
the dialog would.

### 4.3 Expressions and parameters

- Small hand-written Pratt parser in `core/expr` (not mathjs, which is too big).
  It does dimensional analysis on length, angle and unitless.
- Model parameters (`d1`, `d2`…) are created automatically for every `expr`
  input. User parameters are global to the document.
- Evaluation builds a dependency graph (parameters ↔ parameters and features)
  with cycle detection. Changing a parameter marks dependent features dirty.

### 4.4 Undo / redo

Every document mutation goes through a **command**
(`applyCommand(doc, cmd) → patches`). Immer produces forward and inverse
patches, which feed the undo stack. A sketch editing session is a nested
transaction: while in sketch mode, undo steps through sketch edits; on
"Finish sketch" they collapse into one timeline-level step.

## 5. Geometry kernel design

### 5.1 Worker protocol (Comlink)

```ts
interface KernelApi {
  init(): Promise<KernelInfo>;
  recompute(req: { doc: ExtrudoDocument; dirtyFrom: number; tessellation: TessOpts })
    : Promise<RecomputeResult>;                      // cancellable via token
  preview(req: { doc; featureDraft: Feature }): Promise<PreviewResult>;  // live dialog preview
  profilesForSketch(sketch: SketchData, plane): Promise<ProfileRegion[]>;
  export(req: { format: 'stl'|'3mf'|'step'; bodies: BodyId[]; opts }): Promise<Uint8Array>;
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
}
// Faces, edges and vertices are in the kernel's sub-shape order. P2-04 adds
// faceIds / edgeIds / vertexIds (persistent TopoIds, parallel to the ranges),
// and recompute adds bodyId, bbox, volume and area.
```

P0-09 implements the plumbing: `KernelApi` has `init`, `stats` and two debug
commands (`debugTestPart` renders the P0-02 test part at `#/debug/kernel`,
`debugCrash` aborts the WASM). The worker side is `KernelService`; the UI side
is `KernelClient`, which restarts the worker after a crash.

- **Incremental recompute:** evaluate from the first dirty feature. Each
  feature's output is cached under `hash(feature inputs + resolved parameter
  values + upstream output hash)`. Undo and parameter scrubbing often hit the
  cache.
- **Cancellation:** a new recompute request cancels the running one between
  features. Previews are debounced (about 60 ms).
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

### 5.3 Sketch → geometry

- Solving happens in the main thread. The kernel receives solved geometry
  only. The `sketch` adapter keeps one planegcs system per independent
  component (geometry linked through constraints; constraints to fixed
  geometry don't link), so a drag or an edit re-solves only its component:
  0.16 ms per drag step and 0.8 ms per constraint edit at 500 entities in the
  P0-03 spike. A drag binds temporary coordinate constraints to two sketch
  parameters and updates them per frame, without rebuilding the system. One
  large coupled component (100+ entities) is slow, because planegcs uses dense
  matrices (ADR-0002).
- Profile detection: a fast TS planar-arrangement pass gives instant hover
  shading while drawing. The authoritative regions come from OCCT
  (`BOPAlgo_Builder` on sketch edges → faces), which handles splines and
  tangencies robustly. Region IDs are derived from their bounding sketch-curve
  IDs, which makes them persistent.
- A sketch's plane is a reference (origin plane, construction plane or a face's
  persistent ID), re-derived on each recompute, so a sketch on a face follows
  that face.

### 5.4 Tessellation and rendering

- `BRepMesh_IncrementalMesh` with deflection tied to the model size. Separate
  (finer) settings for export.
- Faces are rendered as one merged `BufferGeometry` per body, with `faceRanges`
  for picking and highlight (highlight via a vertex-colour/attribute update, not
  separate meshes).
- Edges are rendered as `LineSegments2` (screen-space width). Silhouette edges
  come later.
- Picking: three-mesh-bvh raycast for faces, with a screen-space distance test
  against edge polylines and vertices. Selection priority follows the active
  filter.

## 6. Storage and file format

### 6.1 ProjectStore interface

```ts
interface ProjectStore {
  list(): Promise<ProjectSummary[]>;
  load(id): Promise<ExtrudoDocument>;
  save(doc, opts?: { asVersion?: string }): Promise<void>;
  versions(id): Promise<VersionInfo[]>; loadVersion(id, v): Promise<ExtrudoDocument>;
  rename/duplicate/trash/restore/purge(id): Promise<void>;
  thumbnail(id): Promise<Blob | null>; setThumbnail(id, png): Promise<void>;
  exportFile(id): Promise<Blob>;          // .extrudo
  importFile(blob): Promise<ProjectId>;
}
```

- **Web:** IndexedDB holds the project index and version list. OPFS holds
  `projects/<id>/current.json`, `versions/<n>.json.gz`, `thumb.png` and
  attachments. Writes are atomic (write temp, then rename) where OPFS allows.
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
  (`FileDialogs`, `ProjectStore`, `SlicerLauncher`, `Clipboard`).
- No reliance on URL routing that needs a server. Use hash routing or in-app
  state.
- Asset URLs are relative (Vite `base: './'`).
- Keyboard shortcuts go through one registry, so desktop menus can reuse them.

## 9. Testing strategy

| Layer | What | Tool |
|---|---|---|
| core | expression parser, units, migrations, undo patches, schema | Vitest |
| sketch | solver adapter: every constraint type, DOF counts, conflict reporting; profile detection; SVG export golden files | Vitest (planegcs in Node) |
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
- **ADR-0003** Document-as-JSON, geometry-as-cache.
- **ADR-0004** Topological naming strategy (§5.2).
- **ADR-0005** Electron over Tauri for desktop.
