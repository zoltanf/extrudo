# ADR-0042: Marking menu and context menus

- **Status:** Accepted, 2026-09-29
- **Task:** P3-11 (FR-UX-03). Code: `apps/web/src/design-system/MarkingMenu.tsx`
  and `marking.ts` (geometry, tested in `marking.test.ts`),
  `commands/marking.ts` (slot tables, Repeat last), `shell/contextEntries.tsx`
  (the overflow list), `shell/viewMenu.tsx` (`useViewMenu`, the ring/list
  preference, the Appearance popover), `viewport/viewMenu.ts` (the contract
  with the view), `viewport/pointer.ts` (`onContextMenu`),
  `shell/commands.tsx` (`repeatLast`, `markingMenuStyle`), `e2e/marking-menu.spec.ts`.
- **Builds on:** ADR-0008 (pointer modes: the right button drags), ADR-0021
  (menus of the timeline and browser), ADR-0023 (commands), ADR-0026
  ("Select other…"), ADR-0018 (sketch selection).

## Context

UI spec §3.3 promised a right-click marking menu: a radial menu of eight
slots (Repeat last, Delete, Press Pull, Undo, Sketch, Extrude, Fillet,
Move) with an overflow list below. §3.1 says the right button drags in
some presets, so the menu may open only on a right-click without
movement. Until now a right-click over the model only opened "Select
other…", and there was no menu in sketch mode. Several surfaces had no
context menu at all.

## Decisions

1. **The menu is a view of the commands, not a second command system.** A
   slot is a command ID; `resolveSlots` matches the table with the commands
   `buildCommands` offers now and the wedge runs `command.run()`. A command
   that isn't offered here (`sketch` inside a sketch), or doesn't exist yet
   (`pressPull`, `move`; `fillet` is offered but `unavailable` until P3-01),
   leaves its wedge in place, dimmed, with a tooltip ("Arrives with P3-06."),
   so the ring keeps its layout and a later task only adds the command
   (and drops `comesWith` from the table).
2. **Two slot tables** (`commands/marking.ts`), clockwise from the top.
   Model: Sketch, Extrude, Fillet, Move, Press Pull, Undo, Repeat last,
   Delete. Making things sits top right, editing at the left, so a flick
   direction means the same thing every time. Sketch mode: Line,
   Rectangle, Circle, Dimension, Trim, Undo, Construction, Finish Sketch
   (the tools drawn most, the construction toggle, and the way out; Undo
   stays at the same wedge). Delete is not a wedge in a sketch: it is the
   list's first entry once something is selected.
3. **Opening.** The right button's press is left to navigation; on release
   without movement (`CLICK_SLOP`, 5 px) `usePointerInput` calls
   `handlers.onContextMenu` (falling back to `onMenu`, the old "Select
   other…", where a mode has no marking menu). The view reports the request
   (`ViewMenuRequest`: mode, the item under the pointer, the stack) to the
   shell's `ViewMenu.open`, which draws from the current state. The long
   press (500 ms) still opens "Select other…" directly.
4. **A right-click selects what is under it** (unless it is selected
   already), like Onshape: the list acts on the selection, so "Delete",
   "Hide Body" and "Measure" mean what they say. In sketch mode the item is
   the tool host's hover, which the view re-reports at the click (the press
   moves pointer capture and the host forgot the pointer). Empty space keeps
   the selection.
5. **When it is offered.** The shell passes `viewMenu` only while nothing
   else owns the pointer: model mode without a dialog, Create Sketch,
   Project or Measure running; sketch mode always (a running tool adds
   "Cancel <Tool>"). Elsewhere the view keeps its plain "Select other…" on
   right-click, which dialogs' pick fields rely on.
6. **The overflow list** (`contextEntries`, pure and unit tested) is decided
   by the selection: a face, edge or vertex (Sketch on Face for one flat
   face, Measure), its body (Hide/Show, Appearance…, Export…, Delete for
   selected bodies), a picked profile or sketch curve (Edit Sketch,
   Hide/Show Sketch), a construction plane, axis or point (Edit, Hide/Show,
   Delete; picked by their feature's ID, ADR-0040), empty space (Fit, Home View, Orthographic/Perspective,
   Redo, Show All Bodies when some are hidden), then Clear Selection. In a
   sketch: Cancel, Delete (named: constraint, dimension), Look At Sketch,
   Fit, Redo, Repeat. The view puts **Select other…** on top when anything lies
   under the pointer. Entries reuse `BodyActions`,
   `FeatureActions`, commands and the viewport store; "Appearance…" opens the
   browser's `AppearancePanel` in a popover at the menu.
7. **Repeat last** is the last *tool* started through `runTool` (shortcuts,
   the palette, the toolbox, the menu) or the toolbar's `run`: sketch
   tools, Extrude, Fillet, primitives and the like. It is not Undo, Redo,
   Delete, view or panel commands, Create Sketch, Finish Sketch, Measure,
   Parameters or Export (`isRepeatable`). It is one `repeatLast` command
   ("Repeat Extrude") that exists only while the remembered tool is offered
   in this mode and can run; state lives in the shell, session only.
8. **Gestures.** The ring's wedges are the eight 45-degree sectors round
   its centre (`slotAt`), so aiming picks, and a click, or a **press,
   drag and release** from anywhere in the ring (the classic flick), runs
   the wedge in that direction, however far the pointer goes. A press
   and release inside the 36 px dead zone does nothing; a press farther
   than the ring's edge plus 24 px, or any other button, closes the
   menu. Because the menu opens on the release, the flick is a *second*
   gesture with the left button; a right press-drag stays navigation.
9. **Keyboard and screen readers.** `role=menu` with `menuitem` wedges and
   rows in a `group`; the menu takes focus and owns all keys (nothing
   runs behind it). Arrow keys jump to the wedge in that direction (Up is
   the top wedge, Down from the bottom one goes into the list); Tab and
   Shift+Tab walk everything; Home/End in the list; Enter and Space run;
   Esc closes and returns focus. Dimmed items are `aria-disabled` and stay
   focusable, with the reason as tooltip.
10. **Placement** (`placeMenu`, pure): the ring keeps a margin from the
    window's edges (it moves inward when the pointer is near one), the
    list goes below it, above it when the bottom has no room, and
    shortens and scrolls when neither has.
11. **Preference** `marking.radial` (default on): the command "Right-Click
    Menu: Use a List" / "Use the Ring" (Ctrl+K) switches to one plain list,
    the slots first, then the entries, at the pointer.
12. **Context menus elsewhere.** Every browser folder gets Expand/Collapse
    and Show/Hide all (where it has an eye), the Bodies folder also
    Export all; Origin rows Show/Hide; user-parameter rows in the
    Parameters dialog Delete, Undo, Redo (a right-click in a text field
    there keeps the browser's own menu); design cards on the home screen
    the same menu as their "…" button. The timeline chips and body and
    sketch rows already had menus (ADR-0021). The browser's own menu stays
    suppressed everywhere except text fields and links (unchanged).

## Rejected

- **A right-press marking menu (press, drag, release)**: the classic
  design, but the right button navigates in the presets (ADR-0008); a menu
  on press would fight every orbit and pan.
- **Building the ring from Radix menu primitives**: no radial layout, and
  a flick needs the pointer's direction, not the item under it.
- **Custom actions in the menu code**: each slot would drift from the
  command it copies (keys, availability, dimming). Only commands run.
- **Hiding slots that aren't available**: the ring would shuffle by mode
  and by task, which breaks the muscle memory the ring is for.
- **Selecting on right-click through the click path** (`select.onClick`):
  in a dialog or while measuring that would add a pick; the shell selects
  through the session, and only where the menu is offered.
- **A context menu around the whole timeline strip**: nested Radix context
  triggers with the chips' own; chips have menus, the rest of the strip has
  nothing to offer.

## Open items

- ~~Constraint glyphs and dimension labels sit over the view and take their
  own right-clicks (they navigate); a menu on them (Delete constraint) is a
  small follow-up.~~ Done in P3-17 (amendment below).
- ~~Press Pull and Move wedges wait for P3-08 and P3-06;~~ Done: the Move
  wedge lit up with P3-06, Press Pull with P3-08; the Fillet wedge lit up
  with P3-01 without any change here, and so did the others (Press Pull with
  P3-08: only the command was added).
- A user setting to remap wedges: the tables are data, so a settings page
  could layer overrides as it will for the keymap.

## Amendment (P3-17)

Constraint glyphs and dimension labels have a right-click menu of their own
(`sketch/tools/annotationMenu.tsx`), not the marking menu: what is under the
pointer is one annotation, and a ring of sketch tools would be the wrong
answer to a right-click on it. A right press on a glyph or label is
remembered and its release heard on the window (the navigation captures it,
as for the view's own ring), so a right drag still pans or orbits and only a
right click without movement (`CLICK_SLOP`) opens the menu. The click selects
the annotation unless it is already selected (`menuSelection`), and the menu
acts on the selection: Delete runs the shell's `deleteSelection` (with its
toast when a dimension's parameter is used elsewhere), Edit Value opens a
dimension's in-place editor. No menu while a tool runs (the layer isn't
interactive then). It is a `PointMenu` ("Constraint menu", "Dimension menu").

## Amendment (P4-12, 2026-10-06): remappable wedges

"The tables are data, so a settings page could layer overrides": the layer is
there, and the settings page is one small dialog.

- **Preference `marking.slots`**: `{ model?: (string | null)[]; sketch?: (string
  | null)[] }`, eight entries each, a command ID or `null` for the table's own
  wedge (a missing entry, or one that isn't a non-empty string, counts as
  `null`). `resolveSlots(specs, commands, overrides?)` takes the mode's list:
  an override replaces the wedge's command, label (the command's `short`, else
  its label) and icon with the command's own; one naming no command offered in
  this mode stays, dimmed ("Not available here."), with the ID as its label.
  With no preference the result is the table's, as before.
- **Customize Marking Menu…** (`customizeMarkingMenu`, Panels group, no key; the
  Ctrl+K palette) opens a `FloatingDialog` (region "Customize Marking Menu",
  `shell/CustomizeMarkingMenu.tsx`): a Model and a Sketch tab, each the ring
  drawn with the geometry of `design-system/marking.ts` and the current label
  in every wedge (`[data-slot-button="model:2"]`, with `data-slot-command` and
  `data-slot-custom`). A click on a wedge opens the search over the commands
  that mode offers (the palette's option list and fuzzy scorer); the first row
  is "Reset wedge" while the wedge has an assignment; "Reset all" per tab. Every
  choice writes the preference at once. The lists are built with a `listing`
  flag so Delete, Repeat last (labelled without a tool's name) and the sketch's
  Construction toggle are offered whatever is selected now.
- A command may sit in two wedges; the dialog does not stop it.
