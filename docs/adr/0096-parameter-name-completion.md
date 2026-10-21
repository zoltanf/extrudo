# ADR-0096: Parameter name completion in expression fields

- **Status:** Accepted, 2026-10-20
- **Issue:** #77, tester feedback (2026-10-18): typing part of a parameter's
  name in a dimension field should list the names that match (`cut` finds
  `cut_height`).
- **Builds on:** ADR-0004 (the expression language, `<ExpressionInput>`),
  ADR-0086 (the Parameters dialog).
- **No schema or file-format change.**

## Context

`<ExpressionInput>` is every numeric field: feature dialogs, the Parameters
dialog, sketch dimensions, panels, Settings. It gets one `evaluate(text)`
callback from its caller and nothing else, and each caller decides the scope:
the Parameters dialog leaves out the parameter itself and what depends on it
(a cycle), a feature dialog evaluates against the draft feature, a few fields
(export, print info) know no names. There are about forty call sites.

## Decision

1. **Names come from a React context**, not a prop. `ExpressionNamesProvider`
   (`apps/web/src/parameters/expressionNames.tsx`) wraps `AppShell` with the
   document store and provides a getter: every parameter of the current
   document (`evaluateParameters(doc).parameters`, user then model, in document
   order) with its value formatted by `formatQuantity`, cached per document
   object. A getter keeps document edits from re-rendering fields and evaluates
   nothing until a list opens. Without a provider (the home screen) there are
   no names.
2. **Each field filters by its own `evaluate`.** A name is offered when
   `evaluate(name)` succeeds or fails for another reason than an unknown name or
   a cycle; a unit mismatch still counts as in scope (`count * 1 mm`). For that
   `ExprError` gets an optional `code`: `'unknown-name'` (the evaluator's
   "Unknown name") and `'cycle'` (the parameter graph's "refers to itself").
   The answer is cached per name while the field has the focus, so a feature
   dialog's draft evaluation runs once per matching name, not per keystroke.
3. **Matching** (`apps/web/src/parameters/completion.ts`): the identifier
   around the caret (`wordAt`), none inside a number or where a unit follows a
   number (`10 m`); names that contain it ignoring case, the exact name first,
   then prefix matches, then the rest, each in document order (`matching`).
4. **Keys.** Typing a word opens the list, unless its only entry is the word
   itself (a name typed out in full: the list would only cover what is under
   it, such as a dialog's OK button); ↑/↓ pick (none is picked at first);
   Enter inserts the picked name, and without a pick commits as before, so
   specs that type a value and press Enter don't change; Tab inserts the picked
   name or the first, except when nothing is picked and the word already is the
   first name (then Tab moves on); Esc closes the list and only a second Esc
   reverts the field; Ctrl+Space opens the list on an empty word; ←/→/Home/End,
   a click outside and blur close it. The picked name replaces the whole word
   and the caret goes after it.
5. **The list is a Radix Popover** anchored to the field, portalled, so a
   dialog's scrolling body doesn't clip it, and as a nested dismissable layer a
   click in it doesn't close the dialog. Its content is the `role="listbox"`
   (`Parameters for <field label>`), options `role="option"` with
   `aria-selected`; the field keeps the focus and its `textbox` role, with
   `aria-autocomplete="list"`, `aria-controls` and `aria-activedescendant`.
   Options keep the focus on mouse down and insert on click. The popover never
   dismisses itself on Esc (`onEscapeKeyDown` prevented), so the field's own
   handler decides, and it stops the event so the sketch dimension editor and
   dialogs don't see it.

## Rejected

- **A `names` prop on every call site:** about forty callers to thread, each
  repeating the scope that `evaluate` already encodes.
- **Matching on the message text** ("Unknown name …") to find names out of
  scope: breaks with any rewording.
- **The `combobox` role on the field:** right by the pattern, but over four
  hundred e2e locators find these fields as `textbox`, and `aria-activedescendant`
  is allowed on a textbox.
- **An absolutely positioned list inside the field:** the dialog body scrolls
  (`overflow: auto`) and would clip it.
- **Functions (`sin`, `min`, …) and constants in the list:** later, as the issue
  says.

## Consequences

- A field whose `evaluate` doesn't use the document's parameters offers none,
  with no change at its call site.
- A new place that shows `<ExpressionInput>` outside `AppShell` gets no names
  until it adds the provider.
