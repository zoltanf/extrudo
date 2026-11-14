---
title: Simplify for Print
section: Tools
category: Make
order: 124
---

# Simplify for Print

Remove every small round, chamfer and hole at once: for parts imported from engineering CAD.

| Where | Shortcut |
|---|---|
| Make › Prepare | None |

<video src="demo:simplifyForPrint" muted loop autoplay playsinline aria-label="Simplify for Print demo"></video>

<!-- notes -->
Pick the bodies. Each kind (rounds, chamfers, holes) has a card with a
slider that starts at **Keep** and stops at every size of that kind found on
the bodies: a round's radius, a chamfer's size (how far it cuts back into
either face) and a hole's diameter. Everything up to the size you pick goes;
the preview follows when you let go, and you can also type any value. The
card's badge counts what goes, and its note says which sizes go and which
stay. A hole goes with its
floor, counterbore, countersink and rounded edge. The view shows the faces
that go in red. One whose neighbouring faces can't be extended to meet stays:
its card names it, and the rest are still removed. The feature keeps the limits, not the faces, so changing a
limit or an earlier feature finds them again. An imported
mesh needs [Mesh to Solid](meshToSolid.md) first; to remove one particular
face, use [Remove Faces](removeFaces.md).
<!-- /notes -->
