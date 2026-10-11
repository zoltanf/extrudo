# ADR-0083: Reading `.f3d` files

- **Status:** Accepted, 2026-10-10 (the owner: read `.f3d` directly, with our
  own TypeScript decoder; the app's import first, then coverage). It reverses
  the earlier "don't parse `.f3d`" recommendation and amends Open decision 5
  in `docs/03-roadmap.md`.
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
4. **In the app**, Home › Files has **Import .f3d…** (and the home screen a
   button; Import .extrudo accepts `.f3d` too). Each import makes a new design
   with the file's preview as its thumbnail; when it opens, a notice says how
   many timeline features came across and lists the rest. The package is its
   own lazy chunk.
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
