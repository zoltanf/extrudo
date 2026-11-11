# The `.FCStd` format, as this package reads it

FreeCAD's document file. What follows is what `@extrudo/fcstd` reads and how,
checked over a private library of 60 files saved by FreeCAD 0.14 to 1.2
(ADR-0144; the library itself stays outside the repository).

Sources: FreeCAD's own source code, read as a description of the format (no
code, comments or text taken; FreeCAD is LGPL-2.1-or-later), and the FCStd
specification of the [cadmpeg](https://github.com/cadmpeg/cadmpeg) project
([`docs/formats/freecad_fcstd.md`](https://github.com/cadmpeg/cadmpeg/blob/main/docs/formats/freecad_fcstd.md),
by the cadmpeg contributors, licensed under
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)), against which our
notes were cross-checked. This document is our own wording, organised and
extended from the library.

Numbers in the file are always FreeCAD's internal units: millimetres, square
and cubic millimetres, and degrees for angle properties; sketch constraint
angles are radians. The document's unit system (1.0+) only changes what
FreeCAD displays.

## Container

A plain ZIP archive, its entries stored or deflated. Entry names are plain
(`Document.xml`, `Pad.Shape.brp`, `thumbnails/Thumbnail.png`); the reader
treats them as keys only, never as paths.

| Entry | Holds | Read |
|---|---|---|
| `Document.xml` | every object, its properties, links and expressions | always; the file is refused without it |
| `GuiDocument.xml` | per object: visibility, colours, display settings; the camera | when present (files saved without the GUI have none) |
| `*.brp` | one OCCT B-rep text per shape property (see Stored shapes) | on demand |
| `*.bms` | a mesh kernel (binary) | named only, not decoded yet |
| `DiffuseColor*`, `ShapeAppearance*` | binary colour and material lists of `GuiDocument.xml` | the first colour, when the GUI document names one |
| `*.Map.txt`, `StringHasher.Table.txt` | FreeCAD 1.0's topological element maps | not read (ADR-0144 decision 4) |
| other side entries without an extension | vector, float and placement lists saved as files (`<VectorList file="Nodes3"/>`) | named only |

Every property stored in its own entry names it in a `file` attribute; the
reader follows that name and never derives one. FreeCAD itself reads entries
in a fixed request order and silently skips one stored out of order; looking
entries up by name reads such a file more completely.

### Limits

Checked for every entry before anything is inflated (`archive.ts`); an entry
is inflated only when asked for, streaming into its declared size, which it
must fill exactly and whose CRC-32 must match.

| Limit | Value | Library's largest |
|---|---|---|
| Entries | 20,000 | 1,657 |
| One entry, inflated | 128 MB | 6.3 MB (a `Document.xml`) |
| All entries, declared | 512 MB | 25 MB |
| Inflated per compressed byte | 500 to 1 (+4 kB) | 145 to 1 |
| Compression methods | stored (0), deflate (8) | 0 and 8 |

Refused outright, with a plain message: a ZIP64 archive (an end-of-directory
locator, a `0xFFFF`/`0xFFFFFFFF` field, or a ZIP64 extra field), an encrypted
entry (flag bit 0 or 6), an archive over several disks, two entries sharing a
local header, an entry whose local header disagrees with the central
directory, a stored entry whose sizes differ, a declared size past the ratio.
Left out with a problem: a name that isn't plain (absolute, a drive letter, a
backslash, a control character, a `.` or `..` part), a second entry of the
same name (the first is read), an entry in another compression method.

## XML

Both XML documents are UTF-8 (refused when they aren't) and use attributes
for nearly everything. `xml.ts` reads elements, attributes and text; the five
predefined entities and numeric character references. Comments and
processing instructions are skipped, CDATA is text. A `<!DOCTYPE` (and so any
entity definition) or any other entity is refused. Limits: 256 levels of
nesting, 256 attributes per element, 4,000,000 elements per document (the
library: 9 levels, 17 attributes, 55,138 elements). The reader builds a tree
in one forward pass: the library's largest `Document.xml` (6.3 MB, 55,000
elements) parses in about 80 ms into about 27 MB.

## `Document.xml`

```
Document SchemaVersion ProgramVersion FileVersion [StringHasher]
  Properties                       the document's own properties (Label, UnitSystem, Uid …)
    Property name type [status] [group doc …]
      <value element(s)>
  Objects
    [ObjectDeps …]                 0.19+: each object's dependencies (not read)
    Object type name [id] [Invalid Error …]
  ObjectData
    Object name [Extensions="True"]
      [Extensions  Extension type name …]
      Properties  Property …       an object's and its extensions' properties together
```

- **`SchemaVersion`** is 4 in every file seen. Schema 2 calls the sections
  `Features`/`FeatureData` with `Feature` elements, otherwise the same; the
  reader accepts both names.
- **`ProgramVersion`** is FreeCAD's version and build (`0.19R`, `1.0.0R39109
  (Git)`); its leading `major.minor[.patch]` decides version rules
  (`FcDocument.version`). Missing means older than 0.14.
- An object's **type** is its C++ class (`PartDesign::Pad`), declared in
  `Objects`; its properties are in `ObjectData` under the same `name`. The
  **name** is what links and expressions use; the **label** (`Label`
  property) is what people see.
- `_Property` elements are transient (only their status is saved) and are
  skipped. A property's `status` bit 21 marks a dynamic (user-added) property;
  those also carry `group`, `doc` and type flags (VarSet entries, scripted
  objects).
- A document property `UnitSystem` (1.0+) is an enumeration with its strings
  in the file (localised); display only.

### Property values

A property is decoded by its **value element**, not its declared type:
FreeCAD renamed and retyped properties over the versions and reads the value
whatever the type says. Numbers go through a finite check; a property whose
number is NaN, infinite or not a number is left out with a problem.

| Element | Types | Decoded as |
|---|---|---|
| `Integer value` | integers, percent, constraints | `integer`; with the type `…Enumeration` or a following `CustomEnumList` (its `Enum value` strings) an `enum` |
| `Float value` | floats and quantities (length, distance, angle, area, volume …) | `float`, with the unit for length/distance (mm), angle (degrees), area, volume |
| `Bool value` | `true`/`false` | `bool` |
| `String value`, `Uuid value`, `Path value` | strings, fonts, files | `string` |
| `PropertyVector valueX valueY valueZ` | vectors, positions, directions | `vector` |
| `PropertyPlacement Px Py Pz Q0 Q1 Q2 Q3 [A Ox Oy Oz]` | placements | `placement`: when `A` is there FreeCAD uses the axis (normalised; a zero axis is +Z) and the angle in radians, else the quaternion Q0..Q3 = x, y, z, w. A point maps to `R·p + P` |
| `PropertyColor value` | colours | `colour`: packed `0xRRGGBBAA` (the fourth byte is transparency before 1.1, alpha from 1.1; it is never the opacity source, see GuiDocument) |
| `Link value` | links (`…Hidden`, `…Global`) | `link`, `''` for none |
| `LinkList count` + `Link value` | link lists (order matters: `Group`) | `linkList` |
| `LinkSub value` + `Sub value [shadowed] [shadow]` | a link with sub-elements | `linkSub` |
| `LinkSubList` + `Link obj sub [shadowed] [shadow]` | one `Link` per sub-element; `sub=""` is the whole object | `linkSubList` |
| `XLink file stamp name [sub]`, `XLinkSub`, `XLinkSubList` | links that may name another document (`file` non-empty) | `xlink` |
| `IntegerList` + `I v`, `StringList` + `String value`, `BoolList value="0101"` | lists | `integerList`, `stringList`, `boolList` |
| `Map` + `Item key value` | maps | `map` |
| `ExpressionEngine` + `Expression path expression` | the object's expressions | `expressions`, and `FcObject.expressions` |
| `GeometryList` + `Geometry` | a sketch's `Geometry`, `ExternalGeo` | `geometry`: raw records, not interpreted |
| `ConstraintList` + `Constrain` | a sketch's `Constraints` | `constraints`: raw records, not interpreted |
| `Part file` | part shapes | `shape`: the entry name (`''` for a null shape) |
| `Mesh file` | meshes | `mesh`: the entry name |
| `Cells` + `Cell address content [alias]` | a spreadsheet | `sheet` |
| `Python module class value encoded` | a scripted object's proxy | `python`: module and class only; the value (pickled or JSON state) is never decoded |
| `PropertyMaterial uuid` / `PropertyMaterial diffuseColor … transparency` | a 1.0+ library material / a display material | `material` / `appearance` |
| any other element with a `file` attribute | lists and files saved as entries (`VectorList`, `FloatList`, `ColorList`, `MaterialList`, `FilletEdges`, `FileIncluded` …) | `file`: the element and the entry name |
| anything else | | `unknown`: the raw elements, counted per type in `FcDocument.unknownTypes` |

A sub-element name is `[path.]Element`: `FaceN`, `EdgeN`, `VertexN` (1-based
into the referenced object's stored shape), `H_Axis`/`V_Axis`/`N_Axis`, `''`
for the whole object. When a sub carries `shadowed`, FreeCAD restores that
name and the stored one is the old name (`FcSub.old`); `shadow` is the 1.0
topological name, kept beside it.

In the library every property decodes except three display-only types:
`Spreadsheet::PropertyColumnWidths` and `…RowHeights` (5 each) and the
sketcher's visual layer list (71, typed `BadType` in the files).

### Objects the reader names

- **Extensions** an object declares (`App::OriginGroupExtension`,
  `App::GroupExtension`, `Part::AttachExtension`, `App::LinkBaseExtension` …)
  are listed per object; their properties are among the object's own.
- **Containers.** A `PartDesign::Body`, `App::Part`, `App::Origin`, a local
  coordinate system, `PartDesign::Boolean` and an assembly apply their
  `Placement` to what their `Group` holds (geo-feature groups). An
  `App::DocumentObjectGroup` (a folder) doesn't; a folder inside a part is
  inside the part's frame. A body's `Group` lists its sketches, datums and
  features in tree order; `Tip` is the feature whose shape is the body's.
  0.14 development files call `Group` `Model`.
- **Links** (`App::Link`): `LinkedObject` (an XLink; only targets in this
  document are followed), `LinkPlacement` (else `Placement`),
  `LinkTransform` (false: the link's placement replaces the target's; true:
  it applies on top of it), `ElementCount` (an array; not expanded yet).

## Stored shapes

Every shape property is a `Part file="…"` naming an entry with OCCT's B-rep
text. **The `file` attribute is the authority** (`storedShapeEntry`); the
naming differs by version:

| Saved by | Entry names |
|---|---|
| 0.14 – 0.21 | `PartShape.brp`, `PartShape1.brp`, `PartShape2.brp` … in save order |
| 1.0 – 1.2 | `<Object>.<Property>.brp`: `Pad.Shape.brp`, `Pad.AddSubShape.brp`, `Sketch.InternalShape.brp` |
| any, with FreeCAD's binary-shape setting | the same names ending in `.bin` (OCCT's binary form; none in the library) |

- An entry is empty (0 bytes) for a null shape. The text starts with
  `CASCADE Topology V1, (c) Matra-Datavision` (0.14 to 0.17 put a
  `DBRep_DrawableShape` line first; line ends may be CRLF); the library's
  1,784 non-empty entries are all version 1 text.
- **A PartDesign feature's `Shape` is the whole body after that feature**, in
  the body's coordinates; `AddSubShape` is its tool alone (stored in 1.2
  files only). A body's own `Shape` is its tip's with the body's placement.
  Any object's stored shape already carries the object's own `Placement`; it
  is in its container's coordinates.
- `storedShapeText` returns the text, or `undefined` with a problem when the
  entry is empty, missing, unreadable, binary or lacks the format line. The
  reader never parses the text: only the import's own kernel reads it
  (ADR-0144 decision 5). `brepHasSolid` only looks for a solid record (`So`)
  in the text's shape table.

## `GuiDocument.xml`

```
Document SchemaVersion="1"
  ViewProviderData
    ViewProvider name [Extensions]
      Properties  Property …       the same property grammar
  Camera settings
```

Per object (`FcObject.gui`, `undefined` without a GUI document):

- **Visible**: the view provider's `Visibility`; without one, the object's own
  `Visibility` in `Document.xml` (written from 0.19 on).
- **Colour**: `DiffuseColor` with more than one entry (a per-face list; the
  first colour, `faceColours` its length), else `ShapeAppearance`'s first
  material (1.0+: binary, `u32` count, then per material four packed RGBA
  `u32`s, ambient, diffuse, specular, emissive, then `f32` shininess and
  transparency; diffuse and transparency are used), else `DiffuseColor`'s only
  entry, else `ShapeColor`, else `ShapeMaterial`'s diffuse colour.
- **Transparency** 0–1: the `Transparency` percent, or the appearance's own
  value when the colour came from it.

## Final shapes

`finalShapes(doc)` (ADR-0144 decision 7): the shapes the author sees as the
result. Only `Shape` properties count (never `AddSubShape`, `SuppressedShape`
or a sketch's `InternalShape`).

An object **consumes** every object its link properties name (`Base`, `Tool`,
`Shapes`, `Profile`, `BaseFeature`, `Support`, `ExternalGeometry` …), except
through `Group`, `Model`, `Origin`, `OriginFeatures`, `Tip`, expressions and
XLinks; and except objects that never consume (folders, parts, origins,
assemblies, link groups, links, drawings, analyses, spreadsheets). Then, in
document order:

1. each `PartDesign::Body` nothing consumes: the body's own shape;
2. each other PartDesign object (not a datum) outside every body that nothing
   consumes: the tip of a chain in a file from before bodies;
3. each `App::Link`: one instance of its target (through further links, at
   most 32), placed as the link says;
4. each `Mesh::Feature` nothing consumes;
5. each other object outside the families that never hold a final shape
   (sketches, `App::`, spreadsheets, drawings, analyses) that nothing consumes
   and whose stored shape has a solid.

Visibility doesn't select: a hidden final shape is returned with `visible:
false`. Each final shape comes with its name (the label), colour, the entry
with its geometry and its **placement chain**: the containers' placements
outermost first, and for a link its own placement followed, when it replaces
the target's, by the inverse of the target's. Container loops and link
cycles end the walk with a problem.

On the library: 383 final shapes (35 bodies, 14 chain tips, 236 other
shapes, 13 links, 85 meshes; 27 hidden), the same per file as the
investigation's count, against 1,784 stored shapes.

## Sketches

A `Sketcher::SketchObject` holds its curves in `Geometry` (a
`GeometryList` of `Geometry` records) and its constraints in `Constraints`
(a `ConstraintList` of `Constrain` records). `sketch-decode.ts` reads both;
the rest of the package works from that typed form.

**Frame.** Coordinates are in the sketch's own frame, millimetres; the
curves lie in its plane (Z is 0, and a conic's normal is ±Z; a record with
any other normal is not read). The frame is the stored `Placement`, which
FreeCAD always writes as the attacher's result at save time, in the
coordinates of the sketch's container. Containers that move what they hold
(a body, a part, an origin, a coordinate system, a PartDesign boolean, an
assembly) apply their own placements outside it, outermost first; plain
folders don't. On the library the stored placement equals FreeCAD 1.1's
loaded one for 219 of 221 sketches (within the 1e-6 rounding of FreeCAD's
numbers); the other two are 0.14 sketches on an origin plane's back side,
which FreeCAD 1.1 attaches again without the flip. No support face needs
to be looked up to place a sketch.

**Geometry records.** `Geometry@type` names the curve; its curve element
holds the numbers:

| Type | Element and attributes | Point positions |
|---|---|---|
| `Part::GeomLineSegment` | `LineSegment` `StartX/Y/Z`, `EndX/Y/Z` | 1 start, 2 end |
| `Part::GeomCircle` | `Circle` `CenterX/Y/Z`, `NormalX/Y/Z`, `AngleXU` (0.17+), `Radius` | 3 centre |
| `Part::GeomArcOfCircle` | `ArcOfCircle` as a circle plus `StartAngle`, `EndAngle` (radians, end > start, may pass 2π) | 1, 2 ends, 3 centre |
| `Part::GeomPoint` | `GeomPoint` `X/Y/Z` | 1 the point |
| `Part::GeomBSplineCurve` | `BSplineCurve` `PolesCount`, `KnotsCount`, `Degree`, `IsPeriodic`; `Pole X/Y/Z Weight` per pole; `Knot Value Mult` per distinct knot (values as stored, not from 0 to 1) | 1 first, 2 last pole |
| `Part::GeomEllipse`, `Part::GeomArcOfEllipse` | `Ellipse` / `ArcOfEllipse` `CenterX/Y/Z`, `NormalX/Y/Z`, `MajorRadius`, `MinorRadius`, `AngleXU` (the major axis), arcs `StartAngle`, `EndAngle` (eccentric anomaly) | |

A conic's own frame is X turned by `AngleXU` about its normal; a normal
pointing down (−Z) reverses X, so the curve runs clockwise in the sketch.
An arc's point positions 1 and 2 are its counter-clockwise start and end in
the sketch, whatever the normal: with a downward normal the stored start
angle gives position 2. Every circle and arc in the library has an upward
normal.

**Construction and helper geometry.** Up to 0.18 the only flag is a
`<Construction value="0|1">` element before the curve. From 0.19 a
`GeoExtensions` element holds a `Sketcher::SketchGeometryExtension` whose
`geometryModeFlags` is a bit string, its rightmost character bit 0
(blocked) and the next bit 1 (construction); its `internalGeometryType`
marks helper geometry tied to another curve (9 a B-spline pole circle, 10
a knot point, 1 to 8 and 11 the parts of ellipses, hyperbolas and
parabolas). From 1.0 the old element is written again after the curve, for
old readers (in the library with the extension's value); the extension's
flag is the one to read. The
library's 11 B-splines are all quadratic with three poles of weight 1,
not periodic.

**Constraint records.** `Constrain` attributes: `Type` (below), `Value`
(millimetres, radians for angles), `First`, `Second`, `Third` (geometry
indices: 0 and up the sketch's own, −1 the horizontal axis, −2 the
vertical, −3 and down external geometry, −2000 unused), `FirstPos`,
`SecondPos`, `ThirdPos` (0 the curve, 1 start, 2 end, 3 centre; −1 with
position 1 is the sketch's origin), `Name`, `IsDriving` (0: a reference
dimension; absent before 0.15: 1), `IsActive` (absent: 1),
`IsInVirtualSpace`, label placement, and from 1.1 `ElementIds` /
`ElementPositions` with all elements (the three legacy attributes are still
written and come first), and for type 15 `InternalAlignmentType` and
`InternalAlignmentIndex`. A constraint names geometry by its index in the
list, and an expression names a constraint by its index
(`.Constraints[3]`) or its name (`.Constraints.width`), so an unreadable
record keeps its slot.

| Type | Constraint | Value |
|---|---|---|
| 1 | Coincident (two points) | |
| 2, 3 | Horizontal, Vertical (a line, or two points) | |
| 4 | Parallel | |
| 5 | Tangent: two curves; a point and a curve; two ends (a joint); via a third point | an encoded angle at a joint (±π/2, 0 undecided) |
| 6 | Distance: a line's length, an arc's length, two points, a point and a line | mm, ≥ 0 |
| 7, 8 | DistanceX, DistanceY: a line (end − start), a point alone (its coordinate), two points (second − first) | mm, signed |
| 9 | Angle: a line from +X, an arc's sweep, two lines (counter-clockwise from the first), two lines from given ends, via a point | radians, signed |
| 10 | Perpendicular (two curves, at a joint, via a point) | |
| 11, 18 | Radius, Diameter | mm |
| 12 | Equal (lengths, radii) | |
| 13 | Point on object | |
| 14 | Symmetric: two points about a line (third position 0) or about a point | |
| 15 | Internal alignment (helper geometry to its curve) | |
| 16 | Snell's law | ratio |
| 17 | Block | |
| 19 | Weight (a B-spline pole) | |

**Limits** (`sketch-decode.ts`, set from the library with room): 10,000
curves per sketch (the library's largest has 28), 20,000 constraints (71),
1,000 poles per B-spline (3). A sketch over a limit is not decoded.

## Not read yet

- Sketches: external geometry (`ExternalGeometry`, `ExternalGeo`), `MapMode`
  and the attachment (the stored placement is enough), the 1.1 n-ary element
  lists past the first three, geometry ids and layers.
- Mesh kernels, colour lists past the first entry, vector/float/placement
  list entries, the 1.0 element maps and string hasher, thumbnails.
- Link arrays (`ElementCount`, `PlacementList`, `LinkElement`s) and links to
  other documents: one instance or a problem.
- FreeCAD's binary shape form.
- `ObjectDeps`, `Touched`/`Invalid` beyond the flag, the recompute log, the
  camera.
