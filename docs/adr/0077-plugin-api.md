# ADR-0077: The plugin API (P6-03)

- **Status:** accepted (2026-10-07)
- **Task:** P6-03 (`docs/03-roadmap.md`: "Plugin API (custom features and
  commands; sandboxed)"); FR-PRG-01's second half (`docs/01-requirements.md`
  names "a plugin API" among Phase 6's goals).
- **Depends on:** ADR-0068 (the document API), ADR-0070 (the Script feature
  and the QuickJS sandbox), ADR-0061 (attachments), ADR-0027 (declarative
  feature dialogs), ADR-0023 (commands).

## Context

A Script (ADR-0070) is code *inside one design*: it writes features, runs in
QuickJS in the kernel worker, sees nothing but the document API, and is
re-run on every recompute. People who write a useful script want to use it
again in the next design, give it a dialog with named inputs instead of
editing code, and share it. That is a plugin: the same code, packaged with a
manifest, installed once in the app, offered as a **custom feature** (a
timeline entry with a dialog, recomputed like any feature) or a **custom
command** (a one-off that adds features to the design when run), and carried
inside every design that uses it so the design opens elsewhere.

What a plugin may do is bounded by what a Script may do: **add features**
through the document API. That is the whole extension surface in this version;
it is what the sandbox already enforces, what the recompute engine already
knows how to run (`expand`, ADR-0070 §2's one hook), and what makes a plugin
safe to install from a stranger: no file, network, DOM or process access, no
UI code, no native code.

## Decision

### 1. A plugin is a manifest and one module, zipped

A plugin file is `<id>.extrudo-plugin`: a zip (fflate, as `.extrudo` files)
holding

- `plugin.json` — the manifest (core's zod, `packages/core/src/plugin.ts`,
  `PluginManifest`): `id` (`^[a-z][a-z0-9-]{1,63}$`, unique per app; the
  file name is `<id>.extrudo-plugin`), `name`, `version` (semver),
  `description`, `author` (free text), `license` (an SPDX id), `main`
  (`main.ts` or `main.js`), `commands[]` and `features[]`;
- `main.ts` or `main.js` — the module (at most 200,000 characters, like a
  Script's 100,000 doubled), TypeScript stripped by sucrase as a Script's is;
- optionally `README.md` (shown in the Plugins dialog) and `LICENSE`.

**A command** (`commands[]`): `{ id, label, hint?, keys?: never }` — a plugin
never binds a key (ADR-0023: keys live in the keymap; a person may pin the
command in the toolbox); the command's id is namespaced by the app as
`plugin:<plugin id>:<command id>`.

**A custom feature** (`features[]`): `{ type, label, hint?, icon?, inputs[] }`,
where each input is `{ name, label, kind, default?, options?, accepts?,
multiple?, min?, max? }` with `kind` one of core's input kinds the dialog
framework already draws — `expr` (with `unit`: `length` | `angle` | `none`),
`bool`, `enum` (`options[]`), `ref` (`accepts[]` of `profile` | `face` | `edge`
| `vertex` | `body` | `plane` | `axis` | `point` | `sketchEntity`, `multiple`),
`labels` is not offered. Icons are one of the design system's tool icons by
name (`icon?: ToolIconName`), never a file: a plugin ships no assets.

The manifest is validated with the schema before anything else is read; a
plugin whose manifest the app doesn't understand (an unknown `kind`, a key the
schema lacks) is refused at install with the path and the reason, the way
`loadDocument` words leniency (ADR-0050): nothing is guessed.

### 2. The module exports handlers; both run in the Script sandbox

`main.ts` exports `commands` and `features`, objects keyed by the manifest's
ids and types:

```ts
export const commands = {
  'ribs-along-edges': (design, ctx) => { /* adds features */ },
};
export const features = {
  'name-plate': (design, inputs, ctx) => { /* adds features */ },
};
```

Both handlers get the **restricted `Design`** a Script gets
(`@extrudo/script`'s `restrictedDesign`: adds only; every refusal says "A
plugin can only add features: …"), `ctx.params` (the document's parameter
values, frozen), `ctx.selection` for a command (the current model selection as
the `GeomRef`s a Script would pass: profiles, faces, edges, vertices, bodies —
computed-geometry questions stay out, as ADR-0070 Deferred has them) and, for a
feature, `inputs`: the dialog's values resolved to what a Script passes — an
`expr` input as its number in the unit's base (mm, degrees, plain), a `bool`,
an `enum`'s value, a `ref` as the reference (or a list). `console.log`,
`Math.random` seeded from the feature or command id, `Date` at 0, the same
limits (2 s, 64 MB, 1,000 features, 100,000 characters of output); an
exception, a limit or a refusal is the feature's error / the command's toast
with the plugin's name and the line in `main.ts`.

The sandbox is `packages/script`'s, extended with one entry:
`ScriptRunner.runPlugin({ code, language, handler: { kind: 'command' |
'feature', name }, design, inputs?, selection?, params, featureId? })` that
evaluates the module once per call (no state survives between runs: a plugin
is a function of the document, like a Script), picks the handler and calls it.
The kernel's `ScriptHost` gains `runPlugin` the same way `run` exists
(`script-host.ts`), still injected by whoever starts the kernel; a kernel
without a runner gives `NO_SCRIPT_HOST`'s wording for plugins too.

### 3. A custom feature is the `plugin` feature type, expanded like a Script

Core gains one feature type, `plugin` (`packages/core/src/plugin-feature.ts`):
inputs `plugin` (`{ kind: 'file', id }` — the plugin file as an **attachment
of the design**, see §4), `handler` (an `enum` input with no listed values: the
manifest's feature `type`), and the plugin's own inputs stored under their
manifest names **prefixed `in:`** (`in:height`, `in:text`), each as the stored
form of its kind (an `expr` input stores an expression string with its unit,
so parameters and dimensions drive a plugin feature exactly as they drive an
Extrude; a `ref` stores a `GeomRef` with a fingerprint, so topological naming,
Fix References and timeline dependencies work unchanged). `bodyAccess`:
`write`. Not patternable (as a Script isn't). Face roles: none of its own —
its generated features name their faces (`extrude:<feature>.f1:cap:end`), as a
Script's do.

The kernel's definition has **`expand(ctx)`** (ADR-0070 §2): it reads the
attachment through `ctx.file`, finds the handler, resolves the `in:` inputs
(expressions through `ctx.value`, refs through `ctx.resolve` as persistent
references the API's `ref()` understands), calls `runPlugin`, and splices the
generated features into the walk after the feature under their own cache keys
— the run itself cached under the plugin file's digest, the handler, the
feature id and name, the resolved inputs and the document before it. IDs and
names are a Script's: `<feature>.f<n>`, "Name plate1 › Extrude1". A plugin
feature that refers to a plugin the design lacks (the attachment is gone) is
an error naming the plugin and its version, never a crash; `scriptOfGenerated`
makes references into its geometry a dependency on the feature.

### 4. The plugin travels with the design as an attachment; the app installs plugins per person

Two stores, two lifetimes:

- **Installed plugins** are the person's: `PluginStore` in
  `@extrudo/storage` beside `ProjectStore` (`plugins/<id>/plugin.extrudo-plugin`
  + an index: id, name, version, enabled, installed at; OPFS on the web,
  `userData/plugins` on the desktop through the same bridge pattern as
  projects, a method whitelist in `shared/ipc.ts`). Installing is picking a
  file (`platform.files.pick('.extrudo-plugin')`), validating the manifest,
  writing the bytes; the Plugins dialog (File › Plugins…, Ctrl+K "Plugins")
  lists them with name, version, description, README, Enable/Disable and
  Remove. Disabled plugins offer nothing; a removed plugin's features in open
  designs keep working (the design has its own copy).
- **A design that uses a plugin feature carries the plugin file** as an
  attachment of media type `application/x-extrudo-plugin` (`MEDIA_TYPES`,
  `docs/file-format.md` §6.32), written **before** the feature that names it
  (ADR-0061's rule; `attachments/<sha256>` in the `.extrudo` file, one copy
  however many features use it), garbage-collected with the rest. The feature
  dialog's OK adds the attachment record and the feature in one transaction
  through the dialog framework's `commitWith` hook (ADR-0066 §2's pattern for
  imports). Opening a design whose plugin is not installed works (the kernel
  runs the design's copy); the Plugins dialog offers "Install from this
  design". A design's copy at an older version than the installed one keeps
  running at its version; "Update to <installed version>" replaces the
  attachment for every feature of that plugin in one undo step (a new
  attachment, the old one collected on the next version save).

The kernel gets the file the way it gets fonts and imports: the `Recomputer`'s
`#sendResources` sends every attachment a `plugin` feature or a draft names
(`KernelApi.addFile`), once per kernel, and again after a recycle; the CLI
does the same (`headless.ts`). `enableScripts()` is called for a design with a
`plugin` feature as for one with a `script`.

### 5. Commands run in the kernel worker and apply as one transaction

A plugin command is an `AppCommand` (`buildCommands`'s `ctx.plugins`: the
enabled plugins' commands, group "Plugins › <plugin name>", in model mode; a
command whose plugin is disabled is absent, not dimmed). Running it: the app
asks the kernel worker (`KernelApi.runPluginCommand({ pluginId, commandId,
doc, selection, params })` — the worker already has the runner and the design's
document; the plugin's bytes come from the installed store, sent as a resource
under its digest) and gets back the features the handler added (a
`ScriptHostResult`); the app then inserts them **as stored features at the
timeline marker in one transaction** — exactly the macro's Replace path
(ADR-0073 §slice 2: `insertFeatures` + the IDs re-minted through core's
`newId()` so a command's features are ordinary features, editable, with no
tie to the plugin afterwards), named "<plugin name>: <command label>" as the
undo step. A failure is a toast with the plugin's name and the line. Nothing
of a command runs on the UI thread.

### 6. Where it shows

- **Plugins dialog** (`apps/web/src/plugins/`): the list, Install…, the
  per-plugin page (README, commands, features, Enable, Remove), "Install from
  this design" for a design's unknown plugins, and "Update to <version>".
- **Custom features:** every enabled plugin's features are registered in
  `featureDialogs()` at runtime as generated `FeatureDialogSpec`s (ADR-0027:
  fields from the manifest's inputs, `toInputs`/`fromInputs` to the `in:`
  names, `command` an auto-made tool id `plugin:<id>:<type>` with the
  manifest's label and icon); they sit in the Solid tab's Create menu under a
  "Plugins" separator and in Ctrl+K. A plugin feature's chip is the manifest's
  label ("Name plate1"), its tooltip the plugin's name and version; editing it
  opens the same dialog.
- **The CLI** (`extrudo info|export|check`) runs plugin features headless; no
  install step: the design carries the plugin.

## Rejected

- **Plugins as web code on the UI thread** (React panels, viewport overlays):
  the whole security story of ADR-0054/0067 (no `'unsafe-eval'`, a strict CSP)
  would end, and every UI API would become a compatibility promise. Deferred
  until there is demand that the add-features surface can't meet.
- **A plugin marketplace or registry:** install is a file; sharing is a link
  to a file. A registry is a later task if plugins appear.
- **Network access from a plugin:** none; a plugin is a function of the
  document.
- **Storing the plugin per feature by id and version only** (no bytes in the
  design): the design would stop opening on another machine, and "the
  document is the record" (ADR-0073) would break.
- **Running commands on the UI thread's `Design`:** the sandbox lives in the
  worker; one path for both kinds of handler.

## Deferred

- Plugin **UI** beyond the generated dialog (a custom preview, panels).
- Plugins that **read computed geometry** (volumes, face lists) — with Scripts'
  same Deferred (ADR-0070).
- **Sketch-mode commands** (a plugin that draws into the open sketch): the
  document API's sketch builder makes whole sketches; editing an open one is a
  different seam.
- Patterning a plugin feature; a plugin feature inside a Script.
- A keymap entry for a plugin command (pins cover the common case).

## Slices

1. **Core, sandbox, kernel, CLI** (Opus): `PluginManifest` + the
   `.extrudo-plugin` reader (`packages/core/src/plugin.ts`, zod; fflate
   through `@extrudo/storage`'s archive helpers), the `plugin` feature type
   (`plugin-feature.ts`, `in:` inputs, file format §6.32, the API generator's
   treatment of an open-ended feature), `runPlugin` in `@extrudo/script`
   (handler calls, selection and inputs marshalled, the plugin-worded
   refusals), the kernel's `expand` for `plugin` + `ScriptHost.runPlugin`, the
   `Recomputer`'s and the CLI's resource sending, `application/x-extrudo-plugin`
   in `MEDIA_TYPES`; an example plugin `examples/plugins/name-plate/` (a
   feature and a command) run headless by `packages/cli`'s tests (the only
   package with both the runner and the kernel, ADR-0070 §2).
2. **Installed plugins and commands** (Opus): `PluginStore` in storage (web
   OPFS + the desktop's Node store and bridge), the Plugins dialog's list,
   Install…, Enable/Disable, Remove, README; `ctx.plugins` in `buildCommands`,
   `KernelApi.runPluginCommand`, the one-transaction insert; "Install from
   this design".
3. **Custom features in the app** (Sonnet or GLM, decision-complete): the
   generated `FeatureDialogSpec`s, the Create menu's Plugins group, the
   `commitWith` attachment write, "Update to <version>", the chip and tooltip,
   `docs/plugins.md` (how to write one: the manifest, the handlers, the limits,
   the example), `docs/api/plugins.md` whose TypeScript blocks the API docs
   test compiles, roadmap, CHANGELOG, CLAUDE.md.
4. **Review** (MiMo): the sandbox boundary, the manifest validation, the
   store's path handling, the IPC whitelist; fixes.

## Consequences

- One sandbox and one API for Scripts and plugins: anything that works in a
  Script works in a plugin, and the plugin's extra is packaging, inputs and
  a dialog.
- A design is self-contained: it opens anywhere the kernel and the runner
  exist (the web, the desktop, the CLI), plugin or no plugin installed.
- The attack surface grows by a manifest parser and a zip reader (both already
  in use for `.extrudo` files) and a per-person plugin store; plugin code
  itself gets nothing a Script doesn't have.
- A manifest `kind` is a compatibility promise: adding one is an amendment
  here and a line in `docs/file-format.md`.

## Results

### Slice 1: core, sandbox, kernel, CLI (2026-10-07)

- **The manifest** is core's `PluginManifestSchema` (`packages/core/src/plugin.ts`),
  strict at every level, with `commands` and `features` defaulting to empty lists.
  Input names are identifiers (`inputs.width` in a handler); IDs and types are
  lower case with dashes; `license` is checked by the form of an SPDX expression.
  `parsePluginManifest` throws `PluginManifestError` with the first problem's place
  ("plugin.json › features[0] › inputs[2] › kind: expected one of expr, bool,
  enum, ref"); repeated IDs, types and input names and an enum default outside its
  options are refused too. `plugin.test.ts`.
- **The file** is `@extrudo/storage`'s `readPluginFile`/`writePluginFile`
  (`plugin-file.ts`, also exported as `@extrudo/storage/plugin` so the kernel takes
  fflate and core and nothing else of storage): at most 1 MB packed and 4 MB
  unpacked (counted from the zip's own sizes before anything is inflated), no entry
  outside the root (`..`, an absolute path, a backslash, a drive letter), a
  `plugin.json` and the module it names, at most 200,000 characters of module.
  Packing uses a fixed mtime, so the same plugin is the same attachment hash.
  `application/x-extrudo-plugin` (`.extrudo-plugin`) is in `MEDIA_TYPES`, outside
  `MODEL_MEDIA_TYPES`, and is the `plugin` feature's only `FILE_INPUT_MEDIA_TYPES`.
- **The `plugin` feature** (`plugin-feature.ts`) is `plugin` + `handler` + any
  `in:<identifier>` key holding an `expr`, `bool`, `enum` or `ref` input. Its schema
  takes any stored input under any key and then reports a key outside `in:` as
  `unrecognized_keys`, so the engine's lenient reading (ADR-0050) leaves it out with
  a warning instead of failing; an `in:` key of another kind is an error. Its icon
  is the Script's until slice 3 picks the manifest's. `makesFeatures(type)`
  (Script and plugin) replaces the Script checks in the delete rule, the
  `Recomputer` and the CLI.
- **The API** gets the open-ended inputs through one generic hook, not a case for
  the type: `FeatureDefinition.openInputs` (`{ name: 'inputs', prefix: 'in:' }`)
  makes the generator add an `inputs` row and type the method
  `d.plugin(inputs: PlainInputs<PluginInputs> & { inputs?: OpenInputValues },
  options?): FeatureHandle<'plugin'>`, and `storedInputs` spread the object under the
  prefix. No schema says a plugin input's kind, so the value does: a string is an
  expression whose unit is read off it (`inferUnit`: a length unless it ends in an
  angle unit), a number a **plain number**, a parameter handle its own unit, a
  boolean a toggle, a reference or a list a `ref`, and a choice is given stored,
  `{ kind: 'enum', value }` (a string is already an expression). The kernel holds
  the stored unit against the manifest's, so `width: 60` for a length is an error
  that says so. The macro emitter needs nothing: it already leaves out any feature
  with a file input.
- **The sandbox** (`ScriptRunner.runPlugin`, `host.ts`'s `runPlugin`): the module
  is not evaluated as an ES module. quickjs-emscripten 0.31's module evaluation
  answers with a promise and needs a module loader, and the runner treats a pending
  job as a script that tried to be asynchronous; instead sucrase's `imports`
  transform (with `typescript` for `main.ts`) turns `export const features = …`
  into an assignment to a global `exports` object the sandbox provides, which keeps
  every line, so a line is still `main.ts`'s. The module gets no global `design` or
  `params`; the handler is read from `exports.commands`/`exports.features` and
  called as `(design, ctx)` or `(design, inputs, ctx)`, `inputs` and `ctx`
  (`{ params, selection? }`) frozen all the way down (`Bridge.freezeDeep`). An
  `import` becomes a `require()` the sandbox doesn't have (an error on its line); an
  `import type` is stripped. Refusals say "A plugin can only add features: …"
  (`ScriptDesign`'s third argument); a script or a plugin can't add a plugin
  feature (`PLUGIN_IN_SCRIPT`). `plugin.test.ts` in `packages/script`.
- **The kernel**: `ScriptHost.runPlugin(PluginRunRequest)` beside `run`; the plugin
  definition (`features/plugin.ts`) reads the file through `ctx.file`, refuses a
  wrong media type, a file `readPluginFile` refuses ("The plugin Name plate 1.0.0
  (name-plate.extrudo-plugin) can't be read: …"), a missing one ("… is missing
  from this design, so Name plate1 can't run." — the version comes from the
  attachment record's `name`, since a missing file has no manifest) and a handler
  the manifest lacks; checks each `in:` input against the manifest (kind, unit,
  options, reference kinds, one or `multiple`), fills a missing one with its
  default (a constant, evaluated in the document's unit) and warns about one the
  manifest lacks; resolves face, edge and vertex references with `ctx.resolve`
  (the name they have now, the stored fingerprint kept), so a guess warns and a lost
  one is `LostReferenceError` with the feature's `refs` for Fix References. To do
  that `ExpandContext` gained `value`, `file`/`fileType`/`fileName`, `resolve` and
  `warn`; the engine's resolver moved into `#references`, shared by `#evaluate` and
  `#expand`, and an expansion's warnings join the feature's status. A failure of
  the code is "Name plate 1.0.0, main.ts line 3: …" (`ScriptRunError`'s `where`).
  The run is cached under the Script's key plus the expression values; the resolved
  references are a function of the document before the feature, which the key
  already holds (the plugin file's digest is in its attachment record), so they are
  not hashed separately. `checkedGenerated` is shared with the Script.
- **Resources**: the `Recomputer` sends a plugin feature's file (`pluginFileOf`) like
  an import's and enables the runner for it; the CLI's `headless.ts` does the same.
  `recomputer-recycle.test.ts` checks both reach a recycled worker before its
  recompute.
- **The example plugin** `examples/plugins/name-plate/` (feature `name-plate`:
  `width`, `height`, `thickness`, `rounded`, `plane`; command `three-holes`),
  typechecked by `packages/cli`'s program. `packages/cli/src/plugins.test.ts` packs
  it, opens a design that carries it through the CLI's `openDesign` and computes it:
  the default 60 × 20 × 3 mm rounded plate is one body of 10 faces and
  3535.619 mm³ (= (60 × 20 − (4 − π) · 5²) · 3 to 1e-6), 4735.619 mm³ after the
  parameter driving `width` goes to 80 mm; square corners give 6 faces and
  3600 mm³; the command's two features (`cmd.f1` sketch, `cmd.f2` cut through all)
  stored after it take 3 · π · 2² · 3 mm³ out. The refusals (a `remove` call, a
  handler missing from the module or the manifest, an unknown input kind, a
  `../` path, a missing file, a plain number for a length, an extra input) and a
  lost face reference have a test each.
- **Deviations from the brief**: the restricted `Design` is `ScriptDesign` with a
  rule argument; `ScriptHost.runPlugin` is required (the one implementation is
  `@extrudo/script`'s); the kernel depends on `@extrudo/storage` for
  `@extrudo/storage/plugin` only (`check-boundaries.mjs` says so); the
  `NO_SCRIPT_HOST` text now reads "Scripts and plugins can't run here: …".
