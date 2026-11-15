# ADR-0004: Expression language, units and parameters

- **Status:** Accepted, 2026-09-25
- **Task:** P0-07 (expression and parameter engine). Code:
  `packages/core/src/expr/`, `apps/web/src/parameters/`.
- **Affects:** every numeric input (dialogs, sketch dimensions, heads-up
  boxes), the recompute engine (P2-01), sketch dimensions (P1-07), scripting.

## Context

Every numeric input in Extrudo takes an expression (FR-PAR-02, FR-PAR-03):
numbers with units, arithmetic, a few functions, `pi`, and references to user
parameters and model parameters (`d1`, `d2`…, FR-PAR-01). Unit errors such as
`10 mm + 5 deg` must be caught, and so must circular references and undefined
names, with a clear message (FR-PAR-04). The architecture planned a small
hand-written Pratt parser in `core` with dimensional analysis on length, angle
and unitless (§4.3), rather than mathjs, which is too big.

## Decision

1. **Grammar.** `+ -` < `* /` < unary `+ -` < `^` (right-associative, so
   `-2^2 = -4` and `2^3^2 = 512`) < atoms: a number with an optional unit
   (`10 mm`, `2.5in`, `1e-3 m`), a name, a call `name(args)`, or a
   parenthesised expression. A unit may only follow a number literal. There is
   no implicit multiplication: `2 width` and `2(3)` are "missing an operator".
   Units: `mm cm m in ft deg rad`. Functions: `sin cos tan asin acos atan sqrt
   abs min max round floor ceil`; constant `pi`. Every AST node carries its
   source span, so errors underline the exact part that is wrong.

2. **Dimensions are exponent pairs (length, angle)**, and values are held in
   base units: millimetres and degrees. Angle is a dimension of its own, not
   dimensionless, so adding a length and an angle is an error. Intermediate
   results may be areas or volumes (`sqrt(a^2 + b^2)` works); the final result
   must match what the field needs.

3. **Plain numbers take the unit of their context.** A "bare" value is a
   literal, or arithmetic of literals only. Next to a length in `+ - min max`,
   and at the top level of a length field, it counts in the document's length
   unit; in an angle context, in degrees. So `width + 2`, a bare `10` in a
   length field, and `sin(30)` all do what a CAD user expects. Anything else
   must match exactly: a unitless *parameter* in a length field is an error
   ("Multiply by a unit, like `… * 1 mm`"), and so is `width + pi`.

4. **Trigonometry** takes an angle. A bare number counts as degrees; a
   non-bare unitless value (`pi / 6`, a unitless parameter) counts as radians,
   the maths convention. Inverse functions return angles.
   `round`/`floor`/`ceil` round in display units (document length unit,
   degrees), not in millimetres.

5. **One namespace for user and model parameters.** Model parameters are
   feature inputs of kind `expr` with a `paramName`. `ExprInput` gains an
   optional `unit` (`length` when absent), so the evaluator knows what each
   model parameter must be without asking the feature registry. This is an
   additive schema change: no version bump. Names can't be units, functions or
   `pi`, and a name used by a model parameter can't be taken by a user
   parameter.

6. **Evaluation walks the reference graph depth-first** (`evaluateParameters`)
   with a stack for cycle detection. Every parameter in a cycle gets the cycle
   with its path ("`wall` refers to itself: wall → lid_gap → wall."), with the
   reference that closes it underlined. Dependents of a broken parameter say
   which one ("Uses `wall`, which has an error.") instead of repeating its
   message. Unknown names get a "did you mean" suggestion within a small edit
   distance. The result also answers `dependents(names)` and
   `featuresAffectedBy(names)`, which the incremental recompute (P2-01) uses to
   mark features dirty.

7. **Commands keep references intact.** Renaming a parameter rewrites every
   expression that refers to it, in user parameters and feature inputs. The
   rewrite matches name tokens with a regular expression (not function calls,
   not parts of longer names), so it also works on expressions that don't
   parse at the moment, and it leaves the user's formatting alone. Deleting a
   parameter that is still used is refused, naming the users.

8. **`<ExpressionInput>`** evaluates the draft on every keystroke, shows
   `= value` or the error, and underlines the error span on a backdrop layer
   that repeats the text in the same monospace font. Enter or blur commits
   only a valid, changed expression; an invalid draft stays in the field until
   it is fixed or Esc reverts it. The Parameters dialog evaluates each draft
   against a copy of the document with the draft applied, so cycles and
   downstream unit errors show *before* anything is committed. Until the app
   shell exists (P0-04), the dialog is a native `<dialog>` on the debug page
   `#/debug/parameters`.

## Rejected options

- **mathjs:** too big for what we need, and its units system doesn't know our
  "plain number takes the context unit" rule. Already rejected in §4.3.
- **Angles as dimensionless (radians):** simpler, but then `10 mm + 5 deg`
  can't be caught, which the acceptance criterion requires.
- **Strict units everywhere, no bare-number adoption:** `width + 2` would be
  an error. Too annoying for the most common edit in CAD.
- **Bare numbers in `sin()` as radians:** mathematically standard, but CAD
  users think in degrees, and angle fields already default to degrees.
- **Implicit multiplication (`2width`, `2(a+b)`):** ambiguous next to unit
  suffixes, and it hides typos.
- **Rename by re-printing the AST:** it would reformat the user's text and
  can't handle an expression that doesn't parse right now.
- **Kinds for model parameters from the feature registry:** the evaluator
  would need the registry, and sketch dimensions (P1) have no feature
  definition per dimension. Storing `unit` on the input is self-describing.

## Consequences

- **Tests:** 196 expression cases (numbers, precedence, units, functions,
  plain-number rules, expected kinds, unit, name and syntax errors with
  spans, formatting) and 30 parameter-graph and command cases in Vitest;
  Playwright drives the dialog: live values, a unit error that is never
  committed, a cycle, add, rename, delete and undo.
- **P1-07** (dimensions) must add sketch-dimension expressions to rename and
  delete checks; `updateParameter` has a note where.
- **Inline parameter creation** (`wall = 2 mm` in any field, FR-PAR-03) is
  not done; the parser rejects `=` with "Unexpected character", which P1 can
  turn into the create flow.
- **Scrubbing a value** (dragging a manipulator) creates one command per
  commit, not per frame; coalescing is still open (ADR-0003).

## Amendment, 2026-11-15: limits on length, values per call and depth through parameters

**Decision.** Three limits join the nesting limit (`MAX_DEPTH`, 256 levels, ADR-0083's
amendment of 2026-10-15). Past any of them the expression is an error like any other,
with code `limit` on its `ExprError`:

1. **Length.** `parse` reads at most `MAX_EXPRESSION_LENGTH` = 10,000 characters and refuses a
   longer source before reading it: "Longer than 10000 characters: split it into
   parameters." The underline marks the part past the limit.
2. **Values per call.** A call takes at most `MAX_CALL_ARGUMENTS` = 1,000 values: "`min` takes
   at most 1000 values." with the function's name underlined. A node's height is computed
   with a loop over its children, never by spreading them into a call.
3. **Depth through parameters.** `MAX_PARAMETER_DEPTH` = 512 levels, counted as the summed
   height of the expressions along a chain of parameters (`a + 1 mm` is 2 levels, a bare
   `a` is 1): `p0 = p1` … `p511 = 1 mm` is 512 deep and evaluates. The first parameter past
   the limit says "Nested more than 512 levels deep through the parameters it uses.",
   underlining its reference to the next one, and those that use it say "Uses `p…`, which
   has an error." like any other dependent. A real cycle keeps its message.

**How the depth is kept.** Each evaluated parameter records its deepest chain (its own height
plus the deepest of the parameters it uses); a parameter that evaluates has evaluated
every reference, so the number is exact and the error doesn't depend on the order of the
list. When the evaluation stack itself would go past the limit (a chain listed from its
near end), it unwinds uncached and `evaluateFromTop` evaluates the parameter where it went
past first, then tries again: work stays linear in the chain's length. A parameter reached
again while one waits for it is in a cycle longer than the limit and gets the depth error.

**Importers.** The f3d import keeps a user parameter's value, with its usual note
(`Parameter x: "…" kept as its value (<message>).`, the expression quoted up to 80
characters), when its expression is past the length or values limit, and, when the file's
parameters go past the depth limit through each other, every one of them with an error
(found on a scratch document before any is made), so the rest evaluate. A feature input
whose expression from the file is past a limit takes its value.

**Census behind the numbers** (2026-11-15, every expression in the repository's fixtures,
66 designs and 616 expressions, and in the 252 designs of the private import corpus as
imported, 8,474 expressions):

| | repository | corpus | limit | factor |
|---|---|---|---|---|
| Longest expression | 31 characters | 73 | 10,000 | 137× |
| Most values in one call | 0 (no calls) | 1 | 1,000 | 1,000× |
| Tallest expression | 4 levels | 6 | 256 (`MAX_DEPTH`) | 43× |
| Deepest chain of parameters | 3 parameters, 7 levels | 4 parameters, 7 levels | 512 levels | 73× |

No fixture or corpus design comes near a limit, so no saved design changes.

**Rejected:**
- **Counting parameters, not levels.** Each parameter of a chain can nest 255 levels, so a
  count of parameters says little about how deep evaluation goes; levels count both.
- **Marking every parameter on the stack when it gets too deep.** Simple, but it gives the
  error to parameters whose own chain is within the limit and depends on the list order.
- **Marking only those whose chain to the stack's top is past the limit, and evaluating the
  rest later.** Exact, but each parameter of a long chain then walks the whole limit again:
  quadratic in the chain's length.
- **A smaller length limit (1,000).** Still 13× the longest real expression, but a
  hand-written formula with long names gets close; 10,000 costs little, since reading is
  linear in the length.
