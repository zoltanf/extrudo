---
title: References
section: Guide
order: 3
---

# References

A feature is only half of a design: what the features make is geometry, and
geometry is named (ADR-0005). A **reference** is one of those names, and every
reference the API builds is a string the kernel resolves without the API ever
computing a shape.

The helpers below cover everything a script needs. `d.ref(kind, id)` is the way
out for the rest.

## What a reference is

```ts
import { Design } from '@extrudo/api';

const d = Design.create();
const plate = d.box();

console.log(plate.face('side:front'));
// { kind: 'face', id: 'box:f1:side:front' }
console.log(d.origin.xy);
// { kind: 'plane', id: 'origin:xy' }
```

The kinds are `plane`, `axis`, `point`, `face`, `edge`, `vertex`, `profile`,
`body`, `sketchEntity` and `feature`.

## The origin

`d.origin` holds the six origin planes and axes and the world origin, as
references any feature takes in place of something picked:

| Helper | Reference |
|---|---|
| `d.origin.xy`, `d.origin.xz`, `d.origin.yz` | The three origin planes |
| `d.origin.x`, `d.origin.y`, `d.origin.z` | The three origin axes |
| `d.origin.point` | The world origin, for the inputs that take a point |

## Bodies

```ts
import { Design } from '@extrudo/api';

const d = Design.create();
const plate = d.box({ length: '40 mm' });

const one = plate.body(); // the body this feature made
const all = plate.bodies(); // it and every <feature>:<n> the document holds
d.moveBodies({ bodies: [one], dx: '10 mm' });
console.log(all.length);
```

A body is named after the feature that made it, so `plate.body()` is
`{ kind: 'body', id: 'f1' }` for the first feature of a design. A feature that
makes several (a Mirror's copies, a pattern's instances) names the rest
`<feature>:2`, `<feature>:3`, …; `bodies()` lists the ones the document knows
without a recompute, and the kernel's `splitSolids` names any others.

## Faces, edges and vertices

The kernel names the faces of a result after the operation that made them
(ADR-0005): `extrude:F1:cap:end`, `box:B2:side:front`,
`fillet:F3:from:(extrude:F1:side:l3)`. The part after the feature is the
**role**, and every body-making feature lists the roles it names — with a line
each — under [Features](features/README.md).

```ts
import { Design } from '@extrudo/api';

const d = Design.create();
const box = d.box();
const shaft = d.cylinder({ diameter: '20 mm' });

const front = box.face('side:front');
const end = shaft.face('cap:start');
console.log(box.faceName('side:front'), front.id);

// The edge between two faces, and the vertex they meet at.
const corner = box.edge([box.faceName('side:front'), box.faceName('side:right')]);
console.log(corner.id, box.vertex([box.faceName('side:front'), box.faceName('side:right')]).id);
```

- `handle.faceName(role, which?)` — the name itself. `which` picks between faces
  with the same role: a number is the piece (`#n`, the kernel numbers split
  faces in geometric order) and a string is the source it came from, so a
  sweep's `side:l3`.
- `handle.face(role, which?)` — the same as a `face` reference.
- `handle.edge(faces, index?)` — the edge between the faces named, given as full
  names from `faceName`. Several edges between the same pair take `index`.
- `handle.vertex(faces, index?)` — the vertex where they meet.

The role is checked against the feature type: `extrude` names `cap:start`,
`cap:end` and `side:<curve>`, `box` names `side:front|right|back|left`, and a
type that names no face of its own (a Move, an Offset Face) takes any string.

## Sketch curves, points and profiles

```ts
import { Design, type LineHandle } from '@extrudo/api';

const d = Design.create();
let line!: LineHandle;
const s = d.sketch(d.origin.xy, (k) => {
  k.rectangle([0, 0], [40, 20]);
  k.circle([20, 10], '3 mm');
  line = k.line([0, 30], [40, 30]);
});

d.hole({ points: [line.start.ref()], diameter: '4 mm' });
console.log(s.profiles().length, s.profileAt([5, 5]).id);
```

- `handle.ref()` on anything the builder returned — a curve, a point, or a whole
  text — is a `sketchEntity` reference. A hole takes sketch points; an emboss
  takes profiles or a whole text.
- `s.profiles()` — every closed region of the sketch.
- `s.profileAt([x, y])` — the region at a point in sketch millimetres; it
  throws where there is none.
- `s.profileOrUndefined([x, y])` — the same, without the throw.
- `s.profilesInside(points)` — the regions wholly inside a polygon, holes
  included.

Profile IDs are a hash of the boundary's curves and their directions (ADR-0020),
so they do not move when a later solve does.

## Construction geometry

A construction feature makes a plane, an axis or a point, and its handle names
it (ADR-0040):

```ts
import { Design } from '@extrudo/api';

const d = Design.create();
const raised = d.offsetPlane({ plane: d.origin.xy, distance: '12 mm' });

console.log(raised.constructionRef()); // { kind: 'plane', id: 'f1' }

const plane = raised.constructionRef(); // undefined unless it is a construction feature
if (plane) {
  d.sketch(plane, (k) => {
    k.circle([0, 0], '5 mm');
  });
}
```

`constructionRef()` is `undefined` for any other feature type: only the nine
construction types make one.

## Anything else

`d.ref(kind, id, fingerprint?)` builds a reference by hand, for a name no helper
covers — a face an older document holds, or a name read out of the JSON.

```ts
import { Design } from '@extrudo/api';

const d = Design.create();
const raw = d.ref('face', 'extrude:f1:side:l3');
const alsoRaw = d.ref('vertex', 'v[box:f1:side:front|box:f1:side:right]');
console.log(raw, alsoRaw);
```

The named helpers are also exported on their own, for code that builds names
without a design: `edgeName(faces)`, `vertexName(faces)`, `createdName(op, id,
role, source)`, `indexedName(name, n)` and `splitName(name, n)`.

## When a name does not resolve

A name the kernel cannot find is a **lost reference**: the feature that holds it
reports an error, the timeline chip shows a ✕, and the app offers Fix References
(ADR-0033). The API does not guess and does not fail early — it stores what it
was given, and the recompute decides, which is why a wrong role is a visible
error rather than a silent stand-in. `d.validate()` reports what is wrong with
the document itself; a name that only the kernel can check is found by the
recompute that uses it.

## See also

- [The API in one page](README.md) — parameters, determinism, `Design`
- [Sketches](sketch.md) — the builder and its handles
- [Features](features/README.md) — the roles of every feature's faces