---
title: Fillet
type: fillet
section: Features
category: modify
order: 3
---

# Fillet

`d.fillet(inputs?, options?): FeatureHandle<'fillet'>`

One feature of the timeline, in the **modify** category. Its name follows
the app's (`Fillet1`, then `Fillet2`, …); `options.name` gives it
another, `options.id` its ID and `options.index` its place in the timeline. Inputs the
table calls optional keep the default it names, so a call with none of them still makes
a valid feature.

## Inputs

| Input | Type | Required or default | What it does |
| --- | --- | --- | --- |
| `edges` | `GeomRef \| GeomRef[]` (`edge`) | optional | Set 1's edges to round. A set with no edges does nothing. |
| `radius` | `string \| number \| ParameterHandle` | optional | Set 1's radius; a length. Radius 0 leaves the edges as they are. |
| `radiusEnd` | `string \| number \| ParameterHandle` | optional | Set 1's radius at the other end of each edge's tangent chain; a length. With one, the round tapers along the chain. |
| `swap` | `boolean` | default `false` | Set 1's radius runs from the chain's other end. |
| `edges2` | `GeomRef \| GeomRef[]` (`edge`) | optional | Set 2's edges to round. A set with no edges does nothing. |
| `radius2` | `string \| number \| ParameterHandle` | optional | Set 2's radius; a length. Radius 0 leaves the edges as they are. |
| `radiusEnd2` | `string \| number \| ParameterHandle` | optional | Set 2's radius at the other end of each edge's tangent chain; a length. With one, the round tapers along the chain. |
| `swap2` | `boolean` | default `false` | Set 2's radius runs from the chain's other end. |
| `edges3` | `GeomRef \| GeomRef[]` (`edge`) | optional | Set 3's edges to round. A set with no edges does nothing. |
| `radius3` | `string \| number \| ParameterHandle` | optional | Set 3's radius; a length. Radius 0 leaves the edges as they are. |
| `radiusEnd3` | `string \| number \| ParameterHandle` | optional | Set 3's radius at the other end of each edge's tangent chain; a length. With one, the round tapers along the chain. |
| `swap3` | `boolean` | default `false` | Set 3's radius runs from the chain's other end. |
| `edges4` | `GeomRef \| GeomRef[]` (`edge`) | optional | Set 4's edges to round. A set with no edges does nothing. |
| `radius4` | `string \| number \| ParameterHandle` | optional | Set 4's radius; a length. Radius 0 leaves the edges as they are. |
| `radiusEnd4` | `string \| number \| ParameterHandle` | optional | Set 4's radius at the other end of each edge's tangent chain; a length. With one, the round tapers along the chain. |
| `swap4` | `boolean` | default `false` | Set 4's radius runs from the chain's other end. |
| `edges5` | `GeomRef \| GeomRef[]` (`edge`) | optional | Set 5's edges to round. A set with no edges does nothing. |
| `radius5` | `string \| number \| ParameterHandle` | optional | Set 5's radius; a length. Radius 0 leaves the edges as they are. |
| `radiusEnd5` | `string \| number \| ParameterHandle` | optional | Set 5's radius at the other end of each edge's tangent chain; a length. With one, the round tapers along the chain. |
| `swap5` | `boolean` | default `false` | Set 5's radius runs from the chain's other end. |
| `edges6` | `GeomRef \| GeomRef[]` (`edge`) | optional | Set 6's edges to round. A set with no edges does nothing. |
| `radius6` | `string \| number \| ParameterHandle` | optional | Set 6's radius; a length. Radius 0 leaves the edges as they are. |
| `radiusEnd6` | `string \| number \| ParameterHandle` | optional | Set 6's radius at the other end of each edge's tangent chain; a length. With one, the round tapers along the chain. |
| `swap6` | `boolean` | default `false` | Set 6's radius runs from the chain's other end. |
| `edges7` | `GeomRef \| GeomRef[]` (`edge`) | optional | Set 7's edges to round. A set with no edges does nothing. |
| `radius7` | `string \| number \| ParameterHandle` | optional | Set 7's radius; a length. Radius 0 leaves the edges as they are. |
| `radiusEnd7` | `string \| number \| ParameterHandle` | optional | Set 7's radius at the other end of each edge's tangent chain; a length. With one, the round tapers along the chain. |
| `swap7` | `boolean` | default `false` | Set 7's radius runs from the chain's other end. |
| `edges8` | `GeomRef \| GeomRef[]` (`edge`) | optional | Set 8's edges to round. A set with no edges does nothing. |
| `radius8` | `string \| number \| ParameterHandle` | optional | Set 8's radius; a length. Radius 0 leaves the edges as they are. |
| `radiusEnd8` | `string \| number \| ParameterHandle` | optional | Set 8's radius at the other end of each edge's tangent chain; a length. With one, the round tapers along the chain. |
| `swap8` | `boolean` | default `false` | Set 8's radius runs from the chain's other end. |

## Faces

| Role | What it is |
| --- | --- |
| `from:(<edge>)` | The round: a face the fillet makes from each edge it rounds. |

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

// Fillet.
d.fillet({ edges: edge, radius: '2 mm' });
```

## See also

- [Features by category](README.md)
- [Sketches](../sketch.md) — `d.sketch(plane, build)` and its builder
- [References](../references.md) — every helper that builds a reference