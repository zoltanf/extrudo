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

An AI agent can call the same methods on the design open in the desktop app,
through its MCP server: see [Connecting an agent (MCP)](https://github.com/zoltanf/extrudo/blob/main/docs/desktop.md#connecting-an-agent-mcp).

## Getting started

```ts
import { Design } from '@extrudo/api';

const d = Design.create({ name: 'Plate' });
const width = d.parameter('width', '80 mm', {
  customizer: { min: '20 mm', max: '200 mm', step: '5 mm' },
});

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
| `d.setBody(body, { name, color, opacity, visible })` | A body's name, colour (`#rrggbb`), opacity (0.1–1) and visibility, as the browser's body menu sets them (ADR-0030) |
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

## Annotations

An **annotation** is a numbered note (ADR-0126): `#1`, `#2`, … in the order
they were made, a number never given twice. It sits on a reference (a face,
edge, vertex, body, plane, axis, point or sketch curve), at a point `[x, y, z]`
or in a sketch `{ sketch, at: [x, y] }`. The API has no kernel, so a note on a
reference needs `at`, where on it the note goes (world mm), unless the
reference carries a fingerprint; the app stores a fingerprint with every note
it makes, which is how a note follows its face when a parameter moves it.

```ts
import { Design } from '@extrudo/api';

const d = Design.create({ name: 'Plate' });
const plate = d.box({ length: '40 mm', width: '20 mm', height: '5 mm' });
const hole = d.annotate('Hole M4 here', plate.face('cap:end'), { at: [10, 5, 5] });
d.annotate('Logo on this side', [20, 0, 2.5], { offset: [28, -28] });

hole.number;                   // 1
hole.setText('Hole M3 here');
hole.done();                   // ticked off
d.annotation(2)?.remove();     // #2 is gone; the next note is #3
const notes = d.annotations(); // in number order
```

`d.annotationCounter(n)` marks every number up to `n` as given (a design rebuilt
by `emitScript` whose last notes were deleted); it never lowers the counter. A
script can't add or read annotations (`design.annotate` is refused there).

## Sheets

A **sheet** is a page of a drawing (P6-24, ADR-0143): views of the model and the
items placed on them, the way the app's Drawing mode makes them. Every call is
one command, so one undo step; IDs come from the counter (`sh1` for a sheet,
`sv1` for a view, `si1` for an item). Nothing derived is stored: a view says what
to draw, never its lines; a dimension what it measures, never its value; a parts
list only what was typed over its rows. The app, `extrudo export --format pdf`
and `extrudo info` work those out each time.

```ts
import { Design, type GeomFingerprint } from '@extrudo/api';

const d = Design.create({ name: 'Plate' });
const plate = d.box({ length: '60 mm', width: '40 mm', height: '10 mm' });
// A3 landscape at 1:1, first angle, a border and the Simple title block, unless asked.
const sheet = d.addSheet('Plate', {
  size: 'A4',
  start: 'standard', // Front, and Top, the side and Isometric projected from it
  fields: { title: 'Plate', date: '{date}' },
});
const front = sheet.view('Front');

// The kernel's reference to the edge carries its fingerprint; here it is written out.
const fingerprint: GeomFingerprint = { type: 'line', at: [30, 0, 10], dir: [1, 0, 0], size: 60 };
const edge = { ...plate.edge([plate.faceName('cap:end'), plate.faceName('side:front')]), fingerprint };
front?.addDimension('linear', [{ ref: edge, at: 'start' }, { ref: edge, at: 'end' }], [30, 18]);
front?.addLeader(edge, [10, 30], 'Break the edge {= 1 mm}');
const list = front?.addPartsList([140, 20], { rows: [{ body: plate, material: 'PETG' }] });
sheet.addText('All edges 0.5 mm unless noted', [20, 180]);
sheet.addSticky('Ask about the finish', [150, 150]); // on screen only, unless print: true
sheet.addTable([20, 200], [['Rev', 'What'], ['A', 'First drawing']]);

const back = sheet.addView('Back', { at: [60, 250], from: 'back', scale: [1, 2] });
back.project('right', [140, 250]);
sheet.update({ fields: { drawnBy: 'A. N. Other' } }); // merged over the fields there
list?.update({ columns: ['item', 'qty', 'name', 'material'] });
d.state.undo(); // takes back the columns, one call at a time
```

- **Anchors** (what a dimension, leader note, centre mark or line, or balloon
  points at) are given as the API names geometry: a face, edge or vertex
  reference, `{ ref, at: 'start' | 'end' | 'middle' | 'centre' }` for one point of
  an edge, `{ ref, silhouette: 1 | -1 }` for a cylinder's outline in the view,
  or `[x, y]` for a free point in the view's own mm. The document keeps every
  anchor with its **fingerprint**, so the reference must carry one, or come as
  `{ ref, fingerprint }`: the API has no kernel to find the geometry (the app,
  the kernel's `RecomputeEngine.reference` in Node and Export as Script all give one).
- **Places**: a view's `at`, a text's, a sticky note's, a table's and a parts
  list's are sheet mm from the top-left corner, Y down; an item tied to a view
  is placed in the view's own mm (model size, x right, y up from the view's
  origin), so it moves and scales with the view.
- **Standard views** (`start: 'standard'`) go on a grid of the paper; the API
  does not measure the model to fit them (the app's New Drawing does). Give
  `at: { front, top, side, iso }` to place them yourself.
- `d.sheets()`, `d.sheet(name)`, `sheet.views()`, `sheet.view(name)`,
  `sheet.items()` read; each handle has `update`, `remove` (a view takes the
  views projected from it and their items along; a parts list its balloons)
  and `sheet.move(index)` reorders pages.
- [The sheet reference](./sheets.md) lists every stored field (generated from
  the document schema). A script can't add or read sheets (`design.addSheet`,
  `design.sheet` and `design.sheets` are refused there, as annotations are);
  `emitScript` writes a design's sheets for a whole design.

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
