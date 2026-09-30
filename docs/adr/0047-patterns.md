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
  a face repeated (P3-08), which needs those features first.

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
