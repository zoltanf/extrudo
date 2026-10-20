# E2E notes: selectors, data attributes and traps per spec

Moved out of `CLAUDE.md` on 2026-10-12. Read the entries for the specs you write or change (`grep -n "<spec name>"`).

## General

- **Playwright `webServer` must not start through pnpm.** `pnpm --filter …
  preview` and `pnpm exec` leave Vite running after the tests, and the run
  never ends. The config starts `node node_modules/vite/bin/vite.js` with
  `cwd: 'apps/web'`, bound to `127.0.0.1` (Vite otherwise binds IPv6 `::1`
  only while Playwright polls IPv4).

- Playwright's own Chromium headless shell works on the Arch workstation. If
  it ever breaks, set `PLAYWRIGHT_CHROMIUM_PATH=/usr/bin/chromium`. The
  Ubuntu machine uses `/usr/bin/google-chrome-stable` (see Dev machines).

- **Screenshot baselines** (`e2e/*-snapshots/`) are made locally on the Arch
  workstation and must pass in the Playwright Ubuntu image, which renders
  like CI (on the Ubuntu machine take them from CI's artifact instead: Dev
  machines). Check with
  `echo "docker run --rm --ipc=host -e CI=1 -v $PWD:/work -w /work --user
  $(id -u):$(id -g) -e HOME=/tmp mcr.microsoft.com/playwright:v1.63.0-noble
  node node_modules/@playwright/test/cli.js test e2e/shell.spec.ts" | newgrp
  docker` (after `pnpm build`). Arch and Ubuntu differ by about 12 pixels per
  shot; the tolerance is 0.1 %.

- **CI shards by duration.** `E2E_SHARD=<current>/<total>` (set by `ci.yml`,
  four shards) makes `playwright.config.ts` give each project only that
  shard's spec files: `scripts/e2e-shards.ts` deals the files longest first to
  the least loaded shard, using the per-file seconds in `e2e/timings.json`
  (a file not listed there counts as the median). Playwright's own `--shard`
  splits by test count in file order, which put the benchmarks together
  (22.7 min against 8.5, 2026-10-18). `node scripts/e2e-shards.ts plan` shows
  the split. When a shard runs much longer than the others, or a heavy spec is
  new, regenerate the timings from a CI run's `playwright-results-<shard>`
  artifacts: `node scripts/e2e-timings.mjs <run-id>` and commit the JSON.
  Locally, without `E2E_SHARD`, nothing changes; `E2E_SHARD=1/4 … test --list`
  shows one shard. Runner speed varies between runs (the same tests took 1.4×
  longer on one run than on the one before), so compare shards within a run. The `webkit` project's spec is one of the files, and only
  the shard that gets it installs WebKit (`node scripts/e2e-shards.ts browsers`).

- **WebKit** (the `webkit` project, `e2e/webkit-smoke.spec.ts` only; CI
  installs it with `playwright install --with-deps chromium webkit` in the
  shard that has the spec): on the
  Arch workstation `pnpm exec playwright install webkit` downloads the Ubuntu
  build, which cannot start there (`libicu74`, `libxml2.so.2`, `libflite1`
  are missing); run it in the Playwright image as for the baselines, with
  `--project webkit`. Playwright 1.63's WebKit is 26.6 and **has
  `Symbol.dispose`**, so it cannot reproduce the "Object is not disposable."
  bug the polyfill fixes. To test that path for real, use WebKit 26.0: in the
  image, `npm i playwright@1.56.0` in a scratch folder, `PLAYWRIGHT_BROWSERS_PATH=<scratch>/browsers
  npx playwright install webkit`, and drive the app from a plain script with
  that `playwright` package (the test runner's helpers need the repo's newer
  one). Checked 2026-10-18: unfixed main (app.extrudo.org) in 26.0 shows
  `profiles=1 holes=0` after the rectangle (profile detection runs on the UI
  thread) but the kernel logs `TypeError: Object is not disposable.` twice,
  Sketch1 gets an error badge, and Extrude says "Needs Sketch1, which has an
  error."; the branch build gives `data-bodies="Body1:6:40,30,10"` with no
  console error. No toast appears either way.

- **E2E tests start on the home screen with empty storage** (each test has
  its own browser context). Open a project with `openProject(page)` or
  `openProject(page, 'wall-bracket')` from `e2e/helpers.ts`; reloads reopen
  the same stored project. Stub browser APIs with a string init script (for
  example `navigator.storage.persist`), since e2e/ has no DOM types.

- **Regenerate screenshots with `--update-snapshots=all`.** Plain
  `--update-snapshots` only rewrites shots that fail, and a small change (the
  save-state text) stays inside the 0.1 % tolerance, leaving a stale baseline.

- **Viewport tests read the camera from data attributes** on the Viewport
  region (`data-camera-direction`, `-up`, `-target`, `-size`) and wait for
  `data-ready` (first frame drawn; the viewport is a lazy chunk). WebGL runs
  on SwiftShader in headless Chromium (unless `E2E_GPU=1`) and renders the
  same in the Arch and Ubuntu images.

- E2E specs typecheck without the DOM library: pass browser-side code to
  `page.evaluate` as a string (`'document.fonts.ready.then(() => true)'`).

- **The browser pane's `left_click_drag` sends press and release with no
  move between**, and its screenshots can lag one action behind; read state
  with `javascript_tool` (the summary attribute) rather than trusting a
  screenshot taken right after an action. The viewport treats a press and
  release more than 5 px apart as a drag even without moves.

- Playwright's `toHaveAccessibleDescription` reads nothing from an
  `<output>` element referenced by `aria-describedby`; use a `<div>` with
  `aria-live` for field messages.

- **Toolbar menu items' accessible names end with the shortcut** ("Trim T"):
  in Playwright match them with a regex, not `exact: true`.

- **The browser floats over the view** (ADR-0007/0008 amendments,
  2026-09-28): the Viewport region spans the whole work area, the
  browser covers its left edge, and fit centres the model in the open
  part through `View.shift` (the Viewport region's `data-camera-shift`,
  NDC). Map view px with `mapping()`/`projector()` from `e2e/helpers.ts`
  (they read the shift); code that assumes the origin at the box's
  middle is off by `shift × width / 2`. Toggling the browser doesn't
  move the camera; the next fit uses the new width.

- **The collapsed browser is invisible and inert, not removed** (design
  review, ADR-0007 amendment): the complementary "Browser" still exists;
  check it with `toBeHidden()`, and "Show browser" is a small tab over the
  viewport. Toggling animates (200 ms); read widths with `expect.poll`.

- **The status bar's render rate** (`[data-render-stats]`, "58 fps · 1.4
  ms" or "idle · …") varies between runs: `e2e/screenshot.css` hides it in
  every `toHaveScreenshot` (`stylePath` in `playwright.config.ts`). Put
  anything else that varies there too.

- **The default Top view doesn't show a 100 × 80 mm sketch** (P1-15): at
  1440 × 900 it is 3.5 px/mm around the origin, the sketch palette covers
  x > ~95 mm and y = 80 mm is above the view; clicks there are lost. Zoom
  out first, **one `mouse.wheel` at a time**, waiting for
  `data-camera-size` to change (headless Chromium delivers wheel deltas
  unevenly: one `wheel(0, 200)` zoomed 1.06×, eight in a row about 9×),
  then call `mapping(viewport)` again. The snap grid stays at 10 mm up to
  0.83 mm per pixel (`gridStep`). `newSketchOnXY` opens a sketch in a
  project that is already open (after setting up parameters, say).

- **An edit right before `page.reload()` survives** through the rescue
  copy (`platform/rescue.ts`, ADR-0009 amendment), which the next start
  saves; tests that check the stored project itself (the home screen,
  exports) may still wait for the save status "Saved" first.

- **Every open project starts a kernel worker** (P2-01), so every e2e test
  compiles the OCCT WASM. Wait for the first recompute with
  `kernelReady(page)` (`e2e/helpers.ts`: the status bar's "Kernel" output,
  `data-model-status="ready"`) before screenshots or status checks. The
  Wall bracket template computes one body, "Bracket" (40×80×60 mm, 12
  faces); Fillet1 computes since P3-01, and only rolling forward brings in
  Plane1, the template's placeholder of the old `plane` type, which stays an
  error on purpose ("Plane1 (error)", "6 features · mm · 1 error";
  "(rolled back)" Plane1 has no status).
  Sketch1/Sketch2 can't be deleted while the extrudes use them. Error
  toasts have role `alert` and sit in the view's bottom-right corner (at
  the foot of the sketch palette in a sketch): dismiss them ("Dismiss")
  before clicking there. An **open feature dialog moves that corner's
  toast stack clear of its own column** (`DIALOG_COLUMN`), so a click on
  the dialog's OK is never swallowed by the 12-second "Sketch1 is hidden…"
  notice (P4-11; before that, a second extrude's OK click waited out the
  toast and cost the flow ~11 s). Under the full parallel run B1 takes
  about 27 s (60 s timeout).

- **Pointer modes** (ADR-0008 amendment): the nav bar's "Select" button
  is `aria-pressed` when no nav tool or command runs. The viewport's
  pointer surface (`div.touch-none` in the Viewport region) carries the
  cursor as an inline style and `data-cursor` (orbit/pan/zoom); check
  with `toHaveCSS('cursor', 'grab')`, not a class. A menu-only tool marks
  its group's trigger (e.g. "Create") with `data-active`.

- **Parallel worktrees**: `E2E_PORT` sets Playwright's port (default
  4173); give each checkout its own, or `reuseExistingServer` tests
  another checkout's build. A new worktree needs the WASM `dist` folders
  (copy them, or `pnpm wasm` once CI has published the release).

- **Tutorials e2e** (`e2e/tutorials/<name>.spec.ts`, ADR-0080 §4, P6-06 S5): a page
  in `docs/guide/tutorials/<name>.md` has a `<!-- step: <slug> -->` marker, a `###`
  heading, text and `![alt](./images/<name>/<slug>.png)` per step; the spec does
  `const { step } = tutorial(page, '<name>')` (`e2e/tutorials/step.ts`) and one
  `await step('<slug>', actions, check)` per marker, in the same order
  (`apps/site/src/tutorials.test.ts` checks the pairing, the pictures and names the
  slug). Without `RECORD_ASSETS` a step only checks; **`pnpm demos -g tutorials`**
  (`scripts/record-demos.mjs`, `--skip-build` when `dist` is current) runs the folder with
  `RECORD_ASSETS=1`, which saves the whole 1440 × 900 page, reduced to 256 colours
  (80-105 kB; full colour was 570 kB), to `docs/guide/tutorials/images/<name>/`. **Look at every picture**, and
  dismiss toasts before it (the recorder does). The Viewport region leaves the
  accessibility tree under a modal dialog, so step.ts settles on `[data-camera-size]`.
  Tutorial 1 (`first-part`) is B1's flow plus an extrude and an STL export; the shared
  `dimension()` helper lives in `benchmark-helpers.ts`.

## Specs

### `e2e/a11y.spec.ts`

- **Accessibility e2e** (`e2e/a11y.spec.ts`): axe per screen, both themes;
  a new violation fails with its node HTML. Add an entry to `KNOWN` only with
  a reason. Toasts behind a modal dialog are inert for assistive tech (and
  for `getByRole`): say results inside the dialog (the Versions dialog's
  status line "Versions status").

### `e2e/auto-project.spec.ts`

- **Auto-project e2e** (`e2e/auto-project.spec.ts`, P6-07): a Box primitive
  40 × 40 × 20, then Create Sketch on its top face (world (0,0,20)); the face
  sketch opens fitted tight, so `zoomOutTo(page, at(0,0), 150)` before clicking
  the top-right corner (a body vertex). The Line tool's first click at sketch
  (20,20) snaps to that vertex; after the kernel recompute the sketch palette's
  `data-sketch-summary` counts the `coincident` (the projected vertex is a
  point, so `data-sketch-projected` reads `<id>:curves=0:x=20..20:y=20..20` —
  **the summary now lists a point-only projected vertex**, `curves=0`); one
  Ctrl+Z after Finish Sketch takes the line, the projection and the constraint
  away and Ctrl+Shift+Z brings them back; the palette's checkbox "Auto-project"
  (`exact`, the second checkbox is "Auto-project face outline") off leaves the
  corner a plain grid snap with no projection; checking "Auto-project face
  outline" first makes the next sketch on the face start with
  `<id>:curves=4`. **Slice 2** adds three tests: with a Line drawn with Ctrl
  held (no inference; endpoints at (5,0)-(5,10)), the **Coincident** tool
  (group "Constraints") picks the line's end and the Box's (20,20) vertex, the
  **Parallel** tool picks the line and the top face's far edge at (0,20), and
  the **Dimension** tool (`d`) picks the line's end, the vertex and a label
  spot; each shows in `data-sketch-summary` (`constraints=1`/`dimensions=1`)
  and `data-sketch-projected` after the recompute, and one Ctrl+Z takes it and
  its projection away. A constraint tool's click is the point/line nearest the
  cursor first, so click the body geometry where no sketch entity is near.
  The 2026-10-07 review adds a test snapping a Line end to a Ø40 Cylinder's
  **curved** top rim (a point on a curved edge is still allowed): it projects
  the circle (`<id>:curves=1`) and holds the point on it.
  `--repeat-each=2`. `openSketch` (moved to `e2e/helpers.ts`) waits for a
  sketch id that was not shown before the call — the last `data-sketch-frames`
  entry can still be an older sketch's while the new one's face pick resolves
  its kernel reference (`sketchOnFace`), and that wrong id was the face-outline
  test's CI flake (plane picks are synchronous, so the snapshot already names
  them and it falls back to the last shown).

### `e2e/benchmark-b1.spec.ts`

- **Benchmark e2e** (`e2e/benchmark-b1.spec.ts`, `-b2`, `-b3`; helpers in
  `e2e/benchmark-helpers.ts`): a new parameter's unit is the New parameter
  row's select (`Length` unless you pass `'angle'` to `addParameter`), and
  `floor` is an expression function: don't name a parameter that. In a
  sketch on a face the camera is perspective and looks at the body's
  middle, not the plane, so map sketch points with `projector(viewport)`
  at the plane's world coordinates (`flat([x, y, z])`), never the flat
  `mapping()`; a face sketch opens fitted so tight that its edges sit
  under the nav bar: `zoomOutTo(page, point, 150)` first, one wheel step
  at a time. On a YZ sketch the sketch x is world Y and y is world Z
  (camera direction `-1,0,0`). The origin is no entity: a Point tool click
  at (0, 0) is auto-fixed and dimensions can start from it. Offset takes a
  whole projected face outline (its ends that meet are one joint, P3-17; B2
  uses it): `o`, click a side, move to the inside, type a number (letters
  don't go to the heads-up box: `wall` would start the Line tool), Enter,
  then double-click a dimension label and fill in `wall` (the other three
  follow the first).
  A `d` dimension on two parallel lines is their distance; on two lines
  that meet it is the angle (the label's sector picks it). The Constraints
  group ("Parallel") lives in the toolbar, not the palette. `data-bodies`
  rounds sizes to 0.1 mm. `exportProject(page, 'b2-storage-box.extrudo')`
  writes `fixtures/benchmarks/` only with `WRITE_FIXTURES=1`. Each spec
  takes about 20 s alone (B3 about 30 s); on the Ubuntu machine run with
  `PLAYWRIGHT_CHROMIUM_PATH=/usr/bin/google-chrome-stable` (no Playwright
  browser installed there).

### `e2e/benchmark-b2.spec.ts`

- **B2** (P2-17, 120 s timeout, about 40 s alone): a parametric storage box
  cut from a solid, built with `benchmark-helpers.ts` (`addParameter`,
  `openParameters`/`closeParameters`, `renameProject`, `newSketchOnXY`,
  `zoomOutTo`, `dimension`, `exportModel`, `exportProject`, `objectsOf3mf`,
  `meshOfStl`, `solidFacts`, `round`, `expectNoProblems`, `settled`, `attr`,
  `toolPrompt`, `viewportOf`).

- Sketch1 on XY is a rectangle from the origin dimensioned `width` × `depth`;
  uncheck "Show constraints" and `blur()` it first (a coincident glyph sits on
  the origin corner); the labels read `fx: 80.00`, `fx: 60.00` and the palette
  says "Fully constrained". Extrude1 pick the profile at (40, 30), Distance
  `height` → `Body1:6:80,60,40`.

- Sketch2 on the top face: click `projector(viewport)([40, 30, 40])`, press
  `p` to project the outline (`data-sketch-projected`
  `:curves=4:x=0..80:y=0..60$`), then `zoomOutTo(world([40,30,40]), 150)`; the
  camera is perspective, so map points with `projector`, not `mapping`. Offset
  (`o`) takes the outline, the inside and a typed 3 (inward; first distance
  becomes `wall`), and all four labels read `fx: 3.00`.

- Extrude2 cuts `-(height - bottom)` to `Body1:11:80,60,40`;
  `setParameters({width:'100 mm',depth:'70 mm',wall:'4 mm'})` gives
  `Body1:11:100,70,40`. The 3MF (`objectsOf3mf`) and STL (`meshOfStl`) are one
  object `Body1`, `solidFacts.size` [100, 70, 40], volume
  `boxVolume(100,70,40,4,4)` ±0, same triangle count.

- `exportProject(page, 'b2-storage-box.extrudo')` writes
  `fixtures/benchmarks/` only with `WRITE_FIXTURES=1` (see the B1 notes).

### `e2e/benchmark-b3.spec.ts`

- **B3** (P2-17 + P3-06, 150 s timeout): a phone stand of two bodies combined,
  with `benchmark-helpers.ts` (`addParameter`, `selectBodies`,
  `expectNoProblems`, `exportModel`, `exportProject`, `objectsOf3mf`, `round`,
  `setParameters`, `settled`, `solidFacts`, `toolPrompt`, `viewportOf`,
  `zoomOutTo`). Parameters: `width`, `depth`, `base`, `setback`, `rest`,
  `rise`, `tilt` (passed `'angle'`).

- Sketch1 on XY is `width` × `depth`; Extrude1 `base` → `Body1:6:60,80,10`.
  Sketch2 on YZ (camera direction `-1,0,0`; sketch x is world Y, y is world
  Z): a `Point` at the origin is auto-fixed, a five-line parallelogram from
  (50,10) (60,10) (80,70) (70,70) (50,10), `Parallel` on its two sides, five
  dimensions (`fx: 50.00`, `10.00`, `10.00`, `60.00`, `70.00°`). Zoom out
  around `projector[0,40,35]` before picking.

- Extrude2 `width` → a second body `Body2:6:60,<lean+10>,60`, `lean = 60 /
  tan(70°)`. Combine1 (`selectBodies(['Body1','Body2'])`, target Body1, tool
  Body2) joins them, `data-folder-count` goes 2 → 1.

- `setParameters({base:'12 mm',rise:'70 mm',tilt:'65 deg'})` moves the back
  edge to `backY = 60 + 70/tan(65°)`; the 3MF is one `Body1`, size [60, backY,
  82], volume `standVolume` ±0. Fixture via
  `exportProject(page,'b3-phone-stand.extrudo')` (`WRITE_FIXTURES=1`).

- ADR-0093: the `rest` label goes at (55,-6), below the world Y axis: after a
  horizontal line, a click on that parallel axis is now a second pick (a
  dimension to the axis), not the label's place.

### `e2e/benchmark-b4.spec.ts`

- **Benchmarks B4–B7** (`e2e/benchmark-b4.spec.ts`, `-b5`, `-b6`, `-b7`,
  P3-14; B6 with P3-08's Draft): shared steps in `e2e/benchmark-helpers.ts`:
  `primitive(page, 'Box', fields, operation)` fills a primitive on XY and
  commits it, `turnView(page, 'Shift+3')` turns and returns a settled
  `projector`, `clickEdge`/`clickWhere` poll `data-model-hover` before the
  click, `pickAxis` tries points along an origin axis, `extentOf(mesh,
  keep)` measures the nodes that pass a filter (B4's lip and cavity), and
  `solidTab(page)` returns after `exportModel` (which leaves the 3D Print tab
  open); Parameters is a Home tile since ADR-0079, so `pickTool(page,
  'Parameters')` finds it from any tab. While a Hole's or primitive's
  Plane field picks, the view has no `data-model-hover`: `clickAt` with a
  short wait instead. Faces seen from below (Shift+3) sit under the dialog
  on the right at the fitted zoom: `zoomOutTo` first. An origin axis behind
  a body isn't pickable: try its points in front (negative Y in the home
  view). The YZ plane inside a closed body can't be clicked: hide the body
  that covers it (B5 hides the lid over the open tray). A construction
  plane's field text is its name ("Offset Plane1"); pick it where it lies
  over an open cavity (it wins over the floor behind it). In a sketch,
  dimensioning a rectangle side moves the opposite side: pick the next
  side where it is now. Body rows rename with `renameBody` (F2); the 3MF's
  object names are the body names.

### `e2e/benchmark-b5.spec.ts`

- **B5** (P3-14, 120 s timeout): a PCB enclosure, helpers `primitive`,
  `turnView('Shift+1')`, `clickWhere`, `clickAt`, `fill`, `ok`, `pickAxis`,
  `renameBody`, `solidTab`, `addParameter`, `setParameters`,
  `expectNoProblems`, `exportModel`, `exportProject`, `objectsOf3mf`,
  `solidFacts`. `checkExport` asserts two closed objects (within 0.1 % of
  `trayVolume`/`lidVolume`).

- Box shelled open at the top (`Shell`, Faces to remove `[0,0,25]`, Thickness
  `wall`) → `Body1:11:80,60,25`; a Cylinder joined as a corner post; a Hole
  with the `M3 heat-set insert` preset (blind, 6.5 mm); a `Rectangular
  Pattern` (`features`, tick `Cylinder1`+`Hole1`) 2 × 2: Direction → X axis
  (`pickAxis` tries [50,55,60,65,70]), `2 * px`; Direction 2 → Y axis
  ([-40,-45,-50,-55,-60]), `2 * py`) → `Body1:27`.

- While a Hole's Plane field picks the view has no `data-model-hover`: use
  `clickAt` with a wait. Box2 is the lid (`new-body`, Height `lid`, Offset
  `height`); two countersunk `M3 clearance` holes (blind, Depth `lid`, Drill
  point `0 deg`) and `Mirror` (`features`, `Hole2`+`Hole3`, YZ plane clicked
  at `[0, -half*0.5, half*0.5]`) give `Body2:14`. Hide the lid first (its eye
  cycles shown → ghost → hidden).

- `renameBody` to `Enclosure`/`Lid`; the 3MF has both, and
  `setParameters({length:'100 mm',height:'30 mm'})` makes the posts, inserts
  and screws follow (`Enclosure:27:100,60,30 Lid:14:100,60,3`). Fixture
  `exportProject(page,'b5-pcb-enclosure.extrudo')`.

### `e2e/benchmark-b6.spec.ts`

- **Benchmark B6 e2e** (`e2e/benchmark-b6.spec.ts`): three Box dialogs with
  parameter expressions (Operation `join` for the arm and the lip), Draft
  faces picked in the home view and the arm's far side from Shift+5, the
  plane picked on the plate's front face, five fillet edges picked in the home
  view. Radius 3 mm is refused on the 5 mm plate (its front and back top
  fillets meet), which the spec avoids. About 18 s alone.

### `e2e/benchmark-b7.spec.ts`

- **B7** (P3-14, 120 s timeout): a knurled knob, helpers `primitive`,
  `turnView`, `clickEdge`, `pickAxis`, `renameBody`, `solidTab`, `fill`, `ok`,
  `setParameters`, `expectNoProblems`, `exportModel`, `exportProject`,
  `objectsOf3mf`, `solidFacts`, `settled`, `toolPrompt`. Parameters `dia`,
  `height`, `bevel`, `groove`, `grooves` (`'unitless'`), `shaft`, `bore`.

- Sketch1 on XZ (sketch x is world X, y is world Z), a rectangle from the
  origin dimensioned `dia / 2` and `height` (the first dimension moves the
  right side to x = 15); Revolve a whole turn about the Z axis →
  `Body1:3:30,30,16`. Chamfer the top edge where it is nearest the camera
  (`clickEdge` at `[15/√2, -15/√2, 16]`) → `Body1:4`.

- One Cylinder cut at the rim (`X: dia/2`, Diameter `groove`, Height `height +
  2 mm`, Offset `-1 mm`) gives the groove; a `Circular Pattern` (`features`,
  `Cylinder1`, about Z, Count `grooves`) makes them all round; a blind Hole
  from the bottom (Flip) takes the shaft (`shaft`/`bore`). `renameBody` →
  `Knob:53:30,30,16`.

- `checkExport` (one `Knob`, `size[2]≈height`, `size[0]` between `dia-groove`
  and `dia`, volume within 0.3 %). `setParameters({dia:'36
  mm',grooves:'18',groove:'1.8 mm'})` → `Knob:41:36,36,16`. Fixture
  `b7-knurled-knob.extrudo`.

### `e2e/benchmark-b8.spec.ts`

- **Benchmark B8 e2e** (`e2e/benchmark-b8.spec.ts`, P4-11): a name tag, 19 s
  alone, 180 s timeout. Facts a later agent needs: **a plate thin enough to
  snap hides one corner's vertical edge from any one view**, so Fillet1 takes
  three picks in the home view (Shift+1) and the fourth in the back view
  (Shift+5, whose far corner is the home view's hidden one); zoom out only
  *after* the dialog is open, because with no dialog the pick takes vertices and
  a zoomed-out 3 mm edge has the display mesh's own vertices inside the 8 px
  tolerance (`clickEdge` on a midpoint then fails). **A text sketched on the face
  it is embossed onto is pickable in the model** (`pickStack` ranks a whole text
  before a face for coplanar hits), so the Emboss tool's pre-selection fills
  "1 text" with no construction plane — unlike `e2e/emboss.spec.ts`, whose
  letters have to be clickable in the clear. The text's anchor needs "Snap to
  grid" off (the grid would snap it to the origin) and its ink is read from
  `data-text-bounds`: `EXTRUDO` at an 8 mm cap height is 50.8 mm wide, so it is
  centred on x = 4 to fit between the hole's edge and the plate's end (on x = 5
  the last letter overhangs the plate by 0.3 mm). The 3MF's volume sits between
  the plate's (exact: four fillets, one hole) and the plate's plus the letters'
  ink area × `letters` (about 32 % of its bounding box in Inter).

### `e2e/benchmark-b9.spec.ts`

- **Benchmark B9 e2e** (`e2e/benchmark-b9.spec.ts`, P4-11): a threaded bottle
  cap and its thread adapter, 240 s timeout, about 60 s alone. Facts a later
  agent needs: **a Shell that removes the bottom face leaves the cup open
  below and closed at the top**, so the inside wall is only pickable from the
  bottom view (Shift+3, still the current one after the shell) and only *on the
  wall itself* — a point inside the hollow picks the flat lid above it and the
  Thread dialog answers "Pick round faces: a shaft's side or a hole's wall"
  (the message is the Faces field's hint, not the region "Feature status").
  Sketch2 is drawn on 10 mm grid points (0,−30) (10,−30) (10,−20) (20,−20)
  (20,−10) (0,−10) (0,−30) after `zoomOutTo` around the **middle of the view**
  (a point of the model can be under the palette, and a `wheel` at a panel
  doesn't zoom), and its five dimensions are picked with the label placement
  deciding the orientation (above/below a slanted pair = x, beside it = y);
  the label's click must be on screen and on empty space — z = −40 mm is off
  the screen at the fitted zoom. **Five dimensions fix the section, a sixth is
  over-constraining.** Bodies are named `Body1`, `Cap`, `Adapter`: the free
  `Body1` is the adapter's once the cap's row is renamed. Sizes after the
  threads: `Cap:<n>:32,32,14` (an internal thread leaves the outside alone)
  and `Adapter:<n>:23.8,23.8,20` — each thread turns its step down to its
  crests (M20 → Ø19.8, M24 → Ø23.8, so the Ø28 collar as drawn ends at
  Ø23.8). The parameter change is `capDia = 40 mm`, `adapterLow = 24 mm`: the
  cap becomes `Cap:<n>:40,40,14` and the adapter `Adapter:<n>:35.8,35.8,20`
  (M39 in the cap's Ø36 bore, M24 on the spigot, M36 on the Ø36 collar — the
  coarse series goes to M64 since P4-11, so `autoThread` has a fit for every
  bore a bottle cap has).

### `e2e/benchmark-b10.spec.ts`

- **Benchmark B10 e2e** (`e2e/benchmark-b10.spec.ts`, P4-11): a cable chain
  link, 31 s alone, 240 s timeout. Facts a later agent needs: **a sweep carries
  its profile exactly where its sketch drew it** (the facade's no-contact
  `pipe.Add` leaves OCCT's placement cancelled), so the section has to be
  *centred on the path* — drawn centred on the sketch's origin instead, the
  link's walls came out 6 mm thick (`Link:<n>:29,10,26` and a volume 11.7 % over
  the centreline's perimeter × the section); centred on the path's own line it is
  `Link:<n>:26,10,23` and 2425.5 mm³, exact. **The first curve picked is where
  the sweep starts** (the facade's `pathWire` starts the wire with the first
  piece), every path pick must be ≥ 5 mm off the section's own curves (both are
  sketch curves, nearest first), and the *profile* has to be clicked in the half
  of the section the path is not in front of (from the home view the ray meets
  the YZ plane before the XZ one for a point at negative y). **A side face is
  picked in the view that looks square at it** (the front view, Shift+4): the
  plane picker takes an origin plane unless the face is at least as near, and an
  origin plane lies in front of a vertical face in an oblique view — the hole's
  plane comes out "YZ plane" however exactly you click. A hole on a picked face
  defaults to `through`, so set Extent to blind before its Depth field exists.
  The Ø(`pin` + 2 x `tolerance`) hole is wider than the 3 mm wall it is drilled
  into and severs it (the link stays one solid, 32 → 26 faces as the hole grows):
  a printable link needs `wall` ≥ `pin`. The pattern's copies are named from
  their instance: `Link`, `Body1`, `Body2` (P3-07), and their y positions step
  `pitch` in one direction (−5, 25, 55 at 30 mm). Reading the hole's diameter
  after the parameter change: open its chip (double-click) and read the
  expression input's value line, "= 5.60 mm".

### `e2e/bodies.spec.ts`

- **Bodies e2e** (`e2e/bodies.spec.ts`) reads the Viewport region's
  `data-body-appearance` ("Name:#rrggbb|default:opacity") and
  `data-silhouettes`, the browser's `[data-folder-count]` and
  `[data-body]` rows (name button `aria-pressed` when selected; the colour dot
  before it is the button "Appearance of <name>", `data-body-colour`, which
  opens the dialog "<name> appearance" — R3-07 — so match a body's name button
  with `exact: true`). A ghost
  body (ADR-0030's amendment, 2026-10-09) is `data-ghost-bodies` on the
  Viewport ("Lid", absent when none) and `data-body-display="shown|ghost|hidden"`
  on its row; a body row's eye cycles shown → ghost → hidden (icon `EyeDashed`
  while a ghost, labels "Show as ghost <name>" / "Hide <name>" / "Show <name>"),
  and the body and marking menus offer `showBody` / `ghostBody` / `hideBody`
  ("Show Body" / "Show as Ghost" / "Hide Body"). A ghost is not in
  `data-bodies`, `data-model-hover` or `data-model-selection`. A new
  sketch opens fitted to what is drawn (a 40 × 20 plate gives about
  ±13 mm of height at 1440 × 900): keep later geometry inside that, and
  wait for the camera to stop (poll `data-camera-size`, target,
  direction) before `mapping()`. Pick a sketch profile next to a body
  in Orthographic, or the body's edge takes the click. `Bodies.tsx`
  uses `useFrame`: pure helpers go in `viewport/bodyGeometry.ts`.
  `data-silhouettes` sums the hairline-free outlines per body; a node
  within `EDGE_ON` (0.006°) of edge-on counts as **facing** whatever
  the sign of the float noise in its normal is
  (`viewport/silhouette.ts`), so a fillet's tangent line, a wall seen
  exactly from the side or a cylinder's outline in a named view are the
  same every run. The Top view of the bracket is that case: the tapered
  walls of its holes face up, so what is left is the outside fillet's
  tangent line (2 segments), where a run once reported 0, 2 or 4.

### `e2e/canvas.spec.ts`

- **Canvas e2e** (`e2e/canvas.spec.ts`, P4-06 slice 5): the picture is a
  200 × 100 PNG **built in the page** with an `OffscreenCanvas` (as a string:
  the e2e specs typecheck without the DOM) and handed to the file chooser as
  `{ name: 'plan.png', mimeType: 'image/png', buffer }`; the tile is the
  **Home** tab's button "Canvas" (`exact: true`; the Insert tab's before ADR-0079) and the dialog is "Canvas
  dialog" / "Edit Canvas1 dialog": `[data-info="image"]`, the button "Plane"
  (`exact: true`, "1 face"), the textboxes "X", "Y", "Width", "Rotation" and
  "Opacity" (**all `exact: true`**: "Y" also matches "Opacity"), the checkbox
  "Flip" and the button "Calibrate" (which reads "Calibrating…" while it runs,
  so match it with a regex). The Viewport's `data-canvases` reads
  `<feature id>:<w>x<h>:<origin>` per drawn canvas in mm to 0.01 ("…:20x10:0,0,20")
  and is **absent until the picture is decoded** (its height is the picture's
  aspect), so poll it. Calibrate counts its marked points on `[data-calibrate]`
  ("0", "1", "2"), the dialog then shows `<measured> mm apart on the picture.`
  and a "Real distance" textbox with "Apply". **Fit the view (F6) before
  clicking on the picture**: the origin planes' squares are 0.16 × the view
  size, and a click on one of them picks it instead of the face. While a
  dialog's Plane field is the pick field the view has no `data-model-hover`
  (that belongs to the model picker). The browser's rows carry `data-canvas`,
  like the construction rows' `data-construction`.

### `e2e/chamfer.spec.ts`

- **Chamfer e2e** (`e2e/chamfer.spec.ts`, P3-02; P4-12's second part adds
  `distance2` for a second set and, for two distances, `distance` and
  `distanceB` handles along the two faces — in the home view the one on the front
  face points straight down the screen, the one on the top face up and right, and
  **which is Distance is the body mesh's face order**, so the spec reads the top
  face's footprint from a 3MF to check it; P4-12's third amendment adds the
  angle arc: a distance-and-angle set's `data-manipulators` reads
  `distance:distance angle:angle`, and the drag turns the Angle by going along
  the arc — perpendicular to its radius on screen, either way round; P4-12's fourth
  amendment adds a Cylinder rim: a two-distance chamfer reads
  `distance:distance distance:distanceB` and each head dragged along its own
  arm (learned from the head's move between two field values) grows its field): the tool has no key: click
  the toolbar's Chamfer tile (`getByRole('button', { name: /^Chamfer/ })`,
  after picking an edge for pre-selection). The dialog is the region
  "Chamfer dialog" / "Edit Chamfer1 dialog"; set 1 has the button "Edges"
  (`exact: true`), the combobox "Type" (options "Equal distance", "Two
  distances", "Distance and angle": a Radix select, click it, then the
  option) and the textboxes "Distance", "Second distance" (two distances),
  "Angle" (distance and angle), the button **"Reference face"** (P4-12:
  "Automatic" while empty, "1 face" once picked; it shows for the two
  unequal types, and while it holds a face the checkbox "Flip" is gone) and
  the checkbox "Flip" (both non-equal types); set 2 names get " 2" ("Edges
  2", "Type 2", "Distance 2" …). Fields of other types aren't in the DOM.
  The message is in the region "Feature status". P4-12's reference-face test
  picks the top face for the 2 mm and the front one for the 6 mm of one
  two-distance chamfer and reads the top face's footprint and the volume
  from a `3MF` export (its triangles in the plane z = 20); the distance
  handle works as the fillet's radius handle. Kernel-side, the golden table is
  `pnpm vitest run -u packages/kernel/src/features/chamfer`; a chamfer's
  failed build is diagnosed by rebuilding it like fillet's (keep failing
  cases out of previews that run often).

### `e2e/combine.spec.ts`

- **Combine and Move/Mirror e2e** (`e2e/combine.spec.ts`,
  `e2e/move-mirror.spec.ts`, P3-06): the Modify tab's Transform group's tiles
  are the buttons "Move", "Mirror" and "Combine" (`pickTool(page, 'Combine')`
  selects the tab; `exact: true`: a chip "Move1" matches a regex); dialogs are the regions "Combine dialog", "Move dialog",
  "Mirror dialog". Select bodies first with `selectBodies(page, ['Body1',
  'Body2'])` (`e2e/benchmark-helpers.ts`: a click, then Shift-clicks on the
  browser rows): the first is the Combine target, the rest its tools, both
  fields read "1 body" (buttons "Target" and "Tools", `exact: true`, since
  "Clear Target" also matches). A Move that moves nothing previews as a
  *warning* ("Nothing moves"), so wait for `data-preview-status` /^(ok|warning)$/.
  The gizmo is `data-manipulators="distance:dx angle:rx distance:dy …"`
  with handles `[data-manipulator-handle="dx"]`; in the home view drag an
  arrow along the projected axis (the value snaps, so 80 px gave 4.6 mm
  there). Positions are read from the 3MF export (`exportModel` +
  `objectsOf3mf` + `meshBounds`; it opens the 3D Print tab; `pickTool`
  selects the Modify tab again). Picking the X axis for Rotate: try points along it until
  `data-model-hover` is `axis:origin:x` (the dialog covers the right
  edge). The plane picker for Mirror works as in the primitives spec
  (click a plane's square, `[0, -h·0.6, h·0.6]` for YZ). Kernel tests:
  `pnpm vitest run -u packages/kernel/src/features/combine` and
  `…/transform` rewrite the golden tables.

### `e2e/commands.spec.ts`

- **Command search e2e** (`e2e/commands.spec.ts`): one `dialog` "Search"
  (`exact: true`: other names contain the word) since R3-05, opened by
  Ctrl+K (centred), S (at the pointer) or the top bar's button "Search"; its
  `data-dim` is `true` except at the pointer. The combobox is "Search
  commands", the pins the region "Pinned" (tiles are buttons named after the
  command; at most ten, the refusal in its `status`, a row's pin glyph is
  `[data-pin="free|pinned|full"]`, visible on hover), the list the listbox
  "Commands". Seed pins with an init script setting
  `localStorage['extrudo.toolbox.pins']` (JSON). Measure the top bar's
  buttons **before** opening it: a modal takes the page out of the
  accessibility tree. Results are `option`s whose names end with their group
  and key ("3-Point Rectangle Sketch › Create"), so match with `/^…/`.
  Only the current mode's commands are listed: Extrude isn't found inside
  a sketch, and a sketch tool's pin is hidden after a reload (the project
  reopens outside the sketch).

### `e2e/components-placement.spec.ts`

- See `e2e/components.spec.ts`: its notes cover the components and their
  placement.

### `e2e/components.spec.ts`

- **Components e2e** (`e2e/components.spec.ts`, `components-placement.spec.ts`;
  P6-05): the Viewport region's `data-components` ("Lid:Body1,Body2" per
  component), `data-active-component`, `data-isolated`, `data-ghost-bodies`; the
  browser's `[data-component]` rows (`data-component-display`) and
  `[data-body]` rows (`data-body-component`); New Component is
  `pickTool(page, 'New Component')`, a rename F2 on the row's button; the
  isolation bar is `[data-isolation-bar]`; Print Info's per-component rows are
  `[data-print-component="<name>"]` (`print-aids.spec.ts`, "Loose bodies" for
  the rest).

### `e2e/construction.spec.ts`

- **Construction e2e** (`e2e/construction.spec.ts`, P3-05): the Viewport
  region's `data-construction` lists the drawn construction features
  (`Offset_Plane1:plane:<origin>:<normal>`, `…:axis:<point>:<direction>`,
  `…:point:<x,y,z>`, spaces in names as `_`, a dialog's preview
  `preview:`-prefixed); the browser's Construction rows carry
  `data-construction="<feature id>"` and eyes ("Hide Offset Plane1").
  The tools are the Construct tab's (ADR-0079: Planes, Axes, Points; Plane
  Through 3 Points, Plane Along Path and Angled Midplane tiles in Planes): run them
  with `pickTool(page, '<full name>')`; its dialogs are the regions
  "Offset Plane dialog", "Axis Through 2 Points dialog"… A plane field
  picks like Create Sketch (click a plane's square, `clickAt` a world
  point with x ≥ 0, y ≤ 0, z = 0 in the home view); the axis and point
  fields pick in the model. Create Sketch lists construction planes as
  buttons in the group "Construction planes". **An extrude hides its
  sketch**, so `data-sketch-frames` is empty until "Show Sketch1". A
  construction axis lying on an origin axis loses the pick to the origin
  one: offset it. `sketchOnXY` opens a *new* project; use `newSketchOnXY`
  in an open one. **P4-12** adds four tests: a Point on Path on a Box primitive'
  bottom front edge (its `data-construction` reads the midpoint; the
  `[data-manipulator-handle="position"]` handle drags along the edge — blur the
  Position field before reading it), a Plane Along Path on a sketch line
  (`plane:20,0,0:1,0,0`), an Angled Midplane of a Box's front and top faces
  (normal `0,-0.707,0.707`), and a box selection in the top view that takes the
  Offset Plane's square (`data-model-selection` lists `plane:<id>`; a window
  excludes the longer origin axes).

### `e2e/customizer.spec.ts`

- **Customizer e2e** (`e2e/customizer.spec.ts`, P4-07): the panel is the region
  "Customizer" with `data-customizer-state` (`empty`, `parameters`), rows
  `[data-customizer-row="<name>"]` (`data-out-of-range`), the sliders
  `[data-customizer-slider="<name>"]`, the groups as regions named after their
  group ("Size", "Walls"), the combobox "Configuration" and the button
  "Configuration actions" (Save as…/Update/Rename/Delete). A row's value field is
  the textbox "Expression of `<name>`"; in the Parameters dialog (select the
  parameter first, `selectParameter`) the switch "Show `<name>` in customizer"
  exposes it and the textboxes "Min/Max/Step of `<name>`" take expressions (an
  emptied one takes that end away). The Configuration select has no option text hook: read the selected
  option's text through `evaluate` (e2e/ has no DOM library, so cast the element
  to `{options, selectedIndex}`). **A slider drag is real**: down, several
  moves, up on `[data-customizer-slider]`; the value steps from the range, and
  **Ctrl+Z right after it undoes the whole drag** — the slider keeps the focus,
  so `useShortcuts`' `ownsKeys` is what lets the key through. `data-bodies` sizes
  are rounded to 0.1 mm and drop trailing zeros ("Body1:6:40,20,20"), so compare
  numbers, not strings, after a drag. The Storage box template opens at
  `Body1:11:80,60,40` with width/depth/height/wall exposed and "Small"/"Large"
  configurations; the home card is `getByRole('button', { name: 'Start from the
  Storage box template' })`.

### `e2e/draft.spec.ts`

- See `e2e/split-body.spec.ts`: its notes cover Split Body, Scale and Draft
  together.

### `e2e/emboss.spec.ts`

- **Emboss e2e** (`e2e/emboss.spec.ts`, P4-04): the tool is `emboss` in Create's
  menu (`menuitem` "Emboss", no key); its dialog is the region "Emboss dialog" /
  "Edit Emboss1 dialog" with the buttons "Profiles" and "Face" (`exact: true`:
  **"1 text"**, **"1 face"**), the `Depth` textbox (`exact`) and the `Mode`
  combobox (`emboss`/`deboss`); P4-12 adds the read-only line
  `[data-info="method"]` ("Wrapped round the cone", "Projected onto the face",
  after the first preview) and two tests: 'AB' on a Cylinder drafted 10° about
  XY (Modify › Draft, the wall picked at (0, −10, 10), the plane on XY's square)
  and a Ø6 circle typed into the heads-up box on a plane 40 mm over a Sphere
  primitive, its profile picked at z = 40 (the field reads "Profile · Sketch1")
  and the sphere at 10/√3 (1, −1, 1); the sphere's display box is
  `Body1:1:20,19.9,20`, an emboss makes its height 21 and a deboss 19.5 (the cut
  takes the top away). **Sketch on a construction plane clear of the
  body**: the letters have to be clickable in the model, and a sketch through
  the body (an XZ sketch inside a cylinder) puts them behind its faces, where a
  click is refused as occluded (the text spec's `inkPoints` scan over
  `data-text-bounds` finds a letter; the `Create Sketch` dialog's
  "Construction planes" group takes the plane). A 10 × 4 mm pad of straight
  edges and a letter "O" are exact to 1e-7 (`toBeCloseTo(x, 6)`), a B-spline
  wall (a curved profile, a letter's outline) only to 1-2 %: since **P4-12
  §H3** a wrap's volume is integrated to a tolerance, so a wrap of a *profile*
  is within 1e-5 of `area × depth × (R ± depth/2) / R` (`wrap.test.ts`, which
  used to allow 2 %) and the e2e can hold 1-2 % for the letters' own outline
  area. The names are the prism's: `emboss:EM:cap:end` and
  `emboss:EM:side:<sketch curve>`; `cap:start` merges into the face it stands
  on. A wrap of one profile is one tool (`mergeTools` hands it back as it is,
  already tracked by the scope — **don't track it again**, that releases it
  twice).

### `e2e/examples.spec.ts`

- **Examples e2e** (`e2e/examples.spec.ts`, P6-06 S3): the home screen's
  "More examples…" opens the dialog "Examples" (list "Examples", 11 rows, each
  with a button "Open the <title> example" that navigates to
  `#/example/<id>`); the route's opener (`home/ExampleOpener.tsx`) makes the
  copy and `replaceRoute`s to `#/p/<id>` — Back must not return to
  `#/example/…` — and an unknown ID lands on home with the alert
  `There's no example named "<id>".`; while it fetches, the opener's status
  reads "Opening <title>…". The examples' fixture files are not precached
  (`SKIPPED` in `pwa/precache-plugin.ts` keeps only the template gallery's
  three, `TEMPLATE_FIXTURES`; `p4-01-sweep-loft-coil.extrudo` is under the 4 kB
  `assetsInlineLimit` and inlines as a data URL, so no asset file exists to
  skip). The B1 plate fixture is the sketch stage only (no extrude, 0 bodies),
  so the Plate example opens on its sketch, not on a body.

### `e2e/export-3d.spec.ts`

- **Export e2e** (`e2e/export-3d.spec.ts`): the dialog is `dialog`
  "Export model"; bodies are checkboxes by name, formats radios
  (`/^3MF/`, `/^STL/`, `/^STEP/`, `/^OpenSCAD/`; OpenSCAD hides "Keep
  components together" and "Open in slicer", shows `[data-export-hint]` and
  the summary `1 body as OpenSCAD code`, its button is "Export OpenSCAD"), resolutions `/^Coarse/`…`/^Custom/`
  with textboxes "Deviation" and "Angle". The summary's
  `data-export-summary` reads "1 body, 620 triangles, watertight" once
  meshed (poll it before Export). e2e imports `../packages/io/src/index`
  to read and check downloads. The format and resolution are remembered
  in the `export.model` preference (per browser context). `exportModel(page,
  'STEP')` (`e2e/benchmark-helpers.ts`) waits for "exact geometry" instead
  of "watertight"; a coloured body's STEP has one `COLOUR_RGB` per colour
  (P4-12), an uncoloured one none.

### `e2e/extrude.spec.ts`

- **Extrude e2e** (`e2e/extrude.spec.ts`; P4-12 adds the textbox "Offset"
  (`exact`, "0 mm") under "To object", whose prompt is "Pick a face, a body
  or a vertex", and a test extruding a square on XY up to a Ø30 cylinder
  lying on XZ above it, picked from below with Shift+3: `Body2:<n>:20,20,18.8`,
  20.8 with Offset 2 mm; To object takes planes, so it picks through the plane
  picker — no `data-model-hover`, just click — and its `curvedFaces` flag lets
  a curved face in; mind the Taper heads-up box beside the profile, which
  takes a click on it. P4-12's second amendment adds the combobox "Measure"
  ("whole" default, "half"), shown while Direction is Symmetric: the test
  commits 10 mm with Each side (`Body1:6:60,40,20`) and edits back to Whole
  length (`…,10`). P4-12's taper on ellipse and spline sides is the test
  drawing a 40 × 20 ellipse and tapering it 10° over 20 mm:
  `Body1:<n>:47.1,27.1,20` (each side grows by 20·tan 10°), and the 3MF's
  volume matches the kernel test's Steiner value). The Viewport region's
  `data-bodies` lists drawn bodies as `name:faces:x,y,z` (bbox size in
  mm, e.g. "Body1:7:60,40,15"). The dialog is the region "Extrude
  dialog" / "Edit Extrude1 dialog", its operation the combobox
  "Operation", the pick field the button "Profiles" ("1 profile", "1
  face"). In the Top view the extrude arrow points at the camera and
  can't be dragged: type into the heads-up box, or press Shift+1 (home
  view) and wait for the camera to settle before dragging or picking
  faces with `projector`.

### `e2e/feature-dialog.spec.ts`

- **Feature dialog e2e** (P2-05) reads `data-preview` /
  `data-preview-dimmed` on the Viewport region, `data-dialog-valid` /
  `data-preview-status` on the dialog region ("<Label> dialog", "Edit
  <Name> dialog"), and drags handles at `[data-manipulator-handle]`
  (`cx`/`cy` in view px). `#/debug/dialog` is the shell with
  `spawnDebugKernel` (the engine's test features) and "Press Pull (test)"
  in Ctrl+K. Expression fields commit every keystroke that evaluates, so
  Esc in a field cancels the dialog unless its text doesn't evaluate. A
  unit test that resolves a fake preview right after a pick must `await
  settle()` first (the fingerprint arrives and asks for a newer preview).

- A debug-page spec: `#/debug/dialog` is the real shell on an in-memory
  document with a 20 mm test box (`spawnDebugKernel`); `kernelReady` then wait
  for `data-ready` and a settled camera (`data-camera-size`/`-target`
  unchanged) before `projector`.

- "Press Pull (test)" is found from Ctrl+K (`dialog` "Search", option `/^Press
  Pull \(test\)/`) and has what Extrude lacks: a `Tilt` toggle (checkbox) that
  shows the Angle field and `data-manipulators="distance:distance
  angle:angle"`, and a heads-up input. Its `data-preview` is `join` (green) or
  `cut`; handles are `[data-manipulator-handle="distance"|"angle"]` (`cx`/`cy`
  in view px).

- `data-dialog-valid` is absent while the field is empty or `aria-invalid` (`5
  mm +`), reaching `data-preview-dimmed="true"` and
  `data-preview-status="error"` on a kernel refusal ("The distance is zero.").
  Enter commits the field and presses OK; Esc on text that doesn't evaluate
  returns the last that did, a second Esc cancels. The four pictures
  (`join-preview.png`, `heads-up.png`, `angle-arc.png`, `invalid-input.png`)
  are written with `test.info().outputPath`.

### `e2e/fillet.spec.ts`

- **Fillet e2e** (`e2e/fillet.spec.ts`, P3-01): the dialog is the region
  "Fillet dialog" / "Edit Fillet1 dialog", set 1 the buttons "Edges"
  (`exact: true`: "Edges 2" contains it; text "1 edge", "7 edges", or the
  prompt "Pick edges" when empty) and the textbox "Radius" (`exact`), set 2
  "Edges 2" / "Radius 2" once set 1 has edges. A message in the region
  "Feature status" (role `status`), OK disabled while the preview errors.
  Pick edges the way `model-select.spec.ts` does: hover a couple of pixels
  below the projected midpoint until `data-model-hover` is an `edge:…`,
  then click. On a cube from the Box tool (x, y ±10, z 0…20; home view
  from +X, −Y, +Z) the midpoints (0, −10, 20), (10, 0, 20) and (10, −10,
  10) are visible. A picked edge brings its tangent chain a moment later
  (a kernel call): poll the count. The Cancel button's name is "Cancel
  Esc" (the dialog header also has an icon "Cancel"). Kernel-side, the
  fillet golden table is `pnpm vitest run -u packages/kernel/src/features/fillet`.
  A failing fillet is diagnosed by rebuilding it (about a second per
  failing build when 12 edges collide): keep such cases out of previews
  and tests that run many times. P4-10 adds the checkbox **"Variable"** and,
  while it is on, the textbox "End radius" and the checkbox "Swap ends" (set
  n's carry the number, "End radius 2"); the toggle is no input, so opening a
  stored taper shows it on and unchecking it hides the other two. The
  variable test's volumes come from four `exportModel(page, '3MF')` calls
  (each leaves the 3D Print tab open, so `solidTab(page)` before a dialog).
  P4-12's second part: a second set's handle is `[data-manipulator-handle="radius2"]`
  (`data-manipulators="distance:radius distance:radius2"`), a variable set's are
  `radius` and `radiusEnd` (one per end of the edge; **Swap ends changes their
  places**) and `arrowState(viewport, field)` in the specs reads
  `[data-manipulator-state]:has([data-manipulator-handle=…])` (`active` or `quiet`;
  focusing a field or the set's Edges button makes its arrow active). Nearer an end
  than the middle, so measure a head against the nearer of the edge's two end
  points. P4-12 adds the radius handle: the overlay reads
  `viewport.locator('[data-manipulators]')` with `data-manipulators="distance:radius"`,
  and `[data-manipulator-handle="radius"]` carries its centre in `cx`/`cy`
  (px in the view) — drag it **away from the edge** (the head is `radius`
  from the edge's middle, up-left of it in the home view) and the Radius
  field follows. **Blur the field after `fill`** before reading it: an
  `ExpressionInput` keeps the user's own text while it has the focus (the
  field is in `editing` mode), so a dragged value only shows blurred. The
  handle stands on the edge's middle, so a pick *there* while the dialog is
  open is the handle's: click a little along the edge to unpick it.

### `e2e/guide-shots.spec.ts`

- P6-06 S6: skipped unless `RECORD_ASSETS=1`; it records the concept-guide
  pictures (1440 × 900, dark theme) into `docs/guide/images/<page>/` with
  `pnpm demos -g guide` (`--skip-build` when `dist` is current). Every shot
  goes through `indexed` (`e2e/indexed-png.ts`, 256 colours) to stay under
  about 150 kB; the describe timeout is 120 s.

- `badges` lays numbered badges over the page through the CSSOM only (the
  app's content policy refuses a style attribute) and `save` screenshots a
  clip with `page.screenshot`. Shots include the app layout (wall bracket, six
  badges), constraint colours (`newSketchOnXY`, `mapping`, `dimension`), the
  timeline rolled back (`chip` → "Roll Back to Here", slider `aria-valuenow`
  `2`) and the Parameters dialog.

- Part 2 (`S7`): the browser with its folders (the "Box with a lid" template
  via `startFromTemplate`, Section Analysis XY plane), the "Export model"
  dialog (`[data-export-summary]` watertight), the Print Info panel
  (`data-print-state=ready`), the Versions dialog (two `[data-version]`
  entries) and the browser with a component (first `data-bodies` body, then
  `pickTool(page, 'New Component')`).

### `e2e/readme-shots.spec.ts`

- Skipped unless `RECORD_ASSETS=1`; `pnpm demos -g readme` (`--skip-build`
  when `dist` is current; `E2E_GPU=1` where there is a GPU is faster; the
  status bar's frame rate, recompute time and renderer are hidden with
  `e2e/screenshot.css`) records the README's eight scenes (home,
  model, drawing, sketch, fillet, assembly, print, customizer) at 1440 × 900 into
  `docs/images/readme/<scene>-<light|dark>.webp`. Each theme is a `describe`
  with `test.use({ colorScheme })`: the app follows the system scheme while
  no theme is picked. Shots are WebP q 0.9 encoded by `OffscreenCanvas` in a
  blank page (256-colour PNGs band the view's gradient), 45-75 kB each.
- Scenes: wall bracket (`openProject`); drawing: a new sketch on XY zoomed
  in to camera size ≤ 110, a 60 × 40 rectangle and a circle (snap to grid
  makes its radius 10, so pick it at r 10) with three dimensions;
  `chip('Sketch1').dblclick()` and the
  Sketch palette, `chip('Fillet1').dblclick()` until `data-preview-status=ok`,
  the hinge fixture imported then F6 (Fit), 3D Print › Print Info until
  `data-print-state=ready`, Customizer until `data-customizer-state`.

### `e2e/help-links.spec.ts`

- **Help links e2e** (`e2e/help-links.spec.ts`, P6-06 S9): the docs host is
  answered locally with `context.route('https://extrudo.org/**', …)` (no
  request leaves the machine; `route.abort()` would replace the popup's URL
  with `chrome-error://chromewebdata/`) and each step takes the popup with
  `context.waitForEvent('page')` beside the action, then reads `popup.url()`:
  the Menu's Learn › User Guide → `…/docs/`, F1 on a hovered Extrude tile →
  `…/docs/tools/extrude/`, F1 before any tile was hovered → `…/docs/` (F1 and the panel's Help item share `lastHoveredTool()`), Ctrl+K "Tool
  Reference" → `…/docs/tools/`; the Extrude tile's tooltip shows "F1 for more"
  and holds no `a`/`button`. The strip's button "GitHub" opens the repository in a
  popup; the App column is Search…, Settings…, About Extrudo, Close design, and
  the web strip's only button is GitHub. The Learn column on a fresh page is User
  Guide, Tutorial, Online Tutorials, Examples, Tool Reference; after hovering the
  Extrude tile it starts with "Help for Extrude" + F1 (its text `Help for ExtrudeF1`),
  which opens `…/docs/tools/extrude/`. The
  home bar's Docs and GitHub are links that open in popups; its About is a button
  that opens the dialog (ADR-0085).

### `e2e/about.spec.ts`

- **About e2e** (`e2e/about.spec.ts`, ADR-0085): `pickMenuItem(page, 'App', 'About
  Extrudo')` opens a `dialog` named /about/ (title "extrudo —
  about"). Rows are `dt`/`dd` pairs under the headings "Build", "Running on"
  and "Engines"; the version chip is the first text matching `/^\d+\.\d+\.\d+/`;
  "Copy details" is a button, disabled until the system rows load; the logo
  is the button "Extrudo logo" (replays, dialog stays open). Links keep their
  `href` and open through `Platform.openLink` (a popup on the web): the
  github.com host is answered locally with `context.route`, as in
  help-links. The home bar's About button opens the same dialog.

### `e2e/bug-report.spec.ts`

- **Report a bug e2e** (`e2e/bug-report.spec.ts`, ADR-0092): `pickMenuItem(page, 'App',
  'Report a bug')` opens the `dialog` "Report a bug" (also from About's footer button and the
  home screen's app menu). Fields by label: "Title", "What happened?", "Steps to reproduce",
  "Include the timeline" (a checkbox, absent on the home screen). The screenshot is
  `img` "Screenshot" (the viewport snapshot; Remove, then "No screenshot" and the button "Take
  screenshot"); the report preview is `getByTestId('bug-report-preview')`. "Copy report" turns
  into "Copied" for 1.6 s; "Open GitHub draft" opens a popup on the prefilled issue URL
  (github.com answered locally with `context.route`). Trap: grant `clipboard-read` and
  `clipboard-write`; the PNG is not read back, only the text copy and the popup URL.

### `e2e/hole.spec.ts`

- **Hole e2e** (`e2e/hole.spec.ts`, P3-04): press `h` (after Shift+1 and a
  settled `projector`); the dialog is the region "Hole dialog" / "Edit Hole1
  dialog". While Plane is the pick field a click on a face picks it **and
  places the hole** at the clicked point (`X`/`Y` textboxes read "4.98 mm":
  compare with `toBeCloseTo`, or `fill` exact values). The Box tool's cube with
  Length, Width and Height 40 mm has its top at z = 40 (click world
  `(x, y, 40)`). Fields: buttons "Plane" ("XY plane", "1 face") and "Points"
  ("Or pick sketch points", "2 points"), comboboxes "Preset" (`selectOption({
  label: 'M4 clearance' })`, values `m4-clearance`, `m3-insert`, `custom`),
  "Type" (`simple`/`counterbore`/`countersink`) and "Extent"
  (`through`/`blind`), textboxes "Diameter" and "Depth" (`exact`), "Drill
  point", "Counterbore diameter"… and the checkbox "Flip". X and Y are gone
  once points are picked; Depth and Drill point show only for Blind. A
  through hole in the cube is `Body1:7:40,40,40`, a blind one with a cone 8,
  a counterbore adds two faces. Sketch points on the cube's bottom (an XY
  sketch) are occluded from above: click Points, press Shift+3 and pick them
  from below with a settled `projector`. Volumes from the 3MF are a
  tessellation short (`toBeCloseTo(v, -2)` for several holes). A hole that only
  touches the body says "The cut doesn't remove anything". Kernel-side, the
  golden table is `pnpm vitest run -u packages/kernel/src/features/hole`.

### `e2e/hosting.spec.ts`

- **Hosting e2e** (`e2e/hosting.spec.ts`, P3-15): `e2e/static-host.ts`
  (`startStaticHost(dir)`) serves `apps/web/dist` the way Cloudflare Pages does
  (the build's own `_headers` with path rules, **`.html` paths 308-redirected**
  (`/index.html` → `/`), `index.html` fallback, `.wasm` as `application/wasm`) on a random port, with `override(path, body)` to serve a
  changed file; `watchPolicy(page)` collects `securitypolicyviolation` events and
  console errors. `vite preview` (the webServer) applies only the `/*` block, which
  already includes COOP/COEP and the CSP: if a spec fails with "kernel stopped"
  after a change, look for an `EvalError` or a blocked cross-origin load first
  (the debug route `#/debug/kernel` prints why the kernel didn't start). A CSP
  violation in the page is also a console error. The build must be fresh
  (`pnpm build`): the specs read `apps/web/dist`.

### `e2e/insecure-context.spec.ts`

- **Insecure context e2e** (`e2e/insecure-context.spec.ts`, issue #57): a plain-HTTP
  LAN origin has no `crypto.randomUUID` and no `navigator.storage` (so no OPFS). Playwright
  can't make a non-secure origin on localhost, so an init script deletes
  `Crypto.prototype.randomUUID` and defines `navigator.storage` as `undefined`
  before the first navigation; the spec asserts both are gone right after `goto`.
  Then: **New design**, viewport `data-ready="true"`, `primitive(page, 'Box', ...)`,
  `data-bodies` `Body1:6:20,20,20`, `saveStatus` contains "Saved"; after a reload the
  heading "Your designs" and exactly one `listitem` in the list "Designs" (the
  IndexedDB file store worked). Fails on a `pageerror`. Served by `vite preview` like
  the other specs.

### `e2e/import-drawing.spec.ts`

- **Import drawing e2e** (`e2e/import-drawing.spec.ts`, P4-06 slice 1): the tool
  is `importDrawing` in the Sketch tab's Create menu ("Import Drawing…", no
  key); it opens the file dialog at once, so the spec waits for the
  `filechooser` **beside** the click (`chooser.setFiles('packages/io/src/
  fixtures/rect-circle.svg')`, the fixtures `@extrudo/io`'s own tests read). The
  panel is the region "Import drawing": the file's name, the comboboxes "Units"
  (the file's own preselected: `mm`, `in`) and "Position" (`origin`/`centre`),
  the "Scale" textbox (an `ExpressionInput`, so `fill('2')`), the "Fixed"
  checkbox, `[data-import-summary]` ("5 curves", or the reason it can't be
  imported, with `data-import-summary="error"` and OK disabled), and OK/Cancel.
  After OK: `data-sketch-summary` reads `lines=4 circles=1 points=9
  constraints=5` (one `fix` per curve), `data-sketch-profiles` reads
  `profiles=2 holes=1` (ADR-0020: the hole is a region of its own), and one
  Ctrl+Z takes the whole import out (the step is named "Import <file>"). A
  profile is picked in the model **outside** the circle (at sketch (−10, 0)),
  pressed with E, and `data-bodies` gives `40,20,5`; with Scale 2, `80,40,5`;
  and `square-inches.dxf` ($INSUNITS 1) gives 25.4 × 25.4 mm.

### `e2e/import-f3d.spec.ts`

- **The `.f3d` import in its worker** (ADR-0083, 2026-10-16): the file is built in the spec
  (`storedZip` of stored entries, no CRCs, around the empty design segment `metaStream`, the
  same as `packages/f3d`'s archive tests), never a sample, and fed to the home screen's
  **Import…** with `chooser.setFiles({ name, mimeType, buffer })`. That the worker ran is
  `page.on('worker')` seeing a URL with `f3dWorker` (the worker's `name` isn't exposed). The
  empty design's notice is "Imported from the .f3d file: 0 of 0 timeline features."; a bad
  file's error is the home screen's `alert` toast "Import failed: …".

### `e2e/import-mesh.spec.ts`

- **Import mesh e2e** (`e2e/import-mesh.spec.ts`, P4-06 slices 3 and 4): the
  same Home › Import flow (the old Insert tab's, ADR-0079) with `fixtures/imports/cube.stl` (Units "auto",
  the preview's `data-preview-status="ok"` needs manifold-3d in the worker),
  `two-parts.3mf` (two bodies at ×10 for centimetres, the largest first),
  `bracket-y-up.obj` (read as Z-up, then Up `y` from the chip swaps y and z),
  `open.stl` (the error in "Feature status" with OK disabled), a Fillet whose
  Edges field stays "Pick edges" (the creases don't pick) and a Shell that says
  "Shell needs a solid body", and an STL and 3MF export read back with
  `@extrudo/io` (one closed object, 8000 mm³) while the Export dialog under
  STEP disables the body. Slice 4's four tests: a **Ø6 circle sketched on XY and
  extruded as a cut through all** (the profile is picked in the model and `e`
  pressed; the Operation and Extent comboboxes read `cut` and `through-all`; the
  body stays one face of triangles tagged "Mesh" and its 3MF is closed at
  7434 mm³ ±0.5 %), a Box overlapping the cube **joined with Combine** (the
  Target and Tools buttons take the picks, the warning is the region's whole
  text, one body of 25 × 20 × 20 mm), a **Move** by 10 mm along X (the field is
  "X distance"; the exported mesh's lowest x is 10) and a **Split Body** by YZ
  (the browser row selected, then Modify › Split Body; the YZ plane picked on
  its square at `[0, −half · 0.75, half · 0.75]` as `e2e/split-body.spec.ts`
  does it, and two bodies of 10 × 20 × 20 mm whose volumes add up). **9 tests,
  20.7 s** (1.7 s to 6.8 s each; a cut, a join, a move and a split each take a
  mesh boolean), green with `--repeat-each=3`. Two things the four needed: the
  circle's diameter is **typed into the tool's heads-up box** (the group
  "Heads-up input", textbox "Diameter", Enter finishes the circle — the grid
  would snap a drawn radius), and the circle is sketched on a construction plane
  **10 mm below** the cube so its profile is in front of the body from the
  bottom view (Shift+3) and can be picked. Combine picks its target and tool in
  the view (`Target` then the box's top face at `[22, 10, 10]`, `Tools` then the
  cube's top at `[10, 10, 20]`): with pre-selection the *target* is the first
  body **in creation order**, so a mesh target and a solid tool warn about
  nothing.

### `e2e/import-scad.spec.ts`

- **Import OpenSCAD e2e** (`e2e/import-scad.spec.ts`, P5-04 slice 2): the
  Home tab's Import (ADR-0079) with `fixtures/imports/customizer-plate.scad` (a 40 × 30 ×
  4 mm plate with two Ø4 holes; groups Size: `width`, `depth` and Holes:
  `holes`, `hole`, plus a string `label` and a boolean `rounded`). The dialog
  "Import dialog" has `[data-info="file"]` ("customizer-plate.scad · 1 kB ·
  OpenSCAD") and the group "OpenSCAD variables" with
  `[data-scad-overrides="loading|ready|error"]` (`[data-scad-error]` holds an
  error's text), headings `[data-scad-group]` and rows `[data-scad-row="<name>"]`
  (`data-scad-readonly` for a non-number, "(not editable yet)";
  `data-scad-missing` for a stored override the file doesn't list); a row's
  textbox is named after the **variable** (`width`, `exact: true`) and its
  placeholder is the file's value. The first list and preview take a moment
  (the nested worker, the WASM): wait up to 90 s for `ready` and
  `data-preview-status="ok"`. The body is a mesh body, `Body1:1:40,30,4` in
  `data-bodies`. A typed parameter name (`plateWidth`) shows "= 50.00 mm" under
  the row; the Customizer's slider on it recompiles each step (the Customizer is
  a Home tile since ADR-0079: `pickTool(page, 'Customizer')`). `syntax-error.scad`
  says "syntax-error.scad, line 4: syntax error." in "Feature status" with OK
  `aria-disabled` (don't click it: Playwright waits for it to be enabled). Three
  tests, 9.3 s, 10.5 s and 3.4 s; `hosting.spec.ts` has the
  same import under the served headers and `pwa.spec.ts` the runtime cache
  (`caches.open('extrudo-openscad')`), the offline reload after first use and
  the "isn't downloaded yet" message offline before it.

### `e2e/import-step.spec.ts`

- **Import STEP e2e** (`e2e/import-step.spec.ts`, P4-06 slice 2): the tile is
  `importBody` in the **Home tab** (ADR-0079: `selectTab(page, 'Home')`, then the
  button "Import Model", `exact: true`; `data-tool="importBody"`; `fileAction(page,
  'Import Model')` runs the same command). It opens the file dialog at
  once, so wait for the `filechooser` beside the click and
  `setFiles('fixtures/imports/b3.step')` (B3's two bodies through our own
  `writeStep`). The dialog is the region "Import dialog" / "Edit Import1
  dialog": `[data-info="file"]` ("b3.step · 30 kB"), the "Up" combobox
  (`z`/`y`; **no** "Units" for a STEP file, it converts its own units),
  `data-preview-status` (the preview takes a moment: read up to 60 s) and
  `data-dialog-valid`. OK gives `data-bodies` **"Body1:6:60,80,10
  Body2:6:60,31.8,60"** (sizes are rounded to 0.1 mm) and the chip "Import1";
  one Ctrl+Z takes the feature and the file's record away together and
  Ctrl+Shift+z brings them back. Editing from the chip (dblclick) turns Up `y`
  and the sizes' y and z swap: "60,60,31.8" and "60,10,80". A file that isn't
  a STEP file says so in the dialog's "Feature status" with `data-dialog-valid`
  absent. Exporting the design and importing it as a new one brings the bodies
  back (the attachment travels), as in the user-fonts spec. **P4-12's colour
  test**: the Wall bracket recoloured through its Appearance panel's "Hex
  colour" (`#c81e28`; Esc closes the panel with focus on the "Opaque" radio),
  exported with `exportModel(page, 'STEP')`, written to `info.outputPath` and
  imported into a new design reads `data-body-appearance`
  `Body1:#c81e28:1` (`Body1:<n>:40,80,60`); recoloured `#22b3c2` and its chip's
  Up set to `y` (`40,60,80`), it stays `#22b3c2`.
  Slice 5 added the **canvas** (`features/canvas.tsx`, `viewport/Canvas.tsx`,
  `viewport/canvasGeometry.ts`, `viewport/canvasImages.ts`): a canvas is **view
  geometry from a report, never picked** — the kernel evaluator reads the plane
  (`planeOf`) and reports its frame as a `CanvasReport`
  (`ModelState.canvases`), and `canvasGeometry.ts` reads the picture, centre,
  width, turn and opacity from the feature's own inputs through core's
  `canvasNumbers` (the kernel feeds it `ctx.value`, the view the document's
  evaluation). The picture's bytes are decoded on the UI thread
  (`createImageBitmap`, so the CSP is untouched) and its texture goes with the
  last canvas using it; the width is the picture's pixel width × 0.1 mm, which
  **only the app can know**, and Calibrate (its UI is `spec.extra`, a spec's
  own component under the fields; its clicks stay out of the Plane field
  through `spec.placeAtOnly`) writes `width × real / measured`. `spec.info` is
  slice 2's field kind.

### `e2e/joints.spec.ts`

- **Joints e2e** (`e2e/joints.spec.ts`, P6-05 J1–J3): the Viewport's
  `data-joints` ("Hinge:revolute:ok:<component>:1,0,0"), `data-joint-pose`,
  `data-posed-bodies`, `data-joint-check`, `[data-joint-handle]`,
  `[data-pose-bar]`; joint rows are `[data-joint]` with `data-joint-status` and
  `data-joint-type` under their moving component. The fixture is
  `fixtures/components/hinge.extrudo`; a whole-turn check takes 2-3 s there.

### `e2e/kernel.spec.ts`

- P0-09: on `#/debug/kernel` the `status` "Kernel status" reaches "ready" (15
  s), "Render test part" shows `[data-testid="part-summary"]` "Valid solid ·
  11 faces" and a canvas in `[data-testid="kernel-stage"]`. "Crash the kernel"
  makes the status "restarted 1×" and the notice "The kernel stopped and
  restarted.", and the next render works.

- P0-05: the four visual styles (Shaded, Shaded with edges, Shaded with hidden
  edges, Wireframe) are chosen from the "Visual style" button's
  `menuitemradio`s; wait for the fit to settle (`data-camera-size` not empty)
  plus 500 ms, screenshot the viewport canvas, and check all four pictures
  differ (`Buffer.equals`).

### `e2e/linked-folder.spec.ts`

- **Linked folder e2e** (`e2e/linked-folder.spec.ts`, P4-09): the File System
  Access API doesn't exist for a person in headless Chromium, so the spec
  stubs `showDirectoryPicker` with an init script over an OPFS directory
  (`navigator.storage.getDirectory()` then `getDirectoryHandle('linked', {create:
  true})`) — **OPFS handles have no `queryPermission`/`requestPermission`, so
  the stub adds both on `FileSystemDirectoryHandle.prototype`**, answering
  `window.__linkedFolder.permission` ('granted' by default; a second init
  script sets 'prompt' to see Reconnect). **Two traps in that stub, both found
  in the Playwright Ubuntu image CI uses**: an OPFS handle cannot be
  *deserialised* out of IndexedDB there (it crashes the renderer — `put` works,
  the `get` kills the tab), so the stub keeps the folder's **name** in the
  `handles` store and answers the read with a live handle rebuilt from that
  name (it patches `IDBObjectStore.prototype.put`/`get` and hands back a
  stand-in request); and a file being written through `createWritable` is
  briefly *not there*, so the spec's polls read it through `nameIn()`, which
  answers `undefined` instead of failing. Reading and writing those files from
  the test goes through `readArchive`/`writeArchive` imported from
  `../packages/storage/src/archive`, with the bytes base64'd across
  `page.evaluate` (**a `page.evaluate` string must end in `()` or Playwright
  evaluates it as a bare function**). The section is the region "Linked folder"
  with `data-linked-folder` (`none`/`needs-permission`/`ready`/`loading`) and
  file cards `[data-linked-file="<name>"]`; "Link a folder…", "Reconnect",
  "Unlink the folder" and "Refresh the linked folder" are its buttons; the
  project's own command is Home › Export tile "Save to Linked Folder" (ADR-0079;
  `fileAction`, and `hasFileAction` is false once the project is linked) and says "Saved <file> to the linked
  folder.". **The write-back is throttled**, so a test that edits and waits
  must wait 12 s for the trailing write; the file's bytes are read out of OPFS
  and `readArchive`d (check `doc.name`). A conflict is a `role="alert"` toast
  with "Load from disk" and "Overwrite".

### `e2e/macro.spec.ts`

- **Macro e2e** (`e2e/macro.spec.ts`, P5-05 slice 2): `pickTool(page, 'Record Macro')`
  / `'Stop Macro'` (menuitems of Create; only the one that applies is in the menu).
  The status bar's `[data-macro-recording]` holds the count ("Recording macro · 3
  features"). The dialog is the region "Macro" (`exact: true`) with
  `data-macro-dialog` (`ready`, `done`, `empty`), the read-only editor "Macro code",
  buttons "Copy", "Replace with a Script", "Keep both", "Close" (`exact: true`) and
  `[data-macro-outcome]` (`ok`/`refused`) with the message. **The dialog is modal, so
  the Viewport region leaves the accessibility tree while it is open**: read
  `data-bodies` before Stop or after Close. CodeMirror renders only the lines in view:
  read the whole code through Copy (`context.grantPermissions(['clipboard-read',
  'clipboard-write'])`, then `navigator.clipboard.readText()`). A script's body is a
  new body, so compare `data-bodies` without the names. Replace is checked against the
  recorded body's size and face count, one Ctrl+Z, then Ctrl+Shift+Z; Keep both
  gives "Script2" suppressed (unsuppress from the chip's right-click menu). The
  refusal test records a sketch with a dimension (`d1`) and adds the parameter
  `twice = d1 * 2`. Export Design as Script is Home › "Export as Script" (`fileAction(page,
  'Export Design as Script…')`, ADR-0079), which opens the **Export as script** dialog
  (`getByRole('dialog').filter({ hasText: 'Export as script' })`): radios `TypeScript` /
  `OpenSCAD`, the preview `[data-script-preview]` (the file, up to 400 lines, in a scrolling box), `[data-export-summary]`,
  buttons Copy and `Export TypeScript` / `Export OpenSCAD`. "Downloads the design with its
  parameters" checks the preview, Copy against the downloaded file, then Export; "offers
  OpenSCAD" picks OpenSCAD, waits for `cube(` in the preview (kernel write, up to 20 s), then checks the `.scad` download and the toast. 5 tests.

### `e2e/marking-menu.spec.ts`

- **Marking menu e2e** (`e2e/marking-menu.spec.ts`; P4-12: Ctrl+K "customize marking" opens
  Settings at `[data-settings-page="marking"]` (ADR-0090 §2), holding the checkbox "Radial
  right-click menu" and the region "Customize Marking Menu" with tabs Model/Sketch, wedge buttons
  `[data-slot-button="model:2"]` (`data-slot-command`, `data-slot-custom`), the
  combobox "Search commands", options by label and "Reset all"): right-click without
  movement opens `menu` "Marking menu" (`data-marking-menu="radial|list"`)
  with wedges `[data-marking-slot="<command id>"]` (`aria-disabled` when
  dimmed; `[data-wedge="n"]` in the ring's SVG carries `data-active` under
  the pointer); **the ring has no list** (R3-08), so a test that picks a row
  `[data-marking-entry="<id>"]` (`selectOther`, `sketchOnFace`, `measure`,
  `hideBody`, `appearance`, `fit`, `projection`, `delete`, `cancelTool`...; in the
  list style the wedges' commands are rows too, first) calls `listStyleMenu(page)`
  (`e2e/helpers.ts`, sets `marking.radial` false) **before** the page loads; the
  ring is `[data-marking-ring]`, the list `[data-marking-list="below|above|beside|short"]`
  (`scrollHeight <= clientHeight` unless `short`). Wedges pick on pointer release from the pointer's
  direction, so click them or press-move-release from the ring's centre
  (`ringCentre`). A right-click selects what is under it: the pointer at the
  middle of the wall bracket often hovers an edge, so `overFace` scans for
  `data-model-hover` `face:`. The sketch ring has no Delete wedge (the list
  style has the entry). While a sketch tool runs the selection overlay
  (`[data-selected-entities]`) is gone; `[data-sketch-summary]` is on both
  overlays. The debug kernel page has no `viewMenu`, so its right-click is
  still "Select other…" (`model-select.spec.ts`).

### `e2e/measure.spec.ts`

- **Measure e2e** (`e2e/measure.spec.ts`): the panel is the region
  "Measure" (`data-measure-state` empty/pending/ready/error), values are
  `[data-measure-row="<section>/<label>"]` ("Between/Distance",
  "Face 6 · Body1/Area": face numbers follow the kernel's order, so
  match item rows by suffix), the line is `[data-measure-line]` ("x1,y1
  x2,y2" in view px); the status bar's `output[aria-label="Selection
  size"]` reads "40.00 × 20.00 × 0.00 mm ·". Measure isn't in the Sketch
  tab (bodies only).

### `e2e/model-progress.spec.ts`

- **Model progress e2e** (`e2e/model-progress.spec.ts`, ADR-0078): with no cache an empty Bodies folder shows `[data-bodies-computing]` ("Computing bodies…", `aria-busy`) until the first recompute; the notice is
  `[data-model-progress="preparing|updating"]` (absent otherwise; text "Preparing
  your design…", "Computing 6 features"), the icon `[data-progress-icon]`, and a
  pending body row `[data-body-pending]` (`aria-busy`) in the browser. To make the
  window before the kernel is ready long enough, the spec reloads with
  `page.route('**/extrudo_occt*.wasm', …)` delaying the OCCT WASM by 4 s (routes
  cover the worker's fetch, and the e2e service worker is blocked); wait for
  the cache file in OPFS (`projects/<id>/model-cache.json`, written after the
  recompute, fire and forget) before reloading. Under reduced motion
  `getAnimations({ subtree: true })` on the icon is empty (pass it as a string).

### `e2e/model-select.spec.ts`

- **Model-selection e2e** (P2-03) reads the Viewport region's
  `data-model-selection` / `data-model-hover` (space-separated `kind:id`,
  faces as `face:<body>:<index>`) and the status bar's
  `output[aria-label="Selection"]` ("2 faces ·"). Map world mm to page px
  with `projector(viewport)` from `e2e/helpers.ts` (switch to
  Orthographic first for exact numbers). "Selection filter" contains
  "Select": match the nav bar's Select button with `exact: true`.

### `e2e/move-mirror.spec.ts`

- See `e2e/combine.spec.ts`: the Combine and Move/Mirror notes cover this
  spec's dialogs and helpers.

### `e2e/named-views.spec.ts`

- **Named views e2e** (`e2e/named-views.spec.ts`, ADR-0008's amendment): the
  nav bar's "Named views" button opens the menu (its save prompt is the
  dialog "Save current view", a textbox "Name" prefilled "View1" and
  Save/Cancel); restore is an animated move, so wait for
  `data-camera-direction`/`-size` to settle (the attributes are rounded to
  1e-3, so exact string compares are within 1e-3). The browser's "Named
  views" folder is closed by default — `openViewsFolder` in the spec only
  clicks it when `aria-expanded` is `false` (a second click closes it).
  Rows are buttons named after the view inside the `complementary` "Browser"
  (`data-view` on the row); their right-click menu is `menu` "<name> menu".

### `e2e/notifications.spec.ts`

- **Notification history e2e** (`e2e/notifications.spec.ts`): the bell is the
  button "Notification history…" (its name adds ", 2 new, 1 error"; it carries
  `data-unread` and `data-unread-errors` (`0` when nothing is new); it is
  always there, inside the region "Timeline", the status bar row, and the
  empty panel says "No notifications yet."); the panel is `dialog` "Notification history" with regions
  "Errors" and "Earlier", rows `[data-notification="error|info|success"]`
  (a repeat has `[data-count]`), and a stale action is a disabled button named
  "Show (no longer applies)". A toast is `[data-toast="<tone>"]`, at most 420 px
  wide; a long text (`[data-clamp-text]`, `data-clamped="true"` while clamped) has
  a "Show more"/"Show less" button and stays until dismissed once opened (R3-17;
  the history rows clamp the same way). The toasts stay in the view's
  bottom-right corner (12 px from its edges) and no longer cover the bell, so
  nothing needs dismissing to reach it; blur the bell after Esc closes its
  panel (focus returns to it) before pressing tool keys. Unit tests use `createNotifications({ now, later })` with injected
  clock and timers; `renderToStaticMarkup` sees only the store's initial state.

### `e2e/onboarding.spec.ts`

- **Onboarding e2e** (`e2e/tutorial.spec.ts`, `e2e/onboarding.spec.ts`, P3-12):
  the home screen now has the button "Take the tour" (and "Dismiss the tour"; it
  shows until the `onboarding.tour` preference isn't `new`, so a fresh context
  always has it; it doesn't match "New design") and the list "Templates" with
  the buttons "Start from the Wall bracket | Storage box | Box with a lid | PCB
  enclosure template" (their description is the one line). The tutorial card is
  the region "Tutorial" (`data-tutorial-step` `sketch`, `rectangle`, `dimension`,
  `extrude`, `round`, `finished`; text "Step 2 of 5"; buttons "Skip step", "Close
  tutorial", "Keep designing"), the ring round the control it points at is
  `[data-tutorial-ring="<tool id>"]` (the empty-design hint is gone, R3-15).
  Toolbar tiles carry `data-tool`. A tooltip is `getByRole('tooltip')` with a
  `kbd` and, for the thirteen tools with a clip, `video[data-tool-demo="<id>"]`
  (`data-playing` false under reduced motion). **Radix keeps a tooltip open
  when the pointer jumps away in one move** (its grace area): move with
  `mouse.move(x, y, { steps: 5 })` before expecting it gone. The tour walks
  the real flow in about 11 s: rectangle corners at (−20, −10) and (20, 10), a
  dimension on the bottom side labelled at (0, −16), the profile picked at the
  world origin in the home view, an edge picked at (0, −10, 15) for the fillet.
  `e2e/record-assets.spec.ts` (RECORD_ASSETS=1 only) is the demo recorder.

### `e2e/parameters.spec.ts`

- P0-07, ADR-0086: the dialog (`pickTool(page, 'Parameters')`, a Home tile;
  `parametersDialog(page)`) is a list and an inspector. **A parameter's
  fields exist only while it is selected**: rows are
  `[data-parameter-row="<name>"]` (`aria-current="true"` when selected),
  sections `[data-parameter-section="<title>"]` ("User parameters" while
  flat; "General", then groups); model parameters sit in the collapsed
  "Model parameters" section. Use `selectParameter(page, name)` and
  `parameterExpression(page, name)` (both open Model parameters when needed)
  and `addUserParameter(page, name, expression, unit?)` from `helpers.ts`
  (the form's "New parameter name"/"New parameter expression", the radio
  group "New parameter unit", "Add"; the new parameter is selected after).
- The inspector's textboxes: `Expression of <name>` (`exact`; accessible
  description = the live `= 75.20 mm`), `Name of <name>`, `Comment on
  <name>`, `Min/Max/Step of <name>`; the switch `Show <name> in customizer`;
  the group chips are buttons (`aria-pressed`) in the group `Group of
  <name>`, "New group" opens the textbox "New group name"; Delete is the
  button `Delete <name>`; refusals are the dialog's `alert`. A row's value
  is its text (`toContainText('75.20 mm')`).
- Wall bracket opens with General: inner, holes; Size: width; Walls: wall;
  Holes: tilt (the template's groups). Editing `wall` to `3 mm` moves
  `inner` to 74 and `d3` to 15. A unit error (`10 mm + 5 deg`) sets
  `aria-invalid`; Enter and blur don't commit; Esc reverts and keeps the
  dialog open, a second Esc closes it. A cycle (`inner + 1 mm` on `width`)
  reports "width refers to itself: width → inner → width.", a range using
  `inner` on width "The range can't use inner: it changes with width."
- **Drag is real**: `row.dragTo(target, { targetPosition: { x: 40, y: 4 } })`
  (the top half of a row = before it); `Alt+ArrowDown` on a focused row
  moves it; each is one undo step.

### `e2e/pattern.spec.ts`

- **Pattern e2e** (`e2e/pattern.spec.ts`, P3-07): the tools are Solid ›
  Pattern's tiles (`pickTool(page, 'Rectangular Pattern' | 'Circular Pattern' | 'Path
  Pattern')`); dialogs are the regions "Rectangular Pattern dialog"…, fields
  the buttons "Direction"/"Axis"/"Path" (`exact: true`) and textboxes "Count",
  "Distance" (`exact`), the combobox "Pattern" (Mirror's is "Mirror") with
  `bodies`/`features`, and for features a list of checkboxes named like
  `Cylinder1 cut` (`[data-feature]`). The ghosts are `data-preview` ("new
  new" for two copies, one `cut` for a repeated hole, "cut skip" with a
  skipped instance); handles `data-manipulators="distance:distance1
  count:count1 toggle:skip"` / `"angle:angle count:count toggle:skip"` /
  `"distance:distance toggle:skip"` (each kind and field listed **once**, even
  with a dot per instance). **P4-12's handles:** an instance's dot is
  `[data-instance-toggle="1x1"]` (with `data-skipped` on it), the count handle
  and the path's distance handle are `[data-manipulator-handle="count1"|"count"|
  "distance"]` whose `cx`/`cy` are px in the viewport, and the read-only
  "Skipped" line is `[data-labels="skip"]` (its text, "None" when empty, with a
  "Clear Skipped" button). A pattern's handles are drawn 14 px clear of the
  geometry (`lift`), so a drag must start where the handle is drawn but is
  measured from the origin: drag to the projection of a point on the *shaft*
  (the direction line's origin is the report's `series.first`, which for a
  features pattern is the *tool's* centre, not the body's), and take the count
  or the distance from what the drag reads, not from where the head was. The
  three new tests: a 3 × 2 pattern of a cut with a dot clicked out (five holes,
  one undo step), a count handle dragged two spacings (count 5), a circular
  one round the arc, and the path's distance handle. After switching to
  Features the pick field is stale: click the "Axis"/"Plane" button first. The
  Z axis is pickable above a 20 mm cube at (0, 0, 25…45) in the home view; a
  mirror plane at YZ needs a click where no body is in front (the spec tries
  a few points). Volumes read from a 3MF are a tessellation short of exact
  (`toBeCloseTo(v, -1)` for a cylinder hole). A copy body is "Body2" and so
  on in creation order.

### `e2e/plugins.spec.ts`

- P6-03 (ADR-0077): Ctrl+K "Plugins…" opens the `dialog` "Settings" at
  `[data-settings-page="plugins"]` (ADR-0090 §2). The example plugin
  (`examples/plugins/name-plate/`) is packed here with `writePluginFile` and
  installed through the section's own "Install…" file chooser
  (`name-plate.extrudo-plugin`, `application/zip`).

- The `status` "Plugins status" reports installs, refusals (same version) and
  enable/disable; rows are `[data-plugin="name-plate"]` with
  `[data-plugin-command="three-holes"]` and the "Enabled: Name plate"
  checkbox. Its "Three holes" command runs from Ctrl+K (`dialog` "Search",
  combobox "Search commands", option `… Plugins › Name plate`), runs in the
  worker sandbox and adds two features (Sketch1, Extrude1) as one undo step:
  `data-bodies` `Body1:9:60,20,20`.

- Slice 3: an enabled plugin's custom feature appears in Solid's Create menu
  ("Name plate") and Ctrl+K opens the dialog generated from its manifest
  (`region` "Name plate dialog", "Plugin: Name plate 1.0.0"); pick the XY
  plane square at `[h*0.5, -h*0.5, 0]` (`h = data-camera-size * 0.16`) and the
  preview reaches `ok|warning` (≤ 60 s). The design carries the plugin file:
  `exportProject` + `readArchive` find one attachment
  (`application/x-extrudo-plugin`), and undo removes the file's record with
  the feature.

### `e2e/press-pull.spec.ts`

- **Press/Pull e2e** (`e2e/press-pull.spec.ts`, P3-08): with a face selected
  (hover until `data-model-hover` is a `face:`, then click; the cube from the
  Box tool has its top at (0, 0, 20)) press `q`: the dialog is the region
  "Offset Face dialog" / "Edit Offset Face1 dialog" (the chip's name has a
  space, `chip(page, 'Offset Face1')`), the pick field the button "Faces"
  (`exact: true`: "1 face", or more once a smooth chain came along: a cube's
  faces are alone, a rounded body's are not) and the textbox "Distance"
  (`exact`, 2 mm by default, positive out). A cube pulled 5 mm is
  `Body1:6:20,20,25`; a too-far distance says "can't move in by 25 mm: that is
  too far for this body (max ≈ 15 mm)" in the region "Feature status". A
  cylinder's wall is picked at `(r·0.707, −r·0.707, h/2)` in the home view. `q`
  on an edge opens "Fillet dialog" ("1 edge"), on a profile selected in the
  model "Extrude dialog"; with nothing selected a toast says "Select a face to
  move, an edge to round or a sketch profile to extrude, then press Q." The
  marking menu's wedge is `[data-marking-slot="pressPull"]` (enabled since
  P3-08). **Keep rounds' radius** (ADR-0051's second amendment) is the
  checkbox of that name (on for a new offset); the kept rounds' count is
  `[data-info="keptRounds"]` ("1 round keeps its radius", absent at 0). The
  cube's vertical edge between +X and the front is found by hovering a few
  pixels either side of `(10, −10, 10)`; rounded 3 mm the cube is
  `Body1:7:20,20,20`, its +X face (clicked at `(10, 3, 10)`) pulled 4 mm
  `Body1:7:24,20,20` with the box on and `…24,24,20` off. Kernel-side: `pnpm vitest run -u packages/kernel/src/features/offset-face`
  rewrites the golden table; the facade's native harness lives in the
  scratchpad (`#define private public` over `extrudo_facade.cpp`, sweeps of
  every face at eight distances found no heap trap, unlike the shell's).

### `e2e/primitives.spec.ts`

- **Primitives e2e** (`e2e/primitives.spec.ts`): the dialogs are the
  regions "Box dialog"… (from `pickTool(page, 'Box')`), the Plane field
  the button "Plane" ("XY plane", "XZ plane", "1 face"). While Plane is the
  pick field the view picks planes and faces like Create Sketch, so
  `data-model-selection`/`-hover` are absent; click origin planes at world
  points with x ≥ 0, y ≤ 0, z ≥ 0 inside the square (view size × 0.16) in
  the home view, where no other plane is in front, and faces the same way.
  **P4-12:** that click also sets X and Y to the point (a face click lands within
  about a millimetre of the projected point: don't assert tighter), the dialogs'
  handles are `[data-manipulator-handle="x"|"y"|"offset"]` (`cx`/`cy` in view px;
  heads that meet are lifted 14 px by the overlay, so a head can sit 14 px off
  where its value says), and the Box's **"Two corners"** button carries
  `[data-corners]` (`off`, `0`, `1`: the corners marked); the next two clicks on
  the plane set X, Y, Length and Width (the height stays; a turned box goes back
  to 0°) and disarm; Esc with focus in the dialog disarms. The right side of the
  home view is under the dialog: pick points with a negative y of about
  −0.2 h or more. P4-12's second amendment gives the Torus dialog the
  comboboxes "Axis" (`normal`/`x`/`y`) and "Seat" (`centre`/`plane`; `plane`
  rests it on the plane, `offset` still adding): the test sets Axis X +
  Seat On the plane and reads `Body1:1:10,50,50` (one face). The kernel golden table updates with `pnpm vitest run -u
  packages/kernel/src/features/primitives`.

### `e2e/print-aids.spec.ts`

- **Print aids e2e** (`e2e/print-aids.spec.ts`, P3-10): the 3D Print tab's
  Prepare group has the buttons "Place on Bed", "Print Info" and
  "Overhangs" (`/^Overhang/`). The Print Info panel is the region "Print
  Info" (`data-print-state` `empty`/`pending`/`ready`/`error`, rows
  `[data-print-row="volume|printed|weight|filament|cost"]`, the native selects and
  fields "Material" (`selectOption('petg')`, `'custom'`), the textboxes
  "Density", "Walls", "Line width", "Infill" and "Price per kg" and the radios
  "1.75 mm" / "2.85 mm"; a density of 0 or an infill of 150 shows the
  expression error and isn't taken). The material test sets Infill to 100
  first, so its numbers are P3-10's solid ones; the walls/infill/cost test
  (P4-12) makes the Box tool's 20 mm cube (8 cm³, 2400 mm² → 3.04 cm³ printed
  at 2 × 0.45 mm and 15 %, 3.8 g of PLA, 0.09 at 25 per kg), changes the walls,
  the line width and the price, rounds a decimal wall count, and checks that
  Ctrl+Z undoes the Box but not the settings and that a reload keeps them. The
  Overhang panel is the region
  "Overhang Analysis" (textbox "Angle" with `exact: true`, combobox "Down"
  with `selectOption('+z')`, checkbox "Show overhangs", buttons "Done" and
  "Remove"); the Viewport region's `data-overhang` reads "down=-z angle=45
  faces=1 triangles=11 area=226 bed=90" (counts are over the shown bodies;
  `… off` while the shading is off; absent with no analysis), the
  browser row is `[data-overhang-row="on|off"]` (eye "Hide overhang").
  The wall bracket is an L in XZ extruded ±40 mm along Y: its outer wall
  face (x = 0, 80 × 60) is the one to lay down; look at it with Shift+6 and
  click (0, 0, 30) after the camera settles (a point 1 mm from the
  L-shaped end faces or the wall's thin edges hits an edge or the wrong
  face). Laying it down makes `data-bodies` "Bracket:12:60,80,40". The
  dialog is the region "Place on Bed dialog" (button "Face"); the
  context entry is `[data-marking-entry="placeOnBed"]`. The dialog also has
  the textbox "Spin" (`exact`, an angle; 90 deg swaps the bracket's X and Y
  extents: "Bracket:12:80,60,40") and its Face field takes several faces.
  The Overhang panel's "Use selected face" button (enabled while one flat
  face is selected) makes its outward direction "down": `data-overhang`
  reads `down=face(-1,0,0) angle=45 …`, the Down combobox has the value
  `face` ("Picked face") and the browser row says "Overhangs · Face · 45°".
  The overhang shading itself is a shader patch, so it isn't in the counts:
  `overhang-shading-chromium-linux.png` (the Viewport region, +Z down in the
  home view) is checked in, made in CI's image like the section shots.
  Kernel-side tests:
  `pnpm vitest run packages/kernel/src/features/place-on-bed`.

### `e2e/project.spec.ts`

- See `e2e/sketch-on-face.spec.ts`: its notes carry the P4-12
  Project/Intersect details.

### `e2e/pwa.spec.ts`

- **Service worker and e2e** (P2-15, `e2e/pwa.spec.ts`): the config sets
  `serviceWorkers: 'block'` for every test (each fresh context would
  otherwise cache 20 MB of WASM); `pwa.spec.ts` opts in with
  `test.use({ serviceWorkers: 'allow' })`. Wait for
  `navigator.serviceWorker.ready` (resolves after the whole precache);
  the cache is `extrudo-precache`, its keys absolute URLs, and
  `context.setOffline(true)` + `page.reload()` proves the offline path. The
  cache is matched with `ignoreVary` because `vite preview` sends
  `Vary: Origin`. The worker exists only in `pnpm build` output
  (`dist/sw.js`), never in dev. Agent worktrees in `.claude/worktrees/`
  are gitignored, so Biome (which reads `.gitignore`) skips their nested
  `biome.json`.

- **Update toast e2e** (`e2e/pwa.spec.ts`, "an update is waiting"): the host
  swaps `/sw.js` for a copy with another `VERSION`, `registration.update()` makes
  the browser install it, and it **waits** (the old version stays active:
  `activeVersion` reads the `x-extrudo-version` header the worker stamps on
  `.previous-precache` when it activates); the toast "A new version of Extrudo is
  ready." has the button "Reload" (`exact: true`). After it the new version is
  active and the page reloaded; a project rename made just before survives.
  Unit tests: `platform/updates.test.ts`, `updateNotice.test.ts`,
  `project/autosave.test.ts` (`saveEverything`).

### `e2e/recompute.spec.ts`

- P2-01: `kernel` is the `status` "Kernel" (contains `/computed in [\d.]+
  ms/`, carries `data-model-status`), `status` the `status` "Status"
  (`exact`), chips are buttons in the `list` "Features" (`Sketch1`, then
  `Extrude1 (rolled back)`); helpers `kernelReady`, `openProject`, `pickTool`,
  `rollMarker`. A created sketch gives "1 feature · mm".

- On the Wall bracket the chips read
  `['Sketch1','Extrude1','Sketch2','Extrude2','Fillet1','Plane1 (rolled
  back)']` and "6 features · mm". Rolling Home/End moves the `(rolled back)`
  names; Plane1 comes in as `Plane1 (error)` with "6 features · mm · 1 error"
  and the tooltip "Plane · error: This version of Extrudo can't compute";
  Suppress turns it into `Plane1 (suppressed)`.

### `e2e/record-assets.spec.ts`

- See `e2e/onboarding.spec.ts`: `RECORD_ASSETS=1` only, the demo recorder.

### `e2e/revolve.spec.ts`

- **Revolve e2e** (`e2e/revolve.spec.ts`): the dialog is the region
  "Revolve dialog", the axis field the button "Axis" ("Y axis", "1
  sketch curve"); origin axes appear in `data-model-hover` /
  `data-model-selection` as `axis:origin:y`. In the default Top view
  the Y axis is pickable at sketch (0, 45); the status bar says "1
  profile, 1 axis". An origin axis behind a profile can take a click
  meant for the profile in sketch-mode tests; use "Select other…" or
  click off the axis. The revolve golden table updates with `pnpm
  vitest run -u packages/kernel/src/features/revolve`.

### `e2e/rib.spec.ts`

- **Rib e2e** (`e2e/rib.spec.ts`, P4-10): the tool is `rib`, a tile of Solid ›
  Features after Emboss (`pickTool(page, 'Rib')`, no key); its dialog is the region "Rib
  dialog" / "Edit Rib1 dialog" with the button "Line" (`exact: true`: a sketch
  line reads **"Line · Sketch3"**, the sketch it is in), the `Thickness`
  textbox (`exact`), the `Thickness side` combobox (`both`/`one`/`other`) and
  the `Flip` checkbox; `data-manipulators` reads `distance:thickness
  arrow:flip`. The Line field takes a sketch line **selected in the view**
  (pre-selection) or one picked while the dialog is open; the hover reads
  `sketchEntity:`. Two things to know: the Line tool's key is `l` (`r` is the
  Rectangle, and a rectangle's profile takes the pick in front of a line on the
  same plane), and it needs **two Escapes** (the first ends the chain). The
  Wall bracket's own sketch lies in the same plane as a new sketch on XZ and its
  profile face takes every pick along a diagonal, so the spec hides it and
  Sketch2 with their eyes for the pick. The volume is read from a 3MF export
  (`exportModel` + `objectsOf3mf`, the signed volume of each triangle's
  tetrahedron); the bracket is `Bracket:12:40,80,60` and the rib takes it to 16
  faces. Flipped, the preview errors: the region "Feature status" inside the
  dialog says "The rib doesn't close against the body", `data-preview-status`
  is `error`, `data-dialog-valid` is **absent** (it is there only while the
  dialog can commit) and OK is disabled; the bodies drawn are the ones from
  before the draft.

### `e2e/scale.spec.ts`

- See `e2e/split-body.spec.ts`: its notes cover Split Body, Scale and Draft
  together.

### `e2e/script.spec.ts`

- **Script e2e** (`e2e/script.spec.ts`, P5-02): `pickTool(page, 'Script')` opens
  the region "Script dialog"; a chip double-click opens "Edit Script1 dialog".
  The editor is the textbox "Script code" (`.cm-content`, contenteditable): click,
  `Control+a`, then `page.keyboard.insertText(code)` for bulk source; use real
  `keyboard.type('.')` for completion and real keys for undo/Esc/Tab. Read code
  with `innerText()` (CodeMirror lines are separate divs, so `toHaveText` joins
  them without newlines). Wait for `data-preview-status="ok"` before OK, up to
  30 s for the first runner load; `data-preview` on the viewport shows the body.
  Line errors have `.cm-lintRange-error` inside `.cm-line` (zero-based locator
  position); "Feature status" says "Line 3: …" and OK has `aria-disabled`.
  The "Script output" region contains console text; `[data-script-made]` reads
  "Made N features". Completion is `.cm-tooltip-autocomplete`. The loop test's
  60 × 60 × 5 mm plate has 10 faces at count 4, 12 at count 6, and 13 after the
  stored fillet. Both hosting's whole-session walk and axe's two-theme dialog
  audit include Script. The first test prints editor-open, request-to-preview
  and worker-load timings from the performance measures (ADR-0070 slice 3).

### `e2e/section.spec.ts`

- **Section analysis e2e** (`e2e/section.spec.ts`): the Viewport region's
  `data-section` ("origin:xy offset=30 mm on", "… flipped on", "… off",
  "face:<id> offset=… on"; absent with no section; **several sections joined by
  `;` in the order added**, a box `box=cx,cy,cz:hx,hy,hz on` in mm as evaluated)
  and `data-section-clip` (the plane while it clips: `0,0,30:0,0,1` = origin,
  then the unit normal of the **removed** side; absent while off and in sketch
  mode; one entry per plane joined by `;`, the box's six in the order +x −x +y −y
  +z −z; the sketch Slice's clip last while a sketch is open and
  `sketch.slice` is on, which also brings the person's planes into sketch
  mode; the region then also carries `data-sketch-slice="on|off"`, absent
  with no sketch open — `e2e/sketch-slice.spec.ts` walks it). **P4-12:** each plane is a `fieldset` `[data-section-index="<n>"]`
  (legend "Plane 2") holding its own "Offset", "Flip", "Show section", "Change"
  and, from two rows on, "Remove" (`exact: true`: the footer reads "Remove", or
  "Remove all" with several rows); the buttons "Add plane" (`exact`) and "Box"
  (`exact`) switch the choosing state, the panel has `data-section-mode`
  (`planes`/`box`), the box's textboxes are "Centre X/Y/Z" and "Half-size X/Y/Z"
  (`exact`), handles are `[data-section-handle="0"|"1"|"2"|"box:+x"…]` and
  `[data-section-arrow]` (on the overlay's div) lists every arrowhead `x,y;x,y`
  in drawing order (drag a handle along the line to its arrowhead to grow the
  cut; the spec's `dragHandle` does it). **Esc closes the panel**: don't press
  it between clicks. The browser row reads "Section · 2 planes" or "Section ·
  Box". The panel
  is the region "Section Analysis" (`data-section-state` `choosing`, `lost`,
  `on`, `off`; buttons "XY plane"…, "Change", "Done", "Remove"; textbox
  "Offset" with `exact: true`; checkboxes "Flip" and "Show section"); the
  arrow's handle is `[data-section-handle]` (`cx`/`cy` in view px, drag it
  with `mouse.down` and several small `move`s); the browser's row is
  `[data-section-row="on|off"]` (eye "Hide section" / "Show section"). While
  the panel is open with no section it is *choosing*, and a click in the view
  picks a plane or face for the section: press Done (Remove closes it)
  before clicking model faces. On the Wall bracket a click at (2.4, 0, z) on
  the inside wall lands on Sketch1's outline (a sketch curve on the same
  plane): use y = 20. Sketch mode leaves the camera looking at the sketch:
  press Shift+1 and re-read the projector. The two `section-*.png`
  screenshots (full page, dark and light) come from CI's image.

### `e2e/settings.spec.ts`

- **Settings e2e** (`e2e/settings.spec.ts`, ADR-0082): Ctrl+, opens `dialog`
  "Settings" (also the Menu's App item "Settings…", whose accessible name ends with
  the key); sections are `[data-settings-section="general|plugins|marking|keyboard|view|sketch|printing|export|desktop|agents"]`
  (`desktop` and `agents` only in the desktop build: the web build has neither; the Agents
  page has combobox "Agent", the read-only textbox "Setup for <agent>" `[data-agent-setup="<id>"]`,
  the `status` "Skill state", buttons "Copy", "Install skill" / "Update skill" / "Save skill to…"
  and "Regenerate token")
  (the Radial right-click menu checkbox is on `marking`; the last section is remembered,
  so a test that reopens the dialog clicks the section it needs)
  (buttons in `[data-settings-nav]`; at under 640 px a combobox "Section" instead) and the
  page is `[data-settings-page="<id>"]`. Fields are named after what they are: textboxes
  "PLA density", "PETG density", "ABS density", "TPU density", "Custom density" (`exact`:
  "Walls", "Line width", "Infill", "Price per kg"), buttons "Reset PLA density" (only while
  changed) and "Reset 3D printing to defaults", radios "Light"/"Dark"/"System" (theme),
  checkboxes "Radial right-click menu", "Snap to grid", "Auto-project body edges"…, comboboxes
  "Mouse buttons", "Projection", "Visual style", "Default format", "Default resolution". The
  number fields write as you type (`fill`, then `blur()`); Print Info's textbox "Density" shows
  the effective density for **every** material. Preferences are localStorage, so a reload keeps
  them; the desktop section isn't in the web build.

### `e2e/settings-keyboard.spec.ts`

- Settings › Keyboard (ADR-0082's 2026-10-18 amendment): the page is
  `[data-settings-page="keyboard"]`, rows `[data-keymap-row="<id>"]` with
  `data-keymap-changed="true"` when overridden and `data-keymap-recording` while
  recording (the recorder listens on `window` in the capture phase, so plain
  `page.keyboard.press` goes to it). Buttons: "<label>: <key>" per key (`Hole: H`),
  "Add key to <label>", "Reset <label>", "Reset all keys"; the filter is the textbox
  "Search commands" (the page's, not Ctrl+K's combobox) and buttons All / Model / Sketch /
  Changed (n). A same-mode clash is the row's `alert` ("E is Extrude here.") with Replace /
  Cancel. A tile's right-click: `[data-tool="hole"]` `click({ button: 'right' })`, then the
  menuitem "Change shortcut…". A Search row's key button is `[data-change-shortcut]`
  (visible on the active row). Read the preference with
  `localStorage.getItem('extrudo.keymap.overrides')`.

### `e2e/shell-feature.spec.ts`

- **Shell e2e** (`e2e/shell-feature.spec.ts`, P3-03; not `shell.spec.ts`, the
  app shell's): the tool has no key: click the toolbar's Shell tile
  (`getByRole('button', { name: /^Shell/ })`) after picking the top face
  (hover until `data-model-hover` is a `face:`, then click at world (0, 0, 20)
  of the Box tool's cube). The dialog is the region "Shell dialog" / "Edit
  Shell1 dialog": the button "Faces to remove" ("1 face", prompt "Pick
  faces"), the button "Body" ("1 body"; it shows only while no face is
  picked), the textbox "Thickness" (`exact`, default "2 mm") and the combobox
  "Direction" (`inside`/`outside`, `selectOption`). A cube shelled inside
  with its top removed is `Body1:11:20,20,20` in `data-bodies`, outside
  `Body1:<n>:24,24,22`, hollowed closed `Body1:12:20,20,20`. A 12 mm wall on
  the 20 mm cube says "(max ≈ 9.9 mm)". Kernel-side, the golden table is
  `pnpm vitest run -u packages/kernel/src/features/shell`. A shell that fails
  is diagnosed by rebuilding it (7 builds, about 80 ms for a box); a removed
  face next to a fillet that a plug can't open (curved, a slanted neighbour,
  touching another removed face) is refused without running OCCT. **P4-12's
  wall sets:** the button "Wall faces" (`exact`, prompt "Pick faces for
  another thickness") and, once it has faces, the textbox "Wall thickness"
  (`exact`, default "4 mm"), then "Wall faces 2"…; the spec picks the cube's
  floor for it from below (Shift+3, world (0, 0, 0)): `Body1:11:20,20,20`
  still, and the 3MF's volume is exact (`solidFacts`): 3904 mm³ at 4 mm, 4416
  at 6 mm.

### `e2e/shell.spec.ts`

- P0-04, the app shell: full-page screenshots
  `shell-dark.png`/`shell-light.png` (`animations: 'disabled'`, `caret:
  'hide'`) with `document.fonts.ready` awaited as a string. The theme follows
  the system (dark) by default; choosing Light in the Menu's rail (radio "Light")
  survives a reload.

- The browser panel resizes: the `separator` "Resize browser" (width 248)
  responds to ArrowRight (280), Home (180) and End (480) and to a mouse drag
  (330), and keeps its size across a reload. "Hide browser" collapses it (the
  panel is hidden, "Show browser" is a ≤ 32 px tab); the timeline has no
  toggle and the marker `slider` is always shown.

- The marker moves with `rollMarker` (`(rolled back)` chips 0/6), and Ctrl+Z /
  Ctrl+Y undo and redo it. "Send to Slicer" is `aria-disabled` in the web
  build and its tooltip says to export a 3MF and open it in a slicer
  (ADR-0062).

### `e2e/site.spec.ts`

- **Landing page e2e** (`e2e/site.spec.ts`, ADR-0057): serves `apps/site/dist`
  (fresh `pnpm build` builds it with the app) through `startStaticHost`; the
  heading "Parametric CAD for 3D printing, in your browser." (spans `.hl-sketch`
  and `.hl-solid`), the nav's links (Apps with its `.new` pill, Features, Changelog, Docs, GitHub, Open Extrudo),
  the `.soon` pill, links "Open Extrudo" (`[data-open-app]`,
  `https://app.extrudo.org/`) and "Try the latest build", the scroll stage.
  `[data-walkthrough]` gains `data-enhanced` when `walkthrough.ts` runs; it builds
  `.scrolly-track` > `[data-walkthrough-stage]` (the pinned, `aria-hidden` stage:
  `img[data-step]` with `data-active` on the current one, `.caption[data-active]`,
  `[data-walkthrough-counter]` "Step n of 9", `.chip`s with `data-active`/`data-done`
  and the `.marker`) from the `li.step[data-step]` list, which stays as a
  visually hidden `ol` (width 1 px) with `aria-current="step"` on the current item
  and `data-active-step` on the section. **A test drives the scroll position**: the
  track is `n - 0.4` stretches long and a step's picture rests for the first 0.4 of
  its stretch (`scrollToStep(page, n, extra)` in the spec scrolls with
  `behavior: 'instant'`, since the page has `scroll-behavior: smooth`); a resting
  picture's computed `transform` is `none`, a half-dealt one's a matrix; the
  stage's `--tilt` is 12 below the hero and 0 pinned or under reduced motion; a
  chip's click scrolls to its step. The deck never deals past a picture that
  isn't decoded, so reaching step 9 proves all nine loaded. **The toy** is
  `[data-toy]` (`[data-toy-drawing]`, `[data-toy-weight]`, sliders named "width",
  "height", "fillet radius"; hidden without scripting): the tests use the keyboard
  (End/Home) and a mouse drag, and the breathing stops on the first `input`.
  `StaticHost.serve(dir)` switches the host's build
  (the app first, its worker installed, then the site): the retiring `sw.js`
  sometimes waits behind the open tab, and the old app's update toast (Reload)
  sends `SKIP_WAITING`; the spec takes that path when the page didn't switch by
  itself. Routes to the app are fulfilled with `page.route`. "Cloudflare Web
  Analytics runs under the landing page's content policy" serves the built
  `index.html` with the beacon tag injected before `</body>` through
  `host.override` (which takes a content type, as `/` has no extension) and stubs
  both Cloudflare hosts with `page.route`: the script (which then posts to the RUM
  endpoint) must load, or the site's policy has stopped allowing analytics.
  "Every text on the landing page meets WCAG AA contrast against what is painted
  behind it" makes every glyph transparent (through the CSSOM: the policy refuses
  an injected `<style>`), screenshots the page and reads the pixels behind each
  text box in a blank page of its own (a data-URL image on a canvas, 2 px inside
  the box, the 2nd/98th luminance percentile), under both system themes at 1280
  and 375 px (the page is dark in both): axe calls text over the body's gradient
  *incomplete*. SVG text (the toy's labels) is read by `fill`, and the headline's
  dashed underline is hidden for the measurement (it hangs into the next line's
  box). Text on the hero's glow takes `--x-glow-muted`/`--x-glow-link`
  (`apps/site/src/tokens.css`); **a hidden caption is `visibility: hidden`, not
  just `opacity: 0`**, or the test (which counts any translucent text as a failure)
  reports it. "The landing page is dark under a light system theme, the docs are
  not" proves the split.
  **Docs site e2e** (ADR-0068 §6, the same spec): the footer's "API docs" link
  (`[data-api-docs]`, `/docs/api/`), the docs index's sidebar (`nav[aria-label="API
  docs"]`, with a "Create" group) and a feature page's inputs table (`table th`:
  "Input", "Type", "Required or default", "What it does"), its face roles and its
  example code, the sidebar link that navigates (`aria-current="page"` on the page's
  own entry), **no `script` element at all** and no policy violation
  (`watchPolicy`), plus an axe audit of both themes on `/docs/api/` and a feature
  page. The pages come from `docs/api/**.md` at build time, so run `pnpm
  api:generate` before `pnpm build` when the Markdown changed, and the unit tests
  are `apps/site/src/docs.test.ts` (every file becomes a page, links point to
  pages, the sidebar's order).

- **Features, download and FAQ e2e** (`e2e/site.spec.ts`, ADR-0057's amendment of
  2026-10-11): `/features/` is a second page of the site (`apps/site/features/index.html`;
  both pages take the header, footer and icon sprite from `apps/site/src/partials.ts`
  through `<!-- site:… -->` markers, the header marking the current page with
  `aria-current`). Its `nav` "On this page" links seven sections (`#sketch` … `#yours`),
  the format matrix is the `table` "File formats Extrudo imports and exports" (13 rows,
  cells "Yes: …" / "No" through `.sr-only`), and a **"Latest build" tag** (`.tag`) marks
  what only edge has: take the tags off when a release ships those features. The landing
  page keeps `nav` "Features" (links to `/features/#…`) and `[data-all-features]`, and its
  FAQ is the `region` "Questions and answers" (eleven `<details>`). `/download/` (the
  hero's pill `[data-download]`, "Available", the nav's "Apps" link, marked current
  there, and the footer's "Desktop app" lead there)
  has `nav` "Platforms" and the regions "Windows", "macOS" and "Linux"; it names files by
  their ending and links `releases/latest`, never a version. The contrast measurement
  and axe run on all three pages with every `<details>` open and skip `.sr-only` text.

### `e2e/sketch-constraints.spec.ts`

- P1-06: glyphs are `[data-constraint]` buttons named "`<name>` constraint"
  (`exact`), in the overlay not the palette; helpers `clicker`, `counts`,
  `sketchOnXY`. A rectangle gives 8 glyphs (4 Coincident, 2 Horizontal, 2
  Vertical); hovering one highlights its line through `[data-highlight]
  [data-highlight-entity]`. A Horizontal/Vertical **between two points**
  (a corner level with a circle centre) is one glyph halfway between them,
  named "Horizontal (points) constraint" (ADR-0094), so an `exact`
  "Horizontal constraint" locator doesn't count it; a corner level with the
  end of a level line gives a "Collinear constraint" glyph on each edge and
  no own Horizontal on the new edge.

- Click selects (`aria-pressed`), Shift-click adds (`modifiers: ['Shift']`),
  Esc clears and Delete removes (Ctrl+Z restores); an empty-space click
  clears; the wheel still zooms over a glyph; the palette's "Show constraints"
  checkbox hides them all.

- The `Constraints` group's Parallel tool (`toolPrompt` "Pick a line." / "… to
  make parallel to it.", hover `[data-preview="hover"]
  [data-highlight-entity]`) refuses a redundant one ("Parallel isn't needed:
  the sketch already holds it."). Holding Ctrl while drawing turns inference
  off, so nothing is inferred.

- Constraint chords (ADR-0023, amendment 2026-10-18): `k` shows
  `[data-chord-hint]` (`role="status"`, lists "Horizontal"…); the second key
  (`h`) ends it and starts that **tile's tool** (the tiles ignore a
  preselection, so `toolPrompt` reads "Pick a line to make horizontal…" and a
  click on the line adds the glyph). Esc ends the hint and is swallowed: the
  selection (`[data-selected-entities]`) stays. A line drawn with Ctrl held
  needs **two Esc** (next segment, then the tool) before `toolPrompt` is gone.

### `e2e/sketch-dimensions.spec.ts`

- P1-07: labels are `[data-dimension]`, the in-place editor
  `[data-dimension-editor]`; helpers `clicker`, `mapping`, `pickTool`,
  `sketchOnXY`. The Dimension tool (`d`) places a length with a
  `[data-preview="dimension-label"]` preview, then opens the editor's "Value
  of d1" focused; typing `25` changes the label to `25.00` and the line with
  it, and one Undo takes the value and the line back.

- On a circle the label reads `⌀20.00`; hover highlights the circle, a click
  selects it, and dragging moves the label (about 60 px / 30 px) as one undo.
  Double-click edits, the checkbox "Driven (measures only)" turns it into
  `(⌀20.00)`, and the right-click `menu` "Dimension menu" offers Edit Value
  and Delete (P3-17); the palette's "Show dimensions" hides the labels.

- A dimension is a parameter: after Finish Sketch, `pickTool(page,
  'Parameters')` shows the row under `Sketch1`, and `name = value` in the
  editor creates a parameter and uses it (FR-PAR-03, the label's `title`
  becomes `d1 = len`). Deleting a parameter in use is refused ("w is used by
  d1. Change that first."); reopening the sketch fits the view again.

### `e2e/sketch-datums.spec.ts`

- ADR-0093 (#61): `sketchOnXY`, a Line (30,-10)-(30,10) (inference makes it
  vertical; one Esc leaves the tool's next segment, the prompt stays), then
  `d`: the line at (30,5), the **Y axis at (0,25)** (a datum pick; a line
  and its parallel axis, or a point and an axis, need **no placement click**:
  the second pick commits, ADR-0093). The dimension lands only after the
  kernel reports the projected axis, then opens "Value of d1" (wait up to 60 s for
  focus); `20` + Enter moves the line to x = 20 (`[data-dimension]` reads
  `20.00`, the last `[data-dimension-graphic] line` is 20 mm). The active
  sketch's `data-sketch-projected` reads `…:curves=1:x=0..0:y=-50..50` (the
  100 mm construction line; the origin point adds no curve). Then the line's
  top end (20,10), the **origin (0,0)** (the projected axis gives way to the
  origin there) and a label at (-8,5), left of both: a vertical distance,
  "Value of d2" = `10` (point ↔ origin still waits for the placement click).
  `data-sketch-projected` lists projected entities, not drawn segments, so
  "datum projections are not drawn" is a unit test (`sketchGeometry.test.ts`).

### `e2e/sketch-drawing.spec.ts`

- P1-04: `clicker` + `counts` + `sketchOnXY` draw and count what lands in the
  sketch; the prompt is the `status` "Tool prompt". Rectangles: `r` (two
  corners), "3-Point Rectangle" and "Center Rectangle" (four edges, two
  construction diagonals and the centre point).

- Circles: `c` with a typed diameter becomes a dimension; "2-Point Circle" and
  "3-Point Circle". Arcs: `a` (3-point), "Center Point Arc" (round in mouse
  moves, `[data-preview="arc"]`) and "Tangent Arc" (tangent to a line's end).

- "Point" places points; pressing on a line's end and dragging makes a tangent
  arc ("Release to place the tangent arc."); the `x` key toggles construction
  geometry, shown dashed as `[data-preview="line"][data-construction]` and
  mirrored by the palette's construction checkbox.

### `e2e/sketch-export.spec.ts`

- P1-13: the Sketch tab's "Export" group tile "Export Sketch" (label wraps, so
  match `exact`) opens the `dialog` "Export sketch" with radios "Selected
  profile"/"All curves"/"All profiles" and `/^DXF/`; `[data-export-summary]`
  reads "1 profile, 60 × 40 mm", "5 curves, 60 × 40 mm" or "no closed
  profiles". `save` waits for `page.waitForEvent('download')` beside the click
  and reads the file with `readFile`.

- The SVG is `Untitled - Sketch1.svg` with `width="60mm" height="40mm"
  viewBox="-30 -20 60 40"`, one `<path … fill-rule="evenodd">` (outer loop and
  hole); the DXF is `AC1009` with 4 `LINE` and 1 `CIRCLE`. Selected profiles
  are chosen first (the overlay's `[data-selected-profiles]`).

- A timeline chip's right-click menu has `/^Export SVG or DXF/`; an open
  sketch of one line has no profiles, so "All profiles" says "no closed
  profiles" and "Export SVG" is disabled.

### `e2e/sketch-modify.spec.ts`

- P1-10: helpers `clicker`, `counts`, `pickTool`, `sketchOnXY`; a helper draws
  a 60 × 40 rectangle. Sketch Fillet (`f`) hovers to show the corner's radius
  and a typed 6 locks it (1 arc, 4 lines, 1 dimension). Trim (`t`) previews
  the cut-away part as `[data-preview="removed"]`, keeps the line count and
  adds one constraint; one Undo takes it back.

- Offset (`o`) picks the whole closed chain, the side and a typed distance (5
  mm, adding 8 lines and 4 dimensions). Mirror (from the Create menu) picks
  four sides, Enter, then the mirror line (13 lines). The Modify group's tiles
  carry `[data-tool][data-label="<name>"]`; its menu holds the tools that
  aren't tiles (`Sketch Chamfer`, `Extend`, `Break`, `Move`, `Copy`, `Sketch
  Scale`, ADR-0079) and their names end with the shortcut.

### `e2e/sketch-on-face.spec.ts`

- **Sketch on face / Project e2e** (`e2e/sketch-on-face.spec.ts`, 90 s
  timeout) reads the Viewport region's `data-sketch-frames`
  (`<id>:<origin>:<normal>`) and `data-sketch-projected`
  (`<id>:curves=N:x=a..b:y=c..d`). Projected curves appear one
  recompute after `addProjection`: poll in e2e, and call
  `host.syncProjections(reports)` in unit tests. Code that rebuilds a
  `SketchData` must keep `projections` (spread `...data`) or the
  solver frees projected geometry. The kernel builds sketch faces from
  the stored curves, not fresh projections. While Create Sketch waits,
  the view (not R3F plane events) picks planes and faces
  (`PlanePicker.faces`). An XY sketch under a body is hidden behind its
  faces (depth test). **P4-12** (`e2e/project.spec.ts`): the tools' panel is
  the region "Project" or "Intersect" (`exact`) with the checkbox "Keep linked"
  and "Done"; Intersect is `Shift+P` in a sketch; a body is picked by its
  browser row (`complementary` "Browser", button "Body2", `exact`); the
  summary's bounds are the curves' **points**, so a projected circle reads
  `curves=1:x=0..0:y=0..0` (its centre); projected curves are fixed in
  `data-sketch-status` (`free=0 fixed=2` for a circle), an include's free
  (`free=12 fixed=0` for four lines) with no `data-sketch-projected`. A sketch
  on XY over a body below it opens fitted to the body in **perspective**, so
  the sketch plane's curves can be off-screen: `zoomOutTo` and map through
  `projector` at z = 0 before dragging them. An angled construction plane for
  Intersect is the Angled Midplane of a Box's front and top faces, made
  **before** the next body changes the home view's fit.

### `e2e/sketch-profiles.spec.ts`

- **Sketch e2e tests read profiles** from the Viewport region's
  `data-sketch-profiles` ("profiles=2 holes=1", absent while "Show
  profiles" is off) and the selection overlay's `data-selected-profiles` /
  `data-hover-profile` (region IDs). Snap to grid is on in e2e: put test
  geometry on grid points (10 mm steps in the default Top view) or it
  lands elsewhere (a circle snapped against a side made it no hole).

- P1-11: profiles are read from the Viewport region's `data-sketch-profiles`
  (`profiles=1 holes=0`, then `profiles=2 holes=1` for a plate with a hole)
  and the overlay's `[data-selected-profiles]`; helpers `clicker`,
  `sketchOnXY`.

- Hovering the plate away from any curve sets `data-hover-profile`; a click
  selects it and the region "Selection" shows title "Profile", "Area" `2085.84
  mm²` and "Holes"; Shift adds the hole's disc; an empty click clears. A line
  across the plate splits it (`profiles=3 holes=1`), and Ctrl+Z takes the
  split back.

- The palette checkbox "Show profiles" (`blur()` after) makes
  `data-sketch-profiles` null and stops picking profiles.

### `e2e/sketch-select.spec.ts`

- **Sketch e2e tests read the selection** from the selection overlay's
  `data-selected-entities` (IDs) and `data-hover-entity`; it also carries
  `data-sketch-summary` while no tool runs. `page.mouse.click` takes no
  `modifiers`: hold Shift with `keyboard.down`/`up`. Shortcuts (Ctrl+Z)
  don't fire while a panel control has focus; `blur()` it first.

- **A constraint glyph can sit over a corner and take a click meant for
  the point** (only in CI's Ubuntu image, P1-10's select test): uncheck
  "Show constraints" (then `blur()` it) before clicking corners in e2e.

- P1-09: selection is read from the overlay's `[data-selected-entities]` and
  the region "Selection" (`[data-selection-title]`, "60.00 mm", "8 points, 4
  lines", "2 selected"); `page.mouse.click` takes no `modifiers`, so hold
  Shift with `keyboard.down`/`up`. Empty space keeps a Shift selection; Esc
  clears it.

- A left-to-right window box (steps 4) takes what is inside, a right-to-left
  crossing box what it touches; the box is `[data-selection-box]`. Dragging a
  circle's rim (Fix/Unfix its centre first, uncheck "Show constraints")
  resizes it in one undo; dragging an edge moves it with a live solve; typed
  coordinates in the panel's "X"/"Y" fields move a point; Delete takes
  geometry with its constraints.

- A press on the view just above the nav bar, released on a nav button, leaves
  no box behind — the view never hears the release.

### `e2e/sketch-shapes.spec.ts`

- P1-05: helpers `clicker`, `counts`, `pickTool`, `sketchOnXY`; the prompt is
  the `status` "Tool prompt", heads-up fields live in the group "Heads-up
  input". Polygons: "Inscribed Polygon" (typed diameter in the box),
  "Circumscribed Polygon" (fill the "Sides" textbox with 5) and "Edge Polygon"
  (via an edge and a side).

- Slots: "Center to Center Slot" (two edges, a construction centreline and two
  arcs) and "Overall Slot" (typed width 6). An Ellipse
  (`[data-preview="curve"]`, three points) and a "Fit Point Spline" finished
  with Enter.

### `e2e/sketch-slice.spec.ts`

- See `e2e/section.spec.ts`: its notes carry the sketch Slice's
  `data-sketch-slice` and clip details.

### `e2e/sketch-status.spec.ts`

- **Sketch e2e tests read constraint status** from the Viewport region's
  `data-sketch-status` ("free=… fixed=… conflict=…") and the palette's
  `data-constraint-state`/`data-dof`. The browser pane may not draw the
  WebGL viewport at all (no `data-ready`); take screenshots with Playwright.

- P1-08: the palette's `[data-constraint-state]` reads "Nothing to constrain
  yet", "4 DOF left", "1 DOF left", "Fully constrained ✓"; helpers `clicker`,
  `sketchOnXY`. The Viewport region's `data-sketch-status` mirrors the counts
  (`free=12 fixed=0 conflict=0`, then `free=10 fixed=2` after Fix/Unfix,
  `free=0 fixed=12` when fully constrained).

- A dimension that would over-constrain opens the `alertdialog`
  "Over-constrained": "Cancel" adds nothing, "Add as driven" opens the editor
  and the label reads `(40.00)` with `data-driven="true"`; trying to un-drive
  it says "Distance would over-constrain the sketch, so it stays driven." and
  leaves the box checked.

### `e2e/sketch-tools.spec.ts`

- P1-02, the tool framework through the Line tool: helpers `sketchOnXY`; the
  overlay is `[data-sketch-summary]`, the prompt the `status` "Tool prompt",
  heads-up fields the group "Heads-up input". `l` (or the "Line" button,
  `exact`, `aria-pressed`) draws a closed rectangle with inferred constraints,
  snapping a point a little off the 10 mm grid.

- Alignment guides are `[data-guide="horizontal"]` (two at a corner) and the
  endpoint glyph `[data-snap="endpoint"]`; the exact summary is asserted
  (`points=8 lines=4 … constraints=8 dimensions=0`) and Ctrl+Z removes the
  last segment.

- The heads-up box takes a typed length and angle: typing goes into "Length"
  (`2*d` is `aria-invalid`; `20` shows `= 40.00 mm`), Tab moves to "Angle",
  Enter commits, and Esc ends the chain then the tool.

### `e2e/sketch.spec.ts`

- **Sketch e2e tests read the open sketch from the tool overlay's
  `data-sketch-summary`** ("points=8 lines=4 … constraints=8 dimensions=0"),
  and map sketch mm to page pixels from the camera attributes in the Top
  view (`sketchOnXY` in `e2e/helpers.ts`). The overlay exists only while a
  drawing tool runs. Tool unit tests use `sketch/tools/testing.ts`
  (`setup({ tool })`, real planegcs).

- P1-01: Create Sketch picks an origin plane in the view or from the region
  "Create Sketch" (buttons "XY"/"YZ"), the camera turns to look at it, the
  toolbar swaps to the `tablist` "Toolbar tabs" tab "Sketch" (Solid gone) and
  the region "Sketch palette" opens on `Sketch1`; Finish Sketch (group
  "Finish") goes back.

- The in-view plane pick uses `data-camera-shift` (NDC): a point to the
  origin's right, 13 % of the view's height away, lies on XY only; hover shows
  `cursor` `pointer` on `div.touch-none` and the XY button gets
  `/border-accent/`.

- Camera directions are asserted as data attributes (XY `0,0,-1` up `0,1,0`;
  YZ/Right `-1,0,0` up `0,0,1`); the timeline `slider` "Timeline marker" is
  `aria-disabled` while a sketch is open; creating the sketch is one Undo
  step, and a reload reopens it.

- The palette has the "Sketch grid" checkbox (shared with the nav's Grid
  button) and a "Look at" button (turns the camera back); the Wall bracket's
  Sketch1 (XZ, Front view `0,1,0`) and Sketch2 (`0,0,-1`) open by
  double-clicking their chips, and double-clicking another finishes the
  current one. The screenshot is `sketch-mode-dark.png`.

### `e2e/smoke.spec.ts`

- The home screen: title `Extrudo`, `img` "Extrudo" (`exact`), the text
  `extrudo` (`exact`) and the heading "Your designs"; then `openProject(page,
  'wall-bracket')` and the button `/^Project name: Wall bracket/`.

- Collects `pageerror`s and asserts none at the end.

### `e2e/solver.spec.ts`

- `#/debug/solver`: the `status` "Solver status" reaches "ready" (15 s), then
  "Drag test" fills `[data-testid="solver-results"]` with 4 rows (30 s); each
  row's cells give the component count and "DOF 1" for "Rectangle, hole,
  slot", "Anchored plate" and "Chained plate".

- `[data-testid="solver-conflict"]` contains "2 constraints involved"; no
  `pageerror`.

### `e2e/spline-conic.spec.ts`

- **Spline and conic e2e** (`e2e/spline-conic.spec.ts`, P4-05): both tools come
  from the Create menu (`pickTool(page, 'Control Point Spline')` and `'Conic'`;
  neither has a key). A control-point spline is four clicks on grid points and
  Enter (`counts` then reads `splines: 1 points: 4`), a line from its last
  control point back to the first closes the region
  (`data-sketch-profiles` is `profiles=1 holes=0`), and a click on the dome's
  apex selects the curve, so the panel says "Control points: 4". A conic is
  three clicks (the heads-up box shows Rho from the first), the panel's Rho
  field takes 0.3 (`getByRole('textbox', { name: 'Rho' })`, `0.5` to `0.3`),
  a line closes it, and Finish Sketch then a profile pre-selection
  (`data-model-selection` starting `profile:`) and E extrudes 5 mm into one body
  40 mm wide whose height is the rho's share of the shoulder's (0.3 × 15 mm).
  A filled-in conic takes a moment to preview: `data-preview-status` polls up
  to 30 s. **P4-12**: a control spline clicked round (−30, −10) (30, −10)
  (30, 30) (−30, 30) and back on (−30, −10) is closed (the panel's checkbox
  "Closed" is checked; select it at (0, −8.33), where the periodic curve runs
  between the two lower poles) and alone is `profiles=1 holes=0`; a fit wave
  through (−40, 0) (−20, 20) (0, 0) (20, 20) (40, 0) trimmed with `t` at (20, 20)
  against a line at x = 10 shows "Control points" (the point count can stay the
  same: the piece has as many poles as the fit had points), and a click at a
  fit point after Ctrl+Z selects the **point** (points win the pick); `o` on
  the wave at (−20, 20), the pointer above and `2` makes `splines: 2` with no
  dimension. **Third amendment**: a fit spline through (−30, 0) (0, 20)
  (30, 0) is selected at (−15, 15) (on its quadratic, not a fit point); the
  viewport's `data-tangent-grips` then reads `start:x,y end:x,y` in sketch mm
  (only for one selected open fit spline in the open sketch). A drag
  (`mouse.down`, 5-step move, `mouse.up`) from the end grip 20 px up stores
  the end's tangent: the panel's **Free ends** button appears with
  `data-spline-tangents="end"`. A control spline through (−40, 0) (−20, 40)
  (0, 20) (20, 40) (40, 0) is selected at its crown (0, 30); the panel's
  `textbox` "Degree" reads `3`, `5` is refused with "A degree-5 spline needs
  at least 6 points.", `2` sets `data-spline-degree="2"` on the field's row.
  Both close with a line and extrude into one body (`extrudeAt`).

### `e2e/split-body.spec.ts`

- **Split Body, Scale and Draft e2e** (`e2e/split-body.spec.ts`,
  `scale.spec.ts`, `draft.spec.ts`, P3-08): the tools are the Modify tab's tiles
  (ADR-0079: `pickTool(page, 'Split Body' | 'Scale' | 'Draft')`); dialogs are the regions
  "Split Body dialog", "Scale dialog", "Draft dialog" (and "Edit Split Body1
  dialog"…). Split: buttons "Bodies" and "Plane", combobox "Keep"
  (`both`/`above`/`below`); a cube from the Box tool split by YZ is
  `Body1:6:10,20,20 Body2:6:10,20,20`. Scale: combobox "Scale type"
  (`uniform`/`non-uniform`), textboxes "Scale factor", "X factor"… (`exact`),
  checkbox "Create copy"; a factor of 1 previews as a *warning*. Draft: buttons
  "Faces" (`exact`) and "Plane", textbox "Angle" (`exact`, default "3 deg"),
  checkbox "Flip", `data-manipulators="angle:angle"`. A plane field picks like
  Create Sketch (no `data-model-hover`): click an origin plane's square beside
  the body in the view a new design opens with (the camera is wide enough
  there; after Shift+1 the cube covers the squares). Kernel golden tables:
  `pnpm vitest run -u packages/kernel/src/features/split-body` (`scale`,
  `draft`). The facade's native harness for these lives in the scratchpad
  (sweeps of 5,544 drafts and the scales of 11 bodies trapped nothing).

### `e2e/storage.spec.ts`

- **Newer files in e2e**: write `projects/<id>/document.json` in OPFS from
  `page.evaluate` (see `storage.spec.ts`) to simulate a newer Extrudo.

- To simulate a newer Extrudo, write `projects/<id>/document.json` in OPFS
  from `page.evaluate` (the way `storage.spec.ts` does).

### `e2e/sweep-loft-coil.spec.ts`

- **Sweep, loft and coil e2e** (`e2e/sweep-loft-coil.spec.ts`, P4-01): the tools
  are Solid › Create's tiles (`pickTool(page, 'Sweep' | 'Loft')`, `startPrimitive(page,
  'Coil')`); dialogs are the regions "Sweep dialog", "Loft dialog", "Coil dialog"
  ("Edit Sweep1 dialog"…). Sweep: buttons "Profiles" and "Path" (`exact: true`;
  "1 edge"), combobox "Orientation" (`follow`/`fixed`), textboxes "Twist" and
  "End scale". Loft: button "Sections" ("2 sections"), checkboxes "Ruled" and
  "Closed". Coil: button "Plane" ("XY plane"), comboboxes "Type", "Direction",
  "Section", "Section position", textboxes "Diameter", "Revolutions", "Height",
  "Pitch" (the one the type doesn't use is absent), "Taper angle", "Section
  size", `data-manipulators="distance:diameter distance:height"`. The Sweep
  dialog's read-only Placement line is `[data-info="placement"]`
  ("Profile on the path's start." or "Profile 31.6 mm from the path's start:
  the sweep carries it where it is drawn."). The default
  coil is `Body1:7:22,22,22` (a face per turn; the wire is centred on the start height, half of
  it below the plane). The spec's profile is a circle at (40, 0) beside a Box
  cube, swept along the cube's edge at (10, −10, 10): the profile need not
  touch the path. Kernel-side, the golden tables are `pnpm vitest run -u
  packages/kernel/src/features/sweep-loft-coil`; the facade's native harness is
  `bash spikes/p4-01-harness/run.sh` (and `run.sh leaks 600`, about 15 min).

### `e2e/text.spec.ts`

- **Text e2e** (`e2e/text.spec.ts`, P4-03): the tool is `text` (Shift+T) in the
  Create menu (`menuitem` `/^Text/`, "Text Shift+T"); its panel is the region
  "Text" with the textarea "Text", the `Font` select (values like
  `inter-regular@1`), the three `aria-pressed` alignment buttons and the
  `Height` textbox (`10 mm`), plus "OK Ctrl+↵" and "Cancel Esc". It appears
  only **after** the click places the anchor (the first Esc closes the panel,
  the second ends the tool), and a font other than Inter is fetched when it is
  picked, so the ink (and `data-text-bounds`) arrives a moment after OK. A text
  in the model is one pick whatever letter was hit: `data-model-selection` is
  `sketchEntity:<sketch>/<text>`, and the extrude's `Profiles` field reads
  **"1 text"**. "Extrudo" at 10 mm is `profiles=9 holes=2` and extrudes 2 mm
  into 7 bodies, all `…:…,2` in `data-bodies`; the `o` is the four-face one
  (two caps plus its counter, so the counter is a hole, not a body). The
  selection panel's `Text` textarea and `Height` textbox edit a placed text
  (commit on blur); reopening a sketch by double-clicking its chip rolls the
  extrude back, and Finish Sketch rolls it forward. The Viewport region's
  **`data-text-bounds`** is `<sketchId>.<textId>:x=min..max:y=min..max` in
  sketch mm per drawn text — the alignment and height assertions read it, and
  a text without its font has none (the attribute is absent).

### `e2e/thread.spec.ts`

- **Thread e2e** (`e2e/thread.spec.ts`, P4-02): Modify › Modify › Thread
  (`pickTool(page, 'Thread')`, ADR-0079); the dialog is the region "Thread
  dialog" / "Edit Thread1 dialog": button "Faces" (`exact`, "1 face"), combobox
  "Size" (values `auto`, `m8`, `m16x1.5`, `unc-1q4-20`…, `custom`; Diameter and
  Pitch exist only off `auto`), "Profile" (values `iso` default, `trapezoidal`,
  `buttress`, `bottle`) and, only for `buttress`, "Load flank" (`start`/`end`),
  "Extent", "Hand", textboxes "Length", "Offset", "Starts" (`exact`, unitless, "1"; 2 gives the same
  `19.8,19.8,20` with more faces),
  "Tolerance" (`exact`), checkboxes "From the other end", "Lead-in chamfer". A
  thread takes seconds to preview (wait up to 60 s). The default Ø20 cylinder
  threaded to fit is `Body1:<n>:19.8,19.8,20` (M20 less twice the tolerance);
  Size `auto` fits ISO 261 coarse from M2 to M64 (`METRIC_COARSE` in
  `packages/core/src/thread.ts`: a bore takes the thread just above it, a shaft
  the largest thread inside it), and a thread of more than `MAX_TURNS` (150,
  `packages/kernel/src/features/thread.ts`) turns is refused before anything is
  built — over `MAX_TURNS` it takes minutes of booleans, and above about 400
  turns OCCT's boolean runs out of memory and traps (ADR-0067 §H2).
  Kernel: `pnpm vitest run -u packages/kernel/src/features/thread` rewrites the
  golden table; `BENCH=1` times threads (`features/thread-bench.test.ts` times
  B9's `capDia` × 2). P4-12's taper test (ADR-0056's third amendment) drafts a
  Ø21.97 Cylinder 1.79 deg about XY (Draft, `e2e/draft.spec.ts`'s way: its
  wall at (0, −10.985, 10), the plane on XY's square), picks the cone's wall at
  half height and sets Size `npt-1q2` (Pitch reads "1 in / 14"): the dialog's
  `[data-info="designation"]` reads "NPT 1/2" and `data-bodies` keeps z = 20
  with x and y at least 0.1 under the drafted cylinder's (whose display box
  reads 21.9 or 22 across).

### `e2e/timeline-groups.spec.ts`

- **Timeline groups e2e** (`e2e/timeline-groups.spec.ts`, P4-09): the Wall
  bracket template (Sketch1 Extrude1 Sketch2 Extrude2 Fillet1 | Plane1). A run
  is picked with `chip.click()` then `click({ modifiers: ['Shift'] })` and
  grouped from the chip's right-click menu, whose first item reads **"Group 2
  features"**; an open group is `[data-group-band]` with `[data-group-label]`
  holding its name, a folded one `[data-group][data-group-collapsed]` with the
  accessible name **"Group1, 2 features"** (folder glyph, count, worst status)
  and an `IconButton` "Expand Group1" beside it. F2 renames a chip (focus it,
  then the textbox "Rename Group1"); the group's own menu (`click({ button:
  'right' })`) has Rename, Expand/Collapse, Hide/Show, Suppress/Unsuppress and
  "Ungroup 2 features". The marker slider skips a folded group's gaps: Step
  back from 6 goes 5, 4, 3, 1 (never 2), and folding a group the marker is
  inside opens it again. The marking menu's list carries
  `[data-marking-entry="group"]` after two chips are picked. The bracket's
  members grouped are Extrude1 + Sketch2 (adjacent, so the group may straddle
  the marker), and suppressing them leaves the view with no bodies: the features
  after them lose the references they had.

### `e2e/timeline-v2.spec.ts`

- **Timeline v2 e2e** (`e2e/timeline-v2.spec.ts`; P4-12: the Viewport region's
  `data-ghosts` lists `<featureId>:<type>:<x,y,z>` — in the lost-face test, hovering
  Sketch2's chip gives `<id>:plane:0,-10,15` and it stays while Redefine Plane is
  open): the marker is the
  slider "Timeline marker" (`aria-valuenow` = active features,
  `aria-valuetext` "After Extrude1"); while it is dragged the real marker
  stays and `[data-marker-ghost]` holds the target index. There are no playback
  buttons (R3-01): `rollMarker(page, 'Home' | 'End' | 'ArrowLeft' |
  'ArrowRight')` (`e2e/helpers.ts`) focuses the marker and presses the key, and a
  disabled marker (a sketch or dialog open) has `aria-disabled="true"`. Neither
  the ghost nor a chip's drop line may widen the list (R3-02: `insideContent`;
  `e2e/timeline.spec.ts` checks `scrollWidth <= clientWidth` with the PCB
  enclosure's nine chips). A dragged chip
  shows `[data-drop-index]` (and `data-drop-refused`); drag with
  `mouse.down` and several `mouse.move` steps (> 4 px), dropping at a
  chip's left edge + 3 px lands before it. Chips carry
  `data-feature-status` and names like "Sketch2 (warning)". Redefine
  Plane is the region "Redefine Plane". The "Sketch1 is hidden" toast
  covers the first chips: dismiss it before right-clicking them. Snap to
  grid moves off-grid clicks (5 mm snapped to 10 in a zoomed-out view).

### `e2e/timeline.spec.ts`

- **Timeline and browser e2e tests** read drawn sketches from the
  Viewport region's `data-sketches` (IDs) and the highlighted one from
  `data-highlight`; chip names end with "(rolled back, suppressed)".
  A browser row locator `listitem.filter({ has: button })` also matches
  the folder's `<li>`: take `.last()`. Radix `asChild` triggers nested
  through our wrappers need the wrapper to pass props and ref on
  (`Tooltip` does); anchor popovers on a plain element.

### `e2e/tolerance.spec.ts`

- **Tolerance e2e** (`e2e/tolerance.spec.ts`, P4-08): the panel is the region
  "Print tolerance" (`data-tolerance` `unset`/`set`, `data-tolerance-usage` for
  the count line) with the textbox "Print tolerance" and the `aria-pressed`
  buttons "Tight 0.1 mm", "Normal 0.2 mm", "Loose 0.3 mm"; the tile is
  "Tolerance" (`exact`) in the 3D Print tab's Prepare group and **toggles** the
  panel, so close it (Done) before another dialog covers it. The Parameters
  dialog is a **Home** tile since ADR-0079, so `pickTool(page, 'Parameters')`; there the row's field is "Expression of tolerance" and its value
  shows as "= 0.20 mm" under it. One Ctrl+Z per change (the panel's write is one
  command): the edit, then the parameter. A hole's M3 clearance preset then reads
  `3.4 mm + 2 * tolerance` (counterbore diameter `6 mm + 2 * tolerance`, depth
  plain `3.3 mm`) with the combobox still on `m3-clearance`, and without the
  parameter `3.4 mm`. Picking the hole's face follows `e2e/hole.spec.ts`: the
  home view (**Shift+1**, not Shift+2) and `projector` — the projected surface
  point is the click in any view.

### `e2e/topbar.spec.ts`

- ADR-0079's one top bar: `tablist` "Toolbar tabs" lists Home, Solid, Modify,
  Construct, 3D Print (Solid selected by default), there is no File menu and
  no Insert tab, and `header` holds Search, Undo and Redo. The chrome above
  the view is ≤ 134 px (top bar 40 + toolbar row 92 + border).
- The app menu (ADR-0090): `appMenu(page)` is the header's button "Menu" (the right side
  is Version history and Menu; no Help button). `openAppMenu(page)` opens (or finds) the
  panel, the `dialog` "Menu"; `pickPreset(page, 'Crank')` focuses the radio in the
  `radiogroup` "Mouse controls" and presses Space (the panel stays open);
  `railToggle(page, name)` returns a rail toggle (`aria-pressed`);
  `pickMenuItem(page, 'App' | 'Learn', label)` clicks a column item by its label
  (`menuItemName`: the accessible name is the label then the key, e.g. "Settings…Ctrl+,",
  so names are matched as `^label(?![a-z])`) and the panel closes. Rail controls leave
  the panel open; Escape closes it and focuses the Menu button. On open the panel itself
  has the focus. **Tooltips:** the first Escape closes an open rail tooltip, not the
  panel; a pointer moving from one rail control to another may keep the first tooltip
  open (Radix's grace area), so a test presses Escape before hovering the next one. A
  click on a tooltip trigger keeps its tooltip shut until the pointer leaves, so hover
  before clicking. Slicer is `aria-disabled` (Playwright's `toBeDisabled` sees it; a click
  needs `force: true`).
  Home's `navigation` "Extrudo" has the links Docs and GitHub and an About button
  (opens the dialog, ADR-0085);
  `help-links.spec.ts` routes `https://github.com/**` like the docs host.

- Text baselines are measured through an injected zero-size inline-block
  probe; all five tabs share the wordmark's baseline (≤ 1 px) and the
  Search/Undo/Redo glyph centres line up. The title group
  (`[data-title-group]`) is centred between Redo and "Version history" (≤ 2
  px), and under a narrow window its `data-title-fit` goes `full` → `dot` (the
  save word hides) → `truncate` (the name is ellipsised, with the full name in
  `title`).

- The toolbar fits the window: `#toolbar-groups` carries `data-toolbar-fit`,
  groups are `[data-toolbar-group]` with tiles under `[data-toolbar-tiles]`,
  and moving tiles into a group's menu matches `fitToolbar`
  (`apps/web/src/shell/toolbarFit`). Home's Import/Export groups and
  Construct's four groups are checked by tool id (`R3-09`/`R3-10`/`R3-12`),
  and a real sketch shows only Home and Sketch (`R3-11`).

- The Menu's rail holds "Auto-project body edges"/"Auto-project face
  outline" (toggles, shared with a sketch's palette), the theme radios and
  "Radial right-click menu", in step with the `Right-Click Menu: Use the Ring`
  command. The panel is as wide as its rail (the Mouse controls and Theme groups
  sit within 16 px of its edges), App and Learn side by side. The web build has no
  Open File / Save As / Quit and no Check now.

### `e2e/tutorial.spec.ts`

- See `e2e/onboarding.spec.ts`: the tour steps in `tutorial.spec.ts` and
  `onboarding.spec.ts` share the same notes.

### `e2e/user-fonts.spec.ts`

- **User fonts e2e** (`e2e/user-fonts.spec.ts`, P4-03b): both Font selects
  (`Font` in the Text panel and in the Selection panel) list the bundled fonts,
  then an `optgroup` "This design" with the document's attachments, then
  "Add font…" (`value="add"`); choosing it opens the platform file picker, so
  the test waits for `page.waitForEvent('filechooser')` beside the
  `selectOption({ label: 'Add font…' })` and calls `chooser.setFiles(path)`
  (an existing file, or `{ name, mimeType, buffer }` written to
  `info.outputPath()`). What comes back: the select's value becomes
  `attachment:<id>`, `data-font-hint` is under the select, and "Hi" in
  `packages/fonts/fonts/fredoka-semibold.ttf` is `profiles=3 holes=0` (its own
  name reads "Fredoka Light", and its dot is a solid of its own), which
  extrudes 2 mm into **3 bodies**; an export and an import of the design keep
  them, with nothing saying a font is missing (the missing-font notice is a
  `status` toast: "1 font is missing from the file; its texts show without
  letters"). A file that isn't a font is refused with a toast
  ("This file isn't a font Extrudo can read: it doesn't look like a font
  file.") and the select keeps the font it had.

### `e2e/versions.spec.ts`

- **Versions e2e** (`e2e/versions.spec.ts`): Ctrl+S opens the dialog
  "Versions" with the textbox "Description" focused; the list is
  "Saved versions" (items carry `data-version`), buttons "Restore V1",
  "Open V1 as a copy"; toasts "Saved V1.", "Restored V1. What you had is
  kept as V2…". The app bar has a "Version history" button beside the
  name (it moved the centred name a little: shell/sketch baselines).

- **Versions e2e** (P3-13): per-row "Delete V3" buttons and "Delete older
  versions" (shown past 10) open an `alertdialog` "Delete V3?" / "Delete
  V1?" with Cancel/Delete.

### `e2e/viewport.spec.ts`

- P0-05: the camera is mirrored on the Viewport region as
  `data-camera-direction`/`-up`/`-target`/`-size`, so the tests check the
  camera, not pixels. The `group` "ViewCube" turns to axes, edges, roll arrows
  and turn arrows; `status` "Current view" names the view (home is `Top Front
  Right view`, direction `-0.577,0.577,-0.577`).

- Mouse presets live in the Menu rail's `radiogroup` "Mouse controls"
  (radios Crank, Spindle, Glide, Blender, Slicer (disabled), Trackpad; Spindle
  default; each tooltip "Mouse controls: <name>" with the bindings as hint) and
  in the Settings dialog's combobox "Mouse buttons" (R3-03). `choosePreset`
  uses `pickPreset`, then Escape.

- Spindle: middle-drag orbits, right-drag pans, left-drag neither; Shift swaps
  them (R3-04). Glide: middle-drag pans, Shift+middle orbits, wheel zooms, F6
  refits; Blender orbits with the middle button and is remembered across a
  reload. `data-cursor` / the cursor CSS on `div.touch-none` show the active
  nav tool (Orbit/Zoom/Pan), `pickTool` or a key ends it, and a menu-only tool
  marks its group's trigger with `data-active`.

- Projection, grid and "Show/Hide XY plane" buttons change the canvas picture
  (compared by `canvas.screenshot()`) and are remembered across a reload.
  Right-click menus stay out of the view and the panels (none open over nav,
  palette, browser or tabs, but a text field keeps `INPUT`). F6 fits what is
  drawn (a Ø40 circle gives 46 mm, not the sphere's 74).

### `e2e/wall-thickness.spec.ts`

- **Wall thickness e2e** (`e2e/wall-thickness.spec.ts`, P5-06): the 3D Print
  tab's Prepare tile "Wall Thickness" opens the region **"Wall Thickness"**
  (`data-thickness-state` `on`/`off`): the textbox **"Minimum"** (`exact`,
  default "0.9 mm"), the checkbox "Show thin walls", the result lines in
  `[data-thickness-result]` ("No wall is thinner than 0.9 mm.", "Thinnest
  wall: 1.00 mm", "Thin area: 3200 mm² in 1 body") and the buttons "Done" and
  "Remove". The Viewport region's **`data-thickness`** reads `min=1.5 thin=4
  area=3200 thinnest=1 bodies=1` (`… off` while the shading is off, `pending`
  while measuring, absent with no analysis, `thinnest=none` with nothing
  measured), the browser row is `[data-thickness-row="on|off"]` (eye "Hide
  wall thickness" / "Show wall thickness", label "Wall thickness · 0.9 mm").
  The numbers are display-mesh estimates: a 40 × 40 × 1 plate is `thinnest=1`
  with `area=3200` at a 1.5 mm minimum, a 20 mm cube shelled to 2 mm
  `thinnest=2` (its rim measures the wall's height, not its thickness). The
  spec logs the Wall bracket's time from click to counts for ADR-0072's
  Results and fails on any console error (the shading is a shader patch: a
  broken one shows there, not in the counts).

### `e2e/webkit-smoke.spec.ts`

- The only spec of the `webkit` project (`testMatch` in the config; the
  chromium project ignores it). One test: `sketchOnXY`, `r`, two clicks
  (0,0)–(40,30), Escape → `data-sketch-profiles="profiles=1 holes=0"`, Finish
  Sketch, pick the profile at (20,15), `e`, Distance `10`,
  `data-preview-status="ok"` (30 s: WebKit draws WebGL in software and
  compiles the WASM without a cache), OK → `data-bodies="Body1:6:40,30,10"`;
  no `role="alert"` toast and no page error. WebKit 26.6 ran it in 12 s in the
  Playwright image. Its console shows the same warnings as Chromium (service
  worker blocked, THREE.Clock deprecated) and nothing WebKit-only.

### `e2e/webgl-fallback-nogl.spec.ts`

- See `e2e/webgl-fallback.spec.ts`: the "No WebGL" launch option makes this
  separate file.

### `e2e/webgl-fallback.spec.ts`

- **WebGL fallback e2e** (`e2e/webgl-fallback.spec.ts`, `webgl-fallback-nogl.spec.ts`,
  ADR-0076): the e2e browser draws in software (SwiftShader), so `playwright.config.ts`
  pre-sets `render.softwareNotice` to `dismissed` through `use.storageState` (key
  `extrudo.render.softwareNotice`, JSON value) and `screenshot.css` hides `[data-renderer]`;
  the software test clears the storage state (`test.use({ storageState: { cookies: [],
  origins: [] } })`). "No WebGL" is an init script making `getContext` return null for
  `webgl`/`webgl2`; the region "3D view unavailable" has "Try again". A launch option forces
  a worker, so the `--disable-gpu --disable-software-rasterizer` test has its own file (`--disable-gpu --disable-software-rasterizer`, default `--enable-unsafe-swiftshader` ignored, does yield no WebGL in Chrome here; `--disable-gpu` alone does not). The root boundary is `#/debug/crash`; a context that fails after detection (probe canvases detached, the page's canvas null) reproduces three.js's "Error creating WebGL context"; a lost context
  is `WEBGL_lose_context` on the canvas, `[data-webgl="lost"]`.
