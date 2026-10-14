# ADR-0084: `.f3d` import: the file's own bodies where the replay misses

- **Status:** Accepted, 2026-10-14 (the owner: per body, automatic; a body the
  replay doesn't make, or makes differently, comes in as the file's own shape
  with a notice, and everything else stays editable).
- **Builds on:** ADR-0083 (`.f3d` import, and its 2026-10-13 amendments that
  write a body's B-rep stream as STEP), ADR-0066 (the `import` feature, files
  reach the worker through `addFile`, 25 MB / 100 MB), ADR-0061 (bytes before
  the document, limits in storage), ADR-0030 (bodies, Remove), ADR-0081
  (feature stamps, `BodyMeta.component`), ADR-0024 (the kernel only in the
  worker), ADR-0078 (the model cache is derived).
- **Amends:** ADR-0083's "no kernel at import" (the import now starts one, for
  the check), and combines, without reversing, its Rejected item "geometry only
  from the B-rep".

## Context

The importer rebuilds a design from the file's timeline. Where a feature is
not read yet, or Extrudo builds it differently, the rebuilt body is wrong or
missing, and nothing tells the user which. The file also carries each body's
solved B-rep, which `bodiesStep` writes as STEP for analytic geometry
(ADR-0083's amendments). So for many bodies there is a second, exact source to
compare the rebuilt body with, and to fall back on.

## Decision

1. **Pair by geometry, not by ID.** There is no reliable link from a file body
   to the Extrudo body the replay made (joins, splits and moves change which
   body is which). A replayed body *is* the file's `Body<n>` when its volume is
   within 0.5 % of the file body's and its tight bounding box within 0.05 mm on
   every side (`VOLUME_TOLERANCE`, `BOX_TOLERANCE` in
   `packages/f3d/src/body-check.ts`). Greedy pairing in file order, closest
   first; two bodies that close are coincident copies, so a swapped pair is
   harmless. The creator link (`BodyLink.hint`) only picks what to take out for
   a body that did not pair, never a match.
2. **At import, before the first save, in a throwaway kernel.**
   `probeDocument` appends one `import` per written body to the replayed design;
   `checkF3dBodies` (`apps/web/src/project/f3dCheck.ts`) computes it with the
   app's own worker, measures every shown replayed body and each probe body
   (`measureProbe`, `Recomputer.inspect`), plans (`planBodies`) and disposes
   of the worker. No kernel starts when no body was written. The check gives up
   after 60 s (`CHECK_TIMEOUT_MS`): it runs on untrusted bytes and must never
   be what hangs an import. A failed or timed-out check leaves the import as
   before, with one notice.
3. **Outcomes per file body.** Paired: **editable**, the replayed body keeps
   its history and takes the file's name. Written, cleanly imported (one body,
   positive volume) and unpaired: **frozen**. Not written, or a probe import
   that failed: **unchecked**, nothing changes. An unchecked body with no
   unpaired replayed body left for it: counted **missing**.
4. **A body with a sphere or torus face the file signs inward** (a negative
   radius) is written but left unchecked (`BodyStep.inward`): the writer does
   not yet rebuild such bodies reliably. On the corpus every body the writer
   got wrong while the replay was right carried such a face.
5. **Take out with one Remove, bring in with one import per body.** After the
   replay, at the marker: one `Remove "Remove rebuilt bodies"` with the
   replayed counterparts (and, only when every file body was checked, the
   leftover replayed bodies), then one `import "Import Body<n>"` per frozen
   body, stamped with its component, its body named `Body<n>`. Suppressing the
   Remove shows what the timeline made; deleting an import drops that frozen
   body. There is no undo step: the project is created with the final design.
6. **Storage order.** The replayed design is saved first, then each frozen
   body's STEP is written as an attachment (same hash, one record), then the
   design with the plan applied. A failure part-way leaves the replayed design
   and a notice. A STEP over 25 MB, or past 100 MB in total, is not frozen
   (unchecked, "too large to keep with the design").
7. **Notices** (`importNotices` in `project/actions.ts`): the frozen bodies,
   with why, and how to see the rebuilt ones; the number of missing bodies (not
   their names: which unchecked body is missing is not known); that every body
   matches, or how many of how many when some were not checked; why the check
   could not run. Unchecked bodies are not listed. An info toast says the check
   is running.

## Consequences

- On the owner's 250 files, run through the same `probeDocument`,
  `planBodies` and `applyBodyPlan` in Node, the designs matching the reference
  STEP go from 135 to 165: 30 rescued, none harmed. Of the file bodies, 131
  stay editable, 78 come in frozen, 147 are unchecked and 24 missing. The probe
  recompute's median is 26 ms and its 95th percentile 455 ms.
- Importing starts a second OCCT worker for a moment, and the project
  recomputes once more when it opens (the probe's results are thrown away).
- No schema change: `file` inputs, attachments, Remove and body metadata
  already exist.

## Deferred

- Handing the probe's worker to the project instead of recomputing.
- Disabling the Import card while the check runs (two clicks make two designs).
- Spline and intersection geometry in the writer, and streams with hidden
  solids: those bodies stay unchecked until the writer reads them.

## Rejected

- **Checking after the project opens:** the request is lost on reload, the
  fallback lands as an undo step the user didn't take, possibly after their
  first edits, and the project's kernel can't measure the file's bodies
  without putting them in the document.
- **Hiding, suppressing or deleting the rebuilt body:** a hidden body still
  joins with later features and has to be filtered from exports; suppressing
  its features breaks other bodies; deleting them loses the history the user
  may want to repair.
- **One STEP for all frozen bodies:** each frozen body could not be deleted
  alone or keep its own component.
- **A validity check on the file's bodies:** none of the bodies that harmed a
  design on the corpus was invalid.
