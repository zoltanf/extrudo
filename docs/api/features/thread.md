---
title: Thread
type: thread
section: Features
category: modify
order: 39
---

# Thread

`d.thread(inputs, options?): FeatureHandle<'thread'>`

One feature of the timeline, in the **modify** category. Its name follows
the app's (`Thread1`, then `Thread2`, …); `options.name` gives it
another, `options.id` its ID and `options.index` its place in the timeline. Inputs the
table calls optional keep the default it names, so a call with none of them still makes
a valid feature.

## Inputs

| Input | Type | Required or default | What it does |
| --- | --- | --- | --- |
| `faces` | `GeomRef \| GeomRef[]` (`face`) | **required** | The cylindrical faces to thread, one thread each. |
| `diameter` | `string \| number \| ParameterHandle` | optional | The thread's nominal (major) diameter; a length. With pitch missing too, the ISO coarse thread that fits. |
| `pitch` | `string \| number \| ParameterHandle` | optional | Crest to crest along the axis; a length. |
| `extent` | `'full' \| 'length'` | default `full` | Thread the face to its end or to a length. |
| `length` | `string \| number \| ParameterHandle` | default `10 mm` | How far to thread, with extent: length; a length. |
| `offset` | `string \| number \| ParameterHandle` | default `0` | From the face's end to where the thread starts; a length. |
| `flip` | `boolean` | default `false` | Start from the face's other end. |
| `hand` | `'right' \| 'left'` | default `right` | Right- or left-handed. |
| `tolerance` | `string \| number \| ParameterHandle` | optional | Radial clearance on this part; a length. Default 0.1 mm. |
| `chamfer` | `boolean` | default `true` | A 45° lead-in at open ends. |

## Faces

| Role | What it is |
| --- | --- |
| `cap:start` | The face the sweep starts at: the profile in its own place. |
| `cap:end` | The face the sweep ends at. |
| `side:<curve>` | A wall, one per edge of the profile: the sketch curve it came from, or the body edge it was swept from. |
| `side:<piece>` | One piece of the thread: `root`, `crest`, `flank0`, `flank1`, `end0`, `end1` or `lead0`, `lead1`, prefixed with the face's place in the input (`f0`, `f1`, ...) and numbered per turn. |

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

// Thread.
d.thread({ faces: shaft.face('side:wall'), diameter: '20 mm' });
```

## See also

- [Features by category](README.md)
- [Sketches](../sketch.md) — `d.sketch(plane, build)` and its builder
- [References](../references.md) — every helper that builds a reference