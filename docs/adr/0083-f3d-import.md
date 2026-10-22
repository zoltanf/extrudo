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
  buffer of its declared size, streaming, and must fill it exactly (since the
  2026-10-15 amendment, which also caps the ratio of declared to compressed
  size), and the **real** output — never a header's claim — is counted
  against the total. Only the entries the
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
those in the owner's corpus are arcs (up to 190°). Extrudo's
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

## Amendment, 2026-10-14: a stream's solids paired with the bodies by the face tags

**What.** `bodiesStep` no longer pairs container body *i* with the stream's
*i*-th solid, and no longer refuses a whole stream that holds more solids than
the bodies that name it. Each body that names a stream (shown, hidden, or one
the reader could not decode) claims solids by evidence (`pairLumps` in
`brep-lumps.ts`): its creator's operation IDs (`F3dBody.ops`, from the
operation table) against the operations on each solid's faces (`lumpOps`).
In order: (1) the one solid carrying the creator's operations, unless another
body has that same single candidate (both refused); a body with several takes
the one left after the other bodies' single candidates are struck out;
(2) the container order, only when the stream holds as many solids as bodies
and no body's evidence disagrees with its position; (3) among several
candidates, the one whose operations include every other candidate's (the
latest state; the others are earlier states or tool solids of the same
feature), when no other unpaired body lists it. Anything else is refused with
a short reason (`solid not found: no creator`, `… creator in no solid`,
`… creator in several solids`, `… another body claims it`); a solid no shown
body claims is never written. The pairing counts its steps and gives up past
4 M on a crafted file (`… too many solids`).

**Why.** The container's order is not the stream's on every file, and the
extra solids are tool solids, earlier states and hidden bodies' solids
(`FORMAT.md`). Measured on the corpus before choosing: where the counts match,
the creator's operations sit on one solid for 280 bodies and agree with the
index for 278; the other two are a design whose two bodies the index wrote
crossed (the reference export's solid names and face counts confirm the
creators'). The latest-state key decides 15 bodies of streams with extra
solids, each of whose face count matches a reference solid's. It runs after
the container order, not before: in one design two shown bodies are a solid
and its copy plus one operation, and the latest state would give both the
copy. Body links name only a body's creator (one link per body over the 449
in the corpus), so no later feature was available as a key; bodies in no
container are mostly tool bodies whose operations also sit on the result, so
they do not claim. The container order is dropped stream-wide when any body's
evidence contradicts it: in one cabinet stream the index had written two of
nine panels with another panel's solid, and the bodies of a feature that made
two panels with equal tags there are now refused instead.

**Numbers** (250 files, `probeDocument` → `planBodies` → `applyBodyPlan`,
against the reference STEP): designs matching 165 → 169 of 237 comparable,
rescued 30 → 34, harmed 0. File bodies: written 214 → 215, editable 131 → 126,
frozen 78 → 84, unchecked 147 → 146, missing 24. Of the 32 bodies the "stream
holds N bodies" refusal kept out, 9 are now written (3 editable, 6 frozen),
21 reach the writer and stop at geometry it does not carry (15 intersection or
spline, 6 degenerate tori), 1 is refused as `creator in several solids` and 1
as `creator in no solid`. The 8 cabinet panels the index wrote before are now
refused as `creator in several solids` (they were editable; that design's
verdict and volume error are unchanged). The crossed
design now writes each body's own solid (its verdict was already a match: the
check pairs by geometry), so the frozen body carries the right name.
## Amendment, 2026-10-14: B-spline curves and surfaces in the B-rep writer

The writer refused every body with an `intcurve` edge or a `spline-surface`
face, the first blocker in most of the designs whose replay still missed. Those
records keep, besides their procedure (an intersection, an offset, a blend, an
extruded profile), the B-spline the file approximates them with; the writer now
reads that B-spline and writes it. (The previous amendment's note that most
intcurves carry no B-spline read a record's last class name, `nullbs`, which
names a parameter curve inside the block; all but the helices do carry one.)

**What is read.** A curve or surface record carries its definition in a subtype
block, or a reference to a block written earlier in the same stream (counted in
the order blocks open, nested ones included); `readAsm` now keeps the class names
inside a block as values in place, since the layout depends on them. The new
`asm-spline.ts` reads the block's B-spline: degree, form, knots with
multiplicities (the file writes the end knots `degree` times; STEP's
`degree + 1` is restored), control points and weights; for a surface the two
directions and the grid. The procedure is never re-evaluated. The curve record's
sense (against its B-spline) is folded into the edge's, and the edge's two
parameters, which the file negates for each reversal, give its stretch of the
B-spline; a surface record's sense is folded into the face's, as an inward
sphere's is. `FORMAT.md` ("Spline curves and surfaces") has the layout and how
it was checked: evaluating the decoded B-spline at each edge's parameters gives
its vertices to under 1e-6 cm on all 31,484 B-spline edges of the corpus's
live solids but 43 closed ones whose stretch wraps past the curve's start.

**What is written.** `B_SPLINE_CURVE_WITH_KNOTS` and
`B_SPLINE_SURFACE_WITH_KNOTS` in mm, as complex rational entities when a weight
is not 1. A closed B-spline edge is split, like a full circle: at the curve's
seam when its stretch crosses it, else at the middle of its stretch.

**Still refused.** A helix (a thread's curves and faces) keeps no B-spline and
is refused as "an intcurve with no B-spline". A lump with more than one shell
(an outer shell and voids inside it) is now refused as "a solid with an inner
void": the reader took only the lump's first shell, so such a solid was
written without its cavities. The spline refusal had hidden this; with splines written,
eight designs that matched through the replay were frozen to a body 0.7–3.5 %
too large. Walking the lump's whole shell chain also stops a shell of it that
an earlier (history) lump record names from being read as a second solid, so ten
bodies whose stream seemed to hold more solids than bodies now give the void
reason instead (no verdict changes). Writing the voids (`BREP_WITH_VOIDS`) is left for later.

**Measured** on the 250-design corpus with the body check (replay → probe →
plan → apply, the reference STEP's volume within 0.5 % and tight box within
0.05 mm): 165 → 200 designs match of 237 → 239 comparable, 30 → 65 rescued,
none harmed; bodies written 214 → 294 of 380, editable 131 → 158, frozen 78 →
128, unchecked 147 → 82, missing 24 → 12. Three of the newly written frozen
bodies fail OCCT's validity check yet measure as the reference does. The
blockers now left in front of the body check are the voids (21 bodies),
degenerate tori (14 with a tube not smaller than its ring, 9 with a negative
ring radius), streams holding more solids than bodies (22), helices (7), edges
with no curve (9) and inward-signed surfaces (8).

## Amendment, 2026-10-14: voids, degenerate tori, cone apexes and loop winding in the B-rep writer

The writer still refused four kinds of body after the B-spline amendment;
three are now written, and a winding error that made inward-signed tori come
out wrong is fixed. `bodiesStep`'s pairing and `body-check.ts` are unchanged.

**Voids.** A lump's shell chain is its outer shell and the voids inside it.
The file's order does not say which shell is the outside (the chain's first in
21 of the corpus's 27 such lumps, its second in 6); in all 27 it is the only
shell whose box holds every other shell's, so that is the rule, and a lump
whose shells do not nest that way is refused ("a solid with voids whose outer
shell is not known"). The voids are written as the file's own STEP export
writes them: a `BREP_WITH_VOIDS` whose voids are `ORIENTED_CLOSED_SHELL`s
(`.F.`) over closed shells of the void faces with the file's own senses. The
kernel reads it as the outer solid less the voids (a synthetic 3 cm box with a
1 cm cavity measures 26 000 mm³; on the corpus a written body with several voids
measures exactly its outer shell less its voids' volume).

**Degenerate tori.** A torus whose tube is not smaller than its ring, or whose
ring radius is negative, is the tube circle centred at the signed ring radius,
and the face uses its part on its own side of the axis (all 980 vertices of the
corpus's 115 such faces sit there). No `TOROIDAL_SURFACE` holds it; the export
writes each such face it shares vertices with as a rational degree 2 × 2
B-spline, and so does the writer now: the exact rational B-spline of the tube's
arc from axis to axis, swept a whole turn, its seam in the middle of the widest
angle the face's boundary leaves free. Its u × v normal points out of the tube,
as the file's torus's does, so the face keeps its sense. A lemon whose tube does
not reach the axis is still refused.

**Loop winding.** The file winds a face's loop against its own surface's
normal. The writer decided whether to reverse a loop from the face's sense
after the reader had folded a negative radius (or a spline record's sense) into
it, so on an inward-signed surface the loop ran the wrong way. A kernel turns a
single wrong loop round, but on a torus face bounded by two parallel circles the
winding picks the band: such faces came out as the rest of the torus (473.6 mm²
where the export has 101.2). The loop now follows the file's own face flag. The
eight bodies the body check leaves unchecked because of an inward-signed
surface each measure as the export's solid once read on their own (volume
within 0.02 %, box exact). The body check's rule that left such bodies
unchecked was lifted the same day (ADR-0084's amendment): the writer now
vouches for them. With the rule lifted, the corpus gains eight more matching
designs and none harmed.

**Cone apexes and earlier lumps.** Every edge with no curve in the corpus (125)
is a cone's apex, closing the face as a loop of one edge whose two ends are the
apex; the writer leaves that loop out (a kernel closes the cone itself), and
any other curveless edge is still refused. A lump record whose shell names
another lump is an earlier record; two such records reached a shell nothing
else reaches, whose face chain runs into a live lump's faces, which made the
whole stream unreadable. The reader now skips them.

**Helices** stay refused: a thread needs both its helix curves and its helix
surfaces, and neither keeps a B-spline. `FORMAT.md` records what was learned
(the helix curve's layout reproduces the vertices of 78 of the 84 helix edges;
the swept-line surface's stored profile vector is not settled).

**Measured** on the 250-design corpus with the body check: 200 → 205 designs
match of 239 → 240 comparable, 65 → 70 rescued (two with voids, three with
degenerate tori), none harmed; bodies written 294 → 349, editable 158 → 180,
frozen 128 → 140, unchecked 82 → 51, missing 12 → 9. The writer's refusals left
are streams holding more solids than bodies (24) and helices (7); 29 written
bodies carried an inward-signed surface, which the body check no longer leaves
unchecked (ADR-0084's amendment of the same day).
## Amendment, 2026-10-14: imported rounds at their limit

The rounds the import writes (all with `skipLostEdges`) now also build when
they fail at exactly their size: ADR-0038's and ADR-0043's amendments of this
date retry a round whose kernel maximum is at least 0.99 of its size a hair
under it, with a warning. 20 designs' first divergence from the file was such a
round (job C's divergence report). Replay-only corpus: within 0.5 % volume and
0.05 mm box 135 → 142, 50 rounds error → built, 2 rounds built → error
(downstream of a newly built round, on edges next to its faces), one design
match → mismatch (0.48 % → 0.71 % volume; the newly built 0.33 mm chamfer is
the file's, on all 42 of its edges, and the design was short of volume for
another reason).

## Amendment, 2026-10-14: a symmetric extrude's distance is each side's

A symmetric extrude was imported with its `AlongDistance` as the whole length
(Extrudo's default `symmetricMeasure`), so its caps came in at half the distance
from the profile. The file's own cap faces (B-rep faces tagged by the feature's
operations with a normal along the extrude's direction vector) lie the whole
distance either side of the profile in all 26 symmetric extrudes of the corpus
(10 designs; FORMAT.md "Extrude"), including the five that showed no divergence
before only because their caps fall outside the body or on another plane. The
import now writes `symmetricMeasure: 'half'`. No whole-length symmetric extrude
is in the corpus, so a flag for one was not found; if a file has one it would
come in twice as long. Replay corpus: within 0.5 % volume and 0.05 mm box 142 →
147 (5 designs reach it, none leaves it); Pillar Connector's box error 8.5 mm →
0; 4 rounds now build, 1 round further down now fails (it had been built on the
half-length body). Body check on the 10 designs that changed: editable 1 → 6,
frozen 6 → 1. Test: `map.test.ts` "extrudes a symmetric extrude's distance on
each side…".

## Amendment, 2026-10-14: an up-to-face offset to a slanted plane

The file measures an up-to-face offset (`Side1Offset`, `Side2Offset`) along the
target face's normal; Extrudo's `offset` moves the target along the sweep. For
a plane slanted to the sketch the import now writes the offset divided by the
cosine between the sweep and the plane's normal (same sign); other faces keep
it as it is (`alongSweep` in `map.ts`). The corpus has 16 up-to-face extrudes
with a non-zero offset: 13 to a plane parallel to the sketch (already a
distance) and 3 in one design to a slanted plane, whose end
faces were about half a millimetre off the file's and now lie on them. Replay corpus: no
verdict changes (that design already matched, volume error 0.015 % → 0.010 %).
Test: `map.test.ts` "measures an up-to-face offset along the sweep…".

## Amendment, 2026-10-14: an offset's side face among collinear lines

An Offset Faces names its faces without a point on them, and an extrude side
on a plane that holds two collinear profile lines was named after the first of
them: in a housing family the offset moved the wall next to the wrong corner.
The file roots a side's plane on its line's stretch (FORMAT.md
`plane-surface`), so the plane's root point is now the hint that picks the line
when no other is given (`faceName` in `map.ts`). Survey of the corpus: of the
7,864 extruded side planes that offsets, fillets and chamfers name, all have
their root point on a line's stretch; of the 2,964 on planes holding several
lines, 2,071 are on exactly one. Together with ADR-0051's amendment of the same
day (rounds next to a moved face keep their radius), the 7 designs whose first
divergence was an Offset Faces: 3 now have no divergence left (the housing
family's corner round on the file's axis at 3 mm), 3 diverge first at a later
feature that was skipped or failed before too, and 1 still at its Offset Faces
(refused for rounds meeting at a sharp corner). Replay corpus: no verdict or
feature status changes. Body check, both amendments together: editable bodies
195 → 199, frozen 159 → 155, none worse; one design's offsets name 9 distinct
faces instead of 7 (two collinear walls had come out as one name), and 3 of its
bodies now rebuild as the file has them. Test: `map-more.test.ts` "offsets the side
of the collinear line its plane is rooted at".

## Amendment, 2026-10-14: imported rounds where they meet, and edges no round can take

Of the 29 designs whose first divergence from the file is a round OCCT refuses
on a body that matches the file (too large with a maximum under 0.9 of the
size 14, "can't all be built where they meet" 9, "at any size" 6), the import's
rounds (all with `skipLostEdges`) now build in two more cases (ADR-0038's and
ADR-0043's amendments of this date): rounds that fail together at exactly
their size are built a hair under it (5 of the 9 "where they meet"), and the
smooth edges an imported set can hold are left out instead of failing the
round. The rest is OCCT's own limit or the facade's trap guard; healing the
rounds OCCT builds unsound was measured and not kept (no design gained, one
lost). Replay corpus: within 0.5 % volume and 0.05 mm box 147 → 149 (a pipe
holder and a hinge reach it), none worse; 12 rounds error → built, none built →
error. Body check (all 250): after-check matches 225 → 225, harmed 0; bodies
editable 195 → 198, frozen 159 → 156 (made differently 114 → 111), unchecked
26 → 26 with the same reasons; the two designs above and a table base's body
turn from frozen to editable.

## Amendment, 2026-10-14: features the import skipped

143 timeline features of the 250-file corpus were skipped (suppressed ones not
counted), and in 23 designs a skipped feature was the first place the replay
departed from the file (job C's divergence report), so everything after it
started from the wrong body. An inventory by kind and reason showed five causes
the import can fix, each checked on the designs it touches:

1. **Closed round edges named by a negative token.** In 11 edge recipes (7
   designs) the first face's token is negative (`-1@301`, `-143@304`): no face
   of the body has it. In all 11 exactly one face follows the second, and the
   edge runs between the second face and that one — a circle where a cylinder
   meets its cap or a plane (FORMAT.md). `edgeFaces` reads them so; all 11 are
   now named, each with a circle shape.
2. **Holes placed by distances or on a body face.** A hole placed by its
   distances to two edges stores no centre point; its centres are now where
   the axes of the cylinders it made (its own B-rep faces of radius
   `HoleDiameter`/2, not a pattern's copies) meet the start face
   (`centresFromCylinders`). A hole whose start face is a body face (a face
   recipe, not a model plane) takes the point and normal its placement record
   holds, when the recipe's B-rep face is that plane. 5 holes in 4 designs.
3. **An extrude head after a typed reference.** 8 extrudes in 3 files failed to
   decode ("operation block not found"): their leading reference carries its
   target's type GUID, which moves the operation block to payload offset 57.
4. **A profile region not found.** A region whose curves were deleted, trimmed
   or doubled after the pick, and that neither its pieces nor its curves nor the
   stale-region fallback find, no longer skips the whole extrude: it is left out
   with a note when the operand's other regions are found. 3 extrudes.
5. **A round none of whose edges passed.** A fillet or chamfer whose every edge
   the weak-edge rule (the edges amendment above) left out gets a second try that
   also takes an edge named by both its faces where one name is a guessed round
   face's and no line or circle backs it, by that name alone (no fingerprint), and
   `skipLostEdges` drops the ones not found. 26 rounds in 10 designs: 4 build,
   the rest now fail ("Can't find an edge to fillet any more") instead of being
   skipped, because the guessed face is not there (the earlier round failed, or
   the token guess picks the wrong edge: in one design all 8 edges named one
   chamfer face). Such a round is in the timeline with its sizes, for Fix
   References, where it used to be missing; the body is the same either way.

Left skipped, with the reason found: offset faces on a thread's crest (the file
resizes the cylinder; Extrudo models the thread, so the face is gone), lofts
whose sections have holes (ADR-0055 refuses them), a torus primitive (Extrudo
has one; the record's placement and operation are not decoded yet), sweep faces
(not named yet), faces of a second, off-timeline record of a feature (a copied
component's), base features, a mesh conversion, and moves and copies of bodies.

Replay-only corpus (with the solver): skipped features 143 → 84 (fillets 42 →
11, chamfers 21 → 12, extrudes 18 → 5, holes 5 → 0, circular patterns 4 → 3);
of the 59 brought in, 30 build (with warnings for 7) and 29 fail. Designs within
0.5 % volume and 0.05 mm box 147 → 152, none leaves it; a cover pin, a cap
cover, a hammer cover, a holder end and a wrench holder (29.8 % → 0.15 %) reach
it. Of the 23 designs, the first departure moves later in 7 (3 have none left)
and the skipped feature is in the timeline in 5 more. Volume error moves away
from the reference in five designs that did not match before, by the features
now built: a hinge part with a skipped body move (2.9 % → 3.7 %), two chair
stabilisers whose new hole is on the file's own surfaces (16.44 % → 16.47 %,
1.10 % → 1.16 %), a drawer insert broken before and after (88 % → 99 %) and an
adapter (12.16 % → 12.17 %).
Body check (ADR-0084, all 250): the replay matches 147 → 152 designs and the
result after the check stays 225, none harmed; bodies editable 195 → 202,
frozen 159 → 152 (made differently 114 → 109, made nothing 45 → 43), unchecked
26 → 26. Bodies that turn editable: a cover pin, a cap cover, a hammer cover, a
holder end, a wrench holder, an earbuds case's second body and one of a hinge
part's four.
Tests: `edges.test.ts`, `hole.test.ts`, `extrude.test.ts`, and `map.test.ts`
"rounds an edge by its two faces' names…" and "leaves out a profile region it
cannot match…".

## Amendment, 2026-10-14: a torus primitive, sweep faces, a feature's records in other components

Three of the causes the skipped-features amendment above left open, each
measured on the corpus before it was built.

1. **Torus primitive** (`decode/torus.ts`, `map-more.ts` `torus`). Its record
   holds the result operation, the two diameters as parameters it owns
   (`MajorDiameter`, `MinorDiameter`) and a 4 × 4 matrix in the frame of the
   plane it was made on (the plane a geometry operand holds in model space):
   the centre is the matrix's origin and the axis its Z, both taken from that
   frame into the model (FORMAT.md). The corpus's torus, made on the YZ
   plane with its centre along that plane's y, has its B-rep torus along
   model Z about +X, where the matrix read in model axes would put it along
   model Y. The
   reader refuses the record when the B-rep keeps a torus the feature made
   on another centre or axis. It maps to Extrudo's torus on the origin plane
   square to its axis (place in the plane's frame, `offset` along its normal);
   an axis along no origin axis is left out with that reason (none seen). Its
   face is named `torus:<id>:side:surface` for later features.
2. **Sweep faces** (`sweep-faces.ts`). The file numbers a sweep's sides piece
   by piece of the path and merges a side the profile sweeps in the path's
   plane into one face with a tag per piece; the tokens are not read. A face
   is told by geometry instead: along a flat path a profile point keeps its
   offset across the path and its height off the path's plane, so with the
   profile carried to each piece's start a profile line sweeps a plane along a
   line and an arc a cylinder, and round an arc of the path the faces are a
   revolve's about its axis (planes square to it, cylinders, cones, tori);
   along a spline only a plane at one height is known. The caps are the
   planes across the path's ends, `cap:start` at the end nearer the profile
   (in one design the profile sits 0.023 mm along the path from its end).
   Paths that don't chain, aren't flat or don't cross the profile's plane
   square to it name no sweep face (as before). 24 round edges in 3 designs
   named sweep faces: all along lines and arcs are now named, the 4 round a
   spline are not.
3. **A feature's records in other components** (`decode/feature-records.ts`).
   A feature acting on bodies of more than one component keeps a record per
   component; only the first is on the timeline, and one record per design
   (`12D00AC0…`) lists every feature's records under a GUID. The further
   records have their own operations (which tag the faces they made in the
   other component's bodies), name that component's body, and share the
   first's sketch profile and parameter values; they are numbered in their own
   component's count, so their name says nothing (a further record of the
   timeline's `Extrude5` is named `Extrude3`, beside an unrelated `Extrude3` on
   the timeline). Faces are now named through that list only: an operation
   whose records are all off the timeline maps to the timeline feature one of
   them is a further record of, never to a feature that shares its name. A
   join, cut or intersection that names its bodies also takes those its
   further records name (one that names none still acts on every body it
   meets). 4 designs: in three the timeline's cut now also cuts the other
   component's body, as the file's does.

Replay-only corpus (with the solver), against the skipped-features amendment:
skipped features 84 → 75 (the torus, 3 chamfers on sweeps, 4 fillets and a
chamfer on a further record's faces); of the 9, 8 build and 1 fails (a chamfer
along a line–spline–line chain that the kernel can't build with both line
edges given; the body is the same as when it was skipped). Designs within
0.5 % volume and 0.05 mm box 152 → 153 (a garden part, 5.74 % → 0.0006 %),
none leaves it; two rails and two power-supply modules lose their last
skipped feature and match without it. Volume error falls in two modules
(46.09 % → 1.29 %, 4.41 % → 1.26 %), and in the design holding both modules'
bodies it moves from +0.43 % to −0.49 %, still within: its second body now
gets the cut (its volume is then the one module's replay's, 1.26 % over that
module's reference) and no longer makes up for the first body's shortfall.
Body check (ADR-0084, all 250): the replay matches 152 → 153 designs and the
result after the check stays 225, none harmed (the garden part no longer
needs the check: rescued 73 → 72); bodies editable 202 → 203 (the second body
of the design holding both modules), frozen 152 → 151, unchecked 26 → 26.
Tests: `decode/torus.test.ts`, `sweep-faces.test.ts`,
`decode/feature-records.test.ts`, and `map-more.test.ts` "makes a torus on the
origin plane…" and "names a sweep's cap and side…".

## Amendment, 2026-10-15: hostile files, round 2

A second security review of the importer (the parser, the mapping and the
B-rep writer) found no injection, but several ways a small crafted `.f3d`
made the import take minutes, exhaust memory or loop forever. The import runs
on the UI thread, so each froze or crashed the tab. Each is now bounded; the
limits sit well above what the 250-file corpus needs (FORMAT.md has the
measured figures).

- **Arc angles** (`regions.ts` `angleOf`): an arc's angle was brought round
  one turn at a time, which took seconds at 1e10 and never ended past 1e17. It
  is a modulo now. Circles and arcs, points, lines, spline knots, poles and
  weights are refused at decode when a number isn't finite, a radius isn't
  positive or a weight isn't positive (`finite` in `bytes.ts`).
- **The B-rep stream's memory** (`asm.ts` `readAsm`): one object per one-byte
  value made a 16 MB stream cost 0.8 GB of heap (50 times its size), and a
  64 KB archive could ask for about 4 GB. One-byte values and small integers
  now share their objects, class names are kept once, a record needs a class
  name, and a stream may hold at most one value per 4 bytes, one record per
  16 bytes and 16 million values. Measured with `--expose-gc`: the corpus's
  eight largest streams cost 6.0 to 6.5 times their size (6.6 to 7.3 before);
  the dearest stream within the caps (two-character strings) 18 times; a
  16 MB flood of one-byte values is refused in 0.13 s.
- **The operation-table search** (`model.ts` `readOperationTable`) tries
  every offset of its record; a crafted 256 kB record took 21 s. The entry
  reads are budgeted at one million per segment, shared by its tables (the
  corpus needs at most 1,280); past it the table is left out with a problem.
  Record ids repeated in the type table or the timeline are read once, each
  feature's scope is read once (`scopeOf`), and the faces a feature made are
  indexed once (`madeBy`), so repeating an id costs nothing.
- **Shared B-rep records**: a surface, curve or edge record many faces or
  coedges name is read once per stream (`asm-body.ts`), and so is a B-spline
  block several records name by `{ ref n }` (`asm-spline.ts`); the STEP writer
  writes a B-spline surface or curve once however many faces or edges use it
  (analytic surfaces and curves are still written per use: they are a few
  entities, and sharing them would have changed the text of 140 corpus bodies
  for nothing). A body's STEP text is capped at `MAX_STEP_BYTES` = 64 MB (the
  corpus's largest is 4 MB, 85,000 entities); past it the body is refused
  with a reason and stays unchecked like other refused bodies. The tag walk
  (`asmFaceTags`) follows each attribute of a chain once, keeps each
  attribute's and each chain's tags once per stream, and refuses a stream
  whose faces would copy more than a million tags plus four per value; the
  face-edge walk (`asmFaces`) refuses one whose faces would take more than a
  million steps plus four per record (each face walks its own loops in the
  files).
- **Inflating** (`archive.ts`): fflate's one-shot inflate decoded a whole
  stream past its output buffer (about 7 s per compressed MB of overflow) and
  accepted the truncated result; the Zstandard path returned its buffer
  unchecked, zero-padded; and the declared size (up to 256 MB) was allocated
  from a few bytes of input. Entries now inflate streaming (`Inflate`, 4 kB
  of input at a time; fzstd's `Decompress`), stop as soon as the output passes
  the declared size and must fill it exactly; a declared size more than
  `MAX_RATIO` = 200 times the compressed size (plus 4 kB) is refused before
  anything is allocated (the corpus's entries stay under 16); a Zstandard
  entry must be one frame, with no dictionary, a window of at most
  `MAX_ZSTD_WINDOW` = 32 MB and, when the frame says, the declared content
  size, checked by walking its block headers before decoding. The existing
  entry-count, per-entry and total caps stay.
- **Expression nesting** (`packages/core/src/expr/parser.ts`): no depth cap,
  so `((((…))))` 100,000 deep overflowed the stack with a `RangeError` that
  `parseSafely` rethrew. The parser now refuses an expression nested more than
  `MAX_DEPTH` = 256 levels (brackets, operators and calls, including a long
  `1 + 1 + …` chain, which nests the tree without nesting the parser) with an
  `ExprError`. This is core's, so `.extrudo` files and typing benefit too.
- **Finite numbers**: model planes and points (`decode/hole.ts`), a sketch's
  placement matrix and parameter values (not text parameters) are refused when
  a number isn't finite, and an axis line that isn't finite is no axis
  (`readAxis`), so the feature is left out with a note instead of handing NaN
  to the kernel.
- **One bad record**: the `frame()` calls outside `tryDecode` (parameter
  owners, body links, a sketch's placement, a hole's and a circular pattern's
  operands, a revolve's axis) go through it now, so a record that can't be
  framed leaves out what names it instead of aborting the import.

The corpus gate (250 files): the replay's every verdict, skipped feature
(75), failed feature, note and problem is unchanged, and its time summed over
the designs went 1,146 s → 1,037 s; the body check is the same design by
design (before 156 / after 225 within 0.5 %, 69 rescued, none harmed; bodies
editable 211, frozen 143, unchecked 26; 354 written). Five bodies' STEP text
got shorter (a shared B-spline written once) and measure the same.

Still open, each a separate piece of work: decoding in a worker (the import
still runs on the UI thread, so a slow legitimate file still blocks it), the
all-pairs matching of profile-region curves (`regions.ts`), and retry budgets
for the kernel's fillet diagnosis.

## Amendment, 2026-10-16: import in a worker

The import no longer runs on the UI thread. `importF3dFile`
(`apps/web/src/project/actions.ts`) reads the file's bytes and hands them to
an `ImportRunner`; the app's runner (`f3dImport.ts`, `workerImportRunner`)
starts a module worker (`f3dWorker.ts`, named `extrudo-f3d`) for each import,
transfers the `ArrayBuffer` with the name and the document's ID and app
version, and the worker loads `@extrudo/f3d` and the sketch solver
(`@extrudo/sketch/browser`) itself, runs `importF3d` with `{ bodies: true }`
and answers once, `{ result }` or `{ error }` (the thrown error's message),
after which the client terminates it. The `Design` is a class, so it crosses
as its document (`design.toJSON()`) and the client rebuilds it with
`Design.from`; the report, preview, body links and STEP steps are plain data
and `Uint8Array` and cross as they are. `importF3d` itself stays synchronous
and exported (Node tools and tests call it). While the worker runs the busy
toast says "Reading the .f3d file…" (`READING_TEXT`); the body check's toast
(`CHECKING_TEXT`) follows it. Errors go the same way as before: the caller's
"Import failed: …" toast.

- **Time budget**: `F3D_IMPORT_TIMEOUT_MS` = 30 s, after which the worker is
  terminated and the import fails with "The import took too long and was
  stopped." On the 250-file corpus `importF3d` alone (unzip, decode, map and
  the B-rep writer, with the solver; timed in Node on the Ubuntu dev machine)
  took at most 5.2 s, 95th percentile 0.8 s, median 49 ms: the budget is about
  six times the slowest. (The replay's `ms` column in the hardening run counts
  the kernel recompute too, so it was not used.)
- **Out of memory, measured** (Chrome stable under Playwright on the Ubuntu dev
  machine, a crossOriginIsolated page with COOP/COEP as the app has, module
  workers): a worker that runs out of **ArrayBuffer** memory gets a
  `RangeError: Array buffer allocation failed` (about 10 s in); uncaught it
  is the worker's `error` event, caught it is an ordinary exception, and the
  page stays alive either way. A string over the length limit is a
  `RangeError` the same way. A worker that runs out of **JavaScript heap**
  (many small objects) gets **no** error event: it kept allocating, the page's
  main thread stopped answering after about 60 s, and the renderer crashed
  ("Target crashed") at about 165 s, taking the tab with it. Terminating that
  worker at 30 s left the page answering. So the worker turns the first kind
  into a message (an allocation `RangeError` reads "This .f3d file needs more
  memory than the browser gives the importer."; an `error` event reads "The
  importer stopped unexpectedly…"), and the time budget is what stops the
  second, provided the heap fills more slowly than 30 s; one that fills
  faster can still crash the tab. `MAX_F3D_BYTES` (100 MB, M1) and the
  archive's caps keep the import's inputs small enough that no corpus file
  comes near either.

Still open: the all-pairs matching of profile-region curves (`regions.ts`)
and retry budgets for the kernel's fillet diagnosis. The Deferred item
"decoding in a worker" is done.

## Amendment, 2026-10-16: target bodies and extrude extents

**Join and cut targets among several bodies of one feature.** A join or cut
names the bodies it acts on, and the import passed them on only when every one
was the only body of its feature: one body of a feature that made several
(`Body<n>` of an extrude of separate regions) dropped the list, and the feature
then acted on every body it met (in one design a join pulled a large unrelated
body in, +594 %). The rule that pairs them: the file numbers a feature's bodies
in the order of its profile's region groups (`group`, from 0); Extrudo numbers
the separate solids of an extrude by the centre of each one's box, x, then y,
then z (`newBodies`). So body i (by index) of a new-body extrude is Extrudo's
`<feature>:k`, k being the rank of group i's centre, worked out from the
group's outline in model space (`bodyOrder` in `map.ts`; every side of the
extrude runs equally far, so the outlines' boxes order the solids as their
boxes do). Evidence: of the 28 features in the corpus that make several bodies
with a shown one, 26 are such extrudes; on the 22 bodies of 10 of them (5
designs) that no later feature changed, each file body's box (its B-rep
through the writer) is that of the replayed solid the rule names, 22 of 22,
including a 5-body extrude whose bodies the file numbers out of order in x, y
and z alike. Two centres are a tie on an axis when they are at most 1e-6 mm
apart (the kernel's own `ORDER_TOLERANCE`), and the next axis decides; on the
deciding axis, a gap above that but under 0.01 mm (`ORDER_SLACK`: the kernel's
box of a curved outline is not exact) leaves the order unknown, and so does a
tie between outlines that run along a spline or an ellipse (their kernel boxes
are loose, so the kernel may break the tie either way). The order is checked
on neighbours after sorting. Where the order can't be told the list is dropped
as before (the feature then acts on what it meets, with a note): another kind
of feature (a pattern, a text extrude: 2), more than one profile operand, a
region whose outline is not found or left out, a group with no outline, a
taper (a tapered outline's box does not move with its centre), an extent up to
a named face, the order unknown as above, or a file that lists another number
of bodies for the extrude than its groups (some joined away or deleted: even
the one left can't be told).

Extrudo's join of several bodies keeps the pieces its tool doesn't bridge
apart, the largest under the first body's ID and the others under the join's
own (`splitSolids`), so after such a join the import can't tell which ID is
which file body: a later feature naming one of them is left to Extrudo's
default, none of them is hidden even where the file hides it, it stays in
the component of the feature that made it (a "Body to Component" that moves
one notes that), and its body link carries no hint. The bodies
of such a join are named in the order Extrudo's default would join them (the
earliest made first): naming them in the file's order changed which faces kept
their names in three designs, and a chamfer after the join lost edges. Tried
and dropped: leaving every join of several bodies to Extrudo's default (three
bodies, two of them in designs that had matched, came out made differently).

**Extrude extents from a start face.** Measured on the corpus (FORMAT.md
"Start from a face"):

- `ProfileOffset` from a start face runs along the face's normal. Before, it
  ran along the sketch normal, which is the other way for 12 extrudes (a face
  looking against the sketch); none of their designs matched.
- A start on an origin or construction plane is read from the geometry
  operand that holds it (6 extrudes in 4 designs had no start at all), only
  where the extrude names no face and goes up to none (an up-to face would
  take the operand's place), and not when the plane's axes span no plane. A
  plane has no outside and its stored axes may face either way, so its
  `ProfileOffset` runs along the sketch's normal; the corpus can't tell (all
  6 plane starts have no offset).
- A cut from a plane face slanted to its sketch (one in the corpus) starts on
  a copy of the sketch moved past the face (to where the whole profile lies on
  the face's outer side) and runs up to the face's plane moved by its
  distance, which is where the file's cut ends. The wedge between the copy and
  the face is outside the body as long as nothing of it stands over the face
  there; a join, a curved face or a slanted start plane keeps the note it
  had. Its stop plane is made only with the extrude.
- An up-to-face offset of a one-sided extrude that starts from a face counts
  the other way (positive ends short of the face). Two-sided extrudes keep the
  file's sign: none in the corpus starts from a face, so nothing measured it.
- Up to a face parallel to the start stays a distance. The corpus has 76 such
  extrudes in 37 designs, 74 with a face the import can name; with the named
  face (`to-object`) instead, no design changed its verdict, three moved
  further from the reference (one from 1.05 % to 3.5 % volume error), and 20
  extrudes warned that their face had been split.

**Numbers** (replay corpus, within 0.5 % volume and 0.05 mm box, before →
after): match 153 → 157 (a door vent, a connector, a hinge, a spool roller),
mismatch 55 → 51, partial 27 → 27, no design worse; features left out 75 →
75. Box errors of 4 to 70 mm went to 0 in three more designs that still
mismatch for other reasons (their profile regions; one's volume error moves
from 34 % to 54 % now that the part sits where the file has it), and in a case
whose join had pulled in an unrelated body the volume error fell from 345 % to
3.9 %. Body check:
editable 211 → 225, frozen 143 → 129, unchecked 26 → 26 (same reasons); no
body went from editable to anything else. A name tag's two bodies, one merged
body before, now come out apart but stay frozen (about 1 % off each: their
text cuts are drawn in a substitute font). Tests: `map.test.ts`
"the bodies of an extrude that makes several" and "extrude extents from a
start face"; `extrude-start.test.ts` (the start plane).

## Amendment, 2026-10-20: parameter value v9, records that could not be read (#93)

A file written with parameter value class version 9 (version 7 plus a u32 after the first
byte and six flag bytes) lost every parameter: the decoder only knew 5–7, the failures went
into `F3dDesign.problems`, which nothing read, and an extrude without its `AlongDistance`
was imported as "through everything" (a first feature then failed with "no bodies to go
through"). Now `parameterValue` reads v9 (`FORMAT.md`; version 8 was never seen and stays
unsupported). The decoder's problems also reach `ImportReport.problems` (verbatim, for bug
reports and `corpus.test.ts`) and `importNotices` says in one plain line how many records
could not be read. `F3dDesign.unreadParameters` counts the parameter records that failed;
when it is above zero, each through-all fallback for a missing distance adds a note saying it
is a guess. Tests: `decode/parameters.test.ts`; `map.test.ts` "says when a missing distance
is a guess"; `actions.test.ts` "says how many records could not be read".

## Amendment, 2026-10-21: text in fonts that fit the file's

Text was drawn in Inter with Arial's capital height, centred in the file's box:
its width and letters differed from the file's, so a text cut did (text was the
first cause of 11 designs and 11 frozen bodies in the corpus). Now a family with
a bundled stand-in of (about) its widths is drawn in it (`fontFor`, `STAND_INS`
in `map.ts`; the fonts in ADR-0058's amendment of the same day):

| File family | Texts (newer / older) | Stand-in | Width ratio, median (range) | Missing characters |
|---|---|---|---|---|
| Arial | 11 / 21 | Arimo Regular, Bold | 0.995 (0.983–1.024) regular; 0.997 (0.994–1.006) bold | none |
| Arial Narrow | 7 / 0 | Archivo Narrow Regular, Bold | 1.000 (0.995–1.003) regular; 1.002 (0.997–1.007) bold | none |
| DIN Condensed | 5 / 0 | Sofia Sans Extra Condensed Bold | 1.023 (1.005–1.046) | none (Inter lacked the Cyrillic) |
| DIN Alternate, Lucida Grande, Noteworthy | 0 / 2, 1 / 0, 1 / 0 | none (Inter, as before) | | |

The ratio is the file's box width over the stand-in's ink width at the file's
font size (a newer text's box is the width of its letters' ink, measured: the
advance width is about 5 % wider). Inter, drawn as before, came to 0.98
(0.95–1.12) for Arial, about 0.81 for Arial Narrow and 0.69 for DIN
Condensed. Other candidates measured and not taken: Liberation Sans Narrow
(1.004, not OFL), Roboto Condensed (0.98, 0.93–1.04), Barlow Condensed (no
Cyrillic, 0.92–1.21), Barlow Semi Condensed (over 1.2), Fira Sans, IBM Plex
Sans and PT Sans condensed faces, Oswald, Noto Sans, Open Sans and Roboto
width instances. An older text's box is sized by hand (ratios 0.7 to 1.8), so
those texts were not scored; DIN Alternate has only older texts and keeps
Inter.

- **Bold.** A newer text record's byte after the baseline angle is 1 for bold
  (only 0 and 1 in the corpus; bold-flagged texts fit the bold stand-ins within
  0.7 %, and miss the regular ones by up to 7 %); an older record's weight is
  500 or 750, and 750 is bold (a text cut drawn in Arimo Bold is within 1 % of
  the file's B-rep in volume, in Arimo Regular 31 % short). `SketchText.bold`.
- **Size.** A stand-in is drawn at the file's font size: Extrudo's height (the
  capitals') is the size times the stand-in's own capital height over its em
  (`TextFont.cap`). Arimo's capitals are 4 % lower than the file's (0.688 em
  against Arial's 0.716; on a text cut's B-rep the file's letters were 4.1 %
  taller and as wide), so drawing at the file's size keeps the widths and gives
  up 4 % of the height; matching the capitals would make every letter 4 %
  wider. An older text's height is Arial's capitals, so its size is that / 0.716.
- **Place.** A newer text stays centred in the file's box: starting it at the
  box's corner put the ink about 0.4 mm right of the box's ends, centring
  within about 0.1 mm for most texts.
- A family without a stand-in is drawn as before (Inter, or the serif, mono or
  stencil face; capitals 0.716 of the size). The report's note says "drawn in
  Arimo (same widths)" or "(about the same widths)".

**Numbers** (corpus, within 0.5 % volume and 0.05 mm box, before → after):
match 157 → 160 (a plate with a house number, two name tags), mismatch 51 →
48, partial 27 → 27, no design worse; features left out 75 → 75. Body check:
editable 225 → 229, frozen 129 → 125, unchecked 26 → 26 (same reasons); no
body went from editable to anything else.

**Not moved.** Four fraction models (two-line older texts, bold): Arimo Bold's
underscore is 0.038 em thick, the file's about 0.086 em, so the fraction bar
cuts 18.5 mm³ where the file cuts 43; and the second line sits about half a
capital height too low (a single-line text in the same alignment sits within
0.06 mm, so the rule for several lines is still unknown); 1.1 to 2.8 % off.
A hinge part's text cut is refused ("removes nothing") for its extrude's
direction, not its font. Two keychains are off by their offset faces (glyph
faces not named), a cover by its pattern of copied faces; its DIN text is
about 2 % narrower in Sofia Sans, which moved its volume error from 2.5 % to
2.9 %. Tests: `map.test.ts` "picks the stand-in with the same widths for the
families files use most", the two text placement tests, `decode/text.test.ts`,
`packages/fonts/src/index.test.ts`, and the CLI's "reads a bundled stand-in
font from the package".

## Amendment, 2026-10-22: 32-bit B-rep streams, Combine, Move, a deleted sketch (#93)

The second file of #93 (a bumper: an oval base with fillets, two lobes, a
column) imported with its base thinner than in the file. Four causes:

- **32-bit B-rep streams.** Files saved since October 2026 write their
  streams as `ASM BinaryFile4`: ints, enums and pointers are 4 bytes, the
  header's counts two u32 (FORMAT.md, "ASM B-rep"). `readAsm` took only
  BinaryFile8, so no face or edge of such a file could be named (14 fillets
  and 6 offsets of the bumper left out) and the body check had no file body.
  It now reads both with one width variable; the hostile-file bounds are
  unchanged (the 4-byte form only needs fewer bytes per value). The long
  string lengths (`0x09`, `0x12`) occur in none of the four streams seen, so
  they stay 8 bytes, unverified. On the bumper 11 of the 14 fillets and 2 of
  the 6 offsets are now imported (8 → 21 features).
- **Combine** (`2A94257F…`) maps to `combine`: the target and the tools come
  from the record's own lists (FORMAT.md). Both combines seen are joins that
  consumed their tools, and the bytes that would hold a cut, an intersect or
  "keep tools" are not located: a combine is imported as a join only where
  those bytes are zero, and is otherwise left out with "its operation could
  not be read". A tool it consumed is not reported as "hidden, as in the
  file". Before, the bumper's pad (a separate body the combine joins into
  the base) stayed hidden, so the base's bottom was 2.5 mm short.
- **Move** (`64E40C8E…`) maps to `moveBodies` in free mode when its matrix
  (`84E6245F…`, row-major, cm) only translates; a move that turns is left out
  ("it turns the bodies"): Extrudo's free mode turns about the bodies' box
  centre and its rotate mode needs an axis the import does not make. The
  matrix reading was checked on the corpus's two such moves: both designs'
  boxes now equal their exports' (20 mm and 70 mm off before).
- **An extrude whose sketch was deleted.** A profile operand can name a
  sketch record the file no longer holds. That was a decoding problem and the
  skip said "its profile is a face"; now the profile reader tells it apart
  (`SketchGoneError`), no problem is recorded, and the extrude is skipped with
  "the sketch its profile came from is no longer in the file".

Face deletions (`DeleteFace`, 28 in the bumper) stay unsupported.

**Numbers** (replay corpus, before → after): match 157 → 158 (the corpus's
move of a frame part, box 70 mm → 0), mismatch 51 → 52, partial 27 → 25,
features left out 75 → 73. The one design that went from partial to
mismatch has nothing left out now; its volume error is the same (3.7 %, a text
cut in a substitute font) and its box error went from 20 mm to 0. The
corpus's other combine and a move that turns stay left out, with the new
reasons. Body check: editable 225 → 226 (the moved frame part, frozen
before), frozen 129 → 128, unchecked 26 → 26 (same reasons); no body worse.
The bumper: 23 features imported, 39 left out
(28 face deletions, 3 extrudes of the deleted sketch, 3 fillets and 4 offsets
whose faces can't be named, a suppressed removal), no decoding problem; its
body is frozen from the file (the timeline makes it differently without the
face deletions), and the replay's base under the column runs from −5.5 to
2 mm as the file's does. The issue's first file (one sketch, one extrude) now
has its stream read and its body matched (editable). Tests: `asm.test.ts`
"readAsm, BinaryFile4"; `brep-body.test.ts` "reads the 32-bit stream
variant"; `decode/combine.test.ts`; `decode/extrude.test.ts`
"readProfileOperand"; `map-more.test.ts` "features on whole bodies".
