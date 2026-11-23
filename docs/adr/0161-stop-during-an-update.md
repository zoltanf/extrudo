# ADR-0161: Stop during a long update after an edit

- **Status:** Accepted, 2026-11-23 (the owner chose option 3 of the plan "Stop during an update
  after an edit", without option 5: Cancel keeps waiting; with two changes to its mock: Stop in
  Cancel's quiet style, and a progress bar that stretches with the notice; and Ctrl+Z during a
  long update as Cancel, the waiting state included)
- **Builds on:** ADR-0155 (Stop while a design opens; its amendments of 2026-11-19 and
  2026-11-23), ADR-0111 (Cancel on a long update), ADR-0105 (the notice).
- **No schema or file-format change.** Nothing about a stop is stored.

## Context

After an edit, "Updating the model…" offered Cancel only. Cancel undoes the edits behind the
update and then waits for the running feature to end, because the engine takes a newer request
only between features. In the plan's mock, a Cancel pressed into a long pattern waited 30.2 s.
The review of ADR-0155 found the gap this left: after a Stop, an edit to an earlier feature built
the stopped feature in full with no Stop.

## Decision

1. **Stop on a long update.** Once the running feature has run `LONG_FEATURE_MS` (30 s, the
   constant the opening notice uses), the update notice offers **Stop** before **Cancel**, both
   quiet and in the same style, with "This feature is taking a long time.". Stop works as at open:
   the worker is replaced (`KernelClient.restart`), and the feature is skipped for now, recorded
   against the edited document. The edit stays in the document and the history. The rebuild keeps
   the update's notice: it doesn't turn into "Preparing your design…", and Cancel still applies.
   The toast says "Rectangular Pattern1 was stopped, so the model was updated without it. Your
   change is kept." with Try again. The chip says "Stopped: this feature took too long. Try again
   to build it." Try again shows "Preparing your design…" (it counts as opening, ADR-0155): Stop
   is then there from the start, and Cancel would have nothing to undo, since the document is
   still the shown model's.
2. **The gate.** `Recomputer.stop()` allows a Stop while the design opens, or once the running
   feature has run `longFeatureMs` (a `RecomputerOptions` value the app sets from the notice's own
   rule, test hook included, measured with the injectable `now`). The stop store's `stoppable`
   now means "a feature is running and no Stop is under way". The notice decides when to show the
   button (`showsStop(mode, { stoppable, long })`), and `stop()` checks the same rule with its own
   clock.
3. **Stop while Cancel waits.** Cancel's request waits for the running feature to end. While it
   does (`StopState.cancelling`: `revertToShown` changed the document while a feature was
   running, the call that ran it is still with the kernel, and the document is still the one
   Cancel went back to), the update notice's title is "Cancelling…", its lines are "Computing
   n features" and "Your changes are undone once the running feature ends. Stop ends it now.",
   and it offers **Stop** alone, at once, in the same quiet style. That Stop replaces the worker
   and **marks nothing as stopped**: the running feature belongs to the document Cancel left, not
   to the one on its way. The new worker computes the reverted document cold. No new toast:
   Cancel's toast already said the changes were undone. The state ends when the running call
   comes back, when the document changes again, or with that Stop.
4. **Ctrl+Z as Cancel.** While the update notice offers Cancel and Cancel would only undo (the
   shown model's step is on the undo stack: `Recomputer.revertToShownUndoes`), Ctrl+Z and the top
   bar's Undo button run Cancel: the same revert to the shown model's step, the same toast. Like
   the Cancel button, that undoes **every step since the shown model**, quick unrelated edits made
   during the update included. While a pressed Cancel waits, they undo nothing more. Otherwise they
   are the plain undo: after an undo whose update runs long, Cancel would redo, so Ctrl+Z undoes
   one more step; a dialog, a sketch or any open transaction keeps its own undo, the waiting state
   included. The routing is `shell/undoRouting.ts` (`undoRoute`), fed by what the notice offers
   (`cancel.notice`); only the key and the top bar's button use it (`commandShortcuts`' `keyRuns`).
   The command list's Undo (search, the marking menu, the agent) stays the plain undo.
5. **A long feature an edit superseded.** After another edit the worker still finishes the
   running feature of the older call; the newer call has reported nothing, so there is no bar.
   The stop store keeps that feature's start (`StopState.since`) and says the call is superseded
   (`superseded`), so once it has run 30 s the notice keeps "This feature is taking a long time."
   and offers Stop beside Cancel (`[data-model-stop="edit"]`, "Stop: end the running feature
   now"). That Stop replaces the worker and records nothing (the feature's values have changed),
   shows no toast, and the current edit builds. The 30 s rule stays: not every superseded call
   gets Stop at once.

## Rules

- Quick updates look as before: Cancel alone until a feature has run 30 s. Opening never offers
  Cancel, so Stop and Cancel meet only in a long update, in the order Stop, Cancel.
- The long rule counts from the running feature's start (`ModelProgress.since`), not from the
  update's.
- An update's Stop never sets `opening`.
- Cancel itself never replaces the worker (ADR-0111); only the Stop the waiting state offers does,
  and it records no stop.
- "Cancelling…" shows Stop alone: no Cancel (there is nothing left to undo) and no bar (Cancel's
  request has reported no feature yet).
- Stops are kept by value (ADR-0155's amendment of 2026-11-23), so an undo or Cancel back to the
  stopped values brings a stop back.
- `[data-model-stop]` says which Stop it is: `"open"`, `"update"`, `"cancel"` (while Cancel
  waits) or `"edit"` (a superseded call's feature). Only `"open"` and `"update"` record a stop
  and have a toast.
- When Cancel had the focus, the waiting state's Stop takes it.

## Consequences

- Stop in an update replaces the worker, whose cache held the whole shown model: the features
  before the stopped one, and after it, are built again in the new worker. A design with other
  slow features pays them again.
- Ctrl+Z, like Cancel, can undo more than one step: every step since the shown model.

## Tests

- `recomputer-stop.test.ts`, with an injected clock:
  - "Stop while a design opens": an update's Stop refused 1 ms before the long time and allowed
    at it, the edit kept, the rebuild not opening, undo still working; the long rule counted from
    the running feature's start;
  - "Stop while Cancel waits": Stop allowed at once, the worker replaced, nothing recorded (also
    when the feature has run long), the reverted document recomputed; the state ending when the
    running call comes back (then a running feature needs the long rule again) or the document
    changes again; Cancel, Stop, then an edit; never entered when no feature runs;
  - "Stop on a long feature after an edit superseded its call": `since` and `superseded`, the long
    rule kept, Stop recording nothing and the edit building; a Stop then an immediate edit;
  - "whether Cancel only undoes, for Ctrl+Z": yes after an edit, no after an undo.
- `progressRules.test.ts`: `showsStop` for both modes and while Cancel waits.
- `ModelProgress.test.tsx`, "Stop on a long update after an edit": Cancel alone, then Stop before
  Cancel at 30 s with the sentence and the update label; Stop's class equal to Cancel's; the bar's
  classes; "Cancelling…" with Stop alone, its lines and label, back to the update notice once the
  cancel lands; what the notice tells the shell (`notice`); the focus moving from Cancel to the
  waiting Stop, and left alone after Ctrl+Z; the sentence and the `"edit"` Stop after an edit.
- `undoRouting.test.ts`: Cancel only when offered and only undoing; nothing while it waits; the
  plain undo otherwise and always while editing. `commands.test.ts`, "commandShortcuts": the key
  runs its own undo, the command the plain one.
- `stopFeature.test.ts`: the update toast; no toast after a `"cancel"` or `"edit"` Stop, whatever
  the kernel answers.
- `e2e/update-stop.spec.ts`, first test: the lowered long time, Stop before Cancel in the same
  style, the bar as wide as the sentence, the toast, the chip, and the edit kept. Second test: a
  quick edit (n = 3) under the long one (n = 12); Ctrl+Z as Cancel (its toast), "Cancelling…" with
  Stop alone in Cancel's style, a second Ctrl+Z undoing nothing (n stays 3), then Stop: no "was
  stopped" toast, the feature built, Undo and Redo both available.

## Rejected

- **Stop beside Cancel on every update** (option 2): two buttons on every update over 0.8 s.
- **One button changing meaning** (option 4): the same place does two things over time.
- **Cancel replacing the worker** (option 5): every Cancel would throw away the cache. A slow
  feature already in the shown model would then run again in full.
