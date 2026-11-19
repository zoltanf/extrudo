# ADR-0154: Profiles of sketches that aren't open are found in a worker

- **Status:** Accepted, 2026-11-19.
- **Task:** none of its own: the next step of the work on sketch profiles that
  ADR-0020's amendments of 2026-11-15 to 2026-11-19 began.
- **Builds on:** ADR-0020 (profile detection, the fills built once and their
  budget, amendment of 2026-11-19), ADR-0058 §4 (fonts on the UI thread and in
  the kernel), ADR-0083 (the import's worker; a worker out of memory takes the
  renderer with it), ADR-0102 §5 (worker entries stay out of the React Compiler).
- **Schema change:** none.

## Context

Until now the shell found the regions of every shown sketch on the UI thread
while a design opened (`sketchProfiles` in the `sketches` memo), and the fills
were built there too. Each sketch is bounded by the detection limits and the
work limits, but nothing bounded the sum over a design: a design of many large
sketches kept the page from answering while it opened, and every sketch's
regions stayed in memory as `Profile` objects.

## Decision

1. **A worker of the app finds them.** `apps/web/src/sketch/regionsWorker.ts`, a
   module worker, takes one sketch at a time: detection (`detectProfilesWork`,
   which never remembers), the flat regions (`flattenRegions`) and the fill
   (`profileFill`), the same code the UI thread runs (`regionsJob.ts`). Nothing
   is kept between jobs but the fonts. It is not the kernel worker: that one is
   busy with the model's geometry, keeps no polygons, and works on a parsed
   copy of the document, so its results would wait and could not be matched
   to the sketch the shell shows.
2. **Flat results, transferred, regions first.** A result is `FlatRegions`
   (`flatRegions.ts`: region IDs and texts, areas, loop and point offsets, xy,
   boxes), sent as soon as detection is done, then the fill's positions and
   region starts; the arrays cross as transfers, not clones. Each job carries
   what the budget has left for its sketch (`allowance`): arrays that wouldn't
   fit are neither sent nor built, only their sizes.
3. **The client** (`regionsClient.ts`) asks in timeline order; a newly shown
   sketch goes first, and a hovered one (`prefer`) goes to the front. A job
   that is no longer wanted is dropped (the worker restarted if it had run
   250 ms), an answer to an old job is ignored, and results are kept by the
   exact sketch data object (and the fonts' version, for a sketch with text),
   so undo finds them again; results of sketches no longer shown are kept up to
   64 MB. Results that arrive within 150 ms reach the shell together
   (`RESULT_BATCH_MS`): the shell lays out every shown sketch for each, so
   telling it once a sketch would cost a design of many quick sketches as much
   as finding them.
4. **A deadline instead of work limits.** A job that runs past
   `PROFILES_DEADLINE_MS` (10 s, counted from the worker's "started", so a new
   worker's start-up doesn't count) is stopped: the worker is terminated, a new
   one starts with the fonts, and the queue goes on. If the regions had come,
   the sketch keeps them for picking and goes without a fill; if not, it draws
   its curves only and counts as not shaded and not pickable. Before stopping,
   the client looks once more, for an answer that waited behind a busy page. The worker's memory is bounded
   by the detection limits (`MAX_PROFILE_SEGMENTS`, `MAX_PROFILE_POINTS`,
   `MAX_PROFILE_TESTS`) and by building no fill larger than the budget could keep.
5. **No region objects of closed sketches on the UI thread.** Picking in the
   model (`regionAt`, the same crossings as `profileAt`), box select
   (`regionOutline`), the outlines of marked regions and the budget read the
   flat arrays.
6. **One memory budget.** `MAX_REGION_BYTES` (256 MB) covers what a design's shown
   sketches keep on the UI thread: flat regions (16 bytes a point) and fills
   (16 bytes a vertex, with the drawing order). The open sketch is served first,
   then the others in timeline order; a sketch gets fill and regions, else its
   regions, else nothing; a hidden sketch counts nothing. While a sketch is open
   the others keep what they were granted when it was opened, so a drag in it
   never switches another sketch's shading. What the budget doesn't grant is let
   go of and asked for again when it would fit.
7. **The open sketch stays synchronous.** Sketch mode, the palette's problem
   line, the tool host's picking, the selection readout, feature dialogs'
   frames, emboss, export, templates, the assistant's tools and the script
   emitter keep calling `sketchProfiles` / `detectProfiles` as before. The open
   sketch's fill is still built on the UI thread, within `MAX_FILL_WORK`.
8. **Fonts go to the worker** (`uiFontBytes`) before the jobs that need them.
9. **Fallback.** When no worker can start, or it dies three times, the jobs run
   on the UI thread in idle slices, one sketch per slice, within `MAX_FILL_WORK`
   and `MAX_DESIGN_FILL_WORK`.
10. **The status bar** says "· Finding profiles 12 of 30…" while the worker has
    been busy for more than 400 ms, and "· 3 sketches not shaded, 1 can't be
    picked" with a tooltip that says why and what helps.

## Who asks for a sketch's profiles

| Caller | Thread | Now |
|---|---|---|
| Fills, model picking, box select, marked outlines (closed sketches) | worker, read on the UI thread | flat arrays from the worker; nothing until they arrive |
| The open sketch's fill and picking (`pickItem`), `sketchProblem`, `ProfileReadout` | UI, sync | unchanged |
| `profileFrame` (extrude, revolve, emboss), `textCentre` | UI, sync | unchanged: detects the one sketch asked about |
| Export Sketch, templates | UI, sync | unchanged |
| Assistant tools (`@extrudo/api`), script emitter | UI, sync | unchanged |
| Kernel sketch feature, OpenSCAD export, scripts | kernel worker | unchanged |
| f3d and FreeCAD import | import worker | unchanged |
| CLI | Node | unchanged |

## Numbers

Chrome on one four-core desktop, each design opened again from storage, alone:

| Design (plates with 30 holes) | Longest block, before | After | All fills there, before | After |
|---|--:|--:|--:|--:|
| 30 sketches | 577 ms | 164 ms | 1.2 s | 1.7 s |
| 100 sketches | 1,732 ms | 422 ms | 2.6 s | 3.8 s |

The fills of an ordinary design arrive a little later than before, while the page
stays free. The slowest sketch of the repository's 65 designs takes the worker
6.5 ms; a plate with 1,000 round holes of 5 mm takes 3.3 to 3.8 s, inside the
deadline. The largest of the repository's designs keeps 63 KB of the budget (0.02 %).

## Rejected

- **The kernel worker** (decision 1).
- **Cloning `Profile[]`**: the receiving thread then rebuilds every object; flat
  arrays cost nothing to receive.
- **Idle slices on the UI thread only**: one large sketch still blocks, and the
  regions still live on the UI thread.
- **A budget of vertices**: it left out what picking keeps.
- **A time budget at open**: the page still blocks up to it, and ordinary large
  designs would lose their shading.

## Not covered

- Work that is not profile work still runs on the UI thread while a design
  opens: the curves' drawing and the document's parse.
- A synchronous caller asking about a closed sketch (a feature dialog's frame)
  detects that sketch on the UI thread, and detection keeps that result while
  the sketch's data lives.
- The open sketch's fill keeps `MAX_FILL_WORK`'s estimate: a finely serrated
  outline can lose its shading while open.
