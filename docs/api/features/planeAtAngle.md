---
title: Plane at Angle
type: planeAtAngle
section: Features
category: construct
order: 12
---

# Plane at Angle

`d.planeAtAngle(inputs?, options?): FeatureHandle<'planeAtAngle'>`

One feature of the timeline, in the **construct** category. Its name follows
the app's (`Plane at Angle1`, then `Plane at Angle2`, …); `options.name` gives it
another, `options.id` its ID and `options.index` its place in the timeline. Inputs the
table calls optional keep the default it names, so a call with none of them still makes
a valid feature.

## Inputs

| Input | Type | Required or default | What it does |
| --- | --- | --- | --- |
| `axis` | `GeomRef \| GeomRef[]` (`axis`, `edge`, `sketchEntity`) | optional | The line the plane turns about. |
| `plane` | `GeomRef \| GeomRef[]` (`plane`, `face`) | optional | The plane the angle counts from. Without one, 0 deg is the plane through the axis that is as horizontal as it can be. |
| `angle` | `string \| number \| ParameterHandle` | default `0 deg` | From that plane, right-handed about the axis; an angle. |

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

// Plane at Angle.
d.planeAtAngle({ plane: d.origin.xy, axis: d.origin.x, angle: '30 deg' });
```

## See also

- [Features by category](README.md)
- [Sketches](../sketch.md) — `d.sketch(plane, build)` and its builder
- [References](../references.md) — every helper that builds a reference