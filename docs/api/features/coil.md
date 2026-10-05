---
title: Coil
type: coil
section: Features
category: create
order: 34
---

# Coil

`d.coil(inputs?, options?): FeatureHandle<'coil'>`

One feature of the timeline, in the **create** category. Its name follows
the app's (`Coil1`, then `Coil2`, …); `options.name` gives it
another, `options.id` its ID and `options.index` its place in the timeline. Inputs the
table calls optional keep the default it names, so a call with none of them still makes
a valid feature.

## Inputs

| Input | Type | Required or default | What it does |
| --- | --- | --- | --- |
| `plane` | `GeomRef \| GeomRef[]` (`plane`, `face`) | default `XY plane` | The plane or flat face it stands on. |
| `x` | `string \| number \| ParameterHandle` | default `0` | The axis's place along the plane frame's X; a length. |
| `y` | `string \| number \| ParameterHandle` | default `0` | The axis's place along the plane frame's Y; a length. |
| `offset` | `string \| number \| ParameterHandle` | default `0` | How far the coil starts off the plane along its normal; a length. |
| `type` | `'revolutions-height' \| 'revolutions-pitch' \| 'height-pitch'` | default `revolutions-height` | Whether the height or the pitch sets the number of turns. |
| `diameter` | `string \| number \| ParameterHandle` | default `20 mm` | The helix's diameter at the start, through the section's centre when the section is on the axis; a length. |
| `revolutions` | `string \| number \| ParameterHandle` | default `5` | How many turns; a plain number, fractions allowed. |
| `height` | `string \| number \| ParameterHandle` | default `20 mm` | Along the axis, start to end; a length. |
| `pitch` | `string \| number \| ParameterHandle` | default `4 mm` | Rise per turn; a length. |
| `taper` | `string \| number \| ParameterHandle` | optional | Half-angle of the cone it winds on; an angle. Positive widens it with height, the default 0° keeps it even. |
| `direction` | `'counter-clockwise' \| 'clockwise'` | default `counter-clockwise` | Which way round the axis it winds. |
| `section` | `'circle' \| 'square' \| 'triangle-out' \| 'triangle-in'` | default `circle` | The shape of the wire: circle, square or triangle. |
| `size` | `string \| number \| ParameterHandle` | default `2 mm` | The section's size: the circle's diameter, the square's side, the triangle's base; a length. |
| `position` | `'inside' \| 'on' \| 'outside'` | default `on` | The section on the helix, or on the axis. |
| `operation` | `'new-body' \| 'join' \| 'cut' \| 'intersect'` | default `new-body` | New body, join, cut or intersect. |
| `bodies` | `GeomRef \| GeomRef[]` (`body`) | optional | The bodies to join, cut or intersect; by default every body the coil touches (join) or overlaps (cut, intersect). |

## Faces

| Role | What it is |
| --- | --- |
| `cap:start` | The face the sweep starts at: the profile in its own place. |
| `cap:end` | The face the sweep ends at. |
| `side:<curve>` | A wall, one per edge of the profile: the sketch curve it came from, or the body edge it was swept from. |

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

// Coil.
d.coil({ diameter: '20 mm', revolutions: 3, height: '12 mm', section: 'square', size: '3 mm' });
```

## See also

- [Features by category](README.md)
- [Sketches](../sketch.md) — `d.sketch(plane, build)` and its builder
- [References](../references.md) — every helper that builds a reference