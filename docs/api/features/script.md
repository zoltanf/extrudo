---
title: Script
type: script
section: Features
category: create
order: 40
---

# Script

`d.script(inputs, options?): FeatureHandle<'script'>`

One feature of the timeline, in the **create** category. Its name follows
the app's (`Script1`, then `Script2`, …); `options.name` gives it
another, `options.id` its ID and `options.index` its place in the timeline. Inputs the
table calls optional keep the default it names, so a call with none of them still makes
a valid feature.

## Inputs

| Input | Type | Required or default | What it does |
| --- | --- | --- | --- |
| `code` | `string` | **required** | The script's source: TypeScript or JavaScript that adds features through `design`, reading `params`. |
| `language` | `'ts' \| 'js'` | default `ts` | What the source is written in: `ts` (its types are stripped) or `js`. |

## Faces

A script names no face itself: each feature its code makes names its own, under
its own ID — the script's ID, a dot and the API's (`extrude:<script>.f1:cap:end`) —
and the roles its own page lists. The IDs are the same every run, so a feature after
the script can refer to the script's faces like any other's.

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

// Script.
d.script({ code: "for (let i = 0; i < 3; i++) design.cylinder({ diameter: '6 mm', height: '4 mm', x: i * 10 });" });
```

## See also

- [Features by category](README.md)
- [Sketches](../sketch.md) — `d.sketch(plane, build)` and its builder
- [References](../references.md) — every helper that builds a reference