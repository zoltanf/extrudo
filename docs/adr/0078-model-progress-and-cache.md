# ADR-0078: Say the design is being prepared, and list its bodies before they are drawn

- **Status:** accepted (2026-10-08)
- **Depends on:** ADR-0009 (storage), ADR-0024 (recompute engine, `Recomputer`),
  ADR-0030 (bodies), ADR-0075 (desktop store proxy).

## Context

The owner's review of 2026-10-08: opening a design shows its sketches for
several seconds with no bodies. The browser's Bodies folder says "No bodies
yet" and only the status bar's small "computing…" says anything, so the owner
thought a body was lost: "we need to show this more prominently … showing here
top left like an icon in the viewport, which says crunching, we are preparing
your design … a nice icon, animated one … every object that exists should be
still shown in the bodies in the browser, even if it's still not rendered here
in the viewport."

## Decisions

### 1. A progress notice in the view

`viewport/ModelProgress.tsx` (pure rules in `viewport/modelProgress.ts`) draws
a pill at the top left of the view's open part (right of the floating browser,
through `--x-browser-inset`; clear of the "Show browser" tab when it is folded
away). It shows while the model store's `status` is `idle` or `computing` and
either no recompute has finished since the project page opened (`preparing`,
"Preparing your design…") or the running one has lasted more than 800 ms
(`updating`, "Updating the model…", so quick edits never flash it). A second,
muted line says "Computing <n> features" (active features: before the marker,
not suppressed). The icon is a cube of three rhombus faces that fill in turn
(CSS keyframes, 1.2 s loop; a still cube under `prefers-reduced-motion:
reduce`). `role="status"`, `aria-live="polite"`, `data-model-progress=
"preparing|updating"`, absent otherwise, **`pointer-events: none`** so it can
never block a pick. A failed kernel keeps its own message. "A recompute has
finished" is `model.doc !== undefined || model.stats !== undefined`: `computed`
sets them, `reset` clears them, so no extra state can go stale.

### 2. A per-project model cache

`projects/<id>/model-cache.json` = `{ "version": 1, "bodies": string[] }`: the
live body IDs of the last finished recompute, in browser order. **Derived data,
safe to lose**: not in the document, not in the `.extrudo` file, not in versions
(`docs/file-format.md` is unchanged), deleted with the project's folder.
`ProjectStore.readModelCache(id)` answers `undefined` when the file is missing,
unreadable, of another `version` or malformed (it never throws for a bad
cache); `writeModelCache(id, cache)` needs the project to exist. Both are in
`STORE_METHODS` and the desktop proxy (plain values cross as they are).

**Writing** (`project/modelCache.ts`, `followModelCache`, started by
`useModelCache` once the cache was read): after a finished recompute, the live
body IDs are written only when they differ from the last list written (or read)
for this project, fire and forget, a failure only logged.

**Reading:** `useModelCache` reads the file when the project page opens. Until
the first recompute finishes, the browser's Bodies folder lists those IDs as
**pending rows** (`pendingBodyEntries` in `shell/bodies.ts`): name and colour
from `doc.bodies` (an ID with no stored metadata is skipped), the eye (still a
document command), the name muted, a 12 px cube where the count would sit,
`aria-busy="true"`, `data-body-pending`; no selection, menu or appearance. The
folder's count badge counts them. The first finished recompute replaces the
list with the real one. Only the browser sees pending rows: the view, the
selection and the commands keep using computed bodies. No cache: today's
"No bodies yet".

## Rejected

- **(a) Listing `doc.bodies` metadata alone.** It keeps entries for bodies
  that no longer exist (a Remove rolled back brings one back with its name), so
  the list would lie after any edit that removed a body.
- **(b) Storing the live list in the document.** Geometry is derived; it would
  change the file format and every save, and an old file would carry a list
  that the model no longer matches.
- **(c) Caching the meshes too, so bodies draw instantly.** The right next
  step, but a bigger one (size, invalidation, a mesh format in storage).
  Deferred.

## Results

Unit tests: `modelProgress.test.ts`, `modelCache.test.ts`, `pendingBodyEntries`
in `bodies.test.ts`, the cache round trip in both stores, the proxy's method
list. `e2e/model-progress.spec.ts` slows the OCCT WASM by 4 s on reload and
sees the notice and a pending "Bracket" row before `kernelReady`, then neither.
