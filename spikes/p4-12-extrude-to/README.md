# P4-12: extrude "to object" on curved faces and bodies

Native harness for ADR-0028's amendment (P4-12): a long prism cut back by a
face's extended surface (`extendFace` + boolean op 3, a split) or by a body
(boolean op 1, a cut), keeping the pieces that touch the profile. Prints the
volume table the ADR quotes.

    bash spikes/p4-12-extrude-to/run.sh

Needs Docker and the pinned image (`OCCT_IMAGE`, default `74e2918318e4`).
