---
title: Chamfer
type: chamfer
section: Features
category: modify
order: 4
---

# Chamfer

`d.chamfer(inputs?, options?): FeatureHandle<'chamfer'>`

One feature of the timeline, in the **modify** category. Its name follows
the app's (`Chamfer1`, then `Chamfer2`, …); `options.name` gives it
another, `options.id` its ID and `options.index` its place in the timeline. Inputs the
table calls optional keep the default it names, so a call with none of them still makes
a valid feature.

## Inputs

| Input | Type | Required or default | What it does |
| --- | --- | --- | --- |
| `edges` | `GeomRef \| GeomRef[]` (`edge`) | optional | Set 1's edges to chamfer. A set with no edges does nothing. |
| `mode` | `'equal' \| 'two-distances' \| 'distance-angle'` | default `equal` | Set 1's sizes: equal distance, two distances, or distance and angle. |
| `distance` | `string \| number \| ParameterHandle` | optional | Set 1's first distance, along the face that takes it; a length. |
| `distanceB` | `string \| number \| ParameterHandle` | optional | Set 1's second distance, with two-distances; a length. |
| `angle` | `string \| number \| ParameterHandle` | optional | Set 1's angle to the first distance, with distance-angle; an angle. |
| `flip` | `boolean` | default `false` | Set 1's first distance goes on the other face. |
| `edges2` | `GeomRef \| GeomRef[]` (`edge`) | optional | Set 2's edges to chamfer. A set with no edges does nothing. |
| `mode2` | `'equal' \| 'two-distances' \| 'distance-angle'` | default `equal` | Set 2's sizes: equal distance, two distances, or distance and angle. |
| `distance2` | `string \| number \| ParameterHandle` | optional | Set 2's first distance, along the face that takes it; a length. |
| `distanceB2` | `string \| number \| ParameterHandle` | optional | Set 2's second distance, with two-distances; a length. |
| `angle2` | `string \| number \| ParameterHandle` | optional | Set 2's angle to the first distance, with distance-angle; an angle. |
| `flip2` | `boolean` | default `false` | Set 2's first distance goes on the other face. |
| `edges3` | `GeomRef \| GeomRef[]` (`edge`) | optional | Set 3's edges to chamfer. A set with no edges does nothing. |
| `mode3` | `'equal' \| 'two-distances' \| 'distance-angle'` | default `equal` | Set 3's sizes: equal distance, two distances, or distance and angle. |
| `distance3` | `string \| number \| ParameterHandle` | optional | Set 3's first distance, along the face that takes it; a length. |
| `distanceB3` | `string \| number \| ParameterHandle` | optional | Set 3's second distance, with two-distances; a length. |
| `angle3` | `string \| number \| ParameterHandle` | optional | Set 3's angle to the first distance, with distance-angle; an angle. |
| `flip3` | `boolean` | default `false` | Set 3's first distance goes on the other face. |
| `edges4` | `GeomRef \| GeomRef[]` (`edge`) | optional | Set 4's edges to chamfer. A set with no edges does nothing. |
| `mode4` | `'equal' \| 'two-distances' \| 'distance-angle'` | default `equal` | Set 4's sizes: equal distance, two distances, or distance and angle. |
| `distance4` | `string \| number \| ParameterHandle` | optional | Set 4's first distance, along the face that takes it; a length. |
| `distanceB4` | `string \| number \| ParameterHandle` | optional | Set 4's second distance, with two-distances; a length. |
| `angle4` | `string \| number \| ParameterHandle` | optional | Set 4's angle to the first distance, with distance-angle; an angle. |
| `flip4` | `boolean` | default `false` | Set 4's first distance goes on the other face. |
| `edges5` | `GeomRef \| GeomRef[]` (`edge`) | optional | Set 5's edges to chamfer. A set with no edges does nothing. |
| `mode5` | `'equal' \| 'two-distances' \| 'distance-angle'` | default `equal` | Set 5's sizes: equal distance, two distances, or distance and angle. |
| `distance5` | `string \| number \| ParameterHandle` | optional | Set 5's first distance, along the face that takes it; a length. |
| `distanceB5` | `string \| number \| ParameterHandle` | optional | Set 5's second distance, with two-distances; a length. |
| `angle5` | `string \| number \| ParameterHandle` | optional | Set 5's angle to the first distance, with distance-angle; an angle. |
| `flip5` | `boolean` | default `false` | Set 5's first distance goes on the other face. |
| `edges6` | `GeomRef \| GeomRef[]` (`edge`) | optional | Set 6's edges to chamfer. A set with no edges does nothing. |
| `mode6` | `'equal' \| 'two-distances' \| 'distance-angle'` | default `equal` | Set 6's sizes: equal distance, two distances, or distance and angle. |
| `distance6` | `string \| number \| ParameterHandle` | optional | Set 6's first distance, along the face that takes it; a length. |
| `distanceB6` | `string \| number \| ParameterHandle` | optional | Set 6's second distance, with two-distances; a length. |
| `angle6` | `string \| number \| ParameterHandle` | optional | Set 6's angle to the first distance, with distance-angle; an angle. |
| `flip6` | `boolean` | default `false` | Set 6's first distance goes on the other face. |
| `edges7` | `GeomRef \| GeomRef[]` (`edge`) | optional | Set 7's edges to chamfer. A set with no edges does nothing. |
| `mode7` | `'equal' \| 'two-distances' \| 'distance-angle'` | default `equal` | Set 7's sizes: equal distance, two distances, or distance and angle. |
| `distance7` | `string \| number \| ParameterHandle` | optional | Set 7's first distance, along the face that takes it; a length. |
| `distanceB7` | `string \| number \| ParameterHandle` | optional | Set 7's second distance, with two-distances; a length. |
| `angle7` | `string \| number \| ParameterHandle` | optional | Set 7's angle to the first distance, with distance-angle; an angle. |
| `flip7` | `boolean` | default `false` | Set 7's first distance goes on the other face. |
| `edges8` | `GeomRef \| GeomRef[]` (`edge`) | optional | Set 8's edges to chamfer. A set with no edges does nothing. |
| `mode8` | `'equal' \| 'two-distances' \| 'distance-angle'` | default `equal` | Set 8's sizes: equal distance, two distances, or distance and angle. |
| `distance8` | `string \| number \| ParameterHandle` | optional | Set 8's first distance, along the face that takes it; a length. |
| `distanceB8` | `string \| number \| ParameterHandle` | optional | Set 8's second distance, with two-distances; a length. |
| `angle8` | `string \| number \| ParameterHandle` | optional | Set 8's angle to the first distance, with distance-angle; an angle. |
| `flip8` | `boolean` | default `false` | Set 8's first distance goes on the other face. |

## Faces

| Role | What it is |
| --- | --- |
| `from:(<edge>)` | The bevel: a face the chamfer makes from each edge it bevels. |

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

// Chamfer.
d.chamfer({ edges: edge, distance: '1 mm' });
```

## See also

- [Features by category](README.md)
- [Sketches](../sketch.md) — `d.sketch(plane, build)` and its builder
- [References](../references.md) — every helper that builds a reference