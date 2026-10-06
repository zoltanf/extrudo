# ADR-0070: The Script feature

- **Status:** Accepted, 2026-10-05; all three slices implemented
- **Task:** P5-02 (FR-PRG-02: "A Script feature in the timeline: TypeScript/
  JavaScript code that reads parameters and produces bodies or sketches, running
  sandboxed in a worker"; the roadmap adds "no DOM, no network, time and memory
  limits; errors shown inline" and names Monaco).
- **Builds on:** ADR-0068 (`@extrudo/api`: `Design`, deterministic IDs, the
  generated feature methods, `d.sketch`), ADR-0024 (the engine, `bodyAccess`,
  `preview` of a trial timeline, strict leaks), ADR-0066 (a lazily loaded second
  WASM in the kernel worker: manifold-3d), ADR-0067 (no `'unsafe-eval'`),
  ADR-0027 (feature dialogs), ADR-0005 (names), ADR-0069 (the CLI computes
  whatever the engine computes).

## Context

A script must run user code. Two facts decide how:

- **The app forbids `'unsafe-eval'`** since ADR-0067, so user code can't be
  turned into a function in any of our pages or workers; carving out a worker
  with its own looser policy would need `_headers` gymnastics (Cloudflare joins
  every matching rule's headers, and two policies are both enforced).
- **A script runs on every recompute**, with the rest of the design, in the
  kernel worker's engine, and must give the same result each time (later
  features refer to its faces by name).

The P5-01 API already turns code into features. So a script is code that calls
the API, and its result is ordinary features the engine knows how to build.

## Decision

### 1. A script is a feature that writes features

- Feature type `script` (core `script.ts`): inputs `code` (string, at most
  100,000 characters), `language` (`ts` | `js`, default `ts`). `bodyAccess`:
  `write`. Patternable: no (Deferred).
- On evaluation the script runs against a **`Design` over the document as it is
  before the script** (so it can read parameters, find earlier features by name
  or ID and refer to their profiles, faces and bodies) and may only **add**
  features (and sketches) through the API: removing, moving, renaming or
  suppressing existing features, adding parameters and changing settings are
  refused ("A script can only add features."). The features it adds are **not
  stored**: the engine evaluates them right away, in order, in the script's own
  context (`ctx`), and their bodies and names are the script's output.
- **IDs and names** of generated features are `<script id>.<n>` / "Script1 ›
  Extrude1"-style names from the API's counter, so they are the same every run;
  their faces are named by their own evaluators (`extrude:<script>.f3:cap:end`),
  so later features refer to a script's geometry like any other.
- The script's sketches are not solved (the API never solves; scripts give
  coordinates). Its sketches are visible as part of the script feature only
  (Deferred: showing them in the view).

### 2. User code runs in QuickJS inside the kernel worker

- `packages/script` (`@extrudo/script`, GPL-3.0-or-later; depends on api, core):
  runs code in **QuickJS compiled to WASM** (`quickjs-emscripten`, MIT, its
  release-sync WASM variant), which needs only `'wasm-unsafe-eval'`. TypeScript is
  stripped to JavaScript first with `sucrase` (MIT, types only, no
  type checking) on the host side.
- **The sandbox has nothing but what we give it:** no DOM, no `fetch`, no timers,
  no module loading. The global environment is: `design` (a proxy whose methods
  marshal their arguments as JSON to the host's `Design` and return handle
  descriptions), `params` (the document's parameter values, numbers in mm and
  degrees, frozen), `console.log` (captured, shown in the dialog, at most 200
  lines), a seeded `Math.random` (seed: the feature ID) and a `Date` frozen at 0.
- **Limits:** 2 s wall time per run (an interrupt handler), 64 MB memory
  (`setMemoryLimit`), 1,000 generated features, 100,000 characters of output.
  Exceeding one is the feature's error ("The script ran longer than 2 s.").
- **Errors carry a position:** syntax errors from sucrase and QuickJS, runtime
  errors with the script's line and column (QuickJS stack traces; the sucrase
  transform keeps lines), `ApiError`s with the call's line. The feature's status
  message is "Line 12: …"; the editor underlines it.
- QuickJS is loaded **lazily** in the kernel worker (as manifold-3d is), only when
  a design has a script; the kernel gets the runner injected
  (`KernelService.enableScripts(runner)` / Node: `loadScriptRunner()`), so
  `@extrudo/kernel` doesn't depend on `@extrudo/api`. The CLI (P5-03) enables it
  when a design has scripts.

### 3. The editor: CodeMirror 6, not Monaco

- The dialog "Script" (`apps/web/src/features/script.tsx`) is a wide feature
  dialog with a **CodeMirror 6** editor (MIT, a few hundred kB, loaded lazily with
  the dialog): TypeScript highlighting, line numbers, the error underline from
  the feature status, autocompletion of `design.` methods and `params.` names
  from the generated method list and the document's parameters, and the
  captured `console.log` output under it. The preview runs 500 ms after typing
  stops. OK commits the code as one undo step.
- **Rejected: Monaco** (what the roadmap named): about 100 MB unpacked and several
  MB shipped, its own workers, and its TypeScript service is more than a script of
  a few dozen lines needs; CodeMirror fits the CSP and the size budget. Type
  checking in the editor is Deferred.

### 4. Where it shows

- The timeline shows the script as one chip (with the count of features it made in
  its tooltip); its bodies appear in the browser like any other; Fix References
  works on references *into* a script's geometry by name, as for other features.
- Templates/examples: `docs/api/examples/script-*.ts` (a gear-like pattern of
  holes from a loop, a parametric shelf of N compartments) run as tests through
  the runner.

## Slices

1. **Runner:** `@extrudo/script` with QuickJS, sucrase, the bridge to `Design`,
   the environment, limits, errors with positions; Node tests (loops, params, every
   limit, determinism, refusals, a syntax and a runtime error's line).
2. **Kernel:** the `script` feature (core definition, file-format docs), the
   evaluator running the runner and then the generated features in the script's
   context (bodies, names, warnings, strict leaks), lazy loading in the worker and
   Node, the CLI computing a design with a script; kernel tests (a script making a
   plate with holes equals the same features made by hand: volume and face
   names; a later fillet on a script's edge resolves).
3. **App:** the editor dialog, inline errors, console output, autocompletion, the
   timeline chip, e2e (write a script, preview, OK, edit, an error underlined, a
   parameter change re-runs it), docs (`docs/api/scripts.md`, the site page).

## Results: slice 1

The runner (`packages/script`, `@extrudo/script`, GPL-3.0-or-later) is in, with
`pnpm check` green: `loadScriptRunner(options?)` loads QuickJS once (the
release-sync variant; `wasmUrl` for the browser's own asset, which is what
Emscripten's `locateFile` takes) and `runner.run({ code, language, design,
featureId, params?, limits? })` gives back `{ ok: true, added, log }` or
`{ ok: false, error: { message, line?, column? }, log }`. A run owns a runtime, a
context and every QuickJS handle in them, and frees all of it before it returns.

- **The environment** (`src/sandbox.ts`) is §2's list and nothing else: `design`
  (add only, §1), `params` frozen, `console.log`, a `Math.random` seeded from the
  feature ID, a `Date` at 0. There is no `fetch`, no timer, no `require`, no DOM,
  and nothing that could reach one: QuickJS has none of them, `evalCode` runs as
  global code with no module loader set, and `import()` leaves a job QuickJS
  still has, which the runner reports as a failure ("A script runs on its own,
  with nothing to wait for…") rather than a quietly empty design.
- **The bridge** (`src/bridge.ts`) marshals a call's arguments as JSON both ways.
  A **handle** cannot be JSON, so it is published as a proxy: its own properties,
  its prototype's getters (lazily, so building a sketch handle doesn't run
  profile detection) and a method per function on its prototype — one mechanism
  for `FeatureHandle`, `SketchBuilder`, the entity handles and the composite ones
  (a rectangle, a polyline, a slot, a polygon). The proxy carries its host
  handle's name under `@@extrudo`, which is how `k.dimension(plate.bottom, '40
  mm')` hands `plate.bottom` back to the API. `handles.test.ts` fails when the
  API publishes a handle class the bridge doesn't know.
- **The limits** are §2's, each with its own message: 2 s (an interrupt handler
  with a deadline), 64 MB (`setMemoryLimit`), 1,000 features (counted in the one
  place every add comes down to, checked before anything is dispatched), 200 log
  lines and 100,000 characters of output (the log stops with a line saying so,
  which is not an error — the features are the point), and 100,000 characters of
  source. Every one of them is overridable through `limits`, and the message
  names the limit that was given.
- **Positions** come out where §2 says: sucrase's own `loc` for a TypeScript
  syntax error, QuickJS's stack for a runtime error, and the call's line for an
  `ApiError`. The source runs one line lower than the user wrote it
  (`LINE_OFFSET`), because QuickJS's frames leave the line number out when it is
  1, so a failure on the first line would otherwise have no line at all.

Findings for slices 2 and 3:

- **Every QuickJS handle has to be disposed, and QuickJS checks it.** A value
  still alive at `JS_FreeRuntime` is an assertion failure that *aborts the
  process*, not a failed test — the runner's own leak test is 100 runs and the
  free at the end. Two of our own paths did leak and the tests found them: the
  failed `callFunction` of a sketch callback (`runBuilder`), and the handle
  proxies of the composite handle classes, which `isHandle` missed until
  `handles.test.ts` said so.
- **quickjs-emscripten 0.31.0 types a host function as `(this, …args)` but
  passes the arguments alone** (measured on the release-sync, debug-sync and
  asyncify builds). Every argument here goes through one wrapper, with a cast
  and a comment saying why, and the tests pass their arguments through it, so a
  version that changed it would fail loudly rather than shift them silently.
- **A host function in QuickJS is not a constructor**, so the frozen `Date` is
  a small constant of `sandbox.ts` evaluated *inside* the sandbox (a class, with
  `new Date()` working) rather than built from host functions. It is ours, not
  user code: the only source a script reaches `evalCode` with is its own.
- **`Math.random`, `console.log` and every limit are already proved in Node**
  (`runner.test.ts`, 41 tests): a loop of ten holes in a plate gives the same
  `toJSON()` as the same calls made on a `Design`, byte for byte and run after
  run; `params` reads the document's values and cannot be written; every refused
  method names the rule; each limit stops with its own message; a `TypeError` on
  line 7 and an `ApiError` on line 4 report those lines.

Deviations from the ADR as written:

- **The refused set is the ADR's list plus the rest of `Design`'s changing
  methods**: `removeParameter`, `group`, `configuration`, `applyConfiguration`,
  `transaction` and `toFile`, each refused by name with what it would have done
  ("A script can only add features: `design.rename()` would rename a feature."),
  so a script gets the rule rather than `undefined`. `removeBodies` and
  `moveBodies` are *allowed*: they add the Remove and Move features, which is
  what §1 means by "may only add features".
- **Two read-only extras**, because §1 says a script may find earlier features
  by name or ID and read the document: `design.features()` (each feature's ID,
  name and type) and `design.toJSON()`/`design.validate()`. `design.feature(id)`,
  `design.getParameter` and `design.ref` are §1's own.
- **`params` is optional on the call**: a caller that has already evaluated the
  document's parameters (slice 2's evaluator has) passes them, and the runner
  reads them from the document otherwise.
- **Not in this slice:** the `script` feature itself, the kernel evaluator and
  the lazy loading in the worker (§2's last bullet, which is slice 2), and the
  editor dialog (§3).

## Results: slice 2

The Script feature computes, in the engine, in the app's kernel worker and in
the CLI, with `pnpm check` green.

- **Core** has the feature type `script` (`script.ts`: `code`, `language`,
  `bodyAccess` write, not patternable, no `faceRoles` — core's and the API's
  face-role tests say why) and a new input kind, **`code`** (`{ kind: 'code',
  value }`, `codeOf(max)` with `meta({ input: { kind: 'code' } })`), which the
  API's generator and `inputs.ts` know (type column `string`, a call passes the
  text); `docs/file-format.md` §6.1 and §6.30. `FeatureStatus.script`
  (`ScriptRunStatus`) carries what a run did: `generated` (each made feature's
  ID, name, type, status and message), `log`, and `line`/`column` when it failed.
- **The engine** (`recompute/engine.ts`) gained one hook,
  `KernelFeatureDefinition.expand(ctx)`, which the script's kernel definition
  (`features/script.ts`) implements over the injected host. The walk is a queue:
  what a script makes is spliced in right after it and walked like stored
  features, each **under its own cache key** (type, ID, inputs, expression
  values, upstream keys, the body set before it), so `stats.evaluated` after a
  parameter change that only moves the second of two generated features is
  `['<script>', '<script>.f2']`. The generated features' expressions are
  evaluated with them in the document (a sketch's named dimensions are
  parameters), and they stand at fractional timeline positions past their
  script, so "comes later in the timeline" keeps working among them. **The run
  itself is cached** (32 runs, no shapes) under its code, ID, name, the document
  before it (settings, parameters, features) and the parameter values: a change
  after the script never runs it again. A failure for want of a runner, or an
  internal one, is not cached, so a runner that arrives later is used.
- **Statuses:** the result lists the script, never its features (an error count
  must not count one failure twice); the script is an error when any of them
  is, its message each failing feature's own prefixed with its name ("Script1 ›
  Fillet1: Radius 50 mm is too large…"), then the warnings; references the
  generated features lost are **not** offered to Fix References (only the code
  can change them). A mesh error of a generated body, and a crash while a
  generated feature computes, are the script's (the app keys crashes by stored
  features, so a script that crashes the kernel is held as crashed until its code
  changes). A failed run makes nothing — not even what it added before the throw
  — and the bodies before it pass on unchanged.
- **IDs:** `<script>.f1`, `<script>.f2`… from a **fresh, unseeded** API counter
  per run, prefixed only for features (sketch entities, constraints and
  dimensions inside are the plain counter, unique within their sketch). Seeding
  it from the document would shift every generated ID when a feature is added
  before the script and break the references after it. Bodies are
  `<script>.f1:0`, so they can't collide with anyone's. Names are "Script1 ›
  Box1", counted per type within the script (`@extrudo/script`'s `host.ts`).
- **Timeline:** core's `scriptOfGenerated` reads `<script>.f3` as the script
  (the part before the **last** `.`, only when the token is not itself a feature
  ID, so a text's `<text>.<n>` and a hand-written ID with a dot are untouched);
  `referencedFeatures` uses it, so `moveFeature`/`moveFeatures` refuse a move
  across the script, and `removeFeature` refuses to delete a script while any
  stored reference uses its geometry (faces and edges included, which it doesn't
  check for other features). Inside the engine a reference to `<script>.f2/<region>`
  stays a dependency on the generated feature itself (its output is the profile
  the evaluator reads); when the script failed or no longer makes it, the message
  names the script ("Needs Script1, which has an error.").
- **Injection** (decision 4): the kernel defines `ScriptHost` (`script-host.ts`)
  and `ScriptHostLoader`, `KernelServiceOptions.scripts` and
  `KernelApi.enableScripts()`; `@extrudo/script` exports the adapter
  (`scriptHost`, `loadScriptHost`, structurally the same type) and
  `@extrudo/script/browser` (`loadBrowserScriptHost`, QuickJS's WASM as a `?url`
  asset). **Chosen: the app has its own worker entry**
  (`apps/web/src/project/kernelWorker.ts` → `serveKernel({ scripts })` from the
  new `@extrudo/kernel/worker`, spawned by `spawnProjectKernel` through
  `connectKernelWorker`), because a loader is code that must run *in* the
  worker, so `spawnBrowserKernel` (on the UI thread) can't take it. The kernel's
  own `worker.ts` is `serveKernel()` without a runner (the debug page). The
  `Recomputer` calls `enableScripts()` before a recompute or a preview whose
  document or draft has a script, once per kernel, and again after `#resend`
  (crash restart, heap recycle); a kernel without a loader refuses and the
  script's status says `NO_SCRIPT_HOST`. The CLI gives its `KernelService` a
  loader and enables it when the design has a script (cli → script is a new
  allowed dependency; web → script too, for the worker entry only).
- **The app's workers are module bundles now** (`worker: { format: 'es' }` in
  `apps/web/vite.config.ts`): with Vite's default (`iife`) every dynamic import
  in a worker is inlined, which put the runner's JavaScript — QuickJS's glue,
  sucrase, the document API, 318 kB (81 kB gzip) — into every project's kernel
  worker. As `es`, the kernel worker is 434 kB (135 kB gzip; the old one was
  639 kB, 197 kB gzip, since opentype.js and manifold's glue split out too) and
  the runner is a chunk fetched by the first design with a script. Every worker
  was already started with `type: 'module'`.

Tests (real OCCT, in `packages/cli`, the one package allowed both the kernel and
the runner): `scripts.test.ts` — a plate with N holes from a loop equals the same
features by hand (body, volume to 1e-9, box, every face name up to the `f1.`
prefix, and each generated feature's faces carry its own type's roles); a stored
fillet on an edge of the script's body resolves exactly before and after `count`
changes; call counters for a parameter change, a repeat and a change after the
script; a syntax error ("Line 2: …"), a runtime error ("Line 3: Error: no luck")
with the bodies before untouched; a failing fillet named in the status; a script
inside a script refused by its line; no runner (and a runner given later); a
cancel between generated features; stable body IDs and versions across engines;
a later extrude on a script's profile and "Needs Script1, which has an error.";
both examples (`docs/api/examples/script-hole-ring.ts`, `script-shelf.ts`) with
exact volumes; and 16 seeded random parameter edits on each of the three script
designs, warm against cold. `script-cli.test.ts` — the fixture
`fixtures/scripts/plate-holes.extrudo` (rewritten by `WRITE_FIXTURES=1`), its
round trip through `loadDocument`, the archive and the CLI's `save`, the headless
library with `setParameters`, and the binary's `info` ("Script1 (made 5
features)", `--json` with the generated list), `export --param count=7` (a closed
STL of the right volume) and `check` (exit 2, "Line 2: …"). Core:
`timeline.test.ts` (dependencies, the move refusal, the delete refusal);
kernel: the `Recomputer` asks for the runner only for a design with a script,
before its recompute, once per kernel, and again on a recycled worker.

Measurements (the Ubuntu machine, Node 24): QuickJS loads in **10 ms** once the
package is imported (the import itself, with sucrase and the API, 340 ms in Node
from TypeScript sources); a run of the hole ring with 8 holes takes **5.5 ms**
(median of 30; the first 41 ms), with 100 holes 31 ms — `Design.from` on the
document before the script and the API's checks are most of it. The WASM is
**519 kB** raw, 240 kB gzip, 206 kB brotli. The load time in the browser's
worker is not measured here (no e2e in this slice): slice 3's e2e should read it.

Findings for slice 3:

- The editor reads `FeatureStatus.script`: `line`/`column` for the underline,
  `log` for the output pane, `generated` (with each one's status) for the
  tooltip's "made 5 features" and a list of what failed.
- The preview of a script draft is the ordinary `preview`: the walk ends at the
  draft and its features follow it; `base` is the bodies before the script. A
  script's generated features have no `previewTools` of their own in the
  result (the draft is the script), so the preview shows the bodies after it.
- `reports` carry the generated features' own reports (sketch frames,
  construction, patterns) under their generated IDs, which the app's stores
  read by feature ID: the view will want to draw a script's construction
  geometry and sketches from them (ADR-0070 §1 defers the sketches).
- The runner's runtime-error message keeps QuickJS's "Error: " prefix ("Line 3:
  Error: no luck"); the editor may want to drop it for a plain `throw new
  Error(…)`.
- A generated sketch's named dimensions are parameters only inside the script's
  own evaluation; a stored feature after the script can't use them in an
  expression.

Deviations:

- The integration tests live in `packages/cli`, not the kernel: the kernel's
  tests may not load the runner, and the runner may not load the kernel.
  **The kernel's fuzzer has no script fixture** for the same reason; the seeded
  random edits in `scripts.test.ts` do its job for scripts (warm against cold,
  no internal error, strict leaks).
- `removeFeature` checks every stored reference (faces and edges too) for a
  script only; other features keep the profile/body rule they had.
- A trap inside QuickJS's own WASM ends the worker like an OCCT trap (the engine
  passes `WebAssembly.RuntimeError` on): the kernel restarts and holds the script
  as the feature that crashed it. QuickJS's limits (time, memory) are ordinary
  errors, so this needs a QuickJS bug.

## Results: slice 3

The app has a Script command in Solid › Create, after Rib, and in command search.
Its own `</>` icon goes through the tool-icon pipeline. A script is one timeline
chip; the tooltip reads its generated count from `FeatureStatus.script`, while
its bodies remain ordinary browser entries. A picked generated edge can be
filleted, the fillet still computes after a parameter change, and Delete refuses
a script used by that fillet.

The dialog spec is small and eager; its extra component dynamically imports the
editor, then renders the loaded component directly (not `React.lazy`). CodeMirror
6 and the completion metadata are fetched only when the dialog opens, independently
of the worker's lazy runner. The framework gained `wide` (560 px), `initialValues`
and `previewDelay` (500 ms): a new Script starts with a working box, using the
first user parameter when there is one. Dragging and remembered positions are
clamped inside the view. The editor is 320 px high (16 lines), with its own scroll
area, the bundled JetBrains Mono, line numbers, TypeScript/JavaScript highlighting,
diagnostics at the reported line and column, output up to eight lines high and
Made N features. OK waits for the current script preview and commits one command.

The completion list comes from the sandbox's exported allowed-method list,
excluding refused mutations and nested scripts. The API generator now also emits
its methods' one-line descriptions; the editor uses those and the document's
evaluated parameter values. `console.log` completes too. Editor key events stay
inside CodeMirror; text undo does not undo the design. Esc first dismisses a
completion, then enables CodeMirror's Tab-focus mode; Esc followed by Tab leaves
the editor. Returning to it restores indentation. Cancel is the dialog button.

Tests cover input round trips, debounce/cancel/stale replies, pure completion and
diagnostic mapping, and the chip count. `e2e/script.spec.ts` covers creation,
editing/cancel/undo, a parameter-driven hole loop, syntax and runtime errors,
console output, completion, keyboard ownership, and a later fillet/Delete refusal.
The repeat run passed **12 tests (36.2 s)**. The hosting walk opens and previews a
script under the real content policy (**5 passed, 10.6 s**); the axe audit includes
the editor in both themes (**6 passed, 42.7 s**, no exceptions added).
`docs/api/scripts.md` is a guide page on the static docs site; its two examples
come from the tested hole-ring and shelf programs and its TypeScript blocks are
compiled by the API's docs test.

Measured on Ubuntu, system Chrome with GPU rendering, two workers:

| Measurement | Result |
|---|---|
| Editor lazy chunk (including completion support), production raw / gzip | 511.23 kB / 171.37 kB |
| First open, menu click to editor visible (two fresh contexts) | 462 ms / 295 ms |
| First preview request to result (after the 500 ms debounce) | 275.5 ms / 318.0 ms |
| Runner import and QuickJS initialization in the worker | 87.1 ms / 87.2 ms |
| Menu click to first preview, including opening and debounce | 1304 ms / 1121 ms |

The browser timings are performance measures (`extrudo-preview`, with the feature
type in `detail`, in the
page, `extrudo-script-host-load` in the worker), printed by the e2e. The worker
measure includes the runner's dynamic import and WASM initialization, not just
QuickJS's own initialization.

Findings and choices:

- CodeMirror's default keymap took Esc before a later custom binding. The editor
  uses a highest-priority binding and the built-in Tab-focus mode instead of
  trying to emulate browser focus navigation.
- Brand accent and success colours are not text-AA colours in the light theme;
  the editor mixes them with the ink token. A comment on the dark active-line
  background also needed more contrast. The actual axe audit caught both, along
  with the need for an explicit focusable editor inside its scroller.
- Source text lives in the spec's `choices.code` value and maps to core's `code`
  input through `toInputs`/`fromInputs`; this needs no extra generic field renderer
  or document schema change. CodeMirror stays in the spec's lazy `extra` UI.
- Scripts alone wait for their preview before OK; ordinary fast feature dialogs
  retain their existing commit behavior. This prevents committing unvalidated
  source during the debounce window.

### Integration with OpenSCAD import (ADR-0071)

The queue walk retains both hooks: scripts expand into generated features, and
any generated feature with `prepare` runs that hook on a cache miss before its
ordinary evaluation. Cancellation is checked after the await; progress reports
the enclosing Script ID for both preparation and evaluation. Preparation errors
become that generated feature's error and are aggregated into the Script status.
The shared `serveKernel` entry provides the lazy OpenSCAD loader to both project
and debug workers, alongside the project's injected script loader.

A Script can name any model attachment, so the app and CLI send model attachments
and enable the relevant compiler/mesh module when the design has a script; no
source parsing is used to guess which files it might read. Images and fonts are
not included by this scan. The script-run cache includes attachment metadata,
which is part of the document the API can read. The CLI regression computes a
script-generated `.scad` import, reuses it warm, changes its override through a
parameter, and disposes with zero live shapes. A worker-recycle test verifies the
file and both loaders are sent again before the new worker's recompute.

Preview timing is framework-wide: `extrudo-preview` records every preview with
`detail.type`; the Script e2e selects its own entries from that generic measure.

## Rejected

- **Running user code with `new Function` in a dedicated worker** with its own
  looser CSP: brings `'unsafe-eval'` back for part of the origin, and the worker
  would still need its own time and memory limits, which a JS engine in WASM
  gives directly.
- **A geometry-level scripting API** (boxes and booleans like CadQuery or
  OpenJSCAD): a second API to keep, and its results wouldn't be features that
  fillets, patterns and Fix References understand.
- **Storing the generated features** in the document: they would go stale the
  moment the code or a parameter changes; the code is the source.

## Deferred

- Type checking in the editor; imports between scripts; showing a script's
  sketches; patterning a script; a script reading computed geometry (volumes,
  face lists) — it sees the document, not the shapes.
