---
title: Rendering a picture
section: Guide
order: 6.4
---

# Rendering a picture

The **Render Picture** tile sits in the 3D Print tab's Output group, in the browser and in the
desktop app. It renders a presentable picture of your design — on a wooden table, in a clean
studio, outdoors — the kind of picture for a model site, a forum post or a gift. You make the
choices in one dialog and get the picture.

Two engines can make it. **In the app**, Extrudo renders the picture itself, on your graphics
card. In the browser this is the only engine. In the desktop app the dialog's **Render with** row
offers **In the app** (the default) and **Blender**, free 3D software that is very good at such
pictures; Blender is greyed out unless the app finds it. You never open Blender yourself: the app
runs it in the background and hands you the picture. The choice is kept in the design. A design
rendered with Blender opens on the web with the app engine.

## What you need

- **In the app:** nothing beyond a graphics card WebGL2 can use. That is any current computer.
- **Blender**, only for the Blender engine, in the [desktop app](./desktop.md):
  [Blender 4.2 or newer](https://www.blender.org/download/), installed from blender.org. The app
  looks for it in the usual places: on your `PATH`, as a Flatpak or a snap, in Steam, and in the
  standard install folders of Windows, macOS and Linux.
- If the app doesn't find it, tell it where Blender is: **Settings › Desktop** has a **Blender
  path** field (leave it empty to search). Flatpak users enter `org.blender.Blender`.

On the desktop the dialog's first line says what was found ("Blender 4.5 found."), that the
Blender is too old, or that none was found, with a link to blender.org. Nothing is downloaded by
the app: Blender stays a program of yours.

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

**Size.** 1280 × 720, 1920 × 1080, 2560 × 1440 or 1080 × 1080 pixels. The app engine refuses a
size larger than your graphics card can render and names the card's limit; pick a smaller size.

**Quality.** Rough times; they grow with the picture size and depend on your computer.

*In the app:*

- **Draft** is one quick frame (seconds) with soft shadow maps.
- **Standard** (128 samples) and **High** (512) trace light paths on the graphics card. The
  picture refines on the progress bar, and Cancel stops it. A denoise pass then smooths the
  grain and keeps the edges, so the picture comes out clean. Very fine detail can soften a
  little at Standard; High keeps the most.
- On a mid-range graphics card at 1280 × 720, Standard takes 20 seconds to a minute (the studio's
  white sweep is the slowest) and High two to three minutes. Integrated graphics are far slower,
  and a computer without a graphics card (a virtual machine) is very slow.

*With Blender:* Draft (seconds, rough), Standard (a minute or two) or High (several minutes,
finest). Standard and High use Cycles with the denoiser, and speed up on a graphics card when
there is one. Draft uses Blender's fast EEVEE; where that can't run (no usable graphics card: a
virtual machine, a remote desktop) the app renders the draft with Cycles instead, a little
slower. Where you have Blender, its picture is the better one: its materials and its denoiser.

## Render, progress, the picture

**Render** saves the settings into the design first (one undo step, and only when they changed),
so the next render of that design starts from them. Then the app prepares the model ("Preparing
the model… 2/3") and shows the progress on a bar: **Starting…**, **Importing…**, **Rendering…
43 %**, **Saving…** (with Blender, **Starting Blender…** first). Once a render has run for a few
seconds, the line also says about how long is left ("Rendering… 43 % · about 2 min left"),
from how fast the bar has moved so far. A Draft render is over in seconds, and its bar doesn't
count.
**Cancel** stops a render; the dialog refuses to close while one runs — Cancel it first.
In the app, Standard and High render only while the app is on screen: in a browser tab you
switch away from, or a minimised window, the render waits and carries on when you come back.

When it is done the picture is shown in a wider dialog; click it to see it at its real size (scroll to look around, click again to fit it). Three buttons: **Save PNG…** saves it (the default
name is `<design> - <scene>.png`, e.g. `Pen holder - Wooden table.png`), **Copy** puts it on the
clipboard for pasting into a chat or forum post, and **Render again** returns to the form. The
picture itself is never stored in the design — it is a file you save where you want it.

## When it doesn't work

*Blender engine:*

- **"Blender isn't installed, or isn't where the app looks."** Install it from
  [blender.org](https://www.blender.org/download/), or set its path in Settings › Desktop.
- **"Blender 3.6 is too old: 4.2 or newer is needed."** A newer Blender from blender.org fixes
  it; the path field is where you point at it.
- **"Couldn't start Blender."** The path in Settings points at something that isn't Blender (or
  the program can't run). Fix it or clear the field to search again.
- **A render takes longer than you like.** Try **Draft** first to check the scene and framing,
  then Standard. High is for the final picture.
- **Translucent bodies look best in Standard or High.** Draft's EEVEE renders glass only roughly.
*In the app:*

- **A little speckle is left, or fine detail looks soft** (In the app, Standard; mostly in glass and
  its shadows). Use **High**, or Blender where you have it.
- **The render is very slow** (In the app). Try **Draft** first, or a smaller size; Standard and
  High need a real graphics card.
- **"This size is too large for this computer's graphics: up to 8192 × 8192."** The number is
  your card's limit. Pick a smaller size.
- **Translucent bodies come out darker in the app's Standard and High than in Blender.** Glass
  shadows what lies behind it in a path tracer.
- **"Nothing to render: every body is hidden."** Show at least one body in the browser.