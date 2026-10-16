# ADR-0086: The Parameters dialog as list and inspector, parameter groups, formula ranges

- **Status:** Accepted, 2026-10-15 (the owner chose prototype "C refined" of
  four directions).
- **Amends:** ADR-0059 §1 (the customizer's range and group) and §5 (file
  format).
- **Builds on:** ADR-0004 (expressions), ADR-0016 (parameter writes go
  through the shell), ADR-0068 (the API).
- **Schema change:** file format **2** (the first bump), with a migration from 1.

## Context

The Parameters dialog was one table. Starring a parameter for the customizer
added a details row under it (the same sentence of help each time, a Min, Max
and Step field with a result line and a Clear button each, and a Group field),
so a design with a few exposed parameters became a long, busy page. The
customizer's range was stored as numbers in the base unit: a formula typed
into Min or Max (`10 * wall`) was evaluated once and its number kept, never
the reference. The group belonged to the customizer only, so parameters
couldn't be organised unless they were exposed, and there was no way to put
the list in an order.

## Decision

### 1. Groups belong to the parameter

`Parameter.group` (1 to 40 characters, optional) replaces `customizer.group`.
Any user parameter can have one. While no parameter has a group, the dialog's
list is flat ("User parameters"); once one has, the list is in sections:
parameters without a group first under "General", then each group in order of
first appearance. The customizer panel groups the exposed parameters the same
way (`customizerRows` reads `parameter.group`). `setParameterGroup` sets or
clears it in one undo step. A group exists while a parameter has it; there is
no list of groups to keep in step.

### 2. The slider range is expressions

`customizer.min`, `max` and `step` are expression strings in the parameter's
unit, kept as typed (`40 mm`, `width / 20`). `evaluateRange` evaluates one
against the other parameters and refuses, beyond the expression's own errors:

- a range that uses the parameter itself, or a parameter that depends on it
  (`dependents`): the range would move while the slider is dragged. The error
  names the parameter ("The range can't use `inner`: it changes with
  `width`.");
- a step that isn't above 0.

`setParameterCustomizer` trims each field, drops an empty one, evaluates the
rest and refuses an error or a min above the max. Because a range can now
change after it was set (a parameter it uses changes), `customizerRows`
evaluates it every time and leaves out an end that no longer evaluates, and
both ends when the min is above the max: the row then has no slider rather
than a wrong one. The schema no longer checks min against max (only
evaluating can tell). Renaming a parameter rewrites the ranges that use it;
deleting one that a range uses is refused, like any other use.

### 3. Order

The order of `doc.parameters` is the dialog's order and the customizer's
order. `moveParameter({ id, index, group? })` moves a parameter to a position,
and optionally into a group (`null` takes it out), in one undo step: a drag in
the dialog. Order never changes a value (expressions refer by name). The
script emitter (ADR-0073) still writes parameters in dependency order, so a
round trip through a macro can reorder a parameter that uses a later one.

### 4. "Used by"

`parameterUsers(doc, name)` lists every expression that names a parameter:
user parameters, slider ranges, feature inputs and sketch dimensions (with
their model parameter name), joint limits. `refuseIfUsed` is built on it, so
the dialog's list and the delete refusal can't disagree.

### 5. The dialog

A list on the left, the selected parameter on the right (the prototype C,
refined):

- **List:** a row is a grip, a star (filled when exposed), the name, `ƒx` for
  a formula, and the value (or "loop" / "error" in red). Rows are dragged to
  reorder and between sections (a drop line shows where; an empty "General"
  appears as a drop target while dragging), moved with Alt+↑/↓, and have a
  context menu (customizer, move, delete, undo, redo). "New parameter" opens
  the form; "Model parameters" is a collapsed section of the features' and
  sketches' named values.
- **Inspector:** name, unit (three radio buttons), expression, comment, the
  group as chips (no group, each group, a new one typed in place), "Used by"
  chips (a parameter's chip selects it), and the Customizer card: a switch,
  and for a plain value a slider preview with Min, Step and Max fields. A
  formula parameter gets no range fields (the panel shows it read-only, as
  before). A footer has Move up/down and Delete.
- **New parameter:** a form in the inspector; Add (or Enter) adds the
  parameter and selects it.

### 6. File format 2

Version 1 → 2 (`migrations.ts`): each number in `customizer` becomes an
expression with the base unit spelled out (`25.4` → `25.4 mm`, `30` →
`30 deg`, plain for a unitless parameter), so an inch design still reads its
ranges as millimetres; `customizer.group` moves to `parameter.group`. An older
Extrudo opens a format 2 file as far as it understands it (ADR P3-13) unless
it has a range: a string where it expects a number is refused as too new.

## Rejected

- **Keeping numbers and adding `minExpr` beside them**: two fields for one
  value, and the number goes stale the moment a parameter it came from changes.
- **`number | string` without a format bump**: old files would load without a
  migration, but every reader would handle two shapes forever, and the group
  would still need moving.
- **A separate Customizer tab** (prototype D) and **one line per parameter**
  (prototype B): clean, but D splits a parameter's settings across two places
  and B has no room for "Used by" or the error messages.
- **Group ordering of its own**: groups follow the parameters (first
  appearance), so dragging the first member moves the group; a separate order
  would be a second list to keep in step.

## Deferred

- Renaming a group in one step (today: pick the new name on each member).
- Selecting a feature from a "Used by" chip (only parameters are linked).
