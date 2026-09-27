# ADR-0005: Topological naming

- **Status:** Accepted, 2026-09-27
- **Task:** P2-04 (topological naming v1). Code: `packages/kernel/src/naming/`
  (`topo-id.ts` grammar, `names.ts` naming tables, `ops.ts` named
  operations, `fingerprint.ts`, `resolve.ts`, `description.ts`), the
  facade's `prism`, `revolve`, `boolean(…, simplify)`, `compound`,
  `subShape`, `locate` and `describe` in
  `packages/kernel/occt/facade/extrudo_facade.cpp`, the engine's naming
  tables and `EvalContext.resolve` in `src/recompute/engine.ts`,
  `GeomFingerprintSchema` in `packages/core/src/schema.ts`. Tests:
  `src/naming/topo-naming.test.ts` (the 19-scenario suite),
  `topo-id.test.ts`, `names.test.ts`, `memory.test.ts`.
- **Builds on:** ADR-0001 (the facade owns OCCT memory and returns history
  as flat arrays), ADR-0003 (the document is JSON; references are
  `GeomRef`s), ADR-0024 (feature outputs, the shape cache, `bodyAccess`),
  ADR-0025 (profile faces and the sketch curve of each face edge).
- **Affects:** every feature that refers to faces, edges or vertices:
  P2-06 extrude (target faces, press-pull, "to object"), P2-07 revolve
  (axis edges), P2-09 sketch on face and projection, P2-11 "fix
  references", P3 fillet, chamfer, shell, hole, draft, patterns. P2-03's
  selection turns a picked sub-shape into a reference through the mesh's
  `faceIds` / `edgeIds` / `vertexIds` and `KernelApi.reference`.

## Context

A feature that uses a face or an edge of an earlier result (fillet these
edges, sketch on this face, extrude up to that face) must find the same
geometry after any upstream edit, although OCCT renumbers sub-shapes on
every rebuild and edits change the topology. Architecture §5.2 set the
strategy: persistent IDs from why an element exists, propagated through
OCCT history, split pieces numbered by a geometric rule, a fingerprint
fallback with a warning, and a repair UI later. This ADR fixes the
details.

## Decision

### 1. Names (TopoIds)

Faces are named; edges and vertices are named after their faces.

```
face     = created split*
created  = op ":" feature ":" role (":" source)?
source   = token | "(" name ")"          nested names in parentheses
split    = "#" n                         n ≥ 1
edge     = "e[" face ("|" face)* "]" ("@" n)?
vertex   = "v[" face ("|" face)* "]" ("@" n)?
```

Examples, for extrude `E` of sketch lines `l2 l5 l8 l11` and fillet `F`:

| Element | Name |
|---|---|
| start cap (on the sketch plane, after any shift) | `extrude:E:cap:start` |
| end cap | `extrude:E:cap:end` |
| side face swept from line `l8` | `extrude:E:side:l8` |
| the pieces of the end cap a slot cut in two | `extrude:E:cap:end#1`, `extrude:E:cap:end#2` |
| the edge between the end cap and that side | `e[extrude:E:cap:end|extrude:E:side:l8]` |
| a corner | `v[extrude:E:cap:end|extrude:E:side:l11|extrude:E:side:l8]` |
| a cylinder's seam (one face on both sides) | `e[extrude:E:side:c13]` |
| a fillet's face | `fillet:F:from:(e[extrude:E:cap:end|extrude:E:side:l8])` |
| a press-pull side, from a body edge | `extrude:G:side:(e[…|…])` |

Rules:

- Tokens are plain IDs (`[A-Za-z0-9_.~-]+`: sketch entity UUIDs, feature
  IDs); anything else is wrapped in parentheses, so names nest and parse
  unambiguously (`parseFace`, `parseCompound`). Names never contain `/`,
  which a reference uses for a feature's output (`<sketch>/<region>`,
  ADR-0024).
- An edge or vertex lists the **distinct** faces around it, sorted; a
  seam or a free edge has one face.
- `#n` numbers faces that end up with the same name (a face split into
  pieces, a sketch curve that bounds a profile twice, several profiles in
  one extrude); `@n` numbers edges or vertices around the same faces.
  Both use one **geometric order**: by centroid (faces), midpoint (edges)
  or point (vertices), comparing x, then y, then z, each within 1e-6 mm;
  then the larger first; then sub-shape index (`compareGeometry`).
  Numbering repeats until every name in the table differs.

Why edges and vertices from faces: they then follow their faces through
every operation with no history of their own, and a new edge that a
boolean makes where two faces meet is named the same way as one a sweep
made. Onshape and the FreeCAD 1.0 work name edges by their faces too.

### 2. Naming tables and where they live

A body's `TopoNames` is `{ faces, edges, vertices }`: one name per
sub-shape, in the kernel's `MapShapes` order, the same order as the
body's mesh ranges. Evaluators return the tables of the bodies they make
or change in `FeatureOutput.names` (keyed by body ID); the engine keeps
them per shape handle next to the reference-counted shapes of the cache
(`#names`), so a cache hit returns the same names, a body passed through
unchanged keeps its table, and the table goes when the shape does. It
also caches each body shape's `describe()` there. Names depend only on
the document and OCCT's deterministic results, so they are the same after
a kernel restart (test 2). The engine checks that a returned table fits
its shape (counts per kind) and fails the feature otherwise, releasing the
new shapes. A new body without a table gets **positional names**
(`<type>:<feature>:face#n`, by the geometric order): only as stable as
its geometry, but every body shown has names, so every pick can become a
reference.

`BodyMesh` carries `faceIds`, `edgeIds` and `vertexIds` (optional string
arrays, parallel to the ranges); the engine fills them when it meshes a
body.

### 3. What each operation names

Operations live in `naming/ops.ts` and return `{ shape, names }`:

- **Sweeps** (`namedPrism`, `namedRevolve`; facade `prism`, `revolve`).
  The facade records per sub-shape of the swept shape `generated` (edge →
  side face, vertex → side edge), `first` and `last` (its copies at the
  start and end: the caps). `nameSweep` names `first`/`last` of the face
  `op:F:cap:start` / `cap:end` and each edge's side face
  `op:F:side:<source>`, where `edgeSources[i]` is what edge `i` of the
  swept shape comes from: for a sketch profile, the sketch curve
  (`SketchOutputData.profiles[].edges`, ADR-0025; `_` when unknown); for a
  body face (press-pull), the body edge's name (`faceEdgeSources`); for
  several profiles swept as one compound, `compoundSources` maps each
  compound edge back to its part. `prism` takes a `shift` applied before
  sweeping, for symmetric and two-sided extrudes: sub-shape order is kept,
  so names don't depend on it. A full revolve has no caps.
- **Anything with history** (`withHistory` → `propagateNames`), used by
  `namedBoolean` and fillet. A result face keeps the name of the input
  face it was kept or modified from; if several input faces became one (a
  simplified join merging flush faces), the lowest input (the target),
  then the smallest name, wins. A face generated from a sub-shape is
  `op:F:from:(<that sub-shape's name>)`; a face with no history at all is
  `op:F:new`. Then `deriveNames` numbers the repeats and names edges and
  vertices. Booleans take `simplify` (`SimplifyResult`, i.e.
  `ShapeUpgrade_UnifySameDomain` with history), which a join should use:
  without it, a boss sitting in a plate's bottom plane splits that face.

### 4. Fingerprints

`GeomRef` gets an optional `fingerprint` (core schema, backward
compatible, no format version bump: ADR-0003 allows optional fields):

```ts
{ type: 'plane', at: [15, 10, 2.5], dir: [0, 1, 0], size: 150,
  adj: ['extrude:E:cap:end', 'extrude:E:cap:start', …] }
```

`type` is the surface type of a face, the curve type of an edge (or
`degenerate`), `point` for a vertex; `at` a face's area centroid, an
edge's midpoint or a vertex's point; `dir` a plane's outward normal, an
axis (cylinder, cone, torus, revolution) or a line's direction (axes and
lines with a canonical sign); `size` area or length; `adj` the names of
the faces next to a face or around an edge or vertex. The facade's
`describe(shape)` returns all of it for every sub-shape in one call;
numbers are rounded to 1e-6 in the document. The kernel makes
fingerprints (`fingerprintOf`, `KernelApi.reference`); the UI stores what
it gets.

`fingerprintScore` is 0 for a different type, else a weighted mean of
position `exp(-distance / scale)` (0.35; scale = √area for faces, length
for edges, at least 1 mm), direction (0.2; a plane's normal must point the
same way, axes either way), size ratio (0.2) and the Jaccard overlap of
neighbour names without split numbers (0.25). A match needs
`FINGERPRINT_THRESHOLD` = 0.6: the same face of an extrude recreated
under a new feature ID scores 0.75 (everything but the neighbour names),
a moved face with renamed neighbours around 0.9, a different plane far
away under 0.45.

### 5. Resolution

`resolveRef(ref, bodies, describe, { label })`, called by every feature
through `EvalContext.resolve(ref, options)`:

1. **Exact name** in any body before the feature. One match: done. Several
   (bodies sharing names): the best fingerprint, with a warning.
2. **Related names** (`nameRelation`): a face and its pieces or the whole
   it was a piece of (same stem, one split chain a prefix of the other);
   an edge or vertex whose faces pair up one to one with related faces.
   The closest relation wins (most equal faces, then the same `@n`). One
   such: done, silently. This is what keeps a fillet on
   `e[cap:end|side:l11]` after a slot inserted earlier splits the cap: it
   finds `e[cap:end#1|side:l11]`. Several (the referenced face itself was
   split): the best fingerprint among them, with a warning.
3. **Fingerprint** over every sub-shape of the kind: the best at or above
   the threshold, with a warning.
4. Otherwise a `KernelError`, which fails the feature.

Messages, in the style of `04-ui-spec.md` §8, name the element with the
feature's `label` ("the edge to fillet"; default "its face"):

- ⚠ "Lost its face after an earlier change and picked the closest match.
  Check the result, or edit the feature and pick it again."
- ⚠ "Its face was split by an earlier change; picked the closest piece.
  Check the result, or edit the feature and pick it again."
- ✕ "Can't find its edge any more: an earlier change removed it. Edit the
  feature and pick it again."

`ctx.resolve` adds warnings to the feature's status (deduplicated, with
`ctx.warn` and `output.warnings`). It returns the body, its shape, the
sub-shape index and current name, and `via` (`name` / `related` /
`fingerprint`); `Kernel.subShape` gives a handle to the sub-shape itself.
Body references (`kind: 'body'`) are body IDs (`<feature>:<n>`) and are
looked up in `ctx.bodies` directly.

### 6. What P2-06 does with it

```ts
evaluate(ctx) {
  const { kernel, inputs, feature } = ctx;
  using scope = kernel.scope();
  // Profiles: faces from the sketch output, sources from its profile info.
  const parts = inputs.profiles.refs.map((ref) => {
    const [sketch, region] = splitRef(ref.id);            // '<sketch>/<region>'
    const out = ctx.output(sketch);
    const info = (out.data as SketchOutputData).profiles.find((p) => p.id === region);
    return { shape: out.shapes[region], edgeSources: info.edges };
  });
  let source = parts[0];
  if (parts.length > 1) {
    const all = scope.track(kernel.compound(parts.map((p) => p.shape)));
    source = { shape: all, edgeSources: compoundSources(kernel, all, parts) };
  }
  // One side: vector = n·d. Symmetric: vector = n·d, shift = −n·d/2.
  // Two sides: vector = n·(d1 + d2), shift = −n·d2.
  const tool = namedPrism(kernel, { feature: feature.id, ...source, vector, shift });
  if (operation === 'new') {
    const id = ctx.bodyId();
    return { bodies: new Map(ctx.bodies).set(id, tool.shape), names: new Map([[id, tool.names]]) };
  }
  scope.track(tool.shape);
  const target = inputs.bodies.refs[0]?.id ?? first body;  // a body reference
  const joined = namedBoolean(kernel, operation === 'join' ? 'fuse' : operation,
    { shape: ctx.bodies.get(target), names: ctx.names(target) }, tool,
    { feature: feature.id, simplify: operation === 'join' });
  return { bodies: new Map(ctx.bodies).set(target, joined.shape),
           names: new Map([[target, joined.names]]) };
}
```

- **Press-pull on a planar face:** `const hit = ctx.resolve(ref, { label:
  'the face to extrude' })`, then `faceEdgeSources(kernel, { shape:
  hit.shape, names: ctx.names(hit.body) }, hit.index)` gives the face as a
  shape plus its edges' names as sources; sweep along the face normal
  (from `ctx.describe(hit.shape).faces[hit.index].direction`) and join or
  cut. The sides are `extrude:<F>:side:(e[…])`.
- **To object / up to a face:** resolve the face the same way and measure
  the distance along the sweep direction from its description (a plane:
  its centroid and normal), then sweep that far; names don't change.
- **Through all:** sweep past the target bodies' bounding box
  (`kernel.measure`).
- **Taper:** sweep straight, then add a facade op on
  `BRepOffsetAPI_DraftAngle` over the side faces with the start plane as
  neutral plane, returning `Modified` history; `withHistory` keeps every
  name. (`BRepOffsetAPI_MakeDraft` and `BRepFeat_MakeDPrism` also work.)
- **Cut and intersect:** `namedBoolean(kernel, 'cut' | 'common', …)`.
  Cut previews in red don't need names.

P2-07 revolve is the same with `namedRevolve({ axis: { origin, direction
}, angle })` (radians; ≥ 2π is full, with no caps); an axis picked as a
body edge comes from `ctx.resolve` + `describe` (a line's midpoint and
direction), a sketch line from the sketch data.

## Consequences

- The suite (`topo-naming.test.ts`, real OCCT through the engine and test
  features that use the same operations) covers: names of an extrude;
  identical names after a kernel restart and on cache hits; a fillet
  following its edge through a sketch dimension change; a hole added and
  removed; a removed sketch edge failing with its message; reordered
  sketch entities; a face split by a cut, numbered stably while the cut
  moves; a face a cut removes; the fingerprint fallback (and no wild
  guess); split faces found by related names and fingerprints; partial
  and full revolves (cones, and the annuli OCCT's history misses); a hole
  cut through a body with a fillet on its rim surviving a new radius;
  joining bodies (and a flush join merging faces); circles, arcs, slots
  and seams; a curve bounding a profile twice; several profiles and a
  symmetric extrude; every reference the engine hands out resolving to
  itself; positional names and a bad table.
- `memory.test.ts` runs every naming operation (sweeps, a simplifying
  cut, a fillet named through history, compounds, sub-shapes,
  descriptions, resolving) 1000 times with a flat heap. The native
  harness showed 0 bytes of growth between 300 and 1500 iterations of the
  new facade ops.
- Resolution builds a candidate list of every name of the kind per
  reference and fingerprints lazily; descriptions of cached bodies are
  cached. Fine for the models of Phase 2 and 3; a name index per body is
  the next step if it shows in profiles.
- Positional names (bodies of features that don't name their results,
  primitives until P2-10 names them) move when geometry moves: P2-10 and
  every Phase 3 feature must return tables.

## OCCT facts found on the way

- **`BRepPrimAPI_MakeRevol::Generated` returns nothing for an edge square
  to the axis in a full revolution** (the disc or annulus it sweeps is in
  the result, but BRepSweep doesn't mark it "used"). The facade asks the
  sweep itself (`Revol().Shape(edge)`) when `Generated` is empty. Partial
  revolves and prisms are fine.
- `BRepPrimAPI_MakePrism`/`MakeRevol` have `FirstShape(S)` / `LastShape(S)`
  per sub-shape; in a full revolve they are the same shape and not in the
  result, which the facade's record filter drops.
- A boolean's `Generated(face)` lists the new section edges and vertices,
  never faces; faces only come through `Modified` or unchanged. Without
  simplification, same-domain faces of both inputs become one face
  modified from both, and a face overlapping part of another is split.
- `BRepAlgoAPI_BuilderAlgo::Clear()` is protected: a builder on the C++
  stack is freed by its destructor (the `Clear()` rule of ADR-0001 is for
  builders deleted from JS).
- A seam edge lists its face twice among the edge's ancestors
  (`MapShapesAndAncestors`); `MapShapesAndUniqueAncestors` doesn't.

## Rejected

- **Naming edges and vertices through their own history.** OCCT gives
  edge and vertex history too, but a boolean's new section edges come as
  `Generated` from a face of each input, and split edges would need a
  second numbering scheme. Deriving them from faces handles both and
  needs nothing per operation.
- **Qualifying names with the profile's region ID** (`cap:end:<region>`).
  Region IDs hash the outline, so any edit to it would rename every face
  of the extrude. The curve IDs survive such edits; repeats get `#n`.
- **Splitting names by the sketch curve's parameter** (ordering the two
  side faces of one curve along the curve). More meaningful, but needs
  the curve's parameterisation for every curve type; the geometric order
  is the same rule everywhere and deterministic.
- **Trusting only exact names.** A fillet would fail as soon as an
  earlier cut split a neighbouring face; related names fix the common
  case without guessing, fingerprints the rest with a warning.
- **Sibling checks on exact matches.** A reference to `cap:end#2` could
  be checked against its fingerprint and moved to `#1` if the pieces'
  order flipped. Not done in v1: an exact name always wins (see Open).
- **Face aliases after merges.** When a simplified join merges two faces,
  the tool's name is dropped; a reference to it falls back to its
  fingerprint. Keeping every merged name as an alias is possible later.

## Open

- The repair UI: "fix references" with the old geometry as a ghost (P2-11)
  reads the fingerprint to draw it.
- An exact name whose split pieces swapped order (two pieces crossing each
  other's x) resolves silently to the other piece. A fingerprint check on
  split names (see Rejected) would catch it.
- Merged-face aliases; a name index per body; copies and patterns (P3-07)
  need an instance qualifier in names (`pattern:F:3:(…)`).
- `KernelApi.reference` answers for the bodies of the last recompute, not
  a dialog's preview.
