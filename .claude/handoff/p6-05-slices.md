# P6-05 Components: slice plan

Design: `docs/adr/0081-components.md` (read it first; section numbers below are
its §§). Every slice is its own branch off `main` (`p6-05-s<n>-<slug>`), merges
alone, ticks nothing in the roadmap until S9, and adds one `docs/CHANGELOG.md`
line. Every slice: `pnpm check` passes; slices with UI run their own e2e specs
locally (`--workers=2`) and the full suite through CI on the branch.

## Order and parallelism

```
S1 core model ──┬── S3 browser & membership ──┬── S4 active & isolation ──┐
S2 kernel origins┘   (S2 optional for S3)     ├── S5 placement           ├── S9 print info, guide, close
                                               ├── S6 3MF + export dialog ─┤
                    S7 STEP assemblies (facade, after S1) ─────────────────┤
                                                 S8 API/emitter/CLI (after S1, S2, S6, S7)
```

- **S1 ∥ S2** (S2 touches only the kernel and core's `ModelState`).
- After S3: **S4 ∥ S5 ∥ S6**. **S7** needs only S1 and can start as soon as S1
  merges (its OCCT rebuild takes ~15 min in CI: start it early).
- **S8** after S1, S2, S6, S7. **S9** last.

| Slice | Complexity | Model |
|---|---|---|
| S1 core model | architecture, schema, file format | strongest (Opus) |
| S2 kernel origins | engine plumbing, kernel | strongest (Opus) |
| S3 browser & membership | well-specified UI | Sonnet |
| S4 active component & isolation | well-specified UI, many call sites | Sonnet |
| S5 placement | core + kernel input + dialog | Opus (kernel part) |
| S6 3MF + export dialog | io writer/reader + UI | Sonnet |
| S7 STEP assemblies | C++ facade, OCCT build | strongest (Opus) |
| S8 API, emitter, CLI | generator, round-trip tests | Opus |
| S9 Print Info, guide, close | small UI + docs | Sonnet (Haiku would do the docs) |

Conventions used below: "one step" = one undo step; IDs come from `newId()` in
the caller (ADR-0003); a "notice" is a `push` to the toasts' store.

---

## S1: core model (`p6-05-s1-core`)

**Files**
- `packages/core/src/ids.ts`: `ComponentIdSchema = id.brand<'ComponentId'>()`,
  `type ComponentId`.
- `packages/core/src/schema.ts`: `ComponentSchema` (§2, with doc comments in
  the file's style), `components: z.array(ComponentSchema).optional()` on
  `DocumentSchema` (after `groups`), `component: ComponentIdSchema.optional()`
  on `BodyMetaSchema` and `FeatureSchema`. In `superRefine`: add
  `['components', 'id', …]` and `['components', 'name', …, (n) => n.toLowerCase()]`
  to `unique`; a new `reportComponentRefs(ctx, doc)` adds an issue at
  `['bodies', <id>, 'component']` / `['features', i, 'component']` for a
  component that doesn't exist ("names component cmpX, which the design
  doesn't have"), and at `['components', i, 'ghost']` for `ghost` with
  `visible: true`.
- **New** `packages/core/src/components.ts` (export everything from `index.ts`):

```ts
export type BodyOrigins = Readonly<Record<BodyId, BodyId>>;

/** §2's rule: stored meta, else the piece's source, else the making feature's stamp. */
export function componentOfBody(
  doc: Pick<ExtrudoDocument, 'bodies' | 'features'>,
  id: BodyId,
  origins?: BodyOrigins,
): ComponentId | undefined;
// - doc.bodies[id] exists → its .component (undefined = loose)
// - origins?.[id] → componentOfBody(doc, origins[id], origins), guarding cycles
//   with a visited set (a cycle → undefined)
// - feature = id up to the last ':'; doc.features.find(f => f.id === feature)
//   ?? the feature scriptOfGenerated(feature, ids) names → its .component
// - else undefined

/** The making feature's stamp alone (rule 3), for the emitter. */
export function stampOfBody(doc: Pick<ExtrudoDocument, 'features'>, id: BodyId): ComponentId | undefined;

/** Live bodies grouped: components in `doc.components` order (empty ones too), then loose. */
export function componentMembers(
  doc: Pick<ExtrudoDocument, 'bodies' | 'features' | 'components'>,
  live: readonly BodyId[],
  origins?: BodyOrigins,
): { components: { id: ComponentId; bodies: BodyId[] }[]; loose: BodyId[] };

/** "Component1", "Component2"…: the lowest number no component's name uses. */
export function newComponentName(doc: Pick<ExtrudoDocument, 'components'>): string;
/** "Lid (2)", "Lid (3)"…: the lowest free copy name of `name`. */
export function copyComponentName(doc: Pick<ExtrudoDocument, 'components'>, name: string): string;

/** How a body is drawn given its component (§6): component hidden wins, then ghost. */
export function effectiveBodyDisplay(
  meta: BodyMeta | undefined,
  component: Component | undefined,
): 'shown' | 'ghost' | 'hidden';
// component hidden (visible false, no ghost) → 'hidden'
// component ghost → bodyDisplay(meta) === 'hidden' ? 'hidden' : 'ghost'
// else bodyDisplay(meta)
```

**Commands** (in `components.ts`, `defineCommand`, each one step):

| Command | Payload | Label | Rules |
|---|---|---|---|
| `addComponent` | `{ id: ComponentId; name?: string; bodies?: BodyId[] }` | "New component" | name trimmed, default `newComponentName`; refuse empty, > 100 chars, or a duplicate (case-insensitive): `CommandError("There is already a component named Lid.")`; appends to `components`; listed bodies join it; a body with no metadata gets `{ name: newBodyNames(...)[id], visible: true, component }` |
| `renameComponent` | `{ id; name }` | "Rename component" | same name rules (its own name, other case, allowed) |
| `removeComponent` | `{ id }` | "Delete component" | removes the record, deletes `component` from every body meta and feature naming it; drops the `components` key when empty |
| `setBodyComponent` | `{ ids: BodyId[]; component: ComponentId \| null }` | "Move to component" / "Remove from component" | unknown component → `CommandError`; `null` deletes the key; a body with no metadata gets a name as in `addComponent` |
| `setComponentDisplay` | `{ ids: ComponentId[]; display: 'shown' \| 'ghost' \| 'hidden' }` | "Show/Ghost/Hide component(s)" | pair rule as `updateBody` |
| `setFeatureComponent` | `{ id: FeatureId; component: ComponentId \| null }` | "Change component" | unknown component or feature → `CommandError`; `null` deletes the key. Used by Copy Component (S5) inside its dialog's transaction |

`restoreVersion` needs nothing (it replaces the document).

**Tests** (`packages/core/src/components.test.ts`):
- `componentOfBody`: stored meta wins over a stamp; stored meta without
  `component` is loose; unstored body takes its feature's stamp; a piece takes
  its origin's component through two levels; a cycle in `origins` gives
  `undefined`; a script's generated feature (`S1.f1:0`) takes the Script's stamp;
  an unknown feature gives `undefined`.
- `componentMembers`: order, empty components listed, loose last, dead bodies'
  metadata not listed.
- `newComponentName` skips taken numbers; `copyComponentName` gives "(2)", then
  "(3)" when "(2)" exists, case-insensitively.
- `effectiveBodyDisplay`: the 3 × 3 table.
- Each command: happy path, refusals, undo restores exactly (`DocumentState`
  undo, compare `toEqual`), `removeComponent` clears body and feature stamps,
  `setFeatureComponent` sets and clears a stamp.
- `schema.test.ts`: duplicate component IDs, duplicate names in other case, a
  body or feature naming a missing component, `ghost` with `visible: true`: each
  one issue at the path above; a document without `components` still loads.
- `migrations.test.ts`/lenient reading: a document with the three keys read by
  a reader whose schema lacks them (simulate with `loadDocument` on a schema
  copy, as the existing lenient tests do) drops exactly those paths.

**Docs**
- `docs/file-format.md`: §3's additive list gains `components`,
  `bodies[..].component`, `features[..].component`; §4.2 a `component` row;
  new **§4.7 `components[]` (Component)** (table of the four fields, the
  uniqueness and reference rules, "membership lives on the body", "no transform:
  placement is the timeline's"); §6's common feature fields table a `component`
  row ("the component the feature's new bodies join; the app stamps the active
  component"); §10 `ComponentId`. `file-format-doc.test.ts` must pass.
- `docs/02-architecture.md` document-model section: one paragraph pointing at
  ADR-0081.

**Acceptance**: `pnpm vitest run packages/core packages/storage` green;
`pnpm check` green; no other package changes.

---

## S2: kernel origins (`p6-05-s2-origins`)

**Files**
- `packages/kernel/src/recompute/types.ts`: `FeatureOutput.origins?: ReadonlyMap<BodyId, BodyId>`
  ("a new body ID → the body it was broken off; only for pieces of a body that
  existed before this feature"); `RecomputeResult` (`done`) gains
  `origins: Record<BodyId, BodyId>`.
- `packages/kernel/src/features/bodies.ts` `splitSolids`: for each piece with
  a fresh ID whose source `id` is a key of `ctx.bodies` (existed before the
  feature), record `piece → id`; return `{ ...output, origins }` merged with any
  `output.origins`. Pieces of a body the feature itself made get no origin.
- `packages/kernel/src/features/split-body.ts` (the ID at line ~86): record
  `extra → source body` for every half that gets a fresh ID.
- `packages/kernel/src/recompute/engine.ts`: keep a `Map<BodyId, BodyId>` for
  the walk, add each evaluated or cached output's `origins` after the feature,
  never prune within a walk; put it on the result as a plain record. Previews
  ignore it. Cache entries keep `origins` with the output (it is part of the
  output, so cache hits replay it).
- `packages/core/src/stores.ts`: `ModelState.origins: BodyOrigins` (default
  `{}`), `computed({ …, origins? })`.
- `packages/kernel/src/recomputer.ts`: pass `result.origins` to `computed`.
- `packages/cli/src/headless.ts`: keep the last result's `origins` for S8
  (a private field; no output change yet).

Do **not** add origins in transform/pattern/mirror/scale/import/operate: those
IDs are copies or new bodies (ADR §2 rule 3).

**Tests**
- `packages/kernel/src/features/origins.test.ts` (real OCCT, `strictLeaks`):
  a box cut through the middle by an extrude: result `origins` maps
  `<cut>:1 → <box>:0`; a cut whose own new body splits (a join making two
  pieces of a new body) gives no origin; Split Body by YZ maps the second half;
  a cached second recompute (`stats.reused > 0`) gives the same `origins`; a
  Move copy gives none.
- `recomputer.test.ts`: `ModelState.origins` after a recompute.
- Golden tables unchanged (`pnpm vitest run packages/kernel/src/features` with
  no `-u`).

**Acceptance**: kernel and core tests green, `fuzz.test.ts` green, no golden
file rewritten.

---

## S3: browser and membership (`p6-05-s3-browser`, after S1)

**Files**
- `apps/web/src/shell/bodies.ts`:
  - `BodyEntry.component?: ComponentId` (effective, from `componentOfBody` with
    `model.origins` — `{}` if S2 isn't merged) and `display` from
    `effectiveBodyDisplay`.
  - `followBodyNames`: a missing body's stored meta gets
    `component: componentOfBody(doc, id, origins)` when defined (same amend).
  - `BodyActions` gains `moveToComponent(ids, component: ComponentId | null)`
    and `newComponent(ids)` (dispatches `addComponent` with `newId()`, returns
    the ID).
- **New** `apps/web/src/components/` (the app's component code):
  - `componentActions.ts`: `interface ComponentActions { rename(id, name): boolean;
    setDisplay(ids, display): void; remove(id): void; select(id, mode: SelectMode): void;
    newComponent(bodies: readonly BodyId[]): ComponentId | undefined }` and
    `createComponentActions(stores, members, notify)`. `select` puts
    `{ kind: 'body', id }` for every live member into the session selection.
    `remove` toasts "Deleted Lid. Its bodies stay in the design." (info).
  - `componentRows.ts` (pure): `componentRows(doc, entries)` →
    `{ component: Component; bodies: BodyEntry[]; display }[]` plus `loose`.
- `apps/web/src/shell/BrowserPanel.tsx`: inside the Bodies folder, before the
  loose rows, a nested `Folder` per component row: label = name (rename on F2 /
  double-click, the body row's popover), count badge = live bodies, eye cycles
  `nextBodyDisplay`, `defaultOpen` true, its rows the body rows as today. Row
  attributes: `data-component="<id>"`, `data-component-display="shown|ghost|hidden"`.
  Body rows add `data-body-component="<id>"` when in one. Drag: body rows are
  `draggable`; dropping on a component row → `moveToComponent(ids, id)`,
  on the Bodies folder's header → `null` (all selected body rows move if the
  dragged one is selected). The folder count badge stays the number of live
  bodies.
- Menus (`FeatureMenu.tsx` pattern, design-system `ContextMenu`):
  component row: Rename, Show/Show as Ghost/Hide (the states it is not in),
  Delete Component (S4 adds Activate/Isolate, S5 Move/Copy, S6 Export);
  body row: "Move to Component ▸" (each component except its own, "New
  Component…", "No Component" when in one).
- `apps/web/src/shell/tools.ts`: `TOOLS` entry `newComponent` (label "New
  Component", short "Component", category `construct`; icon `component`, a new
  icon in the icon pipeline: a cube with a smaller cube attached), Solid tab
  group `{ label: 'Component', tools: ['newComponent'] }` after Program.
  `shell/commands.tsx`: command `newComponent` (Ctrl+K "New Component"),
  `available` in model mode; runs `newComponent(selected body IDs)`.
  `commands/keymap.ts`: no key. `contextEntries.tsx`: entry
  `[data-marking-entry="newComponent"]` when bodies are selected.
- Viewport: `Bodies.tsx`/`GhostBodies` read the effective display (body rows'
  `display`) instead of `bodyDisplay(meta)`; the Viewport region gains
  `data-components="Lid:Body1,Body2;Box:Body3"` (component name `:` its live
  body names, `;` between, in browser order, spaces as `_`, absent with no
  components).
- `pnpm docs:generate` (the new tool page `docs/guide/tools/newComponent.md`).

**Tests**
- `components/componentRows.test.ts`, `componentActions.test.ts` (select puts
  bodies; remove dispatches one step; rename refusal returns false and
  notifies).
- `shell/bodies.test.ts`: `followBodyNames` stores the stamped component, the
  origin's component for a piece (fake `origins`), nothing for a loose body.
- `shell/commands.test.ts`: `newComponent` listed in model mode only.
- `tooltips.test.ts`/`toolDocs.test.ts` stay green.
- **e2e `e2e/components.spec.ts`** (new): two Box primitives (`primitive(page,
  'Box', …)` twice, the second at X 40); select both browser rows
  (`selectBodies`), `pickTool(page, 'New Component')` →
  `data-components="Component1:Body1,Body2"`; rename via F2 to "Lid" →
  `Lid:Body1,Body2`; drag Body2's row onto the Bodies folder header →
  `Lid:Body1`; body menu "Move to Component › Lid" → back; the component eye
  once → `data-component-display="ghost"` and `data-ghost-bodies` lists both,
  twice → hidden and `data-bodies` lacks them, thrice → shown; Delete
  Component → `data-components` absent, both bodies still in `data-bodies`;
  Ctrl+Z → back. A click on the component row → `data-model-selection` holds
  `body:<id>` for both.

**Acceptance**: the spec green with `--repeat-each=2`; `bodies.spec.ts`,
`a11y.spec.ts` (add the browser with a component to the audited screens),
`shell.spec.ts` screenshots unchanged (no components in them).

---

## S4: active component and isolation (`p6-05-s4-active`, after S3)

**Files**
- `packages/core/src/stores.ts` `SessionState`: `activeComponent: ComponentId | undefined`,
  `isolatedComponent: ComponentId | undefined`, `activateComponent(id | undefined)`,
  `isolateComponent(id | undefined)`. Both survive `enterSketch`/`exitSketch`.
- **New** `apps/web/src/components/active.ts`:
  `withActiveComponent(feature: Feature, session: SessionStore): Feature`
  (returns the feature with `component` set when one is active and the feature
  has none) and `followComponentSession(store, session): () => void` (clears
  `activeComponent`/`isolatedComponent` when the document no longer has them;
  started where `followBodyNames` is).
- Stamp at **every app insert** (all go through `insertFeature`):
  `features/dialog.ts` (the new-feature commit, ~line 871), `sketch/mode.ts`
  (Create Sketch), `plugins/runCommand.ts` (each reminted feature),
  `macro/macro.ts` (both inserts), `shell/bodies.ts`'s Remove feature (harmless,
  keeps the rule "every insert"). Add a unit test
  `components/stamping.test.ts` that reads those five files' sources (Vite's
  `?raw` import) and fails if an `insertFeature(` appears in a file of
  `apps/web/src` that is not on the list, or one on the list lacks
  `withActiveComponent` — so a later insert site can't forget it.
- Browser: component row menu gains Activate / Deactivate and Isolate / Exit
  Isolation; the active row shows a filled dot before its name
  (`data-component-active` on the row); while isolated, other rows get
  `data-isolated-out` and 50 % opacity.
- Status bar (`Timeline`'s bottom row, before the kernel state): an output
  `[data-active-component]` "Active: Lid" (absent with none) whose click opens a
  small menu with Deactivate.
- Viewport: while `isolatedComponent` is set, `Bodies`, `GhostBodies` and the
  pick scene take only that component's bodies; a bar at the view's top centre
  (`[data-isolation-bar]`, role `status`, "Showing Lid only" + button "Exit
  isolation"); the Viewport region gains `data-isolated="Lid"` and
  `data-active-component="Lid"` (both absent when unset). Fit (F6) fits the
  isolated bodies.
- Commands in `buildCommands`: `activateComponent` / `deactivateComponent` /
  `isolateComponent` / `exitIsolation` (Ctrl+K, group "Solid › Component";
  activate/isolate act on the component of the selected bodies when they all
  share one, else `unavailable`). New Component (S3) activates what it made.
- Timeline chip tooltip: "In Lid" line for a stamped feature.

**Tests**
- `stores.test.ts`: the two fields, kept across sketch mode.
- `components/active.test.ts`: stamp with/without active, existing stamp kept;
  `followComponentSession` clears after undo of `addComponent`.
- `components/stamping.test.ts` as above.
- **e2e** in `e2e/components.spec.ts`: Activate "Lid" → `data-active-component`;
  a Cylinder primitive → `data-components` lists it under Lid; Deactivate, a
  Sphere → loose; Isolate Lid → `data-isolated="Lid"`, `data-bodies` lists only
  Lid's bodies, a click where the sphere was selects nothing; Exit isolation →
  all back; Ctrl+Z of New Component clears the active marker.

**Acceptance**: spec green ×2; `marking-menu.spec.ts`, `timeline-v2.spec.ts`
green.

---

## S5: placement (`p6-05-s5-placement`, after S3; ∥ S4, S6)

**Files**
- `packages/core/src/place-on-bed.ts`: `carry: refsOf(['body']).optional()
  .describe('Bodies that take the same turn and drop as the face\'s body (a
  component placed as one). Only with one face.')`; `placeOnBedInputs(faces,
  spin?, carry?)`. `pnpm api:generate` (the page and the example gain nothing
  required).
- `packages/kernel/src/features/place-on-bed.ts`: with `carry`, exactly one face
  else `KernelError("Pick one face to carry other bodies with it.")`; a carried
  body that owns the face → `KernelError("Body2 is the face's own body: it moves
  anyway.")`; the face body's matrix applied to every carried body through the
  same `transformBodies(…, 'placeOnBed')` call; the below-bed warning checks
  carried bodies too. Golden table: add two rows (`-u` and review).
- `apps/web/src/features/place-on-bed.ts`: field `carry` ("Carry along", a
  body selection field, shown always, optional).
- `apps/web/src/components/placement.ts`: `moveComponent(id)` (selects the
  live members, runs the `move` tool), `copyComponent(id)` and
  `placeComponentOnBed(faceRef)`. **Copy Component** starts the Move dialog
  through `startSpec` with a derived spec `{ ...moveSpec, initialValues: () =>
  ({ bodies: <the members>, copy: true }), commitWith: (values, ctx) => [
  ...(moveSpec.commitWith?.(values, ctx) ?? []), addComponent({ id, name:
  copyComponentName(doc, name) }), setFeatureComponent({ id: <the new
  feature's ID>, component: id }) ] }`, so OK makes the Move, the component and
  the stamp in **one step** and Cancel leaves nothing. `DialogContext` has no
  draft ID today: add `featureId: FeatureId` (the draft's ID in create mode,
  the edited one's otherwise) to it in `features/dialog.ts`'s `context()`.
  `ids` are `newId()` when the command runs. Refuse (toast "Lid has no bodies to
  copy.") when the component has no live bodies.
- Menus: component row Move Component, Copy Component; context entry
  `[data-marking-entry="placeComponentOnBed"]` on a flat face of a body in a
  component (beside `placeOnBed`).
- `docs/file-format.md` §6.15: the `carry` row.

**Tests**
- `packages/kernel/src/features/place-on-bed.test.ts`: two boxes, face on one,
  the other carried: same matrix (compare bounding boxes), names kept; errors
  above; warning when the carried body ends below.
- `packages/core/src/place-on-bed.test.ts`: inputs helper with carry.
- `components/placement.test.ts`: copy's derived spec's `commitWith` returns
  `addComponent` then `setFeatureComponent` for the draft's ID, and OK through
  the controller (fake recomputer, as `dialog.test.ts` does) leaves one undo
  step whose undo removes feature and component; move selects members.
- **e2e** `e2e/components-placement.spec.ts`: a two-box component "Lid";
  Move Component, dx 30 → both boxes' x shifted (read `data-bodies` box sizes
  stay, positions from a 3MF export as `move-mirror.spec.ts` does); Copy
  Component, OK with dx 60 → `data-components` has `Lid_(2):Body3,Body4`;
  Place Component on Bed on the lid's side face (Shift+6 view as in
  `print-aids.spec.ts`) → both bodies' min z = 0 in the 3MF.

**Acceptance**: specs green; the place-on-bed golden diff reviewed; fuzz green.

---

## S6: 3MF and the Export dialog (`p6-05-s6-export`, after S3; ∥ S4, S5)

**Files**
- `packages/io/src/threemf.ts`:
  - `ThreeMfOptions.assemblies?: readonly { name: string; parts: readonly number[] }[]`
    (indices into `objects`; an index in two assemblies throws). `modelXml`:
    mesh objects as today; after them one `<object id type="model" name>` per
    assembly with `<components>` of `<component objectid="…"/>` (no transform);
    build items = assemblies in order, then objects in no assembly, in order.
    Without `assemblies` the XML is **byte-identical** (test).
  - `read3mf`: read `<components>`/`<component objectid transform>` and item
    `transform`; `ThreeMfModel.items` gains the expanded mesh list per item
    (`{ objectId, meshes: { object: ThreeMfObject; transform?: number[] }[] }`).
    Keep existing fields.
- `packages/kernel/src/features/import.ts` (3MF branch): build bodies from the
  build items' expanded meshes (transform applied), so a grouped file's parts
  are bodies. A file without components imports exactly as before (fixtures).
- `packages/kernel/src/model-export.ts`: `ExportBody.component?: { id; name }`;
  `meshBytes(meshed, format, { …, groupComponents?: boolean })` passes
  `assemblies` for 3MF when true; `modelFileName` uses "<project> -
  <component>" when every chosen body is in one component and there is more than
  one body.
- `apps/web/src/export/ExportModelDialog.tsx`: body checkboxes grouped under
  component headings (a heading's checkbox, name "Lid (component)", tri-state
  through `aria-checked="mixed"`); a checkbox **"Keep components together"**
  (shown when a chosen body is in a component; preference `export.model`'s new
  `groupComponents`, default `true`; applies to 3MF here and to STEP from S7);
  `data-export-summary` appends ", 2 components" when grouped.
- `components/` menu: Export Component… opens the dialog with the members
  chosen (`BodyActions.exportBodies`).
- Fixture `fixtures/imports/two-components.3mf` written by a test with
  `WRITE_FIXTURES=1` (two assemblies of two cubes each, one loose).

**Tests**
- `packages/io/src/io.test.ts`: assemblies XML (ids, items order), byte
  identity without, duplicate index throws; `read3mf` of the fixture: 3 items,
  2 + 2 + 1 meshes; a `transform` on a component moves the mesh.
- `kernel/src/features/import.test.ts`: the fixture → 5 bodies.
- `export/modelExport.test.ts`, `ExportModelDialog.test.tsx`: grouping,
  preference remembered, file name.
- **e2e** `e2e/export-3d.spec.ts` new test: a component of two boxes and a loose
  sphere → 3MF: read with `read3mf`, 2 build items, the first with 2 meshes;
  unchecking "Keep components together" → 3 items.

**Acceptance**: specs green; `import-mesh.spec.ts` green. **Owner check (Arch
workstation)**: `prusa-slicer --info` on the e2e's file shows 2 objects, the
component with 2 parts; Orca loads it as one object with parts.

---

## S7: STEP assemblies (`p6-05-s7-step`, after S1)

**Files**
- `packages/kernel/occt/facade/extrudo_facade.cpp`: `clearStepGroups()`,
  `pushStepGroup(int group)` (one per staged shape, −1 = none) and
  `pushStepGroupName(const char* name)` (one per group index, in order). In
  `writeStep()`: when any group ≥ 0 → new `writeStepAssembly()`: one XCAF
  document as `writeStepXde`; per group `shapes->NewShape()` named with
  `TDataStd_Name::Set(label, TCollection_ExtendedString(name))`; per part
  `AddShape(shape, false, false)`, colour as today, name, then
  `shapes->AddComponent(groupLabel, partLabel, TopLoc_Location())`; parts with
  group −1 transferred as free shapes; `shapes->UpdateAssemblies()`;
  `writer.SetNameMode(true)`; transfer each free label (groups in order, then
  loose parts). Names arrive already STEP-encoded from TS (`stepString`, `\X2\`
  ASCII), so check in the native harness that OCCT writes them literally (no
  doubled backslash); if it escapes them, fall back to renaming products after
  transfer as `nameStepProduct` does, walking `PRODUCT` entities in transfer
  order. Ungrouped paths untouched. Clear groups in `clearExport`'s neighbours
  as names/colours are.
- `packages/kernel/src/kernel.ts` `writeStep(parts, groups?: readonly string[])`:
  parts gain `group?: number`; stages groups only when some part has one.
- `packages/kernel/src/model-export.ts` / `service.ts`:
  `StepBody.component?: string`; `exportStep(bodies)` groups by component name
  in first-seen order when any body has one.
- Export dialog (if S6 merged; else S6 picks it up): STEP passes `component`
  when "Keep components together" is on.
- Native harness `spikes/p6-05-step-assembly/` (`run.sh`), as
  `spikes/p4-12-*`: write two groups + a loose part, read back with
  `STEPCAFControl_Reader`, print the label tree.
- CI: push the branch, `gh workflow run ci.yml --ref p6-05-s7-step`, wait for
  `occt-<hash>`, `pnpm occt ensure`. Update CLAUDE.md's WASM size line and
  hash.

**Tests** (`packages/kernel/src/export.test.ts`):
- grouped export text has `PRODUCT('Lid'` and `NEXT_ASSEMBLY_USAGE_OCCURRENCE`
  twice (two parts under Lid), the loose body's product top-level; non-ASCII
  "Deckel ö" round-trips as `\X2\00F6\X0\`; `readStep` gives 3 solids and
  `readStepColors` the parts' colours; an ungrouped export is byte-identical to
  the existing golden; `memory.test.ts`-style 300 grouped writes with no heap
  growth beyond the existing STEP test's bound.
- e2e `export-3d.spec.ts`: STEP with a component contains the assembly product.

**Acceptance**: CI's `occt` job publishes; kernel tests green; `import-step.spec.ts`
green (our grouped STEP imports back as 3 bodies with colours).

---

## S8: API, emitter, CLI (`p6-05-s8-api`, after S1, S2, S6, S7)

**Files**
- `packages/api/src/ids.ts`: `IdKind` `'component'`, prefix `cmp`; `storedIds`
  includes component IDs.
- `packages/api/src/handles.ts`: `class ComponentHandle { readonly id; get name();
  add(...bodies: (GeomRef | string)[]): this; bodies(): string[] }` (stored
  members only; `add` dispatches `setBodyComponent`).
- `packages/api/src/design.ts`: `component(name: string, options?: { id?: string;
  bodies?: (GeomRef | string)[] }): ComponentHandle` and the overload
  `component(name, build: (c: ComponentHandle) => void, options?)`: features
  added inside `build` default to it (a stack, nested calls allowed, innermost
  wins); `components(): ComponentHandle[]`; `FeatureOptions.component?:
  ComponentHandle | string` (ID or name; unknown → `ApiError` path
  `component`); `SketchOptions.component` likewise; `add()` sets
  `feature.component`.
- `packages/script`: `methods.ts` refuses `component` ("A script can only add
  features: component") and a `component` option on any call ("A script's
  features go into the Script's own component."); `bridge.ts` knows
  `ComponentHandle` (or `handles.test.ts`'s list excludes it with a reason —
  pick: exclude, since a script can't get one).
- Emitter (`packages/api/src/emit.ts`, `emit/context.ts`): components first
  (`const lid = design.component('Lid');`, variable names from the component
  name like features'), `{ component: lid }` in each stamped feature's options
  (and sketches'), then after the features `lid.add(design.ref('body', \`${box1.id}:0\`))`
  for each stored `BodyMeta.component` that differs from `stampOfBody`. A run
  `[from, to]` emits only components its features stamp or its bodies join.
- `docs/api/README.md`: a "Components" section with a compiled ```ts example;
  `docs/api/emit.md` a line; `pnpm api:generate`.
- CLI `packages/cli/src/headless.ts`: `ComputeResult.components: { id; name;
  bodies: BodyId[] }[]`, `BodyReport.component?: { id; name }` (through
  `componentOfBody` with the last result's origins); `ExportOptions.components?:
  string[]` (names or IDs; unknown → `HeadlessError("No component named Lidd.")`),
  `flat?: boolean`; grouped 3MF/STEP unless `flat`. `src/cli.ts`: `info` prints
  "Components" with indented bodies; `export --component <name>` (repeatable),
  `--flat`. `docs/cli.md`.

**Tests**
- `packages/api/src/design.test.ts`: `component` with bodies, the build
  overload stamps, nested innermost wins, unknown component option throws and
  changes nothing, determinism (`cmp1` twice gives identical JSON).
- `packages/api/src/emit.test.ts`: round trip of a design with two components,
  a stamped sketch and a hand-moved body (compare `components` names and
  membership up to IDs); biome format no change.
- `packages/script/src/runner.test.ts`: both refusals.
- `packages/cli/src/headless.test.ts`: a fixture
  `fixtures/components/lid-box.extrudo` (written by an S8 test with
  `WRITE_FIXTURES=1` through the API: a box component and a lid component, the
  lid cut through by a hole that splits off a piece) → `components` lists the
  piece under the lid (origins); `export({ components: ['Lid'] })` 3MF has one
  item; `cli.test.ts`: `info` output and `--component`.
- `packages/cli/src/emit-recompute.test.ts` includes the new fixture; add it to
  `packages/kernel/src/fuzz.test.ts`'s list.

**Acceptance**: `pnpm check` green, docs tests green (`docs.test.ts`).

---

## S9: Print Info, guide, closing (`p6-05-s9-close`, last)

**Files**
- `apps/web/src/print/usePrintAids.ts` / `PrintInfoPanel.tsx`: when the design
  has components, rows per component under the totals, `[data-print-component="<name>"]`
  with weight, filament and cost of its counted bodies (the same bodies the
  totals count, split with `componentMembers`); "Loose bodies" row when some
  are loose.
- `docs/guide/components.md` (front matter `section` as the concept pages):
  what a component is, active component, where new bodies go, pieces vs
  copies, Move/Copy/Place Component, the "Print layout" group recipe (§3),
  export behaviour, what's not there (joints). Pictures recorded with
  `pnpm demos -g guide` (add a `guide-shots.spec.ts` step).
- `docs/04-ui-spec.md`: the browser's component rows, the Component group, the
  isolation bar.
- `docs/03-roadmap.md`: tick P6-05 with "Done <date> (ADR-0081): components;
  joints deferred".
- ADR-0081: Status "Implemented", a Results section per slice.
- `CLAUDE.md`: a status line and an ADR-0081 paragraph plus a
  "Components e2e" note (the `data-*` attributes above).

**Tests**: `PrintInfoPanel.test.tsx` (component rows, totals unchanged);
`print-aids.spec.ts` new test reading `[data-print-component="Lid"]`.

**Acceptance**: `pnpm check`, the full e2e in CI, docs build (`apps/site`
tests) green.

---

## Open questions for the owner (do not block S1-S3)

1. After S6, check on the Arch workstation that PrusaSlicer and OrcaSlicer load
   a component as one object with parts (default "Keep components together" on
   relies on it).
2. Joints are deferred (ADR §4). Say if print-in-place hinge checks should
   bring them forward.
3. The Solid tab's "Component" group and the browser rows are new UI ahead of
   the UI walk P6-04 waits for: merge S3/S4 before the walk so it covers them,
   or hold them until after?
