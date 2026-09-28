# 04 — User Interface Specification

Reference for concepts: the public Fusion 360 help at
`https://help.autodesk.com/view/fusion360/ENU/`. Use it to understand
*behaviour* only. Never copy its icons, images, text or branding.

## 1. Design language

The full visual system (logo, colour tokens, type, radius, motion, icon
brief, voice) is in **`05-brand.md`**. In short:

- **Feel:** fast, precise, friendly. The playfulness comes from motion,
  colour-coded icons and the glowing viewport, not from cartoons.
- **Themes:** **dark "Slate" is the default** (graphite panels, glowing
  blue-grey viewport); light is a full alternative. The viewport always has
  a soft radial glow and a fading grid.
- **Accent:** amber for selection, primary actions and the timeline marker;
  sketch blue for sketch geometry.
- **Colour by tool category** (icons and timeline chips share it): Sketch =
  blue, Create = green, Modify = coral, Construct = violet, Inspect = teal,
  Insert = pink, Export/3D Print = yellow. Status colours always pair with a
  glyph: ✓ ok, ⚠ warning, ✕ error.
- **Icons:** a custom two-tone set (24 px grid, 1.75 px stroke, 22% fill in
  the category colour). Lucide for generic UI icons.
- **Typography:** Instrument Sans (UI) and JetBrains Mono (values). Both are
  OFL and bundled.
- **Shape:** rounded corners (6–16 px by element size), shadows only on
  raised surfaces, generous hit targets (32 px toolbar buttons, 40 px
  primary tools), motion 120–200 ms (off under `prefers-reduced-motion`).

## 2. Layout

```
┌────────────────────────────────────────────────────────────────────────────┐
│ ☰ File  │ ⟲ ⟳ │        Project name ▾  • Saved           │ ⚙  ?  ◐ theme  │  App bar
├────────────────────────────────────────────────────────────────────────────┤
│ SOLID │ SKETCH* │ INSERT │ 3D PRINT │                                        │  Tabs
│ CREATE ▾  │ MODIFY ▾ │ CONSTRUCT ▾ │ INSPECT ▾                                │  Tool groups
├───────────────┬──────────────────────────────────────────────┬─────────────┤
│ BROWSER       │                                              │   ┌─────┐   │
│ ▾ ⚙ Document  │                                              │   │VIEW │   │  ViewCube
│ ▸ 👁 Views     │                                              │   │CUBE │   │
│ ▾ 👁 Origin    │                 3D VIEWPORT                   │   └─────┘   │
│ ▾ 👁 Sketches  │                                              │             │
│   Sketch1     │                                              │ ┌─────────┐ │
│ ▾ 👁 Bodies    │                                              │ │ COMMAND │ │  Feature dialog /
│   Body1       │                                              │ │ DIALOG  │ │  Sketch palette
│               │                                              │ └─────────┘ │  (right side)
│               │   ↖ ⟳ ✋ 🔍 │ ⊡ │ ◧ style │ ▦ grid │ ◫ views    │             │  Nav bar (bottom
├───────────────┴──────────────────────────────────────────────┴─────────────┤  center, floating)
│ ⏮ ◀ ▶ ⏭ │ [✎S1][▮E1][✎S2][▯E2][◠F1]▼[◡C1]                      │ status bar  │  Timeline
└────────────────────────────────────────────────────────────────────────────┘
```

- **App bar:** file menu (New, Open, Save version, Export, Import, Project
  settings), undo/redo, command search (opens the Ctrl+K palette), project
  name (click to rename, dropdown for version history), save status,
  settings, help (menu: Search commands, Toolbox; the tutorial later), theme
  toggle.
- **No workspace switcher** (removed 2026-09-27): no second workspace is
  planned, and a one-item dropdown did nothing. The 3D Print tab covers the
  printing "mode".
- **Tabs:** `SOLID` (default: create, modify, construct, inspect), `SKETCH`
  (shown only while editing a sketch, replacing SOLID; it keeps its own
  Export Sketch), `INSERT` (SVG, later images and imports), `3D PRINT` (our
  addition: export, orientation, overhang, slicer hand-off,
  mass/filament). Insert and export aren't modelling tools, so they aren't
  in SOLID.
- **Tool groups:** each group shows 3–6 most-used tools as buttons plus a
  dropdown with the full list. Users can pin tools to the toolbar.
- **Browser (left):** collapsible tree with an eye toggle per item and
  folder. Right-click menus. Items highlight in the viewport on hover.
  Rename with F2. Hiding it slides it away in 200 ms (`--x-normal`, none
  under reduced motion); a small tab with the browser icon at the view's
  top-left edge brings it back. No empty rail is left behind.
- **ViewCube (top-right):** faces, edges and corners are clickable. Home icon.
  Rotate-90° arrows appear when face-on. Drag to orbit.
- **Nav bar (bottom center, floating pill):** the pointer modes first:
  **Select**, orbit, pan, zoom. Exactly one mode is active: Select
  whenever no nav tool and no command (a sketch tool, the plane pick)
  runs. Pressing Select stops the nav tool or the command; starting a
  command ends a nav tool. Each nav tool has its own cursor (an orbit
  arrow, a magnifier, a hand), also during a navigation drag. Then fit
  (F6), ortho/perspective, visual style, grid, mouse controls and named
  views. The wireframe and hidden-edge styles also draw the silhouettes
  of curved faces (the outline of a hole or a cylinder as seen now), which
  follow the camera; seams are never drawn (P2-08).
- A running tool is highlighted on the toolbar: its tile, or, for a tool
  from a group's menu, the group's label.
- **Command dialog (right, floating):** appears for the active feature and is
  draggable. It holds selection fields, inputs, OK (Enter) and Cancel (Esc).
- **Timeline (bottom):** playback buttons, feature chips with category colour
  and icon, and a rollback marker (a draggable ▼ handle). The chip tooltip
  shows the name, type and status message.
- **Status bar:** selection summary (e.g. "2 edges"), measure readout (bbox of
  the selection), kernel status (spinner while recomputing), units, and the
  viewport's render rate ("58 fps · 1.4 ms": frames drawn in the last
  second and the mean time to draw one; "idle" while the view is still,
  since it only redraws on change).

## 3. Core interactions

### 3.1 Mouse and keyboard navigation (Onshape / SolidWorks preset, the default)

| Action | Input |
|---|---|
| Orbit | Right-drag (also ViewCube drag) |
| Pan | Middle-drag, or Ctrl + right-drag |
| Zoom | Wheel (zooms toward the cursor) |
| Fit all | F6 or double-click middle |
| Look at selection | Nav bar "Look at" |

Other presets, in the Mouse controls menu after this one: Fusion (MMB pan,
Shift+MMB orbit), Blender (MMB orbit, Shift+MMB pan), Trackpad (two-finger
pan, pinch zoom, Alt+drag orbit). Since the right button orbits, the
right-click marking menu (§3.3) must open only on a right-click without
movement, as Onshape's context menu does.

### 3.2 Selection

- Hover → pre-highlight (light category tint). Click → select (strong
  highlight). Shift or Ctrl+click → toggle.
- Drag left-to-right = **window** (fully inside); right-to-left = **crossing**
  (touching). The rectangle style differs (solid vs dashed).
- Long-press (500 ms), or a right-click without movement → "Select
  other…", lists the stacked geometry under the cursor: vertices, edges
  and sketch curves near it, then profiles and faces front to back
  (hidden ones marked "(hidden)"), then bodies. The pointer or the arrow
  keys on a row pre-highlight it; a click selects it. When the marking
  menu (§3.3) comes, right-click opens it and "Select other…" moves into
  it; the long press stays.
- **In the model (P2-03, ADR-0026)** the pointer picks body faces, edges
  (within 6 px) and vertices (within 8 px), sketch curves and profiles. A
  vertex near the pointer wins, then an edge or curve, then the front
  profile or face; a body only with faces filtered out, or from "Select
  other…". Hidden items (behind a face) are only offered there. Faces
  tint with the accent (45 % under the pointer, 90 % selected); edges and
  vertices are drawn over the body in the accent, and vertices show as
  dots only while hovered or selected. A click on empty space clears the
  selection unless Shift or Ctrl is held.
- **Boxes in the model** take one kind: the first of bodies, faces,
  edges, vertices, profiles and sketch curves that the filter allows and
  the box finds. A box around a part selects the part; filter bodies out
  to box faces. Boxes see through faces.
- **The selection filter** is a chevron beside the nav bar's Select:
  Bodies, Faces, Edges, Vertices, Sketches, Profiles, Construction
  (construction sketch curves and the origin axes), and "Select
  everything". It lasts for the session; a dot on the chevron shows that
  it filters.
- **Origin axes (P2-07, ADR-0029)** are picked like edges wherever they
  are drawn (X and Y along the grid, Z by the origin, as far as the grid
  reaches; hidden ones not), after vertices, edges and sketch curves, and
  never by a box. A picked or pre-highlighted axis is drawn over in the
  accent. "Select other…" names them "X axis", "Y axis", "Z axis".
- The status bar sums up the selection ("2 faces", "1 edge, 2 vertices").
- Esc clears the selection, or cancels the active tool (or a drag in
  progress, putting the geometry back), or stops a nav tool.

### 3.3 Commands

- **Toolbar**, **shortcut**, **S toolbox** (searchable popup at the cursor,
  pinnable), **Ctrl+K** command palette, and the **right-click marking menu**
  (radial, 8 slots: Repeat last, Delete, Press Pull, Undo, Sketch, Extrude,
  Fillet, Move, plus an overflow list below).
- **Search (P1-14):** the palette opens at the top of the window over a
  dimmed page, the toolbox at the pointer with its pinned commands as
  tiles above the search field's results. Both search the commands
  offered in the current mode, fuzzy, by label first (word starts count
  most), then by group and hint words. An empty search lists recent
  commands, then all by group. Arrows move, Enter runs, Shift+Enter (or
  a row's pin) pins or unpins, Esc closes. Tools that aren't built yet
  are listed dimmed with the task that brings them; their keys say so
  in a toast.
- Pre-selection works: select edges, press F, and the Fillet dialog opens with
  those edges already chosen.
- Tools repeat: after OK, pressing Enter again or right-click → "Repeat
  Fillet".

### 3.4 Feature dialogs and in-canvas editing

- Opening a feature shows a live preview (translucent; cuts in red, joins in
  green-tinted).
- Numeric fields have an in-canvas **manipulator** (arrow for distance, arc for
  angle) and a **heads-up value box** next to it. Typing goes straight into the
  box and accepts expressions.
- Invalid input: the field shows a red underline and the message; the preview
  keeps the last valid result, dimmed.
- OK commits one undoable step and adds (or updates) the timeline chip.
- **As built (P2-05, ADR-0027):** the dialog floats top-right below the
  ViewCube, non-modal, and moves when dragged by its title. Selection
  fields are buttons: the one taking picks has the accent border ("Pick a
  face", or "2 faces" with a clear ✕); clicking one makes it take the
  picks. While a field takes picks, a click in the view adds or removes an
  item (replaces it for single-pick fields, then the next empty field
  takes over), a box adds, and only what the field accepts pre-highlights
  (the selection filter narrows to it). The view highlights the dialog's
  picks. Opening a dialog fills its first field that accepts the current
  selection; what that field doesn't take goes on to the next fields that
  take it (a profile and an axis selected before Revolve fill both,
  P2-07). Expressions preview while typing; text that doesn't evaluate
  keeps OK disabled and dims the preview. A failing draft's message shows
  above OK, the preview keeps its last good state, dimmed, and OK is
  disabled. Preview ghosts are drawn through the model: new bodies in the
  preview blue, joins green, cuts red, intersections violet. Dragging an
  arrow or arc writes a number with its unit ("12.5 mm", "15 deg"),
  replacing the expression, snapped to a round step for the zoom. The
  heads-up box sits by the active handle; typing a number with no text
  field focused goes into it, Tab too. Enter in a field commits it and
  presses OK; Esc on text that doesn't evaluate puts the last value back,
  otherwise Esc cancels. Editing a feature (double-click its chip, or
  "Edit Feature") shows the model as it was before the feature.
- **Extrude (P2-06, ADR-0028):** E (or the Solid tab's Extrude) opens
  the dialog with the selected profiles or flat faces in **Profiles**.
  Fields, top to bottom: Profiles; Direction (One side, Symmetric, Two
  sides); Extent (Distance, To object, Through all) with Distance (the
  whole length when symmetric) or To object (a flat face or a vertex);
  Taper; for two sides Extent 2, Distance 2 or To object 2, and Taper 2;
  Flip; Operation (New body, Join, Cut, Intersect); and, except for a
  new body, Bodies ("Automatic" until bodies are picked: every body the
  extrude reaches). Hidden fields keep their values while the dialog is
  open. A long dialog scrolls its fields. In the view: a distance arrow
  per side that ends at a distance, from the profiles' centre along the
  plane's normal (flipped by Flip; side 2 the other way; a symmetric
  arrow reaches half the length), and a taper arc at the end of each
  side. **Press-pull:** select a flat face and press E; pulled out
  (a positive distance) the dialog proposes Join, pushed in (a negative
  distance, or Flip) Cut, and the preview turns from green to red.
  Profiles propose New body. Once the user picks an operation it stays;
  editing a feature keeps a stored operation the rule wouldn't give.
- **Revolve (P2-07, ADR-0029):** the Solid tab's Revolve (no key) opens
  the dialog with the selected profiles or flat faces in **Profiles** and
  a selected axis in **Axis**. Fields: Profiles; Axis (a sketch line,
  construction or not, a straight edge, or an origin axis; the field
  shows "Y axis" for an origin axis, "1 sketch curve" or "1 edge"
  otherwise, and a picked curve that isn't a line says "Pick a straight
  line for the axis."); Direction (One side, Symmetric, Two sides);
  Angle (360 deg by default: a whole turn, with no end faces; negative
  turns the other way; the whole angle when symmetric); Angle 2 for two
  sides (the other way round); Flip; Operation and Bodies as for
  extrude. Side 1 turns right-handed about the axis (a sketch line runs
  from its start to its end; an edge's direction has a fixed sign), so
  Flip or a negative angle is how to turn the other way. In the view: an
  angle arc about the axis, starting on the profiles' side of it (a
  second one, the other way, for side 2; a symmetric arc shows half the
  angle); dragging goes on round past 180°, up to a whole turn. Profiles
  propose New body, faces of a body Join. The kernel says when the axis
  isn't in the profiles' plane, when a profile crosses the axis or the
  profiles lie on both sides of it, and when the angles are 0, beyond a
  whole turn or cancel out.
- **Bodies in the browser (P2-06, P2-08, ADR-0030):** the Bodies folder
  lists the model's bodies in timeline order, with a count badge. A new
  body is named "Body1", "Body2"… (the lowest free number) as soon as it
  appears, and keeps that name: removing another body renumbers nothing.
  Each row has a colour dot, the name and an eye. A click selects the
  body in the model (Shift or Ctrl toggles), or puts it in an open
  dialog's field (an extrude's Bodies); the pointer on a row highlights
  the body in the view. F2 renames, Delete removes (all selected bodies
  when the row is one of them). The right-click menu: Rename, Hide/Show,
  Appearance… (a popover on the dot: colour swatches, Default first, and
  opacity Opaque, 75 %, 50 %, 25 %; each choice is one undo step) and
  Delete. The folder's eye hides or shows all bodies in one step.
- **Removing bodies:** Delete (the browser, the body menu, or Delete in
  the view with bodies selected) adds a **Remove** feature at the marker
  (a Modify chip, "Remove1"): the body is still made by its features and
  taken out after them, so undo, suppressing or deleting the Remove, or
  rolling the marker back before it brings the body back. A feature whose
  bodies a later Remove (or an extrude's Bodies) names can't be deleted
  until that one is changed.
- **One body per solid:** a cut or intersect that leaves a body in
  separate pieces makes one body per piece; the largest keeps the body's
  name, colour and references, the others are new bodies.

## 4. Sketch mode

- Enter by: Create Sketch → pick a plane or face; double-click a sketch in the
  browser or timeline; right-click → Edit Sketch.
- **Sketch on a face (P2-09, ADR-0031):** while Create Sketch waits, flat
  faces of bodies hover in the preselect tint like the origin planes;
  whichever is nearer under the pointer takes the click. A flat face
  selected beforehand takes the sketch at once; a curved one says "A sketch
  needs a flat face or a plane". The sketch moves with its face when the
  model changes; its X runs along world X on floors and roofs, its Y up
  the face on walls, and its origin is the world origin on the face's
  plane.
- **Project (P2-09):** `P`, or Create ▾ → Project. The view picks body edges
  and faces (hovered in the preselect tint); a click projects the edge, or
  the face's outline (with the silhouette lines of a cylinder or cone),
  into the sketch. Projected curves are purple, fixed, make profiles and
  take constraints and dimensions; when the model changes they follow it,
  and whatever is constrained to them follows too, in the same undo step
  as the change. Deleting one keeps it deleted; trimming or filleting it is
  refused. Esc or Select ends the tool. In a sketch that later features
  build on, the view shows the bodies as they were before the sketch while
  the tool runs.
- The camera animates to look at the plane (can be turned off). The grid
  aligns to the sketch plane. Bodies are optionally sliced or dimmed.
- **SKETCH tab groups:** CREATE (line, rectangle ▾, circle ▾, arc ▾, polygon
  ▾, slot ▾, ellipse, spline ▾, point, text, mirror, pattern ▾, project ▾,
  dimension) · MODIFY (fillet, chamfer, trim, extend, break, offset,
  move/copy, scale, parameters — the dialog, as on the SOLID tab) · CONSTRAINTS (row of constraint icons) · INSPECT ·
  EXPORT (the sketch or its profiles as SVG or DXF, P1-13) ·
  **FINISH SKETCH** (big green ✓).
- **Sketch palette (right panel):** construction toggle, look at, sketch grid,
  snap, slice, show profiles, show points, show dimensions, show constraints,
  DOF counter ("3 DOF left", "Fully constrained ✓", or "Over-constrained").
- **Selecting and editing (no tool running):** hover pre-highlights; click
  and box select points and curves; dragging geometry moves it (or the whole
  selection) with a live solve, except that dragging a circle's rim resizes
  it while its radius is free. A **properties panel** in the view's
  bottom-left corner shows the selection's type and status, a point's X/Y
  and a circle's or arc's radius (typed values move it as the constraints
  allow), a line's length and angle, the construction flag and Delete.
  Deleting geometry also deletes its constraints and dimensions.
- **Colours:** under-constrained geometry blue; fully constrained dark
  (light theme) or white (dark theme); construction dashed grey; conflicting
  red; projected purple; profiles pale fill. Status is per entity: a
  fully placed side of a rectangle is white while the others are still
  blue. Constraint glyphs and dimension labels that over-constrain are red.
- **Over-constraint:** a new dimension that would over-constrain the
  sketch asks first: add it as driven (it measures) or cancel.
- **Drawing feedback:** inference guides as dashed lines with small snap
  glyphs; a live length/angle heads-up; auto-constraint glyphs flash when
  applied.
- Pressing a dimension tool on a selection places the most likely dimension
  type.

## 5. Default keyboard shortcuts

Fusion-compatible where Fusion has them; remappable in settings.

| Key | Command | Key | Command |
|---|---|---|---|
| L | Line | E | Extrude |
| R | 2-point rectangle | Q | Press/Pull |
| C | Center circle | F | Fillet |
| A | 3-point arc (ours) | H | Hole |
| P | Project | M | Move/Copy |
| D | Sketch dimension | J | Joint (reserved) |
| T | Trim | S | Toolbox |
| O | Offset | I | Measure |
| X | Construction toggle | Delete | Delete |
| Ctrl+Z / Ctrl+Y | Undo / Redo | Ctrl+K | Command palette |
| Ctrl+S | Save version | Esc | Cancel / clear |
| F6 | Fit | Shift+1…7 | Standard views (ours) |

Shift+1…7 are Home, Top, Bottom, Front, Back, Left, Right, by key
position (they work on any layout). The keys live in one table,
`apps/web/src/commands/keymap.ts`; P is Project (P2-09); Q and J wait for their tools.

## 6. Home screen

- A grid of project cards with thumbnail, name, modified time, and a hover
  menu (rename, duplicate, export `.extrudo`, delete).
- A big playful "New design" card; a "Start from template" row; "Import"
  (`.extrudo`, STEP, STL, SVG).
- Search and sort. A trash view with restore.
- The storage indicator warns if persistent storage is not granted.

## 7. Empty states and onboarding

- New project viewport hint: "Start with a sketch: press **Create Sketch**
  and pick a plane", with an arrow toward the button.
- First run: an optional 5-step guided tour building B2 (box).
- Every tool tooltip: name, shortcut, one sentence, and an optional looping
  2-second demo (WebM, lazy-loaded).

## 8. Error messages

Plain language, with the fix if we know it:

- ✕ "Fillet failed: radius 5 mm is larger than this edge allows (max ≈ 2.4
  mm)." [Set to 2.4 mm]
- ⚠ "Extrude 3 lost its target face after you edited Sketch 1. We picked the
  closest match." [Review] [Pick again]
- ✕ "Parameter `wall` refers to itself: wall → lid_gap → wall."
