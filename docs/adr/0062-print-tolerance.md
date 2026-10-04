# ADR-0062: Print tolerance and slicer hand-off

- **Status:** Implemented, 2026-10-03
- **Task:** P4-08 (FR-3DP-05 "clearance and tolerance helpers: a document-level
  `tolerance` parameter that hole and thread presets use"; FR-3DP-06 "open the
  export in a slicer").

## Context

Printed holes come out smaller and printed pegs larger than modelled, by
roughly 0.1 to 0.3 mm depending on the printer. P4-02's threads already read a
user parameter named `tolerance` when it exists (`TOLERANCE_PARAMETER` in
`packages/core/src/thread.ts`) and default to 0.1 mm otherwise. Holes don't:
their presets (`HOLE_PRESETS`, ISO clearance and heat-set insert sizes) write
plain numbers.

Slicers register URL schemes (`prusaslicer://open?file=…`,
`orcaslicer://open?file=…`, `bambustudio://open?file=…`), but every one of them
takes an **http(s) URL to download**, which the slicer fetches itself. A web
app that keeps designs in the browser has no such URL: a `blob:` URL isn't
reachable from another program, and uploading designs to a server is against
the project's local-first design.

## Decision

### 1. One parameter: `tolerance`

- The **print tolerance** is the user parameter named `tolerance` (length),
  the radial allowance one side of a fit gets: a hole's diameter grows by `2 ×
  tolerance`, a thread's profile moves by `tolerance` (as P4-02 does).
- **Tolerance panel** (3D Print tab, Prepare group, tile "Tolerance" after
  Print Info; session tool `tolerance`, a floating panel like Print Info's;
  no key): a field "Print tolerance" (`<ExpressionInput>`, length) and three
  buttons "Tight 0.1 mm", "Normal 0.2 mm", "Loose 0.3 mm". The first change
  **creates** the parameter (comment "Print clearance: hole and thread presets
  use it") and later changes update it, one undo step each, through the
  shell's parameter `apply` (ADR-0059's rule: parameter writes re-solve
  sketches). The panel lists how many expressions use `tolerance` ("Used by 3
  holes and 1 thread") from a pure core helper.
- Removing it is the Parameters dialog's job (refused while used, as for any
  parameter).

### 2. Hole presets use it

- When the document has a `tolerance` parameter, choosing a hole preset writes
  each diameter it sets as an expression `<nominal> mm + 2 * tolerance`
  (clearance diameter, counterbore diameter, countersink diameter; insert hole
  diameter); depths stay plain. Without the parameter, presets write plain
  numbers as today.
- `presetOf` (which shows the preset that the sizes match) matches either
  form: a plain value equal to the nominal, or exactly the expression above
  (whitespace-insensitive).
- A new thread's tolerance already refers to the parameter (P4-02); nothing to
  change there except a test that the panel's parameter is the one it uses.

### 3. Slicer hand-off: an interface now, the launch on desktop

- `apps/web/src/platform/`: an optional `openInSlicer?(file: { name: string;
  bytes: Uint8Array; format: '3mf' | 'stl' | 'step' }, slicer: SlicerId):
  Promise<boolean>` on the platform interface, with `SlicerId` =
  `prusaslicer | orcaslicer | bambustudio | cura`. The web platform leaves it
  undefined; the Electron build (Phase 6) implements it by writing a temporary
  file and launching the program (NFR-08).
- The Export dialog shows an "Open in slicer" select and button **only when**
  `openInSlicer` exists, so the web build doesn't change. A unit test with a
  fake platform covers the button.
- The roadmap keeps FR-3DP-06's desktop half in Phase 6 (note it there).

## Rejected

- **URL schemes from the web app:** they need a downloadable http(s) URL; a
  `blob:` URL isn't reachable from the slicer and uploading designs to a server
  breaks local-first.
- **A tolerance setting in `doc.settings`:** a parameter is visible in
  expressions (`width + 2 * tolerance`), shows in the Parameters dialog and the
  customizer, and threads already use it.
- **Changing ISO preset values themselves:** the presets stay the published
  sizes; the tolerance is added on top, visibly.

## Deferred

- Per-feature fit classes (press fit, slip fit) and a tolerance test print
  generator; slicer launch on desktop (Phase 6).

## Results

What the implementation settled, and what it cost:

- **One pure module, one command.** `packages/core/src/tolerance.ts` holds
  `TOLERANCE_PRESETS`, `toleranceParameter`, `setToleranceCommand` (add or
  `parameter.update`) and `toleranceUsage`; `hole.ts` gained `presetSizes` and
  `presetMatches`. The panel (P4-08, `apps/web/src/print/`) holds no state but
  the last refusal's message: everything it shows is the document read back
  through `toleranceState`.
- **`onChange` needed the document.** A hole preset's sizes depend on whether
  the document has the parameter, so `FeatureDialogSpec.onChange` grew a
  `Pick<DialogContext, 'doc'>` third argument (the controller passes the store's
  document); the thread dialog ignores it.
- **Both forms match, in either direction.** `presetMatches` compares the sizes
  the caller says apply, so `3.4 mm` and `3.4 mm + 2 * tolerance` both show
  "M3 clearance", and so does a spacing variant (`3.4mm+2*tolerance`). A hole
  whose diameter was typed without the tolerance in a design that has the
  parameter therefore still reads as its preset; nothing rewrites stored inputs.
- **The toolbar's `slicer` placeholder stays, with a truer sentence.** This ADR
  gives it the platform interface and the Export dialog's controls, but the
  launch itself is P6-02, so the tile is still "Send to Slicer" and dimmed; its
  `comesWith` now says **the desktop app** rather than P4-08, which is what a
  user needs to know (nothing in a browser can hand a local design to another
  program).
- **The web build is unchanged.** `openInSlicer` is optional and the web
  platform leaves it out, so the Export dialog renders exactly as before in the
  browser; a unit test with a fake platform covers the controls, and `pnpm
  check`, `e2e/export-3d.spec.ts` and the a11y audit agree.
