---
title: Extrude
type: extrude
section: Features
category: create
order: 1
---

# Extrude

`d.extrude(inputs?, options?): FeatureHandle<'extrude'>`

One feature of the timeline, in the **create** category. Its name follows
the app's (`Extrude1`, then `Extrude2`, …); `options.name` gives it
another, `options.id` its ID and `options.index` its place in the timeline. Inputs the
table calls optional keep the default it names, so a call with none of them still makes
a valid feature.

## Inputs

| Input | Type | Required or default | What it does |
| --- | --- | --- | --- |
| `profiles` | `GeomRef \| GeomRef[]` (`profile`, `face`, `sketchEntity`) | optional | Profiles and flat faces to sweep, all in one plane. |
| `direction` | `'one-side' \| 'symmetric' \| 'two-sides'` | default `one-side` | How the sweep leaves the plane: one-side, symmetric or two-sides. |
| `extent` | `'distance' \| 'to-object' \| 'through-all'` | default `distance` | Side 1's extent: distance, to-object or through-all. |
| `distance` | `string \| number \| ParameterHandle` | optional | Side 1's length (the whole length when symmetric); a length. |
| `symmetricMeasure` | `'whole' \| 'half'` | default `whole; read only for symmetric` | How a symmetric extrude measures its distance: whole (the whole length) or half (the length of each side, twice that). |
| `toObject` | `GeomRef \| GeomRef[]` (`face`, `body`, `vertex`, `plane`) | optional | The face (flat or curved), body, vertex or plane side 1 stops at, where the sweep first meets it. |
| `offset` | `string \| number \| ParameterHandle` | default `0; read only for to-object` | How far past side 1's object the extrude ends, along the sweep; a length. Negative stops short. |
| `taper` | `string \| number \| ParameterHandle` | optional | Side 1's taper; an angle. Positive widens the sweep, the default 0° keeps the section's size. |
| `extent2` | `'distance' \| 'to-object' \| 'through-all'` | default `distance` | Side 2's extent, like side 1. |
| `distance2` | `string \| number \| ParameterHandle` | optional | Side 2's length; a length. |
| `toObject2` | `GeomRef \| GeomRef[]` (`face`, `body`, `vertex`, `plane`) | optional | The face, body, vertex or plane side 2 stops at. |
| `offset2` | `string \| number \| ParameterHandle` | default `0` | How far past side 2's object it ends; a length. |
| `taper2` | `string \| number \| ParameterHandle` | optional | Side 2's taper; an angle. |
| `flip` | `boolean` | default `false` | Sweep side 1 against the plane's normal. |
| `operation` | `'new-body' \| 'join' \| 'cut' \| 'intersect'` | default `new-body` | New body, join, cut or intersect. |
| `bodies` | `GeomRef \| GeomRef[]` (`body`) | optional | The bodies to join, cut or intersect; by default every body the extrude touches (join) or overlaps (cut, intersect). |

## Faces

| Role | What it is |
| --- | --- |
| `cap:start` | The face the sweep starts at: the profile in its own place. |
| `cap:end` | The face the sweep ends at. |
| `side:<curve>` | A wall, one per edge of the profile: the sketch curve it came from, or the body edge it was swept from. |
| `cap:plane` | The middle face of a two-sided tapered extrude: the plane the two sides meet in. |
| `side2:<curve>` | A wall of side 2, when both sides of a two-sided extrude are tapered. |
| `trim:<curve>` | The end where the sweep was trimmed to an object (To object). |

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

// Extrude.
d.extrude({ profiles: profile, distance: '10 mm' });
```

## See also

- [Features by category](README.md)
- [Sketches](../sketch.md) — `d.sketch(plane, build)` and its builder
- [References](../references.md) — every helper that builds a reference