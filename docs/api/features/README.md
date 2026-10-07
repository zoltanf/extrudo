---
title: Features
section: Features
order: 1
---

# Features

Every feature type Extrudo has, with its inputs, the faces it names and an
example call. The pages are generated from the same registry the API methods
are, so they cannot drift: `pnpm api:generate` rewrites both.

## Sketch

The sketches a solid is drawn on.

- [Sketch](sketch.md) — `d.sketch(plane, build)`

## Create

The solids, sweeps and cuts that make bodies.

- [Extrude](extrude.md) — `d.extrude(inputs?, options?)`
- [Revolve](revolve.md) — `d.revolve(inputs?, options?)`
- [Box](box.md) — `d.box(inputs?, options?)`
- [Cylinder](cylinder.md) — `d.cylinder(inputs?, options?)`
- [Sphere](sphere.md) — `d.sphere(inputs?, options?)`
- [Torus](torus.md) — `d.torus(inputs?, options?)`
- [Hole](hole.md) — `d.hole(inputs?, options?)`
- [Sweep](sweep.md) — `d.sweep(inputs?, options?)`
- [Loft](loft.md) — `d.loft(inputs?, options?)`
- [Coil](coil.md) — `d.coil(inputs?, options?)`
- [Emboss](emboss.md) — `d.emboss(inputs?, options?)`
- [Rib](rib.md) — `d.rib(inputs?, options?)`
- [Import](import.md) — `d.import(inputs, options?)`
- [Canvas](canvas.md) — `d.canvas(inputs, options?)`
- [Script](script.md) — `d.script(inputs, options?)`
- [Plugin feature](plugin.md) — `d.plugin(inputs, options?)`

## Modify

What changes the bodies a design already has.

- [Fillet](fillet.md) — `d.fillet(inputs?, options?)`
- [Chamfer](chamfer.md) — `d.chamfer(inputs?, options?)`
- [Shell](shell.md) — `d.shell(inputs, options?)`
- [Remove](remove.md) — `d.removeBodies(inputs, options?)`
- [Combine](combine.md) — `d.combine(inputs, options?)`
- [Move](move.md) — `d.moveBodies(inputs, options?)`
- [Mirror](mirror.md) — `d.mirror(inputs, options?)`
- [Place on Bed](placeOnBed.md) — `d.placeOnBed(inputs, options?)`
- [Rectangular Pattern](rectangularPattern.md) — `d.rectangularPattern(inputs?, options?)`
- [Circular Pattern](circularPattern.md) — `d.circularPattern(inputs?, options?)`
- [Path Pattern](pathPattern.md) — `d.pathPattern(inputs?, options?)`
- [Offset Face](offsetFace.md) — `d.offsetFace(inputs, options?)`
- [Split Body](splitBody.md) — `d.splitBody(inputs, options?)`
- [Scale](scale.md) — `d.scale(inputs, options?)`
- [Draft](draft.md) — `d.draft(inputs, options?)`
- [Thread](thread.md) — `d.thread(inputs, options?)`

## Construct

The planes, axes and points other features build on.

- [Offset Plane](offsetPlane.md) — `d.offsetPlane(inputs?, options?)`
- [Plane at Angle](planeAtAngle.md) — `d.planeAtAngle(inputs?, options?)`
- [Midplane](midplane.md) — `d.midplane(inputs?, options?)`
- [Plane Through 3 Points](planeThroughPoints.md) — `d.planeThroughPoints(inputs?, options?)`
- [Tangent Plane](tangentPlane.md) — `d.tangentPlane(inputs?, options?)`
- [Axis Through 2 Points](axisThroughPoints.md) — `d.axisThroughPoints(inputs?, options?)`
- [Axis Through Cylinder](axisThroughCylinder.md) — `d.axisThroughCylinder(inputs?, options?)`
- [Axis Along Edge](axisAlongEdge.md) — `d.axisAlongEdge(inputs?, options?)`
- [Point](constructionPoint.md) — `d.constructionPoint(inputs?, options?)`
- [Point on Path](pointOnPath.md) — `d.pointOnPath(inputs?, options?)`
- [Point at Intersection](pointAtIntersection.md) — `d.pointAtIntersection(inputs?, options?)`
- [Plane Along Path](planeAlongPath.md) — `d.planeAlongPath(inputs?, options?)`
- [Angled Midplane](midplaneAngled.md) — `d.midplaneAngled(inputs?, options?)`

## See also

- [The API in one page](../README.md)
- [Sketches](../sketch.md)
- [References](../references.md)
