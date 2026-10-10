# P6-05 Components: slice plan

Design: `docs/adr/0081-components.md` (read it first; section numbers below are
its §§). Every slice is its own branch off `main` (`p6-05-s<n>-<slug>`, the
joint slices `p6-05-j<n>-<slug>`), merges alone, ticks nothing in the roadmap
until S9, and adds one `docs/CHANGELOG.md` line. Every slice: `pnpm check`
passes; slices with UI run their own e2e specs locally (`--workers=2`) and the
full suite through CI on the branch.

The owner's review (2026-10-10): build it, starting with the slices that have
no UI (S1, S2, S7), and plan joints now (ADR §4) for print-in-place hinge
checks.

## Order and parallelism

```
S1 core model ───┬── S3 browser & membership ──┬── S4 active & isolation ──────────────┐
S2 kernel origins┘   (S2 optional for S3)      ├── S5 placement                        │
S7 STEP assemblies (after S1) ─┐               ├── S6 3MF + export dialog ─┐           │
                               │               └── J1 joint model & dialog ┼─ J2 pose ─┤
                               │                       (after S3)          └─ J3 check ┤
                               └──────────── S8 API/emitter/CLI (after S2, S6, S7, J1, J3)
                                                                     S9 print info, guide, close (last)
```

- **First, no UI: S1 ∥ S2 ∥ S7.** S2 touches only the kernel and core's
  `ModelState`; S7 needs S1's types only for its last step (the dialog wiring
  waits for S6), so its facade work and native harness can start with S1, and
  its OCCT rebuild (~15 min in CI) should start early.
- After S3: **S4 ∥ S5 ∥ S6 ∥ J1**. J1 needs S3 (a frame pick reads a body's
  component from the browser's rows and `componentOfBody`), not S4–S6.
- After J1: **J2 ∥ J3** (J3's kernel part needs only J1's core types and the
  engine's frame pass, so it can start as soon as J1's core part is reviewed).
- **S8 after S2, S6, S7, J1 and J3.** It moved after the joints because the
  API, the emitter and the CLI must cover `doc.joints` too (`d.joint`, the
  emitter's joint lines, `extrudo check --joints`); written before them, it
  would need a second pass through the generator, the round-trip test and
  `docs/cli.md`.
- **S9 last**, after J2 and J3 as well: the guide page explains joints, the
  pose and the check, and the roadmap tick closes P6-05 with joints in it.

| Slice | Complexity | Model |
|---|---|---|
| S1 core model | architecture, schema, file format | strongest (Opus) |
| S2 kernel origins | engine plumbing, kernel | strongest (Opus) |
| S3 browser & membership | well-specified UI | Sonnet |
| S4 active component & isolation | well-specified UI, many call sites | Sonnet |
| S5 placement | core + kernel input + dialog | Opus (kernel part) |
| S6 3MF + export dialog | io writer/reader + UI | Sonnet |
| S7 STEP assemblies | C++ facade, OCCT build | strongest (Opus) |
| J1 joint model & dialog | schema, engine pass, naming, dialog | strongest (Opus) |
| J2 pose preview | view state, three.js matrices, picking | Sonnet |
| J3 clearance check | kernel algorithm, performance, panel | strongest (Opus) |
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

## J1: the joint model and the dialog (`p6-05-j1-model`, after S3; ∥ S4, S5, S6)

**Files: core**
- `packages/core/src/ids.ts`: `JointIdSchema = id.brand<'JointId'>()`, `type JointId`.
- `packages/core/src/schema.ts`: `JointFrameSchema`, `JointSchema` and
  `joints: z.array(JointSchema).optional()` on `DocumentSchema` (after
  `components`), exactly as ADR §4 lists them, with doc comments. In
  `superRefine`: `['joints', 'id', …]` and `['joints', 'name', …, lower case]`
  in `unique`; a new `reportJoints(ctx, doc)` adds an issue at
  `['joints', i, 'a' | 'b', 'component']` for a missing component, at
  `['joints', i, 'b', 'component']` when both sides name the same one ("both
  sides are in Leaf: pick a frame on another component"), at
  `['joints', i, 'min' | 'max']` for limits on a rigid joint or a limit whose
  unit isn't the type's (`angle` for revolute, `length` for slider), and at
  `['joints', i, 'a' | 'b', 'ref', 'kind']` for a kind the type doesn't take
  (`JOINT_FRAME_KINDS` below).
- **New** `packages/core/src/joints.ts` (exported from `index.ts`):

```ts
export type JointType = Joint['type'];
/** Reference kinds a frame may be, per type (ADR §4). */
export const JOINT_FRAME_KINDS: Readonly<Record<JointType, readonly GeomRefKind[]>> = {
  rigid: ['face', 'edge', 'vertex', 'body'],
  revolute: ['face', 'edge', 'axis', 'sketchEntity'],
  slider: ['face', 'edge', 'axis', 'sketchEntity'],
};
/** "Joint1", "Joint2"…; "Hinge1"… is not guessed. */
export function newJointName(doc: Pick<ExtrudoDocument, 'joints'>): string;
/** The joints whose moving side is `component`, in `doc.joints` order (browser rows). */
export function jointsOf(doc: Pick<ExtrudoDocument, 'joints'>, component: ComponentId): Joint[];
/**
 * The components that move when `joint` moves its side a: a's component plus every
 * component joined to it by unsuppressed rigid joints, never crossing b's component.
 */
export function movingComponents(doc: Pick<ExtrudoDocument, 'joints'>, joint: Joint): ComponentId[];
/** The limits in degrees or mm, `undefined` where absent (a revolute without both is a whole turn). */
export function jointRange(joint: Joint, value: (input: ExprInput) => number): { min: number; max: number } | undefined;
```

- **Commands** (in `joints.ts`, each one step):

| Command | Payload | Label | Rules |
|---|---|---|---|
| `addJoint` | `{ joint: Joint }` (ID from `newId()`) | "New joint" | name rules as components ("There is already a joint named Hinge."); both components exist and differ; appends |
| `updateJoint` | `{ id: JointId; joint: Omit<Joint, 'id'> }` | "Edit joint" | same checks; keeps the position in `joints` |
| `renameJoint` | `{ id; name }` | "Rename joint" | name rules |
| `setJointSuppressed` | `{ ids: JointId[]; suppressed: boolean }` | "Suppress/Unsuppress joint(s)" | `false` deletes the key |
| `removeJoint` | `{ ids: JointId[] }` | "Delete joint(s)" | drops `joints` when empty |

  `removeComponent` (S1) also removes the joints naming the component (one
  step; its label stays "Delete component"). `replaceReferences` takes
  `{ id: FeatureId | JointId; … }` and, for a joint ID, rewrites its frames'
  refs (and `checkNewReferences` is skipped: joints have no timeline position).
  `removeFeature` does **not** refuse because a joint uses the feature: the
  joint goes `error` and the browser says so (joints aren't ordered, ADR §4).
  The parameter graph (`evaluateParameters`, `expr/graph`) adds owner
  `{ type: 'joint', id, input: 'min' | 'max' }` so `removeParameter` refuses a
  parameter a limit uses ("Hinge's maximum angle uses it").
- `packages/core/src/stores.ts`: `ModelState.joints: Record<JointId, JointReport>`
  (default `{}`) and `JointReport` (ADR §4: `status`, `message?`,
  `refs?: ReferenceIssue[]`, `axis?: { origin: Vec3; direction: Vec3 }`,
  `offset?: number`); `computed({ …, joints? })`.

**Files: kernel**
- **New** `packages/kernel/src/joints/frames.ts`:
  `resolveJoint(ctx: EvalContext, joint: Joint): JointReport` — per side
  `jointFrameLine(ctx, ref, label)`: a face through `ctx.resolve` +
  `surfaceGeometry` (cylinder or cone → its axis; plane → its normal through
  the face's centre; anything else → `KernelError("Pick a round face, a
  straight or circular edge or an axis for the joint.")`), an edge through
  `edgeGeometry` (circle → centre and normal; line → as `lineOf`), the other
  kinds through `lineOf`; rigid frames are only resolved (existence). Then the
  agreement test (revolute: distance from a's axis origin to b's line and the
  angle between directions; slider: angle only) → `warning` with the ADR's
  sentence and `offset`. A `LostReferenceError` → `error` with `refs`; a frame
  on a feature after the marker → `inactive`. Labels: "Hinge's moving frame",
  "Hinge's fixed frame".
- `packages/kernel/src/recompute/engine.ts`: after the walk (and only for a
  full recompute, not `preview`), an `EvalContext` at the marker with
  `bodyAccess: 'all'` (as a feature appended there would get, through the
  existing `#references` resolver) runs `resolveJoint` for every unsuppressed
  joint; the reports go on the result (`RecomputeResult.joints`). Not cached,
  not in any key. Keep that context's inputs (`#atMarker`) for the next call.
- `packages/kernel/src/service.ts`: `KernelApi.resolveJoint(joint: Joint):
  Promise<JointReport>` against the last finished recompute (`#atMarker`), for
  the dialog's live readout. `recomputer.ts` passes `result.joints` to
  `computed` and exposes `resolveJoint`.

**Files: app**
- **New** `apps/web/src/joints/`:
  - `JointDialog.tsx`: a `FloatingDialog` (region "Joint dialog" / "Edit Hinge
    dialog") built from the feature dialogs' field components but **not** the
    feature controller (a joint inserts no feature and needs no recompute
    preview): combobox "Type" (`rigid`/`revolute`/`slider`), buttons "Moving
    part" and "Fixed part" (`exact`; selection fields over the model picker,
    one ref each, kinds from `JOINT_FRAME_KINDS`; the text names the pick and
    its component, "Cylinder face · Leaf"; a pick on a body in no component is
    refused with the field hint "Put this body in a component first (Solid ›
    New Component)."), textboxes "Minimum angle"/"Maximum angle" or "Minimum
    travel"/"Maximum travel" (`<ExpressionInput>`, absent for rigid), checkbox
    "Flip", a read-only line `[data-info="joint"]` from `resolveJoint` ("Turns
    Leaf about Base's axis.", or the warning), OK/Cancel. Pre-selection fills
    the fields in order. OK dispatches `addJoint` or `updateJoint` (one step);
    `openJoint(id, { fix })` opens it for Fix References with the lost field
    flagged, as `dialog.edit` does for features.
  - `jointActions.ts`: `createJointActions(stores, notify)` → `{ start(),
    edit(id, options?), rename(id, name): boolean, setSuppressed(ids, value),
    remove(ids), keepClosestMatch(id) }`.
  - `jointRows.ts` (pure): rows per component from `jointsOf` and
    `ModelState.joints`.
- `shell/BrowserPanel.tsx`: after a component row's bodies, its joint rows:
  `data-joint="<id>"`, `data-joint-type`, `data-joint-status="ok|warning|error|inactive"`
  (absent while suppressed; `data-joint-suppressed`), icon per type (new icons
  `jointRigid`, `jointRevolute`, `jointSlider` in the icon pipeline), name
  (F2), the status glyph with the message as tooltip, menu Edit, Rename,
  Suppress, Fix References / Keep Closest Match (when `refs`), Delete Joint
  (J2 adds Pose…, J3 Check Clearance). Component row menu: New Joint….
- `shell/tools.ts`: `TOOLS` entry `joint` (label "Joint", category `construct`,
  icon `jointRevolute`) in the Solid tab's Component group after New Component;
  `commands/keymap.ts`: `joint: ['j']`; `shell/commands.tsx`: the command, model
  mode only, `unavailable` with fewer than two components ("Make two
  components first."). `docs/04-ui-spec.md` §shortcuts: `J` Joint (no longer
  "reserved"). `pnpm docs:generate` (the tool page).
- Viewport: `viewport/Joints.tsx` draws each `ok`/`warning` joint's axis (a
  dashed line with a small arc for revolute, an arrow for slider) while its row
  is hovered or the dialog is open; the Viewport region gains
  `data-joints="Hinge:revolute:ok:<origin>:<direction>;Slide1:slider:warning:…"`
  (names with spaces as `_`, numbers to 0.01, absent with none). The ghost of a
  lost frame (`viewport/ghostGeometry.ts`) for the hovered joint row and the
  dialog opened with `fix`, as for features (`data-ghosts` lists
  `<jointId>:<type>:<x,y,z>`).
- `apps/web/src/components/followComponentSession` (S4) is unaffected; the
  joint dialog closes when its joint disappears (undo).

**Docs**: `docs/file-format.md` **§4.8 `joints[]` (Joint)** and **§4.8.1
JointFrame** (fields, the kinds per type, sides a moves and b stays, limits'
units, as-built meaning of 0, "frames are references by persistent name;
components beside them are metadata"), §3's additive list `joints`, §10
`JointId`; `file-format-doc.test.ts` must pass. `docs/02-architecture.md`: one
sentence on the engine's joint pass.

**Tests**
- `packages/core/src/joints.test.ts`: every command's happy path, refusals and
  exact undo; `removeComponent` takes its joints in the same step;
  `replaceReferences` on a joint; `movingComponents` (a rigid chain carried, a
  rigid joint to b not crossed, a suppressed rigid joint ignored, a cycle);
  `jointRange`; `removeParameter` refused for a limit's parameter.
- `schema.test.ts`: each `reportJoints` issue at its path; a document without
  `joints` loads; lenient reading drops `joints` (as S1's test does for its
  keys).
- `packages/kernel/src/joints/frames.test.ts` (real OCCT, `strictLeaks`): a
  hinge from the API (the fixture below): a cylinder face and a hole wall give
  one axis, `ok`; a circular edge gives the same axis; a flat face for a slider
  gives its normal; axes 0.4 mm apart → `warning` with `offset` 0.4; a deleted
  pin feature → `error` with `refs`; rolled back → `inactive`; a plane face for
  a revolute → the error message; editing a joint in a second recompute reuses
  every feature (`stats.reused` = all).
- **Fixture** `fixtures/components/hinge.extrudo`, written by
  `packages/kernel/src/joints/hinge-fixture.test.ts` with `WRITE_FIXTURES=1`
  through `@extrudo/api` (S8 may not be merged: build the document with core's
  commands): component **Base** (a 40 × 20 × 4 plate with two knuckles and a
  Ø6 pin along X on its edge) and component **Leaf** (a 40 × 20 × 4 plate
  beside it, 0.5 mm away, with a middle knuckle round the pin through a Ø6.6
  hole: 0.3 mm radial clearance), the pin's axis at the plates' mid-height;
  joint **Hinge**: revolute, a = the leaf's hole wall, b = the pin's wall,
  0 to 90 deg. Dimensions are parameters (`gap`, `clearance`), so the tests
  can work the expected angles out from them. Add it to `fuzz.test.ts`'s list (the
  fuzzer's edits leave joints alone; it checks the joint pass doesn't leak).
- App unit tests: `joints/jointRows.test.ts`, `jointActions.test.ts`,
  `JointDialog.test.tsx` (the kinds offered per type, the refusal of a loose
  body, OK dispatches one step).
- **e2e** `e2e/joints.spec.ts` (new): open the hinge fixture through
  `importFile` (Home › Import Design); `data-joints` reads
  `Hinge:revolute:ok:…:1,0,0`; the Leaf row lists `[data-joint="…"]` with
  `data-joint-status="ok"`; `j` with nothing selected opens "Joint dialog",
  pick "Moving part" on the leaf's hole wall and "Fixed part" on the pin's wall
  (hover until `data-model-hover` is a `face:`), Type revolute, Maximum angle
  `90 deg` → `[data-info="joint"]` "Turns Leaf about Base's axis.", OK → a
  second joint row; rename via F2; Ctrl+Z removes it; delete the pin feature's
  chip ("Delete") → `data-joint-status="error"`, Fix References re-picks the
  wall → `ok`; Ctrl+Z ×2 back.

**Acceptance**: core, storage and kernel tests green, `fuzz.test.ts` green with
the hinge, no golden table rewritten; the spec green with `--repeat-each=2`;
`a11y.spec.ts` audits the Joint dialog in both themes.

**Model**: the strongest (Opus): schema, engine pass and naming.

---

## J2: the pose preview (`p6-05-j2-pose`, after J1; ∥ J3)

**Files**
- `apps/web/src/viewport/store.ts`: `jointPose: JointPose | undefined` with
  `interface JointPose { joint: JointId; value: number }` (degrees or mm) and
  `setJointPose(pose | undefined)`. View state: not saved, not undoable. Cleared
  by the tool/dialog/sketch starts (`AppShell.run`, the dialog controller's
  `start`, `enterSketch`), by a document change that removes the joint, or
  makes it not `ok`/`warning`-free (`followJointPose(store, model, viewport)`,
  started beside `followComponentSession`), and when the Joint panel closes.
- **New** `apps/web/src/joints/pose.ts` (pure, unit-tested):

```ts
/** The matrix that poses the moving side; IDENTITY at 0. */
export function poseMatrix(report: JointReport, joint: Joint, value: number): Matrix12;
/** Clamp to the joint's range (a revolute without limits wraps to (−180, 180]). */
export function clampPose(joint: Joint, range: { min: number; max: number } | undefined, value: number): number;
/** Live body IDs that move: the members of `movingComponents`. */
export function posedBodies(doc: ExtrudoDocument, joint: Joint, members: ComponentMembers): BodyId[];
```

  `poseMatrix` uses `rotation(origin, direction, ±value°)` / `translation`
  from `@extrudo/kernel`'s `features/matrix.ts` (export it through a pure entry,
  `@extrudo/kernel/matrix`, so the app takes no OCCT code; add the entry to
  `scripts/check-boundaries.mjs` if it needs a rule), with `flip` reversing the
  sign.
- `viewport/Bodies.tsx`, `GhostBodies`, edges and silhouettes: a posed body's
  group gets the pose matrix (`matrixAutoUpdate = false`); `pick.ts`'s
  `PickScene` leaves posed bodies out (**not pickable while posed**); section
  clips still apply (world space). Fit ignores the pose.
- **New** `apps/web/src/joints/JointPanel.tsx`: region **"Joint"** (`exact`),
  header the joint's name; a Radix slider "Angle" / "Travel" over the range
  (step 1° / 0.1 mm; a whole-turn revolute −180…180) and an
  `<ExpressionInput>` of the same name beside it (both write the pose; typing
  past a limit clamps and shows "Limited to 180°"), button "Reset" (pose 0),
  "Done". Refused poses (the joint's `warning`/`error`) show the joint's
  message instead of the controls. The panel is opened by the joint row's
  **Pose…**, the command `poseJoint` (Ctrl+K "Pose Joint", acting on the
  selected joint row or the only joint), and J3's Check Clearance.
- **New** `viewport/JointHandle.tsx`: while the panel is open, an arc handle
  about the axis (revolute) or an arrow along the direction (slider) at the
  moving side's box centre projected on the axis, built from the dialog
  overlay's angle and distance manipulator drawing (factor the shared SVG
  pieces out of `features/DialogOverlay.tsx` if they aren't already);
  dragging it sets the pose (snapping to 5° / 1 mm with no modifier, free with
  Shift). `[data-joint-handle]` carries `cx`/`cy` in view px.
- A bar at the view's top centre while posed: `[data-pose-bar]` (role
  `status`) "Posed: Leaf at 72° — the design is unchanged." with "Reset".
- Viewport region: `data-joint-pose="Hinge=72"` (absent at none or 0).

**Tests**
- `joints/pose.test.ts`: matrices for a known axis at 0/90/180 (a point maps
  where expected), flip, slider translation, clamping, wrapping,
  `posedBodies` with a rigid-carried component.
- `viewport/store.test.ts`: `setJointPose`, cleared by `followJointPose` when
  the joint is deleted (undo of `addJoint`) and when its report turns `error`.
- `selection/pick.test.ts`: a posed body isn't picked; unposed again it is.
- **e2e** in `e2e/joints.spec.ts`: the hinge fixture, the Leaf row's Pose… →
  region "Joint"; fill "Angle" with `90` → `data-joint-pose="Hinge=90"` and the
  leaf's drawn box changes (`data-bodies` is the kernel's and stays: read the
  posed box from `data-posed-bodies="Leaf:<x,y,z min>..<max>"`, which the
  viewport writes while posed); drag `[data-joint-handle]` along its arc →
  the value changes in the field; a click on the posed leaf selects nothing;
  pressing `e` (Extrude) resets the pose (`data-joint-pose` absent);
  filling 120 (past the fixture's 90°) shows "Limited to 90°".

**Docs**: `docs/04-ui-spec.md`: the Joint panel, the handle and the pose bar.

**Acceptance**: spec green ×2; `bodies.spec.ts`, `section.spec.ts`,
`model-select.spec.ts` green; no screenshot baseline changes.

**Model**: Sonnet (well specified; view-side only).

---

## J3: the clearance check (`p6-05-j3-check`, after J1; ∥ J2, panel after J2)

The kernel part needs only J1; the panel part sits in J2's Joint panel, so
merge J2 first or put the panel section behind J2's merge (a second commit on
the branch after rebasing).

**Files: kernel**
- **New** `packages/kernel/src/joints/sampling.ts` (pure):

```ts
export const JOINT_SAMPLES = { revolute: 36, slider: 25 } as const;
export const MAX_JOINT_SAMPLES = 72;
export const MAX_JOINT_EVALS = 120;
export const MAX_JOINT_COMMONS = 12;
/** Evenly spaced values over [min, max], both ends and 0 (when inside) included, at most MAX_JOINT_SAMPLES. */
export function coarseSamples(range: { min: number; max: number }, count: number): number[];
/** Golden-section search for the smallest gap in [lo, hi]; stops at `step` or `evals`. */
export function narrowMinimum(gap: (v: number) => number, lo: number, hi: number, step: number, evals: number): { at: number; gap: number; used: number };
/** Bisection of a free/colliding boundary in [free, hit]; the value where contact starts. */
export function narrowBoundary(collides: (v: number) => boolean, free: number, hit: number, step: number, evals: number): { at: number; used: number };
```

  (`gap` and `collides` are synchronous here; the check wraps them with its
  yields.)
- **New** `packages/kernel/src/joints/check.ts`:

```ts
export interface JointCheckRequest {
  joint: Joint;                 // as stored, its report from the last recompute
  moving: readonly BodyId[];    // posedBodies(…)
  others: readonly BodyId[];    // every other live body (display ignored, ADR §4)
  range: { min: number; max: number };   // evaluated by the app
  minGap: number;               // mm
}
export interface JointCheck {
  samples: number;              // evaluations used
  tightest: { at: number; gap: number; from: Vec3; to: Vec3; pair: [BodyId, BodyId] };
  collisions: { from: number; to: number; volume: number; at: number;
                faces: { body: BodyId; index: number }[] }[];   // faces of both sides at `at`
  underMinimum: { from: number; to: number }[];                  // gap < minGap, no contact
}
export async function checkJoint(kernel: Kernel, bodies: BodyShapes, report: JointReport,
  request: JointCheckRequest, yieldNow: () => Promise<boolean>, onProgress?: (done: number, of: number) => void): Promise<JointCheck>;
```

  One evaluation at value v: `poseMatrix` (shared with the app through
  `@extrudo/kernel/matrix`); for each moving body `kernel.transform(shape, M)`
  into a `kernel.scope()`; the moved box (`measure()`'s loose box) against each
  other body's, grown by `JOINT_SEARCH = max(5, 2 × minGap)` mm; for each pair
  that meets, `kernel.minGap` when either is a mesh, else
  `kernel.closestPoints`; gap(v) = the minimum (∞ when no pair meets). Where it
  is 0 and the commons budget allows, `kernel.common(moved, other)` +
  `kernel.properties(result).volume` (> 1e-6 mm³ = interference) and the
  common's history → the input face indices (moved copy's indices = the
  as-built body's, since `transform` records every sub-shape as modified).
  Every shape released before the next evaluation (`strictLeaks`). Then:
  coarse samples → `narrowMinimum` around the smallest gap's neighbours (step
  0.1° / 0.01 mm, 8 evals) → `narrowBoundary` at each free/colliding and
  free/under-minimum change (8 evals each) → stop at `MAX_JOINT_EVALS`. A pose
  the joint report refuses (`warning` with an offset, `error`, `inactive`)
  throws `KernelError` with the report's message.
- `packages/kernel/src/service.ts`: `KernelApi.checkJoint(request, onProgress):
  Promise<JointCheck>` on `latestBody` shapes, held for the run with
  `RecomputeEngine.hold(bodies)` (ADR-0050); a newer `checkJoint`, `cancelCheck()`
  or a recompute request cancels it (the next yield returns `false` → a
  `CancelledError`). `recomputer.ts`: `checkJoint`, cancelled by `recompute`.

**Files: app**
- `viewport/store.ts`: `jointCheck: JointCheckState | undefined`
  (`{ joint: JointId; min: string /* expression */; on: boolean }`, view state
  like `thickness`); `apps/web/src/joints/useJointCheck.ts` runs the check
  when asked, keeps `{ state: 'idle' | 'pending' | 'ready' | 'stale' | 'error';
  result?; progress? }`, marks `stale` on any document change after the run.
- `JointPanel.tsx` (J2) gains a "Clearance" section: "Minimum gap"
  (`<ExpressionInput>`, default `tolerance` when the document has the
  parameter, else `0.2 mm`), button "Check clearance" (`Checking 12 of 36…` +
  Cancel while pending), result lines in `[data-joint-result]`: "Tightest gap
  0.30 mm at 0°–180°" (a flat minimum is a range), "Tightest gap 0.18 mm at
  72°", "Under 0.3 mm from 64° to 81°", "Collides from 64.2° to 81.0° (3.2 mm³
  at 72°)", "No collision from 0° to 180°.", each with a **Show** button that
  poses the joint there (J2's pose). "The design changed: check again." while
  stale.
- View: at the shown pose, a leader between `tightest.from`/`to` with the gap
  (`joints/ClearanceOverlay.tsx`, like `print/ThicknessOverlay.tsx`), and the
  collision's faces tinted `--x-error` through the face colour attribute
  (ADR-0026) while the posed value is inside that collision's range. The
  browser's Analysis folder gets `[data-joint-check-row]` ("Clearance · Hinge",
  eye hides the marks, menu Remove).
- Viewport region: `data-joint-check="joint=Hinge min=0.3 tightest=0.3 at=0
  collides=none under=none samples=44"` (collisions `collides=64.2..81.0`,
  several joined by `,`; `pending`, `stale`, absent with no check).
- Command `checkJointClearance` (Ctrl+K "Check Joint Clearance"), the joint
  row's **Check Clearance**.

**Tests**
- `joints/sampling.test.ts`: samples include ends and 0, the cap; golden
  section finds the minimum of a parabola to the step; bisection of a step
  function to the step; the eval budgets hold.
- `packages/kernel/src/joints/check.test.ts` (real OCCT, `strictLeaks`, on the
  hinge fixture): 0–90° → no collision, tightest 0.30 mm (the pin's clearance,
  ±0.001); extend the range to 0–180° → a collision whose start angle equals
  the angle the test works out from the fixture's parameters (where the
  folding leaf's inner edge first reaches the base, ±0.2°), its faces
  including the leaf's and the base's facing sides, and the tightest gap
  before it below 0.30; set `clearance` to 0 (the hole Ø6) → touching (gap 0,
  volume 0): collides=none, tightest 0; a slider on two boxes (a carriage in a channel, 0.25 mm each
  side) → tightest 0.25, and travel past the channel's end → a collision from
  the end; a mesh body (the fixture's leaf exported and imported as STL)
  → `minGap` path, same tightest within the mesh's deflection; cancelled midway
  → `CancelledError` and no leak; never more than `MAX_JOINT_EVALS` transforms
  (call counter).
- `BENCH=1 pnpm vitest run packages/kernel/src/joints/check-bench`: the hinge's
  whole turn and a 100-face-per-side hinge; record the times in ADR-0081's
  Results; target under 2 s on the 4-core CI runner.
- App: `useJointCheck.test.ts` (stale after a change, cancel on close),
  `JointPanel.test.tsx` (result lines, Show sets the pose).
- **e2e** in `e2e/joints.spec.ts`: the hinge, Check Clearance → poll
  `data-joint-check` until `tightest=0.3`, `collides=none`; set Maximum angle to
  180 in the joint's dialog → `stale` → check again → `collides=` a range;
  Show on the collision line → `data-joint-pose` inside the range and the
  leader `[data-clearance-leader]` drawn; Minimum gap `0.5 mm` → an "Under"
  line. The spec logs the check's time for the ADR.

**Docs**: `docs/04-ui-spec.md` the Clearance section; ADR-0081 Results (times).

**Acceptance**: kernel tests green with `strictLeaks`, the bench under 2 s, the
spec green ×2, `fuzz.test.ts` green.

**Model**: the strongest (Opus): the sampling and refinement, the scopes and
the performance work.

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

**Acceptance**: specs green; `import-mesh.spec.ts` green. **Owner check (a machine
with the slicers installed)**: `prusa-slicer --info` on the e2e's file shows 2 objects, the
component with 2 parts; Orca loads it as one object with parts.

---

## S7: STEP assemblies (`p6-05-s7-step`, with S1; no UI)

One of the three first slices (the owner's order). The facade, the native
harness and the CI build need nothing from S1; `writeStep`'s TypeScript
types take S1's `ComponentId` only as a name string, and the Export dialog
wiring waits for S6.

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

## S8: API, emitter, CLI (`p6-05-s8-api`, after S2, S6, S7, J1, J3)

Moved after the joint slices so the API, the emitter and the CLI cover
`doc.joints` in one pass (see Order and parallelism).

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

- **Joints** (J1): `packages/api/src/handles.ts` `class JointHandle { readonly
  id; get name() }`; `design.ts` `joint(name: string, options: { type:
  JointType; a: { component: ComponentHandle | string; frame: GeomRef };
  b: …; min?: string; max?: string; flip?: boolean; id?: string }): JointHandle`
  (IDs `jnt1`…; the frame kinds checked against `JOINT_FRAME_KINDS`, a bad one
  an `ApiError` at `a.frame`), `joints(): JointHandle[]`; `packages/script`
  refuses `joint` like `component`. The emitter writes joints after the
  features and the `lid.add` lines (`const hinge = design.joint('Hinge', …)`,
  frames through `emit/refs.ts` as feature inputs' refs are). `docs/api/README.md`'s
  Components section shows a joint.
- **CLI joints**: `headless.ts` `checkJoints({ minGap }): JointCheckReport[]`
  (each unsuppressed revolute/slider joint through `KernelApi.checkJoint`, the
  moving and other bodies from `componentOfBody` and `movingComponents`);
  `ComputeResult.joints` (name, type, status, message); `cli.ts`: `check
  --joints [--min-gap <expr>]` prints "Hinge: tightest 0.30 mm at 0°–90°, no
  collision" per joint and **exits 2** when one collides, is under the minimum
  or has an error; `info` lists joints. `docs/cli.md`.

**Tests**
- `packages/api/src/design.test.ts`: `joint` stores the record and refuses a bad
  frame kind and a same-component pair without changing anything; `component` with bodies, the build
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
- `packages/cli/src/emit-recompute.test.ts` includes the new fixture and the
  hinge (J1); add `lid-box` to `packages/kernel/src/fuzz.test.ts`'s list.
- `emit.test.ts`: the hinge round-trips its joint (type, limits, frames up to
  IDs).
- `cli.test.ts`: `check --joints` on the hinge exits 0 and prints the tightest
  gap; with `--min-gap 0.5mm` exits 2.

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
  export behaviour, **joints** (making one, the pose, the clearance check
  with a print-in-place hinge worked through, why a pose isn't saved), what's
  not there (a pose that moves the design, motion studies, joint types beyond
  the three). Pictures recorded with
  `pnpm demos -g guide` (add a `guide-shots.spec.ts` step).
- `docs/04-ui-spec.md`: the browser's component rows, the Component group, the
  isolation bar (J1–J3 add the joint parts as they land; check they agree).
- `docs/03-roadmap.md`: tick P6-05 with "Done <date> (ADR-0081): components
  and as-built joints (rigid, revolute, slider) with the pose preview and the
  clearance check; driven poses and motion studies deferred".
- ADR-0081: Status "Implemented", a Results section per slice.
- `CLAUDE.md`: a status line and an ADR-0081 paragraph plus a
  "Components e2e" note and a "Joints e2e" note (the `data-*` attributes
  above).

**Tests**: `PrintInfoPanel.test.tsx` (component rows, totals unchanged);
`print-aids.spec.ts` new test reading `[data-print-component="Lid"]`.

**Acceptance**: `pnpm check`, the full e2e in CI, docs build (`apps/site`
tests) green.

---

## Open questions for the owner (do not block S1, S2, S7)

1. After S6, check on a machine with the slicers installed that PrusaSlicer and
   OrcaSlicer load a component as one object with parts (default "Keep
   components together" on relies on it).
2. Joints (decided 2026-10-10, ADR §4): is a 0.2 mm default minimum gap right
   when the design has no `tolerance` parameter, and should the check count
   ghost and hidden bodies (the plan says yes: a clearance belongs to the
   design, not the view)?
3. The Solid tab's "Component" group and the browser rows are new UI ahead of
   the UI walk P6-04 waits for: merge S3/S4 before the walk so it covers them,
   or hold them until after?
