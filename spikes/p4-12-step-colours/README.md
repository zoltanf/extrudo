# P4-12: STEP colours (XDE)

Native harness for ADR-0034's amendment (P4-12): the facade's
`readStepColors` (a STEP file read through `STEPCAFControl_Reader` into an XCAF
document that lives only for the call) and `writeStep`'s coloured path
(`stageStepColor`, `STEPCAFControl_Writer`). It includes the facade with
`#define private public`.

    bash spikes/p4-12-step-colours/run.sh             # the checks (exits 1 on a failure)
    bash spikes/p4-12-step-colours/run.sh leaks 500   # heap top after 520 and 2520 rounds

Needs Docker and the pinned image (`OCCT_IMAGE`, default `74e2918318e4`). The
results are in `docs/adr/0034-export-stl-3mf-step.md`'s amendment.
