# ADR-0142: Renaming model parameters

- **Status:** Accepted, 2026-11-07 (issue #203), reviewed by the owner 2026-11-10
- **Builds on:** ADR-0086 (the Parameters dialog), ADR-0096 and its amendment of
  2026-10-31 (`name = value` in a dimension's editor).
- **No schema or file-format change.** `paramName` already exists on dimensions and inputs.

## Context

A model parameter (`d1`, a sketch dimension's or feature input's name) could only be renamed
by typing `name = value` in the dimension editor, and that made a **second** parameter: a user
parameter `diameter`, with `d1 = diameter` left behind. The reporter looked for a rename in
the Parameters dialog and found the pair redundant.

## Decision

1. **`renameModelParameter({ name, newName })`** (core, one undo step) sets `paramName` on the
   dimension or input and rewrites every expression that used the old name, through the same
   `rewriteReferences` that `updateParameter` uses for user parameters (parameters, slider
   ranges, inputs, dimensions, joint limits, view sections). Same name rules as a user
   parameter (`checkParameterName`: identifier, not a unit/function/constant, not used by any
   user or model parameter). Driven dimensions have no name and are not found.
2. **The Parameters dialog:** the model parameter inspector has a Name field (commits on
   Enter or blur, errors in the dialog's alert line like a user parameter's), and
   double-clicking a row (user or model) focuses the name field. After a rename the row
   stays selected under its new name.
3. **`name = value` in a driving dimension's editor renames that dimension's own parameter**
   and sets its value (rename, then `expr = value`, one step) instead of adding a user
   parameter. A dimension without a name (driven) keeps the old path: a user parameter
   and `expr = name`. Existing documents are unchanged: a saved `d1 = diameter` still loads.
   For a dimension with a name, the editor's offer for a bare unknown name (ADR-0096's
   amendment) reads **Rename to `width` = 40.00 mm**, in the list and in the link under the
   error, since "New parameter" and "Create" no longer describe what it does (amendment,
   2026-11-08).
4. **Make user parameter** (amendment, 2026-11-07): `makeUserParameter({ name, id })` (core, one
   undo step) adds a user parameter `name` holding the dimension's or input's expression (unit
   from the dimension or input), sets that expression to `name`, and gives it a fresh model
   name (`nextModelParameterName`). Expressions that used `name` need no change. The
   Parameters dialog offers it as a button in the model inspector. It selects the new user
   row. There is **no way back** (undo only): inlining a user parameter that several
   expressions use is ambiguous.
5. **Reset name** (amendment, 2026-11-07): `resetModelParameterName({ name })` renames to the
   lowest free `dN` (`lowestFreeModelParameterName`) and rewrites users. The original auto name
   is not stored (no schema change), so this is usually the original but can differ when
   several parameters were renamed. The button shows only for names that aren't `dN`.
6. **A model parameter that only follows a user parameter is hidden from the list**
   (amendment, 2026-11-07, the owner's call): its expression is a user parameter's name alone
   and nothing refers to the model parameter itself (`followsUserParameter` in
   `apps/web/src/parameters/list.ts`). Such a row says nothing the user parameter's "Used by"
   doesn't, and in the benchmark files they are a quarter of the model parameters or more.
   A line under the model rows, "Show N that follow a user parameter", shows them, and "Hide
   those that follow a user parameter" hides them again. Shown, such a row has a link mark
   (titled "Follows `<name>`") in place of "ƒx". The selected one stays in the list
   until something else is selected, so a row doesn't vanish while its expression is typed.
   **Display only:** the dimension keeps its `paramName` (it still needs a name once a number
   is typed into it again, and its name stays taken).

## Rejected

- Keeping both parameters: nothing needs the indirection, since a rename rewrites every user.
- Making the editor's rename also convert old `d1 = diameter` pairs: it would rewrite
  documents the user did not touch.
- Dropping `paramName` from a dimension that follows a user parameter (instead of hiding the
  row): nothing names a dimension again once it is placed, so typing a number into it later
  would leave a driving value with no name and no row, and any expression using `d3` breaks.
- Hiding model-to-model links (`d4 = d2`, from linked dimensions) too: left for later.
