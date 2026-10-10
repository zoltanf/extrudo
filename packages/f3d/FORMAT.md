# The `.f3d` format, as this package reads it

Autodesk publishes nothing about `.f3d`. What follows was worked out from real
files and checked over a corpus of 250 designs saved between 2018 and 2026:
every record type below decodes, byte for byte, in every file that has it
unless a note says otherwise. Some record layouts were first described in the
[cadmpeg](https://github.com/cadmpeg/cadmpeg) project's format specification
(`docs/formats/f3d.md`, CC-BY-4.0), which this document builds on.

Lengths are centimetres and angles radians throughout the file.

## Container

A ZIP archive. Entries are stored, deflated, or (since 2025) Zstandard (method 93).

- `FusionAssetName[Active]/Design1/{MetaStream,BulkStream}.dat` — the design
  (`FusionDesignSegmentType1/` since 2025; `FusionACTSegmentType1/` beside it
  is the component tree).
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
| `362B7EC3…` | Point incidence | u32 n, n refs to curves, u8, ref point |
| `44A64366…` | Sketch | its base level's first reference is the placement |
| `F47A46FB…` | Sketch placement | u8 identity, or 16 f64: the sketch-to-model matrix, row-major |
| `8DA771B7…` | Sketch feature | refers to its sketch (`44A64366…`) |
| `DD405BC2…` | Extrude | op u32 (1 join, 2 cut, 3 intersect, 4 new body), direction u32 (1 one side, 2 two sides, 3 symmetric), face-extend u32, reversed u8, solid u8, start u8 (0 profile plane, 1 offset, 2 face) — at payload offset 9, 8, 7, 19 or 18 depending on the version |
| `4BD53E5A…` | Sketch-profile operand | the sketch's record number as decimal UTF-16; record N + 3, when it is `0D57BD2F…`, selects regions |
| `0D57BD2F…` | Profile regions | see below |
| `5D89B935…` | Operation table | (u64 operation id, u64 feature) pairs, the last member before the closing reference |
| `2CA5A1CD…` | Operand group | one per fillet/chamfer edge set; members are edge operands |
| `5662F619…` | Edge operand | refers to its edge recipe |
| `7ACC2A03…` | Edge recipe | u32 1, u32 3, u32 n faces; per face u32 tags; per tag str8 token, u32 0, u32 k, k × i32 operation id, u32 0; then `edge_recipe_data` and a program (not read) |

Every feature record (a "parameter scope") ends in the same tail: u32 n and n
references (its inputs), u32 history state (`0xffffffff`: suppressed), wstr
kind (`Sketch`, `Extrude`, `Fillet`, … localized), u32 ordinal (`Extrude3`),
and for a renamed feature u32 0 and wstr name.

### Profile regions (`0D57BD2F…`)

```
ref operand, u32 1?, u32 groups
group: region, u32 X, X × region
region: u32 loops, loops × loop
loop: u32 n, n × member (u32 3, u64 curve tag, 4 × u32, 3 × u32 incidence, 2 × u32), u8 outer
```

The record's very last loop has no `outer` byte. A region's curves are
listed as they were when it was picked — every curve along its boundary,
overlapping collinear ones included — and Fusion finds the region again
after edits. This package rebuilds the region from those curves and takes
every region of the current sketch inside it.

### Construction curves

A flag byte in the tail after a curve's last point reference: lines and arcs
at byte 0 (49-byte tail) or 6 (52- or 56-byte tail); circles at byte 2 (51) or
8 (54, 58); add 40 to the tail length where references carry type GUIDs.
Found statistically (curves Fusion's own profiles use are never construction)
and not certain; curves a profile uses are imported as non-construction
whatever the flag says.

## ASM B-rep

ACIS SAB with 8-byte integers: `ASM BinaryFile8`, u64 version, record count,
entity count, flags; three strings and three doubles; then records of tagged
values (`0x04` int, `0x06` double, `0x07` string, `0x0C` pointer, `0x0D` class
name, `0x0E` base class, `0x11` end of record, `0x13`/`0x14` three doubles…).

A `face` record's first pointer is its attribute chain and its last its
surface. Fusion tags faces with `ATTRIB_CUSTOM`
`generic_tag_attrib_def`: a group count, then per group a selector, a token
string, 0, a count and that many operation ids. A fillet's edge recipe names
faces by the same (token, operation id), which is how an edge is found: its
two faces' surfaces give the line or circle it lies on, and the operation
table gives the feature that made each face.
