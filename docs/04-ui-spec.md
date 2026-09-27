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
  views.
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

### 3.1 Mouse and keyboard navigation (Fusion preset)

| Action | Input |
|---|---|
| Orbit | Shift + middle-drag (also ViewCube drag) |
| Pan | Middle-drag |
| Zoom | Wheel (zooms toward the cursor) |
| Fit all | F6 or double-click middle |
| Look at selection | Nav bar "Look at" |

Other presets: Blender (MMB orbit, Shift+MMB pan), Onshape/SolidWorks (RMB
orbit), Trackpad (two-finger pan, pinch zoom, Alt+drag orbit).

### 3.2 Selection

- Hover → pre-highlight (light category tint). Click → select (strong
  highlight). Shift or Ctrl+click → toggle.
- Drag left-to-right = **window** (fully inside); right-to-left = **crossing**
  (touching). The rectangle style differs (solid vs dashed).
- Long-press, or right-click → "Select other…", lists the stacked geometry
  under the cursor.
- The selection filter will live with the nav bar's Select (P2-03).
- Esc clears the selection, or cancels the active tool (or a drag in
  progress, putting the geometry back).

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

## 4. Sketch mode

- Enter by: Create Sketch → pick a plane or face; double-click a sketch in the
  browser or timeline; right-click → Edit Sketch.
- The camera animates to look at the plane (can be turned off). The grid
  aligns to the sketch plane. Bodies are optionally sliced or dimmed.
- **SKETCH tab groups:** CREATE (line, rectangle ▾, circle ▾, arc ▾, polygon
  ▾, slot ▾, ellipse, spline ▾, point, text, mirror, pattern ▾, project ▾,
  dimension) · MODIFY (fillet, chamfer, trim, extend, break, offset,
  move/copy, scale) · CONSTRAINTS (row of constraint icons) · INSPECT ·
  EXPORT (the sketch or its profiles as SVG or DXF, P1-13) ·
  **FINISH SKETCH** (big green ✓).
- **Sketch palette (right panel):** construction toggle, look at, sketch grid,
  snap, slice, show profiles, show points, show dimensions, show constraints,
  DOF counter ("3 DOF left", "Fully constrained ✓", or "Over-constrained").
- **Selecting and editing (no tool running):** hover pre-highlights; click
  and box select points and curves; dragging geometry moves it (or the whole
  selection) with a live solve. A **properties panel** in the view's
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
`apps/web/src/commands/keymap.ts`; P, Q and J wait for their tools.

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
