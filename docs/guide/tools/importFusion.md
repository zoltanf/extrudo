---
title: Import .f3d
section: Tools
category: Home
order: 8
---

# Import .f3d

Open an Autodesk Fusion .f3d file as a new design: its parameters, sketches, extrudes, fillets and chamfers.

| Where | Shortcut |
|---|---|
| Home › Files | None |

<!-- notes -->
The import rebuilds the design's timeline in Extrudo rather than copying its
shape: user parameters, sketches on the origin planes (or planes parallel to
them), extrudes, fillets and chamfers become ordinary Extrudo features you can
edit. Anything it can't bring over yet — holes, revolves, patterns, components,
extrudes that start from a face, sketches on tilted planes — is listed in a
notice when the new design opens, so you know what to redo. The `.f3d` format
is not published; the import is worked out from real files and may miss
things.
<!-- /notes -->
