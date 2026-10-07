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

## Amendment: P6-02 (2026-10-07), the launch

The desktop app implements `openInSlicer` (ADR-0075's bridge: channels
`slicer:list` and `slicer:open`, `apps/desktop/src/main/slicers.ts`,
`slicerService.ts`) and a new optional `Platform.installedSlicers?: () =>
Promise<readonly SlicerId[]>`. The web has neither.

### Detection

Pure over an injected environment (`platform`, `env`, `exists`, `glob`, `which`,
`flatpakInfo`, `spawn`, `tempDir`, `overrides`), so every OS is unit-tested on
Linux. One entry per slicer, first candidate wins, the override before all:

| | PrusaSlicer | OrcaSlicer | Bambu Studio | Cura |
|---|---|---|---|---|
| **Linux** (`PATH`) | `prusa-slicer` | `orca-slicer` | `bambu-studio` | `cura`, `UltiMaker-Cura` |
| **Linux** (flatpak, `flatpak info <id>`) | `com.prusa3d.PrusaSlicer` | `io.github.softfever.OrcaSlicer` | `com.bambulab.BambuStudio` | `com.ultimaker.cura` |
| **Windows** (`%ProgramFiles%\…`, then `%LOCALAPPDATA%\Programs\…`) | `Prusa3D\PrusaSlicer\prusa-slicer.exe` | `OrcaSlicer\orca-slicer.exe` | `Bambu Studio\bambu-studio.exe` | `UltiMaker Cura <version>\UltiMaker-Cura.exe` (the directory is globbed, the newest version wins; `Ultimaker Cura` too) |
| **macOS** (`open -a`) | `/Applications/PrusaSlicer.app` | `OrcaSlicer.app` | `BambuStudio.app` | `UltiMaker Cura.app` |

An **override** is the preference `slicers.paths` (`{ "cura": "/opt/cura/cura" }`,
slicer ID to a program or, on macOS, an `.app`; no UI yet, edit
`preferences.json`). It wins over detection and counts as installed when the
path exists. The list is read afresh at each call, so installing a slicer while
the app runs needs no restart.

### The launch

The bytes are written to `<temp>/extrudo-slicer/<name>` (replaced per name;
directory mode 0o700, file 0o600, and a directory that is a link or not ours is
refused: `/tmp` is shared) and the program is spawned detached with
`stdio: 'ignore'` and `unref()`. The name is sanitised to a basename (no
separators, no leading dot, no characters Windows refuses, at most 120
characters) with the extension forced to the format's; over 500 MB nothing is
written. The launch resolves **true** unless `spawn` errors (ENOENT) or the
process exits non-zero within 1.5 s (an `open` that hands over and exits 0
counts as success); it never throws, and a malformed request from the renderer
crosses as `guarded`'s error envelope. The directory is emptied on `will-quit`,
best effort (Windows may still hold a file).

**A flatpak is started with `flatpak run --file-forwarding <id> @@ <file> @@`**
rather than the plain `flatpak run <id> <file>`: the sandbox has its own `/tmp`,
and forwarding hands the file over through the document portal.

### The UI

The Export dialog, when `installedSlicers` exists, asks it once when it opens
and lists all four slicers with the missing ones disabled and labelled "(not
found)"; the preselection is the slicer remembered in the `export.model`
preference (`slicer`, written after a successful launch) while it is installed,
else the first installed one. With none installed the button is disabled with
the hint "No slicer found. Install PrusaSlicer, OrcaSlicer, Bambu Studio or
Cura." The toolbar tile **Send to Slicer** is ready where the platform has
`openInSlicer` and opens the same dialog with its slicer button as the primary
action (`ModelExportRequest.slicer`); on the web it stays dimmed ("Arrives with
the desktop app").

### Rejected

- **URL schemes** (`prusaslicer://open?file=…`): they need an http(s) URL, which
  a local design doesn't have.
- **A slicer-side plugin** or a bundled importer: each slicer's would be a
  separate project to keep, for what a file path already does.
- **Plain `flatpak run <id> <file>`:** the file is invisible inside the sandbox.

### Results

`apps/desktop/src/main/slicers.test.ts` (17 tests: each OS's candidates, the
override, the newest Cura, the sanitised name, the forced extension, the cap,
ENOENT, a non-zero exit inside the window, success after it, `open -a` and
flatpak arguments, the quit cleanup, and the real environment's private
directory and refused symlink), `slicerService.test.ts`, `shared/bridge.test.ts`,
`renderer/platform.test.ts`, `ExportModelDialog.test.tsx` (unknown list, missing
ones disabled, none installed, remembered choice, the web rendering unchanged,
primary button for the tile) and `commands.test.ts`. Nothing here was run
against a real slicer: this machine has none, and no Electron binary.
