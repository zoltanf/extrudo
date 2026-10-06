---
title: Sketches
section: Guide
order: 2
---

# Sketches

`d.sketch(plane, build, options?)` makes a sketch feature and calls `build` with
a `SketchBuilder`. Everything `build` draws — points, curves, constraints,
dimensions — is what the feature stores. The call is one undo step, and a throw
inside `build` leaves the design as it was.

```ts
import { Design } from '@extrudo/api';

const d = Design.create();
const s = d.sketch(d.origin.xy, (k) => {
  const plate = k.rectangle([0, 0], [40, 20]);
  k.circle([20, 10], '3 mm');
  k.dimension(plate.bottom, '40 mm', { name: 'width' });
});

d.extrude({ profiles: s.profiles(), distance: '10 mm' });
```

**Nothing is solved.** Positions are stored as given, the way a fresh document
stores them; the app solves the sketch when the design is opened (ADR-0011), and
profile IDs do not depend on positions (ADR-0020), so a reference you take here
still points at the same profile after the solve moves a curve.

## The plane

A plane is a reference like any other: an origin plane (`d.origin.xy`, `.xz`,
`.yz`), a flat face, or a plane a construction feature makes.

```ts
import { Design } from '@extrudo/api';

const d = Design.create();
const raised = d.offsetPlane({ plane: d.origin.xy, distance: '12 mm' });

// `constructionRef()` is undefined for anything that is not a construction
// feature, so a plane taken from a handle is checked once.
const plane = raised.constructionRef();
if (plane) {
  d.sketch(plane, (k) => {
    k.circle([0, 0], '5 mm');
  });
}
```

## Entities

Each method draws one thing and returns a handle: its own reference (`ref()`),
its points and its curves.

| Call | Draws | Handle |
|---|---|---|
| `k.point(at)` | A point | `at()`, `ref()` |
| `k.line(a, b)` | A line | `start`, `end` |
| `k.polyline(points)` | Lines chained end to end, closed when the last point is the first | `lines`, `points` |
| `k.rectangle(a, b)` | A rectangle from two opposite corners, with its own constraints | `bottom`, `right`, `top`, `left`, `edges`, `corners` |
| `k.rectangleCentered(center, corner)` | The same, from its centre and one corner, with construction diagonals | as above, plus `center` |
| `k.circle(center, radius)` | A circle; the radius is a number or `'3 mm'` | `center` |
| `k.arc(start, end, through)` | An arc through a third point | `start`, `end`, `center` |
| `k.arcCentered(center, start, end, options?)` | An arc about a known centre, `{ reversed }` for the other way round | as above |
| `k.ellipse(center, major, minor)` | An ellipse from its centre and two axis points | `center`, `major`, `minor` |
| `k.polygon(center, corner, sides, options?)` | A regular polygon, `{ mode: 'circumscribed' }` for a nut's wrench size | `edges`, `corners`, `circle` |
| `k.polygonOnEdge(a, b, side, sides)` | A polygon on one side of an edge | as above |
| `k.slot(a, b, width, options?)` | A slot of that width between two points, `{ mode: 'overall' }` for its ends | `lines`, `arcs`, `centerline` |
| `k.spline(points, options?)` | A fit-point spline through its points, `{ closed: true }` for a loop back to the first | `points`, `closed` |
| `k.splineControl(points, options?)` | A control-point spline through its poles, `{ closed }` for the periodic one, `{ knots }` for its own knot vector (`points.length + 4` values, four 0s first and four 1s last) | `points`, `closed`, `knots` |
| `k.conic(start, shoulder, end, rho)` | A conic through three points, `rho` between 0 and 1 | `points` |
| `k.text(anchor, top, content)` | Text: `{ text, font, align? }`, where the font is a bundled ID (`inter-regular@1`) or `attachment:<id>` | `anchor`, `top` |

```ts
import { Design } from '@extrudo/api';

const d = Design.create();
const s = d.sketch(d.origin.xy, (k) => {
  k.slot([0, 0], [30, 0], 6);
  k.splineControl([[40, 0], [50, 10], [60, 0]]);
  k.spline([[70, 0], [90, 0], [80, 15]], { closed: true });
  k.text([0, 20], [0, 26], { text: 'Extrudo', font: 'inter-regular@1' });
});

// The slot's outline, the closed spline and each letter's ink: the regions the curves closed.
d.extrude({ profiles: s.profiles(), distance: '4 mm' });
```

A handle a method returns belongs to the call that made it. To use one after
`build`, hold it in a variable the callback fills in:

```ts
import { Design, type RectangleHandle } from '@extrudo/api';

const d = Design.create();
let plate!: RectangleHandle;
const s = d.sketch(d.origin.xy, (k) => {
  plate = k.rectangle([0, 0], [40, 20]);
  k.circle([20, 10], '3 mm');
});

console.log(plate.bottom.id, s.plane);
```

The builders are the ones the drawing tools use (`@extrudo/sketch/build`), so a
rectangle a script draws and a rectangle a person drags are the same geometry
with the same constraints.

## Constraints

One method per constraint type of the sketch schema, each returning its ID:

`coincident`, `pointOnCurve`, `collinear`, `concentric`, `midpoint`, `fix`,
`parallel`, `perpendicular`, `horizontal`, `vertical`, `tangent`, `smooth`,
`equal`, `symmetric`.

```ts
import { Design } from '@extrudo/api';

const d = Design.create();
d.sketch(d.origin.xy, (k) => {
  const first = k.line([0, 0], [10, 0]);
  const second = k.line([10, 0], [20, 10]);
  k.coincident(first.end, second.start);
  k.horizontal(first);
  k.perpendicular(first, second);
});
```

A constraint the solver would refuse — redundant, conflicting, or one that
collapses a curve — is still stored: what a solve makes of it is the solver's
answer, and the app shows it in its own colours (ADR-0017).

## Dimensions

`k.dimension(target, value, options?)` takes a line, two points or a curve, and
the value is an expression or a parameter. The named kinds are `distance`,
`radius`, `diameter`, `angle` and `reference`.

```ts
import { Design } from '@extrudo/api';

const d = Design.create();
const width = d.parameter('width', '40 mm');
d.sketch(d.origin.xy, (k) => {
  const plate = k.rectangle([0, 0], [40, 20]);
  const hole = k.circle([20, 10], '3 mm');
  const sized = k.dimension(plate.bottom, width, { name: 'width' });
  k.radius(hole, '3 mm');
  console.log(sized.parameterName);
});
```

A dimension given a name becomes a model parameter (ADR-0016), so changing it
changes every sketch that reads it. One without a name takes the next free
`d1`, `d2`, … as the app's tools do.

## Profiles

The handle a sketch returns finds the closed regions the curves made:

| Call | Gives |
|---|---|
| `s.profiles()` | Every closed region |
| `s.profileAt([x, y])` | The region at a point; throws where there is none |
| `s.profileOrUndefined([x, y])` | The same, without the throw |
| `s.profilesInside(points)` | The regions inside a polygon, holes included |
| `s.regions` | Every region with its area, its holes and its boundary |

```ts
import { Design } from '@extrudo/api';

const d = Design.create();
const s = d.sketch(d.origin.xy, (k) => {
  k.rectangle([0, 0], [40, 20]);
  k.circle([20, 10], '3 mm');
});

console.log(s.profiles().length); // 2: the rectangle and the circle
d.extrude({ profiles: s.profileAt([5, 5]), operation: 'cut', distance: '10 mm' });
```

A profile inside another is a hole of its parent and a region of its own, so
`profiles()` lists both — the region you cut with and the piece you leave.

The handle also lists what was drawn (`points()`, `lines()`, `circles()`,
`arcs()`), reads one entity by ID (`entity(id)`), holds the sketch's stored
content (`data`) and its plane (`plane`).

## See also

- [The API in one page](README.md) — parameters, determinism, `Design`
- [References](references.md) — what a profile, a face or a body reference is
- [Features](features/README.md) — the solids that sweep a sketch's profiles