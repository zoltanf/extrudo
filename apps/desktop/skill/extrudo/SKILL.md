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
   `list_designs` and `open_design`, or `new_design`.
2. **Prefer parameters to raw numbers.** Make every size that matters a
   parameter (`set_parameter` creates one when the name is new) and use its
   name in the inputs. The person can then change the part from the Parameters
   panel, and so can you.
3. **Make one change per call.** `add_sketch`, `add_feature`, `edit_feature`,
   `set_parameter`, `suppress`, `rename`, `remove`. Each answers `problems`:
   the features whose status is `error` or `warning` after the recompute.
4. **Check after each change.** Read `problems`; call `get_design` when unsure,
   and `screenshot` to see the part. `get_bodies` gives each body's volume and
   bounding box, which is the quickest way to confirm a size.
5. **Fix, don't pile on.** A feature in `error` makes everything after it
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
- Changing bodies: `shell`, `fillet`, `chamfer`, `hole`, `draft`, `combine`,
  `mirror`, the patterns, `move`.
- `operation` on a solid: `'new-body'` (default), `'join'`, `'cut'`,
  `'intersect'`.

## References: never indices

Faces, edges and bodies are named, not numbered. Build references from the
names, never from an index or a position:

- A body: `{ "kind": "body", "id": "<feature id>" }` (the body a feature made
  is named after it).
- A face: `{ "kind": "face", "id": "<type>:<feature id>:<role>" }`, the role
  from the feature type's faces in `references/api.md`: the top of a box is
  `box:<id>:cap:end`, an extrude's far face `extrude:<id>:cap:end`, a side of
  an extrude from sketch line `l3` is `extrude:<id>:side:l3`.
- An edge: `{ "edgeBetween": ["<face name>", "<face name>"] }`, the edge where
  two named faces meet.
- A profile: copy it from `add_sketch`'s answer (or `get_feature` on the
  sketch).
- Origin planes and axes: `{ "kind": "plane", "id": "origin:xy" }` (`xz`,
  `yz`), `{ "kind": "axis", "id": "origin:z" }` (`x`, `y`).

Feature ids come from the answers (`add_feature` returns `[{ id, name }]`) and
from `get_design`'s timeline.

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
