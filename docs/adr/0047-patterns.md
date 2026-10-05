# ADR-0047: Patterns and mirrored features

- **Status:** Accepted, 2026-09-30
- **Task:** P3-07 (FR-FT-11: mirror and pattern of bodies, features or faces).
  Code: `packages/core/src/pattern.ts` (the three feature types, the layout
  maths), `packages/core/src/mirror.ts` (a `features` mode), the kernel's
  `features/pattern.ts` (evaluators, `replayFeatures`, `mergeTools`),
  `features/pattern-layout.ts` (placements), `features/pattern-path.ts` (the
  path), `features/transform.ts` (Mirror's features branch); the web app's
  `features/pattern.ts` (three dialogs), `features/featureList.ts` and the
  `features` field in `features/FeatureDialog.tsx`.
- **Builds on:** ADR-0044 (the facade's `transform`, copies' names), ADR-0028
  and ADR-0029 (`operate`, `splitSolids`), ADR-0005 (naming), ADR-0040
  (`lineOf`), ADR-0024 (the engine, dependencies, leak checks), ADR-0027
  (dialogs), ADR-0033 (timeline dependencies).
- **Affects:** P3-14 (B4 to B7 use patterns), P3-04 (a Hole feature will be
  patternable the day it joins or cuts through `operate`).

## Context

Patterns come in three layouts (rectangular, circular, on a path) and act on
three kinds of thing (bodies, features, faces); Mirror needed the same
"features" mode, which ADR-0044 deferred to here. The facade already has
what a pattern needs (`transform`, booleans, `compound`), and a pattern of a
few hundred instances must not mean a few hundred sequential booleans.

## Decision

### 1. Three feature types, one machinery

`rectangularPattern`, `circularPattern` and `pathPattern` are separate types
(each its own dialog, tool and chip) with shared inputs: `objects`
(`bodies` | `features`), `bodies`, `features`, `join`. **The original counts
as an instance**: a count of 3 makes two new ones, and `symmetric` keeps the
original in the middle (an even count leaves it one place before the
middle). Every layout is reduced to a list of `Placement`s: a rigid motion
(a `Matrix12` for `Kernel.transform`), a label and a slot.

- **Rectangular:** direction 1 and optionally direction 2 (origin or
  construction axis, straight edge or sketch line: `lineOf`), each a count
  and a distance read as *spacing* or *extent*; the second direction may not
  be parallel to the first.
- **Circular:** an axis, a count and an angle read as the whole angle or the
  angle between neighbours; a whole turn (or more) is divided into `count`
  parts, less into `count - 1` (`angularStep`, pure, in core).
- **Path:** sketch curves and edges chained end to end into one polyline
  (`pathFromRefs`: pieces are found by their end points and reversed where
  needed, a gap is an error). The first instance sits at the start; the
  others move by the way the path went, and with `aligned` turn about the
  path's start by the smallest turn that takes its direction to the path's
  direction there (`turnTo`). Arcs are sampled every half degree, and a
  vertex that turns the path by under 2° is a curve's, so the tangent
  there is the mean of its two segments (a real corner keeps both).
  The sketch evaluator's output gained `curves` (exact arcs, polylines for
  the rest) for this; body edges come through `edgeGeometry`.

Counts are `unitless` expressions that must be whole numbers from 1 up; one
pattern makes at most 1000 instances.

### 2. Bodies: copies, or one join

Each instance of a body is `Kernel.transform` of it, named through the
transform's history and then renamed `pattern:<feature>:<label>:from:(<name>)`
(`label` is `2`, `m1` for -1, `1x2` in a grid). **Names stay when counts
grow**: an instance's label is its position in the layout, not its index in
a list, and a copy's body ID `<feature>:<n>` comes from the same position
(`slotOf`, a Cantor pairing of the zigzagged indices, and `pairSlots` for
the body's place among the patterned bodies). Adding instances adds names
and IDs and changes none. Tests: names and shapes of the first instances are
the same with 3 and with 5; a fillet on an edge of the first copy still
finds it when the count grows.

With `join`, each body's copies are fused into it with **one boolean**
(`mergeTools`, below); a copy that misses the body becomes a body of its own
(`splitSolids`) with a warning.

### 3. Features: the tool is replayed

A solid feature's evaluator ends in `operate` (extrude, revolve and the
primitives), which already returns the tool it applied as a `previewTool`.
That preview tool now also carries its **naming table** (`PreviewTool.names`).
A pattern (or Mirror) refers to the feature by a new reference kind,
`{kind: 'feature', id}`: the engine's and the timeline's dependency rules
already follow a reference's ID, so ordering, "delete refused while
something refers to it", suppression ("Needs Extrude1, which is
suppressed") and Fix References work unchanged. The evaluator reads
`ctx.output(feature).previewTools[0]`, copies it to every placement (renamed
as above, so the faces the copies leave in the body are
`pattern:<f>:<label>:from:(<the tool's face name>)`), merges the copies into
one shape and calls **`operate` itself** with the feature's operation:
join goes to the bodies the tool touches, cut removes it, with the same
messages and warnings as the feature (a cut that touches nothing is an
error). Several features go through one after the other, each on what the
last left (a small shim of the context supplies the bodies, names and body
IDs). Shapes an earlier step made and a later one replaced go back to the
scope (found by a leak test).

- **Scope:** extrude, revolve and the four primitives that **join or cut**.
  A feature that makes a new body has no tool to repeat (its body can be
  patterned instead), an intersect has none worth repeating, and features
  that change a body (fillet, chamfer) or make planes are out. The dialog
  lists exactly the eligible features before the pattern
  (`repeatableFeatures`); the kernel says why for any other.
- **Mirror** gets the same `objects` input and `features` list: the
  reflection is a `Placement` with a mirror matrix, the op word is
  `mirror` and names are `mirror:<f>:from:(<name>)`, like its body copies.
  `bodies`, `copy` and `join` are ignored in that mode.
- **Faces** are not patterned. A face pattern is Press/Pull or an offset of
  a face repeated (P3-08), which needs those features first. Offset Face
  exists since P3-08, and the face pattern did not fall out of it: see
  ADR-0051 §8.

### 4. One boolean for many instances

Instances that don't touch each other go into one compound argument, and a
join or cut is one boolean whatever the count. Instances that overlap or
touch each other can't: OCCT refuses a compound argument whose solids
interfere (measured: 100 overlapping boxes gave an invalid shape of 91
solids). So `mergeTools` first groups the instances that interfere (bounding
boxes that meet, then the exact distance), fuses each group as a **tree of
booleans** (halves first, `simplify` on) and hands the groups, which don't
interfere, to the boolean as one compound; a single group is used as it is.
No facade change: `transform`, `compound`, `distance` and the booleans exist.

Measured on the Ubuntu machine (4 cores shared with two other agents, real
OCCT in Node, Vitest; whole document recompute unless noted):

| Case | Time |
|---|---|
| 10 × 10 copies of a 6 mm box (100 new bodies) beside a plate | 0.49 s |
| 10 × 10 copies joined (touching: one 60 × 60 × 4 slab) | 2.0 s |
| 10 × 10 holes (4 mm) cut through a 120 mm plate | 1.1 s |
| 10 × 10 bosses joined to it | 0.67 s |
| 10 × 10 holes that overlap each other (6 mm at 5 mm) | 7.9 s |
| *Experiment:* a plate with 100 separate boxes fused, one compound vs 100 sequential booleans | 0.48 s vs 6.4 s |

Overlapping curved tools are the slow case (cylinder against cylinder), and
a 10 × 10 grid of them is a rare thing to want; it stays usable. The tree
fuse of 100 overlapping boxes took 1.7 s, close to the sequential fuse's
1.4 s, so the tree only pays where the groups are small.

### 5. Dialogs

Three specs in `apps/web/src/features/pattern.ts`, fields named like the
inputs. Pattern (`objects`): Bodies or Features. A new field kind,
`features`, is a list of the eligible features before the draft to tick
(values are `feature` refs in `values.refs`, nothing is picked in the view);
Mirror's dialog uses it too. The **ghosts** are the evaluator's preview
tools: the merged tool of a features pattern drawn as a cut or a join, the
copies of a bodies pattern as translucent new bodies, and the joined
tool. **Handles:** a distance arrow per direction of a rectangular pattern
(from the middle of the picked bodies, or of all bodies) and an angle ring
about a circular pattern's axis; there is no count handle (a count isn't a
distance) and no handle on a path. The tools are in Solid › Create's menu
(no new toolbar tile, so the shell baselines are unchanged). The old
placeholder tool `pattern` is gone.

## Rejected

- **A boolean per instance.** A 10 × 10 pattern takes 6.4 s against 0.5 s
  for one compound, and it grows with the count (each boolean has the
  growing shape to intersect).
- **A facade method that fuses a list** (`BRepAlgoAPI_Fuse` with argument
  and tool lists, which accepts interfering tools). It would make the
  overlapping case faster, but costs an OCCT build and a facade change
  that P3-03 is also making; the grouping in TypeScript is enough for now.
  Worth revisiting if overlapping curved patterns matter.
- **Storing the tool's geometry in the pattern**, or re-running the source
  feature's evaluator at each instance with a transformed frame. The first
  duplicates geometry the document derives; the second means every evaluator
  knows about patterns. The engine already has the tool: reading it from the
  feature's output is one line and follows its edits.
- **A single `pattern` type with a `kind` input.** One dialog and one chip
  icon, but the fields of the three layouts share almost nothing and the
  tools, keys and search entries want their own names.
- **Instances numbered 0, 1, 2 … in a list.** Simple, but raising the count
  of a symmetric or two-directional pattern renumbers instances, so every
  reference into them breaks. Labels and IDs come from positions instead.
- **Pattern "count" as a plain number, not an expression.** The rules say
  every numeric input is an expression; a count is one (unitless) and can
  be a parameter.
- **`symmetric` with the original outside an even series** (the series
  centred on the original's place, the original not an instance). It makes
  an even count add one more body than the count says.

## Consequences

- No facade change; the OCCT input hash stays `8057072e8cdd`.
- `GeomRefKind` gained `feature` (`docs/file-format.md` section 8): older
  readers reject a file that uses it, as for any new feature type.
- `EvalContext.featureName(id)` (for messages) and `PreviewTool.names` are
  new; `SketchOutputData.curves` too.
- Open: skipping instances ("skip list"); patterns of faces; a count handle;
  a path pattern's placement is relative to the path's start, not to the
  object (Fusion places the object on the path's start by an option);
  patterns of a feature that changes a body (fillet, chamfer, Shell) or of
  a Hole feature, once P3-04 lands, should go through the same route
  (`operate`) or a `tool` output of their own.

## Amendment 2026-10-01: a failed round releases what earlier rounds kept (P3-17)

Fuzzing B5 (seed 20260983) found `Rectangular Pattern1` leaving 2 shapes
behind: it repeats Cylinder1 (a join) and Hole1 (a cut); with Hole1 moved off
the post, the first round's `operate` had `keep`-ed its tool and joined body
out of the pattern's scope, the second round's cut then missed every body and
threw, and nothing owned the kept shapes any more. `replayFeatures` now takes
what each round kept back into the scope (`adopt`) and keeps only the final
outputs after the last round, so a failure releases them all; `patternBodies`
keeps its copies after every body worked (same rule as shell: "keep only when
everything worked"), and Mirror's join does too. Tests: `fuzz.test.ts` "B5
releases the shapes of a pattern whose second round fails" (strict leaks).
**Rule for new evaluators: never `scope.keep` inside a loop or round that can
still throw; keep after the last thing that can fail.** B5 is in the fuzzer's
list.

**Found by the same runs, not fixed:** `count2 × 10` on B5's Rectangular
Pattern1 (2 × 20 instances of the post and its hole, most of them off the
box, so separate bodies) recomputes in 54 s to 162 s (seeds 7 and 2026, B5
steps 734 and 305: "a recompute that long is a hang"). Profiling 2 × 6 shows
`kernel.distance` is 90 % of the time (73 calls at 75 ms): `operate` asks it
once per body for the merged tool, and a compound of many solids against
many bodies grows with both. A bounding-box filter doesn't help (the tool's
box spans every body); the fix is per-instance targets or the colour-class
plan already listed under P3-17. The default 200-step run doesn't reach it.

## Amendment (P3-17, part 2): targets solid by solid

The 54 s to 162 s case above is fixed without a facade change. `operate`'s
automatic targets (`touchingBodies` in `features/operation.ts`, also used by
every solid feature) are now found in two steps: a body whose (loose) box
doesn't meet the tool's box is out, and the others are asked **solid by solid
of the tool**, each solid's own box first, with `kernel.distance` only for the
pairs whose boxes meet. A tool of one solid keeps the single exact distance.
The answer is the same; the cost no longer grows with bodies x instances.
Hole's "holes that reach no body" check does the same box-first test.
`boxesTouch` moved from `pattern.ts` to `operation.ts`.

Numbers (this machine, B5 with `count2 x 10`, `BENCH=1 pnpm vitest run
packages/kernel/src/pattern-bench.test.ts`, which also prints the time per
`Kernel` method): **55.2 s -> 2.4 s** (`kernel.distance` 53 s -> 0.04 s over the
recompute; x3: 6.3 s -> 1.0 s). The fuzzer's `FUZZ_SEED=7` and `FUZZ_SEED=2026`
at `FUZZ_STEPS=1000` on B5 now finish in 103 s and 69 s with the slowest step
at 1.6 s and 2.6 s. The fuzzer keeps both sequences (at its step count + 100)
and a regression test "B5 recomputes a pattern of 2 x 20 instances in seconds"
(under 15 s, the warning about separate bodies).

**Colour classes for cuts.** `mergeTools` fused every group of interfering instances
before the boolean. A pattern of **features that cut** now colours the
interference graph instead (`toolSet` in `features/pattern.ts`: first fit in
instance order, instances that touch or overlap are neighbours, at most 8
classes, else it falls back to fusing) and `operate` cuts the body once per
class, each class a compound of instances that do not meet (a valid boolean
argument), each cut on what the last left (`ToolSet` in `features/operation.ts`;
the passes simplify, so the walls of overlapping instances stay whole: the same
faces as with the fused tool, 14 in the five-hole slot test). A grid of
overlapping holes is two classes. Numbers (`pattern.test.ts` timings, this
machine): overlapping 10 x 10 holes **7.7 s -> 3.7 s**; volume the union of the
circles (new test, integrated), valid. **Joins keep the fuse**: colour classes
were measured slower for them (overlapping 10 x 10 bosses 3.9 s against 2.1 s,
joined touching copies of a body 3.2 s against 1.5 s), because each join then
fuses into the growing body. So `patternBodies` and the join rounds of
`replayFeatures` are unchanged, and so are the golden tables.

**Names.** Without interference nothing changes. Where instances of a cut
overlap, a wall face that the second class splits and `simplify` merges again
keeps a `#1` where the fused tool gave the plain name (instance 4 of the slot:
`pattern:P:4:from:(cylinder:H:side:wall)#1`, was without the suffix); related-name
resolution (ADR-0005) matches them. The preview tool of such a cut is one
compound of all instances (for drawing and for finding the bodies they touch)
with `PreviewTool.interferes`, which is not a valid boolean argument, so
repeating that pattern again is refused ("repeats a tool whose instances
overlap"); the Hole feature keeps fusing its own holes, since a Hole is
repeatable. A pattern is not in the dialogs' list of repeatable features, so this
only shows for a hand-edited document.

## Amendment (P4-12): a skip list, count handles and a path handle

The backlog item this closes: *"Patterns: a skip list, count and path handles
(ADR-0047)."* No facade change; no OCCT build.

### `skip`: leaving instances out

All three pattern types take an optional **`skip`** input: the position labels
of the instances they leave out (`"2"`, `"m1"`, `"1x3"`), as the new `labels`
input kind (`schema.ts`: a list of names of a design's own making, with nothing
to refer to, each matching `m?\d+(xm?\d+)?`).

A label is a **position**, which is what makes the list safe: it cannot go
stale, nothing has to be re-resolved, and a skip stays on its instance while
the counts change (the counts only add instances at the end of each series, and
the grid labels are `i x j`). So:

- The kernel drops the listed placements **before any boolean**
  (`splitSkip` in `features/pattern.ts`), so what is left is exactly what the
  pattern would have made without those instances: the same body IDs, the same
  face names, the same geometry. Nothing else had to change.
- **The original can't be skipped** ("The original can't be skipped.") — it is
  the thing being patterned, and `0`/`0x0` is a label like any other, so the
  mistake is caught with a message instead of silence.
- **A label no instance has is ignored, not an error**, and it stays in the
  list: the user lowered the count and the skip comes back when they raise it.
- **Every instance skipped** makes nothing new and says so as a warning (the
  ghosts are still drawn), rather than failing: it is a state a user passes
  through, not a mistake.
- A skipped instance is previewed as a **ghost** (`PreviewToolStyle` gained
  `skip`): the copy of the original, or the feature's tool, at that
  placement. It costs one `transform` per skipped instance per body, and the
  shapes are the engine's (the scope keeps them, like every preview tool), so
  a failed pattern releases them as usual — `strictLeaks` and the leak test
  cover it.

`skip` needed a **new input kind** rather than an `enum`: a list of strings
with a shape of its own. `packages/core/src/pattern.ts` gets `skipLabels`,
`toggleSkip` and `isOriginalLabel`; the dialogs get a `labels` field kind
(`spec.ts`), which is the read-only "Skipped" line with a Clear button and the
input behind it. **An empty list makes no input at all**, so a design with
nothing skipped says nothing and every existing pattern file is unchanged.

### The layout report

The in-view handles need to know where the instances are, and the app cannot
work that out: a path pattern's points come from OCCT's sampled edges. So the
evaluators **report the layout** (`FeatureOutput.report`, a `PatternReport`):
every instance's centre (its placement applied to the box centre of what is
patterned — the picked bodies, or the first replayed feature's tool), its label,
whether it is skipped, and one entry per **series** (`PatternSeries`: the
direction, the step, the count, and where its first and last instances are). It
is plain JSON, checked by `isPatternReport`, and comes through a preview like
any other report (`Preview.pattern`). The app reads it and never repeats the
layout maths — `rectangularSeries`, `circularSeries` and `pathSeries` are pure
and tested in the kernel, where the placements are.

`includeOriginal` on the three placement builders lists the original with the
others (`original: true` on its `Placement`), which is what the report needs;
the placements an evaluator *runs* still leave it out, as before.

### Handles

Three new manipulator kinds in `spec.ts`, all drawn by `DialogOverlay`:

- **`toggle`** — a dot on every instance's centre: filled while it is made, a
  ring with a slash through it while it is skipped. A click puts the label in,
  or takes it out of, the `skip` field. Off above `MAX_PATTERN_TOGGLES` (100)
  instances: that many dots are more than anyone can use, and the Skipped field
  still works.
- **`count`** — a handle on the last instance of each series (one per direction
  of a rectangular pattern, on the arc for a circular one). Dragged along the
  direction (or round the axis), the count becomes the nearest whole number of
  steps the drag reached (`draggedCount`, pure): `round(share) + 1` when the
  distance is between neighbours, and, when it is from the first instance to
  the last, the count scaled by the share of that extent the drag reached — at
  the handle's own place the share is 1, so the count stands still until the
  drag moves. Never below 1, never above `MAX_PATTERN_INSTANCES`.
- the path pattern's **`distance`** handle at the last instance, along the path's
  tangent there, driving the extent along the path. With the distance read
  between neighbours the arrow spans the whole run, so its scale is `count - 1`.

**A lifted handle.** An arrow's tip and a count handle both land on an
instance's centre, which is where that instance's dot is: one of the two was
unreachable. The pattern's handles therefore carry a `lift` (14 px) and are drawn
clear of the geometry — across the shaft for a row, straight out from the axis
for a turn — with a tick back to where the handle really is. A lifted drag
measures from the origin rather than taking its offset where it was pressed,
because where a lifted head was pressed says nothing about the value (in
perspective a 14 px offset moves the ray's intersection with the shaft
noticeably). Nothing else changed: a handle with no `lift` behaves exactly as
before.

### Rejected

- **Filtering in the app** (dropping the ghosts or the copies from the preview
  drawing): the preview comes from the kernel and the bodies are what it is, so
  the kernel has to do it, and `skip` has to be an input for the same reason.
- **A per-instance boolean in the document** (the Fusion way, `skip1 = true`):
  it grows with the count, and a flag that names a position by index is exactly
  the thing that goes stale when the count changes. A label list is the same
  information and cannot.
- **Repeating the layout maths in the app** so the handles need no report: it
  would be a second copy of `rectangularPlacements` and friends, drifting from
  the kernel's. The path pattern cannot be worked out in the app at all.
- **Dragging a count handle changes the distance** instead (what Fusion does):
  a count is the thing the handle sits on, and the distance already has an
  arrow. Making the distance change too would mean every instance moving under
  the pointer.
