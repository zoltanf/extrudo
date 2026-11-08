---
title: Simplify for Print
section: Tools
category: Make
order: 123
---

# Simplify for Print

Remove every small round, chamfer and hole at once: for parts imported from engineering CAD.

| Where | Shortcut |
|---|---|
| Make › Prepare | None |

<video src="demo:simplifyForPrint" muted loop autoplay playsinline aria-label="Simplify for Print demo"></video>

<!-- notes -->
Pick the bodies, then set how far each kind goes under **Remove up to**: a
round's radius, a chamfer's size (how far it cuts back into either face) and
a hole's diameter; turn any of them off to keep that kind. The slider under
each limit stops at every size found on the bodies, and the preview follows
when you let go; you can also type any value. A hole goes with its
floor, counterbore, countersink and rounded edge. The view shows the faces
that go in red, and **Found** counts them. One whose neighbouring faces can't
be extended to meet stays: the list under Found names it, and the rest are
still removed. The feature keeps the limits, not the faces, so changing a
limit or an earlier feature finds them again. An imported
mesh needs [Mesh to Solid](meshToSolid.md) first; to remove one particular
face, use [Remove Faces](removeFaces.md).
<!-- /notes -->
