# ADR-0056: Modeled threads

- **Status:** Accepted, 2026-10-03
- **Task:** P4-02 (FR-FT-15). Code: the facade's `threadSweep` and
  `threadFace` (`packages/kernel/occt/facade/extrudo_facade.cpp`, block
  "threads", at the end of the public methods), and a fix to its `boolean`;
  `Kernel.threadSweep`, `Kernel.threadFace`, `ThreadFace`
  (`packages/kernel/src/kernel.ts`), `namedThreadSweep`
  (`packages/kernel/src/naming/ops.ts`); the definition
  `packages/core/src/thread.ts` (schema, ISO profile, presets, `autoThread`);
  the evaluator `packages/kernel/src/features/thread.ts`; the dialog
  `apps/web/src/features/thread.ts` (tool `thread` in Solid › Modify's menu, no
  key); `e2e/thread.spec.ts`; the native harness `spikes/p4-02-harness/`; the
  file format, `docs/file-format.md` 6.25. Amended three times (profiles,
  multi-start, tapered threads on cones: below). **The facade changed** (OCCT input
  hash `86f6c3f92d7a`, release `occt-86f6c3f92d7a`; additive but for the
  boolean fix), no schema-version change, no migration; one new feature type.
- **Builds on:** ADR-0049 (hole: presets that fill sizes, a feature that always
  cuts, patternable), ADR-0029 (revolve, `namedRevolve`), ADR-0005 (naming),
  ADR-0047 (`mergeTools`, `operate`, repeatable features), ADR-0027 (dialogs).

## Context

FR-FT-15 asks for modeled threads, ISO metric and inch presets, and a print
tolerance. For 3D printing the thread must be real geometry: a cosmetic thread
(a texture, a dashed line) prints as a plain cylinder. Benchmark B9 (P4-11) is
a threaded bottle cap and a thread adapter, so a thread must work on a shaft
and in a hole, on faces made by a primitive, an extrude, a revolve and a Hole.

The kernel had no helical geometry, and nothing built from existing calls
(prisms, revolves, booleans) makes a true helix. P4-01 (sweep, loft, coil)
was being built at the same time on its own branch with a `helix` and a
`sweep` facade method; its brief said threads might reuse them.

## Decision

### 1. The thread is a cut: ring − tooth

Per face, in the half-plane through the face's axis (u from the axis, v along
it), the evaluator builds one cut tool:

- the **ring**: from the thread's root radius out to just past the face (a
  shaft), or from just inside the face out to the root (a hole), over the
  thread's length, turned a whole turn (`namedRevolve`);
- the **tooth** of the part (crest flat, two 60° flanks, a foot reaching
  0.25 P past the root, its sides square to the axis beyond a kink 0.05 P past
  the root so the foot stays clear of the next turn), swept along the helix
  (`threadSweep`) from a pitch before the thread to a pitch after it;
- tool = ring − tooth, cut from the face's body by `operate` (participants:
  the faces' bodies only).

So a shaft and a hole are the same construction mirrored in u, the root flat
is the ring's exact cylinder, the crest flat is the swept one, and the ends of
a thread that stops inside the face are the ring's flat ends (`end0`, `end1`).
A shaft thicker than the thread is turned down to it (the ring reaches past
the face); a hole smaller than the thread's minor diameter is bored out to it.
Several faces give several tools, merged by `mergeTools` into one cut. The
thread always cuts, so it is a repeatable feature for patterns and mirrors
(`featureList.ts`), like a hole.

### 2. Profile and tolerance

The ISO 68-1 basic profile (H = √3/2 P): on a shaft the crest is the major
radius D/2 with a P/8 flat, the root the minor radius D/2 − 5H/8 (D −
1.0825 P) with a P/4 flat; in a hole the reverse. The rounded root of ISO's
external design profile is not modelled: the basic profile prints the same at
FDM resolution and makes a screw and a nut exact complements. UNC and UNF use
the same 60° form, so they are presets of the same profile.

**`tolerance` moves the whole profile radially into the part's material**
(default 0.1 mm): an external thread's diameters shrink by 2t, an internal
one's grow by 2t. Two mating parts with 0.1 mm each have 0.4 mm between their
diameters and 0.2 mm between their flanks (t · sin 30° per part), which is
what printing threads usually needs. The kernel test checks that a screw and a
nut of M8 with the default tolerance have no shared volume and at least
0.09 mm between them. A shaft's tooth is centred on `from − P`, a hole's half a
pitch on, so a screw and a nut whose threads start at the same plane mesh.

### 3. Sizes and presets

`diameter` and `pitch` are plain expressions. **With neither, the kernel picks
the ISO metric coarse thread that fits each face** (`autoThread`: on a shaft
the largest with D ≤ shaft + 0.1 mm, in a hole the largest whose minor diameter
is ≤ hole + 0.1 mm and whose D is larger: a tap-drill hole finds its thread).
The dialog's Size dropdown starts there ("Fit the face"). Presets (ISO coarse
M2–M30, common fine pitches M8–M30, UNC and UNF #4 to 1") are not stored: they
fill the two fields, inch ones as `0.25 in` and `1 in / 20`, and the dropdown
shows the preset the fields match, as the hole's does.

### 4. The document's `tolerance` parameter

FR-3DP-05's document-level `tolerance` parameter doesn't exist yet (P4-08 adds
the helper that makes it). Decision: **a new thread's Tolerance field refers to
a length parameter named `tolerance` when the document has one** (the dialog's
`propose`, `TOLERANCE_PARAMETER` in core), else it is `0.1 mm`. It is stored as
the expression `tolerance`, so changing the parameter re-threads every part.
The kernel's default for a missing input stays 0.1 mm (it can't look up
parameters by name). P4-08 only needs to create the parameter.

### 5. Ends

`threadFace` tells whether each end of the face is an **open** edge: the face
across it turns away (its outward normal points out of the face's run, dot <
−0.5) along the whole circle. That is a shaft's free end and a hole's mouth,
not a shoulder, a hole's floor or a smooth (filleted) join. With `chamfer`
(default on) a thread that runs out of an open end gets a 45° lead-in: before
the tool is made the tooth is cut back by the region outside a cone that meets
the end plane 0.1 P past the root (both ends in one cut, as one compound), so
the first turn grows out of the end instead of starting as a sliver, prints
without a loose flap and screws in.

### 6. Facade: `threadSweep`, `threadFace`

- `threadSweep(profile, axis, pitch, turns, left)`: the planar profile in a
  plane through the axis, swept by `BRepOffsetAPI_MakePipeShell` with a fixed
  binormal (the axis) along a helix through the profile's centre, so every
  point runs on its own helix of the same pitch. The helix is **one edge per
  turn** (2D lines on a `Geom_CylindricalSurface`, `BuildCurves3d` at 1e-5):
  with one long edge for all turns (30 turns), OCCT's boolean of ring and tooth
  silently returned the ring uncut. Refused before OCCT runs: a non-planar
  profile, a plane that doesn't hold the axis, a profile touching the axis or
  as long as the pitch along it (the turns would touch), more than 2000 turns.
  The result must pass `BRepCheck_Analyzer` and have a positive volume.
  History like `prism`'s: side faces generated per profile edge (one per turn,
  `#n` in names), the two caps as first and last (told apart by distance from
  the profile).
- `threadFace(shape, face)`: the cylinder's axis (canonical sign), radius,
  inside/outside (from the face's normal), its run along the axis (`h0`, `h1`
  from the UV bounds), whether it goes all the way round, and whether each end
  is open (above). Cheaper and exact compared with probing from TypeScript.

Names: `thread:<feature>:side:f<k>.<part>`, part `crest`, `flank0`, `flank1`,
`root`, `end0`/`end1`, `lead0`/`lead1`; k is the face's place in the input.
Faces are found with `ctx.resolve`, which reports a face it can't find as for
every feature (Fix References offers it). Errors name the problem and the numbers: not cylindrical, not a
whole turn, a shaft at or under the thread's root, a hole as wide as the
thread, a thread longer than the face, an offset as long as the face, more
than `MAX_TURNS` (150) turns, no standard size that fits; a shaft much thicker
than the thread, or a hole much smaller, is a warning.

### 7. The tooth is cut out of the ring in pieces (ADR-0067 §H2)

`buildTool` sweeps the whole tooth in one `threadSweep` and cuts it out of the
ring in one boolean, which works up to about 350 turns and above that runs the
WASM heap out of memory: a boolean's memory grows with the faces it works on
(4 MB a turn), 350 turns take the heap from 403 MB to 1903 MB, and 400 turns
need more than a 32-bit WASM module can grow to, so `operator new` returns null
and OCCT calls through it while unwinding — the `RuntimeError: table index is
out of bounds` B9's fuzzing found, and later features read freed memory. The
tooth is now swept and cut in pieces of `THREAD_CHUNK` (`MAX_TURNS` + the two
pitches it runs past the thread, so a thread of as many turns as may be
modeled is one piece and its cut is unchanged) and each piece is released as
soon as it has been cut. The memory each boolean needs is then flat, and the
cap is about the time a thread takes (0.35 s a turn piece-wise, 0.1 s in one
cut) rather than about a trap. `spikes/p4-12-threads/` is the harness that
found it; ADR-0067 §H2 has the bisect, the trace with function names and the
measurements.

### 8. Booleans were built twice

`finishBoolean` called `Build()` on a `BRepAlgoAPI_Cut/Fuse/Common` made with
the two-shape constructor, which already builds: **every boolean in the app
ran twice**. The arguments are now set with `SetArguments`/`SetTools` on a
default-constructed builder. Results are identical (every golden table and the
fuzzer pass unchanged); every boolean takes about half the time.

## Performance

Measured in the native harness (WASM in Node on the 4-core Ubuntu machine) and
with `BENCH=1 pnpm vitest run packages/kernel/src/features/thread.test.ts`
(one thread on a fresh engine, the whole recompute including meshing):

| Thread | Recompute | Booleans | Triangles |
|---|---|---|---|
| M8 × 12 mm shaft | 2.8 s | 2.0 s | 4,400 |
| M3 × 10 mm shaft (20 turns) | 3.9 s | 2.9 s | 8,500 |
| M20 × 30 mm shaft | 3.0 s | 2.1 s | 4,800 |
| M30 × 30 mm shaft | 2.4 s | 1.7 s | 4,400 |

About 0.1 s per turn, in the ring − tooth boolean: OCCT intersects the root
cylinder and the end planes with the swept B-spline flanks by marching, about
50 ms per flank and turn. Tried without effect: coarser helix and pipe
tolerances, lower pipe-surface degrees (slower), half-turn edges (slower), a
fuzzy value. Display meshing stays light (70–110 ms, under 10k triangles at
the default deflection). A thread is far from NFR-01's 150 ms for a *simple*
feature, but it is cached like every feature: it recomputes only when its
inputs or the body before it change. Dialog previews take the same seconds.

## Rejected

- **No facade change** (stacked revolves, twisted prisms): no true helix, so
  no thread that screws into another part.
- **A groove sweep** (the space between teeth swept, cut directly): the groove
  is a whole pitch wide beyond the crest, so neighbouring turns touch and the
  sweep isn't a valid solid; narrowing it leaves a fin to remove with a second
  cut, which costs the same as ring − tooth.
- **A full-period profile sweep fused to the core**: neighbouring turns share
  faces (invalid), and leaving a gap brings back the cylinder intersections.
- **Offsetting the flanks normal to themselves by the tolerance**: for fine
  pitches (t > 0.108 P, so t = 0.1 mm on M3) the crest flat vanishes; a radial
  shift keeps the profile whole for any pitch.
- **Building the thread surface directly (no booleans)**: the ends, where the
  ring's planes and the lead-in cones cut the helix, are the hard part and
  would need the same intersections.
- **A cosmetic mode**: out of scope (useless for printing).
- **Storing the preset**: like the hole's, the plain numbers are the source of
  truth and presets can be revised freely.

## P4-01's helix

P4-01's `helix` builds one edge per turn, as `threadSweep` does. Threads keep
their own `threadSweep` anyway. A coil and a thread could share one helix
builder later; the two sweeps differ (a thread's profile lies in a plane
through the axis and keeps a fixed binormal, which is also what a coil wants),
so merging them is a refactor for later, not a change of behaviour.

## Deferred

On-canvas handles (length, offset), tapered (pipe) threads, other profiles
(trapezoidal, buttress, bottle-cap threads with their own profile: B9 will show
whether the 60° profile with a coarse custom pitch is enough), multi-start
threads, a thread per face with its own size, a faster preview.

## P4-12 amendment (2026-10-06): thread profiles

The tooth was one 60° ISO form. A `profile` input now picks it from a pure
table, `threadProfile(profile, pitch)`, in `packages/core/src/thread.ts`: it
returns the outline as lines and arcs in (axial, radial) coordinates and the
crest-to-root depth, so `toothSection` only stages the curves and the kernel
knows no angles of its own. `iso` (the default) reproduces the old tooth
bit for bit, so every existing document and the golden table's rows are
unchanged and no migration is needed. `threadRadii` takes the profile and
places its depth under the major radius. Names are unchanged: a rounded crest
or root is still one `crest`/`root` face.

The profiles, with the numbers and where they come from:

- **`iso`** — the ISO 68-1 basic profile as before: 60° included (30° a
  flank), depth 5H/8 = 5√3/16 P ≈ 0.5413 P, crest flat P/8 at the major
  diameter (P/4 on a nut's minor).
- **`trapezoidal`** — ISO 2901 / DIN 103 **Tr**: 30° included (15° a flank),
  thread height H1 = 0.5 P, and equal crest and root flats of 0.366 P (the
  land DIN 103 lists), which makes the tooth tile exactly one pitch.
- **`buttress`** — DIN 513 **S** (3°/30°): a 3° load flank and a 30° trailing
  flank, a crest flat of 0.26384 P. The standard's basic profile (fundamental
  triangle H = 1.5878 P, full depth h3 = 0.867767 P, clearance
  ac = 0.117767 P, crest width 0.26384 P, root radius R = 0.124271 P) is
  quoted from DIN 513:1985 (mirrored in the Bornemann and Gage Crib tables);
  the modelled tooth stops at the load-bearing height H1 = 0.75 P and lets
  `tolerance` supply the clearance, which is the print-friendly choice. A new
  `loadFlank` enum (`start`/`end`, default `end`) says which axial end the
  steep 3° flank faces; `flip` still says which end the thread starts from.
- **`bottle`** — the PCO-1881 carbonated-drink finish: neck Ø27.43 mm, pitch
  2.7 mm, thread height ≈1.15 mm (≈0.45 P), single start, about two turns
  (from the PCO-1881 neck drawing / ISBT finish). The real finish is a
  rounded sawtooth; the modelled profile is the printed-friendly rounded
  trapezoid the P4-12 brief asks for — 20° flanks, a 0.3 P crest flat, a
  0.45 P depth — with the crest and the root corners rounded by arcs (0.06 P
  radii): FDM threads want a symmetric, rounded tooth, not a moulding.

`THREAD_PROFILES` carries the enum values with a label and a one-line
description for the dialog. `THREAD_PRESETS` gains a **Trapezoidal** group
(Tr 8×1.5, Tr 10×2, Tr 12×3, Tr 16×4, Tr 20×4) and a **Bottle** group
(`pco-1881` = Ø27.43 × 2.7), each setting the profile as well as the size;
`threadPresetOf`/`presetOf` match the profile too, so the same size in
another profile is not that preset and not stored. `autoThread` (Size
`auto`) stays ISO coarse: another profile with no size is refused with
"Enter a diameter and pitch for a <profile> thread." The dialog gets a
Profile select after Size and, only for buttress, a Load flank select; no
handles. Multi-start and tapered (pipe) threads stay deferred.


## Second amendment (2026-10-07): multi-start threads

P4-12. A thread may have `starts` helices (2, 3, … 8), the way a soda-bottle
finish or a fast lead screw is cut: the lead (how far one helix advances in a
turn) is `starts × pitch`, while the tooth keeps its profile and `pitch`
(crest to crest along the axis).

- **Input.** `starts`, an optional unitless `expr` like a pattern's `count` (so
  a parameter can drive it), default 1, **stored only when it isn't 1**
  (a single-start file is what it was; `docs/file-format.md` §6.33). The kernel
  refuses anything but a whole number from 1 to 8 ("Starts must be a whole
  number from 1 to 8.").
- **Geometry.** No facade change: `threadSweep`'s `pitch` argument is the
  helix's lead, so every sweep passes `starts × pitch`. Shifting a tooth one
  pitch along the axis is the same as turning it by 360° / starts, so start `j`
  of a piece is the **same section placed `j × pitch` higher**
  (`centre + piece.from × lead + j × pitch`). The teeth of one piece never
  touch (a root flat lies between them), so they are **one compound** (not
  `mergeTools`, which would fuse heavy teeth whose boxes overlap) cut in one
  boolean; the lead-ins still cut the first and last piece's teeth back. The
  turns of a helix are `length / lead + 2`, and `MAX_TURNS` (150) counts them
  **per helix** ("… turns per start …"), so a long thin thread that is over
  the limit at one start builds at two. `starts = 1` goes through exactly the
  same calls as before (the golden table's rows are unchanged).
- **Names.** With one start nothing changes. With more, each start's tooth
  faces carry `s<j>.` inside the role: `thread:<id>:side:f0.s1.crest`, `….flank0`,
  `….flank1`, per turn `#n` as before; `root`, the end steps and lead-ins keep
  their names.
- **Report.** `ThreadOutputFace.starts` and `.leadLength` (mm; `lead` was
  already the lead-ins' flags); `turns` is per helix; the designation appends
  ", 2 starts". The dialog has a **Starts** textbox after Hand.

**Rejected.** A `lead` input instead of `starts`: a lead that isn't a multiple
of the pitch has no meaning for a tooth (the teeth would not tile the lead),
and a whole number of starts is how the standards name it. A different tooth
per start: nothing a printed part needs, and it would break the identity with
turning a tooth by 360° / starts.

**Results.** On the default Ø20 × 20 cylinder at M20 × 2.5 (kernel
`thread-starts.test.ts`): the removed volume is 1071.79 mm³ at one start,
1072.16 mm³ at two (+0.03 %) and 1091.37 mm³ at three (+1.83 %: fewer whole
turns for the lead-ins to cut); 39 faces at one start, 43 at two (8 and 9
crest faces: two helices of half the turns each, so about as many crest faces
in all, not twice as many). A 4 mm × 40 mm thread at 0.25 mm pitch (160 turns
at one start, refused) builds at two starts in 34.8 s (2 × 80 turns).


## Third amendment (2026-10-07): tapered threads on conical faces

P4-12. A thread cut on a **conical** face follows the cone, so an NPT pipe
thread (1:16 on the diameter) can be modeled. Code: the facade's `threadFace`,
`threadSweep` and the private `helixWire`; `ThreadFace.taper`,
`Kernel.threadSweep(…, taper)`, `namedThreadSweep`'s `taper`; core's NPT
presets, `NPT_TAPER`, `TAPER_SLACK`, `autoTaperThread`, `taperDegrees`,
`ThreadReport`; `planThread`, `shiftAt` and the sections in
`packages/kernel/src/features/thread.ts`; the dialog's Thread line; the native
harness `spikes/p4-12-thread-taper/`. **The facade changed** (OCCT input hash
`ec62df7eead4`, release `occt-ec62df7eead4`), no schema change, no new input,
`docs/file-format.md` unchanged.

- **No input decides the taper: the face does.** `threadFace` accepts a
  `GeomAbs_Cone` as well as a cylinder and returns a fourteenth number, the
  cone's half angle (radians, signed along the canonical axis it reports:
  positive when the radius grows along it); `radius` is the radius at the
  face's lower end (`from`), so the radius at `h` is `radius + (h − from) ·
  tan(taper)`, and a cylinder's taper is 0. A cone's `v` runs along its
  generator, so the heights are `v · cos(halfAngle)`; the ends' "open" test
  and the material side work unchanged. Emboss, which asks `threadFace` first,
  keeps cones on `coneFace` (`taper === 0` only).
- **The sweep.** `threadSweep` takes a trailing `taper` (radians; |taper| <
  90°, and a narrowing cone must not bring the profile to the axis before the
  end). Its path is the helix through the profile's centre on the **cone** of
  that half angle (a pitch along the axis is `pitch / cos(taper)` along the
  generator), still one edge per turn, the profile keeping its angle to the
  axis (fixed binormal). So every point of the tooth runs on a conical helix of
  the same taper — to within the frame's small turn as the helix's lead angle
  changes with the radius (estimated, not measured: under 1e-3 rad over an
  NPT 1/2 thread, about a micrometre at the tooth). `helix` and `threadSweep` now build their turns
  through one private `helixWire`, but **each keeps its own construction**: the
  coil's turns share vertices along one 2D line, the thread's are lines of
  their own joined by the wire builder. Making them one construction moved a
  straight thread's volume by about 2e-7 (469.402611 → 469.402521 mm³ on an M8
  × 12 mm), which a mesh fingerprint or a golden row could see; with the flag
  the harness's `compare` builds four straight threads bit for bit as main's
  facade does.
- **The plan.** On a cone the thread's radii (`threadRadii`) hold at the
  face's **small end** (`ThreadPlan.anchor`: `from` for a positive taper, `to`
  for a negative one), where NPT gives its diameter, and every radius in the
  sections is moved by `shiftAt(v) = (v − anchor) · tan(taper)`: the ring is
  the cone's band (a trapezoid in (radial, axial)), the lead-ins' corners move
  with their heights (so their 45° is measured from the cone), and each tooth
  is drawn with the radii the cone has at its centre and swept along the
  conical helix; the tolerance stays radial. Starts compose (each start's
  tooth is a pitch higher with the radius there). On a cylinder `shiftAt` is
  0, so the sections are exactly what they were.
- **Presets and fitting.** `THREAD_PRESETS` gains an **NPT** group (`npt-1q8`,
  `npt-1q4`, `npt-3q8`, `npt-1q2`, `npt-3q4`, `npt-1`): ASME B1.20.1 Table 2's
  E0 (the pitch diameter at the external thread's small end: 0.36351,
  0.47739, 0.61201, 0.75843, 0.96768, 1.21363 in) plus h = 0.8 p is the major
  diameter at the small end, for every size the same rule (`diameter: '0.75843
  in + 0.8 in / 14'`, `pitch: '1 in / 14'`), and `taper: NPT_TAPER` =
  atan(1/32) = 1.7899°. `threadPresetOf(…, taper)` matches a preset only when
  its taper (0 for a straight one) is within `TAPER_SLACK` (0.2°) of the
  face's either way, so `designation` says "NPT 1/2" on its cone, "Ø20 × 1.5,
  taper 5°" for a custom size on another one, and an M20 on a cone is "Ø20 ×
  2.5, taper 1.8°". With no size, a cone within 0.2° of NPT's taper takes the
  NPT size `autoThread`'s rule fits to its small end (`autoTaperThread`); any
  other cone is refused: "Enter a diameter and pitch: this cone's taper (5°)
  isn't a pipe thread's." An NPT size on a cylinder or a cone of another
  taper is a **warning** naming both angles ("NPT 1/2 is made for a 1.8°
  taper, but this face is a cylinder (0°): the thread follows the face."), and
  it is cut with the face's taper.
- **Report and dialog.** `ThreadOutputFace.taper` (degrees, signed) and `face`
  (the diameter at the small end); the evaluator reports a `ThreadReport`
  (`{ kind: 'thread', designations }`), which reaches the dialog as
  `Preview.thread`/`DialogContext.draftThread` and shows as the read-only
  **Thread** line (`[data-info="designation"]`) under Pitch. The Size select
  lists the NPT group ("NPT 1/2 (pipe, tapered)").

**Rejected.** A `taper` input: the face already says it, and an input could
only disagree with it. A dedicated NPT profile table: NPT's flanks are 60° like
ISO 68-1's and only its truncation differs (h = 0.8 p against ISO's 5H/8 =
0.541 p); the ISO basic profile on the NPT cone is what a printed pipe fitting
needs, so the NPT preset's profile is `iso`. Sharing one helix construction
between the coil and the thread (above). **Deferred:** BSPT (55° Whitworth
flanks, a profile of its own), NPTF's dryseal truncation, a taper that changes
along one face.

**Results.** Native harness (`spikes/p4-12-thread-taper/run.sh`, O1): on a
cone of r0 = 10 at NPT 1/2's pitch and taper, the eleven turn ends of the
conical helix lie at r0 + n · P · tan(taper) to 0 mm (exactly) and n · P to
1.8e-15 mm, and its B-spline stays within 3.3e-6 mm of the cone (its
tolerance is 1e-5). NPT 1/2 cut into a 20 mm cone (small-end major Ø20.7156)
is valid, 51 faces, in 3.3 s, and removes 839.239 mm³ against 839.434 mm³ for
a straight thread at the mean radius (ratio 0.9998); `leaks 300` holds the heap
top at 36.9 MB from round 50 to round 300. Kernel (`thread-taper.test.ts`, the
same cone through `revolve` and the engine): both ends are cut down past the
thread's depth (0.982 mm) by the lead-ins — at the small end the body reaches
9.2764 mm from the axis where the cone is 10.3578 mm, at the large end 9.9008
against 10.9828 — the crests stay within 0.08 mm under the cone less the
tolerance at z = 5, 10 and 15, the height is unchanged, and the removed volume
is 869.488 mm³ against 869.658 mm³ for the straight thread on the mean
diameter (−0.02 %). Auto fits NPT 1/2 to the cone from either end, two starts
build, an internal NPT 1/2 in a hole extruded with a 1.79° taper builds, NPT on
a Ø20.72 cylinder warns, and a 5° cone with no size is refused. The golden
table's existing rows are unchanged; two rows are appended (NPT 1/2 on a 10 mm
cone: 3030.1 mm³, 28 faces; Ø20 × 1.5 on a 5° cone: 2414.3 mm³). The OCCT WASM
grew by 339 bytes raw and 1.3 kB brotli (20.57 / 6.66 / 4.63 MB, as before at
two decimals).
