---
title: Split Body
type: splitBody
section: Features
category: modify
order: 33
---

# Split Body

`d.splitBody(inputs, options?): FeatureHandle<'splitBody'>`

One feature of the timeline, in the **modify** category. Its name follows
the app's (`Split Body1`, then `Split Body2`, …); `options.name` gives it
another, `options.id` its ID and `options.index` its place in the timeline. Inputs the
table calls optional keep the default it names, so a call with none of them still makes
a valid feature.

## Inputs

| Input | Type | Required or default | What it does |
| --- | --- | --- | --- |
| `bodies` | `GeomRef \| GeomRef[]` (`body`) | **required** | The bodies to split. |
| `plane` | `GeomRef \| GeomRef[]` (`plane`, `face`) | **required** | The plane to split them on. |
| `keep` | `'both' \| 'above' \| 'below'` | default `both` | Keep both sides, the one above the plane or the one below. |

## Faces

| Role | What it is |
| --- | --- |
| `cut:above` | The face the plane cut on the part above it, facing down the normal. |
| `cut:below` | The face the plane cut on the part below it, facing up the normal. |

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

// Split Body.
d.splitBody({ bodies: [body], plane: d.origin.yz });
```

## See also

- [Features by category](README.md)
- [Sketches](../sketch.md) — `d.sketch(plane, build)` and its builder
- [References](../references.md) — every helper that builds a reference