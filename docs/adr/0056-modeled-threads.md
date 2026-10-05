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
  file format, `docs/file-format.md` 6.25. **The facade changed** (OCCT input
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
