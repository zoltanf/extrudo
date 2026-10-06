---
title: Plane Along Path
type: planeAlongPath
section: Features
category: construct
order: 22
---

# Plane Along Path

`d.planeAlongPath(inputs?, options?): FeatureHandle<'planeAlongPath'>`

One feature of the timeline, in the **construct** category. Its name follows
the app's (`Plane Along Path1`, then `Plane Along Path2`, …); `options.name` gives it
another, `options.id` its ID and `options.index` its place in the timeline. Inputs the
table calls optional keep the default it names, so a call with none of them still makes
a valid feature.

## Inputs

| Input | Type | Required or default | What it does |
| --- | --- | --- | --- |
| `path` | `GeomRef \| GeomRef[]` (`sketchEntity`, `edge`) | optional | The sketch curves and edges to follow, chained end to end. |
| `by` | `'position' \| 'length'` | default `position` | How the place along the path is measured: a fraction of it, or a length from its start. |
| `position` | `string \| number \| ParameterHandle` | optional | How far along the path, a fraction from 0 (its start) to 1 (its end). Default 0.5. |
| `distance` | `string \| number \| ParameterHandle` | optional | How far along the path, a length from its start. Only when By is Length. |
| `flip` | `boolean` | default `false` | Measure from the other end of the path. |

## Faces

This feature makes no face of its own, so `handle.face(role)` has no role to take.
Its result keeps the names of the bodies it worked on, so a reference to one of those
still resolves.

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

// Plane Along Path.
d.planeAlongPath({ path: line });
```

## See also

- [Features by category](README.md)
- [Sketches](../sketch.md) — `d.sketch(plane, build)` and its builder
- [References](../references.md) — every helper that builds a reference