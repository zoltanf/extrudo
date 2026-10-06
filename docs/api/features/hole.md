---
title: Hole
type: hole
section: Features
category: create
order: 31
---

# Hole

`d.hole(inputs?, options?): FeatureHandle<'hole'>`

One feature of the timeline, in the **create** category. Its name follows
the app's (`Hole1`, then `Hole2`, …); `options.name` gives it
another, `options.id` its ID and `options.index` its place in the timeline. Inputs the
table calls optional keep the default it names, so a call with none of them still makes
a valid feature.

## Inputs

| Input | Type | Required or default | What it does |
| --- | --- | --- | --- |
| `plane` | `GeomRef \| GeomRef[]` (`plane`, `face`) | default `XY plane` | Where the holes start: an origin plane, a construction plane or a flat face. |
| `points` | `GeomRef \| GeomRef[]` (`sketchEntity`) | optional | The sketch points to drill at. With none, the one hole is at x and y. |
| `x` | `string \| number \| ParameterHandle` | default `0` | The hole's place along the plane frame's X; a length. |
| `y` | `string \| number \| ParameterHandle` | default `0` | The hole's place along the plane frame's Y; a length. |
| `type` | `'simple' \| 'counterbore' \| 'countersink'` | default `simple` | Simple, counterbored or countersunk. |
| `extent` | `'blind' \| 'through'` | default `blind` | Blind or through. |
| `diameter` | `string \| number \| ParameterHandle` | default `5 mm` | The hole's diameter; a length. |
| `depth` | `string \| number \| ParameterHandle` | default `10 mm` | A blind hole's depth to the end of the full diameter; a length. |
| `tipAngle` | `string \| number \| ParameterHandle` | default `118°, 0° for a flat bottom` | The drill point's full angle; an angle. |
| `cbDiameter` | `string \| number \| ParameterHandle` | default `10 mm` | The counterbore's diameter; a length. |
| `cbDepth` | `string \| number \| ParameterHandle` | default `4 mm` | The counterbore's depth; a length. |
| `csDiameter` | `string \| number \| ParameterHandle` | default `10 mm` | The countersink cone's diameter at the surface; a length. |
| `csAngle` | `string \| number \| ParameterHandle` | default `90°` | The countersink cone's full angle; an angle. |
| `flip` | `boolean` | default `false` | Drill the other way, against a face's inward direction. |

## Faces

| Role | What it is |
| --- | --- |
| `cap:start` | The face the sweep starts at: the profile in its own place. |
| `cap:end` | The face the sweep ends at. |
| `side:<curve>` | A wall, one per edge of the profile: the sketch curve it came from, or the body edge it was swept from. |
| `side:<segment>` | One segment of the hole's own wall: `top` (where it opens), `wall`, `tip`, `floor`, `bottom`, `cbwall`, `cbfloor` or `cone`, prefixed with the sketch point's ID where the hole was placed at one. |

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

// Hole.
d.hole({ plane: d.origin.xy, x: '10 mm', y: '10 mm', diameter: '4 mm', extent: 'through' });
```

## See also

- [Features by category](README.md)
- [Sketches](../sketch.md) — `d.sketch(plane, build)` and its builder
- [References](../references.md) — every helper that builds a reference