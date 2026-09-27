# ADR-0007: Design system and app shell

- **Status:** Accepted, 2026-09-25
- **Task:** P0-04 (design system and shell). Code: `apps/web/src/design-system/`,
  `apps/web/src/shell/`, `apps/web/src/platform/`, `apps/web/src/commands/`.
- **Affects:** every UI task from here on; P0-05 (viewport) fills the shell's
  middle; P0-08 (storage) replaces the sample document and the file menu stubs.

(ADR-0005 and ADR-0006 are reserved for topological naming and Electron.)

## Context

`docs/05-brand.md` fixes the look (Slate dark by default plus a full light
theme, amber accent, category colours, Instrument Sans and JetBrains Mono,
radii, depth, motion, the two-tone icon style), and `docs/04-ui-spec.md` §2
fixes the layout. The architecture chose Radix (headless) and Tailwind v4 with
design tokens. P0-04 asks for the tokens, typography, Radix wrappers, the icon
pipeline and a static shell, with a screenshot test in both themes and panels
that resize and collapse.

## Decision

1. **Tokens are CSS custom properties**, named 1:1 after the brand doc
   (`bg` → `--x-bg`), in `design-system/tokens.css`. Dark is the `:root`
   default; light overrides under `[data-theme="light"]`. Logo colours are
   tokens too, so the mark follows the theme.
2. **Tailwind v4 reads them through `@theme inline`** (`design-system/theme.css`):
   `bg-panel`, `text-muted`, `border-line`, `text-cat-create`, `rounded-dialog`,
   `shadow-raised`, the brand type scale. Tailwind's default palette is cleared
   (`--color-*: initial`), so off-brand colours can't creep in. Switching
   `data-theme` restyles everything with no JavaScript.
3. **Theme choice** is `dark | light | system`, stored through the platform
   preferences and applied to `<html>` before the first render; `system`
   follows `prefers-color-scheme` live.
4. **Fonts are bundled** from `@fontsource` (OFL): Instrument Sans 400/500/600
   and JetBrains Mono 400/500. Nothing loads from the network (NFR-06).
5. **Thin wrappers over `radix-ui`**: `Button`, `IconButton` (32 px, always
   with a tooltip: name, shortcut, one sentence), `Tooltip`, `Menu` (with radio
   groups), `Dialog`, `Popover`, `TextInput` and a styled native `Select`. The
   dialog starts focus in the first field of its body, and Esc skips fields
   marked `data-keep-escape`, so Esc reverts an edited expression before it
   closes anything.
6. **Icons are SVG sources inlined at build time.** `design-system/icons/svg/`
   holds one file per icon on the 24 × 24 grid, with no colours: strokes come
   from CSS, and elements with class `f` are the 22 % "subject" fill. Vite
   inlines them through `import.meta.glob(…, { query: '?raw' })`, and
   `<ToolIcon name category>` renders one in its category colour
   (`--x-cat-*`). A unit test enforces the rules (grid, allowed elements and
   attributes, a filled subject, every file registered). The first 17 icons
   are original drawings; 8 come from the brand prototype.
7. **Platform interfaces start here** (`platform/`): `Platform.preferences`
   (web: prefixed JSON in localStorage, errors ignored). Feature code never
   touches localStorage.
8. **One shortcut registry** (`commands/shortcuts.ts`): one window listener,
   `Mod` = Ctrl or ⌘, and text fields keep their own shortcuts (Ctrl+Z in a
   field undoes typing, not the document).
9. **The shell** (`shell/`) is a CSS grid: app bar, toolbar (workspace
   switcher, Solid and 3D Print tabs, tool groups with menus), browser |
   splitter | viewport placeholder, timeline with status bar. The browser
   panel resizes through a WAI-ARIA window splitter (drag, ← →, Shift for big
   steps, Home, End, Enter or double-click to collapse) and collapses to a
   rail; the timeline collapses; both remember their state. Tools that aren't
   built yet are shown with `aria-disabled` and a tooltip naming the roadmap
   task that brings them, so the real layout is visible without pretending.
   What already works is wired for real: undo/redo, project rename, body
   visibility, timeline playback (moves the marker), the Parameters dialog.
10. **Until storage exists (P0-08)** the shell opens a sample document in
    memory; the `#/debug/parameters` page is gone (the dialog lives in the
    shell), and `#/debug/kernel` stays.
11. **Screenshot tests** compare full-page shots in both themes against
    baselines made locally (Arch) and checked in the Playwright Ubuntu image
    (`mcr.microsoft.com/playwright:v1.63.0-noble`), which renders like CI.
    Only about a dozen pixels per shot cross the colour threshold between the
    two, so the tolerance is 0.1 % of pixels (`playwright.config.ts`).

## Rejected options

- **SVGR (`vite-plugin-svgr`):** it adds Babel and SVGR for what is static
  markup. Inlining raw SVG plus a rules test is smaller and just as safe for
  our own files. Revisit if icons ever need props inside the SVG.
- **Radix Select:** heavy for a handful of short option lists; a styled
  native select is accessible and fine until a list needs icons.
- **Keeping Tailwind's default palette:** it makes `text-red-500` and friends
  available, which would drift away from the brand tokens.
- **Per-environment screenshot baselines** (one for Arch, one for Ubuntu):
  unnecessary given a 12-pixel difference; one baseline plus a small tolerance
  is simpler to update.
- **Separate DOM tests for components (Testing Library + jsdom):** the shell's
  behaviour is covered end-to-end in Playwright; unit tests cover the logic
  (preferences, theme, shortcuts, icon rules). Add jsdom when a component gets
  logic worth testing on its own.

## Consequences

- **Updating the screenshots:** `npx playwright test e2e/shell.spec.ts
  --update-snapshots`, then run the same spec in the Ubuntu image (command in
  CLAUDE.md) before committing.
- **P0-05** replaces `ViewportPlaceholder` with the three.js viewport and
  wires the nav bar and ViewCube; **P2-11** adds marker dragging and chip
  menus; **P2-08** makes the browser tree interactive.
- **The icon set** grows task by task to the ~60 icons in the brand brief.

## Amendment, 2026-09-27 (design review)

- **The workspace switcher is gone.** No second workspace is planned (no
  roadmap task or requirement names one), and a dropdown with one item did
  nothing. The toolbar starts with its tabs.
- **Tabs: Solid · Insert · 3D Print** (Sketch replaces Solid while a sketch
  is open). Insert and Export left Solid, which keeps Create, Modify,
  Construct and Inspect: Insert has its own tab, and the model's Export is
  in 3D Print (Output). A sketch's Export stays in the Sketch tab, since it
  exports the sketch being edited (ADR-0022).
- **The browser collapses to nothing, animated.** Instead of a 40 px rail,
  the panel slides to no width over `--x-normal` (200 ms; 0 under reduced
  motion; its content keeps its width and is clipped, so nothing reflows),
  then turns invisible (visibility switches at the end of a hiding
  transition) and inert. A small tab with the browser icon at the
  viewport's top-left edge ("Show browser") brings it back. Dragging or
  keyboard resizing doesn't animate (`usePanel().animate` is set only by
  toggling).
- **The status bar shows the render rate.** A probe inside the canvas wraps
  `renderer.render`, counts the frames of the last second and times them
  (`viewport/renderMeter.ts`); the viewport store's `renderStats` carries
  them to the status bar twice a second. The canvas renders on demand, so
  a still view reads "idle" with the last frame time. Screenshot tests hide
  it (`e2e/screenshot.css`, `stylePath` in `playwright.config.ts`).

