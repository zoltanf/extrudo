---
title: OpenSCAD export
section: Guide
order: 6.5
---

# OpenSCAD export

There are two ways in: **Export as Script › OpenSCAD** (with a preview of the code and a Copy
button) and **Export model › OpenSCAD**. Both write the same file.

**Export model › OpenSCAD** saves your design as a `.scad` file: code you can open in OpenSCAD,
read, edit and re-render. Where a feature has an OpenSCAD equivalent the file holds it as code;
where it has none, the file holds the shape as a mesh.

Choose the bodies as for any export. Hidden bodies are listed, and left out unless you tick them.
Imported mesh bodies are fine here: they become meshes in the file. The line under the options
says how many bodies the file holds. There is no meshing step, so Export is quick.

## What the file holds

- **A header comment** with the Extrudo version and the project name. It also lists every
  place where the file holds a mesh instead of code, and which feature made it.
- **`$fa` and `$fs`**, from the Resolution you chose. They set how finely OpenSCAD draws
  circles and spheres, and the same resolution sets the mesh of every polyhedron in the file.
- **The parameters** (see below).
- **One module per body version.** A body that goes through a Box, an Extrude and a Combine has
  a module for each step, named after the body (`Bracket_v1`, `Bracket_v2`…), each built from the
  one before. A tool that cuts several bodies is a module of its own.
- **Each exported body**, last, wrapped in `color()` with its colour, under a comment naming
  its component.

The same design and settings always give the same file, so it diffs and versions well.

## What becomes code

| In Extrudo | In the file |
|---|---|
| Box, Cylinder, Sphere, Torus | `cube`, `cylinder`, `sphere` and a `rotate_extrude`d circle, in every operation |
| Extrude of a sketch profile (and text) | `linear_extrude` of a `polygon`; a distance on every side; Through all for Cut and Intersect |
| Revolve of a sketch profile | `rotate_extrude`, for an axis in the profile's plane |
| Combine, Remove | `union`, `difference`, `intersection`; Remove writes nothing |
| Move, Scale, Mirror | `translate`, `rotate`, `scale`, `mirror`; copies stay |
| Rectangular and Circular Pattern | the copies, as repeated transforms |

## What becomes a polyhedron

Everything else is written as a `polyhedron` of the body's shape at that step: Fillet,
Chamfer, Shell, Loft, Sweep, Hole, Thread, Draft, Offset Face, Rib, Emboss, Coil, Split, Place on
Bed, scripts, plugins and imported meshes. OpenSCAD has no operation for these, so the file
stores the result at the resolution you chose. A few cases of the features above fall back too:
an Extrude from a face rather than a sketch, one tapered, or one that goes up to an object.

A polyhedron is not lost work: **later features build on it again as code.** A hole cut after a
fillet is still a live `difference()` in the file. A finer resolution makes a bigger, smoother
mesh, and a coarser one a smaller file.

## Parameters

Parameters the file's code uses become variables at the top, so you can change them in
OpenSCAD. Parameters with a Customizer group (see [Parameters](./parameters.md)) keep their
group and range in OpenSCAD's Customizer panel; the rest sit in a hidden section, each after
the ones it uses. Names OpenSCAD can't take get a trailing `_`.

**What follows a change:** sizes, distances, angles and scale factors (a Box's length, an
Extrude's distance, a Move's angle) are written as expressions over the parameters, so the
shape follows when you change one.

**What is held fixed:** sketch geometry (Extrudo's constraint solver placed it, and OpenSCAD
has none), placements (where a feature sits: its plane, axis or pivot), a pattern's count and
spacing, and every polyhedron. When a parameter also sets one of these, changing it in
OpenSCAD changes only the live parts, and a comment at the parameter names the features it
doesn't follow. A parameter that only fixed things use isn't written. To change those,
change the parameter in Extrudo and export again.

## From the command line

```sh
extrudo export box.extrudo --format scad --out box.scad
```

Without `--bodies` or `--component` it writes the shown bodies, as the dialog does.
`--resolution coarse|medium|fine` or a deflection in millimetres sets `$fa`, `$fs` and the
polyhedra's mesh. `extrudo export --help` lists the rest.
