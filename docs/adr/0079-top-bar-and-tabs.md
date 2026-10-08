# ADR-0079: One top bar with the tabs, a Home tab, toolbars that fit the window

- **Status:** accepted (2026-10-08)
- **Task:** the owner's UI review of 2026-10-08 (no roadmap ID).
- **Depends on:** ADR-0007 (design system and shell), ADR-0023 (commands,
  keymap, `buildCommands`), ADR-0052 (tiles carry `data-tool`, the tutorial
  hangs under a tile), ADR-0075 slice 2 (the desktop's native menu is a
  projection of `buildCommands`).

## Context

The owner's review (2026-10-08): **too much height goes to the chrome above
the view.** The project page had three rows over the viewport: an app bar
(the File menu, undo, redo, search, the logo, the design's name, settings,
help, theme), a row of tabs, and the selected tab's toolbar. The prototype's
mock of that layout measured 182 px of an 800 px window; the real app's rows
were 44 px (app bar), 32 px (tabs) and 71 px (toolbar), 147 px, read from
their classes (`h-11`, `h-8`, the toolbar row's 70 px plus its border).

The owner chose a layout from a clickable prototype,
<https://claude.ai/artifact/7rZowrVHWgYosvCGakEmvA> (Version 3, "Proposal B",
undo/redo/search "After the tabs"; its mock is 130 px of chrome).

## Decision

### 1. Two rows instead of three

- **The top bar** (`shell/AppBar.tsx`, 40 px), left to right: the logo (a link
  to all designs, as before), **the tabs** (`ToolbarTabs`), a separator,
  **Undo, Redo, Search commands** (the same buttons, labels, tooltips and
  disabled states as before), a separator, flexible space, **the design's
  name** (rename as before), the version-history button, the save state, then
  settings, help and theme.
- **The toolbar** (`shell/Toolbar.tsx`): the selected tab's groups, unchanged
  in look. The selected tab is `useToolbarTab(mode)` in `AppShell`, which hands
  the tabs to the top bar and the tab to the toolbar.
- **The File menu is gone**: every item it had is a tile of the Home tab (§2)
  with its old condition (Save to Linked Folder only where a folder is linked
  and this project isn't, Export as Script in the model, Plugins). The disabled
  "Project settings…" placeholder is dropped: nothing was behind it.
- **Alignment is measured** (`e2e/topbar.spec.ts`): the tab labels' text
  baseline is the wordmark's (a zero-size inline-block `vertical-align:
  baseline` probe in each; 9 px of top padding on the tabs gives 26 px against
  the wordmark's 25.5 px), and the Undo, Redo and Search glyphs' visual centres
  (their SVG `getBBox()` centres in page coordinates) are equal (19.5 px).
- **Narrow windows:** below Tailwind's `lg` (1024 px) the top bar keeps the
  logo's mark without the wordmark, the tabs' padding shrinks, the save state
  keeps its dot (the word stays for screen readers) and the design's name
  truncates, so all six tabs, the three buttons and the right-hand buttons fit
  at 760 px.
- The home screen (`#/`) keeps its own header.

### 2. The tabs

| Tab | Groups (`▾` = a menu of tools that are never tiles) |
|---|---|
| **Home** | Design: New Design, All Designs · Versions: Save Version, Version History · Files: Import, Import Drawing, Canvas, Export Design (.extrudo), Export Model, Export as Script ▾ Import .extrudo, Save to Linked Folder · Parameters: Parameters, Customizer · Extend: Plugins |
| **Solid** | Create: Create Sketch, Extrude, Revolve, Sweep, Loft, Coil (▾ the enabled plugins' features) · Primitives: Box, Cylinder, Sphere, Torus · Features: Hole, Emboss, Rib · Pattern: Rectangular, Circular, Path · Program: Script, Record Macro / Stop Macro (one at a time) |
| **Modify** | Modify: Press Pull, Fillet, Chamfer, Shell, Offset Face, Draft, Thread · Transform: Move, Mirror, Combine, Split Body, Scale |
| **Construct** | Planes: Offset Plane, Plane at Angle, Midplane, Tangent Plane ▾ Plane Through 3 Points, Plane Along Path, Angled Midplane · Axes: 2-Point Axis, Axis Through Cylinder, Axis Along Edge · Points: Point, Point on Path, Point at Intersection |
| **Inspect** | Inspect: Measure, Section Analysis |
| **3D Print** | Prepare, Output (unchanged) |

- **The Insert tab is gone**: its three tools are in Home › Files.
- **Home's file actions are commands, not tools.** They are listed in
  `TOOLS` for their tiles, icons and hints (category `file`), and
  `FILE_COMMANDS` names the `FileActions` method each runs: a tile goes through
  `AppShell.run`, a command through `buildCommands`' `fileCommand`, and both
  call the method the File menu's item called. A command whose method the page
  leaves out is not offered and its tile is hidden (`Toolbar`'s `hidden`).
  Their IDs are the commands' old IDs (`exportProject`, `importProject`,
  `saveVersion`…), so the keymap (Ctrl+S), the marking menu and the desktop
  menu keep working.
- **New icons**: nine 24-grid file icons following `docs/05-brand.md` §6
  (`new-design`, `all-designs`, `save-version`, `version-history`,
  `export-design`, `import-design`, `export-script`, `linked-folder`,
  `plugins`), in the new neutral category token `--x-cat-file` (`#A7B0C2` dark,
  `#5B6375` light: 7.6:1 and 6.0:1 against the bar's `bg`). Import, Import
  Drawing and Canvas keep their insert/sketch icons; Export Model is the 3D
  Print tab's `export` with the label "Export Model" in Home (a group's
  `labels` override).
- **Sketch mode**: the Sketch tab replaces Solid, Modify, Construct and Inspect,
  whose tools work on bodies; Home and 3D Print stay. The default tab is Solid
  in the model and Sketch in a sketch. `visibleTabs(mode)` keeps that rule in
  one place and `tabs.test.ts` says so. Because Home stays in a sketch, its
  model-only tools (Import, Canvas, Customizer) say "Finish the sketch to use
  …" there, as Import Drawing says "Open a sketch…" outside one.
- **Command groups** follow the tabs ("Home › Files", "Modify › Modify"), so
  the palette shows where a tool now is. **The desktop menu maps the Home tab
  to its File menu** (`menuModel`'s `topMenu`), where a desktop app keeps a
  design's files; main's template is unchanged.
- **The tutorial** points at a tile, and when the tile isn't on the page (the
  round step's Fillet is on the Modify tab) at the tab that holds it
  (`toolOrTabSelector`, `tabOfTool`); the step's text says "In the **Modify**
  tab, press **Fillet**". The empty-design hint keeps pointing at Create
  Sketch's tile only.

### 3. Toolbars that fit the window

When the selected tab's groups don't fit the toolbar, **the group with the
most visible tiles moves its last tile to the front of its ▾ menu**, one tile
at a time, until the row fits; a group keeps at least one tile, and a group
that gets hidden tiles shows the ▾ even if it had no menu. Of groups equally
full, **the earlier one gives** (the prototype's rule). Widening brings the
tiles back in reverse. The rule is the pure `fitToolbar(groups, available,
chrome)` in `shell/toolbarFit.ts` (a group is never narrower than its label,
which grows by the ▾'s 12 px); its sequence of moves doesn't depend on the
width, so it is monotonic. The toolbar measures every tile's width from the DOM
once per set of tiles (a tab, or the macro tile swapping), with nothing hidden,
and fits again on every resize (`ResizeObserver`) from the stored widths.
`data-toolbar-fit` on the row says how many each group hides.

**A group's ▾ menu lists only what isn't a tile** (the moved tiles, then its
`more` tools, then the plugin items), as in the prototype; a group with nothing
there has a plain label. Before, every group's label opened a menu of all its
tools, tiles included.

Measured with the app's labels (`e2e/topbar.spec.ts` and a probe): at 900 px
Solid moves 4 (Create gives Sweep, Loft and Coil; Primitives gives Torus) and
Home 2; at 760 px Solid moves 7 (Create 4, Primitives 2, Features 1), Home 3
and Modify none. The prototype's numbers (Solid 8, Home 3, Modify 2 at 760)
were for its fixed 64 px tiles; the app's tiles are as wide as their labels.

## Rejected alternatives

- **Today's three rows**: the space they take is the problem.
- **Proposal A** (the prototype's first proposal): a Home tab without the
  Insert tab's tools and without Parameters and Customizer (they stayed in
  Modify), and Construct and Inspect on one tab. The owner preferred B: Home
  takes everything about the design as a whole, Modify is only shape changes,
  and Construct and Inspect are tabs of their own.
- **Undo, redo and search beside the logo** (first, where the File menu was):
  keeps today's left edge, but pushes the tabs right and away from the tools.
- **At the top right**, with the design's name: groups the bar's "about this
  design" part, but puts the most used buttons far from the tools.
- **At the end of the toolbar**: right after the last tool, as first described;
  they move whenever the tab changes, since each tab is a different length.
- **Under the ViewCube**, as a small floating bar in the view: frees the top
  bar but covers part of the model.
- **Tabs as tall as the old tab row (32 px)**: the top bar holds 32 px buttons,
  so 40 px keeps 4 px round them; the brief's "the height of today's tab row or
  less" is the prototype's 44 px row.
- **Pattern tiles named "Pattern", "Circular Pattern", "Path Pattern"**
  (the old short label): in a group called Pattern they read "Rectangular",
  "Circular" and "Path" (the tools' full names stay in tooltips, menus and
  search).

## Consequences

- e2e: `pickTool(page, name)` finds a tool wherever it is (a tile of the
  selected tab, a tile of another tab, a group's ▾ menu item), matching a tile
  by its accessible name or its tool's full name (`data-label`); `fileAction`
  runs what was a File menu item, `selectTab` selects a tab. Specs that clicked
  a tile now on another tab use `pickTool`.
- Every screenshot baseline's top area changed.
- No document, kernel or file-format change.

## Round 2, 2026-10-08

The owner's second review (a screen recording on edge), in their words: the default
theme "should be the same as system", and the theme goes "under the settings menu …
under the gear icon there could be like general settings and one section with the
theme … below the general settings. So we save a bit of space"; "add the toolbox …
next to the search, so first the toolbox and then the search"; "version history should
move next to the settings"; "this saved label should be next to the title … the title
should be aligned center between the separator … after the last icon on the left side
and the version history button … title and then a dot and then saved as a status … the
saved [label] is gone when there is not enough space and then after that we start to
collapse the title name itself"; "let's experiment with … removing this right separator
here after the search icon".

Decisions:

- **The default theme is `system`** (`DEFAULT_THEME` in `design-system/theme.ts`); a stored
  choice still wins. Playwright reports a light system theme, so `playwright.config.ts`
  sets `colorScheme: 'dark'` and the app and the baselines render as before; specs that
  want light use `test.use({ colorScheme })` or a stored choice. The landing page and the
  API docs are untouched.
- **The gear is the Settings menu**: General (Auto-project body edges, Auto-project face
  outline — the same viewport-store state as the sketch palette's checkboxes —, Customize
  Marking Menu…), then Theme (System, Light, Dark). The top bar's theme button is gone;
  `ThemeMenu` stays for the home screen.
- **The cluster is Undo, Redo, Toolbox, Search**; Toolbox (lucide `LayoutGrid`) opens the
  S toolbox at the button (`onSearch('toolbox', at)`). The right side is Version history,
  Settings, Help.
- **The title group** (name, then the save state's dot and word) is centred in the space
  between the cluster's last button and Version history. `shell/titleFit.ts`'s pure
  `titleFit(available, nameWidth, statusWidth)` answers `full`, `dot` (the word becomes
  screen-reader text; the dot's tooltip has it) or `truncate` (the name gets an ellipsis,
  its `title` is the full name). Natural widths come from a hidden copy measured with a
  `ResizeObserver`. The wordmark still hides under 1024 px.
- **The separator after the cluster is removed**; the one between the tabs and the
  cluster stays.
- **Tiles first, one-line labels** (the owner: labels stay on one line, may be longer;
  what has room is a tile, the ▾ menu is for what doesn't fit). Home › Files is now
  Import Design, Import Model, Import Drawing, Canvas, Export Design, Export Model, Export
  as Script, Save to Linked Folder (shown only where available) with no fixed `more`;
  Construct › Planes adds Plane Through 3 Points, Plane Along Path and Angled Midplane as
  tiles. The tile text is `short` (`importBody`'s full label is "Import STEP, mesh or
  OpenSCAD…", kept for tooltips and search); tiles never truncate (`whitespace-nowrap`,
  the fit rule measures real widths). At 1440 px Home and Construct move nothing; at
  900 px the fit is Home `0,0,4,0,0`, Construct `3,0,0` (Solid `3,1,0,0,0`).
