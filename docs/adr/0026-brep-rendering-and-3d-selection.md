# ADR-0026: B-rep rendering and 3D selection

- **Status:** Accepted, 2026-09-28
- **Task:** P2-03 (B-rep rendering and 3D selection; FR-VP-05, 3D part).
  Code: `apps/web/src/selection/` (`items.ts` topology items, references,
  pruning, summary and labels; `pick.ts` picking and box selection;
  `highlight.ts` face states and colours; `filter.ts`;
  `useModelSelection.ts` the session glue), `apps/web/src/viewport/pointer.ts`
  (pointer input shared by sketch and model mode), `useModelInput` and
  `SelectOtherMenu` in `viewport/Viewport.tsx`, highlights in
  `viewport/Bodies.tsx` and `viewport/Sketches.tsx`, the filter menu in
  `viewport/NavBar.tsx`, the selection summary in `shell/Timeline.tsx`,
  `PointMenu` and `MenuCheckboxItem` in `design-system/Menu.tsx`, the
  optional `faceIds`/`edgeIds`/`vertexIds` on `BodyMesh`
  (`packages/kernel/src/mesh.ts`), `sketchEntityRefId` in
  `packages/core/src/sketch/feature.ts`.
- **Builds on:** ADR-0008 (viewport, camera maths, nav tools), ADR-0018
  (sketch-mode selection: click, Shift/Ctrl toggle, window vs crossing),
  ADR-0020 (profiles and their region IDs), ADR-0021 (session hover),
  ADR-0024 (the model store's meshes).
- **Affects:** P2-04 (fills the persistent-ID arrays), P2-05 (selection
  fields and pre-selection read and set this selection), P2-06 (extrude
  pre-selects profiles and faces; press-pull on a picked planar face),
  P2-08 (bodies in the browser), P2-09 (sketch on a picked face).

## Context

The viewport drew body meshes (P0-05) but nothing in model mode could be
picked: sketch mode had its own selection through the tool host (ADR-0018),
and a click outside a sketch did nothing. Feature dialogs (P2-05) need
faces, edges, vertices, bodies and profiles as `GeomRef`s. Persistent IDs
for faces and edges arrive with P2-04, in parallel with this task, so the
selection had to work on mesh indices now and switch to IDs without
changing its callers. No feature makes a body yet (extrude is P2-06).

## Decision

1. **One selection, in the session store.** Model mode writes the same
   `SessionState.selection` and `hover` as sketch mode, so Esc, the status
   bar and any later panel read one list. A face, edge or vertex is a
   *topology item* `{ kind, body, index }` (index in the body mesh's
   sub-shape order), stored as `{ kind, id: "<body>:<index>" }`; a body as
   `{ kind: 'body', id: <body> }`; a profile as before
   (`<sketch>/<region>`); a sketch curve picked in the model as
   `sketchEntity` with `<sketch>/<entity>` (`sketchEntityRefId`; inside
   the open sketch the bare entity ID stays). `topologyItem` /
   `readTopology` convert.
2. **References come from persistent IDs, never from indices.**
   `BodyMesh` gets optional `faceIds`, `edgeIds`, `vertexIds`, parallel
   to the ranges (the contract with P2-04; undefined until then).
   `topologyRef(item, bodies)` gives the `GeomRef` from them, or
   `undefined`; `{ indexFallback: true }` gives `index:<body>:<n>`
   (`isIndexRef`), good only until the next recompute. `selectionRefs`
   turns a whole selection into references for a dialog. After a
   recompute, `pruneSelection` keeps items on unchanged meshes, follows
   IDs to their new index when both meshes have them, and drops the rest.
3. **Picking is pure maths over the meshes** (`selection/pick.ts`), not
   R3F raycasting: faces by a three-mesh-bvh ray cast (one indirect BVH per
   mesh, cached in a `WeakMap`, so the rendered index buffer is left
   alone), edges and vertices by the closest approach between the pick ray
   and each edge segment or vertex, in pixels at that depth (6 px for
   edges and sketch curves, 8 px for vertices). An item is **hidden** when
   a drawn face lies between the camera and it (a second ray cast towards
   it, with 1.5 px of depth slack so an edge isn't hidden by its own
   faces); wireframe hides nothing. **Priority:** a visible vertex, else
   an edge or sketch curve (nearest first), else the front profile or face
   (a profile on the face wins), else the front body. So bodies are
   clicked only with faces filtered out, or from "Select other…".
4. **Boxes take one kind.** Left to right is a window (wholly inside),
   right to left crossing (touching), with the sketch-mode box and style.
   The box takes the first kind in `bodies, faces, edges, vertices,
   profiles, sketch curves` that the filter allows *and the box finds
   anything of*: a box around a part selects the part, a window over half
   of it the faces wholly inside, and with bodies filtered out, faces. A
   box sees through faces, as in sketch mode.
5. **Highlights.** Faces are tinted through a colour attribute on the
   body's one merged geometry (`vertexColors`; the body colour lives in
   the attribute): the accent at 45 % under the pointer, 90 % selected
   (brand §3.4). A state change rewrites only the nodes of the faces whose
   state changed and uploads that range (`paintFaces`,
   `addUpdateRange`). Edges and vertices are small overlays in the accent:
   selected edges 3 px, depth-tested; the hovered edge 2.5 px over
   everything, so a hidden edge offered by "Select other…" shows.
   **Vertices are drawn only while hovered or selected**, as 8 px dots; a
   corner shows its dot when the pointer comes near. Model-mode sketch
   curves get the same accent overlay (`curveSegments`).
6. **Select other…** opens on a long press (500 ms, left button, no
   movement) or a right click without movement, when anything is under
   the pointer: the visible vertices, edges and curves near it, then
   profiles and faces front to back (hidden ones marked "(hidden)" and
   greyed), then bodies, then hidden vertices and edges; at most 24 rows.
   The pointer or the arrow keys on a row pre-highlight it; a click
   selects it (toggles, if the menu opened with a modifier). It is a Radix
   dropdown anchored at the pointer (`PointMenu`), 10 px clear of it,
   because Radix takes a release over an item for a pick.
7. **The filter lives with Select** (a chevron beside it in the nav bar):
   Bodies, Faces, Edges, Vertices, Sketches (curves), Profiles,
   Construction (construction sketch curves, until construction features
   exist), and "Select everything". It is session state in the viewport
   store, not a preference: a filter left on from yesterday would make
   clicks look broken. A dot on the chevron shows that it filters.
8. **Pointer input is one hook** (`viewport/pointer.ts`, from the old
   `useSketchInput`): press, click, drag, box, long press and right
   click, in view pixels. Sketch mode maps it onto the sketch plane as
   before; model mode (`useModelInput`) picks. Model picking runs only in
   model mode with no command (Create Sketch's plane pick, sketch tools)
   and no hover while a nav tool runs. Bodies still draw in sketch mode,
   but aren't picked there; the model selection is cleared on entering a
   sketch (as before) and a hover picking set is cleared when it stops.
9. **The status bar** shows the selection before the feature count ("2
   faces", "1 edge, 2 vertices", "1 profile, 1 sketch curve"), and nothing
   while nothing is selected. Esc clears the selection in the model (or
   stops a nav tool first: the shell's Esc now runs before the viewport's,
   which never saw the key any more).
10. **E2E runs on the kernel debug page.** Until extrude makes bodies, the
    B-rep tests use `#/debug/kernel`, which now wires the P0-02 test part
    to the same `useModelSelection`, a session store and a selection
    summary. No test-only code ships in the product; the shell test picks
    sketch curves and profiles in the model.

## Rejected options

- **R3F's raycaster and pointer events on the meshes.** It gives faces
  only; edges and vertices need a screen-space test anyway, and the
  priority, occlusion and "Select other…" need all candidates at once.
  Pure functions also run in Vitest without WebGL.
- **A separate mesh per highlighted face.** Architecture §5.4 asks for
  one geometry per body; with the colour attribute a hover costs a few
  hundred floats, not a new draw call.
- **Brute-force ray/triangle tests.** Fine for the test part, too slow on
  pointer moves at 100k+ triangles; three-mesh-bvh (MIT) is the standard
  and supports indirect BVHs, which keep the triangle order that
  `faceRanges` relies on. (A non-indirect BVH reorders the index buffer.)
- **Occlusion by depth along the pointer's ray.** With the pointer a few
  pixels off an edge, onto a face seen at a grazing angle, the ray meets
  that face well in front of the edge, which would count as hidden;
  casting towards the item itself doesn't have that problem.
- **A box that takes every allowed kind at once** (bodies, their faces,
  edges and vertices). Nobody wants all of them; one kind per box, with
  the filter to choose, matches how feature fields (one kind each) will
  use it.
- **Vertex dots always shown.** Busy on curved parts (every seam end and
  arc end), and they hide the edge lines at small sizes.
- **A test-only hook to inject bodies into a project** (a URL flag, a
  window global, a debug feature type in the kernel registry). Each ships
  test code or a feature type users could meet in a file; the debug page
  already draws a real B-rep.
- **The filter as a saved preference**, see decision 7.

## Consequences

- Selections are index-based until P2-04 fills the ID arrays; a recompute
  that re-meshes a body drops its selected faces until then.
- Picking cost per pointer move: one BVH ray cast per body, a pass over
  all edge points and vertices, and one extra ray cast per nearby
  candidate. Not measured on large models yet; they may want per-edge
  bounding boxes (open item).
- A hidden face hovered in "Select other…" is tinted where nobody sees
  it; hidden edges and vertices do show.
- The status bar's selection text is new; screenshot baselines of the
  shell and sketch mode changed only for the nav bar's new chevron.

## Open items

- Silhouette edges of curved faces are not pickable (P2-08 draws them).
- Origin and construction planes/axes aren't selectable in the model yet;
  the Construction filter covers construction sketch curves until
  construction features exist.
- The right-click marking menu (UI spec §3.3) will take right click;
  "Select other…" then moves into it, and the long press stays.
- Box selection sees through faces; a "visible only" option may be wanted.
- An x-ray outline for hidden faces hovered in "Select other…".
