# ADR-0008: Viewport, camera and navigation

- **Status:** Accepted, 2026-09-25
- **Task:** P0-05 (viewport). Code: `apps/web/src/viewport/`.
- **Affects:** P1-01 (sketch on a plane: Look At animation, origin planes),
  P1-02 (sketch tools: picking on the canvas), P2-08 (bodies), named views,
  every screenshot test.

## Context

P0-05 asks for the R3F canvas, an adaptive infinite grid, the origin planes,
axes and point, camera controls with the Fusion mouse mapping and presets
(FR-VP-01), a ViewCube with faces, edges, corners, home and rotate arrows
(FR-VP-02), perspective/orthographic and four visual styles (FR-VP-03), and
the grid and origin (FR-VP-04). The brand fixes the look: a glowing
background, a faint grid that fades out radially (major lines twice as
strong), 350 ms camera transitions with the UI curve, and instant motion
under `prefers-reduced-motion` (docs/05-brand.md §3.1, §5). The E2E test
clicks the ViewCube's Top face and checks the camera orientation.

## Decision

1. **World: Z-up, millimetres.** XY is the print bed, as in slicers. Front
   looks from −Y, Right from +X, Top from +Z. Standard views keep +Z up; Top
   has +Y up (front edge at the bottom of the screen) and Bottom has −Y up, as
   if the front view had been tilted over. Home is front-right-top.
2. **Our own camera controller, as pure functions** (`viewport/camera.ts`).
   A view is `{ target, orientation (quaternion), size }`, where `size` is the
   visible height through the target in mm. Both projections derive from it,
   so switching perspective ⇄ orthographic keeps the model the same size at
   the target. Orbit is a turntable about world Z plus a tilt about the screen
   right axis; `turn` rotates about a camera axis (ViewCube arrows, roll).
   Pan keeps points on the target plane under the cursor; zoom keeps the point
   under the cursor on the target plane fixed, which in perspective moves the
   camera along the cursor ray. Fit frames a bounding sphere (25 % margin,
   corrected for the perspective camera being nearer the sphere's front).
   Transitions interpolate target (linear), orientation (slerp) and size
   (geometric) over 350 ms with `cubic-bezier(.2, .8, .2, 1)`.
3. **A viewport store in the web app** (`viewport/store.ts`, vanilla
   Zustand, one per open document), not in core's session store. The camera
   changes on every pointer move and uses three.js math, which core must not
   depend on. It holds the view,    the running transition (advanced by
   `step(now)` from the render loop, so tests drive it with a fake clock),
   the scene bounds for fit, the nav-bar tool, and the display settings:
   projection, visual style, grid, mouse preset and origin visibility. The
   settings are user preferences (`Platform.preferences`); the camera is not
   saved. Named views convert a `View` to the schema's
   `{ projection, position, target, up }` (and `size` for orthographic; the
   amendment of 2026-10-10).
4. **Mouse mapping as tables** (`viewport/navigation.ts`): one pure function
   from button + modifiers to orbit/pan/zoom per preset. Fusion (the
   default until 2026-09-27; see the amendment):
   middle-drag pans, Shift+middle orbits, wheel zooms, middle double-click
   fits. Blender: middle orbits, Shift pans, Ctrl zooms. Onshape/SolidWorks:
   right orbits, middle pans, Ctrl+right pans. Trackpad: two-finger scroll
   pans, pinch (a Ctrl+wheel event) zooms, Alt+drag orbits. The nav-bar
   Orbit/Pan/Zoom tools turn a left-drag into that action until Esc. F6 fits.
5. **The ViewCube is DOM, not WebGL**: 6 faces × a 3 × 3 grid of buttons in a
   CSS 3D transform that follows the camera (`matrix3d` of the inverse
   rotation with y flipped; no CSS perspective, so it is orthographic). It is
   crisp, themed by the tokens, reachable by keyboard (the six face buttons)
   and clickable by Playwright by name. Edges and corners are the side and
   corner cells; hovering one lights all its cells. Dragging the cube orbits.
   Face-on views show four turn arrows and two 90° roll arrows. The transform
   updates through a store subscription, not React renders.
6. **The grid is one shader quad** under the camera target. Each pixel picks
   its level from its own footprint (`fwidth`): minor lines at a power of ten
   mm between 6 and 60 px apart, the next level up as major lines at twice the
   alpha, with a smooth cross-fade, so spacing adapts to zoom and to distance
   in perspective. It fades out radially (0.1 → 0.95 view sizes from the
   target) and at grazing angles. The X and Y axes are drawn by the same
   shader; the Z axis is a line that fades the same way. The origin planes are
   hidden by default (as in Fusion) and toggled from the Browser's Origin
   folder; they and the Z axis scale with the view so they keep their screen
   size.
7. **Scene colours come from the design tokens** at runtime (read from
   `<html>`, re-read when `data-theme` changes). New tokens:
   `--x-body-default`, `--x-edge` (brand §3.4) and `--x-axis-x/y/z`.
8. **Bodies** come from the model store: one `BufferGeometry` per body,
   B-rep edges as `LineSegments2` (screen-space width). Styles: shaded;
   shaded with edges (default); shaded with hidden edges (a second edge pass
   with `GreaterDepth` at a third of the opacity); wireframe (edges only).
   Faces use a polygon offset so edges win the depth test. **Seam edges are
   not drawn**: the kernel facade flags each edge that is closed on one of its
   faces (`BRep_Tool::IsClosed`, `BodyMesh.edgeFlags` bit `EDGE_SEAM`), such
   as the line where a cylinder meets itself. It is a real B-rep edge but
   looks like a stray line in a hole. Silhouettes of curved faces, the lines
   people expect there instead, are view-dependent and come with P2-08.
9. **The canvas renders on demand** (`frameloop="demand"`): a store change
   or a running transition asks for a frame. The camera rig owns a
   perspective and an orthographic camera, both `manual`, and sets their pose
   and frustum from the view each frame.
10. **Test hooks:** the viewport element carries `data-camera-direction`,
    `-up`, `-target` and `-size` (rounded), a `role="status"` region names the
    view at rest ("Top view", "Top Front Right view"; also useful to screen
    readers), and `data-ready` is set after the first frame, so screenshots
    never catch an empty canvas.
11. **The viewport is a lazy chunk.** R3F and the scene (580 kB) load after
    the shell paints. three.js's core (~380 kB) stays in the main chunk: the
    viewport store uses its math and `three.core` doesn't tree-shake, so the
    chunk-size warning limit is 1000 kB.
12. **`#/debug/kernel` draws the test part in the real viewport**, which is
    where the visual styles are tested on real geometry until the recompute
    pipeline fills the shell's model store.

## Rejected options

- **camera-controls (drei `CameraControls`):** spherical coordinates, so no
  roll (the ViewCube's roll arrows) and a pole at top/bottom; transitions are
  damped, not a fixed 350 ms; modifier-based mappings need patching the
  button table on every key press. **three's OrbitControls /
  TrackballControls:** same pole problem, or no fixed up; neither does
  zoom-to-cursor in both projections with one size.
- **drei's `GizmoViewcube`:** drawn in WebGL in a second viewport, so no
  keyboard access or accessible names, and Playwright would click pixels.
- **Camera state in core's session store:** core has no three.js, and the
  camera changes per frame; nothing outside the viewport needs it yet.
- **A textured or line-mesh grid:** fixed spacing, aliasing at a distance, and
  a rebuild on zoom. The shader adapts per pixel at no CPU cost.
- **Dashed hidden edges:** `LineMaterial` dashes are in world units, so they
  would need rescaling on every zoom; faint solid lines read clearly enough.
- **Writing our own vector/quaternion maths** to get three.js out of the main
  chunk: about 100 lines and a second set of tests to save ~110 kB gzipped on
  first load, well inside NFR-02. Revisit with the bundle-size budget.

## Consequences

- Orbit pivots on the target, and zoom anchors on the target plane, not on
  the geometry under the cursor. Picking (P1-02 / P2) can add a depth pick for
  both.
- Touch gestures are not mapped yet (touch drags do nothing on the canvas).
- Named views stayed disabled in the nav bar until the 2026-10-10 amendment,
  which wires both places up (save, restore, rename, delete).
- **P1-01** uses `lookFrom` (or `animateTo`) for the Look At animation and the
  origin planes for sketch-plane selection; hover highlight of origin items
  comes with P2-08.
- Screenshot baselines now include WebGL output; SwiftShader renders it the
  same in the Arch and Ubuntu Playwright images (checked 2026-09-25).

## Amendment, 2026-09-27 (pointer modes)

- **One pointer mode at a time.** The nav bar starts with **Select**,
  then Orbit, Pan and Zoom. Select is pressed whenever no nav tool and no
  command runs; the viewport learns about commands through
  `commandRunning` and `onStopCommand` (the shell passes "a sketch tool
  draws or Create Sketch waits for a plane", and stopping them). Pressing
  Select clears the nav tool and stops the command. Starting a command
  (the session's `activeTool` becomes set) clears the nav tool.
- **Cursors per nav tool.** All three tools used to show the open hand.
  `viewport/cursors.ts` gives Pan the hand (closed while dragging), and
  Orbit and Zoom small SVG cursors (a circular arrow, a magnifier; white
  over a dark outline, falling back to `move` and `zoom-in`). A
  navigation drag without a tool (middle button) shows the cursor of what
  it does. The cursor is an inline style on the pointer surface, which
  also carries `data-cursor` (the tool or drag) for tests.
- **No browser context menu in the way of right-button orbiting.** The
  viewport used to cancel `contextmenu` only over the canvas and
  pass-through overlays, so a right-press on the nav bar, the ViewCube or
  the sketch palette opened Chromium's "Copy / Select all" menu. Now the
  whole viewport cancels it except in text fields (`isEditable` from
  `commands/shortcuts.ts`), the shell cancels it on the window while a
  project is open (except text fields, links and selected text; our own
  Radix menus open as before), and for 400 ms after a right-button drag it
  is cancelled wherever the button comes up.
- **Onshape / SolidWorks is the default preset and first in the menu**
  (the owner's choice, 2026-09-27): right-drag orbits, middle-drag pans.
  Stored preferences are kept, so anyone who already has a preset saved
  keeps theirs. FR-VP-01 changed with it. The marking menu (UI spec §3.3)
  will have to open on a right-click without movement.
- **Extrudo is the default preset and first in the menu** (the owner's
  choice, 2026-09-28): Onshape's buttons swapped, so middle-drag orbits
  (Ctrl/Cmd+middle-drag pans) and right-drag pans; the left button is
  unchanged. Onshape / SolidWorks stays second in the menu. As before,
  stored preferences are kept: whoever saved any display setting keeps
  the preset stored with it and picks Extrudo in the Mouse controls menu.
- **Fit frames the box, not a sphere** (user report: F6 zoomed out too
  far). `Bounds` carries the axis-aligned box of what's shown (bodies,
  sketch curves and points, placed dimension labels); `fitBox` projects
  its corners on the view's right and up axes and fits them with a 15 %
  margin, refining the size a few times for perspective (a nearer corner
  looks bigger). A circle seen face-on now fills 87 % of the height
  instead of 54 %. An empty document still fits the sphere around the
  origin area (`EMPTY_BOUNDS`), so its home view is unchanged.
- **No stuck selection box.** A left press in a sketch whose release came
  up outside the view (over the nav bar or a menu) stayed recorded, and
  the next move over the view drew a box with no button held. A window
  `pointerup` now ends such a press (a drag or box finishes, an unmoved
  press is dropped), and a move with the button no longer held drops a
  stale press; navigation drags end the same way.

## Amendment, 2026-09-28 (off-centre views for a floating panel)

- **`View.shift`**: where the target shows across the view, in NDC (absent
  or 0: the middle). Fit (F6, Home, the ViewCube, opening a sketch) sets it
  to the fraction of the view's width the browser covers
  (`ViewportState.cover` in px over `width`, set by `setCover` and
  `setAspect(aspect, width)`), after fitting into the open part's aspect.
  The target stays on the model, so orbiting and zooming behave as before;
  the model shows in the middle of the open part. Pans and orbits keep the
  shift; animations interpolate it; the browser toggling doesn't change the
  view (no jump) — the next fit uses the new cover.
- Rendering applies it as an off-axis frustum (`camera.setViewOffset`, in
  `viewport/applyView.ts`; for a perspective camera the call also sets
  `aspect`, so it gets the view's real proportions). `viewRay`,
  `viewProject`, `zoomAt` and `pick.ts`'s projector add or remove the
  shift, so picking and overlays follow; `applyView.test.ts` checks
  three.js's projection against `viewProject` and `viewRay` in both
  projections with and without a shift.
- The Viewport region carries `data-camera-shift`; the e2e helpers
  `mapping` and `projector` use it.

## Amendment, 2026-10-10: saving named views

The schema's `doc.views` (`NamedViewSchema`, file format §4.3) existed from
the start and the nav bar's and the browser's Named views places were
placeholders; nothing wrote to it. Now it works:

- **Core commands** (`document-commands.ts`, one undo step each, the caller
  passes the ID): `saveView({ id, name, camera })`, `updateView({ id, name?,
  camera? })` (rename, or overwrite the camera, or both) and `removeView({
  id })`. Names are trimmed and can't be empty; a name taken by another view
  gets the next free "`<name>` 2" (`uniqueViewName`), and the default name is
  "View1", "View2"… the lowest number no view uses (`defaultViewName`, as
  `newBodyNames` works). Views are never referred to by anything, so a delete
  is always allowed.
- **The camera is `ViewCamera`** (`schema.ts`): `projection`, `position`
  (the camera's own point), `target`, `up`, plus an optional `size` —
  **orthographic only** (added with this amendment; no version bump, an
  optional field). A perspective camera sits `perspectiveDistance(size)` from
  the target, so its position fixes the size; the orthographic camera sits
  far back at a distance that depends on the zoom, so without `size` an
  orthographic view could not be restored exactly. `viewToCamera` /
  `cameraToView` (`viewport/namedView.ts`) convert both ways; restoring is
  exact within 1e-6 in both projections. The `View.shift` of a fit is not
  saved: the target restores centred, orbiting unchanged.
- **Saving** reads the live camera from the viewport store and dispatches
  `saveView` — a normal command, so the design marks unsaved and undoes with
  the rest. **Restoring** sets the saved projection and animates the camera
  through the store's standard move (`animateTo`, the one Shift+1… use): view
  state, never a command, never undoable, never unsaved.
- **UI:** the nav bar's Named views button is always enabled; its menu lists
  the views by name (click to restore) above "Save Current View…", which
  opens a small popover anchored on the button (a Name field prefilled with
  `defaultViewName`, Save/Cancel; Enter/Esc). The Ctrl+K command of the same
  name opens the same prompt (`viewport/namedViewSave.ts`, a shared open
  flag); one "View: `<name>`" command per view restores it — no keys. The
  browser's Named views rows restore on a click, and their right-click menu
  has Restore, Update to Current View, Rename (F2) and Delete.
- **Not here:** thumbnails per view, saving section or display settings with
  a view, and keyboard slots for views stay out (the owner's request was
  save/restore/rename/delete).
