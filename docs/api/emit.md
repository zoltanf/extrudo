---
title: Macros
section: Guide
order: 5
---

# Macros

`emitScript(doc)` turns a design back into the TypeScript that makes it. Every
feature becomes the call the API takes for it — the same methods
[Features](features/README.md) lists — with its stored inputs, its references as
handle expressions and its sketches as `d.sketch(plane, (k) => { … })`. The
document already is the record of what was built (ADR-0003), so a macro is not
a log of clicks: it is the inverse of the API (ADR-0073).

The code runs against a `Design` or, as printed, inside a
[Script](scripts.md) feature, which is why its design variable is `design`.
Nothing new is stored; the function is pure.

```ts
import { Design, emitScript } from '@extrudo/api';

const d = Design.create({ name: 'Plate' });
d.parameter('width', '80 mm');
const s = d.sketch(d.origin.xy, (k) => {
  const plate = k.rectangle([0, 0], [40, 20]);
  k.dimension(plate.bottom, '40 mm', { name: 'width' });
});
d.extrude({ profiles: s.profileAt([5, 5]), distance: '10 mm' });

console.log(emitScript(d.toJSON()));
```

The output is a program, not data:

```text
design.parameter('width', '80 mm');
const sketch1 = design.sketch(design.origin.xy, (k) => {
  const l1 = k.line([0, 0], [40, 0]);
  // … three more lines and their constraints …
  k.dimension(l1, '40 mm', { name: 'width' });
});
const extrude1 = design.extrude({
  profiles: [sketch1.profileAt([5, 5])],
  distance: '10 mm',
});
```

## A run of the timeline

`options.features` selects a contiguous run, as `[from, to]` feature indices or
IDs. A reference to a feature **before** the run stays the stored name (it is
already in the design the run is added to); a reference inside the run becomes a
handle. The design's own parameters are left out of a run by default — the
design it runs in already has them.

```ts
import { Design, emitScript } from '@extrudo/api';

const d = Design.create();
const first = d.box({ length: '10 mm', width: '10 mm', height: '10 mm' });
const edge = first.edge([first.faceName('cap:end'), first.faceName('side:front')]);
d.fillet({ edges: edge, radius: '1 mm' });

const run = emitScript(d.toJSON(), { features: [1, 1] });
console.log(run);
```

## What is preserved

- **IDs become handles.** A face of a recorded feature is `extrude1.face('cap:end')`,
  an edge `box1.edge([…])`, a profile `sketch1.profileAt([x, y])`, a body
  `design.ref('body', …)`. A name that embeds a recorded feature's ID — a
  Script's generated `<script>.f1`, a face's source — is written as a template
  literal through the handle's own `.id`, so it works whatever IDs the run
  assigns.
- **A sketch is stored solved.** The emitter writes the coordinates the solver
  last produced, so the script adds the same geometry without solving. Named
  dimensions and a feature input's own parameter (`d1`) keep their names, so
  expressions that read them still resolve.
- **Suppression** and **timeline groups** are kept.
- **What can't travel in a script** is left out with a comment: a feature that
  reads an attachment (an import, a canvas image) is skipped — a script can't
  carry the file — and a text with a user font keeps its string but falls back
  to the bundled Inter, with a comment naming the font. A hidden feature and a
  body's name and appearance are
  [Deferred](https://github.com/zoltanf/extrudo/blob/main/docs/adr/0073-macro-recording.md)
  with the rest of ADR-0073's open list.

## In the CLI

`extrudo script <design.extrudo>` prints the same code, with
`--features a..b` for one run and `--param`/`--config` to emit a changed design.
See [the CLI guide](https://github.com/zoltanf/extrudo/blob/main/docs/cli.md).
