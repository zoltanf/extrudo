# P6-05: STEP assemblies (XDE)

Native harness for ADR-0081 §7 (P6-05, slice S7): `writeStep`'s grouped path
(`clearStepGroups`, `pushStepGroup`, `pushStepGroupName`, the facade's
`writeStepAssembly`). It writes two parts in a group "Lid" and a loose part,
reads the file back through `STEPCAFControl_Reader`, prints the label tree and
checks names (a non-ASCII name staged as `\X2\…\X0\` is written as it is, not
doubled), the two `NEXT_ASSEMBLY_USAGE_OCCURRENCE`s, the colours and that the
plain and coloured paths are unchanged. It includes the facade with
`#define private public`.

    bash spikes/p6-05-step-assembly/run.sh             # the checks (exits 1 on a failure)
    bash spikes/p6-05-step-assembly/run.sh leaks 300   # heap top after 320 and 1520 rounds

Needs Docker and the pinned image (`OCCT_IMAGE`, default `74e2918318e4`).
Result (2026-10-10): all checks pass; the tree reads

    assembly 'Lid'
      reference '=>[0:1:1:2]'
        part 'Alpha'
      reference '=>[0:1:1:3]'
        part 'Beta'
    part 'Gämma'

and 1,200 grouped writes and colour reads grow the heap by 0 bytes.
