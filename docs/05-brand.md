# 05 — Brand and Visual Design

Decided 2026-09-25. This is the source of truth for P0-04 (design system and
app shell). The chosen look is **direction E "Sketch to Solid"** (logo, amber
accent, grey tones, type), plus **direction B's tool icons** and a **glowing
viewport** in the **Slate** version. Interactive reference:
`docs/brand/direction-e-final.html`. Earlier options are in
`docs/brand/directions-v1.html`.

## 1. Personality

Fast, precise, friendly. A modern pro tool that doesn't take itself too
seriously. The playfulness comes from **motion, colour-coded icons, the glow
and the copy**, not from cartoons. The app's default is **dark (Slate)**.
Light is a full alternative theme for bright rooms.

## 2. Logo

### Mark

A dashed **blue sketch square** (the profile), with **amber faces** (the solid
it becomes) growing out of it: the whole product in one picture.

| File | Use |
|---|---|
| `docs/brand/extrudo-mark-dark.svg` | On dark or Slate backgrounds (default) |
| `docs/brand/extrudo-mark-light.svg` | On light backgrounds |
| `docs/brand/extrudo-mark-mono.svg` | One colour (`currentColor`): stickers, laser engraving, embossed prints, monochrome contexts |
| `docs/brand/extrudo-favicon.svg` | 16–32 px: solid outline instead of dashes, no corner dots, on a Slate tile |

Geometry (64 × 64 grid): sketch square `x10 y24 w28 h28`, extrusion offset
`(+14, −14)`, dash `3.2 / 2.6`, stroke 2, corner points r 2.2.

### Wordmark

`extrudo`, all lowercase, in **Instrument Sans SemiBold (600)** with tracking
**−0.04em**. It ends in a small **amber square** (0.15em, radius 0.03em),
which stands for the "solid".

### Rules

- Clear space around the mark: at least ¼ of its height.
- Minimum size: mark 20 px (below that, use the favicon variant); wordmark
  cap-height 8 px.
- Lockup: mark on the left, wordmark on the right, gap = ⅓ of the mark's
  height, vertically centred.
- Don't: rotate, recolour the sketch square amber, fill the sketch square
  solid, add shadows or outlines, or set the wordmark in another font.

### App icon

The mark at 72% of the tile, on a Slate glow tile:
`radial-gradient(circle at 50% 30%, #46557A, #1B1F27 80%)`, corner radius 23%
(the platform mask may override the radius on macOS and Windows).

## 3. Colour tokens

Names map 1:1 to CSS custom properties (`--x-*`) in
`apps/web/src/design-system/tokens.css`. The theme is chosen by
`data-theme="dark" | "light"` on `<html>`. Default is `dark`; "system" follows
`prefers-color-scheme`.

### 3.1 Surfaces and text

| Token | Dark (Slate), default | Light | Used for |
|---|---|---|---|
| `bg` | `#1B1F27` | `#FFFFFF` | App bar, toolbar |
| `panel` | `#20252F` | `#F3F5F9` | Browser tree, timeline, status bar |
| `raised` | `#282E3A` | `#FFFFFF` | Dialogs, menus, popovers, cards |
| `line` | `#343B4A` | `#E0E4EC` | Borders, dividers |
| `ink` | `#E9EDF3` | `#111318` | Primary text, icons without a category |
| `muted` | `#939CAD` | `#5B6375` | Secondary text, placeholders |
| `viewport-glow` | `radial-gradient(90% 80% at 45% 42%, #46557A 0%, #29313F 50%, #15181F 100%)` | `radial-gradient(90% 80% at 45% 42%, #FFFFFF 0%, #EEF1F5 52%, #DCE1E9 100%)` | 3D viewport background (rendered as a full-screen shader quad or CSS behind a transparent canvas) |
| `grid` | `rgba(255,255,255,.05)` | `rgba(17,19,24,.06)` | Viewport grid minor lines (major lines ×2 opacity), fading out radially |

### 3.2 Accent and meaning

| Token | Dark | Light | Used for |
|---|---|---|---|
| `accent` (amber) | `#FFB23E` | `#E08A1E` | Primary buttons, selection, active tool, timeline marker, focus |
| `on-accent` | `#15171C` | `#15171C` | Text on accent (dark in both themes: white on light amber fails contrast) |
| `accent-soft` | amber at 16% | amber at 14% | Active tool background, selected rows |
| `sketch` | `#5AA9FF` | `#2F86F0` | Sketch geometry (under-constrained), sketch profiles, info |
| `link` (landing page, API docs) | `#5AA9FF` | `#1A6AD0` | Text links on the landing page; the light `sketch` blue is 3.6:1 on white, under WCAG AA for text |
| `glow-muted` (landing page, API docs) | `#C8CFDB` | = `muted` | Grey text on the hero's glow (nav links, the intro, the latest-build note): 4.7:1 even at the glow's brightest point, where `muted` is 2.9:1 |
| `glow-link` (landing page, API docs) | `#A4CFFF` | = `link` | Links on the hero's glow: 4.6:1 at its brightest point, where `sketch` is 3.1:1 |
| `success` | `#3DD68C` | `#1B9E5E` | Saved, OK status, feature ✓ |
| `warning` | `#F2C14E` | `#B7791F` | Feature ⚠, fallback reference |
| `error` | `#FF6B6B` | `#D93D3D` | Feature ✕, conflicts, destructive actions |

**The landing page is dark only** (ADR-0057 amendment, 2026-10-05): its pictures are the dark app, so it ignores the system theme and uses the dark column. The light values of `link`, `glow-muted` and `glow-link` (and of every token in `apps/site/src/tokens.css`) now serve the API docs pages only, which still follow the system theme.

### 3.3 Tool categories (icons, timeline chips)

From direction B. Each category colour drives the icon stroke and the 22%
fill, and the timeline chip background (colour at 16% over `bg`).

| Category | Dark | Light |
|---|---|---|
| sketch | `#7C9BFF` | `#2451FF` |
| create | `#3DD6A3` | `#12A879` |
| modify | `#FF8A78` | `#FF6F59` |
| construct | `#A590FF` | `#7C5CFF` |
| inspect | `#3CC7D4` | `#0F9DAB` |
| insert | `#FF7EB6` | `#E0457F` |
| export / 3D print | `#FFC93C` | `#E59A00` |

### 3.4 Viewport and model

| Token | Dark | Light | Notes |
|---|---|---|---|
| `body-default` | `#A7B0C2` | `#B9C0CD` | Default body colour (lit by the scene; appears darker on side faces) |
| `edge` | `#C3CAD6` at 70% | `#111318` at 70% | B-rep edge lines |
| `preselect` | amber at 45% | amber at 45% | Hover highlight |
| `selected` | amber at 90% | amber at 90% | Selected faces, edges, bodies |
| `preview` | `sketch` at 35% | `sketch` at 30% | Live preview of new-body features |
| `preview-join` | `success` at 35% | `success` at 30% | Join preview ("green-tinted", UI spec §3.4; P2-05) |
| `preview-cut` | `error` at 40% | same | Cut preview |
| `preview-intersect` | `cat-construct` at 35% | `cat-construct` at 30% | Intersect preview (P2-05) |
| `sketch-fixed` | `ink` | `ink` | Fully constrained sketch geometry |
| `sketch-construction` | `muted`, dashed 6/4 | same | Construction lines (not amber, to avoid confusion with selection) |
| `sketch-projected` | construct colour | same | Projected/included geometry |
| `sketch-conflict` | `error` | same | Over-constrained geometry |
| `profile-fill` | `sketch` at 14% | `sketch` at 12% | Closed profiles |
| `axis-x` | `#F0675C` | `#D9463A` | X axis (drawn along the grid, fading with it) |
| `axis-y` | `#5FCF78` | `#23994A` | Y axis |
| `axis-z` | `#5B8CFF` | `#2F63E0` | Z axis |

**Body swatches** (P2-08, ADR-0030). A body's colour is stored in the
document as a fixed `#rrggbb`, the same in both themes, so the picker
offers swatches rather than tokens: Default (no colour stored: the
theme's `body-default`), and mid-tone versions of the category hues that
read under the scene's light in either theme: Blue `#5B7CFF`, Teal
`#22B3C2`, Green `#2FBF8F`, Amber `#F2B21B`, Coral `#FF7A66`, Pink
`#F0609A`, Violet `#8F75FF`, plus White `#E9EBF0` and Charcoal `#3B404C`
(filament colours people print in). Opacity presets: opaque, 75 %, 50 %,
25 %. Selection tints still blend towards amber over any body colour.

Contrast: `ink` and `muted` meet WCAG AA on `bg`, `panel` and `raised` in
both themes. Amber is for fills, outlines and highlights, never for body text
on light backgrounds (`#E08A1E` on white is only about 2.6:1). State is never
shown by colour alone (glyph plus colour).

## 4. Typography

Both fonts are OFL and **bundled with the app** (no Google Fonts at runtime,
so it works offline).

| Role | Font | Sizes |
|---|---|---|
| UI, headings, logo | **Instrument Sans** 400 / 500 / 600 | 13 px base UI · 11.5 px small · 10.5 px uppercase labels (tracking 0.08em, 600) · 15 / 18 / 24 px headings (tracking −0.02em) |
| Values, parameters, expressions, code | **JetBrains Mono** 400 / 500 | 12 px in fields; tabular figures everywhere numbers align |

## 5. Shape, depth, spacing, motion

- **Spacing:** 4 px grid; panels use 8 / 12 / 16 px padding.
- **Radius:** 6 px inputs · 8–9 px buttons, tool tiles, chips · 12 px dialogs,
  menus · 16 px cards, large panels · 999 px pills.
- **Depth:** only `raised` surfaces cast shadows. Use
  `0 14px 30px -16px rgba(0,0,0,.6)` (dark) or `0 10px 24px -14px
  rgba(17,19,24,.25)` (light). Floating bars over the viewport (nav pill) use
  `raised` at 85% with a 6 px backdrop blur.
- **Motion:** 120–200 ms, `cubic-bezier(.2,.8,.2,1)` for UI. Camera
  transitions (ViewCube, Look At) take 350 ms. Feature previews fade in over
  120 ms. Under `prefers-reduced-motion`, motion is instant.
- **Playful moments (sparingly):** the amber square in the wordmark pulses
  once on save; a new timeline chip "extrudes" into place; empty states have
  small animated sketches turning into solids.

## 6. Icon system (brief for the full set)

Style, taken from direction B:

- **24 × 24 grid**, 2 px padding, **1.75 px stroke**, round caps and joins.
- **Two-tone:** stroke in the category colour; the "subject" surface filled
  with the same colour at **22%** opacity.
- **Visual grammar:** dashed stroke (3 / 2.6) = sketch, construction or
  ghost geometry · arrow = direction of the operation · filled face = the
  result · isometric boxes for solids (30°).
- Sizes: 24 px (toolbar), 18 px (timeline chips, dialog titles), 16 px (menus,
  browser tree). Hand-tune the 16 px versions.
- Generic UI icons (save, undo, eye, settings, search, chevrons) come from
  **Lucide** at 1.75 px stroke in `ink` / `muted`.
- Deliverable: SVG sources in `apps/web/src/design-system/icons/svg/`,
  inlined at build time and rendered by `<ToolIcon name category>`; no colours
  in the files (strokes from CSS, class `f` marks the 22 % fill), and the
  category colour arrives through `color: var(--x-cat-…)`. `icons.test.ts`
  checks the rules (ADR-0007).

Initial set, about 60 icons:

| Category | Icons |
|---|---|
| sketch | create sketch, finish sketch, line, rectangle (2-point, 3-point, center), circle (center, 2-point, 3-point), arc (3-point, center, tangent), polygon, slot, ellipse, spline, point, text, sketch dimension, trim, extend, break, sketch fillet, offset, mirror, sketch pattern, project, construction toggle, and 13 constraint glyphs (coincident … symmetric) |
| create | extrude, revolve, sweep, loft, hole, thread, box, cylinder, sphere, torus, coil, rectangular pattern, circular pattern, mirror |
| modify | press/pull, fillet, chamfer, shell, draft, scale, combine, split body, move/copy, offset face, appearance |
| construct | offset plane, plane at angle, midplane, plane through 3 points, tangent plane, axis, point |
| inspect | measure, section analysis, mass properties, overhang analysis |
| insert | insert SVG, insert DXF, insert mesh, canvas image, insert STEP |
| export / 3D print | export STL, export 3MF, export STEP, export SVG, place on bed, send to slicer |

## 7. Voice

Short, plain and friendly. Say what happened and how to fix it. No blame, no
jargon when a normal word works.

- ✓ "Fillet didn't fit: 5 mm is too big for this edge. The maximum is about 2.4 mm."
  [Use 2.4 mm]
- ✓ "Saved." · "Exported bracket.3mf (38.2 g of PLA)."
- ✗ "BRepFilletAPI_MakeFillet: StdFail_NotDone."
