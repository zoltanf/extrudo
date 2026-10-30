---
title: Settings
section: Guide
order: 9
---

# Settings

Open **Settings** from the Menu (four squares) in the top bar (Settings…), with **Ctrl+,**, from Ctrl+K
("Settings…") or from the Menu on the home screen. The dialog gathers your preferences in one
place. They belong to this browser or this computer, never to a design, so a design you send
someone doesn't carry them.

Everything in it is the same setting you can change where you work: the Menu's toggles, the
sketch palette, the Print Info panel and the Export dialog stay as they are, and a change in
either place shows in the other at once. A reload keeps them.

| Section | What is in it |
|---|---|
| **View and navigation** | The mouse buttons preset, projection, a 3D mouse and its speed, visual style, the grid |
| **Keyboard** | Every command's keys: change, add or remove them |
| **Marking menu** | The radial right-click menu on or off, and the command on each wedge of the ring (also Ctrl+K "Customize Marking Menu…") |
| **Sketch** | Snap to grid, auto-project edges and face outlines, what a sketch shows, Slice |
| **Appearance** | Theme (System, Dark, Light) |
| **3D printing** | Material densities, filament diameter, walls, line width, infill, price per kg |
| **Export** | The format and resolution the Export dialog starts with |
| **Desktop** | Slicer and Blender paths (desktop app only) |
| **Agents (MCP)** | Let AI agents read and change the open design (desktop app only) |
| **Plugins** | Install, enable and remove plugins (also Ctrl+K "Plugins…") |

## 3D mouse

A 3Dconnexion SpaceMouse or SpaceNavigator moves the view with your left hand while the right
one keeps the mouse. Click **Connect…** under **View and navigation** once and pick it; it
reconnects by itself after that. The model follows the cap: push it to pan, pull or push it
towards you to zoom, tip it to tilt, twist it to turn. The left button goes home, the right one
fits the model. **3D mouse speed** slows it down or speeds it up, from 0.25× to 4×;
double-click the slider for 1×. It needs Chrome, Edge or the desktop app (Firefox and Safari can't talk to the
device), and no driver.

## Material densities

PLA starts at 1.24 g/cm³, PETG 1.27, ABS 1.04 and TPU 1.21. Edit any of them in
**3D printing › Materials**: Print Info's weight then uses your number. A material you never
touched keeps following Extrudo's value; **Reset** next to a changed one (or **Reset 3D printing
to defaults** at the bottom) brings the built-in density back. The same density is the
**Density** field in the Print Info panel, so you can change it there instead.

Numbers are expressions, like everywhere else, and are plain numbers of their own unit: a density
is g/cm³ and a line width mm whatever your design's units are.

## What is not here

Document settings (units, precision) belong to the design: they are in the browser's **Document
settings** folder, and the home screen's New design card picks the unit of a new design. Keyboard
shortcuts can't be remapped yet. Panel sizes, the pinned commands in Search and the tutorial's progress are kept,
but are changed where they live.
