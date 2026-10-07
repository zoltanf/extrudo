---
title: Plugin feature
type: plugin
section: Features
category: create
order: 45
---

# Plugin feature

`d.plugin(inputs, options?): FeatureHandle<'plugin'>`

One feature of the timeline, in the **create** category. Its name follows
the app's (`Plugin feature1`, then `Plugin feature2`, …); `options.name` gives it
another, `options.id` its ID and `options.index` its place in the timeline. Inputs the
table calls optional keep the default it names, so a call with none of them still makes
a valid feature.

## Inputs

| Input | Type | Required or default | What it does |
| --- | --- | --- | --- |
| `plugin` | `string (an attachment ID)` | **required** | The plugin file: an attachment of this design with the media type `application/x-extrudo-plugin`. The design carries its own copy, so it opens where the plugin isn't installed. |
| `handler` | `string` | **required** | Which of the plugin's custom features this is: a `type` its manifest lists under `features` (`name-plate`). |
| `inputs` | `Record<string, OpenInputValue>` | optional | The plugin's own inputs by their manifest names: an expression as a string (its unit read off it, a length unless it ends in an angle unit) or a parameter handle, a plain number as a number, a toggle as a boolean, references as one or a list, and a choice as `{ kind: 'enum', value }`. Stored as `in:<name>`. |

## Faces

A plugin feature names no face itself: each feature its plugin's handler makes names
its own, under its own ID — the plugin feature's ID, a dot and the API's
(`extrude:<feature>.f1:cap:end`) — and the roles its own page lists, as a script's do.

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

// Plugin feature.
d.plugin({ plugin: 'att-name-plate', handler: 'name-plate', inputs: { width: '60 mm', rounded: true, plane: d.origin.xy } });
```

## See also

- [Features by category](README.md)
- [Sketches](../sketch.md) — `d.sketch(plane, build)` and its builder
- [References](../references.md) — every helper that builds a reference