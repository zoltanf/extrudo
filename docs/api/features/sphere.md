---
title: Sphere
type: sphere
section: Features
category: create
order: 9
---

# Sphere

`d.sphere(inputs?, options?): FeatureHandle<'sphere'>`

One feature of the timeline, in the **create** category. Its name follows
the app's (`Sphere1`, then `Sphere2`, …); `options.name` gives it
another, `options.id` its ID and `options.index` its place in the timeline. Inputs the
table calls optional keep the default it names, so a call with none of them still makes
a valid feature.

## Inputs

| Input | Type | Required or default | What it does |
| --- | --- | --- | --- |
| `plane` | `GeomRef \| GeomRef[]` (`plane`, `face`) | default `XY plane` | The plane it sits on: an origin plane or a flat face. |
| `x` | `string \| number \| ParameterHandle` | default `0` | Its place along the plane frame's X; a length. |
| `y` | `string \| number \| ParameterHandle` | default `0` | Its place along the plane frame's Y; a length. |
| `offset` | `string \| number \| ParameterHandle` | default `0` | How far the base sits off the plane along its normal; a length. |
| `operation` | `'new-body' \| 'join' \| 'cut' \| 'intersect'` | default `new-body` | New body, join, cut or intersect. |
| `bodies` | `GeomRef \| GeomRef[]` (`body`) | optional | The bodies to join, cut or intersect; by default every body the primitive touches (join) or overlaps (cut, intersect). |
| `diameter` | `string \| number \| ParameterHandle` | default `20 mm` | Its diameter; a length. |

## Faces

| Role | What it is |
| --- | --- |
| `side:surface` | The whole surface, one face; the poles lie on the normal. |

`handle.face(role)` builds a reference to one of them and `handle.faceName(role)` its
persistent name.
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

// Sphere.
d.sphere({ diameter: '30 mm' });
```

## See also

- [Features by category](README.md)
- [Sketches](../sketch.md) — `d.sketch(plane, build)` and its builder
- [References](../references.md) — every helper that builds a reference