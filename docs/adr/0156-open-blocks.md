# ADR-0156: Work the page repeats for every shown sketch is done once per sketch version

- **Status:** Accepted, 2026-11-19.
- **Task:** none of its own: what ADR-0154's open question on the blocks that
  are not profile work left, measured and fixed where the fix changes nothing
  the user sees.
- **Builds on:** ADR-0020 (data remembered only when frozen all the way
  through), ADR-0154 (the shell hands new drawings with every profile result),
  ADR-0052 (the tutorial's steps are pure checks over the document).
- **Schema change:** none.

## Context

With the profile worker in, a design with many large sketches still blocked
the page: on opening, on every pointer move over the model, on a click, on
showing or hiding a sketch. A CPU profile of each action attributed the time
to work repeated for every shown sketch on every render or every pick, work
whose answer depends only on a sketch's data, which the document store
freezes. For ordinary designs (30 to 100 plates with holes) the same work
costs tens of milliseconds per pointer move.

## Decision

1. **Per-sketch facts are remembered by the sketch's data** (`sketchFacts`,
   `packages/core/src/sketch/facts.ts`): whether it has a non-construction text,
   its texts and their fonts, how many lines it has. Kept in a `WeakMap` only
   when `data`, its entity map and every entity are frozen (the facts read only
   the entities' own fields, so frozen ones can't change them); other data is
   walked on each call and nothing is kept. `hasText` (the profile client),
   `usedFonts` (the fonts the UI and the kernel load), `textBoundsSummary` (the
   viewport's test attribute, now only over the texts) and the tutorial's
   "rectangle" step read them. The tutorial's current step is memoised by its
   facts (`useTutorial`): the React Compiler does not memoise a plain call whose
   result is a number, so it ran on every render of the shell, which re-renders
   for every batch of profile results.

2. **The curves of the shown sketches are sampled once per data object**
   (`SketchCurves`, `apps/web/src/sketch/curveLines.ts`). Model-mode picking
   measured against every curve of every shown sketch on each pointer move
   (twice per click: press and click) and sampled each curve again each time
   (`pickEntity` → `entityPolylines`); opening sampled each sketch twice (Fit's
   bounds, then the drawing). Each `Viewport` keeps one `SketchCurves`: flat
   `Float64Array` polylines and a box per curve entity, kept **only for data
   frozen all the way through** (checked once per data object) and **never for a
   text** (its curves follow the fonts); `retain` lets go of every sketch the
   view no longer shows, so the undo history, which keeps old data objects
   alive, never keeps samples. `sketchSegments` (the drawing and `sketchBoundsOf`)
   and the pick (`sketchHits`, `curveDistance`, `pickBox`'s curves) read it; the
   open sketch samples its own as before. The pick (`nearestEntity` in
   `selection/pick.ts`) is `pickEntity` with the same arithmetic and order
   (`flatPolylineDistance` equals `polylineDistance` bit for bit), and it skips a
   curve whose box lies further than the reach (plus a margin of 10⁻⁹ of the
   coordinates for rounding), which can never be the one picked.

## Rules

- A check that runs per render over every sketch reads `sketchFacts` (or adds a
  fact there) instead of walking `data.entities`.
- Facts are kept only for data frozen through its entities; a new fact must
  read only an entity's own fields (or it needs the deep check of
  `curveLines.ts`).
- Per-pick or per-render code that needs a shown sketch's curve polylines takes
  them from the view's `SketchCurves` (`PickScene.curves`, the `linesOf`
  argument of `sketchSegments`), never `entityPolylines` per call.
- `nearestEntity` must pick what `pickEntity` picks (`pickCurves.test.ts`
  compares them): a box skip may only leave out curves that can't be within
  reach, and the distances keep `polylineDistance`'s and `curveDistance`'s
  arithmetic.
- Never keep samples in a cache keyed by data alone without `retain`: the undo
  history keeps old data alive (the rule ADR-0020 gives for fills).

## Rejected

- **Keeping the facts for any data object.** A builder's or a draft's data is
  changed in place; ADR-0020 keeps detection only for frozen data for the same
  reason.
- **A global `WeakMap` of samples by data.** Simplest, but every version of a
  sketch the undo history holds would keep its samples (megabytes for a large
  sketch).
- **Picking on the drawing's `Float32Array` segments.** No second copy, but
  distances in single precision could pick another curve at the edge of the
  reach.
- **`Vec2` arrays in the cache** (what `entityPolylines` returns): about 2.5
  times the memory of flat arrays.

## Numbers

Opening a stored design with many large sketches (Chrome, real GPU, minified
build): the time the page was blocked in all fell by about two thirds, most of
it the three walks above; showing or hiding a sketch by a third to a half.
