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
   depend on. It holds the view, the running transition (advanced by
   `step(now)` from the render loop, so tests drive it with a fake clock),
   the scene bounds for fit, the nav-bar tool, and the display settings:
   projection, visual style, grid, mouse preset and origin visibility. The
   settings are user preferences (`Platform.preferences`); the camera is not
   saved. Named views will convert a `View` to the schema's
   `{ projection, position, target, up }`.
4. **Mouse mapping as tables** (`viewport/navigation.ts`): one pure function
   from button + modifiers to orbit/pan/zoom per preset. Fusion (default):
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
- Named views stay disabled in the nav bar; the Browser lists the document's.
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

