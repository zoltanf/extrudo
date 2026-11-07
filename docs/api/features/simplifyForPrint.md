---
title: Simplify for Print
type: simplifyForPrint
section: Features
category: modify
order: 34
---

# Simplify for Print

`d.simplifyForPrint(inputs, options?): FeatureHandle<'simplifyForPrint'>`

One feature of the timeline, in the **modify** category. Its name follows
the app's (`Simplify for Print1`, then `Simplify for Print2`, …); `options.name` gives it
another, `options.id` its ID and `options.index` its place in the timeline. Inputs the
table calls optional keep the default it names, so a call with none of them still makes
a valid feature.

## Inputs

| Input | Type | Required or default | What it does |
| --- | --- | --- | --- |
| `bodies` | `GeomRef \| GeomRef[]` (`body`) | **required** | The solid bodies to simplify. |
| `rounds` | `boolean` | optional | Remove rounds (fillets: cylinder, torus and sphere faces in a smooth chain) up to maxRoundRadius; false keeps them and the limit. Absent: on while maxRoundRadius is given. |
| `maxRoundRadius` | `string \| number \| ParameterHandle` | optional | The largest round radius removed, in mm (a torus by its tube radius). Absent: no round is removed. |
| `holes` | `boolean` | optional | Remove holes (closed cylindrical walls and the faces they enclose) up to maxHoleDiameter; false keeps them and the limit. Absent: on while maxHoleDiameter is given. |
| `maxHoleDiameter` | `string \| number \| ParameterHandle` | optional | The largest hole diameter removed, in mm (a counterbored hole by its widest wall). Absent: no hole is removed. |

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

// Simplify for Print.
d.simplifyForPrint({ bodies: [body], maxRoundRadius: '1 mm', maxHoleDiameter: '3 mm' });
```

## See also

- [Features by category](README.md)
- [Sketches](../sketch.md) — `d.sketch(plane, build)` and its builder
- [References](../references.md) — every helper that builds a reference