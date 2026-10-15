# The `.f3d` format, as this package reads it

There is no official specification of `.f3d`. What follows was worked out from
real files and checked over a corpus of 250 designs saved between 2018 and
2026: every record type below decodes, byte for byte, in every file that has
it unless a note says otherwise.

Some record layouts were first described in the format specification of the
[cadmpeg](https://github.com/cadmpeg/cadmpeg) project
([`docs/formats/f3d.md`](https://github.com/cadmpeg/cadmpeg/blob/main/docs/formats/f3d.md),
by the cadmpeg contributors), licensed under
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). This document builds
on it with changes: reworded, reorganised and extended from our own files.

Lengths are centimetres and angles radians throughout the file.

## Provenance

Apart from the specification credited above, everything here comes from
reading `.f3d` files byte by byte: the maintainer's own designs and a few
openly licensed ones. Each decoded design was checked against a STEP export of
the same design. No application binary was decompiled or disassembled, and no
SDK, vendor documentation or confidential material was used. The files carry
no encryption or other access control, and this package bypasses none. The
purpose is interoperability: opening a person's own `.f3d` designs in Extrudo.

## Container

A ZIP archive. Entries are stored, deflated, or (since 2025) Zstandard (method 93).

- `…AssetName[Active]/Design1/{MetaStream,BulkStream}.dat` — the design
  (`…DesignSegmentType1/` since 2025; `…ACTSegmentType1/` beside it is the
  component tree).
- `…/Breps.BlobParts/BREP.<uuid>.smb` (solved B-rep) and `.smbh` (B-rep with
  history): ASM ("ASM BinaryFile8"), see below.
- `…/Previews/small.png` — the preview.

## MetaStream: the type table and the record index

```
str8 segment name, u32 segment id, wstr asset GUID
u32 serializer magic (1234 since 2025: three more u32; otherwise one more)
str8 full type name, str8 add-in, u32, u32
u32 n types:  str8 type GUID, str8 base GUID, u32 version, str8 module,
              u32 k, k × u64 ids of the records of this type
u32 n, n × u64            named records
u32 n, n × (u64 id, u64 offset)   primary index: where each record starts
u32 n, n × (u64 id, u64 offset)   secondary index: a nested header inside the record
u64 next id, …
```

`str8` is u32 byte count + ASCII; `wstr` u32 code-unit count + UTF-16LE.

## BulkStream: records

```
str8 class tag (decimal: 256 + the type's index — local to the file)
u64 id, str8 name
u8 leading block present; [block]; u8 property block present; [u32 n, n × (str8 key, str8 type, value)]
members of the most-derived class level …
[at the secondary offset: str8 tag, u64 id, str8 name, members of the base level]
```

Members are untagged, in a fixed order per type version (sorted by member
name). The property block holds `pt_tag`, `crv_primary_id`,
`crv_secondary_id`, `EntityGenesis` (type `IntrinsicMetaTypeuint64`, a u64).

A reference: `u8 present`; `u64 id`; in one 2018–2019 generation the target's
type GUID as str8 (36); `u8 cross-document`; same-document: `u8 other segment`
(`u32 segment`); cross-document: `u32 segment`, wstr asset, `u8 same`, … So a
local reference is `01 + u64 + 00 00` (11 bytes).

## Records read

| Type GUID | What | Layout (after the prologue) |
|---|---|---|
| `2F4C1849…` | Timeline | ref context, u32 n, n refs: the features in order |
| `7A6A3D31…` | Parameter value (v5–7) | u8, [v6+ u32], wstr comment, [v7 u8], u32 n (the n of `dn`), ref owner, wstr expression, [v7 u32 value type], 5 flags (last: user parameter), wstr kind, [v7 wstr text], wstr unit, wstr name, f64 value, u8, ref table |
| `D91D429C…` | Parameter owner | its first reference is the feature that owns the parameter |
| `C2CEDAE7…` | Sketch point (v0/8/10/11) | ref incidence, 7–8 flags, 3 f64 (u, v, w), u64, u8, 8–12 zero, 2 f32, 5 bytes, ref, owner backlink |
| `DCA267ED…` | Sketch line | [wrapper ref], start, displacement, direction (3 f64 each), [normal], ref end point, ref start point, flags, owner backlink |
| `F0130424…` | Sketch circle or arc | [wrapper ref], centre, normal, x axis, radius, start angle, end angle, ref centre point, [ref end, ref start], flags, owner backlink |
| `FF23079A…` | Sketch ellipse or elliptical arc (v2) | [wrapper ref], centre, unit major axis, unit minor axis (3 f64 each; the plane normal is major × minor), major radius, minor radius, start and end parameter angles (the point at t is centre + major·a·cos t + minor·b·sin t), ref centre point, then for an arc ref end point, 2 bytes, ref start point; flags, owner backlink. Every one in the corpus is an arc |
| `AE42BAB6…` | Sketch line subclass (v0) | a reference to its incidence record, then a line's members (start, displacement, direction, refs end and start point); it runs across profiles, so it is read as construction |
| `00D157C2…` | Sketch point subclass | its point is in the base level; seen as the corners of older texts' boxes (not read) |
| `111A78C2…` | Sketch conic (v0) | after the curve ids: f64 rho, `01 00`, then the curve as a spline stores it (u32 degree 2, f64 tolerance, knots, weights 1, rho / (1 − rho), 1, and the start, shoulder and end as poles); a trailer; refs to the shoulder, end and start points. The base level ends in the owner backlink |
| `D82E012F…` | Sketch spline (v3) | derived level: the curve ids, an 8-byte carrier (all `ff`, or a reference); base level: two helper refs, ref end point, ref start point, `01 00`, u32 degree, f64 fit tolerance, then knots, weights (empty unless rational) and xyz poles, each `u32 n, u32 n, u32 8` and n × 1 or 3 f64; a trailer; owner backlink |
| `F0B1AFA3…` | Sketch text (v3, v4) | leading block u32 n, n × (ref box line, u32); property block (`txt_tag`, `txt_tag_base`); f64 baseline angle, a byte, 4 bytes, 12 zero bytes, f32 1, wstr font family, f64 font size (cm), 2 bytes, the box corner the baseline starts from (2 f64), zeros (v4: and three bytes), wstr text, the box lines again, a trailer, owner backlink. The box runs along the baseline for the text's advance width and up (90° anticlockwise) for the font size; its bottom edge is the baseline |
| `E0618268…` | Sketch text, older (v0, 2018–19 files) | presence byte, property block (`textex_tag`, `txt_tag_base`); a byte, f64, 12 zero bytes, f32 1; wstr font family; a byte; f64 height (cm, the capitals'), a reference to its parameter when it has one; u32 horizontal alignment (1 left, 3 centre), 3 zero bytes; wstr text (lines split by `\n`); a byte, the vertical alignment (1 the capitals' top at the box's top, 3 the lines' middle at the box's); u32 weight (500, 750) or other fields; a 4 × 4 row-major matrix from the text's frame to the sketch's (cm), its origin the box's lower left corner; trailer, owner backlink |
| `8B369926…` | Older text's box (a coincident-constraint subclass) | references the text and the four `16DEFC4D…` box lines (a sketch-line subclass; start and displacement, 6 f64, in the base level) |
| `EA3B930A…` | Text box line | a sketch-line subclass: a ref to its text, then start and displacement as a line's |
| `362B7EC3…` | Point incidence | u32 n, n refs to curves, u8, ref point |
| `60403D47…` | Sketch relation (a geometric constraint) | see below; subclasses keep it in their base level |
| `0C3F3829…` | Sketch dimension (base type) | see below; subclasses `8C780195…` linear, `664AD49F…` diameter, `8EDAC24D…` radial, `6EEAFDE5…` angular |
| `44A64366…` | Sketch | its base level's first reference is the placement |
| `F47A46FB…` | Sketch placement | u8 identity, or 16 f64: the sketch-to-model matrix, row-major |
| `8DA771B7…` | Sketch feature | refers to its sketch (`44A64366…`) |
| `DD405BC2…` | Extrude | op u32 (1 join, 2 cut, 3 intersect, 4 new body), direction u32 (1 one side, 2 two sides, 3 symmetric), face-extend u32, reversed u8, solid u8, start u8 (0 profile plane, 1 offset, 2 face) — at payload offset 9, 8, 7, 19, 18 or 17 depending on the version and the leading reference (57 where that reference carries its target's type GUID: 8 extrudes in 3 files of the corpus, all of class version 5); then three zero bytes and a unit vector (3 f64, model space) along the profile's normal (all 1182 extrudes of the corpus: unit, after three zero bytes; parallel to the sketch normal in 1172 of the 1175 with a sketch) |
| `4BD53E5A…` | Sketch-profile operand | the sketch's record number as decimal UTF-16; record N + 3, when it is `0D57BD2F…`, selects regions |
| `0D57BD2F…` | Profile regions | see below |
| `92F9A5F4…` | Entity-profile operand | names its sketch as a sketch-profile operand does, and the entity by a `90055C05…` record reference: a text (`F0B1AFA3…`, or the older `E0618268…`) whose letters are the profile |
| `5D89B935…` | Operation table | u32 n × (u64 operation id, u64 record), or in newer files u32 n × (u64 operation id, u32 m, m × u64 records); then u32 k, k × u64 and the closing reference. Version 1 has another list in front. A record can be missing from the file (seen: one of 41) |
| `E3849A15…` | Revolve | op u32 (as an extrude's) then u32 2, at payload offset 6 (after an empty property block) or 2; a sketch-profile operand; a geometry operand for the axis; the angles are parameters it owns (`AlongAngle`, …) |
| `5A1BF548…` | Geometry operand | refers to what it names: a sketch curve (`E2CEFD18…`: u64 0, u64 sketch record, u64 curve tag), an origin axis (`90055C05…`: u64 record), and its geometry in model space (`50AEE8B4…`: a line as start and displacement; `994C518A…`: a point; `CC54ECAD…`: a plane) |
| `50AEE8B4…` | Model line | 2 zero bytes, start (3 f64), displacement (3 f64) |
| `994C518A…` | Model point | 2 bytes, the point (3 f64), a byte and, in the long form, the 4 × 4 sketch-to-model matrix of the sketch it is in |
| `CC54ECAD…` | Model plane | 3 bytes, origin, x direction, y direction (9 f64) |
| `1C037A07…` | Hole | see below |
| `D087EFE5…` | Offset faces | the distance is a parameter it owns (`distance`, along the outward normal); an operand group of face operands (`5662F619…`), each recipe naming its face first |
| `FCBB1707…` | Sweep | op u32 at payload offset 6 (after an empty property block; as an extrude's: 1 join, 2 cut, 3 intersect, 4 new body); an operand group with the sketch-profile operand; an operand group of geometry operands, the path, each naming a sketch curve (`E2CEFD18…`) beside the curve in model space; a body operand per body it joins or cuts. Parameters it owns: `AlongDistance` and `AgainstDistance` (how much of the path it follows from the profile, one way and back, as fractions), `TwistAngle`, `TaperAngle`, and `AlongRailDistance`/`AgainstRailDistance` for a guide rail. The profile need not touch the path |
| `B0B3D9E5…` | Path pattern | what it copies as a mirror's; a count record (`countU`); the distance a parameter it owns (`PathPatternDelta`); the path an operand group of geometry operands, each naming a sketch curve. Its data record (`BE1FB171…`): u8, u32 2 (extent, as a rectangular pattern's), the count record, 4 zero bytes, the distance's parameter owner, 5 zero bytes, the original's reference point (3 f64, cm), four flag bytes (`01 00 01 00` in both files: the first is 1 where the copies turn with the path, which the copied faces in the B-rep confirm), the path group, the distance again (f64, cm), the start group and the instance list. The start group (`69EE2FA7…`, an operand-group subtype): 19 bytes, the start point on the path (3 f64, cm), a geometry operand naming the path's first curve. A copy is the original moved by the way the path went from the start point to the point the distance along it, and turned with it about the start point; its instance code is 1 |
| `65CA3206…` | Split body | an operand group with a body operand per body it splits; an operand group with the splitting tool: a geometry operand naming a plane (record reference) beside the plane in model space (`CC54ECAD…`), as a mirror's. Both sides are kept |
| `584D9526…` | Thread | after the prologue and an empty property block (offset 6, or 2 without one): f64 profile angle (60 metric, 55 pipe), u8 external (1 on a shaft, 0 in a hole), wstr class (`6g`, `6H`, `A`), wstr designation (`M10x1.5`, `G 1/2-14`), wstr size, wstr family (`ISO Metric profile`, `BSP Pipe Threads`), u8 full length (0: `ThreadLength` and `ThreadOffset` are parameters it owns), u32 1 or 2 (not known), f64 major and minor diameters, a byte, f64 pitch, f64 pitch diameter (cm; the class's own sizes, so a `6H` major is above the nominal). An operand group with a face operand per face. The file resizes the face to the thread (an external one's crest to the major diameter, a hole's to the minor), so the face's B-rep radius is not its sketch circle's. Every thread in the corpus is modeled (the reference STEPs have the thread's faces); a cosmetic flag was not found |
| `12D00AC0…` | A feature's records in several components | u32 n, n × (wstr GUID, reference: the feature's first record, the one the timeline names); u32 n, n × (wstr GUID, u32 m, m references: every record of the feature, the first among them); a closing reference. A feature acting on bodies of several components (an extrude cutting through two components' bodies, a hole drilled through both) keeps a record per component; the further ones are not on the timeline, are numbered in their own component's count (the timeline's `Extrude5` has an `Extrude3` there), have their own operations (which tag the faces they made in that component's bodies) and a body operand for that component's body, and the same sketch profile and parameter values (checked on one extrude and one hole). Seen in 4 designs (3 extrudes, 1 hole); the record's other instances hold two empty lists |
| `13BE0EF0…` | Torus primitive (v0) | u32 operation (as an extrude's; 1 join the one seen), a byte, four references (the parameter owners of `MajorDiameter` and `MinorDiameter`, the plane operand `7B6C3C2D…`, a `36D375CD…`), a byte, then a 4 × 4 row-major matrix (cm) in the frame of the plane it was made on; a body operand group for the bodies it joins, then a GUID string. The plane is a geometry operand among its references (`5A1BF548…`, naming an origin plane by `90055C05…`) holding the plane in model space (`CC54ECAD…`): the torus's centre is the matrix's origin and its axis the matrix's Z, taken from that frame (origin, x, y, x × y) into the model. Seen once (the plane YZ, the matrix a move of 7.5 cm along the plane's y): the file's B-rep torus is at (0, 0, 7.5) cm about +X, which the matrix read in model axes, (0, 7.5, 0), is not; the reference STEP agrees (one solid, 91 mm high) |
| `11F1A5CE…` | Circular pattern | the total angle is a parameter it owns (`TotalAngle`); a count record; an operand group of what it repeats; the axis as a geometry operand with a model line |
| `A085449A…` | Pattern count | refers to the count's parameter value (`countU`) |
| `D1728651…` | Mirror | shares the circular pattern's base type. An operand group of what it copies: per feature a geometry operand with a record reference and a body link, per body a body operand, per face a face operand; the plane is a geometry operand holding a record reference to the plane it names (origin or construction plane) and that plane in model space (`CC54ECAD…`). Its count record says 2 |
| `AE12AD3F…` | Rectangular pattern | what it copies as a mirror's; count records `countU`, `CountV`; the distances are parameters it owns (`uSpaceDistance`, `vSpaceDistance`): the whole extent from the first instance to the last, signed; each direction is a direction group (`F2A7590D…`) holding a geometry operand with the direction's model line. The group opens with two zero bytes, a u32 (8 or 16), a point and a vector (3 f64 each); the vector can point against the line (the pattern then runs the other way). Spacing instead of extent, and a symmetric pattern, have not been seen |
| `90055C05…` | Record by number | 2 zero bytes, u64 record: an origin axis, or the feature a pattern repeats |
| `D26351F0…` | Body link | wstr body GUID; refs to the body (`D3937028…`) and the feature that made it. In a pattern's geometry operand beside a `90055C05…`, the body that feature acted on |
| `D3937028…` | Body | GUID and appearance strings, then u32 index (its number, "Body3"), u32 n, n bytes, u32, u8 1, u8 light bulb (1 shown, 0 hidden). Newer files put a −1.0 double just before the index; class version 16 starts it at payload offset 10. a STEP export of the design leaves hidden bodies out |
| `9716F783…` | Body operand | refers to a body link. In an extrude's or revolve's operand group, one per body it joins, cuts or intersects; in a pattern's, one per body it repeats |
| `F2A7590D…` | Hole placement, pattern direction (an operand-group subtype) | u32 8, 6 f64 (a point and the face plane's unit normal), …; either a geometry operand holding the face's plane (`CC54ECAD…`; the point is then zero) or a face operand (`5662F619…`) whose recipe names a body face (the point is then the hole's place on that face: in the 4 such holes of the corpus it lies on the recipe's B-rep plane, and the hole's cylinder axis meets the face there) |
| `2CA5A1CD…` | Operand group | one per fillet/chamfer edge set; members are edge operands (or face or body operands, for other features) |
| `5662F619…` | Edge or face operand | refers to its recipe; an extrude's face operands name its start face and the face it goes up to |
| `7ACC2A03…` | Edge or face recipe | u32 1, u32 3, u32 n faces; per face u32 tags; per tag str8 token, u32 0, u32 k, k × i32 operation id, u32 0; then `edge_recipe_data` and a program (not read). An edge lists its two faces first, a face itself; the rest are neighbours. A fillet's or chamfer's face often has the token k of the k-th edge in that feature's list, but the tokens count other faces too (a one-edge fillet's face can be 4; a four-edge chamfer's 1, 2, 5, 6); an extrude's start cap 1, end cap 2, sides from 3. A first face with a negative token (`-1@301`, `-143@304`) names no face of the body: in the 11 such edge recipes of the corpus (all closed edges: a circle where a cylinder meets a cap or a plane) exactly one face follows the second, and the edge runs between the second face and that one (the B-rep holds an edge between those two where the stream kept it) |

An extrude's extent shows in the parameters it owns: `AlongDistance` for a
distance, `Side1Offset` (and a face operand) for up to an object, none for
through all; `ProfileOffset` is the start offset, from the profile plane or
from the start face.

A symmetric extrude's `AlongDistance` is each side's length, not the whole
length: the file's own cap faces (the B-rep faces tagged by the feature's
operations, normal along the direction vector above) lie that distance either
side of the profile in every symmetric extrude of the corpus where both caps
survive (26 extrudes in 10 designs: the gap between the caps is twice the
distance). No whole-length symmetric extrude has been seen, so the record's
flag for one, if there is one, is not known: the head block is the same in all
26, and the few member bytes that differ between them (a prologue byte in
version 8, one u32 that is 0, 5 or 10) split them in ways the caps don't.

An up-to-face offset (`Side1Offset`, `Side2Offset`) is measured along the
target face's normal. Seen on a face slanted to the sketch in one design
(three extrudes, cosine 0.946, −9.5 mm): taken along the extrude direction the
replayed end face lies 0.5104 mm (= 9.5 × (1 − 0.946)) off the file's own end
face (the B-rep face tagged by the extrude, on the target's normal); divided by
the cosine it lies on it (0.0000 mm, both extrudes whose end face survives).
The other 13 offsets of the corpus are to faces parallel to the sketch.

A hole's sizes are parameters it owns: `HoleDiameter`, `HoleDepth`,
`TipAngle` (180° is a flat bottom), and `CSDiameter`/`CSAngle` for a
countersink or `CBDiameter`/`CBDepth` for a counterbore. Its references hold a
hole placement (the plane of the face it starts on) and one geometry operand
per centre (`994C518A…`, model space). A hole placed by its distances to two
edges (parameters `RefDim1`, `RefDim2`) stores no centre point: its centre is
where the axis of the cylinder it made (the B-rep faces tagged by its
operations, of radius `HoleDiameter`/2) meets the start face (the one such hole of
the corpus: 3.9 mm and 3.8 mm, centre at y 3.9 mm, z 3.8 mm on the plane x = 0). It drills against the plane's normal
(x × y). Its own members open with `01 01` (payload offset 10 after a
property block, 6 without, 2 in version 4); 28 bytes on, a byte is 1 where it
drills along the normal instead — seen once, on the only hole in the corpus
that drills that way, so not certain. The extent (blind, through all, up to)
has not been found yet.

Every feature record (a "parameter scope") ends in the same tail: u32 n and n
references (its inputs), u32 history state (`0xffffffff`: suppressed), wstr
kind (`Sketch`, `Extrude`, `Fillet`, … localized), u32 ordinal (`Extrude3`),
and for a renamed feature u32 0 and wstr name.

### Profile regions (`0D57BD2F…`)

```
ref operand, u32 1?, u32 groups
group: region, u32 X, X × region
region: u32 loops, loops × loop
loop: u32 n, n × member, u8 outer
member: u32 kind 2 or 3, u64 crv_primary_id, u64 crv_secondary_id,
        u32 direction, u32 piece, u32 pieces, 8 zero bytes
```

The record's very last loop has no `outer` byte. When a group lists more
regions (X > 0), its first region is the outline of the others together; its
loop can run along a piece twice (a slit).

A member is a piece of a curve: piece k of the n pieces the curve is cut into
by the **other curves of the same region** (all its loops) — not by the whole
sketch, so one curve can be piece 1 of 1 in one region and 2 of 3 in another.
An open curve's pieces count from its start; a closed curve's by where they
end, in (0, 2π]: piece 1 ends at the first cut. Collinear curves overlapping
along the boundary are each listed. Members are not in boundary order. A
curve trimmed after it was drawn keeps its primary id; its pieces get new
secondary ids.

This package cuts the decoded curves the same way (`regions.ts`), checks that
the pieces close, and takes every region of the Extrudo sketch inside them by
the even-odd rule. Where the sketch changed after the pick (curves gone, new
secondary ids, other counts), it falls back to the curves alone: the region
those curves close, every region inside it; failing that, the region whose
outline runs along the most listed curves still there. A region whose curves
are all gone is left out.

### Construction curves

A flag byte in the tail after a curve's last point reference: lines and arcs
at byte 0 (49-byte tail) or 6 (52- or 56-byte tail); circles at byte 2 (51) or
8 (54, 58); add 40 to the tail length where references carry type GUIDs.
Found statistically (curves the file's own profiles use are never construction)
and not certain; curves a profile uses are imported as non-construction
whatever the flag says.

### Sketch constraints and dimensions

A **relation** (`60403D47…`, v3) is one geometric constraint:

```
u8 1 (leading block), u32 n, n × (ref point or curve, u32 role)
property block (usually empty; sometimes EntityGenesis)
ref sketch, u32 kind mask, u32 state mask
u32 n, n × ref (the loci again), u8
```

The kind mask, checked against the solved geometry over the corpus: `0x1`
coincident (two points, or a point on a line, circle or arc — never a curve's
own end point), `0x2` collinear, `0x4` concentric, `0x10` parallel, `0x20`
perpendicular, `0x40` horizontal, `0x80` vertical (along the sketch's own
axes), `0x100` tangent, `0x400` symmetric (two points, lines or circles and
the line that is the axis), `0x800` equal, `0x1000` midpoint (a point and a
line). `0x2000` (seven points) is not known. The roles look like counters and
are not used. Subclasses with kind 0 and a state mask hold other sketch
constructions: `D3BD153B…` offsets (state `0x20`), `40800FB9…` sketch
patterns, `8B369926…` an older text's box. A Fix constraint was not found.

A **dimension** (a subclass of `0C3F3829…`) opens with the same leading block
(its first locus is often the null reference), then presentation data, then a
reference to the owner record (`D91D429C…`) of the parameter it drives; the
parameter value with that owner holds its `dN` name, expression and value. A
linear dimension measures two points, a line (its length), two parallel lines
or a point and a line; its direction is the byte pair 7 and 6 bytes before
the owner reference: `40 00` aligned, `00 40` horizontal, `00 80` vertical.
A diameter dimension measures a circle, a radial one an arc, an angular one
two lines (the angle or its supplement, whichever the value is).

The importer (`sketch-constraints.ts`) takes a constraint or dimension only
when the geometry already satisfies it where the file put it, then solves the
sketch and takes out whatever the solver calls redundant or conflicting, or
anything that would move a point.

## Components

Every component, the root included, is a component record; what belongs to it
is found by following references, since the frames differ between file
generations.

| Type GUID | What | How it is read |
|---|---|---|
| `E03784ED…` | Component | its most-derived level references its occurrence list (`904F885E…`), body containers (`CD57BC48…`) and history (`C3423E04…`); its base level references the occurrence list again, then a few bytes, a wstr GUID and the wstr name (the root's is the design's name and version, "Bracket v3") |
| `C3423E04…` | Component history | references the component's feature list (`3A6D1E62…`) and its own timeline (only the root's lists items: the file keeps one timeline for all components) |
| `3A6D1E62…` | Feature list | its base level lists the records the component owns; every timeline feature's base level ends with a reference to the feature list of its component |
| `CD57BC48…` | Body container | its last component reference is its component; a body (`D3937028…`) references the container of the component it is in |
| `CE2913AA…` | Occurrence | a reference to the component; after a stretch that differs between generations, u32 ordinal (1 for a component's first occurrence, 2, 3… for copies), wstr component GUID, wstr occurrence GUID; when placed, a row-major 4 × 4 rigid transform (cm) after those. The root's is named `rootInstance`. A component's occurrence list references the occurrences of its children |
| `2BB3BB69…` | Hidden occurrence | references a component (first) and its occurrence; one per occurrence whose light bulb is off. Worked out from the samples alone: in each of them, the components these name are the ones a STEP export of the design leaves out |
| `56225BC7…` | Body to Component (timeline item) | a body operand (`9716F783…` → body link → body) names the body it takes; it makes a new body record in the target component, whose body link names the item or one of its own records as the feature that made it. The body it took stays in its old component, hidden |
| `BA3059E4…` | Cut and paste of bodies (`CutPasteBodies`, timeline item) | the same shape as Body to Component (body operand → body link → the body it takes; a new body record in the target component whose body link names one of the item's own records); its scope has **no history state**, like a sketch, so a missing state doesn't mean suppressed. The plain cut and paste (`D57B1A22…`, `CutPaste`) names no body operand and is not read |

Seen in the samples: no component placed twice, nesting in a few designs, and placed
occurrences away from the origin only in a design with no timeline.

A body's index sits after a −1.0 double in most files (payload offset 10 in
class version 16); in some it is 16 bytes after the body's GUID string, behind
other numbers.

## ASM B-rep

SAB (binary SAT) with 8-byte integers: `ASM BinaryFile8`, u64 version, record count,
entity count, flags; three strings and three doubles; then records of tagged
values (`0x04` int, `0x06` double, `0x07` string, `0x0C` pointer, `0x0D` class
name, `0x0E` base class, `0x11` end of record, `0x13`/`0x14` three doubles…).

A record writes its own class and then its base classes, each with a `0x0D`
tag: a straight curve is `intcurve`, `curve` (joined `intcurve-curve`), a
procedural one continues `spring_int_cur`, `nurbs`, `spline`, `ref`, `cone`,
`nubs`, `nullbs`. The first name is the record's own type; the rest are its
ancestors, so a reader that keeps only the last name reads `nullbs` where the
type is `intcurve-curve`. (`asm.ts` keeps the last in `type`, what the rest of
this reader was written against, and the first in `derived`.)

A `face` record's first pointer is its attribute chain and its last its
surface. Faces are tagged with `ATTRIB_CUSTOM`
`generic_tag_attrib_def`: a group count, then per group a selector, a token
string, 0, a count and that many operation ids. A fillet's edge recipe names
faces by the same (token, operation id), which is how an edge is found: its
two faces' surfaces give the line or circle it lies on, and the operation
table gives the feature that made each face.

A face merged from coplanar faces (after a join) carries one tag per
face merged into it, sorted by operation id: `[18@303 5@303 4@305 6@307]` is
two sides of operation 303 and faces of 305 and 307. A face copied by a
pattern or mirror carries tags with several operation ids: the source
feature's, the pattern's and the instance's (`[5@309/311/328]`); the face it
copies is the one with the source's tag and not the pattern's.

A copying feature's data record (the first record its members name:
`C444E6AD…` for a mirror, `EA0E146E…` for a rectangular pattern,
`7493A99D…` for a circular one) lists its instances: `u8 1, u32 n, n ×
(u64 code, u64 operation id)`, then `u32 m` and m instance records
(`AD719C1A…`; m can exceed n). A circular pattern's codes number the
instances from 1, the original; a rectangular pattern's Cantor-pair its two
indexes, the original's (1, 0), so a row's instance u has code u(u + 1)/2; a
mirror's one copy is 2.

`plane-surface`: a root point, then the unit normal. On the side of an
extrude made by a sketch line, the root point lies on that line's stretch
(swept to the face's height): of the 7,864 such planes the corpus's offsets,
fillets and chamfers name, all of them; at the line's start in 3,005, its end
in 2,629, a joint of two lines in 205, between its ends in 2,025. On a plane
that holds several of the sketch's lines (2,964 of them) it lies on exactly
one line's stretch in 2,071, which tells collinear sides apart where the
recipe's tags don't (checked with a survey over the corpus, 2026-10-14).

`cone-surface`: centre, axis (unit), major axis (its length the radius at
the centre), ratio, then the sine and cosine of the half-angle. The radius at
h cm along the axis is r + h · sine / cosine; a negative sine narrows the cone
along its axis (a countersink drilled along the axis). A sine of 0 is a
cylinder.

### Topology, and earlier states

The faces reach their edges the usual SAT way (each record: attribute
pointer, a history slot, a spare pointer, then):

| record | pointers after those three |
|---|---|
| `face` | next face, first loop, shell, subshell, surface (then sense flags) |
| `loop` | next loop, first coedge, face |
| `coedge` | next, previous, partner coedge, edge, (sense,) loop, pcurve |
| `edge` | start vertex, (parameter,) end vertex, (parameter,) a coedge, curve (then sense and a convexity string) |
| `vertex` | an edge, (an int,) point |
| `point` | its position |

`straight-curve` is a point and a direction; `ellipse-curve` a centre, the
normal, the major axis (as long as the major radius) and the minor-to-major
ratio (1: a circle). Subtypes (`tedge-edge`, `tvertex-vertex`) end in the
base type's name.

A `sphere-surface` is a centre, a radius, then the pole axis and a reference
direction (both unit; the sphere is symmetric about the axis). A
`torus-surface` is a centre, the axis, the major (centre-to-tube-centre) radius,
the minor (tube) radius and the tube's reference direction. A negative radius —
the sphere's, or the torus's minor one — is the file's way of pointing that
surface's normal inward.

A torus whose tube is not smaller than its ring (an apple, or a horn when they
are equal) or whose major radius is negative with a tube that reaches past the
axis (a lemon) is the tube circle centred at the signed major radius, swept round
the axis, and a face uses its part on its own side of the axis: every vertex of
the corpus's 115 such faces (980) lies on that circle with a non-negative
distance from the axis. No `TOROIDAL_SURFACE` holds such a part; the file's own
STEP export writes each of these faces it shares vertices with as a rational
`B_SPLINE_SURFACE` of degree 2 × 2 (the corpus has no
`DEGENERATE_TOROIDAL_SURFACE`).

An `edge` record that names no curve (its two vertices one point) is a cone's
apex: the file closes the cone's face there with a loop of that one edge
(125 such edges in the corpus's live solids, all on cones, 104 in an inner
loop and 21 in the outer one). The export writes the cone's face without it,
with a seam line running to the apex.

An `edge` record's pointers and values are: its two vertices, each with its
parameter on the curve, a coedge, the curve, then a sense flag and a convexity
string. The sense is true when the edge runs against its curve (the edge's
start-to-end direction is opposite the curve's own parameter direction), so
STEP's `EDGE_CURVE` same-sense is its opposite; for a straight curve the two
vertex positions say the same thing directly. A full-circle edge has one vertex
and parameters that span 2π; STEP is written with it split at its antipode into
two half edges.

A `face` record's two trailing flags are its forward sense (true when the face's
normal runs with its surface's) and a second flag the file writes false
throughout. STEP's `ADVANCED_FACE` same-sense is the opposite of *reversed*, and
the file winds a loop the other way round from STEP's surface-normal winding, so
a not-reversed face's loop is written reversed with same-sense true and a
reversed face keeps the file's loop with same-sense false. The winding is
against the file's own surface: a sphere or torus written with a negative radius
(or a spline record that runs against its B-spline) points its normal the other
way than the surface STEP gets, which reverses the face's same-sense but not
the loop the file wound. A kernel reorients a face whose single loop winds the
wrong way, but on a torus face bounded by two parallel circles the winding is
what picks the band between them: such faces on inward tori came out as the
rest of the torus (473.6 mm² for an export's 101.2) until the loop followed the
file's own flag.

A stream is one or more solids, grouped `body` → `lump` → `shell` → face chain.
Each `lump` names its shell and its body, and the shell's face chain is that
lump's faces; the stream's earlier shells (history) carry no faces. A lump
can hold more than one shell: a shell's first pointer to another shell is the
lump's next shell. Together they bound the solid: one is its outside, the others
voids inside it (27 lumps in the corpus; in a body checked against its STEP
export, the first shell's 59 faces plus the other shells' 24 made the export's
83, and the first shell alone had 1.3 % more volume). The chain's order does not
say which shell is the outside: it is the first in 21 of the 27 lumps and the
second in 6, and in all 27 it is the only shell whose box (from its vertices)
holds every other shell's. A void's faces keep the file's sense (their normals
point out of the material, into the cavity); the export writes each void as an
`ORIENTED_CLOSED_SHELL` with `.F.` over a `CLOSED_SHELL` of those faces, in a
`BREP_WITH_VOIDS`. A shell names its lump: an earlier `lump` record (history)
can name one of the later shells as its own (95 lump records in the corpus name
a shell whose lump is another); two of them name a shell nothing else reaches,
whose face chain runs into a live lump's faces. A design
body reaches its stream through its body container (`CD57BC48…`, the record in
the design segment the body's `D3937028…` names): the container lists its
component's bodies in order and points at a record (`74CA4562…` or
`40DCC3F4…`) whose payload is the stream's `BREP.<uuid>.smb[h]` name.

The container's order is not the stream's on every file, and a stream can hold
solids no container lists: a hidden body's solid (a body no container names),
solids a feature made for a later one (a tool body; its faces carry only that
feature's operations) and earlier states of a body (their faces carry a subset
of the final solid's operations). What ties a solid to its body is the face
tags: the body's creator (the feature its first body link `D26351F0…` names
after it) has operation IDs in the operation table, and the faces that feature
made carry them. Measured over the 250-file corpus with a probe that lists each
solid's operations beside each body's creator: in the streams holding as many
solids as the bodies naming them, the creator's operations are on exactly one
solid for 280 bodies, the container's position for 278 of them; the other two
are one design whose two bodies the container lists the other way round (the
reference export names the solids, and its face counts confirm the creators').
In one stream of nine panels the container lists the bodies #1, #4, #2, #3…
while the creators' operations put the solids in #1, #2, #3, #4 order. A
feature that made several bodies tags all of them alike, so its bodies cannot
be told apart by tags. Every body link in the corpus (449) is the only one for
its body, so the links name no later feature that changed a body.

A body with a sphere or torus face the file signs inward (a negative radius)
was not rebuilt reliably: on the corpus, every body the writer got wrong
while the replayed timeline was right carried such a face, though the sign is
not the whole cause (in some of them the body's container leads to a different
solid than the visible one). With the loop winding above corrected, the writer
vouches for such bodies and the body check checks them like any other: the eight
bodies it once left unchecked for this reason each measure as the export's solid
(volume within 0.02 %, box exact) when read on their own.

The streams hold more than the solved B-rep: earlier versions of faces (one
face tag can appear on several faces with different extents) and their
edges. So the edge a fillet or chamfer rounded is often still there between
two faces carrying its recipe's two tags: about half the corpus's
fillet and chamfer edges are. Its vertices are exact, but they may belong to
another state than the one the fillet saw (for nearly half of the lines the
edge was longer or shorter then), so they tell which line or circle the
edge is on, and which stretch of it when the bounding faces leave a choice,
not where it ends on their own.

### Spline curves and surfaces

An `intcurve` (a procedural curve: an intersection, an offset, a blend's
spring) and a `spline-surface` (a blend, an extruded or swept profile, a
loft) carry their definition in a subtype block between `0x0F` and `0x10`.
Inside a block the class names (`0x0D`/`0x0E`) are values in their own right,
not the record's type: `{ exact_int_cur 22800 0 nubs 3 0 2 … }`. The record's
value just before the block is its sense flag: true when the curve runs
against its B-spline's parameter, or the surface's normal against the
B-spline's own (u × v). Only `intcurve-curve`, `spline-surface`, `pcurve` and
`tcoedge-coedge` records hold blocks.

A block can be a reference instead, `{ ref n }`: the n-th block the stream
wrote before it, counting every block that opens with a class name other than
`ref`, in the order they open (blocks nested inside another, and those of
other records, included). Over the corpus every one of the 72,445 references
lands on an earlier block of the right kind (a curve on a curve, a surface on
a surface, a parameter curve on a parameter curve) with this count, and 38,508
miss when blocks are counted as they close.

A curve block is the subtype's name, a version integer, a 0 (the B-spline is
saved; a helix has none and writes `nullbs`), then the B-spline:

| field | values |
|---|---|
| kind | `nubs` (polynomial) or `nurbs` (rational) |
| degree, form, knot count | integers; form 0 open, 1 closed, 2 periodic |
| knots | that many (value, multiplicity) pairs, the values increasing |
| control points | x, y, z (cm), and a weight after each for `nurbs` |

then the fit tolerance (a double) and the subtype's own data (its surfaces,
its parameter curves, ranges). The end knots are written with multiplicity
`degree`, not the `degree + 1` STEP wants, so there are `Σ multiplicities −
degree + 1` control points. Checked on every B-spline block in the corpus
(curves, parameter curves and surfaces, nested ones included): the end
multiplicity equals the degree in all of them, and the run of doubles after
the knots is exactly that many points (3 or 4 doubles each) plus the fit
tolerance. A closed or periodic curve's first and last points are the same.

A surface block holds the subtype's own data first (an extruded profile's
curve as a whole `intcurve` block, its direction; a blend's support surfaces
and spine), then a 0 and the surface's B-spline, at the block's own bracket
depth: `nubs`/`nurbs`, u and v degrees, for `nurbs` the name of the rational
directions (`u`, `v` or `both`; every point still has a weight), u and v
forms, two singularity flags, u and v knot counts, the u knots, the v knots,
then the points with u running fastest (point (i, j) is the (j · nu + i)-th).
A block written with 2 instead of that 0 keeps no B-spline (an extruded
profile saved as a summary); none of those is a live face's surface in the
corpus. Helix surfaces (`helix_spl_line`, `helix_spl_circ`) keep none either.

A helix curve's block is `helix_int_cur`, a version, the parameter range (two
doubles, each after a true), then the helix: a root point, a major and a minor
axis (the radius at t = 0 and a quarter turn on), the rise per turn as a
vector, a taper (0 throughout) and the axis. Root + major · cos t + minor · sin
t + rise · t / 2π gives both vertices of 78 of the corpus's 84 helix edges at
the edge's parameters, mapped as for a B-spline edge. A `helix_spl_circ`
surface sweeps a circle of the block's last radius round the helix in the plane
of the axis (every vertex of its 24 faces is that far from the helix); a
`helix_spl_line` surface sweeps a straight profile, whose stored vector's
meaning is not settled (its axial part matches the vertices, its radial part
does not). The writer refuses both.

An edge's two parameters are on its curve, negated when the edge runs against
it, and again when the curve runs against its B-spline: evaluating the
B-spline at the edge's parameters gives its two vertices to under 1e-6 cm on
all 31,484 B-spline edges of the corpus's live solids but 43. Those 43 are
closed edges on closed curves whose stretch starts away from the curve's
first point (a stretch of one period, past the end of the knot range), and
the vertex is where the stretch, wrapped by the period, says.

The file's STEP export of the same body re-fits its splines (other knots,
other points), so its `B_SPLINE_*` entities agree with these only at the
ends; they cannot be compared knot by knot.

### Sweep faces

A sweep's own faces carry tokens of its operations: the start cap (on the
profile's plane) 1, the end cap 2, and the sides numbered on from there, piece
by piece of the path (one design, a profile of 26 curves along a line, an arc
and a line: 114–139 along the line, 140–156 round the arc, 157–173 along the
last line; not every number is a face). A side the profile sweeps in the
path's own plane is one face carrying a tag per piece (`119 120 121`). The
tokens are not read: the importer tells a sweep's faces by geometry, against
each piece of a flat path of lines, arcs and splines (along a line a profile
line sweeps a plane and an arc a cylinder; round an arc the faces of a revolve
about its axis; along a spline only a plane at one height off the path's
plane). Checked on 3 designs: every face the rounds there name along lines and
arcs is told; those round a spline are not.

### Fillet and chamfer faces

A fillet's own faces (tagged with its operation ids) are cylinders of its
radius: in 443 of the 444 fillets with such faces, every set's radius is
one of them. A chamfer with two distances, or a distance and an angle
(`leftDistance` and `rotateAngle`), makes a plane or cone that meets the
face taking the first distance that far from the edge, and the other face
d · tan θ (or the second distance) from it; nothing else in the records says
which face is which.
