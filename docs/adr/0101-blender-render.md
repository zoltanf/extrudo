# ADR-0101: Rendering a picture of the design in Blender

- **Status:** Proposed, 2026-10-23 (owner asked for the feature and chose the
  shape: presets that hide Blender, materials per body, settings saved in the
  design, one button, the picture shown in the app).
- **Task:** P6-15, FR-3DP-08.
- **Builds on:** ADR-0062's P6-02 amendment (the slicer launch: detection per
  OS, a temp file, a detached program, `Platform.openInSlicer`), ADR-0075 (the
  Electron app, IPC channels, preferences main reads), ADR-0030 (bodies and
  their colour), ADR-0008's amendment (named views, `ViewCamera`), ADR-0034
  (model export, tessellation), ADR-0066 §3 (OBJ read), ADR-0087 §7 (text
  files bundled into main with `?raw`).
- **Schema change:** a new optional document section `render` (§4).

## Context

People design for 3D printing, and sometimes want a **presentable picture** of
the design: the pen holder on a wooden table, the bracket in a clean studio
shot, for a model site, a forum post or a gift. The viewport's screenshot is a
CAD view, not that. Blender renders such pictures well and is free, but most
of our users don't know it: setting up a scene, lights, materials, a camera
and a render is a skill of its own.

Blender can run **headless**: `blender -b` with a Python script does
everything without a window, imports OBJ, STL, PLY, glTF, FBX and USD out of
the box (not 3MF, not STEP), renders with Cycles (CPU everywhere, GPU where
there is one) or EEVEE, and writes a PNG. Progress goes to stdout
(`Fra:1 … | Sample 32/128`). Checked against Blender 5.2 LTS on 2026-10-23;
the operators used (`wm.obj_import`, `render.render`) exist since 4.2 LTS.

The browser can't start a program, so this is a desktop feature, like the
slicer launch.

## Decision

### 1. One button, presets, no Blender knowledge

A **Render Picture** tile in the 3D Print tab's Output group (desktop only;
the browser shows the "needs the desktop app" hint as Send to Slicer does)
opens the **Render dialog**:

- a **scene preset**: `studio` (white sweep, soft three-point light),
  `table` (a wooden table top, warm light from a window side), `workbench`
  (dark worktop, cooler light, a hint of grid), `outdoor` (ground plane under
  a sky with sun);
- a **finish per body**: `matte` (PLA matte), `glossy` (PLA/PETG gloss),
  `translucent` (clear PETG/resin), `resin` (smooth, slightly waxy), `metal`
  (brushed), `wood`. The **base colour is the body's own colour** (ADR-0030);
  a finish is only the surface, so a design needs nothing set to render;
- the **camera**: the current viewport camera (the default: the picture shows
  what the viewport shows; owner, 2026-10-23), automatic (framed from the
  bounding box, from the viewport's home direction), or a named view;
- the **picture size** (1280×720, 1920×1080, 2560×1440, 1080×1080) and
  **quality** (`draft`, `standard`, `high`);
- a status line about Blender (found with its version; missing, with an
  install link and the Settings › Desktop path field; too old).

**Render** writes the settings into the design (§4), hands the job to main,
shows a progress bar with Cancel, then the picture, with **Save PNG…** and
**Copy**. Nothing is stored but the settings: the picture is a file the person
saves, never part of the design.

### 2. Transport: OBJ + MTL, built in the renderer

The renderer tessellates the bodies as Export does (`meshBodies`, the
`standard` resolution), writes an **OBJ** with one `o` object per body and an
**MTL** with its colour (`packages/io`'s new `writeObj`, the counterpart of
`readObj`), and sends main the two texts plus the **job**: project name, the
objects (name, finish, colour), preset, camera, size, quality. OBJ is text,
unit-less (millimetres by Extrudo's convention, the script imports it at
`global_scale=0.001`, Z up, Y forward) and natively imported; 3MF would need
an add-on and STL has no objects or colours. The MTL colours make the OBJ
self-describing when someone keeps it, but the script takes the colours from
the job, with the finish.

### 3. Main: find Blender, build the scene in Python, render, hand back the PNG

`apps/desktop/src/main/blender.ts` is pure over an injected environment, like
`slicers.ts`: `findBlender` (the `blender.path` preference wins; then `PATH`,
Flatpak `org.blender.Blender`, Snap, Steam, the Windows `Blender Foundation`
folders newest first, `/Applications/Blender.app`), `blenderVersion`
(`blender --version`, **4.2 or newer** is required), `renderInBlender` (writes
`<temp>/extrudo-render/<job>/model.obj`, `model.mtl`, `job.json`, `render.py`
and runs `blender -b --factory-startup -noaudio --python render.py -- job.json
out.png`, detached from the window but awaited; progress parsed from stdout;
the PNG read back; the folder removed after; one render at a time; Cancel
kills the process). The renderer never sees a path, and main validates every
field of the job before writing anything (`blenderService.ts`, as
`slicerService.ts` does).

**The scenes and materials are built by `render.py` itself**, not loaded from
`.blend` files: a ground, lights, a world (sky or a gradient), procedural wood
for the table, Principled BSDF materials per finish with the body's colour.
`--factory-startup` keeps the person's add-ons and start-up file out of the
run (a failing add-on would fail every render); the script turns on Cycles'
GPU devices itself when there are any. `draft` renders with EEVEE (16
samples, Cycles 32 samples when EEVEE can't start without a display),
`standard` with Cycles at 128 samples and the denoiser, `high` with 512. The
script is one file, bundled into main as text (`?raw`, as the skill's files
are), so the installer carries no loose files.

### 4. The settings live in the design: `render`

A new optional document section, written by one command (`render.set`):

```json
"render": {
  "preset": "table",
  "finishes": { "extrude-1:0": "glossy" },
  "camera": { "kind": "auto" },
  "width": 1920, "height": 1080,
  "quality": "standard"
}
```

`finishes` holds only bodies the person changed from `matte`; entries of
bodies that no longer exist are harmless (as `bodies` entries are). `camera`
is `{ "kind": "auto" }`, `{ "kind": "current" }` (the viewport's camera at
render time) or `{ "kind": "view", "id": <ViewId> }`. The enums (`RENDER_PRESETS`,
`RENDER_FINISHES`, `RENDER_QUALITIES`) are `packages/core`'s, so the schema,
the dialog and main's validation share them. Rendering a second time with the
same settings writes nothing (no empty undo step).

### 5. Where the pieces live

| Piece | Where |
|---|---|
| OBJ/MTL writer | `packages/io/src/obj.ts` (`writeObj`), tests beside it |
| Enums, schema, command | `packages/core/src/render.ts`, `schema.ts` (`RenderSettingsSchema`, `render` on the document), `document-commands.ts` (`setRenderSettings`) |
| Platform seam | `apps/web/src/platform/render.ts` (`RenderJob`, `BlenderStatus`, `RenderResult`, `BlenderRenderer`), `Platform.render?` |
| Dialog and tile | `apps/web/src/render/RenderDialog.tsx`, `renderJob.ts`; tool `render` in `shell/tools.ts` |
| Main | `apps/desktop/src/main/blender.ts`, `blenderService.ts`, `apps/desktop/blender/render.py`; channels `render:status`, `render:start`, `render:cancel`, `render:progress` |
| Preference | `blender.path` (Settings › Desktop, next to the slicer paths) |
| Docs | `docs/guide/rendering.md`, `docs/desktop.md` "Rendering with Blender", `docs/file-format.md` §4 `render` |

## Rejected

- **Bundled `.blend` scene files** made in Blender. Nicer scenes with less
  code, but binary files in a public repository (every tweak a megabyte of
  diff), a coupling to the Blender version that saved them (a 5.x file in a
  4.2 install), and HDRI/texture assets with their own licences. Python-built
  scenes are reviewable text, work on every supported version, and a preset
  can still be replaced by a `.blend` later if the look needs it.
- **A path tracer in the app** (three.js's). Would work in the browser too,
  but a studio shot is as far as it goes: no scene presets of this quality,
  and a second renderer to maintain. Worth revisiting as a browser fallback.
- **glTF as the transport.** Carries materials, but needs a binary writer we
  don't have; the finish is applied by the script anyway.
- **Letting the person edit the scene in Blender** (open the `.blend` after
  the render). Not what the feature is for; the OBJ export is there for
  people who know Blender.
- **Storing the rendered picture in the design.** Megabytes per render in a
  file that is otherwise a few kilobytes; the person saves it where they want.

## Consequences

- Desktop only, Blender 4.2+ installed by the person; the app never
  downloads it. The dialog says what is missing.
- A render takes seconds (`draft`) to a few minutes (`high` on a CPU); the
  dialog shows progress and Cancel, and the app stays usable meanwhile.
- `--factory-startup` means no user add-ons: a scene can't use one, by design.
- A new schema key: `docs/file-format.md` documents `render`, and older
  readers drop it (the section is optional; `strictObject` rejects unknown
  keys inside it, so a future field is a new ADR amendment).
- `render.py` runs inside Blender under Blender's GPL, like the app itself.

## Amendment, 2026-10-24: an in-app renderer, and the engine choice (P6-16)

- **Status:** Proposed, 2026-10-24 (the owner asked for a fallback that works
  in the browser too, and chose the shape: three.js in the app with a path
  tracer for the slow qualities, the engine chosen in the dialog).
- **Task:** P6-16. **Schema change:** `render.engine` (§6.4).

### 6. The second engine: the app itself

§1–§5 need Blender on a desktop. Most people open Extrudo in a browser, and
many desktop users never install Blender. The app already has a WebGL
renderer (three.js through @react-three/fiber) and a BVH library
(three-mesh-bvh), so it can render the same four scenes and six finishes
itself, in the browser and the desktop app alike. Blender stays the better
picture: its materials, lights and denoiser are a cut above, so where it is
found the person chooses.

#### 6.1 Two engines, one dialog

`render.engine` is `app` (the default) or `blender`. The dialog gets a
**Render with** row above Scene: **In the app** and **Blender**. The row is
shown only where the platform has `render` (the desktop app); on the web the
app engine is the only one and the row is absent. With Blender missing or too
old, the Blender choice is disabled and §1's status line (install link,
Settings path) stands under the row. The rest of the dialog (scene, bodies,
camera, size, quality) is the same for both engines, so a design renders the
same picture, as far as each engine can, whichever is chosen.

The **Render Picture tile is ready everywhere**: the web build loses its
"needs the desktop app" hint (`tools.ts`: no `comesWith`, no `unavailable`).

#### 6.2 Draft: a plain three.js render; Standard and High: a path tracer

- **Draft** renders with three.js's rasteriser: `MeshPhysicalMaterial` per
  finish, PCF soft shadow maps from the key light, an environment map from
  three's `RoomEnvironment` through `PMREMGenerator` (no texture files),
  ACES filmic tone mapping. It takes well under two seconds at 1920×1080 on
  an integrated GPU, and is what the web e2e checks.
- **Standard and High** render with **three-gpu-pathtracer** (MIT,
  `WebGLPathTracer`, needs three ≥ 0.185 and three-mesh-bvh, both already in
  the app): physically based light transport in a WebGL2 fragment shader,
  progressive, one `renderSample()` per animation frame so the UI thread
  stays responsive; 128 samples for Standard and 512 for High (Blender's
  numbers, §3), 5 bounces, tiles so that one tile's GPU time stays under ~40 ms
  (measured with a fence after each tile, the next tile waiting for it, so
  work never piles up on the GPU the desktop shares). A denoise pass (owner, 2026-10-24) follows the output pass: the library's
  `DenoiseMaterial` (an edge-preserving blur, sigma 5, threshold 0.12) runs on the
  8-bit display values, so the threshold means a colour difference as seen. The
  library's default threshold, 0.03, is below Standard's grain and left it in place. Progress is
  `samples / target`; Cancel stops the loop. Translucent bodies use
  `transmission`, which the path tracer honours.
- The picture is rendered off screen into a `WebGLRenderTarget` of the
  requested size (a hidden canvas with its own `WebGLRenderer`, created on
  the first render, disposed with the dialog), read back with
  `readRenderTargetPixelsAsync`, flipped, drawn to a 2D canvas and encoded
  with `toBlob('image/png')` into the same `RenderResult` as Blender's. A
  size above the GPU's maximum render-target side is refused with a message
  naming the limit (the size list stays; `RENDER_MAX_SIDE` is Blender's).

#### 6.3 The scenes and finishes, again, in three.js

`apps/web/src/render/app/` holds the engine: `appRenderer.ts`
(`createAppRenderer(): PictureRenderer`), `scenes.ts` (the four presets built
from the model's bounding box exactly like `render.py`'s: the studio's
sweep from the same arc, the table's and workbench's slabs, the outdoor
ground under three's `Sky` baked to the environment, the same light
positions and strengths scaled to the model), `finishes.ts` (one material
per finish, the body's colour as the base colour, wood's grain and the
workbench's texture drawn to a `CanvasTexture` at runtime), `camera.ts`
(a `ViewCamera` in millimetres to a three camera; the automatic camera fits
the box corners like `fit_distance`), `pathTrace.ts` (§6.2's loop). No
`.blend`, no image files: everything is code, as §3 ruled for Python.

The renderer's job is the meshed bodies (`MeshedBodies`, the same
`RESOLUTIONS.medium` meshes the OBJ is written from), the preset, the
finishes, the camera, the size and the quality: `AppRenderJob` in
`apps/web/src/platform/render.ts` next to `RenderJob`, with the shared
`RenderProgress` and `RenderResult`; `PictureRenderer` is the common
interface (`render(job, onProgress)`, `cancel()`), which `BlenderRenderer`
extends with `status()`.

#### 6.4 The setting

`RenderSettingsSchema` gains `engine: z.enum(['app', 'blender']).optional()`
(absent means `app`); `docs/file-format.md` §4.9 documents it. A design
rendered with Blender on a desktop opens on the web with the row hidden and
the app engine used; the stored `blender` is kept until the person renders
there again.

### Rejected (the amendment)

- **A WebGPU path tracer**: not in Safari's stable channel for everyone yet
  and a second code path; three-gpu-pathtracer runs on WebGL2 everywhere
  the app does.
- **Rendering in a Web Worker with `OffscreenCanvas`**: the path tracer is
  progressive per frame, so the main thread stays responsive without it;
  a worker would double the three.js scene code.
- **A server-side render**: the app has no server and the model is private.
- **Dropping Blender**: it stays the better picture where it exists.

### Consequences (the amendment)

- The web build gets the feature for real, and the tile's hint goes.
- Standard and High depend on the GPU: minutes on an integrated one, a
  software renderer (CI, a VM) is far slower, so e2e renders a draft only.
- Standard is denoised and High is the cleanest; very fine detail can soften at
  Standard, and Blender stays the better picture.
- `three-gpu-pathtracer` is a new dependency (MIT, in the allow-list), listed
  in `NOTICE`.
