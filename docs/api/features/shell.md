---
title: Shell
type: shell
section: Features
category: modify
order: 5
---

# Shell

`d.shell(inputs, options?): FeatureHandle<'shell'>`

One feature of the timeline, in the **modify** category. Its name follows
the app's (`Shell1`, then `Shell2`, …); `options.name` gives it
another, `options.id` its ID and `options.index` its place in the timeline. Inputs the
table calls optional keep the default it names, so a call with none of them still makes
a valid feature.

## Inputs

| Input | Type | Required or default | What it does |
| --- | --- | --- | --- |
| `faces` | `GeomRef \| GeomRef[]` (`face`) | optional | The faces to remove (openings). Without any, the bodies are hollowed closed. |
| `bodies` | `GeomRef \| GeomRef[]` (`body`) | optional | The bodies to hollow closed, besides the bodies of the faces. |
| `thickness` | `string \| number \| ParameterHandle` | **required** | The wall thickness; a length. |
| `direction` | `'inside' \| 'outside'` | default `inside` | Hollow inside the bodies or outside them. |
| `wallFaces` | `GeomRef \| GeomRef[]` (`face`) | optional | Wall set 1's faces: their walls get the set's thickness instead of the shell's. A set with no faces does nothing. |
| `wallThickness` | `string \| number \| ParameterHandle` | optional | Wall set 1's wall thickness; a length, needed once the set has faces. |
| `wallFaces2` | `GeomRef \| GeomRef[]` (`face`) | optional | Wall set 2's faces: their walls get the set's thickness instead of the shell's. A set with no faces does nothing. |
| `wallThickness2` | `string \| number \| ParameterHandle` | optional | Wall set 2's wall thickness; a length, needed once the set has faces. |
| `wallFaces3` | `GeomRef \| GeomRef[]` (`face`) | optional | Wall set 3's faces: their walls get the set's thickness instead of the shell's. A set with no faces does nothing. |
| `wallThickness3` | `string \| number \| ParameterHandle` | optional | Wall set 3's wall thickness; a length, needed once the set has faces. |
| `wallFaces4` | `GeomRef \| GeomRef[]` (`face`) | optional | Wall set 4's faces: their walls get the set's thickness instead of the shell's. A set with no faces does nothing. |
| `wallThickness4` | `string \| number \| ParameterHandle` | optional | Wall set 4's wall thickness; a length, needed once the set has faces. |
| `wallFaces5` | `GeomRef \| GeomRef[]` (`face`) | optional | Wall set 5's faces: their walls get the set's thickness instead of the shell's. A set with no faces does nothing. |
| `wallThickness5` | `string \| number \| ParameterHandle` | optional | Wall set 5's wall thickness; a length, needed once the set has faces. |
| `wallFaces6` | `GeomRef \| GeomRef[]` (`face`) | optional | Wall set 6's faces: their walls get the set's thickness instead of the shell's. A set with no faces does nothing. |
| `wallThickness6` | `string \| number \| ParameterHandle` | optional | Wall set 6's wall thickness; a length, needed once the set has faces. |
| `wallFaces7` | `GeomRef \| GeomRef[]` (`face`) | optional | Wall set 7's faces: their walls get the set's thickness instead of the shell's. A set with no faces does nothing. |
| `wallThickness7` | `string \| number \| ParameterHandle` | optional | Wall set 7's wall thickness; a length, needed once the set has faces. |
| `wallFaces8` | `GeomRef \| GeomRef[]` (`face`) | optional | Wall set 8's faces: their walls get the set's thickness instead of the shell's. A set with no faces does nothing. |
| `wallThickness8` | `string \| number \| ParameterHandle` | optional | Wall set 8's wall thickness; a length, needed once the set has faces. |

## Faces

| Role | What it is |
| --- | --- |
| `inner:<face>` | The face of the wall itself, on the side away from the outer skin (an inside shell hollows in). |
| `rim:<face>` | The rim round an opening, between the removed face and the inner face. |
| `round:<face>` | The round on a face that meets the one removed at an angle. |
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

// Shell.
d.shell({ faces: face, thickness: '2 mm' });
```

## See also

- [Features by category](README.md)
- [Sketches](../sketch.md) — `d.sketch(plane, build)` and its builder
- [References](../references.md) — every helper that builds a reference