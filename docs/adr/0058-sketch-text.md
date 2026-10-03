# ADR-0058: Sketch text

- **Status:** Accepted, 2026-10-03; implemented (slices 1 to 4)
- **Task:** P4-03 (FR-SK-13), first part: bundled fonts. **User fonts as
  attachments are P4-03b** (a schema and storage change of its own, see
  Deferred). Emboss/deboss (P4-04) builds on this.

## Context

FR-SK-13 asks for text in sketches: a font picker (bundled open fonts, later
the user's own), size and alignment, with curves that can be extruded. The
architecture already names opentype.js for fonts → curves and an
`attachments/` folder in the `.extrudo` zip for fonts.

What we have to work with:

- Sketch entities are points plus curves defined by points (ADR-0010); a
  fit-point `spline` is derived from its points (ADR-0014), so the solver only
  sees points.
- The kernel already stages **exact clamped non-rational B-splines** (`PlanarCurve`
  kind `spline`: degree, poles, full knot vector; facade `sketchSpline`). A
  Bézier of degree n is exactly a clamped B-spline with knots `[0×(n+1),
  1×(n+1)]`, so glyph outlines (TrueType quadratics, CFF cubics) need **no
  facade change**.
- Profiles (ADR-0020) are keyed by the set of (curve ID, direction) around a
  region, the kernel's faces carry the same IDs (ADR-0025), and extrude refers
  to profiles by those IDs.
- About fifteen `switch (entity.type)` sites handle every entity type
  (`curvePolyline`, profile segments, `planarCurves`, export, solver mapping
  and status, modify tools, projection, commands, measure). TypeScript's
  exhaustiveness checks list them.

## Decision

### 1. A `text` sketch entity, sized and placed by two points

```ts
SketchTextSchema = z.strictObject({
  type: z.literal('text'),
  anchor: ref,      // a point on the first line's baseline
  top: ref,         // a point one text height above the anchor, "up" for the text
  text: z.string().min(1).max(1000),   // '\n' separates lines
  font: FontIdSchema,                  // e.g. 'inter-regular@1' (§3)
  align: z.enum(['left', 'center', 'right']),
  construction: z.boolean(),
});
```

- **Height** is `|top − anchor|` and means the font's **cap height** (OS/2
  `sCapHeight`, else the height of `H`): "10 mm text" gives 10 mm capitals,
  which is what people measure on a print. **Rotation** is the direction from
  `anchor` to `top` (up); the baseline runs 90° clockwise from it.
- **Alignment** is horizontal, per line, about the anchor: `left` starts at it,
  `center` centres on it, `right` ends at it. Lines go down from the first
  baseline by the font's line height (`ascender − descender + lineGap`, scaled
  like the glyphs).
- **No number is stored** for size or angle, like the ellipse: the two points
  carry them, so the solver, dragging, constraints and dimensions just work.
  The Text tool creates the two points, a `vertical` constraint between them
  (upright text; delete it to rotate) and a **driving distance dimension**
  between them whose expression is the height the user typed (a normal named
  `dN` dimension, so it is a parameter and the customizer can drive it later).
- The entity itself maps to nothing in the solver (like `spline`, only its
  points). Constraints and dimensions may not refer to a `text` entity (it is
  in none of the kind lists); they refer to its points.
- A text whose two points are closer than 1 µm, whose font isn't loaded, or
  whose string has no glyphs yields no curves (and the sketch feature warns,
  §5).
- **Construction text** never forms profiles, like other construction curves.
- `formatVersion` stays 1, as for P4-01 and P4-02's new types (pre-1.0; an older
  app refuses a document with an unknown entity type, which is acceptable now).

### 2. Derived curves with sub-IDs

`textCurves(data, id)` (core, `packages/core/src/sketch/text.ts`) lays out the
text with the registered shaper (§4) and returns its curves placed in sketch
coordinates, in a fixed order (line, glyph, contour, segment):

```ts
type TextCurve =
  | { id: TextCurveId; kind: 'line'; a: Vec2; b: Vec2 }
  | { id: TextCurveId; kind: 'spline'; degree: 2 | 3; poles: Vec2[]; knots: number[] };
type TextCurveId = `${SketchEntityId}.${number}`;   // '<text entity>.<n>', n from 0
```

plus `contours` (which curves form each closed contour, in order) for the ink
test. Every place that turns entities into curves expands a `text` entity into
these: `curvePolyline`'s callers get one polyline per sub-curve
(`textPolylines`), profile detection makes segments whose `curve` is the
sub-ID, `planarCurves` stages lines and splines with the sub-IDs in its `ids`,
export writes lines and Béziers, the viewport draws them. Region IDs and the
kernel's face sources therefore name `<text>.<n>`; the naming service sees them
as ordinary source strings (check that `.` parses in names; hole faces already
use `<point>.`).

Modify tools: Move/Copy/Rotate/Scale/Mirror/patterns act on the text's two
points (a mirrored text stays readable, placed mirrored); Trim, Break, Extend,
Fillet, Chamfer and Offset refuse a text ("Text can't be trimmed; explode it
first" is P4-12 material: say "Text can't be trimmed."). Project and measure
skip text. Selecting a text selects the entity; Delete removes it with its two
points, the vertical constraint and the height dimension (`entityRemoval`).

### 3. Bundled fonts: a `@extrudo/fonts` package

- New workspace package `packages/fonts` (no dependencies; boundaries: nothing
  internal; anyone may depend on it): `fonts/*.ttf`, one `OFL.txt` per family,
  `README.md` (source URL, version, subsetting command) and `src/index.ts`
  with `BUNDLED_FONTS: readonly { id: FontId; family: string; style: string;
  file: string }[]`.
- **Font IDs carry a version** (`inter-regular@1`) and **a file never changes
  under an ID**: a newer font file gets `@2`, the old one stays, so a saved
  design keeps its exact shape. `FontIdSchema` (core) accepts
  `/^[a-z0-9-]+@[0-9]+$/` now and `attachment:<id>` in P4-03b.
- The set (all SIL OFL 1.1, static TTF, subset to Latin, Latin-1 Supplement and
  Latin Extended-A plus common punctuation and symbols, with `pyftsubset`, so
  each stays small): **Inter** Regular and Bold (default `inter-regular@1`),
  **Noto Serif** Regular, **JetBrains Mono** Regular, **Allerta Stencil**
  (stencil letters for through-cuts), **Fredoka** SemiBold (rounded, chunky:
  name tags). `NOTICE` lists them; the license check only covers npm packages.
- The app imports each file with `?url` (hashed assets, so the precache
  includes them and designs open offline); Node tests read them from the
  package directory.

### 4. Shaping: opentype.js behind a registry

- **opentype.js** (MIT; `^1.3.4`, plus `@types/opentype.js` if needed) lives in
  a new entry **`@extrudo/sketch/text`** (`packages/sketch/src/text/`), never in
  core's or the app's main chunk: `loadFont(id, bytes)` parses and keeps a font,
  `hasFont(id)`, and a shaper `shape(font, text, align)` that returns the
  **unit layout**: contours of lines and quadratic/cubic Béziers in a frame
  where the cap height is 1, the anchor is the origin and up is +y (kerning
  from the font's `kern`/GPOS pair adjustments through opentype.js; no complex
  shaping: right-to-left and Indic scripts are out of scope, see Deferred).
  Missing glyphs come back as the font's `.notdef` and a `missing` list.
- **Core stays free of opentype.js.** `packages/core/src/sketch/text.ts` holds
  a module registry: `registerTextShaper(shaper)`, and `textCurves` asks it,
  memoising the unit layout by `(font, text, align)` and placing it by the two
  points. Without a shaper or font it returns no curves and reports why
  (`textStatus(data, id)`: `ok`, `no-font`, `missing-glyphs`, `empty`).
  `@extrudo/sketch/text` registers itself when imported.
- **Who loads fonts:**
  - *Kernel worker:* `KernelApi.addFont(id, bytes)` (imports
    `@extrudo/sketch/text` lazily the first time). The app's `Recomputer`
    collects the font IDs the document's sketches use and sends each missing
    one before it posts the recompute (once per session). A font ID that no
    source knows makes the sketch evaluator warn ("Font X isn't available")
    and draw that text as nothing. Engine cache keys don't need the font: a
    font's bytes never change under its ID (§3).
  - *UI thread:* `apps/web/src/sketch/fonts.ts` loads `@extrudo/sketch/text`
    and the bundled files when a document with text opens or the Text tool
    starts, then bumps a `fontsVersion` that the profile cache
    (`sketch/profiles.ts`) and the sketch drawing include in their keys.
  - *Node tests:* `loadFont` with bytes read from `packages/fonts/fonts/`.

### 5. Profiles of text: ink regions and a whole-text reference

- Profile detection marks each region whose boundary consists only of one
  text's sub-curves and whose interior has a **non-zero winding number**
  against that text's contours as that text's **ink**: `Profile.text` (the
  text entity's ID). Counters (inside an `o`) have winding 0 and are ordinary
  islands; overlapping contours (letters touching, fonts with overlaps) split
  into pieces that are all ink, and their union is the letter. The interior
  point comes from a horizontal scan through the region (not its centroid,
  which can fall outside a `C`). The kernel's `SketchProfileInfo` gets the same
  `text?` field from the same function.
- **A whole text is a reference of its own:** `{ kind: 'sketchEntity', id:
  '<sketch>/<text>' }` in a profile field means every ink region of that text.
  Extrude (and revolve, sweep, loft sections, P4-04 emboss) accept it through
  `partsOf` in `packages/kernel/src/features/sources.ts` (all ink faces of the
  text, united; none left: "The text has no letters left to extrude"). It
  **survives editing the string, the font or the size**, where per-letter
  profile IDs don't (they change with the string). In the dialogs, a click on
  an ink region picks the whole text (the field reads "1 text"); "Select
  other…" offers the single letter region as a profile.
- A text with a rectangle round it: the rectangle's region has the letters as
  holes (extrude it and the letters are cut out), and each letter region is
  ink. That is the name-plate case and needs nothing special.

### 6. The Text tool and editing

- Tool `text` in the Sketch tab's Create group ("Text", key **Shift+T**: `T` is
  Trim). Click the anchor; a non-modal panel (like the selection panel) asks
  for the string (multi-line textarea), font (a select with the families, each
  name drawn in its own font once loaded), alignment (three toggle buttons) and
  height (`<ExpressionInput>`, default 10 mm); the text previews live; Enter in
  the height field or OK commits one undo step (points, text, `vertical`,
  height dimension); Esc cancels.
- With a text selected, the `SelectionPanel` edits string, font, alignment and
  construction through a core command `setText` (`modifySketch`, one undo
  step); its height is its dimension (edit the label, or the panel's height
  field writes the dimension's expression through `ToolHost.apply`).
- The viewport draws a text's sub-curves like other curves (selection colour,
  construction dashes, constraint status colour of its points); hovering any
  sub-curve hovers the text.

## Slices (each committed and pushed, checked before the next)

1. **Fonts and shaping:** `packages/fonts` (files, licenses, manifest,
   boundaries, NOTICE), `@extrudo/sketch/text` with opentype.js (`loadFont`,
   `shape`), unit tests of the unit layout (cap height 1, alignment, kerning
   present, multi-line, `.notdef` for a missing glyph, quadratic and cubic
   fonts).
2. **Core and kernel:** the schema entity and `FontIdSchema`, the registry and
   `textCurves`/`textPolylines`/`textStatus`, every `switch` site, profile ink
   and `Profile.text`, `planarCurves`, `SketchProfileInfo.text`, the
   whole-text reference in `sources.ts`, the evaluator's warning,
   `KernelApi.addFont`, `setText` and `entityRemoval`; file format §7 (the
   entity) and §8 (the reference); unit and kernel tests (an extruded "Ag" in
   Inter: volume = ink area × depth within 0.5 %, face count; counters stay
   empty; editing the string keeps the extrude through the whole-text
   reference; a missing font warns).
3. **App:** font loading on both threads, drawing, the Text tool and panel,
   selection and editing, pick → whole text in profile fields, export of text
   in SVG/DXF; unit tests.
4. **E2E and docs:** `e2e/text.spec.ts` (create "Extrudo" 10 mm, extrude 2 mm,
   change the string, the body follows; Shift+T; panel fields), CLAUDE.md
   (status and e2e notes), CHANGELOG, roadmap tick, this ADR's results
   (performance: a 20-character text should recompute well under a second),
   CI green on the branch.

## Results

Implemented on branch `p4-03-text` in the four slices above, all pushed.

### Code map (one line per file group, per slice)

1. **Fonts and shaping** — `packages/fonts/` (`fonts/*.ttf`, `OFL.txt` per
   family, `README.md`, `src/index.ts` with `BUNDLED_FONTS`, `FontId` and
   `DEFAULT_FONT`), `packages/sketch/src/text/` (`loadFont`, `hasFont`,
   `shape`, `src/text.test.ts`), `scripts/check-boundaries.mjs`, `NOTICE`.
2. **Core** — `packages/core/src/sketch/schema.ts` (`text` entity,
   `FontIdSchema`), `packages/core/src/sketch/text.ts` (the registry:
   `registerTextShaper`, `placeText`, `textPolylines`, `entityPolylines`),
   `text-layout.ts`, `sketch/curves.ts` and every `switch (entity.type)` site
   (`planarFaces`, export, modify tools, projection, measure), `sketch/commands.ts`
   (`setText`), `entityRemoval`, `packages/sketch/src/profiles/{profiles,ink}.ts`
   (ink regions, `Profile.text`), `packages/kernel/src/features/sources.ts`
   (`partsOf`, the whole-text reference), `features/sketch.ts` (the evaluator's
   text faces and its font warning), `recomputer.ts` (`addFont` before a
   recompute), `docs/file-format.md` §7 and §8, and the tests
   (`packages/core/src/sketch/text.test.ts`, `packages/sketch/src/profiles/*`,
   `packages/kernel/src/features/text.test.ts`).
3. **App** — `apps/web/src/sketch/fonts.ts` (UI-thread fonts, `fontsStore`'s
   version in every text-geometry cache key), `apps/web/src/sketch/tools/text.ts`
   (the Text tool), `sketch/panels.tsx` (`TextPanel`, `TextFields`, `HeightField`),
   `sketch/textDraft.ts`, `sketch/textEditing.ts`, `selection/pick.ts` (a whole
   text is one pick), `features/{refs,values,dialog,pressPull}.ts` (the "1 text"
   field, `SelectionField.wholeTexts`), `shell/{tools,AppShell}.tsx`,
   `commands/keymap.ts` (Shift+T), the icon, and the unit tests.
4. **E2E and docs** — `e2e/text.spec.ts`, `viewport/sketchGeometry.ts`
   (`textBoundsSummary`, read as `data-text-bounds`), this Results section, the
   roadmap tick, CHANGELOG and CLAUDE.md.

### Performance

A 20-character text in one sketch, one extrude of the whole text (18 bodies),
on this 4-core Ubuntu machine: **cold 1038 ms**, **edit 738 ms** (the string
through the reference), **warm 24 ms**. The build carries opentype.js in its own
chunk (`assets/text-*.js`, 168 kB raw) and the six fonts as 15–45 kB hashed
assets, all in the precache, so a design with text opens offline and the entry
chunk is untouched until a document has text.

### Decisions taken while implementing

- **`SketchOutputData.texts`** — the sketch evaluator's `data` lists the text
  entity IDs it placed, so the app knows which fonts the worker has (the
  `Recomputer` sends each missing one with `KernelApi.addFont` before the next
  recompute) without asking the kernel again.
- **`SelectionField.wholeTexts`** — a profile field that accepts a whole text
  needs a filter of its own: sketch *curves* are excluded (an extrude sweeps a
  text's ink, not a line) and ink regions come along, so one pick takes the
  whole text however many letters it has. `countLabel` then says "1 text".
- **The draft in `sketch/textDraft.ts`** — the tool's string, font, alignment
  and height live in a small vanilla store, not in the tool: the panel is in the
  main chunk and must not pull the lazy drawing-tools chunk (and with it
  planegcs and opentype.js) in with it. The tool reads the store when it
  commits and draws its preview from it.
- **A "Text" item in the Create menu**, next to the drawing tools and not in the
  palette ("Text", Shift+T); the palette's fuzzy search then finds it inside a
  sketch like any other sketch command.
- **The font's `.notdef` box counts as ink**, so a string the font can't show
  still sweeps something, and the evaluator warns with the missing characters
  rather than leaving a hole in the model.
- **A 1e-9 scan-height fix for `8`** — the ink test's interior point comes from
  a horizontal scan; for a very small glyph (the bowl of `8` at a small text
  height) the scan through the region found no crossing, and a scan height of
  1e-9 mm fixed it.

### Still open after this task

- **P4-03b user fonts** (the ADR's Deferred list): `doc.attachments`, font IDs
  `attachment:<id>`, an "Add font…" button, plus text on a path, letter
  spacing, bold/italic synthesis, complex-script shaping, exploding text into
  editable curves and variable-font axes.
- **A text fixture for the fuzzer** (slice 4's optional step; written, measured
  and then dropped): 200 random edits of a document with two texts
  (a plate with the letters cut out, a disc and 6 letter bodies) had not
  finished after 15 minutes, against the case's own budget of 60 s + 200 × 2 s.
  Glyph bodies are B-spline solids, so every recompute costs far more than the
  fixtures this fuzzer was tuned on, and its cold-compares (every tenth step)
  multiply that. A text fixture wants a bigger per-step budget (or a text
  document with fewer or simpler letters) before it goes in.

## Rejected

- **Exploding text into ordinary line and spline entities** on creation: simple,
  but the string, font and size can't be edited afterwards, and a customizer
  can't drive a name tag.
- **Fit-point splines for glyph curves:** they interpolate and would not be the
  font's shape; exact Béziers are already supported by the kernel.
- **Storing glyph outlines in the document:** derived geometry in the source of
  truth; fonts pinned by versioned IDs make the outline reproducible instead.
- **A number for height and angle on the entity:** would bypass the solver and
  the dimension machinery (parameters, expressions, over-constraint checks).
- **opentype.js in core or the main chunk:** about 170 kB minified, needed only
  when a design has text.
- **Per-letter profile references as the only way to extrude text:** they
  change whenever the string does.

## Deferred

- **P4-03b, user fonts:** `doc.attachments` (ID, name, media type, SHA-256,
  size), bytes in project storage and the zip's `attachments/`, font IDs
  `attachment:<id>`, an "Add font…" button. Needs its own ADR section and file
  format change.
- Text on a path, letter spacing, bold/italic synthesis, complex-script shaping
  (HarfBuzz), exploding text into editable curves, variable-font axes.
