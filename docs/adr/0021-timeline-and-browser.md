# ADR-0021: Timeline v1 and browser tree

- **Status:** Accepted, 2026-09-27
- **Task:** P1-12 (timeline v1 and browser tree; FR-TL-01, FR-TL-03
  partial, FR-VP-07). Code: the commands in
  `packages/core/src/document-commands.ts` (`setFeatureVisibility`,
  `isFeatureVisible`, the checks in `removeFeature`) and `Feature.visible`
  in `schema.ts`; in the app, `apps/web/src/shell/featureActions.ts`
  (`createFeatureActions`), `shell/FeatureMenu.tsx` (`FeatureMenuItems`,
  `RenameField`), `shell/Timeline.tsx` (`Chip`), `shell/BrowserPanel.tsx`
  (`SketchLeaf`, folder eyes), the design system's `ContextMenu`
  (`design-system/Menu.tsx`), `Popover`'s `anchorOnly` and a pass-through
  `Tooltip`; the highlight in `viewport/Sketches.tsx`.
- **Builds on:** ADR-0003 (commands, undo transactions), ADR-0007 (design
  system, shell), ADR-0010 (sketch mode as one transaction), ADR-0016
  (named dimensions are parameters; `refuseIfUsed`).
- **Affects:** P2-08 (body and feature visibility in model mode), P2-11
  (draggable marker, "Roll back to here", "Move to end", reorder), P2
  features that refer to sketches (extrude profiles).

## Context

Until now the timeline showed chips that open a sketch on double-click,
and the browser listed sketches with a pencil. FR-TL-01 asks that hovering
a chip highlights its geometry, FR-TL-03 for a right-click menu (edit,
rename, suppress, delete, roll back, move to end), and FR-VP-07 for a
browser tree with visibility toggles on every item and folder. The UI spec
says the browser renames "with F2 or double-click", and elsewhere (§4)
that double-clicking a sketch in the browser opens it.

## Decision

1. **Visibility is document state.** `Feature.visible` is optional;
   absent means shown, so existing files are unchanged and need no format
   bump. `setFeatureVisibility({ ids, visible })` changes several features
   in one undo step (a folder's eye) and removes the key when showing.
   This matches body visibility, which is already an undoable command.
   Only sketches have geometry of their own so far; a hidden sketch isn't
   drawn, except while it is open.
2. **Suppressed and rolled-back sketches aren't drawn** (as before);
   suppressed chips are dashed and see-through, suppressed rows struck
   through. A suppressed sketch's named dimensions stay parameters, as in
   Fusion.
3. **Deleting is refused when something would break.** `removeFeature`
   refuses, naming the users, while another feature has a `ref` whose ID
   is the feature's ID or starts with `<id>/` (profile references), or
   while an expression outside the feature uses one of its named
   dimensions (its own dimensions may use each other). Deleting is
   undoable, so there is no confirmation dialog.
4. **Suppress and delete wait for an open sketch.** Sketch mode runs one
   undo transaction; suppressing or deleting could remove the sketch being
   edited or change the model under it, like moving the marker (already
   locked). The menu items are disabled and the actions say "Finish the
   sketch first." Renaming and visibility are harmless inside the
   transaction and stay available.
5. **Double-click edits, F2 renames.** Double-clicking a sketch in the
   browser or the timeline opens it (UI spec §4, and what users expect
   from Fusion's timeline); renaming is F2 on a focused row, or Rename in
   either menu. In the browser the name becomes a field in the row; on a
   chip, a popover above it. Enter or leaving the field keeps the name,
   Esc puts the old one back, an empty name is refused with a message.
6. **One set of actions for both panels.** `createFeatureActions(stores,
   notify)` holds edit, rename, show/hide, suppress, delete and hover as
   plain functions over the stores (like `sketch/mode.ts`), so the
   timeline, the browser and unit tests share them. `FeatureMenuItems`
   renders the same menu in both.
7. **Hover is session hover of kind `feature`.** A chip or row under the
   pointer sets `{ kind: 'feature', id }`; the shell marks that sketch's
   drawing `highlight`, and the viewport draws all its curves in the
   accent (`preselect`) at full strength. Leaving clears only a feature
   hover, so it doesn't fight the sketch host's own hover.
8. **Folder eyes.** Origin (viewport preferences, as before), Sketches
   (one `setFeatureVisibility`) and Bodies (one transaction of
   `updateBody`). A folder's eye shows everything when all is hidden and
   otherwise hides everything. A Construction folder holds the place of
   P2's planes and axes.
9. **Radix composition.** A new `ContextMenu` wraps Radix's; `MenuItem`
   and `MenuSeparator` pick the right Radix parts through a context, so
   menus share items. `Tooltip` passes other props and the ref to its
   trigger, so a context-menu trigger can wrap it. The chip's rename
   popover is anchored (`Popover` `anchorOnly`, Radix `Anchor`) on a plain
   `<span>` around the chip.

## Consequences

- The e2e tests read drawn sketches from the Viewport region's
  `data-sketches` (IDs) and the highlighted one from `data-highlight`;
  chip names end with "(rolled back, suppressed)" where those apply.
- Rolled-back sketches can no longer be opened from the browser either
  (the timeline already refused); the pencil is hidden for them.
- P2 features referring to sketches get the delete check for free if
  their references use `<featureId>/…` IDs.

## Rejected

- **Visibility as a viewport preference** (like the origin's eyes). It
  would not travel with the file, and a hidden sketch is part of how a
  design is meant to be looked at; bodies already store it.
- **A required `visible` field.** Needs a format version bump and a
  migration for no gain.
- **Double-click to rename in the browser** (UI spec §2). It clashes with
  double-click to edit a sketch (§4), which the timeline also uses.
- **Finishing the open sketch automatically before suppress or delete.**
  Surprising: the user's sketch edits would be committed as a side effect.
- **A confirmation dialog before deleting.** The delete is one undo step.
- **Anchoring the rename popover through the nested triggers**
  (Popover → ContextMenu → Tooltip → button). Our wrappers didn't pass the
  ref down, the popover was never positioned (Radix leaves it at
  `translate(0, -200%)`, off screen) while its field still had focus.

## Open

- "Roll back to here", "Move to end", dragging the marker and reordering
  (P2-11); error and warning chip states (FR-TL-05, P2).
- Hover highlights only sketches; bodies and features without geometry
  show nothing until P2.
- Features can't be selected from the timeline or browser yet (no
  multi-feature delete).
