# ADR-0059: Customizer and configurations

- **Status:** Accepted, 2026-10-03; implemented (on `p4-07-customizer`)
- **Task:** P4-07 (FR-PAR-05 "favourite / exposed parameters form a customizer
  panel with sliders and ranges", FR-PAR-06 "named configurations, switchable").

## Context

User parameters (`doc.parameters`, ADR-0004) are named expressions with a unit
kind; the Parameters dialog (`apps/web/src/parameters/ParametersDialog.tsx`)
edits them and the model parameters of features. A parameter change must
re-solve the sketches whose dimensions use it in the same undo step: CLAUDE.md,
"anything that changes a dimension's value or a parameter goes through
`ToolHost.apply`" (ADR-0016); the Parameters dialog already does this, and every
new writer of parameter expressions must use **the same path**.

People who download a design (a box, a name tag, an enclosure) want a few
knobs, not the whole parameters table. OpenSCAD's and MakerWorld's customizers
are the reference: a short list of named values with sliders and ranges, and
saved presets.

## Decision

### 1. Exposed parameters: an optional `customizer` object

```ts
ParameterSchema += {
  /** Present = shown in the customizer (FR-PAR-05). */
  customizer: z.strictObject({
    min: z.number().optional(),      // in the parameter's base unit: mm, deg, or plain
    max: z.number().optional(),
    step: z.number().positive().optional(),
    group: z.string().min(1).max(40).optional(),   // a heading in the panel
  }).optional(),
}
```

- Only **user parameters** can be exposed in this task (not features' model
  parameters `dN`; Deferred).
- Order in the panel = order in `doc.parameters`, grouped by `group` (groups in
  order of first appearance, ungrouped first).
- Ranges are numbers in the base unit (mm for length, degrees for angle,
  plain for unitless), shown in the document's length unit. `min > max` is a
  schema error.
- A parameter whose expression is a **plain value** (one number with an
  optional unit: `12`, `12 mm`, `30 deg`, `0.5 in`) gets a slider when it has
  both `min` and `max`, and always an `<ExpressionInput>`. A parameter whose
  expression is a formula (`width / 2`) shows its computed value read-only with
  the formula as a hint; it can't be dragged. (The slider writes plain values
  only; typing in the field can still enter a formula.)
- A value outside `[min, max]` is allowed (the range is a slider range, not a
  constraint) and shown with a warning style.

### 2. Configurations: named value sets, no "active" field

```ts
DocumentSchema += {
  configurations: z.array(z.strictObject({
    id: ConfigurationIdSchema,          // new branded ID, like the others
    name: z.string().min(1).max(60),
    /** Parameter ID → its expression in this configuration. */
    values: z.record(ParameterIdSchema, z.string()),
  })).optional(),
}
```

- **Apply** sets each listed parameter's expression (one undo step, through the
  parameter-change path above). Values for parameters that no longer exist are
  ignored (and shown as missing in the panel). Parameters not listed keep their
  values.
- **No stored "active configuration".** The panel shows a configuration as
  current when every listed value equals the parameter's expression (string
  equality after trimming). Undo, a slider drag or a manual edit then simply
  makes none current; nothing can get out of sync.
- **Save as…** captures the expressions of the exposed parameters under a new
  name; **Update** rewrites a configuration with the current expressions of its
  parameters plus any newly exposed ones; **Rename** and **Delete**. Each is one
  undo step. Names are unique (case-insensitive).
- Deleting a parameter removes it from every configuration's `values` in the
  same command (`removeParameter`), so documents stay valid.

### 3. Commands (core, `document-commands.ts` or a new `customizer.ts`)

`setParameterCustomizer({ id, customizer | undefined })`,
`addConfiguration({ configuration })`, `updateConfiguration({ id, changes })`,
`removeConfiguration({ id })`, and a pure
`configurationChanges(doc, id): { id: ParameterId; expression: string }[]` that
the app feeds to the parameter-change path (core can't re-solve sketches; the
app's path can). Pure helpers for the panel: `customizerRows(doc, values)`
(group, label, value, plain-or-formula, range, out-of-range) and
`currentConfigurations(doc)`.

### 4. The panel

- **Customizer** panel (floating like Print Info, `apps/web/src/customizer/`):
  opened by the toolbar tile "Customizer" (Solid tab, new group "Design" next to
  Inspect, or wherever the Parameters button lives: put it beside it) and the
  Ctrl+K command `customizer`; no default key. Rows per §1; a header with a
  **configuration select** (current one shown, "Custom" when none matches) and
  buttons "Save as…", "Update", "Rename", "Delete" (in a menu).
- **A slider drag is one undo step:** open a transaction on pointer down, write
  values while dragging (the recompute engine cancels outdated recomputes),
  commit on release; keyboard steps on the slider are one step each.
- Empty state: "No parameters in the customizer yet. Star a parameter in the
  Parameters dialog to show it here." with a button that opens the dialog.
- **Parameters dialog:** a star toggle per user-parameter row ("Show in
  customizer"), and, for a starred row, Min, Max, Step and Group fields in the
  row's details (numbers; `<ExpressionInput>` with the parameter's unit, so
  `10 mm` and `1 in` both work and are stored in base units).
- The home screen's template designs (B2, B4, B5) get a few exposed parameters
  each (their existing main dimensions), so the customizer is useful right
  away; the fixtures are rewritten with `WRITE_FIXTURES=1` through their e2e
  specs only if that is how they are made, else edited by a script that loads,
  changes and saves them through core.

### 5. File format

`docs/file-format.md` §5.1 gets the `customizer` field, a new §5.4
`configurations[]`. `formatVersion` stays 1 (optional keys; an older app drops
them with the existing "newer file" notice, ADR-0050).

## Slices

1. **Core:** schema, IDs, commands, `removeParameter` cleanup, pure helpers,
   file format, tests.
2. **App:** Parameters dialog star and range fields, the Customizer panel with
   sliders and configurations, the command and tile, undo behaviour, unit
   tests.
3. **Templates, e2e and docs:** exposed parameters in the templates,
   `e2e/customizer.spec.ts`, CLAUDE.md notes, CHANGELOG, roadmap tick.

## Results

### Code map

**Core (slice 1)**

| File | What |
|---|---|
| `packages/core/src/schema.ts` | `ParameterSchema.customizer` (`min`, `max`, `step`, `group`), `ConfigurationSchema`, `configurations[]`, `sameConfigurationName` |
| `packages/core/src/ids.ts` | `ConfigurationId` |
| `packages/core/src/customizer.ts` | the commands (`setParameterCustomizer`, `addConfiguration`, `updateConfiguration`, `removeConfiguration`, `setParameterExpressions`) and the pure helpers (`customizerRows`, `configurationChanges`, `currentConfigurations`, `capturedValues`, `isPlainValue`) |
| `packages/core/src/document-commands.ts` | the commands in the store's list; `removeParameter` drops a parameter from every configuration's `values` |
| `docs/file-format.md` | §5.1 `customizer`, §5.4 `configurations[]`; `formatVersion` stays 1 |

**App (slice 2)**

| File | What |
|---|---|
| `apps/web/src/parameters/ParametersDialog.tsx` | the star per user-parameter row, the details row under a starred one (Min, Max, Step, Group, and a Clear button per number), `starCommand` |
| `apps/web/src/parameters/customizer.ts` | the numbers as text in the document's unit (`valueExpression`, `rangeText`, `withRangeField`, `withoutRangeField`) and the slider's maths (`sliderStep`, `rangeValue`, `snapValue`) |
| `apps/web/src/customizer/CustomizerPanel.tsx` | the panel: the configuration select and its menu, the rows with their fields, sliders and out-of-range warning, the empty state |
| `apps/web/src/customizer/useCustomizer.ts` | the controller: rows, the current configuration, every write through the shell's `apply`, the drag transaction |
| `apps/web/src/shell/AppShell.tsx` | the session tool `customizer`, the panel, the command |
| `apps/web/src/shell/tools.ts` | the tile (Solid › Modify, next to Parameters) and its icon |
| `apps/web/src/commands/shortcuts.ts` | `ownsKeys`: a control with no text to undo (a slider, a checkbox…) leaves Ctrl+Z to the app |

**Templates, e2e, docs (slice 3)**

| File | What |
|---|---|
| `apps/web/src/home/gallery.ts` | each template's `exposed` list and `configurations`, applied to the copy by `withTemplateCustomizer` (through core's commands, before it is stored) |
| `apps/web/src/home/gallery.test.ts` | every listed name is a parameter the template really has, every template computes with each of its configurations |
| `apps/web/src/parameters/customizer.test.ts`, `apps/web/src/customizer/customizer.test.tsx`, `apps/web/src/commands/shortcuts.test.ts` | the star, the ranges, the panel's writes and undo, the shortcut predicate |
| `e2e/customizer.spec.ts` | the slider drag and its one undo, configurations, a value outside the range, a template, the empty state |

### Decisions made while implementing

- **Applying a configuration is `setParameterExpressions`** (one command, one
  undo step) sent through the shell's `apply`, so the sketches whose dimensions
  use a parameter are re-solved in the same step (ADR-0016). `configurationChanges`
  lists only what differs, so applying the configuration the document already has
  does nothing.
- **`restoreVersion` restores a version's configurations** with everything else:
  they are part of the document, not view state.
- **Rows carry the parameter's `comment`** as a hint beside the name (the panel
  has room for one line); the exposed list has no comment field.
- **The tile sits in Solid › Modify, right after Parameters**, since the panel is
  the parameters dialog's other half. No default key; the Ctrl+K command is
  `customizer`.
- **A slider drag is one undo step** through the store's transaction
  (`beginTransaction` on pointer down, `commitTransaction` on release, also on
  `pointercancel` and window `blur`); a keyboard step on the slider has no pointer
  down and is a command of its own.
- **The template exposure lives in `home/gallery.ts`, not in the fixtures**: the
  benchmark e2e specs rewrite `fixtures/benchmarks/*.extrudo` with
  `WRITE_FIXTURES=1`, so anything stored there would be lost. The gallery applies
  the exposure to the copy it hands to storage, through core's commands; a name a
  template doesn't have is skipped, and the gallery's test fails if one is.
- **The shortcut fix:** `ownsKeys` (in `commands/shortcuts.ts`) replaces
  `isEditable` in `useShortcuts`. `isEditable` still answers "is this a form
  control" for the context menu. Without this a focused slider kept Ctrl+Z and
  the drag could not be undone.

## Rejected

- **An `active` configuration field:** it goes stale after any edit or undo;
  matching values is always right.
- **Ranges as hard limits:** an expression can legitimately go past a slider's
  range; refusing it would fight the expression language.
- **Exposing model parameters (`d17`) now:** their names change when features
  are deleted and recreated; worth a design of its own.
- **A separate customizer document or file:** configurations are part of the
  design and travel in the `.extrudo` file.

## Deferred

- Exposing model parameters; text strings as parameters (driving P4-03 text
  from the customizer, for name tags); dropdown parameters (a list of allowed
  values); a public "customize and download" page for shared designs.
