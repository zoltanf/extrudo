---
title: Revolve
type: revolve
section: Features
category: create
order: 2
---

# Revolve

`d.revolve(inputs?, options?): FeatureHandle<'revolve'>`

One feature of the timeline, in the **create** category. Its name follows
the app's (`Revolve1`, then `Revolve2`, …); `options.name` gives it
another, `options.id` its ID and `options.index` its place in the timeline. Inputs the
table calls optional keep the default it names, so a call with none of them still makes
a valid feature.

## Inputs

| Input | Type | Required or default | What it does |
| --- | --- | --- | --- |
| `profiles` | `GeomRef \| GeomRef[]` (`profile`, `face`, `sketchEntity`) | optional | Profiles and flat faces to revolve, all in one plane. |
| `axis` | `GeomRef \| GeomRef[]` (`axis`, `sketchEntity`, `edge`) | optional | The axis to revolve about, which lies in the profiles' plane. |
| `direction` | `'one-side' \| 'symmetric' \| 'two-sides'` | default `one-side` | How the revolve goes round: one-side, symmetric or two-sides. |
| `extent` | `'angle' \| 'to-object'` | default `angle` | How far it turns: angle, or to-object (one side, until it first meets toObject). |
| `toObject` | `GeomRef \| GeomRef[]` (`face`, `body`, `plane`) | optional | The face (flat or curved), body or plane the revolve turns up to, where it first meets it; read only for to-object. |
| `angle` | `string \| number \| ParameterHandle` | default `360°, a full turn with no end faces` | Side 1's angle (the whole angle when symmetric); an angle. |
| `angle2` | `string \| number \| ParameterHandle` | default `0°` | Side 2's angle, the other way round; an angle. |
| `flip` | `boolean` | default `false` | Turn side 1 the other way round the axis. |
| `operation` | `'new-body' \| 'join' \| 'cut' \| 'intersect'` | default `new-body` | New body, join, cut or intersect. |
| `bodies` | `GeomRef \| GeomRef[]` (`body`) | optional | The bodies to join, cut or intersect; by default every body the revolve touches (join) or overlaps (cut, intersect). |

## Faces

| Role | What it is |
| --- | --- |
| `cap:start` | The face the sweep starts at: the profile in its own place. |
| `cap:end` | The face the sweep ends at. |
| `side:<curve>` | A wall, one per edge of the profile: the sketch curve it came from, or the body edge it was swept from. |

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

// Revolve.
d.revolve({ profiles: profile, axis: d.origin.y, angle: '90 deg' });
```

## See also

- [Features by category](README.md)
- [Sketches](../sketch.md) — `d.sketch(plane, build)` and its builder
- [References](../references.md) — every helper that builds a reference