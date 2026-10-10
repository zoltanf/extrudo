# ADR-0081: Components and simple assemblies

- **Status:** Proposed, 2026-10-10 (design only; slices in
  `.claude/handoff/p6-05-slices.md`)
- **Task:** P6-05 "Components and simple assemblies (multiple components,
  as-built joints), if demand warrants" (`docs/03-roadmap.md`; vision line in
  `docs/01-requirements.md` §1).
- **Builds on:** ADR-0003 (commands, undo, deterministic recipes), ADR-0005
  (topological naming), ADR-0024 (recompute engine), ADR-0030 (bodies, and its
  2026-10-09 ghost amendment), ADR-0034 (STL/3MF/STEP export, STEP colours
  through XDE), ADR-0044 (Move/Copy, Mirror), ADR-0047 (patterns), ADR-0048
  (Place on Bed, Print Info), ADR-0050 (lenient reading), ADR-0065 (timeline
  groups), ADR-0068 (the API), ADR-0069 (the CLI), ADR-0070 (scripts), ADR-0073
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
  of flattening them.

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

**Out of scope**, explicitly: bills of materials, part numbers and
properties; external or linked references to other designs; several
occurrences (linked instances) of one component; nested components (deferred,
§9); joints and motion (deferred, §4); motion studies, contact sets and
interference over a motion; per-component timelines (§6); a component colour
(bodies keep their own).

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

### 4. Joints: deferred

"As-built joints" are joints whose two frames are picked where the parts
already are, so the joint records a relationship (rigid, revolute about an
axis, slider along one) without moving anything; a solver-free "drive" would
then turn or slide one component in the view, and "keep this position" would
add a Move. **No joint is in P6-05.** The reasons: nothing a printer makes
depends on them; a driven position must either live outside the timeline (two
coordinate systems for one body, which §3 rejects) or become a Move feature
anyway; and interference along a motion needs repeated kernel booleans on
transformed copies. Revisit when people ask for print-in-place hinge checks.
The shape a later ADR should start from is recorded so nothing in this one
blocks it:

```ts
joints?: { id; name; type: 'rigid' | 'revolute' | 'slider';
           a: { component: ComponentId; frame: GeomRef };   // a face, edge or point
           b: { component: ComponentId; frame: GeomRef };
           min?: Expr; max?: Expr }[]
```

`J` stays reserved in the keymap (UI spec §shortcuts).

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
  (`followBodyNames`), a cycle.

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
    Component, Export Component…, Delete Component.
  - A **body row's menu** gains "Move to Component ▸" (each component, "New
    Component…", "No Component"); a body row **dragged** onto a component row
    joins it, onto the Bodies folder's own row leaves its component.
- **Creating components**: the Solid tab gets a group **Component** with one
  tile, **New Component** (`newComponent`, no default key): with bodies
  selected it makes a component of them ("Component1", the lowest free number),
  with none an empty one, and it activates the new component. The body menu's
  "New Component…" and the marking menu's list do the same.
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
two small things:

- **`origins`**: a feature that breaks a body into pieces reports which body
  each new piece came from (`FeatureOutput.origins`, from `splitSolids` and
  Split Body), and a recompute's result carries the map for every piece the
  walk made (`RecomputeResult.origins`, `ModelState.origins`). This is what
  rule 2 of §2 reads. Without it a piece would go wherever its feature was
  stamped, so splitting the lid while the box is active would put half the lid
  into the box.
- **STEP assemblies** in the facade (§7), staged like the colours: grouped
  exports go through XDE, everything else is unchanged. One OCCT rebuild.

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
  display states are deferred like body visibility.
- **The CLI**: `compute()` reports `components` (ID, name, live body IDs) and
  each body's `component`; `extrudo info` lists bodies under their components;
  `extrudo export --component <name>` (repeatable) chooses a component's bodies
  and `--flat` writes without the component structure.

### 10. What a Fusion import does with this

`docs/research/fusion-import.md` §5.3 flattens components because there were
none. With this ADR the importer keeps them: one Extrudo component per Fusion
occurrence, its features stamped with it, its placement a Move feature as that
section already plans, a second occurrence of one component a Move copy into a
component of its own (the importer's "<name> (2)"), joints dropped with a note
until §4 is revisited. Nested Fusion components flatten to one level, named
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
- **Joints in v1**: §4.

## Deferred

- Joints, drive and motion (§4); a limit/interference check along a motion.
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
- The recompute and naming are untouched apart from `origins`; one OCCT rebuild
  for STEP assemblies.
- The browser, the Export dialog and Print Info grow a level of grouping only
  when a design has components, so every existing screenshot baseline of a
  design without components stays as it is.
- New UI (a Solid tab group, browser rows, an isolation bar) lands before the
  owner's UI walk that P6-04 waits for; the walk should include it.

## Slices

Nine slices, in `.claude/handoff/p6-05-slices.md`: S1 core model ∥ S2 kernel
origins; S3 browser and membership; S4 active component and isolation ∥ S5
placement (Move/Copy/Place Component on Bed) ∥ S6 3MF and the Export dialog ∥
S7 STEP assemblies; S8 API, emitter and CLI; S9 Print Info, the guide page and
closing the task.
