# References — related open-source projects

Projects worth looking at for ideas or code. **Check the license of the exact
repository or file before copying anything.** The app is GPL-3.0-or-later, so
MIT, BSD, Apache-2.0, CC0, LGPL and GPL-2.0-or-later/GPL-3.0 code can come in
with attribution. GPL-2.0-only and AGPL cannot.

## CaDoodle (reviewed 2026-09-25)

- App: <https://github.com/CommonWealthRobotics/CaDoodle-Application>
  (Java 21 + JavaFX, **CC0-1.0**, i.e. public domain). Actively developed
  (last push 2026-09-24).
- Geometry and operations: <https://github.com/CommonWealthRobotics/bowler-script-kernel>,
  package `com.neuronrobotics.bowlerstudio.scripting.cadoodle`, **LGPL-3.0**
  (not CC0!). It uses JCSG, which does mesh-based CSG.
- Website: <https://cadoodlecad.com/>

**What it is:** an offline, Tinkercad-style CAD for beginners. You drag shapes
in, turn them into holes, group them (boolean), resize, align, mirror and
fillet. Every action is an operation in a replayable list (`CaDoodleFile` +
`CaDoodleOperation`, JSON with a polymorphic type adapter).

**Code reuse: none expected.** It's a different language (Java) and a
different geometry model (triangle-mesh CSG, whereas we use exact B-rep).

**Ideas worth borrowing:**

| Idea | Where in CaDoodle | Use in Extrudo |
|---|---|---|
| The design as a JSON list of typed operations | `bowler-script-kernel/.../cadoodle/CaDoodleFile.java`, `CaDoodleOperation.java`, `CaDoodleJsonOperationAdapterFactory.java` | Confirms our document model (`02-architecture.md §4`). Look at how they handle failed operations (`FailedToApplyOperation`) and pruning of forward history (`IAcceptPruneForward`). |
| Timeline filter by operation type (show/hide chips per category) | `CaDoodle-Application/src/main/java/com/commonwealthrobotics/TimelineManager.java` | A timeline filter menu for long histories (candidate for P2-11 / P4-09). |
| Beginner direct-manipulation tools: drag-in shapes palette, "to hole / to solid", resize handles, align handles, linear and radial distribution, workplane | `ShapesPallet.java`, `controls/ResizingHandle.java`, `align/`, `WorkplaneManager.java`; ops `ToHole`, `ToSolid`, `Align`, `Resize`, `LinearDistribution`, `RadialDistribution` | A possible **"Quick Shapes" beginner mode** on top of our parametric features: a primitive + move/align + combine, all recorded as normal timeline features. Would lower the barrier for Tinkercad users. Not yet in the roadmap; consider after Phase 3. |
| STL repair dialog on import | `StlRepairDialogController.java` | Mesh import (P4-06): offer repair of non-manifold STLs (Manifold library). |
| ~60 UI translations, **including Hungarian and Serbian** | `src/main/resources/lang/Messages_*.properties` (CC0) | Seed glossary for our i18n (P6-04): CAD terms already translated. Keys differ, so use it as a glossary, not a drop-in. |
| Plugin-based "add from script / add from file" | ops `AddFromScript`, `AddFromFile` | Compare when designing the script feature (P5-02) and plugin API (P6-03). |
| Icons | "Solar Bold" icon set (CC-BY-4.0, third-party) | Not for us: we draw our own icon set. |

## Other projects to know (not reviewed in depth yet)

| Project | Why it matters | License |
|---|---|---|
| [taucad/opencascade.js (`libcascade`)](https://github.com/taucad/opencascade.js) | **Our kernel** (ADR-0001): raw OCCT 8 in WASM, plus `@libcascade/toolchain` for trimmed builds with our own C++ | LGPL-2.1 + exception (toolchain MIT) |
| [replicad](https://replicad.xyz/) | JS API over OCCT WASM. Reference for wire/face builders and meshing; its `replicad-opencascadejs` build config is a starting binding list for our trimmed build. Evaluated in P0-02, not used as a dependency. | MIT (WASM LGPL) |
| [brepjs](https://github.com/andymai/brepjs) | TypeScript B-rep modeling over occt-wasm. Its `shapeRef`/`EdgeRef` (face roles + geometric hints, edges named by their two adjacent face roles) is the closest open design to our §5.2 topological naming: read it for P2-04. Evaluated in P0-02, not used as a dependency. | Apache-2.0 |
| [occt-wasm](https://github.com/andymai/occt-wasm) | OCCT 8 behind a C++ facade with arena handles; the pattern for our own C++ facade (builder lifetime in C++, flat-array history). Face-only history, no bound OCCT classes. | tooling MIT/Apache-2.0, WASM LGPL-2.1 |
| [planegcs](https://github.com/Salusoft89/planegcs) | **Our sketch solver** (ADR-0002): FreeCAD's PlaneGCS in WASM, JSON primitives. We build it ourselves (memory growth, current emsdk, two pivoting patches). Source headers say LGPL-2.1-or-later; the npm `package.json` says LGPL-2.0-or-later. | LGPL-2.1-or-later |
| [SolveSpace](https://github.com/solvespace/solvespace) (`slvs` on npm) | Constraint solver with first-class dragging. The npm package (3.1.0-dev.14) was slower than planegcs, ran out of memory on small sketches and crashed on tangency in P0-03. Worth a look again if a maintained WASM build appears. | GPL-3.0 |
| [Ansatz](https://github.com/LAU-MARS/Ansatz) (`ansatz-wasm`) | New solver with structured, human-readable diagnostics (DOF, conflict groups, suggestions). Too new to depend on in P0-03 (published 2026-09); its diagnostics design is a reference for our conflict UI. | MIT |
| CascadeStudio | Browser code-CAD over OCCT; scripting-UX reference for Phase 5 | MIT |
| CADmium | Browser CAD in Rust/WASM; a comparable history-based web CAD | check |
| Chili3D | Browser CAD on OCCT WASM with a Fusion-like UI | AGPL, ideas only, no code |
| FreeCAD (Sketcher, TNP work in 1.0) | Constraint UX and topological-naming approach | LGPL-2.1 |
| OpenSCAD (its own WebAssembly snapshot, ADR-0071) | Phase 5 import (P5-04): `.scad` files compiled to mesh bodies | GPL-2.0-or-later (the WASM bundles CGAL: GPL-3.0-or-later) |
| Manifold | Mesh booleans | Apache-2.0 |
