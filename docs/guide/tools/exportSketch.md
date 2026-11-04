---
title: Export Sketch
section: Tools
category: Sketch
order: 116
---

# Export Sketch

Save the sketch or its profiles as SVG or DXF, at 1 unit = 1 mm.

| Where | Shortcut |
|---|---|
| Sketch › Export | None |

<video src="demo:exportSketch" muted loop autoplay playsinline aria-label="Export Sketch demo"></video>

<!-- notes -->
## Step by step

1. In an open sketch, click **Export Sketch** in the Sketch tab's Export
   group. It has no shortcut. The sketch's menu in the timeline or the browser
   has the same thing as **Export SVG or DXF…**.
2. The **Export sketch** dialog opens, headed with the sketch's name and "at
   1 unit = 1 mm."
3. Under **Format**, choose **SVG** (laser cutters, vinyl, slicers) or **DXF**
   (R12, for CAD and CNC).
4. Under **Contents**, choose what goes in the file. See Options.
5. The line under the choices says what the file will hold: the number of
   curves or profiles, then the width and height in mm. If there is nothing
   to export it says why, in red, and the export button is off.
6. Click **Export SVG** or **Export DXF**, or press Enter. The file is
   saved and the dialog closes. **Cancel**, the close button and `Esc` close
   it without saving.

The file is named `<project name> - <sketch name>` plus `.svg` or `.dxf`.
Characters a file name can't hold (such as `/`, `:` or `?`) become spaces.

## Options

- **All curves**: every line, circle, arc, ellipse, spline and text in the
  sketch, one shape each, on a layer named Sketch. Points are not drawn.
- **Include construction geometry** (with **All curves** only): adds the
  construction curves on a grey, dashed layer named Construction. Off by
  default.
- **All profiles**: each closed region as one filled shape with its holes,
  on a layer named Profiles.
- **Selected profile** or **Selected profiles (n)**: only the profiles you
  had selected in the sketch. This choice appears only when profiles are
  selected, and then it is the one the dialog starts on. Otherwise the dialog
  starts on **All curves**.

The SVG keeps curves exact: circles and arcs as arcs, an ellipse as an
elliptical arc, a spline as Bézier pieces. The DXF writes ellipses and
splines as fine polylines (within 0.002 mm). A text's letters are exported as
curves.

## What it keeps

- Nothing in the sketch changes: it is an export only, and not an undo step.
- Sketch coordinates are written as they are, in millimetres. The SVG
  says `mm` for its width and height, so other programs open it at its real
  size, and the DXF carries millimetre units.
- The SVG is flipped for you (SVG counts down, the sketch up), so it looks as
  in the sketch.
- The SVG carries the sketch's name as its title.

## Messages

- "This sketch has no curves to export.": **All curves** is chosen and the
  sketch has nothing to draw. Draw something, or tick **Include construction
  geometry** if there are only construction curves.
- "This sketch has no closed profiles. Close a shape to make one.": **All
  profiles** or **Selected profile** is chosen and no closed region is
  there. Close a shape, or choose **All curves**.
<!-- /notes -->
