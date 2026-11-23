# ADR-0161: Stop during a long update after an edit

- **Status:** Accepted, 2026-11-23 (the owner chose option 3 of the plan "Stop during an update
  after an edit", without option 5: Cancel keeps waiting; with two changes to its mock: Stop in
  Cancel's quiet style, and a progress bar that stretches with the notice)
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
   to build it."
2. **The gate.** `Recomputer.stop()` allows a Stop while the design opens, or once the running
   feature has run `longFeatureMs` (a `RecomputerOptions` value the app sets from the notice's own
   rule, test hook included, measured with the injectable `now`). The stop store's `stoppable`
   now means "a feature is running and no Stop is under way". The notice decides when to show the
   button (`showsStop(mode, { stoppable, long })`), and `stop()` checks the same rule with its own
   clock.

## Rules

- Quick updates look as before: Cancel alone until a feature has run 30 s. Opening never offers
  Cancel, so Stop and Cancel meet only in a long update, in the order Stop, Cancel.
- The long rule counts from the running feature's start (`ModelProgress.since`), not from the
  update's.
- An update's Stop never sets `opening`.
- Stops are kept by value (ADR-0155's amendment of 2026-11-23), so an undo or Cancel back to the
  stopped values brings a stop back.

## Tests

- `recomputer-stop.test.ts`, with an injected clock:
  - an update's Stop refused 1 ms before the long time and allowed at it;
  - the edit kept, and the rebuild not opening;
  - undo still works;
  - the long rule counted from the running feature's start.
- `progressRules.test.ts`: `showsStop` for both modes.
- `ModelProgress.test.tsx`: Cancel alone, then Stop before Cancel at 30 s with the sentence and
  the update label; Stop's class equal to Cancel's; the bar's classes.
- `stopFeature.test.ts`: the update toast.
- `e2e/update-stop.spec.ts`, first test: the lowered long time, Stop before Cancel in the same
  style, the bar as wide as the sentence, the toast, the chip, and the edit kept.

## Rejected

- **Stop beside Cancel on every update** (option 2): two buttons on every update over 0.8 s.
- **One button changing meaning** (option 4): the same place does two things over time.
- **Cancel replacing the worker** (option 5): every Cancel would throw away the cache. A slow
  feature already in the shown model would then run again in full.
