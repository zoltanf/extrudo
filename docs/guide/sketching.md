---
title: Sketching and constraints
section: Guide
order: 2
---

# Sketching and constraints

Most designs start as a flat drawing. You draw it on a plane, tell Extrudo how the parts relate
(this line is horizontal, that circle is 8 mm wide), and the sketch holds its shape when a number
changes. Then you turn the closed regions into solids with [Extrude](./tools/extrude.md) or
[Revolve](./tools/revolve.md).

## Starting a sketch

Choose **Create Sketch** (Solid › Create). The view then waits for a plane: pick an origin plane
or a flat face of a body in the view, or use the **XY**, **XZ** and **YZ** buttons in the panel.
Construction planes you have made are listed there too. If a flat face is already selected when
you choose the tool, the sketch opens on it at once.

![The three origin planes, XY, XZ and YZ, with a flat face that accepts a sketch and a curved face that refuses one](./images/sketching/start-planes.figure.svg)

A sketch on a face moves with the face when the model changes. A curved face says "A sketch needs
a flat face or a plane".

To come back to a sketch later, double-click it in the browser or on the timeline, or right-click
it and choose **Edit Sketch**.

## Drawing

The Sketch tab's Create group has the tools you use most; the rest are under its ▾ menu. The ones
to know first:

- [Line](./tools/line.md) (`L`)
- [Rectangle](./tools/rectangle.md) (`R`) and its centre and three-point forms
- [Circle](./tools/circle.md) (`C`) and [Arc](./tools/arc.md) (`A`)
- [Polygon](./tools/polygon.md), [Slot](./tools/slot.md) and [Ellipse](./tools/ellipse.md)
- [Fit Point Spline](./tools/spline.md) and [Control Point Spline](./tools/splineControl.md)
- [Text](./tools/text.md) (`Shift+T`), whose letters become profiles like any other shape
- [Import Drawing](./tools/importDrawing.md), for an SVG or DXF file

While a tool runs you can type. Press a digit and the heads-up box beside the pointer takes it:
the length of a line, then `Tab` for its angle; the width of a rectangle, then `Tab` for its
height. Numbers are [expressions](./parameters.md), so `wall * 2` works. A typed length becomes a
dimension, so it stays editable.

**Modify** tools such as [Trim](./tools/trim.md) (`T`), [Offset](./tools/sketchOffset.md) (`O`),
[Sketch Fillet](./tools/sketchFillet.md) (`F`) and [Sketch Move](./tools/sketchMove.md) (`M`)
change what you drew; their constraints and dimensions come along.

```widget trim
Point at a piece, then click to trim it.
```

## Constraints you didn't ask for

As you draw, the pointer snaps to existing points, midpoints, crossings, curves, and the
horizontal or vertical line through the last point. A snap is also a constraint: end a line on
another line's end and the two points are **coincident**; start on a curve and the point is held
on it; keep a line exactly horizontal and it is **horizontal**. Draw a rectangle corner level with
the end of another level edge and the two edges are **collinear**; level with a lone point or a
circle centre, the two points are tied instead (one glyph halfway between them). A small glyph near
the pointer shows which snap you are on.

Hold `Ctrl` to draw without snapping. The grid snaps too, and **Snap to grid** in the sketch
palette turns that off.

## Constraint tools

Constraints are the rules that tie shapes together. The Sketch tab's Constraints group has one
button for each:

[Coincident](./tools/coincident.md), [Collinear](./tools/collinear.md),
[Concentric](./tools/concentric.md), [Midpoint](./tools/midpoint.md),
[Fix/Unfix](./tools/fix.md), [Parallel](./tools/parallel.md),
[Perpendicular](./tools/perpendicular.md), [Horizontal](./tools/horizontal.md),
[Vertical](./tools/vertical.md), [Tangent](./tools/tangent.md), [Smooth](./tools/smooth.md),
[Equal](./tools/equal.md) and [Symmetric](./tools/symmetric.md).

![Coincident: two ends apart, then meeting at one point](./images/sketching/constraint-coincident.figure.svg "Coincident: a point, then a point or a curve")

![Collinear: two segments at two heights, then on one line](./images/sketching/constraint-collinear.figure.svg "Collinear: two lines")

![Concentric: two circles offset, then sharing one centre](./images/sketching/constraint-concentric.figure.svg "Concentric: two circles or arcs")

![Midpoint: a point off a line, then on its middle](./images/sketching/constraint-midpoint.figure.svg "Midpoint: a point, then a line or an arc")

![Fix: a free line, then a fixed one held by the lock](./images/sketching/constraint-fix.figure.svg "Fix/Unfix: the thing to lock, or a fixed thing to free")

![Parallel: two lines at an angle, then parallel](./images/sketching/constraint-parallel.figure.svg "Parallel: two lines")

![Perpendicular: two lines, then at a right angle](./images/sketching/constraint-perpendicular.figure.svg "Perpendicular: two lines")

![Horizontal: a slanted line, then level](./images/sketching/constraint-horizontal.figure.svg "Horizontal: a line, or two points")

![Vertical: a slanted line, then upright](./images/sketching/constraint-vertical.figure.svg "Vertical: a line, or two points")

![Tangent: a line and a circle apart, then the line touching the circle](./images/sketching/constraint-tangent.figure.svg "Tangent: two curves, not two lines")

![Smooth: two curves meeting at a corner, then meeting smoothly](./images/sketching/constraint-smooth.figure.svg "Smooth: two curves, not two lines")

![Equal: two lines of different length, then equal, each marked with an equals sign](./images/sketching/constraint-equal.figure.svg "Equal: two lines, or two circles or arcs")

![Symmetric: two points either side of a construction line, uneven, then mirrored](./images/sketching/constraint-symmetric.figure.svg "Symmetric: two things, then the line to mirror about")

Pick a tool, then click the things it ties together. A small glyph appears on the sketch for each
constraint; click one and press `Delete` to remove it. **Show constraints** in the sketch
palette hides the glyphs when they get in the way.

If you ask for something the sketch can't do, the app says so and changes nothing: "Parallel
isn't needed: the sketch already holds it", or "Perpendicular would conflict with the sketch's
other constraints".

## Free, fixed, conflict

The colour of a curve tells you how much it can still move:

| Colour | Meaning |
|---|---|
| Blue | Free: the solver can still move it |
| White in the dark theme, black in the light one | Fixed: nothing can move it |
| Red | Conflict: it is part of an over-constrained set |
| Grey, dashed | Construction geometry |
| Purple | Projected from a body (see below) |

![A rectangle with some sides fixed and others free, and the sketch palette counting degrees of freedom](./images/sketching/constraints.png)

The counter at the bottom of the sketch palette says the same in numbers. A sketch has a number
of **degrees of freedom** (DOF): the independent ways its shapes could still move. "6 DOF left"
means six more constraints or dimensions would pin it down; **Fully constrained ✓** means nothing
can move. You don't have to reach zero. A free sketch is fine to extrude. Fully constrained is a
guarantee that a change to a dimension can't make the shape do something surprising.

You can also drag a free point or curve to see what moves. Press `Esc` during the drag to put it back.

```widget dof-playground
Switch constraints on and watch the colours and the DOF count.
```

## Dimensions

The [Dimension](./tools/dimension.md) tool (`D`) fixes a size. Click one thing or two: a line
gives its length, two lines their angle (or their distance, if parallel), a circle its diameter,
an arc its radius, two points their distance. Then click where the label should sit. For a length
or a distance between points, the label's place decides what is measured: above or below gives a
horizontal dimension, beside gives a vertical one, and anywhere else an aligned one.

A circle or an arc and then a line, a point or another circle gives the distance from its **edge**,
with no tangent line to draw. Click the circle on the half that faces the other thing for the near
edge, and on the other half for the far edge. To give the circle its diameter instead, click empty
space after picking it.

![A circle dimensioned to a line from its near edge and from its far edge](./images/sketching/circle-edge-distance.figure.svg)

The origin point and the X, Y and Z axes count as things to click, for dimensions and for the
constraint tools. A line and the Y axis give the line's distance from the axis; pick the axis
first for an angle to a line across it. A point and the origin give its distance from there. A line
and a parallel axis, or a point and an axis, are dimensioned at once, with no click to place the
label. Coincident puts a point on the origin or on an axis.

The axis or point you pick comes into the sketch as fixed construction geometry that follows it.
The projected datum isn't drawn: the axis you see is the datum itself. Construction axes and points
made before the sketch count as well, as long as they are shown and not suppressed. A datum you
hid in the browser can't be picked. An axis has no length or middle, so Equal, Midpoint and
Horizontal/Vertical refuse an axis line; the origin point works with all of them.

The new dimension is **driving**: it starts at the current size and from then on it holds the
shape to that value. The value opens for editing as soon as you place it. To change it later,
double-click the label and type a number or an [expression](./parameters.md). The box has a
**Driven** checkbox: tick it and the dimension only shows the measurement, in grey and brackets,
without holding anything.

Every driving dimension is a parameter named `d1`, `d2` and so on, and other fields can use it.
To give one a better name, type `name = value` in its editor, for example `width = 40 mm`. That
makes a [user parameter](./parameters.md) and sets the dimension to it, in one step.

Quicker: type only the new name. The list under the field offers **New parameter width = 40.00
mm**, with the value the dimension has now. With the list closed (Escape), a link under the
"Unknown name" message does the same, and so does Ctrl+Enter at any time. Either one fills in `width = 40` with the value selected: press Enter to keep it, or
type another value first.

```widget dimension-label
Drag the label: where it sits decides what it measures.
```

## Over-constraining

A dimension that repeats what the sketch already fixes would over-constrain it. The app stops and
opens a dialog titled **Over-constrained**: the dimension would over-constrain the sketch, and
would you like to add it as a driven one? Choose **Add as driven** to keep it as a measurement,
or cancel to drop it. A conflict that gets in some other way turns the geometry
red, and the counter says "Over-constrained: the red geometry has a constraint too many". Undo,
or delete one of the constraints involved.

![A rectangle with a width and two height dimensions; the repeated heights are red, and a strip says the sketch is over-constrained](./images/sketching/over-constrained.figure.svg)

## Construction geometry

Press `X` (or tick **Construction** in the palette) and what you draw next is construction
geometry: grey, dashed and never a profile. It is for lines you only want to measure from or
constrain to, such as a centreline or a circle that sets where bolt holes go. Press `X` again to
go back. To change a curve you already drew, select it and use the **Construction** checkbox in
the selection panel.

![A plate with a shaded profile and a dashed bolt circle, two centre lines and four holes on it, all construction geometry](./images/sketching/construction.figure.svg)

## Project and Intersect

[Project](./tools/project.md) (`P`) copies edges, faces, vertices or a whole body into the sketch.
Pick them in the view, or pick a body by its row in the browser. The projected curves are fixed,
you can constrain and dimension against them, and they follow the model: change the part
underneath and the sketch is updated, along with what is constrained to it.
[Intersect](./tools/intersect.md) (`Shift+P`) brings in the curves where a face or body cuts
through the sketch plane. With **Keep linked** off, the curves come in as ordinary entities that
no longer follow the model.

![Project copies a body's outline onto the sketch plane; Intersect brings in the section where a cylinder crosses the plane](./images/sketching/project-intersect.figure.svg)

**Auto-project** does that as you draw. With it on, a line's end that snaps to a body's edge or
corner projects that edge and ties the point to it. Near the middle of a flat face in the sketch
plane (the face the sketch is on, say) the pointer snaps to the face's centre, and the point
stays there when the face changes size. It is on by default, and a checkbox in the
sketch palette and in **Settings** turns it off. **Auto-project face outline** in **Settings**
also projects a flat face's outline when a sketch opens on it. In an open sketch on a face,
**Face outline** in the palette adds the face's outline now, or removes it again; while a
constraint or dimension uses the outline it stays, and the switch says why.

![Auto-project: a line ending on a body edge projects that edge, and the pointer near a face's centre snaps to it](./images/sketching/auto-project.figure.svg)

## Profiles

A closed loop of curves is a **profile**: the sketch shades it so you can see what an extrude
would pick. A circle inside a larger outline is a hole in that outline and a region in its own
right. **Show profiles** in the palette turns the shading off. Select a profile in the view and
the selection panel shows its area. Curves that don't close, and construction geometry, make no
profile.

## The sketch palette

While a sketch is open, the palette sits at the right of the view. It shows the sketch's name with
a **Look at** button, then one row per setting, each with an icon, a short caption and a switch.
**Construction** comes first. The **Grid** group has the grid and snapping, the **Show** group
what is drawn, and the **View & project** group the slice, Auto-project and the face outline.
Under them are the degrees-of-freedom counter and **Finish Sketch**. Rest the pointer on a row for
a second and a tooltip says what it does. Press `F1` over a row to open its section here.

```widget palette-switches
Flip a switch to see what it shows or hides.
```

### Look at

Turns the view square to the sketch plane. It is a button, not a switch.

### Construction

New curves become [construction geometry](#construction-geometry): they guide and constrain, but
make no profiles. Press `X` to switch it. Off by default.

### Sketch grid

Shows the grid on the sketch plane. On by default.

### Snap to grid

Points land on the grid while you draw. Hold `Ctrl` to draw without snapping. On by default.

### Show points

Shows the points at the ends and centres of curves. On by default.

### Show dimensions

Shows the sketch's [dimensions](#dimensions). On by default.

### Show constraints

Shows the constraint glyphs (parallel, tangent, …) beside the geometry. The
[constraints](#constraint-tools) still hold when they are hidden. On by default.

### Show profiles

Shades the closed regions a feature such as Extrude can use, and lets them be picked. See
[Profiles](#profiles). On by default.

### Slice

Cuts the bodies away on your side of the sketch plane, to see into the model. It lasts while the
sketch is open. Off by default.

### Auto-project

A body edge or vertex you snap to while drawing comes into the sketch, linked to the model. See
[Project and Intersect](#project-and-intersect). On by default.

### Face outline

Adds the outline of the face the sketch sits on, or removes it again. It is off until you switch it
on, and not available on a plane sketch. While a constraint or dimension uses the outline it
stays, and the switch says why. See [Project and Intersect](#project-and-intersect).

![A sketch open on a box face with Face outline off and nothing projected](./images/sketching/face-outline-1.figure.svg "Off: the sketch has only what you drew")

![The same sketch with Face outline on: the face's edges come in projected](./images/sketching/face-outline-2.figure.svg "On: the outline is added")

![A dimension refers to the outline, so the Face outline switch is locked and a tooltip says why](./images/sketching/face-outline-3.figure.svg "In use: the switch says why it stays")

## Finish Sketch

**Finish Sketch** (the green button in the palette) closes the sketch. Everything you did in it
is one undo step, so `Ctrl+Z` takes the whole session back. Extrude, Revolve and the other
features read the profiles from the finished sketch; once a feature uses one, the sketch hides
itself so it doesn't sit in front of the new faces. The browser's eye shows it again.
