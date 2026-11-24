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
- The list tracks components, not reasons: a new diagnostic inside a component already on
  the list passes unseen. The test runs with a 60 s timeout (the scan takes a few seconds,
  more on a loaded runner).

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
sees this render's function). (Superseded 2026-11-24 by the amendment "`Shell` compiles": no ref
is written during `Shell`'s render any more.)

**Rules.**

- A callback the shell hands to a component that renders many children (toolbar, app bar)
  goes through `useLatest` (or is otherwise stable); never an inline function or a function
  made in the shell's render.
- `useLatest`'s result is called from events and effects, never during a render.
- The tiles' reuse rests on the toolbar being compiled, which `compiler.test.ts` (§1) keeps.
  (Corrected 2026-11-24: this said Vitest doesn't run the React Compiler. It does, for tests in
  the jsdom environment: they get the app's code as the build compiles it; a test in the node
  environment gets it uncompiled. See the amendment on bodies.) Tested: `latest.test.tsx`
  (the same function across renders under StrictMode, calling the latest; a child's layout
  effect already calls this render's function, which a passive effect would not).

**Numbers (§2–§4 together).** Components rendered, production build, designs of 30 / 100
plates with 30 holes each (a sketch and an extrude per plate), before → after: dragging a
point in an open sketch (10 pointer moves) 51,981 → 29,681 / 118,286 → 53,801; undo of an
edit 9,480 → 6,748 / 30,375 → 21,318; opening a sketch 10,280 → 9,833 / 25,031 → 23,460; a
box select 12,056 → 11,803 / 29,066 → 28,279. The renders of `Shell` itself are unchanged
(11 / 8 for the drag): what changed is what each of them renders.

## Amendment (2026-11-24): bodies keep their props

**Context.** A render of the view (every hover, every document change, every step of a drag)
rendered every body with each of its four mark components: `Body`, `EdgeMarks` and
`VertexMarks` are skipped by the compiler (they set three.js materials in render) and `Body`
was not memoised. Even memoised it would have rendered every time: the scene (also skipped)
handed `Bodies` a new accent object (`{ ...colors.preselect, a: 1 }`) on every render, which
every body passes to its marks, and a new section or thickness object while an analysis is on.
And with a section on, `Bodies` made new clipping planes on every render: its
`useMemo(() => clipPlanes(clips), [clips])` is dropped by the compiler (the compiled code
calls `clipPlanes` on every render), so the planes every body takes were new each time.

**Decision.**

1. `useBodyProps` (`viewport/bodyProps.ts`) gives the scene the accent and the analyses'
   objects (overhang, thickness, collisions, section, the region preview), each the same
   object while its parts are.
2. `Body` is `memo`. `Bodies` hands it the shared section and thickness objects (not one per
   body; `Body` takes its own thin flags and its caps' render order as a number), and the
   clipping planes from `planesOf`: one list per list of clips, kept in a `WeakMap` by the clips
   array (the section's clips are immutable: a new array whenever they change, ADR-0045), so
   they don't depend on a memo the compiler can drop.
3. `EdgeMarks` and `VertexMarks` stay as they are: with `Body` memoised a body renders only
   when its own props change, and then one or two of its four marks change; memoising them
   would spare two or three components per changed body.

**What a body and its marks read from outside their props, and why none can go stale.**
The camera (silhouettes) is read per frame in `useFrame`; the renderer's pixel ratio (vertex
dots) in `onBeforeRender`, per frame; the line materials' resolution is set by three's
`LineSegments2.onBeforeRender`, per frame; `useThree`'s `invalidate` is a subscription. The
material and shading settings written in render (colours, opacity, clipping planes, the
analysis shadings) come from props only, so a skipped render leaves them as the same props
set them. The face colours, thin flags and the region preview are written in layout effects
keyed on props. Everything else is a pure function of props (`edgeSegments`, `paintFaces`,
`capColors`, `bodyObjectName`) or a module cache keyed by value (`hex`, `planesOf`), which
gives the same object for the same input. No store, global or setting is read in render.

**Rules.**

- What `Bodies` hands a body is a value or an object kept while unchanged: no object built per
  body per render, no value that depends on a memo the compiler may drop (check the compiled
  output, `oxc-transform-react` client mode).
- A new input a body or a mark reads in render from outside its props (a store, a setting)
  must reach it as a prop, or be read per frame or in an effect.
- Tested: `Bodies.renders.test.tsx` with the real `Bodies` (a render with the same props renders
  no body; a hover on one body renders that body; a new mesh renders its body; with a section
  and a thickness check on, a render renders none and a new section renders all; a new accent
  renders all), `bodyProps.test.tsx` (the same objects across renders; a new part gives a new object
  for that part alone; a new accent colour gives a new accent). Each fails with its part of the change taken out.

## Amendment (2026-11-24): `Shell` compiles

**Context.** `Shell` (`shell/AppShell.tsx`) was the largest component the React Compiler
skipped: 47 diagnostics on 2026-11-24 (refs written in render and closures reading refs handed
to the action creators, 24; manual memos it couldn't keep, 15; `import()`, 7; one ref written
after an effect read it). So every render of it handed new values to everything it renders.

**Decision.**

1. The chunks it loads on demand come from module-level loaders (`loadDrawingTools`,
   `loadSolver`, `loadStandardViews`), called where the `import()`s were.
2. No ref is written during its render. The 16 refs that were get their value in an insertion
   effect, which runs in the commit before every layout and passive effect and every event
   after it. Seven of them are read through functions called during the render (the action
   creators' getters, the file commands): they sit in `Later` boxes (`shell/latest.ts`:
   `useLater`, set by `useLaterValue` in an insertion effect); a ref can't go there, since the
   compiler can't tell the function won't read it at once. The update notice the Ctrl+Z route
   reads (handed to the shortcuts' builder) is a `Later` too, set where the notice tells it, as
   its ref was. So are `run` and the plugin command's run (read by the dialogs' commands and the
   plugin entries) and the pointer the search opens at (set in its `pointermove` handler): a
   closure that reads a ref leaves the value around it unmemoised (item 7).
3. The recompute error's Edit asks `canEditFeature` with `hasFeatureDialog(dialogs, type)`
   (`shell/featureActions.ts`, pure) instead of the feature actions through a ref: the
   notification history asks it while it renders, and a ref given its value in an effect would
   answer with the last commit's actions there. Same answers for every `dialogs` (tested); the
   watcher subscribes again if `dialogs` changes (the app passes one constant registry).
4. Every value is declared above the closures that use it: a closure that uses a `const`
   declared further down makes the compiler build that value inside the closure's memo scope,
   so it is made again whenever anything the closure reads changes (the first attempt rendered
   2–3× more for that). Moved up: `featureActions` with `sketchOnFace`, `redefineTo`,
   `pickPlane` and `startRedefine` (above `run`), `openSection` (above the section's row), the
   import and script-export boxes (above the file actions). The moved blocks hold memos and
   insertion-effect writes only: no layout or passive effect changed place.
5. Dependency lists are complete (the boxes, the update notice). Memos whose lists the compiler
   and Biome's `useExhaustiveDependencies` read differently (Biome calls a state setter
   needless, the compiler counts it) are left to the compiler: `commandBuilder`,
   `markingCommands`, `shortcuts`, `searchAtPointer`, `openBugReport`; the compiler keeps each of
   them (item 7). Two stay hand-written: `dialogCommands` (left to the compiler, the
   expression is built on every render) and `commands` (a plain `commandBuilder(mode, false)` is
   called on every render, and the compiler then keeps nothing built from it; a lint
   suppression says the compiler memoises `commandBuilder`). `featureActions` keeps its manual
   memo too: with the declarations in order, the compiler keeps it.
6. `compiler.test.ts` lists `Shell` as a component that must compile and checks it for names used
   in a closure before their declaration (`forwardReferences`, on Vite's `parseAst`: it visits
   the expression inside `as`, `!`, `satisfies` and `<T>x`, and JSX element names, and skips
   types only), and that the compiled `Shell` builds no value on every render
   (`unguardedValues`: every top-level value that allocates comes from a memo guard).
7. **What `Shell` hands down keeps its identity as on main.** Checked in the compiled output
   (`oxc-transform-react`, target 19): every value main memoised by hand, and handed to a child,
   an effect's list, `useShortcuts` or the desktop menu, comes from a memo guard, except
   `pickingSketchPoints` and `kernelBusy`, which are booleans (compared by value). An
   independent read found three that weren't, the first time `Shell` compiled: `dialogCommands`
   (its run read `runRef`), `searchAtPointer` (it read the pointer ref) and with them
   `shortcuts`, so the shortcuts' window listeners were removed and added again, and the
   desktop menu updated, on every render of `Shell`; `pluginEntries` (its run read
   `runPluginRef`) was found the same way. The `unguardedValues` test catches such a value; it
   can't see a guarded value whose input is new on every render because a skipped hook makes it
   (`useSection` and the other analysis hooks), so those stay out of what fans out.
8. **The keys are read live.** `Shell` and the command builder take a command's keys from
   `useKeysFor()` (handed to `buildCommands` as `keysFor`), not the module's `keysFor`: under the
   compiler a plain `keysFor(id)` in render is memoised on the ID and misses a key rebound in
   Settings › Keyboard. `useKeymap` still loads the stored overrides.


**Who reads the 16 refs, and when** (checked one by one; none reads during a render):

| ref (box) | read by | runs on |
|---|---|---|
| `bodyListRef` (`bodyListLater`) | body actions' `entry` (rename, display, visibility, colour, opacity) | browser row and menu handlers |
| `componentListRef` (`componentListLater`) | component `select`, placement move/copy/place on bed | browser click and menus, the marking menu |
| `openJointCheckRef` | the Check Clearance command | command run: key, search, menus, desktop menu, agent (async) |
| `exportScriptRef` (`exportScriptLater`) | the file command, `run` | command run |
| `startImportRef` (`startImportLater`) | the file command, `run`, the model-import effect | command run; a passive effect (after the insertion effects) |
| `startCanvasRef` | `run` | command run |
| `runRef` (`runLater`) | dialog commands, `runTool`, Convert to Solid | command run, menus |
| `startTutorialRef` | the tutorial command | command run |
| `runPluginRef` (`runPluginLater`) | plugin menu items | command run |
| `sketchOnFaceRef` | the plane picker's face pick | the view's pointer click |
| `pickPlaneRef` | the plane picker's plane pick | the view's click, the origin's click |
| `startRedefineRef` (`startRedefineLater`) | feature actions' Redefine Plane / Fix | feature menu |
| `featureActionsRef` | the recompute error's Edit (`canEdit` no longer: item 3) | the toast's and the history's click |
| `openSketchRef` (`openSketchLater`) | annotation select/edit, Look At, the agent, re-anchoring | browser keys/clicks/menus, a command, MCP (async), annotation drags |
| `bodiesRef` (`bodiesLater`) | annotating a model point, re-anchoring | the view's click, annotation drag end |
| `convertToSolidRef` | the body menu's Convert to Solid | menu |

Nothing in the app uses transitions or deferred values, so `Shell`'s renders are synchronous and
no event runs between a render and its commit. No Suspense boundary sits above `Shell` on the
project page; on the debug dialog route (`#/debug/dialog`, `App.tsx`) one wraps the lazy
`DialogDebug`, which renders `AppShell`. It only waits for that chunk, before `Shell` mounts:
nothing below `Shell` can suspend into it (its lazy children have boundaries of their own and it
calls no `use()`). A child that suspended without its own boundary would let React discard a
render of `Shell` and its insertion effects with it.

**Rules.**

- `Shell` must compile (`compiler.test.ts`): no ref written in its render, no `import()` in it, no
  name used in a closure before its declaration, dependency lists that match what it reads.
- A value a render hands to a function called in the render, for the function to read later,
  goes in a `Later` box; a `Later` (or a ref) is never read during a render, the shell's or a
  child's: a child's render would see the last commit's value.
- `sketchBase` stays a manual `useMemo` (it pins and closes the profile cache's open sketch). The
  compiler keeps the items behind a guard on the same inputs (`status` narrowed to
  `status?.entities`, the only part it reads), with `pinOpenSketch` inside it, but moves the
  `closeOpenSketch()` after the loop out of the memo: it runs on every render while no shown
  sketch is open, not only when the inputs change. Both are idempotent (`pinOpenSketch` returns
  for the same data; `closeOpenSketch` does nothing when nothing is pinned, and nothing pins
  while no sketch is open).
- What `Shell` hands down comes from a memo guard (`unguardedValues`); a closure reading a ref,
  or a plain call of a builder, can leave a value unmemoised: check the compiled output.
- A command's keys come from `useKeysFor()` in `Shell`, never the module's `keysFor` in render.
- Effect order: blocks moved for item 4 must not carry a layout or passive effect past another.
