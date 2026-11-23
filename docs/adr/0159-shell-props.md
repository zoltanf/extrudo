# ADR-0159: What the shell hands down stays the same while it doesn't change

- **Status:** Accepted, 2026-11-23 (the owner chose to keep props stable first and to compile
  the shell later; open questions answered: a compiler test in Vitest, refs written in
  insertion effects once the shell compiles, per-item view components memoised by hand, the
  sketch drag keeps editing the document on every pointer move, splitting the shell later,
  one ADR with an amendment per step).
- **Builds on:** ADR-0102 §3 (the React Compiler memoises components and hooks), ADR-0156 and
  its amendment of 2026-11-19 (profile results render what shows them; the chip memoised).
- **No schema or file-format change.**

## Context

The React Compiler skips 74 of the app's 508 components and hooks, without a word in the build.
The largest is `Shell` (`shell/AppShell.tsx`, 3,400 lines: 46 diagnostics, mostly refs written
during render and closures reading refs handed to the action creators). A skipped component
hands new callbacks and objects to its children on every render, and a skipped child renders
whenever its parent does. Measured on designs of 30 and 100 plates with 30 holes each (a
sketch and an extrude per plate): dragging a point in an open sketch edits the document on
every pointer move, every edit renders `Shell`, and each of those renders every sketch's
drawing, every timeline chip and every toolbar tile: 51,000 / 119,000 component renders for a
10-move drag, 420 / 779 ms of the page blocked.

A compiled child still re-renders when an uncompiled parent does, but reuses its own memoised
parts while its props stay the same objects. So keeping the few props that fan out to many
components the same gets most of the gain without compiling `Shell`, which is a larger
change of its own (making it compile was tried: 46 diagnostics fixed in six rounds; on its
own it saved little, and a closure using a `const` declared further down made the compiler
rebuild that value with the closure, so it rendered 2–3× more until fixed).

## Decision

1. **A test keeps compiled components compiled** (`apps/web/src/compiler.test.ts`). It runs
   `oxc-transform-react` the way the build does (target 19) in lint mode over the app's
   sources (not tests, type files or workers), names each skipped component or hook by the
   top-level declaration that holds the diagnostic, and compares them with
   `apps/web/compiler-skips.json`. A newly skipped one fails the test (fix it, or add it to the
   list on purpose); a listed one that compiles now fails it too, so the list only shrinks.
   `EXTRUDO_UPDATE_COMPILER_SKIPS=1` rewrites the list (then `pnpm format`).

## Rules

- A component or hook that compiles must keep compiling; adding one to
  `compiler-skips.json` is a decision for the pull request's text, not a side effect.
- A component that comes off the list stays off.

## Rejected

- **Compiling `Shell` first.** Possible (about 350 changed lines in `AppShell.tsx`), but it
  saves little until the props below are stable, and it needs this test and a check for
  forward references before it is safe. It comes later.
- **Splitting `Shell` into compiled parts.** Ten or more slices before any gain; `run`,
  `commands`, `doc` and the selection are read by nearly every part.
- **Matching component names in the compiler's output** (`_c(` in each function) instead of its
  diagnostics: depends on the generated code's shape.

## Amendment (2026-11-23): each sketch keeps its drawing while it draws the same

**Context.** The shell builds every shown sketch's drawing again whenever its `sketchBase`
memo runs: on every document change, so on every pointer move while a sketch point is
dragged. The provider memoises its dressed drawings by the base drawing object (ADR-0156's
amendment), so every sketch's drawing was new and every sketch drew again: 270 sketch
renders (and as many for each of the three mark layers and the fill) for a 10-move drag on
30 plates, where one sketch changed.

**Decision.** `ShownSketchesProvider` passes the shell's base through `keepDrawings` before
adding results: a sketch whose new drawing draws the same as the last one it kept (by sketch
ID) gets the kept object. Data and the solver's status count by identity (the document's data
is frozen, and a new object exactly when its sketch changes); every other field by value (the
frame, the selected entities and profiles, the flags). The same base comes back while nothing
is replaced; a replaced item is a copy, so the shell's base is never written to; the kept map
holds the current base's drawings only. The provider's effects are untouched (no new effect,
same order); the shell's `sketchBase` memo, with its calls into the profile cache, is
untouched.

**Rules.**

- A field added to `SketchDrawing` that is large or changes identity on purpose must be
  compared by identity in `drawsTheSame`; anything else is compared by value.
- `keepDrawings` never writes into the base's items or drawings, and keeps only the drawings
  it returned.
- "Draws the same" covers only what is in the drawing. What its readers take from outside it
  during a render stays with the outside: the open sketch's fill reads the profile cache by
  its data **and the fonts' version** (`sketchProfiles`, `sketchRegions`), so a new fonts
  version keeps nothing (the kept drawings carry the version they were made for, and every
  drawing is the shell's new one, as before drawings were kept). Checked, nothing else: the
  view's size is read per frame (`useFrame`), not in render; colours, the curve cache and the
  pick state are props; lengths don't depend on the unit. A new outside input read in render
  must reset the kept drawings the same way.
- Tested: `shownSketches.test.tsx` (an edit in one of 30 sketches renders that sketch's
  stand-in only; the same values in new objects render none; each kind of change gives the
  new drawing; the base is not written to), `Sketches.renders.test.tsx` (the real `Sketches`:
  an edit in one of 30 renders one sketch and one fill; a new fonts version renders every
  fill, the open sketch's included, and the same fonts none).

## Amendment (2026-11-23): the timeline keeps its chip order

**Context.** The timeline's `order` (the features' IDs) was memoised on `doc.features`, which
is a new array on any edit inside a feature. The chips' `onSelect` depends on it (ADR-0156's
amendment), so every sketch edit gave every chip a new callback: 480 chip renders for a
10-move point drag on 30 plates, 1,400 on 100, each with its tooltip and menu triggers.

**Decision.** `order` is memoised on the features' IDs joined into one key: the same array
while the IDs and their order are the same; a new one when a feature is added, removed or
moved. An edit inside a feature renders that feature's chip only (its `feature` prop).

**Rules.**

- Props the chips share (`select`, `live`, `order`-derived values) depend on the features' IDs,
  never on the feature objects.
- Tested: `Timeline.renders.test.tsx` (ten edits inside one of 30 features render that chip ten
  times and no other; swapping two features renders every chip).

## Amendment (2026-11-23): the toolbar's and the app bar's callbacks stay the same

**Context.** `Shell` handed the toolbar `onRun={run}` and the app bar `onTutorial` and an
inline `helpTool`: new functions on every render of the shell (it isn't compiled). The toolbar
is compiled and keeps its tiles while their props stay, but a new `onRun` gave every tile a
new click handler, so each render of the shell rendered every tile with its tooltip and menu
(about 12–18 tiles, a few hundred components, per render: once per pointer move while a
sketch point is dragged).

**Decision.** `useLatest(fn)` (`shell/latest.ts`): a function that stays the same object and
calls the latest `fn`, taken in an insertion effect. The shell hands the toolbar
`useLatest(run)` and the app bar `useLatest(startTutorial)` and `useLatest(helpTool)`. The
existing refs (`runRef` and the others, written during render) are unchanged, so the order in
which those refs get their value is unchanged; the new ones follow the owner's choice for refs
(insertion effects: every layout and passive effect of the commit, and every event after it,
sees this render's function).

**Rules.**

- A callback the shell hands to a component that renders many children (toolbar, app bar)
  goes through `useLatest` (or is otherwise stable); never an inline function or a function
  made in the shell's render.
- `useLatest`'s result is called from events and effects, never during a render.
- Vitest doesn't run the React Compiler, so the tiles' reuse can't be counted there: it rests on
  the toolbar being compiled, which `compiler.test.ts` (§1) keeps. Tested: `latest.test.tsx`
  (the same function across renders under StrictMode, calling the latest; a child's layout
  effect already calls this render's function, which a passive effect would not).

**Numbers (§2–§4 together).** Components rendered, production build, designs of 30 / 100
plates with 30 holes each (a sketch and an extrude per plate), before → after: dragging a
point in an open sketch (10 pointer moves) 51,981 → 29,681 / 118,286 → 53,801; undo of an
edit 9,480 → 6,748 / 30,375 → 21,318; opening a sketch 10,280 → 9,833 / 25,031 → 23,460; a
box select 12,056 → 11,803 / 29,066 → 28,279. The renders of `Shell` itself are unchanged
(11 / 8 for the drag): what changed is what each of them renders.
