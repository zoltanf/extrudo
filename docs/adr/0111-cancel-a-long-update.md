# ADR-0111: Cancel on a long update undoes the edits behind it

- **Status:** Accepted, 2026-10-25 (the owner chose this over pausing updates)
- **Task:** option 15 of `docs/plans/perf-baseline-2026-10-23.md`.
- **Builds on:** ADR-0105 (the "Updating the model…" notice, its modes and its
  rejected "Cancelling a wait from the notice"), ADR-0024 (the `Recomputer`),
  the undo history (`packages/core/src/history.ts`, FR-TL-07).
- **No schema or file-format change.**

## Context

After an edit, a long recompute (B9, the bottle cap: about 8 s from scratch)
can't be stopped. What already stops: a newer recompute supersedes a running
one between features (the engine's generation counter); a feature dialog's
preview ends when the dialog closes; export meshing and the joint check have
their own Cancel. The model always mirrors the document, so stopping the update
alone would leave a model that no longer matches what the document says.

## Decision

The notice in `updating` mode gets a **Cancel** button. Cancel returns the
document to the state the model on screen was computed from, by undoing (or, if
the long update came from an Undo, redoing) top-level steps in one run:

- The `Recomputer` remembers the undo step its last finished recompute was
  computed at (`lastStepId()` when the recompute was sent), only when no
  transaction was open.
- `UndoHistory.revertTo(stepId)` / `DocumentState.revertTo` undo or redo
  top-level steps until that step is the latest, and set the document once: one
  change, one recompute. The running recompute is superseded between features,
  and the earlier state's features hit the kernel's cache, so the old model is
  back quickly.
- The undone steps are on the redo stack: Redo brings the edits back. A toast
  says so.
- The button shows only in `updating` and only when the step is reachable (a
  finished recompute exists, no transaction is open, the step is in the top
  level's undo or redo stack and isn't already the latest).

## Rules

- Cancel never terminates the kernel worker and never leaves the model out of
  step with the document: it changes the document, through the history.
- One `revertTo` is one document change (one `set`), so one recompute follows.
- No Cancel while a design first opens (`preparing`), for a kernel wait
  (`waiting`), or inside a transaction (sketch mode, a feature dialog).
- No keyboard shortcut: Escape clears the selection, closes dialogs and leaves
  sketch tools, and must never undo edits.
- The notice stays `pointer-events: none`; only the button takes the pointer.

## Consequences

- A single slow feature (a thread, say) still runs to its end before the
  superseding recompute starts: Cancel shortens the wait to the current
  feature plus the cached replay, not to zero.
- `revertTo(undefined)` means "before any step"; if the undo stack's limit
  dropped old steps meanwhile, that is the oldest step kept. In practice a
  single long update spans a handful of steps.

## Rejected

- **Pause updates** (keep the edit, freeze the model, show "Out of date —
  Resume"): a new app-wide stale state that every view and export would have to
  respect; more work for a rarer need.
- **Terminate the worker** to stop even inside a long feature: the kernel's
  cache is lost, so the earlier model recomputes from scratch (B9 again ~8 s),
  and the restart path re-sends fonts and files.
- **Escape as Cancel**: it already means deselect / close / leave tool; a stray
  Escape would silently undo edits.
