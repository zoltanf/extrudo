---
title: The API
section: Guide
order: 1
---

# The Extrudo document API

`@extrudo/api` builds and changes an Extrudo design from code. A design is JSON
(ADR-0003) and every call here is one of the app's own commands on it, so what
code writes is exactly what the app opens: the same timeline, the same names,
the same parameters.

It is pure TypeScript. No DOM, no WASM, no geometry kernel: it runs in Node, in
a worker and in the browser, and computing the solids a design makes is the
consumer's business, not this package's.

## Getting started

```ts
import { Design } from '@extrudo/api';

const d = Design.create({ name: 'Plate' });
const width = d.parameter('width', '80 mm', { customizer: { min: 20, max: 200, step: 5 } });

const s = d.sketch(d.origin.xy, (k) => {
  const plate = k.rectangle([0, 0], [40, 20]);
  k.circle([20, 10], '3 mm');
  k.dimension(plate.bottom, width, { name: 'width' });
});

const solid = d.extrude({ profiles: s.profileAt([5, 5]), distance: '10 mm' });
solid.face('cap:end');

const document = d.toJSON();
const bytes = await d.toFile();
```

Three calls make a part: a sketch, a solid, a reference to one of its faces. The
[Wall bracket](https://github.com/zoltanf/extrudo/blob/main/docs/api/examples/wall-bracket.ts)
and [benchmark B1](https://github.com/zoltanf/extrudo/blob/main/docs/api/examples/b1.ts)
are longer versions of the same thing, and both are tests: the repository runs
them and checks the geometry they describe.

## Where it comes from

The package lives in this repository (`packages/api`) and imports
`@extrudo/core`, `@extrudo/sketch` and `@extrudo/storage`. There is nothing to
install and nothing to publish: a fork adds it with a workspace link, a script
or a CLI imports it by name.

```ts
import { API_VERSION, Design, type FeatureHandle } from '@extrudo/api';

const version: number = API_VERSION;
const handle: FeatureHandle<'extrude'> = Design.create().extrude();
```

## Determinism and IDs

The same calls on the same starting document give the same JSON, byte for byte.
IDs come from a counting factory (`f1`, `f2`, … for features, `s1` for sketch
entities, `p1` for parameters), seeded from the document it started with so a new
ID never collides with a stored one, and names follow the app's (`Extrude1`,
then `Extrude2`). Nothing reads a clock unless the caller gives one:

```ts
import { Design } from '@extrudo/api';

const options = { now: '2026-10-05T00:00:00.000Z' };
const first = Design.create(options).toJSON();
const second = Design.create(options).toJSON();

console.log(JSON.stringify(first) === JSON.stringify(second)); // true
```

Any call takes `{ id }` and `{ name }` when its own IDs matter, and
`options.ids` replaces the factory altogether:

```ts
import { Design } from '@extrudo/api';

const ids = (() => {
  let next = 1;
  return () => `f${next++}`;
})();
const d = Design.create({ ids: () => ids() });
d.box({ length: '40 mm' });
d.cylinder({ diameter: '20 mm' });
```

## Units and expressions

Every length, angle and plain number an input takes is an expression with a
unit (ADR-0004): `'10 mm'`, `'2 * tolerance'`, `'90 deg'`, `3`. A number is
taken in the input's own unit, and a `ParameterHandle` stands for its name, so
the design follows the parameter:

```ts
import { Design } from '@extrudo/api';

const d = Design.create({ units: 'mm' });
const wall = d.parameter('wall', '2.4 mm');
d.box({ length: '40 mm', width: '20 mm', height: wall });

d.setParameter('wall', '3 mm');
```

A parameter's name is what expressions use, so `` `${wall}` `` is `'wall'`. A
named driving dimension in a sketch becomes a parameter too (ADR-0016): give it
`{ name }` and a sketch dimension drives itself with that name.

## References

A feature is not much use on its own — what a design is made of is geometry, and
geometry is named. Every reference the API builds is one of the persistent names
the kernel resolves (ADR-0005), computed without any geometry:

| What | How |
|---|---|
| An origin plane, axis or the world origin | `d.origin.xy`, `d.origin.z`, `d.origin.point` |
| A profile a sketch closed | `s.profileAt([x, y])`, `s.profiles()`, `s.profilesInside(points)` |
| A curve or a whole text | `handle.ref()` on what the builder returned |
| A body a feature made | `handle.body()`, `handle.bodies()` |
| A face, an edge, a vertex | `handle.face(role)`, `handle.edge(faces)`, `handle.vertex(faces)` |
| A construction plane, axis or point | `offsetPlane.constructionRef()` |
| Anything else | `d.ref('face', 'f3:side:front')` |

[References](references.md) has the whole table, the naming grammar and what
happens to a name the kernel cannot resolve.

## The rest of `Design`

| Call | What it does |
|---|---|
| `d.feature(id)` | A handle for a feature that is already there |
| `d.rename(f, name)`, `d.suppress(f)`, `d.move(f, index)`, `d.remove(f)` | The timeline, as the app's chip menu does it |
| `d.group(first, last)` | A run of features under one name (ADR-0065) |
| `d.transaction(label, fn)` | Several calls as one undo step; a throw rolls it all back |
| `d.configuration(name, values)`, `d.applyConfiguration(name)` | Named value sets to switch between (ADR-0059) |
| `d.validate()` | What is wrong with the document, as `ApiError`s |
| `d.toJSON()`, `await d.toFile()` | The document, and a `.extrudo` archive |
| `d.state` | Core's own document state, for what the API does not wrap |

A bad call throws `ApiError` with the input's path and the schema's own words,
and changes nothing:

```ts
import { Design } from '@extrudo/api';

const d = Design.create();
try {
  d.extrude({ distance: '10 mm', taper: '5 deg' });
} catch (error) {
  console.log(error instanceof Error ? error.message : 'it failed');
}
```

Every feature type has a method of its own — `d.extrude`, `d.fillet`,
`d.hole`, `d.thread`, `d.pattern` and the rest — generated from the same
registry the app and the kernel use, so a new feature in the app reaches the API
and its reference by running one command. They are all listed under
[Features](features/README.md), with their inputs, their face roles and an
example each.

## Components and joints

A **component** is a named set of bodies (ADR-0081): a box and its lid, quickly
shown, exported and weighed as one part. `d.component(name)` makes one and
returns a handle; the build form stamps every feature added inside it, and
`FeatureOptions.component` (or `SketchOptions.component`) stamps one explicitly.
`handle.add(...)` moves bodies in, and `handle.bodies()` reads the stored ones.
A component stores no transform: placing it is a `moveBodies` feature over its
bodies.

A **joint** is an as-built link between two components (ADR-0081 §4): side `a`
moves, side `b` stays. Its frames are ordinary references; the component beside
each is metadata, never part of the reference.

```ts
import { Design } from '@extrudo/api';

const d = Design.create({ name: 'Hinge' });
const base = d.component('Base');
const leaf = d.component('Leaf');
const plate = d.box({ length: '40 mm', width: '20 mm', height: '4 mm' }, { component: leaf });
base.add(d.ref('body', 'f2:0'));

const hinge = d.joint('Hinge', {
  type: 'revolute',
  a: { component: leaf, frame: plate.face('side:front') },
  b: { component: base, frame: d.ref('face', 'cylinder:Pin:side:wall') },
  min: '0 deg',
  max: '180 deg',
});

const components = d.components(); // every stored component
const joints = d.joints();         // every stored joint
```

The frames must already agree as built (a revolute's two axes are collinear, a
slider's two directions parallel); nothing moves when a joint is made.

## Stability

`API_VERSION` is `1`. The feature methods follow the document's feature inputs,
which never break: a stored document migrates instead (ADR-0003). A change that
would break a call — an input renamed or retyped — keeps the old form working
and maps it, and says so in the changelog.

## Links

- [Sketches](sketch.md) — the builder behind `d.sketch`
- [References](references.md) — every helper that builds a reference
- [Scripts](scripts.md) — a sandboxed program in the timeline, its environment and examples
- [Macros](emit.md) — turn a design back into the code that makes it
- [Features](features/README.md) — one page per feature type
- The `.extrudo` [file format](https://github.com/zoltanf/extrudo/blob/main/docs/file-format.md)
- [Source and issues](https://github.com/zoltanf/extrudo)
