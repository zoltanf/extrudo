# ADR-0155: Stop while a design opens skips the running feature for now

- **Status:** Accepted, 2026-11-19 (the owner chose option 1.1 of the plan "Stopping a long
  update while a design opens": skip, not roll back, suppress or close)
- **Builds on:** ADR-0105 (the notice; its amendment of 2026-11-19 names the running feature),
  ADR-0111 (Cancel after an edit), ADR-0024 (the `Recomputer`, the crash guard and its skip
  list), P4-12 H4 (`KernelClient.restart`, the memory recycle).
- **No schema or file-format change.** Nothing about a stop is stored.

## Context

A design whose model takes long keeps the kernel busy from the moment it opens. After an edit
the notice offers Cancel (ADR-0111), which undoes the edit; while a design opens there is no
earlier state, so nothing was offered. Rolling the marker back or suppressing the feature
helped only after the running kernel call ended (a newer recompute takes over between
features): measured on a design with a large pattern (20 × 20 copies), rolling the marker back
13 s into the pattern still waited 14.5 s more. Closing the design was the only thing that
ended a call at once (it terminates the worker). One kernel call can't be interrupted from
outside the worker.

## Decision

While a design opens, the notice offers **Stop** (a quiet text button where Cancel sits after an
edit), once the kernel is on a feature. Stop:

1. **Ends the running call by replacing the worker**: `Recomputer.stop()` calls
   `KernelClient.restart()`, the path the memory recycle uses: terminate, reject the call in
   flight with `KernelCrashError`, boot a new worker, `#resend` (fonts, files, the mesh kernel go
   again). Measured with the prototype: the new worker is ready in 0.6–0.9 s, the design shown
   1.4–1.6 s after the click (20 × 20 design, dev server).
2. **Skips that feature for now**, like a crashed one: the recomputer keeps it in `#stopped`
   and sends it as the request's `stopped` list; the engine fails it with `STOPPED_MESSAGE`
   ("Stopped: this feature took too long while the design opened. Try again to build it.")
   without evaluating it. Features after it that need it fail as after any failed feature.
3. **Changes nothing in the document**: no command, no undo step, no dirty flag, no save.
   Nothing about the stop is stored; closing and opening the design computes everything again.
4. **Says so**: a toast "Rectangular Pattern1 was stopped, so the design opened without it.
   Nothing in the design changed." with **Try again** (available while the feature is still
   stopped); the same command, **Try Again**, is on the feature's menu (timeline chip and
   browser row) while it is stopped.
5. **Try again** forgets the stop and computes the design again with no limit. That recompute
   counts as opening: the notice shows "Preparing your design…" at once, with Stop.
   **Edit Feature** on a stopped feature (to lower a count, say) doesn't start the slow
   computation by itself: its own dialog keeps it skipped while the draft's inputs equal the
   stopped feature's (compared by value, whatever the key order), and the dialog's Feature status
   line says "Stopped while the design opened, so there is no preview yet. Change a value to
   build it." (`STOPPED_DRAFT_MESSAGE`; OK stays off, as for any refused draft, since there is
   nothing to commit). Once a value changes the preview builds it; OK commits the change, which
   forgets the stop.
6. **A stop is forgotten** when the feature changes, when a feature before it, the parameters or
   the settings change (the stop keeps them by identity: a conservative stand-in for "what it
   depends on"), when the marker no longer reaches it (rolled back, deleted, suppressed: the
   feature object changes too), and when the design closes (`dispose`).

## Rules

- **Only while opening.** `StopState.opening` is true until a recompute finishes, and again
  for the recompute Try again or a Stop starts, until the document changes. Stop is offered in
  `preparing` only (`showsStop`); Cancel in `updating` only (`showsCancel`): never both.
  `progressMode` takes `opening` so a Try again shows as `preparing`.
- **A stop is not a crash.** The rejected call of the stopped sequence (`#stoppedSequence`) is
  dropped without blaming a feature; `restart()` doesn't touch the crash budget or
  `client.restarts`. A real crash during a Try again is handled as a crash (the feature goes to
  `#crashed`, the crash message, the budget counts).
- **The running feature** is the one the kernel last reported, for as long as the call that
  reported it is with the kernel (`#current` is cleared when that call settles, by
  `#currentSequence`). A newer send (an edit, a roll-back, a suppress during opening) doesn't
  end it: the worker finishes the old feature first, so Stop stays offered meanwhile (review
  finding 1 of 2026-11-19). The stop is recorded against the document as it is when the worker
  is replaced: an edited feature in its new version (Try again builds that one); a feature the
  document no longer reaches (rolled past, suppressed, deleted) is not recorded, but the worker
  is still replaced, which ends the old call, and no toast shows.
- **Nothing to stop → nothing happens.** `stop()` returns undefined when not opening, when no
  recompute call is with the kernel (resources still going out, a restart under way), when a
  Stop is already under way, or when the feature finished first. The race: `stop()` lets the
  worker's messages already delivered land (one macrotask) and gives up when another feature
  started, the walk got past its features, or the call came back. A send that starts during
  that turn doesn't cancel the Stop (review finding 7). The engine reports the end of
  its features with `onFeature(undefined)` (joints, annotations, meshes follow), so the last
  feature is never blamed for the meshing. A feature that finishes in the few milliseconds
  between that turn and the terminate is still marked stopped; Try again builds it.
- **The toast tells only of a stop that is still there** when the restart ends: none after a
  Try Again during the restart or when nothing was recorded. Its Try again does nothing once the
  stop is gone (the history copy no longer offers it).
- **Disposal wins.** A design closed mid-Stop sends nothing more: the restart's resend checks
  `#disposed`, the old model store is never written, the next design has its own kernel.
- **Previews skip it too** (the request's `stopped`); its own dialog too, until a value changes
  (see 5).
- **The button is reachable and named** ("Stop: open the design without this feature for
  now"); it alone takes the pointer, the notice stays `pointer-events: none`. When it leaves
  while it has the focus, the focus goes to the stopped feature's timeline chip (else the
  timeline marker), whose menu has Try Again. Screen readers hear the toast (the toast region)
  and the chip's state ("Rectangular Pattern1 (error)", the message in its tooltip); the notice's
  announcements are unchanged.
- **Where the stopped state shows:** the timeline chip (✕, `data-feature-status="error"`, the
  message in its tooltip, "(error)" in its name), the browser's feature row (the error mark and
  the message), the status bar's error count ("1 error"), and the notification history (the
  recompute-errors watcher notes it quietly with Edit, like any new error).

## Consequences

- **What is lost and what Try again costs.** The restart throws away the worker's feature cache:
  the features before the stopped one are computed again by the resend (at open that is only
  what this open had done; a design with slow features before the stopped one pays them
  again). Try again recomputes the stopped feature from scratch, plus anything after it; the
  features before it come from the new worker's cache. Measured: 34 s for the 20 × 20 pattern
  (its first run never finished, so nothing of it was cached).
- **Other kernel callers during the restart** get what they get when the worker is recycled or
  crashes: a call in flight rejects with `KernelCrashError` ("The kernel was restarted.") and a
  call made meanwhile waits for the new worker. By caller: a dialog's preview resolves
  `undefined` (no preview until the next draft); picks and lookups (`reference`,
  `tangentChain`, `meshRegions`, `smoothFaces`, `removeFacesPick`, `resolveJoint`,
  `resolveAnnotation`, `resolveSheet`, `sheetParts`) answer `undefined`; export (`exportMeshes`,
  `exportStep`, `exportScad`), Measure (`inspect`), the interference and clearance checks
  (`interference`, `checkJoint`) and the sheet views (`sheetViews`) reject, and their panels show
  the error as after a crash; `scadParameters` and plugin commands answer `ok: false` with the
  message; the heap probe gives up quietly. The f3d import's body check has its own throwaway
  `Recomputer` and worker (and its 60 s limit), so a Stop never reaches it. The assistant's tools
  wait for the model to settle and then see the stopped feature as failed, with its message.
  Scripts run inside the recompute: a running script is the feature Stop names.
- e2e: `e2e/open-stop.spec.ts`. Unit tests: `packages/kernel/src/recomputer-stop.test.ts` (a
  fake kernel: stop, first and last feature, five stops without a give-up, a crash during Try
  again, two Stops, Stop during the restart, the three races, fonts still going out, disposal,
  only while opening, Try again and an edit during it, forgetting, previews),
  `recompute/engine.test.ts` (the skip, the walk's end, the own-dialog message), `progressRules.test.ts`,
  `ModelProgress.test.tsx` (the button, never with Cancel, the focus), `stopFeature.test.ts` (the
  toast and Try again, none for a stop already gone), `featureVisibility.test.tsx` (Try Again in
  the menu). The review of 2026-11-19 added: Stop after an edit, a roll-back, a suppress or a
  delete of the running feature; Stop not swallowed by a send in its first turn; Try Again during
  the restart; the own dialog (`recomputer-stop.test.ts`, `engine.test.ts`); and in the e2e the
  stored `document.json` compared before Stop and after it (text and write time), and Stop →
  Edit Feature → no build until a value changes → OK builds it.

## Limits (known, for later steps)

- **An edit after a Stop builds the stopped feature in full, without Stop.** An edit to a
  feature before the stopped one forgets the stop (rule 6); the update that follows computes the
  stopped feature again with no Stop (Stop is only for opening) and Cancel can't bring the
  stopped state back (the stop was forgotten, and Cancel returns to the step the model was shown
  at). This belongs to the next step, Stop during an update after an edit.
- **Export after a Stop** gives the model without the stopped feature, as after any failed
  feature: the export dialog doesn't warn about it.

## Rejected

- **Roll the marker back to before the feature** (option 1.2): a document change, an undo step,
  saved to storage at once, and every later feature vanishes from the view.
- **Suppress the feature** (option 1.3): a document change saved at once; a suppressed feature
  is easy to forget, and the next open would not try it again.
- **Close the design** (option 1.4): already possible, and it doesn't let anyone look at the
  design.
- **Wait for the running call** (supersede only): free, but the click does nothing visible for as
  long as the call runs.
- **A time limit that stops by itself**, **a prominent button after 30 s**, **Stop during an
  update after an edit**: later steps, decided separately.
