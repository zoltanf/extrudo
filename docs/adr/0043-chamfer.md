# ADR-0043: Chamfer

- **Status:** Accepted, 2026-09-29
- **Task:** P3-02 (chamfer; FR-FT-05, FR-UX-06). Code: the facade's
  `chamfer` and its helpers (`packages/kernel/occt/facade/extrudo_facade.cpp`);
  `Kernel.chamfer`, `ChamferError`, `ChamferSpec` (`packages/kernel/src/kernel.ts`);
  the definition `packages/core/src/chamfer.ts`; the evaluator
  `packages/kernel/src/features/chamfer.ts`; the dialog
  `apps/web/src/features/chamfer.ts`; the file format, `docs/file-format.md` 6.9.
- **Builds on:** ADR-0038 (fillet: the builder family, the chain query, the
  failure diagnosis, edge sets as plain inputs), ADR-0001 (the facade owns
  OCCT memory), ADR-0005 (chamfer faces are `chamfer:<id>:from:(<edge>)`),
  ADR-0027 (dialog fields), ADR-0033 (`LostReferenceError`).
- **Affects:** P3-03 shell, P3-04 hole and P3-08 (the reference-face default
  is the pattern for anything with a "first face"); P3-14 (B4/B5 chamfer
  steps).

## Context

FR-FT-05 wants three ways to size a chamfer: equal distance, two distances
(you choose which face takes distance 1, with a flip) and distance plus
angle. The toolbar had a Chamfer tile marked "comes with P3-02". Fillet
(ADR-0038) had just set the pattern: sets of edges as plain inputs, a
facade call on the C++ stack with a diagnosis of failures, and a dialog
whose picks bring tangent chains.

Facts about OCCT 8.0.1 (read in `ChFi3d_ChBuilder.cxx`, then run in the
native harness on the pinned image):

- `BRepFilletAPI_MakeChamfer` has the same contour behaviour as the fillet
  builder: adding one edge adds its whole chain of tangent-continuous
  edges, with one setting for the chain; `Add` on an edge that is already
  in a contour does nothing. `Contour(edge)` is 0 for an edge that isn't
  between two faces.
- The three constructors: `Add(d, E)` (symmetric), `Add(d1, d2, E, F)`
  (`d1` measured on the face `F`, `d2` on the other) and `AddDA(d, angle, E,
  F)` (`d` on `F`, the chamfer at `angle` radians to `F`). `F` must be a
  face around `E`, and for a chain it decides the side of the first edge;
  OCCT carries it along the chain.
- The angle is measured between the chamfer face and the reference face
  (checked: `d = 3` at 30° puts 3 mm on the reference face and
  3·tan 30° on the other).
- A failed chamfer looks like a failed fillet: `IsDone() == false`, an
  exception from `Build()`, or a "done" solid that fails `BRepCheck_Analyzer`.
- `recordHistory` works unchanged: a chamfered edge is deleted and
  generates its chamfer face.

## Decision

1. **Sets, each with its own type.** A chamfer has up to 8 edge sets
   (`CHAMFER_MAX_SETS`), and unlike fillet's sets each carries a `mode`
   (`equal`, `two-distances`, `distance-angle`) and its own values. Inputs
   are plain `ref`, `enum`, `expr` and `bool` inputs (`edges`, `mode`,
   `distance`, `distanceB`, `angle`, `flip`, and the same with the set's
   number appended for sets 2 to 8), so the document schema and the
   migrations don't change; `docs/file-format.md` 6.9 documents them.
   Sets are cheap: the only difference from "one mode per feature" is which
   inputs a set uses, and the kernel takes a spec per edge anyway. The
   dialog shows only the fields of a set's type.
2. **Which face takes distance 1: a default and a flip.** The reference
   face of an edge is the lower-numbered of its two faces in the kernel's
   face order; `flip` takes the other. A chain's first staged edge decides
   for the chain. It is arbitrary, but it is deterministic, needs no extra
   reference in the document, and the live preview shows the outcome so
   Flip is a one-click fix. (Rejected below: a pickable face.)
3. **One facade call.** `chamfer(shape)` takes the staged edge indices
   (`pushArg`) and four staged numbers per edge (`pushNumber`): mode,
   `a`, `b` (second distance, or the angle in radians) and flip. It adds
   each edge with the constructor of its mode, checks every chain got one
   setting (`Contour` per staged edge), builds inside `try` and validates
   with `BRepCheck_Analyzer`. Returning 0 leaves a diagnosis in
   `geometryNumbers`, the same layout as fillet's (`[status, n, n × [m,
   edge × m, value]]`):
   - `too-large`: a chain that fails **alone**, with the largest **factor**
     (0 to 1) its distances can be scaled by, by the same 7-step bisection
     (`largestThatWorks`, reused as is); the angle is not scaled, so a
     distance and angle chamfer scales its one distance, a two-distances
     chamfer both;
   - `unchamferable` (`Contour == 0`, or no two distinct faces for a
     reference face), `mixed` (one chain, two settings: compares all four
     staged numbers), `together` (every chain works alone, not all at once:
     the largest factor of all distances) and `other`.
   The probe helpers `addChamfers`, `chamferWorks`, `explainChamfer`
   sit next to fillet's in the private section; existing methods and their
   signatures are unchanged. The builder is only ever on the C++ stack.
4. **The tangent chain is fillet's.** `Kernel.tangentChain` builds a
   `MakeFillet` contour; OCCT's chain rule is one shared class
   (`ChFi3d_Builder`), so a chain found that way is the chain the chamfer
   bevels. The dialog uses `SelectionField.tangentChain` unchanged and the
   `KernelApi.tangentChain` plumbing needed no change.
5. **Messages come from the evaluator** and give a maximum that works
   (rounded down to two significant digits, tested by running it):
   - "Distance 50 mm is too large for edge 12 (max ≈ 19 mm)."
   - "Distances 50 mm and 10 mm are too large for edge 12. Try up to 9.9 mm
     and 1.9 mm." (both scaled by the same factor)
   - "Distance 60 mm at 30° is too large for edge 12 (max ≈ 17 mm)."
   - "Edge 12 can't be chamfered with 5 mm, or with anything smaller. …",
     "Edge 12 can't be chamfered: it isn't between two faces of the body.",
     "Edges 3 and 8 are one chain of tangent edges, so they take one
     setting…", "These chamfers can't all be built where they meet. Try
     distances up to about 4.1 mm, or fewer edges at once."
   Missing values name the set ("Enter a second distance for edge set 2."),
   and an angle outside 0° to 90° is refused before the kernel runs.
6. **Edges are references.** Every edge goes through `ctx.resolve` (a lost
   one is a `LostReferenceError`: Fix References works), edges are grouped
   by body and bevelled body by body, the same edge in two sets with
   different settings is refused, and the result is named with
   `withHistory` (`chamfer:<id>:from:(<edge name>)`), so later features
   keep their references when a distance changes (tested).
7. **The dialog** (`apps/web/src/features/chamfer.ts`) is a declarative
   spec like fillet's: per set an Edges field, a Type dropdown, Distance,
   Second distance (two distances), Angle (distance and angle) and Flip;
   set n + 1 shows once set n has edges. No on-canvas handles yet (as for
   fillet). The tool is the Modify group's Chamfer tile; **it has no
   default key** (Fusion has none either, and F, C and H are taken); it is
   in Ctrl+K and the toolbox like every command.
8. **Memory:** `memory.test.ts` runs 1000 rounds of all three modes, a
   failed chamfer with its probing diagnosis, a mixed-settings refusal and
   a chain query and expects a flat heap and no leftover shapes; the file's
   leak control (results kept and meshed) still trips, and a control
   specific to chamfer results (kept and meshed, 300 of them show as 300
   live shapes) sits last in the file: it raises the heap's high-water mark,
   and the generic control, which needs the heap to grow, failed when it
   ran earlier.

## Rejected

- **One mode per feature** (a `mode` input, sets share it). It would have
  saved four input names per set, but mixing an equal chamfer on one edge
  and a distance-and-angle one on another then needs two features, which is
  exactly the friction sets are there to avoid. The kernel takes a spec per
  edge either way.
- **A pickable reference face** ("choose which face takes distance 1")
  as an optional `face` ref per set. It would be the most direct reading of
  the requirement, but it needs a second selection field and a second
  cursor mode in the dialog, a face reference per set in the file, and a
  rule for a chain whose edges have different faces. A default plus Flip
  covers the use with the existing field kinds; revisit with an on-canvas
  face highlight when the dialog framework gets one.
- **Rebuilding each chain alone to find the chain's largest distance
  per value** (bisect distance 1 and distance 2 separately). A common
  factor is right for the equal and angle modes and honest for two
  distances ("Try up to 9.9 mm and 1.9 mm" keeps the shape you asked for);
  two independent bisections would find a different, arbitrary trade-off
  and double the probing.
- **Sharing the C++ fillet helpers** by templating `addFillets`,
  `filletWorks` and `explainFillet` over the builder. The two differ in what
  a staged edge means (one radius versus four numbers) and in what a chain
  needs to agree on; a template would have changed existing private
  signatures for little saved code, and another track edits the same file.
  `largestThatWorks` was already generic and is reused.
- **The chamfer mode `ConstThroat` and friends** (`SetMode`): unusual for
  3D printing, not asked for by FR-FT-05.

## Consequences

- The facade has a new method: the OCCT input hash is `b23063d86006`
  (WASM built by CI on branch `p3-02-chamfer`). P3-06 (transform) adds
  another method; merge them one at a time and rebuild on the combined
  inputs.
- The Chamfer tile is enabled, so the shell screenshots (dark and light)
  were regenerated.
- A chamfer's Distance is a model parameter like any other (the dialog gives
  each expression a name), so `wall / 4` works and updates with it.
- A distance and angle chamfer with the angle near 90° or 0° can fail in
  OCCT for reasons the diagnosis reports as "too large" (the largest factor
  is 0 or small). That is the truth for that chamfer; the angle field's hint
  says what it measures.
- Variable distance (FR-FT-05 doesn't ask for it) would need per-edge laws,
  as for a fillet.
