# The `.extrudo` file format

Specification of format version **1**, for people who write tools that read or
write Extrudo projects, and for us. It is derived from the zod schema in
`packages/core/src/` (the schema is normative; if this text and the schema
disagree, the schema wins and this text has a bug) and from the archive code
in `packages/storage/src/archive.ts`.
`packages/storage/src/file-format-doc.test.ts` keeps it honest: it validates
the example in section 9 against the real schema and fails when a document
key, feature type, feature input, sketch entity, constraint or dimension type,
reference kind or unit is missing from this text.

**License:** this specification is under the **MIT license** (the text is in
[`file-format.LICENSE`](file-format.LICENSE), the same as for `packages/io`),
so anyone may implement readers and writers of Extrudo files, in any license.
The rest of Extrudo is GPL-3.0-or-later.

Conventions: "must" and "may" are meant in the RFC sense. Numbers are JSON
numbers (IEEE doubles). Lengths are millimetres and angles degrees wherever a
plain number is stored (only sketch coordinates and radii; every other number
is an expression string). An "ID" is a non-empty string.

Contents: 1 Overview, 2 The container, 3 Versioning and migrations, 4 The
document, 5 Expressions and parameters, 6 Features, 7 Sketch data,
8 References, 9 Example, 10 IDs, determinism and what is derived.

---

## 1. Overview

An Extrudo project is a **parametric history**, not a shape. The file stores
what the user did (sketches, feature inputs, expressions, parameters, the
order of features) as JSON. Solids, meshes, sketch profiles, faces and their
names are **derived** by the geometry kernel every time the document is
opened or edited; they are never stored (section 10). STEP, STL and 3MF are
*exports*; a tool that wants the editable model reads this format.

Two layers:

- the **document** (`document.json`, section 4 onwards): the model, as JSON;
- the **container** (`.extrudo`, section 2): a zip that holds the document
  plus a manifest, a thumbnail and saved versions.

## 2. The container

A `.extrudo` file is a standard **zip archive** (PKZIP, no encryption, no
multi-disk, no zip64 needed for realistic sizes). Entry names use `/`, are
case sensitive and have no leading `/`. JSON entries are UTF-8, without a byte
order mark. The writer (fflate `zipSync`) pretty-prints JSON with two-space
indentation and a trailing newline and deflates entries at the default level;
readers must accept any valid JSON formatting and any zip compression method
that common zip libraries support (stored or deflate).

| Entry | Required | Content |
|---|---|---|
| `manifest.json` | yes | A small JSON object identifying the file (section 2.1). |
| `document.json` | yes | The document (section 4). |
| `thumbnail.png` | no | A PNG preview; the app writes 256 x 256. Stored uncompressed (already compressed). |
| `versions/index.json` | no | `{ "versions": [ VersionSummary… ] }` (section 2.2). Written only when there is at least one version. |
| `versions/<n>.json` | one per index entry | The complete document as it was when version `n` was saved. Same schema as `document.json`. |

Reserved for later, not written or read by format version 1:
`attachments/` (fonts, canvas images, imported geometry that features refer
to) and `cache/` (kernel-derived data that a reader may drop). A reader must
**ignore any entry it does not know**, including these; a writer that copies a
file it edited should keep unknown entries when it can.

### 2.1 `manifest.json`

| Field | Type | Meaning |
|---|---|---|
| `format` | `"extrudo"` | Required. The file is refused ("not an Extrudo project") unless this is exactly the string `extrudo`. |
| `formatVersion` | integer | Required. The format version the writer used (currently 1). A file without an integer here is refused as damaged. A reader migrates by `document.json`'s own `formatVersion`, but treats the file as newer when either number is above what it knows (section 3). |
| `appVersion` | string | Version of the app that wrote the file (copy of `meta.appVersion`). |
| `created` | ISO 8601 string | Copy of `meta.created`. |
| `units` | `mm`, `cm`, `m` or `in` | Copy of `settings.units`. |

The manifest lets a file browser show a project without parsing the document.
`format` and `formatVersion` are checked when reading; unknown manifest fields
are ignored.

### 2.2 `versions/index.json`

`{ "versions": [ … ], "next": 4 }`, versions oldest first. `next` (optional
integer, since P3-13) is the number the next version gets: versions can be
deleted, and numbers are never given out twice. Without it (older files) the
next number is one past the highest listed. Each element:

| Field | Type | Meaning |
|---|---|---|
| `number` | integer, at least 1 | 1, 2, 3, ... in the order saved ("V3"); gaps where versions were deleted. Names the entry `versions/<number>.json`. |
| `description` | string | What the person saving it wrote; may be empty. |
| `created` | ISO 8601 string | When the version was saved. |
| `name` | string | The project's name then. |

A reader drops index elements that are not well formed and sorts the rest by
`number`. The index itself being unreadable, or a listed `versions/<n>.json`
missing or not valid JSON, makes the file *damaged*. Each version document
goes through the same loading pipeline as `document.json`
(section 3), so an old file's versions are migrated too. A version keeps the
project's `id` (restoring it does not change the ID; opening it as a copy
gives it a new one).

### 2.3 Import rules (the reference reader)

1. Unzip. Not a zip: error `not-a-zip`.
2. `manifest.json` missing, unparsable, or `format` not `extrudo`: error
   `not-extrudo`. No integer `formatVersion`: error `damaged`.
3. `document.json` missing or not JSON: error `damaged`.
4. Load `document.json` through the pipeline of section 3 (may fail with
   `not-a-document`, `too-new`, `invalid`). The file counts as newer when the
   manifest's or the document's `formatVersion` is newer than the reader's.
5. Read the thumbnail and the versions if present.
6. When the project's `id` is already in the reader's store, the app imports
   the file as a **copy** with a new ID rather than overwriting.

---

## 3. Versioning and migrations

`document.json` carries `format` (always `"extrudo"`) and `formatVersion` (an
integer; the current one is **1**). The rules:

- **Breaking changes bump `formatVersion`.** A breaking change is anything
  but adding an *optional* field: removing or renaming a field, changing a
  type or meaning, making an optional field required, tightening a
  constraint.
- **Additive changes do not bump it**: new optional fields (`unit` on
  expression inputs, `bodies[..].opacity`, `visible`, a sketch's
  `projections`, a reference's `fingerprint` were all added this way), and new
  feature types (`Feature.type` is an open string).
- **Objects are strict, reading is lenient.** Every object in the schema
  names the keys it doesn't know, and the reader **leaves them out** and
  tells the user (since P3-13; before, a file with an optional field added
  after the reader was built was refused like a typo). So an older reader
  opens a newer file of the same version, losing only what it doesn't know.
  The same holds for a feature's input names: the recompute ignores an input
  its feature type doesn't define and marks the feature with a warning
  ("This version of Extrudo doesn't know the input…"). Writers of other
  tools must not add private keys to the document all the same: a reader
  drops them, and there is no `extensions` bag in format 1.
- **Reading a document** (`loadDocument`):
  1. The value must be an object with `format === "extrudo"` and an integer
     `formatVersion`, else `not-a-document`.
  2. `formatVersion` greater than the reader's known version: the reader
     tries to read it **as its own version**, leaving out unknown keys. If
     that validates, the document opens and the user is told it came from a
     newer Extrudo and what was left out (`loadNotice`); if anything else
     fails (a changed type or shape), the error is `too-new` ("saved by a
     newer Extrudo… Update Extrudo to open it"), with the issues. Opening an
     imported file this way never changes the file (the project is a copy);
     a stored project opened this way is written back in the reader's
     version when it is saved, which the notice says. The app keeps no
     read-only mode.
  3. Otherwise the raw JSON is copied and migrated one step at a time
     (`from → from + 1`) until it is at the current version. Migrations work
     on raw JSON and never on the current types, are pure, and get their IDs
     and timestamps from the caller so they can be tested.
  4. The result is validated against the current schema (section 4 onwards),
     leaving out unknown keys as above (`LoadResult.dropped` lists their
     paths, like `features.0.inputs.distance.tolerance`); any other failure is
     `invalid` ("the document is damaged") with the list of issues.
- **Writing** always writes the current version; a file read at an older
  version is saved back at the current one.
- **Version 0** is a draft shape from before the v1 schema (top-level
  `units`, parameters without IDs, `disabled` instead of `suppressed`,
  sketch lists as arrays). No release ever wrote it; it exists so the
  migration chain has a first step and a fixture
  (`packages/core/fixtures/v0-bracket.json`). A third-party writer should
  write version 1.

---

## 4. The document

`document.json` is one JSON object. Every object below is **strict**: the
schema names unknown keys, and a reader leaves them out (section 3).
"Required" means the key must be present.

| Key | Type | Required | Meaning and constraints |
|---|---|---|---|
| `format` | `"extrudo"` | yes | Literal. |
| `formatVersion` | `1` | yes | Literal 1 in this specification. |
| `id` | ID | yes | The project's identity (a UUID v4 from `crypto.randomUUID()` in practice; any non-empty string is accepted). Names the project in storage. |
| `name` | string | yes | Non-empty. Shown in the app bar and the home screen. |
| `settings` | object | yes | Section 4.1. |
| `parameters` | array of Parameter | yes | User parameters (section 5.1). May be empty. |
| `features` | array of Feature | yes | **The timeline**, in order (section 6). May be empty. |
| `timelineMarker` | integer | yes | At least 0 and at most `features.length`. The number of *active* features: the feature at index `i >= timelineMarker` is rolled back (not evaluated). `features.length` means everything is active. |
| `bodies` | object | yes | Record from body ID to `BodyMeta` (section 4.2). May be empty. Keys are IDs the kernel makes (section 10). |
| `views` | array of NamedView | yes | Saved camera views (section 4.3). May be empty. |
| `meta` | object | yes | Section 4.4. |

Whole-document rules (checked after the per-field rules):

- `timelineMarker` must not exceed `features.length`.
- Feature `id`s are unique; parameter `id`s are unique; parameter `name`s are
  unique; view `id`s are unique. (Names are compared exactly, case
  sensitively.)
- Each feature's `inputs` is additionally checked per feature `type`
  (section 6); the document schema alone only knows the generic input shapes.

### 4.1 `settings`

| Field | Type | Required | Meaning |
|---|---|---|---|
| `units` | `"mm"`, `"cm"`, `"m"`, `"in"` | yes | The document's **length unit**: what a plain number in a length field means, and what the app displays. Stored lengths in sketches are always mm regardless. |
| `precision` | integer 0 to 8 | yes | Decimal places shown for lengths and angles. A new document uses 2. |

### 4.2 `bodies[<bodyId>]` (BodyMeta)

Name, appearance and visibility of a body. The **geometry is derived**;
this record only holds what the user chose. A body appears here after the
first recompute that produces it.

| Field | Type | Required | Meaning |
|---|---|---|---|
| `name` | string | yes | Non-empty. Defaults are `Body1`, `Body2`, ... and are never reused. |
| `color` | string `#rrggbb` | no | Six hex digits (either case): a swatch or any custom colour (the app writes lower case). Absent: the theme's default body colour. |
| `opacity` | number 0.1 to 1 | no | Absent: opaque. |
| `visible` | boolean | yes | Whether the body is drawn. |

Entries whose body no longer exists are harmless; a body without an entry
gets one at the next recompute.

### 4.3 `views[]` (NamedView)

| Field | Type | Required | Meaning |
|---|---|---|---|
| `id` | ID | yes | Unique among views. |
| `name` | string | yes | Non-empty. |
| `camera` | object | yes | `projection` (`"perspective"` or `"orthographic"`), `position`, `target`, `up`: each of the last three is a `[x, y, z]` array of three numbers, in world millimetres. The world is **Z up**. |

### 4.4 `meta`

| Field | Type | Required | Meaning |
|---|---|---|---|
| `created` | ISO 8601 datetime string | yes | When the project was created. Must satisfy zod's `z.iso.datetime()` (UTC `Z` suffix, e.g. `2026-09-29T10:00:00.000Z`). |
| `modified` | ISO 8601 datetime string | yes | Set by storage when it saves, not by editing commands (so undo does not touch it). |
| `appVersion` | string | yes | The writer's version, for diagnostics. |

---

## 5. Expressions and parameters

**Every number a user can edit is an expression string** (never a raw number
in a feature input). Sketch coordinates and radii are the only stored plain
numbers, and they are the *solved* values.

### 5.1 `parameters[]` (Parameter)

User parameters, the named values of the parameters table.

| Field | Type | Required | Meaning |
|---|---|---|---|
| `id` | ID | yes | Unique among parameters. |
| `name` | string | yes | Must match `^[A-Za-z_][A-Za-z0-9_]*$` and be unique. See the extra rules below. |
| `expression` | string | yes | An expression (section 5.2), for example `2 mm` or `width / 2`. |
| `unit` | `"length"`, `"angle"` or `"unitless"` | yes | The *kind* the expression must evaluate to. |
| `comment` | string | no | Free text. |

Rules that the *evaluator* enforces but the schema does not: a name must not be
a **reserved word** (a unit `mm cm m in ft deg rad`, a function name, or
`pi`); a user parameter's name must not equal a model parameter's
`paramName` (below). Parameters may refer to each other in any order (the
list order is not evaluation order); a **cycle** is an error reported on
every parameter in it. All parameters and model parameters share **one
namespace**.

### 5.2 Expression language (summary of ADR-0004)

- **Atoms:** a number with an optional unit (`10 mm`, `2.5in`, `1e-3 m`); a
  name (a parameter); a call `name(args)`; a parenthesised expression.
- **Operators**, loosest to tightest: `+ -` (binary), `* /`, unary `+ -`,
  `^` (right-associative, so `-2^2 = -4` and `2^3^2 = 512`). There is **no
  implicit multiplication** (`2 width` is an error).
- **Units:** `mm cm m in ft deg rad`. A unit may only follow a number
  literal. Values are held in millimetres and degrees.
- **Constant:** `pi`. **Functions:** `sin cos tan asin acos atan sqrt abs min
  max round floor ceil`. `min` and `max` take one or more arguments, the rest
  one.
- **Dimensions:** length and angle are separate dimensions, so `10 mm + 5 deg`
  is an error. Intermediate results may be areas or volumes; the final result
  must be what the field needs.
- **Plain numbers take the context unit.** A bare literal (or arithmetic on
  literals only) in a length field means the document's length unit
  (`settings.units`), in an angle field degrees. A unitless *parameter* in a
  length field is an error; multiply by a unit.
- **Trigonometry** takes an angle; a bare number counts as degrees, a non-bare
  unitless value as radians.
- Whitespace is insignificant. Names are case sensitive.

Expression fields are stored verbatim as the user typed them (formatting
included), so a tool that only reads geometry values should evaluate them,
not parse them ad hoc.

### 5.3 Model parameters

A feature input or sketch dimension may expose its value as a **model
parameter**: its `paramName` (`d1`, `d2`, ...). It then takes part in the
same namespace as user parameters, so other expressions can use it. The
schema requires only that a `paramName` match the name regex; uniqueness and
non-collision with user parameters and reserved words are the evaluator's job.

---

## 6. Features

`features[]` is the timeline. Each element (Feature):

| Field | Type | Required | Meaning |
|---|---|---|---|
| `id` | ID | yes | Unique among features, permanent. |
| `type` | string | yes | Non-empty. One of the types below; the schema accepts any string, so a document with an unknown type *loads* and the app reports that feature as an error. A tool should preserve features it does not understand. |
| `name` | string | yes | Non-empty; the user's name ("Extrude1"). |
| `suppressed` | boolean | yes | `true`: the feature is skipped, as if not there (its dependants report errors). |
| `visible` | boolean | no | `false` hides the feature's *own* geometry (a sketch's curves) in the view. Absent: shown. |
| `inputs` | object | yes | Record from input name to an **Input** (below). Which names are allowed depends on `type`. |

**Order matters.** A feature can only use things made by features *before* it.
A feature depends on those whose IDs appear in its stored references
(profiles, bodies, face/edge names), and the app refuses to move a feature
before something it uses. Expressions do not order features.

### 6.1 Inputs

`inputs[<name>]` is an object with a `kind` discriminator:

| `kind` | Other fields | Meaning |
|---|---|---|
| `expr` | `expr` (string, required); `paramName` (string matching the name regex, optional); `unit` (`length`, `angle` or `unitless`, optional, default `length`) | A number as an expression. `paramName` makes it a model parameter (section 5.3). `unit` says what it must evaluate to. **An angle input must say `"unit": "angle"`**: the feature schemas reject an `expr` whose `unit` (default `length`) is not the one the input takes. |
| `enum` | `value` (string) | One choice from a fixed list; the allowed values depend on the feature and input. |
| `bool` | `value` (boolean) | A flag. |
| `ref` | `refs` (array of GeomRef, required, may be empty) | Persistent references to geometry (section 8). |
| `sketchData` | `sketch` (SketchData, required) | A sketch's 2D content (section 7). Only the `sketch` feature uses it. |

Feature-specific rules below are enforced by the per-type inputs schema (each
inputs object is strict too: the recompute ignores unknown input names with
a warning, section 3). "Optional"
inputs may be absent; the default is what a reader must assume.

### 6.2 `sketch`

A sketch on a plane or a flat face (label "Sketch", category sketch).

| Input | Kind | Required | Rule |
|---|---|---|---|
| `plane` | `ref` | yes | Exactly one reference, of kind `plane` (an origin plane `origin:xy`, `origin:xz`, `origin:yz`, or a construction plane's feature ID, 6.10) or `face`. |
| `sketch` | `sketchData` | yes | The sketch content (section 7). |

A sketch's 2D frame (origin, X, Y, normal) is *derived*: for an origin plane
it is fixed (below); for a face it is computed from the face's plane and
reported by the kernel.

| Plane | X | Y | Normal |
|---|---|---|---|
| `origin:xy` | (1, 0, 0) | (0, 1, 0) | (0, 0, 1) |
| `origin:xz` | (1, 0, 0) | (0, 0, 1) | (0, -1, 0) |
| `origin:yz` | (0, 1, 0) | (0, 0, 1) | (1, 0, 0) |

All three have their origin at the world origin.

### 6.3 Shared pieces of solid features

The four **body operations** (`operation`, an `enum` input): `new-body`
(default), `join`, `cut`, `intersect`. `bodies` (a `ref` input of kind `body`
references, body IDs) chooses the participants of `join`, `cut` and
`intersect`; absent or empty means every body the new solid touches (join) or
overlaps (cut, intersect). A feature that yields several separate solids
makes one body per solid.

Reading conventions for all solid features: inputs the chosen mode does not use
are ignored but may be kept (so a dialog can switch back and forth); a length
`expr` input must have `unit` absent or `length`; an angle one must have
`"unit": "angle"`.

### 6.4 `extrude`

Sweeps sketch profiles or flat faces straight along their plane's normal.
Every input is optional in the schema; a useful extrude has `profiles` and
`distance` (without `profiles` the feature fails in the kernel).

| Input | Kind | Rule | Default and meaning |
|---|---|---|---|
| `profiles` | `ref` | Refs of kind `profile` or `face`, any number, all in one plane | none: the feature fails until some are picked |
| `direction` | `enum` | `one-side`, `symmetric`, `two-sides` | `one-side`. Symmetric is centred on the plane and `distance` is the whole length; two-sides uses side 2 inputs too |
| `extent` | `enum` | `distance`, `to-object`, `through-all` | `distance` (side 1) |
| `distance` | `expr` length | | Side 1's length; negative goes the other way |
| `toObject` | `ref` | At most one ref of kind `face`, `vertex` or `plane` | Side 1's target for `to-object` |
| `taper` | `expr` angle | | Side 1's taper, default 0. Positive widens along the sweep, negative narrows |
| `extent2` | `enum` | as `extent` | Side 2 of `two-sides` |
| `distance2` | `expr` length | | Side 2's length |
| `toObject2` | `ref` | as `toObject` | Side 2's target |
| `taper2` | `expr` angle | | Side 2's taper |
| `flip` | `bool` | | Reverses the direction, default false |
| `operation` | `enum` | section 6.3 | `new-body` |
| `bodies` | `ref` | body refs | section 6.3 |

### 6.5 `revolve`

Turns profiles or flat faces about an axis in their plane. Optional inputs as
for extrude; a useful revolve has `profiles` and `axis`.

| Input | Kind | Rule | Default and meaning |
|---|---|---|---|
| `profiles` | `ref` | refs of kind `profile` or `face` | none: fails until picked |
| `axis` | `ref` | At most one ref of kind `axis` (`origin:x`, `origin:y`, `origin:z`), `sketchEntity` (`<sketch>/<line>`) or `edge` (a straight edge) | none: fails until picked. Must lie in the profiles' plane |
| `direction` | `enum` | `one-side`, `symmetric`, `two-sides` | `one-side` |
| `angle` | `expr` angle | | Side 1 (the whole angle when symmetric); default a full turn, `360 deg` (no end faces). Right-handed about the axis. Negative turns the other way |
| `angle2` | `expr` angle | | Side 2 of `two-sides`, the other way round; default 0 |
| `flip` | `bool` | | Turns side 1 the other way, default false |
| `operation` | `enum` | section 6.3 | `new-body` |
| `bodies` | `ref` | body refs | section 6.3 |

### 6.6 Primitives: `box`, `cylinder`, `sphere`, `torus`

Four feature types with one input set for placement and one for size. Every
input is optional; the minimal feature has `"inputs": {}` (a 20 mm cube, new
body, on the XY plane at the origin).

**Placement (all four):**

| Input | Kind | Rule | Default and meaning |
|---|---|---|---|
| `plane` | `ref` | At most one ref of kind `plane` or `face` | The XY plane (`origin:xy`) |
| `x` | `expr` length | | 0. The primitive's centre along the plane frame's X |
| `y` | `expr` length | | 0. Along the frame's Y |
| `offset` | `expr` length | | 0. Lifts the base (a sphere's or torus's centre) off the plane along its normal |
| `operation` | `enum` | section 6.3 | `new-body` |
| `bodies` | `ref` | body refs | section 6.3 |

**Sizes:**

| Type | Input | Default | Meaning |
|---|---|---|---|
| `box` | `length` | 20 mm | Along the frame's X (turned by `rotation`); must be greater than 0 |
| `box` | `width` | 20 mm | Along the frame's Y; greater than 0 |
| `box` | `height` | 20 mm | Along the normal from the base; negative goes below the plane |
| `box` | `rotation` (`expr` angle) | 0 deg | Turns the box about the normal through its centre, right-handed, from the frame's X |
| `cylinder` | `diameter` | 20 mm | Base centred on the point; greater than 0 |
| `cylinder` | `height` | 20 mm | As the box's height |
| `sphere` | `diameter` | 20 mm | Centred on the point; greater than 0 |
| `torus` | `diameter` | 40 mm | Through the tube's centre line; greater than 0 |
| `torus` | `tube` | 10 mm | The tube's own diameter, smaller than `diameter` |

The size sign rules ("greater than 0") are checked by the kernel when the
value is known, not by the schema, since values are expressions.

### 6.7 `remove`

Takes bodies out of the model without touching the features that made them.

| Input | Kind | Required | Rule |
|---|---|---|---|
| `bodies` | `ref` | yes | One or more refs, all of kind `body` (body IDs). |

Rolling the timeline back past it, suppressing it or deleting it brings the
bodies back.

### 6.8 `fillet`

Rounds edges of a body with a constant radius (P3-01). A fillet has up to
8 **edge sets**, each with its own radius: set 1 is `edges` + `radius`,
set `n` is `edges<n>` + `radius<n>` (`edges2`, `radius2`, ..., `edges8`,
`radius8`). Every input is optional.

| Input | Kind | Rule |
|---|---|---|
| `edges`, `edges2` ... `edges8` | `ref` | Refs of kind `edge` (persistent edge names, section 8); a set with no edges is ignored |
| `radius`, `radius2` ... `radius8` | `expr` | Length; greater than 0 when the kernel evaluates it (not checked by the schema); a set with edges needs its radius |

The kernel rounds the whole chain of tangent-continuous edges around each
edge you name, with one radius, so edges of one chain must share a radius
(two sets that reach one chain with different radii fail). Edges of
different bodies are rounded body by body. The faces it makes are named
`fillet:<feature id>:from:(<edge name>)`. No new keys: a fillet is a
feature with `ref` and `expr` inputs like the others.

### 6.9 `chamfer`

Bevels edges of a body (P3-02). Like a fillet it has up to 8 **edge sets**,
and each set has its **own type and values**. The names of set 1 are plain,
set `n` appends its number: `edges`, `mode`, `distance`, `distanceB`,
`angle`, `flip`, then `edges2`, `mode2`, `distance2`, `distanceB2`,
`angle2`, `flip2`, ..., up to `edges8` ... `flip8`. Every input is optional.

| Input | Kind | Rule |
|---|---|---|
| `edges`, `edges2` ... `edges8` | `ref` | Refs of kind `edge` (persistent edge names, section 8); a set with no edges is ignored |
| `mode`, `mode2` ... | `enum` | `equal` (default), `two-distances` or `distance-angle` |
| `distance`, `distance2` ... | `expr` | Length, greater than 0 when the kernel evaluates it (not checked by the schema); needed by every type |
| `distanceB`, `distanceB2` ... | `expr` | Length: the second distance of `two-distances` |
| `angle`, `angle2` ... | `expr` | Angle, between 0 and 90 deg (exclusive) when evaluated: the angle of `distance-angle` |
| `flip`, `flip2` ... | `bool` | Swaps which of the edge's two faces takes `distance`, for `two-distances` and `distance-angle` (default false) |

`equal` puts the chamfer `distance` from the edge on both faces.
`two-distances` puts `distance` on the set's first face and `distanceB` on
the other; the first face is the lower-numbered of the two faces around the
edge in the kernel's face order (the first edge of a chain of tangent edges
decides for the chain). `distance-angle` puts `distance` on the first face,
with the chamfer at `angle` to that face (45 deg is the equal chamfer). As
in a fillet, the kernel bevels the whole chain of tangent-continuous edges
around each edge you name, with one setting, so edges of one chain must
share their set's type and values. Edges of different bodies are bevelled
body by body. The faces it makes are named
`chamfer:<feature id>:from:(<edge name>)`. No new keys: a chamfer is a
feature with `ref`, `enum`, `expr` and `bool` inputs like the others.

### 6.10 Construction features

Nine feature types (category construct) make no body: each makes a plane, an
axis or a point that later features refer to (section 8: a reference of kind
`plane`, `axis` or `point` whose `id` is the *feature's ID*). Every input is
optional in the schema (a missing pick is an error the kernel reports), and
every reference input takes at most the count shown.

| Type | Makes | Inputs |
|---|---|---|
| `offsetPlane` | plane | `plane` (`ref`, one of kind `plane` or `face`); `distance` (`expr` length, default 0): along the plane's normal (a face's outward one) |
| `planeAtAngle` | plane | `axis` (`ref`, one of kind `axis`, `edge` or `sketchEntity`: the line the plane turns about); `plane` (`ref`, one `plane` or `face`: where the angle counts from; without it 0 deg is the plane through the line whose normal is as vertical as possible); `angle` (`expr` angle, default 0, right-handed about the line) |
| `midplane` | plane | `planes` (`ref`, two of kind `plane` or `face`, parallel): the plane halfway between |
| `planeThroughPoints` | plane | `points` (`ref`, three of kind `point` or `vertex`, not on one line); the normal follows their order (right-handed) |
| `tangentPlane` | plane | `face` (`ref`, one `face`: cylindrical, conical or spherical); `plane` (`ref`, one `plane` or `face`: says where round the face it touches, by its normal); `angle` (`expr` angle, default 0: turns the touching point about the face's axis) |
| `axisThroughPoints` | axis | `points` (`ref`, two different points of kind `point` or `vertex`): from the first to the second |
| `axisThroughCylinder` | axis | `face` (`ref`, one `face`: cylindrical, conical, toroidal or of revolution): the face's own axis |
| `axisAlongEdge` | axis | `edge` (`ref`, one of kind `edge` or `sketchEntity`): a straight edge or sketch line, or a circular edge's axis through its centre |
| `constructionPoint` | point | `at` (`ref`, one of kind `point`, `vertex`, `edge` or `face`: a circular edge gives its centre, another edge its middle, a face its centre; without it the origin); `x`, `y`, `z` (`expr` length, default 0): moves it along the world axes |

A plane's 2D frame is derived from the plane alone, by the rule of a sketch on
a flat face (6.2), so a sketch or primitive on a construction plane follows
it. The kernel computes and reports everything; nothing but the inputs is
stored. A feature that uses a construction feature must come after it in the
timeline, and deleting one that is used is refused (section 8).

### 6.11 `combine`

Joins, cuts or intersects a target body with tool bodies (P3-06).

| Input | Kind | Required | Rule |
|---|---|---|---|
| `target` | `ref` | yes | At most one ref, of kind `body` (a body ID). Empty: the kernel reports "Pick the target body." |
| `tools` | `ref` | yes | Refs of kind `body`. Empty: an error until some are picked |
| `operation` | `enum` | no | `join` (default), `cut` or `intersect` |
| `keepTools` | `bool` | no | Default `false`: the tool bodies are used up |

The result keeps the target's body ID, name and colour; the tools leave the
body set unless `keepTools`. `join` needs every tool to touch the target (or a
tool that does); `cut` and `intersect` fail with a message when nothing would
change or nothing would be left. A result of several separate solids becomes
one body per solid (`<feature id>:<n>`). Faces keep the names of the target
and of the tools' faces that end up in the result (section 8).

### 6.12 `move`

Moves or turns bodies, optionally as copies (P3-06). Every input but `bodies`
is optional and defaults to "no move".

| Input | Kind | Rule |
|---|---|---|
| `bodies` | `ref` | Refs of kind `body`. Empty: an error until some are picked |
| `mode` | `enum` | `free` (default), `rotate` or `point-to-point` |
| `dx`, `dy`, `dz` | `expr` | Length. `free`: the move along the world axes, after the turns |
| `rx`, `ry`, `rz` | `expr` | Angle. `free`: turns about the world X, Y and Z axes through the centre of the bodies' bounding box, in that order |
| `axis` | `ref` | At most one ref of kind `axis`, `edge` or `sketchEntity`. `rotate`: the axis to turn about |
| `angle` | `expr` | Angle. `rotate`: right-handed about the axis |
| `from`, `to` | `ref` | At most one ref each, of kind `vertex` or `point`. `point-to-point`: the bodies move by the vector from `from` to `to` |
| `copy` | `bool` | Default `false`. `true`: the bodies stay and moved copies are new bodies `<feature id>:<n>`, in the order of `bodies` |

A move keeps the body IDs, so references to the moved bodies and to their
faces still resolve. A copy's faces are named
`move:<feature id>:from:(<the original face's name>)`, so a reference means one
body. Fields of the other modes are not stored.

### 6.13 `mirror`

Mirrors bodies, or features, about a plane (P3-06, features in P3-07).

| Input | Kind | Required | Rule |
|---|---|---|---|
| `objects` | `enum` | no | `bodies` (default) or `features`: what is mirrored |
| `bodies` | `ref` | with `bodies` | Refs of kind `body`. Empty or missing: an error until some are picked |
| `features` | `ref` | with `features` | Refs of kind `feature`: the features whose tools are mirrored (6.16) |
| `plane` | `ref` | yes | At most one ref, of kind `plane` (an origin or construction plane) or a flat `face` |
| `copy` | `bool` | no | Bodies only. Default `true`: the originals stay and the mirrored copies are new bodies `<feature id>:<n>`. `false`: the bodies themselves are mirrored and keep their IDs |
| `join` | `bool` | no | Bodies only; default `false`; only with `copy`. Fuses each copy into its original (which keeps its ID); a copy that doesn't touch it stays a body of its own |

A copy's faces are named `mirror:<feature id>:from:(<the original face's name>)`.
With `features`, the tool of each listed feature is reflected in the plane
and joined or cut like the feature did (6.16 says which features qualify);
`bodies`, `copy` and `join` are ignored.

### 6.14 `shell`

Hollows bodies with walls of a given thickness (P3-03).

| Input | Kind | Required | Rule |
|---|---|---|---|
| `faces` | `ref` | no | Refs of kind `face` (persistent face names, section 8): the faces to remove, the openings. May lie on several bodies |
| `bodies` | `ref` | no | Refs of kind `body` (body IDs): bodies to hollow closed, with no opening. Bodies of the picked faces are shelled anyway |
| `thickness` | `expr` | yes | Length, greater than 0 when the kernel evaluates it (not checked by the schema) |
| `direction` | `enum` | no | `inside` (default) or `outside` |

At least one face or body is needed (the kernel reports it otherwise). Each
body with faces picked is shelled with those faces removed; a body without
any becomes a closed solid with a sealed void. `inside` keeps the body's
outer surface where it is and cuts the cavity into it; `outside` keeps the
surface as the cavity and grows the walls outwards, so the part gets
bigger. The outer skin keeps the faces' names in both directions; the faces
the shell makes are named `shell:<feature id>:inner:(<face name>)` (the
cavity), `shell:<feature id>:rim:(<removed face name>)` (around an opening)
and `shell:<feature id>:round:(<edge or vertex name>)` (a rounded join). A
removed face that runs smoothly into a neighbour (next to a fillet) is
refused. No new keys: a shell is a feature with `ref`, `expr` and `enum`
inputs like the others.

### 6.15 `placeOnBed`

Turns the body a flat face belongs to so that face lies on the build plate
(P3-10); with several faces, each body lies on its own face (P3-17). The
rotation and the move are computed on every recompute, not stored.

| Input | Kind | Required | Rule |
|---|---|---|---|
| `face` | `ref` | yes | Refs of kind `face`, flat faces, at most one per body (two faces of one body are an error). Empty: an error until one is picked. Before P3-17 at most one |
| `spin` | `expr` (angle) | no | A turn about the vertical (+Z) through the face's centre, after the face lies on the bed. Absent: no turn |

Each body is the one its face is in. It turns by the smallest rotation that
makes the face's outward normal point along -Z (about the horizontal axis
`normal x -Z` through the face's centre; a face that faces up turns half a
turn about X), then moves along Z so the face lies at z = 0, then turns by
`spin` (counter-clockwise seen from above) about the vertical through the
face's centre. The X and Y of the face's centre stay where they were. Every
body keeps its ID and every face keeps its name, so references to the body
and its faces still resolve. The feature warns when every face is already on
the bed (and there is no spin), and when part of a body ends up below z = 0.

### 6.16 Patterns: `rectangularPattern`, `circularPattern`, `pathPattern`

Copies of bodies, or repeats of features, in a layout (P3-07, ADR-0047).
The original counts as the first instance: a `count` of 3 makes two new
ones. Three feature types share these inputs:

| Input | Kind | Required | Rule |
|---|---|---|---|
| `objects` | `enum` | no | `bodies` (default) or `features` |
| `bodies` | `ref` | with `bodies` | Refs of kind `body`, each once. Empty or missing: an error until some are picked |
| `features` | `ref` | with `features` | Refs of kind `feature` (`{"kind": "feature", "id": "<feature id>"}`): the features to repeat, in the order they are applied. Each must come earlier in the timeline, be a solid feature that **joins or cuts** (`extrude`, `revolve`, a primitive, a `hole`, which always cuts) and not be suppressed; the pattern depends on it like on any feature it refers to |
| `join` | `bool` | no | Bodies only; default `false`: the copies are new bodies `<feature id>:<n>`. `true`: they are fused into the original body, and a copy that doesn't touch it becomes a body of its own with a warning |

Counts are `expr` inputs of unit `unitless` that must evaluate to a whole
number from 1 up; a pattern makes at most 1000 instances. Distances are
`expr` inputs of unit `length`, angles of unit `angle`.

With `features`, the tool the feature made (the solid it extruded, revolved
or built) is copied to every instance, and one boolean joins it to, or cuts
it from, the bodies it touches. Instances that overlap each other are fused
first.

Names: every face of an instance is named
`pattern:<feature id>:<label>:from:(<the original face's name>)`, where the
label is the instance's position in the layout (`1`, `2`, `m1` for -1,
`1x2` for a grid position), so a reference to a face of one instance keeps
resolving when the counts change. A copy's body ID is `<feature id>:<n>`
with `n` derived from the same position, so it stays too.

#### `rectangularPattern`

| Input | Kind | Required | Rule |
|---|---|---|---|
| `direction1` | `ref` | yes | One ref of kind `axis` (origin or construction), `sketchEntity` (a sketch line) or `edge` (a straight edge). Missing: an error until picked |
| `count1` | `expr` | no | Unitless. Default `2` |
| `distance1` | `expr` | no | Length. Default 20 mm |
| `measure1` | `enum` | no | `spacing` (default: the distance is between neighbours) or `extent` (from the first instance to the last) |
| `symmetric1` | `bool` | no | Default `false`. `true`: the original sits in the middle of the row (for an even count, one place before the middle) |
| `direction2` | `ref` | no | A second direction, as `direction1`, makes a grid; it must not be parallel to the first |
| `count2`, `distance2`, `measure2`, `symmetric2` | as `count1`… | no | The second direction's series (used only with `direction2`) |

#### `circularPattern`

| Input | Kind | Required | Rule |
|---|---|---|---|
| `axis` | `ref` | yes | One ref of kind `axis`, `sketchEntity` or `edge`, as a direction above |
| `count` | `expr` | no | Unitless. Default `3` |
| `angle` | `expr` | no | Angle. Default 360 deg. Right-handed about the axis |
| `measure` | `enum` | no | `total` (default: the angle is the whole spread; a whole turn or more is divided into `count` equal parts, less into `count - 1`) or `step` (the angle between neighbours) |
| `symmetric` | `bool` | no | Default `false`. The original in the middle of the series |

#### `pathPattern`

| Input | Kind | Required | Rule |
|---|---|---|---|
| `path` | `ref` | yes | Refs of kind `sketchEntity` (`<sketch>/<curve>`) and `edge`, chained end to end (the kernel reorders and reverses pieces as they meet); the first is walked in its own direction |
| `count` | `expr` | no | Unitless. Default `3` |
| `distance` | `expr` | no | Length. Default 20 mm |
| `measure` | `enum` | no | `spacing` (default) or `extent`, as above |
| `aligned` | `bool` | no | Default `false`: instances keep the original's orientation. `true`: each turns with the path's direction, about the path's start |
| `flip` | `bool` | no | Default `false`. `true`: walk the path from its other end |

The first instance is taken to sit at the start of the path and the others
move by the way the path went from there. A path shorter than the pattern
needs is an error.

Skipping single instances is not supported yet.

### 6.17 `hole`

Drills holes into the bodies below a plane or a flat face (P3-04, ADR-0049).
It makes no body of its own: it always cuts, like a `cut` operation, and a
pattern or mirror can repeat it as a feature (6.16). Every input is
optional; a minimal hole is `{}`: a 5 mm blind hole, 10 mm deep, in the XY
plane at the origin.

| Input | Kind | Required | Rule |
|---|---|---|---|
| `plane` | `ref` | no | At most one ref, of kind `plane` (an origin or construction plane) or `face` (a flat face). Where the holes start. Missing or empty: the XY plane |
| `points` | `ref` | no | Refs of kind `sketchEntity` naming sketch **points** (`<sketch feature id>/<point id>`, section 8): one hole at each, the point dropped along the plane's normal onto the plane, so a sketch on the face or on a parallel plane both work. Empty or missing: one hole at `x`, `y` |
| `x`, `y` | `expr` | no | Length, default 0. The one hole's place in the plane's sketch frame, the frame a sketch on that plane gets (for a face: the world origin projected onto it, X along world X on faces within 40 degrees of horizontal, else Y up the face, 6.2). Not used with `points` |
| `type` | `enum` | no | `simple` (default), `counterbore` (a wider flat-bottomed step at the top) or `countersink` (a cone at the top) |
| `extent` | `enum` | no | `blind` (default) or `through` (runs past every body along its way) |
| `diameter` | `expr` | no | Length, default 5 mm; greater than 0 |
| `depth` | `expr` | no | Length, default 10 mm. Blind only: from the plane to the end of the full diameter |
| `tipAngle` | `expr` | no | Angle, default 118 deg. Blind only: the drill point's full angle, a cone beyond `depth`; `0 deg` makes a flat bottom; must be under 180 deg |
| `cbDiameter`, `cbDepth` | `expr` | no | Length, defaults 10 mm and 4 mm. Counterbore only: the step's diameter (larger than `diameter`) and its depth from the plane (less than `depth` when blind) |
| `csDiameter`, `csAngle` | `expr` | no | Length default 10 mm, angle default 90 deg. Countersink only: the cone's diameter at the plane (larger than `diameter`) and its full opening angle (between 0 and 180 deg) |
| `flip` | `bool` | no | Default `false`. The holes go against the plane's normal: into a face (whose normal points out of the body), down from an origin plane. `true` reverses that |

Holes are solids of revolution about their axis, cut from every body they
touch. The kernel warns when some of several holes cut nothing and reports
an error when none does (no body there, or the wrong `flip`), when a size
doesn't fit (a counterbore wider than the body's hole, a countersink or
counterbore deeper than a blind hole) and when a sketch point is gone.
At most 200 holes per feature; two points in one place make one hole.

Names: the faces a hole makes are `hole:<feature id>:side:<part>`, where
the part is `wall` (the cylinder), `tip` (the drill point's cone) or `floor`
(a flat bottom), `cbwall` and `cbfloor` (the counterbore's wall and floor)
or `cone` (the countersink). With `points`, each part is prefixed with the
point's ID (`<point id>.wall`), so a face keeps its name when other points
are added or removed. The hole dialog's presets (M2 to M8 clearance, heat-set
inserts) only fill these inputs in the app; nothing about a preset is stored.

### 6.18 `offsetFace`

Moves faces of bodies along their normals by a distance (P3-08, ADR-0051); the
faces next to them are extended or trimmed to follow. No new keys: a feature
with `ref` and `expr` inputs like the others.

| Input | Kind | Required | Rule |
|---|---|---|---|
| `faces` | `ref` | yes | Refs of kind `face` (persistent face names, section 8): the faces to move. May lie on several bodies, each of which is offset on its own. Empty: an error until one is picked |
| `distance` | `expr` | yes | Length. **Positive moves a face along its outward normal**: the body grows there (a pad grows, a hole's wall closes in). Negative moves it in. 0 is an error when the kernel evaluates it (not checked by the schema) |

Faces that run smoothly into a picked face (their normals at the shared edge
within 4 degrees: the fillets round a pad) move with it by the same distance,
whether or not they are listed; the app's dialog lists them. A planar face moves
like a pad growing or sinking, a cylinder's wall changes its radius, a cone
keeps its angle. **Every face keeps its name**, so later features that refer
to a moved face keep finding it, and the distance can be edited freely; a face
the offset swallows is gone, and a face OCCT splits gets `#n`. A solid with a
sealed void inside (a body shelled closed), a body whose rounded edges meet at a
sharp corner (two fillets with no blend between them, which OCCT's offset can't
do safely), a distance that makes the body vanish or cross itself, and faces
OCCT can't offset are reported as errors, with the largest distance that works
where one does. Press Pull is not a feature: it
opens an Offset Face, a Fillet or an Extrude in the app.

### 6.19 `splitBody`

Cuts bodies in two along a plane (P3-08, ADR-0053). No new keys.

| Input | Kind | Required | Rule |
|---|---|---|---|
| `bodies` | `ref` | yes | Refs of kind `body` (body IDs): the bodies to cut. Empty: an error until some are picked |
| `plane` | `ref` | yes | One ref of kind `plane` (an origin or construction plane) or `face` (a flat face, taken as its whole plane, past its edges). Empty: an error until one is picked |
| `keep` | `enum` | no | `both` (default), `above` (the side the plane's normal points to: +Z for the XY plane, outside the body for a face) or `below` |

Each side becomes a body of its own, and a side that falls apart into several
solids becomes several bodies. The **largest piece keeps the body's ID** (and
so its name and colour); the others get the feature's IDs `<feature>:<n>`
(ADR-0030). A face the plane cuts in two keeps its name with `#1` and `#2`
(one piece in each body, so names stay unique); the new faces on the plane are
`split:<feature>:cut:above` and `split:<feature>:cut:below`. A body the plane
doesn't cut stays whole with a warning (an error if none is cut), and keeping
a side that has nothing of a body in it is an error.

### 6.20 `scale`

Makes bodies larger or smaller about a point (P3-08, ADR-0053). No new keys.

| Input | Kind | Required | Rule |
|---|---|---|---|
| `bodies` | `ref` | yes | Refs of kind `body`: the bodies to scale. Empty: an error until some are picked |
| `point` | `ref` | no | At most one ref of kind `vertex` or `point` (a construction point): the point that stays where it is. Absent or empty: the centre of the box that holds the bodies |
| `mode` | `enum` | no | `uniform` (default) or `non-uniform` |
| `factor` | `expr` | no | `uniform`: plain number (`unitless`), default 1 |
| `x`, `y`, `z` | `expr` | no | `non-uniform`: plain numbers, the factors along the world X, Y and Z axes, default 1 each |
| `copy` | `bool` | no | Keep the bodies and add scaled copies (`<feature>:<n>`). Default false |

Every factor must be greater than 0 (an error otherwise; a mirror is
`mirror`); all factors 1 is a warning. Faces keep their names (a copy's faces
are `scale:<feature>:from:(<name>)`, as for `move`). A uniform scale keeps every
surface's type; a non-uniform one turns curved faces into B-spline surfaces (a
cylinder scaled across its axis has an elliptic section), while flat faces stay
planes and the straight edges between them lines.

### 6.21 `draft`

Tilts faces by an angle about a neutral plane (P3-08, ADR-0053). No new keys.

| Input | Kind | Required | Rule |
|---|---|---|---|
| `faces` | `ref` | yes | Refs of kind `face`: the faces to tilt, on one or several bodies. Empty: an error until one is picked |
| `plane` | `ref` | yes | One ref of kind `plane` or `face` (a flat face): the neutral plane. The faces turn about the line where each meets it; its normal is the pull direction |
| `angle` | `expr` | yes | Angle. **Positive narrows the body along the pull** (matter goes on the pull side of the plane and comes on the other); negative widens it. 0, and 90° or more, are errors when the kernel evaluates it |
| `flip` | `bool` | no | Pull against the plane's normal. Default false |

Only flat, cylindrical and conical faces tilt (a cylinder becomes a cone);
faces that run smoothly into a picked face tilt with it. **Every face keeps its
name.** A face parallel to the neutral plane, a face of another kind, faces
whose rounded or chamfered neighbours can't follow, and an angle that makes
faces cross are reported as errors, with the largest angle that works where
one does.

### 6.22 `sweep`

Moves sketch profiles or flat faces along a path (P4-01, ADR-0055), then makes
new bodies or joins, cuts or intersects (section 6.3). No new keys. A useful
sweep has `profiles` and `path`.

| Input | Kind | Rule | Default and meaning |
|---|---|---|---|
| `profiles` | `ref` | Refs of kind `profile` or `face` (flat), all in one plane; a profile may have holes | none: fails until picked |
| `path` | `ref` | Refs of kind `sketchEntity` (`<sketch>/<curve>`: a line, arc, circle, ellipse or spline, construction ones too) or `edge`, in any order and direction, that join end to end (within 1 µm) into one chain without branches | none: fails until picked |
| `orientation` | `enum` | `follow`, `fixed` | `follow`: the profile keeps its angle to the path. `fixed`: it doesn't turn, staying parallel to where it starts |
| `twist` | `expr` angle | `follow` only, along a path without sharp corners | 0. The profile turns about the path by this much from start to end, evenly by length |
| `scale` | `expr` unitless | greater than 0; not on a closed path | 1. The profile's size at the end as a factor of its size at the start, changing evenly along the path |
| `operation` | `enum` | section 6.3 | `new-body` |
| `bodies` | `ref` | body refs | section 6.3 |

The profile stays where it is: it need not touch the path, and travels with
the path's frame **from the path's end nearer to the profile's centre** (the
chain is walked the other way when its far end is nearer). Sharp corners of the
path are mitred. Faces are named `sweep:<feature>:cap:start` (the profile's
own place), `sweep:<feature>:cap:end` and `sweep:<feature>:side:<source>` per
profile edge (a sketch curve's ID, or `(<edge name>)` for a body's face), as
for extrude, numbered `#1`, `#2` … along a path of several pieces (a face per piece). A sweep that would run into itself (a profile too large for a
bend, a path coming back near itself) is an error.

### 6.23 `loft`

A solid through sections in order (P4-01, ADR-0055), then new bodies or a
join, cut or intersection (section 6.3). No new keys.

| Input | Kind | Rule | Default and meaning |
|---|---|---|---|
| `sections` | `ref` | In loft order, at least two (three when `closed`): refs of kind `profile` or `face` (flat, one outline without holes), or as the first or last section a point: `point` (a construction point), `vertex` or `sketchEntity` (`<sketch>/<point>`) | none: fails until picked |
| `ruled` | `bool` | | false: smooth through all sections. true: straight (ruled) between neighbours |
| `closed` | `bool` | no points | false. true joins the last section back to the first: a ring with no end faces |
| `operation` | `enum` | section 6.3 | `new-body` |
| `bodies` | `ref` | body refs | section 6.3 |

Sections may have different numbers of edges (a square to a circle); the
kernel lines their starts up so the loft doesn't twist. Neighbouring sections
in one plane, a section with a hole, a point in the middle and a loft that runs
into itself are errors. Faces are named `loft:<feature>:cap:start` (the first
section), `loft:<feature>:cap:end` (the last) and `loft:<feature>:side:<source>`
after the edge of the earliest section that bounds the face. Rails and a centre
line are not part of the format yet.

### 6.24 `coil`

A spring (P4-01, ADR-0055): a section swept along a helix, placed like a
primitive (section 6.6), then new bodies or a join, cut or intersection. No
new keys. Every input is optional; `"inputs": {}` is 5 turns, 20 mm high, of a
2 mm round wire on a 20 mm diameter, standing on the XY plane at the origin.

| Input | Kind | Rule | Default and meaning |
|---|---|---|---|
| `plane` | `ref` | At most one ref of kind `plane` or `face` | The XY plane. The coil's axis is the plane's normal through (`x`, `y`) |
| `x`, `y` | `expr` length | | 0. The axis's place in the plane's frame |
| `offset` | `expr` length | | 0. Lifts the start off the plane |
| `type` | `enum` | `revolutions-height`, `revolutions-pitch`, `height-pitch` | `revolutions-height`: which two of `revolutions`, `height` and `pitch` set the length; the third follows, and its input is ignored |
| `diameter` | `expr` length | greater than 0 | 20 mm. The helix's diameter at the start, measured through the section's centre when `position` is `on` |
| `revolutions` | `expr` unitless | greater than 0, at most 1000 turns in all | 5. Fractions allowed |
| `height` | `expr` length | greater than 0 | 20 mm. Along the axis from start to end |
| `pitch` | `expr` length | greater than 0 and than the section's height along the axis | 4 mm. Rise per turn |
| `taper` | `expr` angle | between -89° and 89° | 0. Half-angle of the cone the helix winds on; positive widens with height |
| `direction` | `enum` | `counter-clockwise`, `clockwise` | `counter-clockwise` seen from above (along the normal): a right-hand spring |
| `section` | `enum` | `circle`, `square`, `triangle-out`, `triangle-in` | `circle`. A triangle is equilateral, pointing away from the axis (`triangle-out`) or towards it (`triangle-in`) |
| `size` | `expr` length | greater than 0 | 2 mm. The circle's diameter, the square's side, the triangle's side along the axis |
| `position` | `enum` | `inside`, `on`, `outside` | `on`: the section is centred on the diameter; `inside` and `outside` put its outer or inner side on it |
| `operation` | `enum` | section 6.3 | `new-body` |
| `bodies` | `ref` | body refs | section 6.3 |

The helix starts on the plane frame's X side of the axis, and the section is
centred on that start height (half of it lies below the start). A section that
would reach the axis, or turns that would touch, are errors. Faces are named
`coil:<feature>:cap:start`, `coil:<feature>:cap:end` and
`coil:<feature>:side:<role>`: `surface` (circle), `inner`, `outer`, `top`,
`bottom` (square), and for triangles the base (`inner` or `outer`) and the
`top` and `bottom` sides; each has a face per turn, numbered `#1`, `#2` … up the coil.

### 6.25 `thread`

A modeled screw thread cut into round faces (P4-02, ADR-0056): real geometry
that prints, external on a shaft's face, internal on a hole's wall (the kernel
tells which from the face). Sections 6.22 to 6.24 are P4-01's (sweep, loft,
coil). It makes no body of its own: it always cuts, and a pattern or mirror can
repeat it as a feature (6.16). No new keys.

| Input | Kind | Required | Rule |
|---|---|---|---|
| `faces` | `ref` | yes | 1 to 16 refs of kind `face`: whole cylindrical faces (all the way round), one thread on each. A flat or curved face of another kind, or part of a cylinder, is an error |
| `diameter` | `expr` | no | Length: the nominal (major) diameter of the ISO 68-1 basic profile (60°, which the Unified inch threads share) |
| `pitch` | `expr` | no | Length: crest to crest along the axis. **With neither `diameter` nor `pitch` the kernel picks the ISO metric coarse thread that fits each face** (M2 to M30: on a shaft the largest whose diameter isn't more than 0.1 mm over the shaft's; in a hole the largest whose minor diameter is at most the hole's + 0.1 mm and whose diameter is larger, so a tap-drill hole finds its thread). With one of them, the other takes its default (6 mm, 1 mm) |
| `extent` | `enum` | no | `full` (default: from `offset` to the face's far end) or `length` |
| `length` | `expr` | no | Length, default 10 mm; with `extent: length`. At least one pitch |
| `offset` | `expr` | no | Length, default 0: from the face's end to where the thread starts |
| `flip` | `bool` | no | Default `false`: `offset` and `length` run from the face's lower end along its axis (the axis taken with its first non-zero component positive: a vertical shaft's bottom end); `true` from the other end |
| `hand` | `enum` | no | `right` (default) or `left` |
| `tolerance` | `expr` | no | Length, default 0.1 mm, not negative: the print clearance. The whole profile moves this far radially into the part's material, so an external thread's diameters shrink by twice it and an internal one's grow by twice it |
| `chamfer` | `bool` | no | Default `true`: a 45° lead-in where the thread runs out of an open end of the face (a shaft's end, a hole's mouth; not a shoulder or a hole's floor) |

The profile is the basic one: on a shaft a crest flat P/8 wide at the major
diameter and a root flat P/4 wide at the minor (D − 1.0825 P), in a hole the
reverse; both moved by `tolerance`. A shaft thicker than the thread is turned
down to it (a warning when much thicker); a shaft at or under the thread's root,
a hole as wide as the thread, a thread longer than the face, an offset as long
as the face and more than 400 turns are errors. A shaft's thread and a hole's
that start at the same plane mesh (the hole's tooth sits half a pitch on).

Names: `thread:<feature id>:side:f<k>.<part>`, where k is the face's place in
`faces` (0, 1 …) and the part is `crest`, `flank0`, `flank1` (one face per turn,
`#n` along the helix), `root`, `end0` / `end1` (the flat steps where a thread
stops inside a face) or `lead0` / `lead1` (the lead-in cones). The dialog's
sizes (ISO metric coarse and fine, UNC, UNF) only fill `diameter` and `pitch`;
nothing about a preset is stored.

---

## 7. Sketch data (`sketchData`)

`{ "kind": "sketchData", "sketch": SketchData }`, where SketchData is:

| Field | Type | Required | Meaning |
|---|---|---|---|
| `entities` | record: sketch entity ID to Entity | yes | Points and curves (7.1). |
| `constraints` | record: constraint ID to Constraint | yes | Geometric constraints (7.2). |
| `dimensions` | record: dimension ID to Dimension | yes | Dimensions (7.3). |
| `projections` | record: projection ID to Projection | no | Model geometry projected into the sketch (7.4). Absent: none. |

**Records keyed by ID, not arrays**, so that one deletion is one small patch.
JSON object key order carries no meaning. All four records share **one ID
space per sketch**: an ID appears in at most one of them. IDs are unique
within the sketch only.

Coordinates are millimetres in the sketch plane's own 2D frame (6.2). The
values stored are the *solved* ones, so a sketch draws immediately and the
solver starts from the last solution. A sketch's **profiles** (closed
regions) are derived, never stored.

**Reference checks** (run when loading; an inconsistent sketch is *damaged*):
every entity a record points at must exist and be of an allowed kind (the
tables below give the kinds); a record must not refer to the same entity
twice where that is meaningless; each **point belongs to at most one curve**
(two lines that meet share no point; a `coincident` constraint joins their
endpoints).

### 7.1 Entities (`type`)

All curves have a `construction` flag (required): `true` makes it construction
geometry (dashed, helps constrain, never forms profiles).

| `type` | Fields | Meaning |
|---|---|---|
| `point` | `x`, `y` (numbers) | A point. |
| `line` | `start`, `end` (point IDs, distinct); `construction` | A segment. Direction is start to end. |
| `circle` | `center` (point ID); `radius` (number greater than 0); `construction` | A circle. |
| `arc` | `center`, `start`, `end` (point IDs, all distinct); `construction` | Counter-clockwise from `start` to `end` about `center`; the radius is the distance from `center` to `start`. |
| `ellipse` | `center`, `major`, `minor` (point IDs, distinct); `construction` | From three points: the centre, the end of the major axis, the end of the minor axis. The minor point is on the ellipse square to the major axis (the solver keeps it so); radii and rotation are the points' distances and angle, nothing else is stored. |
| `spline` | `points` (array of at least 2 point IDs, distinct); `construction` | A fit-point spline through the points in order. The B-spline is derived from the points. |

### 7.2 Constraints (`type`)

Field values are entity IDs. "Kind" says what entity types are allowed.

| `type` | Fields | Allowed kinds and rules |
|---|---|---|
| `coincident` | `a`, `b` | Two distinct points. |
| `pointOnCurve` | `point`, `curve` | `point` a point; `curve` a line, circle, arc or ellipse. |
| `collinear` | `a`, `b` | Two distinct lines. |
| `concentric` | `a`, `b` | Two distinct circles or arcs. |
| `midpoint` | `point`, `of` | `point` a point; `of` a line or an arc. |
| `fix` | `entity` | Any entity (point, line, circle, arc, ellipse, spline). Splines take only `fix`. |
| `parallel` | `a`, `b` | Two distinct lines. |
| `perpendicular` | `a`, `b` | Two distinct lines. |
| `horizontal` | `a`; `b` (optional) | Either `a` a line and no `b`, or `a` and `b` two distinct points. |
| `vertical` | `a`; `b` (optional) | As `horizontal`. |
| `tangent` | `a`, `b`; `reversed` (boolean, optional) | Two distinct curves (line, circle or arc), not two lines. |
| `smooth` | `a`, `b`; `reversed` (boolean, optional) | As `tangent`. Meant as G2 continuity for splines; between lines and arcs the solver treats it as tangency today. |
| `equal` | `a`, `b` | Two distinct lines, or two circles/arcs. |
| `symmetric` | `a`, `b`, `axis` | `a` and `b` distinct and of the same kind (point, line, or circle/arc); `axis` a line, distinct from both. |

`reversed` (tangent, smooth) records whether the two curves' directions at the
joint point opposite ways (lines run start to end, circles and arcs
counter-clockwise); the solver keeps the joint on that side. Absent: the solver
picks the side from the current geometry.

### 7.3 Dimensions (`type`)

Every dimension has these common fields, in addition to its own:

| Field | Type | Required | Meaning |
|---|---|---|---|
| `expr` | string | yes | The value as an expression (section 5). A length for `distance`, `radius`, `diameter`; an angle for `angle`. |
| `paramName` | string matching the name regex | no | Makes the dimension a model parameter (`d1`, ...). |
| `driven` | boolean | yes | `true`: a *reference* dimension that measures the geometry instead of driving it. |
| `label` | object `{ "x": number, "y": number }` | no | Where the label sits: an offset in sketch mm from the dimension's anchor. Absent: a default spot. |

| `type` | Own fields | Meaning and rules |
|---|---|---|
| `distance` | `orientation` (`aligned`, `horizontal` or `vertical`, required); `a` (required); `b` (optional) | A line's length (`a` a line, no `b`), or the distance between two points, a point and a line, or two parallel lines. `a` and `b` are points or lines and distinct; `a` a point needs `b`; when a line is involved the orientation must be `aligned`. |
| `radius` | `curve` | A circle or arc. |
| `diameter` | `curve` | A circle or arc. |
| `angle` | `a`, `b` (distinct lines); `supplement` (boolean, optional) | The angle between the lines' directions (start to end), 0 to 180 degrees; with `supplement`, 180 degrees minus that. |

A **driving** dimension's value comes from `expr`; the solver moves the
geometry to satisfy it. A dimension whose `expr` cannot be satisfied together
with the constraints is reported by the app; the file still loads.

### 7.4 Projections (`projections[<id>]`)

Model geometry projected into the sketch (P2-09), kept associative. The
projected curves are ordinary `entities` that the solver holds fixed; the
kernel reports where they should be on each recompute and the app moves them.

| Field | Type | Required | Meaning |
|---|---|---|---|
| `ref` | GeomRef | yes | What is projected: kind `edge` or `face` (other kinds are refused). |
| `curves` | record: string to entity ID or `null` | yes | Each key is what a curve comes from (the source edge's persistent name, `sil:<n>` for a silhouette line of a curved face, `edge` for a projected edge itself); its value the entity ID of the curve in the sketch, or `null` once the user deleted it (so it does not come back). A non-null value must be an existing curve (not a point), and no curve is used by two projections. |

---

## 8. References

A `GeomRef` points at geometry made by earlier features. It is stored in
`ref` inputs (`refs` arrays) and in a projection's `ref`.

| Field | Type | Required | Meaning |
|---|---|---|---|
| `kind` | one of `plane`, `axis`, `point`, `face`, `edge`, `vertex`, `profile`, `body`, `sketchEntity`, `feature` | yes | What kind of thing. |
| `id` | string | yes | Non-empty. The **persistent name** (below), never an index into a mesh or a shape. |
| `fingerprint` | GeomFingerprint | no | For `face`, `edge` and `vertex`: what the target looked like when picked; used when `id` no longer resolves. |

`id` by kind:

| `kind` | `id` | Made by |
|---|---|---|
| `plane` | `origin:xy`, `origin:xz`, `origin:yz`; or a construction plane feature's ID (`<featureId>`, 6.10) | fixed, or a construction feature |
| `axis` | `origin:x`, `origin:y`, `origin:z`; or a construction axis feature's ID | fixed, or a construction feature |
| `profile` | `<sketchFeatureId>/<regionId>`: the sketch feature and the region within it. A region's ID is a hash of the curves around its outer loop and the direction each runs in, so it survives moving and resizing | derived from the sketch |
| `sketchEntity` | `<sketchFeatureId>/<entityId>` (a curve or point picked outside its sketch) | sketch |
| `body` | a body ID, `<featureId>:<n>`: the first body a feature makes is `<featureId>:0` | kernel |
| `face` | a face name, `op:feature:role[:source]` with optional `#n` split suffixes | kernel |
| `edge` | `e[face|face…]` with optional `@n` | kernel |
| `vertex` | `v[face|face…]` with optional `@n` | kernel |
| `point` | a construction point feature's ID (`<featureId>`, 6.10) | construction feature |
| `feature` | a feature's ID (`<featureId>`): the feature itself, for a pattern or mirror that repeats it (6.16) | the timeline |

**Topological names** (ADR-0005) describe *why* a face exists, not where it
is, so they stay valid when upstream features change. Grammar:

```
face     = created split*
created  = op ":" feature ":" role (":" source)?
source   = token | "(" name ")"        nested names in parentheses
split    = "#" n                       n at least 1
edge     = "e[" face ("|" face)* "]" ("@" n)?
vertex   = "v[" face ("|" face)* "]" ("@" n)?
```

Tokens are plain IDs (`[A-Za-z0-9_.~-]+`); names never contain `/`. Examples:
`extrude:E:cap:end` (the end cap of extrude `E`), `extrude:E:side:l8` (the
side swept from sketch line `l8`), `box:B:side:front`,
`e[extrude:E:cap:end|extrude:E:side:l8]` (the edge between them),
`v[extrude:E:cap:end|extrude:E:side:l11|extrude:E:side:l8]`. Third-party
writers can create references to origin planes, axes and sketch profiles and
entities; face, edge and vertex names must come from the kernel's naming
tables (`packages/kernel/src/naming/`), which is why a tool that needs them
has to run a kernel.

### 8.1 `fingerprint`

Recorded when a face, edge or vertex is picked, matched against the current
geometry only if `id` does not resolve (the app then warns that it guessed).

| Field | Type | Required | Meaning |
|---|---|---|---|
| `type` | string | yes | Non-empty. Surface type of a face (`plane`, `cylinder`, ...), curve type of an edge (`line`, `circle`, ...), `point` for a vertex. |
| `at` | `[x, y, z]` | yes | Area centroid of a face, midpoint of an edge, position of a vertex (mm). |
| `dir` | `[x, y, z]` | no | A plane's outward normal, an axis, or a line's direction. |
| `size` | number, at least 0 | no | Area (mm squared) of a face, length (mm) of an edge. |
| `adj` | array of strings | no | Persistent names of the faces around it (for a face: the faces next to it). |

---

## 9. Example

A complete valid `document.json`: two parameters, a 40 by 20 mm rectangle
sketch on the XY plane (four lines, each with its own two points; joined by
`coincident` constraints; two dimensions, one of them a model parameter), an
extrude of its profile that is `wall * 5` long, a box on the extrude's end
face that joins the body, the body's record, and one saved view. The sketch has no `projections`. (A test parses this
block against the real schema, so it stays valid.)

```json example
{
  "format": "extrudo",
  "formatVersion": 1,
  "id": "5b0b3ad0-2a52-4c6f-9c5e-0f2d3f9e0a11",
  "name": "Example bracket",
  "settings": { "units": "mm", "precision": 2 },
  "parameters": [
    { "id": "param-width", "name": "width", "expression": "40 mm", "unit": "length", "comment": "Overall width" },
    { "id": "param-wall", "name": "wall", "expression": "2 mm", "unit": "length" }
  ],
  "features": [
    {
      "id": "sketch-1",
      "type": "sketch",
      "name": "Sketch1",
      "suppressed": false,
      "inputs": {
        "plane": { "kind": "ref", "refs": [{ "kind": "plane", "id": "origin:xy" }] },
        "sketch": {
          "kind": "sketchData",
          "sketch": {
            "entities": {
              "p1s": { "type": "point", "x": 0, "y": 0 },
              "p1e": { "type": "point", "x": 40, "y": 0 },
              "p2s": { "type": "point", "x": 40, "y": 0 },
              "p2e": { "type": "point", "x": 40, "y": 20 },
              "p3s": { "type": "point", "x": 40, "y": 20 },
              "p3e": { "type": "point", "x": 0, "y": 20 },
              "p4s": { "type": "point", "x": 0, "y": 20 },
              "p4e": { "type": "point", "x": 0, "y": 0 },
              "l1": { "type": "line", "start": "p1s", "end": "p1e", "construction": false },
              "l2": { "type": "line", "start": "p2s", "end": "p2e", "construction": false },
              "l3": { "type": "line", "start": "p3s", "end": "p3e", "construction": false },
              "l4": { "type": "line", "start": "p4s", "end": "p4e", "construction": false }
            },
            "constraints": {
              "c1": { "type": "coincident", "a": "p1e", "b": "p2s" },
              "c2": { "type": "coincident", "a": "p2e", "b": "p3s" },
              "c3": { "type": "coincident", "a": "p3e", "b": "p4s" },
              "c4": { "type": "coincident", "a": "p4e", "b": "p1s" },
              "c5": { "type": "horizontal", "a": "l1" },
              "c6": { "type": "horizontal", "a": "l3" },
              "c7": { "type": "vertical", "a": "l2" },
              "c8": { "type": "vertical", "a": "l4" },
              "c9": { "type": "fix", "entity": "p1s" }
            },
            "dimensions": {
              "dim1": { "type": "distance", "orientation": "aligned", "a": "l1", "expr": "width", "paramName": "d1", "driven": false },
              "dim2": { "type": "distance", "orientation": "aligned", "a": "l2", "expr": "20 mm", "driven": false, "label": { "x": 3, "y": 0 } }
            }
          }
        }
      }
    },
    {
      "id": "extrude-1",
      "type": "extrude",
      "name": "Extrude1",
      "suppressed": false,
      "inputs": {
        "profiles": { "kind": "ref", "refs": [{ "kind": "profile", "id": "sketch-1/1ihvgl0iouc" }] },
        "distance": { "kind": "expr", "expr": "wall * 5", "unit": "length", "paramName": "d2" },
        "operation": { "kind": "enum", "value": "new-body" }
      }
    },
    {
      "id": "box-1",
      "type": "box",
      "name": "Box1",
      "suppressed": false,
      "inputs": {
        "plane": {
          "kind": "ref",
          "refs": [
            {
              "kind": "face",
              "id": "extrude:extrude-1:cap:end",
              "fingerprint": { "type": "plane", "at": [20, 10, 10], "dir": [0, 0, 1], "size": 800 }
            }
          ]
        },
        "x": { "kind": "expr", "expr": "10 mm", "unit": "length" },
        "length": { "kind": "expr", "expr": "10 mm", "unit": "length" },
        "width": { "kind": "expr", "expr": "10 mm", "unit": "length" },
        "height": { "kind": "expr", "expr": "5 mm", "unit": "length" },
        "rotation": { "kind": "expr", "expr": "15 deg", "unit": "angle" },
        "operation": { "kind": "enum", "value": "join" },
        "bodies": { "kind": "ref", "refs": [{ "kind": "body", "id": "extrude-1:0" }] }
      }
    }
  ],
  "timelineMarker": 3,
  "bodies": {
    "extrude-1:0": { "name": "Body1", "color": "#3b82f6", "opacity": 1, "visible": true }
  },
  "views": [
    {
      "id": "view-1",
      "name": "Front",
      "camera": {
        "projection": "orthographic",
        "position": [0, -200, 0],
        "target": [0, 0, 0],
        "up": [0, 0, 1]
      }
    }
  ],
  "meta": {
    "created": "2026-09-29T10:00:00.000Z",
    "modified": "2026-09-29T10:30:00.000Z",
    "appVersion": "0.1.0"
  }
}
```

Its container, with one saved version, holds `manifest.json`
(`{"format":"extrudo","formatVersion":1,"appVersion":"0.1.0","created":"2026-09-29T10:00:00.000Z","units":"mm"}`),
`document.json` (the above), `thumbnail.png` (optional), `versions/index.json`
(`{"versions":[{"number":1,"description":"First cut","created":"2026-09-29T10:15:00.000Z","name":"Example bracket"}]}`)
and `versions/1.json` (a document of the same shape).

---

## 10. IDs, determinism and what is derived

**IDs.** Every entity that has an ID (document, feature, parameter, view,
sketch entity, constraint, dimension, projection) gets a random UUID (v4, from
`crypto.randomUUID()`) when it is created and keeps it for life; IDs are never
reused. The schema only requires a non-empty string, and readers must accept
any. IDs of features are used as tokens inside references and persistent
names, so a hand-written feature ID should use only `[A-Za-z0-9_.~-]` and no
`/` or `:`. Sketch entity, constraint, dimension and projection IDs share one
space per sketch (section 7). Body IDs are made by the kernel (`<feature>:<n>`)
and profile region IDs by the sketch profile detector; a third-party writer
that creates them must follow the rules in section 8.

**Determinism.** Editing is a sequence of deterministic commands over this
JSON (undoable, replayable): a command makes the same change from the same
document and payload, and IDs and timestamps are created by the caller, never
inside a command. As a file format this means: the same document, evaluated
by the same kernel, gives the same geometry, and a writer must not put
randomness or time into anything but IDs and `meta`.

**Derived, never stored.** The following are computed from the document
by the kernel (OCCT compiled to WebAssembly, in a worker) and are not part of
any `.extrudo` file: solids and their meshes; a sketch's profiles and faces;
the frame of a sketch on a face; persistent names of faces, edges and
vertices (only *references* to them are stored); measurements; the values of
expressions and parameters; constraint status (free, fixed, conflict) of a
sketch; body IDs' existence (only their metadata is stored). A tool that
wants shapes must run a kernel over the feature list in order, honouring
`suppressed` and `timelineMarker`, or use the app's STEP, STL and 3MF
exports.

**Unstored user state.** Selection, the open sketch, camera (other than saved
`views`), panel layout, undo history and the display settings are not part of
the file.

**Known gaps in format 1** (things a tool author might expect that are not
there yet): no hole, pattern, move or combine features; no imported bodies or
`attachments/`; no `cache/`; no extension mechanism for third-party keys.
Each will arrive as new feature types or optional fields, or as a
`formatVersion` bump with a migration (section 3).
