# ADR-0156: Work the page repeats for every shown sketch is done once per sketch version

- **Status:** Accepted, 2026-11-19.
- **Task:** none of its own: what ADR-0154's open question on the blocks that
  are not profile work left, measured and fixed where the fix changes nothing
  the user sees.
- **Builds on:** ADR-0020 (data remembered only when frozen all the way
  through), ADR-0154 (the shell hands new drawings with every profile result),
  ADR-0052 (the tutorial's steps are pure checks over the document).
- **Schema change:** none.

## Context

With the profile worker in, a design with many large sketches still blocked
the page: on opening, on every pointer move over the model, on a click, on
showing or hiding a sketch. A CPU profile of each action attributed the time
to work repeated for every shown sketch on every render or every pick, work
whose answer depends only on a sketch's data, which the document store
freezes. For ordinary designs (30 to 100 plates with holes) the same work
costs tens of milliseconds per pointer move.

## Decision

1. **Per-sketch facts are remembered by the sketch's data** (`sketchFacts`,
   `packages/core/src/sketch/facts.ts`): whether it has a non-construction text,
   its texts and their fonts, how many lines it has. Kept in a `WeakMap` only
   when `data`, its entity map and every entity are frozen (the facts read only
   the entities' own fields, so frozen ones can't change them); other data is
   walked on each call and nothing is kept. `hasText` (the profile client),
   `usedFonts` (the fonts the UI and the kernel load), `textBoundsSummary` (the
   viewport's test attribute, now only over the texts) and the tutorial's
   "rectangle" step read them. The tutorial's current step is memoised by its
   facts (`useTutorial`): the React Compiler does not memoise a plain call whose
   result is a number, so it ran on every render of the shell, which re-renders
   for every batch of profile results.

## Rules

- A check that runs per render over every sketch reads `sketchFacts` (or adds a
  fact there) instead of walking `data.entities`.
- Facts are kept only for data frozen through its entities; a new fact must
  read only an entity's own fields (or it needs the deep check of
  `curveLines.ts`).

## Rejected

- **Keeping the facts for any data object.** A builder's or a draft's data is
  changed in place; ADR-0020 keeps detection only for frozen data for the same
  reason.

## Numbers

Opening a stored design with many large sketches (Chrome, real GPU, minified
build): the time the page was blocked in all fell by about two thirds, most of
it the three walks above; showing or hiding a sketch by a third to a half.
