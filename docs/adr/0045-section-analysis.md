# ADR-0045: Section analysis

- **Status:** Accepted, 2026-09-30
- **Task:** P3-09 (section analysis; FR-VP-06). Code: the app's
  `apps/web/src/section/` (`clip.ts` maths, `useSection.ts` the tool's
  logic, `SectionPanel.tsx`, `SectionOverlay.tsx` the arrow), the view's
  `viewport/SectionCap.tsx` and the clipping in `viewport/Bodies.tsx` /
  `Preview.tsx` / `Viewport.tsx`, `SectionState` in the viewport store
  (`viewport/store.ts`), picking in `selection/pick.ts` (`PickScene.clip`),
  the Analysis folder in `shell/BrowserPanel.tsx`, "Section Here" in
  `shell/contextEntries.tsx`, the tool in `shell/tools.ts` (Solid ›
  Inspect, `Shift+S` in `commands/keymap.ts`). **No kernel or facade
  change, no schema change.**
- **Builds on:** ADR-0008 (the viewport store, the camera), ADR-0026
  (bodies as meshes, BVH picking), ADR-0027 (manipulators and the panel
  column; `draggedExpression`), ADR-0031/0040 (plane picking: origin
  planes, flat faces, construction planes), ADR-0035 (a session tool with
  its own panel), ADR-0042 (context entries).

## Context

FR-VP-06 asks for "a live clipping plane with cap fill": look inside a
part without changing it. It is a picture of the model, not geometry, so
it belongs in the viewport, not in the kernel; but three parts of the app
have to agree on it: the drawing (faces, edges, silhouettes clipped, the
cut filled), the picking (what is cut away can't be clicked, and the fill
hides what is behind it) and the state (where the plane is, and for how
long).

## Decision

1. **The section is view state, not document state.** `viewport.section`
   (`SectionState`: `plane`, `offset`, `flip`, `on`) sits in the viewport
   store next to the camera. It isn't in the `.extrudo` file (so
   `docs/file-format.md` is unchanged), isn't undoable and isn't a
   preference; it lasts while the project is open and outlives every
   recompute, dialog and undo. That fits what it is: an aid for looking,
   which shouldn't make a document "changed", enter the undo history or
   travel to someone who opens the file. Turning it off keeps the rest
   (`on: false`), so it comes back as it was.
   The user reaches it in three places: the tool's panel, a row in a new
   browser folder "Analysis" (eye = clip or not, click = open the panel,
   menu = Edit / Hide / Remove; the folder exists only while there is a
   section, so nothing changes in the browser otherwise) and the panel's
   "Show section" checkbox.
2. **The plane is picked, the offset is an expression.** `plane` is a
   `GeomRef`: an origin plane (`origin:xy`), a construction plane (its
   feature's ID, P3-05) or a flat face (a persistent reference from
   `KernelApi.reference`, which needs a `plane` fingerprint). Every render
   resolves it against the current model (`sectionFrame`: `planeFrame`
   with the kernel's construction reports, or `faceFrame` of the current
   mesh by face ID, else the reference's fingerprint), so a section on a
   face follows the face when the model is edited, and one on a plane that
   is gone stops clipping and says so in the panel. `offset` is an
   expression evaluated with the document's parameters (`<ExpressionInput>`
   in the panel; an offset that stops evaluating keeps its last value).
   The plane moves along its own normal; **the side the normal points to is
   removed**, and Flip turns that round without moving the cut. A new
   section starts through the middle of what is shown (`middleOffset`), so
   it shows something at once: the XY plane cuts a part 60 mm tall at
   30 mm, a face on its top goes 30 mm down.
3. **Picking a plane, a face, or "Section Here".** The tool's panel opens
   in a "choosing" state (no section yet, or "Change"): the view picks
   origin planes, construction planes and flat faces exactly as Create
   Sketch does (`PlanePicker.faces`), and the panel lists the same planes
   as buttons. A flat face selected beforehand takes the section at once
   (like Create Sketch): Shift+S, the toolbar or the context list's
   "Section Here" (`sectionHere`, which runs the `section` command).
   With no face selected the command toggles the panel. Remove ends the
   section and closes the panel.
4. **The arrow** is `SectionOverlay`, an SVG overlay drawn only while the
   panel is open (the tool's own, next to `MeasureOverlay` and
   `DialogOverlay`, no permanent global overlay): a handle on the plane
   over the middle of the model and an arrowhead towards the removed
   side. Dragging the handle uses the dialogs' helpers
   (`distanceAlong`, `draggedExpression`), so it snaps like their arrows
   and writes the offset expression. Along the view direction the arrow
   collapses; the field still works.
5. **Clipping is a material property.** three.js local clipping planes
   (`renderer.localClippingEnabled`, set only while a section is on) on
   the bodies' face materials, the edge and silhouette `LineMaterial`s,
   the edge highlights and the dialogs' preview shapes; the plane is
   `(-normal, normal·origin)` because three keeps the positive side.
   The grid, the origin, sketches and construction geometry are drawn
   unclipped: they are the frame the model is in. Vertex dots aren't
   clipped (their shader has no clipping chunks; a selected vertex that
   was clipped away after selecting it still shows).
6. **The cap is a stencil cap** (`SectionCap`), per body, from the
   classic method: the body's faces, clipped, go into the stencil buffer
   with back faces counting up and front faces counting down (no colour,
   no depth), which leaves a non-zero count exactly where the view ray is
   inside the solid at the plane; a quad in the plane, sized to the body's
   bounding sphere, then paints where the stencil isn't zero and clears it
   for the next body. The quad is opaque and depth-tested (faces on the
   kept side hide it, faces in the plane lose to it), lit by nothing: a
   flat fill with diagonal hatch lines in screen space (constant weight
   and pitch, 9 px, whatever the zoom). Colours are tokens, not new
   ones: the body's own colour pulled 55 % towards `--x-cat-inspect`
   (the Inspect category's teal, which both themes define) with the hatch
   in `--x-ink` at 45 % (dark lines on the light theme, light lines on
   dark; `capColors`). Each body gets its own three render orders so one
   body's passes don't mix with another's. The canvas context now asks for
   a stencil buffer (`gl={{ stencil: true }}`; three's default since r163
   is none), which only shows when a section is on. It works in headless
   Chromium on SwiftShader (the e2e spec and its screenshots).
   Wireframe style draws no faces and so no cap.
7. **Picking follows what is drawn** (`PickScene.clip`, `selection/pick.ts`):
   - A face hit, a vertex or an edge point on the clipped side is skipped
     (a face partly cut away can still be picked where it is kept; a face
     lying in the plane stays, `CLIP_EPS` = 1 nm).
   - The cap hides what is behind it: a ray that starts on the clipped side
     and crosses the plane inside a body (the first face it meets past the
     plane is seen from the inside: its mesh normal faces along the ray)
     gets a cap depth, and everything behind that depth is *occluded* like
     something behind a face (listed as "(hidden)" by "Select other…", never
     taken by a click or hover). The cap itself isn't pickable.
   - Edge and vertex occlusion tests (`hidden`) ignore cut-away faces and
     see the cap; box selection skips faces, edges and vertices that are
     wholly cut away.
   The rule "a ray from the clipped side that meets the plane inside the
   solid" needs no cap geometry and no stencil, so it runs in unit tests.
8. **Model mode only.** A sketch is drawn without the section (the plane it
   lies on may be cut away, and the section is a view of the model); the
   section is back when the sketch is finished. The panel closes with the
   mode; a feature dialog closes it too (both float in the same corner).
9. **Testing hooks:** the Viewport region's `data-section` ("origin:xy
   offset=30 mm on", "… flipped off", "face:<id> …"; absent with no section)
   and `data-section-clip` (the plane in the world while it clips,
   "0,0,30:0,0,1": origin, then the unit normal of the removed side); the
   panel is the region "Section Analysis" with `data-section-state`
   (`choosing`, `lost`, `on`, `off`); the arrow's handle is
   `[data-section-handle]` with `cx`/`cy`.

## Consequences

- No document, kernel or file-format change; the Wall bracket's baselines
  don't move while no section exists (the stencil bit in the context is the
  only difference; CI's shell, sketch and home screenshots confirm it).
- A section on a face follows the face by its reference, a section on an
  origin or construction plane by its ID; neither is stored, so reloading
  the page (or reopening the project) starts without a section.
- The cap is the section of the *display mesh*: a body with a mesh that
  isn't closed (the kernel meshes closed solids) would leak the fill at the
  hole; a cap can't show a hollow that isn't modelled. Big meshes cost two
  more passes per body while a section is on (the same geometry, no
  fragments shaded).
- Faces at the plane exactly (`CLIP_EPS`) stay drawn and pickable; the cap
  wins the depth test over them by a polygon offset.

## Rejected

- **Storing the section in the document** (a feature or an "Analysis"
  entry, as Fusion keeps analyses in the browser). It would need a schema
  change, a migration, `docs/file-format.md`, undo steps for dragging an
  arrow and a recompute path that computes nothing; and a saved section
  would make every file open half-cut. Nothing here needs it; the day it
  does (saved analyses with named views, P4), it can be added as an
  optional key.
- **Cutting the geometry in the kernel** (a boolean with a half-space, or
  a section face per body from OCCT). It makes a real cap with exact
  edges and gives cut faces to measure, but it costs a facade change (a
  15-minute OCCT build), a kernel call per drag step and a second copy of
  every body's mesh. The task is a live view; the stencil cap is exact
  enough (the plane's own pixels) and free per frame. Measuring the cut
  (an area of the section) can use the kernel later without touching this.
- **Global clipping planes on the renderer** (`gl.clippingPlanes`). It is
  one line, but it clips everything, including the grid, the origin axes,
  sketches and construction geometry, which must stay, and there is no way
  to exempt them.
- **Building the cap on the CPU** (slicing the
  mesh at the plane and triangulating the outlines). It handles holes and
  islands correctly only with a robust polygon triangulator, and it has to
  be redone on every drag step; the stencil buffer gets nesting, holes and
  touching bodies right by counting.
- **A hatch fixed in the plane's own coordinates.** It rotates with the
  model, but its pitch shrinks to noise when zoomed out and needs
  screen-derivative care when zoomed in; a screen-space hatch keeps its
  weight, at the cost of not sliding with the cut when orbiting.
- **Clipping the marks too** (vertex dots, and the picking planes of
  construction geometry). Dots need their own shader chunks for very little;
  construction geometry is not part of the model being cut.

## Open items

- Section views on more than one plane (a corner cut), a section box, and
  saving a section with a named view.
- A hatch per body material once bodies have materials; today each body's
  cap takes its colour.
- ~~Vertex dots and a sketch's projected curves aren't clipped.~~ Done in
  P3-17 (amendment below).

## Amendment (P3-17)

Vertex dots (a hovered or selected B-rep vertex) and a sketch's projected
curves are clipped too. The dot material (`viewport/dots.ts`, shared with
the origin point and sketch points) now includes three.js's clipping chunks
and sets `clipping: true`; only `VertexMarks` gives it planes, so origin and
sketch points stay whole. The point's clip position is its centre, so a dot
is either drawn whole or not at all. Projected curves are a `LineMaterial`
like body edges and take the same planes (`Sketches`' `clip`); the sketch's
own curves, points and profiles stay unclipped, as the grid does: they are
drawing aids on their plane, while projected curves stand for the model's
edges.


## Amendment (P4-12, 2026-10-06): several planes and a section box

Still view state, no kernel, facade, schema or file-format change.

**Several planes.** `viewport.section` is a list of up to three
`SectionState`s (`MAX_SECTIONS`), each with its own plane, offset, flip and
`on`; `setSection` still takes one state (or `undefined`), which it reads as a
list of one, so a caller of the old shape keeps working. The view is clipped
by the **intersection** of the kept half-spaces: the model is cut by all of
them, a corner cut away. `SectionClip` stays one plane; the view, the pick
scene and the thickness mark take a `readonly SectionClip[]`, and a point is
clipped when it is outside **any** of them (`isClippedAny`).

**Caps.** One stencil cap per plane and body. The stencil passes of plane *i*
clip only by plane *i* (the count of faces behind the plane decides whether the
plane's point is inside the solid; clipping those faces by another plane would
break the count), and the cap's quad discards the fragments the **other**
planes cut away, so a cap is drawn only where the cut lies on the kept side of
all the others. Picking agrees: `capDepth` looks at every plane, a plane
covers a ray only where the crossing point is kept by the others, and what
lies behind any cap is occluded.

**The panel** lists the sections as rows (plane, offset, Flip, an eye, Remove)
and has "Add plane" (disabled at three); Change on a row re-picks its plane.
Each row has its own arrow, `[data-section-handle="<n>"]`. `data-section` and
`data-section-clip` list every section in the order added, separated by `;`
(a single section reads exactly as before). The browser's Analysis row reads
"Section · 2 planes".

**The section box** is a fourth mode, "Box": a box in world axes from a centre
and three half-sizes (six expressions), by default the shown bodies' bounding
box grown 5 %. It is six clips in one object (+x, −x, +y, −y, +z, −z), with
its own state (`viewport.sectionBox`) beside the list; **a box excludes
planes** (it counts as six against the limit of three), and starting one
removes the planes, adding a plane removes the box. The panel says so. Each
face has a `distance` handle on its centre (`[data-section-handle="box:+x"]`
…): dragging it moves that face, the opposite one stays, so centre and
half-size both change. The box's edges are drawn as a thin wire (view
geometry, never picked), and every face the box cuts is capped.
`data-section` reads `box=cx,cy,cz:hx,hy,hz on` (mm, the values as
evaluated); `data-section-clip` lists the six planes.

**Section Here** (a selected flat face, or a face picked from the view while
no row is being changed) adds a plane, or replaces the only one as before;
at the limit it replaces the last; with a box it replaces the box.

**Stays deferred:** saving sections with named views (the views don't exist
yet) and a hatch per material.

### Results (P4-12)

- **Tests.** Clip maths (`section/clip.test.ts`: the intersection of two and
  three planes, the box's six clips and summaries, the default box, dragging a
  face), the store (`viewport/store.test.ts`: a list of up to three, edits and
  removals by index, a box and planes exclude each other) and picking
  (`selection/pick-section.test.ts`: a point inside every kept side is visible,
  outside any is clipped, what lies behind a cap is occluded). E2E in
  `e2e/section.spec.ts`: two planes on the Wall bracket (XY at 30 mm and YZ at
  20 mm: the cut-away wall and foot can't be picked, the rest can; the second
  row's handle, Flip and Remove belong to their row) and the box (default size,
  a face handle dragged with the opposite face fixed, a field edited, off, and a
  plane replacing it); `e2e/a11y.spec.ts` audits the rows and the box in both
  themes.
- **Decisions the brief left open.** Several planes live in `viewport.section`
  as a list and the box in its own `viewport.sectionBox`, so the old single
  state is simply a list of one. The per-row Remove button appears from the
  second row on (with one row the footer's "Remove" is the same thing, and
  the single-plane tests keep their names); with several rows the footer reads
  "Remove all". The box's half-sizes must be more than zero (the field refuses
  the rest); a dragged face keeps `MIN_BOX_HALF` (5 µm). `data-section`
  prints the box's values as evaluated (mm), not as expressions.
  The box's wire is drawn only while the box is on. A face handle of the box is
  `[data-section-handle="box:+x"]` (… `-x`, `+y`, `-y`, `+z`, `-z`); a plane's is
  its row number. `data-section-arrow` lists the arrowheads of every drawn handle,
  separated by `;`, in the order the handles are drawn.
- **Rejected.** Clipping the stencil passes by every plane (the parity of faces
  behind a plane would no longer say whether the plane's point is inside the
  solid); a cap per plane clipped by three.js's own clipping chunks (the cap
  shader tests the other planes itself with a uniform array, which needs no
  `clipping: true` plumbing in a `ShaderMaterial`).
- **Limits.** A face is "clipped" for picking when every node is cut away by
  some plane, so a face cut in two by different planes with no node of its own
  on a kept side is not offered even where a sliver remains. Caps where planes
  meet are exact only to the stencil's pixel; to check by hand in both themes.

## Amendment (2026-10-07, P4-12): a sketch's Slice is a fourth clip source

The sketch palette's Slice (ADR-0031 §5) adds one more `SectionClip` — the
open sketch's plane, the camera's side removed — to `useSection`'s list
while a sketch is open and the display setting `sketch.slice` is on, last
after the person's own planes; everything here (clipping, caps, picking,
the thickness mark) takes it unchanged. With it on, the person's own
sections keep clipping in sketch mode too, where before a sketch was drawn
without the section; with it off, that is unchanged.
