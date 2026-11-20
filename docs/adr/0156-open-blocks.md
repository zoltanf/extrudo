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
   bounds, then the drawing). Each `Viewport` keeps one `SketchCurves`: per
   sketch **one** `Float64Array` of points end to end, with an offset and a box
   per kept curve and a map from entity to slot, all sampled the first time
   any curve of the sketch is asked for. It keeps **nothing for a line** (two
   end points, measured from the data as cheaply as from a copy), **a point**,
   **a text** (its curves follow the fonts) or **a polyline of fewer than
   `MIN_KEPT_POINTS` (8) points** (its offset, box and map entry would cost more
   than twice its drawn segments); those are sampled on each ask, as before.
   So a view keeps at most twice the bytes the drawing's segments take for the
   same curves, whatever the mix (`keptBytes`, tested): nothing for a sketch of
   lines, about 0.7 times the drawing for circles. It is kept **only for data
   frozen all the way through** (checked once per data object); `retain` lets go of every sketch the
   view no longer shows, so the undo history, which keeps old data objects
   alive, never keeps samples. `sketchSegments` (the drawing and `sketchBoundsOf`)
   and the pick (`sketchHits`, `curveDistance`, `pickBox`'s curves) read it; the
   open sketch samples its own as before. The pick (`nearestEntity` in
   `selection/pick.ts`) is `pickEntity` with the same arithmetic and order
   (`flatPolylineDistance` equals `polylineDistance` bit for bit), and it skips a
   curve whose box lies further than the reach (plus a margin of 10⁻⁹ of the
   coordinates for rounding), which can never be the one picked.

3. **The selection merges picked items in one pass** (`nextSelection`,
   `packages/core/src/stores.ts`). A box over many profiles picks thousands of
   items, and `replace` compared each with every item before it (a new slice
   per item), `add` and `toggle` each with the whole list. Now a key per item
   (`kind`, NUL, `id`) in a `Set` for `replace` and an insertion-ordered `Map`
   for `add`/`toggle` (deleting and setting again moves an item to the end, as
   the splice and push did): the same list in the same order. A current
   selection that holds an item twice (no store rule makes one) keeps the old
   scan.

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
- What a view keeps for a sketch stays within twice the drawing's segment
  bytes for any mix of entities (`pickCurves.test.ts` counts `keptBytes`
  against `sketchSegments`' arrays): no per-curve typed arrays or objects, no
  entry for a line, a point or a polyline under `MIN_KEPT_POINTS`.
- Never keep samples in a cache keyed by data alone without `retain`: the undo
  history keeps old data alive (the rule ADR-0020 gives for fills).
- Selection changes stay linear in the items picked: no scan of the list per
  item (`stores-select.test.ts` counts the reads).

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
- **`Vec2` arrays in the cache** (what `entityPolylines` returns), or **a typed
  array, box and object per curve** (the first form of this decision): for long
  polylines such as circles a typed array per curve was about 0.9 times the
  drawing's bytes, but for lines each such entry cost about 460 bytes (`Vec2`
  arrays about 285), some 19 times the 24 bytes the drawing keeps for a line
  and more than the sketch's own data. One array per sketch with nothing kept
  for lines and short polylines keeps the cache within twice the drawing.

## Numbers

Chrome with a real GPU, minified build, longest main-thread block, median of 3
runs, before → after, for a design of 30 / 100 plates with 30 holes each:
pointer move over the model 29 → 9 / 66 → 22 ms, click 44 → 24 / 117 → 48 ms,
the hover where an orbit starts 24 → 14 / 64 → 27 ms, box select 54 → 51 /
135 → 113 ms. Opening, showing and hiding are within the noise for these.
For designs with many large sketches, opening blocked the page about a third
as long in all (§1), a pointer move or a click went from seconds to tens or a
few hundred milliseconds (§2) and a box over thousands of profiles from
seconds to about one (§3).

## Amendment (2026-11-19): profile results render what shows them

**Context.** On opening, every batch of profile results (ADR-0154) rendered
the whole shell: the app bar, the toolbar's tiles, the browser's rows, the
timeline's chips (with their tooltip and menu triggers) and every shown
sketch in the view; about 2,450 component renders a batch for 30 plates.
The React Compiler doesn't compile `Shell` (it reads and writes refs during
render, has dynamic `import()`s and manual memos whose dependencies it can't
match), so each render of it hands new callbacks to all of those. Separately,
each step of the kernel's progress rendered all of the timeline's chips for
the one that changed: the compiler skips the chip (`useChipDrag` changes a
value it can't prove unshared) and left the timeline's `live`, `select` and
`movingWith` unmemoised (they read a ref, and `movingWith` made a new array
for every chip).

**Decision.**

1. The shell builds the shown sketches from the document only
   (`ShownSketchBase` in `shell/shownSketches.tsx`: the drawings, the open
   sketch's claim, the closed sketches' jobs). `ShownSketchesProvider`, around
   the shell's tree, subscribes to the profile client and the unbuilt fills,
   adds the results (`withResults`: the old memo's rules; the open sketch's
   claim, made by the shell, is looked at again there, since a fill that fails
   to build (`noteUnbuiltFill`) renders the provider and not the shell: its
   profiles come from the profile cache, where the open sketch is pinned, and a
   failed fill leaves it unshaded and gives its bytes back) and gives
   the drawings and the note's counts through two contexts
   (`useShownDrawings`, `useSketchShading`). Its children are the shell's
   elements, unchanged when only results arrive, so a batch renders the
   provider, `DialogViewport` and the view, and the status bar's
   `UnshadedSketches` only when a count changes. Its effects run in the old
   order among themselves (fonts, `want`, `keep`); as a child's, they now run
   before the shell's own effects, the one that makes the client included: on
   the first pass they have no client and do nothing, and once the client is
   set they run in that order.
2. A drawing whose results didn't change stays the same object (`dressed`,
   per base drawing), the list stays the same while every drawing does, and
   `Sketches` memoises each sketch and fill (`ShownSketch`, `ShownFill`): the
   compiler memoises the list as a whole, not its items.
3. The timeline's chip is `memo(TimelineChip)` with stable props: `live` and
   `select` memoised, a one-chip `moving` list kept per feature (dropped when
   the feature goes), and one `featureProblem` object per status object, so a
   chip with an error or a warning keeps its props too.

**Rules.**

- Profile results reach the view and the note through the provider's
  contexts; nothing in `Shell` may subscribe to the profile client's store or
  read a drawing's `regions`/`fill`/`unshaded` (the shell's render is not
  memoised).
- `withResults` never writes into the base's drawings or jobs (jobs are copied
  before `allowance` is set).
- What the tests check, and a change must keep: the provider gives a batch's
  drawings with the same objects for the sketches it isn't for, renders none
  of the shell's other children, and renders the note only when a count
  changes (`shownSketches.test.tsx`, with stand-ins for the shell's parts); the
  real `Sketches` renders, for a batch for 3 of 30 sketches, those 3 sketches
  and fills only (`Sketches.renders.test.tsx`); a failed fill of the open
  sketch unshades it and gives its bytes back without a new base
  (`shownSketches.test.tsx`); a kernel step renders only the chips whose
  "computing" changed, those with a problem included
  (`Timeline.renders.test.tsx`, the real `Timeline`). No test renders `Shell`:
  that nothing in it subscribes to the profile client is a rule for review.

**Rejected.** Making `Shell` compile: dozens of diagnostics in a 3,900-line
component, a refactor of its own. Wrapping the shell's children in `memo`: their
props are new on every shell render, so it would spare nothing.

**Numbers.** Opening a stored design of 30 / 100 plates with 30 holes each,
Chrome with a real GPU, minified build, median of 5, before → after: time the
page was blocked in all 1,062 → 705 / 2,572 → 1,005 ms, its longest block 254 →
250 / 672 → 412 ms. Components rendered by a batch of results: about 2,450 /
6,300 → 24, plus in the view about 262 / 822 → 84 / 88 (the sketches whose
results arrived); by a kernel step: 1,276 / 4,216 → 109.
