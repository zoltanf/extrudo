# ADR-0052: Onboarding: template gallery, tutorial, empty-design hint, tooltip demos

- **Status:** Accepted, 2026-10-02
- **Task:** P3-12 (FR-UX-04, FR-UX-05). Code: `apps/web/src/onboarding/`
  (`tutorial.ts` the steps, `state.ts` the preference, the start request and the
  card's store, `useTutorial.ts`, `TutorialCard.tsx`, `ViewportHint.tsx`,
  `anchor.ts`, `demos.ts`, `ToolDemo.tsx`), `apps/web/src/home/gallery.ts` and
  `home/templates/*.png`, `HomeScreen.tsx`, the Help menu in `shell/AppBar.tsx`,
  the `tutorial` command in `shell/commands.tsx`, `data-tool` on the toolbar's
  tiles, `Tooltip`'s `demo` slot, `apps/web/public/demos/*.webm`,
  `e2e/record-assets.spec.ts` + `e2e/demo-recorder.ts` + `scripts/record-demos.mjs`
  (`pnpm demos`), `e2e/tutorial.spec.ts`, `e2e/onboarding.spec.ts`. No kernel,
  facade, schema or file-format change.
- **Builds on:** ADR-0007 (design system, shell), ADR-0009 (home screen,
  storage; `readArchive` migrates every file), ADR-0023 (commands), ADR-0037
  (offline precache), ADR-0039 and ADR-0053 (the benchmark fixtures), ADR-0050
  (the axe audit).

## Context

A new user meets a toolbar of forty tiles and an empty grid. FR-UX-05 asks for a
first-run tutorial and a starter gallery, FR-UX-04 for tooltips with a short
animated demo, and the UI spec (§6, §7) for a hint over an empty design. The
constraints: the whole app works offline and starts within NFR-02's budgets;
every existing e2e test starts on the home screen with empty storage and must
not be blocked; the axe audit stays clean.

## Decisions

### 1. Template gallery

`home/gallery.ts` lists four templates: the Wall bracket (still built in code,
`project/templates.ts`) and **B2 Storage box, B4 Box with a lid, B5 PCB
enclosure from `fixtures/benchmarks/*.extrudo`**, the very files the benchmark
tests recompute. Vite emits them as hashed assets (`?url`), so they are in the
service worker's precache and a template opens offline. A file template is
fetched, read with storage's `readArchive` (core's migrations and validation
apply, like any file the user opens) and becomes **a copy: a new ID, the
template's name, a new creation date**; its saved versions are dropped. The
card's picture is a small PNG checked in under `home/templates/`, also set as
the new project's thumbnail so its card on the home screen has one at once.
Each card is a button named "Start from the <name> template" (the name the
Wall bracket already had, so `openProject` is unchanged).

The thumbnails are made by the app: `RECORD_ASSETS=1` runs a spec that opens each
template, turns to the home view, saves (the autosave takes a fresh picture of
the view) and pulls `thumbnail.png` out of the exported `.extrudo`. They are
checked in; regenerate them when a template or the render changes.

### 2. The tutorial reads the design, never clicks

Five steps build a box: **sketch** (a sketch feature exists), **rectangle** (a
sketch has four lines), **dimension** (a sketch has a dimension), **extrude** (an
extrude feature), **round** (a fillet, chamfer or shell). `onboarding/tutorial.ts`
is pure data over `{ doc, mode, activeTool }`: each step has a title, a text (it
changes with the state: "now click the XY plane" while Create Sketch waits,
"press Finish Sketch" while still in the sketch), the toolbar tool to point at
and a `done(facts)`. The current step is **the first one whose work isn't in
the document**, at or after a floor that "Skip step" raises. So the tour
follows any route the user takes (sketch with the Line tool, dimension before the
rectangle is closed), **undo steps it back**, nothing is stored, and a design that
already has the box shows the finish card at once. Suppressed features don't
count.

The card (`TutorialCard`) hangs under the toolbar tile of the step
(`[data-tool="<id>"]`, found again four times a second by `useTargetBox`, since
tabs swap and panels slide) with an accent ring on the tile; with no target (the
plane pick) it sits over the timeline's corner. It is **not modal and takes no
focus**: the user needs the whole app to follow it. It is a labelled region whose
text is an `aria-live="polite"` area (a screen reader hears each step), it sits
right after the app bar in tab order, and **Esc closes it while focus is inside**
(a global Esc would take the key from Esc-cancels-the-tool). Colour is never the
only signal (the ring comes with the card, the step says "Step 2 of 5").
The ring and the notch respect reduced motion.

It runs on an empty design. The home screen's "Take the tour" card makes a new
design and asks the project that opens to start it (`requestTutorial`, taken
once by `useTutorial`); Help › Tutorial and Ctrl+K "Tutorial" start it in the
open design if it has no features, or else in a new one (`FileActions.startTutorial`).
The `onboarding.tour` preference is `new` (the home card shows), `started`,
`dismissed` (closed before the end, or the card's X) or `done`; only `new`
shows the card, so a first run isn't nagged. It is a non-modal card in the
grid: **no existing e2e test needed a change** (`New design` and the template
buttons keep their names).

### 3. The empty-design hint

`ViewportHint`: "Start with a sketch: press **Create Sketch** and pick a plane",
a dashed accent arrow from the words to the Create Sketch tile, while
`doc.features.length === 0`, no tool runs, no dialog is open and the tutorial
is closed. `pointer-events: none`. Undo to the empty design brings it back.

### 4. Tooltips and demo clips

Every toolbar tile and constraint icon already had name, key (`keysFor`) and a
sentence (`Tool.hint`); `tooltips.test.ts` now checks every tool has a name and
a one-sentence hint and that each key shows. New: `Tooltip` takes a `demo` slot,
rendered inside the open content only, and `ToolDemo` puts a `<video>` there:
muted, looping, `playsInline`, `aria-hidden` (decoration: the words say the
same). **Clips are not in the JS bundle and not precached.** The tooltip asks for
`demos/<toolId>.webm` when it opens; the browser's HTTP cache keeps it; the
service worker's precache skips `demos/` (`SKIPPED` in `precache-plugin.ts`) and
`sw.js` returns without answering requests under `/demos/` (a `<video>`
range-requests, and the network handles that better than a worker that would
have to answer 206s). Offline, or if the file is missing, the video's `onError`
removes it and the tooltip has its words alone (tested by aborting the route).
**Reduced motion** (`prefers-reduced-motion`, followed live): no autoplay, the
URL ends `#t=0.01` and the browser shows the first frame as a still. Twelve
tools have a clip: Create Sketch, Line, Rectangle, Circle, Dimension, Extrude,
Revolve, Fillet, Shell, Hole, Press Pull, Rectangular Pattern; `demos.ts` lists
them and `demos.test.ts` checks the list against the files, that each file is
at most 150 kB and that all of them together stay under 2 MB.

### 5. Recording the clips (`pnpm demos`)

No ffmpeg was installed. Playwright's own ffmpeg (`playwright install ffmpeg`,
2 MB) has only an MJPEG decoder and a VP8 encoder with `crop`, `scale` and `pad`
filters, which is enough but not a general tool, and Playwright's built-in
`recordVideo` records the whole page at its own quality, in real time, with
no cropping. So `e2e/demo-recorder.ts` takes **JPEG screenshots of a clip
region in a loop** (about 8 to 12 a second: WebGL on SwiftShader), lays them on a
constant 15 fps timeline by when each was taken, holds the last frame for
0.6 s and pipes them to ffmpeg (`libvpx`, constrained quality, `scale` to
480 × 300). The OS cursor isn't in a screenshot, so the page gets a drawn
pointer and a click ring (`CURSOR_SCRIPT`), and the onboarding hint and card
are hidden with a style. The flows in `e2e/record-assets.spec.ts` are the same
steps the e2e specs use (a cube from the Box tool, an edge picked in the home
view, a dimension typed key by key), run through the real app and kernel, so a
clip is what the tool does today. `scripts/record-demos.mjs` installs ffmpeg,
builds, and runs the spec with `RECORD_ASSETS=1` (the spec skips itself
otherwise, like `WRITE_FIXTURES`). Clips are 3 to 4 seconds (the plan said about
2: the preview and the OK need that time to read), 19 to 60 kB each, 460 kB in
all.

## Numbers

Measured on the Ubuntu machine with `node scripts/measure-startup.mjs` (50 Mbit,
20 ms latency, brotli; twice after, the two runs agree within 0.03 s).

| | before | after |
|---|---|---|
| main JS chunk (`index-*.js`) | 544.79 kB | 557.33 kB |
| precache, raw / brotli | 21.51 MB / 5.30 MB | 21.69 MB / 5.47 MB (three `.extrudo` files, four thumbnails, +12 kB JS) |
| demos, not precached | – | 12 files, 0.44 MB |
| first visit: home / kernel ready | 0.74 s / 1.16 s | 0.86 s / 1.33 s |
| repeat visit: home / kernel ready | 0.19 s / 1.07 s | 0.22 s / 1.17 s |
| repeat visit, offline: home / kernel ready | 0.20 s / 1.06 s | 0.23 s / 1.12 s |

All three NFR-02 targets (first visit under 8 s, repeat home under 1.5 s,
kernel under 3 s) still hold with a wide margin. The script now lists the demos
apart from the precache total and serves `.webm`.

## Rejected

- **A coach-mark library** (Shepherd, Driver.js, Intro.js): a dependency and a
  modal overlay for what is one card and a ring; they also advance by their own
  buttons, not by the app's state.
- **Steps advanced by click handlers** ("when Create Sketch is pressed"): a user who
  gets there another way (key, search, undo) is stuck; reading the design can't
  disagree with the app.
- **A dimmed spotlight over everything but the target**: it blocks the controls
  the next step needs and is a focus trap for assistive technology.
- **A tutorial on the open design with a baseline** ("a sketch more than at the
  start"): the box would depend on what was there before; an empty design is
  simpler and a restart is a new design.
- **Storing progress**: derived state needs no migration and can't go stale.
- **GIF, animated WebP or APNG demos**: ten times the bytes of VP8 for flat UI
  colour; **MP4** needs H.264, which Playwright's ffmpeg doesn't have.
- **Playwright's `recordVideo`** (see 5), and **frames from `Page.startScreencast`**
  (full-page, only on change; the screenshot loop is simpler and gives clip regions).
- **Precaching the clips**: 460 kB is small, but a clip is decoration and the
  precache is what makes the app work offline; the tooltip degrades to words.
- **Rendering template thumbnails at runtime** (starting the kernel on the home
  screen) and **a template per feature test**: checked-in pictures cost 4 requests
  that are precached, and the benchmarks already test the designs.
- **The old `TEMPLATES` list in `project/templates.ts`**: the gallery moved to
  `home/gallery.ts`; the Wall bracket's builder stays where its tests and the e2e
  suite use it.

## Open items

- Tools that sit only in a menu (the Create menu's primitives, the sketch
  modify tools) have no tooltip, so no demo; a menu item could carry its hint.
  Clips for Move, Combine, Chamfer and the constraint icons are missing too
  (add a flow to `record-assets.spec.ts` and a name to `demos.ts`).
- The tutorial and the hint are English strings in the components, like the rest
  of the UI (FR-UX-07 is still open); a touch tablet isn't covered (the steps
  talk about clicks).
- The hint's arrow and the card's resting place assume the browser panel's
  default width (248 px); a resized panel leaves them a little off. The card's
  `useTargetBox` polls (250 ms); a `ResizeObserver` plus a toolbar event would
  be exact.
- "Skip step" and the close button are the only way out besides Esc; there is no
  "back" (undo steps back), and no "show me again" prompt for the hint.
- The clips are 3 to 4 seconds, not the 2 the plan named, and sampled at 8 to 12
  screenshots a second, so a fast pointer move steps. A faster capture (CDP
  `Page.startScreencast`, which the screenshot loop avoids) would smooth them.

## Amendment (2026-10-11): the empty-design hint is gone

The owner's UI review 3 (R3-15, `docs/plans/ui-review-2026-10-11.md`): "It looks strange and
it only appears sometimes … I really don't want that, for now." `ViewportHint.tsx` and its
place in `AppShell` are removed, with its e2e checks (`e2e/onboarding.spec.ts` now checks
that an empty design shows no hint, `e2e/tutorial.spec.ts` and `e2e/a11y.spec.ts` no longer
expect it). §3 above describes what it was. The tutorial, the home card and the tooltip demos
stay; a hint may come back as part of a later tutorial. The open item about "the hint's
arrow" no longer applies.

## Amendment (2026-10-11): a clip for every Solid tile, framed for the tooltip

The owner's UI review 3 (R3-16, decision 4): "let's do a first batch, and yes, I would re-record
everything. Please make sure when recording that the important part is visible in the tooltip."
The first batch is every tile of the Solid and Modify tabs plus the thirteen clips above,
re-recorded in the current UI; Construct, 3D Print and the Sketch tab follow later. It comes in
two pull requests: **Solid** (this part: 21 tiles, 16 of them new) and then **Modify** with the
four sketch clips.

- **The frame is the action, not the window.** A clip is a 400 × 250 px region of the page
  (`FRAME`), scaled to the 480 × 300 file, which the tooltip shows 236 px wide. The scenes
  zoom the view until the geometry fills about 70 % of the frame (`frameWorld`), pan it clear of
  the browser, the toolbar and the open dialog (`safeArea`), and keep the pointer, the pick and
  the handle inside. No chrome is in the frame, except where the result lives there:
  New Component's clip shows the browser's rows, because the tool's outcome is the component
  in the browser, and Record Macro's shows the status bar's red dot. No clip depends on text.
- **Each scene starts from a small design**, `fixtures/demos/<tool>.extrudo`. They are written
  through `@extrudo/api` by `packages/cli/src/demo-designs.test.ts`, which recomputes each one
  headless and checks the files match the code (`WRITE_FIXTURES=1` rewrites them). The scene
  imports its file from the home screen, so it never draws its own setup on camera.
- **Panning uses the nav bar's Pan tool and a left drag.** A right-button drag opens the
  marking menu, because Chromium on Linux fires `contextmenu` when the button goes down.
- **Still stretches are cut short.** `Recorder.resample` advances a run of byte-identical
  frames by at most 400 ms, so waiting on the kernel doesn't show as a frozen clip. The
  status bar's render rate and kernel state are drawn transparent (`DEMO_STYLE`), because
  their changing text would make every frame differ.
- **The size budgets hold while recording.** Clips are encoded at 200 kbit/s, which at the
  tooltip's 236 px looks the same as the 600 kbit/s the first clips had. That keeps 37 clips
  under the 2 MB total `demos.test.ts` asks for. A clip over 140 kB is encoded again at
  150 kbit/s, then 110 kbit/s, and the scene fails if it is still over. (Raising the CRF barely
  changed the size: VP8's rate control held the bitrate.) `demos.test.ts` keeps 150 kB a clip,
  and it checks that every tile of each tab whose batch is recorded (`WHOLE_TABS`) has a clip.

**The Modify part** (the second pull request) adds the twelve Modify tiles (Press Pull, Fillet,
Chamfer, Shell, Offset Face, Draft, Thread, Move, Mirror, Combine, Split Body, Scale) and
re-records Line, Rectangle, Circle and Dimension, so all 37 clips are in the current UI. Mirror's
and Split Body's blocks sit behind the XZ plane, which keeps the YZ plane's square in front of
them clickable. Draft and Scale type their value into the field (no handle to drag). The owner
saw an empty box in the Sketch Dimension tooltip on edge (R3-16). That box is the video's own
background (`bg-bg`, white in the light theme) before its first frame draws, so the clip hadn't
loaded; the file itself decodes. Edge can't be reached from the agent's machine. Locally the clip
loads and plays in its tooltip in a sketch, in the light theme, and `e2e/onboarding.spec.ts`
now checks that. Whether it plays on a fresh edge visit is for the owner to see after the deploy.

Rejected:
- Recording the whole work area and cropping it later: a pick or a handle is a few pixels
  at 236 px.
- Drawing each scene's setup on camera: it doubles every clip's length for what isn't the
  tool.
- Shortening long clips by speeding them up: a drag at double speed reads as a jump.

## Amendment (2026-10-15): a clip for every Construct, 3D Print and Sketch tile

The rest of R3-16: the batch the first one left for later, in three pull requests' worth of
slices (Construct, 3D Print, Sketch). The approach, sizes and checks are the Solid part's
(above): a 400 × 250 px frame round the action, a small design from `fixtures/demos/`, 200
kbit/s, still stretches cut to 400 ms, `WHOLE_TABS` in `demos.test.ts`.

- **Construct** (15 tiles: Offset Plane, Plane at Angle, Midplane, Tangent Plane, 3-Point Plane,
  Plane Along Path, Angled Midplane, 2-Point Axis, Cylinder Axis, Edge Axis, Point, Point on
  Path, Point at Intersection, and Inspect's Measure and Section Analysis). Each scene opens the
  tool on a visible body, picks in the view (`constructScene` in the recorder), drags the
  handle where the tool has one, commits with Enter and moves the pointer aside so a small
  result (a point) isn't under it. **A scene that picks planes keeps its bodies in front of the
  origin planes (x > 0, y < 0 in the home view)**: while a Plane field picks, the three origin
  planes' big squares show and take a click that would land on a face behind them. The point
  tools' results are a few pixels (the app draws a point small), so their scenes frame the body
  at 85 %.
- **3D Print** (Measure is Construct's clip; seven new: Place on Bed, Print Info, Tolerance,
  Overhang Analysis, Wall Thickness, Export, Send to Slicer). Place on Bed picks the wedge's
  sloping face and the body turns down. Overhang Analysis is recorded from below (Shift+3): an
  overhang faces down, so from above nothing shows; the cap's underside turns red. Wall
  Thickness shows two plates, the 0.6 mm one shaded. **Print Info, Tolerance and the two
  Export tiles live in a panel or a dialog, so their frames are a fixed region of the page**
  (`PANEL_FRAME`, the dialog's middle) with the model beside it, not a `frameWorld`: Print
  Info scrolls to its numbers and types an infill (the weight follows), Tolerance clicks the
  Normal preset. **Send to Slicer is the desktop app's tile**: the web build, which records the
  clips, leaves the tile unavailable (`platform.openInSlicer`), so its clip is the Export
  dialog the tile opens there, with 3MF ("for slicers") picked; the slicer buttons themselves
  are not in it. Re-record it from the desktop build if that ever matters.
- **Sketch** (19 new: Arc, Sketch Fillet, Trim, Offset, Parameters, the thirteen constraints
  and Export Sketch; Line, Rectangle, Circle and Dimension keep their clips, which pass the
  look check). A scene opens a new sketch on XY, zooms it (`sketchFrame`), draws what the
  tool works on with Ctrl held (inference off, so no constraint is added by the drawing) and
  then runs the tile and clicks the picks in sketch millimetres (`sketchScene`). Each
  constraint scene picks what its prompt asks for and the solver moves the geometry. Sketch
  Fillet takes its radius **before** the corner is picked (the box follows the pointer; typing
  after the pick changes nothing). Parameters and Export Sketch are dialogs, framed on their
  fields like the Export dialog. Tools in the tab's "more" menus (the other arcs, shapes,
  Extend, Break…) have no clip: the batch is the ribbon's tiles, the ones `WHOLE_TABS`
  checks.
- **The total budget goes from 2 MB to 4 MB** (`demos.test.ts`): 78 clips of about 45 kB (3.5 MB) don't
  fit 2 MB, and a clip loads only when its tooltip opens (not precached), so what a visitor
  fetches is one clip of at most 150 kB.
