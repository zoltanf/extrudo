# ADR-0105: Every kernel wait is visible, and a long recompute shows its progress

- **Status:** Accepted, 2026-10-24
- **Task:** P6-17 (slice C of `docs/plans/perf-baseline-2026-10-23.md`:
  options 13 and 14).
- **Builds on:** ADR-0024 (the `Recomputer`: the app's one kernel object, a
  Comlink client in the UI thread), ADR-0078 (the progress notice
  `viewport/ModelProgress.tsx` and its pure rules `progressRules.ts`),
  ADR-0050 §5 (export meshing with progress and Cancel), ADR-0100 (the perf
  spec), NFR-07 (no colour alone, `prefers-reduced-motion`).
- **No schema or file-format change.**

## Context

The owner's brief for the performance work had two halves: keep the app
snappy, and when an operation does take time, show it instead of freezing.
The baseline (the plan, §3, "Kernel waits with no feedback") found nine
user-triggered kernel calls with no feedback at all: a face or edge pick for
a dialog field, Sketch on a face, Section on a face, Project onto sketch, a
joint's pick and readout, a plugin command, STEP and OpenSCAD export, and the
script export. Each waits on the one kernel worker, so a click during a long
recompute waits for the recompute too, with nothing on screen. Where feedback
exists it is bespoke: Measure says "Measuring…", the clearance check "Checking
n of m…", the export dialog has a bar, OpenSCAD "Reading the file's
variables…".

A long recompute (B9's threads take 8 s; an import can take longer) shows
"Updating the model… Computing 7 features" after 800 ms (ADR-0078) and
nothing more until it ends. The kernel already reports each feature as it
starts: `recompute(request, onFeature)` (`packages/kernel/src/recompute/engine.ts`,
`ProgressListener = (feature: FeatureId) => void`), which the `Recomputer` uses
only to remember the culprit of a crash (`recomputer.ts`, around line 731).

## Decision

1. **The `Recomputer` counts every wait and names it.** Every public method
   that goes to the worker other than `recompute` and `preview` (`reference`,
   `tangentChain`, `meshRegions`, `smoothFaces`, `removeFacesPick`,
   `exportStep`, `exportScad`, `exportMeshes`, `inspect`, `interference`,
   `resolveJoint`, `checkJoint`, `scadParameters`, `runPluginCommand`) runs
   through one private `#wait(label, work)`: it adds a wait `{ id, label,
   since }` to the recomputer's `waits` (a small external store:
   `waits.get(): readonly Wait[]`, `waits.subscribe(listener)`), removes it
   when the promise settles (fulfilled or rejected), and notifies. Each
   method has a default label in plain words ("Reading the pick…", "Following
   the tangent chain…", "Reading the mesh…", "Exporting STEP…", "Exporting
   OpenSCAD…", "Meshing for export…", "Measuring…", "Checking for
   interference…", "Reading the joint…", "Checking the clearance…", "Reading
   the file's variables…", "Running the plugin…"); a caller that knows better
   passes `{ label }` as the method's last, optional argument, and one whose
   own panel already shows the wait passes `{ quiet: true }` (Measure, the
   clearance section, the export dialog, the OpenSCAD list), which still
   counts the wait but keeps the notice away. No call site needs anything
   else: a wait that queues behind a long recompute is counted from the call,
   so the notice covers exactly the case the baseline named.
2. **The notice shows the wait after 300 ms.** `ModelProgress` gets a third
   mode, `waiting`: the cube and the oldest wait's label (with "and n more"
   when several run), shown when a wait has lasted 300 ms
   (`WAITING_AFTER_MS` in `progressRules.ts`, pure like the rest), and
   `data-model-progress="waiting"`. While any wait is on, the app shell root
   carries `data-kernel-busy` and the stylesheet sets `cursor: progress` on
   it (the pointer cursor still wins on controls). The recompute notice
   (`preparing`, `updating`) takes precedence when both apply; the 800 ms
   threshold for a recompute is unchanged (quick edits must not flash). A
   quiet wait shows no notice and no cursor. The notice stays
   `pointer-events: none` and `aria-live="polite"`.
3. **A long recompute is determinate.** The `Recomputer` turns `onFeature`
   into progress: the request's features in timeline order up to the marker
   (suppressed ones left out) are the steps, the reported feature's position
   among them is `done`, and the model store gets
   `progress: { done, total, feature } | undefined` (`computing()` resets it,
   a result or a failure clears it), updated at most once per animation frame
   (`requestAnimationFrame`; a timer in Node). `ModelProgress`'s `updating`
   mode shows a `<progress value={done} max={total}>` bar under its text and
   "Thread1 · 4 of 7" (the feature's name from the document); the status
   bar's "computing…" becomes "computing 4/7". The timeline chip of the
   feature being computed carries `data-feature-computing` and a soft pulse
   on its status glyph (none under reduced motion). The browser's "Computing
   bodies…" row is unchanged. A `preview` (a dialog's draft) reports nothing:
   previews are short and have their own pending state.
4. **Nothing in the kernel package's worker protocol changes**: `onFeature`
   already exists; this ADR only uses it.

## Rejected

- **Spinners per call site.** Fourteen places to keep consistent, and none
  of them would cover the queue behind a recompute; one counter in the one
  kernel object does.
- **A progress channel with percentages from the engine.** Features are the
  unit the user knows; an evaluator's inner progress (a fillet's faces) would
  be a facade change for little.
- **Cancelling a wait from the notice.** Only export meshing supports cancel
  today (ADR-0050); a Cancel that works for one call in fourteen misleads.
  Option 15 of the plan stays open.
- **Showing the wait at once.** Most picks return in under 100 ms; a notice
  that flashes on every click is noise. 300 ms is the point where a person
  starts to wonder.

## Consequences

- `e2e/kernel-waits.spec.ts`: on the bottle cap (B9, an 8 s recompute) a
  parameter change then a click on the model shows
  `[data-model-progress="waiting"]` with "Reading the pick…" and the busy
  cursor while the pick queues behind the recompute, and the `updating` notice
  shows a `progress` whose value grows; the notice is gone once the kernel is
  ready. `e2e/model-progress.spec.ts` keeps passing (the `preparing` mode is
  unchanged).
- The perf spec (ADR-0100) is the check that the per-frame progress updates
  cost nothing visible: the edit and undo windows' app time must not grow.
