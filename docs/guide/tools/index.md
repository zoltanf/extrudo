---
title: Tools
section: Tools
order: 0
---

# Tools

Every tool in the toolbar, by tab. On a Mac, Ctrl is ⌘.

## Home

### Design

- [New Design](./newDesign.md) — Start a new, empty design.
- [Open File](./openFile.md) — Open an .extrudo file from disk: the design stays linked to that file.
- [Save As](./saveAs.md) — Save this design as an .extrudo file on disk and keep it linked to that file.
- [All Designs](./allDesigns.md) — Back to the home screen with every design in this browser.

### Versions

- [Save Version](./saveVersion.md) — Keep this state of the design with a description, to come back to later.
- [Version History](./versionHistory.md) — Saved versions of this design: save one, restore one, or open one as a copy.

### Files

- [Import .extrudo](./importProject.md) — Open an .extrudo file as a new design.
- [Import .f3d](./importFusion.md) — Open an Autodesk Fusion .f3d file as a new design: its parameters, sketches, extrudes, fillets and chamfers.
- [Import STEP, mesh or OpenSCAD](./importBody.md) — Bring in a STEP file, a mesh (STL, 3MF, OBJ) or an OpenSCAD file as bodies you can cut, combine and print.
- [Import Drawing](./importDrawing.md) — Bring an SVG or DXF drawing into the sketch as ordinary curves.
- [Canvas](./canvas.md) — Lay a picture on a plane as a reference to trace, and calibrate it to real scale.
- [Export .extrudo](./exportProject.md) — Download the whole design as an .extrudo file, with its versions and attachments.
- [Export](./export.md) — STL, 3MF or STEP for printing and sharing.
- [Export Design as Script](./exportScript.md) — Download the design as TypeScript that makes it again with the document API.
- [Save to Linked Folder](./saveToLinkedFolder.md) — Keep this design as an .extrudo file in the linked folder on disk.

### Parameters

- [Parameters](./parameters.md) — Named values and expressions that drive the model.
- [Customizer](./customizer.md) — The few parameters this design exposes, with sliders, and named configurations.

### Extend

- [Plugins](./plugins.md) — Install, enable and remove plugins: custom features and commands.

## Solid

### Create

- [Create Sketch](./sketch.md) — Draw a 2D profile on a plane or a flat face.
- [Extrude](./extrude.md) — Pull a profile into a solid, or push and pull a flat face.
- [Revolve](./revolve.md) — Spin a profile around an axis.
- [Sweep](./sweep.md) — Move profiles along a path of sketch curves or edges, with an optional twist and end scale.
- [Loft](./loft.md) — A solid through profiles on different planes, in order; a point can start or end it.
- [Coil](./coil.md) — A spring: a circle, square or triangle wound along a helix, from its turns, height and pitch.

### Primitives

- [Box](./box.md) — A box on a plane or a flat face, from its length, width and height.
- [Cylinder](./cylinder.md) — A cylinder on a plane or a flat face, from its diameter and height.
- [Sphere](./sphere.md) — A sphere centred on a plane or a flat face.
- [Torus](./torus.md) — A ring centred on a plane or a flat face, from its diameter and tube diameter.

### Features

- [Hole](./hole.md) — Simple, counterbored or countersunk holes, blind or through, at a click or at sketch points.
- [Emboss](./emboss.md) — Raise the letters of a sketch, or a whole text, off a face, or press them into it; round a cylinder or a cone they keep their width.
- [Rib](./rib.md) — A thin wall from a sketch line to the body.

### Pattern

- [Rectangular Pattern](./rectangularPattern.md) — Copies of bodies, or repeats of features, in a row or a grid.
- [Circular Pattern](./circularPattern.md) — Copies of bodies, or repeats of features, spread round an axis.
- [Path Pattern](./pathPattern.md) — Copies of bodies, or repeats of features, along sketch curves or edges.

### Program

- [Script](./script.md) — Make features with TypeScript or JavaScript, using the design’s parameters.
- [Record Macro](./recordMacro.md) — Start recording: what you make from here on becomes code you can keep as a Script.
- [Stop Macro](./stopMacro.md) — Stop recording and see the code for what you made.

## Modify

### Modify

- [Press Pull](./pressPull.md) — Push or pull what is selected: a face moves, an edge is rounded, a sketch profile is extruded.
- [Fillet](./fillet.md) — Round the selected edges.
- [Chamfer](./chamfer.md) — Bevel the selected edges.
- [Shell](./shell.md) — Hollow out a body, leaving walls.
- [Offset Face](./offsetFace.md) — Move faces along their normals; the faces next to them follow. A curved wall changes its radius.
- [Draft](./draft.md) — Tilt faces by a few degrees about a plane, so the part comes off the bed or out of a mould.
- [Thread](./thread.md) — A real, printable screw thread on a shaft or in a hole: ISO metric or inch, with a print clearance.

### Transform

- [Move/Copy](./move.md) — Move or turn bodies with the gizmo, about an axis or point to point. Copy keeps the original.
- [Mirror](./mirror.md) — Mirror bodies about a plane or a flat face, as copies or in place.
- [Combine](./combine.md) — Join, cut or intersect a target body with tool bodies.
- [Split Body](./splitBody.md) — Cut bodies in two along a plane or a flat face; each side becomes a body. Keep both or one.
- [Scale](./scale.md) — Make bodies larger or smaller about a point, by one factor or one per axis.

## Construct

### Planes

- [Offset Plane](./offsetPlane.md) — A plane parallel to a plane or a flat face, a distance away.
- [Plane at Angle](./planeAtAngle.md) — A plane turned about a line, at an angle from a reference plane.
- [Midplane](./midplane.md) — The plane halfway between two parallel planes or faces.
- [Tangent Plane](./tangentPlane.md) — A plane touching a cylindrical, conical or spherical face.
- [Plane Through 3 Points](./planeThroughPoints.md) — A plane through three points.
- [Plane Along Path](./planeAlongPath.md) — A plane square to a path at a point on it, for a sweep to draw its section on.
- [Angled Midplane](./midplaneAngled.md) — The plane that bisects two non-parallel planes or flat faces.

### Axes

- [Axis Through 2 Points](./axisThroughPoints.md) — A construction axis through two points, for revolves and patterns.
- [Axis Through Cylinder](./axisThroughCylinder.md) — The axis of a cylindrical, conical or toroidal face.
- [Axis Along Edge](./axisAlongEdge.md) — An axis along a straight edge or sketch line, or through a circular edge.

### Points

- [Point](./constructionPoint.md) — A construction point at a vertex, a circle center, a face center or coordinates.
- [Point on Path](./pointOnPath.md) — A point a fraction or a length along a path of sketch curves and edges.
- [Point at Intersection](./pointAtIntersection.md) — The point where two edges, an edge and a plane, or three planes meet.

## Inspect

### Inspect

- [Measure](./measure.md) — Distances, angles, areas and volumes. Pick one thing, or two to measure between.
- [Section Analysis](./section.md) — Cut the view through a plane, with the cut filled in. Look inside without changing the model.

## Sketch

### Create

- [Line](./line.md) — Lines from point to point. Type a length, Tab to the angle.
- [2-Point Rectangle](./rectangle.md) — From two opposite corners. Type the width, Tab to the height.
- [Center Diameter Circle](./circle.md) — From the center out to the rim. Type the diameter.
- [3-Point Arc](./arc.md) — Start, end, then a point it passes through.
- [Sketch Dimension](./dimension.md) — Lengths, radii and angles that drive the sketch.
- [3-Point Rectangle](./rectangle3.md) — One edge at any angle, then the height.
- [Center Rectangle](./rectangleCenter.md) — From the center out to a corner.
- [2-Point Circle](./circle2.md) — Across a diameter, from one side to the other.
- [3-Point Circle](./circle3.md) — Through three points on the rim.
- [Center Point Arc](./arcCenter.md) — The center, the start, then how far round.
- [Tangent Arc](./arcTangent.md) — Carries on smoothly from the end of a line or an arc.
- [Point](./point.md) — A sketch point, for construction and hole centers.
- [Inscribed Polygon](./polygon.md) — A regular polygon from its center out to a corner. Tab to the number of sides.
- [Circumscribed Polygon](./polygonCircumscribed.md) — A regular polygon sized across the flats, like a nut.
- [Edge Polygon](./polygonEdge.md) — A regular polygon built on one edge.
- [Center to Center Slot](./slot.md) — A slot from one arc center to the other, then the width.
- [Overall Slot](./slotOverall.md) — A slot from end to end, then the width.
- [Ellipse](./ellipse.md) — An ellipse from its center and two axes.
- [Fit Point Spline](./spline.md) — A smooth curve through the points you click. Enter to finish.
- [Control Point Spline](./splineControl.md) — A smooth curve guided by the points you click. Enter to finish.
- [Conic](./conic.md) — A conic from its two ends and the shoulder point. Rho sets how full it is.
- [Text](./text.md) — Type text on the sketch. Its letters are closed regions like any other profile.
- [Import Drawing](./importDrawing.md) — Bring an SVG or DXF drawing into the sketch as ordinary curves.
- [Project](./project.md) — Bring body edges, faces, vertices and bodies into the sketch; they follow the model.
- [Intersect](./intersect.md) — Bring in the curves where a face or body meets the sketch plane; they follow the model.
- [Mirror](./sketchMirror.md) — Mirror curves about a line; the copies stay symmetric.
- [Rectangular Pattern](./sketchRectangularPattern.md) — Copies in rows and columns. Type the counts and spacing.
- [Circular Pattern](./sketchCircularPattern.md) — Copies around a center. Type the count and the angle.

### Modify

- [Sketch Fillet](./sketchFillet.md) — Round the corner between two lines. Type the radius.
- [Trim](./trim.md) — Cut curves back to where they cross.
- [Offset](./sketchOffset.md) — Copy a chain of curves at a distance. Type the distance.
- [Parameters](./parameters.md) — Named values and expressions that drive the model.
- [Sketch Chamfer](./sketchChamfer.md) — Cut the corner between two lines. Type the distance.
- [Extend](./extend.md) — Lengthen a line or an arc to the next curve.
- [Break](./break.md) — Split a curve where other curves cross it.
- [Move](./sketchMove.md) — Move curves from one point to another; constraints come along.
- [Copy](./sketchCopy.md) — Copy curves from one point to another, as often as you click.
- [Sketch Scale](./sketchScale.md) — Scale curves about a point, with their dimensions.

### Constraints

- [Coincident](./coincident.md) — Join two points, or put a point on a curve.
- [Collinear](./collinear.md) — Put two lines on one straight line.
- [Concentric](./concentric.md) — Give circles and arcs the same center.
- [Midpoint](./midpoint.md) — Put a point at the middle of a line or an arc.
- [Fix/Unfix](./fix.md) — Lock something in place, or free it again.
- [Parallel](./parallel.md) — Make lines parallel.
- [Perpendicular](./perpendicular.md) — Make two lines meet at a right angle.
- [Horizontal](./horizontal.md) — Make a line horizontal, or line up two points.
- [Vertical](./vertical.md) — Make a line vertical, or line up two points.
- [Tangent](./tangent.md) — Make a curve touch another without a corner.
- [Smooth](./smooth.md) — Join curves with no jump in curvature (G2).
- [Equal](./equal.md) — Give lines the same length, or circles the same radius.
- [Symmetric](./symmetric.md) — Mirror two things about a line.

### Export

- [Export Sketch](./exportSketch.md) — Save the sketch or its profiles as SVG or DXF, at 1 unit = 1 mm.

## 3D Print

### Prepare

- [Place on Bed](./placeOnBed.md) — Turn a flat face down onto the print bed: the body turns with it.
- [Measure](./measure.md) — Distances, angles, areas and volumes. Pick one thing, or two to measure between.
- [Print Info](./printInfo.md) — Volume, weight and filament length for PLA, PETG, ABS, TPU or your own density.
- [Tolerance](./tolerance.md) — How much room a printed fit gets: hole presets and threads add it to their sizes.
- [Overhang Analysis](./overhang.md) — Shade the faces that lean out more than an angle: they need support to print.
- [Wall Thickness](./wallThickness.md) — Shade the walls thinner than a minimum: they print weak or not at all.

### Output

- [Export](./export.md) — STL, 3MF or STEP for printing and sharing.
