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
| [replicad](https://replicad.xyz/) | JS API over OCCT WASM; reference for wire/face builders and meshing | MIT |
| [brepjs](https://github.com/andymai/brepjs) | TypeScript B-rep modeling over OCCT WASM | Apache-2.0 (kernel LGPL) |
| [taucad/opencascade.js (`libcascade`)](https://github.com/taucad/opencascade.js) | Our kernel candidate, OCCT 8 in WASM, custom-build toolchain | LGPL-2.1 + exception |
| [planegcs](https://github.com/Salusoft89/planegcs) | Our sketch solver | LGPL-2.1 |
| CascadeStudio | Browser code-CAD over OCCT; scripting-UX reference for Phase 5 | MIT |
| CADmium | Browser CAD in Rust/WASM; a comparable history-based web CAD | check |
| Chili3D | Browser CAD on OCCT WASM with a Fusion-like UI | AGPL, ideas only, no code |
| FreeCAD (Sketcher, TNP work in 1.0) | Constraint UX and topological-naming approach | LGPL-2.1 |
| OpenSCAD / openscad-wasm | Phase 5 import | GPL-2.0-or-later |
| Manifold | Mesh booleans | Apache-2.0 |
