# ADR-0113: Imperial units: the document unit editor, an inch grid, fractions and feet-inches

- **Status:** Accepted, 2026-10-28 (the owner asked for all three slices; S1
  here, S2 and S3 as follow-up slices)
- **Task:** P6-18 (`docs/03-roadmap.md`), FR-PRJ-07.
- **Builds on:** ADR-0004 (expressions and units: plain numbers take the
  context unit; `mm cm m in ft deg rad`), ADR-0008 (the viewport's shader grid
  and grid snapping), ADR-0003 (commands, migrations).
- **Schema change:** S3 adds the optional `settings.fractions` (section 3).
  S1 and S2 change no schema.

## Context

The file format has carried `settings.units` (`mm`, `cm`, `m`, `in`) since
format 1, the expression language takes `in` and `ft`, `formatQuantity`
displays lengths in the document unit, and `Design.create({ units })` makes an
inch design through the API. But the app itself had no way to set a design's
unit: the browser's Document settings folder showed it read-only, and nothing
dispatched the `document.settings` command. US users of a 3D-printing CAD want
to type and read inches, usually as fractions (`1 1/2"`, `3/8"`), on a grid
that makes sense in inches.

The one hard problem is what a unit change does to numbers typed without a
unit. The `ExpressionInput` stores what the user typed, so an extrude distance
is usually `"10"`, which ADR-0004 reads in the document unit. Switching a
millimetre design to inches would silently make it 25.4 times bigger.

## Decision

### 1. The unit editor keeps every length (S1)

`document.settings` (`packages/core/src/document-commands.ts`, `updateSettings`)
is the one way to change the unit or the precision. When the unit changes, the
command first spells the **old** unit out on every plain length number in the
document, so the model keeps its size and only the display and the meaning of
newly typed numbers change:

- A plain number is a literal or arithmetic of literals with no unit and no
  parameter (`isBareNumber`, `packages/core/src/expr/spell-unit.ts`), the
  same notion as the evaluator's `bare`. `10` → `10 mm`; `-2.5` → `-2.5 mm`;
  `10 / 2` → `(10 / 2) * 1 mm`. Anything with a unit, a parameter or a
  function is left as written.
- Every place an expression lives is covered: user parameters of unit `length`
  and their slider `min`/`max`/`step`, configuration values of those
  parameters, feature `expr` inputs whose unit is `length` (plugin `in:` and
  OpenSCAD override inputs included), and sketch dimensions other than angles.
  Angles and unitless numbers are untouched.
- The rewrite is part of the same command, so one undo step brings the unit
  and every expression back together. Setting the same unit again, or the
  precision alone, rewrites nothing.

The UI: the browser's **Document settings** folder has two rows, `Units` and
`Precision`, each a native select (`DocumentSettings` in
`apps/web/src/shell/BrowserPanel.tsx`), and the home screen's **New design**
card has a unit select whose choice is remembered in the `newDesignUnits`
preference and passed to `createDocument`. Precision offers 0 to 6 places (the
schema allows 8).

**Rejected:** re-reading plain numbers in the new unit (what the format's rule
alone would do): it rescales the model behind the user's back, and nobody who
switches a finished design to inches wants it 25 times bigger. **Rejected:**
converting every expression to the new unit (`10 mm` → `0.3937 in`): it
destroys the numbers the user wrote; a dimension shows the converted value
anyway. **Rejected:** a confirmation dialog offering both: a second choice for
a case that has one right answer.

### 2. An inch design gets an inch grid (S2)

`gridStep` (`apps/web/src/viewport/grid.ts`) and the grid shader
(`GridPlane.tsx`) take the document unit. Metric designs keep ADR-0008's
levels, powers of ten mm with 1 mm the finest. An inch design uses the levels
**1/16, 1/8, 1/4, 1/2, 1, 6, 12 in (1 ft), 120 in (10 ft), 1200 in**, in mm
internally (1 in = 25.4 mm): the finest level whose cells are at least 12 px
wide is the snap step, the grid draws that level as minor lines and the next
as major lines. The shader picks the level per fragment (its spacing varies
across a perspective view), so it gets the level table as a uniform array in mm
and walks it, instead of `pow(10, floor(log10 …))`; the fade between levels
stays. The finest snap step in inches is 1/16 in; `cm` and `m` designs
stay on the millimetre levels. Sketch snapping (`sketch/tools/host.ts`, the
`grid` option) uses the same function, so points land on the drawn lines. The
sketch's own mm storage is unchanged; the grid is display and snapping only.

**Rejected:** powers of ten inches (0.1, 1, 10 in): nobody measures in tenths
of an inch outside machining. **Rejected:** a user setting for the grid's
levels: the unit says enough.

### 3. Fractions and feet-inches (S3)

**Input.** The parser (`packages/core/src/expr/parser.ts`) accepts, as one
number with a unit:

- a **fraction** `3/8` or a **mixed number** `1 1/2` or `1-1/2`, when a length
  unit follows directly: `3/8 in`, `1 1/2 in`, `1-1/2"`. A fraction is `int/int`
  with no spaces inside, so `10 / 2` stays a division and `1 1/2` without a
  unit stays an error;
- `"` for inches and `'` for feet after a number: `6"`, `5'`;
- **feet and inches** as one quantity: a feet number directly followed by an
  inches number, `5' 6"`, `5 ft 6 in`, `5' 6 1/2"`, is their sum.

The tokenizer gains `"` and `'` as unit tokens; nothing else in the grammar
changes, so `width + 2` and every existing expression parse as before.

**Display.** `settings.fractions` (optional boolean, absent = false; only
meaningful with `units: "in"`) makes `formatQuantity` show an inch length as
the nearest binary fraction: whole inches, then a reduced fraction,
`1 1/2 in`, `3/8 in`, `0 in` for zero, `-1/4 in`. The denominator follows the
precision: `2^(precision + 2)` capped at 64 (precision 0 → 1/4, 1 → 1/8,
2 → 1/16, 3 → 1/32, 4 and above → 1/64), so the existing precision setting
keeps one meaning (how fine) and the Precision select shows `1/4 … 1/64`
labels in that mode. Areas and volumes stay decimal. Lengths in other units
ignore `fractions`. The browser's Document settings folder gets a `Fractions`
row (a checkbox) shown only for an inch design; the Parameters dialog,
dimension labels, feature dialogs, the measure tool and the customizer all
format through `formatQuantity`, so they follow. The `ExpressionInput` keeps
showing what the user typed; its computed-value hint uses the fraction form.

**Storage** is unchanged: the document stores the expression text the user
typed (`1 1/2 in` stays `1 1/2 in`), geometry stays mm, the API's plain values
(`'1 1/2 in'`) go through the same parser. `fractions` is an optional field,
so no format version bump (file-format.md section 5.1.1's rule); the
file-format doc gets the field and the grammar; `pnpm api:generate` runs for
the describe text.

**Rejected:** `ft` as a document unit: a 3D-printing design in feet has no
use, and feet-inches display (`5' 6"`) is a formatting choice, not a unit; if
it is ever wanted it is a second display flag, not a unit. **Rejected:**
decimal-feet. **Rejected:** a sixteenths-only display: 1/32 and 1/64 are
common on drawings; the precision setting already says how fine.

## Consequences

- A design made in millimetres can be switched to inches and back without
  moving a face; the expressions grow units (`10 mm`), which is also what the
  format 1 migration did to numbers.
- Users who type a plain `10` in an inch design get ten inches, as ADR-0004
  always said; the status bar and every dimension show the unit.
- S2 and S3 touch the viewport grid and the expression parser, two places
  every e2e exercises; their specs (`e2e/document-units.spec.ts` extended, or
  their own) must cover a metric design staying as it was.
