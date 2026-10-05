---
title: Move
type: move
section: Features
category: modify
order: 21
---

# Move

`d.moveBodies(inputs, options?): FeatureHandle<'move'>`

One feature of the timeline, in the **modify** category. Its name follows
the app's (`Move1`, then `Move2`, …); `options.name` gives it
another, `options.id` its ID and `options.index` its place in the timeline. Inputs the
table calls optional keep the default it names, so a call with none of them still makes
a valid feature.

## Inputs

| Input | Type | Required or default | What it does |
| --- | --- | --- | --- |
| `bodies` | `GeomRef \| GeomRef[]` (`body`) | **required** | The bodies to move. |
| `mode` | `'free' \| 'rotate' \| 'point-to-point'` | default `free` | How they move: free, rotate or point-to-point. |
| `dx` | `string \| number \| ParameterHandle` | default `0` | How far along the world X axis; a length. |
| `dy` | `string \| number \| ParameterHandle` | default `0` | How far along the world Y axis; a length. |
| `dz` | `string \| number \| ParameterHandle` | default `0` | How far along the world Z axis; a length. |
| `rx` | `string \| number \| ParameterHandle` | default `0°` | Turn about the world X axis before the move; an angle. |
| `ry` | `string \| number \| ParameterHandle` | default `0°` | Turn about the world Y axis before the move; an angle. |
| `rz` | `string \| number \| ParameterHandle` | default `0°` | Turn about the world Z axis before the move; an angle. |
| `axis` | `GeomRef \| GeomRef[]` (`axis`, `sketchEntity`, `edge`) | optional | The axis to turn about, with mode: rotate. |
| `angle` | `string \| number \| ParameterHandle` | default `0°` | The angle about the axis, right-handed; an angle. |
| `from` | `GeomRef \| GeomRef[]` (`vertex`, `point`) | optional | Where the move starts, with mode: point-to-point. |
| `to` | `GeomRef \| GeomRef[]` (`vertex`, `point`) | optional | Where the move ends, with mode: point-to-point. |
| `copy` | `boolean` | default `false` | Keep the bodies and add moved copies. |

## Faces

| Role | What it is |
| --- | --- |
| `from:(<edge>)` | A face the operation generated from an edge: a round, a chamfer, or the seam a boolean leaves. |
| `new` | A face with no face of its own before, which nothing else names. |

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

// Move.
d.moveBodies({ bodies: [body], dx: '10 mm' });
```

## See also

- [Features by category](README.md)
- [Sketches](../sketch.md) — `d.sketch(plane, build)` and its builder
- [References](../references.md) — every helper that builds a reference