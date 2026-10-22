---
name: extrudo
description: Model 3D-printable parts in Extrudo, the parametric CAD app, through its MCP tools. Use when asked to design, change, measure or export a part in a running Extrudo.
---

# Modelling in Extrudo

Extrudo is a parametric CAD app for 3D printing. A design is a **timeline** of
features (sketches, extrudes, boxes, shells, fillets, …) driven by
**parameters**. You change the design open in the person's app through the
`extrudo` MCP tools; every change you make shows up in their timeline as one
step named `Agent: …`, and one Ctrl+Z takes it back.

All lengths are millimetres, angles degrees. Expressions take units and
parameter names: `'40 mm'`, `'width / 2'`, `'2 * wall + 0.4 mm'`.

## The loop

1. **Read first.** Call `get_design`: its parameters, configurations and the
   timeline with every feature's `status`. With no design open, call
   `list_designs` and `open_design`, or `new_design`. A design the person
   made in the app is "Untitled": name it with `rename_design`.
2. **Prefer parameters to raw numbers.** Make every size that matters a
   parameter (`set_parameter` creates one when the name is new) and use its
   name in the inputs, sketch points included (`["-width / 2", "wall_t"]`
   keeps the point at that place when a parameter changes). The person can
   then change the part from the Parameters panel, and so can you.
3. **Make one change per call.** `add_sketch`, `add_feature`, `edit_feature`,
   `set_parameter`, `suppress`, `rename`, `remove`. Each answers `problems`:
   the features whose status is `error` or `warning` after the recompute.
4. **Check after each change.** Read `problems`; call `get_design` when unsure,
   and `screenshot` to see the part. `get_bodies` gives each body's volume and
   bounding box, which is the quickest way to confirm a size; pictures are for
   shape, not size. Check with targeted views: `screenshot` takes a `view`
   (`'top'`, `'front'`, … or a direction), `bodies` to show only some, a
   `section` to look inside (`{ "plane": "xy", "offset": "10 mm" }` with
   `view: "top"` is a floor plan), `overlays: false` and a `size` up to 1536.
   The person's own view doesn't move.
5. **With several bodies, run `check_interference` before finishing.** It
   lists every pair that overlaps with the shared volume; overlapping bodies
   print badly. Fix each with a `combine` cut, or move or resize one.
6. **Fix, don't pile on.** A feature in `error` makes everything after it
   suspect. Fix it (`edit_feature`, or `undo`) before adding more.

## Features

`add_feature` takes a feature `type` and its **inputs as plain values**: the
same inputs as the document API's method of that name (`references/api.md`
lists every type, its inputs, their defaults and the faces it names). A bad
input is refused with the input's path, and nothing changes.

- Solids from nothing: `box`, `cylinder`, `sphere`, `torus` (centred on their
  plane's origin at `x`, `y`; `offset` lifts them off the plane).
- From a sketch: `add_sketch` draws on `'xy'`, `'xz'`, `'yz'` or a flat face
  and answers the sketch's `profiles`; pass them to `extrude`, `revolve`, ….
  Each shape names its kind in `shape`:
  `{ "shape": "circle", "center": [0, 0], "diameter": "20 mm" }`,
  `{ "shape": "polyline", "points": [[0, 0], [30, 0], [15, 20]], "closed": true }`
  (`references/tools.md` lists them all).
- Where a sketch lies: `add_sketch` answers its `frame` (`origin`, `xDir`,
  `yDir`, `normal`, world mm); a one-side extrude goes along `normal`. World
  Z is up. The origin planes:

  | plane | sketch x | sketch y | normal |
  | --- | --- | --- | --- |
  | `xy` | +X | +Y | +Z |
  | `xz` | +X | +Z | −Y |
  | `yz` | +Y | +Z | +X |

  So an `offsetPlane` on `origin:xz` at `-60 mm` lies at Y = +60. To sketch
  off the origin, add an `offsetPlane` (or another construction plane) and
  pass `{ "kind": "plane", "id": "<its feature id>" }` as the sketch's plane.
- Changing bodies: `shell`, `fillet`, `chamfer`, `hole`, `draft`, `combine`,
  `mirror`, the patterns, `move`.
- `operation` on a solid: `'new-body'` (default), `'join'`, `'cut'`,
  `'intersect'`.

## References: never indices

Faces, edges and bodies are named, not numbered. Build references from the
names, never from an index or a position:

- A body: `{ "kind": "body", "id": "<feature id>:<n>" }`, as `get_bodies`
  lists them: a feature's bodies are numbered from `:0` (an extrude of two
  separate profiles makes `:0` and `:1`). A bare `<feature id>` works when
  that feature made one body; an unknown body is refused and nothing changes.
  Body names (`Body1`, …) are for people, not references.
- A face: `{ "kind": "face", "id": "<type>:<feature id>:<role>" }`, the role
  from the feature type's faces in `references/api.md`: the top of a box is
  `box:<id>:cap:end`, an extrude's far face `extrude:<id>:cap:end`, a side of
  an extrude from sketch line `l3` is `extrude:<id>:side:l3`.
- An edge: `{ "edgeBetween": ["<face name>", "<face name>"] }`, the edge where
  two named faces meet.
- A profile: copy it from `add_sketch`'s answer (or `get_feature` on the
  sketch). Profiles don't follow the order of `shapes`: pick one by its entry
  in `regions` (same order as `profiles`): `area`, `box`, `centroid`, its
  `holes`, and `shapes`, the indices of the shapes that bound it. A rectangle
  inside another gives two profiles: the ring (one hole, `shapes: [0, 1]`)
  and the inner rectangle (no hole, `shapes: [1]`).
- A sketch curve (a revolve's axis, a sweep's path): its `ref` from
  `get_feature`'s `curves`, `{ "kind": "sketchEntity", "id": "<sketch id>/<curve id>" }`.
- Origin planes and axes: `{ "kind": "plane", "id": "origin:xy" }` (`xz`,
  `yz`), `{ "kind": "axis", "id": "origin:z" }` (`x`, `y`).

Feature ids come from the answers (`add_feature` returns `[{ id, name }]`) and
from `get_design`'s timeline.

## How bodies look

`set_body_appearance` gives a body (its id from `get_bodies`) a colour
(`"#8b5a2b"`), an opacity (0.1–1), a name, or hides it (`visible: false`),
one undo step per call. Colour each part of a multi-body model, and name the
bodies after what they are (`Trunk`, `Crown`).

## Files

`save` saves now (the app also saves on its own). `export` writes STL, 3MF or
STEP of the shown bodies and answers the file's path.

## Limits

- Changes are refused while the person has a sketch or a feature dialog open
  in the app: ask them to finish it.
- `screenshot` at most once a second, `export` once every 2 s.

## More

- `references/tools.md`: every tool and its inputs.
- `references/api.md`: every feature type, its inputs and its faces.
- `references/examples.md`: two worked examples, as the exact tool calls: a
  box with a lid, and a parametric bracket.
