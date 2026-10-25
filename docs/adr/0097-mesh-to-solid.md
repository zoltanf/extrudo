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
