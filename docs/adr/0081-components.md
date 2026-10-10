# ADR-0081: Components and simple assemblies

- **Status:** Accepted, 2026-10-10 (the owner: build it, starting with the
  slices without UI; joints planned now, not deferred, for print-in-place
  hinge checks). Slices in `docs/plans/p6-05-components.md`.
- **Task:** P6-05 "Components and simple assemblies (multiple components,
  as-built joints), if demand warrants" (`docs/03-roadmap.md`; vision line in
  `docs/01-requirements.md` §1).
- **Builds on:** ADR-0003 (commands, undo, deterministic recipes), ADR-0005
  (topological naming), ADR-0024 (recompute engine), ADR-0030 (bodies, and its
  2026-10-09 ghost amendment), ADR-0034 (STL/3MF/STEP export, STEP colours
  through XDE), ADR-0044 (Move/Copy, Mirror), ADR-0047 (patterns), ADR-0048
  (Place on Bed, Print Info), ADR-0050 (lenient reading), ADR-0033 (Fix
  References), ADR-0035 (measure), ADR-0040 (construction references), ADR-0062
  (print tolerance), ADR-0065 (timeline groups), ADR-0072 (an analysis as view
  state), ADR-0068 (the API), ADR-0069 (the CLI), ADR-0070 (scripts), ADR-0073
  (the emitter), ADR-0079 (tabs).

## Context

A design holds bodies (ADR-0030): each has an ID the kernel gives it
(`<feature>:<n>`), and `doc.bodies` stores the person's name, colour, opacity
and visibility for it. There is nothing above a body. People who print want
to keep the parts that belong together in one design (a box and its lid, a
hinge's two leaves, a lid and its seal printed in a second colour), to show,
hide, export and weigh each part as a unit, and to hand a slicer one object
per part. Fusion calls such a unit a component and adds joints, occurrences,
external references and motion studies on top; Fusion is a conceptual
reference only (no text, icons or behaviour copied wholesale).

The constraints that shape the decision:

- **Geometry is derived and recomputed from one timeline** (ADR-0024). Bodies,
  their IDs and their face names come out of the engine; anything that changes
  where a body is has to be a feature, or the kernel's names and positions
  disagree with what is drawn.
- **References are persistent names of bodies and faces** (ADR-0005), never
  of anything above them.
- **Older readers must open newer files** (ADR-0050): unknown keys are left
  out with a notice. A component model whose loss leaves the geometry intact
  degrades well; one that changes the geometry does not.
- **A future Fusion import flattens components** (`docs/research/fusion-import.md`
  §5.3: each occurrence's bodies placed by a Move feature, joints dropped with a
  note). Whatever we pick should let that importer keep the components instead
  of flattening them, and later its joints.
- **Print-in-place parts move after printing.** A hinge printed assembled has
  to keep its clearance over its whole swing; a check at the as-built position
  alone misses the leaf that hits the base at 70°.

## Decision

### 1. Scope: a component is a named set of bodies

A **component** is a named, user-made set of bodies in one design: a box and
its lid are two components, each holding the bodies that print as one part.
It has a name and a display state (shown, ghost, hidden), and nothing else.
Its uses, which are the whole of v1:

- **Organise**: the browser lists bodies under their component; a component
  shows, ghosts, hides, isolates, selects and exports as a unit.
- **Model in context**: an *active* component receives the bodies new
  features make, so a lid is modelled on top of the box it fits.
- **Place**: move, copy or lay a component on the bed as a rigid unit (through
  the existing Move and Place on Bed features, §3).
- **Print**: a 3MF file has one object per component with its bodies as parts,
  STEP one assembly product per component, Print Info a line per component.
- **Check a motion**: an as-built joint between two components (rigid,
  revolute, slider) can be posed in the view and checked for clearance over its
  range (§4).

**Out of scope**, explicitly: bills of materials, part numbers and
properties; external or linked references to other designs; several
occurrences (linked instances) of one component; nested components (deferred,
§9); a joint pose that drives stored geometry, contact sets, motion studies,
gears and couplings (deferred, §4); per-component timelines (§6); a component
colour (bodies keep their own).

### 2. The data model: a collection in the document, membership on the body

```ts
// packages/core/src/ids.ts
export const ComponentIdSchema = id.brand<'ComponentId'>();

// packages/core/src/schema.ts
export const ComponentSchema = z.strictObject({
  id: ComponentIdSchema,
  name: z.string().min(1).max(100),       // unique, case-insensitively
  visible: z.boolean(),                    // the same pair rule as BodyMeta
  ghost: z.boolean().optional(),           // `true` only, only with visible: false
});

DocumentSchema: components?: Component[]       // browser order; absent when none
BodyMetaSchema: component?: ComponentId        // absent: the body is in no component
FeatureSchema:  component?: ComponentId        // the component its *new* bodies join
```

- **Membership lives on the body's metadata** (`BodyMeta.component`), so a body
  is in at most one component by construction and moving it is one write. A
  body with no `component` is **loose**: it belongs to no component. **Bodies
  need not be in a component**; a design without `components` is exactly
  today's design, and the browser shows it unchanged.
- **Where a new body goes** is decided once, when the app first stores the
  body's metadata (`followBodyNames`, ADR-0030), by a pure rule in core,
  `componentOfBody(doc, id, origins)`:
  1. the body has stored metadata: its `component` (absent = loose). Stored
     metadata is the truth from then on;
  2. else the body is a **piece broken off another body** (a cut that splits a
     body, Split Body; the kernel reports this as `origins`, §8): the
     component of that body, by this same rule;
  3. else the `component` of the feature that made it (the body ID's
     `<feature>` part; for a Script's or plugin's generated feature,
     `scriptOfGenerated` gives the stored feature, ADR-0070);
  4. else loose.

  So "new bodies go into the active component" (the app stamps
  `Feature.component` with the active component when it inserts a feature,
  §6), and "pieces stay with the body they broke off". Copies (Move/Mirror/Scale
  copies, pattern bodies) are new bodies of their feature and follow rule 3:
  they go where the copying feature was made. The CLI and the API, which store
  no body metadata, read the same rule, so a component's bodies are the same in
  the app, the CLI and an export.
- **When bodies disappear** (an upstream edit, a Remove, a rollback) their
  metadata stays (ADR-0030), membership included, so a body that comes back is
  back in its component. A component lists only its **live** bodies; one with
  none stays, shown as empty ("No bodies"), until the person deletes it.
  Components are the person's objects and are never removed automatically.
- **Deleting a component** removes the record and clears every
  `BodyMeta.component` and `Feature.component` that names it, in one undo step;
  its bodies stay, loose. Removing the bodies themselves is the existing
  Remove feature.
- **Consistency** (schema `superRefine`): component IDs and names (folded to
  lower case) are unique, and every `BodyMeta.component` and `Feature.component`
  names an existing component.
- **File format:** a new `docs/file-format.md` **§4.7 `components[]`
  (Component)**; a `component` row in **§4.2** (BodyMeta) and in the feature
  fields table of **§6**; the additive-changes list in **§3** names the three
  keys; **§10** lists `ComponentId`. All three keys are optional: **no
  `formatVersion` bump and no migration**. An older reader leaves the three keys
  out with its notice (ADR-0050) and opens the design as loose bodies with
  **the same geometry**, because nothing in the recompute reads them. (The one
  exception is Place on Bed's new optional `carry` input, §3, which an older
  reader ignores with its "doesn't know the input" warning.)

### 3. Placement is the timeline's: no transform on the component

A component stores **no transform**. Where its bodies are is where the
timeline put them, and **moving a component is a Move feature over its live
bodies** (ADR-0044), so placement recomputes, takes expressions, undoes, and
every reference to a moved body's faces keeps resolving (a Move keeps body IDs
and face names).

- **Move Component** selects the component's live bodies and opens the Move
  dialog (pre-selection fills `bodies`). Nothing new in the kernel.
- **Copy Component** opens the Move dialog with the component's live bodies
  and `copy: true`; its OK inserts the Move, creates a component "<name> (2)"
  (the lowest free number) and stamps the Move with it, in **one undo step**,
  so the copies follow rule 3 into the new component. Cancel leaves nothing.
- **Patterns, Mirror, Scale** need nothing: selecting a component row selects
  its bodies, and every tool that takes bodies is pre-filled from the
  selection.
- **Place Component on Bed**: Place on Bed gains an optional input **`carry`**
  (`refsOf(['body'])`): bodies that take the same turn, spin and drop as the
  body of the (single) picked face. The context entry on a flat face of a body
  that is in a component fills `face` and `carry` = the component's other live
  bodies. `carry` with more than one face is an error ("Pick one face to carry
  other bodies with it."), a carried body that is also a face's body is an
  error, and a carried body that ends below the bed warns like the face's body
  does.
- **Print layout versus assembled position**: one timeline holds one position.
  The documented recipe for "assembled to check the fit, laid out to print" is
  a timeline group "Print layout" (ADR-0065) of Move and Place on Bed features
  at the end: suppress it to see the assembly, unsuppress it to print. An
  automatic plate arrangement is deferred (§9).

### 4. Joints: as-built, stored; the pose is a look; a clearance check along the motion

People who print ask for joints for one reason: a **print-in-place** part (a
hinge printed assembled, a slide in its rail) has to keep its clearance over
the whole motion, and the person wants to swing the leaf about its pin, or push
the carriage along its rail, and see whether it collides or how tight it gets
**before** printing. v1 is the smallest thing that answers that: joints are
stored records, the pose is view state, and a kernel check samples the motion.

**As-built joints.** A joint is made where the parts already are: the person
picks a **frame on each of two components** and nothing moves. Three types:

- **rigid**: the two components move as one. Its only use in v1 is to carry:
  when a revolute or slider joint moves component A, every component joined to
  A by rigid joints (a walk over rigid joints that never passes through the
  joint's other side) moves with it, so a leaf made of two components still
  swings as one.
- **revolute**: side `a` turns about an axis, from `min` to `max` (angles; 0 is
  the as-built position, positive right-handed about the axis, `flip` reverses
  it). Without limits it is a whole turn.
- **slider**: side `a` moves along a direction, from `min` to `max` (lengths; 0
  is as built). A slider needs both limits to be posed or checked ("Give
  Slide1 a travel to check it.").

Side **`a` moves, side `b` stays**: the axis or direction is read from `b`'s
frame and `a`'s frame must agree with it as built — a revolute's two axes
collinear within 0.05 mm and 0.5°, a slider's two directions parallel within
0.5° (their offset doesn't matter: a carriage's edge runs beside the rail's).
A frame that disagrees is the joint's **warning** ("Hinge's axes are 0.4 mm
apart: the parts aren't where the joint was made. Suppress Print layout to
check it."), and while it disagrees the pose and the check are refused with the
same sentence: a joint measured on parts that a print-layout Move (§3) has laid
out apart would report nonsense.

**What a joint does in v1** — three things, nothing more:

1. **It is stored** (`doc.joints[]`, below), named, edited, deleted and undone
   like any record, and its frames resolve through the naming service at every
   recompute, so a lost frame shows up and Fix References repairs it.
2. **The pose is view state** (`viewport.jointPose: { joint: JointId; value:
   number } | undefined`, degrees or mm, not saved, not undoable, recomputing
   nothing). Dragging the joint's handle in the view or its slider in the
   Joint panel draws the moving components' meshes through a matrix
   (`rotation`/`translation` of `kernel/src/features/matrix.ts`, re-exported for
   the app), clamped to the limits. Bodies drawn posed are **not pickable**,
   and starting any tool, dialog or sketch resets the pose to 0, so nothing is
   ever modelled against a posed body; the overhang and wall-thickness shading
   stay as-built classifications drawn on the moved mesh.
3. **A clearance check along the motion** (on demand: the Joint panel's
   **Check clearance**). It samples the joint's range, measures at each sample
   the smallest distance between the moving bodies and every other live body
   (display state ignored: a clearance is a property of the design, not the
   view; a ghost or hidden base still counts), finds the tightest point and any
   collision, and reports "Tightest gap 0.18 mm at 72°" or "Collides from
   64.2° to 81.0° (3.2 mm³ at 72°)" against a **minimum gap** (view state like
   the wall-thickness minimum: an `<ExpressionInput>`, default the document's
   `tolerance` parameter when it has one (ADR-0062), else 0.2 mm). The tightest
   pair of points gets a leader in the view and colliding faces are tinted
   `--x-error`; a result's "Show" poses the joint there.

**Where the check runs: the kernel worker**, on the shapes of the last finished
recompute (`latestBody`, as `inspect` and export do, ADR-0034/0035), through a
new `KernelApi.checkJoint(request, onProgress)` and existing `Kernel` calls
only, so **no facade change**:

- `Kernel.transform(shape, matrix)` places a moving body at a sample (one copy
  per moving body per sample, released before the next);
- `Kernel.distance(a, b)` / `closestPoints(a, b)` for the gap (0 where they
  touch or overlap), and **`Kernel.minGap`** where either body is a mesh
  (ADR-0066 §4);
- where the gap is 0, **`Kernel.common(a, b)`** then `Kernel.properties(…)`'s
  volume tells touching (volume ≤ 1e-6 mm³) from interference, and the common's
  history names the input faces that collide (the transform's history maps
  sub-shapes one to one, so a face index of the moved copy is the as-built
  body's face index; the app gets topology items `{ body, index }`).

**How it stays fast:**

- **Box filter first**: a pair is measured only where the moved body's box,
  grown by `JOINT_SEARCH` (5 mm or twice the minimum gap, whichever is larger),
  meets the other body's box; pairs that never meet are skipped at that sample
  and can't be the tightest.
- **A capped coarse pass**: `JOINT_SAMPLES` evenly spaced samples including 0
  and both limits — 36 for a revolute (10° over a whole turn), 25 for a slider
  — capped at `MAX_JOINT_SAMPLES` = 72.
- **Refinement where it matters**: a golden-section search on the gap between
  the neighbours of the tightest coarse sample, and a bisection on each
  boundary between a free and a colliding sample (to report where a collision
  starts and ends), each stopped at 0.1° or 0.01 mm or after 8 evaluations;
  at most `MAX_JOINT_EVALS` = 120 evaluations in all, `common` at most 12 times
  (the colliding samples with the largest overlap first).
- **Cancellable**: it yields between evaluations like the engine; a newer check,
  Esc, a closed panel or a new recompute cancels it, and a document change after
  it marks the result stale (`stale`, "The design changed: check again").
- Budget: a print-in-place hinge of two components of about 100 faces each
  checks a whole turn in **under 2 s** (measured in J3 with `BENCH=1`; if the
  transformed copies dominate, a facade `distance` under a `TopLoc_Location`
  is the recorded next step, not part of v1).

**Data shape** (`docs/file-format.md` **§4.8 `joints[]` (Joint)** with
**§4.8.1 JointFrame**; §3's additive list gains `joints`; §10 `JointId`):

```ts
// packages/core/src/ids.ts
export const JointIdSchema = id.brand<'JointId'>();

// packages/core/src/schema.ts
export const JointFrameSchema = z.strictObject({
  component: ComponentIdSchema,   // the side's component (metadata, read by the app)
  ref: GeomRefSchema,             // the picked geometry, by its persistent name
});
export const JointSchema = z.strictObject({
  id: JointIdSchema,
  name: z.string().min(1).max(100),          // unique, case-insensitively
  type: z.enum(['rigid', 'revolute', 'slider']),
  a: JointFrameSchema,                        // the side that moves
  b: JointFrameSchema,                        // the side that stays
  min: ExprInputSchema.optional(),            // angle (revolute) or length (slider)
  max: ExprInputSchema.optional(),
  flip: z.literal(true).optional(),
  suppressed: z.literal(true).optional(),     // kept, not resolved, not posed or checked
});
DocumentSchema: joints?: Joint[]              // browser order; absent when none
```

- **Frames are existing reference kinds**, picked like any dialog field and
  stored as `GeomRef`s with fingerprints: a revolute takes a **cylindrical or
  conical face** (its axis, from `surfaceGeometry`), a **circular edge** (its
  centre and normal, from `edgeGeometry`), a straight edge, an origin or
  construction axis, or a sketch line; a slider takes a straight edge, a
  **flat face** (its normal), an axis or a sketch line; a rigid joint takes any
  face, edge or vertex, or a body. **Components still never enter a
  reference** (§5): `component` beside the ref is plain metadata, which the app
  checks (a frame whose body is no longer in that component is the joint's
  warning, "Hinge's moving frame isn't on Leaf any more").
- **Consistency** (`superRefine`): IDs and names unique, both components exist
  and differ, `min`/`max` only for revolute and slider with the unit the type
  takes. `removeComponent` also removes the joints that name it, in its one
  step ("Deleted Leaf and 1 joint."). Joint limits are expression owners
  (`joint`, never named) in the parameter graph, so deleting a parameter they
  use is refused as for a feature input.
- **Surviving edits: the naming service, at the marker.** After the walk, the
  engine resolves every unsuppressed joint's two frames with the same resolver
  features use (`ctx.resolve`, ADR-0005: exact name, related name, fingerprint
  with a warning, else lost) in an evaluation context **at the marker**, and
  reads the axis or direction with the existing `lineOf`/`planeOf`
  (ADR-0040) extended by the face-axis and circular-edge cases above. The
  result is `RecomputeResult.joints` → `ModelState.joints: Record<JointId,
  JointReport>` (`{ status: 'ok' | 'warning' | 'error' | 'inactive'; message?;
  refs?; axis?: { origin; direction }; offset? }`). It costs a resolve and a
  geometry query per frame, is not cached and is no part of any feature's cache
  key, so editing a joint recomputes no feature. A frame on a feature the marker
  has rolled back is `inactive`, not an error.
- **Lost frames: Fix References.** A frame the resolver can't find gives the
  joint `error` with its `refs` (as `FeatureStatus.refs`, ADR-0033); the
  browser row shows ✕, the row's menu has **Fix References** (the Joint dialog
  opened with `{ fix }`) and **Keep Closest Match**, and core's
  `replaceReferences` learns to rewrite joint frames too. The ghost of the lost
  geometry is drawn from the fingerprint as for features.
- **No `formatVersion` bump**: an older reader drops `joints` with its notice
  (ADR-0050) and the geometry is unchanged, because joints move nothing that
  is stored.

**Deferred** (a later ADR): a pose that drives the stored geometry (a joint
value that becomes a Move, "keep this position"); joint limits used to move
bodies or to stop a drag at contact; contact sets; motion studies and
animation; several joints posed at once (a chain, a four-bar); cylindrical,
pin-slot, planar and ball joints; gears and couplings between joints; joints
inside a nested component.

`J` is the Joint tool's key (UI spec §shortcuts, where it was reserved).

### 5. Topological naming: components never enter a reference

A `GeomRef` names a body or a face, edge or vertex by its persistent name,
**never a component**, and the naming grammar does not change. So:

- moving a body between components, renaming or deleting a component changes
  **no reference** and recomputes nothing;
- a sketch on another component's face, a Combine whose target and tools are
  in different components, a hole on a face of the active component's
  neighbour: all are ordinary references and resolve as today. A Combine's
  result keeps the target's ID, so it stays in the target's component; a used
  tool body disappears and keeps its (now unlisted) metadata;
- moving a component is a Move feature, which keeps body IDs and face names
  (ADR-0044); references *after* the Move see the moved faces, references
  *before* it see the faces where they were, exactly as for any body today;
- a **`component` reference kind is rejected**: the engine would need
  membership at evaluation time, which is metadata stored after the recompute
  (`followBodyNames`), a cycle;
- a **joint's frames** are ordinary references too (§4): the component stored
  beside each frame is metadata the app checks, never part of the reference.

### 6. UI

- **Browser**: no separate folder. The **Bodies folder** lists component rows
  first (in `components` order), each a nested folder with its count badge, eye
  and menu, holding its live bodies; loose bodies follow at the folder's top
  level. With no components the folder is unchanged.
  - A **component row's click selects all its live bodies** (session selection
    of kind `body`), Shift-click adds them.
  - Its **eye cycles shown → ghost → hidden** like a body's. A body is drawn
    hidden when its component is hidden; as a ghost when its component is a
    ghost and the body itself is not hidden; otherwise as the body says
    (`effectiveBodyDisplay`). The body keeps its own state underneath, so
    showing the component again restores it.
  - Its **menu**: Activate, Rename (F2), Isolate, Move Component, Copy
    Component, Export Component…, New Joint…, Delete Component.
  - After its bodies it lists the **joints whose moving side** (`a`) it is,
    one row each with the type's icon, the name, the status (✕/⚠ with the
    message in the tooltip) and a menu: Edit, Rename (F2), Pose…, Check
    Clearance, Suppress, Fix References / Keep Closest Match (when lost),
    Delete Joint. A double-click edits.
  - A **body row's menu** gains "Move to Component ▸" (each component, "New
    Component…", "No Component"); a body row **dragged** onto a component row
    joins it, onto the Bodies folder's own row leaves its component.
- **Creating components**: the Solid tab gets a group **Component** with one
  tile, **New Component** (`newComponent`, no default key): with bodies
  selected it makes a component of them ("Component1", the lowest free number),
  with none an empty one, and it activates the new component. The body menu's
  "New Component…" and the marking menu's list do the same. The same group
  has **Joint** (`joint`, key `J`), which opens the Joint dialog: Type, the
  two frame fields "Moving part" and "Fixed part" (a pick on a body outside
  every component is refused with "Put this body in a component first."), the
  limits as `<ExpressionInput>`s and Flip; OK adds the joint in one step.
- **The Joint panel** (Pose… or Check Clearance on a joint row, or Ctrl+K)
  holds the pose — a slider and an `<ExpressionInput>` for the angle or travel,
  plus the handle in the view (an arc about the axis or an arrow along the
  direction) — and the clearance check (Minimum gap, Check clearance, the
  result lines with Show). Closing it resets the pose. The browser's
  Analysis folder has a row for a check result while one exists.
- **Activating** a component is **session state** (`SessionState.activeComponent`,
  not stored, not undoable; none when a project opens). The active row carries
  a filled marker and the status bar says "Active: Lid"; "Activate" on another
  row or **Deactivate** (the row's menu, the status bar item) changes it. Every
  feature the app inserts while a component is active is stamped
  `component: <active>` (sketches too, harmlessly). Editing a feature never
  changes its stamp. Nothing is dimmed: the other components stay pickable,
  which is what modelling in context needs.
- **Where new bodies go**: §2's rule. Without an active component they are
  loose, as today.
- **The timeline stays one timeline**: one document, one recompute order, and
  features of one component routinely refer to another's faces. A chip whose
  feature has a `component` names it in its tooltip ("In Lid"). A per-component
  filter is deferred.
- **Isolation** is session state (`SessionState.isolatedComponent`): the view
  draws and picks only that component's bodies, the browser's other rows are
  dimmed, and a bar at the top of the view says "Showing Lid only" with **Exit
  isolation**. It ends when the component is deleted or Exit is pressed;
  activating another component keeps it.
- **Session state follows the document**: when an undo, a version restore or a
  delete removes the active or isolated component, the session clears it.

### 7. Export and print

- **3MF**: with the Export dialog's **"Keep components together"** on (the
  default; remembered in the `export.model` preference), each component among
  the chosen bodies is **one build item**, an `<object type="model">` holding a
  `<components>` list of its bodies' mesh objects (each still named and
  coloured); loose bodies stay one build item each, as today. Slicers read such
  an object as one part made of several (each part can take its own filament),
  which is what a component is for. Off, every body is a build item as today.
  `read3mf` learns to expand `<components>` (with their `transform`s) so a
  grouped file imports back as bodies.
- **STEP**: with the same option on, each component is an **assembly product**
  named after it whose children are its bodies' part products (named and
  coloured as today), through XDE (`XCAFDoc_ShapeTool::NewShape` +
  `AddComponent` at identity); loose bodies stay top-level products. A file
  with no component involved is byte-identical to today's (the existing
  `writeStep` paths). Importing STEP assemblies *as* components is deferred
  (§9), and is the door a Fusion import (route A, the person's STEP export)
  walks through.
- **STL** holds no structure: the bodies are concatenated as today; **Export
  Component…** opens the dialog with that component's bodies chosen and the file
  named "<design> - <component>".
- The Export dialog's body list is grouped under component headings, a
  heading's checkbox choosing all of its bodies.
- **Print Info** keeps its totals and adds a row per component (weight,
  filament, cost of its counted bodies) when the design has components.

### 8. The engine: metadata only, plus where pieces came from

Components are **metadata over bodies**: the recompute, the cache keys, the
naming and the evaluators do not read them, so creating, renaming, moving a body
between and showing or hiding components recompute nothing. The kernel gains
three small things:

- **`origins`**: a feature that breaks a body into pieces reports which body
  each new piece came from (`FeatureOutput.origins`, from `splitSolids` and
  Split Body), and a recompute's result carries the map for every piece the
  walk made (`RecomputeResult.origins`, `ModelState.origins`). This is what
  rule 2 of §2 reads. Without it a piece would go wherever its feature was
  stamped, so splitting the lid while the box is active would put half the lid
  into the box.
- **STEP assemblies** in the facade (§7), staged like the colours: grouped
  exports go through XDE, everything else is unchanged. One OCCT rebuild.

- **Joints** (§4): after the walk the engine resolves each joint's frames at
  the marker and reports `RecomputeResult.joints` (status, lost `refs`, the
  axis or direction); no feature's cache key includes a joint. The clearance
  check is `KernelApi.checkJoint` on the last finished recompute's shapes,
  through `transform`, `distance`/`closestPoints`, `minGap`, `common` and
  `properties`: no facade call.

Place on Bed's `carry` is an evaluator change; there is no new facade call.

### 9. API, emitter and CLI

- **`@extrudo/api`**: `d.component(name, options?)` and `d.component(name, build)`
  return a `ComponentHandle` (`id`, `name`, `add(...bodies)`, `bodies()` of
  stored members); inside `build`, every feature added defaults to that
  component; `FeatureOptions.component` (and `SketchOptions.component`) stamps
  one explicitly. IDs `cmp1`, `cmp2`… from the counter (ADR-0068 §2). A
  `Design` restricted to a Script or plugin refuses `component` ("A script can
  only add features: component") and the `component` option: generated
  features follow their Script's own stamp (rule 3).
- **The emitter** (ADR-0073) writes `const lid = design.component('Lid');` for
  each component before the features, `{ component: lid }` on every stamped
  feature, and `lid.add(design.ref('body', …))` for each stored membership the
  rule would not give (a body moved into a component by hand). Component
  display states are deferred like body visibility. Joints follow the
  features: `const hinge = design.joint('Hinge', { type: 'revolute', a: {
  component: leaf, frame: pin1.face('side:wall') }, b: { … }, min: '0 deg',
  max: '180 deg' });`.
- **Joints in the API**: `d.joint(name, options)` returns a `JointHandle`
  (IDs `jnt1`…); frames take the same references as feature inputs, components
  a `ComponentHandle` or ID; a restricted `Design` refuses it like
  `component`.
- **The CLI**: `compute()` reports `components` (ID, name, live body IDs) and
  each body's `component`; `extrudo info` lists bodies under their components;
  `extrudo export --component <name>` (repeatable) chooses a component's bodies
  and `--flat` writes without the component structure; `extrudo check
  --joints [--min-gap 0.3mm]` runs every joint's clearance check and exits 2
  when one collides or is under the minimum, so a print-in-place design can be
  checked in a project's CI.

### 10. What a Fusion import does with this

`docs/research/fusion-import.md` §5.3 flattens components because there were
none. With this ADR the importer keeps them: one Extrudo component per Fusion
occurrence, its features stamped with it, its placement a Move feature as that
section already plans, a second occurrence of one component a Move copy into a
component of its own (the importer's "<name> (2)"). Fusion's rigid, revolute
and slider joints between two imported occurrences can become §4's joints
once the importer can name their frames' geometry (a later task); every other
joint type is dropped with a note. Nested Fusion components flatten to one level, named
"Parent › Child".

## Alternatives considered and rejected

- **Components as timeline features** ("Create Component" with body refs):
  membership is not geometry, but a feature puts it in the recompute, the cache
  key and the ordering rules; a body made after the feature can't join without
  editing it; renaming would recompute. Rejected for §2's metadata.
- **A member list on the component** (`bodies: BodyId[]`): a body could be
  listed twice, every move is two writes, and bodies with no metadata yet (CLI,
  API) need a rule anyway. Rejected for `BodyMeta.component`.
- **Every body in a component** (Fusion's root component as a real record):
  forces a migration onto every existing design and gains nothing for a
  one-part design; "loose" is the root.
- **A stored transform per component** (Fusion's occurrence transform), applied
  after the timeline: every body would have a modelling position and a placed
  position, and picking, sketches on faces, measure, section, the print aids
  and export would each have to apply it, while face names and kernel positions
  disagree with the view. Rejected for §3.
- **Placement as view state**: not saved, not exported, not parametric.
- **The active component in the document**: activating is not a design change
  and would fill the undo history; it is session state like the selection.
- **Per-component timelines**: one recompute order is what lets features refer
  across components; two timelines would need cross-timeline dependencies.
- **Copies follow the original's component** (an origin for copies too): a
  copy made while another component is active then lands somewhere the person
  didn't choose, and Copy Component needs the opposite; copies follow their
  feature (rule 3), only pieces follow their source.
- **Merging each component into one mesh for 3MF/STL**: loses per-body colours
  and parts, and a union of touching bodies can be non-manifold.
- **A `component` reference kind**: §5.
- **Joints deferred to a later phase** (this ADR's first draft): the reason
  people ask for joints is the print-in-place check, which needs nothing the
  draft feared (no driven geometry, no solver); the owner asked for it now.
- **A stored pose** (a joint value saved in the document): either the bodies
  get a second position outside the timeline, which §3 rejects, or the value
  becomes a Move feature, which is the deferred "keep this position". A pose
  for a look needs neither.
- **Joints as timeline features** (like construction geometry, ADR-0040): a
  joint changes no geometry and relates the parts where they end up, so its
  place is the marker, not a timeline position that later Moves would make
  stale; as a feature it would also order against features and take part in
  the cache.
- **The check in the UI thread on the display meshes** (three-mesh-bvh, as the
  wall-thickness rays): fast, but a display mesh's deflection (0.05 mm and up
  on curved faces) is a quarter of a 0.2 mm clearance, and a pin in its hole is
  exactly that case. The B-rep distance is exact; the box filter and the
  sample cap keep it fast enough.
- **A swept volume of the moving part** (one boolean against the motion's
  envelope): OCCT has no robust sweep of a solid along a rotation, and an
  envelope says "collides" without saying where or at what angle.

## Deferred

- What §4 defers: a pose that drives stored geometry ("keep this position" as
  a Move), limits that stop bodies or a drag at contact, contact sets, motion
  studies and animation, several joints posed at once, joint types beyond
  rigid/revolute/slider, gears and couplings.
- Nested components (`Component.parent?: ComponentId`, additive later).
- STEP import that turns a file's assemblies into components (`ImportReport`
  gains `components: { name; bodies }[]`, `followBodyNames` creates them when it
  first names the bodies).
- Automatic arrangement of components on the print bed.
- A component colour that bodies without their own inherit.
- A timeline filter per component; reordering components in the browser
  (`components` order is creation order until then).
- Linked occurrences of one component.

## Consequences

- No format version bump, no migration; older readers keep the geometry.
- The recompute and naming are untouched apart from `origins` and the joints'
  frame pass after the walk; one OCCT rebuild for STEP assemblies, none for
  joints (the clearance check uses existing facade calls).
- The browser, the Export dialog and Print Info grow a level of grouping only
  when a design has components, so every existing screenshot baseline of a
  design without components stays as it is.
- New UI (a Solid tab group, browser rows, an isolation bar, the Joint dialog
  and panel) lands before the owner's UI walk that P6-04 waits for; the walk
  should include it.
- A posed body is drawn where it isn't: picking it is off and any tool resets
  the pose, so a pose can never leak into a reference.

## Results

### J3: the clearance check (2026-10-10)

Measured on the Ubuntu machine (4 cores), one kernel in Node, `BENCH=1 pnpm
vitest run packages/kernel/src/joints/check-bench` (median of three):

| Design | Faces (moving + other) | Range | Poses | Time |
|---|---|---|---|---|
| The hinge fixture | 11 + 11 | −180…180° | 67 | 1.55 s |
| The hinge with 22 ribs fused across each plate | 137 + 129 | −180…180° | 67 | 16.3 s |

In the browser (`e2e/joints.spec.ts`, two Playwright workers, the worker's
WASM): the fixture's 0…90° check takes 2.5–3.0 s from the menu click to the
result, 0…180° 1.9–2.6 s. A collision's start lands within 0.02° of the angle
worked out from the fixture's numbers (140.06° against 180° − 2·atan(2/5.5) =
140.05°).

**The 2 s budget holds for the fixture, not for 100-face bodies.** The time is
in `BRepExtrema_DistShapeShape`, not in the transformed copies: at 130 faces a
side one `closestPoints` takes 340–440 ms a pose where the bodies are apart
(11–45 ms where they touch, as it stops at the first contact), `transform`
3.5 ms. Two ways round it were measured and rejected:

- **Face pairs from TypeScript**, nearest boxes first, stopping once no box can
  be nearer than the best gap: slower, because a moved face's box is loose and
  boxes of a body's faces overlap, so most pairs stay in (3,622 face distances
  at 26 ms each for one whole turn of a drilled 99-face hinge, 98 s against
  54 s for whole bodies).
- **manifold-3d's `minGap` on meshes** of the bodies (meshed once, moved by
  manifold's transform): 70–170 ms a pose at 0.01 and 0.002 mm deflection, no
  faster than OCCT at that size and only as exact as the mesh.

The recorded next step is a facade call rather than the transformed copy the
Decision expected: one that measures many poses of the same pair, keeping
OCCT's per-face bounding volumes and extrema of the fixed body between calls
(or `BRepExtrema_ShapeProximity`'s BVH as a first pass), so a pose costs the
faces near the gap only. Until then a whole turn of a 130-face hinge takes
about 16 s, with its progress shown and Cancel.

**`common` only where it decides something.** Telling touching from
interference costs a boolean (60–300 ms at 130 faces), so the check runs one at
each contact run's middle, at its ends only when the middle merely touches,
and bisects a collision's boundary next to a free pose on the gap alone (where
contact starts is where the collision does); a boundary between touching and
colliding poses still takes a `common` per step while the budget of 12 lasts.

**A flat minimum is reported at the pose nearest as built** (`tightest.over`
holds the stretch), so its leader can be drawn before the pose preview exists
and `data-joint-check` reads `at=0` for the fixture.

**The fixture was wrong as built.** J1's base plate (`y` −24…−4) reached into
the leaf's Ø10 knuckle (to `y` −5), so the hinge collided at 0°. Its plate is
now the leaf's mirror (`y` −25.5…−5.5) with two bridges joining it to its
knuckles, 0.5 mm clear of everything on the leaf.

## Slices

Twelve slices, in `docs/plans/p6-05-components.md`: S1 core model ∥ S2 kernel
origins ∥ S7 STEP assemblies (the three without UI, first); S3 browser and
membership; S4 active component and isolation ∥ S5 placement (Move/Copy/Place
Component on Bed) ∥ S6 3MF and the Export dialog; J1 the joint model and
dialog; J2 the pose preview ∥ J3 the clearance check; S8 API, emitter and CLI
(after the joints, so it covers them); S9 Print Info, the guide page and closing
the task.
