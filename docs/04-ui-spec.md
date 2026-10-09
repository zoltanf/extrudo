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
  Insert = pink, Export/3D Print = yellow, the Home tab's file actions = neutral
  grey (`file`, ADR-0079). Status colours always pair with a
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
│ ◆ extrudo. HOME SOLID MODIFY CONSTRUCT INSPECT 3D PRINT │ ⟲ ⟳ ▦ 🔍   Name • Saved   🕘 ⚙ ? │  Top bar
├────────────────────────────────────────────────────────────────────────────┤
│ CREATE  │ PRIMITIVES │ FEATURES │ PATTERN │ PROGRAM                         │  Tool groups
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

- **Top bar** (ADR-0079, one row of 40 px): the logo (a link to all designs),
  the toolbar's tabs, a separator, then undo, redo, the toolbox (opens at the button)
  and command search (the Ctrl+K palette). The project name and the save state
  (a dot and its word) sit together, centred between the search button and the
  right-hand buttons: version history, settings and help (menu: Search commands,
  Toolbox, Tutorial, P3-12). Settings holds General (auto-project, the Radial right-click menu,
  Customize Marking Menu…) and the Theme (System by default, Light, Dark). The tab labels
  sit on the wordmark's baseline. There is no File menu: its items are the Home
  tab (on the desktop app also Open File, Save As and Open Recent, and Help has
  Check for Updates…); Windows and Linux have no native menu bar either, macOS
  keeps the system one (ADR-0075). Below 1024 px the wordmark goes; when the title group doesn't fit, the save
  word goes first (the dot stays), then the name truncates (ADR-0079, round 2). Tool tiles carry a one-line label that may be long; a tool has a
  tile whenever there is room, and the ▾ menu holds only what the fit rule moved.
- **Versions** (P2-14, ADR-0036): Ctrl+S, Home › Save Version or
  Version History, the clock icon beside the project name, or the
  palette open one dialog: a Description field with Save version on top
  (Enter saves V<n> and closes; a toast says so), then the saved
  versions newest first (V<n>, description, when, the name if it has
  changed) with Open copy (a new design, "<name> V<n>") and Restore (one
  undo step, "Restore version"; what was there is kept as a version
  first, "Before restoring V<n>", unless the newest version already
  holds it). Restore ends an open sketch or feature dialog first.
- **No workspace switcher** (removed 2026-09-27): no second workspace is
  planned, and a one-item dropdown did nothing. The 3D Print tab covers the
  printing "mode".
- **Tabs** (ADR-0079): `HOME` (the design as a whole: New Design, All
  Designs; Save Version, Version History; Files: Import, Import Drawing,
  Canvas, Export Design, Export Model, Export as Script, and in its menu Import
  .extrudo and Save to Linked Folder; Parameters, Customizer; Plugins),
  `SOLID` (default: Create, Primitives, Features, Pattern, Program), `MODIFY`
  (Modify, Transform), `CONSTRUCT` (Planes, Axes, Points), `INSPECT` (Measure,
  Section Analysis) and `3D PRINT` (our addition: export, orientation,
  overhang, slicer hand-off, mass/filament). `SKETCH` shows only while editing
  a sketch, replacing SOLID, MODIFY, CONSTRUCT and INSPECT (it keeps its own
  Export Sketch); HOME and 3D PRINT stay, and Home's model-only tools (Import,
  Canvas, Customizer) say "Finish the sketch to use …" there.
- **Toolbars fit the window** (ADR-0079 §3): when the selected tab's groups
  are wider than the window, the group with the most visible tiles moves its
  last tile to the front of its ▾ menu, one at a time (equally full: the
  earlier group), until the row fits; a group keeps one tile at least, and
  widening brings them back. A group's ▾ lists only what isn't a tile (moved
  tiles, tools that are never tiles, the Create group's plugin features).
- **Export model** (P2-12, ADR-0034): 3D Print › Export, Home › Export
  Model, or a body's menu (that body). A small dialog: the
  bodies as checkboxes (the selection's bodies, else every shown body),
  the format (3MF first, "for slicers"; STL; STEP), and for meshes
  Coarse / Medium / Fine or Custom (deviation and angle fields). The
  summary line says what the file holds ("1 body, 620 triangles,
  watertight", or which bodies aren't closed) before Export saves it.
  Format and resolution are remembered.
- **Measure** (P2-13, ADR-0035): Inspect › Measure or 3D Print › Prepare,
  key `I`. A panel where feature dialogs open, pressed like a tool
  (Esc or Close ends it; the selection stays). It measures the model
  selection: a plain click adds until two things are picked, the next
  starts again with itself; Shift toggles. One thing: a body's volume,
  area and centre; a face's type, area, radius and diameter or normal;
  an edge's type, length, radius, sweep, centre; a vertex's position.
  Two: "Between" first (minimum distance with its ΔX, ΔY, ΔZ, the angle
  where both have a direction, the centre distance of holes, circles
  and vertices), with a dashed line and label between the closest
  points in the view. Three or more: totals. Always the bounding box.
  Sketch points and curves (picked in the model), origin and construction
  axes and planes, and construction points measure too (P3-17): a curve's
  length, radius and centre, a plane's origin and normal, an axis's
  direction; between them (or with a vertex or straight edge) the distance,
  and with a face or a curve the angle and centre distance only.
  Values are in the document's unit and precision and can be selected
  to copy.
- **Section Analysis** (P3-09, ADR-0045): Inspect › Section Analysis, `Shift+S`, the
  context list's "Section Here" on a flat face. A panel in the same
  corner as Measure (Esc or Done closes it; the section stays). A new
  section asks for a plane: click an origin plane, a construction plane
  or a flat face in the view, or a button in the panel (a flat face
  selected beforehand is taken at once). The model is then cut away on
  the side the arrow points to, through the middle of the part, and the
  cut is filled with the body's colour tinted teal and hatched. The panel
  has the plane ("Change"), the Offset (an expression field), Flip and
  "Show section"; the arrow's handle in the view drags the offset, with
  the same snapping as a dialog's arrows. Faces, edges and silhouettes
  are clipped, the grid, origin and sketches aren't; a click passes
  through what is cut away and is stopped by the cap. The section is view
  state, not part of the design: it is not saved, not undone, and stays
  while the model is edited. The browser's Analysis folder lists it (click
  to edit; the eye turns it off and on; the menu removes it). Sketch mode
  draws the model without it.
- **Print aids** (P3-10, ADR-0048), all in 3D Print › Prepare. *Print Info*:
  a panel like Measure's. Material (PLA, PETG, ABS, TPU with their g/cm³, or
  Custom density as an expression field) and filament diameter (1.75 or
  2.85 mm) above, then the print itself — Walls, Line width, Infill and Price
  per kg, every one an expression field, all in the `print.material`
  preference; below, the solid volume, what a print of it takes ("Printed
  (est.)"), its weight, filament length and cost of the selected bodies (a face
  or edge counts for its body) or, with none selected, of every shown body. The
  note "An estimate: walls and infill as set, no supports" says what the number
  is. The choice is remembered. *Overhang Analysis*: a panel with
  an Angle (an expression field, 0–90°, 45° default), Down (-Z the bed, +Z,
  ±Y, ±X) and "Show overhangs", and a line saying how many faces and how much
  area overhang. Faces whose normal points more than the angle below the
  horizontal are shaded red (the error colour, both themes); faces lying on the
  lowest level of the model are not overhangs. It is view state like the
  section: not saved, not undone; closing the panel leaves the shading on;
  the browser's Analysis folder has its row (click to edit, eye, menu with
  Remove). It works with a section on and is off in sketch mode. *Place on
  Bed*: a dialog with one Face field (a flat face selected beforehand is taken
  at once); the preview shows the body turned so the face lies on the bed
  (z = 0); a warning says when part of the body would end up below it. Also
  "Place on Bed" in the context list of a flat face.
- **Tool groups:** each group shows 3–6 most-used tools as buttons plus a
  dropdown with the full list. Users can pin tools to the toolbar.
- **Browser (left):** collapsible tree with an eye toggle per item and
  folder. Right-click menus. Items highlight in the viewport on hover.
  Rename with F2. It floats over the view's left edge in frosted glass,
  like the nav bar: the view runs on behind it, so hiding, showing or
  resizing it never moves the model. Hiding it slides it out to the left
  in 200 ms (`--x-normal`, none under reduced motion); a small tab with
  the browser icon at the view's top-left edge brings it back. Fit (F6,
  Home, the ViewCube, opening a sketch) frames the model in the part of
  the view the browser leaves open and centres it there; orbiting still
  turns about the model. Overlays on the view's left and centre (the
  selection panel, the nav bar, the tool prompt) keep clear of it.
- **Toasts** appear in the view's bottom-right corner, newest at the
  bottom; while a sketch is open they sit at the foot of the sketch
  palette's column, so they never cover it. Errors stay until dismissed.
  **Notification history (P3-16, ADR-0041):** a bell button at
  the status bar's right edge (always there, muted while empty; badge: how many came since
  the list was last opened, red if one is an error). It opens a panel of
  the session's earlier notifications, newest first with errors in a group
  of their own on top, then the rest; repeats show ×n and the time; Clear
  all empties it. An action stays clickable while it still applies (Show
  for a hidden sketch) and shows disabled once it doesn't. Esc closes the
  panel and returns focus to the button; Ctrl+K "Notification History"
  opens it any time. The list is session-only.
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
  A selection field names a single pick ("Y axis", "Line · Sketch1",
  "Profile · Sketch1", a body's name; faces, edges and vertices are counted)
  and counts several; while a field takes axes the origin axes are drawn
  even if the browser hides them (P3-17).
- **Timeline (bottom):** playback buttons, feature chips with category colour
  and icon, and a rollback marker (a draggable ▼ handle). The chip tooltip
  shows the name, type and status message. The timeline and the status bar
  share the bottom row and are always shown: there is no Hide timeline
  button (removed 2026-10-08; it freed almost no space, the status bar
  staying put).
- **As built (P2-11, ADR-0033):** the marker is a slider: drag it (a ghost
  shows the gap, chips behind it dim, the model rolls when it is let go,
  one undo step), or focus it and use ←/→, Home and End. Drag a chip to
  move it: an accent line shows where it goes, red with the reason when
  the move would put a feature before something it uses (or after
  something that uses it); dropping there says why in a toast, Esc puts
  it back. New features go in at the marker. The chip and browser menus
  add Roll Back (Forward) to Here, Move to End, Redefine Plane… (sketches)
  and, when the kernel lost or guessed a reference, Fix References… and
  Keep Closest Match. Fix References opens the feature's dialog with the
  lost picks taken out, a note above the fields and the field waiting for
  a pick; for a sketch it is Redefine Plane: Create Sketch's plane prompt
  titled "Redefine Plane", picking planes and the faces made before the
  sketch. While a dialog edits a feature, the marker shows dashed after it
  and later chips dim; the marker and chips stay put meanwhile, as while a
  sketch is open. The browser's sketch and construction rows show the same
  ✕/⚠ as the chips, with the message in a tooltip (P3-17). A click picks a
  chip (Ctrl/⌘ adds, Shift a run); dragging a picked chip moves all of them
  as a block, and a drag near the list's ends scrolls it (P3-17).
- **Status bar:** selection summary (e.g. "2 edges"), measure readout (bbox of
  the selection: "40.00 × 20.00 × 0.00 mm", the exact box of what is
  selected in the model, P2-13; asked once the selection has been still for
  150 ms, P3-17), kernel status (spinner while recomputing), units, and the
  viewport's render rate ("58 fps · 1.4 ms": frames drawn in the last
  second and the mean time to draw one; "idle" while the view is still,
  since it only redraws on change).

## 3. Core interactions

### 3.1 Mouse and keyboard navigation (Extrudo preset, the default)

| Action | Input |
|---|---|
| Orbit | Middle-drag (also ViewCube drag) |
| Pan | Right-drag, or Ctrl + middle-drag |
| Zoom | Wheel (zooms toward the cursor) |
| Fit all | F6 or double-click middle |
| Look at selection | Nav bar "Look at" |

The Extrudo preset is Onshape / SolidWorks with the middle and right
buttons swapped. Other presets, in the Mouse controls menu after this one:
Onshape / SolidWorks (right-drag orbit, middle-drag or Ctrl + right-drag
pan), Fusion (MMB pan, Shift+MMB orbit), Blender (MMB orbit, Shift+MMB
pan), Trackpad (two-finger pan, pinch zoom, Alt+drag orbit). Since the
right button drags, the right-click marking menu (§3.3) must open only on
a right-click without movement, as Onshape's context menu does.

### 3.2 Selection

- Hover → pre-highlight (light category tint). Click → select (strong
  highlight). Shift or Ctrl+click → toggle.
- Drag left-to-right = **window** (fully inside); right-to-left = **crossing**
  (touching). The rectangle style differs (solid vs dashed).
- Long-press (500 ms) → "Select other…", lists the stacked geometry
  under the cursor: vertices, edges and sketch curves near it, then
  profiles and faces front to back (hidden ones marked "(hidden)"), then
  bodies. The pointer or the arrow keys on a row pre-highlight it; a
  click selects it. **Since P3-11 (ADR-0042) a right-click without
  movement opens the marking menu (§3.3)**, whose list starts with
  "Select other…"; the long press still opens the list directly, and
  where the marking menu isn't offered (a feature dialog, Measure) a
  right-click opens it as before.
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
  reaches; hidden ones not), after vertices, edges, sketch curves,
  profiles and faces (over a body, "Select other…" offers them; a
  dialog's axis field filters faces out), and never by a box. A picked or pre-highlighted axis is drawn over in the
  accent. "Select other…" names them "X axis", "Y axis", "Z axis".
- The status bar sums up the selection ("2 faces", "1 edge, 2 vertices").
- Esc clears the selection, or cancels the active tool (or a drag in
  progress, putting the geometry back), or stops a nav tool.

### 3.3 Commands

- **Toolbar**, **shortcut**, **S toolbox** (searchable popup at the cursor,
  pinnable), **Ctrl+K** command palette, and the **right-click marking menu**
  (radial, 8 slots, plus an overflow list below; P3-11, ADR-0042).
- **The marking menu (P3-11):** a right-click **without movement** (a
  right-drag navigates) opens a ring of eight wedges round the pointer and
  a list under it (above it when there is no room; both stay inside the
  window). A right-click first selects what is under the pointer, unless it
  is selected already. Each wedge is a command, so it has the command's
  keys and availability: one that can't run here, or isn't built yet,
  stays in place, dimmed, with the reason as its tooltip. In the model, clockwise from the top: **Sketch, Extrude, Fillet,
  Move, Press Pull, Undo, Repeat last, Delete**. In a sketch: **Line,
  Rectangle, Circle, Dimension, Trim, Undo, Construction, Finish Sketch**.
  Pick a wedge by clicking it, by aiming (the pointer's direction from the
  centre picks the wedge, so it needn't touch the label) or by a **flick**:
  press the left button in the ring, drag towards a wedge, release. A press
  and release in the ring's middle does nothing; Esc or a click outside
  closes. Keyboard: arrows jump to the wedge in that direction (Down from
  the bottom wedge goes into the list), Tab walks everything, Enter runs.
  **Repeat last** runs the last tool started through the commands, the
  toolbar or the menu (not Undo, Delete, views or dialogs such as
  Parameters). The **list** depends on what was right-clicked: for a
  face, edge or vertex, Select other…, Sketch on Face (one flat face),
  Measure, Hide Body, Appearance…, Export…; for a body also Delete; for a
  profile or sketch curve, Edit Sketch and Hide Sketch; for a construction
  plane, axis or point, Edit, Hide and Delete; over empty space,
  Fit, Home View, Orthographic/Perspective, Redo and Show All Bodies when
  some are hidden; in a sketch, Cancel (while a tool runs), Delete
  (named for a constraint or dimension), Look At Sketch, Fit, Redo,
  Repeat. "Right-Click Menu: Use a List" in Ctrl+K swaps the ring for one
  plain list.
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
  A new feature that used sketch profiles hides those sketches in the same
  step (as Fusion does), so a used profile doesn't float in front of the
  faces made from it and take their clicks. A toast (bottom right, 12 s)
  says so ("Sketch1 is hidden: Extrude1 used its profile.") with a Show
  button; the eye in the browser shows it again too. Editing a feature
  doesn't change visibility.
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
  side. **Press-pull:** select a flat face and press E (Q, Press Pull, opens
  Offset Face for a face instead, which moves it like a pad and extends the
  faces around it; ADR-0051); pulled out
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
- **Script (P5-02, ADR-0070):** Solid › Program › Script (no
  default key; Ctrl+K finds it). A 560 px draggable dialog with a lazily loaded
  CodeMirror editor, Language (TypeScript/JavaScript), Script output and Made N
  features. A new script starts with a working box. Preview waits 500 ms after
  typing; errors underline their line and disable OK. Tab indents, Esc closes
  completion first, Esc then Tab leaves the editor; Cancel closes the dialog.
  Editor undo changes text, OK adds or edits one document undo step. The Script
  stays one timeline chip, with its generated count in the tooltip; bodies are
  ordinary browser entries and may be picked by later features.
- **Plugins (P6-03, ADR-0077):** Home › Plugins (Ctrl+K "Plugins…") installs, enables
  and removes `.extrudo-plugin` files and lists a design's plugins that aren't installed
  (Install) or are older than the installed version (Update to <version>, one undo
  step). An enabled plugin's custom features are the items of Solid › Create ▾
  under a "Plugins" label and in Ctrl+K as "Plugins › <name>" (no keys); each opens a
  dialog generated from its manifest (expression, checkbox, dropdown and pick fields, a
  line "Plugin: <name> <version>"), and OK adds the feature and the plugin file together.
  Its chip is the label numbered ("Name plate1"), with the plugin and version in the
  tooltip. Its commands (one-offs) are in Ctrl+K only.
- **Record Macro and Stop Macro (P5-05, ADR-0073):** Solid › Program after Script
  (no keys; Ctrl+K finds them). The group shows Record while idle and Stop while
  recording; the status bar shows a red dot and "Recording macro · N features".
  Stop opens the Macro dialog (code read only, Copy, Replace with a Script, Keep
  both, Close). Home › Export as Script downloads `<name>.ts`.
- **Primitives (P2-10, ADR-0032):** Solid › Primitives → Box, Cylinder,
  Sphere, Torus (no keys). The dialog opens on the XY plane ("XY plane"
  in **Plane**) with a live preview; while Plane takes picks the origin
  planes show and the nearer of a plane and a flat face under the pointer
  takes a click, as in Create Sketch (the picked plane is highlighted). A
  face selected before the tool fills Plane. Fields: Plane; the sizes (Box:
  Length, Width, Height; Cylinder: Diameter, Height; Sphere: Diameter;
  Torus: Diameter through the tube's middle, Tube diameter); X, Y (the
  centre in the plane's frame, the one a sketch on it gets); Offset (off
  the plane along its normal); Rotation (box, about its centre);
  Operation and Bodies as for extrude. A box and a cylinder stand on the
  plane (a negative height goes into it); a sphere and a torus are centred
  on it. A picked face proposes its centre as X and Y, and Join, or Cut
  for a box or cylinder with a negative height, until the user sets them.
  In the view: arrows for each size (from the centre for lengths, widths
  and diameters, from the base for heights, from the ring for the tube)
  and a box's rotation arc.
- **Hole (P3-04, ADR-0049):** H, or Solid › Features › Hole. The dialog
  opens like a primitive's (XY plane, live cut preview; a face selected
  first fills Plane and proposes its centre), and **a click on a face or
  plane square while Plane takes picks also puts the hole where you
  clicked** (X and Y in the plane's frame; click again to move it). Points
  picks sketch points instead: the view draws the points of the shown
  sketches, each picked one gets a hole dropped onto the plane, and X and
  Y go. Fields: Plane, Points, X, Y, **Preset** (M2 to M8 clearance, heat-set
  inserts M2 to M5: it fills the sizes, which stay editable; the dropdown shows
  the preset the sizes match, else Custom), Type (simple, counterbore,
  countersink), Extent (through all, blind), Diameter, Depth and Drill point
  (blind; 118° default, 0° is flat), the counterbore's diameter and depth or
  the countersink's diameter and angle, and Flip (holes go into a face, down
  from an origin plane). In the view: arrows for the diameter, the blind depth
  and the counterbore or countersink diameter on the first hole.
- **Press Pull and Offset Face (P3-08, ADR-0051):** Q, Modify › Modify ›
  Press Pull, and the marking menu's Press Pull wedge push or pull what is
  selected by opening the dialog that fits it, with the selection in its first
  field: a **face** of a body opens Offset Face, an **edge** Fillet, a
  **sketch profile** Extrude (with several kinds selected a profile wins over
  a face over an edge). With nothing usable selected it says so (a toast:
  select a face, an edge or a profile) and starts nothing. **Offset Face**
  (Modify › Modify) moves faces along their normals: Faces (any face, flat or
  curved; picking one also picks the faces that run smoothly into it, since
  they move together, and unpicking takes them out) and Distance (2 mm by
  default: **positive moves the faces out of the body**, so a pad grows and a
  hole's wall closes in; negative moves them in). The neighbours extend or trim
  to follow, a cylinder's wall changes its radius, and every face keeps its
  name. In the view: a distance arrow on the first face along its outward
  normal (on a point of the surface for a curved face); the preview replaces
  the body. A distance that is too far says how far it may go ("Face 6 can't
  move in by 25 mm: that is too far for this body (max ≈ 19 mm)").
- **Split Body, Scale and Draft (P3-08, ADR-0053):** Modify › Transform (Split
  Body, Scale) and Modify › Modify (Draft) (no default keys; Ctrl+K finds them). **Split Body**: Bodies, Plane
  (picked like Create Sketch's plane: an origin or construction plane, or a
  flat face, which cuts along its whole plane) and Keep (Both sides, Above the
  plane, Below the plane; above is where the plane's normal points). Each side
  becomes a body; the larger keeps the body's name. **Scale**: Bodies, Point
  (optional: a vertex or construction point that stays put; empty means the
  middle of the bodies' box), Scale type (Uniform, Non-uniform), Scale factor
  or X, Y and Z factor (plain numbers, 1 by default, which previews as a
  warning that nothing changes), Create copy. **Draft**: Faces (flat,
  cylindrical or conical; picking one picks the faces that run smoothly into
  it), Plane (the neutral plane, picked like Create Sketch's; the faces turn
  about where they meet it and its normal is the pull direction), Angle (3° by
  default; positive narrows the body along the pull) and Flip. In the view an
  angle arc stands where the first face meets the plane, starting along the
  pull. A draft too steep for the body says the largest angle that works
  ("The faces can't tilt by 45°: that is too steep for this body (max ≈
  36°)"); faces next to rounded edges say to draft before rounding.
- **Bodies in the browser (P2-06, P2-08, ADR-0030):** the Bodies folder
  lists the model's bodies in timeline order, with a count badge. A new
  body is named "Body1", "Body2"… (the lowest free number) as soon as it
  appears, and keeps that name: removing another body renumbers nothing.
  Each row has a colour dot, the name and an eye. A click selects the
  body in the model (Shift or Ctrl toggles), or puts it in an open
  dialog's field (an extrude's Bodies); the pointer on a row highlights
  the body in the view. F2 renames, Delete removes (all selected bodies
  when the row is one of them). Folders have right-click menus too (P3-11:
  Expand/Collapse, Show/Hide all, Export all bodies), and so do the origin
  rows, user-parameter rows in the Parameters dialog and design cards on the
  home screen. The body right-click menu: Rename, Hide/Show,
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
  the tool runs. Since P4-12 it also projects a sphere's, torus's or free-form
  face's outline, a vertex (a fixed point) and a whole body (picked by its
  browser row: its outline and the sharp edges seen from the sketch's side).
  A panel in the sketch's column says what to pick and has **Keep linked**
  (on): off, the next picks come in as plain curves that don't follow the
  model, one undo step "Include 4 curves".
- **Intersect (P4-12):** `Shift+P`, or Create ▾ → Intersect. Picks a face, or
  a body by its browser row, and brings in the curves where it meets the
  sketch plane (a cylinder cut by a slanted sketch is an ellipse); they follow
  the model like projected curves, with the same panel and Keep linked.
- The camera animates to look at the plane (can be turned off). The grid
  aligns to the sketch plane. Bodies are optionally sliced or dimmed.
- **SKETCH tab groups:** CREATE (line, rectangle ▾, circle ▾, arc ▾, polygon
  ▾, slot ▾, ellipse, spline ▾, point, text, mirror, pattern ▾, project ▾,
  dimension) · MODIFY (fillet, chamfer, trim, extend, break, offset,
  move/copy, scale, parameters — the dialog, as on the SOLID tab) · CONSTRAINTS (row of constraint icons) · INSPECT ·
  EXPORT (the sketch or its profiles as SVG or DXF, P1-13) ·
  **FINISH SKETCH** (big green ✓).
- **Sketch palette (right panel):** construction toggle, look at, sketch grid,
  snap, slice (cuts the bodies away on the camera's side of the sketch plane
  while the sketch is open), auto-project (and auto-project face outline),
  show profiles, show points, show dimensions, show constraints, DOF counter
  ("3 DOF left", "Fully constrained ✓", or "Over-constrained").
- **Selecting and editing (no tool running):** hover pre-highlights; click
  and box select points and curves; dragging geometry moves it (or the whole
  selection) with a live solve, except that dragging a circle's rim resizes
  it while its radius is free. A **properties panel** in the view's
  bottom-left corner shows the selection's type and status, a point's X/Y
  and a circle's or arc's radius (typed values move it as the constraints
  allow), a line's length and angle, the construction flag and Delete.
  Deleting geometry also deletes its constraints and dimensions. A
  right-click on a constraint glyph or a dimension label selects it (unless
  it is already in the selection) and opens a small menu: Delete, and Edit
  Value for a dimension (P3-17).
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
`apps/web/src/commands/keymap.ts`; P is Project (P2-09), Shift+P Intersect in a
sketch (P4-12; Offset Plane on the model); Shift+S is Section
Analysis (P3-09); Q and J wait for their tools.

## 6. Home screen

- A grid of project cards with thumbnail, name, modified time, and a hover
  menu (rename, duplicate, export `.extrudo`, delete).
- A big playful "New design" card and, until it is started, dismissed or
  finished, a "Take the tour" card beside it (P3-12, §7); then "Start from a
  template": a row of four cards with a picture, a name and one line each (Wall
  bracket, Storage box, Box with a lid, PCB enclosure), the last three from the
  benchmark fixtures B2, B4 and B5. A template opens as a new design under its
  own name (a copy, never the template's file) with its picture on the card;
  "Import" (`.extrudo`, STEP, STL, SVG).
- Search and sort. A trash view with restore.
- The storage indicator warns if persistent storage is not granted.

## 7. Empty states and onboarding (P3-12, ADR-0052)

- **New design hint:** while a design has no features, "Start with a sketch:
  press **Create Sketch** and pick a plane" sits in the view with a dashed
  arrow up at the Create Sketch tile. It takes no clicks, steps aside while
  Create Sketch waits for a plane, a dialog is open or the tutorial runs, and
  is gone with the first feature (undo brings it back).
- **First run:** an optional tutorial of five steps that build a box: sketch
  on the XY plane, a rectangle, a dimension, extrude, fillet (or shell). It is
  offered by the home screen's "Take the tour" card (once), and started later
  from Help › Tutorial or Ctrl+K "Tutorial". It runs on an empty design (a design
  with features gets a new one). A small card hangs under the toolbar control
  to use, which has an accent ring: "Step 2 of 5", a title, one or two
  sentences, Skip step and a close button; Esc closes it while focus is in it.
  It is not modal and takes no focus. **Steps are read from the design**, not
  from clicks: a sketch exists, a sketch has four lines, a dimension, an
  extrude, a fillet, chamfer or shell; so it follows any route, undo steps it
  back, and at the end the card says "You made a box".
- **Every tool tooltip** (toolbar tiles and the constraint icons): name,
  shortcut, one sentence and, for the most used tools, a looping demo of 3 to 4
  seconds (WebM, 480 × 300, 20 to 60 kB) that loads only when the tooltip
  opens. Create Sketch, Line, Rectangle, Circle, Dimension, Extrude, Revolve,
  Fillet, Shell, Hole, Press Pull and Rectangular Pattern have one. With
  reduced motion the clip doesn't play (its first frame is a still); offline,
  or if the file is missing, the tooltip has its words alone. A toolbar tile's
  tooltip ends with a muted "F1 for more" line (plain text: a tooltip holds no
  link or button; P6-06 S9).
- **Help menu and F1 (P6-06 S9):** below Tutorial, four items open the docs on
  the landing site through `Platform.openDocs` — User Guide (shown with the
  F1 key), Tutorials, Examples and Tool Reference; they are commands too
  (`docsGuide`, `docsTutorials`, `docsExamples`, `docsTools`), so Ctrl+K and
  the desktop's Help menu list the same. **F1** (`keymap.help`) opens the docs
  page of the tool whose toolbar tile was hovered or focused last, or the user
  guide when none was.

### 7.1 Preparing the design (ADR-0078)

- **Progress notice:** at the top left of the view's open part (right of the
  browser) a small pill with an animated cube says "Preparing your design…"
  (until the first recompute after opening has finished) or "Updating the model…"
  (a later recompute that runs longer than 800 ms), with "Computing 6 features"
  under it. The cube's faces fill in turn; with reduced motion it stands still.
  No buttons, and it never takes clicks. A failed kernel keeps its own message.
- **Bodies before they are drawn:** the Bodies folder lists the bodies the last
  session made at once, as muted rows with a small cube where the count would be;
  the eye works, selection waits. The first finished recompute replaces them.
  With no cache and features to compute, the folder shows a muted "Computing
  bodies…" with a small cube instead of "No bodies yet" until that recompute ends.

## 8. Error messages

Plain language, with the fix if we know it:

- ✕ "Fillet failed: radius 5 mm is larger than this edge allows (max ≈ 2.4
  mm)." [Set to 2.4 mm]
- ⚠ "Extrude 3 lost its target face after you edited Sketch 1. We picked the
  closest match." [Review] [Pick again]
- ✕ "Parameter `wall` refers to itself: wall → lid_gap → wall."

### 8.1 Graphics problems (ADR-0076)

- **Software rendering** (the browser draws 3D without the graphics card): the
  status bar says "Software rendering" and a one-time toast says "Your browser
  draws 3D without the graphics card, so the view may be slow. Turn on
  hardware acceleration in your browser's settings, or update your graphics
  driver." [Don't show again].
- **No WebGL 2**: the view area shows "Extrudo can't draw the 3D view in this
  browser" with what to try (hardware acceleration: Chrome and Edge, Settings ›
  System › "Use graphics acceleration when available"; Firefox, Settings ›
  Performance; chrome://gpu to see why; software drawing in a VM; a driver
  update; another browser), "Your design is safe…" and [Try again]. In a
  Chromium-based desktop browser the panel leads with "Open a window that draws
  in software": a ready-to-copy command (`[data-swiftshader-command]`, Copy)
  that starts a separate profile with `--enable-unsafe-swiftshader
  --use-angle=swiftshader --app=<this site>`, then "Then open Extrudo in that
  window. The view will be slower than with a graphics card.", why it is a
  separate window (the setting lets websites run graphics code on the
  processor, which Chrome keeps off by default for safety) and that designs are
  per profile (Home › Export Design here, Home › Files › Import Design there). Brave, Opera, Vivaldi and other Chromium browsers get the flags and a separate `--user-data-dir` instead of a command (`[data-swiftshader-flags]`); the Copy button copies `edge://gpu` on Edge, `chrome://gpu` otherwise. The timeline, browser, parameters, customizer and export keep
  working.
- **The view crashed**: "The 3D view stopped working" with the error and
  [Try again]. **The driver reset** (context lost): "The graphics driver reset
  the 3D view" with [Reload view]; it clears by itself if the browser restores
  the context.
- **Any other crash**: a full page, "Something went wrong", the error text,
  "Your work is saved" and [Reload] (which saves first). Never a white page.
