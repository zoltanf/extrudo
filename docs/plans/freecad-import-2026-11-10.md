# FreeCAD file import: what is possible (investigation, 2026-11-10)

**Question (the owner):** can Extrudo open FreeCAD files (`.FCStd`) natively and
keep as much as possible (history, sketches, parameters), for 3D-printing work?

**Short answer:** yes, and it is a much easier target than the f3d importer was.
The format is open and plain (a zip with XML), FreeCAD's kernel is the same one
Extrudo uses (OCCT) and so is the sketch solver (planegcs), and the file stores
the solid after **every** feature, which gives an exact check and an exact
fallback at each step. On a 60-file test library the estimate is full history
for about half the files and history plus exact shapes for most of the rest.
The numbers below marked *measured* come from scripts run on the library; those
marked *estimate* come from classifying the files' features and still need a
prototype run.

**Update, same day:** a prototype has since run the whole library; section 9
has the measured numbers, which replace the estimates of 3.6.

Status: the owner decided on 2026-11-11 to build it (ADR-0144, roadmap P6-25). The
open decisions of section 7 are answered there; section 3.2's hidden-solids fix
for the STEP import landed on 2026-11-10 (ADR-0066's amendment).

## 1. What was done

| Step | Result |
|---|---|
| Test library | 60 `.FCStd` files saved by FreeCAD 0.14 to 1.2 (FreeCAD's own examples and test files, 35 parts of the FreeCAD parts library, two user files): 2,547 objects, 221 sketches, 3,114 sketch constraints, 1,784 stored shapes (97 MB) |
| Census | A script over every `Document.xml`: object types, properties, sketch geometry, constraint kinds, attachment modes, references, expressions |
| Ground truth | Every file opened headless in FreeCAD 1.1.4, each object's stored volume, box and face/edge counts recorded; then a full recompute and the same again |
| Format study | Two study passes over FreeCAD's source (commit `d1707972`, read as a description of the format only) against the library: (A) document, sketches, parameters; (B) features, references, stored shapes. Both cross-checked against cadmpeg's independent FCStd specification |
| Baseline | Today's path (desktop only): cadmpeg 0.6.8 converts the file to STEP |

## 2. The file, in brief

- A zip. `Document.xml` holds every object with its typed properties (plain
  XML, numbers always in mm and degrees whatever the document's unit system;
  sketch angles in radians), the links between objects and the expressions.
  `GuiDocument.xml` holds visibility and colours.
- Each object that has a shape stores it as an OCCT BRep text entry
  (`*.brp`). For a PartDesign feature that shape is **the whole body after
  that feature**. All 1,784 non-empty entries in the library are the same text
  format (*measured*); FreeCAD can also write a binary form (a user setting,
  none in the library).
- A sketch stores its solved geometry (lines, circles, arcs, points, conics,
  B-splines), its constraints by number (coincident, horizontal, distance …)
  and its solved placement. A feature stores its inputs and enum choices as
  numbers, and its references as an object name plus `Face6` / `Edge12`.
- `EdgeN` / `FaceN` is simply the N-th edge/face of the referenced object's
  **stored** shape, in OCCT's standard order (*measured*: 23,475 sub-elements
  in 5 files checked in FreeCAD, 0 mismatches; and a reader's counts equal
  FreeCAD's for all 1,627 shapes). So a reference can be resolved from the file
  alone: read the stored shape, take the N-th edge, match it by geometry on
  the body Extrudo rebuilt.
- FreeCAD 1.0's own topological names (element maps) are in newer files but
  no library feature depends on them; index plus geometry is enough.
- All 60 files use document schema 4. Older schemas (2, 3) exist in theory;
  none was found, also not in cadmpeg's 53 fixtures.

## 3. Measurements

### 3.1 FreeCAD's own replay is not reliable for old files (*measured*)

After a full recompute in FreeCAD 1.1.4, **22 of 60 files** have objects that
fail (15 files) or solids whose volume changed (11 files; 4 have both), mostly
files saved by 0.14 to 0.16. The stored shapes are what the author saw. An importer should
therefore check every rebuilt body against the file's stored shape and bring
the stored shape in where they differ, as the f3d importer does (ADR-0084).

### 3.2 Today's baseline (*measured*)

The desktop app converts `.FCStd` through cadmpeg; the browser refuses the
format. cadmpeg 0.6.8 converted 58 of 60 files (2 fail its own check), but it
writes **every stored shape**: FreeCAD's PartDesign example (one body, four
features) becomes 9 solids, intermediate states and tool shapes included;
2,684 solids over the library, of which 1,114 match a FreeCAD object by
volume. Mesh-only and sketch-only files give an empty STEP. No history,
sketches, parameters, names or colours.

cadmpeg does mark the intermediate shapes as hidden: its STEP for that example
has 9 solids and one `INVISIBILITY` entity listing the hidden ones. Extrudo's
STEP import has no handling for that entity (nothing in the facade or the
import feature refers to it), so all 9 arrive. Reading that flag in the STEP
import would be a small fix for today's desktop path, independent of the rest.

A native reader should take only the final shapes: each body's own shape (its
tip), the top-level objects nothing else consumes, one instance per link, and
the meshes. Counted over the library by that rule: 766 solids in 383 objects,
against cadmpeg's 2,684; the example gives 1 solid.

### 3.3 Sketches (*measured* counts, mapping rules from the study)

| | Library | Maps to Extrudo |
|---|---|---|
| Geometry | 895 lines, 169 circles, 110 arcs, 26 points, 11 B-splines (simple, non-rational), 0 ellipses | All exactly. Arc of ellipse and weighted or periodic B-splines have no Extrudo entity (none in the library) |
| Constraints | 3,114 | **84.6 %** as they are; **11.5 %** more once constraints can refer to the sketch origin and its H/V axes (the importer can draw these as fixed construction geometry, no Extrudo change); **3.9 %** with a small loss (point symmetry, B-spline helper circles) |
| Placement | 221 sketches | The stored placement is enough: FreeCAD's recompute left 219 unchanged. 217 have a frame along the axes of their container, so origin and offset planes plus a 2D shift cover them; 4 need a plane from an arbitrary frame |
| Attached to | 68 on origin planes, 63 on a face of a feature, a few on datum planes | Keeping "follows the face" needs the face re-found by geometry (section 2) |
| Projected (external) geometry | 80 links in 42 sketches | Stored in the file only from 1.0; for older files the importer projects the linked edge from the stored shape |

Both sketchers give each curve its own end points and join them with
coincident constraints, and both solve with planegcs, so the constraint sets
carry over almost one to one. Signed distances, the tangent "side" value and
angle units need care (rules in the notes).

### 3.4 Parameters (*measured* on the library's 168 expressions)

- Spreadsheet cells with an alias (FreeCAD's usual parameter table) and
  VarSet properties become user parameters; named sketch constraints become
  named dimensions (ADR-0142).
- 60 expressions keep their formula (72 % of those outside the BIM example),
  107 keep only their value (85 of them in one BIM file: references to other
  objects' properties, which Extrudo's expressions don't have), 1 is broken in
  FreeCAD too.

### 3.5 Features

| FreeCAD | Extrudo | Fidelity |
|---|---|---|
| PartDesign body, feature chain, suppressed features | A body with its features in order | same |
| Pad, Pocket: length, symmetric, two lengths, through all | `extrude` | same |
| Pad, Pocket: up to face (with offset), up to first | `extrude` to object | face re-found; "up to first" to be tested |
| Pad up to last; custom direction | no counterpart yet | stored shape for that step |
| Revolution, Groove | `revolve` | same (sketch axes become construction lines) |
| Fillet, Chamfer (3 modes) | `fillet`, `chamfer` | edges re-found by geometry |
| Hole (simple, counterbore, countersink) | `hole` | from the stored sizes, not FreeCAD's size tables (their numbering changed between versions) |
| Linear and polar pattern, Mirrored | `rectangularPattern`, `circularPattern`, `mirror` | same or with re-found references |
| MultiTransform (pattern of a pattern) | only the mirror-mirror case | rest: stored shape |
| Sweep (Pipe), Loft | `sweep`, `loft` | simple cases |
| Helix (additive/subtractive) | `coil` / `thread` for standard profiles | any profile: no counterpart yet |
| Draft, Thickness | `draft`, `shell` | basic modes |
| Datum planes, lines, points | construction geometry | from the attachment where it has a counterpart, else from the stored placement |
| Part workbench: box, cylinder, sphere, torus, cut, fuse, common, mirror, fillet, chamfer, extrusion of a sketch | primitives, `combine`, `mirror`, `fillet`, `chamfer`, `extrude` | same; the object tree becomes a timeline |
| Part extrusion of a Draft 2D object or a plain face | needs "2D shape to sketch" | stored shape until then |
| Plain shapes (STEP imports inside the file), Python-made solids (BIM, Draft arrays, fasteners) | `import` of the stored shape | exact shape, no history (the file has none either) |
| Meshes | mesh import | same |
| Part containers, groups | components, groups | placement baked into the bodies |
| Links (instances) | copies | not live |
| Assembly joints (1.0+) | joints | fixed, revolute, slider; others skipped |
| BIM, FEM, TechDraw, CAM objects | solids as stored shapes, the rest skipped | |

Direction rules (which way a pocket cuts and a hole drills, what Reversed and
Midplane do, taper sign, how two-length pads from old versions are converted)
are written down from the source and agree with cadmpeg's specification where
it covers them; the library has only full revolutions and no tapers, so a
prototype has to confirm the turn sense of a partial revolution and the taper
sign.

### 3.6 Coverage of the 60 files (*estimate*, by classifying each file's features)

| Result | With Extrudo as it is, no BRep reader | With the small and medium gaps closed |
|---|---|---|
| Full history | 24 | 30 |
| History, with exact stored shapes where FreeCAD has no history either or a feature has no counterpart | 23 (those parts lost) | 17 |
| Shapes only | 0 | 6 |
| Mesh bodies | 1 | 1 |
| Nothing useful (no solids: 2D gears, sketches only, empty bodies) | 12 | 6 |

What blocks the most files: plain stored shapes (15 files) and Python-made
solids (9), both solved by reading BRep; then Draft profiles (5), helical
sweeps (4), pattern-of-pattern (1), pad up to last (1).

## 4. What Extrudo lacks

Sizes: S under a day, M a few days, L a week or more.

| Id | Gap | Library files / items | Size |
|---|---|---|---|
| K1 | **Kernel reads OCCT BRep** (text, and binary beside it): one facade method next to `readStep`, an OCCT WASM rebuild through CI. Needed for every stored-shape body, for the checks and for re-finding edges and faces | all 53 files with solids | S (+ CI build) |
| S1 | Sketch origin point and H/V axes that constraints can refer to | 357 constraints | S (importer-drawn fixed construction geometry works today) |
| S2 | Sketch plane from an arbitrary frame | 4 sketches | S–M |
| S3 | Symmetric about a point | 24 constraints | S |
| S4 | Arc of ellipse; weighted and periodic B-splines; point on spline; via-point angle/tangent; arc-length dimension | 0 | S–M each |
| P1 | Expression extras (conditionals, comparisons, `%`, more functions) | 0 | S each |
| P2 | Configuration table from a spreadsheet | 1 file | M |
| F1 | 2D shape (Draft wire, rectangle, circle; a plain face) to sketch | 5 files, 49 extrusions | M |
| F2 | Sweep of any profile along a helix | 4 files | M |
| F3 | Pattern or mirror of a pattern/mirror | 1 file | M |
| F4 | Extrude "up to last" | 1 file | S |
| F5 | Construction axis normal to a plane through a point; move by a placement | fallbacks exist | S each |
| F6 | Extrude along a custom direction | 0 PartDesign (BIM walls only) | M |
| F7 | Hole counterdrill, tapered; sweep with auxiliary spine; thickness join modes | 0 | S–M each |
| C1 | Components with their own placement, nesting, live instances | 21 part containers, 13 links: baked placements and copies work today | M–L |
| C2 | Per-face colours | BIM files | S–M |

Only K1 is needed before a useful first version. Everything else either has a
fallback (stored shape, importer-drawn geometry, copies) or no file in the
library needs it.

## 5. Approach

| Option | What it is | Verdict |
|---|---|---|
| **1. Native reader and mapper** | A new pure-TypeScript package beside the f3d importer: read the zip and `Document.xml`, map onto an Extrudo design through the document API, check each body against the stored shape, fall back to the stored shape per step. Works in the browser and the desktop app | **Recommended** |
| 2. Shapes only | Read the file, bring in only the final shapes (body tips, top-level objects, meshes) with names and colours | This is option 1's first step; already better than today's 9-solids result |
| 3. Stay with cadmpeg | Desktop only, no history ever; the intermediate-shape problem would need an upstream change | No |
| 4. A FreeCAD add-on that writes `.extrudo` | FreeCAD resolves everything itself, but users need FreeCAD and the add-on; not "open the file" | No |

Reuse from the f3d importer: the report and "opens as a new design" flow, the
profile-region rule (even-odd over closed loops), the constraint policy (keep a
constraint only if the drawn geometry satisfies it), the body check and the
mid-body fallback (ADR-0084), the hostile-file limits. New for FreeCAD: the XML
reader, the PartDesign and CSG mappers, and "replay and match" for references
(read the stored shape, take the N-th edge, find it on the rebuilt body).

Stored shapes can enter the design as STEP attachments made at import time by
the kernel (`readBrep` then the existing `writeStep`), so the document format
does not change.

### Suggested order (each a slice with its own check on the library)

1. K1: facade `readBrep`; shapes-only import of the final shapes with names,
   colours, visibility and meshes (replaces the cadmpeg path for this format).
2. Reader: container, `Document.xml` property types, object model, versions.
3. Sketches: geometry, constraints, placement on origin and offset planes;
   check that the solved sketch equals the stored geometry.
4. PartDesign chain: Pad, Pocket, Revolution, Groove; body check against each
   feature's stored shape; mid-body fallback.
5. Parameters: spreadsheets, VarSets, expressions, named constraints.
6. References: fillets, chamfers, face-attached sketches, up-to-face,
   projected geometry (replay and match).
7. Patterns, mirror, hole, draft, thickness, datum geometry.
8. Part workbench: primitives, booleans as a timeline, Part fillet/chamfer.
9. Structure: part containers as components, links as copies, joints; legacy
   files without a Body (0.14 to 0.16).
10. App flow and report, user guide page, hostile-file hardening.
11. Later, by demand: F1 (Draft profiles), F2 (helical sweeps), F3.

About 12 to 16 worker slices (*estimate*, from how the f3d importer went; that
one also had to decode an undocumented binary format, this one does not).

## 6. Risks a prototype should settle first

| Risk | Test |
|---|---|
| Sketch frame on a face: FreeCAD's X axis versus Extrudo's rule for the same face | The 63 face-attached sketches: both frames, count those that differ by other than a multiple of 90° |
| A mapped sketch moves when Extrudo solves it (signed distances, tangent side) | Every library sketch: solve, compare each point with the stored one |
| Direction and sign rules (pocket side, reversed + symmetric, two lengths, revolve sense, taper) | Rebuilt volume against the stored shape per feature |
| Edge matching after different face merging in the two kernels' builds | Fillets and chamfers of four chosen files: matched / guessed / lost per edge |
| `readBrep` then `writeStep` changes face order or geometry | Round-trip all 1,784 stored shapes, compare volume, box and counts |
| Legacy chains (no Body, base found through the sketch's support) | The 16 legacy files against their stored shapes |
| Big files (15 MB of shapes in one BIM file) and hostile files | Time and memory budget, the f3d importer's limits |

## 7. Open decisions

1. Go for option 1 (native reader with history), staged so the shapes-only
   step ships first?
2. Run a measuring prototype first (reader, sketches, pad/pocket/revolve,
   volumes against the stored shapes on the library), before an ADR?
3. First-release scope: PartDesign, Part workbench and stored-shape fallback;
   Draft profiles, helical sweeps and pattern-of-pattern later?
4. Meanwhile, make the STEP import honour hidden bodies (`INVISIBILITY`), so
   the desktop's current path stops bringing in intermediate shapes?
5. Test fixtures in the public repository: small files authored with FreeCAD
   scripts for each feature (clean licence), plus the private library for the
   corpus test; FreeCAD's own LGPL test files only if their notice is added.

Smaller ones, each with a recommendation in the notes: sketch on the re-found
face or on a plane; importer-drawn origin geometry or a new sketch-origin
entity; legacy files with history or shapes only; which side wins when the
rebuild and the stored shape differ (the stored shape).

## 8. Sources

- FreeCAD source (LGPL-2.1-or-later), commit `d1707972`: read to learn the
  file format; no code taken.
- cadmpeg's FCStd specification (CC BY 4.0), commit `b6b55714`: independent
  description used for the cross-check; to be credited in the package's format
  document, as the f3d one does.
- The detailed notes (format reference with property tables and enum numbers,
  mapping tables, the per-file coverage table) and the scripts are kept outside
  this repository with the private test library.

## 9. Prototype (2026-11-10, same day): the estimates, measured

A throw-away prototype (a reader, a sketch mapper and a feature mapper in a
scratch package, about 3,800 lines, never pushed) ran the whole library through
Extrudo's kernel in Node and compared every rebuilt feature with the shape the
file stores for it. Round 1 used FreeCAD's numbers for the comparison; round 2
used the stored shapes themselves, read by a new kernel method `readBrep`
(section 4, K1: a facade method beside `readStep`, built locally). All numbers
in this section are *measured*; the coordinator recounted them from the result
files.

### 9.1 The reader of stored shapes (K1)

- All 1,784 non-empty stored shapes of the library read, in 32 s in total.
  Face and edge counts equal FreeCAD's on all 1,625 shapes that have FreeCAD
  numbers; the volume on 1,611 (the others: 9 spline shapes within 0.02 %,
  5 shells, faces or invalid shapes).
- **OCCT's B-rep text reader never returns from a number with a long integer
  part** in this build: old files print an unbounded line's range (±2e100) in
  full, a hundred digits. The kernel passes such a number in its short form.
  STEP import is not affected (tested with the same number).
- The WASM grows by 36 KB.
- Not done: hardening against hostile text (the reader indexes its tables
  without checks), docs.

### 9.2 Sketches (221)

| | |
|---|---|
| Placed from the stored placement | 219 (2 on tilted tangent planes have no Extrudo plane) |
| Constraints mapped | 2,784 of 2,984 (93.3 %); lost: external geometry 91, B-spline internals 94, point symmetry 14, other 1 |
| Solve without moving (more than 1e-6 mm) | 215 of 219; the 4 others move at most 1.4e-5 mm (a line-to-arc tangent that FreeCAD stores a hair off) |

The stored placement is enough to place a sketch, sketches on faces included
(no face lookup needed). Origin planes have the same axes in both programs; 27
sketches whose normal points the other way need a mirror, which works.

### 9.3 Features, compared with the stored shape after each

| Feature | Rebuilt and equal, round 1 | Round 2 |
|---|---|---|
| Pad | 58 of 70 | 62 |
| Pocket | 28 of 67 | 52 |
| Revolution | 9 of 11 | 11 |
| Groove | 0 of 3 | 1 |
| Fillet | not mapped | 15 of 19 |
| Chamfer | not mapped | 12 of 13 |
| Patterns, holes and the rest (39) | not mapped | not mapped |
| **All PartDesign features** | **95 of 221** | **153 of 221** |
| Box, cylinder, sphere | 174 of 174 | 174 |
| Cut / Fuse / MultiFuse / Common | 25 / 18 / 14 / 6 | 38 / 19 / 23 / 6 (of 51 / 24 / 42 / 7) |
| Bodies equal at their tip | 26 of 68 | 40 |

No mismatch is left unexplained. One rule for the side of a pad and a pocket
holds from 0.14 to 1.x, and Extrudo's profile regions reproduce FreeCAD's
nested-wire rule.

### 9.4 References by "replay and match"

A reference (`Edge12` of a feature) is resolved on that feature's stored
shape, described by its geometry and looked up on the body Extrudo rebuilt.

| | References | Found, one candidate | Ambiguous | Not found |
|---|---|---|---|---|
| Fillet edges | 124 | 124 | 0 | 0 |
| Chamfer edges | 26 | 22 | 0 | 4 (the body had already diverged) |

On a body equal to the stored one, every edge was found (146 of 146).
Up-to-face (3, all on datum planes), external geometry in sketches (91
constraints) and reference axes were not tried.

### 9.5 Continuing a body from a stored shape

When a feature can't be rebuilt, the importer carries on from the shape the
file stores for it (as the f3d importer does, through a STEP attachment). Of
70 such steps, 26 worked and 44 failed. The cause is not in the file or the
reader: **Extrudo's STEP writer writes a wrong file for some shapes whose
sub-shapes carry locations** (reproduced on a plain cylinder; 192 of the
library's 1,012 stored solids). FreeCAD's STEP of the same shape reads back
correctly in Extrudo, and a shape that came in through STEP once round-trips
fine. The steps that work keep volume, face count and (25 of 26) face order;
the attachments are small (5.2 MB over 11 files, the largest 751 KB).

### 9.6 Coverage of the 60 files, measured, beside the estimate of 3.6

| | Measured | Estimate (as is → gaps closed) |
|---|---|---|
| Full history | 14 | 24 → 30 |
| History plus stored shapes | 17 (26 once the STEP writer is fixed) | 23 → 17 |
| Stored shapes only | 11 | 0 → 6 |
| Mesh only | 1 | 1 |
| Nothing useful | 8 | 12 → 6 |

Full history is lower than estimated because patterns and holes (35 features)
were not mapped in the prototype, not because they can't be: they need no
shape reference. After a stored-shape step little stays editable (8 of 80
features in the chains that needed one), so mapping the common features
matters more than the fallback.

### 9.7 What the prototype changes in this report

- K1 is done as a prototype and verified on the library; what is left is
  hardening and docs.
- New gap, small: the STEP writer's handling of shapes with located
  sub-shapes. It blocks the stored-shape fallback, so it comes before it. A
  B-rep attachment kind would avoid the round trip altogether, at the price of
  a document-format change.
- Order of work, by what the numbers say: reader and shapes-only import;
  sketches; pad, pocket, revolve; fillet and chamfer by replay and match;
  **patterns and holes next** (the largest remaining skip); then the
  stored-shape fallback, external geometry, up-to-face.
- Extrudo gaps met on the way: a join refuses tools that don't touch the
  target (FreeCAD keeps both solids); no sketch plane from an arbitrary
  placement; no cone primitive; extrude "to object" is not FreeCAD's
  "up to first" for a sketch on the body's own face; a 0.45 mm fillet on seven
  meeting edges fails where FreeCAD builds it.
- Still not verified: partial revolutions and taper (no case in the library),
  truly tilted sketch planes, patterns, holes, external geometry.
