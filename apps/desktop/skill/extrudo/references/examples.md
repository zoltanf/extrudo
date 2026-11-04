# Worked examples

Each example is the exact tool calls, in order, one JSON object per call:
`{ "tool": …, "args": … }`. Where a call needs an id an earlier call answered,
the text says `<Name id>`: the id of the feature named `Name` (from that
call's answer or `get_design`). `<Name profiles>` is the `profiles` list
`add_sketch` answered for the sketch named `Name`.

After every change, read the answer's `problems` (it should be empty); at the
end, `get_bodies` and `screenshot` confirm the result.

## A box with a lid

A 60 × 40 × 30 mm open box with 2 mm walls, and its lid printed beside it: a
3 mm plate with a lip that fits inside the box with 0.3 mm of clearance.

```json
{ "tool": "new_design", "args": { "name": "Box with lid" } }
```

The sizes, as parameters:

```json
{ "tool": "set_parameter", "args": { "name": "length", "expression": "60 mm" } }
{ "tool": "set_parameter", "args": { "name": "width", "expression": "40 mm" } }
{ "tool": "set_parameter", "args": { "name": "height", "expression": "30 mm" } }
{ "tool": "set_parameter", "args": { "name": "wall", "expression": "2 mm" } }
{ "tool": "set_parameter", "args": { "name": "lid", "expression": "3 mm" } }
{ "tool": "set_parameter", "args": { "name": "clearance", "expression": "0.3 mm" } }
```

The box, hollowed with its top face removed:

```json
{ "tool": "add_feature", "args": { "type": "box", "name": "Base", "inputs": { "length": "length", "width": "width", "height": "height" } } }
{ "tool": "add_feature", "args": { "type": "shell", "inputs": { "faces": { "kind": "face", "id": "box:<Base id>:cap:end" }, "thickness": "wall" } } }
```

The lid beside it, and the lip joined on top of the lid (the lid is turned
over to close the box):

```json
{ "tool": "add_feature", "args": { "type": "box", "name": "Lid", "inputs": { "x": "length + 10 mm", "length": "length", "width": "width", "height": "lid" } } }
{ "tool": "add_feature", "args": { "type": "box", "name": "Lip", "inputs": { "x": "length + 10 mm", "offset": "lid", "length": "length - 2 * (wall + clearance)", "width": "width - 2 * (wall + clearance)", "height": "4 mm", "operation": "join" } } }
```

Check it:

```json
{ "tool": "get_design", "args": {} }
{ "tool": "get_bodies", "args": {} }
{ "tool": "screenshot", "args": {} }
```

Two bodies: the box (60 × 40 × 30 mm) and the lid (60 × 40 × 7 mm). Making the
box taller is now one call: `set_parameter` `height` to `"45 mm"`.

## A parametric bracket

An L-shaped bracket: a base plate with two screw holes and an upright, the
inside corner rounded. Every size is a parameter.

```json
{ "tool": "new_design", "args": { "name": "Bracket" } }
{ "tool": "set_parameter", "args": { "name": "base", "expression": "50 mm" } }
{ "tool": "set_parameter", "args": { "name": "width", "expression": "30 mm" } }
{ "tool": "set_parameter", "args": { "name": "upright", "expression": "40 mm" } }
{ "tool": "set_parameter", "args": { "name": "thickness", "expression": "4 mm" } }
{ "tool": "set_parameter", "args": { "name": "screw", "expression": "4.5 mm" } }
{ "tool": "set_parameter", "args": { "name": "corner", "expression": "3 mm" } }
```

The base plate, centred on the origin, and the upright joined at its left end:

```json
{ "tool": "add_feature", "args": { "type": "box", "name": "Plate", "inputs": { "length": "base", "width": "width", "height": "thickness" } } }
{ "tool": "add_feature", "args": { "type": "box", "name": "Upright", "inputs": { "x": "-(base - thickness) / 2", "length": "thickness", "width": "width", "height": "upright", "operation": "join" } } }
```

The inside corner rounded: the edge where the upright's right side meets the
plate's top.

```json
{ "tool": "add_feature", "args": { "type": "fillet", "inputs": { "edges": { "edgeBetween": ["box:<Plate id>:cap:end", "box:<Upright id>:side:right"] }, "radius": "corner" } } }
```

Two screw holes through the plate, as cylinders cut from it:

```json
{ "tool": "add_feature", "args": { "type": "cylinder", "name": "Hole A", "inputs": { "x": "base / 6", "diameter": "screw", "height": "thickness", "operation": "cut" } } }
{ "tool": "add_feature", "args": { "type": "cylinder", "name": "Hole B", "inputs": { "x": "base / 3", "diameter": "screw", "height": "thickness", "operation": "cut" } } }
```

Check it:

```json
{ "tool": "get_design", "args": {} }
{ "tool": "get_bodies", "args": {} }
{ "tool": "screenshot", "args": {} }
```

One body, 50 × 30 × 40 mm. A sturdier bracket is `set_parameter` `thickness`
to `"6 mm"`; everything follows.

## Notes on the bracket

The agent leaves the person a note at the first screw hole (on the plate's top
at x = base / 6) and lists the notes. On a face of the model the anchor is its
name instead, `{ "face": "<face name>" }`, which follows the face when a
parameter moves it.

```json
{ "tool": "add_annotation", "args": { "text": "Screw holes are 4.5 mm, for M4 self-tappers: change screw if yours differ.", "anchor": { "at": [8.333, 0, 4] } } }
{ "tool": "list_annotations", "args": {} }
```

The answer is note `#1`. When the person later says "#1 is fine", tick it off
(a note is never deleted unasked):

```json
{ "tool": "edit_annotation", "args": { "number": 1, "done": true } }
```
