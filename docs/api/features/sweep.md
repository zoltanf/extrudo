---
title: Sweep
type: sweep
section: Features
category: create
order: 36
---

# Sweep

`d.sweep(inputs?, options?): FeatureHandle<'sweep'>`

One feature of the timeline, in the **create** category. Its name follows
the app's (`Sweep1`, then `Sweep2`, …); `options.name` gives it
another, `options.id` its ID and `options.index` its place in the timeline. Inputs the
table calls optional keep the default it names, so a call with none of them still makes
a valid feature.

## Inputs

| Input | Type | Required or default | What it does |
| --- | --- | --- | --- |
| `profiles` | `GeomRef \| GeomRef[]` (`profile`, `face`) | optional | The profiles and flat faces to sweep along the path. They need not touch it. |
| `path` | `GeomRef \| GeomRef[]` (`sketchEntity`, `edge`) | optional | The sketch curves and edges to follow, chained end to end. |
| `orientation` | `'follow' \| 'fixed'` | default `follow` | How the profile turns along the path: follow it or hold it fixed. |
| `twist` | `string \| number \| ParameterHandle` | default `0°` | How far the profile turns about the path from start to end; an angle. |
| `scale` | `string \| number \| ParameterHandle` | default `1` | The profile's size at the path's end as a factor of its size at the start; a plain number. |
| `operation` | `'new-body' \| 'join' \| 'cut' \| 'intersect'` | default `new-body` | New body, join, cut or intersect. |
| `bodies` | `GeomRef \| GeomRef[]` (`body`) | optional | The bodies to join, cut or intersect; by default every body the sweep touches (join) or overlaps (cut, intersect). |

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

// Sweep.
d.sweep({ profiles: profile, path: line });
```

## See also

- [Features by category](README.md)
- [Sketches](../sketch.md) — `d.sketch(plane, build)` and its builder
- [References](../references.md) — every helper that builds a reference