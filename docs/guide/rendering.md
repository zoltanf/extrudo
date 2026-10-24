---
title: Rendering a picture
section: Guide
order: 6.4
---

# Rendering a picture

The **Render Picture** tile sits in the 3D Print tab's Output group (desktop app only). It renders
a presentable picture of your design — on a wooden table, in a clean studio, outdoors — the kind
of picture for a model site, a forum post or a gift. It does so with
[Blender](https://www.blender.org/download/), free 3D software that is very good at such pictures.
You never open Blender yourself: you make the choices in one dialog, and the app runs Blender in
the background and hands you the picture. In the browser the tile is greyed out, because a web
page cannot start programs — use the [desktop app](./desktop.md).

## What you need

- The desktop app.
- [Blender 4.2 or newer](https://www.blender.org/download/), installed from blender.org. The app
  looks for it in the usual places: on your `PATH`, as a Flatpak or a snap, in Steam, and in the
  standard install folders of Windows, macOS and Linux.
- If the app doesn't find it, tell it where Blender is: **Settings › Desktop** has a **Blender
  path** field (leave it empty to search). Flatpak users enter `org.blender.Blender`.

The dialog's first line says what was found ("Blender 4.5 found."), that the Blender is too old,
or that none was found, with a link to blender.org. Nothing is downloaded by the app: Blender
stays a program of yours.

## The dialog

**Scene.** The group holds the scene, the camera, the size and the quality; click its heading to fold it to one line that sums up the choices. Four scenes, each a little set built around your model:

- **Studio** — a white sweep and soft light: clean product shot.
- **Wooden table** — on a wooden table top, warm light from the side.
- **Workbench** — a dark worktop and cooler light.
- **Outdoor** — on the ground under a sunny sky.

**Bodies.** One **finish** for all the bodies you see in the browser; **Set per body…** opens
the list of bodies, each with its name, colour and its own finish, for the exceptions (the list
stays open while the finishes differ). Your body's own colour stays the base colour — a finish is
only the surface, so a design needs nothing set to render. The finishes:

- **Matte** — matte PLA.
- **Glossy** — glossy PLA or PETG.
- **Translucent** — clear PETG or resin, light passes through.
- **Resin** — smooth, slightly waxy.
- **Metal** — brushed metal.
- **Wood** — wood grain, tinted with the body colour.

Hidden bodies are not rendered.

**Camera.** **Current view** (the default) renders from the viewport's camera at the moment you
press Render: the picture shows what you see. **Automatic** frames the whole design to the
picture's edges, seen from the home direction (the `Shift+1` view). Or pick one of your saved
[named views](./getting-started.md) — each is a choice in the list, and the picture comes from
exactly that camera.

**Size.** 1280 × 720, 1920 × 1080, 2560 × 1440 or 1080 × 1080 pixels.

**Quality.** Draft (seconds, rough), Standard (a minute or two) or High (several minutes,
finest) — rough times; they grow with the picture size and depend on your computer. Standard and
High use Cycles with the denoiser, and speed up on a graphics card when there is one. Draft uses
Blender's fast EEVEE; where that can't run (no usable graphics card: a virtual machine, a remote
desktop) the app renders the draft with Cycles instead, a little slower.

## Render, progress, the picture

**Render** saves the settings into the design first (one undo step, and only when they changed),
so the next render of that design starts from them. Then the app prepares the model ("Preparing
the model… 2/3"), starts Blender and follows its progress: **Importing…**, **Rendering… 43 %**,
**Saving…**, on a progress bar (a Draft render is over in seconds, and its bar doesn't count).
**Cancel** stops a render; the dialog refuses to close while one runs — Cancel it first.

When it is done the picture is shown in a wider dialog; click it to see it at its real size (scroll to look around, click again to fit it). Three buttons: **Save PNG…** saves it (the default
name is `<design> - <scene>.png`, e.g. `Pen holder - Wooden table.png`), **Copy** puts it on the
clipboard for pasting into a chat or forum post, and **Render again** returns to the form. The
picture itself is never stored in the design — it is a file you save where you want it.

## When it doesn't work

- **"Blender isn't installed, or isn't where the app looks."** Install it from
  [blender.org](https://www.blender.org/download/), or set its path in Settings › Desktop.
- **"Blender 3.6 is too old: 4.2 or newer is needed."** A newer Blender from blender.org fixes
  it; the path field is where you point at it.
- **"Couldn't start Blender."** The path in Settings points at something that isn't Blender (or
  the program can't run). Fix it or clear the field to search again.
- **A render takes longer than you like.** Try **Draft** first to check the scene and framing,
  then Standard. High is for the final picture.
- **Translucent bodies look best in Standard or High.** Draft's EEVEE renders glass only roughly.
- **"Nothing to render: every body is hidden."** Show at least one body in the browser.