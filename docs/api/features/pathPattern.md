---
title: Path Pattern
type: pathPattern
section: Features
category: modify
order: 26
---

# Path Pattern

`d.pathPattern(inputs?, options?): FeatureHandle<'pathPattern'>`

One feature of the timeline, in the **modify** category. Its name follows
the app's (`Path Pattern1`, then `Path Pattern2`, …); `options.name` gives it
another, `options.id` its ID and `options.index` its place in the timeline. Inputs the
table calls optional keep the default it names, so a call with none of them still makes
a valid feature.

## Inputs

| Input | Type | Required or default | What it does |
| --- | --- | --- | --- |
| `objects` | `'bodies' \| 'features'` | default `bodies` | Copy bodies, or replay the tools of features. |
| `bodies` | `GeomRef \| GeomRef[]` (`body`) | optional | The bodies to copy, with objects: bodies. |
| `features` | `GeomRef \| GeomRef[]` (`feature`) | optional | The features whose tools are replayed, with objects: features. |
| `join` | `boolean` | default `false` | Fuse each copy into the original. |
| `path` | `GeomRef \| GeomRef[]` (`sketchEntity`, `edge`) | optional | The sketch curves and edges to follow, chained end to end. |
| `count` | `string \| number \| ParameterHandle` | default `3` | How many instances there are, the original included; a whole number of at least 1. |
| `distance` | `string \| number \| ParameterHandle` | default `20 mm` | The spacing along the path; a length. |
| `measure` | `'spacing' \| 'extent'` | default `spacing` | Whether distance is a spacing or the whole extent of the path. |
| `aligned` | `boolean` | default `false` | Turn each instance to the direction of the path. |
| `flip` | `boolean` | default `false` | Walk the path from its other end. |

## Faces

| Role | What it is |
| --- | --- |
| `<label>:from:(<face>)` | A face of a copy: the label is the instance's own (`2`, `m1`, `1x2`), so the face keeps its name as the count grows. |
| `from:(<face>)` | A face of a copy whose instance has no label of its own. |
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

// Path Pattern.
d.pathPattern({ objects: 'bodies', bodies: [body], path: line, count: 3 });
```

## See also

- [Features by category](README.md)
- [Sketches](../sketch.md) — `d.sketch(plane, build)` and its builder
- [References](../references.md) — every helper that builds a reference