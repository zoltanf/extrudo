# ADR-0023: Command search and shortcuts v1

- **Status:** Accepted, 2026-09-27
- **Task:** P1-14 (command search and shortcuts v1; FR-UX-03 partial).
  Code: `apps/web/src/commands/keymap.ts` (`DEFAULT_KEYMAP`, `keysFor`),
  `commands/search.ts` (`fuzzyMatch`, `searchCommands`),
  `commands/shortcuts.ts` (`eventKeys` now reads digits by key position),
  `shell/commands.tsx` (`buildCommands`, `commandShortcuts`),
  `shell/CommandSearch.tsx` (palette and toolbox), design system
  `FloatingDialog.tsx`, and the wiring in `shell/AppShell.tsx`.
- **Builds on:** ADR-0007 (shell, tool catalogue, design system),
  ADR-0012/0013 (tool host, construction toggle), ADR-0021 (feature menus).
- **Affects:** the marking menu and "Repeat last" (UI spec §3.3, later
  phases), a settings page that remaps keys, Electron menus (Phase 6),
  FR-UX-04 tooltips.

## Context

FR-UX-03 asks for command search (an "S" toolbox and a Ctrl+K palette), a
marking menu, and default shortcuts that follow mainstream CAD tools and that
the user can remap. P1-14 is the first part: a shortcut registry with mainstream CAD keys,
the toolbox and the palette. Before it, keys were declared in three
places: `shortcut` on tools in `shell/tools.ts` (for tooltips), a
`TOOL_KEYS` table in `AppShell` (for running them) and hard-coded strings
(F6 in the viewport, X in the sketch palette). Nothing listed "every
command", so a search had nothing to search.

## Decision

1. **One keymap table.** `DEFAULT_KEYMAP` maps command IDs to keys
   (`'Mod+K'`, `'Shift+2'`, `'F6'`, `'L'`); `keysFor(id)` reads it. Tool
   IDs are command IDs. The toolbar, menu items, the sketch palette's
   Construction row and the search all show keys from it, and
   `Tool.shortcut` is gone. A key may belong to two commands that are
   never offered together (F: Sketch Fillet in a sketch, Fillet on the
   model); a unit test checks that no key has two owners in either mode
   and that every keymap ID is a command somewhere.
2. **Commands are built per context.** `buildCommands(ctx)` lists the
   tools of the tabs shown in the current mode (`visibleTabs`, shared
   with the toolbar), Finish Sketch, Construction and Look At in a
   sketch, Parameters everywhere, Undo/Redo, Delete (only where
   something can be deleted), Fit, the seven standard views, show/hide
   browser and timeline, the File menu's actions and the two themes not
   in use. Each `AppCommand` has a label, a group ("Sketch › Create"),
   an icon, keywords (group and hint), its keys and `run`. The same list
   drives the shortcuts (`commandShortcuts`), the palette and the
   toolbox. Context keys that aren't commands (Esc, Enter while drawing)
   stay in `AppShell`.
3. **Tools that aren't built yet are listed and say so.** Their key or a
   click on a pinned tile shows "Extrude arrives with P2-06." as a toast;
   in search they are shown dimmed with "Arrives with …" and don't run.
4. **Keys start tools; the toolbar toggles them.** A shortcut or a search
   result starts a sketch tool (restarting it if it runs); a toolbar
   click on the running tool still stops it.
5. **Fuzzy search, then words.** A query matches a label when its letters
   appear in order, scored by a small DP over (query letter, label
   index): word starts (after a separator, a lower→upper step or a
   letter↔digit step) +8, the first letter +2, runs +6, gaps −0.5 per
   letter, letters before the first match −0.2 each, long labels −0.05
   per letter. Separators in the query are dropped ("3 pt-rect"). If the
   label doesn't match, every query word of 3+ letters must start a word
   of the group or hint ("constraints", "round"), and such matches rank
   below all label matches. Unavailable commands lose 3, recent ones gain
   up to 1. The best path's positions are highlighted.
6. **One component, two placements.** `CommandSearch` is a
   `FloatingDialog` (a new borderless Radix modal: focus trap, Esc,
   outside click, focus return, a visually hidden title) with a combobox
   and a grouped listbox (`aria-activedescendant`). Ctrl+K puts it at
   the top centre and dims the page; S puts it at the last pointer
   position (kept on screen) with the toolbox's pinned tiles above the
   results. Empty query: "Recent" (commands run from search this
   session), then every command by group. Arrows and Page keys move,
   Enter runs, Shift+Enter pins or unpins, Esc closes. A command that
   opens a dialog keeps the focus (`keepFocus`).
7. **Pins are a preference.** `toolbox.pins` in `platform.preferences`,
   default Create Sketch, Line, Rectangle, Circle, Dimension, Trim,
   Parameters. A pin shows only where its command is offered (Line not
   on the model). Tiles use the tool's short label.
8. **Findable without the keys.** A search button after Undo/Redo in the
   app bar opens the palette; the Help menu (no longer a disabled button)
   has Search commands… (Ctrl+K) and Toolbox… (S, at the pointer, here
   the menu item), plus a disabled Getting started for P3-12.
9. **Standard views on Shift+1…7** (ours, UI spec §5): Home, Top, Bottom,
   Front, Back, Left, Right. `eventKeys` reads digit keys by `event.code`
   (`Digit2`), so Shift+2 is "Shift+2" on US ("@") and French layouts.
   F6 moved from the viewport to the shell's commands (the kernel debug
   page lost it; its nav bar still has Fit).

## Consequences

- A new command is one entry in `buildCommands` (and one line in the
  keymap if it has a key); it then shows up in search with its key, and
  its key works.
- Remapping (FR-UX-03's remaining part) is an overrides layer on top of
  `DEFAULT_KEYMAP`; the toolbar and menus already read keys through
  `keysFor`.
- Command IDs are now public-ish (preferences hold pinned IDs): renaming
  a tool ID drops its pin.
- "Recent" lives in memory, per session.

## Rejected

- **A library (cmdk, kbar, Fuse.js).** The palette is a small combobox
  over our own Radix dialog; the scorer is ~60 lines and ranks word
  starts the way tool labels need ("3pr" → 3-Point Rectangle). No new
  dependency.
- **Keeping `shortcut` on tools.** It left app commands (Undo, views,
  palette) in other tables; one table serves tooltips, handlers and a
  future settings page.
- **Pin buttons as focusable controls in each row.** A listbox's options
  can't hold buttons; Shift+Enter pins from the keyboard, and the row's
  pin glyph is a pointer shortcut hidden from assistive tech.
- **Opening the palette from inside text fields** (`inFields`). Ctrl+K
  over another modal dialog would stack focus traps; fields keep their
  keys.
- **Fuzzy-matching hints.** "to" or "ln" found half the catalogue; hints
  only match by word prefix, with 3+ letters.

## Open

- Remapping UI and conflict warnings (settings page).
- The right-click marking menu, "Repeat last" and pre-selection
  (UI spec §3.3).
- "Rect" ranks Rectangular Pattern (a prefix of its label) above the
  rectangles; a usage-based boost could fix it once there is usage.
- Press/Pull (Q), Project (P) and Joint (J) have no tools yet, so no keys.
- Recent commands aren't stored across sessions.

## Amendment, 2026-10-11: one search (the owner's UI review 3, R3-05)

The owner asked for the Ctrl+K palette and the S toolbox to become one: "this search
commands, Ctrl+K, and this toolbox, search tools, [should] be unified into a single
dialog"; from the button "it should appear exactly like this [the toolbox, dropping from
the button] … kind of grey the background a bit"; "pin them to the top and then show the
rest as it is now … maybe limit how many can be pinned"; and S "should appear … wherever my
mouse cursor is; if I'm using Ctrl+K … like a proper pop-up". The decision was ten pins in
two rows (`docs/plans/ui-review-2026-10-11.md`, decision 2).

- **One dialog, one content.** `CommandSearch` draws one `FloatingDialog` titled
  **"Search"** (480 px wide, up to 440 px tall, the combobox "Search commands", the listbox
  "Commands"): the search field, the region "Pinned" with the pins as tiles, then the list.
  The kinds `palette` and `toolbox` are gone; `SearchOpen` says only where it opens:
  `{ from: 'centre' }` (Ctrl+K and Help › Search…: top centre, page dimmed), `{ from:
  'pointer', at }` (S: its top-left 24 px up and left of the pointer, page clear) and
  `{ from: 'button', at }` (the top bar's Search button: 4 px below the button's bottom-left
  corner, page dimmed). The dialog's `data-dim` says which.
- **The keymap IDs** are `search` (Mod+K) and `searchAtPointer` (S), instead of
  `commandPalette` and `toolbox`. Nothing stored keyed on the old IDs (key remapping is
  still Open).
- **At most ten pins** (`shell/searchPins.ts`, pure): the tiles are the first
  `PIN_LIMIT` (10) stored pins the current mode offers (`shownPins`), in a five-column
  grid, so two rows. With ten showing, a pin is refused (`canTogglePin`): the row's pin glyph
  is dimmed with the title "Up to 10 pins: unpin one first." (`data-pin="full"`) and
  Shift+Enter or a click on it puts the same sentence in the pins' status line (`role=
  "status"`). Unpinning is always allowed. The preference stays `toolbox.pins`, one list
  for both modes, so a list longer than ten (pinned before the cap, or pins of the other
  mode) keeps the rest stored and shows them as soon as there is room. The cap counts what
  the mode shows, not the stored list, so a person with sketch pins can still pin model
  commands.
- **No horizontal scroll bar.** The toolbox showed one under its list (a row's "can't run
  here" reason was `shrink-0` and wider than 360 px). The list is `overflow-x-hidden`, a row
  is `min-w-0`, and a reason takes the room left and truncates (its `title` has it whole).
  `e2e/commands.spec.ts` checks the dialog, the pins and the list at 1440, 1024, 720 and
  480 px, and fails without the fix.

Rejected: keeping two sizes (360 px at the pointer, 560 px centred): the owner asked for
one dialog, and one width keeps the pins' grid the same wherever it opens. Placing the
centred dialog at the vertical middle: its height changes as the list filters, so it would
jump while typing; it stays at 12 % from the top, horizontally centred.
