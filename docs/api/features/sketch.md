---
title: Sketch
type: sketch
section: Features
category: sketch
order: 0
---

# Sketch

`d.sketch(plane, build, options?): SketchHandle`

A sketch is the one feature type with no inputs object: `build` is a function the
API calls with a `SketchBuilder`, and everything it draws — points, curves,
constraints, dimensions — is what the feature stores. [Sketches](../sketch.md) walks
through the builder; the sketch handle it returns gives the profiles a solid feature
sweeps.

## Inputs

| Input | Type | Required or default | What it does |
| --- | --- | --- | --- |
| `plane` | `GeomRef \| GeomRef[]` (`plane`, `face`) | **required** | The plane the sketch is drawn on: an origin plane, a construction plane or a flat face. |

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

// Sketch.
const other = d.sketch(d.origin.yz, (k) => {
  k.circle([0, 0], '5 mm');
});
```

## See also

- [Sketches](../sketch.md) — every entity, constraint and dimension
- [Features by category](README.md)
- [References](../references.md) — every helper that builds a reference