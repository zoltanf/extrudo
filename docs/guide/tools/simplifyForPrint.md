---
title: Simplify for Print
section: Tools
category: Make
order: 123
---

# Simplify for Print

Remove every round under a radius and every hole under a diameter at once: for parts imported from engineering CAD.

| Where | Shortcut |
|---|---|
| Make › Prepare | None |

<!-- notes -->
Pick the bodies, then set **Max radius** for rounds and **Max diameter** for
holes; turn either off to keep that kind. The view shows the faces that go in
red, and **Found** counts them. A round or hole whose neighbouring faces
can't be extended to meet stays: the list under Found names it, and the rest
are still removed. The feature keeps the limits, not the faces, so changing a
limit or an earlier feature finds the rounds and holes again. An imported
mesh needs [Mesh to Solid](meshToSolid.md) first; to remove one particular
face, use [Remove Faces](removeFaces.md).
<!-- /notes -->
