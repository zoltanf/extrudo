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
