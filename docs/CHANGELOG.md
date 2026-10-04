# Changelog

One line per completed roadmap task, newest first. Dates are absolute.

## v0.4 (Phase 4, in progress)

- 2026-10-04 · **P4-06 (1 of 5) Drawings into a sketch** (ADR-0066 §1,
  FR-SK-14): `readSvg` and `readDxf` in `@extrudo/io` (an XML tokenizer of our
  own, a path-data parser with the SVG arc conversion, transforms composed down
  the tree, `$INSUNITS`, blocks and `INSERT`, bulges, B-splines by knot
  insertion, everything left out counted) give a `Drawing` in millimetres with
  y up; `@extrudo/sketch/import`'s `drawingToSketch` turns it into a
  `SketchChange` (lines, circles and arcs, ellipses, and control-point splines
  for elliptical arcs and Béziers, so nothing is flattened), fixed by default,
  the 5,000-curve limit and the user's own IDs; and the tool `importDrawing`
  with its panel "Import drawing" (unit, scale, position, fixed, what the file
  brings in), which commits the drawing as one undo step. The e2e extrudes the
  imported plate and reads its size.
- 2026-10-04 · **P4-11 (parts 2 and 3) Benchmarks B8 and B10**, which
  finishes the task (ADR-0039's second amendment). **B8, a name tag**
  (`e2e/benchmark-b8.spec.ts`): a Box with `length`/`width`/`thick`, its four
  vertical edges rounded `corner`, a Ø4 mm hole through the top face at
  `-length / 2 + 6`, a text `EXTRUDO` (8 mm, centred) sketched **on that face**
  and embossed `letters` out of it, a parameter change that makes the plate
  longer and thicker and carries the letters up with it, and the 3MF read back
  through `@extrudo/io` (one closed solid, its volume between the plate's and
  the plate's plus its letters'). **B10, a cable chain link**
  (`e2e/benchmark-b10.spec.ts`): a rounded centreline path sketched on XZ swept
  with a `depth` x `wall` section into a ring, a cylinder pin on its outside
  face, a blind hole `pin + 2 * tolerance` across at the other end (the
  tolerance comes from the 3D Print tab's panel), a rectangular pattern of
  three links along Y, and the 3MF read back (three closed solids). Both
  fixtures recompute headless in `packages/kernel/src/benchmarks.test.ts` and
  fuzz clean at the full 200 steps. B10 found that **a sweep carries its
  profile exactly where its sketch drew it** (OCCT's no-contact placement), so
  a swept section has to be *centred on the path*: centred on the sketch's
  origin instead, the link came out with 6 mm walls.
- 2026-10-04 · **P4-10 (2 of 2) Variable-radius fillet** (ADR-0064 §2,
  FR-FT-04): each edge set of a fillet takes an optional **end radius**
  (`radiusEnd<n>`) and a **swap** (`swap<n>`), so the round tapers along its
  tangent chain from `radius` at one end to the end radius at the other. The
  facade's new `filletVariable` (staged edges with two radii each, one pair
  per chain, the same build, check, `filletRollsOff` guard and history as
  `fillet`, whose diagnosis it shares — except that a taper only reports the
  factor every radius scales by, since which chain is too large depends on the
  direction the radius runs in); `Kernel.filletVariable` with the same
  `FilletError`. The evaluator calls it **only** when some set has an end
  radius, so a constant document still takes the constant `fillet` and
  computes exactly as before. The dialog gets a per-set Variable toggle with
  an End radius and Swap ends. `spikes/p4-10-harness/` (native) checks a box's
  top edge 2 → 5 mm, a chain of three tangent edges 1 → 3 mm, a taper too
  large → a factor that works, and leaks; `fillet-variable.test.ts` measures
  the volumes through the evaluator (a taper takes more off than a 2 mm
  fillet and less than a 5 mm one; `swap` keeps the volume and moves the big
  end); `e2e/fillet.spec.ts` reads them out of three 3MF exports.
- 2026-10-04 · **P4-10 (1 of 2) Rib** (ADR-0064 §1, FR-FT-17): the `rib`
  feature — a thin wall from one sketch **line** to the body beside it, the
  stiffening triangle in a bracket's corner. Core's definition (`curve`,
  `thickness`, `side`, `flip`) and the patternable types; the kernel's
  evaluator, which builds a slab around the line (it extended by the bodies'
  box diagonal at both ends, swept that far to the side the material is on,
  prisms it along the plane normal by the thickness), cuts every body out of
  it and joins the piece that holds the line's midpoint — named as a prism
  under `rib:<id>`, so the wall's faces keep their names through a pattern.
  The dialog: Line (one sketch line), Thickness with an arrow across the
  plane, Thickness side, Flip with a direction arrow (a new manipulator kind,
  `kind: 'arrow'`, whose head a click turns). `e2e/rib.spec.ts` measures the
  Wall bracket's volume through a 3MF: the rib adds 2 915.1 mm³ against the
  exact 2 916.0 mm³ of the triangle, and flipped it says the rib doesn't close
  against the body. §1's "`d` is signed by the middle of the bodies' box" is
  answered by their centre of mass instead: an L's legs are on the corner side
  of its diagonal, which the box's middle is not.
- 2026-10-04 · **P4-11 (part 1) Benchmark B9** (ADR-0039's amendment): a
  threaded bottle cap and its thread adapter, built through the UI in
  `e2e/benchmark-b9.spec.ts` — a revolved rectangle, a Shell that opens it at
  the bottom, a Thread on its inside wall, a second revolved sketch (a stepped
  section dimensioned from a fixed point at the origin) as a body of its own
  with a Thread on each of its two outside walls, all sized to fit, a parameter
  change, and the 3MF read back through `@extrudo/io` (two closed solids, their
  volumes within the bounds the threads leave). The fixture
  `fixtures/benchmarks/b9-bottle-cap.extrudo` is recomputed headless in
  `packages/kernel/src/benchmarks.test.ts` and fuzzed (6 steps, for the reasons
  in ADR-0039). The benchmark found two limits of modeled threads and both are
  answered here: the ISO coarse thread series now goes to M64 (a bore wider
  than M30 had no `autoThread` fit at all, so the cap couldn't grow), and a
  thread is refused above 150 turns (about 400 corrupted the WASM heap; the
  corruption itself is a P4-12 item).
- 2026-10-04 · **P4-04 (4 of 4)** Emboss and deboss on cylindrical faces
  (ADR-0060 §3, §4): the profiles or a whole text are **wrapped** round a
  cylinder's wall instead of projected on it, so the letters keep their width
  measured along the surface. A new facade method `wrapOnCylinder` (OCCT's
  simple offset of the wrapped cap: both caps exact surfaces on radius R and
  R ± depth, the walls between them exactly radial), the kernel's cylindrical
  branch with the frame rule (the sketch plane must run along the axis; `r` from
  the axis towards the sketch, `across = a × r`, the foot of the axis on the
  plane as the corner), `namedWrap` in the naming operations, the dialog's
  depth arrow standing on the wall at the letters (radially, out of a boss's
  wall and into a hole's), and `e2e/emboss.spec.ts`: a text round a Cylinder's
  wall, embossed and debossed, and the same on a box's top face.
- 2026-10-04 · **P4-05** Control-point splines and conics (ADR-0063): a sketch
  `spline` entity gains a mode — `fit` (through its points, as before),
  `control` (its points are the B-spline's poles, so the curve is guided by
  them) or `conic` (three points — start, shoulder, end — and a `rho` that says
  how full it is). Two tools in the Create menu: Control Point Spline and
  Conic, with the poles drawn as a thin dashed control polygon while the sketch
  is open, and a Rho field in the selection panel. A conic's own curve is
  rational, which the kernel cannot take, so the conic is stored exactly (three
  points and rho) and drawn as a cubic within 1e-5 mm — everything downstream
  (profiles, export, extrude, the sketch's faces) reads one `splineCurve`. No
  facade change, no new schema version.
- 2026-10-03 · **P4-08** Print tolerance and slicer hand-off (ADR-0062): the
  print tolerance is the user parameter `tolerance`, set from the 3D Print tab's
  Tolerance panel (a field and the Tight 0.1 / Normal 0.2 / Loose 0.3 mm
  buttons, one undo step each, through the shell's parameter `apply`), and it
  says how many holes and threads use it. Hole presets add it to every diameter
  they write ("3.4 mm + 2 * tolerance", depths stay plain) and the Preset
  dropdown recognises both forms; the platform interface gained the optional
  `openInSlicer` the Export dialog offers (Slicer select + "Open in slicer")
  where it exists — the browser build leaves it out, the launch is Phase 6.
- 2026-10-03 · **P4-03b** User fonts as attachments (ADR-0061): `doc.attachments`
  records the files a design carries (name, file name, media type, SHA-256,
  size) while their bytes live beside the document —
  `projects/<id>/attachments/<sha256>` in the project store and
  `attachments/<sha256>` in the `.extrudo` file, one copy each, collected when a
  version is saved; a text's font may be `attachment:<id>`, which the app reads
  for the UI thread and sends to the kernel worker; both Font selects list the
  design's fonts and offer "Add font…" (TTF, OTF, WOFF; WOFF2 refused, a file
  that isn't a readable font stores nothing), with a hint that the font travels
  inside the design; 10 MB per file and 50 MB per design.
- 2026-10-03 · **P4-04 (1 of 4)** Emboss and deboss on flat faces (ADR-0060
  §1, §2): the `emboss` feature in core and its evaluator in the kernel. The
  profiles or a whole text from a sketch in any plane parallel to the face are
  moved onto the face's plane and swept `depth` along its outward normal
  (`emboss`, joined) or against it (`deboss`, cut); only the face's own body is
  touched. The app dialog, e2e and round faces come in the later slices (the
  dialog in slice 2, the facade's `wrapOnCylinder` in slice 3).
- 2026-10-03 · **P4-07** Customizer and configurations (ADR-0059): a user
  parameter can be exposed for changing (`parameters[].customizer`: `min`,
  `max`, `step`, `group`), and a design can hold named value sets
  (`configurations[]`) to switch between. The Customizer panel (Solid › Modify,
  or Ctrl+K) lists the exposed parameters with expression fields and sliders,
  warns about a value outside its range, and switches configurations by name —
  one undo step for a whole drag, one for applying a configuration. No "active
  configuration" is stored: one goes stale after any edit or undo, so the panel
  matches the values. The Parameters dialog gets a star per row, the slider's
  range and a Clear button per number; the templates open with their main
  dimensions exposed and a Small and a Large configuration. Commands, the pure
  helpers the panel needs (`customizerRows`, `configurationChanges`,
  `currentConfigurations`, `capturedValues`, `isPlainValue`) and core's
  `setParameterExpressions` (applying a configuration re-solves the sketches that
  use a parameter in the same step). File format 5.1.1 and 5.4; `formatVersion`
  stays 1 (optional keys).
- 2026-10-03 · **P4-03** Sketch text (ADR-0058): the Text tool (Shift+T) puts
  text on a sketch — string, font, alignment and height in a non-modal panel,
  the height a driving dimension — and the letters come out as closed ink
  regions: an extrude of a whole text sweeps every letter (a plate round a
  text has it cut out as holes), and the selection panel edits the string, the
  font, the alignment and the height. Six bundled OFL fonts (Inter, Noto Serif,
  JetBrains Mono, Allerta Stencil, Fredoka) with versioned IDs; opentype.js
  only in `@extrudo/sketch/text`, behind core's shaper registry.
- 2026-10-03 · **P4-02** Modeled threads (ADR-0056): the Thread feature cuts a
  real ISO 68-1 thread into a shaft's or a hole's round face (Solid › Modify ›
  Thread): ISO metric coarse and fine, UNC and UNF presets or a size that fits
  the face, length/offset from either end, right or left hand, a print
  tolerance (0.1 mm, or the `tolerance` parameter) and 45° lead-ins at open
  ends. Facade `threadSweep`/`threadFace`; every boolean now builds once
  (it ran twice).
- 2026-10-03 · **Landing page and channels** (ADR-0057): `apps/site`, a static landing
  page for extrudo.org with an intro video recorded from the real app (`pnpm demos -g
  intro`); the stable app moves to app.extrudo.org (deployed by a `v*` tag) and the
  latest build to edge.extrudo.org (every green main); the site's `sw.js` retires the
  app's old service worker at extrudo.org and old `#/p/…` links go on to the app;
  `e2e/site.spec.ts`.
- 2026-10-03 · **P4-01** Sweep, loft and coil (ADR-0055): sweep along exact
  sketch curves or edges (follow or fixed, twist, end scale, holes kept), loft
  through profiles, faces and an end point (smooth or ruled, open or closed),
  coil placed like a primitive (three types, taper, hand, circle, square or
  triangle sections inside, on or outside the diameter); seven facade methods
  checked in a native harness first; patterns repeat all three; file format
  6.22 to 6.24; OCCT input hash `9a6136154e2f`; feature patterns skip repeats on the original.

## v0.3.0 (Phase 3, "real CAD")

- 2026-10-02 · **Fix** Repeat visits to extrudo.org failed with `ERR_FAILED`: the
  service worker served a redirected copy of `index.html` (Pages redirects it to `/`)
  for navigations; it now stores and serves a plain copy, and the e2e static host
  redirects like Pages (ADR-0054 amendment).
- 2026-10-02 · **P3-15** Public release prep (ADR-0054; the owner's release
  steps are in `docs/release-checklist.md`): README with screenshots, CONTRIBUTING,
  CODE_OF_CONDUCT (Contributor Covenant 2.1, enforcement through GitHub, no email),
  SECURITY (GitHub private vulnerability reporting), issue forms and a pull request
  template, NOTICE (third-party components and licenses, upstream
  taucad/opencascade.js#40) and `scripts/check-licenses.mjs` in `pnpm lint`;
  `docs/file-format.md` states the MIT license; Cloudflare Pages hosting: `_headers`
  (COOP same-origin, COEP require-corp, CSP, `no-cache` for the shell and `sw.js`,
  immutable hashed assets), a `deploy.yml` workflow that runs after CI succeeds on main and
  skips cleanly without the Cloudflare secrets, `SITE_URL` (default
  `https://extrudo.org`, registered 2026-10-02) in the canonical and Open Graph tags, `docs/deploy.md`;
  the service worker now waits and the app shows "A new version of Extrudo is ready."
  with a Reload button that saves open designs first; `e2e/hosting.spec.ts` runs the build under
  the full header file and `vite preview` (so every e2e spec) under COOP/COEP and the CSP.
  Public-readiness audit of the tree and history: nothing to remove (one note for the
  owner: the commit author address). Versions 0.3.0.
- 2026-10-02 · **P3-12** Onboarding (ADR-0052): the home screen offers a "Take
  the tour" card (once) and a row of four templates with pictures (Wall bracket,
  Storage box, Box with a lid, PCB enclosure: B2, B4 and B5 come from the
  benchmark fixtures through `readArchive`, are precached and open as copies
  under a new ID); a five-step tutorial that builds a box (sketch, rectangle,
  dimension, extrude, fillet) and reads its progress from the design, so undo
  steps it back (Help, Ctrl+K "Tutorial"; a card with a ring round the toolbar
  control, not modal, Esc closes it, `aria-live`); a hint over an empty design
  that points at Create Sketch; toolbar tooltips carry a looping WebM demo for
  twelve tools (Create Sketch, Line, Rectangle, Circle, Dimension, Extrude,
  Revolve, Fillet, Shell, Hole, Press Pull, Rectangular Pattern: 480 × 300, 3 to
  4 s, 19 to 60 kB each), fetched when the tooltip opens, not precached, a still
  under reduced motion, recorded from the app by `pnpm demos` with Playwright's
  own ffmpeg. No kernel, facade or schema change; the axe audit covers the new
  screens and `KNOWN` stays empty. Startup (50 Mbit): first visit home 0.74 to 0.86 s, kernel
  1.16 to 1.33 s; repeat visit home 0.19 to 0.22 s; precache 21.51 to 21.69 MB
  raw (5.30 to 5.47 MB brotli), main chunk +12 kB, demos 0.44 MB outside it.
- 2026-10-01 · **P3-17** (part 2) Polish, done: Place on Bed takes one face
  per body and a Spin angle about the vertical; Overhang Analysis can take a
  picked flat face as "down"; Offset follows a projected face outline (B2
  uses it, fixture rewritten); the OK button's key hint passes contrast in
  the light theme (`KNOWN` is empty); a checked-in screenshot of the overhang
  shading; `operate` finds the bodies a tool touches solid by solid, so B5's
  2 × 20-instance pattern recomputes in 2.4 s instead of 55 s, and the fuzzer
  keeps its seeds 7 and 2026; a pattern of cuts goes one colour class at a time
  (overlapping 10 × 10 holes 7.7 s to 3.7 s); the warm-cache heap growth is
  attributed to `mesh` and moved to P4-12 (a `BRepTools::Clean` experiment
  didn't cure it). No schema version change (`placeOnBed` gains `spin` and
  takes several faces), OCCT hash unchanged.
- 2026-10-01 · **P3-17** (part 1, items 1–10) Polish: browser rows show
  feature status like timeline chips; a single pick is named in its field
  ("Line · Sketch1", "Body1"), and origin axes show while an axis field picks;
  constraint glyphs and dimension labels have a right-click menu (Delete,
  Edit Value); Measure takes sketch points and curves, axes, planes and
  construction points; section analysis clips vertex dots and projected
  curves; timeline chips can be picked and moved together, and dragging near
  the ends scrolls; Appearance has a custom colour; a Remove feature has a
  dialog. Each item amends its own ADR.
- 2026-10-01 · **P3-08** (second half) and **P3-14** (B6) Split Body, Scale,
  Draft and benchmark B6 (ADR-0053): bodies cut along a plane or flat face
  into a body per side (or one side kept); bodies scaled about a point,
  uniformly or per axis (flat faces stay flat), in place or as copies; faces
  tilted about a neutral plane, too-steep drafts refused with the largest
  angle that works. Every face keeps its name through all three. B6, a wall
  hook with a drafted arm and fillets meeting at the plate's corners, is built
  through the UI, kept as a fixture and fuzzed. OCCT input hash `0ba43e09d993` (release `occt-0ba43e09d993`).
- 2026-10-01 · **P3-17 (first item)** Two bugs the fuzzer found in B4 and B5
  (ADR-0038 and ADR-0047 amendments): a fillet radius that reaches a parallel
  wall of an adjacent face (a lid side face with a step 3 mm below its edge)
  trapped OCCT; the facade now refuses it before OCCT runs, with the usual
  "max ≈" message and probes that stay below it. A pattern whose later round
  failed leaked the shapes its earlier rounds kept (the same latent leak in
  Fillet, Chamfer and Mirror's join is fixed too). B4 and B5 join the fuzzer
  (1000 steps on four seeds each; the only further finding is a pattern of
  2 × 20 instances that takes a minute or more, left open). OCCT input hash
  `5449f61f15d6` (release `occt-5449f61f15d6`).
- 2026-09-30 · **P3-14** (part) Benchmarks B4, B5, B7 (ADR-0039 amendment):
  a box with a lid that fits by a clearance parameter, a PCB enclosure with
  screw posts and countersunk lid screws, and a knurled knob, each built
  through the UI in an e2e spec, parameter-driven, exported as 3MF (closed,
  sizes and volumes checked; the lid's gap is the clearance) and kept as a
  fixture the kernel recomputes headless. B6 waits for Draft.
- 2026-09-30 · **P3-13** Hardening (ADR-0050): a seeded fuzzer makes random
  parameter, dimension and expression edits on the benchmark fixtures and
  recomputes them headless (no crash, leak or cache mismatch in 4500 edits);
  it found that shrinking B2 flipped its inner wall across the edge it is
  measured from, so big sketch changes are now solved in small steps. Files
  from a newer Extrudo open with what this version doesn't know left out, and
  a notice says so; feature inputs it doesn't know are a warning, not an
  error. Versions can be deleted (one, or all but the newest 10), and the
  version list is locked across tabs. A recompute's first new error goes
  into the notification history, with Edit. Mesh export works body by body
  with a progress bar, and Cancel stops it. Silhouettes cost a third
  (6 ms per frame at a million curved triangles); the rest of NFR-01 was
  measured and written down. An axe audit covers the main screens in both
  themes; four contrast and ARIA problems were fixed.
- 2026-09-30 · **P3-08 (first half)** Press Pull and Offset Face (ADR-0051):
  Q (Solid › Modify, the marking menu's wedge) pushes or pulls what is
  selected: a face opens the new Offset Face, an edge Fillet, a sketch profile
  Extrude, with the selection already in the dialog. Offset Face moves faces
  along their normals (positive out), the faces next to them following: a pad
  grows or sinks, a cylinder wall changes radius, a hole narrows or widens, and
  fillets round a pad move with it (the dialog picks the whole chain). Every face
  keeps its name, so a fillet after an offset survives editing it; a distance
  that is too far says how far it may go. Extrude and Revolve now share one
  press-pull rule: a face swept into its body, or a profile drawn on a face,
  proposes a cut, out of it a join. Facade change (new `offsetFaces` and
  `tangentFaces`); a body whose rounded edges meet at a sharp corner can't be
  offset yet (OCCT traps on it, so it is refused with a reason); Split, Scale,
  Draft and face patterns are still to do.
- 2026-09-30 · **P3-04** Hole (ADR-0049): the Hole tool (H, Create's menu)
  drills simple, counterbore or countersink holes, blind (drill point 118° by
  default, 0° for a flat bottom) or through all, at the point you click on a
  face or at picked sketch points, with presets for M2 to M8 clearance and
  M2 to M5 heat-set inserts (sizes fill in, nothing is stored). The preview
  is live, with arrows for the diameter and depth; the faces keep their names
  when sizes change, patterns and mirrors repeat holes, and a hole that misses
  the body says so. No facade change.
- 2026-09-30 · **P3-07** Patterns (ADR-0047): Rectangular, Circular and Path
  Pattern (Solid › Create menu) of bodies (copies, or joined to the
  original) or of features (the tool of an extrude, revolve or primitive that
  joins or cuts, repeated at every instance), with counts and distances as
  expressions, symmetric layouts, a second direction for grids, a whole or
  partial angle, and paths of sketch curves and edges; instance faces are
  named per instance so references survive count changes, and many
  instances go through one boolean (10 × 10 in 0.5 to 2 s). Mirror also
  mirrors features now. Ghosts, distance arrows and an angle ring in the
  view; no facade change.
- 2026-09-30 · **P3-10** 3D-print aids (ADR-0048): 3D Print › Prepare gets
  Print Info (volume, weight and filament length for PLA, PETG, ABS, TPU or a
  density of your own, 1.75 or 2.85 mm filament, from the exact volumes, solid
  at 100 % infill), Overhang Analysis (faces leaning out more than an angle
  from a chosen down direction are shaded red; the bed is left out; a row in
  the browser's Analysis folder) and Place on Bed (pick a flat face: its body
  turns so the face lies on the bed, a real feature you can undo, edit and
  export; also in a flat face's context list).
- 2026-09-30 · **P3-03** Shell (ADR-0046): hollow a body by removing faces
  (on one or several bodies) and giving a wall thickness, inside or outside
  the surface; with no face a body is hollowed closed, a sealed void. The
  preview is live. A wall that is too thick says how thick it may be ("A
  12 mm wall is too thick for this body (max ≈ 9.9 mm)"), and a face next to
  a fillet, which OCCT can't open, is refused with a reason. The outside
  keeps its face names in both directions. The Modify group's Shell tile is
  ready. OCCT input hash `6384f5ae452a` (with P3-06's `transform`).
- 2026-09-30 · **P3-09** Section analysis (ADR-0045): Section Analysis in
  Solid › Inspect (Shift+S, Ctrl+K, "Section Here" in the face context
  list) cuts the view through an origin plane, a construction plane or a
  flat face, with the cut filled and hatched (one cap per body, in the
  body's colour tinted towards the Inspect teal). An offset expression, a
  Flip and a draggable arrow set the cut; faces, edges and silhouettes are
  clipped, the grid and origin aren't, and clicks pass through what is cut
  away. It is view state kept through edits and recomputes; the browser's
  Analysis folder turns it off and on, edits or removes it.
- 2026-09-30 · **P3-06** Combine, Move/Copy and Mirror (ADR-0044): Combine
  joins, cuts or intersects a target body with tool bodies (keep the tools
  if you like); Move/Copy moves and turns bodies with an in-view gizmo (an
  arrow and a ring per axis), about a picked axis, or point to point, and can
  keep the original; Mirror reflects bodies about a plane or flat face, as a
  copy, in place or joined to the original. Faces keep their names through
  all three, so later features still find them. Benchmark B3 now uses a real
  Combine. New facade method `transform`, OCCT input hash `8057072e8cdd`.
- 2026-09-29 · **P3-02** Chamfer (ADR-0043): bevel edges in up to eight sets,
  each with its own type (equal distance, two distances with a Flip for
  which face takes distance 1, distance and angle); picking an edge takes
  its tangent chain; the preview is live. A chamfer that can't be built says
  why with the largest distance that works ("Distance 50 mm is too large for
  edge 12 (max ≈ 19 mm)"). The Modify group's Chamfer tile is ready.
- 2026-09-29 · **P3-11** Marking menu and context menus (ADR-0042): a
  right-click without movement opens a ring of eight command wedges
  (Sketch, Extrude, Fillet, Move, Press Pull, Undo, Repeat last, Delete;
  in a sketch the drawing tools, Undo, Construction and Finish Sketch) and
  a list that depends on what was right-clicked (Select other…, Sketch on
  Face, Measure, Hide Body, Appearance…, view commands over empty space);
  click, flick (press, drag, release), arrows, Tab and Esc work, a
  right-drag still navigates, and Ctrl+K "Right-Click Menu: Use a List"
  swaps the ring for a plain list. Browser folders, origin rows, parameter
  rows and design cards got context menus.
- 2026-09-29 · **P3-05** Construction geometry (ADR-0040): offset plane,
  plane at angle, midplane, plane through 3 points, tangent plane, axis
  through 2 points / a cylinder / along an edge, and point, as timeline
  features with dialogs, previews and Shift+P / Shift+A / Shift+X keys. They
  work as sketch planes, primitive placements, extrude "to object" planes
  and revolve axes, are drawn and pickable in the view, and are listed in
  the browser's Construction folder (`docs/file-format.md` 6.10).
- 2026-09-29 · **P3-01** Fillet (ADR-0038): round edges with several edge
  sets, each with its own radius; picking an edge takes its tangent chain;
  the preview is live. A fillet that can't be built says why in plain words
  with the largest radius that works ("Radius 50 mm is too large for edge
  12 (max ≈ 19 mm)"), found by the kernel. The Wall bracket template's
  Fillet1 computes now.
- 2026-09-29 · **P3-16** Notification history (ADR-0041): a bell button
  below the toasts (and Ctrl+K "Notification History") opens the session's
  earlier notifications, newest first with errors in a group on top,
  repeats counted, an unread badge, Clear all; a notification's action
  stays clickable while it still applies (Show for a hidden sketch) and
  shows disabled once it doesn't.

## Phases 0 to 2 (v0.0 to v0.2)

- 2026-09-29 · **P2-17** Benchmarks B2 and B3 (ADR-0039): the parametric
  storage box (cut from a solid, sketch on its top face, exported as 3MF
  and STL) and the phone stand (two bodies joined into one, parametric
  angle, 3MF) are built through the UI in end-to-end specs, and the
  designs of B1, B2 and B3 are saved as fixtures (`fixtures/benchmarks/`)
  that the kernel tests recompute. B3's standalone Combine step waits for
  P3-06: until then bodies merge by a join that touches both.
- 2026-09-29 · **P2-16** File-format spec: `docs/file-format.md` documents
  the `.extrudo` container, versioning and migrations, the document JSON
  (parameters, expressions, every feature type, sketch data, references)
  and a complete example, with a test that keeps it in step with the
  schema.
- 2026-09-29 · **P2-15** WASM size and startup (ADR-0037): the app works
  offline. A small service worker precaches everything (both WASM files,
  the kernel worker, every lazy chunk; updates keep the previous version's
  files for tabs still open), and a web app manifest with icons lets
  browsers install it. The OCCT build now binds only the C++ facade (the
  kernel never used the 198 raw classes it carried): the WASM shrinks from
  4.52 to 3.69 MB brotli (20.19 to 15.76 MB raw) and instantiates about 2.5
  times faster. Measured at 50 Mbit: the whole app is 4.9 MB brotli, a
  first visit shows the home screen in 0.8 s, a repeat visit in 0.22 s, the
  kernel is ready 1.1 s after opening a project.
  `node scripts/measure-startup.mjs` repeats the measurement.
- 2026-09-29 · **P2-14** Version history (ADR-0036): Ctrl+S (or File ›
  Save version…) saves the design as V1, V2, … with a description. The
  Versions dialog (File › Version history…, or the clock beside the
  design's name) lists them; Restore brings one back as a single undo
  step and first keeps what you had as a version too, and Open copy opens
  one as a separate design. Versions are stored with the project and
  travel in exported `.extrudo` files.
- 2026-09-29 · **P2-13** Measure and inspect (ADR-0035): Measure (`I`, in
  Solid › Inspect and 3D Print › Prepare) shows a picked body's volume and
  area, a face's area, type, radius or normal, an edge's length, radius
  and sweep, a vertex's position; two plain clicks measure between two
  things: minimum distance with ΔX, ΔY, ΔZ and a line in the view, the
  angle, the distance between hole centres. All from the kernel's exact
  geometry. The status bar shows the size of the box around the
  selection.
- 2026-09-28 · **P2-11** Timeline v2 (ADR-0033): drag the rollback marker
  (or focus it and use the arrow keys, Home and End); drag chips to
  reorder them, refused with a message when a feature would come before
  something it uses; Roll Back to Here and Move to End in the chip and
  browser menus. A sketch can move to another plane or face (Redefine
  Plane). When a change loses a face, edge, profile or plane a feature
  used, Fix References picks it again (in the feature's dialog, or a new
  plane for a sketch); when the kernel took the closest match (a warning
  chip), Keep Closest Match stores it. While a dialog edits a feature, the
  timeline shows the marker after it.
- 2026-09-28 · **P2-12** STL, 3MF and STEP export (ADR-0034): Export in
  the 3D Print tab, the File menu and a body's menu. Pick bodies (the
  selection, or every shown one), 3MF (objects with names, colours and
  millimetres, for slicers), binary STL or STEP AP242 (exact geometry,
  named products), and Coarse, Medium, Fine or a custom deviation and
  angle. The kernel meshes each body at that resolution into one closed
  surface; the dialog shows the triangle count and that every mesh is
  watertight before saving.
- 2026-09-28 · **P2-10** Primitives (ADR-0032): Box, Cylinder, Sphere and
  Torus in the Solid tab's Create menu, each a parametric feature. They
  open on the XY plane with a live preview; click another origin plane or
  a flat face of a body to move them there (a face proposes its centre and
  Join, or Cut for a box or cylinder pushed in with a negative height).
  Sizes, X, Y and Offset in the plane's frame, a box's rotation, arrows
  and an arc to drag, and new body, join, cut or intersect. A primitive on
  a face follows the face when the model changes.
- 2026-09-28 · Fix: a new extrude or revolve hides the sketches whose
  profiles it used (one undo step with it, as in Fusion), so a used
  profile no longer floats over a pocket and takes the clicks meant for a
  sketch on its floor. A toast bottom left says which sketch was hidden,
  with a Show button, for 12 seconds.
- 2026-09-28 · Fixes: the new **Extrudo** mouse preset is the default
  (middle-drag orbits, right-drag pans, the left button as before;
  Onshape / SolidWorks is still in the Mouse controls menu); dropdown
  options (a dialog's Operation, for one) are readable in the dark theme
  where the browser draws its list white.
- 2026-09-28 · **P2-07** Revolve (ADR-0029): the Solid tab's Revolve
  turns sketch profiles or flat faces about an origin axis, a sketch line
  (construction lines too) or a straight edge: a whole turn by default,
  or an angle one way, symmetric or two ways, flipped as needed; new
  body, join, cut or intersect. Select a profile and an axis first and
  both land in the dialog; an arc in the view drags the angle all the way
  round. The origin axes can now be picked (and are highlighted) in the
  model. The kernel says when the axis isn't in the profile's plane or
  the profile crosses it.
- 2026-09-28 · **P2-09** Sketch on face and Project (ADR-0031): Create
  Sketch now also takes a flat face of a body (click it, or select it
  first); the sketch sits on the face and moves with it when the model
  changes. The Project tool (P, in the Sketch tab's Create menu) brings
  body edges and faces into a sketch, outlines of cylinders included; the
  projected curves are purple, fixed, make profiles, take constraints, and
  follow the model when it changes. A profile drawn on a face and pushed
  in cuts by default.
- 2026-09-28 · **P2-08** Bodies (ADR-0030): new bodies are named Body1,
  Body2… as they appear and keep their names; the browser's Bodies folder
  shows how many there are and renames, hides, colours (ten swatches) and
  fades (opacity) them; a click selects a body. Deleting a body adds a
  Remove feature to the timeline, so undo or rolling back brings it back.
  A cut that splits a body makes one body per piece. Wireframe and
  hidden-edge styles now draw the outlines of holes and other curved
  faces.
- 2026-09-28 · **P2-06** Extrude (ADR-0028): E extrudes selected sketch
  profiles or flat faces into solids, one side, symmetric or two sides,
  each side to a distance, up to a face or vertex, or through all, with a
  taper per side and Flip; new body, join, cut or intersect, with the
  bodies found automatically or picked. The preview shows the new body,
  a green join or a red cut; arrows and taper arcs in the view drag the
  values. Press-pull: select a face and press E; pulling it out joins,
  pushing it in cuts. The browser lists the model's bodies, and the Wall
  bracket template now builds its bracket.
- 2026-09-28 · **P2-05** Feature dialog framework (ADR-0027): features get
  their command dialog from a declarative spec (selection, expression,
  dropdown and toggle fields): it opens on the right with the current
  selection already filled in, picks in the view go into its selection
  fields, and the kernel previews the draft live as a translucent ghost
  (joins green, cuts red), dimmed while an input is invalid or the
  feature fails. Distance arrows and angle arcs drag values, with a
  heads-up box that takes typing. OK is one undo step; a timeline chip
  reopens the dialog for editing, with the model rolled back to the
  feature. Tried on the dialog debug page until Extrude arrives.
- 2026-09-28 · **P2-03** B-rep rendering and 3D selection (ADR-0026): in
  the model, the pointer pre-highlights faces, edges, vertices, sketch
  curves and profiles, a click selects (Shift or Ctrl toggles), Esc
  clears; window and crossing boxes select bodies, or faces with bodies
  filtered out. Hidden geometry is offered by "Select other…" (long press
  or right-click). A selection filter sits beside the nav bar's Select;
  the status bar says what is selected ("2 faces"). Selections turn into
  references through the persistent IDs on body meshes (P2-04).
- 2026-09-27 · **P2-04** Topological naming v1 (ADR-0005): every face,
  edge and vertex of a body has a persistent name from why it exists (an
  extrude's caps and the sketch curve of each side), carried through
  booleans and fillets by OCCT's history; split faces are numbered by
  position, edges and vertices named after their faces. References keep a
  fingerprint; a feature finds its face or edge by name, by a related name
  after a split, or by fingerprint with a warning, and says what to do
  when it's gone. The kernel sweeps (extrude, revolve) with history, and
  body meshes carry the names for selection. A 19-scenario naming suite
  and a 1000-rebuild memory test.

- 2026-09-27 · **P2-02** Sketch → kernel (ADR-0025): the kernel turns a
  sketch's curves into exact OCCT edges (splines cut where they cross
  themselves), splits them where they meet and makes a face for every
  profile, holes included, placed in the sketch plane. Faces carry the
  same region IDs as the profiles the sketch shows, so a later feature
  reads the face a user picked; bridges and dangling lines drop out as in
  the sketch. A 1000-rebuild memory test.

- 2026-09-27 · **P2-01** Recompute engine (ADR-0024): the kernel worker
  walks the timeline and caches each feature's result under a hash of its
  inputs, expression values, references and the bodies before it, so an
  edit at feature 25 of 30 re-evaluates 25–30 and undo re-evaluates
  nothing. Shapes are reference-counted in the cache; a newer request
  cancels a running one between features; dialog previews; the
  `Recomputer` keeps the model store current and survives kernel crashes by
  skipping the feature that crashed. Timeline chips show ✕/⚠ with the
  reason; the status bar counts errors and shows the kernel state. A
  500-recompute memory test.

- 2026-09-27 · **Edits made just before a reload are kept** (found by
  P1-15): the page writes a synchronous rescue copy of an unsaved document
  when it is hidden or goes away, and the next start saves it
  (`Platform.rescue`, `recoverRescued`). ADR-0009 amended. **Parameters on
  the Sketch tab** (Modify group), so the dialog opens while sketching
  without Ctrl+K.

- 2026-09-27 · **P1-15** Benchmark B1 end to end, and the **Phase 1 exit
  (v0.1)**: Playwright builds the parametric plate with four corner holes
  through the UI (user parameters, a fully constrained sketch of 16
  constraints and 7 expression dimensions), changes the hole spacing in the
  open sketch and the width outside it, reloads, and checks the dimension
  labels and every path of the SVG export. `newSketchOnXY` e2e helper.

- 2026-09-27 · **No timeline scrollbar with room to spare** (user report):
  the marker's triangle is wider than its bar and stuck out a pixel at the
  ends of the chip list, which then scrolled; the list has 4 px of padding
  at each end now.

- 2026-09-27 · **F6 fits tightly; no stuck selection box** (user reports):
  Fit frames the box of the bodies, sketches and placed dimension labels
  as seen from the camera, with a 15 % margin, instead of a bounding
  sphere (a face-on sketch filled half the view). A press released over
  the nav bar or a menu no longer leaves a selection box following the
  pointer. ADR-0008 amended.

- 2026-09-27 · **Onshape / SolidWorks mouse controls by default** (owner's
  choice): first in the Mouse controls menu and the default preset
  (right-drag orbits, middle-drag pans); Fusion's mapping is second.
  FR-VP-01, UI spec §3.1 and ADR-0008 updated.

- 2026-09-27 · **No browser menu on right-click** (user report): the
  browser's own "Copy / Select all" menu no longer opens over the view,
  the nav bar, the ViewCube or the panels (it got in the way of Onshape's
  right-button orbit); text fields, links and selected text keep it.
  ADR-0008 amended.

- 2026-09-27 · **Resize circles by the rim** (not a roadmap task, user
  feedback): with no tool running, dragging a circle's rim changes its
  radius while the radius is free (a circle with a fixed centre could not
  be resized by dragging before), and moves the circle when a dimension
  holds it. Solver `beginRadiusDrag`/`dragRadius`. ADR-0018 amended.

- 2026-09-27 · **Pointer modes** (not a roadmap task, user feedback): the
  nav bar's first button is Select, the default pointer mode, pressed
  whenever no nav tool or command runs; it stops either. Starting a tool
  ends Orbit/Pan/Zoom. Orbit and Zoom have their own cursors (they all
  showed a hand). The Solid tab's Select tile is gone; a tool from a
  group's menu lights up its group's label. ADR-0007 and ADR-0008 amended.

- 2026-09-27 · **P1-14** Command search and shortcuts v1: one keymap
  table (`commands/keymap.ts`, Fusion's keys plus Shift+1…7 for the
  standard views) that the toolbar, menus and shortcut handler all read;
  a per-mode command list (`shell/commands.tsx`: the shown tabs' tools,
  edit, view, panel, file and theme commands); fuzzy search that favours
  word starts ("3pr" → 3-Point Rectangle) and falls back to group and
  hint words; the Ctrl+K palette and the S toolbox at the pointer with
  pinned commands (Shift+Enter pins; kept in preferences) and recent
  commands. Keys of tools that come later say when they arrive. The app
  bar has a search button after Undo/Redo, and Help is a menu with Search
  commands and Toolbox. ADR-0023.

- 2026-09-27 · **Design review** (not a roadmap task): the workspace
  switcher is removed; the toolbar's tabs are Solid · Insert · 3D Print
  (Insert and Export left Solid; the model's Export is in 3D Print); the
  browser slides closed in 200 ms and leaves a small "Show browser" tab
  instead of a rail; the status bar shows the viewport's render rate and
  frame time ("idle" while the view is still). ADR-0007 amended.

- 2026-09-27 · **P1-13** SVG and DXF export: `@extrudo/io` gets a neutral
  2D `Drawing` (layers; contours of lines, arcs, elliptical arcs and
  Béziers) with `writeSvg` (width/height in mm, bounding-box viewBox, y
  flipped, exact `A`/`Q`/`C` curves, layers as Inkscape layers) and
  `writeDxf` (R12: LINE/ARC/CIRCLE, POLYLINE for ellipses and splines,
  profiles as closed polylines with bulges, `$INSUNITS` mm).
  `@extrudo/sketch/export` maps a sketch's curves (construction optional,
  on a dashed layer) or its profiles (filled, even-odd, with holes) onto
  it, splines as the Bézier pieces of their B-spline. An "Export sketch"
  dialog (format, contents, selected profiles first, size summary) opens
  from the Sketch tab's new Export group and from a sketch's timeline or
  browser menu. Golden-file tests. ADR-0022.

- 2026-09-27 · **P1-12** Timeline v1 and browser tree: right-click menus
  on timeline chips and browser rows (Edit Sketch, Rename, Show/Hide,
  Suppress, Delete; new design-system `ContextMenu`); rename in place
  (F2 or the menu: a field in the row, a popover over the chip); the
  pointer on a chip or row draws its sketch in the accent; eyes on
  sketches and on the Origin, Sketches and Bodies folders (one undo step
  each); a Construction folder; suppressed chips dashed, rows struck
  through. Core: optional `Feature.visible`, `setFeatureVisibility`, and
  `removeFeature` refuses while another feature refers to the feature or
  an expression outside it uses one of its named dimensions. Suppress and
  delete wait until an open sketch is finished. ADR-0021.

- 2026-09-27 · **P1-11** Profile detection: a TypeScript planar
  arrangement (`@extrudo/sketch/profiles`) finds every closed region of a
  sketch, where curves cross, touch or end on each other, with nested
  groups as holes; exact lines and arcs, ellipses and splines as
  polylines; exact areas; region IDs hashed from their boundary's curves
  and directions (stable across moves, resizes and unrelated edits).
  Profiles are shaded in the view (new `profile-fill` token), hovered and
  selected where no entity is (kind `profile`, `<sketch>/<region>`), with
  their area in the properties panel; the palette's "Show profiles" hides
  them. Also fixed a CI-only e2e failure from P1-10 (a constraint glyph
  over a corner took the click). ADR-0020.

- 2026-09-27 · **P1-10** Modify tools: Trim (`T`, previews what goes),
  Extend, Break; Sketch Fillet (`F`) and Chamfer on a corner point or two
  lines, keeping a virtual sharp so dimensions to the corner survive, with
  a driving radius (distance); Offset (`O`) of a joined chain with parallel
  or concentric pieces and linked distance dimensions; Mirror with
  symmetric constraints; Move (`M`, a solver drag) and Copy; Rectangular
  and Circular Pattern (copies take the original's dimension parameters);
  Scale (points, radii and dimension expressions; refuses fixed geometry).
  Pure operations in `@extrudo/sketch/modify` returning a change for the
  new `modifySketch` command (replace, remove, re-express; one named undo
  step). Seven new tool icons. ADR-0019.

- 2026-09-27 · **P1-09** Selection and editing in sketch: with no tool
  running, hover pre-highlights, click selects (Shift/Ctrl toggles), a drag
  over empty space draws a window (left to right, solid) or crossing box
  (dashed), and a drag on geometry moves it, or the whole selection, with a
  live solve as one undo step (Esc puts it back). The solver drags several
  points across components (`beginDrag(ids)`, `dragBy`). Delete removes
  geometry with its points, constraints and dimensions (`removeFromSketch`
  entities, `entityRemoval`; a spline loses just the point). Properties
  panel in the view's bottom-left: type and status, point X/Y and radius as
  expressions, line length and angle, construction toggle, Delete.
  ADR-0018.

- 2026-09-27 · **P1-08** Constraint status: per-entity colours in the open
  sketch (free `sketch` blue, fully constrained `ink`, over-constrained
  `error` red; construction stays grey), from planegcs's dependent
  parameters (new `get_dependent_params` binding in our planegcs patch;
  `ComponentReport.free`, `sketchStatus`). Red glyphs and labels for what
  over-constrains, including driving dimensions the geometry doesn't meet
  (`unmetDimensions`); constraints on fixed geometry alone don't count.
  DOF counter in the palette. A new over-constraining dimension opens a
  dialog (add as driven, or cancel) instead of going in driven; turning a
  driven dimension driving, or a value the solve doesn't meet, is refused.
  ADR-0017.

- 2026-09-27 · **P1-07** Dimensions: the Sketch Dimension tool (`D`) picks
  a line (length), two lines (angle, or distance if parallel), a point and
  a line, two points, a circle (diameter) or an arc (radius), and places
  the label where you click: horizontal, vertical or aligned by where it
  goes, an angle's pair by its sector (`supplement`). New dimensions drive
  at their measured value and open for editing in place
  (`<ExpressionInput>`, a Driven checkbox, `name = value` creates a
  parameter); one that would over-constrain goes in driven. Labels with
  extension lines and arrows (`tools/dimensionLayout.ts`) select, drag
  (label offset stored from the anchor), and delete. Named driving
  dimensions (`d1`…, typed heads-up values too) are model parameters in the
  Parameters dialog; renames and delete checks cover them. Changing a
  value, or a parameter it uses, re-solves every affected sketch in the
  same undo step (`ToolHost.apply`), and refuses a value the sketch can't
  take. "Show dimensions" palette toggle. ADR-0016.
- 2026-09-26 · **P1-06** Constraints UI: 13 constraint tools (Coincident …
  Symmetric) in a compact two-row Constraints group, with nine new icons.
  They pick points and curves under the cursor (`pickEntity`), highlight
  what a click would pick, and refuse a redundant or conflicting constraint
  with a message; a solve that shrinks a curve to nothing counts as a
  conflict (planegcs reports it as solved). Fix toggles. Glyphs next to the
  geometry (placement in `tools/glyphs.ts`): hover highlights the
  constrained entities, click selects, Delete removes (`removeFromSketch`,
  one undo step), new ones flash; the wheel and middle/right drags pass
  through them to the view. "Show constraints" palette toggle.
  `curvePolyline` in core now shapes every drawn curve. ADR-0015.
- 2026-09-26 · **P1-05** More drawing tools: regular polygons (inscribed,
  circumscribed across the flats, from an edge; equal edges with corners on
  a construction circle; a Sides heads-up field that persists), slots
  (center to center, overall; tangent lines and arcs with a construction
  centerline), ellipses and fit-point splines. Two new entity types in the
  core schema: `ellipse` (three points, mapped to planegcs's ellipse through
  a solver-only focus and ordinary constraints) and `spline` (fit points;
  the curve is a cubic B-spline interpolation in `sketch/curves.ts`, no
  solver equations). Previews draw polylines and construction circles. The
  drawing tools and overlay moved into a lazy chunk (main chunk 950 kB, was
  about 1 MB). ADR-0014.
- 2026-09-26 · **P1-04** Basic drawing tools: rectangles (2-point `R`,
  3-point, center with construction diagonals), circles (center-diameter
  `C`, 2-point, 3-point), arcs (3-point `A`, center point, tangent), points,
  and the Line tool's tangent-arc drag (press on the chain's end and drag).
  Each commits with its structural constraints (corners, H/V or
  perpendicular/parallel, tangent with its side) plus test-solved snaps;
  typed widths, heights, diameters and radii become dimensions. Construction
  toggle (`X`, palette checkbox). Previews draw arcs, circles and dashed
  guides; the viewport reports drags to tools. Variants live in the Create
  menu with their own icons. ADR-0013.
- 2026-09-26 · **P1-02** Sketch tool framework: the inference engine in
  `@extrudo/sketch/inference` (endpoint, center, point, origin, intersection,
  midpoint, on-curve, H/V alignment and guide crossings, grid; unit tested)
  and its auto-constraints, test-solved with `SketchSolver.check` before
  they're committed; `addToSketch` in core (additions plus solved positions
  in one step). Web: tools as state machines under a host, pick rays and
  projection in `camera.ts`, an SVG overlay (rubber band, dashed guides,
  snap glyphs, prompt), the heads-up box (typed length → dimension, typed
  90° multiples → horizontal/vertical), grid snapping that follows the
  visible grid ("Snap to grid" in the palette), Ctrl/⌘ turns snapping off.
  The Line tool (`L`) is the reference tool. ADR-0012.
- 2026-09-26 · **P1-03** Solver integration: `SketchSolver` in
  `packages/sketch` (planegcs adapter): every entity, constraint and
  dimension type mapped (endpoint tangency as `angle_via_point`, an optional
  `reversed` side on `tangent`/`smooth`), fixed geometry as constants, one
  persistent system per independent component, solving only what changed,
  drag with temporary constraints, DOF, conflict and redundancy reports, and
  `check()` to test-solve a new constraint. Our planegcs WASM builds in CI
  once per input hash (`pnpm planegcs`, `pnpm wasm`; shared
  `scripts/wasm-release.mjs`). Fixtures and a benchmark (plates, gear
  outline); debug page `#/debug/solver`. ADR-0011.
- 2026-09-25 · **P1-01** Sketch feature and sketch mode: `SketchData` schema
  in core (points, lines, circles, arcs; every FR-SK-07 constraint and FR-SK-08
  dimension; records keyed by ID; reference checks on load), origin plane
  frames, the `sketch` feature definition (plane `ref` input + sketch data),
  `createSketch`, v0 sketch data migrated to records. Web: Create Sketch
  picks an origin plane in the view (hover highlight) or in a prompt; Look
  At; sketch mode as one undo transaction; the Sketch tab with Finish Sketch;
  the sketch palette; the grid on the sketch plane; sketches drawn in the
  viewport; browser and timeline open sketches; 17 new sketch icons. The Wall
  bracket template has real sketches. ADR-0010.
- 2026-09-25 · **P0-08** Project storage: `packages/storage` with the
  `ProjectStore` interface over an IndexedDB index and OPFS files (IndexedDB
  fallback), `.extrudo` zip read/write through core's migrations, and
  in-memory versions for tests. Web: async platform with project store,
  persistent-storage request and file download/pick; autosave (800 ms, save
  state in the app bar, retry, flush on hide/leave); thumbnails from the
  viewport; hash routes `#/` and `#/p/<id>`; home screen (new design, Wall
  bracket template, grid, search, sort, rename, duplicate, export, import,
  trash, delete forever, storage badge). ADR-0009.
- 2026-09-25 · **P0-05** Viewport: R3F canvas over the glowing background,
  Z-up world; our own camera controller (target + quaternion + size, one
  scale for perspective and orthographic, zoom to cursor, fit, 350 ms
  transitions, instant under reduced motion); Fusion, Blender,
  Onshape/SolidWorks and trackpad mouse presets; adaptive shader grid with X/Y
  axes, Z axis, origin point and planes (Browser eyes); CSS 3D ViewCube with
  faces, edges, corners, home, turn and roll arrows; nav bar (orbit/pan/zoom
  tools, fit F6, orthographic, visual styles, grid, mouse preset); bodies
  from the model store in four visual styles, tried on `#/debug/kernel`.
  Settings are preferences. The viewport is a lazy chunk. Seam edges are
  flagged by the kernel facade and not drawn. ADR-0008.
- 2026-09-25 · **P0-04** Design system and app shell: brand tokens as CSS
  variables (Slate dark default, light) mapped into Tailwind v4, bundled
  Instrument Sans and JetBrains Mono, Radix wrappers (button, icon button with
  tooltip, menu, dialog, popover, inputs), two-tone icon pipeline (17 SVGs,
  rules test), platform preferences, shortcut registry, and the shell: app
  bar, toolbar tabs and groups, resizable and collapsible browser, viewport
  placeholder, timeline with working playback. Parameters dialog moved into
  the shell. Screenshot tests in both themes. ADR-0007.
- 2026-09-25 · **P0-07** Expressions and parameters: Pratt parser with
  source spans, length/angle dimensional analysis (mm and degrees; plain
  numbers take the context unit), the FR-PAR-02 functions, parameter graph
  with cycle paths and "did you mean", model parameters (`ExprInput.unit`),
  rename that rewrites references, refusal to delete a used parameter.
  `<ExpressionInput>` (live value, exact error underline, never commits an
  invalid draft) and the Parameters dialog at `#/debug/parameters`. 226 unit
  tests, Playwright E2E. ADR-0004.
- 2026-09-25 · **P0-06** Document model in `packages/core`: zod schema v1
  (strict objects, document invariants), `loadDocument` with a migration chain
  on raw JSON and a v0 fixture, branded IDs, feature registry types (core holds
  the data part; kernel and web extend it), commands with Immer patches, undo
  history with nested transactions (commit collapses, cancel reverts), and
  vanilla Zustand document/session/model stores. ADR-0003.
- 2026-09-25 · **P0-03** Solver spike (`spikes/p0-03-solver/`): planegcs in
  Node and the browser on a constrained rectangle and on generated 50–500-entity
  sketches; our own planegcs builds (the published one has a fixed 16 MB heap);
  per-component solving; SolveSpace (`slvs`) compared. ADR-0002: planegcs from
  our own build, one solver system per independent component, drag through
  temporary constraints on sketch parameters.
- 2026-09-25 · **P0-09** Kernel package: our trimmed OCCT WASM with a C++
  facade (shapes in an arena, flat result/history/mesh arrays, LGPL-2.1+),
  TS `Kernel` layer, Comlink worker, `KernelClient` that restarts the worker
  after a WASM abort, debug page `#/debug/kernel` rendering the test part.
  Memory test (1000 rebuilds + a leak control) and crash test in Vitest and
  Playwright. CI builds the WASM once per input hash and publishes it as a
  release (`pnpm occt ensure` downloads it).
- 2026-09-25 · **P0-02** Kernel spike (`spikes/p0-02-kernel/`): libcascade,
  replicad and brepjs/occt-wasm compared on the same scenario in Node and a
  browser worker, with sizes, load times, op timings, a memory test and a
  topological-naming history test. Built our own trimmed libcascade WASM
  (4.34 MB brotli, about 200 ms cold start). Found that libcascade's `delete()`
  often doesn't free C++-owned memory. ADR-0001: own trimmed build + a C++
  facade that owns memory + a thin TS layer.
- 2026-09-25 · **P0-01** Repo and toolchain: git, pnpm 12 monorepo (`apps/web`,
  `packages/{core,sketch,kernel,io,storage}`), TypeScript 7 strict, Biome 2.5,
  Vitest 5, Playwright 1.63, GitHub Actions CI, GPL-3.0 (+ MIT for `io`),
  package-boundary check, branded hello page.
