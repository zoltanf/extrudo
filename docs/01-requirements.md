# 01 — Product Requirements

Product name: **Extrudo** (decided 2026-09-25). Files use the `.extrudo` extension; packages use the `@extrudo/*` scope.

## 1. Vision

A fast, friendly, open-source **parametric CAD app in the browser**, built for the
3D-printing community. It borrows the proven *workflow* of Fusion 360 (sketch →
feature → timeline, parameters everywhere) and puts a playful, modern interface
on it. It aims to be easier than FreeCAD and quicker than Fusion 360.

It is one codebase that runs as a website (installable PWA, works offline) and
later as an Electron desktop app for Linux, Windows and macOS.

## 2. Target users

| Persona | Needs |
|---|---|
| **Hobby maker** (primary) | Model brackets, boxes, clips, enclosures and replacement parts in minutes. Export an STL or 3MF and slice it. Has never used CAD, or gave up on FreeCAD. |
| **Fusion 360 refugee** | Wants the same mental model and shortcuts without a license, cloud lock-in or slow startup. |
| **Parametric designer** | Publishes customizable models (MakerWorld / Printables style), so needs parameters, variants and eventually scripting. |
| **Tinkerer / programmer** (later) | Wants OpenSCAD-style code-driven parts, mixed with interactive modeling. |

## 3. Product principles

1. **Parametric from day one.** Every numeric input takes an expression and can
   reference named parameters. Change a parameter and the whole history
   recomputes.
2. **History-based.** The design is an ordered list of features on a timeline.
   The user can roll back, edit, reorder and suppress features.
3. **Printing-first.** STL and 3MF export are first-class. Units default to mm.
   Tools for print concerns (overhangs, bed placement, clearances, threads) come
   before engineering-only features.
4. **Fast.** The UI never blocks. The geometry kernel runs in a Web Worker.
   Recompute is incremental. Cold start under 3 s once cached.
5. **Playful but precise.** Friendly icons, motion and colour, with exact B-rep
   geometry (true circles and fillets, not triangle soup) underneath.
6. **Familiar.** Layout, terminology and default shortcuts follow Fusion 360 so
   its users feel at home. We copy the concepts only: no Autodesk code, icons,
   assets or trademarks.
7. **Local-first and open.** Projects live on the user's machine. A documented,
   open file format. STEP for interchange. No account required.

## 4. Scope overview

**In scope for v1.0** (Phases 0–4): single-part, multi-body solid modeling.
That covers sketches with constraints, extrude/revolve/sweep/loft,
fillet/chamfer/shell/hole/pattern/mirror/boolean, construction geometry,
parameters, a timeline, a local project store, and STL/3MF/STEP/SVG/DXF export.

**Later** (Phase 5+): scripting and code features, OpenSCAD import, a headless
CLI, the desktop app, a plugin API, and components with simple assemblies.

**Out of scope** (no plans): CAM/toolpaths, FEA simulation, 2D engineering
drawings, sheet metal, T-splines/sculpt, rendering, real-time cloud
collaboration.

## 5. Functional requirements

IDs are stable so tasks and tests can reference them. Priority: **M** = must
for the phase's release, **S** = should, **C** = could.

### 5.1 Projects and files (FR-PRJ)

| ID | Requirement | Pri | Phase |
|---|---|---|---|
| FR-PRJ-01 | Home screen lists projects with thumbnail, name and modified date. Actions: new, open, rename, duplicate, delete (to an in-app trash). | M | 0 |
| FR-PRJ-02 | Projects are stored locally in the browser (OPFS + IndexedDB) behind a storage interface that has a native-filesystem implementation for desktop. | M | 0 |
| FR-PRJ-03 | Autosave with a visible save state. Explicit "Save version" with a description keeps a version history like Fusion. Restore any version. | M / S | 0 / 2 |
| FR-PRJ-04 | Export and import a whole project as a single file (`.extrudo`, a zip) for backup and sharing. | M | 0 |
| FR-PRJ-05 | Ask the browser for persistent storage and warn if it is denied. | S | 0 |
| FR-PRJ-06 | Optionally link a real folder on disk (File System Access API, Chromium only). | C | 4 |
| FR-PRJ-07 | Document settings: units (mm, cm, m, in), default precision. | M | 1 |

### 5.2 Parameters and expressions (FR-PAR)

| ID | Requirement | Pri | Phase |
|---|---|---|---|
| FR-PAR-01 | Parameters table: user parameters (name, expression, unit, comment) and model parameters (every dimension and feature input, auto-named `d1`, `d2`…). | M | 0–1 |
| FR-PAR-02 | Expression language: numbers with units (`mm cm m in ft deg rad`), `+ - * / ^ ()`, functions (`sin cos tan asin acos atan sqrt abs min max round floor ceil`), constant `pi`, parameter references. Unit checking (length vs angle vs unitless). | M | 0 |
| FR-PAR-03 | Every numeric input field (dialogs, dimensions, heads-up inputs) accepts expressions and shows the evaluated value. Creating a parameter inline (`wall = 2 mm`) is supported. | M | 1 |
| FR-PAR-04 | Detect circular references and undefined names with a clear error. | M | 0 |
| FR-PAR-05 | "Favourite" / exposed parameters form a customizer panel with sliders and ranges. | S | 4 |
| FR-PAR-06 | Named configurations (sets of parameter values), switchable. | C | 4 |

### 5.3 Sketching (FR-SK)

| ID | Requirement | Pri | Phase |
|---|---|---|---|
| FR-SK-01 | Create a sketch on an origin plane (XY/XZ/YZ), a construction plane or a planar face. The camera animates to "look at" the plane. | M | 1 (faces: 2) |
| FR-SK-02 | Drawing tools: point, line (chained, with tangent-arc drag), rectangle (2-point, 3-point, center), circle (center-diameter, 2-point, 3-point), arc (3-point, center, tangent), polygon (inscribed, circumscribed, edge), slot (center-to-center, overall), ellipse. | M | 1 |
| FR-SK-03 | Spline (fit-point and control-point), conic. | S | 1–4 |
| FR-SK-04 | Construction geometry toggle (`X`) and centerlines. | M | 1 |
| FR-SK-05 | Snapping and inference while drawing: endpoint, midpoint, center, on-curve, intersection, horizontal/vertical alignment, grid. Auto-apply the matching constraints. | M | 1 |
| FR-SK-06 | Heads-up numeric input while drawing (type a length, Tab to the angle, Enter to commit). | M | 1 |
| FR-SK-07 | Geometric constraints: coincident, collinear, concentric, midpoint, fix, parallel, perpendicular, horizontal, vertical, tangent, smooth (G2), equal, symmetric. Glyphs shown next to geometry; selectable and deletable. | M | 1 |
| FR-SK-08 | Dimensions: linear (horizontal, vertical, aligned), radius, diameter, angle, point-to-line distance. Driving or driven (reference). Values are expressions. | M | 1 |
| FR-SK-09 | Constraint status shown by colour: under-constrained, fully constrained, over-constrained or conflicting. Show remaining degrees of freedom. Dragging under-constrained geometry re-solves live. | M | 1 |
| FR-SK-10 | Modify tools: trim, extend, break, sketch fillet, sketch chamfer, offset, mirror, move/copy, rectangular and circular pattern, scale. | M | 1 |
| FR-SK-11 | Automatic closed-profile detection, including nested regions (holes). Profiles are shaded and selectable. | M | 1 |
| FR-SK-12 | Project / include edges and faces of bodies into a sketch (associative). | M | 2 |
| FR-SK-13 | Text: font picker (bundled open fonts plus user fonts), size, alignment. Output is curves that can be extruded. | M | 4 |
| FR-SK-14 | Import SVG and DXF into a sketch. | S | 4 |
| FR-SK-15 | Export a sketch to SVG (1 unit = 1 mm, correct viewBox). | M | 1 |
| FR-SK-16 | Export a sketch to DXF. | S | 1 |
| FR-SK-17 | Auto-project: body edges and vertices a sketch snaps, constrains or dimensions to are projected into the sketch automatically (can be turned off). | C | 6 |

### 5.4 Solid features (FR-FT)

| ID | Requirement | Pri | Phase |
|---|---|---|---|
| FR-FT-01 | **Extrude** profiles or planar faces. Direction: one side, symmetric, two sides. Extent: distance, to object, through all. Taper angle. Operation: new body, join, cut, intersect. In-canvas arrow manipulator and live preview. | M | 2 |
| FR-FT-02 | **Revolve** around a sketch line, origin axis or construction axis. Full or partial angle. | M | 2 |
| FR-FT-03 | **Primitives:** box, cylinder, sphere, torus, as parametric features. | S | 2 |
| FR-FT-04 | **Fillet:** constant radius, several edge sets per feature, tangent-chain selection. Variable radius comes later. | M | 3 |
| FR-FT-05 | **Chamfer:** equal distance, two distances, distance and angle. | M | 3 |
| FR-FT-06 | **Shell:** remove faces, thickness inside or outside. | M | 3 |
| FR-FT-07 | **Hole:** placed on a face at sketch points or a clicked point. Simple, counterbore or countersink; blind or through; drill-point angle; hole presets (M2–M8 clearance, heat-set insert sizes). | M | 3 |
| FR-FT-08 | **Press/Pull:** context-sensitive. On a face it offsets the face; on an edge it fillets. | S | 3 |
| FR-FT-09 | **Combine:** join, cut or intersect bodies, with an option to keep the tools. | M | 3 |
| FR-FT-10 | **Move/Copy:** translate and rotate bodies with a gizmo, or point-to-point. | M | 3 |
| FR-FT-11 | **Mirror** and **pattern** (rectangular, circular, on path) of bodies, features or faces. | M | 3 |
| FR-FT-12 | **Split body** by a plane or face; **scale** (uniform and non-uniform); **draft**; **offset face**. | S | 3 |
| FR-FT-13 | **Construction:** offset plane, plane at angle, midplane, plane through 3 points, tangent plane, axis (2 points, through a cylinder, along an edge), point. | M | 3 |
| FR-FT-14 | **Sweep**, **loft**, **coil**. | M | 4 |
| FR-FT-15 | **Modeled threads** (ISO metric and inch presets) with print-tolerance offset. | M | 4 |
| FR-FT-16 | **Emboss/deboss** text or sketches onto planar and cylindrical faces. | S | 4 |
| FR-FT-17 | **Rib / web**. | C | 4 |

### 5.5 Timeline and history (FR-TL)

| ID | Requirement | Pri | Phase |
|---|---|---|---|
| FR-TL-01 | Timeline shows every feature as an icon chip in order. Hovering highlights the feature's geometry. | M | 1 |
| FR-TL-02 | A draggable marker rolls the model back. Playback buttons: start, step back, step forward, end. New features are inserted at the marker. | M | 2 |
| FR-TL-03 | Right-click menu: edit feature, edit sketch, rename, suppress/unsuppress, delete, roll back to here, move to end. | M | 1–2 |
| FR-TL-04 | Drag to reorder, rejected if it would break a dependency. | S | 2 |
| FR-TL-05 | Error (red) and warning (yellow) states with a readable message and a "fix references" flow when a referenced face or edge is lost. | M | 2 |
| FR-TL-06 | Group features. | C | 4 |
| FR-TL-07 | Undo/redo (Ctrl+Z / Ctrl+Y) for every document change, including edits inside sketches. | M | 0 |

### 5.6 Viewport and selection (FR-VP)

| ID | Requirement | Pri | Phase |
|---|---|---|---|
| FR-VP-01 | Orbit, pan and zoom with the Extrudo mouse mapping by default (middle-drag orbits, right-drag pans: Onshape/SolidWorks with those buttons swapped; 2026-09-28, after Onshape's on 2026-09-27 and Fusion's before). Presets for Onshape/SolidWorks, Fusion, Blender and trackpad. | M | 0 |
| FR-VP-02 | ViewCube with click-to-orient (faces, edges, corners), home, and rotate arrows. | M | 0 |
| FR-VP-03 | Perspective and orthographic. Visual styles: shaded, shaded with edges, wireframe, hidden edges. | M | 0 |
| FR-VP-04 | Infinite adaptive grid and origin planes/axes. | M | 0 |
| FR-VP-05 | Pre-highlight on hover. Click and Shift/Ctrl multi-select. Window (left-to-right) vs crossing (right-to-left) box selection. Selection filters (bodies, faces, edges, vertices, sketches, profiles, construction). "Select other" for occluded items. | M | 1–2 |
| FR-VP-06 | Section analysis: a live clipping plane with cap fill. | S | 3 |
| FR-VP-07 | Browser tree: document settings, named views, origin, sketches, construction, bodies, each with visibility toggles. | M | 1 |

### 5.7 Inspect and 3D-printing aids (FR-3DP)

| ID | Requirement | Pri | Phase |
|---|---|---|---|
| FR-3DP-01 | Measure: distance, angle, radius, area, volume. Always-visible bounding-box size of the selection. | M | 2 |
| FR-3DP-02 | Mass properties with a filament material preset (PLA, PETG, ABS, TPU): weight estimate, filament length. | S | 3 |
| FR-3DP-03 | Overhang analysis: shade faces steeper than N° for a chosen "down" direction. | S | 3 |
| FR-3DP-04 | "Place on bed": pick a face to lie flat on the build plate for export orientation. | S | 3 |
| FR-3DP-05 | Clearance and tolerance helpers: a document-level `tolerance` parameter that hole and thread presets use. | S | 4 |
| FR-3DP-06 | Open the export directly in a slicer (PrusaSlicer, OrcaSlicer, Bambu Studio, Cura) via URL scheme on the web, or by launching the program on desktop. | C | 4 / 6 |
| FR-3DP-07 | Minimum wall thickness check. | C | 5 |

### 5.8 Import and export (FR-IO)

| ID | Requirement | Pri | Phase |
|---|---|---|---|
| FR-IO-01 | SVG export of sketches. | M | 1 |
| FR-IO-02 | STL export (binary; ASCII optional) for one body, selected bodies or all. Resolution presets (coarse, medium, fine) plus custom deflection. Output must be watertight and manifold. | M | 2 |
| FR-IO-03 | 3MF export with multiple objects, units, colours and names, so it opens cleanly in Bambu Studio, OrcaSlicer and PrusaSlicer. | M | 2 |
| FR-IO-04 | STEP export (AP214/AP242). | M | 2 |
| FR-IO-05 | STEP import as a (non-parametric) base body. | S | 4 |
| FR-IO-06 | STL, 3MF and OBJ import as mesh bodies that can be used in booleans. | S | 4 |
| FR-IO-07 | Canvas: a reference image on a plane, calibrated to real scale. | S | 4 |
| FR-IO-08 | OpenSCAD `.scad` import as a mesh body (through openscad-wasm). | C | 5 |

### 5.9 Programmatic design (FR-PRG), later phases

| ID | Requirement | Pri | Phase |
|---|---|---|---|
| FR-PRG-01 | A public, typed document API. Every UI feature is a serializable operation that code can also create. | M | 2 (design) / 5 |
| FR-PRG-02 | A **Script feature** in the timeline: TypeScript/JavaScript code (Monaco editor) that reads parameters and produces bodies or sketches, running sandboxed in a worker. | M | 5 |
| FR-PRG-03 | Headless CLI (Node): recompute a project with overridden parameters and export STL/3MF/STEP, for batch variants and CI. | S | 5 |
| FR-PRG-04 | Macro recording: turn UI actions into a script. | C | 5 |

### 5.10 UX, help and onboarding (FR-UX)

| ID | Requirement | Pri | Phase |
|---|---|---|---|
| FR-UX-01 | Fusion-like layout. See `04-ui-spec.md`. | M | 0 |
| FR-UX-02 | Light and dark theme. A consistent custom icon set with a colour per tool category. | M | 0 |
| FR-UX-03 | Command search ("S" toolbox and Ctrl+K palette), a right-click marking menu, and Fusion-compatible default shortcuts that the user can remap. | M | 1–2 |
| FR-UX-04 | Tooltips with a short description and a small animated demo per tool. | S | 3 |
| FR-UX-05 | First-run guided tutorial ("make your first box") and a starter template gallery. | S | 3 |
| FR-UX-06 | Friendly error messages. A failed fillet says "radius too large for edge X (max ≈ 2.4 mm)", not a kernel error code. | M | 3 |
| FR-UX-07 | Internationalization-ready strings (English first). | S | 1 |

## 6. Non-functional requirements

| ID | Requirement |
|---|---|
| NFR-01 Performance | The UI thread never blocks for more than 50 ms. Viewport runs at 60 fps with 1 M triangles on an integrated GPU (Ryzen 4700U class). A sketch drag re-solves in under 8 ms for sketches of up to 200 entities. Editing a simple feature recomputes in under 150 ms for a 30-feature model. |
| NFR-02 Startup | First visit loads under 8 s on 50 Mbit. Repeat visits (service-worker cache) reach an interactive home screen in under 1.5 s. The kernel is ready in under 3 s. |
| NFR-03 Robustness | A kernel failure never crashes the app. The failing feature goes red; everything before it stays usable. The worker restarts automatically after a WASM abort. |
| NFR-04 Data safety | Autosave at most every 10 s of inactivity. No data loss on tab close. Files carry a format version and migrations. Old files always open. |
| NFR-05 Platforms | Chromium 120+, Firefox 120+, Safari 17+ on desktop. Tablets are best effort. Needs WebGL2 and WASM. Later an Electron build for Linux (AppImage/deb), Windows and macOS. |
| NFR-06 Offline | Fully functional offline after first load (PWA). No network calls at runtime except explicit user actions. |
| NFR-07 Accessibility | Keyboard reachable panels, visible focus, colour-blind-safe status colours (never colour alone), respects `prefers-reduced-motion`. |
| NFR-08 Portability | Platform-specific code (storage, file dialogs, slicer launch) sits behind interfaces so the Electron build swaps implementations without touching feature code. |
| NFR-09 Open source | Permissive or copyleft license (to decide). All dependencies license-compatible. The file format spec is published. |
| NFR-10 Testability | The core model, sketch solver adapter and kernel operations run headless in Node for tests and the CLI. |
| NFR-11 Precision | Geometry uses kernel precision (1e-7 model units). The UI shows values at the configured precision. Exported STL/3MF units are correct: mm in 3MF metadata, mm assumed for STL. |

## 7. Acceptance benchmark models

Each release must be able to build these from scratch, fully parametric. They
double as end-to-end test fixtures (`fixtures/benchmarks/`).

| # | Model | Exercises | Needed by |
|---|---|---|---|
| B1 | Parametric plate with 4 corner holes (width, depth, hole spacing) | sketch, constraints, dimensions, parameters, SVG export | v0.1 |
| B2 | Parametric storage box, cut from a solid | extrude new/cut, sketch on face, STL/3MF export | v0.2 |
| B3 | Phone stand | revolve or extrude, multiple bodies, combine | v0.2 |
| B4 | Box with a lid that fits (clearance parameter) | shell, fillet, chamfer, offset plane, 2 bodies → 3MF | v0.3 |
| B5 | PCB enclosure with screw posts and countersunk lid screws | hole feature, pattern, mirror, shell | v0.3 |
| B6 | Wall hook | fillets on intersecting edges, draft | v0.3 |
| B7 | Knurled knob | circular pattern, revolve, chamfer | v0.3 |
| B8 | Name tag / keychain | text, emboss, fillet | v0.4 |
| B9 | Threaded bottle cap and thread adapter | modeled threads, revolve, shell | v0.4 |
| B10 | Cable chain link | loft or sweep, pattern, tolerance parameter | v0.4 |
