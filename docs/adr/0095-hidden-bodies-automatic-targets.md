# ADR-0095: Hidden bodies stay out of an extrude's automatic join and cut

- **Status:** Accepted, 2026-10-20
- **Issue:** user feedback (Reddit, 2026-10-19): "if i make an item invisible and
  i extrude it 'into it' and i want to join with another part it always joins
  with the invisible part".
- **Builds on:** ADR-0028 (extrude and `operate`), ADR-0030 (bodies, the ghost
  amendment), ADR-0027 (previews), ADR-0051 (`propose`, the press-pull rule),
  ADR-0067 §H5 (reports shown in the dialog).
- **No schema or file-format change.** `bodies` is stored already.

## Context

With the dialog's Bodies field empty ("Automatic"), `operate()` joins, cuts or
intersects every body the tool touches. The kernel never sees visibility
(`BodyMeta.visible` and `ghost` live in the document, not in `EvalContext`), so a
hidden or ghost body takes part like a shown one. For a join it is worse: when
the hidden body is the first target, the merged body keeps its ID and its hidden
state, so the extrusion vanishes.

Other CAD tools behave the same way, and the kernel must stay this way:
visibility is display state, not timeline state, and a recompute must not change
with an eye toggle.

## Decision

1. **The operation reports what the tool reaches.** `operate()` returns
   `report: OperationReport` (`touching`: the `touchingBodies` of the tool, in
   creation order; empty for a new body). Extrude and Revolve pass it through
   `FeatureOutput.report`; `PreviewResult.operation` carries it to the dialog.
2. **The dialog proposes the shown bodies.** `proposeBodies` (`propose`, ADR-0051:
   a pick of the user's own wins) fills Bodies with the shown ones when the
   draft reaches a hidden one, so the stored feature names them and recomputes
   are deterministic. A new report that differs re-runs `propose` once.
3. **The dialog refuses when every body reached is hidden**: "Every body the
   extrude reaches is hidden. Show one, pick it under Bodies, or make a new body."

## Rejected

- **Skipping hidden bodies in the kernel.** An eye toggle would change geometry.
- **A stored "hidden at creation" snapshot.** A schema field for something the
  proposal already gives through `bodies`.
- **Reporting `touching` for picked cut or intersect.** It would cost a distance
  query per body for nothing (a thread's heavy tools, ADR-0067 §H2); such a report
  is empty.
