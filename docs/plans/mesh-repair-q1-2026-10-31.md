# Mesh repair on import — Q1 measurement (2026-10-31)

The brief for `claude/mesh-repair` says: measure the four refused STLs first,
and **if fewer than 2 of the 4 have only cracks, bad triangles and holes of at
most 8 edges, stop before writing any code**, commit the measurement and let
the owner decide.

**Result: only 1 of the 4 qualifies (`mms-m5-nut.stl`). The gate trips, so no
`repairMesh` was written.** The findings that decide it are below.

Measured with `readStl` from `@extrudo/io`, a script under
`/tmp/mesh-repair/measure.mjs` (Node with the repo's `scripts/ts-import.mjs`),
against `~/Development/extrudo-stl-solid-test/`. `checkManifold` counts
reproduce the sweep baseline exactly (`339`, `30`, `1802` after
`splitNonManifoldEdges`, `4`).

## The gate: defects per file

"Qualifies" = the file's only defects are cracks (corners within 1e-4 mm of a
node they should be one with), bad triangles (repeated corner, collinear,
duplicate) and boundary loops of at most 8 edges.

| file | triangles | bbox diag (mm) | boundary edges | bad triangles | cracks ≤ 1e-4 | qualifies |
|---|---|---|---|---|---|---|
| `own/grass-for-flower.stl` | 953 | 161.52 | 339 | 0 | 0 | **no** |
| `third-party/chip-bag-clip-small.stl` | 13,948 | 61.20 | 30 | 0 | 0 | **no** |
| `third-party/hex-key-cap-3mm.stl` | 11,496 | 20.20 | 0 | 303 duplicate (opposite) | 0 | **no** |
| `third-party/mms-m5-nut.stl` | 1,494 | 12.86 | 0 | 4 repeated corner | 0 | **yes** |

**No file has a crack.** The nearest node that is not a triangle-neighbour of a
boundary node is, over all four files, 0.060–0.149 mm away — three orders of
magnitude above the 1e-4 mm weld. `readStl` already welds corners by exact
position, so the "float-apart" cracks the brief expected are not present here.

### Why each file does not qualify

- **`grass-for-flower.stl`** — 339 boundary edges, 290 boundary nodes, 49 of
  them with **degree 4** (holes that share a vertex). The edges form many small
  cycles (36 three-edge, …) plus one connected component of **87 nodes / 119
  edges**. Filling every loop up to 8 edges closes 97 holes but leaves a single
  **11-edge** loop; the file stays open. No bad triangles, no cracks.

- **`chip-bag-clip-small.stl`** — 30 boundary edges in components of 3, 3, and
  two of **9 edges (7 nodes, degree-4 vertices)**. All boundary vertices sit on
  two straight seams at fixed (x, y) with z varying, so every candidate
  three-edge "hole" is **collinear (zero area)** — a torn seam, not a fillable
  hole. Fan filling rejects them (area < 1e-12); ear clipping has nothing to
  clip. Not repairable as cracks/bad triangles/≤8-edge holes.

- **`hex-key-cap-3mm.stl`** — no boundary edges, but **920 edges used by four
  triangles** (all balanced 2-forward/2-backward). The 303 opposite-winding
  duplicate triangles account for part of it: dropping them removes only 300 of
  the 920 non-manifold edges (920 → 620). The rest are four faces meeting along
  an edge (coincident/touching sheets), which is `splitNonManifoldEdges`'
  territory — and after it splits them the mesh has 1,802 open edges, as the
  baseline shows. Not a cracks/bad-triangles/≤8-edge-holes defect.

- **`mms-m5-nut.stl`** — 4 triangles repeat a corner. Dropping them leaves a
  closed, oriented mesh (`checkManifold.ok`, volume unchanged at 151.74 mm³).
  This is the one file the planned repair fixes.

## Repair prototype (not committed; it only confirmed the table)

A prototype of the brief's steps (drop bad triangles, weld 1e-4, drop
collinear/duplicate, fill boundary loops ≤ 8 with a fan/ear clip) run over the
four files:

| file | welded | dropped tris | holes filled | result after repair |
|---|---|---|---|---|
| `grass-for-flower` | 0 | 0 | 97 (134 tris) | 11 open edges — still refused |
| `chip-bag-clip-small` | 0 | 0 | 0 | 30 open edges — still refused |
| `hex-key-cap-3mm` | 0 | 303 | 0 | 620 non-manifold edges — still refused |
| `mms-m5-nut` | 10 | 24 | 0 | **closed, volume 151.74 mm³** |

So even a generous repair would make at most 1 of the 4 closed (2 if the default
`maxHoleEdges` were raised past grass's 11-edge residual — but chip-bag's
collinear seam and hex-key's four-use edges stay refused either way). The
acceptance bar of "at least 3 of the 4 no longer refused" is **not reachable**
with the specified mechanical repairs.

## Raw Q1 output

```
## own/grass-for-flower.stl
- triangles: 953, nodes: 552
- bbox diagonal: 161.5241 mm
- boundary edges: 339, boundary nodes: 290, all degree 2 or 4 (49 of degree 4)
- nearest non-neighbour node from a boundary node: min 1.494e-1, median 2.064e0, max 1.059e1 mm
- bad triangles: repeated corner 0, collinear 0, duplicate-same 0, duplicate-opposite 0

## third-party/chip-bag-clip-small.stl
- triangles: 13948, nodes: 6977
- bbox diagonal: 61.2025 mm
- boundary edges: 30, boundary nodes: 26, degree 2 or 4 (4 of degree 4)
- nearest non-neighbour node from a boundary node: min 1.376e-1, median 2.725e-1 mm
- bad triangles: repeated corner 0, collinear 0, duplicate-same 0, duplicate-opposite 0

## third-party/hex-key-cap-3mm.stl
- triangles: 11496, nodes: 5280
- bbox diagonal: 20.2015 mm
- boundary edges: 0; edges used by four triangles: 920
- bad triangles: repeated corner 0, collinear 0, duplicate-same 0, duplicate-opposite 303

## third-party/mms-m5-nut.stl
- triangles: 1494, nodes: 745
- bbox diagonal: 12.8582 mm
- boundary edges: 0
- bad triangles: repeated corner 4, collinear 0, duplicate-same 0, duplicate-opposite 0
```

## Decision

Per the brief's Q1 gate, the work stops here: **1 file qualifies, fewer than 2**.
No `repairMesh`, no import change, no docs. The owner decides whether to (a)
accept a partial repair that fixes `mms-m5-nut.stl` only and keeps a
`repairMesh` for future files, (b) widen what "repair" means (drop collinear
slivers / separate four-use edges before filling) to attempt `chip-bag` and
`hex-key`, or (c) drop the task.

Measurement script and prototype: `/tmp/mesh-repair/` (`measure.mjs`,
`proto.mjs`, outputs `q1.txt`, `check.mjs`, `crackdepth.mjs`).
