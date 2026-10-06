# P4-12: Project — silhouettes of every surface, Intersect, bodies

Native harness for ADR-0031's amendment (P4-12): the facade's
`faceSilhouettes` on spheres, tori and free-form faces (OCCT's
`Contap_Contour`, the contour finder `HLRBRep_Algo` runs per face),
`sectionWithPlane` (Intersect) and `edgeVisibility` (a body's edges through
`HLRBRep_Algo`). It includes the facade with `#define private public`.

    bash spikes/p4-12-project/run.sh             # the checks (exits 1 on a failure)
    bash spikes/p4-12-project/run.sh leaks 100   # heap top after 100 and 500 rounds of every call

Needs Docker and the pinned image (`OCCT_IMAGE`, default `74e2918318e4`); on the
Ubuntu machine run it through `sg docker -c '…'`. The results are in
`docs/adr/0031-sketch-on-face-and-project.md`'s amendment.
