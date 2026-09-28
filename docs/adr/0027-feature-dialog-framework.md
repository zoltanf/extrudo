# ADR-0027: Feature dialog framework

- **Status:** Accepted, 2026-09-28
- **Task:** P2-05 (feature dialog framework). Code: `apps/web/src/features/`
  (`spec.ts` the spec types, `registry.ts` the app's registry, `dialog.ts`
  the controller, `values.ts` values ↔ inputs, parameter names and checks,
  `refs.ts` picks ↔ references and the field filter, `geometry.ts` frames
  for manipulators, `manipulate.ts` drag maths, `preview.ts` what a
  preview draws, `FeatureDialog.tsx` the dialog, `DialogOverlay.tsx`
  manipulators and the heads-up box, `useFeatureDialogs.ts` the shell
  glue, `testing.ts` a fake spec and kernel), `viewport/Preview.tsx`
  (preview ghosts), the shell wiring in `shell/AppShell.tsx`,
  `shell/commands.tsx` (`ready`, `dialogCommands`, `isToolReady`),
  `shell/Toolbar.tsx`, `shell/featureActions.ts` (`canEdit`, dialog edit),
  `project/useRecompute.ts`; in the kernel `FeatureOutput.previewTools`,
  `RecomputeResult.tools`/`base`, `PreviewRequest.base`,
  `reference(…, base)` (`recompute/engine.ts`, `types.ts`,
  `recomputer.ts`, `service.ts`, `worker-api.ts`), the `test-press` test
  feature (`recompute/testing.ts`), `debug-worker.ts` and
  `spawnDebugKernel`; `updateFeatureInputs({ replace })` in core; the
  debug page `apps/web/src/debug/DialogDebug.tsx` with `pressDialog.ts`.
- **Builds on:** ADR-0003 (commands, one undo step), ADR-0004
  (`<ExpressionInput>`, model parameters `dN`), ADR-0005 (persistent names,
  fingerprints, `KernelApi.reference`), ADR-0007 (design system), ADR-0012
  (the sketch heads-up box), ADR-0021 (timeline and browser menus),
  ADR-0023 (keymap and commands), ADR-0024 (`preview` walks a trial
  timeline; the `Recomputer` debounces it), ADR-0026 (session selection,
  picking, the selection filter, `selectionRefs`).
- **Affects:** every feature with a dialog: P2-06 extrude (the first real
  spec), P2-07 revolve, P2-10 primitives, P2-11 (edit reopens a dialog,
  rollback while editing), Phase 3 features.

## Context

Architecture §4.2 planned a `dialog` component and `manipulators` per
feature type in the web app's own registry. UI spec §2, §3.3 and §3.4 ask
for a right-side floating, draggable command dialog with selection fields,
expression fields, OK (Enter) and Cancel (Esc); pre-selection (select
edges, press F, the dialog opens with them); a live preview, translucent,
cuts red and joins green; manipulators (an arrow for distances, an arc for
angles) with a heads-up box that takes typing and expressions; invalid
input underlined in red while the preview keeps the last valid result,
dimmed; OK as one undo step. No feature had a dialog yet, and Extrude's
kernel side was being built in parallel (P2-06), so the framework had to
be proven without it and give that task a fixed contract for preview
shapes.

## Decision

1. **A dialog is a declarative spec, not a component per feature.** A
   `FeatureDialogSpec` extends core's `FeatureDefinition` (type, label,
   category, icon, inputs schema) with `command`, `fields`, and optional
   pure functions: `toInputs`/`fromInputs` (default: one input per shown
   field, named like it), `validate`, `manipulators` and `previewStyle`.
   Field kinds: **selection** (`accepts` GeomRef kinds, `min` default 1,
   `max`, `prompt`), **expression** (`unit`, `default`), **choice** (a
   dropdown, an `enum` input) and **toggle** (a `bool`); any field can be
   `shown` conditionally, and hidden fields make no input. One generic
   dialog renders every spec, so dialogs look and behave the same, and
   specs are unit-testable data. A feature that needs something the kinds
   don't cover gets a new field kind, not its own dialog.
2. **The registry is `featureDialogs()`** (`features/registry.ts`, a core
   `FeatureRegistry` keyed by type; empty until P2-06). Registering a spec
   makes its command run: `command` is a toolbar tool's ID (label, icon,
   keys and toolbar place from `shell/tools.ts` and the keymap), which
   the shell then treats as ready even while `tools.ts` still names the
   task that brings it (`isToolReady`), or a command of its own (debug
   pages), listed in model mode. Running it opens the dialog; the
   timeline chip (double-click, "Edit Feature") opens an existing feature
   of that type for editing.
3. **One controller per open project holds the dialog's state** in a
   vanilla store (`createDialogController`), like the sketch tool host:
   the spec, values, the pick field, the active manipulator field, the
   draft feature, its expression results, checks and preview. It works
   without React; the tests drive it with a fake spec and kernel.
4. **Pre-selection:** opening a dialog fills the first selection field that
   accepts anything selected, with the accepted items (up to `max`), and
   makes the first field still below its minimum the pick field.
5. **Selection fields store persistent references only.** A pick becomes a
   `GeomRef` from the mesh's persistent IDs (`selectionRefs` without index
   fallback; a mesh without IDs gives nothing), then the kernel's
   `reference()` adds the fingerprint asynchronously. While the dialog is
   open the viewport's model picking goes to the dialog (`select`): a
   click toggles the item in the pick field (replaces it when `max` is
   1, then moves on to the next unfilled selection field), a box adds; the
   pick field's `accepts` narrows the viewport's filter (`fieldFilter`,
   combined with the user's; not shown in the menu), and only accepted
   kinds pre-highlight. The view highlights every field's picks instead of
   the session selection, which the dialog leaves alone (OK clears it).
6. **Model parameter names are given once per dialog.** Each `expr` input
   gets `d<n+1>…` (one past any `dN` in use) when the dialog first builds
   its draft, keeps it while the dialog is open (and an edited feature
   keeps its own), and gets a new one only if something took the name
   meanwhile. The preview's draft is then the feature OK commits, so OK
   hits the kernel's cache.
7. **Every value change rebuilds and checks the draft,** and asks for a
   preview when it is valid: expressions are evaluated with the draft in
   the document (its own parameters, cycles), selection counts and kinds
   are checked, then `spec.validate`, then the inputs schema. Expression
   fields send every keystroke that evaluates (a live preview while
   typing); text that doesn't evaluate marks the field (`typing`) and
   keeps OK disabled.
8. **Previews go through the `Recomputer`** (`preview(draft, index)`,
   debounced 60 ms): a new feature at the timeline marker, an edited one at
   its own index. The same draft and document aren't sent twice; late
   answers for an older draft or dialog are dropped. A preview whose draft
   computed replaces the drawing; while inputs are invalid, or the draft
   fails in the kernel, the last good drawing stays, **dimmed**, and a
   failure's message shows in the dialog. OK is refused while the latest
   preview of the current values failed (its tooltip and a toast say
   why).
9. **Preview tools are the kernel's contract for what a preview shows.** An
   evaluator may add `previewTools: { shape, style }[]` (`new`, `join`,
   `cut`, `intersect`) to its `FeatureOutput`: an extrude's prism, styled
   by its operation. The cache owns them like other output shapes
   (released with the entry, counted by the leak check). Only `preview()`
   meshes them, for the draft, into `RecomputeResult.tools`; `recompute()`
   ignores them. A draft without tools (a fillet) previews the bodies it
   made or changed instead, in `spec.previewStyle`. The viewport draws
   them as ghosts over the model, without depth test (so a cut inside a
   part shows), in the brand's preview colours: new in the preview blue,
   join green, cut red, intersect violet (new tokens `--x-preview`,
   `-join`, `-cut`, `-intersect`); dimmed ones fainter. The model's bodies
   stay drawn and picked underneath.
10. **Editing shows the model rolled back to the feature.** An edit
    preview asks for `base: true`: the engine also meshes the bodies
    before the draft (`RecomputeResult.base`, meshes left out as for
    bodies; the `Recomputer` keeps them while the dialog is open). The
    view shows and picks those while the dialog is open, manipulators are
    placed on them, and the kernel's `reference(…, base)` fingerprints
    picks on them. Otherwise an edited extrude would be shown already
    applied, with its arrow on the face it moved.
11. **Manipulators are spec functions of the values** (and a context:
    document, the bodies shown, each expression field's value), returning
    a **distance arrow** (`origin`, unit `direction`, `field`) or an
    **angle arc** (`origin`, `axis`, `zero`, `field`) in world mm.
    Helpers place them: `faceFrame` (a face's centroid and normal from its
    triangles, by persistent ID), `profileFrame` (a profile's centroid on
    its sketch plane, from the app's profile cache), `meanFrame`. They are
    drawn as SVG over the view (`DialogOverlay`), rendered directly by the
    shell (never through `React.lazy`: keys typed while a lazy boundary
    suspends are lost). Dragging an arrow's head takes the point of its
    line closest to the pointer ray (keeping the grab offset); an arc's
    handle takes the angle where the ray meets its plane.
12. **A drag writes a plain number with its unit** ("12.5 mm", whole
    degrees "15 deg"), snapped to 1, 2 or 5 × 10ⁿ of about three pixels in
    the document's length unit, **replacing the expression**, parameter
    references included. Keeping a reference (writing `wall + 2.5 mm`)
    was rejected: it grows an expression nobody typed. Cancel restores
    everything, and the field shows the new text at once.
13. **The heads-up box** sits next to the active manipulator's handle (the
    field last focused or dragged, else the first manipulator), clear of
    the dialog's column, with an `<ExpressionInput>` for its field. Typing
    a digit, `.`, `+`, `-` or `(` while no text field has the keyboard
    focuses it (as in sketch mode, ADR-0012); Tab moves into it.
14. **Keys.** Enter in an expression field commits the field and presses
    OK (a field that doesn't evaluate keeps the key); Enter elsewhere
    presses OK. Esc on text that doesn't evaluate puts the last good value
    back; any other Esc cancels. Starting another tool (not Parameters),
    undo or redo ends an open dialog first; view commands don't.
15. **The dialog** (`FeatureDialog`) floats top-right below the ViewCube,
    non-modal (the view stays live), draggable by its title (the position
    lasts while the project is open): a title with the tool icon ("Press
    Pull", "Edit Press Pull1"), one row per shown field (a selection field
    is a button that makes it the pick field, "Pick a face" or "2 faces",
    with a clear button; expression fields are `<ExpressionInput>`s;
    choices are the design system's `Select`; toggles checkboxes), the
    draft's problem or the kernel's message, and Cancel (Esc) / OK
    (Enter).
16. **OK is one command:** `insertFeature` at the marker for a new
    feature, or `updateFeatureInputs({ id, inputs, replace: true })` (new
    option: the inputs become exactly the dialog's, so an input a now
    hidden field made goes away). The undo menu says "Add feature" or
    "Edit feature".
17. **E2E on a debug page.** `#/debug/dialog` runs the real shell on an
    in-memory document (a 20 mm `test-box`) with a debug kernel worker
    (`spawnDebugKernel`: the app's kernel plus the engine's test features)
    and one spec registered, "Press Pull (test)" (`test-press`: flat
    faces pushed or pulled along their normal, tilted by an optional
    angle, new/join/cut/intersect, with its prism as a preview tool). It
    uses every field kind, both manipulators and a custom input mapping.
    The app's worker and registry don't have it; nothing is saved.

## Rejected

- **A React component per feature dialog** (architecture §4.2's first
  sketch). Each would re-implement pick fields, parameter names, preview
  and keys; a spec keeps features to data and pure functions.
- **Committing previews into the document inside an undo transaction**
  (as sketch mode does). Every keystroke would be a document change the
  autosave and the recompute see; the trial timeline of ADR-0024 was made
  for this.
- **Drawing the preview's result bodies in place of the model's.** Picks
  would then land on geometry the draft's own references don't refer to,
  and highlights would jump between meshes; ghosts over the (rolled-back)
  model keep picking and drawing consistent.
- **Depth-tested ghosts.** A cut inside a part would be invisible.
- **Using the session selection as the field's value.** A click would
  replace the pick instead of adding to it, the status bar and Esc would
  act on it, and several fields couldn't hold picks at once.
- **Index references while the kernel's IDs are missing** (`indexFallback`).
  They break at the next recompute; a pick without an ID is ignored.
- **A test-only feature type in the app's kernel** or a URL flag in the
  real project page (ADR-0026 rejected those too). The debug worker is a
  separate entry that only `#/debug/dialog` spawns.
- **Manipulators in the WebGL scene.** An SVG overlay gets DOM pointer
  capture, crisp constant-size handles, and runs in the shell's chunk.
- **Allowing OK on a draft the kernel refused.** It would add a feature
  known to be broken; the message is in the dialog already.

## Consequences

- P2-06 adds `apps/web/src/features/extrude.ts` (a spec), registers it in
  `featureDialogs()` and removes `comesWith` from `TOOLS.extrude`; its
  evaluator emits `previewTools` with the operation as style.
- Feature types show their `label` + number as names ("Press Pull1").
- The viewport has new test hooks: `data-preview` (styles drawn),
  `data-preview-dimmed`; the dialog `data-feature-dialog`,
  `data-dialog-mode`, `data-dialog-valid`, `data-preview-status`; the
  overlay `data-manipulators`, handles `data-manipulator-handle` (with
  `cx`/`cy`), the box `data-heads-up`.
- Editing a feature re-meshes the bodies before it on the first preview;
  big models will feel that (the `Recomputer` keeps them for the rest of
  the dialog).

## Open

- Editing doesn't move the timeline marker: features after the edited one
  aren't shown while the dialog is open, but the timeline doesn't say so
  (P2-11: rollback while editing, reorder, "fix references").
- Inline parameters (`wall = 3 mm` typed into a field, FR-PAR-03) work in
  sketch dimensions but not yet in dialog fields.
- Right-click "Repeat" and Enter-to-repeat after OK (UI spec §3.3).
- Selection fields for origin planes and axes (they aren't pickable in
  the model yet, ADR-0026).
- A manipulator per selected item (several faces, each its own arrow) and
  arrow handles for two-sided extents.
- Screen-reader announcements of preview status beyond the status line.
