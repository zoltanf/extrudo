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
| `edges9` | `GeomRef \| GeomRef[]` (`edge`) | optional | Set 9's edges to round. A set with no edges does nothing. |
| `radius9` | `string \| number \| ParameterHandle` | optional | Set 9's radius; a length. Radius 0 leaves the edges as they are. |
| `radiusEnd9` | `string \| number \| ParameterHandle` | optional | Set 9's radius at the other end of each edge's tangent chain; a length. With one, the round tapers along the chain. |
| `swap9` | `boolean` | default `false` | Set 9's radius runs from the chain's other end. |
| `edges10` | `GeomRef \| GeomRef[]` (`edge`) | optional | Set 10's edges to round. A set with no edges does nothing. |
| `radius10` | `string \| number \| ParameterHandle` | optional | Set 10's radius; a length. Radius 0 leaves the edges as they are. |
| `radiusEnd10` | `string \| number \| ParameterHandle` | optional | Set 10's radius at the other end of each edge's tangent chain; a length. With one, the round tapers along the chain. |
| `swap10` | `boolean` | default `false` | Set 10's radius runs from the chain's other end. |
| `edges11` | `GeomRef \| GeomRef[]` (`edge`) | optional | Set 11's edges to round. A set with no edges does nothing. |
| `radius11` | `string \| number \| ParameterHandle` | optional | Set 11's radius; a length. Radius 0 leaves the edges as they are. |
| `radiusEnd11` | `string \| number \| ParameterHandle` | optional | Set 11's radius at the other end of each edge's tangent chain; a length. With one, the round tapers along the chain. |
| `swap11` | `boolean` | default `false` | Set 11's radius runs from the chain's other end. |
| `edges12` | `GeomRef \| GeomRef[]` (`edge`) | optional | Set 12's edges to round. A set with no edges does nothing. |
| `radius12` | `string \| number \| ParameterHandle` | optional | Set 12's radius; a length. Radius 0 leaves the edges as they are. |
| `radiusEnd12` | `string \| number \| ParameterHandle` | optional | Set 12's radius at the other end of each edge's tangent chain; a length. With one, the round tapers along the chain. |
| `swap12` | `boolean` | default `false` | Set 12's radius runs from the chain's other end. |
| `edges13` | `GeomRef \| GeomRef[]` (`edge`) | optional | Set 13's edges to round. A set with no edges does nothing. |
| `radius13` | `string \| number \| ParameterHandle` | optional | Set 13's radius; a length. Radius 0 leaves the edges as they are. |
| `radiusEnd13` | `string \| number \| ParameterHandle` | optional | Set 13's radius at the other end of each edge's tangent chain; a length. With one, the round tapers along the chain. |
| `swap13` | `boolean` | default `false` | Set 13's radius runs from the chain's other end. |
| `edges14` | `GeomRef \| GeomRef[]` (`edge`) | optional | Set 14's edges to round. A set with no edges does nothing. |
| `radius14` | `string \| number \| ParameterHandle` | optional | Set 14's radius; a length. Radius 0 leaves the edges as they are. |
| `radiusEnd14` | `string \| number \| ParameterHandle` | optional | Set 14's radius at the other end of each edge's tangent chain; a length. With one, the round tapers along the chain. |
| `swap14` | `boolean` | default `false` | Set 14's radius runs from the chain's other end. |
| `edges15` | `GeomRef \| GeomRef[]` (`edge`) | optional | Set 15's edges to round. A set with no edges does nothing. |
| `radius15` | `string \| number \| ParameterHandle` | optional | Set 15's radius; a length. Radius 0 leaves the edges as they are. |
| `radiusEnd15` | `string \| number \| ParameterHandle` | optional | Set 15's radius at the other end of each edge's tangent chain; a length. With one, the round tapers along the chain. |
| `swap15` | `boolean` | default `false` | Set 15's radius runs from the chain's other end. |
| `edges16` | `GeomRef \| GeomRef[]` (`edge`) | optional | Set 16's edges to round. A set with no edges does nothing. |
| `radius16` | `string \| number \| ParameterHandle` | optional | Set 16's radius; a length. Radius 0 leaves the edges as they are. |
| `radiusEnd16` | `string \| number \| ParameterHandle` | optional | Set 16's radius at the other end of each edge's tangent chain; a length. With one, the round tapers along the chain. |
| `swap16` | `boolean` | default `false` | Set 16's radius runs from the chain's other end. |
| `edges17` | `GeomRef \| GeomRef[]` (`edge`) | optional | Set 17's edges to round. A set with no edges does nothing. |
| `radius17` | `string \| number \| ParameterHandle` | optional | Set 17's radius; a length. Radius 0 leaves the edges as they are. |
| `radiusEnd17` | `string \| number \| ParameterHandle` | optional | Set 17's radius at the other end of each edge's tangent chain; a length. With one, the round tapers along the chain. |
| `swap17` | `boolean` | default `false` | Set 17's radius runs from the chain's other end. |
| `edges18` | `GeomRef \| GeomRef[]` (`edge`) | optional | Set 18's edges to round. A set with no edges does nothing. |
| `radius18` | `string \| number \| ParameterHandle` | optional | Set 18's radius; a length. Radius 0 leaves the edges as they are. |
| `radiusEnd18` | `string \| number \| ParameterHandle` | optional | Set 18's radius at the other end of each edge's tangent chain; a length. With one, the round tapers along the chain. |
| `swap18` | `boolean` | default `false` | Set 18's radius runs from the chain's other end. |
| `edges19` | `GeomRef \| GeomRef[]` (`edge`) | optional | Set 19's edges to round. A set with no edges does nothing. |
| `radius19` | `string \| number \| ParameterHandle` | optional | Set 19's radius; a length. Radius 0 leaves the edges as they are. |
| `radiusEnd19` | `string \| number \| ParameterHandle` | optional | Set 19's radius at the other end of each edge's tangent chain; a length. With one, the round tapers along the chain. |
| `swap19` | `boolean` | default `false` | Set 19's radius runs from the chain's other end. |
| `edges20` | `GeomRef \| GeomRef[]` (`edge`) | optional | Set 20's edges to round. A set with no edges does nothing. |
| `radius20` | `string \| number \| ParameterHandle` | optional | Set 20's radius; a length. Radius 0 leaves the edges as they are. |
| `radiusEnd20` | `string \| number \| ParameterHandle` | optional | Set 20's radius at the other end of each edge's tangent chain; a length. With one, the round tapers along the chain. |
| `swap20` | `boolean` | default `false` | Set 20's radius runs from the chain's other end. |
| `edges21` | `GeomRef \| GeomRef[]` (`edge`) | optional | Set 21's edges to round. A set with no edges does nothing. |
| `radius21` | `string \| number \| ParameterHandle` | optional | Set 21's radius; a length. Radius 0 leaves the edges as they are. |
| `radiusEnd21` | `string \| number \| ParameterHandle` | optional | Set 21's radius at the other end of each edge's tangent chain; a length. With one, the round tapers along the chain. |
| `swap21` | `boolean` | default `false` | Set 21's radius runs from the chain's other end. |
| `edges22` | `GeomRef \| GeomRef[]` (`edge`) | optional | Set 22's edges to round. A set with no edges does nothing. |
| `radius22` | `string \| number \| ParameterHandle` | optional | Set 22's radius; a length. Radius 0 leaves the edges as they are. |
| `radiusEnd22` | `string \| number \| ParameterHandle` | optional | Set 22's radius at the other end of each edge's tangent chain; a length. With one, the round tapers along the chain. |
| `swap22` | `boolean` | default `false` | Set 22's radius runs from the chain's other end. |
| `edges23` | `GeomRef \| GeomRef[]` (`edge`) | optional | Set 23's edges to round. A set with no edges does nothing. |
| `radius23` | `string \| number \| ParameterHandle` | optional | Set 23's radius; a length. Radius 0 leaves the edges as they are. |
| `radiusEnd23` | `string \| number \| ParameterHandle` | optional | Set 23's radius at the other end of each edge's tangent chain; a length. With one, the round tapers along the chain. |
| `swap23` | `boolean` | default `false` | Set 23's radius runs from the chain's other end. |
| `edges24` | `GeomRef \| GeomRef[]` (`edge`) | optional | Set 24's edges to round. A set with no edges does nothing. |
| `radius24` | `string \| number \| ParameterHandle` | optional | Set 24's radius; a length. Radius 0 leaves the edges as they are. |
| `radiusEnd24` | `string \| number \| ParameterHandle` | optional | Set 24's radius at the other end of each edge's tangent chain; a length. With one, the round tapers along the chain. |
| `swap24` | `boolean` | default `false` | Set 24's radius runs from the chain's other end. |
| `edges25` | `GeomRef \| GeomRef[]` (`edge`) | optional | Set 25's edges to round. A set with no edges does nothing. |
| `radius25` | `string \| number \| ParameterHandle` | optional | Set 25's radius; a length. Radius 0 leaves the edges as they are. |
| `radiusEnd25` | `string \| number \| ParameterHandle` | optional | Set 25's radius at the other end of each edge's tangent chain; a length. With one, the round tapers along the chain. |
| `swap25` | `boolean` | default `false` | Set 25's radius runs from the chain's other end. |
| `edges26` | `GeomRef \| GeomRef[]` (`edge`) | optional | Set 26's edges to round. A set with no edges does nothing. |
| `radius26` | `string \| number \| ParameterHandle` | optional | Set 26's radius; a length. Radius 0 leaves the edges as they are. |
| `radiusEnd26` | `string \| number \| ParameterHandle` | optional | Set 26's radius at the other end of each edge's tangent chain; a length. With one, the round tapers along the chain. |
| `swap26` | `boolean` | default `false` | Set 26's radius runs from the chain's other end. |
| `edges27` | `GeomRef \| GeomRef[]` (`edge`) | optional | Set 27's edges to round. A set with no edges does nothing. |
| `radius27` | `string \| number \| ParameterHandle` | optional | Set 27's radius; a length. Radius 0 leaves the edges as they are. |
| `radiusEnd27` | `string \| number \| ParameterHandle` | optional | Set 27's radius at the other end of each edge's tangent chain; a length. With one, the round tapers along the chain. |
| `swap27` | `boolean` | default `false` | Set 27's radius runs from the chain's other end. |
| `edges28` | `GeomRef \| GeomRef[]` (`edge`) | optional | Set 28's edges to round. A set with no edges does nothing. |
| `radius28` | `string \| number \| ParameterHandle` | optional | Set 28's radius; a length. Radius 0 leaves the edges as they are. |
| `radiusEnd28` | `string \| number \| ParameterHandle` | optional | Set 28's radius at the other end of each edge's tangent chain; a length. With one, the round tapers along the chain. |
| `swap28` | `boolean` | default `false` | Set 28's radius runs from the chain's other end. |
| `edges29` | `GeomRef \| GeomRef[]` (`edge`) | optional | Set 29's edges to round. A set with no edges does nothing. |
| `radius29` | `string \| number \| ParameterHandle` | optional | Set 29's radius; a length. Radius 0 leaves the edges as they are. |
| `radiusEnd29` | `string \| number \| ParameterHandle` | optional | Set 29's radius at the other end of each edge's tangent chain; a length. With one, the round tapers along the chain. |
| `swap29` | `boolean` | default `false` | Set 29's radius runs from the chain's other end. |
| `edges30` | `GeomRef \| GeomRef[]` (`edge`) | optional | Set 30's edges to round. A set with no edges does nothing. |
| `radius30` | `string \| number \| ParameterHandle` | optional | Set 30's radius; a length. Radius 0 leaves the edges as they are. |
| `radiusEnd30` | `string \| number \| ParameterHandle` | optional | Set 30's radius at the other end of each edge's tangent chain; a length. With one, the round tapers along the chain. |
| `swap30` | `boolean` | default `false` | Set 30's radius runs from the chain's other end. |
| `edges31` | `GeomRef \| GeomRef[]` (`edge`) | optional | Set 31's edges to round. A set with no edges does nothing. |
| `radius31` | `string \| number \| ParameterHandle` | optional | Set 31's radius; a length. Radius 0 leaves the edges as they are. |
| `radiusEnd31` | `string \| number \| ParameterHandle` | optional | Set 31's radius at the other end of each edge's tangent chain; a length. With one, the round tapers along the chain. |
| `swap31` | `boolean` | default `false` | Set 31's radius runs from the chain's other end. |
| `edges32` | `GeomRef \| GeomRef[]` (`edge`) | optional | Set 32's edges to round. A set with no edges does nothing. |
| `radius32` | `string \| number \| ParameterHandle` | optional | Set 32's radius; a length. Radius 0 leaves the edges as they are. |
| `radiusEnd32` | `string \| number \| ParameterHandle` | optional | Set 32's radius at the other end of each edge's tangent chain; a length. With one, the round tapers along the chain. |
| `swap32` | `boolean` | default `false` | Set 32's radius runs from the chain's other end. |

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