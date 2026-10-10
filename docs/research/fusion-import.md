# Can Extrudo import Fusion 360 designs? (research, 2026-10-09)

Research only: no product code changed. **Deferred by the owner on 2026-10-10** (`docs/03-roadmap.md`, Open decisions 5); later that day the owner chose to read `.f3d` directly after all (ADR-0082, `@extrudo/f3d`), against this document's route B advice. The probe script is
`spikes/fusion-import/inspect_f3d.py`. Not legal advice: section 2 lists what
the owner should have checked by a lawyer.

## Summary

- An `.f3d` file is a ZIP archive. The bodies are Autodesk ShapeManager
  ("ASM") binary B-reps, a fork of ACIS. The **full parametric history**
  (sketches, dimensions, features, parameters, the timeline) is in the file
  too, but only as an undocumented, versioned binary object stream. Files saved
  in 2026 also compress their entries with Zstandard (ZIP method 93).
- No open-source project reads the history to a usable degree, and no
  maintained open-source reader turns ASM B-reps into OCCT shapes.
- **Recommendation, in this order:**
  1. **Route A, now (1–2 slices):** document "export STEP from Fusion",
     and make our STEP import keep body and part names (colours already
     come through).
  2. **Route C, then (6–8 slices):** a small MIT-licensed Fusion add-in that
     the user runs inside Fusion. It writes a documented JSON "Fusion
     interchange" file. Extrudo replays that file through `@extrudo/api` and
     the kernel into an editable timeline, and anything that doesn't map
     falls back to the STEP bodies.
- **Don't** parse `.f3d` history (route B). Parsing only the geometry is
  possible but costly and fragile. It is worth it only if many users ask to
  open shared `.f3d` files without Fusion.
- **Don't** use Autodesk Platform Services (route D): it needs accounts, keys,
  a paid quota and cloud upload, and gives back only geometry.

---

## 1. The file formats

### 1.1 What we inspected

The samples are six files from public GitHub repositories with
open-hardware or free licences. Each was downloaded into its own scratch
directory, read in memory with `python3 -I`, and not committed.

| Sample (repository, licence) | Saved | Size | ZIP method | ASM version in the B-rep header |
|---|---|---|---|---|
| `jig.f3d` (GadgetAngel/Voron2.4_My_Build_Log, GPL-2.0) | 2020-09 | 96 kB | store/deflate | `ASM 226.5.1.65535 OSX` |
| `Voron_Design_Cube_v7.f3d` (matthewlloyd/Voron-Parametric, GPL-3.0) | 2021-09 | 344 kB | store/deflate | – |
| `Ball Joint.f3d` (cadop/fusion360descriptor, MIT) | 2022-07 | 1.1 MB | store/deflate | ASM BinaryFile4 |
| `charging-box.f3z` (HULKs/hulk, GPL-3.0) | 2024-07 | 5.1 MB | deflate (outer), store/deflate (inner `.f3d`) | `ASM 230.4.0.65535 OSX` |
| `motor_arm.f3d` (Stefanos0710/Odonata, MIT) | 2026-05 | 691 kB | **93 (Zstandard)** for 16 of 30 entries | `ASM 232.3.0.65535 NT` |
| `Ultrasonic_PCB_2.0.f3d` (Kushal-Sachdeva78/VVS-Ballers-RoboCup, MIT) | 2026-05 | 5.3 MB | **93** for 23 of 38 entries | – |

Many repositories hold only Git LFS pointers (about 130 bytes); GitHub's media
endpoint serves the real files.

### 1.2 Inside an `.f3d`

All the samples are ZIP archives. The layout of a 2026 file is below; older
files have `Design1/` instead of the three `Fusion*SegmentType1/` folders, and
have no `OGS.BlobFolder/`.

| Entry | Kind | What we saw |
|---|---|---|
| `Manifest.dat` | binary | Length-prefixed strings; starts with `07 00 00 00 "3-2-0-0"` (a format version) |
| `Properties.dat` | text after a length prefix | 2026: `{"docstruct":{"version":"1.0.0","type":"part-design","subtype":"part-standard"…}}`; older: `{}` or 4 zero bytes |
| `[Content_Types].xml`, `core.xml`, `cnx.xml`, `autodesk-design-package.xml` | XML | An OPC-style package wrapper |
| `FusionAssetName[Active]/Manifest.dat` | binary, UTF-16 strings | Asset table |
| `…/FusionDesignSegmentType1/MetaStream.dat` and `BulkStream.dat` (`Design1/` before) | binary | **The design itself.** MetaStream starts with `"FusionDesign"` (`"Design"` in older files); BulkStream with `03 00 00 00 "409"` (a schema revision; 311 in 2022, 383 in 2020) |
| `…/FusionBrowserSegmentType1/…`, `…/FusionACTSegmentType1/…` | binary | Browser tree and another segment (purpose unknown) |
| `…/Breps.BlobParts/BREP.<uuid>.smb` / `.smbh` | binary | ASM binary B-rep; magic `ASM BinaryFile4` or `ASM BinaryFile8`, then `Autodesk Neutron`, the ASM version and the save date. 5 kB to 18 MB each |
| `…/OGS.BlobFolder/OGS/DefaultScene/…` | binary | 2026 only: display scene and tessellated meshes (`stream_mesh_000`, `Fusion_mesh_0`; raw floats) |
| `…/ProteinAssets.BlobParts/*.protein` | nested ZIP | Appearances and materials |
| `F8CB9D34-…/Schemas/*.xml`, `AssetData/*` | XML and binary | Material schemas (physical, render) |
| `…/DesignConfigurationTable.BlobParts/*.dsgcfg` | JSON | Configuration tables (2024+); `{}` when unused |
| `…/Previews/small.png` | PNG | Thumbnail |

**The history is in the file.** The 2024 charging box's `BulkStream.dat`
(5 MB) contains a type table with these names:

- `DcSketchMetaType`, `DcExtrudeFeatureMetaType`, `DcFilletEdgeFeatureMetaType`,
  `DcChamferFeatureMetaType` and `DcShellFeatureMetaType`;
- `DcCombineFeatureMetaType`, `DcSplitBodyFeatureMetaType`,
  `DcOffsetFacesFeatureMetaType`, `DcMirrorPatternMetaType` and
  `DcWorkPlaneMetaType`;
- `DcCreateComponentMetaType` and `DcJointAssembleFeatureMetaType`.

The same file holds UTF-16 strings of feature and dimension names in the
user's language ("Extrusion", "Skizze", "Abrundung", "Fase", "Linear
Dimension-3", "Diameter Dimension-2"), of expressions as typed ("2 mm",
"0.0 deg", "45 mm") and of input names ("TaperAngle", "AlongDistance",
"Side1Offset", "ProfileOffset", "mirrorStitchTolerance").

The 2026 `motor_arm.f3d` shows `DcSketchMetaType`, `DcExtrudeFeatureMetaType`,
`DcFilletEdgeFeatureMetaType`, `DcMoveFeatureMetaType` and
`DcDeleteFaceFeatureMetaType`. The 2022 ball-joint file is a direct-model
design: it shows only `DcBaseFeatureMetaType` (bodies with no history) and
joints.

The records themselves are binary: GUIDs, length-prefixed strings and
little-endian numbers with no type tags. The **sketch geometry is in the ASM
blobs**: the `.smb` entries carry `sketch_attrib_def` attributes with `straight`
and `ellipse` curves.

**Conclusion:** the history is present but readable only by decoding
Autodesk's private object serialisation. Its schema revision moved from 311
(2022) to 383, 409 and beyond (2020–2026). ezf3d records the same drift
between revisions 269 and 489 in its four samples
([ezf3d unknowns.md](https://github.com/AlexSabaka/ezf3d/blob/main/docs/format/unknowns.md)).

### 1.3 `.f3z`

A `.f3z` is a ZIP archive that holds:

- one `.f3d` per design;
- `Manifest.json` (`{"root":"<guid>.f3d"}`);
- `DesignDescription.json` (names, cloud URNs, the reference graph, and the
  version, here 25);
- `pim.zip` (JSON "product information model": part numbers, configurations).

Autodesk describes it as a design packed with its external references
([Autodesk support](https://autodesk.com/support/technical/article/How-to-make-a-local-archive-back-up-file-in-Fusion-360);
link as reported, not opened here).

### 1.4 ShapeManager, SMT/SMB and ACIS SAT/SAB

- **History.** Autodesk ShapeManager was forked in 2001 from ACIS 7.0, which
  Autodesk licensed from Spatial, and it has diverged since. Spatial's
  lawsuit over the fork failed in 2003, and the appeal was lost in 2006
  ([Wikipedia: ShapeManager](https://en.wikipedia.org/wiki/ShapeManager)).
- **SMT and SMB** are ShapeManager's text and binary save formats; the
  blobs above are SMB.
- **The binary layout** uses ACIS SAB's token scheme, but the magic word is
  `ASM` instead of `ACIS`, the entity and attribute names are Autodesk's,
  and history sections are interleaved with the records
  ([ezf3d asm.md](https://github.com/AlexSabaka/ezf3d/blob/main/docs/format/asm.md)).
  Our samples match: `asmheader`, `coedge`, `vertex`, `straight`, `ellipse`,
  `intcurve`, `surface`, `ATTRIB_CUSTOM`, `int_int_cur`.
- **Exchange with ACIS.** Fusion imports SAT only up to ACIS 7
  ([Autodesk: supported file formats](https://help.autodesk.com/cloudhelp/ENU/Fusion-Designs/files/TPD-SUPPORTED-FILE-FORMATS.htm)).
  A SAT reader therefore does not read current SMB without
  ShapeManager-specific work, and the format changed between ASM 226 and
  232 in our samples alone.
- **No public specification.** No openly licensed specification exists for
  SAT, and none at all for SMT/SMB. The only copy of Spatial's "Save File
  Format" chapter we found is a third-party upload marked All Rights
  Reserved (unverified).

---

## 2. Legal standing

CLAUDE.md's rule, "Fusion 360 is a conceptual reference only", governs
*copying Fusion*. Its code, icons, images, text and branding stay out of the
repository, and nothing below changes that. Reading **a user's own design
file** or **a user's own design through Fusion's API** is a different act.

### 2.1 Autodesk's terms

Source: the General Terms, last updated 2026-03-30. We read the Wayback copy
of [autodesk.com/company/terms-of-use/en/general-terms](https://www.autodesk.com/company/terms-of-use/en/general-terms),
which matches the [2023 PDF](https://www.dlt.com/sites/default/files/documents/2024-11/2023-TOU-General-Terms-Final.pdf).

- **§5 "You Own Your Work".** The user keeps ownership of "files, designs,
  models, data sets … created by You". The output of the offerings carries
  no use restriction.
- **§13 Proprietary rights.**
  - It says: "You will not engage in any decompiling, disassembling, or other
    reverse engineering, or otherwise attempt to discover, learn, or study
    the structure … protocols, **data structures or other externals** …
    **except as expressly permitted under applicable law notwithstanding a
    contractual prohibition to the contrary**."
  - It also forbids accessing the offerings "by any means other than the
    interface Autodesk provides or authorizes".
  - Studying the `.f3d` layout is arguably within this ban, which leaves only
    what the law guarantees regardless of contract.
- **§8.3 APIs.** The APIs may be used "to develop applications, services,
  modules, or components solely for Your internal business use". Commercial
  software needs a separate developer licence.
  - A free add-in that we publish and that users run on their own designs is
    not clearly "internal business use". **The owner should get a legal
    opinion on this point.**
  - In practice, Autodesk's own GitHub organisation, AutodeskFusion360,
    publishes 15 of its 34 repositories (add-in samples among them) under MIT
    (counted with the GitHub API).
  - Open-source exporter add-ins exist under MIT: fusion2urdf
    ([syuntoku14/fusion2urdf](https://github.com/syuntoku14/fusion2urdf)) and
    fusion360descriptor ([cadop/fusion360descriptor](https://github.com/cadop/fusion360descriptor)).
- **Consumers.** EU consumers contract with Autodesk Ireland under Irish law,
  keeping "the protections granted to You by the law of the country where you
  live" (§19.1(d)).

### 2.2 Fusion for personal use

- **Who may use it:** non-commercial users earning less than USD 1,000 a year
  from it ([Autodesk](https://www.autodesk.com/products/fusion-360/personal)).
- **What it can export**, per
  [the supported-formats page](https://help.autodesk.com/cloudhelp/ENU/Fusion-Designs/files/TPD-SUPPORTED-FILE-FORMATS.htm):
  - F3D, **STEP**, SMT, STL, OBJ and 3MF can be exported on personal use;
  - IGES, SAT/SAB, SMB and File > Export DXF are commercial only.
- **STEP stays.** It was kept after the 2020 backlash ("STEP export will
  remain available for Fusion for personal use",
  [Autodesk blog, 2020-09-25](https://www.autodesk.com/products/fusion-360/blog/changes-to-fusion-360-for-personal-use/)).
- **The API stays.** The same post says personal users "will still be able
  to leverage our API" and keep add-ins.
  - Unverified: whether any API export call is limited per licence.

### 2.3 The law

- **EU.**
  - Directive 2009/24/EC, [EUR-Lex](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32009L0024):
    - art. 1(2): the ideas behind interfaces are not protected;
    - art. 5(3): a lawful user may observe, study and test the program;
    - art. 6: decompiling is allowed when it is indispensable for
      interoperability, limited to the parts needed, and the information may
      not be used for a substantially similar program;
    - **art. 8: contract terms contrary to arts. 5(3) and 6 are void.**
  - *SAS Institute v World Programming* (C-406/10,
    [EUR-Lex](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:62010CJ0406))
    held that "the format of data files used in a computer program" is not
    protected expression.
  - So black-box analysis of one's own data files arguably involves no
    restricted act at all.
- **US.** 17 USC §1201(f) exempts interoperability analysis from the
  anti-circumvention rules ([Cornell LII](https://www.law.cornell.edu/uscode/text/17/1201)),
  and *Sega v Accolade* (1992) and *Sony v Connectix* (2000) found reverse
  engineering for compatibility to be fair use. But *Bowers v Baystate* (Fed.
  Cir. 2003) and *Davidson v Jung* (8th Cir. 2005) enforced contractual bans
  on reverse engineering. **In the US a click-through ban can bind the
  person who agreed to it.** Case links via Justia, not opened one by one:
  unverified links.

### 2.4 How other projects handled proprietary formats

- **DWG.**
  - Autodesk's disputes with the Open Design Alliance (2006–07, the
    "TrustedDWG" marker) and with SolidWorks (2010) were about trademarks, not
    about reading the format. Autodesk's 2010 statement said it "does not
    preclude ODA from developing interoperable software"
    ([Wikipedia: .dwg](https://en.wikipedia.org/wiki/.dwg),
    [Open Design Alliance](https://en.wikipedia.org/wiki/Open_Design_Alliance)).
  - **LibreDWG** is a GNU project under GPL-3.0 and still maintained (pushed
    2026-10-03; [GitHub](https://github.com/LibreDWG/libredwg)). We found no
    record of action against it.
  - **FreeCAD** does not bundle a DWG reader: it calls the user's own ODA
    File Converter or LibreDWG
    ([FreeCAD wiki](https://wiki.freecad.org/FreeCAD_and_DWG_Import)).
- **Samba** got Microsoft's protocol documentation after the EU competition
  case: a €10,000 fee and an NDA, with GPL code allowed
  ([samba.org/PFIF](https://www.samba.org/samba/PFIF/)).
- **OpenOffice's `.doc` filters** were reverse-engineered years before
  Microsoft published the specification in 2008
  ([Wikipedia: Doc](https://en.wikipedia.org/wiki/Doc_(computing)); general
  knowledge, unverified here).
- **GitHub's DMCA repository** holds 14 Autodesk notices from 2016 to 2025.
  Every one targets leaked source code, credentials or cracks; none targets a
  file-format reader ([github/dmca](https://github.com/github/dmca)). Absence
  of evidence is not proof.

### 2.5 What this means

| | Assessment |
|---|---|
| **Clearly fine** | Reading STEP, STL or 3MF files a user exported (route A). Documenting the workflow. Naming "Fusion 360" factually ("import from Fusion 360") without its logo or trade dress. |
| **Fine in our reading, owner to confirm** | An add-in we write ourselves against the public API, which reads the user's open design and writes our own format (route C). The user acts on their own data through the interface Autodesk provides. **Open point: §8.3's "internal business use" wording for a published add-in.** License the add-in **MIT**, as Autodesk's own samples are. A GPL add-in that imports Autodesk's proprietary `adsk` module raises the question of a GPL work combined with a non-free library. MIT avoids it, and the add-in carries no Extrudo code. Distribute it from our GitHub, not the Autodesk App Store, whose guidelines are wary of GPL ([guidelines](https://apps.autodesk.com/Publisher/ProductGuidelines)). |
| **Grey area** | A clean-room reader of `.f3d` (route B). It is defensible in the EU (format not protected; art. 8 voids the contract clause against interoperability work) and riskier in the US, where §13 may bind contributors who agreed to Autodesk's terms. Any reader must be written by people who never decompiled Fusion, from files alone, documented as such. Reusing ezf3d (MIT) or cq-acis (MIT) needs their notices. InventorLoader is GPL-2.0; whether "or later" is in its file headers is unverified. |
| **Avoid** | Decompiling or disassembling Fusion or ShapeManager binaries. Using leaked Autodesk documentation or code. Using Spatial's All-Rights-Reserved SAT manual from third-party sites. Committing sample `.f3d` files whose licence is unclear. Using the Fusion 360 Gallery dataset's files as fixtures: their licence is non-commercial research, no redistribution ([LICENSE.md](https://github.com/AutodeskAILab/Fusion360GalleryDataset/blob/master/LICENSE.md)). |

---

## 3. Existing open-source readers

| Project | Reads | Licence | State | Fit for our stack |
|---|---|---|---|---|
| [InventorLoader](https://github.com/jmplonka/InventorLoader) (FreeCAD workbench) | Inventor `.ipt`, ACIS SAT/SAB, Fusion `.f3d` bodies via its ACIS reader (`importerF3D.py`, `Acis.py`, `Acis2Step.py`) | GPL-2.0 (LICENSE file; "or later" unverified) | Python; last push 2024-12-17; 169 stars. Uses `zipfile`, so it cannot open 2026 Zstandard entries on Python < 3.14 | Bodies only, no history. Python + FreeCAD: not runnable in our worker. Its ACIS→STEP converter is a reference for geometry mapping |
| [ezf3d](https://github.com/AlexSabaka/ezf3d) | `.f3d`/`.f3z` containers (incl. Zstandard), ASM B-rep (analytic surfaces; splines on its roadmap), display mesh, timeline order, parameters, sketch points and curves; constraints and most feature payloads undecoded | MIT | Python, "alpha", 1 star, single author, pushed 2026-08-28 | The best public format notes. Code would need porting to TypeScript. Its decoding is version-dependent |
| [cq-acis](https://github.com/monozukuri-ai/cq-acis) ([PyPI](https://pypi.org/project/cq-acis/)) | SAT 105/400/600/700, "selected SAB and Autodesk ShapeManager binary profiles", building CadQuery/OCCT shapes for analytic surfaces; NURBS experimental | MIT | Python, v0.3.9 released 2026-10-07, 0 stars | The closest thing to "ASM → OCCT". Whether it reads Fusion SMB: unverified |
| [ezdxf.acis](https://github.com/mozman/ezdxf/blob/stable/docs/source/acis.rst) | ACIS inside DXF, flat polygonal faces only | MIT | Maintained | Too narrow |
| OCCT, open edition | No SAT/SAB/SMT reader. ACIS import is a **commercial** Open Cascade component ([opencascade.com](https://www2.opencascade.com/components/acis-import-export-component)) | – | – | Not available to us |
| Open Design Alliance | SAT only through Spatial's modeler or ODA's C3D module ([ODA docs](https://docs.intellicad.org/files/oda/2023_10/oda_drawings_docs/drw_3d_modelers.html)); no Fusion/SMT support found | Membership, not GPL-compatible | – | No |
| DATAKIT, CAD Exchanger | Commercial converters; DATAKIT sells a Fusion→ACIS reader ([DATAKIT](https://www.datakit.com/cad-convertors/fusion-360-to-acis/92-5-0.html)) | Proprietary | – | No |
| [Fusion 360 Gallery dataset tools](https://github.com/AutodeskAILab/Fusion360GalleryDataset) | Not a reader: add-ins that **export** sketch + extrude sequences from Fusion to JSON (`reconstruction.md` schema), with `.smt`, `.step` and `.obj` per design | Repository NOASSERTION; dataset licence non-commercial; tools' licence unverified | Last push 2022-04 | A proof that route C works, and a schema to learn from (not to copy) |

We found no JavaScript or Rust reader of SAT, SMT or `.f3d`. Searches for
"sat2step" and "pyacis" found nothing; Mayo goes through OCCT and has no SAT
reader (unverified).

The competitors do not read `.f3d` either:

- Onshape refuses it ([forum](https://forum.onshape.com/discussion/comment/28194)).
- Shapr3D tells users to export Parasolid or STEP and says the history is
  lost ([Shapr3D help](https://support.shapr3d.com/hc/en-us/articles/15441903753116)).
- SolidWorks users go through STEP, Parasolid or ACIS.

---

## 4. The routes

### A. The user exports STEP from Fusion

- **Availability.** It works today: STEP export is on every Fusion licence,
  and our import (ADR-0066 slice 2) reads it with colours (P4-12).
- **What survives**, from community reports, not Autodesk documentation:
  - appearance colours do;
  - component structure and names do;
  - body names often come back as "Body<n>" in other tools
    ([forum](https://forums.autodesk.com/t5/fusion-support-forum/step-file-export-issue/m-p/11425836),
    [forum](https://forums.autodesk.com/t5/fusion-support-forum/imported-assembly-file-structure-has-bodies-vs-components/td-p/12726201)).
  - Which AP Fusion writes (214 or 242) is unverified. A real export's
    `FILE_SCHEMA` line would tell; we had no Fusion to make one.
- **Our side today:**
  - an import's bodies are named by our own rule, "Body<n>";
  - colours are read per solid;
  - the file's product names are **not** taken into body names (from
    `packages/kernel/src/features/import.ts`).
- **What the user gets:** dumb solids, exact B-rep, and faces named
  `import:<id>:face:<n>`. Fillets, holes and every other feature can build on
  top of them.
- **Gaps worth a slice:**
  1. take the STEP product (or instance) names into `BodyMeta.name` when
     the import first names the body, as colours are taken now;
  2. a guide page, "Bring a Fusion design over", that walks through the
     export: File › Export › STEP, one file per design, components kept.
- **Optional extra:** an API call, `STEPExportOptions.wantTempIds`, writes
  Fusion's face IDs into the STEP file
  ([API](https://help.autodesk.com/cloudhelp/ENU/Fusion-360-API/files/fusion_STEPExportOptions.htm)).
  This is not needed for route A, but route C can use it (section 5.4).

### B. Parse `.f3d` directly

There are two halves, and they are very different.

**B-geometry: read the ASM bodies.** The work, in order:

1. unzip with Zstandard;
2. parse ASM SAB for each schema version;
3. map ACIS geometry to OCCT: analytic surfaces are easy; B-spline surfaces
   need care; procedural surfaces (`intcurve`, offset and swept surfaces)
   need evaluating or approximating;
4. rebuild topology and sew it through new facade calls;
5. validate the result.

Assessment:

- **Effort:** 6–10 slices before it reads most files, then a never-ending
  slice per Fusion release that bumps ASM (226 → 232 in our samples).
- **What the user gets:** the same dumb solid as a STEP export, except they
  need no Fusion. That helps for `.f3d` files shared on GitHub, Printables
  and Thingiverse.
- **A cheaper variant:** read the 2026 files' tessellated display mesh
  (`OGS.BlobFolder`) as a mesh body (ADR-0066 slice 3). It is still an
  undocumented binary, it is absent from older files, and it gives only a
  mesh.
- **Risk:** high technically; legally a grey area (section 2.5).

**B-history: decode the timeline from `BulkStream.dat`.** This is a private,
untagged object serialisation whose schema changes with Fusion's monthly
releases. Even ezf3d, after months, has no constraints and few feature
payloads. **Not feasible to maintain**; reject it.

### C. Our own Fusion add-in (detailed in section 5)

A Python add-in reads the open design through Fusion's documented API and
writes an interchange file. Extrudo turns that file into a real, editable
timeline wherever the features map, with STEP bodies as the fallback. The
user needs Fusion (any licence, including personal use) and a one-time
add-in install.

### D. Autodesk Platform Services, Model Derivative API

- **What it is:** a cloud translation service. In 2017 it listed `.f3d` as
  input for STEP, IGES, STL and OBJ output
  ([APS blog, 2017](https://blog.autodesk.io/translatable-file-format-with-model-derivative-api-and-role/)).
  The current matrix is behind a token, so unverified.
- **What it needs:**
  - an APS app with a client ID and secret;
  - an upload of the user's file to Autodesk's cloud;
  - a positive Flex token balance (tokens expire after 12 months; the
    pricing pages conflict on the cost per job,
    [aps.autodesk.com/pricing](https://aps.autodesk.com/pricing)).
- **Fit:** none. Extrudo has no backend, ships no secrets in a public PWA,
  and sends no design anywhere. Each user would need their own developer
  account, and the result is the same dumb solid as route A. **Reject.**

### E. Other paths

- **Other Fusion exports.** On personal use Fusion exports SMT, which is
  just route B's parsing problem in text form. SAT/SAB and IGES are
  commercial only, and SAT would need a SAT reader we don't have. Fusion
  lists Inventor `.ipt` among its formats, but whether it *exports* one is
  unverified. None of these beats STEP for us.
- **Through FreeCAD.** A user with FreeCAD can open `.f3d` bodies through
  InventorLoader and export STEP. It is a valid user workaround to mention
  in the guide (no history; 2026 files need Python 3.14 or newer, which we
  did not test inside FreeCAD).
- **Mesh only.** STL, OBJ or 3MF from Fusion import as mesh bodies today.
  This is worse than STEP; mention it only for designs where STEP fails.

### Comparison

| Route | User gets | Effort (slices) | Technical risk | Legal standing | Needs |
|---|---|---|---|---|---|
| **A** STEP export | Dumb exact solids; colours; names after a small fix | 1–2 | Low | Clearly fine | Fusion to export (any licence) |
| **B-geometry** read ASM in `.f3d` | Dumb solids without Fusion | 6–10, plus upkeep per ASM version | High (undocumented, versioned, procedural geometry) | Grey: fine in the EU in our reading, contract risk in the US | Zstandard decoder (e.g. fzstd), new facade calls |
| **B-history** decode the timeline | Editable timeline, in theory | Unbounded | Very high | Grey | – |
| **C** our add-in | **Editable timeline** where features map; STEP fallback; parameters | 6–8 | Medium (mapping and references) | Fine in our reading; §8.3 to be confirmed by the owner | Fusion (any licence) plus installing an add-in |
| **D** APS cloud | Dumb solids | 3–4 plus a backend | Medium | Fine, but against our no-backend, privacy-first posture | APS account, keys, Flex tokens, upload |
| **E** SMT, SAT, FreeCAD, mesh | Dumb solids or meshes | 0 (docs) to B's cost | – | Fine (exports); grey (SMT parsing) | Various |

---

## 5. Route C in detail

### 5.1 What Fusion's API exposes

The API docs
([Features](https://help.autodesk.com/cloudhelp/ENU/Fusion-360-API/files/fusion_Features.htm),
[Sketch](https://help.autodesk.com/cloudhelp/ENU/Fusion-360-API/files/fusion_Sketch.htm),
[Timeline](https://help.autodesk.com/cloudhelp/ENU/Fusion-360-API/files/fusion_Timeline.htm),
[Parameter](https://help.autodesk.com/cloudhelp/ENU/Fusion-360-API/files/fusion_Parameter.htm))
cover everything the add-in needs.

- **Timeline.** Items in order with `entity`, `isSuppressed`, `healthState`
  and `name`; timeline groups; the marker position.
- **Parameters.** User parameters and model parameters with `name`,
  `expression`, `unit`, `value`, `comment` and their dependencies.
- **Sketches.**
  - Curves, points, `geometricConstraints`, `sketchDimensions` (each with its
    driving parameter), profiles, the reference plane and the sketch's
    transform.
  - `isReference` marks projected or included geometry, and construction
    flags are exposed.
- **Features.**
  - A collection per type, with its definition. For example, an extrude
    gives its extents (one and two), its start extent, operation, profile,
    taper angles and participant bodies.
  - Its start, end and side faces are exposed as well, and reading them
    needs no roll-back
    ([ExtrudeFeature](https://help.autodesk.com/cloudhelp/ENU/Fusion-360-API/files/fusion_ExtrudeFeature.htm)).
- **B-rep.**
  - Bodies, faces and edges with exact geometry (surface type, evaluators),
    and per-body physical properties (volume, area, bounding box).
  - `entityToken` with `findEntityByToken` is persistent inside Fusion, but
    the strings are opaque and not comparable
    ([entityToken](https://help.autodesk.com/cloudhelp/ENU/Fusion-360-API/files/BRepFace_entityToken.htm)).
- **Export.** `ExportManager`: STEP, SMT, STL, 3MF, OBJ, F3D and others
  ([ExportManager](https://help.autodesk.com/cloudhelp/ENU/Fusion-360-API/files/fusion_ExportManager.htm)).
- **Files.** The Gallery tools write JSON and STEP from inside Fusion, so an
  add-in can write files. That the full Python standard library is
  available is inference, not documented.

The units are Fusion's internal centimetres and radians: the add-in converts
to mm and degrees. Expressions are stored as typed.

### 5.2 Architecture

```
Fusion (user's machine)                      Extrudo (browser or CLI)
┌──────────────────────────────┐             ┌────────────────────────────────┐
│ extrudo-export add-in        │  .fusion-   │ @extrudo/fusion (new, GPL)      │
│ (Python, MIT, ours)          │  extrudo    │  parse + check (zod)            │
│  walk timeline → JSON        │ ──────────▶ │  replay with @extrudo/api       │
│  + final bodies as STEP      │  (zip)      │  resolve face/edge refs against │
│  + per-step body checks      │             │  our kernel (worker / CLI)      │
└──────────────────────────────┘             │  fallback: STEP import          │
                                             └────────────────────────────────┘
```

- **The add-in only reads and writes data.** It is a few files of Python
  that know Fusion's API and nothing about Extrudo's internals. It writes a
  zip holding `fusion.json` (the interchange) and `bodies.step` (the final
  bodies, as fallback and check).
- **The interchange is ours and documented** (a `docs/fusion-interchange.md`
  under MIT, like `docs/file-format.md`) and versioned. It is a neutral
  description: units already converted, Fusion's own type names kept as data.
- **The importer is a new package, `@extrudo/fusion`.** It is GPL and depends
  on core, api and sketch.
  - Its pure part turns `fusion.json` into `@extrudo/api` calls. Sketches
    become `d.sketch(...)` with builder calls; features use their generated
    methods. So every change is a core command, and IDs and names follow
    the app (ADR-0068).
  - Its kernel part runs where a kernel already is: the app's `Recomputer`,
    or the CLI's `openDesign` (ADR-0069). It replays feature by feature and
    resolves references between steps (5.4).
  - The app offers it as Home › Import ("Import from Fusion…", `.fusion-extrudo`);
    the CLI as `extrudo import-fusion in.fusion-extrudo out.extrudo`.
- **Why not have the add-in write `.extrudo` or a Script directly?**
  - It cannot name our faces: face, edge and vertex names come from our
    kernel's naming tables (file-format §8).
  - Emitting TypeScript (ADR-0073) would still need those names.
  - Script limits (1,000 features, 100,000 characters) would cap big
    designs.
  - Python would duplicate our schema and fall behind it.
  - A plain JSON file plus a TypeScript importer keeps all Extrudo
    knowledge in this repository.

### 5.3 Fallback and checks

- **Fallback.**
  - The replay stops at the **first feature that doesn't map**, or the first
    reference it can't resolve.
  - Everything before it stays as an editable timeline, inside a
    **suppressed group "From Fusion (editable)"**.
  - The design's bodies come from `bodies.step` as one Import feature
    (exact, coloured, named after the slice-1 fix), so the user always gets
    the right final shape.
  - When everything maps, the group is not suppressed and no Import feature
    is added.
  - A dialog lists what didn't map and why.
- **Checks.** The add-in records each body's volume, area and bounding box
  after every feature (Fusion's physical properties). The importer compares
  them with our `KernelApi.inspect` after each replayed step: within 0.1 %
  passes; outside it the step counts as unmapped. This catches silent
  mismatches, such as a pattern whose instance count rule differs, before
  the user builds on them.
- **Components.**
  - Extrudo has no assemblies, so a multi-component design is **flattened**:
    each occurrence's bodies are placed by a Move feature (or the STEP
    import's placement), and joints are dropped with a note.
  - A body keeps its name, prefixed with the component's name when names
    collide.
- **Direct-model designs** (no history, as in the ball-joint sample) are
  pure fallback: the STEP bodies.

### 5.4 References to faces and edges

Fusion's tokens are opaque and our names (ADR-0005, `extrude:E:cap:end`,
`e[…|…]`) exist only after our kernel computes. So **references are carried
as geometry and resolved by our kernel**:

1. **What the add-in writes.** For every face, edge or vertex a feature
   refers to, it writes:
   - the timeline index of the feature that created it;
   - a role hint where the API offers one: an extrude or revolve's
     `startFaces`, `endFaces` or `sideFaces`, plus the sketch curve whose
     side it is;
   - a geometric signature: surface or curve type, a point on it (face:
     a point inside; edge: its middle), the normal or tangent there, radius,
     area or length.
2. **What the importer does.**
   - It recomputes up to that feature, then finds the matching face among
     ours: same type, the point within 1 µm of the face, the normal within
     0.01°, and area or length within 0.1 %.
   - The match goes through the display meshes and `BodyMesh.faceIds`, as a
     pick does, then `KernelApi.reference` for the persistent name and
     fingerprint (ADR-0026, ADR-0005). **No facade change.**
   - Role hints come first: an extrude's end cap is `handle.face('cap:end')`
     without any geometry (ADR-0068's face roles).
3. **What it builds.** Profiles are matched by an interior point
   (`s.profileAt([x, y])`, the API's own way); sketch curves by their
   entity map. Origin planes and axes map directly, though Fusion's and our
   sketch frames differ, see 5.6.
4. **When it fails.** No match, or two matches, ends the editable part
   there (5.3). A guess is never stored.

Once stored, the references behave like any other: they survive upstream
edits through our naming. The geometry was only needed once, at import.

### 5.5 Feature mapping

**Legend:** ✅ maps cleanly · ≈ maps with an approximation or a lost option
(the importer warns) · ✗ no equivalent (fallback).

| Fusion feature | Extrudo | Map | Notes |
|---|---|---|---|
| Sketch (on origin plane, construction plane or planar face) | `sketch` | ✅ / ≈ | Frames differ: re-express coordinates in `sketchFrame` (5.6). 3D sketch curves and points off the plane ✗. Sketches on non-planar targets ✗ |
| Extrude (distance, symmetric, two sides, to object, through all; taper; new/join/cut/intersect) | `extrude` | ✅ | `symmetricMeasure` covers Fusion's whole vs. per-side symmetric. **Start offset** (offset start, from-object start) has no input: ≈ via an offset construction plane only if the profile's sketch is rebuilt there; else fallback. "New component" operation → new body |
| Revolve (angle, full, symmetric, two sides, to object) | `revolve` | ✅ | Axis: origin axis, sketch line or straight edge, all supported |
| Sweep (path, orientation, twist, taper) | `sweep` | ≈ | Guide rail ✗. Fusion's taper is not our end scale (different definition); compare by the body check |
| Loft (sections, closed, ruled) | `loft` | ≈ | Rails, centreline and end conditions (tangent, point) ✗ |
| Rib / Web | `rib` | ≈ | Ours is web-like from one straight line; Fusion's rib depth options and curved-line ribs ✗ |
| Emboss | `emboss` | ≈ | Flat, cylindrical, conical and projected; Fusion's "emboss tangent to face" ✗ (ADR-0060 deferred) |
| Hole (simple, counterbore, countersink; blind, through, to object; drill point) | `hole` | ≈ | Blind and through ✅; "to object" ✗. Tapped hole: modeled → our `thread` after the hole; cosmetic → dropped with a note |
| Thread (modeled; ISO, UNC/UNF, …) | `thread` | ≈ | Map designation to `THREAD_PRESETS` where it matches; cosmetic threads dropped |
| Coil | `coil` | ✅ | Type, section and position map |
| Box, Cylinder, Sphere, Torus | `box`, `cylinder`, `sphere`, `torus` | ✅ | Pipe ✗ (could be a sweep of a circle) |
| Fillet (constant, variable, setback) | `fillet` | ✅ / ≈ | Constant and two-end variable ✅ (32 sets). Mid-point radii, setback corners, chord length ✗. Rule fillet ✗ |
| Chamfer (equal, two distances, distance and angle) | `chamfer` | ✅ | The reference face maps to a set's `face`. Corner type options ✗ |
| Shell (inside, outside, both; per-face thickness) | `shell` | ≈ | Inside and outside ✅, wall sets ✅; "both" ✗ |
| Draft (fixed plane, pull, angle) | `draft` | ✅ | Parting-line draft ✗ |
| Scale (uniform, non-uniform) | `scale` | ✅ | |
| Combine (join, cut, intersect, keep tools) | `combine` | ✅ | "New component" → bodies stay |
| Split Body (by plane or face) | `splitBody` | ≈ | Plane or flat face ✅; curved or sketch-curve splitting tools ✗ |
| Split Face, Replace Face, Delete Face, Patch, Thicken, Boundary Fill | – | ✗ | Surface operations: fallback |
| Offset Faces, Press Pull | `offsetFace` (or `extrude`, `fillet`) | ✅ | Press Pull is stored by Fusion as the feature it became |
| Move/Copy (free, translate, rotate, point to point) | `move` | ✅ / ≈ | Bodies ✅; moving **components** → flatten (5.3); "Align" ✗ |
| Mirror (bodies, features, faces) | `mirror` | ≈ | Faces ✗ |
| Rectangular, Circular, Path Pattern (bodies, features) | patterns | ≈ | Spacing/extent, symmetric, skipped instances ✅; faces and components ✗; Fusion's "suppress instance" → `skip` labels where positions match |
| Construction planes (offset, at angle, tangent, midplane, two edges, three points, tangent at point, along path) | `offsetPlane`, `planeAtAngle`, `tangentPlane`, `midplane`, `planeThroughPoints`, `planeAlongPath` | ✅ / ≈ | "Through two edges" ✗ (or `planeThroughPoints` on three of their end points) |
| Construction axes (through cylinder, two points, edge, two planes, perpendicular at point, normal to face at point) | `axisThroughCylinder`, `axisThroughPoints`, `axisAlongEdge` | ≈ | Two planes and the perpendicular axes ✗ |
| Construction points (vertex, two edges, three planes, centre of circle/sphere/torus, edge and plane, along path) | `constructionPoint`, `pointAtIntersection`, `pointOnPath` | ✅ / ≈ | Sphere and torus centre ✗ |
| Canvas, attached image | `canvas` | ≈ | Image bytes are an attachment; calibration maps to `width` |
| Insert SVG / DXF | `sketch` with imported curves | ✅ | The add-in exports sketch geometry anyway |
| Insert Mesh, mesh features | `import` (mesh) | ≈ | Export the mesh body as 3MF in the zip; mesh editing features ✗ |
| Base Feature (direct edits), T-spline Form, sheet metal, surface bodies | – | ✗ | Fallback: STEP. A surface body (not closed) is skipped with a note |
| Joints, rigid groups, motion | – | ✗ | Flattened at the joint's current position |
| Timeline groups | `groups` | ✅ | Ends become `first`/`last` (ADR-0065) |
| Suppressed features | `suppressed` | ✅ | |
| User parameters | `parameters` | ✅ / ≈ | See 5.6 for expressions |
| Model parameters (`d1` …) of sketch dimensions | named driving dimensions | ✅ | Keep Fusion's names when they don't clash |
| Model parameters of feature inputs | the input's expression | ✅ | Their names are dropped (we don't name feature inputs); expressions referring to them get the expression inlined |
| Configurations (2024+ tables) | `configurations` | ≈ | Only rows that set parameter values; suppression and appearance columns ✗ |
| Appearances | `BodyMeta.color`, `opacity` | ≈ | Colour of the body's appearance; textures and face appearances ✗ |
| Materials | – | ✗ | Could set Print Info's material: out of scope |
| Components | – | ✗ | Flattened (5.3) |

### 5.6 Sketches and parameters

- **Sketch entities:**
  - lines, circles, arcs, points, ellipses, conic curves, and fit-point and
    control-point splines (closed too) all map to their types;
  - an **elliptical arc** has no entity of ours: it becomes a control spline
    of four poles per ≤ 45°, as the drawing import does (ADR-0066 slice 1),
    so it is exact;
  - text maps to the `text` entity only when its font is one of ours or
    the add-in can export the font file (fonts are licensed, so default to
    a note and Inter);
  - projected and included geometry (`isReference`) becomes a projection
    (`projections`, kept linked) when its source is a face or edge we
    resolved; else plain fixed curves.
- **Constraints:**
  - coincident, collinear, concentric, midpoint, parallel, perpendicular,
    horizontal, vertical, tangent, smooth, equal, symmetric and fix map one
    to one (file-format §7.2);
  - a Fusion "point on curve" is our `pointOnCurve` for lines, circles,
    arcs and ellipses, and is dropped on splines;
  - polygon, offset and pattern constraints (Fusion's newer constraint
    kinds) are dropped, and the geometry stays where it was;
  - every drop is listed.
- **Dimensions:**
  - linear (horizontal, vertical, aligned) maps to `distance` with its
    orientation;
  - radial and diameter map directly;
  - angular maps to `angle`, with `supplement` when Fusion measured the
    other angle;
  - "driven" stays driven.
  - Concentric-circle, ellipse-radius and point-to-surface dimensions are
    dropped.
  - Each dimension's expression is copied as text and named with its
    parameter.
- **Solving.** A dropped constraint can leave a sketch under-constrained.
  The importer writes the **solved positions Fusion had**, so the sketch is
  right on import. Then it runs `settleSketches` (ADR-0069) to check that the
  solver agrees, and flags any sketch that moves.
- **Sketch frames:**
  - Fusion's sketch plane frame (origin, X direction) differs from ours
    (ADR-0031's `faceSketchFrame`).
  - The add-in writes model-space coordinates, plus its transform.
  - The importer maps them through `sketchFrame(feature, plane, construction)`.
    For a sketch on a face, it does so after recomputing up to it, since
    the frame comes from the kernel report.
- **Expressions:**
  - Fusion's language is close to ours: numbers with units, names,
    `+ - * / ^`, functions (ADR-0004).
  - The importer parses each expression with our parser, rewriting known
    differences: units we lack, functions we lack, implicit units of
    unitless parameters.
  - When an expression won't parse or uses a missing function, it stores
    **the value** with a note.
  - Fusion's full function list and syntax corners (implicit
    multiplication, `if`, `exp`, `ln`) are unverified; slice C1 builds a
    table from Autodesk's docs.

### 5.7 Licence and tiers for the add-in

- **Licence: MIT**, separately from Extrudo's GPL (section 2.5). It contains
  no Extrudo code; the interchange spec is MIT too.
- **Tiers:** the API and add-ins are available on Fusion for personal use
  (Autodesk's 2020 FAQ, section 2.2), so hobbyists can use it.
  - Unverified: whether a 2026 personal-use install still loads add-ins
    from a folder (it did in 2020) and whether STEP export through the API
    is allowed there.
  - Slice C1 needs an owner with a Fusion install to confirm both. The
    agent machines have no Fusion.
- **Distribution:** a release asset on our GitHub (a zip to drop into
  Fusion's add-ins folder, or "Scripts and Add-Ins › +"). Not the Autodesk
  App Store, at least at first.

---

## 6. Recommendation and slice plan

**Order: A1, A2, then C1–C7.** Drop B and D, and revisit B-geometry only on
user demand. Every slice is one branch, merged after `pnpm check` and its e2e.

### Route A (start now)

| Slice | Content | Done when |
|---|---|---|
| **A1** STEP names | `readStep` reports each solid's product or instance name (the XDE path already walks parts for colours). `ImportReport.names` per body; `followBodyNames` takes a name **only when it first names the body**, like the colour. File format: no change (names live in `BodyMeta`). | A fixture STEP with two named parts imports as "Bracket" and "Lid"; renaming in Extrudo survives a recompute; a STEP without names still gives "Body<n>". |
| **A2** Guide | `docs/guide/fusion.md`: export STEP (and when to use 3MF), import, what is kept and lost, the FreeCAD route for `.f3d` without Fusion; a mention in the import dialog's info line for `.step` files. | Page in the docs site; docs tests pass. |

### Route C (after A)

| Slice | Content | Done when |
|---|---|---|
| **C0** ADR and owner checks | ADR "Importing Fusion designs through an add-in": this report's 5.2–5.7, the MIT add-in, the §8.3 question answered by the owner's legal check, tier checks on a real Fusion. | ADR accepted. |
| **C1** Interchange v1 and add-in skeleton | `docs/fusion-interchange.md` (MIT) and a zod schema in `@extrudo/fusion`. The add-in (`tools/fusion-addin/`, Python, MIT) writes: parameters, the timeline (names, suppression, groups), sketches (entities, constraints, dimensions, frames, solved positions), extrude and revolve, per-step body checks, `bodies.step`. A hand-made sample interchange in `fixtures/fusion/` (written by us, not from Fusion's Gallery). | Schema tests; the owner runs the add-in on two designs, and the files validate. |
| **C2** Importer: parameters, sketches, extrude, revolve on origin planes | Pure translation to `@extrudo/api` calls; the fallback group and STEP Import; the report of what was dropped. CLI `extrudo import-fusion`. | B1, B2 and the Wall bracket rebuilt in Fusion by the owner import fully editable, body checks within 0.1 %. |
| **C3** References | Geometric signatures resolved through the kernel between steps (5.4), role hints first; sketches on faces (frames from reports); profile-by-point. | A fillet on an extrude's top edges and a sketch on a face import editable; a deliberately ambiguous reference falls back. |
| **C4** The common features | Fillet (constant, variable), chamfer, shell, hole, combine, mirror, three patterns, construction planes, axes and points, primitives, move. | One fixture per type round-trips; fuzzer-style test edits a parameter after import and recomputes. |
| **C5** The rest of the mapping | Sweep, loft, coil, thread, emboss, rib, draft, scale, split body, offset faces, canvas, mesh inserts; configurations; appearances. | Each mapped or listed as fallback in the report. |
| **C6** Components | Flattening occurrences into bodies with Move features and names; joints noted. | A two-component design imports with both bodies placed. |
| **C7** App UI | Home › Files "Import from Fusion…" (a command), a progress notice (ADR-0078 style), the import report dialog; the add-in's download linked from the guide; e2e with the fixture. | e2e spec passes; axe passes. |

**Benchmark for success:** the B1–B10 designs, rebuilt in Fusion by the owner
from their descriptions, import with at least B1–B6 fully editable and the
rest editable up to their first unmapped feature.

---

## 7. What we could not check

- **Fusion itself** (no install, no account). Not run:
  - what Fusion's STEP export keeps (names, colours, AP schema);
  - whether personal use still loads add-ins and allows STEP through the
    API;
  - Fusion's expression function list.
- **The meaning of `BulkStream.dat` records**: we saw only type names and
  strings, deliberately no deeper (section 2.5).
- **Whether InventorLoader or cq-acis read our 2024–2026 samples**: neither
  was run (FreeCAD isn't installed here).
- **The current APS translation matrix and pricing** (behind a token).
- **The add-in-related terms:** whether the Autodesk App Store accepts GPL
  add-ins, and the Publisher Agreement (shown only on registration).
- **The legal questions** in section 2.5, which need the owner's lawyer:
  - §8.3 "internal business use" for a published add-in;
  - the US contract risk for a clean-room `.f3d` reader.

## Sources

Format and readers:
- ezf3d: <https://github.com/AlexSabaka/ezf3d> ([container](https://github.com/AlexSabaka/ezf3d/blob/main/docs/format/container.md), [ASM](https://github.com/AlexSabaka/ezf3d/blob/main/docs/format/asm.md), [streams](https://github.com/AlexSabaka/ezf3d/blob/main/docs/format/neutron-streams.md), [unknowns](https://github.com/AlexSabaka/ezf3d/blob/main/docs/format/unknowns.md))
- InventorLoader: <https://github.com/jmplonka/InventorLoader>
- cq-acis: <https://github.com/monozukuri-ai/cq-acis>, <https://pypi.org/project/cq-acis/>
- ezdxf ACIS: <https://github.com/mozman/ezdxf/blob/stable/docs/source/acis.rst>
- Open Cascade ACIS component: <https://www2.opencascade.com/components/acis-import-export-component>
- ODA 3D modelers: <https://docs.intellicad.org/files/oda/2023_10/oda_drawings_docs/drw_3d_modelers.html>
- DATAKIT: <https://www.datakit.com/cad-convertors/fusion-360-to-acis/92-5-0.html>
- ShapeManager: <https://en.wikipedia.org/wiki/ShapeManager>
- Fusion 360 Gallery: <https://github.com/AutodeskAILab/Fusion360GalleryDataset>, [schema](https://github.com/AutodeskAILab/Fusion360GalleryDataset/blob/master/docs/reconstruction.md), [licence](https://github.com/AutodeskAILab/Fusion360GalleryDataset/blob/master/LICENSE.md), <https://arxiv.org/abs/2010.02392>
- f3d ZIP (Autodesk forum): <https://forums.autodesk.com/t5/fusion-support-forum/f3d-files-in-the-tutorials/td-p/7693093>
- Samples: cadop/fusion360descriptor, HULKs/hulk, GadgetAngel/Voron2.4_My_Build_Log, matthewlloyd/Voron-Parametric, Stefanos0710/Odonata, Kushal-Sachdeva78/VVS-Ballers-RoboCup (GitHub)

Fusion features, exports and API:
- Supported formats: <https://help.autodesk.com/cloudhelp/ENU/Fusion-Designs/files/TPD-SUPPORTED-FILE-FORMATS.htm>
- Personal use: <https://www.autodesk.com/products/fusion-360/personal>, <https://www.autodesk.com/products/fusion-360/blog/changes-to-fusion-360-for-personal-use/>
- API: [Features](https://help.autodesk.com/cloudhelp/ENU/Fusion-360-API/files/fusion_Features.htm), [Sketch](https://help.autodesk.com/cloudhelp/ENU/Fusion-360-API/files/fusion_Sketch.htm), [Timeline](https://help.autodesk.com/cloudhelp/ENU/Fusion-360-API/files/fusion_Timeline.htm), [TimelineObject](https://help.autodesk.com/cloudhelp/ENU/Fusion-360-API/files/fusion_TimelineObject.htm), [Parameter](https://help.autodesk.com/cloudhelp/ENU/Fusion-360-API/files/fusion_Parameter.htm), [ExtrudeFeature](https://help.autodesk.com/cloudhelp/ENU/Fusion-360-API/files/fusion_ExtrudeFeature.htm), [entityToken](https://help.autodesk.com/cloudhelp/ENU/Fusion-360-API/files/BRepFace_entityToken.htm), [findEntityByToken](https://help.autodesk.com/cloudhelp/ENU/Fusion-360-API/files/WorkingModel_findEntityByToken.htm), [ExportManager](https://help.autodesk.com/cloudhelp/ENU/Fusion-360-API/files/fusion_ExportManager.htm), [STEPExportOptions](https://help.autodesk.com/cloudhelp/ENU/Fusion-360-API/files/fusion_STEPExportOptions.htm), [SMTExportOptions](https://help.autodesk.com/cloudhelp/ENU/Fusion-360-API/files/fusion_SMTExportOptions.htm)
- STEP export reports: <https://forums.autodesk.com/t5/fusion-support-forum/step-file-export-issue/m-p/11425836>, <https://forums.autodesk.com/t5/fusion-support-forum/imported-assembly-file-structure-has-bodies-vs-components/td-p/12726201>
- Add-in licence question: <https://forums.autodesk.com/t5/fusion-api-and-scripts-forum/add-ins-license/m-p/8709711>
- App Store guidelines: <https://apps.autodesk.com/Publisher/ProductGuidelines>
- APS: <https://blog.autodesk.io/translatable-file-format-with-model-derivative-api-and-role/>, <https://aps.autodesk.com/en/docs/model-derivative/v2/supported-translations>, <https://aps.autodesk.com/pricing>
- Competitors: <https://forum.onshape.com/discussion/comment/28194>, <https://support.shapr3d.com/hc/en-us/articles/15441903753116>

Legal:
- Autodesk General Terms: <https://www.autodesk.com/company/terms-of-use/en/general-terms>, 2023 PDF <https://www.dlt.com/sites/default/files/documents/2024-11/2023-TOU-General-Terms-Final.pdf>
- Directive 2009/24/EC: <https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32009L0024>
- SAS v WPL (C-406/10): <https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:62010CJ0406>
- 17 USC 1201: <https://www.law.cornell.edu/uscode/text/17/1201>
- Sega v Accolade: <https://law.justia.com/cases/federal/appellate-courts/F2/977/1510/45684/>; Sony v Connectix: <https://law.justia.com/cases/federal/appellate-courts/F3/203/596/>; Bowers v Baystate: <https://law.justia.com/cases/federal/appellate-courts/F3/320/1317/>; Davidson v Jung: <https://law.justia.com/cases/federal/appellate-courts/F3/422/630/> (links unverified)
- DWG and ODA: <https://en.wikipedia.org/wiki/.dwg>, <https://en.wikipedia.org/wiki/Open_Design_Alliance>, <https://en.wikipedia.org/wiki/LibreDWG>, <https://github.com/LibreDWG/libredwg>, <https://wiki.freecad.org/FreeCAD_and_DWG_Import>
- Samba PFIF: <https://www.samba.org/samba/PFIF/>
- `.doc`: <https://en.wikipedia.org/wiki/Doc_(computing)>
- GitHub DMCA repository: <https://github.com/github/dmca>
