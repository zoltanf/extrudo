# ADR-0068: The public document API (`@extrudo/api`)

- **Status:** Implemented, 2026-10-05 (slices 1 to 3)
- **Task:** P5-01 (FR-PRG-01: "A public, typed document API. Every UI feature
  is a serializable operation that code can also create."). Phase 5 builds on
  it: the Script feature (P5-02) runs user code against it in a sandboxed
  worker, the headless CLI (P5-03) loads and edits designs with it, macro
  recording (P5-05) writes calls to it.
- **Builds on:** ADR-0003 (document JSON, commands, undo, `newId()` in the
  caller), ADR-0004 (expressions), ADR-0010/0013/0014 (sketch entities, the
  tools' builders), ADR-0016 (dimensions as parameters), ADR-0020 (profile IDs:
  a hash of the boundary's (curve, direction) set, independent of positions),
  ADR-0005 (persistent names: `op:feature:role`, edges `e[faces]`), ADR-0024
  (the feature registry), ADR-0061 (`.extrudo` archives), ADR-0050 (lenient
  loading), ADR-0067 (zod jitless: `packages/core/src/zod.ts`).

## Context

A design is JSON (`ExtrudoDocument`) changed only through core's commands;
geometry is derived by the kernel. Code that wants to make or change a design
today would have to know the schema, the IDs, the reference formats and the
sketch builders that live in the app (`apps/web/src/sketch/tools/build.ts`).
Phase 5's three consumers need one stable surface:

- **Scripts** (P5-02): user code in a worker with no DOM and no network, run on
  every recompute, so the same script must produce the same document (same IDs,
  same names) every time, or the features after it lose their references.
- **The CLI** (P5-03): Node, loads an `.extrudo`, changes parameters, saves.
- **Macros** (P5-05): turn recorded commands into readable calls.

## Decision

### 1. A package of its own, pure

`packages/api` (`@extrudo/api`, GPL-3.0-or-later like the packages it uses):
depends on `@extrudo/core`, `@extrudo/sketch`'s pure entries (`/profiles`, the
new `/build`) and `@extrudo/storage`'s archive code; **no DOM, no WASM, no
kernel** in its main entry, so it runs in Node, in a worker and in the app.
Computing geometry is not the API's job (the CLI adds it in P5-03). Add it to
`scripts/check-boundaries.mjs`.

### 2. `Design`: a document and its commands

```ts
const d = Design.create({ name: 'Bracket', units: 'mm' });   // or Design.from(doc | json)
const width = d.parameter('width', '40 mm');                 // a ParameterHandle; `${width}` in expressions
const s = d.sketch(d.origin.xy, (k) => {
  const plate = k.rectangle([0, 0], [width, 20]);           // numbers, expressions or handles
  k.circle([10, 10], '3 mm');
  k.dimension(plate.bottom, width);
});
const ext = d.extrude({ profiles: s.profileAt([1, 1]), distance: '10 mm' });
d.fillet({ edges: [ext.edge('cap:end', 'side:' + plate.top.name)], radius: '2 mm' });
d.toJSON();            // ExtrudoDocument, schema-valid
await d.toFile();      // `.extrudo` bytes (storage's archive writer)
```

- **Every change is one of core's commands** on a `DocumentState` (so the
  document is always valid, undo works, and macros can map commands back to
  calls); `d.transaction(label, fn)` groups them. Inputs are checked with the
  feature's zod schema at the call: a bad call throws `ApiError` with the input
  path and the schema's message, never a half-written document.
- **Deterministic IDs and names.** A design hands out IDs from an injectable
  factory: the default is a counter per design (`f1`, `f2`…, `s1`…, `p1`… for
  features, sketch entities, parameters; never colliding with IDs already in a
  loaded document); `{ id }` on any call overrides it. Names follow the app
  (`nextFeatureName`: "Extrude1"); `{ name }` overrides. The same calls on the
  same starting document give the same JSON, byte for byte (a test).
- `d.parameter(name, expr, options?)` (with `customizer` ranges, ADR-0059),
  `d.setParameter`, `d.feature(id)`, `d.remove`, `d.suppress`, `d.rename`,
  `d.move` (timeline order through `moveFeature`'s rules), `d.group(first, last)`
  (ADR-0065), `d.validate()` (the document check's issues).

### 3. Feature methods generated from the registry

`pnpm api:generate` (a script run by `pnpm check`'s staleness test, like
`docs/file-format.md`'s) reads core's feature registry and writes
`packages/api/src/generated/features.ts`: for every feature type one method
`d.<type>(inputs, options?) → FeatureHandle<'<type>'>` whose `inputs` type is the
feature's own input type (required inputs required, the rest optional with the
registry's defaults in the doc comment), and `d.add(type, inputs)` for any type
by name. Doc comments come from the zod schemas' `.describe()` texts (add
descriptions where inputs lack them; the generator fails on an input without
one). Generated, not hand-written, so a new feature or input reaches the API and
its docs by running the generator, and the test fails until someone does.

### 4. References without a kernel

The API builds the same `GeomRef`s the UI stores, from what it knows without
computing geometry:

| Helper | Ref |
|---|---|
| `d.origin.xy`/`.xz`/`.yz`, `.x`/`.y`/`.z`, `.point` | origin planes, axes, point |
| a construction feature's handle | `{kind: 'plane'|'axis'|'point', id: <feature>}` (ADR-0040) |
| `k.line(...)` etc. | `{kind: 'sketchEntity', id: '<sketch>/<entity>'}`; a text: the whole text |
| `s.profiles()`, `s.profileAt([x, y])`, `s.profilesInside(...)` | profile refs from `@extrudo/sketch/profiles`' `detectProfiles` on the sketch as built (IDs depend on curves and directions, not positions, so a later solve that moves the curves keeps them) |
| `handle.body()`, `handle.bodies()` | body refs by the feature's body IDs (`<feature>`, `<feature>:<n>`) |
| `handle.face(role)`, `handle.edge(roleA, roleB)`, `handle.vertex(...)` | face/edge/vertex refs **by persistent name** (`<op>:<feature>:<role>`, `e[...]`), no fingerprint |
| `d.ref(kind, id)` | anything else, raw |

Face and edge **roles** are documented per feature in the generated reference
(from a `faceRoles` description each core feature definition gains: a list of
role patterns with one line each, e.g. extrude's `cap:start`, `cap:end`,
`side:<sketch curve>`). A name the kernel can't resolve fails like a lost
reference in the UI (Fix References), so a wrong role is a visible error, not a
silent guess.

### 5. Sketches

`d.sketch(plane, build, options?)` creates a sketch feature and runs `build`
with a `SketchBuilder`:

- entities: `point`, `line`, `polyline`, `rectangle` (2-point, centre),
  `circle`, `arc` (3-point, centre), `ellipse`, `polygon`, `slot`, `spline`
  (fit, control, conic), `text`; each returns a handle with its points and
  curves (`plate.top`, `plate.corners[0]`);
- constraints (`k.coincident`, `horizontal`, `parallel`, … every type of the
  schema) and dimensions (`k.dimension(entity | [a, b], value | expression,
  { name })`, a named one becoming a parameter, ADR-0016);
- **the builders the tools use** move from `apps/web/src/sketch/tools/build.ts`
  into `@extrudo/sketch` as a pure `/build` entry (rectangles, slots, polygons
  with their constraints, exactly as the tools make them); the app's tools
  import them from there. One implementation for the UI and the API.
- The builder doesn't solve: positions are stored as given. The app (or the
  CLI's recompute, P5-03) solves on open, and profile IDs don't depend on
  positions. `k.solved()` is not offered in P5-01 (it needs planegcs' WASM; the
  `/solve` entry is P5-02's if scripts need it).

### 6. Docs

- **Reference pages generated** with the methods: `docs/api/features/<type>.md`
  (inputs with types, defaults, descriptions; face roles; an example call), plus
  hand-written `docs/api/README.md` (getting started, determinism, references),
  `docs/api/sketch.md`, `docs/api/references.md`. The staleness test covers the
  generated pages too.
- **Examples that are tests:** `docs/api/examples/*.ts` (the Wall bracket, B1,
  a parametric box with a customizer) run in Vitest; B1's example is recomputed
  headless with the kernel (a test-only dependency) and must give the B1
  fixture's bodies and volumes.
- **The docs site:** the landing page (`apps/site`) builds `docs/api/**/*.md`
  into static pages under `/docs/api/` at build time (a Markdown renderer as a
  build-only dev dependency, MIT or similar on the licence allow-list; no script
  in the pages; the site's stricter `_headers` unchanged), linked from the
  landing page's footer.

### 7. Stability

`API_VERSION = 1` is exported. The generated feature methods follow the
document's feature inputs, which already never break (stored documents migrate,
ADR-0003); a change that would break a call (an input renamed or retyped) gets
the old form accepted and mapped, like a migration, and a line in the docs'
changelog section.

## Slices

1. **Design core:** the package, `Design` (create/from, ids, parameters, commands,
   transactions, validate, toJSON/toFile), generic `add`, refs that need no sketch
   (origin, features, bodies, construction, names), `ApiError`, the generator and
   the generated feature methods with the staleness test, unit tests incl.
   byte-identical determinism.
2. **Sketches:** `@extrudo/sketch/build` (moved from the app, the app's tools use
   it), `SketchBuilder` with entities, constraints, dimensions, profile refs,
   `faceRoles` on every feature definition, `handle.face/edge/vertex`; the
   examples, B1's recomputed headless against the fixture. **Done.**
3. **Docs:** generated reference pages, hand-written pages, the site's
   `/docs/api/` pages, CLAUDE.md, the roadmap tick. **Done.**

## Results: slice 1

The package (`packages/api`, `@extrudo/api`, GPL-3.0-or-later), `Design`, the
references and the generated methods are in, with `pnpm check` green:

- **`Design`** (`src/design.ts`): `create`/`from` (through `loadDocument`, with
  what a newer file carried in `design.notices`), `parameter`/`getParameter`/
  `setParameter`/`removeParameter`, `feature`, `add`, `remove`, `suppress`,
  `rename`, `move`, `group`, `transaction`, `validate`, `toJSON`, `toFile`,
  `design.state` for the rest. Every change is a core command on a
  `DocumentState`; `ApiError` carries the message, the input path, the feature
  type and (from `validate`) the feature's ID.
- **Deterministic IDs** (`src/ids.ts`): a counter per kind — `doc1`, `f1`,
  `p1`, `g1` (and `s1`, `c1`, `d1` for slice 2's sketch entities, constraints
  and dimensions) — seeded from a loaded document so a new ID never collides
  with a stored one. `options.ids` injects a factory. A test builds the same
  design twice and compares `JSON.stringify`, over every benchmark fixture too.
- **References that need no sketch** (`src/handles.ts`, `src/names.ts`): the
  three origin planes, the three axes, `origin.point`, a feature as a
  `{kind:'feature'}` reference, a construction feature's plane/axis/point, a
  feature's own body and the `<feature>:<n>` bodies the document knows, and
  `faceName`/`face`/`edge`/`vertex` building the kernel's persistent names
  (`box:f1:face#1`, `e[...|...]`, `v[...]@n`, `extrude:f1:side:l3`) from the
  grammar in `packages/kernel/src/naming/topo-id.ts`, which the API keeps as
  plain string functions rather than importing (the kernel is off limits, §1).
- **Generated methods** (`src/generate.ts`, `src/generated/features.ts`):
  `pnpm api:generate` reads core's new `documentFeatures()` registry and writes
  one method per type — 37 of the 38; `sketch` is left for slice 2's builder —
  plus the `FEATURE_TYPES` list and `d.add(type, inputs)`. Biome runs over the
  output, and `generated.test.ts` fails when the checked-in file is not what
  the generator writes.

Deviations from the ADR as written:

- **Plain values, not the stored shapes.** §3 says a method's `inputs` is the
  feature's own input type, while §2's example passes `distance: '10 mm'` and
  `edges: [ref]`. The example is what users need, so the signature is
  `PlainInputs<ExtrudeInputs>` — the imported core type mapped to the plain
  value of each input — and a stored input is still accepted, so one call does
  both. To map it, each input schema says what it is under
  `meta({ input: … })` (core's `feature-inputs.ts`), which also lets a call
  refuse `'10 mm'` for an angle input with the schema's own words. A
  `ParameterHandle` stands for its name, so `height: wall` works.
- **`remove` and `move` are the document commands**, so the Remove and Move
  features' methods are `removeBodies` and `moveBodies` (core's own names); the
  generator refuses any future type whose name collides with `Design`'s.
- **`origin.point`** is `{kind:'point', id:'origin:point'}`; the kernel's
  `pointOf` gained that case, so a construction plane through two points can
  use the world origin like the origin planes and axes.
- **A new feature does not hide the sketch it used.** The app's dialog does that
  (a view convenience, `setFeatureVisibility`); an API-built design keeps its
  sketches shown, and `d.suppress` or `Feature.visible` is the caller's.
- **Core changes:** `documentFeatures()` (the registry the kernel and the app
  extend), `export { z }` so a package imports zod only through
  `core/src/zod.ts` (ADR-0067 §H1), `.describe()` on every feature input (293
  of them; the generator fails without one), `meta({ input })` on the shared
  input schemas, a grammar fix in `exprOf`'s message ("a length", not "an
  length"), and `DocumentLoadError` without parameter properties, so a Node
  script can import core's TypeScript directly (`scripts/ts-import.mjs`
  registers a resolver for the extensionless imports; type stripping does the
  rest).
- **Not in this slice:** `faceRoles` per feature and the generated reference
  pages, which are slices 2 and 3 and read this file's structure.

## Results: slice 2

Sketches, face roles and the examples, with `pnpm check` green:

- **`@extrudo/sketch/build`** (`packages/sketch/src/build/`, entry `"./build"`):
  the pure builders the drawing tools already used, moved out of the app — the
  point, line, circle, arc, ellipse, spline and text adders, the placement and
  tangent helpers (`place`, `throughPoint`, `tangentJoin`, `curveEnd`,
  `typedEnd`, `axisOf`), and the three composite shapes extracted from the
  tools that made them: `rectangleEdit` (the 2-point, 3-point and centre modes,
  with their construction diagonals), `slotEdit` (`slotShape`, `slotOutline`)
  and `polygonEdit` (`polygonAround`, `polygonOnEdge`). `BuildIds` is an ID
  factory and the construction flag, which the app's `ToolContext` already is,
  so the tools pass it unchanged and the app's diff is imports only.
- **`d.sketch(plane, build, options?)`** (`packages/api/src/sketch.ts`) runs
  `build` with a `SketchBuilder`: every entity kind of the schema (`point`,
  `line`, `polyline`, `rectangle`, `rectangleCentered`, `circle`, `arc`,
  `arcCentered`, `ellipse`, `polygon`, `polygonOnEdge`, `slot`, `spline`,
  `splineControl`, `conic`, `text`), one method per constraint type, and
  `dimension(target, value, options)` plus `distance`, `radius`, `diameter`,
  `angle` and `reference` for each kind of dimension. Handles carry the points
  and curves (`plate.top`, `rect.corners[0]`, `slot.centerline`); a sketch
  handle carries `profiles()`, `profileAt()`, `profileOrUndefined()`,
  `profilesInside()`, `regions`, `lines()`, `circles()`, `arcs()`, `points()`
  and `entity(id)`. **Nothing is solved**: positions are stored as given.
- **`faceRoles`** on core's `FeatureDefinition` (`packages/core/src/face-roles.ts`):
  a list of `{ pattern, description }` filled in for every body-making feature
  from what its kernel evaluator really names — the shared `SWEEP_FACE_ROLES`
  and `KEEPS_FACE_ROLES` where the naming is the same, and each feature's own
  list where it isn't (`fillet:from:(<edge>)`, `shell:inner|rim|round`, the
  primitives' `side:front|right|back|left`, `hole:side:<segment>`,
  `thread:side:<piece>`, the patterns' `<label>:from:(<face>)`,
  `split:cut:above|below`, `import:face:<n>` and `import:mesh`). The role is
  matched with `matchesFaceRole`, `ownFaceRole` reads it out of a name, and a
  kernel test (`features/face-roles.test.ts`) builds one of every feature —
  through the benchmark fixtures, which between them use most of them, and
  hand-built cases for sphere, torus, Move, Scale, Split Body, Place on Bed,
  Offset Face, Draft and the rib — and checks every face name a feature makes
  is one of its definition's patterns.
- **Generated with it**: `FaceRoleName<T>` and `FeatureFaceRoles` in
  `generated/features.ts` type `handle.face(role)`/`faceName(role)`, with a
  `<…>` as a template literal (`` `side:${string}` ``), and each method's doc
  comment lists the roles with a line each.
- **Configurations** (ADR-0059): `d.configuration(name, values)` and
  `d.applyConfiguration(name | id)`, which the parametric box example needs;
  the document's own types are re-exported so a script imports nothing else.

Deviations and what changed under the ADR's letter:

- **`insertFeature` then one `modifySketch`**, not a single insert: the sketch
  feature is created empty and `build` fills it through core's
  `modifySketch`, so core checks the whole change (references, parameter
  names) exactly as it does the app's, and a throw inside `build` rolls the
  whole call back. It is one undo step either way (`d.transaction`).
- **New driving dimensions take the next model parameter name** (`d1`, `d2`, …)
  as the app's host gives them, which is what makes an API-built sketch's
  dimension names match a drawn one's; `{ name }` gives one a name of its own.
- **`d.configuration`/`d.applyConfiguration`** are not in §2's list; slice 2's
  third example needs them, and a public API with a configuration feature and
  no way to set one would be odd.
- **`profileAt(point)` throws** where there is no profile (a design needs the
  profile it picked); `profileOrUndefined` asks without throwing. `profileAt`
  also returns the reference rather than `| undefined`.
- **`ExprValue` includes a `ParameterHandle`** (it already worked at runtime in
  slice 1 but was missing from the type), so `d.box({ length: width })` checks.
- **`documentFeatures()` gained `import` and `canvas`** (P4-06, ADR-0066), with
  `.describe()` on their inputs so the generator passes, and the `import`
  feature's `faceRoles` (`face:<n>`, `mesh`). `@extrudo/kernel` is a
  devDependency of the API package, for the tests that recompute a design
  headless and nothing else.
- **`p5-01-api/vitest.config.ts`** and a `paths` entry in the API's tsconfig
  resolve `@extrudo/api` for the examples under `docs/api/examples`, which are
  outside every package and import the package by its own name.
- **B1 has no bodies**: the benchmark is a sketch (requirements §7: "sketch,
  constraints, dimensions, parameters"), and the fixture the e2e spec exports
  is that sketch. The example therefore extrudes the plate as well, 10 mm, and
  the test compares the *sketch* with the fixture's up to its IDs (identical)
  and the recomputed solid with the analytic volume of a 120 × 80 × 10 mm plate
  less four Ø6 holes, to 1e-6.
- **Not in this slice:** the generated reference pages and the site's
  `/docs/api/` pages, which are slice 3.

## Results: slice 3

The reference and the pages it is published as, with `pnpm check` green:

- **Generated pages** (`packages/api/src/pages.ts`, written by
  `docPages()` in `generate.ts`): `docs/api/features/<type>.md` for all 40
  feature types plus `docs/api/features/README.md`, which lists them by category.
  A page holds the label and type, the method's signature, an inputs table (name,
  the plain value a call passes, required or the default its description names,
  the description itself), the face roles with a line each, the example call and
  three links. Everything comes from the registry: the type column is read off the
  stored input's own shape (`kind` says expr / ref / enum / bool / file /
  sketchData, and the metadata gives the unit and the reference kinds), and a
  default is the "Default …" sentence the schemas already carry, so the page
  cannot say something the schema does not.
- **Examples that are checked.** `packages/api/src/example-calls.ts` holds the
  preamble every page shows (a design, a box and a cylinder, a sketch with two
  profiles and a guide line, the references) and one call per feature type. The
  generator writes them into `generated/features.ts` as `featureExamples(d)`, so
  `pnpm typecheck` checks them, and `docs.test.ts` runs that function against a
  real `Design` and checks every feature came out valid. A page's example block
  is the same text (`exampleBlock`), which a test compares, so the page and the
  checked code cannot drift. The generator refuses a new feature type with no
  example, and one whose example leaves out a required input.
- **Hand-written pages**: `docs/api/README.md` (what it is, getting started,
  determinism and IDs, units and expressions, the references table, the rest of
  `Design`, stability), `docs/api/sketch.md` (the plane, every entity with the
  handle it returns, the constraints, the dimensions, the profiles) and
  `docs/api/references.md` (every helper that builds a reference, the naming
  grammar, what a name the kernel cannot resolve does). `docs.test.ts` compiles
  every ```ts block of the three with the package's own strictness, and checks
  that every relative link names a page that exists.
- **The site** (`apps/site`): `src/docs.ts` reads `docs/api/**/*.md`, reads the
  front matter (`title`, `section`, `category`, `order`), rewrites relative links
  to the addresses they became and renders the rest to HTML with `marked`;
  `src/docs-plugin.ts` emits one `index.html` per page under `dist/docs/api/…`,
  the brand's stylesheet (the landing page's `tokens.css`, now a file of its own
  both import) and the two font faces, all with Vite's hashed names. A sidebar
  (the guide pages, then the features by category) is in every page, and the
  landing page's footer links to `/docs/api/`. `e2e/site.spec.ts` walks it: the
  footer's link, the index, a feature page's inputs table, face roles and example
  code, no script in the page, no console error and no policy violation, plus an
  axe audit of both themes.
- **`pnpm api:generate --check`** now really checks (it compared against
  `undefined` before), and covers the pages as well as the methods; it is what a
  developer or CI runs to see whether anything is stale.

Deviations and additions under the ADR's letter:

- **A file input takes an attachment ID as a string.** `import` and `canvas` need
  an attachment (ADR-0061), and their stored type is a branded `AttachmentId`, so
  a call could not name one without a cast. `PlainInputs` now maps a file input to
  `string` and `storedInputs` fills the stored shape in, exactly as it does for
  the other plain values; `AttachmentId` and `Attachment` are re-exported from the
  API for anyone who wants the type.
- **No prose per feature.** The registry has no description of a feature, only its
  label and category, so a page's lead says what a call adds, how the name follows
  and what `options` holds, and the inputs do the rest. A `description` on
  `FeatureDefinition` would improve every page and every method's doc comment; it
  is the natural next thing to add when someone writes 40 sentences.
- **`constructionRef()` returns `GeomRef | undefined`**, so the pages show the
  one check a script needs before using it. A narrower method per construction
  type would be nicer, but it is a change to slice 2's API, not to the docs.
- **`marked` is a build-only dependency of `@extrudo/site`** (MIT, §6's "a Markdown
  renderer as a build-only dev dependency"). Nothing of it is in the shipped
  pages, so `scripts/check-licenses.mjs` (which reads `--prod`) and `NOTICE` are
  unchanged; both say so here instead. Code blocks are plain `<pre>`: no client
  highlighter, which the ADR's "no script in the pages" asks for anyway.
- **The pages are Markdown in the repository**, with a small front matter block at
  the top of each (`title`, `section`, `category`, `order`) for the sidebar. GitHub
  reads that as metadata, and it is what lets `apps/site` stay free of internal
  packages (ADR-0057): it reads files, not core's registry.
- **Keyboard reachability** (axe, WCAG 2.1): the sidebar, the tables and the code
  blocks scroll, and a scrollable region a keyboard cannot reach fails
  `scrollable-region-focusable`, so they carry `tabindex="0"` — the one thing that
  needs no script.

## Rejected

- **A hand-written API per feature:** drifts from the registry with every new
  input; the generator plus a staleness test keeps them one.
- **Random IDs (`newId()`) in the API:** a script re-run on every recompute would
  give its features new IDs each time, and everything downstream would lose its
  references.
- **Computing geometry in the API** (face names from a recompute, solved
  sketches): pulls OCCT and planegcs into every consumer, including the
  sandboxed script worker; names and profile IDs are computable without them.
- **Exposing core's commands directly as the API:** commands are internal
  (payload shapes, patches), change with the app, and are a poor read for users;
  the API wraps them and stays stable.

## Deferred

- `k.solved()` / a `/solve` entry (planegcs), if P5-02 needs solved positions in
  scripts.
- A dimension's label placement: the API stores where the Dimension tool put
  it, and a builder's dimension takes the default spot, as a typed one does.
- Reading computed results (bodies, volumes, face lists) through the API: the
  CLI's (P5-03) `compute()`.
- Typed handles for every sub-shape of every feature beyond the documented roles.
