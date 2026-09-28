# ADR-0033: Timeline v2: marker, reorder, fix references

- **Status:** Accepted, 2026-09-28.
- **Task:** P2-11 (FR-TL-02 to FR-TL-05; ADR-0031's "redefine the plane"
  open item). Code: `packages/core/src/timeline.ts` (`storedRefs`,
  `referencedFeatures`, `timelineDependencies`, `moveProblem`,
  `moveFeature`, `replaceReferences`, `checkNewReferences`),
  `redefineSketchPlane` in `packages/core/src/sketch/commands.ts`,
  `ReferenceIssue` and `FeatureStatus.refs` in `packages/core/src/stores.ts`;
  in the kernel `LostReferenceError` (`src/naming/resolve.ts`), thrown by
  `resolveRef` and by the evaluators for lost profiles, sketch lines,
  origin planes and axes, bodies (`features/sources.ts`, `revolve.ts`,
  `extrude.ts`, `sketch.ts`, `operation.ts`, `primitives.ts`), and the
  engine's issue list (`recompute/engine.ts`, `#evaluate`); the
  `Recomputer` compares `refs` too. In the app: `shell/Timeline.tsx`
  (`Marker`, chip drag, `DropIndicator`, `editing`), `shell/featureActions.ts`
  (`rollTo`, `move`, `moveProblem`, `issues`, `fix`, `keepClosest`,
  `redefinePlane`), `shell/FeatureMenu.tsx` (new items and `position`),
  `features/dialog.ts` (`edit(id, { fix })`, `fixReferences`,
  `OpenDialog.note`), `sketch/baseBodies.ts` (`useBodiesBefore`, shared
  with the Project tool), Redefine Plane in `shell/AppShell.tsx` and the
  `PlanePrompt` title. Tests: `core/src/timeline.test.ts`, the kernel's
  lost/guessed expectations (`naming/topo-naming.test.ts`,
  `features/sketch-on-face.test.ts`, `extrude.test.ts`, `revolve.test.ts`,
  `primitives.test.ts`, `recompute/engine.test.ts`),
  `apps/web/src/shell/featureActions.test.ts`,
  `apps/web/src/features/dialog.test.ts`, `e2e/timeline-v2.spec.ts`.
- **Builds on:** ADR-0003 (commands, undo), ADR-0005 (resolution: exact,
  related, fingerprint with a warning, else an error), ADR-0021 (timeline
  and browser menus), ADR-0024 (feature status), ADR-0027 (dialogs, edit
  mode, the preview base), ADR-0031 (sketch on face, Create Sketch's plane
  and face picking), ADR-0032 (primitives go in through the dialog
  controller).

## Context

Timeline v1 had chips with a status glyph, a menu, playback buttons and a
marker that couldn't be dragged. Insertion at the marker already worked:
`insertFeature` defaults to `timelineMarker`, and Create Sketch, the dialog
controller (extrude, revolve, and P2-10's primitives) and Remove all go
through it. FR-TL-02 to 05 ask for a draggable marker, reorder by drag
refused when it would break a dependency, "roll back to here", "move to
end", warning chips and a "fix references" flow when a face or edge is
lost. Warnings already existed as a status with a message, but nothing
said which reference the kernel lost or guessed.

## Decision

1. **Dependencies come from stored references.** A feature builds on
   another when the other's ID appears in one of its stored references
   (`ref` inputs and a sketch's projection sources): `<sketch>/<region>`
   profiles and sketch lines, `<feature>:<n>` bodies, and face, edge and
   vertex names, which carry the feature that made them
   (`extrude:<F>:cap:end`, nested sources too). References are split on
   anything that isn't an ID character; tokens that are feature IDs count.
   Fingerprints don't. This is conservative: a nested source can name a
   feature the reference could survive without, but all such features came
   before the referring one when it was picked.
2. **Expressions don't order features.** Parameters are one namespace
   evaluated apart from the timeline (ADR-0004); a rolled-back or later
   feature's named dimension already works everywhere. So reordering never
   breaks an expression, and isn't checked against them.
3. **`moveFeature({ id, index, active? })`** refuses, with the nearer
   offending feature named ("Can't move Extrude2 before Sketch2: Extrude2
   uses Sketch2." / "…after Extrude2: Extrude2 uses Sketch2."), a move
   that puts a feature before what it uses or after what uses it. The
   marker stays between the same other features: landing among active
   features makes it active, among rolled-back ones rolled back; right at
   the marker it keeps its state unless `active` says otherwise (a drop
   left or right of the marker says). A move that changes nothing makes
   no undo step.
4. **The marker is a slider** (`role="slider"`, arrow keys, Home, End),
   also dragged by the pointer. While dragged it stays where it is (it
   holds the pointer capture) and a ghost shows the gap it will go to; the
   chips behind the ghost dim; letting go dispatches one
   `moveTimelineMarker`. A key move puts the focus back on the marker in
   its new place.
5. **Chips move by drag** after 4 px: an indicator shows the gap
   (accent, or the error colour with the reason as its title when
   `moveProblem` refuses); Esc cancels; a refused drop shows the reason as
   an error toast. The marker, the chips and the menus are locked while a
   sketch is open, and while a dialog edits a feature: then the timeline
   shows the marker, dashed, after that feature and dims the later chips
   (ADR-0027 open item: the view already showed the model before it).
6. **Menu items** (chips and browser rows): Roll Back (or Forward) to
   Here puts the marker after the feature; Move to End moves it to the
   last place (past the marker it is rolled back); Redefine Plane… for
   every sketch; Fix References… when the kernel lost or guessed a
   reference; Keep Closest Match when it guessed.
7. **The kernel says which references.** `FeatureStatus.refs` lists
   `ReferenceIssue`s for warnings and errors: `{ ref: {kind, id}, state:
   'lost' | 'guessed', now? }`. The engine wraps `ctx.resolve`: a guess
   records `now`, a reference to what it took (current name and a fresh
   fingerprint) when the name differs; a `LostReferenceError` (a subclass
   of `KernelError` carrying the reference) records a loss, whether it
   comes from `resolveRef` or an evaluator (a profile or sketch line gone,
   an unknown origin plane or axis, a body no longer there). A projection
   whose source is lost is listed while the sketch stays a warning.
8. **Fix References** depends on the feature: a sketch whose plane is
   listed gets **Redefine Plane**: Create Sketch's plane and face pick, for
   the existing sketch (the prompt says "Redefine Plane"), showing and
   picking the bodies before the sketch (`useBodiesBefore`, the Project
   tool's preview base); a pick dispatches `redefineSketchPlane`, one undo
   step, refused for a face of the sketch itself or a later feature. A
   feature with a dialog opens it in edit mode with lost references taken
   out of their fields and guesses replaced by `now`; the first such
   field takes picks and a note above the fields says what was lost. OK
   commits one `updateFeatureInputs` step as for any edit. A sketch whose
   projections are lost opens, with a toast saying to delete their curves
   or project again. **Keep Closest Match** stores every `now` in place of
   its guessed reference with `replaceReferences`, one step.
9. **Insertion at the marker** stays as it was: every creation path uses
   `insertFeature` at the marker, so new dialog features (P2-10's
   primitives) get it for free.

## Rejected

- **Live scrubbing while the marker is dragged** (a recompute per gap,
  through an undo transaction). Body names are amended into the latest
  undo step (ADR-0030): a transaction cancelled at the start position
  would take them along, and moving the marker element between chips lost
  its pointer capture. A ghost and one recompute on release are simpler;
  the cache makes the release fast.
- **Moving the marker element during the drag** (re-rendering it in the
  new gap): React re-mounts it and the pointer capture is lost.
- **Refusing a move that would change what a face reference resolves
  to** without naming its feature (a cut moved before a fillet that uses
  an edge it splits). That is a geometric question the kernel answers
  after the move with a warning, which Fix References then handles.
- **Checking deletes against face names** as moves are. Deleting stays
  as ADR-0021 has it (explicit references only): a deleted feature's
  faces become lost references, which is what Fix References is for.
- **A separate "fix references" dialog listing every reference.** The
  feature's own dialog already knows its fields, prompts and validation;
  taking the lost references out makes the field say "Pick a face".

## Consequences

- `FeatureStatus` has an optional `refs`; producers other than the
  engine (tests, debug pages) need not set it.
- `DialogController.edit(id, options?)` is backward compatible.
- `FeatureActions` has seven new members (tests that fake it need them).
- E2E hooks: the slider "Timeline marker" (`aria-valuenow`,
  `aria-valuetext`), `[data-marker-ghost]`, `[data-drop-index]` and
  `[data-drop-refused]` while dragging, chips' `data-feature-status`, the
  region "Redefine Plane", the dialog note (role `note`, "Fix
  references").

## Open

- Auto-scrolling the chip list while dragging near its edges (long
  timelines).
- A ghost of the lost geometry in the view (ADR-0005 open item: the
  fingerprint knows where it was).
- Moving several features at once, and groups (FR-TL-06).
- The browser shows no feature status yet (ADR-0024 open item).
- Remove features have no dialog (ADR-0030): a lost body reference there
  says "has no dialog yet".
