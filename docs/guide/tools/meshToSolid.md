---
title: Mesh to Solid
section: Tools
category: Modify
order: 47
---

# Mesh to Solid

Turn an imported mesh into a solid with real faces, so it fillets, shells and takes sketches like any body.

| Where | Shortcut |
|---|---|
| Modify › Modify | None |

<video src="demo:meshToSolid" muted loop autoplay playsinline aria-label="Mesh to Solid demo"></video>

<!-- notes -->
Use **Faceted** for a part made of flat faces: it keeps every flat facet as a face and is exact. Use **Prismatic** for a part with holes and rounds: it finds the planes, cylinders, cones, spheres and tori within a tolerance and rebuilds them as exact surfaces; what fits none of them (a freeform patch, a thread) stays as flat facets, and the Result line says how many ("3 unfit regions kept as 318 facets"). The tolerance is **Auto** by default: the kernel picks one from the mesh (0.01 to 0.1 mm) and the Result line names it ("· auto 0.02 mm"); choose **Custom** to set it yourself. The conversion is refused above 5,000 faces (Faceted) or 5,000 facets (Prismatic), and the message names the count.
<!-- /notes -->
