# ADR-0022: Sketch export to SVG and DXF

- **Status:** Accepted, 2026-09-27
- **Task:** P1-13 (SVG and DXF export; FR-SK-15, FR-SK-16, FR-IO-01).
  Code: `packages/io/src/` (`drawing.ts`: the `Drawing` format and
  flattening; `svg.ts`: `writeSvg`; `dxf.ts`: `writeDxf`; `format.ts`),
  `packages/sketch/src/export/` (`sketchDrawing`, `profileDrawing`,
  B-spline → Bézier in `bezier.ts`; entry `@extrudo/sketch/export`), and
  in the app `apps/web/src/sketch/exportFile.ts` and
  `sketch/ExportSketchDialog.tsx`, opened from the Sketch tab's Export
  tile (`exportSketch` in `shell/tools.ts`) and from the timeline's and
  the browser's feature menu (`FeatureActions.exportSketch`).
- **Builds on:** ADR-0009 (platform file download), ADR-0014 (ellipse and
  fit-point spline shapes), ADR-0020 (profiles), ADR-0021 (feature menus).
- **Affects:** P1-15 (benchmark B1 checks the SVG), P2-12 (STL/3MF writers
  go in `packages/io` too), P4-06 (SVG/DXF import can share the `Drawing`
  format), P5 CLI export.

## Context

FR-SK-15 asks for a sketch as SVG at 1 unit = 1 mm with a correct viewBox;
FR-SK-16 for DXF. The roadmap adds "or its profiles" and optional
construction geometry, and requires golden-file tests and that the SVG
opens at its real size in Inkscape. The architecture puts format-level,
geometry-agnostic writers in `packages/io`, which is MIT so other tools
can reuse it, and must not depend on the GPL packages.

## Decision

1. **Two layers.** `@extrudo/io` knows a neutral 2D `Drawing`: layers
   (name, colour, AutoCAD colour index, dashed, fill) and shapes made of
   contours of exact segments: line, circular arc (centre and signed
   sweep), elliptical arc, quadratic and cubic Bézier. Coordinates are mm
   with y up. `writeSvg` and `writeDxf` write it. `@extrudo/sketch/export`
   (pure, no WASM) maps a sketch onto it. The sketch package now depends
   on `io` (GPL may use MIT; `check-boundaries.mjs` allows
   `sketch → core, io`); `io` still depends on nothing.
2. **Curves stay exact.** Lines, arcs and circles map directly; an ellipse
   is one elliptical arc of a full turn; a fit-point spline is converted
   from its B-spline (the curve the viewport draws, `fitSpline`) into
   Bézier pieces by knot insertion (quadratic for three points, a line for
   two). Nothing is sampled until a format can't express a curve.
3. **Two contents.** *All curves*: one shape per curve on the "Sketch"
   layer, construction geometry optional on a dashed grey "Construction"
   layer; points aren't exported. *Profiles* (all, or the selected ones):
   each profile one shape, its outer loop and its holes as closed
   contours, on a "Profiles" fill layer. A profile edge keeps its curve's
   exact geometry between the loop's vertices: arc and ellipse sweeps are
   summed along the edge's points (so reversed edges and whole circles
   come out right), spline pieces are cut between the parameters of the
   edge's ends (at a closed spline's joint, the side of the next point
   decides 0 or 1). Segment ends are the loop's vertices, so neighbouring
   edges meet exactly.
4. **SVG.** The root has `width`/`height` in `mm` and the bounding box as
   viewBox, so one user unit is a millimetre in Inkscape, browsers,
   slicers and laser software. y is flipped by negating coordinates, not
   with a transform. Each layer is a group (and an Inkscape layer).
   Stroke layers are 0.1 mm black hairlines with no fill; dashed layers
   get a dash array. Fill layers are filled black, even-odd, no stroke:
   slicers (emboss, SVG import) and vinyl cutters want filled regions.
   Arcs are `A` commands of at most half a turn each (so the large-arc
   flag is always 0), ellipses with their rotation mirrored for the
   flipped y; Béziers are `Q`/`C`. A drawing with no height or width (one
   straight line) gets a page the stroke's width across. Numbers have at
   most 4 decimals (0.1 µm), no trailing zeros and no `-0`, so output is
   deterministic.
5. **DXF R12 (AC1009).** Read by every CAD, CAM, laser and CNC program.
   Header with `$EXTMIN/$EXTMAX` and `$INSUNITS` 4 (mm; newer than R12,
   and readers that don't know it skip it), LTYPE (CONTINUOUS, DASHED) and
   LAYER tables, entities. Stroke layers: LINE, ARC (counter-clockwise, so
   clockwise arcs swap their angles), CIRCLE for a full turn, and POLYLINE
   for what R12 lacks (ELLIPSE and SPLINE are R13+), flattened to
   0.002 mm. Fill layers: one closed POLYLINE per contour with bulges, so
   arcs stay exact and a region is one entity a CAM program can pick. No
   hatches. `\n` line ends; reals to 6 decimals.
6. **UI.** An "Export sketch" dialog: format (SVG, DXF), contents (all
   curves with a construction checkbox, all profiles, and selected
   profiles when some are selected, chosen first), and a live summary
   ("1 profile, 60 × 40 mm"), or why there is nothing to export (the
   Export button is then disabled). It opens from the Sketch tab's Export
   group while editing and from "Export SVG or DXF…" in a sketch's
   timeline or browser menu. The file is named "<project> - <sketch>.svg"
   and saved through `platform.files.download`. Output is always mm,
   whatever the document's display units.

## Consequences

- Golden files live in `packages/sketch/src/export/golden/`
  (`UPDATE_GOLDEN=1 pnpm vitest run packages/sketch/src/export` rewrites
  them; Biome ignores `**/golden`). Checked outside the tests: Inkscape 1.4.4
  opens them at their size (`--query-width` of the filled 100 × 60 mm
  plate is 377.953 px = 100 mm at 96 px/in; stroked files are 0.1 mm
  larger, the hairline; a page export at 25.4 dpi is 100 × 60 px), and
  ezdxf reads and audits the DXF files with no errors.
- The e2e tests read the dialog's `data-export-summary` and the
  downloaded file (`page.waitForEvent('download')`).
- The Sketch tab has a new Export group; the sketch-mode screenshot
  baseline changed in the toolbar only.

## Rejected

- **Writing SVG/DXF straight from `SketchData` in `packages/io`.** `io`
  must not depend on the GPL `core`/`sketch` packages, and the neutral
  drawing is what later writers and the importer can share.
- **Sampling everything to polylines.** Simpler, but loses exactness in
  SVG and in DXF arcs, and makes files large; only ellipses and splines in
  DXF are flattened.
- **A transform (`scale(1,-1)`) for the flip.** Inkscape then shows the
  paths under a transformed group, and the numbers in the file aren't the
  geometry.
- **A margin around the viewBox.** The page would no longer be the part's
  size, which slicers and laser software use for placement; hairlines at
  the edge may be half clipped in a browser preview, which is harmless.
- **DXF R2000+ (LWPOLYLINE, ELLIPSE, SPLINE).** Exact ellipses and splines,
  but older and simpler CAM and laser tools only read R12 reliably; the
  roadmap asks for R12.
- **Stroking profiles (no fill).** The same outlines as "All curves",
  minus open curves; filled regions are what slicers and vinyl cutters
  use.

## Open

- Exporting from model mode by selecting a sketch in the view, and from
  the File menu (no feature selection in model mode yet).
- Remembering the last format and contents between exports.
- Text, points and dimensions aren't exported.
- Profile edges on ellipses and splines start at profile detection's
  polyline vertices, which can be up to the polyline's sagitta (a few
  hundredths of a mm) off the exact curve where curves cross.
