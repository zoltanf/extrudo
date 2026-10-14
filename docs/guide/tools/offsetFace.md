---
title: Offset Face
section: Tools
category: Modify
order: 42
---

# Offset Face

Move faces along their normals; the faces next to them follow. A curved wall changes its radius.

| Where | Shortcut |
|---|---|
| Modify › Modify | None |

<video src="demo:offsetFace" muted loop autoplay playsinline aria-label="Offset Face demo"></video>

<!-- notes -->
Picking a face also picks the faces that run smoothly into it, because they move together.
**Keep rounds' radius** (on for a new offset) stops at rounded edges a Fillet made: a wall is
picked without its rounds, and each round is made again at its own radius between the moved wall
and the face on its other side, which stays where it is. The dialog counts them ("2 rounds keep
their radius"). Turn it off to move the rounds with the wall: they grow or shrink by the distance,
and the faces past them move too. Clicking a round itself picks its whole chain. Offsets made
before this option open with it off, so they keep their shape.
<!-- /notes -->
