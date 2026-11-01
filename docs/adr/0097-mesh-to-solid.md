# ADR-0097: Mesh to Solid: an imported mesh becomes a B-rep body

- **Status:** Accepted, 2026-10-20 (the owner's decisions 1.1, 2.1, 3.1, 4.1
  and 5.1 of `docs/plans/stl-to-solid-2026-10-20.md`; issue #95, with #78
  and #79 behind it). Lives on the branch
  `claude/stl-import-native-solid-e60e8c` until the whole feature lands in
  one pull request; releases go on without it meanwhile.
- **Task:** P4-13 (Phase 4), FR-IO-10.
- **Builds on:** ADR-0066 (imports, mesh bodies as manifold-3d handles),
  ADR-0034 (meshing and STEP), ADR-0005 (topological naming), ADR-0024 (the
  shape cache and scopes), ADR-0037 (the C++ facade: ints, doubles and
  pointers, never an OCCT type), ADR-0030 (`splitSolids`).

## Context

A mesh file (STL, 3MF, OBJ, an OpenSCAD compile) is one manifold-3d body with
one face: booleans and transforms work on it, everything that needs a B-rep
face or edge refuses (`Kernel.#solid`, `meshBodyMessage`): Fillet, Chamfer,
Shell, Hole, Rib, Place on Bed, sketch on face, Extrude to, Remove Faces,
STEP export. People download STLs and want to edit them like a part they
made (#95; the video shows Fusion's Face Groups + Convert Mesh), and want to
remove a hole or a round from such a part (#78, #79), which needs real faces.

Measured in the pinned image (OCCT 8.0.1, `spikes/stl-to-solid/`):
`BRepBuilderAPI_MakeShapeOnMesh` turns a welded triangulation into a compound
of faces that share their edges; a shell, `BRepBuilderAPI_MakeSolid`,
`ShapeFix_Solid` and `ShapeUpgrade_UnifySameDomain` give a valid solid whose
coplanar triangles are merged into real planar faces: a 12-triangle box STL
becomes the 6-face box, and a fillet and a through-cut on it equal the ones
on an exact box. OCCT recognises nothing curved: a meshed cylinder stays 32
facets. The cost is per face after the merge: 10,104 faces take ~8 s to
build and 2.8 s per boolean afterwards (80 MB); 50k faces 21 s. So the size
limit goes on the faces of the result, and curved parts need recognition.

## Decision

### 1. Feature `meshToSolid` ("Mesh to Solid"), Solid › Modify

| Input | Type | Default | Notes |
|---|---|---|---|
| `body` | body reference | – | One body. A solid is refused: "Mesh to Solid needs a mesh body: this body is already a solid." |
| `method` | choice `prismatic`, `faceted` | `prismatic` | §3 |
| `tolerance` | number (mm, an `ExpressionInput`) | `0.01` | How far a triangle's vertices may sit from a fitted surface (prismatic). Faceted ignores it. |

`bodyAccess: 'write'`. The output **replaces the mesh body under its own
`BodyId`** (as Combine replaces its target), so the body keeps its name, its
colour and its place in the browser; `splitSolids` runs on the result as a
guard (a mesh body is one connected piece already, ADR-0066 §3). Suppressing
the feature gives the mesh back. Not patternable (its tool is the body).

Every input gets a `.describe()` and `pnpm api:generate` runs (ADR-0068); the
feature needs no face roles (it makes no faces of its own kind: §2).

### 2. Names (ADR-0005)

The result's faces are named `toSolid:<feature>:face:<n>`, `n` the face's
position in the result shape, edges and vertices derived (`deriveNames`), as
a STEP import's `import:<feature>:face:<n>` are: deterministic for the same
mesh, method and tolerance, with no history into the mesh (it has none).
A later feature's reference to such a face survives recomputes until the
mesh, the method or the tolerance changes; then it may become a
`LostReferenceError`, which the UI shows as it does for an edited import.

### 3. The kernel: two methods, one facade entry

`Kernel.meshToSolid(shape, { method, tolerance })` → `{ shape, report }`,
B-rep handle out; a mesh handle in (anything else throws `KernelError`). The
triangles come from the body's `Manifold.getMesh()` (welded, outward), and
go into the facade through two facade-owned buffers written in place
(`meshNodes(count)`/`meshNodesPtr()` as doubles, `meshTriangles(count)`/
`meshTrianglesPtr()` as uint32; the TypeScript side writes right after
reading each pointer, since memory growth moves the heap, ADR-0037) — no
per-number embind calls for a million-triangle mesh.

**`faceted`** (slice 1): `Poly_Triangulation` → `BRepBuilderAPI_MakeShapeOnMesh`
→ one shell of all its faces (`BRep_Builder`; the faces share their edges)
→ `BRepBuilderAPI_MakeSolid` → `ShapeFix_Solid` →
`ShapeUpgrade_UnifySameDomain` (unify edges and faces, linear and angular
tolerance 1e-3, concave faces allowed) → `ShapeFix_Shape` only if
`BRepCheck_Analyzer` says invalid (the sphere needed it, the box didn't) →
`store`. Refused when the estimated result has more than `FACETED_FACE_CAP`
= 5,000 faces (2,000 until slice D4, below): "Faceted would give about 9,497
faces; Extrudo converts up to
5,000. Use Prismatic, or simplify the mesh in your slicer." The count is
estimated from the triangle buffers **before** anything is built (2026-10-22
amendment); the exact count after unify stays a backstop, and its message has
no "about".

**`prismatic`** (slice 3): segmentation and fitting in the facade, then an
exact rebuild:

1. *Segment:* region growing over triangle adjacency. Planar regions: every
   vertex within `tolerance` of the region's plane and the normal within
   1° of it (manifold's `faceID` may seed them). The remaining triangles are
   grouped by smooth adjacency (dihedral under 30°, `CREASE` of ADR-0066).
2. *Fit* each smooth region as a cylinder: axis = the smallest-eigenvector of
   the facet normals' covariance, centre and radius by least squares on the
   vertices projected along it; accepted when every vertex is within
   `tolerance`. Then cone and sphere; torus in slice 4. A region that fits
   nothing is **unfit**.
3. *Rebuild:* one oversized face per surface (a plane's region box grown by
   10 × `tolerance`; a cylinder's full round between its parameter bounds
   plus the same margin), `BOPAlgo_MakerVolume` over all of them, and the
   volume(s) kept are those whose volume is within 1 % of manifold's and
   that contain the mesh's triangle centroids. Exact intersections fall out
   of it: a 32-gon hole is a circle on its face.
4. *Verify:* `BRepCheck_Analyzer` valid, the volume within 1 %, and sampled
   triangle centroids within `tolerance` of the solid
   (`BRepExtrema_DistShapeShape`); else refuse.

Refused when there are unfit regions (owner's 4.1): "Mesh to Solid couldn't
close the body: 3 regions (12 % of the surface) fit no plane or cylinder.
Raise the tolerance to 0.05 mm, or use Faceted." — the suggested tolerance
is the smallest that would have fit the largest unfit region, when one was
found under 10 × `tolerance`; the unfit regions stay highlighted in the
preview (§5). Refused above `PRISMATIC_SURFACE_CAP` = 500 recognised
surfaces (MakerVolume's pairwise intersections grow with the square): "This
mesh has 812 surfaces; Extrudo rebuilds up to 500. Use Faceted, or
simplify the mesh in your slicer." The input cap stays ADR-0066's
`MAX_MESH_TRIANGLES` (1,000,000); segmentation is linear in triangles.

The facade never falls back from one method to the other on its own
(owner's 4.1 against a silent faceted fallback): what the user chose is what
runs, and a refusal says what to choose instead.

### 4. The report

`FeatureOutput.report` of kind `meshToSolid`: `{ method, faces, planes,
cylinders, cones, spheres, tori, unfit: { regions, triangles, fraction },
suggestedTolerance? }`, read from the facade's `meshReportPtr()` (doubles).
The dialog shows it as one line ("12 planes, 4 cylinders · 0 unfit") and the
feature status keeps it; the MCP `get_feature` tool returns it unchanged.

### 5. Preview (slice 4)

While the dialog is open, the view colours the picked mesh body by region
kind before any solid is built: plane, cylinder/cone/sphere/torus, unfit.
The kernel's preview path runs the segmentation only
(`Kernel.meshRegions(shape, tolerance)` → one region id per triangle and a
kind per region, in `ModelState.regions` for that body), which is linear and
fast on a million triangles; OK runs the build. The colours come from the
brand tokens (`docs/05-brand.md`), with a legend line in the dialog.

### 6. Where it is

A tile "Mesh to Solid" at the end of Solid › Modify (with a tooltip clip,
`pnpm demos`, ADR-0052), a "Convert to solid…" entry in the context menu of
a body the browser tags "Mesh" (`data-body-mesh`), and the command in the
palette. Done (2026-10-21): the Import dialog's `solid` toggle ("As solid")
adds `meshToSolid` (Prismatic, default tolerance) right after the import
through `commitWith` — one undo step, mesh files only, create mode only.

### 7. After it

A converted body is a solid, so every feature works on it and the Export
dialog's STEP export includes it (its skip is keyed on `BodyMesh.mesh`).
Remove Faces (#78) and Simplify for print (#79) find a hole as a closed
cylinder wall and a round as a cylinder or torus chain on it.

A possible later slice, not planned: build the hybrid first, then retry the
exact rebuild when only a few facets remain.

## Rejected

- **Faces of a mesh as references only** (ADR-0066's deferred "planar
  regions"): sketch-on-face without a solid; fillets, shell, holes, Remove
  Faces still refuse. The preview of §5 reuses that segmentation anyway.
- **Triangles as faces with no cap**: ADR-0066's rejection, measured again.
- **Decimating first** (`Manifold.setTolerance`): removes near-coplanar
  triangles only; curved surfaces keep their facets.
- **Converting inside `import`** (an `as` input): one timeline step, but a
  boolean's or OpenSCAD's mesh couldn't be converted and nothing could be
  suppressed to get the mesh back. The Import-dialog chip of §6 gives the
  one-step feel later.
- **Two features, "face groups" then "convert"** (Fusion's split): one
  feature with a preview is one thing to learn and one timeline step.
- **A silent fallback to faceted** when prismatic fails (owner's 4.2): the
  body appears but with thousands of faces, every later cut takes seconds,
  Remove Faces finds no hole, and nothing says why.

## Consequences

- A new feature type in the document schema: `docs/file-format.md` gets its
  section (`meshToSolid`: `body`, `method`, `tolerance`), the schema test
  enforces it.
- Facade growth: `BRepBuilderAPI_MakeShapeOnMesh`, `BOPAlgo_MakerVolume`
  (TKBO, already linked), the fitting code; tens of kB of WASM.
- The 1,000,000-triangle cap holds; the new caps (2,000 faces, 500
  surfaces) are constants in `packages/kernel/src/features/mesh-to-solid.ts`
  and `extrudo_facade.cpp`, named in the refusal messages.
- A long-lived branch: it is synced with main as releases go out, and its
  ADR number is re-checked against main at pull-request time.

## Slices

1. Facade `faceted` + `Kernel.meshToSolid` + Vitest on `cube.stl` and a
   cylinder STL (planes and faces counted, fillet and cut on the result).
2. Feature, dialog, context menu, API, file format, docs, e2e (faceted).
3. Facade `prismatic`: segmentation, fits, MakerVolume, verification, report,
   refusals; Vitest with a bracket fixture.
4. Region preview, cone/sphere/torus, tooltip clip, guide page, Import chip.

## Amendments

### Amendment, 2026-10-21: prismatic as built (slice 3)

Measured natively first (`bash spikes/stl-to-solid/run.sh prismatic`: the
facade itself, nodes rounded to float32 as `Kernel.meshFrom` keeps them),
then in Vitest (`packages/kernel/src/mesh-to-solid.test.ts`). What changed
from the plan above, and why:

- **Segmentation.** Planar regions grow from the largest unassigned
  triangle over shared edges; a neighbour joins when its corners are within
  `tolerance` of the *seed's* plane and its normal within 1° of the seed's
  (a sliver narrower than `tolerance` / 100 has no reliable normal, so its
  corners decide alone). The region's plane is its facets' area-weighted
  normal through their area-weighted centroid (else least squares, else the
  seed's): a least-squares plane over the nodes let a fine fillet's slivers
  tilt the plane next to it (−0.011 % volume on the fine filleted box).
  Regions whose normals are under 30° apart are *smooth* neighbours, and a
  smooth cluster of regions is fitted whole (one plane, else one cylinder).
  **The fine-tessellation rule:** when a cluster fits nothing whole, its
  regions of 4 × the cluster's median region area or more are planes of
  their own (the planes a fillet's facets lean on: 46 × on the 20 mm box
  with an 8-segment r 2 fillet), and the rest is fitted again, component by
  component. A finely tessellated cylinder's facets are thin regions of one
  size, so none is large and they stay one cylinder (360 segments, facets
  1° apart: one cylinder); a 16-gon's strips the same. A component of fewer
  than 4 regions that fits nothing is kept as planes (a draft or a shallow
  bevel, not a cylinder); a larger one is unfit.
- **Fits** as planned: the cylinder's axis is the smallest eigenvector of the
  facet normals' area-weighted covariance, the circle an algebraic fit of
  the nodes projected along it plus Gauss–Newton; accepted when every node
  is within `tolerance`. The chord error of a cylinder is
  `r (1 − cos(θ/2))`, θ its largest facet-to-facet angle.
- **Rebuild: MakerVolume, with snapping; no sewing.** Before the faces are
  made, each cylinder is snapped to its neighbouring planes: to a plane it
  is tangent to (axis parallel within 1°, distance within `tolerance` of the
  radius) its axis is made parallel and its distance exactly the radius; to
  two non-parallel tangent planes (a fillet) its axis is their offset
  planes' intersection; between two opposite tangent walls (a slot's end)
  its radius is half the gap; else to a plane it is square to (an end cap,
  a hole's plate) its axis is that plane's normal. Without the snap the
  coarse box with four r 3 vertical fillets and the plate with a slot fail
  (MakerVolume leaves the nearly tangent faces apart); with it all shapes
  measured close. The faces are grown by 10 × `tolerance` **plus twice the
  largest chord error** (a 12-gon hole's true circle leaves the polygon's
  box by its sag). `BOPAlgo_MakerVolume` runs with `SetAvoidInternalShapes`
  (a margin that bounds nothing, such as a flap past a tangent line or a
  boss's cylinder inside the plate, otherwise stays in its cell as an
  internal face). The cells kept are decided by sample points: about 3,000
  triangle centroids (plus each region's largest), each moved inside and
  outside along its normal by 3 × `tolerance` + twice its surface's chord
  error, counted for the cell that holds it; a cell keeps when more inside
  points than outside fell in it, and a cell no point reached asks the mesh
  about its centre (ray parity, three rays). The kept cells are merged by
  dropping the faces two of them share, and `ShapeUpgrade_UnifySameDomain`
  **is** needed after all: the cells split a surface where another face's
  margin crossed it (an L-bracket's faces, a boss's wall), and unify makes
  it one face again. `ShapeFix_Shape` only when the result is invalid.
- **Verification:** valid; every n-th mesh node (up to 2,000) within
  `tolerance` of the solid (projected on each nearby face's plane or
  cylinder and classified in the face, `BRepExtrema_DistShapeShape` for a
  node no face takes); and **the volume rule**: |V − V_mesh| at most the
  larger of 1 % of the mesh's volume and Σ (area × chord error) over the
  cylinders + `tolerance` × the mesh's area (a 16-gon cylinder is 2.5 %
  under its circle: 1 % alone refuses it).
- **The report** on success counts the result's faces by kind (planes,
  cylinders); on a refusal after segmentation it holds the recognised counts
  and the unfit regions, triangles and area fraction (0–1), for slice 4's
  preview; the kernel reads it on success only for now.
- The suggested tolerance is the largest unfit region's best plane or
  cylinder deviation × 1.1, rounded up to 0.001 mm, when under 10 ×
  `tolerance`.

Measured, native (ms in the pinned image under node). In Vitest (CI's
WASM, this machine) the 20,124-triangle plate converts in 248 ms, the
500,000-triangle manifold sphere is refused in 306 ms and the staircase in
1 ms (case 11 and 8 print them); every case of the matrix passes:

| Mesh | Triangles | Result | ms |
|---|---|---|---|
| `cube.stl` | 12 | 6 planes, 8,000 mm³ exact | 141 |
| cylinder r 5 h 20, 32 / 360 / 16 segments | 124 / 1,436 / 60 | 2 planes + cylinder r 5 (±1e-8), volume ±2e-7 % | 49 / 90 / 13 |
| plate 40 × 30 × 5, hole r 3, fine / ~5k | 1,024 / 5,044 | 6 planes + 1 cylinder, ±2e-8 %; r 1 fillet on the hole's circle valid | 146 / 341 |
| box 20³, edge filleted r 2, fine / 8 segments | 264 / 76 | 6 planes + cylinder r 2, −3e-4 % / −5e-9 % | 53 / 36 |
| sphere r 10 / 499k triangles | 2,208 / 499,000 | 1 sphere face (slice 4a1: was refused) | 103 / 731 |
| staircase, 602 faces | 2,396 | refused, 602 surfaces | 1 |
| 32-gon, nodes ±0.005 mm, tolerance 0.001 / 0.02 | 124 | refused, "Raise the tolerance to 0.003 mm" (slice 4a1: was 0.006) / 2 planes + cylinder | 0.1 / 8 |
| L-bracket | 20 | 8 planes, exact | 16 |
| box, 4 vertical edges r 3, fine / 8 segments | 1,020 / 268 | 6 planes + 4 cylinders, ±3e-5 % | 279 / 102 |
| box, 4 top edges r 2 | 196 | refused, 1 region (11 %): one smooth cluster of four cylinders (slice 4a2: converts, 6 planes + 4 cylinders, +7e-7 %; OCCT mitres the corners, no sphere) | 0.2 |
| plate, 12-gon hole / slot / boss | 116 / 528 / 516 | 7 / 10 / 8 faces, ±3e-7 % | 21 / 280 / 33 |
| tube r 10 / r 6 | 1,008 | 2 planes + 2 cylinders | 48 |

### Amendment, 2026-10-21: spheres and cones (slice 4a1)

The two remaining primitives (tori and splitting a smooth cluster into
several primitives are the next slice), measured natively
(`bash spikes/stl-to-solid/run.sh prismatic c`) and in Vitest.

- **Fits** (`fitMeshSphere` / `fitMeshCone`, after plane and cylinder). A
  **sphere**: the centre an algebraic fit (the linear system `2 Σ q qᵀ c' =
  Σ q |q|²` over the centroid `m`, `c = m + c'`) refined by Gauss–Newton on
  the residual `|p − c| − r` (three unknowns, `solve3`), the radius the mean
  distance; refused when the nodes are nearly coplanar (the covariance's
  smallest eigenvalue under 1e-6 × its largest). A **cone**: the axis the
  facet normals' area-weighted covariance's smallest eigenvector (refused
  when `values[1] ≤ 1e-6 × trace`, as for the cylinder), the half-angle
  `asin|mean(n·a)|` (refused outside 1°–89°), the apex the facet tangent
  planes' least-squares meeting point (`Σ a_t n_t n_tᵀ x = Σ a_t n_t (n_t ·
  centroid_t)`), the half-angle then the nodes' mean `atan2(ρ_i, h_i)`, and
  the deviation `max |ρ_i cos α − h_i sin α|` (the distance from the
  generating line in the meridian plane). `origin` is the apex, `direction`
  points from it to the nodes, `semiAngle` is α. The order is **plane →
  cylinder → cone → sphere**: a frustum meshed with only its two end rings
  (manifold's `cylinder`) has all its nodes on a sphere too — measured, a
  r 10 → 4, h 20 cone's rings lie on a r 12.74 sphere — so the facet normals
  are the only thing that tells them apart, and the cone must come first
  (a full sphere's cone fit is refused: its normals' mean along the axis is
  zero, α < 1°). An unfit region takes the min deviation of the fits that
  were ok, so the cone and sphere fits can lower a suggested tolerance (the
  noisy 32-gon's falls from 0.006 to 0.003: a sphere also nearly fits its two
  rings). The chord error is the brief's: sphere `r (1 − cos(θ/2))`, cone
  `(ρmax / cos α)(1 − cos(θ/2))`, θ the largest facet-to-facet angle
  (`largestAngle`, shared with the cylinder).
- **Three changes the brief's rules needed, and why.** (1) *A pointed cone.*
  The facet tangent planes' least-squares apex sits a chord error **behind**
  the mesh tip (19.9897 for an apex at 20), so `min h < −1e-6 × max h`
  refused the whole cone. The fit refuses only a genuine double cone (`min h
  < −0.5 × max h`, nodes on both sides in comparable amount) and takes the
  half-angle over the nodes **in front of** the apex (the tip's `atan2(0, 0)`
  otherwise drags it); the cone then fits and the refusal moves to the
  rebuild — `MakerVolume` can't use the cone face's singular apex (`v1 = 0`)
  — so the user gets the usual *rebuild* message, no crash, no invalid
  solid. (2) *A dome.* A cylinder fused with a hemisphere is one smooth
  cluster whose cylinder facets are coarser (larger) than the sphere's; the
  slice-3 peel rule took each large region as a plane and gave 64 planes + a
  sphere. The peel now groups the peeled regions into smooth components too
  (`components(large)`) and fits each, which gives the cylinder back; a plain
  sphere has no such split and is one sphere face. (3) *The volume
  allowance.* `max(1 %, Σ area × sag + tolerance × area)` was 0.5 % short for
  manifold's 48-meridian sphere: its inscribed polyhedron is 41.9 mm³ under
  the true 4188.8 (1.0 %), while the sagitta sum is 28.9 and the 1 % floor
  41.5. The sagitta sum is doubled (`2 × Σ area × sag`), still tight (a
  fine mesh's sag → 0) but covering the measured deficit.
- **Snaps.** After the cylinders' snap loop, a **sphere** next to cylinders
  it shares its radius with (a dome) takes their mean radius and the point
  nearest their axes (normal equations `Σ (I − a_k a_kᵀ) c = Σ (I − a_k a_kᵀ)
  o_k`, `solve3`; with one cylinder, the centre projected onto its axis); a
  **cone** next to a cylinder within 1° (`|a · a_cyl| > cos 1°`) takes that
  cylinder's axis line (apex projected onto it), else next to a plane it is
  square to (`|a · n| > cos 1°`), that plane's normal. The dome's sphere
  radius equals the cylinder's to 1e-11 and sits on its axis (x, y ≈ 1e-16);
  the countersink's cone axis is the through hole's.
- **Faces and verification.** A cone is `gp_Cone(gp_Ax3(apex, a), α, 0)`
  between `v1 = max(0, min h_i / cos α − margin)` and `v2 = max h_i / cos α +
  margin` (v the distance along a generatrix from the apex); a sphere the
  full `gp_Sphere(gp_Ax3(centre, mean outward normal), r)`. The frame's **Z
  along the mean outward normal worked** for the dome — the brief's
  perpendicular fallback wasn't needed (a full sphere is rotation-invariant;
  the frame only moves its poles and seam); for a full sphere the mean normal
  cancels to ~0, so the frame falls back to world Z. Verification reads
  `GeomAbs_Cone`/`GeomAbs_Sphere` and projects nodes with
  `ElSLib::Parameters`/`Value` as for planes and cylinders; cones and spheres
  count into the report's slots 3 and 4, and the surface cap covers all four
  kinds.

Measured, native (ms under node; the same matrix passes in Vitest):

| Mesh | Triangles | Result | ms |
|---|---|---|---|
| sphere r 10 (UV) | 2,208 | 1 sphere face, r 10 (±2e-8), ±7e-7 % | 103 |
| dome (cylinder + hemisphere), fine / coarse | 5,472 / 254 | 1 plane + 1 cylinder + 1 sphere, sphere r = cylinder r (±1e-11), ±3e-6 % | 435 / 25 |
| truncated cone r 10 → 4, h 20 | 1,600 | 2 planes + 1 cone, half-angle 16.716° (atan(6/20) is 16.699°), +0.025 % | 81 |
| countersunk plate (box, hole r 3, sink r 6 → 3) | 754 | 6 planes + 1 cylinder + 1 cone, −7e-4 % | 120 |
| pointed cone r 10, h 20 | 1,476 | refused at the rebuild (MakerVolume can't do the OCCT cone's singular apex; manifold's mesh of the same cone converts to a plane + a cone; slice 4a2: converts, 1 plane + 1 cone, +2e-6 %) | 61 |
| ellipsoid (sphere × 0.6 in z) | 2,208 | refused, 1 region (100 %) | 1 |

The plain sphere and the 499k-triangle sphere, refused in slice 3's table,
now convert to one sphere face (the table above notes the change).

### Amendment, 2026-10-21: tori and split clusters (slice 4a2)

The last primitive and the split of a smooth cluster that fits nothing
whole, measured natively (`bash spikes/stl-to-solid/run.sh prismatic t`, then
the full matrix) and in Vitest.

- **The torus fit** (`fitMeshTorus`, kind 4, after the sphere: the order is
  plane → cylinder → cone → sphere → torus). Every normal line of a torus
  meets its spine circle, so for the signed tube radius ρ the points
  `centroid_t − ρ n_t` lie on one circle and are coplanar (ρ > 0 when the
  normals point away from the spine: a donut, a fillet on an outside edge
  or on a hole's edge; ρ < 0 on the concave side). ρ minimises `f(ρ)`, the
  smallest eigenvalue over the trace of those points' area-weighted
  covariance (`Sgg − ρ (Sgn + Sng) + ρ² Snn` from moments taken once, so
  each `f` is a 3 × 3 eigenproblem), over `±[tolerance, D]` (D the bounding
  box diagonal): 32 geometric samples a side, golden section between the
  best one's neighbours (40 iterations), refused above 1e-3. The axis is that
  covariance's smallest eigenvector; the spine an area-weighted algebraic
  (Kåsa) circle fit in its plane (`solve3`); the tube radius the nodes' mean
  distance from the spine; then Gauss–Newton on all seven parameters (centre,
  two tilts of the axis, R, r) over `sqrt((ρ_i − R)² + h_i²) − r`, a
  central-difference Jacobian, `solveN` (Gaussian elimination, partial
  pivoting, n ≤ 8), up to 12 iterations, the step halved while the residual
  sum grows. The axis is oriented with its largest component positive. The
  chord error is `(R + r)(1 − cos(θ/2))`. The donut R 10 r 3 fits to 1e-8
  fine and coarse.
- **The split** (`splitComponent`). `settle` sends an unfit result of 4 or
  more regions to it; each piece it returns is settled by the old rule (unfit
  under 4 regions → planes). Seeds go by area, largest first. **A large seed
  (4 × the component's median region area) is a plane** at once (the flat
  face between fillets); else its **patch** adds the unassigned smooth
  neighbour sharing the **longest border** with it (region border lengths are
  kept beside `regionNeighbours`), one at a time, until it has 16 nodes, and
  `bestFit` (the five fits in order, factored out of `fitComponent`) tries
  it, dropping the last region added while 16 nodes are left; a seed whose
  patch fits nothing is skipped and may join a later piece. A piece grows in
  rounds: every frontier region whose every node is within the tolerance of
  the surface (`distanceToSurface`) joins, the same kind is refitted over the
  piece (`fitOfKind`), and a refit outside the tolerance undoes the round.
  Then a region on a border goes to the neighbouring piece whose surface is
  nearer its nodes, and the pieces that changed are refitted. What no piece
  took becomes unfit pieces, one per smooth component — and **when one of
  them has 4 regions or more, the split is dropped and the component stays
  one unfit region**: a freeform surface fits small primitives here and there.
  The first version (no such rule, no 16-node floor) split the ellipsoid into
  299 pieces (256 cylinders, 37 spheres, 6 planes) and the rebuild took 273 s
  to refuse; now the ellipsoid is refused in 42 ms as 1 region (100 %), as
  before.
- **What changed from the brief, and why.** (1) *Patches by border, not by
  breadth-first layers, and no prefix under 16 nodes.* A fillet strip's
  first layer holds the corner sphere's facets at its two ends, so every layer
  mixed two kinds and fell back to the seed alone; and a patch of two strips
  fits a cylinder exactly (six nodes), so with prefixes under 16 nodes a big
  plane plus one strip "fitted" a cylinder (the twelve-fillet box came out
  with no plane at all). (2) *A large seed is a plane* at once, instead of
  `planeOf` after a failed patch (the same 4 × median rule as the peel): a
  16-node patch of the box's top face and its first strips still fitted a
  sphere of r 72. (3) *A plane's fit is the
  largest region's own plane* when it holds every node, else the facets'
  area-weighted plane, else least squares: a disc whose edge took a fillet's
  near-tangent facets tilted by 6e-5 rad under least squares, and the torus
  next to it no longer touched it (MakerVolume kept no cell). (4) *Own-node
  refits*: after the clusters, each curved surface is refitted (up to 4
  passes) without the nodes that are off it by more than twice its median node
  and much nearer a neighbouring surface: a fillet strip's planar region can
  carry the end of a corner sphere's facets (within 1° and the tolerance),
  and those few nodes put the box's cylinders at r 2.00055, off their axes by
  1e-3; after the passes r is 2 to 1e-6. (5) *One rolling radius*: in the
  rebuild, adjacent cylinders, spheres and tori whose radii (a torus's tube)
  agree within the tolerance take their area-weighted mean, before the snaps,
  so fillets meeting at a corner are exactly tangent. (6) *Trimmed curved
  faces*: a cylinder's u, a sphere's latitude and longitude (its frame's Z is
  the mean outward normal) and a torus's tube angle v cover the nodes' range
  past their largest gap, grown by the margin; the full turn when that gap is
  under twice the margin **plus twice the facet angle** (the brief's
  `2 margin / r` alone left the donut's tube an open band, fine and coarse:
  MakerVolume failed). With full spheres and full cylinders the twelve-fillet
  box gave 53 cells and a unified result of 58 faces, or an invalid one once
  its radii were exact; trimmed, 1 cell and 26 faces. (7) The verification
  moves a curved face's u (and a torus's v) by whole turns into the face's
  own range before classifying a node in it (`ElSLib` gives [0, 2π); a node
  the face misses falls back to `BRepExtrema`, slow), and the cell
  classification tries the last cell hit first.
- **Snaps** (after the sphere and cone snaps). A torus next to a cylinder
  within 1° takes the cylinder's axis line (centre projected onto it) and, when
  `|R + r − r_cyl|` or `|R − r − r_cyl|` is within 10 × the tolerance,
  `R = r_cyl − r` (a cylinder's end) or `R = r_cyl + r` (a hole's edge); else
  next to a plane it is square to, `±n`. Either way a plane square to it whose
  distance from the spine plane is within 10 × the tolerance of r moves the
  centre along the axis to make it exactly r (the brief gated nothing; an
  ungated move would drag a torus onto a plane it only crosses).
- **The face and the report.** `gp_Torus(gp_Ax3(centre, axis), R, r)`, u the
  full turn, v as above; the verification reads `GeomAbs_Torus` (kind 4,
  `ElSLib` on `gp_Torus`); tori count into the report's slot 5 and the
  surface cap; the unfit message says "fits no plane, cylinder, sphere, cone
  or torus".

Measured, native (ms under node, this machine):

| Mesh | Triangles | Result | ms |
|---|---|---|---|
| donut R 10 r 3, fine / coarse | 14,364 / 1,352 | 1 torus face, R and r ±1e-8, −6e-7 % / +4e-7 % | 381 / 66 |
| box 40 × 30 × 10, 4 top edges r 2 | 196 | 6 planes + 4 cylinders (OCCT mitres the corners: no sphere), +7e-7 % | 113 |
| cylinder r 5 h 20, top edge r 2 | 3,436 | 2 planes + 1 cylinder + 1 torus R 3 r 2 on the axis, +3e-7 % | 246 |
| plate, hole r 3, top edge r 1 | 2,284 | 6 planes + 1 cylinder + 1 torus R 4 r 1 on the hole's axis, −8e-8 % | 236 |
| box 20³, all 12 edges r 2 | 2,796 | 6 planes + 12 cylinders + 8 spheres (26 faces), −9e-7 % | 1,490 |
| ellipsoid (sphere × 0.6 in z) | 2,208 | refused, 1 region (100 %) | 45 |

The full matrix keeps every result but three rows, all for the better: the
box with four top fillets (slice 3's table) converts; the OCCT pointed cone
(slice 4a1's table) converts to 1 plane + 1 cone, +2e-6 %; the truncated cone
fits 16.69995° (atan(6/20) is 16.6992°; was 16.716°), +0.0014 % (was
+0.025 %). Refusals cost the split's attempts: the noisy 32-gon at 0.001 mm
21 ms (was 0.1), the ellipsoid 42 ms (was 1.3).

### Amendment, 2026-10-21: preview and report as built (slice 4b)

- **One segmentation, two callers.** The facade's `segmentMesh(tolerance,
  MeshSegmentation&)` (private) holds what `prismaticFromMesh` did up to its
  refusals: the checks (tolerance, empty mesh, a node index out of range),
  normals, adjacency, planar regions, smooth clusters, `fitComponent`, the
  fine-tessellation rule, the report counts and the suggested tolerance.
  `prismaticFromMesh` runs it and then refuses or rebuilds as before (the
  same messages and counts: the slice-3 matrix prints the same natively);
  the new public `meshRegions(tolerance)` runs it and stops. It fills
  `meshReport_` as a refusal would (faces 0), a surface index per triangle
  (`meshRegionsPtr()`, int32, `meshRegionTriangles()` long, in the staged
  triangle order) and a kind per surface (`meshRegionKindsPtr()`, int32,
  `meshRegionCount()` long: 0 plane, 1 cylinder, 2–4 reserved for cone,
  sphere and torus, −1 unfit; core's `MESH_REGION_KIND`), and frees the input
  buffers. The region buffers live until `clearMeshRegions()` (the kernel
  calls it after copying), the next `meshNodes` or the next `meshRegions`.
- **Per-triangle mapping.** `Kernel.meshRegions(shape, tolerance)` stages the
  body's `Manifold.getMesh()` exactly as `meshToSolid` does (one
  `#stageMesh`), and the view's `BodyMesh` of a mesh body is built from the
  same `getMesh()` triangle order (`displayMesh` keeps it), so
  `surfaceOf[t]` is triangle `t` of `BodyMesh.indices` / 3. `MeshRegions` =
  `{ surfaceOf: Int32Array, kinds: Int32Array }` plus the report's counts
  (`planes`, `cylinders`, `cones`, `spheres`, `tori`, `unfit`,
  `suggestedTolerance?`). Through the worker: `KernelApi.meshRegions(body,
  tolerance, base?)` (the body as the last recompute has it, or with `base`
  the last preview's base: editing the feature that replaced the mesh),
  transferring the two arrays, and `Recomputer.meshRegions`, `undefined` on
  any error (a solid, a bad tolerance, a body that is gone).
- **The preview decision: the draft still evaluates, the view shows the
  regions.** Measured (native harness, case `r`; and Vitest on CI's WASM):

  | Mesh | Triangles | `meshRegions` | full conversion |
  |---|---|---|---|
  | `cube.stl` | 12 | 0.03 ms | 93 ms |
  | plate with a hole | 5,044 | 1.8–4.3 ms | 346–422 ms |
  | sphere (refused) | 499,000 | 278–330 ms | 274–289 ms (refused after the same segmentation) |
  | staircase, 302 planes | 1,196 | 0.46 ms | 3,080 ms |

  In Vitest (CI's WASM, the Ubuntu machine; `describe('Kernel.meshRegions')`
  prints them): the 500,000-triangle manifold sphere segments in 274 ms
  (refused by the conversion in 293 ms), the 20,124-triangle plate in 7 ms
  (converted in 236 ms), the 302-surface staircase in 1 ms (converted in
  2,774 ms). The unfit fraction is clamped to 1 in the kernel (the area sums
  round a whole sphere to 1.0000000000000027).

  A refused mesh costs the segmentation either way, but a part that
  converts costs seconds per draft as its surfaces grow (MakerVolume's
  pairwise intersections: 3.1 s at 302 surfaces). Skipping the draft's
  evaluation for prismatic would leave the dialog without its status (OK
  enabled on a mesh that fails to rebuild, the refusal only after OK), and
  editing without its base (the mesh is only in the preview's base once the
  feature replaced it). So the draft is still previewed as for every
  feature, which gives the status, the OK button, the base and the report;
  but while the method is prismatic the view draws **the regions in place
  of the drawing and of the body's own faces**, from the first answer
  (milliseconds) to the end, and never the solid: the colours say more than
  a solid drawn like the mesh. The region request goes out before the
  preview, so the worker answers it first. Faceted draws its solid as before.
- **The dialog hook.** `FeatureDialogSpec.regions?(values, ctx) →
  { body, tolerance } | undefined`; the controller (`syncRegions` in
  `dialog.ts`) asks `DialogKernel.meshRegions` (optional, like
  `tangentChain`) when the request or the body's mesh changed, debounced
  with the spec's `previewDelay`, drops late answers by generation and a
  sequence, keeps the answer in `DialogPreview.regions` /
  `DialogContext.draftRegions` (kept while a request for the same body is
  out; a half-typed value leaves them), clears them when the hook gives
  undefined (faceted, no body) or the dialog closes, and in edit mode waits
  for the first preview's base. Nothing in `dialog.ts` names Mesh to Solid.
- **The dialog.** An info field `summary` ("Result"): the regions'
  counts while prismatic, else the draft's report (`Preview.meshToSolid`,
  `DialogPreview.meshToSolid`, `DialogContext.draftMeshToSolid`, the `thread`
  pattern): "6 planes, 1 cylinder · 0 unfit" (kinds with a count, unfit
  always; core's `meshSurfaceSummary` / `meshToSolidSummary`), "6 faces" for
  faceted. Its legend is real swatches: `InfoField.legend?(values, ctx)` →
  `{ tone: 'create' | 'sketch' | 'error', label }[]`, rendered under the line
  by `FeatureDialog.tsx` from the same tokens the view reads ("Planes",
  "Cylinders", "Fits nothing"); the hint (the label's tooltip) says what to do
  about a red region. The dialog region carries `data-regions="6 planes,
  0 cylinders, 0 unfit"` and the viewport `data-preview-regions="<body>"`.
- **The view.** `ViewPreview.regions` (`{ body, surfaceOf, kinds }`, filled
  by `previewOf`; `previewInputs` makes an empty drawing so the regions show
  while the draft is refused) goes from `Viewport.tsx` to `Bodies` and the
  `Body` it names. `regionGeometry` (`viewport/regionGeometry.ts`, unit
  tested) builds a de-indexed copy of the body's positions and normals with a
  colour per corner (nodes are shared between triangles of different
  surfaces), memoised on (mesh, regions, colours) and built only while
  regions exist; `Body` draws it with its pose and clipping planes **in place
  of** its faces mesh (picking reads the `BodyMesh`, not the scene, so it is
  unchanged). Colours: planes `--x-cat-create`, cylinders and every curved
  kind `--x-cat-sketch`, unfit `--x-error` (`SceneColors.regionPlane`,
  `regionCurved`, `regionUnfit`), so both themes follow. Regions for another
  triangle count draw nothing.
- **Status and MCP.** The recompute attaches each Mesh to Solid report,
  without its `kind`, to its feature's status (`FeatureStatus.meshToSolid`,
  core's `MeshToSolidReport`, which the kernel's type re-exports);
  `sameStatuses` compares it. The timeline chip's tooltip adds the summary
  ("Mesh to Solid · 6 planes · 0 unfit"), and `get_feature` returns
  `meshToSolid` as the status has it. A refused conversion has no report on
  its status (the error says it); the dialog's regions carry the counts.

### Amendment, 2026-10-22: hardening slice A (memory safety, rebuild budget, rebuilds that failed)

The owner ran the kernel over 41 real STLs on 2026-10-21 (36 import as closed
bodies; prismatic converted 6 at 0.01 mm). Three problems are fixed here;
measured with the harness's new `f`/`F` cases (`spikes/stl-to-solid/README.md`)
and `packages/kernel/src/mesh-to-solid-files.test.ts`.

- **The trap.** `splitComponent` moves border regions to the nearer piece,
  then refitted only the pieces whose region count had changed. A piece can
  lose one region and gain another and keep its count: its region list then
  still named the region it lost (now on two surfaces) and missed the one it
  gained (on none). `rebuildPrismatic` indexed `adjacent[surfaceOf[r]]` with
  -1, a read 12 bytes before the vector of vectors (AddressSanitizer, `SAN=1`);
  in the app's O3 build that read garbage pointers and trapped with `memory
  access out of bounds` or `unreachable`, or corrupted the heap for every
  later call (`table index is out of bounds`, garbage error text). The
  harness's O2 build read the garbage without trapping, so the bug was
  reproduced through the kernel and the harness fed the kernel's mesh order
  (`MESH_OUT`). Over the test files, 1 to 59 regions per file were lost at
  0.01 to 0.2 mm (desk-organizer, puzzle-insert-circle, hot-wheels-connector,
  micro-sd-keyring-inner, vented-funnel, trashcan-spacer at 0.1 and 0.2 …).
  **Fix:** a piece that lost or gained any region is refitted (or keeps its
  surface with its new region list). **Guard:** the rebuild refuses
  ("couldn't rebuild … within") when a region is on no surface, instead of
  indexing with -1. The fixture test checks that `meshRegions` maps every
  triangle of trashcan-spacer at 0.1 and 0.2 mm (it mapped 1 and 9 to -1).
- **The budget.** The rebuild (everything after `segmentMesh`) gets
  `PRISMATIC_REBUILD_BUDGET_MS = 30000` of wall-clock time: a
  `Message_ProgressIndicator` (`MeshDeadline`, `UserBreak()` past the
  deadline) is passed as a `Message_ProgressRange` into
  `BOPAlgo_MakerVolume::Perform`, `ShapeFix_Solid`/`ShapeFix_Shape::Perform`
  and `BRepExtrema_DistShapeShape`, and the rebuild checks the deadline
  between its own loops (cells, nodes). Past it, `meshToSolid` refuses with
  "Mesh to Solid gave up after 30 s: this mesh has too many surfaces to
  rebuild exactly. Use Faceted, or simplify the mesh in your slicer." The
  report is filled before, as for every refusal. `prismaticBudgetMs_` lowers
  it for the harness only (`BUDGET`).
- **Why it was slow, and two fixes.** Stage times (`TIMES=1`) showed the
  cell classification as often the larger half: every sample point was
  classified against every cell whose box held it, and a torus's or
  sphere's cell is slow to classify. A cell whose votes agree (16 or more,
  90 % one way) is now **decided** and later samples skip it.
  numbers-base-top (471 planes) at 0.01 mm: classification 12.4 s → 0.2 s,
  the whole rebuild 16.5 s → 1.6–2.7 s on the Ubuntu machine (10 s on the
  owner's laptop before). **The faces' extent changed slightly:** a face's
  margin is 10 × tolerance + twice the largest chord error of *it and its
  neighbours*, no longer of the whole mesh (one coarse torus grew every
  face, so MakerVolume intersected more pairs). desk-organizer at 0.01 mm
  (374 surfaces, 389 cells): MakerVolume 20 s, classification 19 s, unify
  3 s, then "invalid after healing" at 44 s with no budget; with it, a
  refusal after 30 s. The rebuild of the slice-3/4 matrix (`run.sh
  prismatic`, all cases) gives the same faces, kinds, validity and volumes
  as before, mostly faster (sphere r10 156 → 16 ms, all-edges-filleted box
  1.45 → 0.43 s, 302-surface staircase 3.7 → 2.5 s).
- **Rebuilds that failed although every region fit**, by the check that
  refused (now named by `TIMES=1`):
  - *hole-filler-35mm*, a node 0.053 mm off the solid: the torus snap
    (within 10 × tolerance of tangent to a cylinder) moved R by 0.054 mm,
    but the torus meets that cylinder at a crease. **A snap only takes when
    the surface still holds its own nodes within the tolerance**; else the
    surface keeps its fit.
  - *trashcan-repair-foot*, MakerVolume made no cell: one r 9.80 cylinder
    came out as four surfaces (between chamfer facets), the snaps moved two
    of them 0.008 mm apart, and near-coincident cylinders leave no closed
    cell. **Surfaces that are one surface are merged** before the snaps: a
    surface joins a larger one of its kind with a parallel normal or axis
    (and a radius within the tolerance) when every node of it is within
    the tolerance of that one, or of one fit over both (free, or about
    either piece's axis).
  - *wyze-garage-bracket* (volume 451 against 7,873 mm³: cells missing) and
    *micro-sd-keyring-inner* (volume 7 against 945 mm³) still fail at
    0.01 mm. wyze: a cylinder tangent to one plane kept its fit's tilted
    axis although a square end plane was there; the single-tangent snap now
    takes that plane's normal as the axis, which keeps 1,532 mm³ instead of
    451 but doesn't close the body (MakerVolume warns `NotSplittableEdge` and
    `FaceBuilderUnusedEdges` on the nearly tangent top plane). micro-sd: the
    segmentation fits two slot ends (two r 0.6 arcs joined by a 0.15 mm
    flat) with a sphere r 1.385 whose nodes are only the end rings, and an
    r 0.853 cylinder over flat and arc ends; slice C's.
  - Tried and **rejected**: a cylinder–cylinder tangency snap (a fillet
    tangent to a larger parallel cylinder, moved along its tangent plane):
    it broke micro-sd-keyring-outer at 0.01 mm (41 faces, volume 1.0000 →
    29 faces, 1.0066) and drill-block at 0.05 mm (converted → refused) and
    fixed none of these files; a refit of a snapped cylinder's circle about
    its new axis (no measurable change); a check that a curved fit holds the
    facet centroids within the tolerance plus twice the chord error (it
    tells a two-ring cylinder from a sphere, but refused manifold's
    geodesic sphere, whose triangles sit deeper than twice the edge-based
    chord error).
  - The chord-error case (a 0.01 mm check on a coarser mesh) didn't occur
    among these files: every refusal that remains fails a cell or validity
    check, not the node distances.

The ten files whose rebuild failed with every region fitting, and
drill-block (the reverse case), before (head 4188a505, the owner's runs)
and after (this amendment, the kernel over `STL_DIR`):

Prismatic, kernel over the files (Ubuntu machine, others' jobs running);
"rebuild" is "couldn't rebuild … within", "trap" a WASM trap or the heap
it corrupted, faces planes/cylinders/cones/spheres/tori, volume against the
mesh's:

| file | 0.01 mm before → after | 0.05 mm before → after | 0.1 mm before → after |
|---|---|---|---|
| own/battery-holder | rebuild → rebuild (1.0 s) | rebuild → rebuild (1.0 s) | rebuild → budget (30 s) |
| own/hole-filler-35mm | rebuild → **6 (3/2/0/0/1), 1.0013** (0.4 s) | rebuild → **same** (16 s) | rebuild → **same** (14 s) |
| own/trashcan-repair-foot | rebuild → **16 (12/4/0/0/0), 0.9989** (0.1 s) | unfit → unfit 1 (34 %) | unfit → unfit 1 (38 %) |
| door-stopper-top | rebuild (24 s) → rebuild (6.3 s) | rebuild → rebuild (4.2 s) | rebuild → rebuild (15 s) |
| gardena-end | rebuild (2.2 s) → rebuild (3.0 s) | rebuild → rebuild (0.2 s) | rebuild → rebuild (0.2 s) |
| micro-sd-keyring-inner | rebuild → rebuild (2.2 s) | trap → **97 (91/6/0/0/0), 1.0006** (0.8 s) | 84 faces (4.5 s) → **84 (78/6/0/0/0), 1.0007** (1.2 s) |
| mms-flat-stand | rebuild → **44 (37/6/1/0/0), 1.0000** (0.3 s) | trap → **same** (0.4 s) | rebuild → rebuild (0.3 s) |
| sock-clips-6x | rebuild (43 s) → budget (30 s) | trap → rebuild (1.0 s) | rebuild → budget (30 s) |
| spaghetti-measure | rebuild → rebuild (0.9 s) | trap → rebuild (0.3 s) | rebuild → rebuild (1.2 s) |
| wyze-garage-bracket | rebuild → rebuild (0.5 s) | trap → **84 (55/27/2/0/0), 1.0002** (9.1 s) | rebuild → **88 (58/28/2/0/0), 0.9987** (5.1 s) |
| own/drill-block | unfit 3 → unfit 3 (0 %) | 168 faces (9.6 s) → **168 (137/30/0/1/0), 1.0003** (3.4 s) | rebuild → rebuild (2.4 s) |

Over all 41 files, prismatic converts 9 at 0.01 mm (6 before), 11 at 0.05 and
9 at 0.1, with no trap in one process per tolerance; hole-filler's 14–16 s
at 0.05 and 0.1 mm is a fourth cell (three kept) that no sample falls in: it
stays undecided, and every sample is classified against it. **The budget overruns inside MakerVolume**: it
asks the indicator between its own steps only, and one step of
hot-wheels-connector at 0.1 mm ran to 56 s before the refusal; stopping
inside a step would need the rebuild on its own thread.

### Amendment, 2026-10-22: hardening slice B

The owner ran 41 real STLs through `Kernel.meshToSolid` on 2026-10-21
(`~/Development/extrudo-stl-solid-test/baseline-2026-10-21-tol0.01.md`) and
found two faceted problems. This slice fixes exactly those two.

**The cap refusal was slow.** On every over-cap mesh the facade built the
whole solid (unify included) and only then counted faces: 3–15 s per file
(`own/kuglbahn-pillar-base.stl` 12.8 s for 19,883 faces,
`own/spool-screw-v4.1.stl` 10.4 s, `third-party/vented-funnel.stl` 9.8 s).
Now a private `facetedMeshCounts()` runs first, from the triangle buffers
alone: adjacent triangles (sharing a node-index edge) whose unit normals
agree within 1e-3 rad and whose planes agree within 1e-3 mm — the tolerances
`ShapeUpgrade_UnifySameDomain` gets — are one face, with a union-find over
the triangles; a zero-area triangle joins a neighbour; the number of groups
is the estimate. A circle of `uses` sorted by edge key is linear-ish and
costs single-digit ms on these files (every refusal is now under 25 ms).
Over `FACETED_FACE_CAP` the facade refuses at once with "Faceted would give
about N faces; …" (the word "about" is new: the estimate can be off by a few
faces). The old after-unify count stays a backstop; its message is unchanged
(no "about"). The estimate matched the exact count for 12 of the 18
non-capped files measured and was within 5 % for 17;
`own/trashcan-repair-foot.stl` was the outlier (387 estimated vs 275 exact,
+41 %; `UnifySameDomain` merges more than the edge rule sees).

**Six meshes the importer accepted as closed were refused** with "Mesh to
Solid couldn't make a closed solid from this mesh …". The stage was the
`BRepCheck_Analyzer` on the solid, before unify, and its shell status was
`BRepCheck_NotConnected`: every one of the six is a body of **several
disjoint closed shells** (a multi-part STL), and putting all their faces in
one `TopoDS_Shell` is not a connected shell. `wyze-garage-bracket` has 2
shells, `mirna-doodle-1` 5, `battery-power-adapter` 2, `phone-stand-foldable`
2, `whiteboard-tray-v5` 7, `gear-bearing-5` 7. **Fix:** the facade groups the
faces by shared edge (a union-find over the OCCT edges) and builds one shell,
`BRepBuilderAPI_MakeSolid`, `ShapeFix_Solid` and `ShapeUpgrade_UnifySameDomain`
per shell; one shell gives the solid as before, several give a compound
(`splitSolids` splits it into bodies, ADR-0030). `mirna-doodle-1` (198 faces)
and `wyze-garage-bracket` (945 faces) now convert, valid, volume unchanged to
the mesh; the other four were always over the face cap (8,152 / 7,851 /
7,938 / 16,987 estimated) and are now refused at the pre-count, quickly. No
mesh with one shell changes (same face counts, validity and volume).

**A truly non-manifold mesh still refuses, and now names the reason.**
`facetedMeshCounts()` also counts edges shared by more than two triangles,
edges used by one (open), and pinched vertices (a vertex whose triangles
belong to more than one edge-connected shell). Each has a message: "Mesh to
Solid couldn't make a closed solid from this mesh: 3 edges are shared by more
than two triangles. Repair it in your slicer or a mesh tool and try again."
(and "1 edge has only one triangle." / "1 vertex joins shells that only touch
at a point."; the counts pluralise). The generic message stays for anything
else. The importer rejects open and non-manifold-edge meshes before this, so
only a direct `Kernel.meshToSolid` call, or a pinched-vertex mesh
(`checkManifold` counts edges, not vertices), reaches those clauses.

The fast loop is harness case `g` (`STL_DIR=… FILE=… bash
spikes/stl-to-solid/run.sh prismatic g`): faceted on one corpus file. Tests
in the faceted `describe` of `packages/kernel/src/mesh-to-solid.test.ts`: a
two-cube mesh converts into a compound of two solids; a mesh whose two cubes
touch at a single vertex is refused with "vertex joins shells that only touch
at a point"; the cap-refusal test asserts the refusal takes under 1 s.

### Amendment, 2026-10-22: hardening slice C (small unfit regions, wrong clusters, a tolerance to suggest)

At 0.01 mm the unfit refusal fired on 19 of the owner's 36 real meshes, 10 of
them with unfit regions covering 0–6 % of the surface on parts that are
otherwise plain prismatic work. Measured with the harness's new `UNFIT=1`
print (spike README) and the kernel over `STL_DIR`.

- **What the small unfit regions are** (0.01 mm, per file): *drill-block*
  (3 regions, 0.3 %): 1 mm tall walls of embossed lettering, extruded
  freeform curves in 2-triangle facets; *track-straight-100mm* (2, 0.5 %):
  the 0.66 mm chamfer round the rim of the keyhole socket, a cone round the
  circle blending into flat chamfers along the neck; *remove-before-flight-cover*
  (5, 0.5 %): four 0.25 mm strips 15 mm long (a narrow round on the lettering
  slots) and one 27-region blend; *shower-holder* (3, 0.9 %): a 0.5 mm round
  along a faceted freeform outline, top and bottom, and the corner where
  fillets of r 0.8 and r 2 meet (no sphere: its best sphere is 0.15 mm off);
  *object-permanence-base* (7, 0.5 %): four rounded corners (best fit 1.3 mm
  off), two r 2 fillets along non-circular paths (a torus 0.3 mm off) and
  one crease sliver of 4 triangles; *hot-wheels-connector* (1, 0.5 %): a
  0.5 mm tall freeform wall with sliver triangles 0.0003 mm thin;
  *vented-funnel* (1, 2.08 %): a fillet along a non-circular rim (a torus
  0.16 mm off); *mirna-doodle-1* (11, 6 %), *puzzle-insert-circle* (1, 6 %)
  and *spool-screw-v4.1* (2, 6 %): freeform outlines, a freeform cap and the
  screw's helical thread. None is a segmentation fault of the kinds the
  brief names: no sliver whose nodes all lie on one neighbour (the one
  crease sliver has its nodes on two), no corner where fillets of one
  radius meet. They are left out by the rule below.
- **The unfit allowance.** Unfit regions covering at most
  `PRISMATIC_UNFIT_ALLOWED = 0.02` of the surface area in total no longer
  refuse. They stay kind −1 surfaces with **no face**: the merge of same
  surfaces, the snap check, the faces, the cell samples and the node check
  skip them (their nodes have no face to be near), the volume check keeps
  its allowance. Their neighbours' faces would end a margin past their own
  nodes and leave a hole where the region was, so each neighbour **grows by
  the gap the region leaves**: every node of the region is measured to the
  nearest node of each neighbour, and the second nearest neighbour's margin
  grows by that distance (a node on one border of a chamfer is the
  chamfer's width from the other border's face; a wall's foot is the wall's
  height from its top). The region's geometry is gone from the result: a
  chamfer or round comes back sharp, embossed text flat. The report's
  `unfit` keeps the regions, triangles and fraction left out (the region
  preview's red and `data-regions` show them, as before). When the rebuild
  with regions left out fails, the user gets the **unfit refusal** (regions,
  share, a tolerance), not the rebuild one; over 2 % it refuses as before.
  The web side needed no change: nothing there keys on `unfit.regions > 0`
  (the dialog's line and legend only show the count; the status is the
  kernel's).
- **A tolerance to suggest when the rebuild fails.** A rebuild that fails at
  T (not past the budget) is retried, segmentation included, at 2 T and 5 T
  inside the same `MeshDeadline`; a retry whose unfit share is over 2 % or
  whose surfaces are over the cap is skipped. The first that converts is
  named — "Mesh to Solid couldn't rebuild this mesh as an exact solid within
  0.01 mm. Raise the tolerance to 0.05 mm, or use Faceted." (`millimetres()`)
  — and its result released; the report and the stage times stay T's. With
  regions left out, the unfit refusal names that tolerance instead of the
  fit-based one ("… fit no plane, cylinder, sphere, cone or torus. Raise
  the tolerance to 0.05 mm, or use Faceted."); with no retry converting it
  keeps its own.
- **Unify undone.** `ShapeUpgrade_UnifySameDomain` broke a valid, closed
  cells' solid on track-straight (healing then threw "Bnd_Box is void").
  When healing fails or throws, the cells' solid before unify is kept if it
  is valid (its faces stay split where other faces' margins crossed them):
  track-straight at 0.05 mm converts that way (107 faces).
- **Trashcan-spacer** (the 82 % region): a 180 × 60 × 50 block with r 6
  fillets. The split takes its flat faces as planes and its long fillets as
  planes too (one facet strip of a 180 mm fillet is 145 mm², large against
  the cluster's 14 mm² median), and leaves six pieces of 18–32 regions: the
  vertical and short fillets, whose slicer facets are twisted (alternate
  triangles tilt by ±0.0013 rad) so that their best cylinder is 0.016–0.026
  mm off. Those leftovers drop the split (the ellipsoid's rule), so the
  whole cluster is one unfit region. At 0.03 mm every region fits (10
  planes, 16 cylinders, 4 spheres, 4 tori) and the rebuild fails on the
  volume (+5.4 %: one cell, the U channel not cut). The fixture's outcome at
  0.01 mm is unchanged; what is really there is a fillet network 0.02 mm off
  round. The other six: *makita-vacuum-holder* (97 %) and *whiteboard-tray-v5*
  (59 %): one smooth cluster over the whole part (best fits 25–33 mm off),
  freeform; *phone-stand-foldable* (48 %): one 450-region cluster of the
  flat body and its sliver triangles (0.0003 mm thin; best plane 3.2 mm off,
  the body is slightly bent) plus 28 small blends; *scrap-plate* (45 %): one
  85-region cluster spanning the plate (3.2 mm off any primitive: freeform
  or a swept profile); *kuglbahn-pillar-base* (42 %): a 625-region freeform
  side (9 mm off) and six blends; *peg-perego-button* (39 %): a 262-region
  freeform shell (6 mm off).
- **Tried and rejected** (each measured over the files): (1) the unfit
  regions' planar regions as faceted plane faces instead of no face: drill-block
  failed ("node off the solid"), others slower; (2) growing a left-out
  region's neighbours by its bounding-box diagonal: object-permanence went to
  6,845 cells (MakerVolume 15 s) and failed; by the farthest node from each
  neighbour: hot-wheels grew a 13 mm margin on a 0.07 mm² plane; (3) keeping
  a split whose leftovers cover at most a quarter of the component (as unfit
  pieces of their own): freeform walls became many small cylinders,
  object-permanence and spool-screw went over the 500-surface cap and
  drill-block failed; (4) a large seed that is thin (area under a tenth of
  its extent squared) seeding a patch instead of a plane: the spacer's long
  fillets became cylinders but its leftovers stayed, and object-permanence
  and shower-holder went from 1 % to 65–73 % unfit; (5) no sphere or torus
  on nodes that lie on two parallel circles (the slot ends of
  micro-sd-keyring-inner, which fitted a sphere r 1.385 and then a torus):
  micro-sd's volume went from 7 to 857 of 945 mm³ but still failed, and
  drill-block at 0.05 mm, which converts with such a sphere over its
  lettering walls, failed; (6) a cone fit below 1° (the spacer's fillets
  might have had a draft): the apex fit is ill-conditioned, 4–11 mm off.
- **Slice A's hand-offs.** micro-sd-keyring-inner and wyze-garage-bracket
  still fail at 0.01 mm (micro-sd: two r 0.6 arcs and a 0.15 mm flat fit as
  one r 0.853 cylinder within the tolerance, and the slot ends as a sphere;
  wyze: the nearly tangent top plane); both refusals now name 0.05 mm, where
  both convert.
- **What still fails** among the files below is the rebuild of the fitted
  part, not the left-out regions: remove-before-flight-cover is invalid after
  healing (neighbouring tangent cylinders 0.006 mm apart, `GAPS=1`), at 0.01
  as at 0.05 mm; shower-holder and hot-wheels-connector spend 30–60 s in
  MakerVolume (the budget overruns inside its steps, slice A); object-permanence
  is invalid after healing. track-straight at 0.01 mm keeps its socket void
  in the main cell (+4.5 % volume) although every face is there; at 0.05 mm
  it converts.

Prismatic, the kernel over the files (Ubuntu machine), before (head
0c0f1cf7: slice A's table and the brief; "baseline" marks the owner's
2026-10-21 runs where slice A has no figure) and after; faces
planes/cylinders/cones/spheres/tori, "left out" the unfit regions left out,
volume against the mesh's:

| file | 0.01 mm before → after | 0.05 mm before → after | 0.1 mm before → after |
|---|---|---|---|
| own/drill-block | unfit 3 (0 %) → **93 (77/12/0/0/4), 3 left out, 1.0014** (4.3 s) | 168 → 168 (137/30/0/1/0), 1.0003 (3.2 s) | rebuild → rebuild (6.2 s) |
| own/track-straight-100mm | unfit 2 (1 %) → unfit 2 (1 %), "Raise the tolerance to 0.05 mm" (2.5 s) | unfit (baseline) → **107 (89/12/3/0/3), 1 left out, 1.0002** (1.5 s) | rebuild (baseline) → rebuild, "… to 0.2 mm" (2.3 s) |
| own/remove-before-flight-cover | unfit 5 (1 %), 0.064 → same, after a failed rebuild (16 s) | unfit 4 (0 %) → same (18 s) | rebuild (baseline) → rebuild, "… to 0.2 mm" (16 s) |
| own/shower-holder | unfit 3 (1 %) → budget (66 s) | rebuild (baseline) → budget (30 s) | rebuild (baseline) → rebuild, "… to 0.5 mm" (26 s) |
| own/object-permanence-base | unfit 7 (1 %) → unfit 7 (1 %), after a failed rebuild (11 s) | unfit 3 (83 %) → same | unfit 2 (83 %) → same |
| third-party/hot-wheels-connector | unfit 2 (1 %) → unfit 2 (1 %), after a failed rebuild (30 s) | trap (baseline) → budget (30 s) | trap (baseline) → budget (51 s) |
| third-party/vented-funnel | unfit 1 (2 %) → same (2.08 %, over the allowance) | – → budget (30 s) | – → budget (30 s) |
| own/mirna-doodle-1 | unfit 11 (6 %) → same | unfit 6 (5 %) → same, "… to 0.475 mm" | unfit 2 (3 %) → same, "… to 0.191 mm" |
| own/puzzle-insert-circle | unfit 1 (6 %) → same | trap (baseline) → budget (31 s) | rebuild (baseline) → budget (30 s) |
| own/spool-screw-v4.1 | unfit 2 (6 %) → same | cap 1,098 → same | cap 1,181 → same |
| own/trashcan-spacer | unfit 1 (82 %) → same | rebuild → rebuild (3.9 s) | rebuild → rebuild (16 s) |
| third-party/micro-sd-keyring-inner | rebuild → rebuild, "… to 0.05 mm" (4.8 s) | 97 → 97 (91/6/0/0/0), 1.0006 | 84 → 84 (78/6/0/0/0), 1.0007 |
| third-party/wyze-garage-bracket | rebuild → rebuild, "… to 0.05 mm" (13 s) | 84 → 84 (55/27/2/0/0), 1.0002 (8.8 s) | 88 → 88 (58/28/2/0/0), 0.9987 (4.6 s) |

Over the 41 files (36 import as closed bodies), prismatic converts 10 at 0.01
mm (9 before: drill-block is new), 12 at 0.05 (11: track-straight) and 9 at
0.1 (9), each in one process per tolerance with no trap. The nine files that
converted at 0.01 mm give the same faces, validity and volumes. A refusal
that retries costs up to the rest of the 30 s budget (remove-before-flight
16 s, wyze 13 s) where it was refused in under a second or two before.

### Amendment, 2026-10-22: hardening slice D

The pre-count refused whenever the estimate was over `FACETED_FACE_CAP`, but
the estimate over-counts by up to about 40 % on real meshes (387 estimated
against 275 exact on `own/trashcan-repair-foot.stl`), so a mesh whose exact
count is just under 2,000 could be refused without ever building. The
pre-count now refuses only past `FACETED_FACE_CAP * FACETED_ESTIMATE_MARGIN`
(`FACETED_ESTIMATE_MARGIN` = 1.5); between the cap and 3,000 estimated faces
the build runs and the exact count decides, as before slice B. For the user:
refusals of meshes with 2,000–3,000 faces take the build's time again
(2–4 s); estimates over 3,000 are still refused at once.

### Amendment, 2026-10-23: the hybrid rebuild (slice D1)

On the owner's 41 STLs (the 2026-10-22 benchmark) prismatic converted 10,
faceted 18, either 20. The MIT tool stl2step (its `trueform` engine,
`docs/references.md`) converted 20 exactly, 11 of them closed meshes we
converted with neither method. Its trick is not better fitting: it never
rebuilds the whole solid from surfaces. It starts from the triangles,
replaces each recognised region by one analytic face bounded by that
region's own mesh boundary (shared edges, no sewing), leaves the rest as
planar facets, and turns a region back into facets when its face won't
build. The owner chose (2026-10-23) to bring that idea into prismatic as a
second stage behind the exact rebuild. We took the method from stl2step's
documentation and source (`docs/METHOD.md`, `refit.hpp`'s region and loop
contracts, `refit_build.cpp`'s per-edge tolerances and its facet fallback);
the code is our own, in the facade's style, on our segmentation.
The benchmark's per-file results, versions and failures, with mesh2cad as a
third tool, are in `docs/plans/mesh-to-solid-bench-2026-10-22.md`.

- **Two stages.** `prismaticFromMesh` segments as before, then runs the
  exact rebuild (`rebuildPrismatic`, unchanged) unless the segmentation
  already rules it out: unfit regions over `PRISMATIC_UNFIT_ALLOWED` or more
  than `PRISMATIC_SURFACE_CAP` surfaces (those refused before; now they skip
  straight to the hybrid and don't spend the 30 s budget first). When the
  exact stage is skipped or refuses (its refusal, an exception, its budget),
  `rebuildHybrid` runs on the surfaces **as fitted** (the exact stage snaps
  and merges them in place, so prismatic keeps a copy), with a fresh
  `MeshDeadline` of `HYBRID_BUDGET_MS` = 90,000. The 2 T / 5 T tolerance
  retries (exact rebuilds, their messages unchanged) run only when the hybrid
  refused too.
- **Regions, loops, charts** (`hybridRegions`, `meshLoops`, `MeshChart`).
  A hybrid region is a connected piece (over mesh edges) of one surface's
  triangles, or of the unfit ones. Its boundary is the mesh edges whose other
  triangle is in another region, each taken from corner k to k + 1 so the
  region is on its left seen from outside, chained node to node into closed
  loops; the outer loop is the one with the largest area in the surface's
  parameters, and its sign (inner loops the opposite) is checked against the
  triangles' side. A node two boundary edges leave (the region touches
  itself) explodes the region. A node where three or more regions meet is
  just a loop node here: every mesh edge is its own B-rep edge, so the chains
  between two regions (stl2step's invariant I8) aren't needed until slice D2
  collapses them. **Periodic surfaces:** a cylinder, cone, sphere or torus
  region whose triangles' centroids span more than 3/4 of a turn in u (a
  torus also in v) is split by centroid angle into halves (quarters when a
  torus is closed both ways); each piece takes its periodic parameters within
  half a turn of its own centre, so no pcurve wraps. A sphere's frame puts its
  poles as far from the region's nodes as it can (the mean normal or one of
  six directions square to it), so a cap or a dome has no pole on its loops;
  a whole sphere still converts exactly in the first stage.
- **Shared topology, no sewing.** One `TopoDS_Vertex` per mesh node and one
  `TopoDS_Edge` per mesh edge (a `Geom_Line` from the lower node to the
  higher), built lazily and keyed by the sorted node pair; the two faces of a
  mesh edge use the same edge, forward and reversed, so the shell is closed by
  construction. Interior edges of a region are never built. Each recognised
  region is one face on its own `Geom_Surface` (the `MeshSurface`'s frame),
  reversed when the surface's normal disagrees with its largest triangle's;
  each edge gets a pcurve per face, the straight segment between its nodes'
  parameters on the edge's own range (a degree-1 B-spline), set with
  `BRep_Builder::UpdateEdge(edge, pcurve, surface, loc, tol)`. **The edge's
  tolerance is the gap between that pcurve's image and the chord** (sampled
  at 11 points, × 1.1): the nodes are within the tolerance of the surface and
  the surface bulges past the chord by up to the sag, so that is the
  distance the edge really spans; its vertices are raised with it. Every edge
  has at least `HYBRID_EDGE_TOLERANCE_MIN` = 2e-3 mm, twice unify's linear
  tolerance (below). We computed the tolerance ourselves rather than calling
  `BRepLib::SameParameter`: the sampled distance is the definition
  `BRepCheck` checks.
- **Per-region fallback.** A face is checked alone (`BRepCheck_Analyzer`)
  right after it is built, before other faces add their pcurves; when it is
  invalid, threw, or needs an edge tolerance over
  `HYBRID_EDGE_TOLERANCE_MAX` = 1 mm, the region is **exploded**: its pcurves
  come off the shared edges and its triangles become facets. Facets (unfit
  and exploded triangles) are planes through their three nodes on the same
  shared edges.
- **Assembly.** One shell per connected piece of the mesh, `MakeSolid`,
  `ShapeFix_Solid` only when invalid, oriented by the volume's sign; a shell
  whose triangles enclose negative volume is a **cavity** and goes into the
  solid that holds one of its nodes as an inner shell (none holds it: the
  hybrid refuses). A review found it: one solid per shell turned a closed
  void into a second solid; desk-organizer-module-small and
  whiteboard-tray-v5 hold such shells (their volume was +2.7 % and +1.3 %
  off, as in stl2step's runs) and convert since. Faceted still makes a solid
  of every shell (left as it is: not this slice). Then
  `ShapeUpgrade_UnifySameDomain(solid, true, true, true)` at 1e-3 (coplanar
  facets merge, split periodic pieces merge back into one face with a seam).
  Unify moves a facet edge onto a recognised plane its far node may be up to
  the tolerance from, so the result can fail `BRepCheck`
  (`InvalidCurveOnSurface`); `ShapeFix_Shape` then heals it (its history
  merged into unify's). A face still invalid maps back to its regions
  (unify's history), which explode, and the build runs again; a sampled mesh
  node that no face covers (its parameters outside its region's
  straight-edged face, measured on a 16-triangle torus patch of
  phone-stand-foldable whose edges needed 0.6 mm) explodes its region the
  same way: up to three builds.
- **Checks and cap.** Validity; every n-th mesh node (up to 2,000) within the
  tolerance of the solid (the exact stage's check); the volume within
  max(1 % of the mesh's, 2 × Σ area·sag + tolerance × area) over the
  recognised regions (the exact stage's rule; the brief's version lacked the
  tolerance term, which the nodes' offset from their surfaces needs). The
  result's **facets** are its faces that only facet faces made (unify's
  history); over `HYBRID_FACET_CAP` = 4,000 the hybrid refuses: "Mesh to
  Solid could rebuild only 93 % of this mesh as exact surfaces; the rest would
  be 4,678 facets (Extrudo keeps up to 4,000). Raise the tolerance, or simplify
  the mesh in your slicer." (the share is the recognised regions' area that
  got faces). Before anything is built the facets are estimated with
  faceted's coplanar rule; past 1.5 × the cap the same message says "about"
  and comes at once (kuglbahn-pillar-base: 0.5 s). Past its budget: "Mesh to
  Solid gave up after 90 s: this mesh is too large to rebuild. Use Faceted, or
  simplify the mesh in your slicer." Any other hybrid refusal gives the rebuild
  message ("couldn't rebuild this mesh as an exact solid within …", with a
  retry's tolerance when one converted); it wins over the unfit message, since
  the unfit regions were facets there (an exception keeps the unfit one).
- **The report and the line.** `meshReport_` gains `rebuild` (0 exact, 1
  hybrid, −1 none) and `facets`; core's `MeshToSolidReport` gains `rebuild?:
  'exact' | 'hybrid'` and `facets` (0 for faceted and exact; not stored, so
  the schema and `docs/file-format.md` are untouched). A hybrid result's kinds
  count its recognised faces only, and its summary is "12 planes, 4 cylinders,
  2 tori · 3 unfit regions kept as 318 facets" ("· 48 facets" when only
  exploded regions made them). The dialog's Result line shows that once a
  hybrid draft's report is in (the region counts before), and the method hint
  says "…; what fits nothing stays as facets." So this is **not** the rejected
  silent faceted fallback: the recognised faces are real surfaces (a hole is
  a cylinder for Remove Faces), the facets are only where nothing fitted, and
  the line says how many.
- **Tried and rejected.** (1) Raising just the edges `BRepCheck` flags after
  unify to their sampled pcurve distance, instead of `ShapeFix_Shape`: the
  result stayed invalid and the extra analysis cost as much as the heal
  (phone-stand-foldable 2.4 s). (2) Exploding a region whose pcurve strays
  far (the brief's 1 mm cap alone lets a 0.6 mm torus patch through): the
  node check catches the one case measured, so the cap stays as the brief
  set it.

The eleven target files (closed meshes stl2step converts exactly and we
converted with neither method), the native harness at 0.01 mm (`run.sh
prismatic F`, one process, this machine); faces by kind
planes/cylinders/cones/spheres/tori count recognised faces, facets apart:

| file | outcome | faces | facets | exploded | volume | s |
|---|---|---|---|---|---|---|
| own/battery-holder | hybrid | 131 (61/33/37/0/0) | 0 | 0 | −0.09 % | 9.2 |
| own/object-permanence-base | hybrid | 1,985 (333/25/5/2/0) | 1,620 | 0 | −0.02 % | 13.6 |
| own/peg-perego-button | hybrid | 894 (108/94/8/10/2) | 672 | 0 | +0.41 % | 1.4 |
| own/phone-stand-foldable | hybrid | 3,642 (587/211/0/3/13) | 2,828 | 2 | +0.00 % | 18.8 |
| own/puzzle-insert-circle | refused: facet cap (93 % exact, 4,678 facets) | – | – | – | – | 3.0 |
| own/spool-screw-v4.1 | refused: facet cap (94 % exact, 4,698 facets) | – | – | – | – | 17.2 |
| own/trashcan-spacer | hybrid | 419 (2/0/0/4/4) | 409 | 0 | +0.01 % | 0.6 |
| third-party/door-stopper-top | hybrid | 147 (5/142/0/0/0) | 0 | 0 | +0.01 % | 15.0 |
| third-party/gardena-end | hybrid | 17 (5/5/2/1/4) | 0 | 0 | +0.38 % | 3.2 |
| third-party/micro-sd-keyring-inner | hybrid | 66 (28/16/0/4/0) | 18 | 34 | −0.47 % | 4.4 |
| third-party/wyze-garage-bracket | hybrid | 84 (55/27/2/0/0) | 0 | 0 | +0.01 % | 1.0 |

Nine of eleven convert, all valid and within the volume rule. The two
refused are over the facet cap by 17 %: puzzle-insert-circle's freeform cap
and spool-screw's helical thread (6 % of the surface each) stay facets.
The slowest, phone-stand-foldable (exact stage skipped: 48 % unfit), spends
0.3 s segmenting, then per build 0.7 s on faces, 2.0 s on solids, 0.7 s
unifying, 3.3 s healing and 1.9 s on the node check, twice (one torus patch
exploded). own/track-straight-100mm converts at 0.01 mm (306 faces, 237
facets, 0.8 s), own/desk-organizer-module-small converts in 33 s (418 faces,
42 facets; the exact stage's 30 s first, its cavity as an inner shell). The ten files that converted exactly still do,
with the same faces (ball 1, drill-block 93, hole-filler-35mm 6,
hole-filler-5mm 6, numbers-base-top 471, puzzle-base-circle 37,
trashcan-repair-foot 16, micro-sd-keyring-outer 41, mms-camera-mount 11,
mms-flat-stand 44).

Over all 41 files (native, one process per tolerance): **32 convert at
0.01 mm** (10 exact, 22 hybrid; before: 10) and **39 at 0.05 mm** (11 exact,
28 hybrid; before: 12). The harness doesn't check closedness: one hybrid,
sock-clips-6x, is a mesh a strict watertight test fails. Refused at 0.01 mm:
six over the facet cap (battery-power-adapter 4,107, puzzle-insert-circle,
spool-screw, kuglbahn-pillar-base about 13,926, gear-bearing-5 about 14,644,
makita-vacuum-holder about 10,511), mms-m5-nut invalid, and two open meshes
(grass-for-flower, hex-key-cap-3mm, which the importer refuses anyway). At
0.05 mm only the two open meshes are refused.

The kernel over `STL_DIR` (`mesh-to-solid-files.test.ts`, CI's WASM
`occt-aa4b1f299e0f`, this machine; the importer refuses the four open
meshes) converts **30 of the 37 at 0.01 mm** (10 exact, 20 hybrid) and **36
at 0.05 mm** (12 exact, 24 hybrid); kernel and harness order a mesh
differently, so a few outcomes differ (spool-screw 4,953 facets against
4,698; whiteboard-tray-v5 is refused by the kernel at 0.01 mm, the rebuild
message, and over the facet cap at 0.05 mm). Faces as
planes/cylinders/cones/spheres/tori (recognised faces), volume against the
mesh's:

| file | 0.01 mm | 0.05 mm |
|---|---|---|
| own/ball | exact 1 (0/0/0/1/0), 1.0018, 0.1 s | exact 1 (0/0/0/1/0), 1.0018, 0.2 s |
| own/battery-holder | hybrid 131 (61/33/37/0/0), 0 facets, 0.9991, 13.5 s | hybrid 131 (61/33/37/0/0), 0 facets, 0.9990, 14.1 s |
| own/battery-power-adapter | ✗ cap 4,109, 8.1 s | hybrid 2061 (356/162/3/0/3), 1537 facets, 0.9996, 4.6 s |
| own/desk-organizer-module-small | hybrid 418 (198/166/0/0/12), 42 facets, 0.9999, 38.8 s | hybrid 1414 (266/16/0/0/12), 1120 facets, 1.0001, 4.2 s |
| own/drill-block | exact 93 (77/12/0/0/4), 1.0014, 4.9 s | exact 168 (137/30/0/1/0), 1.0003, 3.9 s |
| own/grass-for-flower | open (importer) | open (importer) |
| own/hole-filler-35mm | exact 6 (3/2/0/0/1), 1.0013, 0.4 s | exact 6 (3/2/0/0/1), 1.0013, 18.0 s |
| own/hole-filler-5mm | exact 6 (3/2/1/0/0), 1.0003, 0.0 s | exact 6 (3/2/1/0/0), 1.0003, 0.0 s |
| own/kuglbahn-pillar-base | ✗ cap 13,915, 0.5 s | hybrid 3898 (289/231/0/5/11), 3362 facets, 1.0001, 11.1 s |
| own/mirna-doodle-1 | hybrid 168 (77/26/0/0/0), 65 facets, 1.0070, 0.3 s | hybrid 141 (65/11/0/0/0), 65 facets, 1.0017, 0.3 s |
| own/numbers-base-top | exact 471 (471/0/0/0/0), 1.0000, 1.2 s | exact 471 (471/0/0/0/0), 1.0000, 1.3 s |
| own/object-permanence-base | hybrid 1985 (333/25/5/2/0), 1620 facets, 0.9998, 15.3 s | hybrid 1892 (302/29/5/0/2), 1554 facets, 1.0000, 5.5 s |
| own/peg-perego-button | hybrid 892 (108/94/8/10/2), 670 facets, 1.0041, 2.2 s | hybrid 261 (162/45/2/2/2), 48 facets, 1.0038, 13.7 s |
| own/phone-stand-foldable | hybrid 3654 (587/211/0/3/12), 2841 facets, 1.0001, 18.7 s | hybrid 2166 (680/93/0/1/1), 1391 facets, 1.0007, 10.1 s |
| own/puzzle-base-circle | exact 37 (35/1/0/0/1), 0.9999, 0.3 s | exact 37 (35/1/0/0/1), 0.9999, 0.3 s |
| own/puzzle-insert-circle | ✗ cap 4,678, 3.0 s | hybrid 1609 (318/59/1/0/1), 1230 facets, 0.9982, 33.9 s |
| own/remove-before-flight-cover | hybrid 438 (252/62/4/0/0), 120 facets, 1.0000, 11.0 s | hybrid 318 (252/46/0/0/0), 20 facets, 1.0000, 10.3 s |
| own/scrap-plate | hybrid 326 (66/67/12/8/0), 173 facets, 1.0001, 2.7 s | hybrid 274 (46/39/16/0/0), 173 facets, 1.0003, 1.1 s |
| own/shower-holder | hybrid 901 (201/224/4/0/0), 472 facets, 0.9999, 78.3 s | hybrid 369 (190/98/2/1/4), 74 facets, 0.9996, 31.4 s |
| own/spool-nut-v4.1 | hybrid 718 (654/63/1/0/0), 0 facets, 0.9995, 16.7 s | hybrid 680 (643/36/1/0/0), 0 facets, 0.9989, 16.1 s |
| own/spool-screw-v4.1 | ✗ cap 4,953, 18.4 s | hybrid 3197 (975/95/4/0/0), 2123 facets, 1.0004, 28.5 s |
| own/track-straight-100mm | hybrid 306 (65/2/2/0/0), 237 facets, 1.0000, 1.0 s | exact 107 (89/12/3/0/3), 1.0002, 1.6 s |
| own/trashcan-repair-foot | exact 16 (12/4/0/0/0), 0.9989, 0.1 s | hybrid 106 (29/5/0/0/0), 72 facets, 0.9975, 0.4 s |
| own/trashcan-spacer | hybrid 419 (2/0/0/4/4), 409 facets, 1.0001, 1.0 s | hybrid 78 (56/14/0/4/4), 0 facets, 1.0000, 2.1 s |
| own/whiteboard-tray-v5 | ✗ rebuild, 42.1 s | ✗ cap 8,802, 20.8 s |
| third-party/chip-bag-clip-small | open (importer) | open (importer) |
| third-party/door-stopper-top | hybrid 147 (5/142/0/0/0), 0 facets, 1.0001, 20.1 s | hybrid 274 (264/10/0/0/0), 0 facets, 0.9997, 12.6 s |
| third-party/gardena-end | hybrid 17 (5/5/2/1/4), 0 facets, 1.0038, 3.9 s | hybrid 15 (3/6/2/0/4), 0 facets, 1.0029, 0.7 s |
| third-party/gear-bearing-5 | ✗ cap 14,648, 1.6 s | hybrid 3896 (513/927/0/34/0), 2422 facets, 1.0050, 10.5 s |
| third-party/hex-key-cap-3mm | open (importer) | open (importer) |
| third-party/hot-wheels-connector | hybrid 2015 (173/9/0/0/0), 1833 facets, 1.0000, 22.2 s | hybrid 682 (228/15/0/0/0), 439 facets, 0.9995, 33.2 s |
| third-party/makita-vacuum-holder | ✗ cap 10,512, 0.4 s | hybrid 3480 (557/237/8/12/4), 2662 facets, 0.9999, 8.6 s |
| third-party/micro-sd-keyring-inner | hybrid 66 (28/16/0/4/0), 18 facets, 0.9953, 5.4 s | exact 97 (91/6/0/0/0), 1.0006, 0.8 s |
| third-party/micro-sd-keyring-outer | exact 41 (23/18/0/0/0), 1.0000, 0.5 s | exact 59 (59/0/0/0/0), 1.0000, 0.3 s |
| third-party/mms-camera-mount | exact 11 (9/1/1/0/0), 1.0000, 0.1 s | exact 11 (9/1/1/0/0), 1.0000, 0.1 s |
| third-party/mms-flat-stand | exact 44 (37/6/1/0/0), 1.0000, 0.4 s | exact 44 (37/6/1/0/0), 1.0000, 0.4 s |
| third-party/mms-m5-nut | open (importer) | open (importer) |
| third-party/sock-clips-6x | hybrid 161 (34/31/0/0/6), 90 facets, 1.0035, 34.9 s | hybrid 85 (46/39/0/0/0), 0 facets, 1.0007, 6.0 s |
| third-party/spaghetti-measure | hybrid 165 (48/61/0/1/0), 55 facets, 1.0000, 25.8 s | hybrid 95 (66/29/0/0/0), 0 facets, 1.0003, 24.1 s |
| third-party/vented-funnel | hybrid 1910 (522/187/10/13/5), 1173 facets, 0.9994, 9.9 s | hybrid 439 (354/69/10/0/6), 0 facets, 0.9979, 35.7 s |
| third-party/wyze-garage-bracket | hybrid 84 (55/27/2/0/0), 0 facets, 1.0001, 1.3 s | exact 84 (55/27/2/0/0), 1.0002, 9.9 s |

**Open for D2 and later.** Polyline edges collapsed to lines and arcs where
they provably are one (stl2step's tier-1 chains; today a hole's rim is its
mesh polygon of line edges on an exact cylinder); fillet-strip detection
(stl2step's law-based strips) so a fillet network fits instead of staying
facets; the facet cap (5,000 would convert puzzle-insert-circle,
spool-screw-v4.1 and battery-power-adapter at 0.01 mm in 3–18 s); skipping
the exact stage when the hybrid would do (it costs up to 30 s, more when
MakerVolume overruns).

### Amendment, 2026-10-23: Auto tolerance, the facet cap, cavities in Faceted (slice D2)

Slice D1's sweep over the owner's 41 STLs (below, and its own tables) showed
the fixed default tolerance of 0.01 mm was the wrong knob. At 0.01 mm many
parts keep hundreds of facets that fit fine at 0.05 mm (trashcan-spacer 409 →
0 facets, peg-perego-button 670 → 48, phone-stand-foldable 2,841 → 1,391,
puzzle-insert-circle refused → converts), while 0.05 mm makes others worse
(trashcan-repair-foot exact 16 faces → hybrid with 72 facets; drill-block
loses its tori). The tool stl2step derives its tolerance from the mesh
instead of fixing it. Three things change here, the owner's decisions of
2026-10-23.

- **Auto is the default tolerance, picked by the kernel.** A tolerance of 0
  or less passed to `meshToSolid(method, tolerance)` or
  `meshRegions(tolerance)` means Auto; faceted ignores it as before.
  `meshAutoTolerance` (private) runs `segmentMesh` at each step of the ladder
  `MESH_AUTO_LADDER` = 0.01, 0.02, 0.05 and 0.1 mm, in that order, and stops
  at the first whose `unfitFraction` is at most `PRISMATIC_UNFIT_ALLOWED`
  (2 %, the share the exact rebuild tolerates); that step is the tolerance
  and its `MeshSegmentation` is **reused** (the caller does not segment
  again). When no step qualifies it takes the step with the smallest share
  (ties: the smaller tolerance). Each extra step costs a segmentation (about
  0.3 s on a 20,000-triangle mesh); under `TIMES=1` the harness prints each
  as `auto 0.02: unfit 3.1 % <ms>`. `prismaticFromMesh` runs the exact stage
  first at the chosen tolerance exactly as before; the 2 T / 5 T retries are
  skipped when the tolerance was Auto (the ladder already went up), and the
  refusals' "Raise the tolerance to X mm" clause becomes "Use Faceted, or
  simplify the mesh in your slicer." A fixed `tolerance` behaves as before.
- **The report names the tolerance.** `meshReport_` gains a 13th double: the
  tolerance used in mm (always for prismatic, Auto or not; −1 for faceted).
  `meshRegions` writes it too. Core's `MeshToSolidReport` gains
  `tolerance?: number` and `auto?: boolean`; the kernel sets `auto` from
  `tolerance <= 0` (the recipe passes −1 when the input is absent), so
  `meshSurfaceSummary` and `meshToSolidSummary` append " · auto 0.02 mm"
  (`formatTolerance`, no trailing zeros) and the feature's chip tooltip shows
  it too. `Kernel.meshToSolid` / `Kernel.meshRegions` document tolerance ≤ 0
  as Auto.
- **The facet cap is 5,000.** `HYBRID_FACET_CAP` = 5,000; the message's
  "Extrudo keeps up to 5,000" comes from the constant through `thousands()`.
  This converts puzzle-insert-circle (4,678 facets at 0.01 mm), spool-screw
  (4,953) and battery-power-adapter (4,107) that were refused by 17 %.
- **Cavities in Faceted, one rule for both.** The hybrid's cavity code is
  factored into `solidsWithCavities(shells, insidePoints, meshVolume, …)`:
  a shell whose solid volume is below −1e-6 × max(1, |mesh volume|) is a
  **cavity** — an inner shell of the solid that contains one of its nodes
  (`BRepClass3d_SolidClassifier`, `BRepBuilderAPI_MakeSolid::Add`), never a
  solid of its own; a cavity no solid holds refuses (the hybrid's "a cavity
  in no solid"; faceted's "a hollow lies in no solid."). `facetedFromMesh`
  calls it now, so a hollow part (desk-organizer-module-small, whiteboard-
  tray-v5) comes out as one solid with a hollow instead of two solids;
  `rebuildHybrid`'s behaviour is unchanged.
- **The document and the dialog.** `tolerance` stays an optional `expr`
  input; **absent means Auto** (today absent meant 0.01).
  `MESH_TO_SOLID_DEFAULT_TOLERANCE` is gone; `MeshToSolidSettings` gains
  `tolerance: number | 'auto'` (the expression's value, or `'auto'`; the
  caller passes the evaluated value in). The schema itself is unchanged (no
  new key). The dialog adds a `toleranceMode` **choice** (label "Tolerance",
  Auto default, Custom) shown for prismatic, and the old expression field
  becomes "Custom tolerance" (default 0.01 mm), shown only when prismatic
  **and** Custom. `toleranceMode` is dialog-only: the spec maps the inputs
  itself (`toInputs`/`fromInputs`), so Auto writes no `tolerance` input and
  editing a feature whose `tolerance` is present opens with Custom selected.
  The region request (`dialog.ts`) passes −1 for Auto. The Import dialog's
  "As solid" adds `meshToSolid` with Prismatic and no tolerance: Auto now.

#### The real files (slice D2)

The sweeps below are the kernel's (`mesh-to-solid-files.test.ts`) over the owner's 41 STLs in `~/Development/extrudo-stl-solid-test/` at `TOL=auto` and `TOL=0.01`, one process, CI's WASM `occt-43138ec84a10` on the Ubuntu machine. The importer refuses the four open meshes (grass-for-flower, chip-bag-clip-small, hex-key-cap-3mm, mms-m5-nut), so each table has the 37 it accepts. Faces by kind planes/cylinders/cones/spheres/tori count **recognised faces**; facets are apart. Auto picks the ladder step named; the same file's 0.01 outcome follows.

**Prismatic over the 37 accepted files at Auto** (kernel, CI WASM `occt-43138ec84a10`, this machine; faces by kind planes/cylinders/cones/spheres/tori count recognised faces, facets apart; volume against the mesh's): 36 of 37 convert.

| file | tolerance | outcome | faces (pl/cy/co/sp/to) | facets | volume | s |
|---|---|---|---|---|---|---|
| own/ball | 0.01 mm | exact | 1 | 0/0/0/1/0 | 0 | 1.0018 | 0.0 |
| own/battery-holder | 0.01 mm | hybrid | 131 | 61/33/37/0/0 | 0 | 0.9991 | 11.0 |
| own/battery-power-adapter | 0.1 mm | hybrid | 994 | 505/70/3/0/1 | 415 | 1.0012 | 3.3 |
| own/desk-organizer-module-small | 0.01 mm | hybrid | 418 | 198/166/0/0/12 | 42 | 0.9999 | 35.6 |
| own/drill-block | 0.01 mm | exact (3 unfit left out) | 93 | 77/12/0/0/4 | 0 | 1.0014 | 4.2 |
| own/hole-filler-35mm | 0.01 mm | exact | 6 | 3/2/0/0/1 | 0 | 1.0013 | 0.4 |
| own/hole-filler-5mm | 0.01 mm | exact | 6 | 3/2/1/0/0 | 0 | 1.0003 | 0.0 |
| own/kuglbahn-pillar-base | 0.1 mm | hybrid | 3941 | 430/86/0/6/10 | 3409 | 1.0012 | 10.7 |
| own/mirna-doodle-1 | 0.1 mm | hybrid | 120 | 63/14/0/0/0 | 43 | 0.9928 | 0.3 |
| own/numbers-base-top | 0.01 mm | exact | 471 | 471/0/0/0/0 | 0 | 1.0000 | 1.1 |
| own/object-permanence-base | 0.01 mm | hybrid | 1985 | 333/25/5/2/0 | 1620 | 0.9998 | 13.9 |
| own/peg-perego-button | 0.02 mm | hybrid | 212 | 99/103/2/5/3 | 0 | 1.0036 | 25.5 |
| own/phone-stand-foldable | 0.1 mm | hybrid | 2325 | 458/10/0/0/10 | 1847 | 1.0010 | 37.5 |
| own/puzzle-base-circle | 0.01 mm | exact | 37 | 35/1/0/0/1 | 0 | 0.9999 | 0.3 |
| own/puzzle-insert-circle | 0.05 mm | hybrid | 1609 | 318/59/1/0/1 | 1230 | 0.9982 | 36.2 |
| own/remove-before-flight-cover | 0.01 mm | hybrid | 438 | 252/62/4/0/0 | 120 | 1.0000 | 10.2 |
| own/scrap-plate | 0.02 mm | hybrid | 154 | 61/77/16/0/0 | 0 | 0.9988 | 17.9 |
| own/shower-holder | 0.01 mm | hybrid | 901 | 201/224/4/0/0 | 472 | 0.9999 | 70.0 |
| own/spool-nut-v4.1 | 0.01 mm | hybrid | 718 | 654/63/1/0/0 | 0 | 0.9995 | 14.5 |
| own/spool-screw-v4.1 | 0.05 mm | hybrid | 3197 | 975/95/4/0/0 | 2123 | 1.0004 | 26.6 |
| own/track-straight-100mm | 0.01 mm | hybrid | 306 | 65/2/2/0/0 | 237 | 1.0000 | 0.9 |
| own/trashcan-repair-foot | 0.01 mm | exact | 16 | 12/4/0/0/0 | 0 | 0.9989 | 0.1 |
| own/trashcan-spacer | 0.05 mm | hybrid | 78 | 56/14/0/4/4 | 0 | 1.0000 | 2.0 |
| own/whiteboard-tray-v5 | 0.02 mm | ✗ rebuild | – | – | – | – | – |
| third-party/door-stopper-top | 0.01 mm | hybrid | 147 | 5/142/0/0/0 | 0 | 1.0001 | 17.7 |
| third-party/gardena-end | 0.01 mm | hybrid | 17 | 5/5/2/1/4 | 0 | 1.0038 | 3.5 |
| third-party/gear-bearing-5 | 0.1 mm | hybrid | 2308 | 291/581/0/10/8 | 1418 | 1.0084 | 11.3 |
| third-party/hot-wheels-connector | 0.01 mm | hybrid | 2015 | 173/9/0/0/0 | 1833 | 1.0000 | 18.4 |
| third-party/makita-vacuum-holder | 0.05 mm | hybrid | 3480 | 557/237/8/12/4 | 2662 | 0.9999 | 8.8 |
| third-party/micro-sd-keyring-inner | 0.01 mm | hybrid | 66 | 28/16/0/4/0 | 18 | 0.9953 | 4.8 |
| third-party/micro-sd-keyring-outer | 0.01 mm | exact | 41 | 23/18/0/0/0 | 0 | 1.0000 | 0.4 |
| third-party/mms-camera-mount | 0.01 mm | exact | 11 | 9/1/1/0/0 | 0 | 1.0000 | 0.0 |
| third-party/mms-flat-stand | 0.01 mm | exact | 44 | 37/6/1/0/0 | 0 | 1.0000 | 0.3 |
| third-party/sock-clips-6x | 0.01 mm | hybrid | 161 | 34/31/0/0/6 | 90 | 1.0035 | 34.7 |
| third-party/spaghetti-measure | 0.01 mm | hybrid | 165 | 48/61/0/1/0 | 55 | 1.0000 | 24.5 |
| third-party/vented-funnel | 0.02 mm | hybrid | 715 | 452/150/10/11/6 | 86 | 0.9999 | 7.0 |
| third-party/wyze-garage-bracket | 0.01 mm | hybrid | 84 | 55/27/2/0/0 | 0 | 1.0001 | 1.1 |

**Prismatic over the 37 accepted files at a fixed 0.01 mm** (kernel, CI WASM `occt-43138ec84a10`, this machine; faces by kind planes/cylinders/cones/spheres/tori count recognised faces, facets apart; volume against the mesh's): 33 of 37 convert.

| file | tolerance | outcome | faces (pl/cy/co/sp/to) | facets | volume | s |
|---|---|---|---|---|---|---|
| own/ball | 0.01 | exact | 1 | 0/0/0/1/0 | 0 | 1.0018 | 0.0 |
| own/battery-holder | 0.01 | hybrid | 131 | 61/33/37/0/0 | 0 | 0.9991 | 12.0 |
| own/battery-power-adapter | 0.01 | hybrid | 4506 | 253/136/3/5/0 | 4109 | 1.0005 | 10.1 |
| own/desk-organizer-module-small | 0.01 | hybrid | 418 | 198/166/0/0/12 | 42 | 0.9999 | 40.1 |
| own/drill-block | 0.01 | exact (3 unfit left out) | 93 | 77/12/0/0/4 | 0 | 1.0014 | 4.9 |
| own/hole-filler-35mm | 0.01 | exact | 6 | 3/2/0/0/1 | 0 | 1.0013 | 0.4 |
| own/hole-filler-5mm | 0.01 | exact | 6 | 3/2/1/0/0 | 0 | 1.0003 | 0.0 |
| own/kuglbahn-pillar-base | 0.01 | ✗ cap | – | – | – | – | – |
| own/mirna-doodle-1 | 0.01 | hybrid | 168 | 77/26/0/0/0 | 65 | 1.0070 | 0.3 |
| own/numbers-base-top | 0.01 | exact | 471 | 471/0/0/0/0 | 0 | 1.0000 | 1.2 |
| own/object-permanence-base | 0.01 | hybrid | 1985 | 333/25/5/2/0 | 1620 | 0.9998 | 15.6 |
| own/peg-perego-button | 0.01 | hybrid | 892 | 108/94/8/10/2 | 670 | 1.0041 | 2.3 |
| own/phone-stand-foldable | 0.01 | hybrid | 3654 | 587/211/0/3/12 | 2841 | 1.0001 | 19.0 |
| own/puzzle-base-circle | 0.01 | exact | 37 | 35/1/0/0/1 | 0 | 0.9999 | 0.3 |
| own/puzzle-insert-circle | 0.01 | hybrid | 4722 | 11/15/1/0/17 | 4678 | 1.0002 | 5.5 |
| own/remove-before-flight-cover | 0.01 | hybrid | 438 | 252/62/4/0/0 | 120 | 1.0000 | 11.0 |
| own/scrap-plate | 0.01 | hybrid | 326 | 66/67/12/8/0 | 173 | 1.0001 | 2.7 |
| own/shower-holder | 0.01 | hybrid | 901 | 201/224/4/0/0 | 472 | 0.9999 | 76.0 |
| own/spool-nut-v4.1 | 0.01 | hybrid | 718 | 654/63/1/0/0 | 0 | 0.9995 | 16.3 |
| own/spool-screw-v4.1 | 0.01 | hybrid | 5909 | 778/174/4/0/0 | 4953 | 0.9996 | 25.5 |
| own/track-straight-100mm | 0.01 | hybrid | 306 | 65/2/2/0/0 | 237 | 1.0000 | 1.0 |
| own/trashcan-repair-foot | 0.01 | exact | 16 | 12/4/0/0/0 | 0 | 0.9989 | 0.1 |
| own/trashcan-spacer | 0.01 | hybrid | 419 | 2/0/0/4/4 | 409 | 1.0001 | 1.0 |
| own/whiteboard-tray-v5 | 0.01 | ✗ rebuild | – | – | – | – | – |
| third-party/door-stopper-top | 0.01 | hybrid | 147 | 5/142/0/0/0 | 0 | 1.0001 | 19.4 |
| third-party/gardena-end | 0.01 | hybrid | 17 | 5/5/2/1/4 | 0 | 1.0038 | 3.8 |
| third-party/gear-bearing-5 | 0.01 | ✗ cap | – | – | – | – | – |
| third-party/hot-wheels-connector | 0.01 | hybrid | 2015 | 173/9/0/0/0 | 1833 | 1.0000 | 19.8 |
| third-party/makita-vacuum-holder | 0.01 | ✗ cap | – | – | – | – | – |
| third-party/micro-sd-keyring-inner | 0.01 | hybrid | 66 | 28/16/0/4/0 | 18 | 0.9953 | 5.0 |
| third-party/micro-sd-keyring-outer | 0.01 | exact | 41 | 23/18/0/0/0 | 0 | 1.0000 | 0.4 |
| third-party/mms-camera-mount | 0.01 | exact | 11 | 9/1/1/0/0 | 0 | 1.0000 | 0.0 |
| third-party/mms-flat-stand | 0.01 | exact | 44 | 37/6/1/0/0 | 0 | 1.0000 | 0.3 |
| third-party/sock-clips-6x | 0.01 | hybrid | 161 | 34/31/0/0/6 | 90 | 1.0035 | 34.5 |
| third-party/spaghetti-measure | 0.01 | hybrid | 165 | 48/61/0/1/0 | 55 | 1.0000 | 24.6 |
| third-party/vented-funnel | 0.01 | hybrid | 1910 | 522/187/10/13/5 | 1173 | 0.9994 | 10.5 |
| third-party/wyze-garage-bracket | 0.01 | hybrid | 84 | 55/27/2/0/0 | 0 | 1.0001 | 1.3 |

**Acceptance, slice D2.** Auto converts **36 of the 37** the importer accepts
(one refusal, whiteboard-tray-v5: at its Auto pick of 0.02 mm the exact rebuild
still refuses in 33 s and the hybrid has nothing to add). Every file that
converted exactly at 0.01 mm in D1's table still converts exactly, with the
same faces: ball (1 sphere), drill-block (93), hole-filler-35mm (6),
hole-filler-5mm (6), numbers-base-top (471), puzzle-base-circle (37),
trashcan-repair-foot (16), micro-sd-keyring-outer (41), mms-camera-mount (11),
mms-flat-stand (44). The ladder adds under 2 s to the slowest file (shower-holder,
the slowest at 70 s, picks 0.01 at the first step: no extra segmentation;
whiteboard-tray-v5 at 0.02 is 33 s against 41 s at 0.01). **The facet cap at
5,000 converts puzzle-insert-circle (4,678 facets, 5.5 s) and spool-screw-v4.1
(4,953, 25.5 s), and battery-power-adapter (4,109, 10.1 s), at 0.01 mm**;
kuglbahn-pillar-base (about 13,915), gear-bearing-5 (14,648) and
makita-vacuum-holder (10,512) stay over it and convert under Auto at 0.1, 0.05,
respectively. The cavity rule is proven by the kernel test (a box with a closed
cubic cavity converts to one solid of 7,000 mm³ in Faceted and Prismatic) and by
Prismatic on desk-organizer-module-small (418 faces, volume 0.9999). **Faceted
does not convert desk-organizer-module-small**: its coplanar-facet result is
about 15,635 faces, over `FACETED_FACE_CAP` (2,000), so the conversion is
refused before the cavity rule can apply; the same holds for
whiteboard-tray-v5 (about 7,944). Faceted's cap was not raised in this slice.

### Amendment, 2026-10-23: boundary chains collapsed (slice D3)

Slice D1's hybrid faces are exact surfaces, but their edges were the mesh's
polylines: the rim of a 32-gon hole on a true cylinder was 32 line edges with
sag-sized tolerances, not a circle. Remove Faces (#78) and Simplify for print
(#79) look for a hole as a cylinder bounded by circles, a fillet on such a
chain refused or made 32 small faces, STEP carried thousands of fat edges, and
`UnifySameDomain` merges collinear line edges but never chords into an arc.
stl2step (`docs/references.md`) calls the fix tier 1: a chain between two
analytic regions becomes one analytic edge when the two surfaces meet in a
line, circle or ellipse every chain node lies on; anything else stays the
mesh polyline (its tier 2). We took the method from its `refit.hpp`
(`BoundaryChain`, invariant I8) and `refit_build.cpp` (its IntAna candidates
and residuals); the code is our own.

- **Chains** (`MeshChain`, `meshChains`). After `hybridRegions`, once per
  rebuild: a chain is a maximal run of boundary mesh edges with the same two
  hybrid regions on its sides, in the left region's loop order, ending at
  every **break node**: a node with three or more regions around it (an
  unfit or exploded region counts as one region: its triangles are one facet
  island) or with other than two boundary edges (stl2step's I8: where a
  chain of another pair touches). A loop with no break node is one **closed
  chain** (first node not repeated). An exploded region keeps its chains;
  they only stop being candidates.
- **Candidates.** Only a chain between two built recognised regions (kinds
  0–4, not exploded) and not undone. Facet islands keep every mesh edge;
  two pieces of one periodic surface (D1's split) keep their seam (unify
  merges the pieces back across it, as before); a chain touching a **sphere
  in pieces** (its surface split into several regions) stays a polyline too:
  each piece has its own frame (D1's poles away from its own nodes), and
  unify merges such pieces only across straight edges (micro-sd-keyring-inner
  came out with 80 sphere faces instead of 4).
- **The candidate curve** comes from the two surfaces (`surfaceCurves`,
  cached per surface pair), never from the nodes, through
  `IntAna_QuadQuadGeo` (angular tolerance 1°, distance tolerance the
  tolerance in use):

  | pair | curve | collapses |
  |---|---|---|
  | plane\|plane | line | unless parallel |
  | plane\|cylinder | circle (square to the axis; IntAna's circle-or-ellipse rule at the tolerance), ellipse (oblique), one or two lines (parallel to the axis, tangent: one) | yes |
  | plane\|cone | circle, ellipse, lines through the apex | parabola, hyperbola: no |
  | plane\|sphere | circle | yes |
  | plane\|torus | circles: plane square to the axis or through it | else no |
  | cylinder\|cylinder | coaxial (axes within 1°, each origin within the tolerance of the other's axis): the circle square to the axis through the chain nodes' mean height, radius the radii's mean; else IntAna's lines (parallel axes) or ellipses (equal radii, crossing axes) | IntAna has no curve (unequal radii, crossing axes): no |
  | cylinder\|cone, cylinder\|sphere, cone\|cone, cone\|sphere, sphere\|sphere, any\|torus | coaxial (a sphere: its centre within the tolerance of the other's axis): the second surface moved onto the first's axis, then IntAna's circles | off axis: no |

  IntAna's `Empty`, `Same`, `NoGeometricSolution`, a point, a parabola or
  hyperbola, or more than two curves: no collapse. Of two curves, the one
  nearer the chain's nodes (sum of distances).
- **The acceptance test** (`chainCurve`): every chain node within 1.5 × the
  tolerance in use of the curve (lines and circles by `gp_Lin`/`gp_Circ`
  distance and `ElCLib::Parameter`, an ellipse by `Extrema_ExtPElC`), the
  nodes' parameters strictly **monotone** in chain order (the curve is turned
  round when they all fall), and a circle's or ellipse's span under a turn
  (a closed chain: exactly one). Then slice D1's own limit, per mesh edge
  the collapse replaces: where a chord's straight pcurve image strays more
  than `HYBRID_EDGE_TOLERANCE_MAX` from it on either face, the surface
  bulges past the mesh between the nodes (a curved fit over a few flat
  triangles), the chain stays a polyline and that region still explodes (a
  4-triangle cylinder of mirna-doodle-1 built as a 1.9 mm bulge, volume
  +3.7 %, without it).
- **The collapsed edge.** One `TopoDS_Edge` on a `Geom_Line`,
  `Geom_Circle` or `Geom_Ellipse` between the chain's two end vertices (the
  shared D1 vertices; they never move), trimmed to the end nodes'
  parameters; a closed chain's edge has the start node's vertex at both ends
  and a full period. Its tolerance is 1.1 × the largest of the nodes'
  distances to the curve and both pcurves' sampled distance from it (11
  points), at least `HYBRID_EDGE_TOLERANCE_MIN`, at most
  `HYBRID_EDGE_TOLERANCE_MAX` (else no collapse); its vertices are raised to
  it. The inner nodes get no vertex and no edge. Both faces use the same
  edge, forward on the left region's wire, reversed on the right's.
- **Pcurves**, one per face, on the edge's own parameter range, from the
  chart parameters of the chain's **end nodes** (D1's `MeshChart::uv`, with
  its periodic centring) to the other's: where the face's other edges'
  pcurves end too. Where the curve is straight in the chart (a line on a
  plane, a circle square to a cylinder's, cone's or torus's axis, a torus's
  meridian, a generator) a straight pcurve between those two (degree-1
  B-spline), when its image stays within 1.5 × the tolerance of the curve at
  11 points; else an interpolating B-spline through the curve's chart
  parameters at samples (every π/16, at least 8), continuous across the
  chart's periods, the ends' offsets to the nodes' parameters blended along
  it, accepted when its image stays within 1.5 × the tolerance; else no
  collapse ("pcurve failed"). `BRep_Builder::UpdateEdge(edge, pcurve,
  surface, loc, tol)` as in D1. **Tried and rejected:** pcurves through the
  curve's own end points (`Geom2d_Line` on iso curves, `GeomProjLib::Curve2d`
  else, as the brief had it). They end up to 1.5 × the tolerance from the
  node's parameters, where the neighbouring edges' pcurves end, so each
  face's parameter domain is open by that much: `BRepCheck` accepts it (the
  vertex tolerance covers it), but `BRepGProp`'s area and volume integrals
  over the face then depend on where the chart's origin lies.
  phone-stand-foldable at 0.1 mm came out +1.8 % in volume (12,188 mm³
  against 12,005 without collapses) while a boolean of the two results
  differed by under 5 mm³, and four times as many collapses were undone.
  `BRepLib::SameParameter` is not called (the brief asked for it): OCCT
  8.0.1's `SameParameter(edge, tolerance)` skips an edge already flagged
  same-parameter, as `BRep_Builder` makes them, and the sampled tolerance
  above is slice D1's own rule for what `BRepCheck` checks.
- **Wires from chains.** `makeFace` walks each loop from a break node; at a
  mesh edge of a collapsed chain it adds the chain's edge once and skips
  the chain's mesh edges. Loop order, the outer and inner loops and the
  face's orientation stay as D1 computes them from the node lists.
- **Fallback.** A face that won't build or check is built again with all
  its collapsed chains as polylines (the regions across them, built
  already, are stripped and built again too: they share those edges) before
  its region explodes ("undone"). After unify, a face that fails the
  validity check, or a region a mesh node misses, first has its regions'
  collapsed chains undone in a build of their own (up to two such builds,
  besides D1's three); only a region without collapsed chains explodes as in
  D1. The node check skips a collapsed chain's nodes: the acceptance test
  measured them against the edge's curve (within 1.5 × the tolerance; the
  check's own reach is 1.01 ×), and the B-rep fallback distance it would
  otherwise take for every node beside an arc cost seconds (peg-perego-button
  0.5 → 2.4 s, vented-funnel 0.9 → 7.0 s, before this rule).
- **Counts.** `TIMES=1` adds `hybrid chain curves <ms>` and the line
  `hybrid chains: 412 collapsed (380 lines, 30 circles, 2 ellipses), 96
  polylines`; the harness prints the chains and why the rest stayed
  polylines ("not a candidate", "no curve: …", "a node off", "not
  monotone", "spans a turn", "a chord off its surface", "a sphere in
  pieces", "pcurve failed", "edge tolerance", "undone") and the result's
  edges by curve type; `FACES=1` one line per chain, collapsed ("chain 17
  cylinder|plane: circle, regions 6|154, 11 mesh edges, tolerance 0.002") or
  not ("chain 33 sphere|plane: node 0 off by 0.01893"). The report gains
  nothing the user sees. `meshLoopsDebug` appends the chains (count, then per
  chain its regions, closed, mesh edges and curve type).

#### The real files (slice D3)

The kernel over `STL_DIR` (`mesh-to-solid-files.test.ts`, which now prints
the result's edges and circle edges) on the owner's 41 STLs, before (slice
D2's WASM `occt-43138ec84a10`) and after (this slice's `occt-01014631ceb4`),
one process each, on the Ubuntu machine while other jobs shared it (the
times are noisy; the "before" runs had more company than D2's own tables).
The importer refuses the four open meshes. Faces by kind count recognised
faces, facets apart; edges and circles are the result's
(`BRepAdaptor_Curve` types). Chains, their collapses and the most common
reason a chain stayed a polyline come from the native harness (`run.sh
prismatic F`, same tolerance), which orders a mesh as `RWStl` does, not as
manifold's `getMesh()`: its counts are that build's, close to the kernel's.

**At Auto:**

| file | tolerance | outcome | faces (pl/cy/co/sp/to) | facets | edges before → after | circles | chains | collapsed (lines/circles/ellipses) | polylines | most common reason kept | volume | s (before → after) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| own/ball | 0.01 | exact | 1 (0/0/0/1/0) | 0 | 3 → 3 | 1 | – | – | – | – | 1.0018 | 0.2 → 0.1 |
| own/battery-holder | 0.01 | hybrid | 131 (61/33/37/0/0) | 0 | 6,181 → 470 | 116 | 441 | 293 (64/229/0) | 148 | no curve: same surface (116) | 0.9986 | 29.8 → 2.5 |
| own/battery-power-adapter | 0.1 | hybrid | 994 (505/70/3/0/1) | 415 | 5,227 → 3,930 | 37 | 1571 | 612 (468/50/94) | 959 | a node off (633) | 1.0004 | 6.7 → 2.6 |
| own/desk-organizer-module-small | 0.01 | hybrid | 418 (198/166/0/0/12) | 42 | 7,197 → 6,929 | 12 | 996 | 118 (93/12/13) | 878 | no curve: no geometric solution (439) | 0.9999 | 48.4 → 35.1 |
| own/drill-block | 0.01 | exact | 93 (77/12/0/0/4) | 0 | 638 → 638 | 211 | – | – | – | – | 1.0014 | 8.4 → 4.2 |
| own/hole-filler-35mm | 0.01 | exact | 6 (3/2/0/0/1) | 0 | 9 → 9 | 4 | – | – | – | – | 1.0013 | 0.4 → 0.4 |
| own/hole-filler-5mm | 0.01 | exact | 6 (3/2/1/0/0) | 0 | 9 → 9 | 6 | – | – | – | – | 1.0003 | 0.1 → 0.0 |
| own/kuglbahn-pillar-base | 0.1 | hybrid | 3941 (430/86/0/6/10) | 3409 | 11,067 → 10,278 | 43 | 1476 | 306 (235/44/27) | 1170 | a node off (501) | 1.0013 | 11.8 → 9.2 |
| own/mirna-doodle-1 | 0.1 | hybrid | 120 (63/14/0/0/0) | 43 | 486 → 330 | 28 | 225 | 189 (161/28/0) | 36 | no curve: no geometric solution (15) | 0.9891 | 0.3 → 0.2 |
| own/numbers-base-top | 0.01 | exact | 471 (471/0/0/0/0) | 0 | 1,292 → 1,292 | 0 | – | – | – | – | 1.0000 | 1.3 → 1.0 |
| own/object-permanence-base | 0.01 | hybrid | 1985 (333/25/5/2/0) | 1620 | 4,365 → 4,239 | 56 | 876 | 342 (253/56/33) | 534 | a node off (304) | 0.9997 | 15.7 → 13.4 |
| own/peg-perego-button | 0.02 | hybrid | 212 (99/103/2/5/3) | 0 | 2,189 → 1,488 | 21 | 578 | 157 (83/28/46) | 421 | a node off (171) | 1.0032 | 28.5 → 24.5 |
| own/phone-stand-foldable | 0.1 | hybrid | 2325 (458/10/0/0/10) | 1847 | 7,663 → 6,860 | 8 | 1352 | 736 (699/12/25) | 616 | a node off (286) | 1.0012 | 37.8 → 36.2 |
| own/puzzle-base-circle | 0.01 | exact | 37 (35/1/0/0/1) | 0 | 129 → 129 | 4 | – | – | – | – | 0.9999 | 0.3 → 0.3 |
| own/puzzle-insert-circle | 0.05 | hybrid | 1609 (318/59/1/0/1) | 1230 | 6,177 → 5,607 | 3 | 1093 | 175 (157/6/12) | 918 | a node off (748) | 0.9984 | 33.5 → 34.4 |
| own/remove-before-flight-cover | 0.01 | hybrid | 438 (252/62/4/0/0) | 120 | 2,722 → 1,083 | 126 | 880 | 747 (603/142/2) | 133 | a node off (43) | 1.0000 | 11.5 → 7.3 |
| own/scrap-plate | 0.02 | hybrid | 154 (61/77/16/0/0) | 0 | 1,367 → 1,179 | 10 | 366 | 96 (80/12/4) | 270 | no curve: no geometric solution (140) | 0.9987 | 19.8 → 17.6 |
| own/shower-holder | 0.01 | hybrid | 901 (201/224/4/0/0) | 472 | 3,361 → 3,357 | 0 | 1043 | 80 (58/0/22) | 963 | a node off (433) | 0.9999 | 79.5 → 69.4 |
| own/spool-nut-v4.1 | 0.01 | hybrid | 718 (654/63/1/0/0) | 0 | 4,209 → 3,415 | 5 | 2159 | 1324 (1280/6/38) | 835 | no curve: hyperbola (642) | 0.9991 | 15.1 → 6.2 |
| own/spool-screw-v4.1 | 0.05 | hybrid | 3197 (975/95/4/0/0) | 2123 | 13,094 → 11,003 | 33 | 3174 | 1655 (1400/46/209) | 1519 | no curve: hyperbola (642) | 1.0007 | 27.6 → 20.2 |
| own/track-straight-100mm | 0.01 | hybrid | 306 (65/2/2/0/0) | 237 | 847 → 627 | 4 | 169 | 147 (139/8/0) | 22 | not a candidate (14) | 1.0000 | 0.9 → 0.6 |
| own/trashcan-repair-foot | 0.01 | exact | 16 (12/4/0/0/0) | 0 | 72 → 72 | 20 | – | – | – | – | 0.9989 | 0.1 → 0.1 |
| own/trashcan-spacer | 0.05 | hybrid | 78 (56/14/0/4/4) | 0 | 443 → 359 | 12 | 180 | 60 (48/12/0) | 120 | a node off (68) | 1.0001 | 2.2 → 1.9 |
| own/whiteboard-tray-v5 | auto | ✗ rebuild | – | – | – | – | – | – | – | – | – | – |
| third-party/door-stopper-top | 0.01 | hybrid | 147 (5/142/0/0/0) | 0 | 3,920 → 3,258 | 7 | 464 | 28 (0/10/18) | 436 | no curve: no geometric solution (411) | 1.0002 | 18.9 → 14.4 |
| third-party/gardena-end | 0.01 | hybrid | 17 (5/5/2/1/4) | 0 | 529 → 212 | 16 | 72 | 32 (0/32/0) | 40 | no curve: same surface (22) | 1.0041 | 3.7 → 3.2 |
| third-party/gear-bearing-5 | 0.1 | hybrid | 2308 (291/581/0/10/8) | 1418 | 8,649 → 7,814 | 106 | 2383 | 738 (217/106/415) | 1645 | no curve: no geometric solution (1060) | 1.0078 | 11.2 → 10.3 |
| third-party/hot-wheels-connector | 0.01 | hybrid | 2015 (173/9/0/0/0) | 1833 | 3,984 → 3,363 | 16 | 482 | 281 (252/19/10) | 201 | not a candidate (78) | 0.9998 | 19.0 → 17.1 |
| third-party/makita-vacuum-holder | 0.05 | hybrid | 3480 (557/237/8/12/4) | 2662 | 9,383 → 9,004 | 26 | 2202 | 421 (317/34/70) | 1781 | a node off (921) | 0.9995 | 8.6 → 4.7 |
| third-party/micro-sd-keyring-inner | 0.01 | hybrid | 66 (28/16/0/4/0) | 18 | 1,114 → 264 | 32 | 354 | 122 (90/32/0) | 232 | a sphere in pieces (227) | 0.9973 | 4.8 → 2.4 |
| third-party/micro-sd-keyring-outer | 0.01 | exact | 41 (23/18/0/0/0) | 0 | 158 → 158 | 60 | – | – | – | – | 1.0000 | 0.4 → 0.4 |
| third-party/mms-camera-mount | 0.01 | exact | 11 (9/1/1/0/0) | 0 | 24 → 24 | 4 | – | – | – | – | 1.0000 | 0.0 → 0.0 |
| third-party/mms-flat-stand | 0.01 | exact | 44 (37/6/1/0/0) | 0 | 195 → 195 | 29 | – | – | – | – | 1.0000 | 0.3 → 0.3 |
| third-party/sock-clips-6x | 0.01 | hybrid | 161 (34/31/0/0/6) | 90 | 2,097 → 489 | 74 | 269 | 175 (101/74/0) | 94 | undone (38) | 1.0056 | 34.6 → 30.5 |
| third-party/spaghetti-measure | 0.01 | hybrid | 165 (48/61/0/1/0) | 55 | 3,503 → 449 | 123 | 348 | 270 (137/131/2) | 78 | no curve: no geometric solution (37) | 0.9999 | 24.6 → 1.2 |
| third-party/vented-funnel | 0.02 | hybrid | 715 (452/150/10/11/6) | 86 | 6,508 → 5,317 | 63 | 1718 | 624 (510/68/46) | 1094 | a node off (573) | 1.0011 | 7.5 → 5.3 |
| third-party/wyze-garage-bracket | 0.01 | hybrid | 84 (55/27/2/0/0) | 0 | 996 → 320 | 62 | 260 | 236 (162/74/0) | 24 | no curve: same surface (12) | 1.0002 | 1.2 → 0.7 |

**At a fixed 0.01 mm:**

| file | tolerance | outcome | faces (pl/cy/co/sp/to) | facets | edges before → after | circles | chains | collapsed (lines/circles/ellipses) | polylines | most common reason kept | volume | s (before → after) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| own/ball | 0.01 | exact | 1 (0/0/0/1/0) | 0 | 3 → 3 | 1 | – | – | – | – | 1.0018 | 0.2 → 0.1 |
| own/battery-holder | 0.01 | hybrid | 131 (61/33/37/0/0) | 0 | 6,181 → 470 | 116 | 441 | 293 (64/229/0) | 148 | no curve: same surface (116) | 0.9986 | 12.9 → 1.6 |
| own/battery-power-adapter | 0.01 | hybrid | 4506 (253/136/3/5/0) | 4109 | 10,177 → 9,317 | 34 | 1051 | 318 (159/47/112) | 733 | a node off (318) | 1.0006 | 9.9 → 8.1 |
| own/desk-organizer-module-small | 0.01 | hybrid | 418 (198/166/0/0/12) | 42 | 7,197 → 6,929 | 12 | 996 | 118 (93/12/13) | 878 | no curve: no geometric solution (439) | 0.9999 | 38.6 → 34.9 |
| own/drill-block | 0.01 | exact | 93 (77/12/0/0/4) | 0 | 638 → 638 | 211 | – | – | – | – | 1.0014 | 4.6 → 4.1 |
| own/hole-filler-35mm | 0.01 | exact | 6 (3/2/0/0/1) | 0 | 9 → 9 | 4 | – | – | – | – | 1.0013 | 0.5 → 0.4 |
| own/hole-filler-5mm | 0.01 | exact | 6 (3/2/1/0/0) | 0 | 9 → 9 | 6 | – | – | – | – | 1.0003 | 0.0 → 0.0 |
| own/kuglbahn-pillar-base | 0.01 | ✗ cap | – | – | – | – | – | – | – | – | – | – |
| own/mirna-doodle-1 | 0.01 | hybrid | 168 (77/26/0/0/0) | 65 | 534 → 474 | 52 | 315 | 268 (216/52/0) | 47 | not a candidate (44) | 1.0105 | 0.3 → 0.2 |
| own/numbers-base-top | 0.01 | exact | 471 (471/0/0/0/0) | 0 | 1,292 → 1,292 | 0 | – | – | – | – | 1.0000 | 1.1 → 1.0 |
| own/object-permanence-base | 0.01 | hybrid | 1985 (333/25/5/2/0) | 1620 | 4,365 → 4,239 | 56 | 876 | 342 (253/56/33) | 534 | a node off (304) | 0.9997 | 14.9 → 13.3 |
| own/peg-perego-button | 0.01 | hybrid | 892 (108/94/8/10/2) | 670 | 3,058 → 2,670 | 21 | 574 | 102 (32/28/42) | 472 | not a candidate (254) | 1.0034 | 1.9 → 1.6 |
| own/phone-stand-foldable | 0.01 | hybrid | 3654 (587/211/0/3/12) | 2841 | 9,953 → 8,731 | 109 | 2194 | 985 (719/113/153) | 1209 | a node off (507) | 1.0000 | 18.7 → 16.5 |
| own/puzzle-base-circle | 0.01 | exact | 37 (35/1/0/0/1) | 0 | 129 → 129 | 4 | – | – | – | – | 0.9999 | 0.3 → 0.3 |
| own/puzzle-insert-circle | 0.01 | hybrid | 4722 (11/15/1/0/17) | 4678 | 10,033 → 9,457 | 5 | 133 | 16 (2/10/4) | 117 | no curve: off axis (43) | 1.0003 | 4.8 → 3.9 |
| own/remove-before-flight-cover | 0.01 | hybrid | 438 (252/62/4/0/0) | 120 | 2,722 → 1,083 | 126 | 880 | 747 (603/142/2) | 133 | a node off (43) | 1.0000 | 10.6 → 7.3 |
| own/scrap-plate | 0.01 | hybrid | 326 (66/67/12/8/0) | 173 | 1,611 → 1,387 | 22 | 366 | 92 (64/24/4) | 274 | not a candidate (100) | 1.0000 | 2.7 → 2.1 |
| own/shower-holder | 0.01 | hybrid | 901 (201/224/4/0/0) | 472 | 3,361 → 3,357 | 0 | 1043 | 80 (58/0/22) | 963 | a node off (433) | 0.9999 | 78.3 → 69.0 |
| own/spool-nut-v4.1 | 0.01 | hybrid | 718 (654/63/1/0/0) | 0 | 4,209 → 3,415 | 5 | 2159 | 1324 (1280/6/38) | 835 | no curve: hyperbola (642) | 0.9991 | 16.8 → 6.2 |
| own/spool-screw-v4.1 | 0.01 | hybrid | 5909 (778/174/4/0/0) | 4953 | 15,735 → 13,876 | 38 | 2866 | 1525 (1379/50/96) | 1341 | no curve: hyperbola (642) | 0.9995 | 24.8 → 17.3 |
| own/track-straight-100mm | 0.01 | hybrid | 306 (65/2/2/0/0) | 237 | 847 → 627 | 4 | 169 | 147 (139/8/0) | 22 | not a candidate (14) | 1.0000 | 1.1 → 0.6 |
| own/trashcan-repair-foot | 0.01 | exact | 16 (12/4/0/0/0) | 0 | 72 → 72 | 20 | – | – | – | – | 0.9989 | 0.1 → 0.1 |
| own/trashcan-spacer | 0.01 | hybrid | 419 (2/0/0/4/4) | 409 | 848 → 848 | 0 | 10 | 0 (0/0/0) | 10 | not a candidate (10) | 1.0001 | 0.9 → 0.8 |
| own/whiteboard-tray-v5 | 0.01 | ✗ rebuild | – | – | – | – | – | – | – | – | – | – |
| third-party/door-stopper-top | 0.01 | hybrid | 147 (5/142/0/0/0) | 0 | 3,920 → 3,258 | 7 | 464 | 28 (0/10/18) | 436 | no curve: no geometric solution (411) | 1.0002 | 20.6 → 14.4 |
| third-party/gardena-end | 0.01 | hybrid | 17 (5/5/2/1/4) | 0 | 529 → 212 | 16 | 72 | 32 (0/32/0) | 40 | no curve: same surface (22) | 1.0041 | 4.2 → 3.2 |
| third-party/gear-bearing-5 | 0.01 | ✗ cap | – | – | – | – | – | – | – | – | – | – |
| third-party/hot-wheels-connector | 0.01 | hybrid | 2015 (173/9/0/0/0) | 1833 | 3,984 → 3,363 | 16 | 482 | 281 (252/19/10) | 201 | not a candidate (78) | 0.9998 | 21.7 → 17.3 |
| third-party/makita-vacuum-holder | 0.01 | ✗ cap | – | – | – | – | – | – | – | – | – | – |
| third-party/micro-sd-keyring-inner | 0.01 | hybrid | 66 (28/16/0/4/0) | 18 | 1,114 → 264 | 32 | 354 | 122 (90/32/0) | 232 | a sphere in pieces (227) | 0.9973 | 5.1 → 2.3 |
| third-party/micro-sd-keyring-outer | 0.01 | exact | 41 (23/18/0/0/0) | 0 | 158 → 158 | 60 | – | – | – | – | 1.0000 | 0.4 → 0.4 |
| third-party/mms-camera-mount | 0.01 | exact | 11 (9/1/1/0/0) | 0 | 24 → 24 | 4 | – | – | – | – | 1.0000 | 0.0 → 0.0 |
| third-party/mms-flat-stand | 0.01 | exact | 44 (37/6/1/0/0) | 0 | 195 → 195 | 29 | – | – | – | – | 1.0000 | 0.4 → 0.3 |
| third-party/sock-clips-6x | 0.01 | hybrid | 161 (34/31/0/0/6) | 90 | 2,097 → 489 | 74 | 269 | 175 (101/74/0) | 94 | undone (38) | 1.0056 | 34.6 → 30.5 |
| third-party/spaghetti-measure | 0.01 | hybrid | 165 (48/61/0/1/0) | 55 | 3,503 → 449 | 123 | 348 | 270 (137/131/2) | 78 | no curve: no geometric solution (37) | 0.9999 | 23.5 → 1.2 |
| third-party/vented-funnel | 0.01 | hybrid | 1910 (522/187/10/13/5) | 1173 | 8,690 → 7,810 | 18 | 1950 | 731 (645/20/66) | 1219 | a node off (440) | 0.9993 | 9.5 → 7.7 |
| third-party/wyze-garage-bracket | 0.01 | hybrid | 84 (55/27/2/0/0) | 0 | 996 → 320 | 62 | 260 | 236 (162/74/0) | 24 | no curve: same surface (12) | 1.0002 | 1.2 → 0.7 |

**Acceptance, slice D3.**

1. **Same outcomes: pass.** Both sweeps convert the same files as before
   and as D2's tables (Auto: 36 of 37; 0.01 mm: 33 of 37), each exact or
   hybrid as before, with the same faces by kind and the same facets; the
   comparison script found no difference in either. The volume rule holds
   everywhere; the hybrid volumes move by at most 0.4 % of the mesh's
   (mirna-doodle-1 at 0.1 mm 0.9928 → 0.9891, at 0.01 mm 1.0070 → 1.0105;
   sock-clips-6x 1.0035 → 1.0056).
2. **Fewer edges: pass but one.** Every hybrid result has fewer edges, in
   total 117,278 → 91,644 at Auto (−22 %, 26 hybrid files, 1,039 circle
   edges where there were none) and 105,664 → 83,045 at 0.01 mm (−21 %, 23
   files, 948 circles); the largest drops are on parts made of holes and
   bosses (battery-holder 6,181 → 470, spaghetti-measure 3,503 → 449,
   sock-clips-6x 2,097 → 489). The exception is trashcan-spacer at 0.01 mm
   (848 → 848): its ten chains all border its one unfit fillet network,
   so no chain lies between two recognised regions. At Auto (0.05 mm) it
   has no facets and drops to 359 edges with 12 circles.
3. **Time: pass.** The slowest file, shower-holder, takes 69.4 s at Auto
   and 69.0 s at 0.01 mm against D2's 70.0 s and 76.0 s; most hybrid files
   got faster (battery-holder 11.0 → 2.5 s, spaghetti-measure 24.5 → 1.2 s
   at Auto against D2's table).
4. **In the harness only** (not in the kernel sweeps): at Auto the native
   order explodes one region fewer on whiteboard-tray-v5 (facets 644 →
   622): an arc in place of a polyline made a face valid that D2 exploded;
   at 0.01 mm mms-m5-nut, an open mesh the importer refuses, converts.

What collapses in practice (the harness's `FACES=1` over all 41 files at
Auto, every build's chains counted): of 13,973 collapses, plane|plane lines
9,705, plane|cylinder circles 1,355, ellipses 1,330 and lines 805 (walls
parallel to an axis), plane|sphere circles 218, coaxial cone|cylinder 181
and cylinder|torus 52 circles, cylinder|cylinder ellipses 103 (equal radii,
crossing axes) and lines 40, plane|cone 154, plane|torus 18. What stays a
polyline: nodes more than 1.5 × the tolerance off the curve ("a node off":
plane|plane 4,538, plane|cylinder 2,304: fitted surfaces off by more than
that where they meet, mostly at 0.01 mm on noisy parts);
cylinder|cylinder with crossing axes and unequal radii, which IntAna has no
curve for (4,133; door-stopper-top's 142 cylinders); plane|cone hyperbolas
(1,386: spool-nut's and spool-screw's thread flanks); plane|cylinder pairs
that don't meet at all (869: a plane meant to be tangent to a fillet's
cylinder, a little off: stl2step constructs the tangent line there, which
would be the next step); plane|torus other than square to or through the
axis (607); spheres in pieces (959); the split seams ("same surface", by
design) and chains to facet islands ("not a candidate").

**Deviations from the brief.** (1) A through hole's rim is not one closed
chain: D1 splits a periodic surface spanning over 3/4 of a turn into
halves, so each rim is two arcs (one per half), which unify merges into one
circle edge with the halves; closed chains occur where a region spans less
(a spherical cap on a plane, the test). (2) Cylinder|cylinder pairs that
aren't coaxial collapse to whatever lines or ellipses IntAna gives (parallel
axes: the tangent line or the two crossing lines; equal radii with crossing
axes: two ellipses), not only the tangent case. (3) Curved|curved pairs are tested for
a shared axis by us (1° and the tolerance) and the second surface moved
onto the first's axis before IntAna, whose own coaxial tests are exact:
battery-holder's 121 coaxial cone|cylinder chains got "no geometric
solution" from the fitted surfaces as they were. (4) The pcurves end at the
nodes' parameters, through samples where not straight, instead of
`Geom2d_Line`/`GeomProjLib` through the curve's ends (above), and
`BRepLib::SameParameter` is not called. (5) Three rules the brief did not
have, each found on a file whose D2 outcome changed without it: D1's chord
limit for the replaced mesh edges (mirna-doodle-1, sock-clips-6x), no
collapse beside a sphere in pieces (micro-sd-keyring-inner), and undoing a
failing region's collapses after unify and in the node check before it
explodes (shower-holder, hot-wheels-connector); and the node check skips a
collapsed chain's nodes (its time, above). (6) `meshLoopsDebug`'s chain
curve type applies the acceptance test but not the build's sphere and chord
rules.

### Amendment, 2026-10-23: the exact stage only where it can win, Faceted's cap, browser timings (slice D4)

The D2/D3 sweeps (their own tables) show where the time went. On the files the
exact stage can't rebuild it still ran first and burned its budget, and
`BOPAlgo_MakerVolume` overruns its deadline inside one long step: on
hot-wheels-connector `MakerVolume` ran **91.8 s against the 30 s budget**
(+61.8 s), the file taking 96.0 s in all where the hybrid alone is ~3 s. On
shower-holder `MakerVolume` was 14.4 s (inside the budget), but the exact
stage then spent another **58.8 s** between "cells classified" and the
un-recorded "merged and unified" — the kept-cell merge, `BRepCheck` and
`ShapeUpgrade_UnifySameDomain`, none of which takes the `MeshDeadline` — so
its exact stage overran as well (78.6 s in all, the hybrid ~3 s). The files
the exact stage converts are small and clean (at most 471 surfaces, under 5 s
each), and every file where the hybrid would do still paid for the exact
stage first. Four things change here, the owner's decisions of 2026-10-23 (the
first three) and the browser measurement the brief asked for.

- **The exact stage runs only on a clean segmentation.** `prismaticFromMesh`
  skips it whenever the segmentation has **any unfit region**
  (`unfitRegions > 0`), where slice C ran it with up to 2 % and left the unfit
  regions out. Leaving a region out **changes the geometry** (its triangles
  are dropped and the neighbouring surfaces' faces extended to meet), where the
  hybrid keeps it as facets (D1–D3), which is more faithful and is where such a
  file lands anyway when the exact stage fails; skipping also spares the
  overrun above. `PRISMATIC_UNFIT_ALLOWED` stays: it is `rebuildPrismatic`'s
  own leaving-out rule and the Auto ladder's stopping rule. The surface cap
  stays `PRISMATIC_SURFACE_CAP` = 500.
- **The budget is 12 s.** `PRISMATIC_REBUILD_BUDGET_MS` 30,000 → 12,000 (the
  exact files finish in under 5 s, so this leaves headroom), and the "gave up
  after N s" message takes N from the constant. **No surface-count gate:**
  `SetRunParallel(false)` and `maker.Perform(deadline->Start())` are already
  there, so the overrun is inside one `MakerVolume` step that doesn't check the
  progress indicator; a gate that keeps numbers-base-top (the exact stage's
  largest, 471 surfaces, 1.0 s) out must sit above 471, but the overrunning
  hot-wheels-connector has only 202 surfaces and shower-holder 430 — a surface
  count cannot separate them, and both are skipped by the unfit-region rule
  anyway. Left as an open item.
- **Faceted's cap is 5,000.** `FACETED_FACE_CAP` 2,000 → 5,000;
  `FACETED_ESTIMATE_MARGIN` stays 1.5 and **both** cap messages take the number
  from the constant through `thousands()`. Every file whose coplanar-facet
  count is between 2,000 and 5,000 converts now (timings below);
  desk-organizer-module-small (about 15,635 faces) and whiteboard-tray-v5
  (about 7,944) stay over it, so the Faceted cavity rule (D2) is still
  unreachable on them, as before.
- **Browser timings.** `e2e/mesh-to-solid-timing.spec.ts` (skipped unless
  `MESH_TIMING` is set, so CI ignores it; run by
  `spikes/stl-to-solid/browser-timing.sh` with `PLAYWRIGHT_CHROMIUM_PATH` and
  `E2E_GPU=1`) imports each STL ("As solid" off) through the Import dialog,
  opens the browser row's Convert to Solid… (Prismatic, Auto) and times the
  body's status turning done. **The conversion runs in the dialog's own draft
  preview, not on OK**: the measured confirm-to-done span is 0.2–0.4 s on every
  file, and the conversion — the dialog-open-to-done span, the user's wait — is
  what the ratio below uses.

#### The real files (slice D4)

The kernel sweeps over `STL_DIR` (`mesh-to-solid-files.test.ts`) on the owner's
41 STLs (the importer refuses the four open meshes), the same machine, the new
WASM `occt-66e41e5c997c`. The "before" times are D3's own table (the same
head); the machine had other jobs on it for both (load average 4.8–2.6 during
the Auto sweep, 2.6–2.1 during 0.01), so the small differences are noise. Faces
by kind count recognised faces, facets apart; edges and circles are unchanged
from D3 (checked in the comparison) except where the outcome changed.
**At Auto** the sweep converts **36 of 37** (whiteboard-tray-v5 refused, as
before); **at 0.01 mm 33 of 37** (kuglbahn-pillar-base, gear-bearing-5 and
makita-vacuum-holder over the facet cap, whiteboard-tray-v5 the rebuild), the
same sets as D3.
**At Auto** (D4 vs D3's own table, s before → after):

| file | tolerance | outcome | faces (pl/cy/co/sp/to) | facets | s before → after |
|---|---|---|---|---|---|
| own/ball | 0.01 | exact | 1 (0/0/0/1/0) | 0 | 0.1 → 0.0 |
| own/battery-holder | 0.01 | hybrid | 131 (61/33/37/0/0) | 0 | 2.5 → 1.4 |
| own/battery-power-adapter | 0.1 | hybrid | 994 (505/70/3/0/1) | 415 | 2.6 → 2.3 |
| own/desk-organizer-module-small | 0.01 | hybrid | 418 (198/166/0/0/12) | 42 | 35.1 → 17.0 |
| own/drill-block | 0.01 | hybrid | 388 (108/65/0/3/4) | 208 | 4.2 → 1.4 |
| own/hole-filler-35mm | 0.01 | exact | 6 (3/2/0/0/1) | 0 | 0.4 → 0.4 |
| own/hole-filler-5mm | 0.01 | exact | 6 (3/2/1/0/0) | 0 | 0.0 → 0.0 |
| own/kuglbahn-pillar-base | 0.1 | hybrid | 3941 (430/86/0/6/10) | 3409 | 9.2 → 9.9 |
| own/mirna-doodle-1 | 0.1 | hybrid | 120 (63/14/0/0/0) | 43 | 0.2 → 0.2 |
| own/numbers-base-top | 0.01 | exact | 471 (471/0/0/0/0) | 0 | 1.0 → 1.1 |
| own/object-permanence-base | 0.01 | hybrid | 1985 (333/25/5/2/0) | 1620 | 13.4 → 2.3 |
| own/peg-perego-button | 0.02 | hybrid | 212 (99/103/2/5/3) | 0 | 24.5 → 13.2 |
| own/phone-stand-foldable | 0.1 | hybrid | 2325 (458/10/0/0/10) | 1847 | 36.2 → 18.9 |
| own/puzzle-base-circle | 0.01 | exact | 37 (35/1/0/0/1) | 0 | 0.3 → 0.3 |
| own/puzzle-insert-circle | 0.05 | hybrid | 1609 (318/59/1/0/1) | 1230 | 34.4 → 14.6 |
| own/remove-before-flight-cover | 0.01 | hybrid | 438 (252/62/4/0/0) | 120 | 7.3 → 0.7 |
| own/scrap-plate | 0.02 | hybrid | 154 (61/77/16/0/0) | 0 | 17.6 → 12.9 |
| own/shower-holder | 0.01 | hybrid | 901 (201/224/4/0/0) | 472 | 69.4 → 3.1 |
| own/spool-nut-v4.1 | 0.01 | hybrid | 718 (654/63/1/0/0) | 0 | 6.2 → 6.3 |
| own/spool-screw-v4.1 | 0.05 | hybrid | 3197 (975/95/4/0/0) | 2123 | 20.2 → 20.5 |
| own/track-straight-100mm | 0.01 | hybrid | 306 (65/2/2/0/0) | 237 | 0.6 → 0.3 |
| own/trashcan-repair-foot | 0.01 | exact | 16 (12/4/0/0/0) | 0 | 0.1 → 0.1 |
| own/trashcan-spacer | 0.05 | hybrid | 78 (56/14/0/4/4) | 0 | 1.9 → 2.1 |
| own/whiteboard-tray-v5 | – | ✗ refused | – | – | – → 44.8 |
| third-party/door-stopper-top | 0.01 | hybrid | 147 (5/142/0/0/0) | 0 | 14.4 → 14.6 |
| third-party/gardena-end | 0.01 | hybrid | 17 (5/5/2/1/4) | 0 | 3.2 → 3.2 |
| third-party/gear-bearing-5 | 0.1 | hybrid | 2308 (291/581/0/10/8) | 1418 | 10.3 → 10.5 |
| third-party/hot-wheels-connector | 0.01 | hybrid | 2015 (173/9/0/0/0) | 1833 | 17.1 → 2.5 |
| third-party/makita-vacuum-holder | 0.05 | hybrid | 3480 (557/237/8/12/4) | 2662 | 4.7 → 4.9 |
| third-party/micro-sd-keyring-inner | 0.01 | hybrid | 66 (28/16/0/4/0) | 18 | 2.4 → 2.4 |
| third-party/micro-sd-keyring-outer | 0.01 | exact | 41 (23/18/0/0/0) | 0 | 0.4 → 0.4 |
| third-party/mms-camera-mount | 0.01 | exact | 11 (9/1/1/0/0) | 0 | 0.0 → 0.0 |
| third-party/mms-flat-stand | 0.01 | exact | 44 (37/6/1/0/0) | 0 | 0.3 → 0.3 |
| third-party/sock-clips-6x | 0.01 | hybrid | 161 (34/31/0/0/6) | 90 | 30.5 → 12.5 |
| third-party/spaghetti-measure | 0.01 | hybrid | 165 (48/61/0/1/0) | 55 | 1.2 → 1.3 |
| third-party/vented-funnel | 0.02 | hybrid | 715 (452/150/10/11/6) | 86 | 5.3 → 5.5 |
| third-party/wyze-garage-bracket | 0.01 | hybrid | 84 (55/27/2/0/0) | 0 | 0.7 → 0.7 |

**At a fixed 0.01 mm:**

| file | tolerance | outcome | faces (pl/cy/co/sp/to) | facets | s before → after |
|---|---|---|---|---|---|
| own/ball | 0.01 | exact | 1 (0/0/0/1/0) | 0 | 0.1 → 0.0 |
| own/battery-holder | 0.01 | hybrid | 131 (61/33/37/0/0) | 0 | 1.6 → 1.3 |
| own/battery-power-adapter | 0.01 | hybrid | 4506 (253/136/3/5/0) | 4109 | 8.1 → 7.9 |
| own/desk-organizer-module-small | 0.01 | hybrid | 418 (198/166/0/0/12) | 42 | 34.9 → 16.9 |
| own/drill-block | 0.01 | hybrid | 388 (108/65/0/3/4) | 208 | 4.1 → 1.3 |
| own/hole-filler-35mm | 0.01 | exact | 6 (3/2/0/0/1) | 0 | 0.4 → 0.4 |
| own/hole-filler-5mm | 0.01 | exact | 6 (3/2/1/0/0) | 0 | 0.0 → 0.0 |
| own/kuglbahn-pillar-base | – | ✗ refused | – | – | – → 0.5 |
| own/mirna-doodle-1 | 0.01 | hybrid | 168 (77/26/0/0/0) | 65 | 0.2 → 0.3 |
| own/numbers-base-top | 0.01 | exact | 471 (471/0/0/0/0) | 0 | 1.0 → 1.1 |
| own/object-permanence-base | 0.01 | hybrid | 1985 (333/25/5/2/0) | 1620 | 13.3 → 2.3 |
| own/peg-perego-button | 0.01 | hybrid | 892 (108/94/8/10/2) | 670 | 1.6 → 1.6 |
| own/phone-stand-foldable | 0.01 | hybrid | 3654 (587/211/0/3/12) | 2841 | 16.5 → 16.8 |
| own/puzzle-base-circle | 0.01 | exact | 37 (35/1/0/0/1) | 0 | 0.3 → 0.3 |
| own/puzzle-insert-circle | 0.01 | hybrid | 4722 (11/15/1/0/17) | 4678 | 3.9 → 4.0 |
| own/remove-before-flight-cover | 0.01 | hybrid | 438 (252/62/4/0/0) | 120 | 7.3 → 0.6 |
| own/scrap-plate | 0.01 | hybrid | 326 (66/67/12/8/0) | 173 | 2.1 → 2.2 |
| own/shower-holder | 0.01 | hybrid | 901 (201/224/4/0/0) | 472 | 69.0 → 3.1 |
| own/spool-nut-v4.1 | 0.01 | hybrid | 718 (654/63/1/0/0) | 0 | 6.2 → 6.3 |
| own/spool-screw-v4.1 | 0.01 | hybrid | 5909 (778/174/4/0/0) | 4953 | 17.3 → 17.8 |
| own/track-straight-100mm | 0.01 | hybrid | 306 (65/2/2/0/0) | 237 | 0.6 → 0.3 |
| own/trashcan-repair-foot | 0.01 | exact | 16 (12/4/0/0/0) | 0 | 0.1 → 0.1 |
| own/trashcan-spacer | 0.01 | hybrid | 419 (2/0/0/4/4) | 409 | 0.8 → 0.8 |
| own/whiteboard-tray-v5 | – | ✗ refused | – | – | – → 34.4 |
| third-party/door-stopper-top | 0.01 | hybrid | 147 (5/142/0/0/0) | 0 | 14.4 → 14.7 |
| third-party/gardena-end | 0.01 | hybrid | 17 (5/5/2/1/4) | 0 | 3.2 → 3.2 |
| third-party/gear-bearing-5 | – | ✗ refused | – | – | – → 1.5 |
| third-party/hot-wheels-connector | 0.01 | hybrid | 2015 (173/9/0/0/0) | 1833 | 17.3 → 2.6 |
| third-party/makita-vacuum-holder | – | ✗ refused | – | – | – → 0.3 |
| third-party/micro-sd-keyring-inner | 0.01 | hybrid | 66 (28/16/0/4/0) | 18 | 2.3 → 2.4 |
| third-party/micro-sd-keyring-outer | 0.01 | exact | 41 (23/18/0/0/0) | 0 | 0.4 → 0.4 |
| third-party/mms-camera-mount | 0.01 | exact | 11 (9/1/1/0/0) | 0 | 0.0 → 0.0 |
| third-party/mms-flat-stand | 0.01 | exact | 44 (37/6/1/0/0) | 0 | 0.3 → 0.3 |
| third-party/sock-clips-6x | 0.01 | hybrid | 161 (34/31/0/0/6) | 90 | 30.5 → 12.5 |
| third-party/spaghetti-measure | 0.01 | hybrid | 165 (48/61/0/1/0) | 55 | 1.2 → 1.3 |
| third-party/vented-funnel | 0.01 | hybrid | 1910 (522/187/10/13/5) | 1173 | 7.7 → 7.8 |
| third-party/wyze-garage-bracket | 0.01 | hybrid | 84 (55/27/2/0/0) | 0 | 0.7 → 0.7 |

#### Browser versus node (slice D4)

On the Ubuntu machine (`PLAYWRIGHT_CHROMIUM_PATH=/usr/bin/google-chrome-stable`
and `E2E_GPU=1`, the built app on the preview server; load average 2.8–5.1
during the run, so the node column — the Auto sweep under the same external
load — is itself noisy), two runs per file, median. The browser span is
dialog-open-to-done (the dialog's draft preview is what converts); the
`kernel.meshToSolid` column is the temporary `performance.now()` mark the brief
asked for (not committed).

| file | node Auto s | browser total s | browser kernel.meshToSolid s | total / node |
|---|---|---|---|---|
| peg-perego-button | 13.2 | 14.7 | 13.4 | 1.11 |
| trashcan-spacer | 2.1 | 5.8 | 4.2 | 2.76 |
| drill-block | 1.4 | 3.5 | 2.2 | 2.50 |
| hole-filler-35mm | 0.4 | 1.8 | 1.1 | 4.5 |
| puzzle-base-circle | 0.3 | 2.1 | 1.1 | 7.0 |
| remove-before-flight-cover | 0.7 | 2.7 | 1.5 | 3.9 |
| track-straight-100mm | 0.3 | 1.8 | 1.1 | 6.1 |
| trashcan-repair-foot | 0.1 | 1.9 | 0.9 | 18.6 |
| own/battery-holder | 1.4 | 5.0 | 3.4 | 3.5 |
| own/phone-stand-foldable | 18.9 | 12.4 | 10.8 | 0.66 |
| own/spool-screw-v4.1 | 20.5 | 24.7 | 19.6 | 1.20 |

The median total ratio is **3.5×** — over 1.5×. **Where** it comes from is not
the kernel: on the large files the browser's `kernel.meshToSolid` matches or
beats the (loaded) node sweep (phone-stand 10.8 vs 18.9 s, spool-screw 19.6 vs
20.5, peg-perego 13.4 vs 13.2), and the confirm step is 0.2–1.0 s (the draft
preview already built the solid). Two fixed costs dominate the small files,
where node is well under a second: about **0.6–1.6 s of dialog, worker
round-trip and redraw** around the kernel call (the browser total minus the
kernel time), and a **cold kernel per run** — the script reloads the page for
each file, so the worker's WASM starts fresh, where the node sweep reuses one
warm kernel; that is the ~0.75 s the small fixtures gain inside the kernel call
itself. A user converting in one open session (a warm kernel, no page reload)
sits near the large files' ratio. So the kernel is not the problem; the
per-conversion fixed overhead and the cold start are, and neither is
browser-specific to Mesh to Solid.

**Acceptance, slice D4.**

1. **Same convert set and outcomes: pass, one intended change.** Both sweeps
   convert the same files as D3 and keep every file's exact/hybrid outcome,
   faces by kind, facets, edges and circles, except **drill-block** (exact with
   3 unfit left out → hybrid, 388 faces, 208 facets) at Auto and 0.01 mm, and
   **track-straight-100mm at 0.05 mm** in the fixture test (exact with 1 unfit
   left out → hybrid, 219 faces, 145 facets). Both are Part 1's skip rule: a
   file the exact stage converted by leaving unfit regions out. whiteboard-tray-v5
   stays refused. The volume rule holds everywhere (0.9891–1.0105, the same
   span as D3). The `STL_DIR` comparison script found no other difference.
2. **Time at Auto: pass.** Over the 36 files D3 timed the total is 377.9 → 143.0 s
   (**−62 %**); including whiteboard-tray-v5's refusal (untimed in D3, 44.8 s
   now) 377.9 → 187.8 s (**−50 %**, well over the 25 % asked). At 0.01 mm,
   267.4 → 96.8 s (−64 %; with whiteboard 131.2, −51 %). The large wins are the
   files the exact stage used to burn its budget on: shower-holder 69.4 → 3.1 s,
   desk-organizer-module-small 35.1 → 17.0, phone-stand-foldable 36.2 → 18.9,
   puzzle-insert-circle 34.4 → 14.6, sock-clips-6x 30.5 → 12.5,
   hot-wheels-connector 17.1 → 2.5, remove-before-flight-cover 7.3 → 0.7.
3. **No file slower by more than 10 %: pass with one exception.**
   Every converted file is within 10 % (the largest real movements are
   spool-screw 17.3 → 17.8 s at 0.01 mm, +3 %, and kuglbahn +7.6 %; the rest is
   ~0.1–0.2 s of sweep noise, e.g. trashcan-spacer 1.9 → 2.1 and
   numbers-base-top 1.0 → 1.1). The exception is **whiteboard-tray-v5**, a
   refusal: D3 left it untimed, and D2's own table had ~33 s at its 0.02 mm
   Auto pick, where D4 takes 44.8 s. The exact stage is now skipped (3 unfit
   regions), so the hybrid alone runs to its refusal (44.8 s at 0.02, 34.4 s at
   0.01 against D2's ~41) instead of the exact stage's 30 s budget ending it
   sooner. It stays a refusal either way; not fixed (open item).
   The three facet-cap refusals are faster: kuglbahn 0.5 s, gear-bearing-5
   1.5 s, makita 0.3 s at 0.01 mm (the pre-count).
4. **shower-holder and hot-wheels-connector under 30 s: pass** (3.1 s and 2.5 s
   at Auto; 3.1 s and 2.6 s at 0.01 mm).
5. **The exact files still convert exactly: pass, apart from drill-block**
   (Part 1's list): ball, hole-filler-35mm, hole-filler-5mm, numbers-base-top,
   puzzle-base-circle, trashcan-repair-foot, micro-sd-keyring-outer,
   mms-camera-mount and mms-flat-stand keep their exact rebuild and faces.
6. **Faceted converts every file between 2,000 and 5,000 faces in under 20 s:
   pass.** In node, valid and single-solid: ball 4,608 (8.0 s),
   drill-block 2,532 (7.2 s), object-permanence-base 2,968 (7.6 s),
   peg-perego-button 3,846 (6.2 s), shower-holder 4,504 (5.6 s),
   spool-nut-v4.1 4,335 (7.8 s), hot-wheels-connector 2,799 (4.2 s). Two of
   them are repository fixtures and get a test
   (`mesh-to-solid-files.test.ts`'s Faceted describe).
7. **The browser ratio is measured: pass** (table above).

**Open items.** (1) whiteboard-tray-v5's refusal is slower at Auto (44.8 s vs
D2's ~33 s): the hybrid refuses only after ~32 s where the exact stage's full
30 s budget used to end the conversion sooner. (2) `BOPAlgo_MakerVolume` can
still overrun the exact budget inside one step for a mesh with no unfit region
and under 500 surfaces (none in the corpus; hot-wheels-connector's 61.8 s is
the measured case, now skipped by the unfit rule). (3) The browser conversion
runs in the dialog's draft preview, so a future UX pass could show the wait
there; the confirm itself is instant. (4) Faceted's cap stays unreachable for
desk-organizer-module-small and whiteboard-tray-v5 (their coplanar counts are
~15,600 and ~7,900), so a faceted cavity still needs Faceted to fit under the
cap.

**Decision, 2026-10-24.** The owner kept the skip rule as built: the exact
stage runs only with no unfit region and at most 500 surfaces. drill-block's
result, a hybrid with 388 faces and 208 facets, is preferred to the exact
93-face result that left 3 small regions out: it is faithful, and the Result
line says what stayed facets.

### Amendment, 2026-10-24: Offset Face on a converted body (diagnosis; the fix is open)

**The report.** The owner imported a gear (3MF, 17,472 triangles), converted it
with Mesh to Solid (prismatic, tolerance Auto) and ran Offset Face on the
flat top of the hub; the app stayed on "computing…" for minutes, then refused.
Replayed in Node (`Kernel` + `loadOcct` + `loadManifold`): `read3mf` →
`kernel.meshFrom` → `kernel.meshToSolid(mesh, { method: 'prismatic', tolerance: -1 })`
(≈9.5 s) gives a **valid** 204-face body (102 planes, 100 cylinders, 2 cones,
rebuild **hybrid**, 0 facets, 597 edges, volume 13,441.33 mm³) with the exact
stage refusing first (`invalid after healing`). `kernel.offsetFaces(shape, [top], d)`
then fails for d = 2.6, 0.5 and −0.5 with
`OffsetFaceError: Offset failed: OCCT can't offset these faces.`, each after
52–58 s (the plain build, then the seam retry, then `explainOffset`'s
`largestThatWorks` bisection over seven more builds).

**Slice 1, the fast failure** (`extrudo_facade.cpp`, `largestThatWorks`):
probe `failing / 128` — the smallest value the seven-step bisection ever
tests — before the loop. Under the loop's own monotonicity assumption a
failure there means the same answer (0) at the cost of one build instead of
seven; a success leaves the bisection exactly as it was, so every caller's
result is unchanged. The gear's failed preview and commit drop to a couple of
builds.

**The harness-only diagnosis hooks.** Three facade methods (reached through
the raw facade in tests and the spike harness, as `meshLoopsDebug` is; the app
never calls them):
- `shapeDiagnose(shape)`: the largest vertex/edge/face tolerance
  (`BRep_Tool::Tolerance`), the sub-shape counts, the edges not
  SameParameter, the faces that sit on a geometric surface another face also
  has (one analytic surface split into several faces), the free edges (one
  face), how many of those are **dangling** (neither a seam, `BRep_Tool::IsClosed`,
  nor degenerate), the over-shared edges, and the invalid faces and edges.
- `offsetProbe(shape, face, distance)`: one plain `BRepOffset_MakeOffset`
  build, reporting `IsDone`, `Error()`, the raw builder shape's kind, its
  shell count and how many shells close, and which of `offsetIsGood`'s checks
  the `asSolid` result fails (validity, the volume against the input's,
  `farFacesKept`).
- `meshRefusalDebug()`: the last call's exact-stage and hybrid refusals.

**What they measured on the gear.** Tolerances are small (max vertex and edge
0.012 mm, face 1e-7 mm), 0 edges are not SameParameter and 0 sub-shapes are
invalid — but the converted body has **5 dangling edges**: the shell is not
watertight, even though `BRepCheck_Analyzer` reports the solid valid. A single
plain `BRepOffset_MakeOffset` build from it returns `IsDone` with `Error() = 0`
and a raw **solid** of ~0.0016 mm³ (invalid per `BRepCheck_Analyzer`), so
`offsetIsGood` refuses it at every distance and Shell fails the same way.
Every face fails, not only the top. The **assembled** (pre-unify) hybrid solid
has **0** dangling edges; `UnifySameDomain` introduces the 5 (with
`ConcatBSplines` on or off alike), and sewing the faces back — up to 1 mm, in
the default and non-manifold modes, then `ShapeFix_Shape` and
`ShapeFix_Wireframe` — does not close them (they have no partner within 1 mm).
Keeping the assembled solid instead (210 faces: the split pieces unify would
merge, 6 faces on a surface another face has, 0 dangling) is closed but
`BRepOffset_MakeOffset` then still returns a solid of ~0 volume, so the
conversion's coplanar/tangent split faces are a second trigger.

**Slice 3, the local reproduction** (`mesh-to-solid-files.test.ts`, the
`MESH_FILE` describe): with `MESH_FILE=<path to .3mf or .stl>` (skipped when
absent, so CI never sees the private file) it converts prismatic Auto, then
runs Offset Face at 2.6, 0.5 and −0.5 mm, Fillet (0.5 mm on an edge of the top
face), Shell (top face removed, 1 mm) and Press Pull (2.6 mm) on the top face
and logs each result and time. On the gear: Offset Face and Shell fail (as
above), Fillet and Press Pull succeed.

**Open.** The fix — merging the split analytic faces without opening the shell,
or stopping OCCT's single-face offset from collapsing on a body with
coplanar/tangent faces — is not done. The hooks above are what the next
attempt starts from.

### Amendment, 2026-10-25: Offset Face on a converted body, the causes measured

Measured with the spike harness (`spikes/stl-to-solid`, the facade natively in
the pinned OCCT image, the gear's staged mesh written by the `MESH_FILE`
test's `MESH_OUT`) and, for native bodies, with Vitest on the app's own WASM.

**Correction: the gear's shell was never open.** The 2026-10-24 count called a
free edge *dangling* unless `BRep_Tool::IsClosed(edge)` — the one-argument
form, which asks whether the edge's two ends meet (a closed loop), not whether
it is a seam of its face. Counted with `BRep_Tool::IsClosed(edge, face)`, the
converted gear (204 faces, 597 edges) has **0** dangling edges, as has the
assembled solid (210 faces, 619 edges). The 5 were the seams of the 5
full-turn faces `UnifySameDomain` makes when it merges the split pieces back
(3 cylinders, 2 cones): a seam has one face on both sides. Sewing, ShapeFix
and keeping the assembled solid (the 2026-10-24 attempts) could not close
what was not open.

**Cause 1, in the conversion: seams that are not isolines.** Unify keeps one
of the split edges between a surface's pieces as the merged face's seam.
Those edges follow mesh edges, and on a short band of a cylinder or a cone
the mesh edge is the quad's diagonal: on the gear, the flange's r 20 wall
(1.2 mm tall) and its 45° chamfer get seams whose ends are 0.0347 rad (2.0°)
and 0.0174 rad (1.0°) apart in u (a chord, edge tolerance 0.0033 mm; the
other 3 seams are vertical). `BRepCheck_Analyzer` accepts such a face;
`BRepOffset_MakeOffset` does not. On a synthetic valid cylinder (r 20, h 1.2,
built with `BRep_Builder`) whose seam runs from u = 0 at the bottom to u = s
at the top, Offset Face of the top face by 2.6 mm gives the 3-face,
4,775.22 mm³ solid a `BRepPrimAPI_MakeCylinder` gives for s = 0, and an
empty skin (`IsDone`, `Error()` 0, no face) for s = 0.001, 0.0347 and
−0.0347, the seam a chord or an exact helix alike; the facade's whole
`offsetFaces` (the seam retry included) refuses them. Shell works on all of
them. Re-seaming the face on the isoline through one end of the old seam
(the far rim edge split where that isoline meets it, in both of its faces)
gives 4,775.22 mm³ for all three.

**Cause 2, not in the conversion: a partial cylinder meeting a plane.** On
the app's kernel, Offset Face refuses native bodies built from primitives
and booleans: a 30 × 30 × 6.6 box with a D-shaped through bore (r 8.6, the
flat at x = 6.3015) for **every** one of its 8 faces (the top at 2.6, 0.5 and
−0.5 mm, the others at 1 mm); a D pin (a cylinder r 8.6 cut by a plane at
x = 6.3015, 0 or −4); a box with a convex half-cylinder bump r 5. A round
bore, a square bore and a concave half-cylinder notch work, and so does a box
whose vertical edges are rounded (r 0.4 or 1.5: tangent faces). The plain
build returns an empty skin, with OCCT's intersection flag on or off. The
gear's hub has such a bore (r 8.6, its flat at x = 6.30, through the whole
part), so every Offset Face on the gear hits cause 2: re-seaming the gear's
two slanted seams (harness) still leaves the top face and the 3.8 mm
shoulder refused. Making Offset Face handle these bodies is a change to
Offset Face for every body (ADR-0051), not to Mesh to Solid.

**Shell.** Shell 1 mm (top open) on the gear is refused before and after
re-seaming. The gear's teeth have 48 convex rounds of r 0.4 mm, and on a
native 20 × 20 × 10 box whose vertical edges are rounded r 0.4 the kernel
refuses Shell 1 mm as well ("the thickness is too large"; r 1.5 shells): an
inward 1 mm offset turns a 0.4 mm round inside out. Shell 0.3 and 0.2 mm on
the gear fail too, before and after re-seaming, while the hub cut off above
z = 4 (5 faces, the D bore included) shells; that cause is not isolated.

**The fix for cause 1** (`straightenSeams`, facade): after unify, in the
hybrid (each solid, its history merged into unify's so the region map
follows) and in the exact rebuild, every face with one seam, no degenerated
edge and a seam whose ends differ along its period is rebuilt on a copy of
its surface (so no shared edge's old pcurve changes) with the seam on the
isoline through the old seam's first vertex: the far rim run must cross that
isoline once, inside one edge, which is split there in both of its faces
(`EmptyCopied` keeps every pcurve; `ShapeBuild_ReShape` replaces it by its
two pieces in the neighbour); the near run must not cross it but at that
vertex; the other edges' pcurves move by whole periods into the new range.
The result is kept only when it is a valid solid of the same type and the
same volume (1e-6 relative), else the unified solid stays as it was. On the
gear both slanted seams are re-seamed (the same 204 faces and volume; 597 →
599 edges and 204 → 206 circles, each split rim adding one) and none is
left; its Offset Face still fails (cause 2), now after about 20 s per
distance instead of 14 (not followed up). Of
the fixtures, peg-perego-button (Auto, hybrid) has one slanted seam: 1,488 →
1,489 edges, 21 → 22 circles; the others are unchanged. Test
(`mesh-to-solid.test.ts`, the hybrid describe): a 260-step staircase (over
the 500-surface cap, so hybrid with no facets) under a disc r 8 h 1.2 of 181
segments whose top ring is turned half a segment (no vertical wall edge, so
the kept seam is π/181 off an isoline); Offset Face of the disc's top by
1 mm refuses on the old build ("OCCT can't offset these faces") and adds
π r² with the fix.

**Rejected** (2026-10-24 and here): sewing the "dangling" edges, ShapeFix
on them, keeping the assembled (un-unified) solid, `ConcatBSplines` off —
all aimed at an open shell that wasn't; sharing one `Geom_Surface` per
fitted surface (`cbce064d`, refused by the hybrid's own checks; unify merges
equal analytic surfaces anyway); and `ShapeFix_Face::FixMissingSeam` after
removing the slanted seam, which puts the seam at the surface's own u origin
and splits rim edges in that face only, leaving the neighbour with the
unsplit edge (an invalid shell).

**Also seen.** The hybrid conversion of `mesh-to-solid.test.ts`'s
`bossWithBump` mesh is a compound of 47 solids: the body (72 faces of its
first shell) and 46 two-face shells of zero volume; Offset Face refuses it
("the solid has an inner void"). Not followed up here.

### Amendment, 2026-10-25b: the mesh's own degenerate components, and a flat face on a faceted body

Measured through the raw facade and `Kernel` on the app's WASM (Vitest), the
fixture `mesh-to-solid.test.ts`'s `bossWithBump`: a 30 × 30 × 10 box with a
48-segment cylinder r 5, h 6 standing at z = 10 (its base **coplanar** with the
box top), refined (6) and its top warped into a 2 mm tilted bump.

**Cause, in the mesh, not in the rebuild.** `manifold-3d` reports the fixture's
mesh as **47 connected components** (`part.decompose()`; status NoError): the
body, 4,934 triangles, and **46 components of exactly 10 triangles** each,
**flat at z = 10.000**, tiny (fractions of a millimetre), their nodes 4.5–4.95 mm
from the boss axis, i.e. just inside the boss's r 5 base circle. The coplanar
union of the box top and the cylinder base leaves thin zero-volume closed flaps;
manifold calls each a valid manifold piece. Their signed volumes are 0 to
5e-16 mm³. The hybrid (and faceted) build **one solid per connected component**
(`rebuildHybrid`, `facets` then `byShell`; `facetedFromMesh`'s face components),
so the result is a compound of **47 solids**: the body (1,608 faces after unify,
volume 9,548.60 mm³, rebuild hybrid, 0.01 mm) and 46 solids of **2 faces** each
(10 coplanar facets unify to their front and back) and **zero volume**.
`kernel.isValid` is true and the volume is within ±1 %, so no existing test
noticed; `offsetFaces` sees 47 shells and refuses the body ("the solid has an
inner void", status 4).

**Fix 1, at the mesh (facade).** `dropDegenerateComponents()` runs at the top of
`meshToSolid`: it groups the staged triangles by shared edge (as
`segmentMesh` does), sums each component's signed volume, and removes every
**closed** component (every edge shared by exactly two of its triangles) with
**|V| ≤ 1e-6 × max(1, |mesh volume|)**, compacting the node and triangle
buffers. So neither the faceted nor the prismatic path ever builds a
solid, a shell or a facet from one, and the hybrid's node-vs-solid check never
sees a node of a component that is gone. A component with volume (a part) and
one with negative volume (a cavity) both stay, and so does an open component
(a boundary or a non-manifold edge), which is the path's to refuse, not this to
drop. The conversion of `bossWithBump` becomes **1 solid, 1 shell** (1,608
faces, 1,596 facets, 4 cylinders, 8 planes, unfit 1 region / 1,628 triangles),
the same body as before but alone.

**Fix 2, in Offset Face, because the inner-void refusal hid the next one.** With
the body alone, `offsetFaces` on its bottom face (the box's z = 0 plane) then
fails on the **smooth-chain guard** (status 6, "rounded edges meet at a sharp
corner") rather than the inner void: the bump's 1,596 facets and the 4 small
cylinders the hybrid fits to its flanks are, in OCCT's 4° tangent test, **one
smooth chain of 115 faces with creases inside it** (facets ~14° apart — dot
0.969–0.973 — reached through < 4° steps). That guard exists because
`BRepOffset_MakeOffset` traps the wasm heap on a body where **two fillets meet
at a corner**. The **flat-face prism fallback** (`buildPrismOffset`) never calls
OCCT's offset, so `offsetFaces` now tries it, before keeping the refusal, when
the chain's creases are **not between two non-planar faces** (a converted body's
chain is plane/plane and plane/a fitted cylinder: `smoothChains` reports that in
a `curvedCrease` out-parameter). On `bossWithBump` the gate passes (the bottom
face is a plane; its neighbours are the box's four side planes, square to it),
and the box's bottom rises 1 mm for +900 mm³. A fillet-corner body (two
cylinders at a crease: `kernel.test.ts`'s and `offset-face.test.ts`'s rounded
corners), a non-flat pick, or a gate the fallback can't pass all keep the
status-6 refusal unchanged, and **OCCT's offset is never reached for any of
them**, so the guard's protection is intact.

**Rejected.**
- *Dropping the degenerate **shells** after `BRepBuilderAPI_MakeSolid`, not the
  mesh triangles.* Their triangles stay staged, so the hybrid's node check
  (`trianglesOf`, `for n in 0..nodeCount`) validates the flaps' nodes against a
  `result` that no longer has their faces: they are off the solid by 0.05–0.5 mm
  (inside the boss footprint, on no face), their regions explode twice and the
  build refuses ("a node off its face"). The drop must be at the mesh, before
  the segmentation.
- *Keeping the flaps but merging them into the main shell* (one solid for all
  components): `MakeSolid` needs a connected shell, and `UnifySameDomain` does
  not absorb coincident internal faces that share no edge.
- *A zero-volume component as a cavity*: a cavity is a **negative** volume below
  the threshold (already the rule); a flat flap is not.
- *Removing the smooth-chain guard*: it protects OCCT's offset from a heap trap
  for every body, not only a converted one; the safe fallback is tried first
  instead.
- *Changing the fixture* so the box top and cylinder base are not coplanar: a
  slicer's or a mesh tool's union can leave such flaps, so the conversion has to
  handle them.

The mesh-region **preview** (`meshRegions` / `meshLoopsDebug`) still segments the
staged mesh as staged — its per-triangle array has to line up with the view
mesh's triangles — so a degenerate flap still shows as an (unfit) region there;
only the conversion drops it.

Test (`mesh-to-solid.test.ts`, the hybrid describe): `bossWithBump` converts to
one solid and one shell (a `shells` helper reads the STEP writer's one
`CLOSED_SHELL` per shell), and `offsetFaces` on the box's bottom by 1 mm gives
+900 mm³ within 0.5 %. The `mesh-to-solid-files.test.ts` fixtures are unchanged.


### Amendment, 2026-10-25c: the tangent line where a plane meets a fillet's cylinder — tried, not kept (slice D5)

The D3 sweep's own "what stays a polyline" list names 869 plane|cylinder
chains, "a plane meant to be tangent to a fillet's cylinder, a little off":
`surfaceCurves` returns `no curve: empty` (or two near-coincident lines the
chain's nodes miss) and the chain stays the mesh polyline. stl2step builds
the tangent line there (its `refit.hpp`, tier 1); slice D5 tried it in two
shapes and **did not keep it** — the numbers are below the bar.

**What was built.** In the facade's `surfaceCurves`, the plane|cylinder
case: when the plane's normal is square to the cylinder's axis within 1°
(`|n·A| ≤ sin 1°`) and the plane's distance from the axis is within
`2 ×` the tolerance of the radius (`|d − r| ≤ 2 T`), build the cylinder's
tangent line on the plane's side — through `O − sign(s)·r·n`
(`s = (O − P0)·n`) along the axis projected into the plane (`A − (A·n)n`,
normalised), one line of type 0 — with the fitted surfaces unchanged.
Two shapes were tried:

1. **Replace IntAna.** Return the tangent line before calling IntAna,
   whenever the condition holds. This changed the chain only where IntAna
   yielded no curve; it also turned a chain IntAna had collapsed into a
   polyline on **puzzle-insert-circle** at Auto (8 more edges), so it was
   narrowed.
2. **Add it as a candidate.** `surfaceCurves` appends the tangent line to
   IntAna's curves, and `chainCurve` tries IntAna's curves first (nearer
   first) and the tangent line only where none of them passes the node,
   monotone and span checks — so a pair IntAna handles never moves, and the
   869 are reached when their IntAna curve's nodes miss. This is the second
   attempt the review asked for.

**The numbers** (kernel sweep over `STL_DIR`, `mesh-to-solid-files.test.ts`,
`TOL=auto`, the 37 convertible STLs, base WASM `occt-e1e731c1fd29` against
attempt 2's `occt-59ba5782c2cd`, one process each on the Ubuntu machine):

| file | outcome | faces | facets | edges before → after | circles | volume |
|---|---|---|---|---|---|---|
| own/battery-power-adapter | hybrid | 994 | 415 | 3,930 → 3,925 | 37 | 1.0004 |

Exactly **one** file of the 37 moved (attempt 1's narrower rule: 3,930 →
3,928); every other file's outcome, faces by kind, facets, circles, volume
(within ±1 %) and validity is unchanged, and none got worse (no refusal, no
extra facets, no volume drift). The committed fixtures
(`mesh-to-solid-files.test.ts`'s eight STLs) are unchanged too. The brief's
bar to keep the rule was edges down in at least three files; one file is
below it, so the facade change is reverted entirely (the facade is back to
the base, its WASM input hash `occt-e1e731c1fd29` again, so no new build)
and no test or changelog change goes with it.

**Why a synthetic test cannot reach it.** The brief asked for a rounded box
whose fitted plane misses tangency by 0.01–0.02 mm at 0.01 mm. It cannot be
built: the plane and the cylinder share the chain's seam nodes, each fit's
deviation from them is bounded by the same tolerance `T` that IntAna is
given, so `|d − r| ≤ T` for any such mesh, and IntAna snaps a plane within
`T` of tangency to the line the chain's nodes lie on. A mesh built to miss
by more than `T` makes the cylinder or the plane unfit instead (its own
deviation exceeds `T`). A sweep of 200 rounded-box perturbations (segment
count, `refine`, radial pull, sideways shift, whole-mesh noise) found no
configuration where the rule changes the chain; it fires on real noisy
meshes, where the fits' binding nodes are not the chain's.

**Also harness-only.** `hybridChainsKept_` (the "kept as polylines: … near
tangent, node off …" line) is printed by the native `spikes/stl-to-solid`
harness, which needs the OCCT static libraries and is built with Docker on
the Arch workstation; on the Ubuntu machine the count is not readable
through the WASM facade, so the tables here report the sweep's edge deltas.

### Amendment, 2026-10-25d: whiteboard-tray-v5's slow refusal measured — no safe early point

The D4 amendment's open item: `own/whiteboard-tray-v5.stl` at Auto is refused
after ~45 s (now 42.8 s) where the hybrid alone runs to its refusal. Slice 2
measured it through the facade's `stage(...)` timings (a temporary
`takeStageTimes()` accessor, removed again) and found **no safe point to
refuse earlier**: the cost is the `ShapeFix_Shape` heal, which is
load-bearing, and cutting it still leaves ~16 s, over the 15 s bar.

**Where the 42.8 s goes.** Auto picks 0.02 mm (the ladder's second step:
0.01 gives 58.9 % unfit, 0.02 gives 0.1 %; the whole ladder plus segmentation
is 220 ms). The hybrid then builds three times (slice D1's three, plus the
undo path): 0.02 mm, 3 unfit regions, one solid. Per attempt, in ms
(`TIMES`-style `stage()` names):

| attempt | chain curves | faces | solid | unified | **healed** | validity/next | estimate | heal valid? |
|---|---|---|---|---|---|---|---|---|
| 0 (undo 1 collapse) | 20 | 668 | 1,714 | 477 | **8,223** | 2,101 | 527 | no |
| 1 (explode 1 region) | 21 | 301 | 1,789 | 503 | **9,845** | 2,159 | 622 | no |
| 2 (refuse) | 21 | 273 | 1,858 | 520 | **8,507** | – | 644 | no |

The last line: `cellsValid 0 culprits 0 solids 1 faces 5382` — the single
solid fails `BRepCheck` after all three builds and there is no region left to
explode, so `refuse("invalid")` (the user still sees the same message: `Mesh
to Solid couldn't rebuild this mesh as an exact solid within 0.02 mm. Use
Faceted, or simplify the mesh in your slicer.`). The **heal is 26.6 s of the
42.8 s (62 %)**: `ShapeFix_Shape` on the assembled result, run whenever
`BRepCheck` fails, which for this mesh is every attempt. `solid`
(`MakeSolid` + `ShapeFix_Solid` + volume) is 5.4 s, `unified`
(`UnifySameDomain` + `straightenSeams`) 1.5 s, `faces` 1.2 s, the validity
passes (`BRepCheck` + the culprit map) 4.3 s.

**Why no early point.** The brief's two examples do not apply: the hybrid's
`facetEstimate()` is **527 / 622 / 644**, far under the 5,000 cap (the early
estimate refusal fires above 7,500), and the Auto ladder runs each rung once
(0.01, 0.02) and stops — no repeated rung. Nor is any retry provably futile:
attempt 0 undoes a collapsed chain and attempt 1 explodes a region, both real
changes (the D1–D3 retries exist for other meshes and would be needed for
them), and attempt 2 only learns `culprits 0` by building again. Cutting the
`ShapeFix_Shape` heal outright — not provably safe, since files where unify's
moved edges only need their tolerances raised rely on it — leaves
42.8 − 26.6 = **16.2 s**, still over the 15 s acceptance, and skipping a
rebuild on top of that is not safe. So slice 2 records the measurement and
makes **no change**: the facade is back to the base (input hash
`occt-e1e731c1fd29`; no new build), no test and no changelog fragment.

**Measured with** (`mesh-to-solid-files.test.ts` and a scratch harness over
`STL_DIR`, at Auto on the Ubuntu machine): the kernel's `meshToSolid` refuses
in 42,915 ms with the same message; the raw facade with the kernel's own
(manifold) welding refuses in 42,278 ms, `meshRefusalDebug` reporting `hybrid:
invalid | exploded 0`; a 1e-6-rounding weld instead converts in 10.8 s with 7
exploded regions, so the result is weld-sensitive — one more reason not to
widen any rule here. The same numbers on the intermediate WASM
`occt-234b03194dc6` (the `takeStageTimes` builds) and `occt-9c885cd89a84`.

### Amendment, 2026-10-25e: the preview drops what the conversion drops (slice D6)

The 2026-10-25b amendment's own note: `dropDegenerateComponents` runs at the
top of `meshToSolid`, so the conversion never sees a mesh's flat zero-volume
flaps, but `meshRegions` (the dialog's region preview) and `meshLoopsDebug`
segmented the staged mesh as-is. On `bossWithBump` (a box with a cylinder r 5
standing coplanar on its top: the body plus **46 flat zero-volume
components**) the preview read **100 plane surfaces** where the conversion
makes **8** — 92 of them the flaps' front and back — so the dialog showed and
counted regions the conversion would not build.

**Rule (facade).** `dropDegenerateComponents` is split into
`degenerateDropMask(keep, dropped)` (the per-triangle keep mask: 1 for a
triangle of a component that stays — positive volume a part, negative a
cavity, open the path's to refuse — 0 for a flat closed zero-volume flap) and
`compactStagedMesh(keep)` (the in-place compaction). `meshToSolid` runs both,
unchanged. `meshRegions` and `meshLoopsDebug` now compute the mask first and
segment the **compacted** mesh:

- `meshRegions` keeps the staged buffers, builds the compacted copy
  (`compactedStagedMesh`, with `origOf`: each kept triangle's original index),
  segments that (its `meshReport_` counts, unfit share and suggested tolerance
  are the conversion's), restores the staged buffers and maps each surface
  back to the original triangle order. `meshRegionOf_` keeps the **original**
  triangle count (the view mesh lines up with it); a dropped triangle takes
  the surface of a kept triangle sharing a node with it, else -1 (a flap's
  nodes are its own, so -1).
- `meshLoopsDebug` compacts in place and segments that, so its regions, loops
  and chains are the conversion's (its output is region- and chain-level, no
  per-triangle array).

The 2026-10-25b rejected option ("dropping only the shells") stays rejected:
the drop is at the mesh, before any segmentation. No schema change.

**Test** (`mesh-to-solid.test.ts`, `Kernel.meshRegions`): `bossWithBump`'s
preview has `surfaceOf.length` = the view mesh's triangle count (5,218),
`unfit.regions` = the conversion's report (1), and `planes`/`cylinders` = the
report's (8/4, where the base WASM gave 100 planes). On the base WASM the
test fails at `expected 100 to be 8`.

### Amendment, 2026-10-30: the STEP round trip checked, sweep baselines (slice D7)

stl2curves (an MIT Python STL→STEP converter) learned the hard way that a STEP
file keeps no tolerances: a reader works them out again from the geometry,
tightly, so a face that was only valid thanks to a generous edge tolerance
comes back broken. The hybrid rebuild raises edge tolerances up to
`HYBRID_EDGE_TOLERANCE_MAX` (1 mm, the 2026-10-23 amendment) and nothing wrote
a converted body to STEP and read it back. Slice D7 adds **checks only**: no
converter change, so this amendment also records where the bar fails today.

**The check.** `mesh-to-solid-test-support.ts` (a plain module the two
mesh-to-solid test files import) has `stepRoundTrip(kernel, shape, name)`: it
writes `shape` to STEP (`Kernel.writeStep`), reads it back
(`Kernel.readStep`), releases everything it made and returns a measurement —
`valid` (`isValid`), `faces` (`count(back, 'face')`), `solids`
(`solids(back).length`), `volumeRatio` (`properties(back).volume /
properties(shape).volume`) and `bytes` — never throwing on a bad result: it
measures. `expectStepRoundTrip` asserts the bar: the read-back body is valid,
keeps the face and solid counts, and the volume is the written body's within
1e-4. Every converted-body test case calls it (in the existing `try`, after
the existing assertions); every new such case must too. A case that misses
the bar keeps all its own assertions and, under a `tripFails` flag with the
numbers in a comment, asserts `expect(() => expectStepRoundTrip(…)).toThrow()`
instead — the failure is pinned, so a fix flips it; never loosen or delete.

**Where the bar fails today (all pinned with `tripFails`, all hybrid, both
prismatic fixture passes — one entry per tolerance):**

| case | faces | solids | read back | volumeRatio |
|---|---|---|---|---|
| peg-perego-button.stl 0.01 mm (670 facets) | 892 → 892 | 1 → 1 | invalid | 0.99979 |
| peg-perego-button.stl Auto (0.02 mm) | 212 → 214 | 1 → 1 | invalid | 1.00012 |
| drill-block.stl 0.01 mm (208 facets) | 388 → 388 | 1 → 1 | invalid | 0.999998 |
| drill-block.stl Auto (0.01 mm, same build) | 388 → 388 | 1 → 1 | invalid | 0.999998 |
| track-straight-100mm.stl 0.1 mm | 79 → 79 | 1 → 1 | valid | 1.00127 |

The synthetic cases of `mesh-to-solid.test.ts` (58, faceted and prismatic,
boxes to the 602-face staircase, the boss's freeform top, the re-seamed band)
all pass the bar. Fixing the converter — the reader's tight tolerances land
mostly on the hybrid's rebuilt faces and on facets sewn to them — is the next
slice.

**The sweep keeps itself honest.** The `STL_DIR` sweep gains
`SWEEP_OUT=<file>.jsonl` (one JSON line per file: both methods' report,
validity, volume ratio, ms and the STEP round trip — the measuring form, the
sweep's own bar is below) and `SWEEP_BASELINE=<file>.jsonl`: against the
previous run's line for that file, a file **fails** when it is refused where
it converted, when prismatic's or faceted's faces exceed the baseline's by
more than 10 % (fewer faces mean more of the part was recognised; going down
passes), or when its STEP read-back was valid there and keeps the face count
there but not now. A file with no baseline line passes; refused in both
passes. The comparison prints on the row (`baseline 212 faces → 230
(+8.5 %)`), and a last `it('sweep totals')` prints both runs' numbers (files,
converted/refused per method, prismatic faces, ms, round trips failed).

**First run** (the owner's 41-STL corpus, Auto, Ubuntu machine): files 41;
prismatic converted 36, refused 5 (3 at `meshFrom`: open edges or a face of
fewer than three corners; whiteboard-tray-v5's known slow refusal);
faceted converted 25, refused 16 (14 over the 5,000-face cap, 2 mesh
refusals); prismatic faces 27,706; prismatic 236 s, faceted 104 s of kernel
time; **round trips failed 17** of 36 prismatic conversions (0 faceted): the
fixture table's files plus battery-power-adapter (994 → 998, invalid),
desk-organizer-module-small (418 → 418, invalid), kuglbahn-pillar-base (3941
→ 3942, invalid), mirna-doodle-1 (120 → 120, valid, volumeRatio 0.99917),
phone-stand-foldable (2325 → 2340, invalid, 0.98062), puzzle-insert-circle
(1609 → 1609, valid, 1.00045), shower-holder (901 → 901, invalid),
spool-nut-v4.1 (718 → 718, valid, 0.99965), spool-screw-v4.1 (3197 → 3197,
valid, 0.99856), gear-bearing-5 (2308 → 2392, invalid, 7 solids),
hot-wheels-connector (2015 → 2016, invalid), makita-vacuum-holder (3480 →
3482, invalid, **0 solids**), micro-sd-keyring-inner (66 → 66, valid,
0.99926), spaghetti-measure (165 → 165, valid, 1.00013), vented-funnel (715 →
715, invalid). Second run on one file (`FILE=own/trashcan-spacer.stl`)
against the first run's baseline passes against itself, the comparison path
works. **Converter fixes are the next slice.**

### Amendment, 2026-10-30b: the STEP read-back failures measured (diagnosis, no fix)

Slice D7 recorded *that* the bar fails. This amendment records *where*, measured
by two new spike-harness cases — no converter change. `s` is case `f` on one
corpus file (`STL_DIR` mounted at `/stl`, `FILE`, `TOL`, `TOL=auto` allowed):
it converts, writes the body to STEP, reads it back and prints the reader and
writer settings in force, the written body's edges by class and tolerance
buckets, the read-back `shapeDiagnose` summary and BRepCheck statuses by name,
the invalid edges by class and invalid faces by kind, the summed area per face
kind written against read back, and a `ShapeFix_Shape` pass at the written edge
tolerance. `S` does the same for every file in one process and ends with one
Markdown summary row per file. Run (Ubuntu machine, the pinned OCCT image):

```sh
STL_DIR=~/Development/extrudo-stl-solid-test TOL=auto BUILD=diag \
  bash spikes/stl-to-solid/run.sh prismatic S
```

**The mesh order, and why this run reads differently from the sweep.** The
spike stages the STL in the file's own triangle order (`stlFile`, `RWStl`),
while the kernel sweep imports through `meshFrom`, which orders a mesh as
manifold's `getMesh()` does (the note already in the spike README, 2026-10-21).
Segmentation depends on that order, so the two runs convert the same file to
slightly different bodies. This run: 9 exact rebuilds, 30 hybrids, 2 refusals
(grass-for-flower, mms-m5-nut). **20 of the 30 hybrid conversions miss the D7
bar** (read-back valid, the same face and solid counts, volume within 1e-4):
the sweep's 17 all miss here too, plus whiteboard-tray-v5 and hex-key-cap-3mm
(both refusals in the sweep's order, converted here) and sock-clips-6x (a pass
in the sweep, invalid here). chip-bag-clip-small, a refusal in the sweep,
converts and passes here. Face counts differ from the sweep's for
battery-power-adapter (995 vs 994), kuglbahn-pillar-base (3930 vs 3941),
phone-stand-foldable (2329 vs 2325), spool-screw-v4.1 (2915 vs 3197),
gear-bearing-5 (2330 vs 2308) and hot-wheels-connector (2518 vs 2015); the
other eleven match. Every number below is this run's.

**Reader and writer settings in force (Q5, once per run).** The harness calls
`STEPControl_Controller::Init()` before reading them (the parameters only exist
after it, or after a `STEPControl_Writer`/`Reader` constructor); read without it
every value comes back 0. Measured:
`write.precision.mode 0` (Average), `write.precision.val 0.001`,
`write.surfacecurve.mode 1` (On), `read.precision.mode 0` (File),
`read.precision.val 0.001`, `read.surfacecurve.mode 0` (Default),
`read.stdsameparameter.mode 0` (Off). The meanings, confirmed against the
pinned OCCT (OCCT 8.0.1) sources:
`write.precision.mode` is `DESTEP_Parameters::WriteMode_PrecisionMode` —
Least −1, Average 0, Greatest 1, Session 2 (uses `write.precision.val`);
Average takes the shape's mean tolerance, Greatest its largest, both rounded by
`Interface_MSG::Intervalled` to 1/2/5. `read.precision.mode` is
`ReadMode_Precision` — File 0 (the reader's precision is the file's
`UNCERTAINTY_MEASURE_WITH_UNIT`) or Session 1 (`read.precision.val`). The
brief's "0 = Least … 3 = Session" and "mode 2 = Greatest" are off by one from
the enum in this build; the numbers above are the enum's.

**Summary table (Q6; one row per file, as `S` prints it).**

| file | rebuild | tol | faces | facets | max edge tol written | max vertex tol written | back valid | back faces | back solids | ratio | back invalid edges | back invalid faces | top status | fix valid | fix faces | fix ratio | u2 valid | u2 faces | u2 solids | u2 ratio | uncertainty |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| own/ball.stl | exact | 0.01 | 1 | 0 | 1e-07 | 1e-07 | valid | 1 | 1 | 1 | 0 | 0 | - | valid | 1 | 1 | valid | 1 | 1 | 1 | 1e-07 |
| own/battery-holder.stl | hybrid | 0.01 | 131 | 0 | 0.0168194 | 0.0168194 | valid | 131 | 1 | 1 | 0 | 0 | - | valid | 131 | 1 | valid | 131 | 1 | 1 | 0.02 |
| own/battery-power-adapter.stl | hybrid | 0.1 | 995 | 416 | 0.164814 | 0.164814 | invalid | 999 | 2 | 0.999899 | 0 | 2 | face BadOrientationOfSubshape x1 | invalid | 1000 | 0.999898 | invalid | 999 | 2 | 0.999298 | 0.2 |
| own/desk-organizer-module-small.stl | hybrid | 0.01 | 418 | 42 | 0.0153582 | 0.0153582 | invalid | 418 | 1 | 0.999998 | 0 | 1 | face BadOrientationOfSubshape x1 | invalid | 418 | 0.999998 | invalid | 418 | 1 | 0.999958 | 0.02 |
| own/drill-block.stl | hybrid | 0.01 | 388 | 208 | 0.58915 | 0.58915 | invalid | 388 | 1 | 0.999998 | 0 | 2 | face UnorientableShape x2 | invalid | 388 | 0.999998 | valid | 388 | 1 | 0.999999 | 0.5 |
| own/grass-for-flower.stl | refused | 0.1 | 0 | 0 | 0 | 0 | invalid | 0 | 0 | 0 | 0 | 0 | - | invalid | 0 | 0 | invalid | 0 | 0 | 0 | -1 |
| own/hole-filler-35mm.stl | exact | 0.01 | 6 | 0 | 1e-06 | 1e-06 | valid | 6 | 1 | 1 | 0 | 0 | - | valid | 6 | 1 | valid | 6 | 1 | 1 | 1e-06 |
| own/hole-filler-5mm.stl | exact | 0.01 | 6 | 0 | 1e-07 | 1.00001e-07 | valid | 6 | 1 | 1 | 0 | 0 | - | valid | 6 | 1 | valid | 6 | 1 | 1 | 1e-07 |
| own/kuglbahn-pillar-base.stl | hybrid | 0.1 | 3930 | 3398 | 0.229375 | 0.229375 | invalid | 3931 | 1 | 0.999357 | 0 | 6 | face UnorientableShape x3 | invalid | 3938 | 0.998435 | invalid | 3931 | 1 | 0.999166 | 0.2 |
| own/mirna-doodle-1.stl | hybrid | 0.1 | 120 | 43 | 0.151169 | 0.151169 | valid | 120 | 5 | 0.999174 | 0 | 0 | - | valid | 120 | 0.999174 | valid | 120 | 5 | 1.0032 | 0.2 |
| own/numbers-base-top.stl | exact | 0.01 | 471 | 0 | 1.5e-07 | 1.5e-07 | valid | 471 | 1 | 1 | 0 | 0 | - | valid | 471 | 1 | valid | 471 | 1 | 1 | 2e-07 |
| own/object-permanence-base.stl | hybrid | 0.01 | 1985 | 1620 | 0.163989 | 0.163989 | valid | 1985 | 1 | 0.999986 | 0 | 0 | - | valid | 1985 | 0.999986 | valid | 1985 | 1 | 1.00001 | 0.2 |
| own/peg-perego-button.stl | hybrid | 0.02 | 212 | 0 | 0.044735 | 0.308934 | invalid | 214 | 1 | 1.00013 | 0 | 4 | face UnorientableShape x3 | invalid | 214 | 1.00013 | invalid | 214 | 1 | 0.99996 | 0.2 |
| own/phone-stand-foldable.stl | hybrid | 0.1 | 2329 | 1852 | 0.271369 | 0.271369 | invalid | 2346 | 2 | 0.979189 | 0 | 18 | face UnorientableShape x8 | invalid | 2355 | 0.996416 | invalid | 2346 | 2 | 1.00331 | 0.2 |
| own/puzzle-base-circle.stl | exact | 0.01 | 37 | 0 | 1.5e-07 | 1.5e-07 | valid | 37 | 1 | 1 | 0 | 0 | - | valid | 37 | 1 | valid | 37 | 1 | 1 | 2e-07 |
| own/puzzle-insert-circle.stl | hybrid | 0.05 | 1609 | 1230 | 0.0811348 | 0.0811348 | valid | 1609 | 1 | 1.00045 | 0 | 0 | - | valid | 1609 | 1.00045 | valid | 1609 | 1 | 1.00045 | 0.1 |
| own/remove-before-flight-cover.stl | hybrid | 0.01 | 438 | 120 | 0.872458 | 0.872458 | valid | 438 | 1 | 1.00002 | 0 | 0 | - | valid | 438 | 1.00002 | valid | 438 | 1 | 1.00002 | 1 |
| own/scrap-plate.stl | hybrid | 0.02 | 154 | 0 | 0.034724 | 0.034724 | valid | 154 | 1 | 0.999994 | 0 | 0 | - | valid | 154 | 0.999994 | valid | 154 | 1 | 0.999994 | 0.05 |
| own/shower-holder.stl | hybrid | 0.01 | 901 | 472 | 0.0159189 | 0.0159189 | invalid | 901 | 1 | 1.00005 | 0 | 2 | face BadOrientationOfSubshape x2 | invalid | 901 | 1.00005 | invalid | 901 | 1 | 1.00009 | 0.02 |
| own/spool-nut-v4.1.stl | hybrid | 0.01 | 718 | 0 | 0.0158714 | 0.0158714 | valid | 718 | 1 | 0.999655 | 0 | 0 | - | valid | 718 | 0.999655 | valid | 718 | 1 | 1.00019 | 0.02 |
| own/spool-screw-v4.1.stl | hybrid | 0.05 | 2915 | 1841 | 0.0795326 | 0.0795326 | valid | 2915 | 0 | 0.998541 | 0 | 0 | - | valid | 2915 | 0.998541 | valid | 2915 | 0 | 1.00021 | 0.1 |
| own/track-straight-100mm.stl | hybrid | 0.01 | 306 | 237 | 0.0137019 | 0.0137019 | valid | 306 | 1 | 1.00001 | 0 | 0 | - | valid | 306 | 1.00001 | valid | 306 | 1 | 1 | 0.02 |
| own/trashcan-repair-foot.stl | exact | 0.01 | 16 | 0 | 1.5e-07 | 1.5e-07 | valid | 16 | 1 | 1 | 0 | 0 | - | valid | 16 | 1 | valid | 16 | 1 | 1 | 2e-07 |
| own/trashcan-spacer.stl | hybrid | 0.05 | 78 | 0 | 0.0450076 | 0.0450076 | valid | 78 | 1 | 1.00001 | 0 | 0 | - | valid | 78 | 1.00001 | valid | 78 | 1 | 1 | 0.05 |
| own/whiteboard-tray-v5.stl | hybrid | 0.02 | 1302 | 622 | 0.826073 | 0.826073 | invalid | 1302 | 1 | 1.06794 | 0 | 3 | face BadOrientationOfSubshape x2 | invalid | 1307 | 1.06794 | invalid | 1302 | 1 | 1.06825 | 1 |
| third-party/chip-bag-clip-small.stl | hybrid | 0.01 | 757 | 500 | 0.0145976 | 0.0145976 | valid | 757 | 0 | 0.999923 | 0 | 0 | - | valid | 757 | 0.999923 | valid | 757 | 0 | 0.999645 | 0.02 |
| third-party/door-stopper-top.stl | hybrid | 0.01 | 147 | 0 | 0.0163259 | 0.0163259 | valid | 147 | 1 | 0.99999 | 0 | 0 | - | valid | 147 | 0.99999 | valid | 147 | 1 | 0.999976 | 0.02 |
| third-party/gardena-end.stl | hybrid | 0.01 | 17 | 0 | 0.0564495 | 0.0564495 | valid | 17 | 1 | 1.00001 | 0 | 0 | - | valid | 17 | 1.00001 | valid | 17 | 1 | 1.00001 | 0.05 |
| third-party/gear-bearing-5.stl | hybrid | 0.1 | 2330 | 1444 | 0.754246 | 0.754246 | invalid | 2414 | 7 | 0.998211 | 0 | 52 | face BadOrientationOfSubshape x46 | invalid | 2414 | 0.998211 | invalid | 2414 | 7 | 0.999389 | 1 |
| third-party/hex-key-cap-3mm.stl | hybrid | 0.02 | 4590 | 3470 | 0.0347333 | 0.0347333 | valid | 4591 | 0 | 1.00297 | 0 | 0 | - | valid | 4591 | 1.00297 | valid | 4591 | 0 | 1.0012 | 0.05 |
| third-party/hot-wheels-connector.stl | hybrid | 0.01 | 2518 | 2318 | 0.0286497 | 0.0286497 | invalid | 2519 | 1 | 1.00027 | 0 | 8 | face BadOrientationOfSubshape x6 | invalid | 2520 | 1.00027 | invalid | 2519 | 1 | 1.0001 | 0.02 |
| third-party/makita-vacuum-holder.stl | hybrid | 0.05 | 3480 | 2662 | 0.581547 | 0.581547 | invalid | 3481 | 1 | 0.999774 | 0 | 1 | face UnorientableShape x1 | invalid | 3481 | 0.999774 | invalid | 3480 | 1 | 1.00008 | 0.5 |
| third-party/micro-sd-keyring-inner.stl | hybrid | 0.01 | 66 | 18 | 0.999885 | 0.999885 | valid | 66 | 1 | 0.99926 | 0 | 0 | - | valid | 66 | 0.99926 | valid | 66 | 1 | 0.999918 | 1 |
| third-party/micro-sd-keyring-outer.stl | exact | 0.01 | 41 | 0 | 1.5e-07 | 1.5e-07 | valid | 41 | 1 | 1 | 0 | 0 | - | valid | 41 | 1 | valid | 41 | 1 | 1 | 2e-07 |
| third-party/mms-camera-mount.stl | exact | 0.01 | 11 | 0 | 1.5e-07 | 1.5e-07 | valid | 11 | 1 | 1 | 0 | 0 | - | valid | 11 | 1 | valid | 11 | 1 | 1 | 2e-07 |
| third-party/mms-flat-stand.stl | exact | 0.01 | 44 | 0 | 0.000220075 | 0.0002214 | valid | 44 | 1 | 1 | 0 | 0 | - | valid | 44 | 1 | valid | 44 | 1 | 1 | 0.0002 |
| third-party/mms-m5-nut.stl | refused | 0.02 | 0 | 0 | 0 | 0 | invalid | 0 | 0 | 0 | 0 | 0 | - | invalid | 0 | 0 | invalid | 0 | 0 | 0 | -1 |
| third-party/sock-clips-6x.stl | hybrid | 0.01 | 163 | 97 | 0.187077 | 0.187077 | invalid | 163 | 1 | 1.00012 | 0 | 1 | face UnorientableShape x1 | invalid | 163 | 1.00012 | invalid | 163 | 1 | 1.00012 | 0.2 |
| third-party/spaghetti-measure.stl | hybrid | 0.01 | 165 | 55 | 0.786253 | 0.786253 | valid | 165 | 1 | 1.00013 | 0 | 0 | - | valid | 165 | 1.00013 | valid | 165 | 1 | 0.999967 | 1 |
| third-party/vented-funnel.stl | hybrid | 0.02 | 715 | 86 | 0.500955 | 0.500955 | valid | 715 | 1 | 0.999155 | 0 | 0 | - | valid | 715 | 0.999155 | valid | 715 | 1 | 0.999121 | 0.5 |
| third-party/wyze-garage-bracket.stl | hybrid | 0.01 | 84 | 0 | 0.0124522 | 0.0124522 | valid | 84 | 2 | 1.00001 | 0 | 0 | - | valid | 84 | 1.00001 | valid | 84 | 2 | 1.00001 | 0.01 |

**Second summary table (Q9-Q12; one row per file, as `S` prints it).**

| file | rebuild | brep valid | brep faces | brep solids | brep ratio | healed valid | healed faces | healed rt valid | healed rt faces | healed rt solids | healed rt ratio | nopc valid | nopc faces | nopc solids | nopc ratio | pref2d valid | pref2d faces | pref2d solids | pref2d ratio | flagged wires | min edge in flagged | edges < uncertainty | written vertices->back vertices | written edges->back edges |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| own/ball.stl | exact | valid | 1 | 1 | 1 | valid | 1 | valid | 1 | 1 | 1 | valid | 1 | 1 | 1 | valid | 1 | 1 | 1 | 0 | 0 | 0 | 2->2 | 3->3 |
| own/battery-holder.stl | hybrid | valid | 131 | 1 | 1 | valid | 131 | valid | 131 | 1 | 1 | valid | 131 | 1 | 0.999992 | valid | 131 | 1 | 1 | 0 | 0 | 0 | 372->372 | 470->470 |
| own/battery-power-adapter.stl | hybrid | valid | 995 | 2 | 1 | valid | 995 | invalid | 999 | 2 | 0.999899 | invalid | 999 | 2 | 0.999896 | invalid | 999 | 2 | 0.999899 | 0 | 0 | 0 | 2940->2944 | 3931->3941 |
| own/desk-organizer-module-small.stl | hybrid | valid | 418 | 1 | 1 | valid | 418 | invalid | 418 | 1 | 0.999998 | invalid | 418 | 1 | 1.00002 | invalid | 418 | 1 | 0.999998 | 0 | 0 | 0 | 6522->6522 | 6929->6929 |
| own/drill-block.stl | hybrid | valid | 388 | 1 | 1 | valid | 388 | invalid | 388 | 1 | 0.999998 | invalid | 388 | 1 | 0.999998 | invalid | 388 | 1 | 0.999998 | 2 | 0.242139 | 0 | 872->872 | 1251->1251 |
| own/grass-for-flower.stl | refused | invalid | 0 | 0 | 0 | invalid | 0 | invalid | 0 | 0 | 0 | invalid | 0 | 0 | 0 | invalid | 0 | 0 | 0 | 0 | 0 | 0 | 0->0 | 0->0 |
| own/hole-filler-35mm.stl | exact | valid | 6 | 1 | 1 | valid | 6 | valid | 6 | 1 | 1 | valid | 6 | 1 | 1 | valid | 6 | 1 | 1 | 0 | 0 | 0 | 6->6 | 9->9 |
| own/hole-filler-5mm.stl | exact | valid | 6 | 1 | 1 | valid | 6 | valid | 6 | 1 | 1 | valid | 6 | 1 | 1 | valid | 6 | 1 | 1 | 0 | 0 | 0 | 6->6 | 9->9 |
| own/kuglbahn-pillar-base.stl | hybrid | valid | 3930 | 1 | 1 | valid | 3930 | invalid | 3931 | 1 | 0.999357 | invalid | 3931 | 1 | 0.999333 | invalid | 3931 | 1 | 0.999357 | 3 | 0.0155792 | 1 | 6335->6335 | 10264->10266 |
| own/mirna-doodle-1.stl | hybrid | valid | 120 | 5 | 1 | valid | 120 | valid | 120 | 5 | 0.999174 | valid | 120 | 5 | 0.999645 | valid | 120 | 5 | 0.999174 | 0 | 0 | 0 | 220->220 | 330->330 |
| own/numbers-base-top.stl | exact | valid | 471 | 1 | 1 | valid | 471 | valid | 471 | 1 | 1 | valid | 471 | 1 | 1 | valid | 471 | 1 | 1 | 0 | 0 | 0 | 888->808 | 1292->1212 |
| own/object-permanence-base.stl | hybrid | valid | 1985 | 1 | 1 | valid | 1985 | valid | 1985 | 1 | 0.999986 | valid | 1985 | 1 | 0.999988 | valid | 1985 | 1 | 0.999986 | 0 | 0 | 0 | 2255->2255 | 4239->4239 |
| own/peg-perego-button.stl | hybrid | valid | 212 | 1 | 1 | valid | 212 | invalid | 214 | 1 | 1.00013 | invalid | 214 | 1 | 1.0001 | invalid | 214 | 1 | 1.00013 | 3 | 0.129458 | 0 | 1223->1225 | 1431->1435 |
| own/phone-stand-foldable.stl | hybrid | valid | 2329 | 2 | 1 | invalid | 2329 | invalid | 2346 | 2 | 0.979189 | invalid | 2348 | 2 | 0.979307 | invalid | 2346 | 2 | 0.979189 | 8 | 0.0053074 | 22 | 4563->4594 | 6864->6930 |
| own/puzzle-base-circle.stl | exact | valid | 37 | 1 | 1 | valid | 37 | valid | 37 | 1 | 1 | valid | 37 | 1 | 1 | valid | 37 | 1 | 1 | 0 | 0 | 0 | 95->67 | 129->101 |
| own/puzzle-insert-circle.stl | hybrid | valid | 1609 | 1 | 1 | valid | 1609 | valid | 1609 | 1 | 1.00045 | valid | 1609 | 1 | 1.00045 | valid | 1609 | 1 | 1.00045 | 0 | 0 | 0 | 4002->4002 | 5608->5608 |
| own/remove-before-flight-cover.stl | hybrid | valid | 438 | 1 | 1 | valid | 438 | valid | 438 | 1 | 1.00002 | valid | 438 | 1 | 1.00002 | valid | 438 | 1 | 1.00002 | 0 | 0 | 0 | 686->686 | 1085->1085 |
| own/scrap-plate.stl | hybrid | valid | 154 | 1 | 1 | valid | 154 | valid | 154 | 1 | 0.999994 | valid | 154 | 1 | 1.00001 | valid | 154 | 1 | 0.999994 | 0 | 0 | 0 | 1028->1028 | 1179->1179 |
| own/shower-holder.stl | hybrid | valid | 901 | 1 | 1 | valid | 901 | invalid | 901 | 1 | 1.00005 | invalid | 901 | 1 | 1.00006 | invalid | 901 | 1 | 1.00005 | 0 | 0 | 0 | 2458->2458 | 3357->3357 |
| own/spool-nut-v4.1.stl | hybrid | valid | 718 | 1 | 1 | valid | 718 | valid | 718 | 1 | 0.999655 | valid | 718 | 1 | 0.999698 | valid | 718 | 1 | 0.999655 | 0 | 0 | 0 | 2700->2700 | 3416->3416 |
| own/spool-screw-v4.1.stl | hybrid | valid | 2915 | 0 | 1 | valid | 2915 | valid | 2915 | 0 | 0.998541 | valid | 2915 | 0 | 0.99691 | valid | 2915 | 0 | 0.998541 | 0 | 0 | 0 | 7582->7582 | 10462->10462 |
| own/track-straight-100mm.stl | hybrid | valid | 306 | 1 | 1 | valid | 306 | valid | 306 | 1 | 1.00001 | valid | 306 | 1 | 1.00001 | valid | 306 | 1 | 1.00001 | 0 | 0 | 0 | 323->323 | 627->627 |
| own/trashcan-repair-foot.stl | exact | valid | 16 | 1 | 1 | valid | 16 | valid | 16 | 1 | 1 | valid | 16 | 1 | 1 | valid | 16 | 1 | 1 | 0 | 0 | 0 | 64->28 | 72->42 |
| own/trashcan-spacer.stl | hybrid | valid | 78 | 1 | 1 | valid | 78 | valid | 78 | 1 | 1.00001 | valid | 78 | 1 | 0.999994 | valid | 78 | 1 | 1.00001 | 0 | 0 | 0 | 283->283 | 359->359 |
| own/whiteboard-tray-v5.stl | hybrid | valid | 1302 | 1 | 1 | invalid | 1302 | invalid | 1302 | 1 | 1.06791 | invalid | 1302 | 1 | 1.00017 | invalid | 1302 | 1 | 1.06794 | 0 | 0 | 0 | 4500->4495 | 5770->5770 |
| third-party/chip-bag-clip-small.stl | hybrid | valid | 757 | 0 | 1 | valid | 757 | valid | 757 | 0 | 0.999923 | valid | 757 | 0 | 0.999923 | valid | 757 | 0 | 0.999923 | 0 | 0 | 0 | 1242->1242 | 2006->2006 |
| third-party/door-stopper-top.stl | hybrid | valid | 147 | 1 | 1 | valid | 147 | valid | 147 | 1 | 0.99999 | valid | 147 | 1 | 0.999964 | valid | 147 | 1 | 0.99999 | 0 | 0 | 0 | 3115->3115 | 3259->3259 |
| third-party/gardena-end.stl | hybrid | valid | 17 | 1 | 1 | valid | 17 | valid | 17 | 1 | 1.00001 | valid | 17 | 1 | 1.00001 | valid | 17 | 1 | 1.00001 | 0 | 0 | 0 | 200->200 | 212->212 |
| third-party/gear-bearing-5.stl | hybrid | valid | 2330 | 7 | 1 | valid | 2330 | invalid | 2414 | 7 | 0.998211 | invalid | 2414 | 7 | 0.995221 | invalid | 2414 | 7 | 0.998211 | 6 | 0.00198009 | 12 | 5522->5606 | 7838->8006 |
| third-party/hex-key-cap-3mm.stl | hybrid | valid | 4590 | 0 | 1 | valid | 4590 | valid | 4591 | 0 | 1.00297 | valid | 4591 | 0 | 1.004 | valid | 4591 | 0 | 1.00297 | 0 | 0 | 0 | 3218->6430 | 7352->10113 |
| third-party/hot-wheels-connector.stl | hybrid | valid | 2518 | 1 | 1 | valid | 2518 | invalid | 2519 | 1 | 1.00027 | invalid | 2519 | 1 | 1.00024 | invalid | 2519 | 1 | 1.00027 | 1 | 0.114594 | 0 | 1496->1496 | 4023->4025 |
| third-party/makita-vacuum-holder.stl | hybrid | valid | 3480 | 1 | 1 | valid | 3480 | invalid | 3481 | 1 | 0.999774 | invalid | 3481 | 1 | 0.999751 | invalid | 3481 | 1 | 0.999774 | 1 | 0.348622 | 0 | 5526->5531 | 9004->9014 |
| third-party/micro-sd-keyring-inner.stl | hybrid | valid | 66 | 1 | 1 | valid | 66 | valid | 66 | 1 | 0.99926 | valid | 66 | 1 | 0.999502 | valid | 66 | 1 | 0.99926 | 0 | 0 | 0 | 200->200 | 264->264 |
| third-party/micro-sd-keyring-outer.stl | exact | valid | 41 | 1 | 1 | valid | 41 | valid | 41 | 1 | 1 | valid | 41 | 1 | 1 | valid | 41 | 1 | 1 | 0 | 0 | 0 | 120->76 | 158->114 |
| third-party/mms-camera-mount.stl | exact | valid | 11 | 1 | 1 | valid | 11 | valid | 11 | 1 | 1 | valid | 11 | 1 | 1 | valid | 11 | 1 | 1 | 0 | 0 | 0 | 16->16 | 24->24 |
| third-party/mms-flat-stand.stl | exact | valid | 44 | 1 | 1 | valid | 44 | valid | 44 | 1 | 1 | valid | 44 | 1 | 1 | valid | 44 | 1 | 1 | 0 | 0 | 0 | 156->81 | 195->121 |
| third-party/mms-m5-nut.stl | refused | invalid | 0 | 0 | 0 | invalid | 0 | invalid | 0 | 0 | 0 | invalid | 0 | 0 | 0 | invalid | 0 | 0 | 0 | 0 | 0 | 0 | 0->0 | 0->0 |
| third-party/sock-clips-6x.stl | hybrid | valid | 163 | 1 | 1 | valid | 163 | invalid | 163 | 1 | 1.00012 | invalid | 163 | 1 | 1.00012 | invalid | 163 | 1 | 1.00012 | 1 | 4 | 0 | 326->326 | 494->493 |
| third-party/spaghetti-measure.stl | hybrid | valid | 165 | 1 | 1 | valid | 165 | valid | 165 | 1 | 1.00013 | valid | 165 | 1 | 1.00014 | valid | 165 | 1 | 1.00013 | 0 | 0 | 0 | 286->286 | 449->449 |
| third-party/vented-funnel.stl | hybrid | valid | 715 | 1 | 1 | valid | 715 | valid | 715 | 1 | 0.999155 | valid | 715 | 1 | 0.999179 | valid | 715 | 1 | 0.999155 | 0 | 0 | 0 | 4604->4604 | 5317->5317 |
| third-party/wyze-garage-bracket.stl | hybrid | valid | 84 | 2 | 1 | valid | 84 | valid | 84 | 2 | 1.00001 | valid | 84 | 2 | 0.999935 | valid | 84 | 2 | 1.00001 | 0 | 0 | 0 | 238->238 | 320->320 |

**Third summary table (Q13; the edge-tolerance cap swept, one row per file).**

| file | rebuild@1.0 | faces@1.0 | facets@1.0 | bar@1.0 | rebuild@0.1 | faces@0.1 | facets@0.1 | bar@0.1 | rebuild@0.05 | faces@0.05 | facets@0.05 | bar@0.05 | rebuild@0.02 | faces@0.02 | facets@0.02 | bar@0.02 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| own/ball.stl | exact | 1 | 0 | pass | exact | 1 | 0 | pass | exact | 1 | 0 | pass | exact | 1 | 0 | pass |
| own/battery-holder.stl | hybrid | 131 | 0 | pass | hybrid | 131 | 0 | pass | hybrid | 131 | 0 | pass | hybrid | 131 | 0 | pass |
| own/battery-power-adapter.stl | hybrid | 995 | 416 | fail | hybrid | 2991 | 2488 | fail | refused |  |  | refused | refused |  |  | refused |
| own/desk-organizer-module-small.stl | hybrid | 418 | 42 | fail | hybrid | 418 | 42 | fail | hybrid | 418 | 42 | fail | hybrid | 418 | 42 | fail |
| own/drill-block.stl | hybrid | 388 | 208 | fail | hybrid | 442 | 268 | pass | hybrid | 449 | 276 | pass | hybrid | 449 | 276 | pass |
| own/grass-for-flower.stl | refused |  |  | refused | refused |  |  | refused | refused |  |  | refused | refused |  |  | refused |
| own/hole-filler-35mm.stl | exact | 6 | 0 | pass | exact | 6 | 0 | pass | exact | 6 | 0 | pass | exact | 6 | 0 | pass |
| own/hole-filler-5mm.stl | exact | 6 | 0 | pass | exact | 6 | 0 | pass | exact | 6 | 0 | pass | exact | 6 | 0 | pass |
| own/kuglbahn-pillar-base.stl | hybrid | 3930 | 3398 | fail | refused |  |  | refused | refused |  |  | refused | refused |  |  | refused |
| own/mirna-doodle-1.stl | hybrid | 120 | 43 | fail | hybrid | 126 | 52 | fail | hybrid | 178 | 126 | fail | hybrid | 189 | 144 | pass |
| own/numbers-base-top.stl | exact | 471 | 0 | pass | exact | 471 | 0 | pass | exact | 471 | 0 | pass | exact | 471 | 0 | pass |
| own/object-permanence-base.stl | hybrid | 1985 | 1620 | pass | hybrid | 2188 | 1828 | pass | hybrid | 2188 | 1828 | pass | hybrid | 2188 | 1828 | pass |
| own/peg-perego-button.stl | hybrid | 212 | 0 | fail | hybrid | 222 | 13 | fail | hybrid | 222 | 13 | fail | hybrid | 492 | 297 | fail |
| own/phone-stand-foldable.stl | hybrid | 2329 | 1852 | fail | hybrid | 4289 | 3859 | fail | refused |  |  | refused | refused |  |  | refused |
| own/puzzle-base-circle.stl | exact | 37 | 0 | pass | exact | 37 | 0 | pass | exact | 37 | 0 | pass | exact | 37 | 0 | pass |
| own/puzzle-insert-circle.stl | hybrid | 1609 | 1230 | fail | hybrid | 1609 | 1230 | fail | hybrid | 2843 | 2540 | pass | refused |  |  | refused |
| own/remove-before-flight-cover.stl | hybrid | 438 | 120 | pass | hybrid | 438 | 120 | pass | hybrid | 438 | 120 | pass | hybrid | 438 | 120 | pass |
| own/scrap-plate.stl | hybrid | 154 | 0 | pass | hybrid | 154 | 0 | pass | hybrid | 154 | 0 | pass | hybrid | 302 | 158 | pass |
| own/shower-holder.stl | hybrid | 901 | 472 | fail | hybrid | 901 | 472 | fail | hybrid | 901 | 472 | fail | hybrid | 901 | 472 | fail |
| own/spool-nut-v4.1.stl | hybrid | 718 | 0 | fail | hybrid | 718 | 0 | fail | hybrid | 718 | 0 | fail | hybrid | 718 | 0 | fail |
| own/spool-screw-v4.1.stl | hybrid | 2915 | 1841 | fail | hybrid | 2915 | 1841 | fail | hybrid | 4834 | 3803 | fail | refused |  |  | refused |
| own/track-straight-100mm.stl | hybrid | 306 | 237 | pass | hybrid | 306 | 237 | pass | hybrid | 306 | 237 | pass | hybrid | 306 | 237 | pass |
| own/trashcan-repair-foot.stl | exact | 16 | 0 | pass | exact | 16 | 0 | pass | exact | 16 | 0 | pass | exact | 16 | 0 | pass |
| own/trashcan-spacer.stl | hybrid | 78 | 0 | pass | hybrid | 78 | 0 | pass | hybrid | 78 | 0 | pass | hybrid | 1240 | 1198 | pass |
| own/whiteboard-tray-v5.stl | hybrid | 1302 | 622 | fail | hybrid | 1317 | 639 | fail | hybrid | 1330 | 653 | fail | hybrid | 2388 | 1753 | fail |
| third-party/chip-bag-clip-small.stl | hybrid | 757 | 500 | pass | hybrid | 757 | 500 | pass | hybrid | 757 | 500 | pass | hybrid | 757 | 500 | pass |
| third-party/door-stopper-top.stl | hybrid | 147 | 0 | pass | hybrid | 147 | 0 | pass | hybrid | 147 | 0 | pass | hybrid | 147 | 0 | pass |
| third-party/gardena-end.stl | hybrid | 17 | 0 | pass | hybrid | 17 | 0 | pass | hybrid | 1807 | 1802 | pass | hybrid | 1807 | 1802 | pass |
| third-party/gear-bearing-5.stl | hybrid | 2330 | 1444 | fail | refused |  |  | refused | refused |  |  | refused | refused |  |  | refused |
| third-party/hex-key-cap-3mm.stl | hybrid | 4590 | 3470 | fail | hybrid | 4590 | 3470 | fail | hybrid | 4590 | 3470 | fail | hybrid | 5478 | 4387 | fail |
| third-party/hot-wheels-connector.stl | hybrid | 2518 | 2318 | fail | hybrid | 2518 | 2318 | fail | hybrid | 2518 | 2318 | fail | hybrid | 2529 | 2330 | fail |
| third-party/makita-vacuum-holder.stl | hybrid | 3480 | 2662 | fail | hybrid | 3594 | 2788 | fail | hybrid | 5108 | 4356 | fail | refused |  |  | refused |
| third-party/micro-sd-keyring-inner.stl | hybrid | 66 | 18 | fail | hybrid | 102 | 58 | pass | hybrid | 102 | 58 | pass | hybrid | 102 | 58 | pass |
| third-party/micro-sd-keyring-outer.stl | exact | 41 | 0 | pass | exact | 41 | 0 | pass | exact | 41 | 0 | pass | exact | 41 | 0 | pass |
| third-party/mms-camera-mount.stl | exact | 11 | 0 | pass | exact | 11 | 0 | pass | exact | 11 | 0 | pass | exact | 11 | 0 | pass |
| third-party/mms-flat-stand.stl | exact | 44 | 0 | pass | exact | 44 | 0 | pass | exact | 44 | 0 | pass | exact | 44 | 0 | pass |
| third-party/mms-m5-nut.stl | refused |  |  | refused | refused |  |  | refused | refused |  |  | refused | refused |  |  | refused |
| third-party/sock-clips-6x.stl | hybrid | 163 | 97 | fail | hybrid | 271 | 211 | fail | hybrid | 271 | 211 | fail | hybrid | 274 | 215 | fail |
| third-party/spaghetti-measure.stl | hybrid | 165 | 55 | fail | hybrid | 173 | 64 | pass | hybrid | 173 | 64 | pass | hybrid | 173 | 64 | pass |
| third-party/vented-funnel.stl | hybrid | 715 | 86 | fail | hybrid | 715 | 86 | fail | hybrid | 715 | 86 | fail | hybrid | 2089 | 1493 | fail |
| third-party/wyze-garage-bracket.stl | hybrid | 84 | 0 | pass | hybrid | 84 | 0 | pass | hybrid | 84 | 0 | pass | hybrid | 232 | 150 | pass |


**Totals per cap** (the four `S` runs; cap 1.0 is `S-auto-3.log`): cap 1.0 — 30 hybrids, 2 refused, **10 of 30 pass the bar**, 34,594 faces, 22,751 facets, 215 s; cap 0.1 — 28 hybrids, 4 refused, **13 of 30**, 32,844 faces, 22,584 facets, 206 s; cap 0.05 — 26 hybrids, 6 refused, **14 of 30**, 32,093 faces, 22,975 facets, 179 s; cap 0.02 — 23 hybrids, 9 refused, **14 of 30**, 24,381 faces, 17,524 facets, 142 s. (The totals fall at the lower caps because whole large bodies are refused: kuglbahn-pillar-base, gear-bearing-5, battery-power-adapter, phone-stand-foldable, puzzle-insert-circle, spool-screw-v4.1, makita-vacuum-holder — so the per-file face counts, not the totals, are the cost.)

**What the reader rejects (Q2).** Across the 20 failing conversions BRepCheck
reports **no vertex and no edge status at all** — every non-`NoError` status is
on a face, a wire or a shell:

| sub-shape | status | count |
|---|---|---|
| face | `BadOrientationOfSubshape` | 67 |
| face | `UnorientableShape` | 25 |
| face | `InvalidImbricationOfWires` | 8 |
| wire | `SelfIntersectingWire` | 25 |
| wire (in context) | `SelfIntersectingWire` | 25 |
| shell (in context) | `BadOrientationOfSubshape` | 5 |

The invalid **faces** are almost all flat — by kind facet 17, plane 81, other 2.
The "other" 2 are drill-block's read-back of two of its four torus faces, which
come back as a surface the classifier doesn't name. Not one cylinder, cone,
sphere or torus face is flagged invalid directly. The invalid **edges by class**
table is empty for every one of the 20. So the read-back failure is not a
tolerated pcurve: it is orientation and topology — a face `UnorientableShape`
or `BadOrientationOfSubshape`, a wire `SelfIntersectingWire` — on the flat faces
and facets, where the reader's own re-welding of the hybrid's seams disagrees
with the body's orientation.

**The written body's edges by class (Q1).** Class is `<curve> <A>|<B>` (A ≤ B,
the two faces around the edge; "facet" is a 3-edge plane). Buckets are
≤0.002 / ≤0.01 / ≤0.05 / ≤0.1 / ≤0.5 / ≤1 / >1 mm.

drill-block (max vertex tolerance 0.58915 mm):

```
circle cylinder|plane  143  <=0.002:33 <=0.01:108 <=0.05:2   max 0.0109398
circle plane|sphere      6  <=0.002:0  <=0.01:2   <=0.05:4   max 0.0111325
ellipse cylinder|plane  20  <=0.002:18 <=0.05:2             max 0.0138686
line cylinder|cylinder  69  <=0.002:20 <=0.01:47 <=0.05:2   max 0.0130068
line cylinder|plane     28  <=0.002:10 <=0.01:9 <=0.05:5 <=0.5:4  max 0.177693
line cylinder|sphere     2  <=0.5:2                         max 0.120998
line facet|plane        11  <=0.002:7  <=0.05:4             max 0.0170903
line facet|torus         4  <=1:4                           max 0.58915
line plane|plane       855  <=0.002:810 <=0.01:34 <=0.05:11 max 0.0180813
line plane|sphere       96  <=0.002:22 <=0.01:68 <=0.05:6   max 0.010993
line plane|torus        16  <=0.05:12 <=0.5:4               max 0.271937
line sphere|sphere       1  <=0.5:1                         max 0.224711
```

peg-perego-button (max vertex 0.308934; every edge ≤ 0.044735):

```
circle cone|cylinder     2  max 0.002      circle cone|plane        2  max 0.00708193
circle cylinder|plane    5  max 0.00717953 circle cylinder|sphere    2  max 0.002
circle cylinder|torus    3  max 0.002      circle plane|sphere      10  max 0.00826411
ellipse cylinder|cylinder 2 max 0.00698371 ellipse cylinder|plane   44  max 0.0320919
line cone|plane          4  max 0.0202268  line cylinder|cylinder   640 max 0.0211373
line cylinder|facet     27  max 0.0167538  line cylinder|plane      194 max 0.044735
line cylinder|sphere   194  max 0.0339869  line cylinder|torus        6  max 0.0433924
line facet|plane        45  max 0.0217726  line plane|plane         137 max 0.0259957
line plane|sphere        4  max 0.0191384  line plane|torus          92  max 0.0432143
line torus|torus        18  max 0.00336356
```

spool-nut-v4.1 (max vertex 0.0158714; every edge ≤ 0.0158714):

```
circle cone|plane         2  max 2.82881e-05  circle cylinder|plane   4  max 0.002
ellipse cylinder|plane   38  max 0.0158714    line cone|cone          1  max 0.00658458
line cone|plane         960  max 0.00658611   line cylinder|cylinder 1039 max 0.0107784
line cylinder|plane      92  max 0.0107499    line plane|plane      1280 max 0.00658812
```

For the other 17 failing files, the class with the most edges over 0.05 mm:

| file | class over 0.05 mm |
|---|---|
| own/battery-power-adapter.stl | line plane\|plane (1163 of 2009, max 0.164814) |
| own/desk-organizer-module-small.stl | none (max edge 0.0153582) |
| own/kuglbahn-pillar-base.stl | line plane\|plane (1152 of 3041, max 0.164686) |
| own/mirna-doodle-1.stl | line plane\|plane (37 of 276, max 0.13023) |
| own/phone-stand-foldable.stl | line plane\|plane (1617 of 3227, max 0.164112) |
| own/puzzle-insert-circle.stl | line plane\|plane (236 of 4300, max 0.0811348) |
| own/shower-holder.stl | none (max edge 0.0159189) |
| own/spool-screw-v4.1.stl | line cylinder\|cylinder (80 of 3065, max 0.054861) |
| own/whiteboard-tray-v5.stl | line plane\|plane (12 of 1389, max 0.826073) |
| third-party/gear-bearing-5.stl | line cylinder\|cylinder (2252 of 3399, max 0.142677) |
| third-party/hex-key-cap-3mm.stl | none (max edge 0.0347333) |
| third-party/hot-wheels-connector.stl | none (max edge 0.0286497) |
| third-party/makita-vacuum-holder.stl | line cylinder\|plane (83 of 1047, max 0.468278) |
| third-party/micro-sd-keyring-inner.stl | line plane\|sphere (8 of 88, max 0.999885) |
| third-party/sock-clips-6x.stl | line plane\|torus and line facet\|torus (6 each of 6, max 0.187077) |
| third-party/spaghetti-measure.stl | line cylinder\|sphere (1 of 1, max 0.786253) |
| third-party/vented-funnel.stl | line cylinder\|plane (4 of 297, max 0.500955) |

**Where the volume goes (Q3), the six valid-but-drifting files.** Written ->
read-back summed area (mm²) and face count per kind:

- **mirna-doodle-1** (ratio 0.999174): cylinder 139.9 (14) -> 139.9 (14), plane 3003.95 (106) -> 3000.06 (106) (delta -3.89).
- **puzzle-insert-circle** (1.00045): plane 4826.17 (1546) -> 4816.89 (1546) (delta -9.29), cylinder 1020.14 (59) -> 1019.95 (59), cone 239.915 -> 239.918, facet 0.0538 -> 0.0358, torus unchanged.
- **spool-nut-v4.1** (0.999655): plane 4392.91 (654) -> 4395.57 (654) (delta +2.66), cylinder 1464.61 (63) -> 1465.2 (63) (delta +0.59), cone 340.65 -> 340.644.
- **spool-screw-v4.1** (0.998541): cylinder 18615.9 (95) -> 18610.4 (95) (delta -5.42), plane 5724.49 (1368) -> 5727.62 (1368) (delta +3.13), facet 326.499 (1448) -> 326.502 (1448), cone unchanged.
- **micro-sd-keyring-inner** (0.99926): sphere 6.71917 (4) -> 13.3783 (4) (delta +6.66), plane 1659.44 (46) -> 1659.23 (46), cylinder unchanged.
- **spaghetti-measure** (1.00013): sphere 5.54724 (1) -> 6.08194 (1) (delta +0.535), plane 8477.84 (63) -> 8477.21 (63) (delta -0.636), cylinder and facet unchanged.

The face and solid counts are identical written against read back in all six;
the drift is a re-fit of the same faces, not a face lost or added. (vented-funnel
and hex-key-cap-3mm also drift validly in this run: ratios 0.999155 and 1.00297.)

**Does ShapeFix help (Q4)?** On the read-back body, `ShapeFix_Shape` with
`SetPrecision(maxEdgeToleranceWritten)` and
`SetMaxTolerance(max(1, 2 x that))`, `Perform()`: it makes **0 of the 12
invalid bodies valid** and changes no valid body's ratio. Back -> fix (faces,
solids, ratio):

| file | back | fix |
|---|---|---|
| own/battery-power-adapter.stl | invalid, 999f/2s/0.999899 | invalid, 1000f/2s/0.999898 |
| own/desk-organizer-module-small.stl | invalid, 418f/1s/0.999998 | invalid, 418f/1s/0.999998 |
| own/drill-block.stl | invalid, 388f/1s/0.999998 | invalid, 388f/1s/0.999998 |
| own/kuglbahn-pillar-base.stl | invalid, 3931f/1s/0.999357 | invalid, 3938f/1s/0.998435 |
| own/mirna-doodle-1.stl | valid, 120f/5s/0.999174 | valid, 120f/5s/0.999174 |
| own/peg-perego-button.stl | invalid, 214f/1s/1.00013 | invalid, 214f/1s/1.00013 |
| own/phone-stand-foldable.stl | invalid, 2346f/2s/0.979189 | invalid, 2355f/2s/0.996416 |
| own/puzzle-insert-circle.stl | valid, 1609f/1s/1.00045 | valid, 1609f/1s/1.00045 |
| own/shower-holder.stl | invalid, 901f/1s/1.00005 | invalid, 901f/1s/1.00005 |
| own/spool-nut-v4.1.stl | valid, 718f/1s/0.999655 | valid, 718f/1s/0.999655 |
| own/spool-screw-v4.1.stl | valid, 2915f/0s/0.998541 | valid, 2915f/0s/0.998541 |
| own/whiteboard-tray-v5.stl | invalid, 1302f/1s/1.06794 | invalid, 1307f/1s/1.06794 |
| third-party/gear-bearing-5.stl | invalid, 2414f/7s/0.998211 | invalid, 2414f/7s/0.998211 |
| third-party/hex-key-cap-3mm.stl | valid, 4591f/0s/1.00297 | valid, 4591f/0s/1.00297 |
| third-party/hot-wheels-connector.stl | invalid, 2519f/1s/1.00027 | invalid, 2520f/1s/1.00027 |
| third-party/makita-vacuum-holder.stl | invalid, 3481f/1s/0.999774 | invalid, 3481f/1s/0.999774 |
| third-party/micro-sd-keyring-inner.stl | valid, 66f/1s/0.99926 | valid, 66f/1s/0.99926 |
| third-party/sock-clips-6x.stl | invalid, 163f/1s/1.00012 | invalid, 163f/1s/1.00012 |
| third-party/spaghetti-measure.stl | valid, 165f/1s/1.00013 | valid, 165f/1s/1.00013 |
| third-party/vented-funnel.stl | valid, 715f/1s/0.999155 | valid, 715f/1s/0.999155 |

**Q7 — the uncertainty experiment.** STEP keeps no per-edge tolerance but one
global uncertainty. A second round trip per file sets `write.precision.mode`
= 1 (Greatest; the brief's 2 is Session) and reads back the same way. The
facade's `writeStep()` overwrites the model's `DESTEP_Parameters` with its own
(`stepParameters()`), so write-side statics have no effect through the app — the
same file comes back, only the header timestamp differs — and the experiment
writes with a plain `STEPControl_Writer` that honours the static. Greatest
raises the file's uncertainty (drill-block 0.01 → 0.5 mm) and **3 of the 20
failing conversions then pass the bar**: drill-block (invalid → valid, ratio
0.999999), micro-sd-keyring-inner (0.99926 → 0.999918) and spaghetti-measure
(1.00013 → 0.999967). The other 17 stay outside the bar; the ones that stay
invalid keep their `UnorientableShape`/`BadOrientationOfSubshape`/
`SelfIntersectingWire` statuses.

**Q8 — where the self-intersections are.** For every wire BRepCheck flags
`SelfIntersectingWire` and every face it flags `UnorientableShape`/
`BadOrientationOfSubshape` on the read-back body, the harness prints the face's
kind and the wire's edge classes, its max edge tolerance and whether it holds a
circle or ellipse edge. Summed over the 20 failing files: **of the 25 flagged
wires, 7 contain a fitted circle or ellipse edge and 18 contain only lines**;
the edges in them are `line plane|plane` 262, `line facet|plane` 20,
`line other|plane` 8, `line cylinder|plane` 8, `line plane|torus` 6,
`circle plane|sphere` 4, `line plane|sphere` 4, `ellipse cylinder|plane` 3 and
`line facet|other` 2 (317 edges). The flagged faces are facet 17, plane 73,
other 2. The wires are dominated by line edges on plane-plane and facet-plane
seams — the mesh polylines and facet seams — with only 7 carrying a chain
circle/ellipse, so a fix at the chain curves' ends alone would reach at most
those 7.

**Q9 — the BREP control.** Writing the written body with `BRepTools::Write` and
reading it back with `BRepTools::Read` (which keeps tolerances and pcurves)
passes the bar for **20 of 20** failing files: every one is valid, keeps its
face and solid count and comes back at volume ratio 1 (of the 41, 39 pass — the
two refusals produce nothing). So the body's topology and its toleranced pcurves
survive a lossless round trip; the STEP reader's own reconstruction is the
trigger, not the converter's topology.

**Q10 — healing before writing.** On a copy of the written body,
`ShapeFix_Shape` at the written tolerances (the same settings as Q4) makes
**18 of the 20** bodies valid — phone-stand-foldable and whiteboard-tray-v5 stay
invalid, their face counts unchanged. Writing and reading that healed body with
the default settings passes the bar for **0 of 20**: healing the body before the
write does not survive the reader.

**Q11 — the pcurve modes.** (a) Written with no pcurves
(`write.surfacecurve.mode` 0, via the direct writer — the file drops from
1,982,044 to 648,049 bytes on drill-block), read with the defaults: passes the
bar for **0 of 20** (8 valid, the same 8 the default round trip already had
valid). (b) Written with the defaults and read preferring the file's pcurves
(`read.surfacecurve.mode` 2 = `2DUse_Preferred`; the brief's −3 is
`3DUse_Forced`, which ignores them): passes for **0 of 20** (8 valid). Dropping
the pcurves or preferring them changes nothing on the bar.

**Q12 — small edges in the flagged wires.** Over the 20 failing files the 25
flagged wires hold **35 edges shorter than the file's uncertainty** and **37
shorter than 0.05 mm**, the shortest 0.00198 mm (gear-bearing-5). The flagged
wires are full of sub-uncertainty and sub-0.05 edges; the reader's re-welding of
such short seams is where the self-intersections and bad orientations come from.

**Q13 — the edge-tolerance cap swept.** Three facade copies with
`HYBRID_EDGE_TOLERANCE_MAX` at 0.1, 0.05 and 0.02 (one line changed in each; the
repo file untouched), each run over the same corpus. Lowering the cap does not
make the bodies round-trip: the bar passes go 10 → 13 → 14 → 14 of the 30
hybrids and the refusals go 2 → 4 → 6 → 9. The three that join at cap 0.1 are
drill-block (388 → 442 faces, 208 → 268 facets), micro-sd-keyring-inner
(66 → 102, 18 → 58) and spaghetti-measure (165 → 173, 55 → 64) — the same three
that passed under the greatest uncertainty (Q7). At 0.05 puzzle-insert-circle
joins (1609 → 2843, 1230 → 2540) but spool-screw-v4.1 and phone-stand-foldable
are refused; at 0.02 mirna-doodle-1 joins (120 → 189, 43 → 144) while
puzzle-insert-circle, kuglbahn-pillar-base, gear-bearing-5, battery-power-adapter,
spool-screw-v4.1 and makita-vacuum-holder are refused, so the count stays 14. The
cap trades a handful of extra passes for many more facets and whole-body
refusals; it is not the fix.

**Q14 — the re-read tori.** Every read-back face my classifier calls `other` is
a `SurfaceOfRevolution`: 11 of them, in drill-block (2), peg-perego-button (1)
and gear-bearing-5 (8). Each comes from a written torus whose minor radius is at
least its major radius — a degenerate (spindle) torus: drill-block 2 of its 4
tori (R 0.495, r 0.531; R 0.494, r 0.540), peg-perego-button 1 of 3 (R 8.63,
r 131.4), gear-bearing-5 all 8 (e.g. R 5.31, r 19.56). The reader re-reads such a
torus as a surface of revolution, which is why those faces leave the kind
classifier; the torus fit (slice 4a2) can return minor radius > major radius.

**Fourth summary table (Q15-Q17; the flagged wires' self-intersections, one row
per failing hybrid, as `S` prints it).** The columns are the 0.001-precision
ShapeAnalysis search of `shapeDiagnose`'s flagged wires. Only 8 of the 20 carry
any flagged wire; the other 12 (battery-power-adapter, desk-organizer-module-small,
mirna-doodle-1, puzzle-insert-circle, shower-holder, spool-nut-v4.1,
spool-screw-v4.1, whiteboard-tray-v5, hex-key-cap-3mm, micro-sd-keyring-inner,
spaghetti-measure, vented-funnel) fail on face orientation alone, with no
`SelfIntersectingWire`:

| file | flagged wires | pairs same-edge / adjacent / non-adjacent | hairpin / 3D-close / 2D-only | written pairs @1e-7 / @tol | unmatched faces |
|---|---|---|---|---|---|
| own/battery-power-adapter.stl | 0 | 0 / 0 / 0 | 0 / 0 / 0 | 0 / 0 | 0 |
| own/desk-organizer-module-small.stl | 0 | 0 / 0 / 0 | 0 / 0 / 0 | 0 / 0 | 0 |
| own/drill-block.stl | 2 | 0 / 0 / 2 | 0 / 0 / 2 | 0 / 0 | 2 |
| own/kuglbahn-pillar-base.stl | 3 | 0 / 1 / 0 | 1 / 0 / 0 | 0 / 0 | 3 |
| own/mirna-doodle-1.stl | 0 | 0 / 0 / 0 | 0 / 0 / 0 | 0 / 0 | 0 |
| own/peg-perego-button.stl | 3 | 0 / 2 / 0 | 1 / 0 / 0 | 0 / 0 | 0 |
| own/phone-stand-foldable.stl | 8 | 0 / 2 / 0 | 0 / 0 / 0 | 0 / 0 | 8 |
| own/puzzle-insert-circle.stl | 0 | 0 / 0 / 0 | 0 / 0 / 0 | 0 / 0 | 0 |
| own/shower-holder.stl | 0 | 0 / 0 / 0 | 0 / 0 / 0 | 0 / 0 | 0 |
| own/spool-nut-v4.1.stl | 0 | 0 / 0 / 0 | 0 / 0 / 0 | 0 / 0 | 0 |
| own/spool-screw-v4.1.stl | 0 | 0 / 0 / 0 | 0 / 0 / 0 | 0 / 0 | 0 |
| own/whiteboard-tray-v5.stl | 0 | 0 / 0 / 0 | 0 / 0 / 0 | 0 / 0 | 0 |
| third-party/gear-bearing-5.stl | 6 | 0 / 0 / 0 | 0 / 0 / 0 | 0 / 0 | 6 |
| third-party/hex-key-cap-3mm.stl | 0 | 0 / 0 / 0 | 0 / 0 / 0 | 0 / 0 | 0 |
| third-party/hot-wheels-connector.stl | 1 | 0 / 0 / 0 | 0 / 0 / 0 | 0 / 0 | 1 |
| third-party/makita-vacuum-holder.stl | 1 | 0 / 0 / 0 | 0 / 0 / 0 | 0 / 0 | 1 |
| third-party/micro-sd-keyring-inner.stl | 0 | 0 / 0 / 0 | 0 / 0 / 0 | 0 / 0 | 0 |
| third-party/sock-clips-6x.stl | 1 | 0 / 0 / 0 | 0 / 0 / 0 | 0 / 0 | 0 |
| third-party/spaghetti-measure.stl | 0 | 0 / 0 / 0 | 0 / 0 / 0 | 0 / 0 | 0 |
| third-party/vented-funnel.stl | 0 | 0 / 0 / 0 | 0 / 0 / 0 | 0 / 0 | 0 |
| **totals** | 25 | 0 / 5 / 2 | 2 / 0 / 2 | 0 / 0 | 21 |

**Fifth summary table (Q15b/Q17b; BRepCheck's own first pair per flagged wire,
classified).** Because ShapeAnalysis disagrees with BRepCheck (Q15 below), this
runs `BRepCheck_Wire::SelfIntersect` — the algorithm that produced the status —
on each flagged wire and classifies the pair it returns. `hairpin`/`3D-close`/
`2D-only` here are Q17's rules on BRepCheck's pair; the residue is adjacent pairs
below 150° (peg-perego-button 3, makita 1, gear-bearing-5 2):

| file | BRepCheck pairs | same-edge | hairpin | 3D-close | 2D-only |
|---|---|---|---|---|---|
| own/drill-block.stl | 2 | 0 | 0 | 0 | 2 |
| own/kuglbahn-pillar-base.stl | 3 | 0 | 1 | 0 | 2 |
| own/peg-perego-button.stl | 3 | 0 | 0 | 0 | 0 |
| own/phone-stand-foldable.stl | 8 | 0 | 1 | 0 | 7 |
| third-party/gear-bearing-5.stl | 6 | 0 | 0 | 0 | 4 |
| third-party/hot-wheels-connector.stl | 1 | 0 | 1 | 0 | 0 |
| third-party/makita-vacuum-holder.stl | 1 | 0 | 0 | 0 | 0 |
| third-party/sock-clips-6x.stl | 1 | 0 | 1 | 0 | 0 |
| **totals** | 25 | 0 | 4 | 0 | 15 |

**Q15 — the intersecting pairs, and that ShapeAnalysis does not reproduce
BRepCheck.** Running `ShapeAnalysis_Wire saw(wire, face, 0.001)` on the 25
read-back wires BRepCheck flags `SelfIntersectingWire`, then each edge with
itself, each adjacent pair (i−1, i) and each non-adjacent pair (i, j), j > i+1
(skipping the closing pair 1/N): the probe finds **7 pairs in total — 0
same-edge, 5 adjacent, 2 non-adjacent** — and `saw.CheckSelfIntersection()`
returns true on only **7 of the 25** wires (18 return false). The 7 pairs are
drill-block 2 (non-adjacent), kuglbahn-pillar-base 1 (adjacent), peg-perego-button
2 (adjacent) and phone-stand-foldable 2 (adjacent). Every other flagged wire —
gear-bearing-5's 6, hot-wheels-connector, makita-vacuum-holder, sock-clips-6x,
phone-stand-foldable's other 6 — yields no pair at all, so **ShapeAnalysis does
not agree with BRepCheck**, contrary to the brief's expectation. Precision is not
the cause: on gear-bearing-5's six wires the probe finds 0 pairs at 0.001, 1e-5,
1e-7, 1e-9 alike. The reason is that `BRepCheck_Wire::SelfIntersect` (the
function behind the status) is an independent algorithm from `ShapeAnalysis_Wire`:
it works at `tolint = 1e-10` with `Geom2dInt_GInter` and accepts an intersection
(the 2D-curve crossing) as correct only when it falls inside a 3D **vertex**
tolerance (OCCT 8.0.1 `BRepCheck_Wire.cxx`). It therefore reports crossings
ShapeAnalysis's own intersection test (which exempts anything enclosed by the
common end vertex of two adjacent edges, and boxes non-adjacent ones) never sees.
This is why the fourth table's counts are so small, and why the mechanism has to
be read off BRepCheck's pair (the fifth table).

**Q16 — is it in the written body too?** Each flagged read-back face is matched
to a written face by centre of mass (nearest within 0.05 mm) and area (within
1 %); then the same pair search runs on the written face's outer wire at 1e-7
(geometry alone) and at that wire's max edge tolerance. **21 of the 25 faces do
not match** a written face: drill-block's two are read-back `SurfaceOfRevolution`
fragments (area 0.048 against the written torus's 0.149, centre 0.175 mm away,
Q14's re-read tori); kuglbahn-pillar-base's, phone-stand-foldable's,
gear-bearing-5's, hot-wheels-connector's and makita-vacuum-holder's are planes
the reader split or re-fit (e.g. phone-stand-foldable 146.6 mm² against the
nearest written 160.6 mm², 0.0052 mm away). For the **4 that do match**
(peg-perego-button 3, sock-clips-6x 1) the written outer wire has **0 pairs at
1e-7 and 0 pairs at its edge tolerance** (peg-perego 0.0205 and 0.0128 mm,
sock-clips 0.002 mm): the written geometry is clean and the reader's
reconstruction created the crossing. For the 21 unmatched faces Q16 cannot say
either way — the matching criterion fails because the reader did not keep the
face 1:1 — so "the written body already carries the crossings" is neither
confirmed nor refuted there; it is refuted wherever it can be measured.

**Q17 — the mechanism of each pair.** Of the 7 ShapeAnalysis pairs, **2 are
hairpin** (adjacent, turning angle ≥ 150° at the shared vertex: kuglbahn-pillar-base
176.7°, sock-clips-6x 180°) and **2 are 2D-only** (non-adjacent, 3D distance
0.242 mm and 0.243 mm — far above the 0.001 mm fallback edge tolerance, the two
edges 1.03 mm and 1.0 mm long, on drill-block's read-back revolution faces);
**0 are 3D-close**, and the remaining 3 adjacent pairs turn an ordinary 89–93°.
The pairs BRepCheck itself reports (Q15b, one per flagged wire, the fifth table)
are clearer: **15 of 25 are 2D-only**, 4 hairpin, 0 same-edge and 0 3D-close,
with 6 adjacent pairs below 150° (the residue). The 2D-only pairs are non-adjacent
edges that are 0.0022–0.15 mm apart in 3D — far above their wire's edge
tolerance (0.002–0.02 mm) — and cross only in the face's 2D parameter space:
mostly the pair's vertices sit right on the surface (off-surface 1e-12 to 2e-4 mm
on gear-bearing-5 and kuglbahn-pillar-base) but on phone-stand-foldable they sit
0.012–0.099 mm off it, and phone-stand-foldable also has two degenerate read-back
plane fragments whose vertices all sit 0.075 mm off the fitted plane (their area
comes back as −3e-17 mm²). The 4 hairpin pairs turn 176.7–180° at the shared
vertex (kuglbahn-pillar-base, phone-stand-foldable, hot-wheels-connector,
sock-clips-6x). No pair at all falls in the 3D-close band.

**What the numbers say**

- The failure is not an edge-tolerance failure: no edge and no vertex carries a
  non-`NoError` status; every status is on a face, a wire or a shell.
- The invalid faces are flat or drill-block's two re-read tori: facet 17,
  plane 81, other 2; never a cylinder, cone, sphere or torus flagged directly.
- Face `BadOrientationOfSubshape` (67) and `UnorientableShape` (25), and wire
  `SelfIntersectingWire` (25 own, 25 in context) dominate;
  `InvalidImbricationOfWires` (8) and shell-in-context
  `BadOrientationOfSubshape` (5) follow.
- The written body's max edge tolerance does not separate pass from fail:
  passing hybrids reach 0.872 mm (remove-before-flight-cover) and 0.786 mm is a
  failing one (spaghetti-measure), and the passing set and the failing set both
  span the range from ~1e-7 to ~1 mm.
- The facet count does not separate either: 0 facets appears on both sides
  (spool-nut-v4.1 fails, battery-holder passes) and thousands too (1620 on
  object-permanence-base, a pass; 3470 on hex-key-cap-3mm, a fail).
- All 9 exact rebuilds pass the bar; every one of the 20 failures is a hybrid.
- Every `BadOrientationOfSubshape`/`UnorientableShape`/`SelfIntersectingWire`
  lands on the flat faces and facets and the wires between them, not on the
  hybrid's rebuilt curved faces.
- `ShapeFix_Shape` at the written tolerances repairs nothing: 0 of the 12
  invalid bodies become valid, and no valid body's ratio moves toward 1.
- The BREP round trip (tolerances and pcurves kept) passes the bar for 20 of 20
  failing bodies, volume ratio 1: the topology is sound and the STEP reader's
  reconstruction is the trigger.
- Writing with the greatest global uncertainty (`write.precision.mode` 1) makes
  3 of 20 pass (drill-block, micro-sd-keyring-inner, spaghetti-measure); the
  facade's `writeStep()` ignores write-side statics, so a direct writer is used.
- Healing the written body before writing makes 18 of 20 valid, but 0 of 20
  survive the STEP round trip.
- Dropping the pcurves (`write.surfacecurve.mode` 0) passes 0 of 20; preferring
  the file's pcurves on read (`read.surfacecurve.mode` 2) passes 0 of 20.
- The 25 flagged wires hold 35 edges shorter than the file's uncertainty and 37
  shorter than 0.05 mm (shortest 0.00198 mm); the flagged wires are mostly line
  polylines: 18 of 25 are lines only, 7 contain a fitted circle or ellipse.
- Lowering the hybrid edge-tolerance cap is not the fix: cap 1.0/0.1/0.05/0.02
  give 10/13/14/14 passes of 30 hybrids, 2/4/6/9 refusals, and more facets per
  converted body.
- Every read-back `other` face is a `SurfaceOfRevolution` (11: drill-block 2,
  peg-perego-button 1, gear-bearing-5 8), each from a written torus with
  minor radius ≥ major radius.
- The volume drift of the eight valid-but-drifting bodies keeps the face and
  solid counts and is a small re-fit of the same faces (e.g. micro-sd-keyring-inner's
  four sphere faces gain 6.66 mm², spool-nut-v4.1's cylinder and plane faces
  drift by +0.59 and +2.66 mm²).
- No fix is proposed here; the next slice designs it from these numbers.
- `ShapeAnalysis_Wire` finds the self-intersection on only 7 of the 25 flagged
  wires (18 return false from `CheckSelfIntersection`), even at precision 1e-9;
  the 7 pairs are 0 same-edge, 5 adjacent and 2 non-adjacent.
- `BRepCheck_Wire::SelfIntersect` is an independent algorithm from
  `ShapeAnalysis_Wire` (tolint 1e-10, `Geom2dInt_GInter`, an intersection
  accepted only inside a 3D vertex tolerance), so the wire status cannot be read
  off ShapeAnalysis.
- Of the 25 flagged faces only 4 (peg-perego-button 3, sock-clips-6x 1) match a
  written face by centre of mass and area; on all 4 the written outer wire has 0
  pairs at 1e-7 and 0 at its edge tolerance, so where it can be measured the
  written geometry is clean and the reader created the crossing; the other 21
  cannot be matched (the reader split or re-fit the face).
- Of BRepCheck's 25 own pairs, 15 are 2D-only, 4 hairpin, 0 same-edge and 0
  3D-close, 6 adjacent pairs (peg-perego-button 3, gear-bearing-5 2, makita 1)
  turn under 150°.
- 2D-only dominates: it is 15 of BRepCheck's 25 pairs and the only mechanism in
  drill-block (2 of 2) and gear-bearing-5 (4 of 4), and the written body carries
  no crossing at 1e-7 wherever the match succeeds.


### Amendment, 2026-10-31: chain edges that re-project exactly on planes, sliver chains, no degenerate tori (slice D8)

**The mechanism.** A STEP reader keeps no tolerances and, on every planar face,
drops the file's pcurves and projects each edge's 3D curve onto the plane
instead (`StepToTopoDS_TranslateEdgeLoop`: `hasPcurve = false` for a
`Geom_Plane`, then `RemovePCurves`). The hybrid's collapsed chains (slice D3)
carried the two surfaces' fitted line, circle or ellipse as their 3D curve,
trimmed nearest their end nodes, while their pcurves ended at the nodes so the
face stayed closed with its neighbouring chord edges. The curves ended up to
0.145 mm from the nodes (the edge tolerance covered it); the re-projected
outline moved by that much and crossed the chord edges beside it, and the
reader's healing then split faces to repair the crossings. Separately, tori
fitted with minor radius ≥ major radius came back as surfaces of revolution.

**The rules** (`extrudo_facade.cpp`, `chainCurve` and `rebuildHybrid`'s chain
loop; tori in `fitMeshTorus` and the surface snaps):
1. A chain with a planar side ends where its end nodes project onto that
   plane. A line runs through the two end nodes. A circle is turned square to
   the plane (a chain stays a polyline when its circle is tilted more than 1°:
   "a tilted circle on a plane") and moved in its own plane to pass through the
   end nodes' projections, the centre nearer the fitted one ("chain ends wider
   than the circle" when they are wider apart than the diameter by more than
   the tolerance; within it the circle takes their half-distance as its
   radius); its plane-side pcurve is the circle's exact projection, a
   `Geom2d_Circle` at the same parameter, checked against the end nodes'
   parameters to 1e-7. An ellipse next to a plane stays a polyline ("an
   ellipse on a plane"). The node, monotone and span checks run on the
   adjusted curve.
2. A torus fit needs R > r; the axial adjustment next to a cylinder and the
   rolling surfaces' radius averaging keep a torus's radii when the new value
   would break that.
3. A self-check after the build: on every planar face of the result, each
   edge's 3D curve ends project onto its pcurve's ends within 1e-5 (unify's
   merged edges miss by up to 1e-6 from rounding), `hybridEnds_` ("exact chain
   ends: N edges, M off"), its own stage (1 ms on battery-holder).
4. A chain stays a polyline when another outline piece joins its two end
   points (open chains and boundary mesh edges, by coordinates to 1e-6) and
   one of its regions is a sliver, its triangles' area below the tolerance
   times its outline's length ("another piece joins its ends"): else both
   pieces become one segment and the region a face of zero area, which the
   reader takes back as a hairpin. Split-circle halves and an arc with its
   diameter bound real faces and still collapse.
5. A chain's curve must stay within 1.5 × the tolerance of both regions'
   surfaces at 9 samples ("curve off its surface").
6. A circle between a plane and a cone stays a polyline ("a circle next to a
   cone"): moved square to the plane by rule 1, scrap-plate's arcs leave their
   cones' axes by 0.699° and sit 0.0108 mm off the cones; the cone-side pcurve
   (the straight shortcut, 0.0244 mm off within the 0.03 mm reach) is up to
   0.0180 apart in UV from the exact projection, and the reader replaces it
   with that projection, so the four cone faces read back 1.47 % smaller
   (volume ratio 1.00018). `pcurveFor`'s offset is the 3D distance between the
   chart's surface at the pcurve's parameters and the curve, already in mm.

**The probes** (spike harness `prismatic.cpp`, case `s`/`S`, ADR-0097's
2026-10-30b amendment for Q1–Q17):
- **Q18** copies the written body, sets every vertex tolerance to 1e-7 and runs
  `BRepCheck_Wire::SelfIntersect` per wire: 1 (on a plane), 0 and 0 wires on
  drill-block, phone-stand-foldable and gear-bearing-5 against 2, 8 and 6 on
  the read: the written outlines don't cross.
- **Q19** reads the default file at a user precision of 1e-3 and writes with
  the least and with a session uncertainty of 1e-3: 9, 8 and 9 of 30 hybrids
  pass against the default's 10; precision is not the cause.
- **Q20** reads with no shape processing (`SetShapeProcessFlags` with no
  operator) and replays the FixShape operator mode by mode: the raw read
  already carries 61, 131 and 108 crossing wires (phone-stand, gear-bearing-5,
  kuglbahn-pillar-base); the healing inherits them and splits faces repairing
  them (face FixSplitFace, FixLoopWires or FixOrientation off keeps the
  written face count).
- **Q21** compares the reader's pcurves with ours on the flagged raw wires: on
  planes every pcurve is re-projected from the 3D curve, up to 0.145 mm from
  ours, with every EDGE_CURVE carrying a SURFACE_CURVE and our pcurves; no
  `read.surfacecurve.mode` and no writer precision changes it.
- **Q22** names the remaining failures after rules 1–3: 11 hairpins (two
  edges with the same ends, a chain and the mesh edge between its ends or two
  chains, a written face of zero area; 0.8–5.2° apart before the rules), the
  scrap-plate drift on four cone faces bounded by a collapsed arc, and the
  extra time of spool-screw and vented-funnel as a second build pass after a
  failed validity check.
- **Q23** measures those four cone faces (above, rule 6).

**Measured** (spike `S`, TOL=auto, 41 files; before = the harness run of
2026-10-30, after = this slice):

| | before | after |
|---|---|---|
| kernel-bar passes of 30 hybrids (of 41) | 10 (19) | 20 (29) |
| refusals | 2 | 2 |
| faces | 34,594 | 35,291 |
| facets | 22,751 | 23,489 |
| conversion | 215.3 s | 227.8 s |
| SurfaceOfRevolution faces on the read | 11 | 0 |
| flagged read-back wires | 25 on 8 bodies | 3 on 2 (phone-stand 2, sock-clips 1) |
| exact-ends misses (1e-5) | – | 0 of 150,893 edges |
| chains collapsed (lines / circles / ellipses) | 11,924 (8,936 / 1,733 / 1,255) | 13,979 (12,293 / 1,585 / 101) |
| polylines | 17,865 | 15,664 |

New passes: desk-organizer-module-small, drill-block, kuglbahn-pillar-base,
mirna-doodle-1, peg-perego-button, shower-holder, spool-screw-v4.1,
hot-wheels-connector, makita-vacuum-holder, vented-funnel; none lost.
phone-stand-foldable's two remaining wires sit on two folded written faces of
almost no area, sock-clips-6x's on a pair whose second edge isn't built by the
chains (both before this slice too): out of scope. The kernel sweep (Auto, 41 files, against the 2026-10-30 baseline, written to
`baseline-2026-10-31-auto.jsonl`): round trips failed 17 → 7
(battery-power-adapter, phone-stand-foldable, spool-nut-v4.1, gear-bearing-5,
makita-vacuum-holder, micro-sd-keyring-inner, spaghetti-measure); prismatic
converted 36 and refused 5 in both; prismatic faces 27,706 → 27,740; prismatic
kernel time 236.1 → 249.7 s. One file is over the sweep's 10 % face bar:
peg-perego-button, 212 → 261 faces (+23.1 %), its Auto step moving from 0.02 to
0.05 mm (one torus region with R ≈ r that no longer fits at 0.02 mm, 48 facets
instead), its round trip now passing. Accepted on 2026-10-31 as the new sweep
baseline: `baseline-2026-10-31-auto.jsonl` is the baseline from here on.

**Follow-ups.** The mesh check's face classification costs battery-holder
4.4 s (`BRepTopAdaptor_FClass2d::Perform` on 1,290 nodes, 17 ms on 626 before:
the nodes of chains that stay polylines lie on face boundaries).
vented-funnel still builds twice: a plane between two cylinder halves joined by
two near-half arcs with shared ends fails the first validity check (its plane
is not a sliver).

### Amendment, 2026-10-31b (slice D9): R ≤ r torus regions

**The question.** Slice D8's rule 2 refused every torus fit with R ≤ r (a
spindle torus, its tube through its axis): OCCT's STEP reader takes such a
`Geom_ToroidalSurface` back as a surface of revolution. The price was
peg-perego-button at Auto: step 0.02 → 0.05 mm, 212 → 261 faces.

**Q1, what the refused regions are** (spike case `f`, `UNFIT=1`: the
segmentation with the gate off; `q24 spindle surface` lines):

| file, step | surfaces | regions / triangles each | area each (share) | R / r | dev | best other fit (dev) |
|---|---|---|---|---|---|---|
| peg-perego-button, 0.02 | 1 | 5 / 20 | 5.49 mm² (0.19 %) | 8.63 / 131.4 | 0.0114 | sphere r 520 (0.0336); cylinder 0.0529, plane 0.0573 |
| drill-block, 0.01 | 2 | 8 / 16 | 1.13 mm² (0.01 %) | 0.495 / 0.531, 0.494 / 0.540 | 0.0012 | cylinder (0.0177), sphere (0.0179) |
| gear-bearing-5, 0.1 | 8 | 12–13 / 15 | 27.1–29.5 mm² (0.17–0.19 %) | 5.31 / 19.56, 6.60 / 28.23, 8.45 / 27.14 | 0.076–0.085 | cylinder (0.178–0.182) |

None fits a plane, cylinder, cone or sphere within its step (`bestFit` tries
the torus last, so none could). None reaches the axis: the nodes' distance
from it is 7.2–14.2 (peg), 0.51–0.87 (drill-block), 4.3–14.2 mm (gear), so
no face holds one of the spindle's two poles (its only self-intersection, on
the axis). peg-perego's patch sits at the top of its tube (h 131.3–131.4,
the poles at ±131.14): a nearly flat strip the torus passes through.
The price is not the patch: refused, it is a 5-region leftover of
`splitComponent`'s seeded growing, and a leftover of 4 regions or more keeps
the whole smooth component unfit (296 regions, 1,190 triangles, 38.7 % of
the area). At 0.02 mm peg-perego gives 845 faces/694 facets with the gate,
212/0 without it; Auto then moves on to 0.05 mm (261/48). drill-block and
gear-bearing-5 have no spindle surface at their Auto steps' neighbours
(drill-block at 0.02 mm, gear-bearing-5 at 0.02 mm refuses).

**Q2, which representation reads back valid** (spike case `s`, `Q24=1`,
slice D8's facade with its three R > r gates off through the harness's
`spikeSpindle`, `Q24SPINDLE=1`; (b) with `spikeTorusSurface`, `Q24REV=1`):

| variant | peg-perego 0.02 | drill-block 0.01 | gear-bearing-5 0.1 |
|---|---|---|---|
| (a) `Geom_ToroidalSurface`, R < r | valid, 212 faces, ratio 0.999999 | **invalid**, 388 faces | valid, 2,330 faces, 7 solids, ratio 0.998794 |
| (b) `Geom_SurfaceOfRevolution` of the meridian circle | valid, 212, 0.999999 | valid, 388, ratio 1 | valid, 2,330, 0.998794 |
| (c) split along the self-intersection | not built: no face reaches the axis | – | – |
| (d) facets (slice D8) | valid, 845 faces | valid, 410 | valid, 2,386, 0.999607 |

In (a) the reader rebuilds each spindle torus as a revolution of another
curve (not a circle), with its own parameters: on drill-block both faces
come back `UnorientableShape` with a `SelfIntersectingWire`, and
`ShapeFix_Face` leaves them invalid; on peg-perego and gear-bearing-5 they
happen to stay valid. Written, every face of (a) is valid on its own. In
(b) the file carries a `SURFACE_OF_REVOLUTION` of a circle, which the reader
takes back as itself (same radius, same parameters). The written faces'
areas still move on the read (drill-block 0.148 → 0.360 mm², gear-bearing-5
26.0 → 27.1 mm²), as in (a): those faces have edges up to 0.59 mm (drill-block)
and 0.47 mm (gear-bearing-5) loose, pieces of tiny R ≈ r corner blends the
hybrid builds badly (also the R > r ones beside them); the solids stay valid
and the volume ratios as listed. (c) needs a face that holds a pole; none does.

**What was tried and rejected.** (b) with the R > r gate gone everywhere (the
fit and both surface snaps): spike `S` matched the run before slice D8
file by file, face and facet counts alike (34,594 faces, 22,751 facets), so all
of slice D8's face increase came from rule 2; but that also brought back its
losses: vented-funnel 632 → 715 faces (0 → 86 facets) and spaghetti-measure
148 → 165, over the sweep's 10 % bar, a spindle fit winning seeds that other
primitives explain better.

**The rules** (`extrudo_facade.cpp`: `fitMeshTorus`, `segmentMesh`'s
`settle`, `MeshChart::surface`, `revolvedTorus`/`revolvedTorusOf`, the
rebuild's mesh check and face counts, the exact rebuild):
1. Rule 2 of slice D8 now reads: a torus fit needs R > r, except in
   `splitComponent`'s retry. When a split leaves its component whole and
   unfit, the component is split once more with spindle tori allowed
   (`fitMeshTorus(…, spindle)`), and the retry is kept when it explains
   anything. The surface snaps keep slice D8's R > r gates.
2. The hybrid builds a torus with R ≤ r as the `Geom_SurfaceOfRevolution` of
   its meridian circle (`revolvedTorus`: centre O + R X, the circle's X the
   frame's X and its Y the axis, turned about the axis), at the torus's own
   (u, v): charts, pcurves, `chainCurve` and the chain checks stay the
   torus's. A torus with R > r is a `Geom_ToroidalSurface` as before.
3. The mesh check and the face counts take such a face back as its torus
   (`revolvedTorusOf`: a revolution of a circle whose Y is the axis).
4. The exact rebuild refuses a spindle torus ("a torus whose tube reaches its
   axis"; MakerVolume keeps to quadrics and tori), and the hybrid runs.

**Measured** (spike `S`, TOL=auto, 41 files; D8 = `S-fix5`, slice D8's run):

| | D8 | D9 |
|---|---|---|
| kernel-bar passes of 30 hybrids (of 41) | 20 (29) | 20 (29), none lost |
| refusals | 2 | 2 |
| faces | 35,291 | 34,469 |
| facets | 23,489 | 22,613 |
| conversion | 227.8 s | 223.3 s |
| SurfaceOfRevolution faces on the read (invalid) | 0 | 7 (0) |
| exact-ends misses (1e-5) | 0 of 150,893 edges | 0 of 147,296 |

Files that changed (all fewer faces): peg-perego-button 0.05 → 0.02 mm, 261
→ 212 faces, 48 → 0 facets, read-back valid (212 faces, volume ratio
0.999999), 1.3 s instead of 11.0; drill-block 410 → 388 (2 spindle faces, its largest
edge tolerance 0.225 → 0.589 mm);
gear-bearing-5 2,386 → 2,326 (4 spindle faces, 9.5 → 12.7 s, largest edge tolerance
0.181 → 0.665 mm); remove-before-flight-cover 466 → 438;
whiteboard-tray-v5 1,965 → 1,302 (read back invalid in both).
The kernel sweep (`TOL=auto`, 41 files, against `baseline-2026-10-31-auto.jsonl`,
written to `baseline-2026-10-31b-auto.jsonl`) passes: prismatic converted 36
and refused 5 in both; faces 27,740 → 27,581; round trips failing the bar 7
in both (the same files); prismatic kernel time 249.7 → 242.9 s. Four files
changed, all fewer faces and with the round trip passing: peg-perego-button
0.05 → 0.02 mm, 261 → 212 faces, 48 → 0 facets, volume against the mesh
1.00293 (D8 1.00317), STEP read-back 212 faces at 0.999997, 1.6 s;
drill-block 410 → 388; remove-before-flight-cover 466 → 438; gear-bearing-5
2,364 → 2,304. The fixture pins move back to the counts from before slice D8
(drill-block at 0.01 mm 65 cylinders, 4 tori; track-straight at 0.05 mm and
remove-before-flight-cover at 0.01 mm; at Auto peg-perego-button 0.02 mm,
212 faces, 1,738 edges with 20 circles, drill-block 388,
remove-before-flight-cover 438), none with a failing round trip.

**Follow-ups.** drill-block's and gear-bearing-5's R ≈ r corner blends:
the hybrid explodes part of each region ("invalid face") and builds the rest
with edges up to 0.59 mm loose at a 0.01 mm step; the read-back moves those
faces' areas. Not this slice's.

### Amendment, 2026-10-31c: rolling-ball fillets between two planes — measured, not built (slice D10)

The hypothesis (from stl2curves, `docs/references.md`; ideas only): many of prismatic's facets, and many of Auto's
climbs up the ladder, are fillet bands between two flat faces. Exporters round fillet nodes to 0.02–0.05 mm, so
region growing within T cuts such a band into strips or leaves it unfit, while two fitted planes pin the fillet's
cylinder up to its radius. Slice D10 measured this first and **did not build it**: the numbers are far below the bar.

**What was proposed.** A rolling-ball pass in `segmentMesh`, after the cluster loop and before the curved-surface
refit. Its candidates: every unfit surface, piece by piece over mesh edges, and every piece the "< 4 regions" rule
turns into planes. A candidate band would be accepted when:
- two planes A and B (30°–170° apart, each at least 3 × the band's largest facet) border at least 80 % of its
  boundary length;
- every facet normal lies within 5° of the plane spanned by n_A and n_B and inside their arc;
- with the radius most nodes vote for (the axis along n_A × n_B at distance r from both planes on the band's side, a
  quadratic per node, the median after dropping the 10 % farthest), 75 % of the nodes lie within 2 T, all within 5 T,
  and neither bound is above 4 % of r.

The band would become a pinned cylinder with a tolerance of its own: a new `MeshSurface.tolerance` used by every
node, chain and volume check, with the planes kept at T. Vouched radii would retry a band that failed alone at a
clean fillet's radius. In `surfaceCurves`, the pinned cylinder and its planes would meet in tangent lines by
construction (slice D5's shape, for pinned cylinders only). **The bar:** at least 5 % of the corpus's facets had to
be such bands.

**Method.**

- **Baseline.** The kernel sweep at Auto against `baseline-2026-10-31b-auto.jsonl`, written as
  `baseline-2026-10-31c-auto.jsonl`: passed (63 passed, 1 skipped, 764 s). Against 31b, `third-party/mms-m5-nut.stl`
  is now imported (prismatic refuses it, faceted converts it: 628 faces), and `third-party/hex-key-cap-3mm.stl` is still
  refused but on 1,245 open edges where it was 1,802 (PR #159's repair). The test's `sweep totals` line doesn't appear in
  the log. These totals come from the JSONL with the test's own rules:
  `files 41, prismatic converted 36 refused 5, faceted converted 26 refused 15, prismatic faces 27581, prismatic facets
  17790, prismatic ms 253658, faceted ms 104971, round trips failed 7` (31b: faceted 25 / 16, prismatic ms 242913,
  faceted ms 106395, the rest the same).
- **Meshes.** The kernel orders a mesh as manifold does, and the spike's own STL reader segments differently
  (hot-wheels-connector gave 2,318 facets there against the sweep's 1,833). So the probe ran on the meshes as the kernel
  stages them (`MESH_OUT`, 38 files; the 3 the importer refuses are absent). There all 36 conversions give the
  sweep's facets and Auto step exactly.
- **Probe `Q25`** (`spikes/stl-to-solid/prismatic.cpp`, `README.md`; tables by `q25.py`). It runs at every ladder step
  up to the one Auto picks. Candidates are (a) every unfit surface, one band per connected piece over mesh edges, and
  (b) every piece the "< 4 regions" rule turned into planes (run.sh's facade copy records them). Each band gets rule 2's
  tests in the design's order: two planes border it by at least 80 % of its boundary, 30–170° apart, each at least
  3 × its largest facet, and every facet normal within 5° of the n_A n_B plane and inside their arc. Then the rolling-ball
  radius: per node, the root of |q − axis(r)| = r on the corner's side, and the median after dropping the 10 % farthest.
  Then the nodes' distances to that cylinder in multiples of T. Acceptance: 75 % within 2 T, all within 5 T, neither
  beyond 4 % of r. A band that fails is also split into **sub-bands**, one per pair of planes it borders: its facets
  whose normals lie in that pair's arc, in connected pieces touching both planes. That goes beyond the design and finds
  fillet strips inside a network.
- **Check of the method.** Every cylinder region growing fitted went through the same test. At Auto, 19 of the 2,521
  pass tests 1–4. 14 of the 19 come out at their fitted radius (r 0.5, 0.6, 0.8, 2, 5, 6; deviation ~0) and pass. The
  other 5 are arcs between planes that aren't tangent to them (fitted r 48.4, 3.0, 9.4 against 0.84, 2.07, 1.99), and
  the deviation test fails them. So the rule finds real fillets and refuses the rest. In this corpus, the flat–flat
  fillets are already cylinders.

**What the facets are (Auto, kernel-staged meshes).**

- **Exploded regions, not unfit ones, make a third of the facets outright.** 8 converted files have no unfit triangle
  at Auto and still have 5,801 facets: spool-screw 2,123, phone-stand-foldable 1,847, puzzle-insert-circle 1,230,
  battery-power-adapter 415, sock-clips 90, desk-organizer 42, spaghetti-measure 36, micro-sd-keyring-inner 18. Corpus-wide,
  the hybrid exploded 17,742 triangles into facets: planes "invalid face" 7,609, tori "touches itself at node" 2,992,
  cylinders "touches itself" 2,434, cones "touches itself" 1,145, planes "outer loop runs the wrong way" 744, the rest
  under 600 each. That is about as many triangles as the 16,083 unfit ones.
- **The unfit triangles are networks.** 97 % of the unfit area at Auto is in bands that border more than two surfaces,
  or two planes by less than 80 % of their boundary (the `network` column). The `UNFIT=1` listing of the largest:
  - kuglbahn-pillar-base: one freeform shell, 5,377 triangles, 36.5 %; the best primitive is off by 10 mm.
  - makita-vacuum-holder: 1,481 regions, best a sphere off by 3 mm.
  - shower-holder: 0.5 mm-high strips round an outline cut into many 30 mm² planes, a fillet or chamfer along a
    curved edge.
  - object-permanence-base: corner blends at the box's corners (best a cone off by 1.3 mm), and blends between r 2
    and r 20/24.7 cylinders (a torus off by 0.30 mm at T 0.01).
  - hot-wheels-connector: a noisy torus (0.085 mm at T 0.01) and a blend (2 mm).
  - gear-bearing-5: 76 small networks (the gear teeth).

  None of these is a fillet between two flat faces. Swept fillets along a curve and blends between curved faces were
  outside this slice's design.

**Per file, at the Auto step and at 0.01 mm.**

The ten facet-heavy files and the twelve above 0.01 mm (15 files). The sweep has 9 files at 0.05/0.1 mm and 3 at 0.02. Each cell is bands/triangles (% of that file's unfit area). The keep-pieces
column is pieces (accepted).

**Unfit bands at auto: bands/triangles (% of the unfit area).**

| file | T | facets | unfit tris | unfit share % | flat-flat accepted | flat-flat, deviation too large | flat-flat, a test fails (angle/area/normals/side) | plane-cylinder | network (borders > 2 surfaces) | other | sub-bands accepted | keep pieces (accepted) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| own/battery-power-adapter | 0.1 | 415 | 0 | 0.00 |  |  |  |  |  |  | 0/0 | 0 (0) |
| own/kuglbahn-pillar-base | 0.1 | 3409 | 5377 | 36.55 |  |  |  |  | 1/5377 (100) |  | 0/0 | 0 (0) |
| own/mirna-doodle-1 | 0.1 | 23 | 30 | 2.60 |  |  | 2/30 (100) |  |  |  | 0/0 | 0 (0) |
| own/object-permanence-base | 0.01 | 1620 | 2938 | 0.53 |  |  |  | 2/538 (13) | 5/2400 (87) |  | 2/134 | 8 (0) |
| own/peg-perego-button | 0.02 | 0 | 0 | 0.00 |  |  |  |  |  |  | 0/0 | 0 (0) |
| own/phone-stand-foldable | 0.1 | 1847 | 0 | 0.00 |  |  |  |  |  |  | 0/0 | 0 (0) |
| own/puzzle-insert-circle | 0.05 | 1230 | 0 | 0.00 |  |  |  |  |  |  | 0/0 | 0 (0) |
| own/scrap-plate | 0.02 | 0 | 0 | 0.00 |  |  |  |  |  |  | 0/0 | 0 (0) |
| own/shower-holder | 0.01 | 472 | 439 | 0.93 |  |  |  |  | 3/439 (100) |  | 0/0 | 0 (0) |
| own/spool-screw-v4.1 | 0.05 | 2123 | 0 | 0.00 |  |  |  |  |  |  | 0/0 | 0 (0) |
| own/trashcan-spacer | 0.05 | 0 | 0 | 0.00 |  |  |  |  |  |  | 0/0 | 0 (0) |
| third-party/gear-bearing-5 | 0.1 | 1418 | 1588 | 18.56 |  |  |  |  | 76/1588 (100) |  | 0/0 | 0 (0) |
| third-party/hot-wheels-connector | 0.01 | 1833 | 1909 | 0.94 |  |  |  |  | 2/1909 (100) |  | 0/0 | 4 (0) |
| third-party/makita-vacuum-holder | 0.05 | 2649 | 3106 | 1.45 |  |  |  |  | 1/3106 (100) |  | 0/0 | 0 (0) |
| third-party/vented-funnel | 0.02 | 0 | 0 | 0.00 |  |  |  |  |  |  | 0/0 | 0 (0) |
| **total** | | 17039 | 15387 | | 0 (0) | 0 (0) | 30 (1) | 538 (1) | 14819 (98) | 0 (0) | 134 | 12 (0) |

**Unfit bands at 0.01: bands/triangles (% of the unfit area).**

| file | T | facets | unfit tris | unfit share % | flat-flat accepted | flat-flat, deviation too large | flat-flat, a test fails (angle/area/normals/side) | plane-cylinder | network (borders > 2 surfaces) | other | sub-bands accepted | keep pieces (accepted) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| own/battery-power-adapter | 0.01 |  | 6946 | 21.01 |  |  | 1/60 (1) |  | 8/6886 (99) |  | 0/0 | 6 (0) |
| own/kuglbahn-pillar-base | 0.01 |  | 19513 | 41.80 |  |  |  |  | 4/12197 (96) | 3/7316 (4) | 0/0 | 3 (0) |
| own/mirna-doodle-1 | 0.01 |  | 126 | 6.10 |  |  | 3/62 (70) |  | 8/64 (30) |  | 0/0 | 10 (0) |
| own/object-permanence-base | 0.01 | 1620 | 2938 | 0.53 |  |  |  | 2/538 (13) | 5/2400 (87) |  | 2/134 | 8 (0) |
| own/peg-perego-button | 0.01 |  | 1168 | 38.56 |  |  |  |  | 3/1168 (100) |  | 0/0 | 0 (0) |
| own/phone-stand-foldable | 0.01 |  | 8059 | 48.46 |  |  | 19/910 (0) |  | 10/7149 (100) |  | 0/0 | 10 (0) |
| own/puzzle-insert-circle | 0.01 |  | 8276 | 6.13 |  |  |  |  | 1/8276 (100) |  | 0/0 | 0 (0) |
| own/scrap-plate | 0.01 |  | 942 | 44.67 |  |  |  |  | 1/942 (100) |  | 0/0 | 0 (0) |
| own/shower-holder | 0.01 | 472 | 439 | 0.93 |  |  |  |  | 3/439 (100) |  | 0/0 | 0 (0) |
| own/spool-screw-v4.1 | 0.01 |  | 6117 | 5.98 |  |  |  |  | 2/6117 (100) |  | 0/0 | 0 (0) |
| own/trashcan-spacer | 0.01 |  | 671 | 82.02 |  |  |  |  | 1/671 (100) |  | 0/0 | 0 (0) |
| third-party/gear-bearing-5 | 0.01 |  | 14828 | 56.87 |  |  |  |  | 240/14828 (100) |  | 0/0 | 0 (0) |
| third-party/hot-wheels-connector | 0.01 | 1833 | 1909 | 0.94 |  |  |  |  | 2/1909 (100) |  | 0/0 | 4 (0) |
| third-party/makita-vacuum-holder | 0.01 |  | 15597 | 97.26 |  |  |  |  | 7/15597 (100) |  | 0/0 | 0 (0) |
| third-party/vented-funnel | 0.01 |  | 2017 | 2.08 |  |  |  |  |  | 1/2017 (100) | 0/0 | 6 (0) |
| **total** | | 3925 | 89546 | | 0 (0) | 0 (0) | 1032 (0) | 538 (0) | 78643 (99) | 9333 (0) | 134 | 47 (0) |

Over the whole corpus (38 files), the totals rows (Auto, then 0.01 mm) read:

| file | T | facets | unfit tris | unfit share % | flat-flat accepted | flat-flat, deviation too large | flat-flat, a test fails (angle/area/normals/side) | plane-cylinder | network (borders > 2 surfaces) | other | sub-bands accepted | keep pieces (accepted) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **total** | | 17790 | 16722 | | 0 (0) | 0 (0) | 466 (1) | 790 (2) | 15466 (97) | 0 (0) | 158 | 21 (0) |
| **total** | | 4676 | 98905 | | 0 (0) | 0 (0) | 1444 (0) | 790 (0) | 87326 (99) | 9345 (0) | 158 | 56 (0) |

The flat–flat bands that fail a test all fail the angle test. Their two planes are either parallel (0°: steps and
lettering walls on drill-block, phone-stand-foldable's 19 small bands at 0.01 mm, remove-before-flight-cover,
whiteboard-tray-v5) or opposite (180°: full rounds on mirna-doodle-1, hot-wheels-connector, battery-power-adapter,
mms-flat-stand). The "< 4 regions" pieces: 56 at 0.01 mm and 21 at Auto, none accepted. At 0.01 mm, 11 are flat–flat
and fail the angle test (opposite planes), 30 border two planes by less than 80 %, 9 are plane–cylinder and 6 other.

**Deviation from the rolling-ball cylinder at Auto: the 16 flat–flat bands that pass tests 1–4.**

| k | p75 <= k T (bands / tris) | max <= k T | p75 <= k T and max <= 2.5 k T |
|---|---|---|---|
| 1 | 14 / 158 | 12 / 24 | 12 / 24 |
| 2 | 16 / 328 | 12 / 24 | 14 / 158 |
| 3 | 16 / 328 | 12 / 24 | 14 / 158 |
| 5 | 16 / 328 | 14 / 158 | 14 / 158 |
| 10 | 16 / 328 | 14 / 158 | 14 / 158 |

All 16 are sub-bands, on files whose Auto step is 0.01 mm: object-permanence-base (4 bands, 304 triangles; 2 of them
with 134 triangles pass) and remove-before-flight-cover (12 bands of 2 triangles, r 0.25, all pass). At 2 T / 5 T,
14 bands with 158 triangles pass. The distribution is too thin to move the constants from.

**The climbs.**

The unfit share at 0.01 and 0.02 mm, and what is left after taking out the bands rule 2 accepts (whole bands, then
sub-bands too), at FILLET_TOL 2 T and FILLET_GROW 5 T:

| file | Auto | 0.01 share | 0.01 after | 0.01 after with sub-bands | 0.02 share | 0.02 after | 0.02 after with sub-bands | passing tris at Auto (whole + sub) / unfit tris at Auto | facets |
|---|---|---|---|---|---|---|---|---|---|
| own/battery-power-adapter | 0.1 | 21.01 | 21.01 | 21.01 | 20.07 | 20.07 | 20.07 | 0 / 0 | 415 |
| own/kuglbahn-pillar-base | 0.1 | 41.80 | 41.80 | 41.80 | 39.08 | 39.08 | 39.08 | 0 / 5377 | 3409 |
| own/mirna-doodle-1 | 0.1 | 6.10 | 6.10 | 6.10 | 6.10 | 6.10 | 6.10 | 0 / 30 | 23 |
| own/peg-perego-button | 0.02 | 38.56 | 38.56 | 38.56 | 0.00 | 0.00 | 0.00 | 0 / 0 | 0 |
| own/phone-stand-foldable | 0.1 | 48.46 | 48.46 | 48.46 | 95.00 | 95.00 | 95.00 | 0 / 0 | 1847 |
| own/puzzle-insert-circle | 0.05 | 6.13 | 6.13 | 6.13 | 6.12 | 6.12 | 6.12 | 0 / 0 | 1230 |
| own/scrap-plate | 0.02 | 44.67 | 44.67 | 44.67 | 0.00 | 0.00 | 0.00 | 0 / 0 | 0 |
| own/spool-screw-v4.1 | 0.05 | 5.98 | 5.98 | 5.98 | 2.93 | 2.93 | 2.93 | 0 / 0 | 2123 |
| own/trashcan-spacer | 0.05 | 82.02 | 82.02 | 82.02 | 82.02 | 82.02 | 82.02 | 0 / 0 | 0 |
| own/whiteboard-tray-v5 | 0.02 | 58.84 | 58.84 | 58.84 | 0.12 | 0.12 | 0.12 | 0 / 639 | None |
| third-party/gear-bearing-5 | 0.1 | 56.87 | 56.87 | 56.87 | 56.87 | 56.87 | 56.87 | 0 / 1588 | 1418 |
| third-party/makita-vacuum-holder | 0.05 | 97.26 | 97.26 | 97.26 | 96.33 | 96.33 | 96.33 | 0 / 3106 | 2649 |
| third-party/mms-m5-nut | 0.02 | 32.26 | 32.26 | 32.26 | 0.00 | 0.00 | 0.00 | 0 / 0 | None |
| third-party/vented-funnel | 0.02 | 2.08 | 2.08 | 2.08 | 0.00 | 0.00 | 0.00 | 0 / 0 | 0 |

No file's share moves, so Auto would keep every file at the step it takes today. (whiteboard-tray-v5 and mms-m5-nut
are refused at Auto; their facets column is empty.)

**whiteboard-tray-v5 at fixed tolerances.**

Spike `f` and `s` on the kernel-staged mesh (39,088 triangles):

- `TOL=0.05`: refused, 18.3 s. 497 / 140 / 2 / 2 / 7 surfaces, 0 unfit. The exact stage is skipped (surface cap) and
  the hybrid hits the facet cap: 8,774 facets, 10 regions exploded. No STEP.
- `TOL=0.1`: refused, 66.1 s. 487 / 70 / 2 / 0 / 3, 0 unfit. The exact rebuild refuses, then the hybrid's result is
  invalid. No STEP.

**The result.** The sub-bands that pass hold 158 triangles: 1.0 % of the 16,083 unfit triangles at Auto, and 0.9 % of
the 17,790 facets at most. No whole unfit band passes. 14 of the 19 fitted cylinders that pass tests 1–4 come out at
their fitted radius, so the corpus's flat–flat fillets are already cylinders from region growing. No file's unfit
share at 0.01 or 0.02 mm moves, so no file's Auto step would move. The pass is not built: no facade change, the OCCT
WASM input hash is unchanged, no test change and no changelog fragment. The probe stays in the spike harness:
`Q25` in `spikes/stl-to-solid/prismatic.cpp`, run.sh's `spikeKeepPieces` hook, `q25.py` and the README section.
From this slice on, the sweep baseline is `baseline-2026-10-31c-auto.jsonl`: D9's, plus the import repair of the
ADR-0066 2026-10-31 amendment.

**Where the facets come from instead.** Each source is a possible slice of its own:

1. **Exploded regions.** 17,742 triangles at Auto, 7,609 of them planes refused as "invalid face". 5,801 facets are in
   8 files with nothing unfit (spool-screw 2,123, phone-stand-foldable 1,847, puzzle-insert-circle 1,230, …).
2. **Networks.** Blends along curved outlines (strips running past many small planes) and between curved faces
   (corner blends, cylinder-to-cylinder blends, noisy tori), plus one freeform shell: 97 % of the unfit area.
