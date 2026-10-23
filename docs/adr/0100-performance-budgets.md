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

   (§4 below moves these budgets onto the **app's own main-thread time** —
   same sizes, with the edit budget widened against measurement.)

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

## §4. Amendment 2026-10-23: the budgets bind the app's JS, not the rasteriser

CI run 39957952394 (commit `d71efddf`) failed the spec on B5. On CI's
SwiftShader every drawn frame is a 100–600 ms task on the main thread, so the
long-task budgets measured the software rasteriser, not the app: CI's numbers
for B5 (two attempts) were open 13 long tasks, total 2165 ms, max 598/532 ms;
orbit 24 long tasks, max 250 ms, 28–33 fps; edit max 234–396 ms, worst event
264–592 ms, round trip 1757–2206 ms; undo 5–7 fps; hover worst event
184–224 ms. With a GPU the same windows have no long task at all.

Investigating the SwiftShader tasks (locally, both Google Chrome stable and
Playwright's Chromium — both report `ANGLE (… SwiftShader …)` as the WebGL
renderer) with a CPU profiler showed what those tasks are: **native time**.
The main thread's JS is 0–3 % of the samples (45 % `(program)`, 41 % idle);
a frame's long task is the renderer's wait for the slow GPU process — frame
pacing — with a few milliseconds of JS at its edge. The render log proves the
same thing from inside the app: `RenderMeterProbe` (which already wraps every
`renderer.render` call) covers only 2–8 % of the long-task time under
SwiftShader, because the raster wait is not inside `render.call`'s JS. A
duration-minus-render subtraction therefore still measures the rasteriser.

What *is* the app's is its **JS execution time**, and the page can measure
it: the Long Animation Frame API (`long-animation-frame`, Chromium 123+) lists
every script that ran in a frame window with its exact duration — module
evaluation, worker message handlers, rAF callbacks, timers — and the Event
Timing API gives each input event's handler time (`processingEnd −
processingStart`), which the next paint does not inflate. So the amendment:

- **`RenderMeterProbe` (`apps/web/src/viewport/Viewport.tsx`) gets one more
  line**: when `window.__extrudoRenderLog` is an array, it also pushes
  `{ start, ms }` per render call (`start` = `performance.now()` before the
  call). Nothing else changes in the app: without that array — every normal
  visit — the probe behaves as before. The spec's init script sets the array
  and keeps the log in `perf.json` (per task the render time inside it), so a
  slow *render call* is still visible where a script-based metric would smear
  it into the rAF callback.
- **`e2e/perf.spec.ts` budgets the app's JS**: a task's app time is the
  merged union of the long-animation-frame's script durations, the render log
  entries and the event handlers' own spans that started inside the task
  (merged so work covered twice — a render call inside its rAF callback —
  counts once), reported per task as `app` and per window as `appMax`/
  `appTotal` (long tasks only) and `jsTotal` (all JS in the window, sub-50 ms
  work included). The raw `longMax`/`longTotal` and the window's
  `renderTotal` stay in `perf.json` for the record. The round trips subtract
  their window's `jsTotal` too (`roundTripAppMs = roundTripMs −
  jsTotal(window)`, `roundTripMs` kept).
- **The §1 budgets apply to the app values** — unchanged in size where the
  measurements allow: open `appMax` < 400, `appTotal` < 1200; orbit `appMax`
  < 100 (measured 1–29); **edit `appMax` < 500** — the one widened budget,
  and widened against measurement, not noise: the B7 grooves edit's
  kernel-message and autosave (`IDBTransaction.oncomplete`) handlers cost
  248–499 ms of JS on a 4-core desktop, and CI's raw edit `longMax` was
  234–396 ms, so §1's 150 would fail on the app's real work; undo `appMax` <
  150 (measured 1); `roundTripAppMs` within the example's budget and
  `roundTripMs` > 0; hover and click worst handler time < 250. On a GPU
  machine a long task is app work, so these bind what §1's budgets bound;
  under SwiftShader they keep binding it while the rasteriser's native
  passes through unmeasured.
- **The frame-rate floor (≥ 20 fps while orbiting) only holds with a GPU**:
  the spec reads the WebGL renderer string once (`WEBGL_debug_renderer_info`,
  `UNMASKED_RENDERER_WEBGL`) and, when it contains `SwiftShader` or
  `llvmpipe`, records the fps and skips that one assertion, with a
  `software rendering` annotation carrying the renderer string. The renderer
  string goes into `perf.json`.
- **The spec no longer runs serially**: both examples report even when one
  fails.

Rejected here: widening the raw long-task budgets to CI's SwiftShader numbers
(open ≈ 700, orbit ≈ 300, edit ≈ 500) — they would swallow the noise they
were meant to catch and stop guarding anything; and subtracting per task with
the render log alone — it covers 2–8 % of a SwiftShader task, so the budget
would still be the rasteriser's.

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
