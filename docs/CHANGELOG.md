# Changelog

One line per completed roadmap task, newest first. Dates are absolute.

## Next

- 2026-10-10 · **Import .f3d (ADR-0082)**: a new package, `@extrudo/f3d`, reads Fusion `.f3d` files (ZIP with Zstandard entries, the design's object stream, ASM B-rep face tags) and rebuilds what it can as an editable design — user parameters; sketches (lines, circles, arcs, splines, conics, texts) on origin planes, planes parallel to them, or planes turned about an origin axis; extrudes with their selected regions, start offsets and faces and up-to faces; revolves; holes (simple, countersink, counterbore); circular patterns of features; offset faces; fillets and chamfers by edge — and reports the rest. Home › Files › **Import .f3d…** (and the home screen) makes a new design with the file's preview as its thumbnail; a notice says how many timeline features came across. The format is written down in `packages/f3d/FORMAT.md`.
- 2026-10-10 · **A chamfer's face handles on curved edges and faces (P4-12, ADR-0043's fourth amendment)**: the two-distance face arrows and the distance-and-angle arc are read **locally at the edge's middle** (by arc length, per display triangle) instead of from whole-edge flat geometry, so a chamfer on a cylinder's top rim now shows `distance:distance distance:distanceB` and an angle arc.
- 2026-10-10 · **The chip menu offers Hide only where it does something**: `Feature.visible` changes what is drawn only for sketches, construction geometry and canvases, so a fillet's, chamfer's, shell's or pattern's menu no longer offers a Hide that drew the same thing either way (`shell/featureVisibility.ts`'s list; the marking menu's list already followed the rule).
- 2026-10-10 · **Send to Slicer on the web says what to do instead**: the tile stays disabled, but a tool can now word its own unavailable reason, and the tooltip (and the command palette) reads "Sending to a slicer needs the desktop app. In the browser, export a 3MF and open it in your slicer." instead of "Arrives with the desktop app.".
- 2026-10-10 · **Print Info's footnote stays readable in a small window**: the note ("An estimate: walls and infill as set, no supports…") sits under the scrolling content instead of inside it, so it is never scrolled out of the panel (checked at 900 × 700).
- 2026-10-10 · **The Text preview follows alignment and height**: the sketch overlay redraws the draft whenever the Text panel changes the string, font, alignment or Height, not only on OK (`e2e/text.spec.ts`).
- 2026-10-10 · **Section Analysis: Box from an empty panel (guide, test)**: the choosing state already offered Box beside the planes (a box needs no plane first); the guide now says so, and `e2e/section.spec.ts` opens the tool on a design with no section and clicks Box straight away.
- 2026-10-10 · **Look at Selection (UI spec §3.1)**: a View command (Ctrl+K, and the first entry of the right-click list while something is selected; no key) that fits the camera to the box of the selected faces, edges, vertices, bodies or sketch curves, turning to look square at one flat face (`selection/lookAt.ts`, `ViewportState.lookAtBox`).

## v0.5.0 (2026-10-10)

- 2026-10-10 · **The notification bell moves to the status bar's right edge** (ADR-0041's amendment): always shown, quiet while the history is empty ("No notifications yet."), opens the same panel upwards; the toasts stay in the view's corner.
- 2026-10-10 · **The macOS app is ad-hoc signed and has its own icon**: v0.4.1's unsigned bundle said "damaged" on Apple silicon; `mac.identity: '-'` signs it ad hoc (Open Anyway works), the `desktop` workflow verifies the signature in the zip and the dmg and launches the app, and the macOS icon sits on Apple's 824-in-1024 grid (`build/icon-mac.png`, `scripts/make-icons.mjs`; ADR-0075's amendment).
- 2026-10-09 · **Bodies get a ghost display state (ADR-0030's amendment)**: a body can now sit between shown and hidden — a **ghost** is a grey see-through shape that takes no part in picking, Fit or the print checks; it is stored in the document (`BodyMeta.ghost`, only with `visible: false`) so it undoes and survives a reload, and older readers show the body hidden. The browser row's eye cycles shown → ghost → hidden, and the body and marking menus offer the states a body is not in.
- 2026-10-09 · **Desktop polish (ADR-0075's amendment)**: Windows and Linux have no menu bar (macOS keeps its native one); Open File… (Ctrl+O), Open Recent and Clear Recent, Save As… (Ctrl+Shift+S), Check for Updates… and Quit (Ctrl+Q) are commands in the app; a check that finds no published release or no network says nothing unless asked, and never shows a response's headers; Settings › General has a "Radial right-click menu" checkbox; thumbnails leave out the origin point; the desktop docs say Arch needs `fuse2` for an AppImage.
- 2026-10-09 · **A body's opacity applies when it changes**: a body drawn opaque and then set to see-through kept drawing opaque (three.js bakes `OPAQUE` into the program and R3F never recompiles it), so only some bodies seemed to obey; the face material is now keyed on its transparency mode (ADR-0030's amendment).
- 2026-10-09 · **An STL of touching parts imports again** (ADR-0066's amendment): an STL Extrudo wrote of bodies that meet along an edge welds that edge to four triangles on import; `splitNonManifoldEdges` (in `@extrudo/io`) separates the touching surfaces before `checkManifold`, the import warns how many edges it split and gives one body per part, and open or unbalanced meshes stay refused.
- 2026-10-09 · **Design thumbnails are framed for themselves**: the home card's picture is rendered through its own square camera fitted to the bodies (12 % margin each side; sketches if there are none) instead of the canvas's centre crop, which cut off models Fit had shifted clear of the browser (ADR-0009's amendment); the template and example pictures are re-taken.
- 2026-10-09 · **The Homebrew cask job runs again**: its `setup-node` no longer looks for pnpm (which the job never installs, so v0.4.1's cask was not pushed), and a manual `desktop` run with `cask_tag` (e.g. `v0.4.1`) pushes the cask for an existing tag from its release's zip.
- 2026-10-08 · **Docs site, slice S7 (P6-06, ADR-0080)**: the concept guide's second half under `docs/guide/` (bodies and the browser, getting it printed, files and versions, the desktop app) with four pictures from `e2e/guide-shots.spec.ts`; Getting started describes the Help menu's docs links and `F1`.
- 2026-10-08 · **Tutorial 2 "A storage box" (P6-06 S8, ADR-0080 §4)**: `docs/guide/tutorials/storage-box.md` and `e2e/tutorials/storage-box.spec.ts` (12 steps, B2's flow) — sketch on the top face of a solid, Project and Offset the outline, cut the cavity, and make the walls follow `wall`.
- 2026-10-08 · **Tutorial 3, "A name tag" (P6-06 S8, ADR-0080 §4)**: `docs/guide/tutorials/name-tag.md` and `e2e/tutorials/name-tag.spec.ts` walk B8's flow as a beginner follows it — a plate, four fillets (the fourth from the back view), a keyring hole, a sketch text, an emboss and a 3MF export — 11 steps, each a picture; the name tag's body/ink/pick helpers moved into `e2e/benchmark-helpers.ts` so B8 and the tutorial share them.
- 2026-10-08 · **Tutorial 4, "A threaded bottle cap" (P6-06 S8, ADR-0080 §4)**: `docs/guide/tutorials/bottle-cap.md` and `e2e/tutorials/bottle-cap.spec.ts` walk benchmark B9's flow in twelve steps (revolved cap, Shell, an Auto internal thread, the adapter body, two external threads, the parameter change) with a picture of each; the benchmark's `bodies`, `expectBody` and `hideConstraints` helpers moved to `e2e/benchmark-helpers.ts` and B9 uses them.
- 2026-10-08 · **Docs site, slice S6 (P6-06, ADR-0080)**: the concept guide's first four pages under `docs/guide/` (the app in five minutes, sketching and constraints, features and the timeline, parameters and expressions) with four pictures recorded by `e2e/guide-shots.spec.ts` (`RECORD_ASSETS=1`, shrunk by `e2e/guide-shots-optimize.py`), and the guide index links them.
- 2026-10-08 · **The app links to the docs (P6-06 S9, ADR-0080 §5)**: Help › User Guide, Tutorials, Examples and Tool Reference, and **F1** on a hovered or focused toolbar tile (else the user guide), open the landing site's `/docs/` pages through `Platform.openDocs` (`VITE_DOCS_URL`); a tile's tooltip carries a muted "F1 for more", and on the desktop main builds its own URL from a whitelisted path over the `docs:open` channel.
- 2026-10-08 · **The examples gallery page (P6-06 S4, ADR-0080 §3)**: `docs/guide/examples.md` is generated from `fixtures/examples/examples.json` by `pnpm docs:generate` (`apps/web/src/home/examplesDoc.ts`, checked by `examplesDoc.test.ts`), each example has a 256 px picture under `docs/guide/images/examples/` recorded by `e2e/record-assets.spec.ts`, the More examples… dialog and a new example's home-screen card show it, and the pictures stay out of the precache.
- 2026-10-08 · **Examples open from a link**: `#/example/<id>` opens a copy of one of eleven example designs, listed under the home screen's More examples… (P6-06).
- 2026-10-08 · **Tutorials are tests, and tutorial 1 (P6-06 S5, ADR-0080 §4)**: `e2e/tutorials/step.ts` walks a page's steps as `step(slug, actions, check)` and, with `RECORD_ASSETS=1` (`pnpm demos -g tutorials`), saves each step's 256-colour PNG under `docs/guide/tutorials/images/`; `apps/site/src/tutorials.test.ts` fails when a page and its spec disagree; "Your first part: a plate with four holes" (12 steps, B1's flow plus an extrude and an STL export).
- 2026-10-08 · **Docs site, slice S2 (P6-06, ADR-0080)**: `pnpm docs:generate` (`scripts/generate-docs.mjs` → `apps/web/src/shell/toolDocs.ts`) writes a page for each of the 116 ready tools under `docs/guide/tools/` plus the index, from `TOOLS`/`TABS`/`keysFor`/`DEMO_TOOLS`; notes between the `<!-- notes -->` markers survive, `toolDocs.test.ts` fails when the pages are stale, and the docs sidebar groups Tools by the tab each tool first appears in.
- 2026-10-08 · **Docs site, slice S1 (P6-06, ADR-0080)**: the site's docs are collections under `/docs/` (`docs/guide`, tutorials, tools, `docs/api` at its old addresses) with one sidebar, hashed pictures and clips from relative Markdown references, only `<video>` allowed as raw HTML, a `/docs/` index and a "Docs" link in the landing nav.

## v0.4.1 (2026-10-08)

- 2026-10-08 · **The desktop app builds on macOS and Windows again**: the progress notice's rules file (`modelProgress.ts`) sat beside its component (`ModelProgress.tsx`), which case-insensitive file systems read as one module; it is `progressRules.ts` now, and `pnpm lint` refuses module paths that differ only by case.

## v0.4.0 (2026-10-08)

- 2026-10-08 · **Top bar, round 2** (the owner's second review, ADR-0079's amendment): the theme follows the system by default, the gear is a Settings menu (auto-project, Customize Marking Menu…, and the theme below), a Toolbox button sits before Search, Version history moves next to Settings, and the name with its save dot is centred between the buttons, dropping the save word and then truncating the name as the window narrows.
- 2026-10-08 · **The Bodies folder says "Computing bodies…" before the first recompute** when nothing is cached, instead of the false "No bodies yet" (ADR-0078's amendment).
- 2026-10-08 · **One top bar with the tabs, a Home tab, toolbars that fit the window** (the owner's UI review, ADR-0079): the app bar and the tab row are one 40 px row (logo, tabs, undo/redo/search, the design's name, settings/help/theme), the File menu's items and the Insert tab's tools are the Home tab, Solid splits into Solid, Modify, Construct and Inspect, and a narrow window moves the fullest group's last tiles into its ▾ menu (`fitToolbar`); 147 → 111 px of chrome above the view.
- 2026-10-08 · **Icons that say what they do**: Fillet (a big round, the sharp corner dashed, a radius line) and Chamfer (a straight 45° cut, emphasised) no longer read alike, Parameters is a name = value pair (Customizer keeps its sliders), and Chamfer's tooltip has a demo clip (thirteen tools now).
- 2026-10-08 · **The timeline is always shown**: the bottom row's Hide timeline button and its command are gone (the owner's UI review).
- 2026-10-08 · **Opening a design says it is being prepared** (ADR-0078): a notice with an animated cube at the view's top left until the first recompute has finished (and after 800 ms of a later one), and the browser lists the bodies the last session made as pending rows from a per-project model cache (`model-cache.json`, derived, not in the file).
- 2026-10-07 · **P4-12 Construction: a cone's nearest tangency point and an edge meeting a curved face** (ADR-0040's addendum): `tangentPlane` with a `point` on a cone touches the foot of the point on the nearest generatrix (the apex past it; a point on the axis warns and follows the angle), and `pointAtIntersection` takes an edge and a curved face.
- 2026-10-07 · **Tapered threads** (P4-12, ADR-0056's third amendment): a thread on a conical face follows the cone (the facade's `threadFace` reads cones, `threadSweep` sweeps along a conical helix), an NPT group (1/8 to 1, ASME B1.20.1) in Size fits a 1:16 cone without a size, and the Thread dialog's Thread line names it ("NPT 1/2"); no new input, no file-format change.
- 2026-10-07 · **P6-03 plugin API, slice 4: the review's fixes** (ADR-0077): a plugin zip is inflated as a stream and refused past 4 MB of real output (a lying header costs ~20 ms), a foreign `in:` input fails its feature and not the document, install's bytes are capped in desktop main, manifest strings refuse control and bidi characters, README/LICENSE capped at 256 kB, a cancelled plugin dialog forgets its pending file, generated IDs may not collide with the design's, a plugin can't replace `Date`/`Math.random`; docs and tests; P6-03 ticked.
- 2026-10-07 · **P6-03 plugin API, slice 3** (ADR-0077): an enabled plugin's custom features get
  a dialog generated from the manifest (Ctrl+K, a "Plugins" section in the Create menu), OK
  adds the feature and the plugin file to the design as one undo step, a stored feature opens
  from the design's own copy, and the Plugins dialog offers "Update to <version>";
  `docs/plugins.md` and `docs/api/plugins.md`.
- 2026-10-07 · **Sketch palette Slice** (P4-12, ADR-0031 §5): while a sketch is open and the palette's Slice is on, the bodies are cut away on the camera's side of the sketch plane (view state; the removed side is decided once per sketch and kept while the camera orbits), with a cap and picking like a section plane's.
- 2026-10-07 · **Multi-start threads** (P4-12, ADR-0056's second amendment): a `starts` input (2–8) cuts that many helices with a lead of starts × pitch, one tooth per start in one boolean, faces `s<j>.`; the Thread dialog has a Starts field; file format §6.33.
- 2026-10-07 · **P4-12 Sweep placement line** (ADR-0055's amendment): the sweep
  evaluator reports where the profile sits against the path's start
  (`SweepReport`: offset, limit, path length, through `Preview.sweep` as the
  emboss report travels), and the Sweep dialog's read-only Placement line shows
  "Profile on the path's start." or "Profile 6.2 mm from the path's start: the
  sweep carries it where it is drawn." before OK; the warning is unchanged. No
  facade, schema or file-format change.
- 2026-10-07 · **P6-03 plugin API, slice 2** (ADR-0077): installed plugins in a
  `PluginStore` (`plugins/<id>/plugin.extrudo-plugin` + `plugins/index.json`; OPFS
  on the web, `userData/plugins` through the desktop's `plugin:call` channel), the
  Plugins dialog (File › Plugins…, Ctrl+K: Install…, Enabled, Remove, the README as
  plain text, "In this design, not installed" with Install), and plugin commands in
  Ctrl+K ("Plugins › <name>") that run in the kernel worker
  (`KernelApi.runPluginCommand`) and land at the marker as one undo step, re-minted
  (`remintFeatures`).
- 2026-10-07 · **P6-03 plugin API, slice 1** (ADR-0077): core's `PluginManifest`
  (strict, refused with its place: "plugin.json › features[0] › inputs[2] › kind:
  expected one of expr, bool, enum, ref") and the `plugin` feature (`plugin`,
  `handler`, `in:<name>` inputs; file format §6.32), `.extrudo-plugin` files
  through `@extrudo/storage`'s `readPluginFile` (1 MB, no path outside the root) as
  attachments of type `application/x-extrudo-plugin`, `d.plugin({ plugin, handler,
  inputs })` in the API, `ScriptRunner.runPlugin` (the module's exports through
  sucrase's `imports` transform, the restricted design, frozen inputs and ctx, "A
  plugin can only add features"), the kernel's `expand` for it (manifest-checked
  inputs, resolved references, Fix References for a lost one), the `Recomputer`'s
  and the CLI's resource sending, and the example plugin
  `examples/plugins/name-plate/` run headless in `packages/cli`.
- 2026-10-07 · **P4-12 Chamfer Angle handle** (ADR-0043's third amendment): a
  distance-and-angle set's Angle gets an in-view arc beside its Distance
  arrow, starting along the reference face's direction and turning towards the
  other face's about the edge, so the head sits on the chamfer face and a drag
  writes the angle; none where the two face directions can't be read (the set
  keeps its single bisector arrow). No kernel, facade or schema change.
- 2026-10-07 · **WebGL fallback** (ADR-0076): the 3D view draws in the browser's software
  WebGL where there is no hardware (dpr 1, no antialiasing, a status bar "Software rendering"
  and a one-time toast), shows "Extrudo can't draw the 3D view in this browser" where there is
  no WebGL 2 (the rest of the app keeps working), recovers from a lost context, and error
  boundaries around the view and the root replace the blank page; the desktop app allows
  SwiftShader and has `--software-rendering`.
- 2026-10-07 · **P4-12 Exact conics in the kernel** (ADR-0063's amendment): a sketch
  conic reaches OCCT as its rational quadratic through the facade's new `sketchConic`,
  so extruded conics measure exactly (the cubic route was 4e-7 to 7.5e-6 out) and STEP
  export carries the true curve; volumes, areas and lengths with a rational edge are
  integrated exactly. The app still draws the cubic; no file change.
- 2026-10-07 · **P6-01 Homebrew cask** (ADR-0075's amendment): the `desktop`
  workflow's `homebrew` job renders the macOS cask from the arm64 zip it built
  and pushes it to the `zoltanf/homebrew-extrudo` tap on a tag (`HOMEBREW_TAP_TOKEN`,
  skipped cleanly without it); `brew install --cask zoltanf/extrudo/extrudo`
  and `brew upgrade` are macOS's install and update path.
- 2026-10-07 · **P6-02 Slicer launch** (ADR-0062's amendment): the desktop app finds
  installed PrusaSlicer, OrcaSlicer, Bambu Studio and Cura (PATH, flatpak, Program Files,
  /Applications, or `slicers.paths`), writes the export to a private temp file and starts
  the slicer on it; the Export dialog disables missing slicers and the Send to Slicer tile
  works.
- 2026-10-07 · **P6-01 Electron app, slice 4: auto-update** (ADR-0075's
  amendment): `electron-updater` against the published GitHub releases; an
  AppImage and the Windows installer update themselves ("Extrudo 0.5.0 is
  ready." with Restart, which saves first), a deb and macOS only point at the
  release page; `Platform.updates` makes the web's update toast a platform seam;
  Help › Check for Updates…; `EXTRUDO_DISABLE_UPDATES` for the smoke test.
- 2026-10-07 · **P4-12 Taper review fixes** (ADR-0028's amendment, "Review
  (2026-10-07)"): `taperLoft` lofts each profile wire to its own offset
  (`MakeOffset::Generated`, not a bounding-box sort that a negative taper
  swaps and two equal holes tie, which slanted hole tunnels silently),
  refuses an outline the offset pinches in two ("The taper pinches the
  outline in two…"), catches OCCT's exceptions from the offset and the loft
  with the "too steep" wording, checks the end cap's fallback face and runs
  `crossesItself` on the solid (it rejected two junk solids the old code
  returned). Kernel tests for two equal holes, a slot and a hole at −5°, the
  dumbbell, spline and mixed outlines against Steiner; e2e narrows the
  ellipse 5°. Golden table unchanged. WASM 20.50 MB raw (−19 kB), OCCT input
  hash `7d9f1e802bdc`.
- 2026-10-07 · **P6-01 Electron app, slice 3: packaging, unsigned** (ADR-0075's
  amendment): `electron-builder` builds AppImage/deb, NSIS and dmg/zip installers
  in the new `desktop` workflow (a `v*` tag attaches them to a draft release;
  the Linux AppImage is smoke-tested headless in CI). Fixes found on the way:
  `electron` was inlined into the main bundle, and two file pairs differing only
  by case (`Grid`, `ViewCube`) broke macOS and Windows builds.
- 2026-10-07 · **P6-01 Electron app, slice 2 review fixes** (ADR-0075's
  amendment): closed the review's high, medium and low findings. Open Recent is
  built from main's own list (the renderer can no longer send a path);
  `menu:set` passes the model through `shift/menuModel.ts`'s `isMenuModel` in
  main, only the Window roles `minimize`/`zoom`/`front` are accepted (anything
  else becomes a disabled label) and every model item sets
  `registerAccelerator: false`; a project opened from a path (Open…, the
  association, Open Recent) or Save-As'd is linked as an **external file**
  (`LinkedFile.external`, the index only) and written back through paths main
  issued this session (`file:write-path`/`file:stat-path`/`file:read-path`,
  refused otherwise), with a second open of the same path reusing the linked
  project. Quit quits directly on the home screen (main tracks a live
  `menu:listening`), the macOS app menu is built item by item so its Quit saves
  first, `desktopMenus.reset` cancels its debounce and drops the model, the
  menu effect resets only on unmount, `second-instance` pushes its path before
  the window check, `open-file`/argv accept `.extrudo` only and a read is
  capped at 100 MB, Clear Recent clears the OS list, a failed import removes
  the path (`recent:remove`), `file:save-as` is guarded, and `recent.ts`'s
  writer `fsync`s and cleans up. No kernel or schema change; no web *behaviour*
  change (`apps/web` gained the `ExternalFiles`/`MenuModel` seams and the
  external-link branch only).
- 2026-10-07 · **P6-01 Electron app, slice 2 — native menus, the `.extrudo`
  association and recent files** (ADR-0075's amendment): the application menu is
  a projection of the command registry (`apps/web/src/shell/menuModel.ts`'s
  pure `menuModel`/`toAccelerator`, sent over `menu:set`; main builds
  `Menu.buildFromTemplate` with `registerAccelerator: false` so the web keys
  still run, and a clicked id returns over `menu:run`), with desktop-only File
  entries (Open…, Open Recent, Save As…, Quit with `saveEverything()` first);
  main handles the OS association and argv, queuing a path until the renderer
  says `app:ready`, and hands the bytes over `file:open-path`, which the
  renderer imports and links to its file as a linked-folder file is; a
  `userData/recent.json` list (`main/recent.ts`) fills the Open Recent submenu
  (`recent:list`/`recent:clear`/`recent:changed`). `electron-builder.yml`
  carries the `.extrudo` association as data for the packaging slice. No
  kernel or schema change; no web *behaviour* change.
- 2026-10-07 · **P6-07 Auto-project review fixes** (ADR-0074's 2026-10-07
  amendment): a pending constraint joins the step that added its projection by
  step id (`UndoHistory.stepId`/`amendInto`/`hasStep`, `DocumentState.amendInto`/
  `lastStepId`), so undoing a later action no longer takes an earlier line's
  constraint with it; a picking tool refuses a curved body edge ("Pick a
  straight edge, or project the edge first (P).", `ModelSnap.straight`) and
  `resolvePending*` catch any throw as a refusal; one ref gets one projection
  per commit, a fresh snap revives a deleted curve (`reviveProjectionCurve`),
  and a pending whose projection is missing/lost or whose feature or step is
  gone is dropped on every `syncProjections` (`dispose` clears them). The
  picker costs 0.120 ms per move on B5, so no rAF coalescing. No facade, kernel
  or schema change.
- 2026-10-07 · **P4-12 Taper cap match fix** (ADR-0028's amendment): a
  tapered loft's caps are found by the point-to-plane distance of the face's
  plane, not by comparing the planes' origin points — a plane's `Location()`
  is wherever its surface was built, so the origin-to-origin rule was a
  coincidence of `BRepLib_FindSurface` reusing the profile's own plane. No
  schema or file-format change; WASM size unchanged (20.52 MB raw), OCCT
  input hash `e6811f0e5181`.
- 2026-10-07 · **P6-01 Electron app, slice 1 review fixes** (ADR-0075): closed
  the review's two high findings — every id that becomes a path is validated
  (`StorageError`/`assertId`, the Node `full()` refuses `..`/absolute/NUL and
  escapes, `purge` of an unknown id touches nothing) and the window cannot
  navigate off `app://` (or the dev origin) or open a window/webview, and every
  permission is denied — plus the lower ones: the CSP/COOP/COEP/`nosniff` set
  rides on every `app://` Response (`headers.ts`, checked against `_headers`),
  store/folder errors cross `invoke` as data and are rebuilt, the index queue
  holds its read-modify-write, the atomic writers `fsync`, preferences are read
  through `invoke`, `folder:read`/`write` take `.extrudo` names only, a failed
  download toasts, `RescueFile.flush` is gone, the smoke script is real, and
  the phantom-test comments have their tests. No facade, kernel or schema
  change.
- 2026-10-07 · **P6-01 Electron app, slice 1** (ADR-0075): the desktop shell on
  electron-vite, whose renderer is the web app's own source with a different
  entry (`apps/web/src/entry/desktop.tsx`'s `bootDesktop`) and the web app's
  CSP/COOP/COEP over a custom `app://` protocol; every privileged call goes
  through one typed preload bridge (`apps/desktop/src/shared/ipc.ts`). The
  Node-fs `ProjectStore` is `@extrudo/storage/node`'s `createNodeProjectStore`
  (atomic `index.json`, `FileStore` over `<dir>/projects/<id>/…`), driven from
  the main process and reached through an IPC proxy. `desktopPlatform()` adds
  preferences, storage, native file dialogs, a synchronous rescue file and
  linked folders over the real file system; no slicer launch yet (P6-02).
  Native menus, file association, recent files, auto-update and packaging are
  later slices. No facade, kernel or schema change.
- 2026-10-07 · **P4-12 Taper on ellipse and spline sides** (ADR-0028's
  amendment, FR-FT-01): a profile with an ellipse or B-spline edge is tapered
  by a **ruled loft** between the profile and its 2D offset (`taperLoft` in
  the facade: `BRepOffsetAPI_MakeOffset` with `GeomAbs_Arc`, `ThruSections`
  ruled per wire pair, caps sewn in) instead of `DraftAngle`, which can't tilt
  such a side. Faces keep a prism's names (`cap:start`, `cap:end`,
  `side:<sketch curve>`); an offset that crosses itself and one that closes a
  hole are refused in the user's words. Lines and arcs still take
  `DraftAngle`, byte-identical. Native harness `spikes/p4-12-taper-curves`
  (0 failures, heap flat over 300 rounds). No `@extrudo/core` or file-format
  change.
- 2026-10-06 · **P6-07 Auto-project slice 2** (ADR-0074's amendment): the
  constraint and dimension tools pick a body edge or vertex directly
  (`ToolContext.pickModel`), behind the sketch's own geometry: the host
  projects the ref in the same undo step and writes the constraint or
  dimension against the projected entity once the kernel reports it (the
  pending machinery generalised from the two fixed coincident shapes to any
  constraint or dimension whose side is a projected entity). No
  file-format, schema or kernel change.
- 2026-10-06 · **P6-07 Auto-project** (ADR-0074, FR-SK-17): while a drawing,
  constraint or dimension tool runs, the view offers the shown bodies' edges
  and vertices under the pointer (behind the sketch's own geometry, vertices
  before edges, hidden ones last) as a `ModelSnap`; `infer` treats a vertex as
  a point target and an edge as an on-curve one, so a point that snaps to a
  body edge or vertex is projected into the sketch in the same undo step
  (`addProjection`) and held on it (`coincident`/`pointOnCurve`) once the
  kernel reports the projected curve. The preference `viewport.autoProject`
  (on) and its palette checkbox and `toggleAutoProject` command turn it off;
  `viewport.autoProjectFace` (off) also projects a flat face's outline when a
  sketch starts on it. No file-format or kernel change.
- 2026-10-06 · **P4-12 warm-cache heap growth closed (ADR-0050 §6)**: the
  growth (10.7 MB per 100 recomputes of the revolve document) is `mesh` alone
  and is mimalloc fragmentation of the mesher's transient
  `NCollection_IncAllocator` blocks on **fresh** shapes, not a leak. The native
  harness `spikes/p4-12-heap-growth` and the app's WASM rule out
  `BRepTools::Clean`, meshing a copy, dlmalloc, the mimalloc options and a
  block-size patch; it stays bounded by the worker recycle (ADR-0067 §H4, 1 GiB,
  kept after measuring a 8 s cold recompute for B9). `HEAP_ATTRIBUTE=1` works
  again, the warm-cache probe checks 20 MB per 100 recomputes, and
  `mesh-golden.test.ts` fingerprints every fixture body's display mesh.
- 2026-10-06 · **P4-12 Emboss on cones, spheres and free-form faces**
  (ADR-0060's amendment): a cone takes letters wrapped round it like a
  cylinder (the facade's new `wrapOnCone`, the cylinder's exact map with the
  frame at the profiles' centroid's height, `coneFace` for which way round the
  wall is), a sphere, a torus or a free-form face takes them projected along
  the sketch's normal and cut back to the depth along the face's normal (the
  new `projectOnFace`; a sphere's and a torus's offsets are concentric
  surfaces, exactly), refused past the face's edge or outline; a wrap may now
  run up to a whole turn instead of half way round each side; the Emboss
  dialog's Method line says whether the profiles were moved, wrapped or
  projected (`EmbossReport` through `Preview.emboss`). "Tangent to the face"
  and several faces at once stay deferred.
- 2026-10-06 · **P4-12 torus placement and symmetric half-length**
  (ADR-0032's and ADR-0028's amendments): the torus takes an `axis`
  (Normal — the default — or X / Y, the ring on edge) and a `seat`
  (Centre — the default — or On the plane, resting on the plane with
  Offset still adding), both optional enums stored only when not the
  default; and a symmetric extrude or revolve takes `symmetricMeasure`
  (`whole` — the default — or `half`, the distance or angle of each side),
  read only while symmetric and stored only when `half`. The dialogs'
  Axis/Seat selects and Measure select drive them; the arrows reach the
  per-side value with `half`. No facade change.
- 2026-10-06 · **P4-12 STEP colours (XDE)** (ADR-0034's amendment): a STEP
  file's solid colours (their own, their part's or their assembly instance's)
  colour the imported bodies when they are first named, and never again, so a
  colour the user picks stays; a body's colour is written to its STEP export as
  the solid's styled item (`COLOUR_RGB`), and uncoloured exports are byte for
  byte what they were. The facade's new `readStepColors` and the coloured
  `writeStep` path go through OCCT's XDE with a document per call (no heap
  growth over 2,520 rounds); the WASM grew 0.83 MB raw, 0.16 MB brotli. The
  headless CLI's exports carry body colours too (STEP and 3MF).

- 2026-10-06 · **P4-12 thread profiles** (ADR-0056's amendment): a thread's
  tooth is no longer only ISO 60°. A `profile` input picks `iso` (the default,
  bit-for-bit what it was), `trapezoidal` (ISO 2901 / DIN 103 Tr: 30°, 0.5 P
  deep, equal 0.366 P flats), `buttress` (DIN 513 S: a 3° load flank and a 30°
  trailing flank, with a `loadFlank` select) or `bottle` (the PCO-1881
  soft-drink finish: a rounded 20° trapezoid, crest and root rounded by arcs).
  The profiles are one pure table in core (`threadProfile`), staged by the
  kernel as lines and arcs, so it knows no angles; `THREAD_PRESETS` gains a
  Trapezoidal group and PCO-1881. `autoThread` stays ISO coarse; another
  profile without a size is refused.
- 2026-10-06 · **Deterministic archive bytes**: `.extrudo` files stamp every
  zip entry with a fixed mtime (2024-01-01) instead of the save time, so the
  same design always writes the same file — the linked folder's conflict check
  (ADR-0065 §3) can no longer see a spurious change, and the download and
  linked-file bytes are byte-identical (the flaky test is fixed).
- 2026-10-06 · **P4-12 Project: silhouettes of every surface, vertices and
  bodies, Intersect and Include** (ADR-0031's amendment): a projected sphere is
  its exact outline circle, a torus or a free-form face its outline through
  OCCT's contour finder (TKHLR's `Contap_Contour`; walked outlines come in as
  control-point splines fitted within 1 µm, or as the circle or line they lie
  on); Project also takes a vertex (a fixed point) and a whole body (picked in
  the browser: its outline edges, silhouettes and the sharp edges seen from the
  sketch's side, through `HLRBRep_Algo`); **Intersect** (Shift+P in a sketch)
  brings in the curves where a face or body meets the sketch plane, following
  the model; and the tools' "Keep linked" checkbox off makes an include — plain,
  editable curves in one undo step, "Include 4 curves". New facade methods
  `sectionWithPlane` and `edgeVisibility`, `faceSilhouettes` in a new encoding;
  a sketch's projection gets `mode` and `linked` (file format §7.4). Slice
  stays open.
- 2026-10-06 · **P4-12 splines: closed, stored knots, trim, break and offset**
  (ADR-0063's amendment): fit and control splines can be closed (a click back
  on the first point, or the panel's Closed checkbox) into periodic C2 loops,
  emitted as the clamped B-spline that is exactly the loop, so the kernel,
  profiles and export need no new curve kind; a control spline may carry its
  own knot vector (`knots`); Trim and Break cut fit, control and closed splines
  by knot insertion into control splines that are exactly their part of the
  curve; Offset takes splines alone, closed or in a chain as a fit spline within
  1e-3 mm of the true offset (refused past the tightest bend). Extend and cutting
  a conic stay refused; exact rational conics stay deferred. No facade change.
- 2026-10-06 · **P4-12 Patterns: a cheaper join of many interfering copies**
  (ADR-0047's amendment): a pattern's copies (and a mirror's) are grouped by
  their boxes alone instead of asking OCCT's exact distance (6-8 ms a call,
  about 100 calls in a 10 × 10 grid), and `toolSet` colours its cut graph the
  same way; a feature's own tool parts (thread, hole, emboss) keep the exact
  test. All four measured joins are faster — overlapping 10 × 10 bosses
  2.5 s → 1.7 s, touching 10 × 10 bosses 1.5 s → 0.9 s, 2 × 20 touching body
  copies 0.6 s → 0.35 s, 36 overlapping circular bosses 1.0 s → 0.8 s — with
  the same results and no golden-table change. No facade or schema change.
- 2026-10-06 · **P4-12 Shell: a thickness per face, and openings next to a
  fillet** (ADR-0046's amendment): up to eight wall sets ("Wall faces" and
  "Wall thickness" in the dialog) give faces their own thickness — a thicker
  floor, a thinner lid — through the facade's new `shellFaces` (per-face
  offsets, sharp joins; the faces that run smoothly into a picked one come
  with it), with every thickness scaled together in the "too thick"
  diagnosis. A flat face next to a fillet can now be removed: the body is
  hollowed closed and the opening cut out as a plug kept to the cavity's
  outline (exact volumes on rounded boxes and rimmed cylinders). The trap the
  old refusal guarded against didn't reproduce in about 3,000 unguarded builds
  (also with mimalloc and a heap validator); curved faces, slanted neighbours
  and touching removed faces next to a fillet stay refused.
- 2026-10-06 · **P4-12 ghost of lost geometry and remappable marking-menu
  wedges** (ADR-0005, -0033 and -0042's amendments): a lost or guessed reference
  is drawn dashed in the error colour where its fingerprint says the geometry
  was (square, circle, segment or cross by type), for the hovered chip or row,
  the feature being fixed and the picked chips (`data-ghosts`); the
  `marking.slots` preference and "Customize Marking Menu…" (Ctrl+K) assign any
  command the mode offers to each of the eight wedges of the model and sketch
  rings, with Reset wedge and Reset all.
- 2026-10-06 · **P4-12 construction geometry** (ADR-0040's amendment): four
  new construction types — Point on Path and Plane Along Path (a fraction or a
  length along a path of sketch curves and edges, with a distance handle along a
  straight path), Point at Intersection (two edges, an edge and a plane, or
  three planes) and Angled Midplane (the bisector of two non-parallel planes) —
  plus a `point` on Tangent Plane that reaches tori and free-form faces (the
  latter from a fine mesh of the face, `basis: 'mesh'`) and box selection that
  takes construction planes, axes and points (origin axes excepted). Everything
  is computed in TypeScript from the existing kernel reports; no facade change.
- 2026-10-06 · **P4-12 Section analysis: several planes and a section box**
  (ADR-0045's amendment): the Section Analysis panel lists up to three planes
  as rows (offset, Flip, Show, Change, Remove, "Add plane"), each with its own
  arrow, and cuts the view by all of them with a cap per plane drawn only where
  the others keep the cut; "Box" cuts at six planes from a centre and
  half-sizes (default the shown bodies' box grown 5 %), with a handle on every
  face and the box's edges drawn as a wire. View state only; named views and
  the hatch per material stay open.
- 2026-10-06 · **Landing page: dark only, a parametric toy in the hero, and a pinned
  scroll stage that deals the nine pictures over each other with the app's timeline
  under it; a Changelog link in the nav** (ADR-0057 amendment).
- 2026-10-06 · **P4-12 Extrude and revolve to an object** (ADR-0028 and
  ADR-0029 amendments): Extrude's To object takes a curved face (a cylinder, a
  sphere, a fillet's round, a free-form face) or a whole body as well as a flat
  face, a vertex or a plane, and stops where the sweep first meets it (the
  face's surface extended past the face, or the body), with an Offset that
  moves the end along the sweep (positive past the object, negative short of
  it). Revolve gets an Extent, Angle or To object: one side turns until it
  first meets a face, a body or a plane. The new ends are `cap:end`; mesh
  bodies are refused as targets. Two new facade calls (a split boolean and
  `extendFace`).
- 2026-10-06 · **P5-05 (2 of 2) Macro recording in the app** (ADR-0073 §4):
  Solid › Create › Record Macro and Stop Macro (and Ctrl+K) — the status bar shows
  a red dot and the count while recording; Stop opens the Macro dialog with the
  code read only, Copy, "Replace with a Script" (one undo step; refused with the
  reason when something outside the run uses it) and "Keep both" (the Script
  suppressed). File › Export design as script… downloads the whole design as
  `<name>.ts`. P5-05 is complete.
- 2026-10-06 · **P5-05 (1 of 2) Macro recording: the emitter** (ADR-0073):
  `emitScript(doc, options?)` in `@extrudo/api` writes a design back as the
  TypeScript that makes it — one call per feature, inputs as their plain values,
  references as handle expressions (or `design.ref`), sketches as
  `design.sketch(plane, (k) => { … })` with solved coordinates, parameters in
  dependency order, suppression and groups; a name that embeds a recorded
  feature's ID (a Script's generated `<script>.f1`, a face's source) becomes a
  template literal through the handle's own `.id`. It is formatted the way
  Biome formats TypeScript, and every benchmark and script fixture is
  round-tripped in tests (document equality in `packages/api`, the recomputed
  bodies in `packages/cli`). `extrudo script <file> [--features a..b]` prints
  the same code, and `docs/api/emit.md` documents it.
- 2026-10-06 · **P4-12 Primitives: placement** (ADR-0032 amendment): every
  primitive dialog has X, Y and Offset handles beside the size handles, a click
  on the picked plane or face puts the primitive there, and the Box has a "Two
  corners" button (two clicks on its plane set centre, length and width). Torus
  placement options stay open.
- 2026-10-05 · **P5-06 Wall-thickness check** (ADR-0072, FR-3DP-07): walls
  thinner than a minimum are found before exporting. Thickness is measured on
  the display mesh, per triangle, by a ray from its centroid along the inward
  normal to the far side of the same body (the picking BVH, one per mesh, and
  cached, so changing the minimum only re-classifies); it is view state like
  the overhang analysis — 3D Print › Prepare › Wall Thickness, a Minimum
  expression (two line widths of the print material by default) with "Show
  thin walls", the thinnest wall and the thin area in the panel, thin
  triangles shaded red (they win over an overhang on the same triangle) and
  the thinnest spot marked with a label in the view. `data-thickness` on the
  Viewport region and a row in the browser's Analysis folder read and toggle
  it; hidden bodies are not measured, and the numbers are estimates on the
  display tessellation (no kernel or file-format change).
- 2026-10-05 · **P5-02/P5-04 integration:** script-generated OpenSCAD imports
  use the async preparation hook and the design's model attachments; project
  workers retain both lazy loaders. Preview timing is generic to all features.
- 2026-10-05 · **P5-02 (3 of 3) The Script editor in the app** (ADR-0070):
  Solid › Create › Script opens a wide, lazy CodeMirror dialog with TypeScript
  or JavaScript, API/parameter completion, inline errors and console output.
  Preview waits 500 ms after typing; OK waits for it and commits one undo step.
  Editor undo and keys stay local, Esc then Tab leaves the editor, and both
  themes meet the axe audit. The timeline chip reports the generated count;
  ordinary bodies support later fillets and Delete refuses a used script.
  The script guide and its checked examples are published under `/docs/api/`.
  P5-02 is complete.
- 2026-10-05 · **P5-02 (2 of 3) The Script feature in the kernel and the CLI**
  (ADR-0070 §1-§2): a `script` feature (core: inputs `code`, a new `code` input
  kind, and `language`) whose program runs on every recompute and whose features
  the engine evaluates right after it, each under its own cache key, as if they
  stood in the timeline there — so a parameter that only moves the last one
  rebuilds only that, and a run whose code, document-before and parameters are
  the same is taken from a small cache. Generated features are `<script>.f1`,
  `<script>.f2`… ("Script1 › Hole2"), their faces named by their own evaluators
  (`hole:<script>.f2:side:wall`), so a fillet after the script refers to an edge
  of its body like any other, and a reference into a script's geometry is a
  dependency on the script (the timeline refuses the move, Delete refuses the
  script). The script's status carries its features' errors and warnings, each
  naming the feature ("Script1 › Fillet1: Radius 50 mm is too large…"), a failed
  run's "Line 12: …" with the line kept apart for the editor, what it printed and
  the list of what it made. The kernel never imports the runner: whoever starts
  it injects one — the app's own kernel worker entry (`apps/web/src/project/
  kernelWorker.ts`, QuickJS's WASM a lazy asset, and the worker now a module
  bundle so the runner's JavaScript is a lazy chunk too) and the CLI in Node —
  through `KernelApi.enableScripts()`, which the `Recomputer` calls for a design
  with a script, again after a restart or a heap recycle. `extrudo info`,
  `export` and `check` compute scripts; `docs/api/examples/script-hole-ring.ts`
  and `script-shelf.ts` are tests. The runner now depends on
  `quickjs-emscripten-core` and the release-sync variant only.
- 2026-10-05 · **P4-12 fillet and chamfer handles for every set** (ADR-0038
  and ADR-0043 amendments): each fillet or chamfer edge set that has edges has
  its own in-view arrow (`radius2`, `distance3` …); the one whose field or pick
  field was touched last is drawn as before and the rest small and faint
  (`data-manipulator-state="active|quiet"`), and grabbing one makes it the
  active one. A variable fillet set has two arrows, Radius where the round
  starts and End radius where it ends on the tangent chain (Swap ends changes
  their places; none for a closed chain). A chamfer of the two unequal types
  runs Distance along the reference face and Second distance along the other
  face, on flat faces and a straight edge. Arrows within 12 px of each other lift
  apart. No kernel, facade or schema change.
- 2026-10-05 · **P5-04 OpenSCAD import (2 of 2): the app** (ADR-0071): Insert ›
  Import (and the File menu's "Import STEP, mesh or OpenSCAD…") takes `.scad`
  files. The Import dialog lists the file's customizer variables under its
  groups, each a row whose empty state is the file's own value (the
  placeholder) and whose expression — a number, or a parameter like `width` —
  overrides it; a string, boolean or vector variable is shown read only. The
  rows are packed into the numbered `scadName`/`scadValue` pairs, each value
  stored with the unit its expression has (`scadValue`'s `unit` is now
  required: file format §6.28), and the API gives a parameter handle its own
  unit. A design parameter bound to a variable works in the Customizer: each
  slider step recompiles. The `Recomputer` loads OpenSCAD once per kernel (again
  after a crash or a heap recycle), the service worker caches the 11 MB WASM in
  `extrudo-openscad` on first use instead of precaching it, and offline before
  that the import says "OpenSCAD isn't downloaded yet: connect to the internet
  once to compile gear.scad." New e2e: `import-scad.spec.ts`, plus `.scad`
  cases in `hosting.spec.ts` and `pwa.spec.ts`.
- 2026-10-05 · **P5-04 OpenSCAD import (1 of 2): kernel, Node and the CLI**
  (ADR-0071): a `.scad` file is an attachment (`application/x-openscad`) the
  `import` feature reads; OpenSCAD's own WebAssembly snapshot (Manifold backend,
  GPL-2.0-or-later, mirrored as the release `openscad-<hash>`) compiles it to a
  3MF in a worker of its own — one fresh instance per compile, a 60 s limit
  and a 1 GiB heap ceiling — and the mesh goes on through ADR-0066's mesh path.
  Up to 32 overrides (`scadName`/`scadValue` …) set the file's top-level
  variables from expressions, so a `.scad` part follows the document's
  parameters, compiled again only when a value changes. OpenSCAD's errors are
  the feature's in the app's words ("gear.scad, line 4: syntax error.", a
  missing `include` named, a 2D or empty result explained) and its echoes and
  warnings the feature's warnings. New: `packages/openscad`, the engine's async
  `prepare` hook, `KernelApi.enableOpenscad()`; the CLI compiles `.scad`
  imports. The app's side (dialog, `Recomputer`, service worker) is slice 2.
- 2026-10-05 · **Landing page: a scroll walkthrough (nine pictures of a PCB
  enclosure built from sketches, recorded from the app) replaces the intro video**
  (ADR-0057 amendment).
- 2026-10-05 · **P5-03 The headless CLI, `extrudo`** (ADR-0069): a design is
  recomputed and exported in Node, with no browser — `info`, `export` (STL, 3MF
  or STEP, `--param`, `--config`, `--bodies`, `--resolution`), `set` (a new
  `.extrudo` file with the changes) and `check` (exit 2 when a feature has an
  error, for CI), each with `--json` and the exit codes 0/1/2/3. A parameter
  change re-solves the sketches it moves, the app's rule moved to one shared
  function (`@extrudo/sketch`'s `settleSketches`, whose `scope` is `'changed'`
  in the app and `'all'` in the CLI, which also repairs a sketch something else
  moved, so no export holds a stale shape), and the export's presets, names,
  colours and metadata are the app's own (`@extrudo/kernel`'s `model-export`),
  so a file written by a script holds what the Export dialog holds. The design's
  fonts and its imported files reach the kernel as the `Recomputer` sends them.
  `packages/cli` is the library (`openDesign`, `setParameters`,
  `applyConfiguration`, `compute`, `export`, `save`, `dispose`); `docs/cli.md`
  has the details.
- 2026-10-05 · **Landing page: text contrast on the hero's glow.** In the dark
  theme the nav links, the intro paragraph and the "latest build" line sat at
  3.0-4.0:1 on the glow (WCAG AA asks 4.5:1); two site tokens,
  `--x-glow-muted` (#c8cfdb) and `--x-glow-link` (#a4cfff), make them 4.5:1 or
  more even at its brightest point, and the light theme is unchanged.
  `e2e/site.spec.ts` now measures every text on the page against the pixels
  painted behind it (glyphs made transparent, a screenshot, both themes, desktop
  and phone widths), where axe reports text over a gradient as incomplete; it
  replaces the footer-only check.
- 2026-10-05 · **P4-12 Patterns: a skip list, count handles and a path handle**
  (ADR-0047's amendment): any of the three pattern types can leave single
  instances out. `skip` is the list of their position labels (`2`, `m1`,
  `1x3`), a new `labels` input kind, so nothing in it can go stale: the kernel
  drops those placements before the boolean (the rest is exactly what the
  pattern would have made), the original can't be skipped, a label past the
  count is ignored and kept for when the count grows, and a skipped instance is
  previewed as a faint ghost of what it would have been. In the view, a **dot
  on every instance** skips or keeps it with a click (the read-only "Skipped"
  line lists them and clears them), a **count handle** on the last instance of
  each direction — dragged along the row or round the arc, the count becomes
  the nearest whole number of steps it reaches — and a path pattern's
  **distance handle** at its last instance stretches or closes the run. The
  handles read a new layout report from the kernel (every instance's centre and
  each series' first and last) rather than repeating the layout maths, and they
  float clear of the instances so the dots stay clickable.
- 2026-10-05 · **P5-02 (1 of 3) The script runner, `@extrudo/script`** (ADR-0070
  §1-§2): user code runs in QuickJS compiled to WebAssembly (the release-sync
  build, loaded lazily and only for a design that has a script), with TypeScript
  stripped by sucrase — types only, and lines kept, so a runtime error's line is
  the line in the editor. The sandbox has what ADR-0070 §2 lists and nothing
  else: `design` (the API's methods over a design it may only add to: every
  remove, move, rename, suppress, group or parameter call is refused by name with
  the rule in its message), `params` frozen, `console.log` (200 lines, 100,000
  characters), a `Math.random` seeded from the script's own feature ID and a
  `Date` frozen at 0. Limits: 2 s, 64 MB, 1,000 features, 100,000 characters of
  source — each with its own message. Errors carry a position: sucrase's for a
  syntax error, QuickJS's stack line for a runtime one, the call's line for an
  `ApiError`. A handle (`d.box(…)`'s, a sketch's, a rectangle's) comes back as a
  proxy over the API's own class, so `k.dimension(plate.bottom, '40 mm')` hands
  it straight back; **every QuickJS handle is disposed** before a run returns,
  which QuickJS itself checks at `JS_FreeRuntime`. No DOM, no `fetch`, no
  timers, no module loading, and no `eval` on the host side (ADR-0067). Slices 2
  (the `script` feature in the kernel) and 3 (the editor dialog, the chip, the
  e2e) are open.
- 2026-10-05 · **P4-12 Fillet and chamfer depth: 32 edge sets, a chamfer's
  reference face, radius and distance handles** (ADR-0038 and ADR-0043
  amendments): `FILLET_MAX_SETS` and `CHAMFER_MAX_SETS` go from 8 to 32 (a
  document written with fewer sets reads unchanged; parsing costs 5 % more),
  and a chamfer set of the two unequal modes may name the face that takes
  its distance with a new `face` input, which the kernel turns into the
  `flip` the facade already understands (a face that doesn't touch one of the
  set's edges is an error naming the set and the edge; an equal set ignores
  it, and the dialog hides its Flip while a face is picked). Set 1's Radius
  and Distance each get an in-view handle on the set's first edge, along the
  outward bisector of its two faces' normals read from the model meshes --
  with no handle where that can't be read honestly (a seam, a smooth chain,
  a face the meshes don't have). The handles also found that a dialog's
  heads-up box swallowed `Shift+1...7` (the view commands) along with the
  plain digits it is there for, which is what left B8's fourth fillet edge
  unpicked; a key with a modifier is a command now. No facade change.
- 2026-10-05 · **P5-01 (3 of 3) The API reference and the docs site pages**
  (ADR-0068 §6): `pnpm api:generate` writes `docs/api/features/<type>.md` as well
  as the methods -- one page per feature type with its inputs (type, required or
  default, description), its face roles and an example call, plus an index by
  category -- and the landing page's site builds `docs/api/**/*.md` into static
  pages under `/docs/api/` at build time (`marked`, a build-only dependency; no
  script in a docs page), linked from the landing page's footer. The examples are
  the same lines as a generated `featureExamples`, so `tsc` checks them and a test
  runs them against a real `Design`; a test also compiles every code block of the
  hand-written pages. `docs/api/README.md`, `sketch.md` and `references.md` are
  written by hand.
- 2026-10-05 · **P5-01 (2 of 3) The public document API: sketches, face roles,
  examples** (ADR-0068 §4-§6): `d.sketch(plane, build)` with a `SketchBuilder`
  for every entity, every constraint type and each kind of dimension, built from
  the very builders the drawing tools use (moved out of the app into
  `@extrudo/sketch/build`), plus profile references (`s.profileAt([x, y])`), and
  every body-making feature lists the roles its faces are named with
  (`faceRoles`), which `handle.face(role)` is typed by and a kernel test checks
  against the real geometry. The examples under `docs/api/examples` are tests:
  the Wall bracket, benchmark B1 (equal to the fixture the app exported, up to
  its IDs, and recomputed headless) and a parametric box with a customizer and
  two configurations.
- 2026-10-05 · **P5-01 (1 of 3) The public document API, `@extrudo/api`** (ADR-0068
  §1-§4, §7): a package of its own (`Design`, `ApiError`, `FeatureHandle`,
  `ParameterHandle`) that changes a design only through core's commands, with
  counting IDs so the same calls give byte-identical JSON, the origin and
  feature references the kernel's persistent names need, and one method per
  feature type generated from core's registry (`pnpm api:generate`, with a
  staleness test). Slice 3 adds the docs and the site's pages.
- 2026-10-05 · **P4-12 Print Info with walls, infill and cost** (ADR-0048's
  amendment): the panel estimates what a *print* takes, not only what the solid
  part is. Each body's exact volume and area (the kernel already measures both)
  give the skin, `min(volume, area × walls × lineWidth)` per body, and
  `printed = skin + interior × infill` — at 100 % infill exactly P3-10's
  numbers. A wall count (2), a line width (0.45 mm), an infill (15 %) and a
  price per kg (25) are `<ExpressionInput>` fields, each a plain number of its
  own unit (the line width is mm whatever the document's units) checked by
  `checkPrintField`; all four live in the `print.material` preference with
  defaults, so an older preference reads as it did. Two new rows, "Printed
  (est.)" and "Cost", and a note that says what an estimate is. Support volume
  stays open: where supports come from is a slicer's decision.
- 2026-10-05 · **P4-12 (H2, H5) Threads cut in pieces; heavy tools merged without
  distances; fuzz budgets; a sweep says where its profile lands** (ADR-0067 §H2,
  §H5): a thread of about 400 turns trapped the WASM heap, and `spikes/
  p4-12-threads/` bisected it natively to OCCT running out of the 32-bit heap in
  the ring-minus-tooth boolean (`IntCurvesFace_Intersector`'s unwind calling
  through a vtable that isn't there; 350 turns take 403 MB to 1903 MB), so the
  tooth is now cut out of the ring in pieces (`THREAD_CHUNK`) and no turn count
  can trap; `MAX_TURNS` stays 150, now about time rather than memory. And
  `mergeTools` treats two overlapping tools as interfering when either is
  **heavy** (over `HEAVY_TOOL_FACES` = 200 faces) instead of asking OCCT for
  their distance — 277 s in one call between the tools of two threads, none at
  all now — which puts B9 back in the fuzzer's default run (120 steps, a 90 s
  step limit, `FUZZ_B9` gone; B8 gets its own 40 s). A sweep measures its
  profile's centroid against the path's start and warns when it is more than 1 %
  of the path's length (or 0.5 mm) away, which is what B10 got wrong.
- 2026-10-05 · **P4-12 (H3, H4) Exact enough mass properties, and a kernel worker
  that recycles itself** (ADR-0067 §H3, §H4): the facade's `measure` and
  `properties` integrate BRepGProp with an error bound (`MASS_EPS = 1e-7`)
  where a B-spline surface makes OCCT's fixed-order integral wrong -- a wrap's
  walls went from 1-3 % off to exact, and `scale`'s non-uniformly scaled
  cylinder from 0.77 % over to exact -- while a prism wall or a surface of
  revolution, where the volume integral's terms cancel and the bound form is
  worse, keeps the cheap form; the facade's own result checks (shell, offset
  face, draft, the wrap of an emboss) decide on the accurate one. `wrap.test.ts`
  tightens from 2 % to 1e-5 and a new `mass-properties.test.ts` checks a loft
  and a conic extrude against a fine tessellation. And `KernelApi.heap()` after
  every recompute: over 1 GiB, with no dialog open, the `Recomputer` ends the
  kernel worker and boots a new one (fonts sent again, recomputed cold, the
  model on screen throughout) and the notification history says so quietly.
- 2026-10-05 · **P4-06 (4 of 5) Mesh booleans and transforms** (ADR-0066 §4,
  FR-IO-06): a boolean with a mesh body in it goes to manifold-3d — the B-rep
  operand meshed through `exportMesh` at 0.01 mm / 0.1 rad and freed again — and
  **the result is a mesh body**, so `operate` (extrude, revolve, sweep, hole,
  pattern instances, rib joins), Combine and Mirror's join all work on meshes as
  they are; the result has no history and its one face is `mesh:<feature>`,
  numbered as an import's pieces are. A body that turns from a solid into a mesh
  says so once per feature: "A solid body was combined with a mesh and is a mesh
  from here on: fillets and face picks no longer work on it." `touchingBodies`
  asks a mesh pair manifold's `minGap`, Move/Mirror/Scale/Split Body and pattern
  copies transform meshes (a reflection keeps its triangles facing out —
  measured — and a move keeps its face name while a copy takes ADR-0044's copy
  rule), Split Body cuts a mesh with `Manifold.splitByPlane` and writes both
  halves as bodies of their own, and a hole on a mesh face, Place on Bed and a
  Rib still refuse with their own words. No facade change. Measured: a
  204,800-triangle STL less a Ø10 mm B-rep cylinder in **193 ms**, to **0.001 %**
  of the exact volume and closed (0.5 mm deflection costs 0.09 % and saves 9 ms,
  so the tool's tessellation is not where a mesh boolean loses accuracy). The
  e2e cuts a Ø6 mm hole through the imported cube, joins a box to it, moves it
  and splits it, reading the volumes from a 3MF export.
- 2026-10-04 · **P4-12 (H1) No `'unsafe-eval'` in the content policy**
  (ADR-0067 §H1): both WASM builds are made with `DYNAMIC_EXECUTION: 0` — the
  OCCT build beside its other emcc settings, planegcs beside
  `ALLOW_MEMORY_GROWTH` in its link flags (CI built and published both, new
  input hashes) — so their embind glue builds its invokers as closures and
  evaluates nothing; zod's JIT is off too (`z.config({ jitless: true })` in the
  new `packages/core/src/zod.ts`, our one zod import, with `zod.test.ts`
  proving no `new Function` is ever attempted). `'unsafe-eval'` is out of
  `apps/web/public/_headers`, which keeps `'wasm-unsafe-eval'` for the WASM,
  and `e2e/hosting.spec.ts` asserts the served `script-src` and walks a whole
  session (template, sketch, extrude, command palette, 3MF) under the real
  headers, failing on any violation or console error. Measured: parsing a
  document and dragging and recomputing the benchmarks are within noise
  (ADR-0067 §Results).
- 2026-10-04 · **Landing page: Cloudflare Web Analytics (cookieless) on extrudo.org
  only** — enabled through the `extrudo-site` Pages project's own setting (the tag
  is injected at deploy time, so no token is in the repo), its two hosts in the
  site's content policy (the app's stays `'self'`, so app. and edge. keep no
  analytics), a privacy note in the footer, the contact address
  hello@extrudo.org and link colours that meet WCAG AA in the light theme
  (a `--x-link` token); `e2e/site.spec.ts` checks that the injected beacon runs
  under the policy and audits the page in both themes (ADR-0057 amendment).
- 2026-10-04 · **P4-06 (1 of 5) Drawings into a sketch** (ADR-0066 §1,
  FR-SK-14): `readSvg` and `readDxf` in `@extrudo/io` (an XML tokenizer of our
  own, a path-data parser with the SVG arc conversion, transforms composed down
  the tree, `$INSUNITS`, blocks and `INSERT`, bulges, B-splines by knot
  insertion, everything left out counted) give a `Drawing` in millimetres with
  y up; `@extrudo/sketch/import`'s `drawingToSketch` turns it into a
  `SketchChange` (lines, circles and arcs, ellipses, and control-point splines
  for elliptical arcs and Béziers, so nothing is flattened), fixed by default,
  the 5,000-curve limit and the user's own IDs; and the tool `importDrawing`
  with its panel "Import drawing" (unit, scale, position, fixed, what the file
  brings in), which commits the drawing as one undo step. The e2e extrudes the
  imported plate and reads its size.
- 2026-10-04 · **P4-09 (slice 2 of 2) Linked folders** (ADR-0065 §3,
  FR-PRJ-06): a real folder of `.extrudo` files on disk, beside the browser's
  own copy — the browser copy stays primary, as the ADR requires. Where the
  browser has the File System Access API (Chromium), `Platform.folders` offers
  `link()` (the picker), `current()` (the handle, kept in its own IndexedDB
  store, since a `FileSystemHandle` survives a reload), `unlink()`, and on a
  link its `permission()`/`request()`, `list()`, `read()` and `write()`; where
  it doesn't, the platform has no `folders` and the app behaves as it did. The
  home screen grows a "Linked folder" section (link, reconnect, unlink, and the
  folder's `.extrudo` files as cards; opening one imports it **linked** to that
  file). A linked project writes its file after every autosave, at most once
  every 10 s with the throttle trailing and the newest state, and once more
  when the project closes; if the file changed on disk, nothing is written and
  a toast offers "Load from disk" (one undo step through ADR-0036's restore
  path, after keeping what you had as a version) or "Overwrite" — which is why
  a toast can carry two buttons now (`ToastOptions.actions`). A project that
  isn't linked gets "Save to Linked Folder" (File menu, Ctrl+K), which refuses
  a name that is already in the folder. The link itself lives in the project
  index (`linked: { file, modified }`), not in the document: it is about this
  browser, not the design. `e2e/linked-folder.spec.ts` over a stubbed
  `showDirectoryPicker` (an OPFS directory), which caught two bugs: the folder
  listing read `values()` (entries alone) instead of `entries()`, and a trailing
  write's outcome was dropped, so a conflict noticed ten seconds after a save
  never reached the user. CI's Chromium needed two more shims in that stub (an
  OPFS handle cannot be read back out of IndexedDB there, and a file being
  written is briefly not there).
- 2026-10-04 · **P4-09 (slice 1 of 2) Timeline groups** (ADR-0065 §1 and §2,
  FR-TL-06): neighbouring features fold into one chip. `doc.groups` holds each
  group as the **range** from `first` to `last`, so a group stays contiguous
  whatever moves — `normalizeGroups` (core's `groups.ts`) applies the rules and
  every command that reorders or removes features ends with it
  (`moveFeature`, `moveFeatures`, `removeFeature`, `restoreVersion`); a group
  whose members are all gone is dropped and a group that would overlap one
  before it is too, so groups never nest and never overlap (the schema says so
  too, on the path of the group). The timeline picks a run with Shift (the
  chip selection of P3-17) and groups it from the chip menu or the marking
  menu's list; a folded group is one chip with a folder glyph, its name, the
  member count and the worst of its members' statuses, an open one a band with
  its name as a label; the marker never rests inside a folded group (stepping,
  dragging and dropping count features, not chips, so it passes one whole, and
  rolling into one opens it), and dragging a folded group's chip moves every
  member together in one command. `e2e/timeline-groups.spec.ts`. (Linked
  folders, ADR-0065 §3, is slice 2.)
- 2026-10-04 · **P4-06 (3 of 5) Mesh bodies** (ADR-0066 §3, FR-IO-06): an STL,
  3MF or OBJ becomes one body of triangles per piece, kept by manifold-3d 3.5.4
  (Apache-2.0) as a `ShapeHandle` at `MESH_HANDLE_BASE` (2^30), so the engine,
  its cache, `hold`, scopes and strict leaks are unchanged and a leaked mesh
  fails a test like a leaked shape. `meshFrom` welds the corners and refuses a
  mesh that isn't closed with `checkManifold`'s counts; `mesh`, `exportMesh`,
  `measure`, `properties`, `describe`, `solids`, `count` and `transform` have
  a mesh branch, and every other shape-taking method refuses with
  `MeshBodyError`: "Shell needs a solid body: this body is a mesh (imported, or
  combined with a mesh)." The module loads only for a document that imports a
  mesh file (`KernelApi.enableMeshes`, which the `Recomputer` calls beside the
  file's bytes): 0.54 MB of WASM, precached, and the CSP needed nothing new.
  In `@extrudo/io`: `readStl` reads ASCII STL (detected from the file, not its
  name), the new `readObj` (`v` and `f`, polygons fanned, `v/vt/vn` and
  negative indices, one body per `o`/`g`), and `write3mf` takes a `unit`.
  `units` scales the coordinates (`auto` takes a 3MF's own), `up` is Move's
  turn, and each body's one face is `mesh:<feature>` (numbered after the first).
  The browser tags a mesh body "Mesh" (`data-body-mesh`), picking skips its
  creases (`EDGE_MESH`, drawn but unpickable), Print Info measures it, and the
  Export dialog leaves it out of a STEP file. Measured: a 204,800-triangle STL
  imports in 1.4 s and +66 MB of JS heap in one live shape; the e2e imports a
  20 mm cube, a two-object 3MF in centimetres and a Y-up OBJ, undoes one,
  reads the open-edge count of a broken one and exports the rest.
- 2026-10-04 · **P4-06 (5 of 5) Canvas images** (ADR-0066 §5, FR-IO-07): the
  Insert tab's "Canvas" (tool `canvas`) picks a PNG, JPEG or WebP, stores its
  bytes with the design and lays the picture on a plane — the XY plane, a
  construction plane or a flat face. A canvas makes **no geometry**: the
  kernel's evaluator reads the plane with `planeOf` and reports its frame
  (`CanvasReport`, collected as `ModelState.canvases`), and the bytes never
  reach the worker. `viewport/Canvas.tsx` draws one textured quad per canvas,
  decoded from the attachment with `createImageBitmap` (no URL, so the CSP is
  untouched), never picked, under the bodies and the sketches; its width comes
  from the dialog, which reads the picture's pixels and proposes them at 100
  dpi, and **Calibrate** takes two clicks on the plane and the real distance
  they measure, setting `width × real / measured` to 0.01 mm. The browser gets
  a "Canvases" folder (eye, rename, the feature menu), the Viewport
  `data-canvases` for the tests, and `e2e/canvas.spec.ts` lays a picture on a
  face, calibrates it, hides it, moves it with its plane and brings it back
  through an exported `.extrudo`.
- 2026-10-04 · **P4-06 (2 of 5) Attachments for imports, STEP import**
  (ADR-0066 §0 and §2, FR-IO-05): a STEP file the user picks becomes one body
  per solid, named `import:<id>:face:<n>` from the file's own face order.
  `packages/core/src/media-types.ts` gives the ten media types and the
  extension they come from (`mediaTypeOf`, which the add-font flow now uses
  too), attachments carry 25 MB a file and 100 MB a design, and a new `file`
  input kind names an attachment — which the document schema checks for one
  the feature can read. The worker's files work like its fonts:
  `KernelApi.addFile(id, bytes, mediaType)` and `EvalContext.file` /
  `fileType`, with `MissingFileError` ("The file b3.step is missing from this
  design.") for one the design names and the kernel doesn't have; the
  `Recomputer` sends every attachment an `import` names before the recompute
  **or preview** that needs it, once per session. No facade change: the STEP
  branch is `readStep`, the `up` turn is `transform`, and one body per solid is
  `splitSolids` as everywhere. The **Insert tab** holds "Import" (tool
  `importBody`, File menu "Import STEP or mesh…"): it writes the file's bytes
  with the design, opens the dialog (the file as a read-only line, Units for
  meshes, Up, live preview) and OK adds the attachment record and the feature in
  one undo step, through the dialog framework's new `commitWith` hook and a new
  `info` field kind. `fixtures/imports/b3.step` is B3's two bodies written by
  our own `writeStep`; `e2e/import-step.spec.ts` imports it, undoes it, turns it
  with Up y, and brings it back through an exported `.extrudo`.
- 2026-10-04 · **P4-11 (parts 2 and 3) Benchmarks B8 and B10**, which
  finishes the task (ADR-0039's second amendment). **B8, a name tag**
  (`e2e/benchmark-b8.spec.ts`): a Box with `length`/`width`/`thick`, its four
  vertical edges rounded `corner`, a Ø4 mm hole through the top face at
  `-length / 2 + 6`, a text `EXTRUDO` (8 mm, centred) sketched **on that face**
  and embossed `letters` out of it, a parameter change that makes the plate
  longer and thicker and carries the letters up with it, and the 3MF read back
  through `@extrudo/io` (one closed solid, its volume between the plate's and
  the plate's plus its letters'). **B10, a cable chain link**
  (`e2e/benchmark-b10.spec.ts`): a rounded centreline path sketched on XZ swept
  with a `depth` x `wall` section into a ring, a cylinder pin on its outside
  face, a blind hole `pin + 2 * tolerance` across at the other end (the
  tolerance comes from the 3D Print tab's panel), a rectangular pattern of
  three links along Y, and the 3MF read back (three closed solids). Both
  fixtures recompute headless in `packages/kernel/src/benchmarks.test.ts` and
  fuzz clean at the full 200 steps. B10 found that **a sweep carries its
  profile exactly where its sketch drew it** (OCCT's no-contact placement), so
  a swept section has to be *centred on the path*: centred on the sketch's
  origin instead, the link came out with 6 mm walls.
- 2026-10-04 · **P4-10 (2 of 2) Variable-radius fillet** (ADR-0064 §2,
  FR-FT-04): each edge set of a fillet takes an optional **end radius**
  (`radiusEnd<n>`) and a **swap** (`swap<n>`), so the round tapers along its
  tangent chain from `radius` at one end to the end radius at the other. The
  facade's new `filletVariable` (staged edges with two radii each, one pair
  per chain, the same build, check, `filletRollsOff` guard and history as
  `fillet`, whose diagnosis it shares — except that a taper only reports the
  factor every radius scales by, since which chain is too large depends on the
  direction the radius runs in); `Kernel.filletVariable` with the same
  `FilletError`. The evaluator calls it **only** when some set has an end
  radius, so a constant document still takes the constant `fillet` and
  computes exactly as before. The dialog gets a per-set Variable toggle with
  an End radius and Swap ends. `spikes/p4-10-harness/` (native) checks a box's
  top edge 2 → 5 mm, a chain of three tangent edges 1 → 3 mm, a taper too
  large → a factor that works, and leaks; `fillet-variable.test.ts` measures
  the volumes through the evaluator (a taper takes more off than a 2 mm
  fillet and less than a 5 mm one; `swap` keeps the volume and moves the big
  end); `e2e/fillet.spec.ts` reads them out of three 3MF exports.
- 2026-10-04 · **P4-10 (1 of 2) Rib** (ADR-0064 §1, FR-FT-17): the `rib`
  feature — a thin wall from one sketch **line** to the body beside it, the
  stiffening triangle in a bracket's corner. Core's definition (`curve`,
  `thickness`, `side`, `flip`) and the patternable types; the kernel's
  evaluator, which builds a slab around the line (it extended by the bodies'
  box diagonal at both ends, swept that far to the side the material is on,
  prisms it along the plane normal by the thickness), cuts every body out of
  it and joins the piece that holds the line's midpoint — named as a prism
  under `rib:<id>`, so the wall's faces keep their names through a pattern.
  The dialog: Line (one sketch line), Thickness with an arrow across the
  plane, Thickness side, Flip with a direction arrow (a new manipulator kind,
  `kind: 'arrow'`, whose head a click turns). `e2e/rib.spec.ts` measures the
  Wall bracket's volume through a 3MF: the rib adds 2 915.1 mm³ against the
  exact 2 916.0 mm³ of the triangle, and flipped it says the rib doesn't close
  against the body. §1's "`d` is signed by the middle of the bodies' box" is
  answered by their centre of mass instead: an L's legs are on the corner side
  of its diagonal, which the box's middle is not.
- 2026-10-04 · **P4-11 (part 1) Benchmark B9** (ADR-0039's amendment): a
  threaded bottle cap and its thread adapter, built through the UI in
  `e2e/benchmark-b9.spec.ts` — a revolved rectangle, a Shell that opens it at
  the bottom, a Thread on its inside wall, a second revolved sketch (a stepped
  section dimensioned from a fixed point at the origin) as a body of its own
  with a Thread on each of its two outside walls, all sized to fit, a parameter
  change, and the 3MF read back through `@extrudo/io` (two closed solids, their
  volumes within the bounds the threads leave). The fixture
  `fixtures/benchmarks/b9-bottle-cap.extrudo` is recomputed headless in
  `packages/kernel/src/benchmarks.test.ts` and fuzzed (6 steps, for the reasons
  in ADR-0039). The benchmark found two limits of modeled threads and both are
  answered here: the ISO coarse thread series now goes to M64 (a bore wider
  than M30 had no `autoThread` fit at all, so the cap couldn't grow), and a
  thread is refused above 150 turns (about 400 corrupted the WASM heap; the
  corruption itself is a P4-12 item).
- 2026-10-04 · **P4-04 (4 of 4)** Emboss and deboss on cylindrical faces
  (ADR-0060 §3, §4): the profiles or a whole text are **wrapped** round a
  cylinder's wall instead of projected on it, so the letters keep their width
  measured along the surface. A new facade method `wrapOnCylinder` (OCCT's
  simple offset of the wrapped cap: both caps exact surfaces on radius R and
  R ± depth, the walls between them exactly radial), the kernel's cylindrical
  branch with the frame rule (the sketch plane must run along the axis; `r` from
  the axis towards the sketch, `across = a × r`, the foot of the axis on the
  plane as the corner), `namedWrap` in the naming operations, the dialog's
  depth arrow standing on the wall at the letters (radially, out of a boss's
  wall and into a hole's), and `e2e/emboss.spec.ts`: a text round a Cylinder's
  wall, embossed and debossed, and the same on a box's top face.
- 2026-10-04 · **P4-05** Control-point splines and conics (ADR-0063): a sketch
  `spline` entity gains a mode — `fit` (through its points, as before),
  `control` (its points are the B-spline's poles, so the curve is guided by
  them) or `conic` (three points — start, shoulder, end — and a `rho` that says
  how full it is). Two tools in the Create menu: Control Point Spline and
  Conic, with the poles drawn as a thin dashed control polygon while the sketch
  is open, and a Rho field in the selection panel. A conic's own curve is
  rational, which the kernel cannot take, so the conic is stored exactly (three
  points and rho) and drawn as a cubic within 1e-5 mm — everything downstream
  (profiles, export, extrude, the sketch's faces) reads one `splineCurve`. No
  facade change, no new schema version.
- 2026-10-03 · **P4-08** Print tolerance and slicer hand-off (ADR-0062): the
  print tolerance is the user parameter `tolerance`, set from the 3D Print tab's
  Tolerance panel (a field and the Tight 0.1 / Normal 0.2 / Loose 0.3 mm
  buttons, one undo step each, through the shell's parameter `apply`), and it
  says how many holes and threads use it. Hole presets add it to every diameter
  they write ("3.4 mm + 2 * tolerance", depths stay plain) and the Preset
  dropdown recognises both forms; the platform interface gained the optional
  `openInSlicer` the Export dialog offers (Slicer select + "Open in slicer")
  where it exists — the browser build leaves it out, the launch is Phase 6.
- 2026-10-03 · **P4-03b** User fonts as attachments (ADR-0061): `doc.attachments`
  records the files a design carries (name, file name, media type, SHA-256,
  size) while their bytes live beside the document —
  `projects/<id>/attachments/<sha256>` in the project store and
  `attachments/<sha256>` in the `.extrudo` file, one copy each, collected when a
  version is saved; a text's font may be `attachment:<id>`, which the app reads
  for the UI thread and sends to the kernel worker; both Font selects list the
  design's fonts and offer "Add font…" (TTF, OTF, WOFF; WOFF2 refused, a file
  that isn't a readable font stores nothing), with a hint that the font travels
  inside the design; 10 MB per file and 50 MB per design.
- 2026-10-03 · **P4-04 (1 of 4)** Emboss and deboss on flat faces (ADR-0060
  §1, §2): the `emboss` feature in core and its evaluator in the kernel. The
  profiles or a whole text from a sketch in any plane parallel to the face are
  moved onto the face's plane and swept `depth` along its outward normal
  (`emboss`, joined) or against it (`deboss`, cut); only the face's own body is
  touched. The app dialog, e2e and round faces come in the later slices (the
  dialog in slice 2, the facade's `wrapOnCylinder` in slice 3).
- 2026-10-03 · **P4-07** Customizer and configurations (ADR-0059): a user
  parameter can be exposed for changing (`parameters[].customizer`: `min`,
  `max`, `step`, `group`), and a design can hold named value sets
  (`configurations[]`) to switch between. The Customizer panel (Solid › Modify,
  or Ctrl+K) lists the exposed parameters with expression fields and sliders,
  warns about a value outside its range, and switches configurations by name —
  one undo step for a whole drag, one for applying a configuration. No "active
  configuration" is stored: one goes stale after any edit or undo, so the panel
  matches the values. The Parameters dialog gets a star per row, the slider's
  range and a Clear button per number; the templates open with their main
  dimensions exposed and a Small and a Large configuration. Commands, the pure
  helpers the panel needs (`customizerRows`, `configurationChanges`,
  `currentConfigurations`, `capturedValues`, `isPlainValue`) and core's
  `setParameterExpressions` (applying a configuration re-solves the sketches that
  use a parameter in the same step). File format 5.1.1 and 5.4; `formatVersion`
  stays 1 (optional keys).
- 2026-10-03 · **P4-03** Sketch text (ADR-0058): the Text tool (Shift+T) puts
  text on a sketch — string, font, alignment and height in a non-modal panel,
  the height a driving dimension — and the letters come out as closed ink
  regions: an extrude of a whole text sweeps every letter (a plate round a
  text has it cut out as holes), and the selection panel edits the string, the
  font, the alignment and the height. Six bundled OFL fonts (Inter, Noto Serif,
  JetBrains Mono, Allerta Stencil, Fredoka) with versioned IDs; opentype.js
  only in `@extrudo/sketch/text`, behind core's shaper registry.
- 2026-10-03 · **P4-02** Modeled threads (ADR-0056): the Thread feature cuts a
  real ISO 68-1 thread into a shaft's or a hole's round face (Solid › Modify ›
  Thread): ISO metric coarse and fine, UNC and UNF presets or a size that fits
  the face, length/offset from either end, right or left hand, a print
  tolerance (0.1 mm, or the `tolerance` parameter) and 45° lead-ins at open
  ends. Facade `threadSweep`/`threadFace`; every boolean now builds once
  (it ran twice).
- 2026-10-03 · **Landing page and channels** (ADR-0057): `apps/site`, a static landing
  page for extrudo.org with an intro video recorded from the real app (`pnpm demos -g
  intro`); the stable app moves to app.extrudo.org (deployed by a `v*` tag) and the
  latest build to edge.extrudo.org (every green main); the site's `sw.js` retires the
  app's old service worker at extrudo.org and old `#/p/…` links go on to the app;
  `e2e/site.spec.ts`.
- 2026-10-03 · **P4-01** Sweep, loft and coil (ADR-0055): sweep along exact
  sketch curves or edges (follow or fixed, twist, end scale, holes kept), loft
  through profiles, faces and an end point (smooth or ruled, open or closed),
  coil placed like a primitive (three types, taper, hand, circle, square or
  triangle sections inside, on or outside the diameter); seven facade methods
  checked in a native harness first; patterns repeat all three; file format
  6.22 to 6.24; OCCT input hash `9a6136154e2f`; feature patterns skip repeats on the original.
## v0.3.0 (Phase 3, "real CAD")
- 2026-10-02 · **Fix** Repeat visits to extrudo.org failed with `ERR_FAILED`: the
  service worker served a redirected copy of `index.html` (Pages redirects it to `/`)
  for navigations; it now stores and serves a plain copy, and the e2e static host
  redirects like Pages (ADR-0054 amendment).
- 2026-10-02 · **P3-15** Public release prep (ADR-0054; the owner's release
  steps are in `docs/release-checklist.md`): README with screenshots, CONTRIBUTING,
  CODE_OF_CONDUCT (Contributor Covenant 2.1, enforcement through GitHub, no email),
  SECURITY (GitHub private vulnerability reporting), issue forms and a pull request
  template, NOTICE (third-party components and licenses, upstream
  taucad/opencascade.js#40) and `scripts/check-licenses.mjs` in `pnpm lint`;
  `docs/file-format.md` states the MIT license; Cloudflare Pages hosting: `_headers`
  (COOP same-origin, COEP require-corp, CSP, `no-cache` for the shell and `sw.js`,
  immutable hashed assets), a `deploy.yml` workflow that runs after CI succeeds on main and
  skips cleanly without the Cloudflare secrets, `SITE_URL` (default
  `https://extrudo.org`, registered 2026-10-02) in the canonical and Open Graph tags, `docs/deploy.md`;
  the service worker now waits and the app shows "A new version of Extrudo is ready."
  with a Reload button that saves open designs first; `e2e/hosting.spec.ts` runs the build under
  the full header file and `vite preview` (so every e2e spec) under COOP/COEP and the CSP.
  Public-readiness audit of the tree and history: nothing to remove (one note for the
  owner: the commit author address). Versions 0.3.0.
- 2026-10-02 · **P3-12** Onboarding (ADR-0052): the home screen offers a "Take
  the tour" card (once) and a row of four templates with pictures (Wall bracket,
  Storage box, Box with a lid, PCB enclosure: B2, B4 and B5 come from the
  benchmark fixtures through `readArchive`, are precached and open as copies
  under a new ID); a five-step tutorial that builds a box (sketch, rectangle,
  dimension, extrude, fillet) and reads its progress from the design, so undo
  steps it back (Help, Ctrl+K "Tutorial"; a card with a ring round the toolbar
  control, not modal, Esc closes it, `aria-live`); a hint over an empty design
  that points at Create Sketch; toolbar tooltips carry a looping WebM demo for
  twelve tools (Create Sketch, Line, Rectangle, Circle, Dimension, Extrude,
  Revolve, Fillet, Shell, Hole, Press Pull, Rectangular Pattern: 480 × 300, 3 to
  4 s, 19 to 60 kB each), fetched when the tooltip opens, not precached, a still
  under reduced motion, recorded from the app by `pnpm demos` with Playwright's
  own ffmpeg. No kernel, facade or schema change; the axe audit covers the new
  screens and `KNOWN` stays empty. Startup (50 Mbit): first visit home 0.74 to 0.86 s, kernel
  1.16 to 1.33 s; repeat visit home 0.19 to 0.22 s; precache 21.51 to 21.69 MB
  raw (5.30 to 5.47 MB brotli), main chunk +12 kB, demos 0.44 MB outside it.
- 2026-10-01 · **P3-17** (part 2) Polish, done: Place on Bed takes one face
  per body and a Spin angle about the vertical; Overhang Analysis can take a
  picked flat face as "down"; Offset follows a projected face outline (B2
  uses it, fixture rewritten); the OK button's key hint passes contrast in
  the light theme (`KNOWN` is empty); a checked-in screenshot of the overhang
  shading; `operate` finds the bodies a tool touches solid by solid, so B5's
  2 × 20-instance pattern recomputes in 2.4 s instead of 55 s, and the fuzzer
  keeps its seeds 7 and 2026; a pattern of cuts goes one colour class at a time
  (overlapping 10 × 10 holes 7.7 s to 3.7 s); the warm-cache heap growth is
  attributed to `mesh` and moved to P4-12 (a `BRepTools::Clean` experiment
  didn't cure it). No schema version change (`placeOnBed` gains `spin` and
  takes several faces), OCCT hash unchanged.
- 2026-10-01 · **P3-17** (part 1, items 1–10) Polish: browser rows show
  feature status like timeline chips; a single pick is named in its field
  ("Line · Sketch1", "Body1"), and origin axes show while an axis field picks;
  constraint glyphs and dimension labels have a right-click menu (Delete,
  Edit Value); Measure takes sketch points and curves, axes, planes and
  construction points; section analysis clips vertex dots and projected
  curves; timeline chips can be picked and moved together, and dragging near
  the ends scrolls; Appearance has a custom colour; a Remove feature has a
  dialog. Each item amends its own ADR.
- 2026-10-01 · **P3-08** (second half) and **P3-14** (B6) Split Body, Scale,
  Draft and benchmark B6 (ADR-0053): bodies cut along a plane or flat face
  into a body per side (or one side kept); bodies scaled about a point,
  uniformly or per axis (flat faces stay flat), in place or as copies; faces
  tilted about a neutral plane, too-steep drafts refused with the largest
  angle that works. Every face keeps its name through all three. B6, a wall
  hook with a drafted arm and fillets meeting at the plate's corners, is built
  through the UI, kept as a fixture and fuzzed. OCCT input hash `0ba43e09d993` (release `occt-0ba43e09d993`).
- 2026-10-01 · **P3-17 (first item)** Two bugs the fuzzer found in B4 and B5
  (ADR-0038 and ADR-0047 amendments): a fillet radius that reaches a parallel
  wall of an adjacent face (a lid side face with a step 3 mm below its edge)
  trapped OCCT; the facade now refuses it before OCCT runs, with the usual
  "max ≈" message and probes that stay below it. A pattern whose later round
  failed leaked the shapes its earlier rounds kept (the same latent leak in
  Fillet, Chamfer and Mirror's join is fixed too). B4 and B5 join the fuzzer
  (1000 steps on four seeds each; the only further finding is a pattern of
  2 × 20 instances that takes a minute or more, left open). OCCT input hash
  `5449f61f15d6` (release `occt-5449f61f15d6`).
- 2026-09-30 · **P3-14** (part) Benchmarks B4, B5, B7 (ADR-0039 amendment):
  a box with a lid that fits by a clearance parameter, a PCB enclosure with
  screw posts and countersunk lid screws, and a knurled knob, each built
  through the UI in an e2e spec, parameter-driven, exported as 3MF (closed,
  sizes and volumes checked; the lid's gap is the clearance) and kept as a
  fixture the kernel recomputes headless. B6 waits for Draft.
- 2026-09-30 · **P3-13** Hardening (ADR-0050): a seeded fuzzer makes random
  parameter, dimension and expression edits on the benchmark fixtures and
  recomputes them headless (no crash, leak or cache mismatch in 4500 edits);
  it found that shrinking B2 flipped its inner wall across the edge it is
  measured from, so big sketch changes are now solved in small steps. Files
  from a newer Extrudo open with what this version doesn't know left out, and
  a notice says so; feature inputs it doesn't know are a warning, not an
  error. Versions can be deleted (one, or all but the newest 10), and the
  version list is locked across tabs. A recompute's first new error goes
  into the notification history, with Edit. Mesh export works body by body
  with a progress bar, and Cancel stops it. Silhouettes cost a third
  (6 ms per frame at a million curved triangles); the rest of NFR-01 was
  measured and written down. An axe audit covers the main screens in both
  themes; four contrast and ARIA problems were fixed.
- 2026-09-30 · **P3-08 (first half)** Press Pull and Offset Face (ADR-0051):
  Q (Solid › Modify, the marking menu's wedge) pushes or pulls what is
  selected: a face opens the new Offset Face, an edge Fillet, a sketch profile
  Extrude, with the selection already in the dialog. Offset Face moves faces
  along their normals (positive out), the faces next to them following: a pad
  grows or sinks, a cylinder wall changes radius, a hole narrows or widens, and
  fillets round a pad move with it (the dialog picks the whole chain). Every face
  keeps its name, so a fillet after an offset survives editing it; a distance
  that is too far says how far it may go. Extrude and Revolve now share one
  press-pull rule: a face swept into its body, or a profile drawn on a face,
  proposes a cut, out of it a join. Facade change (new `offsetFaces` and
  `tangentFaces`); a body whose rounded edges meet at a sharp corner can't be
  offset yet (OCCT traps on it, so it is refused with a reason); Split, Scale,
  Draft and face patterns are still to do.
- 2026-09-30 · **P3-04** Hole (ADR-0049): the Hole tool (H, Create's menu)
  drills simple, counterbore or countersink holes, blind (drill point 118° by
  default, 0° for a flat bottom) or through all, at the point you click on a
  face or at picked sketch points, with presets for M2 to M8 clearance and
  M2 to M5 heat-set inserts (sizes fill in, nothing is stored). The preview
  is live, with arrows for the diameter and depth; the faces keep their names
  when sizes change, patterns and mirrors repeat holes, and a hole that misses
  the body says so. No facade change.
- 2026-09-30 · **P3-07** Patterns (ADR-0047): Rectangular, Circular and Path
  Pattern (Solid › Create menu) of bodies (copies, or joined to the
  original) or of features (the tool of an extrude, revolve or primitive that
  joins or cuts, repeated at every instance), with counts and distances as
  expressions, symmetric layouts, a second direction for grids, a whole or
  partial angle, and paths of sketch curves and edges; instance faces are
  named per instance so references survive count changes, and many
  instances go through one boolean (10 × 10 in 0.5 to 2 s). Mirror also
  mirrors features now. Ghosts, distance arrows and an angle ring in the
  view; no facade change.
- 2026-09-30 · **P3-10** 3D-print aids (ADR-0048): 3D Print › Prepare gets
  Print Info (volume, weight and filament length for PLA, PETG, ABS, TPU or a
  density of your own, 1.75 or 2.85 mm filament, from the exact volumes, solid
  at 100 % infill), Overhang Analysis (faces leaning out more than an angle
  from a chosen down direction are shaded red; the bed is left out; a row in
  the browser's Analysis folder) and Place on Bed (pick a flat face: its body
  turns so the face lies on the bed, a real feature you can undo, edit and
  export; also in a flat face's context list).
- 2026-09-30 · **P3-03** Shell (ADR-0046): hollow a body by removing faces
  (on one or several bodies) and giving a wall thickness, inside or outside
  the surface; with no face a body is hollowed closed, a sealed void. The
  preview is live. A wall that is too thick says how thick it may be ("A
  12 mm wall is too thick for this body (max ≈ 9.9 mm)"), and a face next to
  a fillet, which OCCT can't open, is refused with a reason. The outside
  keeps its face names in both directions. The Modify group's Shell tile is
  ready. OCCT input hash `6384f5ae452a` (with P3-06's `transform`).
- 2026-09-30 · **P3-09** Section analysis (ADR-0045): Section Analysis in
  Solid › Inspect (Shift+S, Ctrl+K, "Section Here" in the face context
  list) cuts the view through an origin plane, a construction plane or a
  flat face, with the cut filled and hatched (one cap per body, in the
  body's colour tinted towards the Inspect teal). An offset expression, a
  Flip and a draggable arrow set the cut; faces, edges and silhouettes are
  clipped, the grid and origin aren't, and clicks pass through what is cut
  away. It is view state kept through edits and recomputes; the browser's
  Analysis folder turns it off and on, edits or removes it.
- 2026-09-30 · **P3-06** Combine, Move/Copy and Mirror (ADR-0044): Combine
  joins, cuts or intersects a target body with tool bodies (keep the tools
  if you like); Move/Copy moves and turns bodies with an in-view gizmo (an
  arrow and a ring per axis), about a picked axis, or point to point, and can
  keep the original; Mirror reflects bodies about a plane or flat face, as a
  copy, in place or joined to the original. Faces keep their names through
  all three, so later features still find them. Benchmark B3 now uses a real
  Combine. New facade method `transform`, OCCT input hash `8057072e8cdd`.
- 2026-09-29 · **P3-02** Chamfer (ADR-0043): bevel edges in up to eight sets,
  each with its own type (equal distance, two distances with a Flip for
  which face takes distance 1, distance and angle); picking an edge takes
  its tangent chain; the preview is live. A chamfer that can't be built says
  why with the largest distance that works ("Distance 50 mm is too large for
  edge 12 (max ≈ 19 mm)"). The Modify group's Chamfer tile is ready.
- 2026-09-29 · **P3-11** Marking menu and context menus (ADR-0042): a
  right-click without movement opens a ring of eight command wedges
  (Sketch, Extrude, Fillet, Move, Press Pull, Undo, Repeat last, Delete;
  in a sketch the drawing tools, Undo, Construction and Finish Sketch) and
  a list that depends on what was right-clicked (Select other…, Sketch on
  Face, Measure, Hide Body, Appearance…, view commands over empty space);
  click, flick (press, drag, release), arrows, Tab and Esc work, a
  right-drag still navigates, and Ctrl+K "Right-Click Menu: Use a List"
  swaps the ring for a plain list. Browser folders, origin rows, parameter
  rows and design cards got context menus.
- 2026-09-29 · **P3-05** Construction geometry (ADR-0040): offset plane,
  plane at angle, midplane, plane through 3 points, tangent plane, axis
  through 2 points / a cylinder / along an edge, and point, as timeline
  features with dialogs, previews and Shift+P / Shift+A / Shift+X keys. They
  work as sketch planes, primitive placements, extrude "to object" planes
  and revolve axes, are drawn and pickable in the view, and are listed in
  the browser's Construction folder (`docs/file-format.md` 6.10).
- 2026-09-29 · **P3-01** Fillet (ADR-0038): round edges with several edge
  sets, each with its own radius; picking an edge takes its tangent chain;
  the preview is live. A fillet that can't be built says why in plain words
  with the largest radius that works ("Radius 50 mm is too large for edge
  12 (max ≈ 19 mm)"), found by the kernel. The Wall bracket template's
  Fillet1 computes now.
- 2026-09-29 · **P3-16** Notification history (ADR-0041): a bell button
  below the toasts (and Ctrl+K "Notification History") opens the session's
  earlier notifications, newest first with errors in a group on top,
  repeats counted, an unread badge, Clear all; a notification's action
  stays clickable while it still applies (Show for a hidden sketch) and
  shows disabled once it doesn't.
## Phases 0 to 2 (v0.0 to v0.2)
- 2026-09-29 · **P2-17** Benchmarks B2 and B3 (ADR-0039): the parametric
  storage box (cut from a solid, sketch on its top face, exported as 3MF
  and STL) and the phone stand (two bodies joined into one, parametric
  angle, 3MF) are built through the UI in end-to-end specs, and the
  designs of B1, B2 and B3 are saved as fixtures (`fixtures/benchmarks/`)
  that the kernel tests recompute. B3's standalone Combine step waits for
  P3-06: until then bodies merge by a join that touches both.
- 2026-09-29 · **P2-16** File-format spec: `docs/file-format.md` documents
  the `.extrudo` container, versioning and migrations, the document JSON
  (parameters, expressions, every feature type, sketch data, references)
  and a complete example, with a test that keeps it in step with the
  schema.
- 2026-09-29 · **P2-15** WASM size and startup (ADR-0037): the app works
  offline. A small service worker precaches everything (both WASM files,
  the kernel worker, every lazy chunk; updates keep the previous version's
  files for tabs still open), and a web app manifest with icons lets
  browsers install it. The OCCT build now binds only the C++ facade (the
  kernel never used the 198 raw classes it carried): the WASM shrinks from
  4.52 to 3.69 MB brotli (20.19 to 15.76 MB raw) and instantiates about 2.5
  times faster. Measured at 50 Mbit: the whole app is 4.9 MB brotli, a
  first visit shows the home screen in 0.8 s, a repeat visit in 0.22 s, the
  kernel is ready 1.1 s after opening a project.
  `node scripts/measure-startup.mjs` repeats the measurement.
- 2026-09-29 · **P2-14** Version history (ADR-0036): Ctrl+S (or File ›
  Save version…) saves the design as V1, V2, … with a description. The
  Versions dialog (File › Version history…, or the clock beside the
  design's name) lists them; Restore brings one back as a single undo
  step and first keeps what you had as a version too, and Open copy opens
  one as a separate design. Versions are stored with the project and
  travel in exported `.extrudo` files.
- 2026-09-29 · **P2-13** Measure and inspect (ADR-0035): Measure (`I`, in
  Solid › Inspect and 3D Print › Prepare) shows a picked body's volume and
  area, a face's area, type, radius or normal, an edge's length, radius
  and sweep, a vertex's position; two plain clicks measure between two
  things: minimum distance with ΔX, ΔY, ΔZ and a line in the view, the
  angle, the distance between hole centres. All from the kernel's exact
  geometry. The status bar shows the size of the box around the
  selection.
- 2026-09-28 · **P2-11** Timeline v2 (ADR-0033): drag the rollback marker
  (or focus it and use the arrow keys, Home and End); drag chips to
  reorder them, refused with a message when a feature would come before
  something it uses; Roll Back to Here and Move to End in the chip and
  browser menus. A sketch can move to another plane or face (Redefine
  Plane). When a change loses a face, edge, profile or plane a feature
  used, Fix References picks it again (in the feature's dialog, or a new
  plane for a sketch); when the kernel took the closest match (a warning
  chip), Keep Closest Match stores it. While a dialog edits a feature, the
  timeline shows the marker after it.
- 2026-09-28 · **P2-12** STL, 3MF and STEP export (ADR-0034): Export in
  the 3D Print tab, the File menu and a body's menu. Pick bodies (the
  selection, or every shown one), 3MF (objects with names, colours and
  millimetres, for slicers), binary STL or STEP AP242 (exact geometry,
  named products), and Coarse, Medium, Fine or a custom deviation and
  angle. The kernel meshes each body at that resolution into one closed
  surface; the dialog shows the triangle count and that every mesh is
  watertight before saving.
- 2026-09-28 · **P2-10** Primitives (ADR-0032): Box, Cylinder, Sphere and
  Torus in the Solid tab's Create menu, each a parametric feature. They
  open on the XY plane with a live preview; click another origin plane or
  a flat face of a body to move them there (a face proposes its centre and
  Join, or Cut for a box or cylinder pushed in with a negative height).
  Sizes, X, Y and Offset in the plane's frame, a box's rotation, arrows
  and an arc to drag, and new body, join, cut or intersect. A primitive on
  a face follows the face when the model changes.
- 2026-09-28 · Fix: a new extrude or revolve hides the sketches whose
  profiles it used (one undo step with it, as in Fusion), so a used
  profile no longer floats over a pocket and takes the clicks meant for a
  sketch on its floor. A toast bottom left says which sketch was hidden,
  with a Show button, for 12 seconds.
- 2026-09-28 · Fixes: the new **Extrudo** mouse preset is the default
  (middle-drag orbits, right-drag pans, the left button as before;
  Onshape / SolidWorks is still in the Mouse controls menu); dropdown
  options (a dialog's Operation, for one) are readable in the dark theme
  where the browser draws its list white.
- 2026-09-28 · **P2-07** Revolve (ADR-0029): the Solid tab's Revolve
  turns sketch profiles or flat faces about an origin axis, a sketch line
  (construction lines too) or a straight edge: a whole turn by default,
  or an angle one way, symmetric or two ways, flipped as needed; new
  body, join, cut or intersect. Select a profile and an axis first and
  both land in the dialog; an arc in the view drags the angle all the way
  round. The origin axes can now be picked (and are highlighted) in the
  model. The kernel says when the axis isn't in the profile's plane or
  the profile crosses it.
- 2026-09-28 · **P2-09** Sketch on face and Project (ADR-0031): Create
  Sketch now also takes a flat face of a body (click it, or select it
  first); the sketch sits on the face and moves with it when the model
  changes. The Project tool (P, in the Sketch tab's Create menu) brings
  body edges and faces into a sketch, outlines of cylinders included; the
  projected curves are purple, fixed, make profiles, take constraints, and
  follow the model when it changes. A profile drawn on a face and pushed
  in cuts by default.
- 2026-09-28 · **P2-08** Bodies (ADR-0030): new bodies are named Body1,
  Body2… as they appear and keep their names; the browser's Bodies folder
  shows how many there are and renames, hides, colours (ten swatches) and
  fades (opacity) them; a click selects a body. Deleting a body adds a
  Remove feature to the timeline, so undo or rolling back brings it back.
  A cut that splits a body makes one body per piece. Wireframe and
  hidden-edge styles now draw the outlines of holes and other curved
  faces.
- 2026-09-28 · **P2-06** Extrude (ADR-0028): E extrudes selected sketch
  profiles or flat faces into solids, one side, symmetric or two sides,
  each side to a distance, up to a face or vertex, or through all, with a
  taper per side and Flip; new body, join, cut or intersect, with the
  bodies found automatically or picked. The preview shows the new body,
  a green join or a red cut; arrows and taper arcs in the view drag the
  values. Press-pull: select a face and press E; pulling it out joins,
  pushing it in cuts. The browser lists the model's bodies, and the Wall
  bracket template now builds its bracket.
- 2026-09-28 · **P2-05** Feature dialog framework (ADR-0027): features get
  their command dialog from a declarative spec (selection, expression,
  dropdown and toggle fields): it opens on the right with the current
  selection already filled in, picks in the view go into its selection
  fields, and the kernel previews the draft live as a translucent ghost
  (joins green, cuts red), dimmed while an input is invalid or the
  feature fails. Distance arrows and angle arcs drag values, with a
  heads-up box that takes typing. OK is one undo step; a timeline chip
  reopens the dialog for editing, with the model rolled back to the
  feature. Tried on the dialog debug page until Extrude arrives.
- 2026-09-28 · **P2-03** B-rep rendering and 3D selection (ADR-0026): in
  the model, the pointer pre-highlights faces, edges, vertices, sketch
  curves and profiles, a click selects (Shift or Ctrl toggles), Esc
  clears; window and crossing boxes select bodies, or faces with bodies
  filtered out. Hidden geometry is offered by "Select other…" (long press
  or right-click). A selection filter sits beside the nav bar's Select;
  the status bar says what is selected ("2 faces"). Selections turn into
  references through the persistent IDs on body meshes (P2-04).
- 2026-09-27 · **P2-04** Topological naming v1 (ADR-0005): every face,
  edge and vertex of a body has a persistent name from why it exists (an
  extrude's caps and the sketch curve of each side), carried through
  booleans and fillets by OCCT's history; split faces are numbered by
  position, edges and vertices named after their faces. References keep a
  fingerprint; a feature finds its face or edge by name, by a related name
  after a split, or by fingerprint with a warning, and says what to do
  when it's gone. The kernel sweeps (extrude, revolve) with history, and
  body meshes carry the names for selection. A 19-scenario naming suite
  and a 1000-rebuild memory test.
- 2026-09-27 · **P2-02** Sketch → kernel (ADR-0025): the kernel turns a
  sketch's curves into exact OCCT edges (splines cut where they cross
  themselves), splits them where they meet and makes a face for every
  profile, holes included, placed in the sketch plane. Faces carry the
  same region IDs as the profiles the sketch shows, so a later feature
  reads the face a user picked; bridges and dangling lines drop out as in
  the sketch. A 1000-rebuild memory test.
- 2026-09-27 · **P2-01** Recompute engine (ADR-0024): the kernel worker
  walks the timeline and caches each feature's result under a hash of its
  inputs, expression values, references and the bodies before it, so an
  edit at feature 25 of 30 re-evaluates 25–30 and undo re-evaluates
  nothing. Shapes are reference-counted in the cache; a newer request
  cancels a running one between features; dialog previews; the
  `Recomputer` keeps the model store current and survives kernel crashes by
  skipping the feature that crashed. Timeline chips show ✕/⚠ with the
  reason; the status bar counts errors and shows the kernel state. A
  500-recompute memory test.
- 2026-09-27 · **Edits made just before a reload are kept** (found by
  P1-15): the page writes a synchronous rescue copy of an unsaved document
  when it is hidden or goes away, and the next start saves it
  (`Platform.rescue`, `recoverRescued`). ADR-0009 amended. **Parameters on
  the Sketch tab** (Modify group), so the dialog opens while sketching
  without Ctrl+K.
- 2026-09-27 · **P1-15** Benchmark B1 end to end, and the **Phase 1 exit
  (v0.1)**: Playwright builds the parametric plate with four corner holes
  through the UI (user parameters, a fully constrained sketch of 16
  constraints and 7 expression dimensions), changes the hole spacing in the
  open sketch and the width outside it, reloads, and checks the dimension
  labels and every path of the SVG export. `newSketchOnXY` e2e helper.
- 2026-09-27 · **No timeline scrollbar with room to spare** (user report):
  the marker's triangle is wider than its bar and stuck out a pixel at the
  ends of the chip list, which then scrolled; the list has 4 px of padding
  at each end now.
- 2026-09-27 · **F6 fits tightly; no stuck selection box** (user reports):
  Fit frames the box of the bodies, sketches and placed dimension labels
  as seen from the camera, with a 15 % margin, instead of a bounding
  sphere (a face-on sketch filled half the view). A press released over
  the nav bar or a menu no longer leaves a selection box following the
  pointer. ADR-0008 amended.
- 2026-09-27 · **Onshape / SolidWorks mouse controls by default** (owner's
  choice): first in the Mouse controls menu and the default preset
  (right-drag orbits, middle-drag pans); Fusion's mapping is second.
  FR-VP-01, UI spec §3.1 and ADR-0008 updated.
- 2026-09-27 · **No browser menu on right-click** (user report): the
  browser's own "Copy / Select all" menu no longer opens over the view,
  the nav bar, the ViewCube or the panels (it got in the way of Onshape's
  right-button orbit); text fields, links and selected text keep it.
  ADR-0008 amended.
- 2026-09-27 · **Resize circles by the rim** (not a roadmap task, user
  feedback): with no tool running, dragging a circle's rim changes its
  radius while the radius is free (a circle with a fixed centre could not
  be resized by dragging before), and moves the circle when a dimension
  holds it. Solver `beginRadiusDrag`/`dragRadius`. ADR-0018 amended.
- 2026-09-27 · **Pointer modes** (not a roadmap task, user feedback): the
  nav bar's first button is Select, the default pointer mode, pressed
  whenever no nav tool or command runs; it stops either. Starting a tool
  ends Orbit/Pan/Zoom. Orbit and Zoom have their own cursors (they all
  showed a hand). The Solid tab's Select tile is gone; a tool from a
  group's menu lights up its group's label. ADR-0007 and ADR-0008 amended.
- 2026-09-27 · **P1-14** Command search and shortcuts v1: one keymap
  table (`commands/keymap.ts`, Fusion's keys plus Shift+1…7 for the
  standard views) that the toolbar, menus and shortcut handler all read;
  a per-mode command list (`shell/commands.tsx`: the shown tabs' tools,
  edit, view, panel, file and theme commands); fuzzy search that favours
  word starts ("3pr" → 3-Point Rectangle) and falls back to group and
  hint words; the Ctrl+K palette and the S toolbox at the pointer with
  pinned commands (Shift+Enter pins; kept in preferences) and recent
  commands. Keys of tools that come later say when they arrive. The app
  bar has a search button after Undo/Redo, and Help is a menu with Search
  commands and Toolbox. ADR-0023.
- 2026-09-27 · **Design review** (not a roadmap task): the workspace
  switcher is removed; the toolbar's tabs are Solid · Insert · 3D Print
  (Insert and Export left Solid; the model's Export is in 3D Print); the
  browser slides closed in 200 ms and leaves a small "Show browser" tab
  instead of a rail; the status bar shows the viewport's render rate and
  frame time ("idle" while the view is still). ADR-0007 amended.
- 2026-09-27 · **P1-13** SVG and DXF export: `@extrudo/io` gets a neutral
  2D `Drawing` (layers; contours of lines, arcs, elliptical arcs and
  Béziers) with `writeSvg` (width/height in mm, bounding-box viewBox, y
  flipped, exact `A`/`Q`/`C` curves, layers as Inkscape layers) and
  `writeDxf` (R12: LINE/ARC/CIRCLE, POLYLINE for ellipses and splines,
  profiles as closed polylines with bulges, `$INSUNITS` mm).
  `@extrudo/sketch/export` maps a sketch's curves (construction optional,
  on a dashed layer) or its profiles (filled, even-odd, with holes) onto
  it, splines as the Bézier pieces of their B-spline. An "Export sketch"
  dialog (format, contents, selected profiles first, size summary) opens
  from the Sketch tab's new Export group and from a sketch's timeline or
  browser menu. Golden-file tests. ADR-0022.
- 2026-09-27 · **P1-12** Timeline v1 and browser tree: right-click menus
  on timeline chips and browser rows (Edit Sketch, Rename, Show/Hide,
  Suppress, Delete; new design-system `ContextMenu`); rename in place
  (F2 or the menu: a field in the row, a popover over the chip); the
  pointer on a chip or row draws its sketch in the accent; eyes on
  sketches and on the Origin, Sketches and Bodies folders (one undo step
  each); a Construction folder; suppressed chips dashed, rows struck
  through. Core: optional `Feature.visible`, `setFeatureVisibility`, and
  `removeFeature` refuses while another feature refers to the feature or
  an expression outside it uses one of its named dimensions. Suppress and
  delete wait until an open sketch is finished. ADR-0021.
- 2026-09-27 · **P1-11** Profile detection: a TypeScript planar
  arrangement (`@extrudo/sketch/profiles`) finds every closed region of a
  sketch, where curves cross, touch or end on each other, with nested
  groups as holes; exact lines and arcs, ellipses and splines as
  polylines; exact areas; region IDs hashed from their boundary's curves
  and directions (stable across moves, resizes and unrelated edits).
  Profiles are shaded in the view (new `profile-fill` token), hovered and
  selected where no entity is (kind `profile`, `<sketch>/<region>`), with
  their area in the properties panel; the palette's "Show profiles" hides
  them. Also fixed a CI-only e2e failure from P1-10 (a constraint glyph
  over a corner took the click). ADR-0020.
- 2026-09-27 · **P1-10** Modify tools: Trim (`T`, previews what goes),
  Extend, Break; Sketch Fillet (`F`) and Chamfer on a corner point or two
  lines, keeping a virtual sharp so dimensions to the corner survive, with
  a driving radius (distance); Offset (`O`) of a joined chain with parallel
  or concentric pieces and linked distance dimensions; Mirror with
  symmetric constraints; Move (`M`, a solver drag) and Copy; Rectangular
  and Circular Pattern (copies take the original's dimension parameters);
  Scale (points, radii and dimension expressions; refuses fixed geometry).
  Pure operations in `@extrudo/sketch/modify` returning a change for the
  new `modifySketch` command (replace, remove, re-express; one named undo
  step). Seven new tool icons. ADR-0019.
- 2026-09-27 · **P1-09** Selection and editing in sketch: with no tool
  running, hover pre-highlights, click selects (Shift/Ctrl toggles), a drag
  over empty space draws a window (left to right, solid) or crossing box
  (dashed), and a drag on geometry moves it, or the whole selection, with a
  live solve as one undo step (Esc puts it back). The solver drags several
  points across components (`beginDrag(ids)`, `dragBy`). Delete removes
  geometry with its points, constraints and dimensions (`removeFromSketch`
  entities, `entityRemoval`; a spline loses just the point). Properties
  panel in the view's bottom-left: type and status, point X/Y and radius as
  expressions, line length and angle, construction toggle, Delete.
  ADR-0018.
- 2026-09-27 · **P1-08** Constraint status: per-entity colours in the open
  sketch (free `sketch` blue, fully constrained `ink`, over-constrained
  `error` red; construction stays grey), from planegcs's dependent
  parameters (new `get_dependent_params` binding in our planegcs patch;
  `ComponentReport.free`, `sketchStatus`). Red glyphs and labels for what
  over-constrains, including driving dimensions the geometry doesn't meet
  (`unmetDimensions`); constraints on fixed geometry alone don't count.
  DOF counter in the palette. A new over-constraining dimension opens a
  dialog (add as driven, or cancel) instead of going in driven; turning a
  driven dimension driving, or a value the solve doesn't meet, is refused.
  ADR-0017.
- 2026-09-27 · **P1-07** Dimensions: the Sketch Dimension tool (`D`) picks
  a line (length), two lines (angle, or distance if parallel), a point and
  a line, two points, a circle (diameter) or an arc (radius), and places
  the label where you click: horizontal, vertical or aligned by where it
  goes, an angle's pair by its sector (`supplement`). New dimensions drive
  at their measured value and open for editing in place
  (`<ExpressionInput>`, a Driven checkbox, `name = value` creates a
  parameter); one that would over-constrain goes in driven. Labels with
  extension lines and arrows (`tools/dimensionLayout.ts`) select, drag
  (label offset stored from the anchor), and delete. Named driving
  dimensions (`d1`…, typed heads-up values too) are model parameters in the
  Parameters dialog; renames and delete checks cover them. Changing a
  value, or a parameter it uses, re-solves every affected sketch in the
  same undo step (`ToolHost.apply`), and refuses a value the sketch can't
  take. "Show dimensions" palette toggle. ADR-0016.
- 2026-09-26 · **P1-06** Constraints UI: 13 constraint tools (Coincident …
  Symmetric) in a compact two-row Constraints group, with nine new icons.
  They pick points and curves under the cursor (`pickEntity`), highlight
  what a click would pick, and refuse a redundant or conflicting constraint
  with a message; a solve that shrinks a curve to nothing counts as a
  conflict (planegcs reports it as solved). Fix toggles. Glyphs next to the
  geometry (placement in `tools/glyphs.ts`): hover highlights the
  constrained entities, click selects, Delete removes (`removeFromSketch`,
  one undo step), new ones flash; the wheel and middle/right drags pass
  through them to the view. "Show constraints" palette toggle.
  `curvePolyline` in core now shapes every drawn curve. ADR-0015.
- 2026-09-26 · **P1-05** More drawing tools: regular polygons (inscribed,
  circumscribed across the flats, from an edge; equal edges with corners on
  a construction circle; a Sides heads-up field that persists), slots
  (center to center, overall; tangent lines and arcs with a construction
  centerline), ellipses and fit-point splines. Two new entity types in the
  core schema: `ellipse` (three points, mapped to planegcs's ellipse through
  a solver-only focus and ordinary constraints) and `spline` (fit points;
  the curve is a cubic B-spline interpolation in `sketch/curves.ts`, no
  solver equations). Previews draw polylines and construction circles. The
  drawing tools and overlay moved into a lazy chunk (main chunk 950 kB, was
  about 1 MB). ADR-0014.
- 2026-09-26 · **P1-04** Basic drawing tools: rectangles (2-point `R`,
  3-point, center with construction diagonals), circles (center-diameter
  `C`, 2-point, 3-point), arcs (3-point `A`, center point, tangent), points,
  and the Line tool's tangent-arc drag (press on the chain's end and drag).
  Each commits with its structural constraints (corners, H/V or
  perpendicular/parallel, tangent with its side) plus test-solved snaps;
  typed widths, heights, diameters and radii become dimensions. Construction
  toggle (`X`, palette checkbox). Previews draw arcs, circles and dashed
  guides; the viewport reports drags to tools. Variants live in the Create
  menu with their own icons. ADR-0013.
- 2026-09-26 · **P1-02** Sketch tool framework: the inference engine in
  `@extrudo/sketch/inference` (endpoint, center, point, origin, intersection,
  midpoint, on-curve, H/V alignment and guide crossings, grid; unit tested)
  and its auto-constraints, test-solved with `SketchSolver.check` before
  they're committed; `addToSketch` in core (additions plus solved positions
  in one step). Web: tools as state machines under a host, pick rays and
  projection in `camera.ts`, an SVG overlay (rubber band, dashed guides,
  snap glyphs, prompt), the heads-up box (typed length → dimension, typed
  90° multiples → horizontal/vertical), grid snapping that follows the
  visible grid ("Snap to grid" in the palette), Ctrl/⌘ turns snapping off.
  The Line tool (`L`) is the reference tool. ADR-0012.
- 2026-09-26 · **P1-03** Solver integration: `SketchSolver` in
  `packages/sketch` (planegcs adapter): every entity, constraint and
  dimension type mapped (endpoint tangency as `angle_via_point`, an optional
  `reversed` side on `tangent`/`smooth`), fixed geometry as constants, one
  persistent system per independent component, solving only what changed,
  drag with temporary constraints, DOF, conflict and redundancy reports, and
  `check()` to test-solve a new constraint. Our planegcs WASM builds in CI
  once per input hash (`pnpm planegcs`, `pnpm wasm`; shared
  `scripts/wasm-release.mjs`). Fixtures and a benchmark (plates, gear
  outline); debug page `#/debug/solver`. ADR-0011.
- 2026-09-25 · **P1-01** Sketch feature and sketch mode: `SketchData` schema
  in core (points, lines, circles, arcs; every FR-SK-07 constraint and FR-SK-08
  dimension; records keyed by ID; reference checks on load), origin plane
  frames, the `sketch` feature definition (plane `ref` input + sketch data),
  `createSketch`, v0 sketch data migrated to records. Web: Create Sketch
  picks an origin plane in the view (hover highlight) or in a prompt; Look
  At; sketch mode as one undo transaction; the Sketch tab with Finish Sketch;
  the sketch palette; the grid on the sketch plane; sketches drawn in the
  viewport; browser and timeline open sketches; 17 new sketch icons. The Wall
  bracket template has real sketches. ADR-0010.
- 2026-09-25 · **P0-08** Project storage: `packages/storage` with the
  `ProjectStore` interface over an IndexedDB index and OPFS files (IndexedDB
  fallback), `.extrudo` zip read/write through core's migrations, and
  in-memory versions for tests. Web: async platform with project store,
  persistent-storage request and file download/pick; autosave (800 ms, save
  state in the app bar, retry, flush on hide/leave); thumbnails from the
  viewport; hash routes `#/` and `#/p/<id>`; home screen (new design, Wall
  bracket template, grid, search, sort, rename, duplicate, export, import,
  trash, delete forever, storage badge). ADR-0009.
- 2026-09-25 · **P0-05** Viewport: R3F canvas over the glowing background,
  Z-up world; our own camera controller (target + quaternion + size, one
  scale for perspective and orthographic, zoom to cursor, fit, 350 ms
  transitions, instant under reduced motion); Fusion, Blender,
  Onshape/SolidWorks and trackpad mouse presets; adaptive shader grid with X/Y
  axes, Z axis, origin point and planes (Browser eyes); CSS 3D ViewCube with
  faces, edges, corners, home, turn and roll arrows; nav bar (orbit/pan/zoom
  tools, fit F6, orthographic, visual styles, grid, mouse preset); bodies
  from the model store in four visual styles, tried on `#/debug/kernel`.
  Settings are preferences. The viewport is a lazy chunk. Seam edges are
  flagged by the kernel facade and not drawn. ADR-0008.
- 2026-09-25 · **P0-04** Design system and app shell: brand tokens as CSS
  variables (Slate dark default, light) mapped into Tailwind v4, bundled
  Instrument Sans and JetBrains Mono, Radix wrappers (button, icon button with
  tooltip, menu, dialog, popover, inputs), two-tone icon pipeline (17 SVGs,
  rules test), platform preferences, shortcut registry, and the shell: app
  bar, toolbar tabs and groups, resizable and collapsible browser, viewport
  placeholder, timeline with working playback. Parameters dialog moved into
  the shell. Screenshot tests in both themes. ADR-0007.
- 2026-09-25 · **P0-07** Expressions and parameters: Pratt parser with
  source spans, length/angle dimensional analysis (mm and degrees; plain
  numbers take the context unit), the FR-PAR-02 functions, parameter graph
  with cycle paths and "did you mean", model parameters (`ExprInput.unit`),
  rename that rewrites references, refusal to delete a used parameter.
  `<ExpressionInput>` (live value, exact error underline, never commits an
  invalid draft) and the Parameters dialog at `#/debug/parameters`. 226 unit
  tests, Playwright E2E. ADR-0004.
- 2026-09-25 · **P0-06** Document model in `packages/core`: zod schema v1
  (strict objects, document invariants), `loadDocument` with a migration chain
  on raw JSON and a v0 fixture, branded IDs, feature registry types (core holds
  the data part; kernel and web extend it), commands with Immer patches, undo
  history with nested transactions (commit collapses, cancel reverts), and
  vanilla Zustand document/session/model stores. ADR-0003.
- 2026-09-25 · **P0-03** Solver spike (`spikes/p0-03-solver/`): planegcs in
  Node and the browser on a constrained rectangle and on generated 50–500-entity
  sketches; our own planegcs builds (the published one has a fixed 16 MB heap);
  per-component solving; SolveSpace (`slvs`) compared. ADR-0002: planegcs from
  our own build, one solver system per independent component, drag through
  temporary constraints on sketch parameters.
- 2026-09-25 · **P0-09** Kernel package: our trimmed OCCT WASM with a C++
  facade (shapes in an arena, flat result/history/mesh arrays, LGPL-2.1+),
  TS `Kernel` layer, Comlink worker, `KernelClient` that restarts the worker
  after a WASM abort, debug page `#/debug/kernel` rendering the test part.
  Memory test (1000 rebuilds + a leak control) and crash test in Vitest and
  Playwright. CI builds the WASM once per input hash and publishes it as a
  release (`pnpm occt ensure` downloads it).
- 2026-09-25 · **P0-02** Kernel spike (`spikes/p0-02-kernel/`): libcascade,
  replicad and brepjs/occt-wasm compared on the same scenario in Node and a
  browser worker, with sizes, load times, op timings, a memory test and a
  topological-naming history test. Built our own trimmed libcascade WASM
  (4.34 MB brotli, about 200 ms cold start). Found that libcascade's `delete()`
  often doesn't free C++-owned memory. ADR-0001: own trimmed build + a C++
  facade that owns memory + a thin TS layer.
- 2026-09-25 · **P0-01** Repo and toolchain: git, pnpm 12 monorepo (`apps/web`,
  `packages/{core,sketch,kernel,io,storage}`), TypeScript 7 strict, Biome 2.5,
  Vitest 5, Playwright 1.63, GitHub Actions CI, GPL-3.0 (+ MIT for `io`),
  package-boundary check, branded hello page.
