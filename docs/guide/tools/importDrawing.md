---
title: Import SVG/DXF
section: Tools
category: Home
order: 9
---

# Import SVG/DXF

Bring an SVG or DXF file into the sketch as ordinary curves.

| Where | Shortcut |
|---|---|
| Home › Import · Sketch › Create | None |

<!-- notes -->
## Step by step

1. Open a sketch and choose **Import SVG/DXF**. A file dialog asks for an
   `.svg` or `.dxf` file. Cancel it and nothing happens.
2. An **Import SVG/DXF** panel opens beside the view with the file's name and
   a line saying how many curves it holds. The drawing previews in the view,
   where it will land. If the file can't be used, the panel says why, a
   notification names the file, and **OK** stays disabled.
3. Set the **Units**, **Position** and **Scale** if the preview is the wrong
   size or in the wrong place.
4. Click **OK** or press `Ctrl+Enter`. The curves come in as one undo step,
   named "Import" and the file's name. A click in the view changes nothing.
5. `Esc` or **Cancel** closes the panel, adds nothing and ends the tool.

## Options

- **Units**: the unit the file's numbers are in. It starts at the unit the
  file declares and offers Millimetres, Centimetres, Metres, Inches, Feet
  and Pixels (96 to the inch). A file with no unit starts as Unitless.
  Another unit rescales the drawing.
- **Position**: **Drawing origin at sketch origin** (the default) or
  **Centred on sketch origin**, which puts the middle of the drawing's box on
  the origin.
- **Scale**: a number or an [expression](../parameters.md), 1 by default,
  multiplied into the size. **OK** is disabled at 0.
- **Fixed** (on by default): see below.
- The line under the options counts the curves, and what the file had that
  isn't a curve and was left out, for example "5 curves" or "312 curves ·
  skipped 4 texts, 1 image".

## What it keeps

- Lines, arcs, circles and whole ellipses come in as the same kind of curve.
  A Bezier curve, or a piece of an ellipse, comes in as a control point
  spline. Every curve has its own points.
- A zero-length line and a curve that repeats one already in the drawing are
  left out. Nothing in a drawing is construction geometry, and a text or
  image in the file is skipped, not converted.
- With **Fixed** on, each curve gets a **Fixed** constraint, so the solver
  treats the drawing as constants.
- With **Fixed** off, curves whose ends meet within a micron get a
  **Coincident** constraint. Nothing else is held.
- The tool adds no dimension. A drawing may hold up to 5,000 curves.

## Messages

- "Check the drawing in the panel, then OK. Esc cancels.": the prompt while
  the panel is open.
- "Open a sketch to import an SVG or DXF file into it.": you chose the tool outside a
  sketch. Open or create a sketch first.
- "No drawing loaded.": the panel has no drawing to count.
- "Extrudo imports SVG and DXF drawings.": the file's name doesn't end in
  `.svg` or `.dxf`.
- "This file isn't an SVG or DXF drawing Extrudo can read.": the file could
  not be read as a drawing. **OK** stays disabled.
- "This isn't an SVG file: it has no `<svg>` root element.": the file is XML
  but not an SVG drawing.
- "This file isn't an SVG file Extrudo can read: `<reason>`": the file is not
  valid XML; the reason replaces `<reason>`.
- "Binary DXF isn't supported: save it as ASCII DXF.": save the drawing again
  as an ASCII DXF and import that.
- "This drawing has 12,400 curves; Extrudo imports up to 5,000.": the drawing
  holds more than 5,000 curves (the first number is the file's own). Use a
  drawing with fewer curves.
- "This file couldn't be read: `<reason>`.": the file could not be opened as
  text; the reason replaces `<reason>`.
- "This drawing can't be imported.": the drawing could not be turned into
  curves with the panel's current settings.
<!-- /notes -->
