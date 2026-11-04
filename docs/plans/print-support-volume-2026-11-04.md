# Print Info: support volume (plan, 2026-11-04)

**Status:** plan only, nothing built. **Deferred** (owner, 2026-11-04): it will be handled
differently; kept as a record of what was measured. The open item is P4-12's "Print Info: … **Still open:
support volume**, which needs a slicer's support generation" (`docs/03-roadmap.md`, the
Print Info bullet of the P4-12 backlog). It builds on ADR-0048 (Print Info, the overhang
analysis) and its P4-12 amendment (walls, infill, cost; `printEstimate` in
`apps/web/src/print/material.ts`). Code pointers are against `main` at `f9d00223`. The owner's
decisions are at the end, numbered.

## Recommendation

**A rough estimate is good enough; don't wait for a real slicer.** Build our own: a **column
grid** over the display meshes that measures, for each body, the air under its overhangs down
to the next surface or the bed (the *column*, mm³) and the area that needs support (the
*footprint*, mm²), and turns them into material with two constants per support style:

```
support = column × density + footprint × interface
normal (grid/snug):  density 0.15, interface 1.7 mm
tree (organic):      density 0.11, interface 0.5 mm
```

Against PrusaSlicer 2.9.6 this lands within about ±15–25 % on most models and ±50 % on the
worst (threads, a helix); a very small overhang can be further off (a 0.4 cm³ button: −94 %
against grid supports). That error is smaller than what the user's own
slicer choices change: the same slicer, same model, gives 1.4–3.1× more support with normal
than with tree supports, and PrusaSlicer's default "don't support bridges" takes a box's
ceiling from 19.6 cm³ to 0.1 cm³. A real slicer would need to know the user's printer profile
to beat that, and the web app can't run one (see Rejected).

The work is pure TypeScript in `apps/web/src/print/`, next to `overhang.ts` and `thickness.ts`:
no kernel, facade, schema or file-format change, no new dependency or licence, the same in the
web app and the desktop app, and ≤ 30 ms on every model measured.

## What was measured

A prototype (Node, not in the repository; the algorithm below is all of it) on 25 shapes: 8
synthetic ones with a known answer (made with manifold-3d), 9 benchmark designs (B2–B7, B9,
B10, P4-01) as `extrudo export` writes them, and the 8 STL fixtures of
`fixtures/imports/mesh-to-solid/`. Each was sliced with the PrusaSlicer 2.9.6 CLI at a 45°
threshold, 0.2 mm layers, 15 % infill, 2 perimeters, in three styles (`grid`, `snug`,
`organic`), and the support and support-interface extrusion summed from the G-code's
`;TYPE:` sections. "Bridges supported" (`--no-dont-support-bridges`) so that the slicer
supports what the column counts; the bridge default is reported separately below.

**The column is exact.** On the synthetic shapes it matches the hand-computed volume to the
cell: table on four legs 30,000 mm³, mushroom 12,560 (π·200·20 = 12,566), shelf half over a
block 27,000, 30° ramp 17,604 (17,600), 60° ramp 0, T 18,000, bridge 30,000. Halving or
doubling the cell (0.25–2 mm) moves the bottle cap's column by under 5 %.

Support + interface volume in cm³ ("est." is the formula above, bold):

| Model | triangles | ms | column | footprint cm² | Prusa grid | Prusa snug | est. normal | Prusa organic | est. tree |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| B10 chain link | 2,694 | 10 | 10.5 | 6.7 | 4.5 | 3.2 | **2.7** | 2.4 | **1.5** |
| B4 box with lid | 192 | 4 | 57.8 | 24.0 | 10.1 | 9.8 | **12.8** | 5.5 | **7.6** |
| B5 PCB enclosure | 3,208 | 13 | 110.6 | 47.7 | 19.6 | 19.6 | **24.7** | 11.4 | **14.6** |
| B9 bottle cap (2 bodies) | 11,820 | 15 | 23.7 | 8.0 | 9.6 | 7.4 | **4.9** | 4.1 | **3.0** |
| P4-01 sweep/loft coil | 26,630 | 15 | 7.1 | 2.3 | 5.1 | 2.7 | **1.4** | 1.7 | **0.9** |
| trashcan repair foot | 4,508 | 9 | 31.4 | 18.4 | 8.9 | 6.5 | **7.8** | 4.2 | **4.4** |
| trashcan spacer | 1,980 | 13 | 0.5 | 5.4 | 0.9 | 1.0 | **1.0** | 0.3 | **0.3** |
| bridge (synthetic) | 36 | 0 | 30.0 | 12.0 | 6.5 | 6.1 | **6.5** | 4.0 | **3.9** |
| mushroom | 764 | 0 | 12.6 | 6.3 | 4.1 | 3.1 | **3.0** | 1.9 | **1.7** |
| 30° ramp | 24 | 0 | 17.6 | 6.0 | 4.5 | 3.9 | **3.7** | 0 | **2.2** |
| shelf | 36 | 1 | 27.0 | 12.0 | 7.3 | 6.2 | **6.1** | 4.4 | **3.6** |
| sphere on the bed | 8,192 | 4 | 0.7 | 3.0 | 0.9 | 0.6 | **0.6** | 0.2 | **0.2** |
| table | 68 | 3 | 30.0 | 15.0 | 6.1 | 6.0 | **7.0** | 4.4 | **4.0** |
| T | 28 | 0 | 18.0 | 6.0 | 4.8 | 4.1 | **3.7** | 2.3 | **2.3** |

Models where both are ~0 (B2, B3, B6, B7, the drill block, hole filler, button, puzzle base,
flight cover, track) are left out; B7 and the button are 0.1 cm³ and 0.1–0.4 cm³.

| Formula vs slicer style (models with > 0.3 cm³ of support) | median error | worst | within ±30 % |
|---|---:|---:|---:|
| normal vs Prusa `snug` | 15 % | 47 % (coil) | 12 of 14 |
| normal vs Prusa `grid` | 26 % | 94 % (a 0.4 cm³ button) | 10 of 15 |
| tree vs Prusa `organic` | 19 % | 46 % (coil) | 9 of 12 |

These are **in-sample**: the constants were fitted (least squares on the relative error) on the
same shapes, then rounded. Expect somewhat worse on unseen models. The misses have a pattern:
threads and helices (B9, the coil) come out 30–50 % low (a slicer puts interface between every
turn), big flat ceilings 25–35 % high (B4, B5: a large area has proportionally less edge).
Organic supports skipped the 30° ramp entirely; nothing simple predicts that.

**Things the slicer does that change its number far more than our error:**

- **Bridges.** PrusaSlicer's default (`dont_support_bridges` on) leaves a ceiling spanned
  between walls unsupported: B5 19.6 → 0.14 cm³, B4 10.1 → 5.2, table 6.1 → 0, shelf 7.3 → 4.5.
  The column counts every ceiling as supported, so for such designs the estimate is the
  "supports everywhere" case.
- **Build plate only.** Shelf 7.3 → 2.7 cm³, B10 4.5 → 1.5. The column's bed-only mode (support
  only where it reaches the bed) gives 1.9 and 0.5 with the normal constants: the same
  direction, 30–70 % low (PrusaSlicer keeps more of a support that only partly lands on the
  model).
- **Style.** Grid vs organic on the same model: 1.4× (table) to 2.3× (B9) and 3.1× (the coil).

**Speed** (Node 26 on the Arch workstation, the typed-array version, after one warm-up run):
every model above in ≤ 15 ms; a 131,000-triangle sphere 26 ms; a 200 × 200 mm table (160,000
cells) 16 ms. The time grows with the triangles and the cells, not with the overhangs. The
PrusaSlicer CLI took 0.4–3.2 s per model with grid supports and up to 15 s with organic ones
(the 200 × 200 mm table).

## Approaches compared

| | (a) Overhang triangles, one ray each | **(b) Column grid (recommended)** | (c) Slicer CLI, desktop only | (d) A WASM slicer in the browser |
|---|---|---|---|---|
| What | Per overhang triangle, a ray down from its centroid to the bed or the body below; area × height | Rasterize every triangle into an XY grid of 0.5 mm cells; per cell, the gap under each overhang down to the next surface | Write the bodies to a temp STL, run `prusa-slicer --export-gcode` with support options, sum the support lines of the G-code | CuraEngine compiled to WASM (cura-wasm), or Kiri:Moto's engine |
| Accuracy vs a slicer | Wrong on big flat triangles: a 40 × 40 mm ceiling is 2 triangles, so 2 samples. Sampling more points per triangle turns it into (b) | ±15–25 % median, ±50 % worst (above) | Exact for that slicer with **its default profile**; the user's printer profile would have to be found and loaded | Exact for that engine with the definitions we ship, not the user's slicer |
| Speed | Fast, needs the picking BVH (three-mesh-bvh, kept out of the home bundle by ADR-0072) | ≤ 30 ms, no BVH | 0.4–15 s per run, a background process | Seconds; megabytes of WASM to load first |
| Licence | Ours | Ours | The slicer is the user's own install, run as a separate program: nothing to add to `scripts/check-licenses.mjs` or `NOTICE` | CuraEngine is AGPL-3.0 (not on the allow-list; GPL-3.0 §13 allows the combination but it needs the allow-list, `NOTICE` and a look at what the network clause means for the hosted app). Kiri:Moto is listed as MIT (unchecked), but it is an app, not a library |
| Web / desktop | Both | Both | **Desktop only**; the web app gets nothing | Both |
| CSP / COOP | Fine | Fine | Not involved (main process) | Same-origin WASM is allowed (`'wasm-unsafe-eval'` is in the policy); must be built without dynamic execution, like OCCT and planegcs |
| Work | Small | Small (4 slices) | Medium: per-slicer CLI quirks (OrcaSlicer and Bambu Studio need machine and process JSON, CuraEngine its definition files), G-code parsing per slicer, a new `Platform` method | Large, and a second engine to keep alive |

manifold-3d (the brief's other idea for (b)) is not needed: the column grid needs only the
display meshes. Building a support *solid* with it (a prism under every overhang triangle,
united, minus the model) would run in the kernel worker, union thousands of prisms, and count
twice the space under a part of the model that is itself an overhang. Rejected below.

## Behaviour (what the user sees)

**Print Info** (`PrintInfoPanel.tsx`) gains, under Price per kg:

- **Supports**: a select, `None` / `Normal` / `Tree` (aria-label "Supports"). One control for
  on/off and the style, because the style is the biggest difference between slicers' numbers.
- **Support angle**: an `<ExpressionInput>` (label "Support angle"), a plain number of degrees
  like the other print fields (`unitless`, ADR-0048's amendment), default `45`, checked 0…90
  ("Between 0° and 90°."). Shown only when Supports isn't None. The same rule as the overhang
  analysis: a face more than this far below the horizontal needs support.
- **From the bed only**: a checkbox (label "From the bed only"), off by default: support only
  where it reaches the bed, as slicers' "build plate only" does. Shown only when Supports isn't
  None.

Rows: **Support (est.)** between Printed (est.) and Weight (`data-print-row="support"`),
"0.42 cm³" or "None needed" when the column is empty; absent with Supports None. **Printed
(est.), Weight, Filament length and Cost include the support**, and so do the per-component
rows (`data-print-component`). The footnote becomes, with supports on: "An estimate: walls,
infill and supports as set, for the model as it lies (bridges counted as supported). Filament
length is the same for every material."; with None it stays as it is.

What is measured, so the number matches what the panel says:

- The counted bodies are Print Info's (selected, else every shown one); hidden bodies are not
  counted. Mesh bodies work like any other.
- **Each body is measured on its own bed**: the lowest point of that body, down = -Z, the way
  it lies in the model. Support lands on that body's own lower parts, not on another body
  (decision 5). A lid modelled above its box is measured as if printed on its own in that
  orientation. Place on Bed is how a person turns a part for printing; Print Info does not
  follow the overhang analysis's picked "down" face.
- Below **0.6 mm** of gap no support is counted (`MIN_SUPPORT_GAP`): a slicer can't fit its
  contact gap and interface there. This removes near-flat undersides that the bed tolerance
  misses.

**Settings › Printing** (`apps/web/src/settings/SettingsDialog.tsx`, `Printing`; it shares the
store, ADR-0082) gets the same three fields, and "Reset 3D printing to defaults" resets them.

`docs/guide/printing.md` replaces "The estimate does not include supports, because only a
slicer can generate those" with what Supports does and what it doesn't model (bridges, the
user's slicer profile), and keeps "treat the slicer's as the final answer".

## The computation

**Where:** `apps/web/src/print/support.ts`, pure maths over `BodyMesh` (like `overhang.ts`),
on the UI thread, **only while Print Info is open and Supports isn't None**. Cached per body
mesh by identity (`WeakMap<BodyMesh, Map<string, BodySupport>>`, key
`${angle}|${bedOnly}`): a recompute's new meshes measure once, an unchanged body is never
measured again, and changing the style only changes the constants (no re-measure). The budget
is ADR-0072's 50 ms; the prototype is under 30 ms at 131,000 triangles. Not a worker: the
display meshes are already on the UI thread, copying them to a worker costs about what the
measure does, and a module worker is new infrastructure. If S3's measurement in Chromium goes
over 50 ms on the largest fixture, slice the passes across animation frames the way
`useThickness` does (not expected; decision 8).

```ts
// apps/web/src/print/support.ts
export type SupportStyle = 'none' | 'normal' | 'tree';
export interface SupportOptions {
  /** Degrees below the horizontal past which a face needs support, 0…90. */
  angle: number;
  /** Count only support that reaches the bed. */
  bedOnly: boolean;
}
export interface BodySupport {
  /** mm³ of air under the overhangs, down to the next surface or the bed. */
  column: number;
  /** mm² of the overhangs' footprint that gets support. */
  footprint: number;
}
export const SUPPORT_CELL = 0.5;          // mm
export const MAX_SUPPORT_CELLS = 1_000_000; // a bigger footprint gets coarser cells
export const MIN_SUPPORT_GAP = 0.6;       // mm
export const SUPPORT_FACTORS = {
  normal: { density: 0.15, interface: 1.7 },
  tree: { density: 0.11, interface: 0.5 },
} as const;
export function supportColumns(mesh: BodyMesh, options: SupportOptions): BodySupport; // uncached
export function measureSupport(mesh: BodyMesh, options: SupportOptions): BodySupport; // cached
export function supportMeasures(): number;  // tests: how many uncached measures ran
/** mm³ of support material: column × density + footprint × interface; 0 for 'none'. */
export function supportVolume(body: BodySupport, style: SupportStyle): number;
```

**The algorithm** (one body):

1. `bed` = the lowest z of the mesh. The XY box, `cell = max(SUPPORT_CELL, sqrt(area /
   MAX_SUPPORT_CELLS))`, `nx × ny` cells.
2. Each triangle gets a kind: **up** (its geometric normal, from the winding, points up),
   **down**, or **overhang** (down, the mean of its node normals · (0,0,-1) > `thresholdOf(angle)`
   from `overhang.ts`, and not all three corners within `BED_TOLERANCE` of `bed`: the overhang
   analysis's own rule, so the shading and the number agree). Vertical triangles are skipped.
3. Pass 1: for every cell centre inside a triangle's XY projection, count a crossing for that
   cell. Prefix sum. Pass 2: write each crossing's z (plane at the centre) and kind into a
   `Float32Array` and an `Int8Array` (CSR layout).
4. Per cell: sort the crossings by z, high to low (insertion sort: a column has a handful). For
   each **overhang** crossing (skip it if the crossing just above is down-facing and within
   1e-4 mm: the same surface hit on a shared edge), the landing is the next crossing more than
   1e-4 mm lower, else the bed. `gap = z − landing`; skip `gap < MIN_SUPPORT_GAP`; with
   `bedOnly` skip a gap that lands on the body. Sum the gaps.
5. A cell with a sum > 0 adds `sum × cell²` to `column` and `cell²` to `footprint`.

An open or broken mesh can leave a down crossing with nothing under it; it then counts to the
bed (an over-estimate, never a crash). Mesh bodies are manifold (ADR-0066), so this is rare.

**The estimate:** `SolidMeasure` (`material.ts`) gains `support?: number` (mm³ of support
material for that body). `printEstimate` adds it after the infill: `printed = skin + interior ×
infill + support` (and at 100 % infill `volume + support`); weight, filament and cost follow.
`PrintEstimate` gains `support` (cm³). `usePrintInfo` (`usePrintAids.ts`) fills `support` per
counted body from `meshes[id]` with `measureSupport` and `supportVolume` when the style isn't
None; a body with no mesh yet counts 0 and the row shows "…".

## Preference and file-format changes

Only the `print.material` preference (ADR-0048: a person's printing settings, not the
design's). `MaterialChoice` gains, all with defaults in `DEFAULT_MATERIAL`, so a preference
written before them loads with supports off (`resolveMaterialChoice`):

| Field | Type | Default |
|---|---|---|
| `supports` | `'none' \| 'normal' \| 'tree'` | `'none'` (decision 3) |
| `supportAngle` | expression string, degrees | `'45'` |
| `supportBedOnly` | boolean | `false` |

`PrintField` gains `'supportAngle'` (range 0…90 in `PRINT_FIELD_RANGE`, message "Between 0° and
90°."). An unknown `supports` value reads as `'none'`. **No schema change, no migration, no
`docs/file-format.md` text, no kernel or facade change, no undo** (settings of the person
printing, as in the P4-12 amendment).

## Tests

**`apps/web/src/print/support.test.ts`** (new; meshes from `boxMesh` in `selection/testing`,
plus `join` moved there from `thickness.test.ts` so both use it; shells don't touch, so no
internal faces):

1. One box on its own: column 0 (its bottom is the bed).
2. A 40 × 40 × 4 slab at z 20 with a 2 × 2 × 1 foot at z 0 beside it: column 40·40·20 =
   32,000 mm³, footprint 1,600 mm² (within one cell's share).
3. Shelf: a 30 × 30 × 10 block at z 0, a 50 × 30 × 5 slab at z 30 over it and past it:
   everywhere 30·30·20 + 20·30·30 = 36,000; bed only 18,000 (footprint 1,500 vs 600).
4. A closed prism whose underside is 30° below the horizontal: the analytic wedge volume; the
   same at 60°: 0; at angle 90°: 0; at angle 0° a box's bottom on the bed still 0.
5. A slab 0.5 mm above a block: 0 (under `MIN_SUPPORT_GAP`); 0.7 mm: counted.
6. The slab of case 2 with its underside cut into 200 triangles gives the same column as with
   2 (shared edges counted once).
7. A 400 × 400 mm slab: the grid is capped (`cell` > 0.5) and the column is within 1 % of exact.
8. `measureSupport` caches: same mesh and options measure once (`supportMeasures`), a new angle
   or `bedOnly` measures again, a new mesh object measures again.
9. `supportVolume`: normal 0.15·column + 1.7·footprint, tree 0.11·column + 0.5·footprint,
   none 0.
10. `BENCH=1` only (like `thickness.test.ts`'s `gridCube`): a 130,000-triangle sphere-like mesh
    measures in under 50 ms.

**`material.test.ts`**: a preference without the support fields reads with `supports: 'none'`,
`'45'`, `false`; an unknown `supports` reads as `'none'`; `printEstimate` with `support` adds it
to printed, weight, filament and cost (and at 100 % infill to the solid volume); `support` 0 or
absent leaves P4-12's numbers exactly; `checkPrintField('supportAngle', …)` refuses −1 and 91
with "Between 0° and 90°.".

**`PrintInfoPanel.test.tsx`**: the Supports select lists None, Normal, Tree; with None there is
no Support row, angle field or checkbox; with Normal they show and the row reads the estimate
("None needed" at 0); the footnote names supports only when they are on.

**`e2e/settings.spec.ts`** (where the Printing section's fields are covered today): the three
fields show, a change reaches Print Info, and "Reset 3D printing to defaults" resets them.

**`e2e/print-aids.spec.ts`**, one new test: open a model with an overhang (the wall bracket if
its rounded corner needs support at 45°, else two joined boxes as a T); Supports → Normal: the
Support row is above 0 and Printed (est.) grew by exactly it (±0.01); From the bed only does
not raise it; Supports → None: the row is gone and Printed is back; a reload keeps Normal, and
`Ctrl+Z` does not touch it. Keep `toContainText('no supports')` for the None case.

## Slices

Each about 1–3 h, one branch, CI green (no facade change: ~10–15 min). S0 is the
coordinator's, as the first commit; S1 and S2 can run in parallel (different files).

| Slice | What | Files | Acceptance |
|---|---|---|---|
| **S0** | ADR-0048 amendment (decision 9) with the results and rejected approaches of this plan; the digest paragraph | `docs/adr/0048-print-aids.md`, `docs/agent/adr-digest.md` | Reviewed text; the digest names `support.ts`, the constants and the per-body bed |
| **S1** | The column grid | `print/support.ts`, `print/support.test.ts`, `selection/testing.ts` (`join`), `print/thickness.test.ts` (import `join`) | Tests 1–10 pass; `pnpm check` |
| **S2** | Preference and estimate | `print/material.ts`, `print/material.test.ts`, `print/materialStore.test.ts` | The material tests above; P4-12's tests unchanged and passing |
| **S3** | Hook and panel | `print/usePrintAids.ts`, `print/PrintInfoPanel.tsx`, `print/PrintInfoPanel.test.tsx` | Panel tests; the app shows the row on B10 and the wall bracket (the dev server, URL to the owner); measure time logged once in Chromium on the coil fixture ≤ 50 ms |
| **S4** | Settings, e2e, docs | `settings/SettingsDialog.tsx`, `e2e/settings.spec.ts`, `e2e/print-aids.spec.ts`, `docs/guide/printing.md`, the roadmap tick, `docs/changelog.d/` line | The e2e test passes locally (`--workers=2`) and in CI; guide text says what is and isn't modelled |

`docs/guide/tools/printInfo.md` is generated (`pnpm docs:generate`, ADR-0080); rerun it in S4
only if the tool list's text changes. No `pnpm api:generate` (no feature input).

## Risks

- **People read the number as exact.** "(est.)", the footnote, and the guide say it's a
  guess for supports everywhere at the set angle. The slicer stays the final answer.
- **Bridges.** A design with ceilings between walls (B4, B5) shows supports that PrusaSlicer's
  default would not print. Said in the footnote; a bridge heuristic is an open item, not v1.
- **One slicer measured.** The constants come from PrusaSlicer 2.9.6's defaults. OrcaSlicer
  (installed here) needs machine and process JSON for its CLI and was not run; Cura and Bambu
  Studio not either. A later check can refit the four constants without touching anything
  else.
- **In-sample constants**, rounded; threads and helices come out 30–50 % low.
- **Orientation as modelled.** A part not yet turned for printing gets the supports of its
  current orientation. That's why Supports defaults to None (decision 3).
- **Display tessellation**, not the export mesh: curved undersides differ by the mesh
  deflection, far below the formula's error.
- **A huge mesh body** (a million triangles) could take ~200 ms by extrapolation; the cell cap
  bounds the grid, and slicing across frames is the fallback.

## Rejected

- **Waiting for a slicer (the P4-12 amendment's position).** It assumed a model can't be asked
  where support goes. It can, to within a slicer's own spread between styles; what it can't
  know is the user's slicer profile, and neither would a bundled slicer.
- **(a) One ray per overhang triangle.** Big flat triangles get one sample each; fixing that
  is sampling a grid, which is (b) without the BVH.
- **A support solid with manifold-3d.** Kernel-worker round trip, thousands of prisms to
  unite, double counting under intermediate overhangs, and a shape nobody asked to see.
- **(c) The slicer's CLI in the desktop app as the estimate.** Desktop only, 0.4–15 s, one CLI
  per slicer with its own quirks, and the default profile rather than the user's. Kept as a
  possible later extra: a "Check in PrusaSlicer" button through a new `Platform` method next
  to `openInSlicer` (`apps/desktop/src/main/slicers.ts` already finds the program), showing
  the slicer's support number beside ours (decision 10).
- **(d) A WASM slicer.** AGPL-3.0 (CuraEngine) or a whole app (Kiri:Moto), megabytes of WASM and
  printer definitions to ship and maintain for one number.
- **Support density, interface layers or pattern fields.** Numbers most people don't know;
  the style select covers the difference that matters. A density field can come later if
  asked for.
- **One bed for all counted bodies** (the overhang analysis's rule). It makes a lid modelled
  above its box float, with a column to the box's floor; per body is what printing separate
  parts means, and it caches per mesh. A design printed as stacked bodies loses the support
  that would land on the lower body (decision 5).

## Open items (not in this plan)

- A bridge heuristic (a flat ceiling with walls under two opposite edges is not supported).
- Showing where the supports go in the view (the overhang shading already shows what needs
  them).
- `extrudo info` printing the estimate (the maths would move to a package the CLI uses).

## Decisions for the owner

1. **Approach.** 1.1 Our own column-grid estimate in the app, web and desktop
   (**recommended**): one number within about a quarter of PrusaSlicer's, instantly. 1.2 Wait
   for / build a real slicer integration: exact for one slicer, desktop only, seconds per run.
2. **What the user picks.** 2.1 A Supports select None / Normal / Tree (**recommended**): one
   control, and the style is the biggest real difference. 2.2 Only on/off with normal
   supports: one fewer choice, tree users see about 1.5–3× too much.
3. **Default.** 3.1 Supports off until turned on (**recommended**): today's numbers don't
   change and designs not yet turned for printing don't show supports they won't need. 3.2
   Normal by default: the estimate always includes supports, "None needed" for well-oriented
   parts.
4. **Support angle.** 4.1 Its own field in the print settings, default 45° (**recommended**): a
   printer setting that persists like line width. 4.2 Take the overhang analysis's angle: one
   number in two places, but that angle is view state and disappears with the analysis.
5. **Bed.** 5.1 Each body on its own bed, as it lies (**recommended**): right for separate
   parts, simplest to cache. 5.2 One bed for all counted bodies, like the overhang shading:
   right for bodies printed stacked, wrong for a lid modelled above its box.
6. **"From the bed only".** 6.1 Include the checkbox (**recommended**): one boolean, and it
   cuts the number by half or more on some models. 6.2 Leave it out of v1.
7. **Bridges.** 7.1 Count them as supported and say so in the footnote (**recommended**). 7.2
   Add a bridge heuristic now: closer to PrusaSlicer's default on boxes, more code and a guess
   of its own.
8. **Where it runs.** 8.1 UI thread, cached per mesh, frame slicing only if it measures over
   50 ms (**recommended**). 8.2 A separate module worker from the start.
9. **ADR.** 9.1 A second P4-12 amendment to ADR-0048 (**recommended**): all Print Info rules
   stay in one place, and the amendment says it reverses the "needs a slicer" stance. 9.2 A
   new ADR (number from `next-free`).
10. **Desktop slicer check.** 10.1 Not now; an open item (**recommended**). 10.2 Add a "Check in
    PrusaSlicer" button in the desktop app as a fifth slice.
