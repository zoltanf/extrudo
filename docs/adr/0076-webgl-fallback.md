# ADR-0076: WebGL fallback — software rendering where possible, a clear message where not

- **Status:** Accepted, 2026-10-07
- **Builds on:** ADR-0008 (the viewport), ADR-0041 (notifications and
  `available()` actions), ADR-0075 (the desktop app loads only its own `app://`
  content), ADR-0007 (the shell).

## Context

On a browser without WebGL (hardware acceleration off, a blocklisted GPU, and
Chrome no longer falling back to SwiftShader on its own since 2025) the app
showed a **blank white page** when a project opened. `<Canvas>` in
`viewport/Viewport.tsx` throws when three.js can't create a WebGL 2 context,
and no React error boundary existed anywhere, so React unmounted the whole
tree. Software WebGL (llvmpipe, WARP, SwiftShader) is slow but works, and a
person with no WebGL at all can still use the timeline, parameters and export.

## Decision

1. **Detection** is `viewport/webglSupport.ts`: `detectWebgl(create?)` returns
   `{ kind: 'hardware' | 'software' | 'none', renderer?, reason? }`. `none`: no
   WebGL 2 context (null or thrown). `software`: a context with
   `failIfMajorPerformanceCaveat: true` fails while a plain one works, or the
   unmasked renderer matches swiftshader/llvmpipe/softpipe/lavapipe/basic
   render driver/WARP. Every probe context is lost afterwards
   (`WEBGL_lose_context`); the result is memoised per page.
2. **Software fallback is automatic.** The Canvas never sets
   `failIfMajorPerformanceCaveat`, so the browser's software WebGL is used. In
   `software` mode it renders at `dpr={1}` without antialiasing (the stencil
   buffer stays: section caps need it). If creation with the full attributes
   fails, it retries once without `antialias`.
3. **Notice:** a status bar indicator "Software rendering"
   (`[data-renderer="software"]`, with a tooltip) and a one-time info toast
   with a "Don't show again" action that sets the preference
   `render.softwareNotice = 'dismissed'` (its `available()` is false once set).
4. **No WebGL:** the viewport area shows `NoWebgl` (region "3D view
   unavailable") with what to try and a "Try again" button; the rest of the
   shell stays mounted.
5. **Error boundaries** (`design-system/ErrorBoundary.tsx`): around the
   viewport (a panel "The 3D view stopped working", or `NoWebgl` when the error
   looks like context creation) and at the root of both entries ("Something
   went wrong", saves everything best-effort, Reload).
6. **Context loss** at run time: `preventDefault()` on `webglcontextlost`, an
   overlay with "Reload view" (remounts the Canvas), hidden on restore.
7. **Desktop:** main appends `enable-unsafe-swiftshader` before `ready`, and
   honours `--software-rendering` / `EXTRUDO_SOFTWARE_RENDERING=1` with
   `app.disableHardwareAcceleration()`. The "unsafe" in the switch is about
   untrusted web content reaching SwiftShader; the desktop app loads only its
   own `app://` content and blocks navigation elsewhere (ADR-0075), so the
   risk does not apply. The pure decision is `main/rendering.ts`.
8. **e2e** runs on SwiftShader, which is a `software` machine: the Playwright
   config pre-sets the notice preference to `dismissed` through `storageState`
   and `screenshot.css` hides `[data-renderer]`, so no baseline changes.

## Amendment: the owner's VM, and a launch command for Chromium

Reproduced in a VM with Chrome (GPU process up, GL "Disabled", no automatic
SwiftShader): three.js threw "THREE.WebGLRenderer: Error creating WebGL context"
inside the Canvas and the page stayed empty. That is the `none` case, so:

- `isContextError` also matches "Error creating WebGL context" and "could not
  be created", and detection returns `none` before the Canvas mounts (the
  boundary is the second line of defence; the e2e covers both paths).
- **Measured** (Chromium 152, Playwright): `--disable-gpu
  --enable-unsafe-swiftshader` gives **no** WebGL 2 (with the GPU process
  disabled the flag alone doesn't help); adding `--use-angle=swiftshader`
  gives WebGL 2 on SwiftShader; on the VM (GPU process up) the flag alone works
  at 30+ fps. System Chrome here: `--disable-gpu` alone still has WebGL 2;
  `--disable-gpu --disable-software-rasterizer` gives none (the e2e's real
  browser case, with the default `--enable-unsafe-swiftshader` ignored).
- **The panel leads with a launch command** in a Chromium-based desktop browser
  (`viewport/swiftshader.ts`: `chromiumBrand`, `desktopOs`, `swiftshaderCommand`,
  all pure; Chrome, Chromium and Edge on Linux, Windows and macOS; nothing on
  ChromeOS, Android, iOS, Firefox or Safari). It starts a **separate profile
  and window** (`--user-data-dir`, `--app=<location.origin>/`, never a fixed
  domain) with `--enable-unsafe-swiftshader --use-angle=swiftshader`: the flag
  lets websites run graphics code on the processor, which Chrome keeps off by
  default for safety, so it is never turned on for the normal profile. Designs
  are per profile, so the panel points at File › Export .extrudo / Import
  .extrudo…. The panel also says to look at chrome://gpu (text and a Copy
  button; a page can't open it).
- **Review fixes:** `isContextError` matches only three.js's and the browser's
  wording (`Error creating WebGL context`, `WebGL context could not be created`,
  `Could not create a WebGL context`) or a re-probe (`webglSupport(true)`) that
  says `none`, so a React `useContext` error stays "The 3D view stopped
  working". Brave, Opera, Vivaldi and other Chromium browsers (brand `other`)
  get the flags to add and a separate `--user-data-dir`, not a made-up program
  name; the GPU page to copy is `edge://gpu` on Edge.
- **Desktop:** `--software-rendering` also appends `use-angle=swiftshader`,
  for the same measured reason.

## Rejected

- **A non-WebGL renderer.** three.js has none, and a 2D/SVG view would be a
  second renderer to keep correct.
- **A WebGPU fallback adapter.** Our shader patches use `onBeforeCompile`,
  which `WebGPURenderer` lacks.
- **Forcing `--ignore-gpu-blocklist`.** Blocklisted drivers crash; the
  blocklist is there for a reason.
