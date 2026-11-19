# ADR-0154: Profiles of sketches that aren't open are found in a worker

- **Status:** Accepted, 2026-11-19.
- **Task:** none of its own: the next step of the work on sketch profiles that
  ADR-0020's amendments of 2026-11-15 to 2026-11-19 began.
- **Builds on:** ADR-0020 (profile detection, the fills built once and their
  budget, amendment of 2026-11-19), ADR-0058 §4 (fonts on the UI thread and in
  the kernel), ADR-0083 (the import's worker), ADR-0102 §5 (worker entries stay
  out of the React Compiler).
- **Schema change:** none.

## Context

The viewport shades the regions of every shown sketch and picks them in the
model; sketch mode, feature dialogs, export and the assistant ask for a sketch's
regions too. Detection (`detectProfiles`, ADR-0020) and the fills (ADR-0020's
amendment of 2026-11-19) ran on the UI thread for all of them. This decision
moves the work for sketches that aren't open into a worker, keeps flat arrays of
their results on the UI thread, and bounds what the UI thread keeps of detection.

## Decision

1. **A worker of the app finds them.** `apps/web/src/sketch/regionsWorker.ts`, a
   module worker, takes one sketch at a time: detection (`detectProfilesWork`,
   which never remembers), the flat regions (`flattenRegions`) and the fill
   (`profileFill`), the same code the UI thread runs (`regionsJob.ts`). Nothing
   is kept between jobs but the fonts and the text shaper's cache of layouts (at
   most 500, `@extrudo/sketch/text`). It is not the kernel worker: that one is
   busy with the model's geometry, keeps no polygons, and works on a parsed
   copy of the document, so its results would wait and could not be matched
   to the sketch the shell shows.
2. **Flat results, transferred, regions first.** A result is `FlatRegions`
   (`flatRegions.ts`: region IDs and texts, areas, loop and point offsets, xy,
   boxes), sent as soon as detection is done, then the fill's positions and
   region starts; the arrays cross as transfers, not clones, and the region IDs
   and texts as a table of distinct strings with indexes (`toWire`), so a string
   shared by many regions crosses once. Each job carries what the budget has left
   for its sketch (`allowance`), less what the client has accepted since the
   shell last shared out the budget: arrays that wouldn't fit are neither sent nor
   built, only their sizes.
3. **The client** (`regionsClient.ts`) asks in timeline order; a newly shown
   sketch goes first, and a hovered one (`prefer`) goes to the front. A job
   that is no longer wanted is dropped (the worker restarted if it had run
   250 ms), an answer to an old job is ignored, and results are kept by the
   exact sketch data object (and the fonts' version, for a sketch with text),
   so undo finds them again. The entry of every shown sketch stays, whatever
   its state (done, refused, stopped or failed: the shell names them all to
   `keep`), so a sketch is asked for once per version of its data; results of
   sketches no longer shown are kept up to 64 MB and 64 results, the newest first. Results that arrive within 150 ms reach the shell together
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
   sketches keep on the UI thread: flat regions (16 bytes a point, each distinct
   string at 2 bytes a character and 32 more, 124 bytes a region with its index
   entry) and fills (16 bytes a vertex, with the drawing order, and 68 a region). The open sketch is served first,
   then the others in timeline order; a sketch gets fill and regions, else its
   regions, else nothing; a hidden sketch counts nothing. While a sketch is open
   the others keep what they were granted when it was opened, so a drag in it
   never switches another sketch's shading. What the budget doesn't grant is let
   go of and asked for again when it would fit.
7. **The open sketch stays synchronous.** Sketch mode, the palette's problem
   line, the tool host's picking, the selection readout, export, templates, the
   assistant's tools and the script emitter keep calling `sketchProfiles` /
   `detectProfiles` as before. The open sketch's fill is still built on the UI
   thread, within `MAX_FILL_WORK`. A feature dialog's handles (`profileFrame`,
   `textCentre`) ask for the centres of the regions they mark (`regionCentroid`,
   `inkCentroids`): one detection per sketch the feature refers to when its
   result isn't at hand, of which only the centres are kept.
8. **What the UI thread keeps of detection is bounded in sum.** Every cache of
   detection results (the app's in `sketch/profiles.ts`, its centres, and the
   package's memory of frozen sketches) keeps its entries in one budget,
   `MAX_KEPT_PROFILE_BYTES` (64 MB) and `MAX_KEPT_PROFILE_RESULTS` (256), the least
   recently used going first (`KeptResults`); a result let go of is found again
   when asked. A result larger than the whole budget isn't kept and lets go of
   nothing else. The open sketch's result always stays, outside the budget, while
   the sketch is open (profiles shown or hidden): it is found once per version of
   the sketch's data, whatever its size, and goes to the budget, if it fits, when
   the sketch closes or its data is replaced. It is looked up by the sketch's
   data where it is drawn: the shell's drawings carry no
   regions of the open sketch, so a drawing that a callback of an old render
   still holds never holds an old version of them. A result is
   counted by `keptBytes`: 96 bytes a point, 96 an edge, 128 a loop, 256 a region
   and its ID at 2 bytes a character, an upper bound: the heap such results held
   was 12 to 18 % below it in every case measured, without pointer compression.
9. **Fonts go to the worker** (`uiFontBytes`) before the jobs that need them.
10. **Fallback.** When no worker can start, or it dies three times, the jobs run
   on the UI thread in idle slices, one sketch per slice, within `MAX_FILL_WORK`
   and `MAX_DESIGN_FILL_WORK`.
11. **The status bar** says "· Finding profiles 12 of 30…" while the worker has
    been busy for more than 400 ms, and "· 3 sketches not shaded, 1 can't be
    picked" with a tooltip that says why and what helps.

## Who asks for a sketch's profiles

| Caller | Thread | Now |
|---|---|---|
| Fills, model picking, box select, marked outlines (closed sketches) | worker, read on the UI thread | flat arrays from the worker; nothing until they arrive |
| The open sketch's fill and picking (`pickItem`), `sketchProblem`, `ProfileReadout` | UI, sync | unchanged |
| `profileFrame` (extrude, revolve, emboss handles), `textCentre` | UI, sync | one detection per sketch the feature refers to, when not kept; keeps only the centres of its regions, within the budget |
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
- The kernel worker keeps its own cache of feature results (sketch outputs among
  them) and the import workers keep nothing between imports; both are unchanged.
- A feature dialog on many large sketches still detects each of them once on the
  UI thread.
- The open sketch's fill keeps `MAX_FILL_WORK`'s estimate: a finely serrated
  outline can lose its shading while open.
