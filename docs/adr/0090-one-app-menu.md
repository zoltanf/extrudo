# ADR-0090: One app menu, with the Help menu and the quick preferences inside it

- **Status:** Accepted, 2026-10-17 (the owner's design review of 2026-10-17, from
  four prototypes: `docs/plans/app-menu-prototypes.html`, section "Wide panel,
  refined")
- **Task:** P6-10 (Phase 6: "One app menu").
- **Builds on:** ADR-0079 (one top bar; the app menu with four squares),
  ADR-0082 (the Settings dialog), ADR-0085 (About), ADR-0075 (the desktop
  app's menus), P6-06 S9 (the Help menu's docs items and F1).

## Context

The top bar's right-hand cluster has two menus: the app menu (Settings…,
Plugins…, three submenus Behaviour, Mouse controls and Theme, Close design or
Quit) and the Help menu (Search…, Tutorial, Help for This Tool, four docs
pages, Check for Updates…, Source on GitHub, About Extrudo). The owner wants one
menu covering everything, with the quick toggles lifted out of their submenus
onto the menu's root, laid out horizontally. Plugins… and Customize Marking
Menu… move into the Settings dialog, where Customize Marking Menu… already has
a button.

## Decision

### 1. One panel, 480 px wide, three bands

The four-squares button ("Menu") opens a **panel** instead of a dropdown list.
The Help button leaves the top bar. The panel is a Radix Popover anchored to the
button (`align="end"`), `role="dialog"` named "Menu", **as wide as its rail**:
the rail's controls and dividers set the width (about 460 px; the columns and
the strip take that width, and it never exceeds the window minus 16 px), with
three bands from top to bottom:

1. **The rail**: one horizontal line of icon controls, left to right:
   - **Mouse controls**, a segmented control (`radiogroup` "Mouse controls",
     one `radio` per preset) in the order **Crank, Spindle, Glide, Blender,
     Slicer, Trackpad**. Spindle stays the default (`NAV_PRESETS[0]`; the rail's
     order is its own, not the array's). Each radio is an icon only: a mouse
     with the orbit button filled (right for Crank, middle for Spindle, left for
     Slicer), a mouse with pan arrows for Glide, a mouse with a modifier key for
     Blender, a pad with two finger dots for Trackpad. **Slicer** is new and
     **not implemented yet**: its radio is disabled, its tooltip says what it
     will be (left-drag orbits, right-drag pans, Shift+left-drag selects) and
     that it is coming; `NavPreset` does not gain a value until the behaviour
     lands.
   - A divider, then the three **toggles** as icon buttons with `aria-pressed`:
     Auto-project body edges, Auto-project face outline, Radial right-click
     menu (the same state as today's checkboxes and commands).
   - A second divider, the same as the first, then **Theme** at the right
     edge: a segmented control (`radiogroup` "Theme", radios System, Light,
     Dark; icons monitor, sun, moon). The three groups and two dividers sit
     with even gaps; nothing stretches.
   Every rail control has the app's `Tooltip`: the control's name as the label
   ("Mouse controls: Crank", "Auto-project body edges", "Theme: Dark") and a
   hint (the preset's bindings from `NAV_PRESETS[].summary`; the toggle's
   state and the hint the Settings dialog gives it; "Follows the operating
   system." for System). Icons alone never carry the meaning.
2. **Two columns, always two** (no stacking at any width):
   - **App**: Search… (Ctrl+K, centred), Settings… (Ctrl+,), About Extrudo, a
     separator, Close design (web, in a design) and Quit (Ctrl+Q, desktop).
   - **Learn**: **Help for \<tool\>** (F1) first, named after the tool whose
     toolbar tile was hovered or focused last (`toolUnderPointer()` at the
     moment the panel opens, the tool's command label: "Help for Extrude") and
     **absent when there is none**; then User Guide, Tutorial (the built-in
     five steps), **Online Tutorials** (the docs page that was "Tutorials"),
     Examples, Tool Reference.
   Each column is a `menu` named after its label with `menuitem`s.
3. **The version strip**, a grey footer: a dot and a word for the update state,
   the version in mono ("0.7.0"), and at the right end the links **Check now**
   (desktop only: the Check for Updates… handler) and **GitHub** (Source on
   GitHub). The word follows `Platform.updates` and the desktop's last check:
   "Update ready" with the waiting version (warning dot) when `waiting`, "Up to
   date" (success dot) after a check that found nothing, "Checking…" while one
   runs, no word before any check (muted dot). Never colour alone.

Keyboard: Tab moves between the rail's groups, the two columns and the strip;
arrow keys move within a group or column; Enter or Space activates; Escape
closes and returns focus to the Menu button. Every control is reachable with the
keyboard and named for a screen reader.

### 2. What leaves the menus

- **Plugins…** becomes a section of the Settings dialog ("Plugins", after
  General, rendering the existing `PluginsList`). The `plugins` command, Ctrl+K
  "Plugins…" and the macOS app menu's Plugins… open Settings at that section;
  the standalone `PluginsDialog` goes.
- **Customize Marking Menu…** becomes a Settings section too ("Marking menu",
  after Plugins): the ring editor and its command list render inline on the
  section's page, with the "Radial right-click menu" switch above them (it
  leaves General). The menu item and General's button go; the
  `customizeMarking` command (Ctrl+K) opens Settings at that section; the
  standalone dialog goes.
- The **Help button** goes from the top bar. The home screen's header keeps its
  About, Docs and GitHub tabs and gets the same panel (no Close design, no Help
  for \<tool\>).
- The macOS native menu bar (ADR-0075) is unchanged apart from the renamed
  "Online Tutorials" item: it is built from the commands, not from the panel.

### 3. Naming

- "Tutorials" (the docs page) is **Online Tutorials** everywhere: the command
  `docsTutorials`'s label, the panel, Ctrl+K, the macOS Help menu, the docs.
  "Tutorial" (the five-step tour) keeps its name.
- The F1 item reads "Help for \<tool\>"; the Ctrl+K command `help` keeps "Help
  for this tool".

## Rejected

- **One long list with a toggle strip on top** (prototype 1): cheapest, but 15
  rows plus the strip and still a submenu for the mouse presets.
- **Every preference inline with switches and chip rows** (prototype 3): no
  submenus, but mixed control kinds in a Radix dropdown menu fight its
  keyboard model.
- **A quick-settings grid with a search box on top** (prototype 4): the
  furthest from a menu; the owner kept only its version strip.
- **Stacking the two columns on narrow windows:** the owner wants the two
  columns always; the panel shrinks to the window instead.
- **A fixed 480 px panel with the Theme group pushed to the edge by empty
  space:** the owner wants the width to come from the rail, so the controls
  read as one even row with a divider on each side of the toggles.
- **Making Slicer selectable before it works** (mapping it to Spindle's
  bindings): a preset that does not do what its tooltip says is worse than a
  disabled one.

## Consequences

- `AppMenu` and `HelpMenu` become one `AppMenu` panel component; `AppBar` and
  `HomeScreen` lose the Help button and the help props move to the panel.
- e2e: `appMenu(page)` still finds the button "Menu"; `appSubmenu` and
  `chooseInMenu` give way to helpers that pick a rail radio, press a rail toggle
  or pick a column item (`docs/agent/e2e-notes.md`). Screenshot baselines that
  show the top bar change (the Help button is gone).
- Docs: `docs/04-ui-spec.md` §2 (top bar), §5.1 (Settings: the Plugins and
  Marking menu sections), §6 (home screen) and the "Help menu and F1"
  paragraph; the user guide where it says "Help ›"; `docs/agent/adr-digest.md`.

## Amendment, 2026-10-17 (the owner, same day)

Two changes after the first brief went out: Customize Marking Menu is a
Settings section rather than General's button, and the panel's width comes
from the rail, with a divider on each side of the toggles. Written into the
text above.

After the implementation review: F1 and the panel's Help item share
`lastHoveredTool()`, and Settings › General is labelled Appearance (its id
stays `general`).
