# ADR-0082: Reading Fusion `.f3d` files

- **Status:** Accepted, 2026-10-10 (the owner: read `.f3d` directly, with our
  own TypeScript decoder; the app's import first, then coverage). It replaces
  the "don't parse `.f3d`" recommendation in `docs/research/fusion-import.md`
  and amends Open decision 5 in `docs/03-roadmap.md`.
- **Builds on:** ADR-0066 (import), ADR-0068 (the public document API, which
  the import writes through), ADR-0005 (topological naming), ADR-0081
  (components, not yet there to import into).

## Context

People who leave Fusion bring `.f3d` files. STEP export gives exact solids
without history. The research of 2026-10-09 judged the history readable only
by decoding Autodesk's private object serialisation and recommended an add-in
instead. The owner asked for the direct route: a test on 250 of their own
designs (saved 2018 to 2026, each with a reference STEP) showed it is
practical.

## Decision

1. **A new package, `@extrudo/f3d`** (GPL-3.0-or-later, pure TypeScript, no
   WASM). It depends on `@extrudo/api`, `@extrudo/core`, `@extrudo/sketch`,
   `fflate` and `fzstd` (Zstandard entries since 2025); `@extrudo/kernel` is a
   test-only dependency. Two layers:
   - `readF3d(bytes)` decodes the archive into plain data: user and model
     parameters, the timeline, sketches (plane, points, lines, circles, arcs),
     extrudes (operation, direction, distances, tapers, selected profile
     regions), fillets and chamfers (their edges as tagged B-rep faces) and
     every other feature by kind and name.
   - `f3dToDesign(f3d, name)` writes that through `@extrudo/api` into a new
     design and returns a report: what was imported, what was skipped and why.
   `importF3d(bytes, name)` does both; `f3dPreview(bytes)` returns the stored
   preview PNG.
2. **The format is written down in `packages/f3d/FORMAT.md`**, from our own
   reading of the files. Some layouts were first described by cadmpeg's
   specification (CC-BY-4.0), credited there. No Autodesk code, text or icons
   are used; the UI names the file type only.
3. **Mapping rules.**
   - User parameters keep their expressions; an input whose expression names
     only user parameters keeps it, any other takes its value (Fusion's
     dimension parameters `d12` have no Extrudo counterpart yet).
   - A sketch on an origin plane, or on a plane parallel to one (through an
     offset plane), keeps its curves; Fusion's XZ frame is Extrudo's turned
     180° about X. Other sketch planes are skipped.
   - An extrude's selected regions are rebuilt from the region's own curves,
     and every Extrudo region inside that outline is taken: Fusion records a
     region as the curves along its boundary when it was picked, overlapping
     collinear ones included.
   - A fillet's or chamfer's edges are named through the topological-naming
     scheme (`extrude:<id>:cap:start`, `extrude:<id>:side:<curve>`) from the
     features that made their two faces, and carry a fingerprint of the
     edge's line or circle for where a join merged faces.
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

## Consequences

- On the owner's 250 files every file decodes and maps to a valid design.
  Rebuilt with our kernel and compared with the reference STEP: 13 match,
  120 lose some features, 34 build different geometry and 83 have no body
  (their first extrude did not map). The common gaps, by count: profiles that
  are body faces, extrudes that start from a face or offset, fillet edges on
  faces from features other than extrudes, components, holes, offset faces,
  patterns, revolves, sketches on other planes, and sketch dimensions and
  constraints.
- The format changes between Fusion versions (record versions, reference
  widths). Each decoder checks its record's version and reports what it does
  not know instead of guessing; the report reaches the user.
- Legal: Autodesk's terms (§13) forbid studying data structures except where
  the law allows it. The research's §2 lists the EU and US positions on
  reading one's own files for interoperability; the owner's legal check
  covers this route as well as the add-in.

## Rejected

- **cadmpeg compiled to WebAssembly** (Rust, Apache-2.0): it decoded 63 of the
  250 files (140 hit its work budget, about 47 older files fail), and its
  codec is about 400k lines.
- **The Fusion add-in route** (research route C): needs Fusion, which a person
  leaving it may no longer have, and waits on the API-terms question.
- **Geometry only from the B-rep** (ASM SAB): no history, and a STEP export
  already gives that.
