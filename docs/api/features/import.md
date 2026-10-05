---
title: Import
type: import
section: Features
category: create
order: 38
---

# Import

`d.import(inputs, options?): FeatureHandle<'import'>`

One feature of the timeline, in the **create** category. Its name follows
the app's (`Import1`, then `Import2`, …); `options.name` gives it
another, `options.id` its ID and `options.index` its place in the timeline. Inputs the
table calls optional keep the default it names, so a call with none of them still makes
a valid feature.

## Inputs

| Input | Type | Required or default | What it does |
| --- | --- | --- | --- |
| `file` | `string (an attachment ID)` | **required** | The file to import: an attachment of this design with a `model/*` media type or an OpenSCAD file (a STEP solid, a mesh, or a `.scad` file compiled to a mesh). |
| `units` | `'auto' \| 'mm' \| 'cm' \| 'm' \| 'in'` | default `auto` | Meshes only: what unit the file's numbers are in (`auto` takes a 3MF's own). STEP converts its own units. |
| `up` | `'z' \| 'y'` | default `z` | The file's up axis; `y` turns it +90° about X (Y-up to Z-up). |
| `scadName` | `string` | optional | OpenSCAD files only: override 1's variable, the name of a top-level variable of the file (`width`, `$fn`). Needs its value. |
| `scadValue` | `string \| number \| ParameterHandle` | optional | OpenSCAD files only: override 1's value, an expression (a plain number, or a length or an angle, which reach OpenSCAD in mm and degrees). Needs its variable. |
| `scadName2` | `string` | optional | OpenSCAD files only: override 2's variable, the name of a top-level variable of the file (`width`, `$fn`). Needs its value. |
| `scadValue2` | `string \| number \| ParameterHandle` | optional | OpenSCAD files only: override 2's value, an expression (a plain number, or a length or an angle, which reach OpenSCAD in mm and degrees). Needs its variable. |
| `scadName3` | `string` | optional | OpenSCAD files only: override 3's variable, the name of a top-level variable of the file (`width`, `$fn`). Needs its value. |
| `scadValue3` | `string \| number \| ParameterHandle` | optional | OpenSCAD files only: override 3's value, an expression (a plain number, or a length or an angle, which reach OpenSCAD in mm and degrees). Needs its variable. |
| `scadName4` | `string` | optional | OpenSCAD files only: override 4's variable, the name of a top-level variable of the file (`width`, `$fn`). Needs its value. |
| `scadValue4` | `string \| number \| ParameterHandle` | optional | OpenSCAD files only: override 4's value, an expression (a plain number, or a length or an angle, which reach OpenSCAD in mm and degrees). Needs its variable. |
| `scadName5` | `string` | optional | OpenSCAD files only: override 5's variable, the name of a top-level variable of the file (`width`, `$fn`). Needs its value. |
| `scadValue5` | `string \| number \| ParameterHandle` | optional | OpenSCAD files only: override 5's value, an expression (a plain number, or a length or an angle, which reach OpenSCAD in mm and degrees). Needs its variable. |
| `scadName6` | `string` | optional | OpenSCAD files only: override 6's variable, the name of a top-level variable of the file (`width`, `$fn`). Needs its value. |
| `scadValue6` | `string \| number \| ParameterHandle` | optional | OpenSCAD files only: override 6's value, an expression (a plain number, or a length or an angle, which reach OpenSCAD in mm and degrees). Needs its variable. |
| `scadName7` | `string` | optional | OpenSCAD files only: override 7's variable, the name of a top-level variable of the file (`width`, `$fn`). Needs its value. |
| `scadValue7` | `string \| number \| ParameterHandle` | optional | OpenSCAD files only: override 7's value, an expression (a plain number, or a length or an angle, which reach OpenSCAD in mm and degrees). Needs its variable. |
| `scadName8` | `string` | optional | OpenSCAD files only: override 8's variable, the name of a top-level variable of the file (`width`, `$fn`). Needs its value. |
| `scadValue8` | `string \| number \| ParameterHandle` | optional | OpenSCAD files only: override 8's value, an expression (a plain number, or a length or an angle, which reach OpenSCAD in mm and degrees). Needs its variable. |
| `scadName9` | `string` | optional | OpenSCAD files only: override 9's variable, the name of a top-level variable of the file (`width`, `$fn`). Needs its value. |
| `scadValue9` | `string \| number \| ParameterHandle` | optional | OpenSCAD files only: override 9's value, an expression (a plain number, or a length or an angle, which reach OpenSCAD in mm and degrees). Needs its variable. |
| `scadName10` | `string` | optional | OpenSCAD files only: override 10's variable, the name of a top-level variable of the file (`width`, `$fn`). Needs its value. |
| `scadValue10` | `string \| number \| ParameterHandle` | optional | OpenSCAD files only: override 10's value, an expression (a plain number, or a length or an angle, which reach OpenSCAD in mm and degrees). Needs its variable. |
| `scadName11` | `string` | optional | OpenSCAD files only: override 11's variable, the name of a top-level variable of the file (`width`, `$fn`). Needs its value. |
| `scadValue11` | `string \| number \| ParameterHandle` | optional | OpenSCAD files only: override 11's value, an expression (a plain number, or a length or an angle, which reach OpenSCAD in mm and degrees). Needs its variable. |
| `scadName12` | `string` | optional | OpenSCAD files only: override 12's variable, the name of a top-level variable of the file (`width`, `$fn`). Needs its value. |
| `scadValue12` | `string \| number \| ParameterHandle` | optional | OpenSCAD files only: override 12's value, an expression (a plain number, or a length or an angle, which reach OpenSCAD in mm and degrees). Needs its variable. |
| `scadName13` | `string` | optional | OpenSCAD files only: override 13's variable, the name of a top-level variable of the file (`width`, `$fn`). Needs its value. |
| `scadValue13` | `string \| number \| ParameterHandle` | optional | OpenSCAD files only: override 13's value, an expression (a plain number, or a length or an angle, which reach OpenSCAD in mm and degrees). Needs its variable. |
| `scadName14` | `string` | optional | OpenSCAD files only: override 14's variable, the name of a top-level variable of the file (`width`, `$fn`). Needs its value. |
| `scadValue14` | `string \| number \| ParameterHandle` | optional | OpenSCAD files only: override 14's value, an expression (a plain number, or a length or an angle, which reach OpenSCAD in mm and degrees). Needs its variable. |
| `scadName15` | `string` | optional | OpenSCAD files only: override 15's variable, the name of a top-level variable of the file (`width`, `$fn`). Needs its value. |
| `scadValue15` | `string \| number \| ParameterHandle` | optional | OpenSCAD files only: override 15's value, an expression (a plain number, or a length or an angle, which reach OpenSCAD in mm and degrees). Needs its variable. |
| `scadName16` | `string` | optional | OpenSCAD files only: override 16's variable, the name of a top-level variable of the file (`width`, `$fn`). Needs its value. |
| `scadValue16` | `string \| number \| ParameterHandle` | optional | OpenSCAD files only: override 16's value, an expression (a plain number, or a length or an angle, which reach OpenSCAD in mm and degrees). Needs its variable. |
| `scadName17` | `string` | optional | OpenSCAD files only: override 17's variable, the name of a top-level variable of the file (`width`, `$fn`). Needs its value. |
| `scadValue17` | `string \| number \| ParameterHandle` | optional | OpenSCAD files only: override 17's value, an expression (a plain number, or a length or an angle, which reach OpenSCAD in mm and degrees). Needs its variable. |
| `scadName18` | `string` | optional | OpenSCAD files only: override 18's variable, the name of a top-level variable of the file (`width`, `$fn`). Needs its value. |
| `scadValue18` | `string \| number \| ParameterHandle` | optional | OpenSCAD files only: override 18's value, an expression (a plain number, or a length or an angle, which reach OpenSCAD in mm and degrees). Needs its variable. |
| `scadName19` | `string` | optional | OpenSCAD files only: override 19's variable, the name of a top-level variable of the file (`width`, `$fn`). Needs its value. |
| `scadValue19` | `string \| number \| ParameterHandle` | optional | OpenSCAD files only: override 19's value, an expression (a plain number, or a length or an angle, which reach OpenSCAD in mm and degrees). Needs its variable. |
| `scadName20` | `string` | optional | OpenSCAD files only: override 20's variable, the name of a top-level variable of the file (`width`, `$fn`). Needs its value. |
| `scadValue20` | `string \| number \| ParameterHandle` | optional | OpenSCAD files only: override 20's value, an expression (a plain number, or a length or an angle, which reach OpenSCAD in mm and degrees). Needs its variable. |
| `scadName21` | `string` | optional | OpenSCAD files only: override 21's variable, the name of a top-level variable of the file (`width`, `$fn`). Needs its value. |
| `scadValue21` | `string \| number \| ParameterHandle` | optional | OpenSCAD files only: override 21's value, an expression (a plain number, or a length or an angle, which reach OpenSCAD in mm and degrees). Needs its variable. |
| `scadName22` | `string` | optional | OpenSCAD files only: override 22's variable, the name of a top-level variable of the file (`width`, `$fn`). Needs its value. |
| `scadValue22` | `string \| number \| ParameterHandle` | optional | OpenSCAD files only: override 22's value, an expression (a plain number, or a length or an angle, which reach OpenSCAD in mm and degrees). Needs its variable. |
| `scadName23` | `string` | optional | OpenSCAD files only: override 23's variable, the name of a top-level variable of the file (`width`, `$fn`). Needs its value. |
| `scadValue23` | `string \| number \| ParameterHandle` | optional | OpenSCAD files only: override 23's value, an expression (a plain number, or a length or an angle, which reach OpenSCAD in mm and degrees). Needs its variable. |
| `scadName24` | `string` | optional | OpenSCAD files only: override 24's variable, the name of a top-level variable of the file (`width`, `$fn`). Needs its value. |
| `scadValue24` | `string \| number \| ParameterHandle` | optional | OpenSCAD files only: override 24's value, an expression (a plain number, or a length or an angle, which reach OpenSCAD in mm and degrees). Needs its variable. |
| `scadName25` | `string` | optional | OpenSCAD files only: override 25's variable, the name of a top-level variable of the file (`width`, `$fn`). Needs its value. |
| `scadValue25` | `string \| number \| ParameterHandle` | optional | OpenSCAD files only: override 25's value, an expression (a plain number, or a length or an angle, which reach OpenSCAD in mm and degrees). Needs its variable. |
| `scadName26` | `string` | optional | OpenSCAD files only: override 26's variable, the name of a top-level variable of the file (`width`, `$fn`). Needs its value. |
| `scadValue26` | `string \| number \| ParameterHandle` | optional | OpenSCAD files only: override 26's value, an expression (a plain number, or a length or an angle, which reach OpenSCAD in mm and degrees). Needs its variable. |
| `scadName27` | `string` | optional | OpenSCAD files only: override 27's variable, the name of a top-level variable of the file (`width`, `$fn`). Needs its value. |
| `scadValue27` | `string \| number \| ParameterHandle` | optional | OpenSCAD files only: override 27's value, an expression (a plain number, or a length or an angle, which reach OpenSCAD in mm and degrees). Needs its variable. |
| `scadName28` | `string` | optional | OpenSCAD files only: override 28's variable, the name of a top-level variable of the file (`width`, `$fn`). Needs its value. |
| `scadValue28` | `string \| number \| ParameterHandle` | optional | OpenSCAD files only: override 28's value, an expression (a plain number, or a length or an angle, which reach OpenSCAD in mm and degrees). Needs its variable. |
| `scadName29` | `string` | optional | OpenSCAD files only: override 29's variable, the name of a top-level variable of the file (`width`, `$fn`). Needs its value. |
| `scadValue29` | `string \| number \| ParameterHandle` | optional | OpenSCAD files only: override 29's value, an expression (a plain number, or a length or an angle, which reach OpenSCAD in mm and degrees). Needs its variable. |
| `scadName30` | `string` | optional | OpenSCAD files only: override 30's variable, the name of a top-level variable of the file (`width`, `$fn`). Needs its value. |
| `scadValue30` | `string \| number \| ParameterHandle` | optional | OpenSCAD files only: override 30's value, an expression (a plain number, or a length or an angle, which reach OpenSCAD in mm and degrees). Needs its variable. |
| `scadName31` | `string` | optional | OpenSCAD files only: override 31's variable, the name of a top-level variable of the file (`width`, `$fn`). Needs its value. |
| `scadValue31` | `string \| number \| ParameterHandle` | optional | OpenSCAD files only: override 31's value, an expression (a plain number, or a length or an angle, which reach OpenSCAD in mm and degrees). Needs its variable. |
| `scadName32` | `string` | optional | OpenSCAD files only: override 32's variable, the name of a top-level variable of the file (`width`, `$fn`). Needs its value. |
| `scadValue32` | `string \| number \| ParameterHandle` | optional | OpenSCAD files only: override 32's value, an expression (a plain number, or a length or an angle, which reach OpenSCAD in mm and degrees). Needs its variable. |

## Faces

| Role | What it is |
| --- | --- |
| `face:<n>` | A face of the imported solid, in the order the file's B-rep has them. |
| `mesh` | A mesh body's one face: a mesh is a single face of triangles (ADR-0066 §3). |

`handle.face(role)` builds a reference to one of them and `handle.faceName(role)` its
persistent name.
A `<…>` is what varies: a `side:<sketch curve>` is the wall of the curve you pass,
and a role of a face that no face carries takes that part out.
A role this feature never names is a lost reference — a visible error, never a silent
guess.

## Example

```ts
import { Design, type LineHandle } from '@extrudo/api';

const d = Design.create({ name: 'My part' });

// Two solids to point faces, edges and bodies at.
const plate = d.box({ length: '40 mm', width: '20 mm', height: '10 mm' });
const shaft = d.cylinder({ diameter: '20 mm', height: '20 mm' });

// A sketch with two closed profiles, a hole and a guide line beside them.
let guide!: LineHandle;
const s = d.sketch(d.origin.xy, (k) => {
  k.rectangle([0, 0], [40, 20]);
  k.circle([10, 10], '3 mm');
  k.rectangle([50, 0], [60, 10]);
  guide = k.line([-5, 30], [45, 30]);
});

const profile = s.profileAt([1, 1]);
const sections = s.profiles();
const line = guide.ref();
const face = plate.face('side:front');
const edge = plate.edge([plate.faceName('side:front'), plate.faceName('side:right')]);
const vertex = plate.vertex([plate.faceName('side:front'), plate.faceName('side:right')]);
const corner = plate.vertex([plate.faceName('side:front'), plate.faceName('side:left')]);
const body = plate.body();
const step = 'att-part.step'; // an attachment of the design
const plan = 'att-plan.png';

// Import.
d.import({ file: step });
```

## See also

- [Features by category](README.md)
- [Sketches](../sketch.md) — `d.sketch(plane, build)` and its builder
- [References](../references.md) — every helper that builds a reference