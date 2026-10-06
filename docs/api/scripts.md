---
title: Scripts
section: Guide
order: 4
---

# Scripts

A Script is one timeline feature whose TypeScript or JavaScript program adds
ordinary features. Change a parameter and the program runs again. Its generated
features are derived geometry; only the code is saved in the design.

In the app, choose **Solid → Create → Script**, after Rib. The editor previews
500 ms after typing stops. Language selects TypeScript or JavaScript; TypeScript
types are stripped, not checked. Errors underline their source line and prevent
OK. Console output and the number of made features appear below the editor.
OK adds or edits one undo step. Tab indents; Esc closes completion first, and
Esc then Tab leaves the editor. Use Cancel to close it.

## Environment

The program runs in QuickJS WASM inside the geometry worker:

- `design` is the [document API](README.md), restricted to adding features and
  reading the document before the script. `design.sketch` builds coordinates;
  it does not run the constraint solver.
- `params` is a frozen record of the current parameter values: millimetres,
  degrees, or unitless numbers. `design.` and `params.` have editor completion.
- `console.log` captures text in Script output. `info`, `warn` and `error`
  write to that same output.
- `Math.random` is seeded from the script feature's ID, so repeated runs agree.
- `Date` is frozen at the Unix epoch; `Date.now()` is always zero.

There is no DOM, network, file access, timer or module loading. Each run has
2 seconds, 64 MB of memory, up to 1,000 generated features and 100,000 source
characters. Console output stops at 200 lines or 100,000 characters, with a
notice; reaching a computation limit fails the feature. A failed run contributes
no features, including anything added before the error.

Removing, moving, renaming, suppressing or grouping existing features is refused,
as are parameter and configuration writes, transactions and `toFile`. Scripts
can only add: changing the earlier document would make timeline recomputation
depend on which runs had already happened. `removeBodies` and `moveBodies` are
allowed because they add Remove and Move features. A script cannot add a script.

## Example: a ring of holes

This is the program from `examples/script-hole-ring.ts`, which the CLI tests
recompute with the real kernel. The first three lines below set up an API design
outside the sandbox; omit them in the editor, where `design` and `params` exist.

```ts
import { Design } from '@extrudo/api';
const design = Design.create();
const params = { diameter: 60, thickness: 5, margin: 8, holes: 8, hole: 5 };

const flange = design.cylinder({ diameter: params.diameter, height: params.thickness });
const top = flange.face('cap:end');
const r = params.diameter / 2 - params.margin;
for (let i = 0; i < params.holes; i++) {
  const a = (2 * Math.PI * i) / params.holes;
  design.hole({
    plane: top,
    x: r * Math.cos(a),
    y: r * Math.sin(a),
    diameter: params.hole,
    extent: 'through',
  });
}
console.log(`${params.holes} holes on a ${2 * r} mm circle`);
```

Use parameters `holes = 8`, `diameter = 60 mm`, `thickness = 5 mm`,
`hole = 5 mm`, and `margin = 8 mm`.

## Example: a shelf

From `examples/script-shelf.ts`. The bottom board goes first so every upright
touches it; the top board joins last. Use `compartments = 3`, `width = 600 mm`,
`depth = 250 mm`, `height = 300 mm`, and `board = 18 mm`.

```ts
import { Design } from '@extrudo/api';
const design = Design.create();
const params = { width: 600, depth: 250, height: 300, board: 18, compartments: 3 };

const { width, depth, height, board, compartments } = params;
design.box({ length: width, width: depth, height: board });
const step = (width - board) / compartments;
for (let i = 0; i <= compartments; i++) {
  design.box({
    length: board,
    width: depth,
    height: height - 2 * board,
    x: -width / 2 + board / 2 + i * step,
    offset: board,
    operation: 'join',
  });
}
design.box({ length: width, width: depth, height: board, offset: height - board, operation: 'join' });
```

## Recording a macro

Solid › Create › **Record Macro** starts recording; make features as usual (the
status bar counts them) and choose **Stop Macro**. The Macro dialog shows the
code that makes them again, the same code `emitScript` writes (see
[emit.md](emit.md)). **Replace with a Script** swaps the recorded features for one
Script feature in a single undo step; **Keep both** adds the Script suppressed
beside them, and Copy puts the code on the clipboard. Replace is refused, with the
reason, when something outside the recording still uses a recorded feature.
File › **Export design as script…** does the same for the whole design,
parameters included.

## IDs, names and later features

Generated features have deterministic IDs `<script>.f1`, `<script>.f2`, … and
names such as `Script1 › Box1` or `Script1 › Hole2`. Their bodies appear in the
ordinary Bodies folder; only the Script appears as a timeline chip. Its tooltip
says how many features it made.

A later feature can pick a generated body's edges or faces exactly as it picks
any other body's. Its persistent reference names the generated feature, for
example `box:<script>.f1:cap:end`. In an API program, build the same reference
explicitly:

```ts
import { Design } from '@extrudo/api';
const d = Design.create();
const script = d.script({ code: 'design.box({});' });
const top = d.ref('face', `box:${script.id}.f1:cap:end`);
d.sketch(top, (k) => { k.circle([0, 0], 2); });
```

The later reference depends on the Script: deleting it or moving it past that
feature is refused. Keep generated calls in the same order when editing code
if later features use their names. Adding a call earlier in the program changes
the later generated IDs. A generated sketch's named dimensions are local to its
run; later stored features cannot use them as expression parameters.

See [feature methods](features/README.md), [sketch builders](sketch.md) and
[persistent references](references.md). The script's sketches are computed but
not yet drawn individually in the viewport.
