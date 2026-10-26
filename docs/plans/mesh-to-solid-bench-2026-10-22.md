# Mesh to Solid: outside converters on the owner's STLs, 2026-10-22

A benchmark of two open-source STL-to-STEP converters against Mesh to Solid
(ADR-0097), run before slice D1 on the owner's 41 STLs (25 own designs, 16
third-party; the files are not in the repository). Its headline numbers are in
ADR-0097's amendment of 2026-10-23 (the hybrid rebuild, slice D1), which took
stl2step's method. This note keeps the rest: the versions, how each STEP was
checked, every file's result and the failures, so a later sweep can be compared
with it.

## What ran

- **Extrudo** Mesh to Solid before slice D1: OCCT 8.0.1 (the facade), tolerance
  0.01 mm, from the kernel sweep (`spikes/stl-to-solid`, `run.sh prismatic F`).
  Prismatic is the exact rebuild; faceted is one face per coplanar patch, capped
  at 2,000 faces at the time.
- **[stl2step](https://github.com/BlinkingSun/stl2step)** 1.6.0, commit
  `a245151`, built Release with OCCT 7.9.2 (Ubuntu 26.04 packages), in both
  modes: `stl2step in.stl -o out.step` (Verbatim) and
  `stl2step in.stl -o out.step --engine trueform` (TrueForm).
- **mesh2cad** 0.11.0 from PyPI, Python 3.12 (`cadquery-ocp` 7.9.3.1.1,
  `trimesh` 5.1.1): `mesh2cad convert in.stl -o out.step --report r.md --json`.

The outside tools each ran in their own Docker image, one file at a time, with
a 600 s limit per file, on a 4-core machine.

## How the results were checked

Each STEP file was re-read by our own checker, `spikes/stl-to-solid/bench/verify_step.cpp`
(desktop OCCT). It counts solids and faces by surface type, runs
`BRepCheck_Analyzer`, and compares the solid's volume with the mesh's signed
volume. A file is:

- **exact**: a valid solid, volume within 1 %, and fewer faces than triangles / 4;
- **faceted**: a valid solid within 1 %, but with more faces;
- **failed**: anything else.

## Totals (41 files)

| tool | exact | faceted | failed | timeout or crash |
|---|---:|---:|---:|---:|
| stl2step TrueForm | 20 | 8 | 8 | 5 |
| stl2step Verbatim | 5 | 30 | 6 | 0 |
| mesh2cad | 5 | 25 | 7 | 3 + 1 crash |

Extrudo converted 20: prismatic 10, faceted 18. It refused the other 21, four
of them open meshes. TrueForm was exact on 14 files that prismatic didn't
convert, 10 of them files neither of our methods converted. Prismatic
converted 4 files that TrueForm didn't make exact (`ball`, `drill-block`,
`hole-filler-35mm`, `numbers-base-top`).

mesh2cad isn't worth following. It wrote a STEP for 37 files, and only 4 of
them have a single curved face. The rest are planar, and in 23 of them each
triangle became its own face.

## Per file

✓ n = converted, with n faces; ✗ = refused; — = an open mesh (not tried).
† = not a closed mesh.

| file | triangles | Extrudo prismatic | Extrudo faceted | stl2step TrueForm | stl2step Verbatim | mesh2cad |
|---|---:|---|---|---|---|---|
| own/ball | 9024 | ✓ 1 | ✗ | faceted, 105 s | faceted, 6 s | faceted, 20 s |
| own/battery-holder | 15622 | ✗ | ✗ | exact, 4 s | faceted, 8 s | faceted, 124 s |
| own/battery-power-adapter | 14390 | ✗ | ✗ | faceted, 40 s | faceted, 10 s | faceted, 129 s |
| own/desk-organizer-module-small | 21380 | ✗ | ✗ | failed: volume, 19 s | failed: volume, 43 s | failed: volume, 80 s |
| own/drill-block | 7962 | ✓ 93 | ✗ | timeout | faceted, 4 s | timeout |
| own/grass-for-flower† | 953 | — | — | exact, 2 s | exact, <1 s | exact, 11 s |
| own/hole-filler-35mm | 2188 | ✓ 6 | ✓ 1070 | faceted, 39 s | faceted, 1 s | faceted, 32 s |
| own/hole-filler-5mm | 1850 | ✓ 6 | ✓ 597 | exact, 7 s | faceted, 1 s | faceted, 8 s |
| own/kuglbahn-pillar-base | 29262 | ✗ | ✗ | faceted, 66 s | faceted, 37 s | failed: open shell, 71 s |
| own/doodle-1 | 740 | ✗ | ✓ 198 | faceted, <1 s | faceted, <1 s | faceted, 14 s |
| own/numbers-base-top | 1612 | ✓ 471 | ✓ 471 | faceted, 27 s | faceted, 1 s | faceted, 16 s |
| own/object-permanence-base | 10670 | ✗ | ✗ | exact, 5 s | faceted, 5 s | faceted, 45 s |
| own/peg-perego-button | 6526 | ✗ | ✗ | exact, 23 s | faceted, 5 s | faceted, 38 s |
| own/phone-stand-foldable | 22732 | ✗ | ✗ | exact, 189 s | faceted, 20 s | faceted, 118 s |
| own/puzzle-base-circle | 3592 | ✓ 37 | ✓ 1916 | exact, 172 s | faceted, 2 s | exact, 6 s |
| own/puzzle-insert-circle | 13298 | ✗ | ✗ | exact, 24 s | faceted, 9 s | faceted, 205 s |
| own/remove-before-flight-cover | 4642 | ✗ | ✓ 1439 | timeout | faceted, 2 s | faceted, 92 s |
| own/scrap-plate | 3192 | ✗ | ✓ 1928 | faceted, 9 s | faceted, 2 s | faceted, 17 s |
| own/shower-holder | 5406 | ✗ | ✗ | failed: invalid, 37 s | faceted, 4 s | faceted, 19 s |
| own/spool-nut-v4.1 | 7040 | ✗ | ✗ | timeout | faceted, 6 s | faceted, 32 s |
| own/spool-screw-v4.1 | 23582 | ✗ | ✗ | exact, 49 s | faceted, 20 s | faceted, 229 s |
| own/track-straight-100mm | 1088 | ✗ | ✓ 637 | faceted, 5 s | faceted, 1 s | failed: volume, 11 s |
| own/trashcan-repair-foot | 4508 | ✓ 16 | ✓ 286 | exact, 5 s | exact, 1 s | exact, 35 s |
| own/trashcan-spacer | 1980 | ✗ | ✓ 1252 | exact, 3 s | faceted, 1 s | faceted, 9 s |
| own/whiteboard-tray-v5 | 39088 | ✗ | ✗ | failed: invalid, 64 s | failed: volume, 15 s | timeout |
| third-party/chip-bag-clip-small† | 13948 | — | — | exact, 46 s | exact, 43 s | failed: open shell, 57 s |
| third-party/door-stopper-top | 7588 | ✗ | ✗ | exact, 33 s | faceted, 6 s | faceted, 52 s |
| third-party/gardena-end | 3452 | ✗ | ✓ 1807 | exact, 13 s | faceted, 2 s | faceted, 10 s |
| third-party/gear-bearing-5 | 19426 | ✗ | ✗ | timeout | failed: invalid, 27 s | crash |
| third-party/hex-key-cap-3mm† | 11496 | — | — | failed: open shell, 10 s | failed: open shell, 10 s | failed: open shell, 147 s |
| third-party/hot-wheels-connector | 4562 | ✗ | ✗ | failed: invalid, 212 s | failed: invalid, 5 s | faceted, 38 s |
| third-party/makita-vacuum-holder | 16630 | ✗ | ✗ | failed: invalid, 29 s | faceted, 13 s | failed: volume, 66 s |
| third-party/micro-sd-keyring-inner | 2116 | ✗ | ✓ 527 | exact, 4 s | exact, 1 s | timeout |
| third-party/micro-sd-keyring-outer | 1068 | ✓ 41 | ✓ 271 | exact, 3 s | faceted, <1 s | exact, 10 s |
| third-party/mms-camera-mount | 4250 | ✓ 11 | ✓ 813 | exact, 30 s | exact, 2 s | exact, 4 s |
| third-party/mms-flat-stand | 5642 | ✓ 44 | ✓ 1269 | exact, 21 s | faceted, 2 s | faceted, 20 s |
| third-party/mms-m5-nut† | 1494 | — | — | exact, 5 s | faceted, 1 s | faceted, 16 s |
| third-party/sock-clips-6x | 3938 | ✗ | ✓ 962 | failed: open shell, 17 s | failed: open shell, 1 s | faceted, 39 s |
| third-party/spaghetti-measure | 6722 | ✗ | ✓ 1812 | timeout | faceted, 5 s | faceted, 73 s |
| third-party/vented-funnel | 22812 | ✗ | ✗ | failed: invalid, 60 s | faceted, 24 s | failed: volume, 81 s |
| third-party/wyze-garage-bracket | 2210 | ✗ | ✓ 947 | exact, 6 s | faceted, 1 s | faceted, 26 s |

## Failures worth knowing

- **TrueForm timeouts**, no STEP after 600 s: `drill-block`,
  `remove-before-flight-cover`, `spool-nut-v4.1`, `gear-bearing-5`,
  `spaghetti-measure`. The logs stop right after the read line;
  `gear-bearing-5` loops on `DIAG_OP2G_LOOP` lines instead.
- **TrueForm, invalid B-rep:** `shower-holder` (cylinder-cylinder
  intersections came back empty, so it kept mesh polylines), `hot-wheels-connector`,
  `vented-funnel` (a seamed face), `makita-vacuum-holder`, `whiteboard-tray-v5`
  (its analytic rebuild reverted on one component).
- **Verbatim** writes the STEP even when ShapeFix leaves it invalid
  (`hot-wheels-connector`, `gear-bearing-5`).
- **mesh2cad:** a segfault on `gear-bearing-5` after 82 s; 3 timeouts
  (`drill-block`, `whiteboard-tray-v5`, `micro-sd-keyring-inner`); volumes
  off by 3–11 % on 5 files; an open shell on `kuglbahn-pillar-base`.

## Caveats

- The exact rule (faces < triangles / 4) is a proxy. `chip-bag-clip-small` and
  `grass-for-flower` pass it with no analytic faces; `numbers-base-top`
  (471 planar faces from 1,612 triangles) fails it narrowly.
- `desk-organizer-module-small` and `whiteboard-tray-v5` fail the 1 % rule
  only because the tools count their 4–6 inward-facing cavity pieces as
  positive volume. The mesh's signed volume is 65,260 mm³; the STEP has
  67,008 mm³.
- A timeout means the tool didn't finish in 600 s, not that it never would.

## Running it again

Build the checker and run it over a folder of STEP files:
`spikes/stl-to-solid/README.md`, "Outside converters".
