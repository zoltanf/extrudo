# ADR-0072: Wall-thickness check

- **Status:** Accepted, 2026-10-05
- **Task:** P5-06 (FR-3DP-07: "Minimum wall thickness check").
- **Builds on:** ADR-0048 (3D-print aids: Print Info's `print.material`
  preference, overhang analysis as view state with CPU classification and
  shading), ADR-0045 (section analysis, the browser's Analysis folder),
  ADR-0026 (body meshes, face colour attribute, three-mesh-bvh).

## Context

A printed wall thinner than about two extrusion lines comes out weak or not at
all. The user wants to see where a design is thinner than a minimum, before
exporting. The display meshes of the bodies are already on the UI thread with
a BVH each (picking), and the overhang analysis (ADR-0048) already shows how an
analysis lives beside the model: view state, a panel, counts as data
attributes, a row in the browser's Analysis folder.

## Decision

### 1. Thickness is measured on the display mesh, by rays

For a point on a body's surface, the **thickness there** is the distance from
the point, along the inward normal, to the first hit on the same body's mesh
(the far side of the wall). It is measured **per triangle**, from the
triangle's centroid moved `1e-4 mm` inward, against the body's own
three-mesh-bvh (`{ indirect: true }`, as ADR-0026 builds it; reuse the picking
BVH where it exists rather than building a second one). A ray that hits
nothing (an open or bad mesh) gives no thickness and is not flagged. A
triangle is **thin** when its thickness is below the minimum.

The measure is a pure function, `apps/web/src/print/thickness.ts`:
`measureThickness(mesh, bvh) → Float32Array` (one value per triangle, `NaN`
for no hit) and `classifyThickness(values, areas, min) → { thin: number
(triangles), area: number (mm²), thinnest: { value, triangle } | undefined }`.
The rays are cast once per body mesh and cached by the mesh's identity; a
changed minimum only re-classifies. Bodies with more than 400,000 triangles in
total are measured in slices across animation frames (the panel shows
"Measuring…"), so the UI never blocks for more than about 50 ms.

Ray thickness is the simplest honest measure: exact for parallel walls, and at
a wedge it reports the wedge's real local thickness along the normal. Its known
weakness is at a wall's ends: a triangle on the thin **edge face** of a plate
(the 1 mm × 40 mm side of a 1 mm plate) measures the plate's *length* from
there, not 1 mm — which is right for that face (the wall behind it is long),
and the plate's two large faces are flagged, so the wall is found.

### 2. The analysis is view state, like the overhang's

`viewport.thickness`: `ThicknessState` = `{ min: string (a length expression),
on: boolean }`, in the viewport store, not in the document and not undoable.
The default minimum is **two line widths** from the `print.material` preference
(`2 × lineWidth`, 0.9 mm with the default 0.45 mm), written as a plain value
("0.9 mm") when the analysis is first opened. The field is an
`<ExpressionInput>` (document parameters work: `wall`, `2 * tolerance`).

### 3. What the user sees

- **3D Print tab › Prepare: "Wall Thickness"** (tool ID `wallThickness`, no
  default key, in `buildCommands`, a tile with an icon in the set's style),
  which toggles the panel **"Wall Thickness"** (a region like "Overhang
  Analysis"): the "Minimum" field, a "Show thin walls" checkbox, the result
  lines — "Thinnest wall: 0.80 mm" and "Thin area: 226 mm² in 2 bodies", or
  "No wall is thinner than 0.9 mm." — and the buttons "Done" and "Remove".
- **Shading:** thin triangles are drawn in `--x-error` (the overhang's colour
  token) through a per-vertex attribute on the body's face material while the
  analysis is on; everything else keeps its colour. When the overhang shading
  is on too, thin wins on a triangle that is both.
- **The thinnest spot** is marked in the view with a small label
  ("0.80 mm") on a leader at the triangle's centroid (an overlay like the
  Measure tool's line; hidden when the spot is clipped by a section or behind
  the camera).
- **Data attributes** on the Viewport region for tests:
  `data-thickness="min=0.9 thin=12 area=226 thinnest=0.8 bodies=1"`
  (`… off` while the shading is off; absent with no analysis; `pending` in
  place of the numbers while measuring).
- **Browser:** a row in the Analysis folder (`data-thickness-row="on|off"`,
  "Wall thickness · 0.9 mm", an eye "Hide wall thickness" / "Show wall
  thickness"), beside the section's and the overhang's.
- Hidden bodies are not measured or counted; a mesh body (ADR-0066) is
  measured like any other; the analysis follows every recompute.

### 4. Not in the kernel, not in the document

No facade, kernel, schema or file-format change. The numbers are view-side
estimates on the display tessellation: a curved thin wall is measured between
facets, so the value is within the display mesh's deflection of the true one.
The panel says "about" nowhere, but the ADR does: a wall within the mesh
deflection of the minimum can be classified either way.

## Rejected

- **Exact thickness in the kernel** (OCCT offset or distance queries per
  face): slow, fails on the bodies where the answer matters (thin shells), and
  the display mesh answers the user's question.
- **The rolling-sphere (medial) thickness:** more robust at corners, far more
  rays per sample; not worth it before anyone misses it.
- **A document feature or a stored result:** it is a check, like overhangs.

## Deferred

- A colour ramp of thickness (not only below/above), a list of thin spots to
  step through, thickness in the headless CLI's `check`.

## Results

Built as decided, 2026-10-05/06: `print/thickness.ts` (pure maths), `useThickness`
(state, evaluation, caching, slicing), `WallThicknessPanel`, `ThicknessOverlay`,
`viewport/thicknessShading.ts`, a row in the browser's Analysis folder and
`data-thickness` on the Viewport region. No kernel, schema or file-format change.

Measured on the Ubuntu machine (4 cores, `BENCH=1 pnpm vitest run
apps/web/src/print/thickness.test.ts`):

- **Rays:** 99,372 triangles (a gridded unit cube) in 315 ms, about 316,000 rays a
  second; building the BVH for it took 57 ms (the picking BVH, normally already there).
- **Wall bracket:** 147 ms from the click on the tile to the counts
  (`e2e/wall-thickness.spec.ts`, including the panel opening).

Deviations:

- **Slicing starts at 15,000 triangles, not 400,000.** At ~300,000 rays a second a
  synchronous pass over 400,000 triangles blocks for over a second, against the ADR's own
  50 ms; slices are time-boxed to 40 ms a frame (`SLICE_AT`, `SLICE_MS` in
  `useThickness.ts`). Every B-rep body's display mesh is under 15,000 triangles and is
  measured in one pass.
- **The shading flag is per node** (`aThin`), so where thin meets thick the boundary
  bleeds one triangle (nodes are shared inside a face). The counts are exact per triangle.
- The shader patch mixes at `<alphatest_fragment>`, after the overhang's
  `<color_fragment>`, so thin wins; both patches share one compiled program
  (`customProgramCacheKey` is a function).
- The sliced path skips meshes already in the cache, so a recompute that leaves a body
  alone does not measure it again.
