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
Pick the bodies, then set **Max radius** for rounds, **Max size** for
chamfers (how far a chamfer cuts back into either face) and **Max diameter**
for holes; turn any of them off to keep that kind. A hole goes with its
floor, counterbore, countersink and rounded edge. The view shows the faces
that go in red, and **Found** counts them. One whose neighbouring faces can't
be extended to meet stays: the list under Found names it, and the rest are
still removed. The feature keeps the limits, not the faces, so changing a
limit or an earlier feature finds them again. An imported
mesh needs [Mesh to Solid](meshToSolid.md) first; to remove one particular
face, use [Remove Faces](removeFaces.md).
<!-- /notes -->
