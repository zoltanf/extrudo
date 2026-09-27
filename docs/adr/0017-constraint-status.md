# ADR-0017: Constraint status, colours and the over-constraint dialog

- **Status:** Accepted, 2026-09-27
- **Task:** P1-08 (constraint status and colouring, FR-SK-09). Code:
  `get_dependent_params` in `packages/sketch/planegcs/planegcs.patch`;
  `ComponentReport.free` in `packages/sketch/src/solver/solver.ts`;
  `sketchStatus` and `unmetDimensions` in `solver/status.ts`; `status`,
  `overConstrained` and the driving check in `apps/web/src/sketch/tools/host.ts`;
  status colours in `apps/web/src/viewport/Sketches.tsx` and
  `sketchGeometry.ts`; the DOF counter and `OverConstrainedDialog` in
  `apps/web/src/sketch/panels.tsx`.
- **Builds on:** ADR-0002 and ADR-0011 (planegcs, our build, per-component
  systems), ADR-0015 (glyphs), ADR-0016 (dimensions, `apply`).
- **Affects:** P1-09 (dragging under-constrained geometry, the other half of
  FR-SK-09; deleting), P1-11 (profiles drawn over coloured curves).

## Context

FR-SK-09 asks for constraint status by colour (under-constrained blue,
fully constrained ink, over-constrained red) and the degrees of freedom
left. The solver reported DOF per component, and conflicting and redundant
constraints, but nothing per entity: a component with 1 DOF can hold a
fully placed side next to one that still slides. P1-07 also added a new
over-constraining dimension as driven with only a note in the prompt; the
roadmap asks for a dialog instead.

## Decision

1. **Per-entity status comes from planegcs's dependent parameters.** Its
   diagnosis (a QR of the Jacobian, run whenever a system is built) already
   works out, per null-space direction, which parameters move
   (`pDependentParameters`, what FreeCAD colours "partially constrained"
   geometry with). Our patch adds `GcsSystem::get_dependent_params()`,
   which returns them as parameter indices; with no driving constraint the
   diagnosis lists none, so it returns every unknown then. The adapter maps
   indices back to entities (`ComponentReport.free`): a point, a circle's
   radius, an arc's angles and radius, an ellipse's focus and minor radius.
2. **`sketchStatus(sketch, result, values)` is pure** (in the inference
   entry, so the app's main chunk doesn't pull the solver): each entity is
   `free`, `fixed` or `conflict`. A curve takes the worst of itself and its
   points: a line with one fixed end is free, one with an over-constrained
   end is red. `over` lists what over-constrains the sketch.
3. **Over-constrained means a component's conflicting or redundant
   constraints, plus driving dimensions the geometry doesn't meet**
   (`unmetDimensions`, 1e-4 mm or degrees). planegcs "solves" contradicting
   values by leaving one equation out as redundant and reports success, so
   measuring is the check that doesn't depend on its bookkeeping.
   Constraints on fixed geometry alone (the solver's `overdetermined`) are
   not over-constraining: they held when the geometry was fixed, and fixed
   geometry doesn't move. Drawing a line (Horizontal inferred) and fixing
   it is ordinary, and must not turn the sketch red.
4. **The host keeps the open sketch's status** (`ToolHostState.status`),
   solving it again after every document change (commits, `apply`, undo)
   and when the solver loads. Components that didn't change cost nothing;
   the identity of the document and sketch data skips even that.
   Sketches that aren't open keep plain `sketch` blue, dimmed.
5. **Colours:** the viewport draws curves and points in three layers:
   `sketch` (free), `ink` (fixed), `error` (conflict). Construction
   geometry stays grey and dashed. Constraint glyphs and dimension labels
   in `over` turn red. The palette's counter reads "N DOF left", "Fully
   constrained ✓", "Over-constrained: …", "Nothing to constrain yet", or
   "Solving…" before the solver is in. The Viewport region carries
   `data-sketch-status` ("free=… fixed=… conflict=…") for tests.
6. **A new over-constraining dimension waits for a dialog.** The host
   holds the edit (`overConstrained`); `resolveOverConstrained(true)` adds
   the dimension as driven (no parameter name), `false` drops it.
7. **Turning a driven dimension driving is checked too:** `apply` test-solves
   each dimension that starts driving (`SketchSolver.check`) and refuses
   one that would over-constrain ("… so it stays driven"). `apply` also
   refuses a changed value the solve didn't meet (`unmetDimensions` on the
   stored result), which covers dimensions on fixed geometry and planegcs's
   redundant "success".

## Rejected options

- **Colour by component DOF** (a whole component blue until its DOF is 0).
  Simple, but wrong for the most common case, a partly dimensioned
  rectangle whose fixed side should already read as done.
- **Probe each entity by fixing it and re-counting DOF.** Correct, but one
  diagnosis (a QR) per entity per change; the dependent-parameter list
  comes free with the diagnosis we already run.
- **Compute the null space in TypeScript.** The adapter has no Jacobian;
  planegcs has it.
- **Keep the solver's `overdetermined` in `over`.** It turned an ordinary
  Fix red (decision 3).
- **Colour construction geometry by status.** It would compete with the
  dashes; Fusion keeps construction in its own colour as well.
- **Status for sketches that aren't open.** Every sketch would need a solve
  on every change; the open one is what the colours are for.

## Consequences

- The planegcs input hash changed: CI builds and publishes a new
  `planegcs-<hash>` release on the next push.
- Every `solve()` reads the dependent parameters (a small vector copy),
  drags included.
- A sketch saved with contradictions, or edited before the solver loaded,
  shows red until it is fixed; value changes to such dimensions are refused
  unless they are met.
- P1-09 must keep the status in step while dragging (the drag's result has
  the same `free`), and deleting geometry changes it like any other edit.
