# ADR-0083: Reading `.f3d` files

- **Status:** Accepted, 2026-10-10 (the owner: read `.f3d` directly, with our
  own TypeScript decoder; the app's import first, then coverage). It reverses
  the earlier "don't parse `.f3d`" recommendation and amends Open decision 5
  in `docs/03-roadmap.md`. **Amended by ADR-0084** (2026-10-14): the import
  checks each rebuilt body against the file's own and brings the file's shape
  in where they differ, with a kernel at import time.
- **Builds on:** ADR-0066 (import), ADR-0068 (the public document API, which
  the import writes through), ADR-0005 (topological naming), ADR-0081
  (components, not yet there to import into).

## Context

People switching to Extrudo bring `.f3d` files. STEP export gives exact
solids without history. The research of 2026-10-09 judged the history readable
only by decoding the file's undocumented object serialisation and recommended
a plug-in for the authoring application instead. The owner asked for the
direct route: a test on 250 of their own designs (saved 2018 to 2026, each
with a reference STEP) showed it is practical.

## Decision

1. **A new package, `@extrudo/f3d`** (GPL-3.0-or-later, pure TypeScript, no
   WASM). It depends on `@extrudo/api`, `@extrudo/core`, `@extrudo/sketch`,
   `fflate` and `fzstd` (Zstandard entries since 2025); `@extrudo/kernel` is a
   test-only dependency. Two layers:
   - `readF3d(bytes)` decodes the archive into plain data: user and model
     parameters, the timeline, sketches (plane, points, lines, circles, arcs,
     splines, conics, texts), extrudes (operation, direction, distances, tapers,
     selected profile regions, the faces they start from or go up to),
     revolves (profile, axis, angles), holes (sizes, face plane, centres),
     circular patterns (the features they repeat, axis, count, angle),
     offset faces (the faces, the distance),
     fillets and chamfers (their edges as tagged B-rep faces) and every other
     feature by kind and name.
   - `f3dToDesign(f3d, name)` writes that through `@extrudo/api` into a new
     design and returns a report: what was imported, what was skipped and why.
   `importF3d(bytes, name)` does both; `f3dPreview(bytes)` returns the stored
   preview PNG.
2. **The format is written down in `packages/f3d/FORMAT.md`**, from our own
   reading of the files. Some layouts were first described by cadmpeg's
   specification (CC BY 4.0), credited there; its Provenance section says how
   the rest was worked out. No vendor code, text or icons are used; the UI
   names the file type only.
3. **Mapping rules.**
   - User parameters keep their expressions; an input whose expression names
     only user parameters keeps it, any other takes its value (the file's
     dimension parameters, `d12`, have no Extrudo counterpart yet).
   - A sketch on an origin plane, or on a plane parallel to one (through an
     offset plane), keeps its curves; the file's XZ frame is Extrudo's turned
     180° about X. Other sketch planes are skipped.
   - An extrude's or revolve's selected regions are rebuilt from the pieces
     of curves the file records around each (piece k of the n pieces the
     region's other curves cut a curve into), and every Extrudo region inside
     them is taken (even-odd). Where the sketch changed after the pick and the
     pieces no longer match, the region is rebuilt from its curves alone, or
     the region along the most of its curves still there stands in; a region
     whose curves are all gone is left out with a note.
   - A fillet's or chamfer's edges are named through the topological-naming
     scheme from the features that made their two faces — extrudes
     (`extrude:<id>:cap:start`, `…:side:<curve>`), revolves
     (`revolve:<id>:side:<curve>`) and earlier fillets and chamfers
     (`fillet:<id>:from:(<edge>)`, from that feature's edge nearest the edge
     being named) — and carry a fingerprint of the edge's line or arc (its ends
     where the faces that bound it cut it) for where a join merged faces. A
     face merged from several of an extrude's sides takes the smallest
     of their names, as Extrudo's merge does; otherwise the side whose curve
     holds the edge. An edge with no nameable face is left out: its geometry
     alone matched the wrong edge more often than the right one.
   - The bodies a feature joined, cut or intersected in the file become the
     extrude's or revolve's `bodies` when each is the only body of an imported
     feature (Extrudo's default is every body it meets). Bodies hidden in the
     file are
     hidden (`visible: false`), unless that could hide a shown body's shape
     (a shown body made by a feature not imported, or a later join with
     every body it meets).
   - Splines keep their poles and knots where Extrudo's control splines can
     hold them (clamped non-rational cubics; a quadratic span is raised to a
     cubic), and become fit splines through points along them otherwise;
     conics stay conics (start, shoulder, end, rho).
   - A text keeps its string, in the nearest bundled font (Inter for
     Arial and other sans faces), its capitals 0.716 of the file's font size
     high (Arial's ratio), centred on the bottom edge of the file's text box
     (Extrudo's letters are not the original's width); an extrude of it takes
     the whole text. A sketch with text is never placed mirrored (the file's
     XZ plane faces the other way): it goes on a plane facing the file's
     sketch normal instead, so the text reads the same way. An older file's text
     (2018–19) has its capitals' height, a box and alignment codes: it is
     aligned in its box as the file says (left or centred; top or middle),
     and a text mirrored in its sketch is turned instead.
   - An extrude that starts at an offset, or from a face parallel to its
     sketch, takes its profiles from a copy of the sketch moved that far
     along its normal (Extrudo's extrude starts on its sketch). One that goes
     up to a parallel plane becomes that distance; up to another face, a
     to-object extent when the face can be named. Either side of a two-sided
     extrude goes up to a face or through everything when it has no
     distance. Faces of bodies as the profile (press-pull) are extruded
     along their outward normal when they can be named.
   - A revolve about an origin axis or a line of its own sketch keeps its
     angle.
   - A hole on a face parallel to an origin plane becomes a sketch of its
     centres on that plane and a blind hole (simple, countersink or
     counterbore) drilling into the face; the file's 180° drill point is
     Extrudo's flat 0°.
   - A circular pattern replays the imported extrudes, revolves and holes it
     repeats (the corpus's patterns all repeat features) about an
     origin axis or a sketch line; fillets and chamfers in it are left out
     with a note.
   - Offset faces move the faces that can be named (those an imported
     extrude made) by the same distance; the others are left out with a
     note, and an offset of 0 (which the file allows) is skipped.
   - Components' features join the one design, with a note (Extrudo has no
     components yet, ADR-0081).
   - Everything else is skipped and listed in the report.
4. **In the app**, Home › Files › **Import Model** accepts `.f3d` (Import
   .extrudo… too). The home screen's one **Import…** card (the Start row,
   beside New design) takes `.extrudo`, `.f3d` and the model files (STEP,
   meshes, OpenSCAD); a model file makes a new design named for it, which
   opens with Import Model's dialog on the file. An `.f3d` import makes a new
   design with the file's preview as its thumbnail; when it opens, a notice
   says how many timeline features came across and lists the rest. The
   package is its own lazy chunk. Amended 2026-10-11 (the owner): the separate
   Import .f3d… tile and home-screen button went into Import Model and
   Import….
5. **No sample files in the repository.** The designs used to work out the
   format are other people's or the owner's own; `corpus.test.ts` reads a
   folder of them when `F3D_SAMPLES` points at one. `map.test.ts` covers the
   mapper on hand-built decoded data.

## Hostile files

A `.f3d` is untrusted input, read on the UI thread, so the reader bounds its
work and its memory (the security review of PR #7). The rules:

- **The archive** (`archive.ts`): at most `MAX_ENTRIES` = 4096 entries; one
  entry at most `MAX_ENTRY_BYTES` = 256 MB, and all entries together at most
  `MAX_TOTAL_BYTES` = 512 MB. Both are checked from the central directory's
  declared sizes **before** anything is inflated. Each entry inflates into a
  buffer of its declared size (fflate's `out` option, fzstd's output buffer),
  so a decompression bomb cannot allocate past it, and the **real** output —
  never a header's claim — is counted against the total. Only the entries the
  import reads are decompressed at all: the design streams (`MetaStream.dat`,
  `BulkStream.dat`), the B-rep `.smb`/`.smbh` streams and the preview. Every
  local header's name must match its central directory entry, and two central
  entries may not point at one local header.
- **The ASM B-rep stream** (`asm.ts`): every tag's value is bounds-checked
  before it is read; a string length is refused when it is negative or runs
  past the stream; a tag's reference count is refused when it exceeds the
  values that are left.
- **The design stream** (`decode/`): every count is read through `bytes.ts`'s
  `Reader`, which refuses a list longer than the bytes that remain.
- **The feature tail** (`decode/scope.ts`): the backward scan is bounded to
  the record's last 64 kB and to `MAX_CANDIDATES` name-like positions.
- **The app** (`apps/web/src/project/actions.ts`): a `.f3d` larger than 100 MB
  is refused before it is read.
- **The preview**: kept only when it starts with the 8-byte PNG signature and
  is at most 1 MB; otherwise the design imports without a thumbnail.
- Errors are worded for the person, e.g. "This .f3d file is too large to
  import (an entry unpacks to more than 256 MB)."

## Deferred

- Decoding in a worker, so reading a large file does not block the UI thread
  (the app caps the file at 100 MB for now, M1).

## Consequences

- On the owner's 250 files every file decodes and maps to a valid design.
  Rebuilt with our kernel and compared with the reference STEP (volume within
  0.5 %, tight bounding box within 0.05 mm; hidden bodies left out, as the
  reference STEP export leaves them out; 7 references hold no solid): of 243,
  120 match (7 of them while skipping features the result does not need), 60
  lose some features, 54 build different geometry, 8 have no body and 1
  crashes the kernel (an OCCT trap on a chamfer). The common gaps, by count:
  fillet and chamfer edges Extrudo cannot find again (faces of features not imported,
  faces gone from the final B-rep), components, faces given as an extrude's
  profile that cannot be named, threads, sweeps, splits, mirrors, and sketch
  dimensions and constraints.
- The format changes over time (record versions, reference widths). Each
  decoder checks its record's version and reports what it does not know
  instead of guessing; the report reaches the user.

## Rejected

- **cadmpeg compiled to WebAssembly** (Rust, Apache-2.0): it decoded 63 of the
  250 files (140 hit its work budget, about 47 older files fail), and its
  codec is about 400k lines.
- **A plug-in for the authoring application** that exports the design: needs
  that application, which a person leaving it may no longer have.
- **Geometry only from the B-rep** (ASM SAB): no history, and a STEP export
  already gives that.

## Amendment 2026-10-11: no kernel crash left in the corpus

The one file whose rebuild crashed the kernel (an OCCT trap on a chamfer, see
Consequences) was the kernel's fault, not the import's: the OCCT WASM ran on a
64 kB stack, which an earlier boolean on B-spline faces ran past, and the
chamfer tripped over the damage (ADR-0001's amendment of the same day: an 8 MB
stack and a guard). That file now rebuilds to its end and counts among those
that build different geometry: **120 match, 60 lose some features, 55 build
different geometry, 8 have no body, none crash** (every other file's volume,
box, skips and failures are unchanged). Its chamfer and four other edge or face
features end in ordinary messages ("Distance 0.75 mm is too large… (max ≈
0.74 mm)"), and one more chamfer loses its edge: OCCT can't build them on the
geometry the import gives them, which is an import question, not a kernel one.

## Amendment, 2026-10-11 (components)

The file's components become Extrudo components (ADR-0081) instead of
joining one flat design. This replaces decision 3's line on components.

- **Decoding** (`packages/f3d/src/decode/component.ts`, `FORMAT.md` §
  Components): every component, the root included, is a component record with
  its name; a timeline feature's base level names the feature list of its
  component, a body names the body container of its component, an occurrence
  places a component (ordinal, optional rigid transform) and a component's
  occurrence list holds the occurrences of the components inside it. A
  hidden-occurrence record names the path to an occurrence whose light bulb is
  off, and a hidden component hides the ones inside it. A "Body to Component"
  item names the body it takes and makes a copy in its target component.
  `readF3d` adds `components`, `bodyMoves` and a `component` on each feature
  and body.
- **Mapping** (`packages/f3d/src/components.ts`, `ComponentMapping`): one
  Extrudo component per component but the root (the root is the design, so
  its bodies stay loose), named as in the file (made unique, "Component1" for
  an empty name). Every Extrudo feature a timeline step makes is stamped with
  that step's component (`setFeatureComponent`), so its bodies join it by
  ADR-0081's rule; at the end each body the import knows is put where the file
  has it when the stamp says otherwise. A "Body to Component" is imported when
  the body it takes was: Extrudo moves nothing, so the body joins the target
  component and is shown as the file shows its copy; that copy counts as the
  body it took wherever the file names it. A hidden component stays hidden.
- **What an Extrudo component cannot hold is reported, not guessed**: a
  component placed away from its own origin is imported where its own features
  make its bodies; one placed several times is imported once; nested
  components stand alone (ADR-0081 §9 defers nesting). Seen in the samples: no
  copies, nesting in a few designs, and placed occurrences only in a design
  with no timeline.
- **Bodies hidden in the file**: a body in a hidden component no longer counts
  as "shown elsewhere", which kept every hidden body shown before.
- Body records whose index sits 16 bytes after their GUID string (behind other
  numbers) now decode too (38 → 18 undecoded body records in the samples).

Results on the samples (the measurement now also leaves out the bodies of
hidden components, as the reference STEP export does): of 243, 122 match (115 + 7 while skipping
features; 120 before), 59 lose some features, 53 build different geometry, 8
have no body and 1 crashes the kernel; no file got further from its
reference. Leaving hidden components out is most of it (a design whose other
parts are hidden: 51.6 → 0.03, 5.4 → 0.014 relative volume error); a "Body to
Component" design whose moved bodies are now known matches. Open: a design
whose shown body came from a feature not imported still shows every hidden
body (the rule above), and bodies a feature makes several of are not put into
another component when "Body to Component" moves them.

## Amendment, 2026-10-11: mirrors, rectangular patterns, sweeps, splits, threads and copied faces

The first import skipped five feature kinds the corpus uses (threads in 6
files, sweeps in 7, splits in 3, mirrors in 4, rectangular and path patterns
in 5) and could not name a face a pattern had copied. This amendment maps
them; the decoders are `decode/copies.ts`, `decode/sweep.ts` and
`decode/thread.ts`, the mappers `map-more.ts`, and the layouts are in
`packages/f3d/FORMAT.md`.

1. **Mirror** (of features or bodies) becomes Extrudo's Mirror in a plane
   built as a sketch's (an origin plane, one moved along its normal, or one
   turned about an origin axis). **Rectangular pattern** (of features or
   bodies) becomes Extrudo's, `measure: extent`: the file's distance is the
   whole run from the first instance to the last (both corpus patterns fit
   only that reading), signed along the direction; a direction group's own
   vector can point against its line, and then the pattern runs the other
   way. A grid's second direction is mapped the same way (none in the
   corpus). Mirrors and patterns of faces stay skipped: Extrudo copies bodies
   and features, not faces.
2. **Sweep** of sketch profiles along a chain of sketch curves, with its
   operation, twist and named bodies. Extrudo sweeps the whole path; a sweep
   that follows only part of it (`AlongDistance` and `AgainstDistance` both
   under 1), follows a guide rail, tapers or runs along body edges is skipped.
   The file's profiles need not touch the path and are carried along it
   where they are drawn, which is what Extrudo does too (it warns).
3. **Split body** by a plane, both sides kept, for bodies known as the one
   body of an imported feature. Splits by a face are skipped (none in the
   corpus).
4. **Thread**: Extrudo's modeled thread at the file's major diameter and
   pitch with no clearance (the file stores the thread class's own
   diameters), full length or a length from an offset. The file resizes the
   face to the thread (a shaft's to the major diameter, a hole's to the
   minor), so the face is found as the sketch circle of the side nearest that
   crest, not by the B-rep's radius. A thread in a hole wider than the thread
   is skipped (the file fills the hole in first; Extrudo only cuts). 55° pipe
   threads get Extrudo's 60° profile, with a note. Every thread in the corpus
   is modeled; a cosmetic flag was not found, so a cosmetic thread would be
   cut too.
5. **Faces a pattern or mirror copied** carry the tag `[source op, pattern
   op, instance op]`. The face is named after the face it copies (the B-rep
   face with the source's tag and not the pattern's) as Extrudo names a
   copy, `<op>:<feature>:<label>:from:(<name>)` (a mirror's without a
   label). The label comes from the copying feature's instance list: a
   circular pattern numbers its instances from 1 (the original), a
   rectangular pattern Cantor-pairs its two indexes, a mirror has one copy.

**Results** (the same check as above, 250 files): match 113 → 116, match
while skipping 7 → 6, partial 60 → 56, different geometry 54 → 56 (two
partials now map every feature and land within 2 %), no body 8, kernel
crash 1. Sweeps took four rails and boxes from 40-56 % volume error to
0.5-3 %; the threaded pipe adapter went from 23 % to 1.4 % (the 55°
profile). One file got worse: its reference is the swept body alone,
because the straight body it was made beside was moved into a component and
hidden, which this import does not follow yet.

**Not done:** splits of bodies Extrudo can only know by position.

**Second round (same day).**

6. **Path pattern** of features or bodies along a chain of sketch curves.
   The file stores the start point; Extrudo walks a chain from its first
   curve's own start (or its far end with `flip`), so the line at the start
   point goes first, flipped when the start is its end; a path that doesn't
   start with a line is skipped. The distance is the whole extent (the data
   record's u32 2, as a rectangular pattern's) and the copies turn with the
   path where the file's flag says so. Checked against the copied faces in
   the file's B-rep: the copies land within 0.06 mm (Extrudo samples a
   curved path as a polyline). Its instance code is 1.
7. **Hole faces** are named `hole:<id>:side:<point>.<role>` by geometry: the
   hole whose axis the surface lies on, the role by shape and size (wall or
   counterbore wall by radius, countersink cone or drill point, counterbore
   floor or flat bottom by depth). The file's face tokens for holes are not
   used. Few references need it (6 in 2 files), but a thread on a hole's wall
   now imports.
8. **An offset of faces a pattern copied is skipped again.** The one such
   offset in the corpus failed in the kernel, not in the import: Offset Face
   refuses every face of a body that has a notch across a cylinder's seam (a
   cylinder with a rectangular cut at +X reproduces it; at +Y or −X it
   works). That is the kernel's to fix.

The second round's results: match 116, match while skipping 6, partial 55,
different geometry 57, no body 8, crash 1. The two path-pattern rails halve
their volume error (0.53 % → 0.22 %, 0.46 % → 0.15 %); the threaded
pipe inlet's thread now imports (41 % → 28 %; the rest is an extrude's
region). For a threaded part, the reference STEP's tight box is inflated by
its spline thread faces (a mesh of the same STEP spans the part exactly), so
the box check can fail where the geometry agrees.

## Amendment, 2026-10-11 (components and features together)

The components amendment and the features amendment were written in
parallel; this one records what changed when they met.

1. **Features inside components.** Every timeline step stamps the Extrudo
   features it adds with its component, so a mirror, pattern, sweep, split
   or thread in a component puts its bodies there too: copies and split
   pieces follow ADR-0081's rule (the stamp, or the body a piece broke off).
2. **A cut and paste of bodies is a body move.** Its records have Body to
   Component's shape (body operand → link → the body it takes; the body it
   makes is in the target component), so it is read the same way. Its scope
   keeps no history state, which the first import read as "suppressed", so
   the paste was dropped and a body pasted into a hidden component stayed in
   view. Two designs now match (a rail whose straight body went to a hidden
   component: 98.6 % → 0.12 % volume error; a power-supply module: 495 % →
   0.34 %). The plain cut and paste names no body and stays unread.
3. **Hostile files.** The new decoders walk references several levels deep.
   Each record's references are now read once and each record visited once
   per walk, a pattern's instance list is checked pair by pair, a record's
   end and every reader stop at the end of the bytes, and a malformed
   mirror, pattern, split, sweep or thread record becomes an unread item
   instead of failing the whole import. A component name cut to 90
   characters is trimmed again, so it can't clash after Extrudo trims it.

Corpus (250 files; bodies of hidden components left out, as a STEP export
leaves them out): match 118, match while skipping 8, partial 48, different
geometry 60, no body 8, crash 1, no reference 7 — from 113, 7, 60, 54, 8, 1,
7 before both amendments, 115, 7, 59, 53 after components alone and 116, 6,
55, 57 after features alone. No file is worse than with the features
amendment alone; the four worse than with components alone are the features
amendment's own (threads now cut where the rest of the part is still off,
and one chamfer on copied faces).

## Amendment (2026-10-11): sketch constraints and dimensions

Imported sketches used to carry geometry and the coincident joins of shared
points only, and inputs naming the file's dimension parameters (`d12`) took
plain values. Now the file's sketch relations and dimensions come over, so an
imported sketch stays drivable.

- **Reading** (`decode/constraints.ts`, `packages/f3d/FORMAT.md`): a relation
  record lists its points and curves and a kind mask (coincident, collinear,
  concentric, parallel, perpendicular, horizontal, vertical, tangent,
  symmetric, equal, midpoint; every mask checked against the solved geometry
  over the owner's corpus); a dimension record lists what it measures and
  refers to the owner of the parameter it drives, whose value record holds
  the `dN` name, expression and value. A linear dimension's direction
  (aligned, horizontal, vertical) is a byte pair before that reference.
- **The rule: imported geometry never moves** (`sketch-constraints.ts`). A
  constraint or dimension is taken only when the geometry, where the file put
  it and as Extrudo's frame sees it, already satisfies it (1e-6 mm; the plane
  map may turn the file's horizontal into Extrudo's vertical, which the
  geometry decides). The sketch is then solved with planegcs: what the solver
  calls redundant or conflicting, and then anything that would still move a
  point, is taken out one at a time (the latest first) and counted, never
  forced. Trouble the sketch had before (its own joins) is not held against
  them. A tangent's side is read once every point making its joint is in.
- **The solver is the caller's**: `ImportOptions.solver` takes a
  `SketchSolver`; `@extrudo/f3d` imports only types from the sketch package's
  main entry (planegcs stays out of its chunk), and the app loads
  `@extrudo/sketch/browser` for the import. Without a solver nothing changes.
- **Parameters**: a dimension is named after the file's parameter (`d12`)
  when the name is free, and keeps the file's expression when every name in
  it is a user parameter or an imported dimension Extrudo evaluates to the
  file's value; else it takes the value. An expression naming a dimension that
  was left out falls back to its value. Feature inputs naming an imported
  dimension keep their expressions (none in the corpus do; dimensions name
  dimensions 430 times and user parameters 890 times). Extrudo's own new names
  (a text's height dimension) count on from past the file's last `dN`. User
  parameters now get the file's unit kind, so a unitless count no longer reads
  as a length.
- **The projected origin**, which the file holds fixed, gets a `fix` when the
  sketch has constraints (a point is made for it when only a constraint or
  dimension names it).
- **Report**: `ImportReport.constraints` (counts, left out by why and kind, the
  largest displacement); a note per sketch with left-outs; one app notice.

Results on the owner's 250 files: 9,280 constraints and 4,779 dimensions
imported (1,248 of the dimensions keep an expression naming another parameter);
left out: 89 with no counterpart (linear dimensions on circles, a midpoint of
two lines, a diameter on an arc, an unknown seven-point relation), 123 that
don't match the geometry (mostly offset dimensions, whose value is a signed
offset), 141 that over-constrain, 150 naming geometry the import doesn't draw
(text-box lines, ellipses, projected curves), 2 that would move geometry (an
ill-conditioned point on a circle a line touches). Every imported sketch
solves with no redundant or conflicting constraint and no point moving more
than 8.5e-7 mm; vetting takes 38 s over the corpus (3.5 s for the slowest
file). The rebuilt geometry is unchanged (two files closer through the unit
kind).

Deferred: a Fix relation (not found in the files), offset and sketch-pattern
relations (Extrudo has none), constraints on ellipses and splines, and naming
feature inputs after their `dN` (nothing in the corpus needs it).

## Amendment, 2026-10-11 (sketch constraints with the rest; hostile files)

Merged with the components and features amendments, the sketch constraints
change nothing they import: sketches inside components are stamped like any
feature, and the curves sweeps and path patterns follow are drawn and solved
in place (nothing moves), so the corpus results are those of the three
amendments together, two designs closer through the unit kind.

The review for untrusted files changed three things in the constraint import:

1. **Every imported dimension is named by the import.** The file's name when
   Extrudo can take it (valid, at most 64 characters, not a unit, function or
   constant, not taken, not used twice in the sketch), else one of Extrudo's
   own past the file's last `dN`. Before, a dimension without a usable name
   was named by the design at commit, from a counter that doesn't see the
   sketch's other names, and a clash, a reserved word such as `max` or a name
   used twice refused the whole sketch. Only `dN` numbers up to nine digits
   count, so a huge one in a file can't make the counting stand still.
2. **At most 1,000 constraints and dimensions of a sketch are vetted** (the
   samples have 213 at most); the rest are left out as `limit`. Vetting solves
   once per candidate it takes out, so this bounds the solves a sketch costs.
3. **A solver failure stays in its sketch**: the sketch keeps its geometry and
   joins, and all of its constraints and dimensions are left out as `failed`.
   The app's import no longer fails when disposing a broken solver throws.
## Amendment (2026-10-11): elliptical arcs

The file's ellipse record (`FF23079A…`: centre, unit major and minor axes,
radii, parameter angles, and the centre, end and start points) is read; all
69 in the owner's corpus are arcs (up to 190°), in 7 files. Extrudo's
`ellipse` entity (ADR-0014) is whole and has no arc, so an arc is drawn as
**exact conics** (ADR-0063's `mode: 'conic'`, a rational quadratic): one per
quarter turn at most, each from the affine image of a circular arc — the
shoulder is where the tangents at its ends meet, `rho = w / (1 + w)` with
`w = cos(Δt / 2)` — joined end to end with coincident constraints, the first
and last ending on the file's own points. The profile regions trace the arc
over its parameter angle. The kernel's conic is exact (P4-12), so a half
ellipse closed by a line extrudes to its exact volume. A whole ellipse would
map onto the `ellipse` entity; none is in the corpus, so none is read yet.
No constraint or dimension of the corpus names an ellipse (only its points),
so the conics take no constraint.

A line subclass (`AE42BAB6…`, 20 in 7 files) with a line's members after a
reference to its incidence record is read as a **construction line** (drawn
as profile curves, it split the profiles it crosses); the constraints naming
it (midpoints, tangents, parallels) now go through the vetting.

What stays in the "names geometry the import doesn't draw" count is the
boxes of texts: newer texts' box lines (`EA3B930A…`), older texts' box lines
(`16DEFC4D…`) and their corner points (`00D157C2…`). Most of those
constraints hold the box together (parallel and perpendicular sides); the
rest place a text against other geometry, which Extrudo's text (an anchor
and a height, its own font's width) cannot follow faithfully. Deferred.

Results on the owner's 250 files: 9,300 constraints and 4,779 dimensions
imported (+20 constraints, all on the construction lines); left out 89 with
no counterpart, 123 that don't match the geometry, 145 that over-constrain
(+4), 126 naming geometry not drawn (150 before; what is left is text boxes),
2 that would move geometry. No imported sketch over-constrained or
conflicting; largest move 8.5e-7 mm. Rebuilt geometry: no verdict changes;
one file imports one more feature (still partial, volume error 2.544 % → 2.536 %).

## Amendment, 2026-10-11 (fillet and chamfer edges)

Fillets and chamfers were the importer's largest loss: about 280 of the
1,000 imported ones failed in the kernel, most for a reference it could not
find or a size it refused. A corpus tool resolved every edge reference the
way the kernel does, against the bodies just before its feature, and
judged the pick against the file's own edge geometry; this amendment is
what that showed.

1. **Copies are measured where they are.** An edge on a pattern's or
   mirror's copy was measured on the copied face, so its fingerprint sat on
   the original (a gear's 46 tooth edges all pointed at the first tooth).
   The copy's own B-rep face gives its surface now.
2. **The B-rep's stored edges.** The ASM reader follows each face's loops to
   its edges (curve, vertices, the face across). The streams keep earlier
   states too, so the edge a fillet rounded is often still there between its
   two faces (`F3dEdge.known`). It picks which of two lines a plane or a
   cylinder meets a cylinder in (a tooth's side and the root circle), gives
   the line or circle where the two surfaces are not followed, and picks the
   stretch the bounding faces' cuts end the edge at when a bounding cylinder
   cuts the line twice. A plane slanted across a cylinder gives an ellipse.
   An edge held only by a guessed round face's name or by one face still
   needs a line or circle of the two surfaces themselves: letting the new
   curves hold such edges made whole rounds fail where the edges lay on an
   earlier round the kernel could not make.
3. **Two-size chamfers take their reference face.** With two distances, or a
   distance and an angle, which face takes the first distance shows only in
   the chamfer faces the file made (`F3dEdgeFeature.made`): from a point on
   the edge, along each face square to it, the chamfer face lies that
   face's distance away. A set gets Extrudo's reference face when all its
   edges agree on it, or on the other face with the sizes swapped
   (d · tan θ at 90° − θ); a set is never split, since a tangent chain
   must stay in one set. Extrudo's angle is the file's (the other distance
   is d · tan θ on both sides).
4. **Chains are not spelled out.** The kernel rounds a whole tangent chain
   whichever of its edges it is given. An edge held only by a guessed name or
   one face's that runs on smoothly from an edge held by name is left out:
   it added nothing, and when it lay on an earlier round that failed it was
   lost and failed this round too (30 rounds in the corpus failed only that
   way, nearly all after the earlier round failed).

Not done: an edge on an earlier round that failed is still lost where it is
not part of a chain (the kernel fails the whole feature on one lost edge,
and the importer can't know which rounds the kernel will refuse); a chamfer
or fillet that consumes a whole face, which the file allows and the kernel
refuses ("too large", max a hair under the face's width: two holders
now fail there instead of bevelling the wrong face); rounds on edges whose
faces belong to features not imported (regions not found, sweeps).

Corpus (250 files, bodies of hidden components left out, sketches vetted by
the solver as in the app): match 122, match while skipping 8, partial 48,
different geometry 57, no body 8, crash 0, no reference 7 — from 118, 8, 48,
61, 8, 0, 7 with the import before this amendment. Four designs match that did
not; references whose pick lies on the file's edge rose (by name 3,732 →
3,843 before item 4) and picks off it fell (by name 118 → 57). Worse: the two
holders above, a case whose fillet now rounds all four of the
file's edges (3.3 % → 4.2 % volume error) and a toy whose rounds already failed
(0.1 % → 0.2 %); a stand's chamfer no longer picks four edges 5 mm
off by fingerprint, and its volume error went from 0.04 % to 0.25 %.

## Amendment, 2026-10-11: reasons in plain words

The owner's UI review 3 (R3-18): a toast after an import showed "profile region {…} not found
in the sketch (it has N: {…})" with hundreds of curve keys. A skipped feature's report entry
(`SkippedFeature`) now has `reason`, a few plain words for people, at most `MAX_REASON` (120)
characters and never a list in braces, and `detail`, the technical text, when it says more.
`skippedFeature(name, kind, raw)` words every reason the mapper gives: a profile region that
could not be matched becomes "its profile couldn't be matched to Sketch3's curves" (the raw
text, `unmatchedRegion`, now names the sketch), a short plain reason stays as it is, and a
longer or technical one (a thrown error) becomes "it couldn't be rebuilt in Extrudo". The app's
notice (`importNotices`) shows the reasons only; `corpus.test.ts` writes every skipped
feature's reason and detail to `F3D_REPORT=<file>` for bug reports. `reasons.test.ts` covers
the wording.

## Amendment, 2026-10-11 (lost edges no longer take the whole round down)

Some edges a fillet or chamfer of the file names can't be found in Extrudo's
body: they lie on an earlier round the kernel couldn't build, or on a face of
a feature that wasn't imported. One such edge used to fail the whole round
(ADR-0033), and the rounds after it that needed its faces with it. The
importer now sets **`skipLostEdges: true`** on every fillet and chamfer it
writes (ADR-0038's and ADR-0043's amendments of this date): the round is
built from the edges that are found and warns how many it left out, listing
them for Fix References; a round none of whose edges is found still fails.
Features made in the app keep failing loudly, since they don't set it.

Corpus (250 files, on top of the fillet and chamfer edges amendment above;
baseline the same code without the input): match 122 → 123, match despite
skips 8, partial 48, mismatch 57 → 56, no bodies 8, no reference 7, no
errors. Of the fillets and chamfers, 253 → 236 fail, and those that fail on a
lost edge 52 → 17 (32 → 11 files; the 17 have every edge lost). 18 rounds now
build (each with a warning: some leave their lost edges out, others find all
their edges now because an earlier round they stand on builds), 18 get past
the lost edge to OCCT and fail there ("too large", "can't be chamfered with any
distance", an edge that "isn't between two faces"), and one round fails that
built before: a chamfer an earlier fillet, now built on 12 of its 18 edges,
leaves no room. New match: a shelf whose chamfer was held by one lost edge.
Eight designs come closer; no verdict got worse, and six volumes moved away
from the reference by 0.03 to 0.31 percentage points where a round now builds
on part of its edges while an earlier round it continues still fails (the
edges on that round are the ones left out). Before the edges amendment the
same change took 77 lost-edge failures to 17 and three designs to a match: the
edges amendment's weak-edge rule (next paragraph) already keeps most of the edges that
would be lost out of the file's rounds.

**With the weak-edge rule.** The edges amendment leaves out an edge named only
by a guessed fillet or chamfer face name, or by one face, unless its shape is a
sure line or circle, and drops a weak edge that only continues the tangent
chain of an edge held by name, both because one lost edge failed the round.
With `skipLostEdges` a lost edge only drops out with a warning, so that reason
is gone for imported rounds; what remains is that a weak edge can resolve to
the *wrong* edge by fingerprint, which a skip doesn't catch (eight rounds
this change lets past their lost edges now fail on "Edge N can't be filleted:
it isn't between two faces", an edge that resolved but isn't one the kernel
can round). Relaxing the
rule is a measurement for the edges work, not a change made here.

Next: measure the weak-edge rule relaxed for imported rounds (keep guessed
and chain-continuing edges, let `skipLostEdges` drop the lost ones), against
the wrong picks it lets in.

## Amendment, 2026-10-12: the active design segment

A `.f3d` file can carry more than one design segment: the active design sits under the asset
folder marked `[Active]`, while an `Animation/` or `Simulation …/` asset holds a design
segment of its own. `readF3dEntries` used `designSegments(entries)[0]`, sorted by folder name,
so a file whose animated asset sorted first read an empty timeline and imported nothing. It
now takes the segment under the `[Active]` folder and falls back to the first when no folder
is marked that way (`activeDesignSegment` in `model.ts`).

Corpus (250 files): no bodies 8 → 7, mismatch 56 → 57, every other verdict unchanged; matches
do not move. Both files that carry more than one segment now read their real design — one
imports bodies it had none of, the other reads its real design, which is direct-modelled and
so not built by the feature replay.

## Amendment 2026-10-12 (the imported rounds build what they can)

The import sets `skipLostEdges` on every fillet and chamfer it writes
(ADR-0038's and ADR-0043's amendments of 2026-10-11). Those rounds now also
build the chains that work: a round whose one tangent chain is too large keeps
the rest and warns how many edges were left out and why, instead of failing
whole (at most a third of the edges; a larger drop fails as before). On the
250-file corpus this moved four designs from *mismatch* to *match* — match 123
→ 127 — with no design's verdict worse and no body lost.

## Amendment, 2026-10-13: reading a body's B-rep stream as STEP

The file carries each body's solid in an ASM B-rep stream
(`…/Breps.BlobParts/BREP.<uuid>.smb[h]`). A slice now reads that stream into
topology and writes the body as AP214 STEP, for bodies a kernel can rebuild
exactly. It does not change the import: nothing in `map.ts` calls it yet; a
later change can feed its STEP through the `import` feature (ADR-0066).

**What is read.** `asm-body.ts` walks body → lump → shell → face: each face's
surface and sense, its loops in order with their coedges and coedge sense, each
edge's curve and vertices, and the outer/inner loop split (the first loop is the
outer one, as the file writes it). Each `lump` names its live shell, so the
lumps in stream order are the solids; history shells carry no faces and are not
read. A design body reaches its stream through its body container: the container
lists its component's bodies in order and points at the record whose payload is
the `BREP.*.smb[h]` file name, so container body *i* pairs with lump *i*. Only
visible bodies are taken; hidden ones are left out, as a STEP export of the
design leaves them out.

**What is written.** `brep-step.ts` writes one body as AP214 STEP in mm:
`PLANE`, `CYLINDRICAL_SURFACE`, `CONICAL_SURFACE`, `LINE`, `CIRCLE` and
`ELLIPSE`, sharing vertices and edges. A cone whose file slope is negative
narrows along its axis, while STEP's semi-angle is positive and the cone widens
along the placement's +Z, so the writer flips the placement axis for a negative
slope (the radius sits at the centre, which stays put). A body with any other
surface or curve, an edge with no vertex, a face with no boundary or a loop with
no edge is not written; `f3dBodiesStep` returns the reason instead, so an open
shell is never emitted. `ASM` streams also write each record's class followed by
its base classes (each with a `0x0d` tag); `readAsm` keeps the last name in
`type` (what the rest of the reader was written against) and the record's own
class in a new `derived` field, which this reader uses. The two container
members that name a stream file are the type table's own 36-character GUID
strings (`74CA4562…`, `40DCC3F41D…` — the latter ten hex digits before its first
dash, as the file writes it); both are read from the bulk and are needed
(containers with bodies use both).

**Limits.** Spline, torus and sphere surfaces and intcurve / exp_par_cur curves
are not carried; they are refused with a reason (the stream often holds an
approximating NURBS for them, which a later change can read). A stream can hold
more solids than the visible bodies that name it (a hidden body's solid beside
them); those are left unwritten rather than pairing by position, since the
container does not mark the hidden ones.

**Hostile input.** Every walk is bounded: each pointer index is checked against
the record count, the whole stream is walked once (a shell, face, loop or coedge
is read at most once — a duplicate shell is skipped, a duplicated face, loop or
coedge throws `F3dFormatError`), so a crafted stream of many lumps on one shell
cannot make the read quadratic, and a chain that runs away throws instead of
looping. The reader shares `readAsm`'s guarantees (no read past the stream's
end).

## Amendment, 2026-10-13: B-rep orientation, spheres and tori, closed edges

The B-rep writer above was written against the wrong sense on three readings;
this amendment corrects them and adds two surfaces. It still does not touch the
importer.

**The edge's own sense.** An `edge` record carries a sense flag. When it is set
the edge runs against its curve, so `EDGE_CURVE`'s same-sense is the opposite;
the writer had always written `.T.`. Over the corpus the flag and the vertex
geometry agree on all but a rare few edges, and for a straight curve the vertex
positions say the edge's direction directly, so a line's sense is taken from its
geometry and every other edge's from the flag. This is the change that moved
most of the previously-written-but-wrong bodies to matching.

**The loop winding and the face sense.** A face record's flag is its forward
sense: true when the face's normal runs with its surface's. STEP's
`ADVANCED_FACE` same-sense is the opposite of *reversed*, and the file winds a
loop the other way round from STEP's surface-normal winding, so a not-reversed
face's loop is reversed and its same-sense is true, while a reversed face keeps
the file's loop and same-sense false. The reader stores the flag as `reversed`
(the complement of the file's) and the writer writes
`same_sense = reversed ? .F. : .T.`. A body whose loops ran the other way round
than its surfaces was otherwise written inside-out.

**Closed circle edges.** A full-circle edge (its two vertices at one point) has
no start-equals-end `EDGE_CURVE` that a kernel reads cleanly; it is now split at
its antipode into two half edges, as the reference exports do.

**Spheres and tori.** `sphere-surface` (centre, radius, pole axis) and
`torus-surface` (centre, axis, major radius, minor radius, tube direction) are
read and written as `SPHERICAL_SURFACE` / `TOROIDAL_SURFACE`. A negative sphere
radius or torus minor radius is the file's way of pointing that surface's normal
inward: the writer writes the radius positive and marks the face reversed (the
same loop/same-sense pair as above). A torus with a negative major radius is
refused with its own reason, as is a torus whose tube is not smaller than its
ring (a spindle or horn torus).

**Still refused.** intcurve and spline curves and spline surfaces (the corpus's
intcurves mostly carry no B-spline at all, and the ones that do carry a
compound record that is not decoded here), and the degenerate tori. A body is
still refused when a stream holds a different number of solids than the bodies
that name it: a stream can hold a hidden body's solid or a construction body's
solid, and the component's body order lines up with the lumps on only part of
the corpus (a first implementation matched a few more designs and wrote wrong
solids for several others), so the extra solids stay unwritten rather than
guessed.
