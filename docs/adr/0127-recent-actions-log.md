# ADR-0127: The recent-actions log, for bugs where nothing throws

- **Status:** Accepted, 2026-11-05 (the owner's decisions of 2026-11-05: about 500
  events, memory only on releases, persisted on edge, an opt-in box in Report a Bug,
  ADR-0092's privacy rules).
- **Builds on:** ADR-0003 (commands, undo), ADR-0074 (auto-project, pending
  constraints joining a past step), ADR-0092 (Report a Bug), ADR-0093 (datum picks),
  ADR-0125 (an earlier sketch's carried curves).
- **No schema or file-format change.** Nothing goes into a design.

## Context

Two bugs on the edge build in early November 2026 took a screen recording to find,
because neither threw:

1. One undo removed a drawn rectangle together with later dimensions. A dimension to
   an unprojected curve had joined the previous undo step (fixed in PR #199, ADR-0074's
   amendment of 2026-11-04). A single line, "sketch.add "Dimension": joined step 12
   "Draw"", would have shown it.
2. The Dimension tool drew no live preview after picking an earlier sketch's curve or
   the origin: the overlay anchored the preview in the stored sketch, which lacked the
   pick's stand-in entity (branch `claude/dimension-model-preview`). A warning,
   "Dimension preview (distance) has no anchor in the stored sketch", would have.

Report a Bug (ADR-0092) carries the last 10 error messages; neither bug made one.

## Decision

### 1. Core emits history events; the app keeps the log

`packages/core` has no DOM and no app state, so it only says what happened:
`DocumentState.subscribeHistory(listener)` (`stores.ts`) calls the listener after each
`dispatch`, `amend`, `amendInto`, `undo`, `redo`, `revertTo`, transaction `begin` /
`commit` / `cancel` and `replaceDocument` with a `HistoryEvent` (`history.ts`): the
command's `type` and `label`, the step it made (`step`, undefined when the command
changed nothing), or for an amend the step it joined (`into`: undefined for `amend`'s
latest step, the asked step for `amendInto`; `step` undefined when there was none to
join or it was gone) and that step's label after the join. `UndoHistory` gained what
that needs: `record` and `commit` return the new step's id, `labelOf(id)`,
`undoStepId`, `redoStepId`, `transactionLabel`. A listener that throws is ignored: it
never blocks or undoes the change. A command that throws emits nothing.

The ring buffer lives in the web app, `apps/web/src/shell/actionLog.ts` (pure, no DOM):
`createActionLog({ limit = 500 })` with `record(level, kind, text, key?)`,
`entries()` (copies, oldest first), `persist(storage)`, `flush()`, `clear()`; the app's
one log is `actionLog`. An entry is `{ t, level: info|warn|error, kind:
app|history|tool|pick|sketch|error, text (≤ 200 characters), repeat?, key? }`. **The
same entry twice in a row is counted, not added** (`repeat`; by `key` when given, so a
drag's moves, each its own step inside the transaction, are one line). `historyEntry`
words a history event; its warnings are the silent no-ops: a command that changed
nothing, an `amendInto` whose step is gone, a refused revert.

`watchActions({ store, session })` (the shell, while a design is open) logs the
history events and the session's mode and tool changes ("Sketch mode: f3", "Tool:
dimension", "Tool: none"), with "Design opened: N features" and "Design closed".

### 2. What the sketch host and the view log

- **Clicks** (`host.click`): one line per click with a tool, `Click (<tool id>):` then,
  for a drawing tool, the snap's kind (`snap endpoint`, `snap onCurve on model edge (not
  projected)`, `free point`), and for every tool what `ToolContext.pick` and
  `pickModel` returned **during that click** (`sketch line`, `model vertex (projected)`,
  `model sketchCurve (not projected)`, `model point`, `model axis`), or "nothing picked".
  Hover picks are not logged (the collector is set only inside `click`).
- **Warnings** (kind `sketch`), the clear silent no-ops:
  - a tool commit that adds nothing to the sketch (no new step), with how many picks wait
    on a projection and which older step the new projections join (PR #199's case);
  - a pending constraint or dimension dropped: in `writePending` (its step is gone, or the
    write threw: the error's name only), by `syncProjections` (its step was undone, its
    sketch is gone) and when its projection is missing, lost or deleted;
  - `SketchOverlay` given a `preview.dimension` that `dimensionAnchor` can't anchor in the
    stored sketch (once per stretch, by the dimension's type).
- **Errors** (kind `error`): `watchRecomputeErrors`' new `failed(feature)` hook logs
  "Feature f5 (extrude) failed" or "The model couldn't be computed"; `watchWindowErrors`
  logs "Uncaught TypeError" / "Unhandled rejection (Error)". **The log links to the
  report's error list rather than copying the message**: messages carry feature names.

A new no-op worth a line gets one `actionLog.warn('sketch', …)` at the place it happens,
not a sweep.

### 3. Privacy: ADR-0092's rules

Command types, undo labels, step and feature ids, tool ids, entity types and pick kinds
only. **Never parameter values, expressions, feature or design names, file paths,
coordinates or document content.** Labels pass through `redactLabel`: the labels that
carry a name the person chose, Customizer's `Change <parameter>`, a macro's `Replace with
<macro>` and Import Drawing's `Import <file name>`, are cut to `Change …`, `Replace with
…`, `Import …`, and any label is cut to 60 characters. **A new label with a user's name in it gets its prefix in
`NAMED_LABELS`.** The report lists seconds since the first entry shown, never a clock
time.

### 4. Where it lives

- **Releases (`BUILD.channel` `stable`): memory only**, lost on reload.
- **Edge and dev builds: also in browser storage** (`persistsActions(channel)` is
  `channel !== 'stable'`), through `platform/actionLogStorage.ts`'s
  `webActionLogStorage`: one localStorage key, `extrudo.recentActions`, in the web build
  and the desktop renderer alike. Local dev builds persist too: they are less stable
  than edge, and the coordinator runs them. Not `Preferences`: its desktop writes go
  over IPC into main's settings file. `persist` puts the stored entries before the
  session's, keeps the newest 500, and writes 500 ms after a change (one write per
  burst); `startActionLog` flushes on `pagehide`. Unreadable or malformed storage starts
  empty (`storedEntries` drops anything that isn't an entry); a failed write is ignored.
- **Boot:** `startActionLog()` (`shell/startActionLog.ts`), first thing in both entries
  (`entry/web.tsx`, `entry/desktop.tsx`), persists on edge/dev, logs "App started:
  <version> (<channel>, <commit>)" (a reload shows as a second start) and sets the
  handle below.

### 5. Report a Bug

An **"Include recent actions"** checkbox, **off by default** like "Include the timeline",
shown on the home screen too (the log isn't the design's). Ticked, the report's console
block ends with "Recent actions (oldest first; seconds since the first):" and one line
per entry (`actionLines`: `   1.250 WARN sketch: … (×3)`). "Copy report" carries every
line. **`issueUrl` cuts the actions first**: the fewest oldest lines that make the URL
fit (whole lines, counted in "… (N older cut: see the copied report)"), all of them if
none fit; then `console`, `steps`, `what` as before (`IssueFields.actions`,
`consoleText`).

### 6. Readable from the running app: a read-only handle

`window.__extrudoRecentActions()` returns the report's lines (a copy each call). A
developer's console, Playwright's `page.evaluate` or an agent driving the browser pane
reads it on the web and in the desktop renderer, stable builds included; on edge and dev
the localStorage key holds the same entries across reloads. It is a function the page
sets, so the CSP's "no string evaluation" holds (the caller evaluates, not the app).

## Rejected

- **The ring buffer in core.** Core would hold app state and persistence it can't do (no
  DOM); the CLI and the kernel need none of it. Core emits events, the app keeps them.
- **Hooking `UndoHistory` instead of the store.** The history knows labels, not command
  types; the store has both and is the one place every change goes through.
- **Logging labels as they are.** Three labels carry a parameter's, a macro's or a
  file's name; `redactLabel` cuts them. Dropping labels altogether loses "Draw" vs
  "Dimension", which is what PR #199's line needed.
- **Copying error messages into the log.** They name features; the report's error list
  already holds them. The log keeps the feature id and type.
- **Logging every pointer move or hover pick.** Floods 500 entries in seconds and
  carries coordinates. Clicks only, by kind.
- **Persisting through `Preferences`.** On the desktop every write is an IPC message and
  a settings-file write; the log changes several times a second while drawing.
- **Writing storage on every entry.** A burst (a drag, a recompute) would stringify 500
  entries each time. One write per 500 ms burst, flushed on `pagehide`; a renderer crash
  loses at most that.
- **A desktop MCP tool (`get_recent_actions`, ADR-0087).** Desktop only, while both bugs
  were on the web edge build; the handle works in both. Deferred: add it when an agent
  session on the desktop needs it (a read-only tool, no transaction).
- **The document API (ADR-0068).** It is about the design; the log is not part of one.
- **A live log panel in the app.** Nobody reads it while modelling; the dialog reads
  the log when it opens, like the error list, and nothing else renders from it.
