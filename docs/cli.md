# `extrudo`: the headless CLI

`extrudo` recomputes an Extrudo design in Node and exports it: no browser, no
window, the same kernel (OCCT) and the same sketch solver the app uses. It is
what a batch script, a CI job or a make rule wants, and the same code is a
library (`@extrudo/cli`) for anything more than one command.

- ADR: [ADR-0069](adr/0069-headless-cli.md) (P5-03, FR-PRG-03)
- Requires Node 24 or newer and the WASM builds (`pnpm wasm`, which `pnpm check`
  and `pnpm build` do for you).

## Running it

In this repository:

```sh
pnpm extrudo <command> …                 # or:
node packages/cli/bin/extrudo.mjs <command> …
```

After `npm install -g @extrudo/cli` (Phase 6) the command is simply
`extrudo`.

## Commands

```
extrudo info   <design.extrudo> [--json]
extrudo export <design.extrudo> --format stl|3mf|step [--out <path>]
               [--param name=expr]… [--config <name>] [--bodies a,b]
               [--component <name>]… [--flat]
               [--resolution coarse|medium|fine|<deviation mm>] [--json]
extrudo set    <design.extrudo> [--param name=expr]… [--config <name>] --out <new.extrudo>
extrudo check  <design.extrudo> [--param …] [--config …] [--joints] [--min-gap <expr>] [--json]
extrudo script <design.extrudo> [--features a..b] [--param name=expr]…
```

### `info` — what the design holds and what it computes to

Parameters with their expressions and values, the configurations, every feature
with its status and message, and every body with its size, face count and
volume. The parameters are listed in three groups: the ones a person added, the
driving dimensions' own (`d1`, or the name they were given) and the feature
inputs' — the last two are what `--param` names too, and `--param` refuses the
feature inputs' (change those in the feature).

```sh
$ extrudo info fixtures/benchmarks/b4-box-with-lid.extrudo
B4 Box with lid
  mm · 2 bodies · 406 ms
Parameters:
  length     60 mm  = 60 mm
  width      40 mm  = 40 mm
  …
Parameters (driving dimensions):
  d1         2 mm   = 2 mm   (Sketch1's dimension)
  …
Features:
  ok      Offset Plane1
  ok      Box1
  ok      Shell1
  …
Bodies:
  Box  60.00 × 40.00 × 30.00 mm · 15 faces · 15489 mm³
  Lid  60.00 × 40.00 × 8.00 mm · 15 faces · 17002 mm³
```

`--json` prints the same as one JSON object on stdout: `name`, `units`,
`notices`, `parameters` (each with its `owner`), `configurations`, `features`,
`bodies`, `errors`, `warnings`, `ms`. It is the slower way to read a design —
the volumes are the kernel's exact mass properties (see
[Times](#times)).

### `export` — STL, 3MF or STEP

```sh
extrudo export box.extrudo --format 3mf --param clearance=0.4mm
extrudo export box.extrudo --format stl --param width=80mm --bodies Lid --out lid.stl
extrudo export box.extrudo --format step --resolution fine --out box.step
```

- A 3MF keeps each body's name and colour, and a STEP file makes each body a
  named product with its colour (a body without one has none) — both exactly as
  the app's Export dialog writes them.
- An STL holds one solid, so without `--out` it writes **one file per body**,
  next to the design (`Box - Lid.stl` and so on). With `--out` the bodies you
  chose go into that one file.
- A mesh body (an imported STL, 3MF or OBJ, or one a boolean made) is left out
  of a STEP file, which says so; STL and 3MF take its triangles as they are.
- An imported OpenSCAD file (`.scad`, ADR-0071) is compiled by OpenSCAD's own
  WASM in a worker thread, with the import's overrides as `-D` definitions, so
  `--param` reaches the `.scad` part through any override bound to that
  parameter. Its body is a mesh body like an STL's. `pnpm wasm` downloads the
  compiler with the rest.
- `--component <name>` (repeatable) exports a component's live bodies (a name or
  ID); with `--bodies` both are combined. A 3MF or STEP keeps a component's
  bodies together as one object of parts (ADR-0081 §7); `--flat` writes one
  object per body instead, as a design without components.
- `--resolution` is `coarse` (0.1 mm), `medium` (0.02 mm, the default), `fine`
  (0.005 mm) or a deflection in millimetres.
- With `--json` it prints `{ "files": [{ "path", "name", "bytes", "bodies",
  "triangles", "closed" }] }`.

### `set` — a design with other parameters

```sh
extrudo set box.extrudo --param wall=3.2mm --out box-3.2mm.extrudo
extrudo set bracket.extrudo --config Large --out bracket-large.extrudo
```

Writes a new `.extrudo` file with the changes: its saved versions, its
thumbnail and the attachments it names travel with it (a font the design
carries, a STEP, mesh or OpenSCAD file it imports). The design it was given is
untouched.

### `check` — is this design sound?

```sh
$ extrudo check design.extrudo; echo $?
design.extrudo: 1 errors.
  Fillet1: Radius 50 mm is too large for edge 12 (max ≈ 19 mm)
1
```

Recomputes the design (with `--param` and `--config` applied first) and exits 2
if any feature has an error, listing them. Warnings are printed but do not fail
the check. `--json` prints the whole report with `"ok": false`.

With **`--joints`** it runs every unsuppressed revolute and slider joint's
clearance check (ADR-0081 §4) and prints one line per joint, so a print-in-place
design can be checked in a CI:

```sh
$ extrudo check hinge.extrudo --joints
Hinge: tightest 0.3 mm at 0°–90°, no collision
$ extrudo check hinge.extrudo --joints --min-gap 0.5mm; echo $?
Hinge: tightest 0.3 mm at 0°–90°, no collision, under the minimum from 0°–90°
2
```

It exits 2 when a joint collides, comes under the minimum gap, or has an error.
`--min-gap` is an expression (the document's `tolerance` parameter by default,
else 0.2 mm); `--json` prints the checks as data.

### `script` — a design as the code that makes it again

```sh
extrudo script box.extrudo > box.ts
extrudo script b4.extrudo --features 2..6 > lip.ts
```

Prints the design as TypeScript through the macro emitter (P5-05, ADR-0073):
one call per feature, references as handle expressions, sketches as
`design.sketch(plane, (k) => { … })`. With `--features a..b` only that run of
the timeline (feature indices or IDs) is emitted, and its parameters are left
out by default; `--param`/`--config` apply their change first, so the emitted
code describes the changed design. Paste the output into a Script feature or
run it against a [`Design`](api/README.md).

## Options

| Option | Meaning |
|---|---|
| `--param name=expr` | Set a parameter to a new expression. Repeatable. The app's expression grammar with units: `width=60mm`, `tilt=30deg`, `wall=2 * tolerance`. A driving dimension's own parameter (`d1`, or the name it was given) works too and moves that sketch; a feature input's own parameter does not — the message says which feature and input it is. `info` lists all three kinds. |
| `--config <name>` | Put a configuration's values on the parameters (ADR-0059), then re-solve. |
| `--bodies a,b` | Export only these bodies, by name (or by ID). |
| `--component <name>` | Export a component's live bodies, by name (or ID). Repeatable; with `--bodies`, both. |
| `--flat` | Write without the component structure: one 3MF object or STEP product per body. |
| `--joints` | For `check`: run every joint's clearance check (ADR-0081 §4). |
| `--min-gap <expr>` | For `check --joints`: the minimum gap the check allows (the design's `tolerance` by default). |
| `--features a..b` | For `script`: emit only this run of the timeline (feature indices or IDs). |
| `--out <path>` | The file to write: the export's, or the new design for `set`. Missing folders are made. |
| `--resolution …` | `coarse`, `medium`, `fine` or a deflection in mm. |
| `--json` | One JSON object on stdout instead of the text report. |
| `--help`, `--version` | The usage, and the version. |

Every parameter change **re-solves the sketches** the change moves (ADR-0016):
a sketch whose driving dimensions read the parameter is solved, in steps when
the value moves far, and its solved geometry is stored with the change — so an
export is never of a stale shape. Here **every** sketch is solved, not only the
ones the parameter drives, so a design whose stored geometry was left out of
shape by something else (a projection sync, a hand edit) is repaired rather
than exported as it is; the app solves only the sketches a change moves. A change
a sketch cannot take (a length of 0 mm on a line, say, which would collapse it)
is refused, and nothing is written.

## Exit codes

| Code | When |
|---|---|
| 0 | It worked. |
| 1 | The command line was wrong: an unknown option or command, a missing `--format` or `--out`, a `--param` that isn't `name=expression`, a parameter the design doesn't have, an expression that doesn't evaluate. The usage follows a command-line mistake. |
| 2 | The design has errors: `check` found one, an export named a body that isn't there, a design has nothing to export, or a change a sketch can't take was refused. |
| 3 | A file could not be read or written. |

Messages go to stderr, in the app's wording, so they read the same as they do
in the app.

## As a library

The commands are a thin layer over `@extrudo/cli`, which is what to call from a
script that wants more than one command:

```ts
import { openDesign } from '@extrudo/cli';

const { job, notices } = await openDesign('box.extrudo');
console.log(notices);                            // what the file said about itself
await job.setParameters({ wall: '3.2 mm' });     // re-solves the sketches
const result = await job.compute();              // features, bodies, volumes, timings
const [file] = await job.export({ format: '3mf' });
await job.save('box-3.2mm.extrudo');
await job.dispose();                             // frees the kernel
```

`compute()` reports every feature's status with its message and every body with
its name, volume, box and face count; `export()` returns the bytes and the names
rather than writing them, so a caller decides where they go. `dispose()` returns
what the kernel still held as it went, which is 0 when nothing leaked.

## What it needs

The design's attachments come with it: a font the design carries is shaped, a
STEP file is read as a base body and a mesh file as a mesh body (which loads
manifold-3d for that design only). A design with a Script feature (ADR-0070)
runs its code in QuickJS, loaded for that design only, and `info` says how many
features each script made (`--json` lists them, with what the script printed and
the line it failed on); `--param` changes what a script makes like anything
else. The bundled fonts of the app are found in
`packages/fonts`. A design from a newer Extrudo opens with a notice, and one
with keys this version does not know opens without them — the same leniency the
app has (ADR-0050).

## Times

One kernel per process, freed at the end. Measured on the development machine
(an Arch workstation, OCCT and planegcs built for it), `export --format 3mf`
including the process start and the medium tessellation:

| Design | Time |
|---|---|
| B1 plate | 0.8 s |
| B2 storage box | 0.9 s |
| B3 phone stand | 1.0 s |
| B4 box with a lid | 1.1 s |
| B5 PCB enclosure | 1.4 s |
| B6 wall hook | 1.2 s |
| B7 knurled knob | 2.3 s |
| B8 name tag | 1.6 s |
| B9 bottle cap | 9.6 s |
| B10 chain link | 1.2 s |

B9 is the slowest: modelling its two threads is about 10 s, and nothing else
matters. An export meshes and writes; `check` recomputes and reads the
statuses; only `info` measures the bodies' volumes, which on a body with
modelled threads costs more than computing it (12.9 s of exact mass properties
against B9's 10.6 s recompute). `packages/cli/src/cli.test.ts` prints the
export table on every run.
