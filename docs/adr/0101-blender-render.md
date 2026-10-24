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
