# ADR-0100: Performance budgets and the guardrails that keep them

- **Status:** Accepted, 2026-10-23
- **Task:** P6-13 (slice A of `docs/plans/perf-baseline-2026-10-23.md`:
  options 1, 4 and 5).
- **Builds on:** NFR-01 and NFR-02 (`docs/01-requirements.md`), ADR-0037
  (`scripts/measure-startup.mjs`), ADR-0050 §6 (profiling against NFR-01),
  ADR-0067 (startup measurements), ADR-0078 (the progress notice, the status
  bar's render meter).
- **No schema or file-format change.**

## Context

Users praise the app's speed, and the owner wants that to survive every new
feature. The baseline of 2026-10-23 (the plan above, measured on the production
build of v0.8.3 with a real GPU) found interaction in budget: orbiting never
blocks the main thread, input handlers take 32–56 ms, a parameter change on B5
reaches the view in about 170 ms. It also found the places where that can
erode without anyone noticing: opening a project runs two or three main-thread
tasks of 100–160 ms (over NFR-01's 50 ms), the first hover over a body costs
112 ms, every edit re-renders the whole shell, and nothing in the repo measures
any of this. The kernel benchmarks (`packages/kernel/src/benchmarks.test.ts`)
time the recompute but assert nothing but B9's 30 s; `measure-startup.mjs`
measures the download and the startup but its repeat-visit path broke when
the home screen started folding the template gallery.

A budget nobody measures is a wish. This ADR puts three measurements in the
repo so a regression fails CI, shows in the status bar while developing, and is
re-read at every release.

## Decision

1. **`e2e/perf.spec.ts` measures what the user feels and asserts budgets.**
   One spec, Chromium only, in the normal e2e run. It installs a
   `PerformanceObserver` for `longtask` and `event` entries (and a
   `requestAnimationFrame` counter) with `page.addInitScript` before the app
   loads, then drives two example designs through the UI (`#/example/<id>`,
   `e2e/helpers.ts`): **pcb-enclosure** (B5, nine features, two bodies) and
   **knurled-knob** (B7, a pattern, the longest ordinary recompute). For each it
   times and samples:
   - *open → model ready* (`[data-model-status="ready"]` and the viewport's
     `data-ready`);
   - *orbit*: a middle-button drag of 60 pointer moves over about one second;
   - *parameter round trip*: a parameter edit in the Parameters dialog, then
     Ctrl+Z, each until the kernel status has left `ready` and returned, or the
     viewport's `data-bodies` has changed and the status is `ready` (watch both
     attributes with one `MutationObserver` armed **before** the edit; the
     expression field applies while typing);
   - *first hover and click on the body*: the event entries' durations.

   **Budgets (CI, SwiftShader, two workers; about twice the laptop's numbers):**

   | Window | Budget |
   |---|---|
   | open → model ready | no long task over 400 ms; long tasks total under 1.2 s; B5 ready under 8 s, B7 under 10 s |
   | orbit | no long task over 100 ms; at least 20 animation frames per second |
   | parameter edit, undo | no long task over 150 ms; B5 round trip under 1.5 s, B7 under 5 s |
   | hover, click | no input event (`event` entry duration) over 250 ms |

   The budgets are deliberately loose against today's numbers (section 1.4 of
   the plan: the laptop's worst long task while opening is 160 ms, while
   interacting 51 ms, the worst event 112 ms): they catch a step change, not
   noise. Tightening them is a one-line change once CI has a history. The spec
   **writes every raw number** (`testInfo.attach('perf.json', …)`, one object
   per window with the long tasks, the worst event, the frame rate and the
   elapsed time), so the html report artifact (`playwright-report-<shard>`)
   carries the trend. The spec has `retries` like the rest; a failure is read
   like any flaky spec (rerun, then look), never worked around by widening a
   budget without a measurement in the PR.
2. **A long-task observer in development builds** (`import.meta.env.DEV` only;
   nothing of it in the production bundle). `apps/web/src/debug/longTasks.ts`
   observes `longtask` entries and, for each one over 50 ms, logs
   `[perf] long task 123 ms` with the current route, and counts them in the
   viewport store (`longTaskCount`). The status bar's render meter
   (`shell/Timeline.tsx`, `RenderRate`) shows `· 3 long` after the frame time in
   dev builds, with a tooltip saying what a long task is; `data-long-tasks`
   carries the count. The counter resets when a project opens. In production
   the observer is never started and the status bar is unchanged.
3. **`scripts/measure-startup.mjs` is fixed and run per release.** It opens
   the folded gallery ("Start from a template") when the Wall bracket card is
   not visible, as `e2e/helpers.ts`'s `startFromTemplate` does; gets a
   `--json <file>` option writing the sizes and the three visits; and
   `docs/release-checklist.md` gets a step that runs it and compares with the
   numbers below (a step, not a gate: the numbers vary with the machine).

**Baseline recorded** (laptop, Ryzen 7 4700U, Node 26, v0.8.3, 50 Mbit):
precache 8.24 MB brotli (OCCT 4.67, app JS 1.48); home screen 0.40–0.48 s on
a first visit, 0.22–0.23 s on a repeat; kernel ready 1.9–2.2 s after opening
the Wall bracket on a first visit, 1.2 s on a repeat. In the browser, headed
with a GPU: open → ready B2 1.1 s, B5 1.5 s, B7 2.0 s, B8 2.0 s, B10 1.5 s,
B9 8.5 s; orbit 50 fps at 0.4–0.6 ms of render per frame with no long task;
parameter round trip B5 170–190 ms, B8 320–330 ms, B7 1.05–1.1 s, B10 30–40 ms.

## Rejected

- **Asserting render time or frame rate tightly in CI.** The e2e browser draws
  with SwiftShader, about 150× slower than a GPU, so only main-thread numbers
  mean anything there. The frame-rate floor of 20 fps catches a frozen main
  thread, nothing finer.
- **Lighthouse or a web-vitals library.** The app is one page behind a kernel
  worker; LCP and INP would measure the home screen. The spec measures the
  windows that matter for CAD (open, orbit, edit) with the same selectors the
  rest of the suite uses.
- **A unit-test budget on the kernel benchmarks and a size budget in the check
  job** (options 2 and 3 of the plan): worth doing, later and separately; this
  ADR is about the UI thread.
- **Shipping the long-task observer in production** (to collect from users):
  no telemetry (NFR-06, no network calls at runtime).

## Consequences

- `pnpm e2e` gets one spec of about a minute; the shard plan (`e2e/timings.json`)
  learns its duration from the next CI run as for any new spec.
- A change that adds main-thread work to opening, orbiting or editing fails
  CI with the number that broke the budget; the html report has the rest.
- `docs/agent/e2e-notes.md` gets the spec's selectors and traps (the
  observer must be armed before the edit; `durationThreshold` on `event`
  entries is 16 ms, so quick events are not listed).
