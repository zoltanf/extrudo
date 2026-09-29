# ADR-0037: WASM size, startup and the offline precache

- **Status:** Accepted, 2026-09-29 (the OCCT trim is proposed, not built: see
  "Not done")
- **Task:** P2-15 (WASM size and startup; NFR-02, NFR-06). Code:
  `apps/web/pwa/sw.js` (the service worker),
  `apps/web/pwa/precache-plugin.ts` (writes `dist/sw.js` at build time),
  `apps/web/public/manifest.webmanifest` and icons,
  `apps/web/src/platform/serviceWorker.ts` (registration),
  `scripts/measure-startup.mjs` (the measurements below),
  `e2e/pwa.spec.ts`.
- **Builds on:** ADR-0001 (the trimmed OCCT build), ADR-0007 (shell, `base:
  './'`), ADR-0009 (platform interfaces).
- **Affects:** P2-16 onwards (any new lazy chunk or asset is precached by the
  plugin without a change), the Electron build (Phase 6: no service worker
  there), hosting (Phase 3: the host must serve `sw.js` with a short cache
  lifetime and everything else with brotli).

## Context

NFR-02: a first visit loads in under 8 s on 50 Mbit, a repeat visit reaches an
interactive home screen in under 1.5 s, and the kernel is ready in under 3 s.
NFR-06: fully functional offline after the first load. The architecture doc
planned a Workbox service worker (`vite-plugin-pwa`); the roadmap task also
asked to trim the OCCT build further.

## Measurements

`pnpm build && node scripts/measure-startup.mjs` (`--no-browser` for sizes
only, `--mbit N`; set `PLAYWRIGHT_CHROMIUM_PATH` to use an installed
Chromium). It serves `apps/web/dist` with brotli, throttles Chromium's
network through the DevTools protocol (50 Mbit, 20 ms latency) and times a
first visit, a repeat visit with the service worker, and a repeat visit
offline. Numbers below: Ubuntu laptop (4 cores), Google Chrome 154 (headless), one
run each, so read them to about ±0.2 s.

Sizes of `apps/web/dist` (brotli quality 11), before any change of the build:

| | raw | brotli |
|---|---|---|
| OCCT WASM | 20.19 MB | 4.52 MB |
| app JS (main, viewport, sketch, chunks) | 2.07 MB | 0.52 MB |
| fonts (woff2 and woff) | 0.35 MB | 0.35 MB |
| kernel JS (worker, glue, incl. the debug worker) | 0.54 MB | 0.15 MB |
| planegcs WASM | 0.52 MB | 0.15 MB |
| CSS, other | 0.07 MB | 0.03 MB |
| **total** | **23.76 MB** | **5.72 MB** |

(ADR-0001's 4.34 MB was the spike build; the shipped build with the facade
grown through P2 is 4.52 MB. The service worker skips the debug worker, the
debug pages and the legacy `.woff` files, about 0.35 MB brotli.)

Timing at 50 Mbit:

| | home screen interactive | kernel ready (opening the Wall bracket, after the click) |
|---|---|---|
| first visit (no cache) | 1.0 s | 1.5 s (4.5 MB WASM downloads meanwhile) |
| repeat visit, service worker | 0.27 s | 1.3 s |
| repeat visit, offline | 0.25 s | 1.3 s |

Against NFR-02: the whole precache is 5.7 MB brotli, 0.9 s of transfer at
50 Mbit, so a first visit is far under 8 s (the home screen at 1 s, the kernel
about 2.5 s after load); a repeat visit reaches the home screen in about a
quarter of a second (limit 1.5 s); the kernel is ready 1.3 s after the
project opens (limit 3 s). The kernel's 1.3 s is the WASM compile plus the
first recompute of the template, not the network. All three targets hold
with a wide margin, so **size is not the constraint any more**; the trim
below would buy download time only.

## Decision

1. **A hand-written service worker, not Workbox.** The worker is 70 lines
   (`apps/web/pwa/sw.js`). Workbox would add a dependency (and a
   `minimumReleaseAge` dance) for runtime routing rules we don't need: the
   app is a fixed set of files with hashed names. A Vite plugin
   (`precachePlugin`, build only) lists what the build wrote and fills it
   into a copy of the worker as `dist/sw.js`, with a version that hashes all
   of it, so any change makes `sw.js` differ byte for byte and the browser
   installs an update. It is not a plugin dependency: no new package.
2. **Precache everything, cache first.** At install the worker fetches every
   listed file (`cache: 'reload'`: never from the HTTP cache) into one cache,
   `extrudo-precache`, including both WASM files, the kernel worker and every
   lazy chunk. Installation is all or nothing: the worker activates only when
   the whole app is cached. Every same-origin GET is then answered from the
   cache (no network fallback but a plain `fetch` for what isn't listed), and
   every navigation gets `index.html` (routes are hash routes). The kernel
   worker's own fetch of the WASM goes through the page's service worker
   too, so the kernel starts offline. Not precached: the debug worker and
   debug pages (they load lazily and only on `#/debug/…`), `.woff` (every
   supported browser takes `.woff2`), source maps.
3. **Updates keep one generation of old files.** Names in `assets/` carry a
   content hash, so an unchanged file (the 20 MB WASM above all) is not
   fetched again, and the fixed names (`index.html`, the manifest, icons) are.
   The new worker activates at once (`skipWaiting` + `clients.claim`, no
   waiting for every tab to close), but a tab still running the old bundle
   may ask for a lazy chunk the new build renamed. So activation deletes only
   files that neither this version nor the previous one lists (the previous
   list is stored in the cache as `.previous-precache`), and the next update
   drops the generation before. The old tab keeps working; the new
   `index.html` shows on the next navigation. Caches of any other name are
   deleted. There is **no "update available" toast**: with the old tab
   supported there is nothing to interrupt anyone for (open item: a toast
   when a reload would help).
4. **Relative URLs everywhere**, as with `base: './'`: the worker resolves its
   list against its own location, and registration is `register('./sw.js')`,
   so the scope is wherever the app sits (a sub-path on a static host works).
5. **Registration is a platform interface**
   (`platform/serviceWorker.ts`, `registerServiceWorker`) and runs only in a
   production build, over `http:`/`https:`, where the browser has service
   workers, after the page's `load` event (the precache must not compete
   with the first visit). `pnpm dev` never registers one (it would serve
   stale files over Vite's HMR), and the Electron build loads from `file:`
   and needs none. A failed registration only logs a warning.
6. **A web app manifest** (`manifest.webmanifest`: name, standalone display,
   the brand's slate background and theme colour `#1B1F27`, 192 and 512 px
   PNGs rendered from `favicon.svg`, plus the SVG) and `<meta
   name="theme-color">`, so the browsers offer to install the app.
7. **The e2e suite blocks service workers** (`serviceWorkers: 'block'` in
   `playwright.config.ts`): every test has a fresh browser context, and each
   would otherwise download and cache 20 MB of WASM. `e2e/pwa.spec.ts` allows
   them: the worker registers and caches the WASM files, the worker, the
   manifest and index (and not the debug files); the app reloads offline
   (`context.setOffline`), opens the Wall bracket template and the kernel
   computes it; and two installs in a row show the previous version's files
   surviving one round and going in the next.
8. **A host's `Vary: Origin` must not defeat the cache**: the worker matches
   with `ignoreVary` (module scripts send an `Origin` header the precache's
   own requests lack; `vite preview` sends `Vary: Origin` and every chunk
   missed the cache until this was set).

## Not done: trimming the OCCT build further

**The kernel needs no raw OCCT bindings.** `libcascade check` finds 7 symbols
referenced from `packages/kernel/src`, all of them the facade (`ExtrudoFacade`,
plus the `wasmMemory` property); `OcctScope` and the hand-typed `OcctModule`
only mention raw objects in comments. Since P0-09 every OCCT call runs in the
C++ facade, which includes OCCT headers directly and needs no embind
binding. Yet `libcascade.config.ts` still binds 198 raw classes (the spike's list plus
their base classes and referenced types from `closure.mjs`), which embind wraps with every method and which keeps every
one of those methods (and everything they call) in the module: for example
`IFSelect_WorkSession`, `BRepOffsetAPI_MakePipeShell`, `ThruSections`,
`MakeThickSolid`, `BRepFilletAPI_MakeChamfer`, `StlAPI_Writer`, `GC_Make*`,
`ShapeFix_*`. The candidate change is a binding list of `['ExtrudoFacade']`
alone (and dropping `closure.mjs`'s generated block), which also shrinks the
1 MB `d.ts` and embind's registration work at start (ADR-0001: cold start
comes from registering the class surface).

I could not build it: this session's machine has no Docker or emscripten
(`pnpm occt build` needs the 2.4 GB image), and a config change moves the
input hash, so `pnpm check` and `pnpm e2e` cannot run here until CI has
published the matching release. Changing the config unbuilt would have
left the tree unverifiable and CI a 16-minute failure away, so **the config
is unchanged and the OCCT input hash is unchanged**. The next session on a
machine with Docker should:

1. Set `bindings: ['ExtrudoFacade']`, delete the closure block, run
   `pnpm occt build`, then `pnpm test` (the kernel suites, the memory test
   with its leak control) and `node scripts/measure-startup.mjs`.
2. If the toolchain refuses a list without OCCT classes, keep one small
   class (`gp_Pnt`).
3. Try `compilerFlags.optimize: 'Oz'` as a second experiment: the OCCT static
   libraries in the image are prebuilt, so it only affects the facade, the
   bindings and the glue, and the toolchain already runs `wasm-opt -O4
   --converge` (it reports a 0.1 % gain), so expect little.
4. Record what each bought here. The toolchain's own guidance says
   dropping symbols gave −0.9 % brotli for −14 % symbols when much of the code
   is reachable from the facade anyway; the facade reaches booleans, fillets,
   meshing, STEP and healing, so the gain may be modest (a guess: 5 to 15 %).
   Given the table above, a result under about 10 % is not worth a
   maintenance burden and should be documented as "tried, not adopted".

Rejected without trying: linking with `-sMALLOC=emmalloc` (the memory
tests, the leak controls and `heapTop()` were tuned on the current
allocator, and mimalloc isn't the big part); dropping STEP (`readStep` and
`writeStep` are shipped features, P2-12); a second, smaller WASM without STEP
loaded on demand (STEP shares most of its code with the rest of OCCT's
data model, so the split saves little and doubles the build).

## Consequences

- Repeat visits and offline use work today; `pnpm dev` is unchanged.
- A build's first visit downloads 5.7 MB (brotli) once; each later release
  downloads only what changed (hashed files), the WASM only when the OCCT
  input hash moves.
- The host must serve `sw.js` (and `index.html`) with `Cache-Control:
  no-cache` or a short lifetime, or updates arrive late; browsers already
  bypass the HTTP cache for `sw.js` for up to 24 hours at most, so the
  risk is bounded.
- Safari evicts cached data of sites unvisited for seven days: the app then
  behaves like a first visit; project data is separately protected by
  `navigator.storage.persist()` (ADR-0009).
- The measuring script's numbers depend on the machine; re-run it after any
  change to the WASM, the chunking or the fonts, and record the table here.
- Open: an "update available" toast; a measurement on a real host with real
  latency; the trim above; compiling the WASM once and storing the module in
  IndexedDB was not needed (the compile is part of the 1.3 s, but the target
  holds).
