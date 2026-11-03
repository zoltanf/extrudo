# ADR-0116: Live widgets and drawn figures in the docs

- **Status:** Accepted, 2026-11-01 (owner chose site-built widgets over an
  embedded app or pictures only, drawn SVG figures over screenshots, and the
  mocks' look; pilot first on the sketching docs).
- **Task:** P6-22, FR-UX-04 (help where you need it).
- **Amends:** ADR-0080 (the docs site: "the only raw HTML is `<video>`", no
  script in a docs page), ADR-0057 (the site's content policy). **Builds on:**
  ADR-0057's amendment of 2026-10-05 (the hero's tray toy: a pure model, drawn
  at build time, a small script on top), ADR-0080 slice S9 (F1 and
  `Platform.openDocs`), ADR-0074's amendment of 2026-10-31 (the sketch
  palette's switches).
- **Schema change:** none.

## Context

The sketching guide (`docs/guide/sketching.md`) is 183 lines of text with one
picture, and its 50 tool pages are generated one-liners: 26 have a tooltip
clip, 24 have nothing, 3 carry hand-written notes. Constraints, degrees of
freedom, label placement and the palette's switches are hard to explain in
words and easy to show; in the session that redesigned the palette, mocks
that could be clicked settled questions that text did not.

The docs pages are static HTML with no script, under the site's content policy
`script-src 'self'; style-src 'self'` (`apps/site/public/_headers`), and
`docs.test.ts` asserts that no page holds `<script`. F1 opens a hovered
toolbar tile's tool page and otherwise `/docs/`, never the sketching page;
the docs headings carry no `id`, so nothing can link to a section.

## Decision

### 1. Widgets: named in Markdown, drawn at build time, woken by one script

- A Markdown page names a widget with a fenced block whose info string is
  `widget <name>`; the block's body, if any, is the caption:

  ````md
  ```widget dof-playground
  Drag the corner, then switch constraints on.
  ```
  ````

  The page still holds no HTML and no script. On GitHub the block reads as a
  labelled code block.
- **The list is fixed in code:** `apps/site/src/widgets/index.ts` maps each
  name to its build-time renderer. An unknown name fails the build:
  `docs/guide/x.md: unknown widget "<name>"`.
- **Each widget is three parts:** `widgets/<name>-model.ts`, pure (no DOM:
  state in, SVG markup out, unit-tested, like `toy-model.ts`);
  the renderer, which writes the starting state into the page; and
  `widgets/<name>.ts`, `enhance(root)`, which wires the model to pointer and
  keyboard.
- **The page is complete without the script:** the build emits
  `<figure class="widget" data-widget="<name>">` with the starting SVG, the
  controls rendered `disabled`, and the caption as `<figcaption>`. Without
  JavaScript, in print and for a reader that doesn't run it, the widget is a
  still picture. `enhance` removes `disabled`.
- **One script, only where needed:** `apps/site/src/docs-widgets.ts` is a
  separate Vite entry, emitted as one hashed asset. A page with at least one
  widget gets exactly one `<script type="module" src="…docs-widgets-<hash>.js">`;
  a page without one gets none. No inline script, no handler attribute, no
  `javascript:` URL, ever.
- **No style attributes:** the policy refuses them in markup. Widgets change
  SVG geometry attributes and classes; anything visual comes from `docs.css`.
  (Setting `element.style` from script is allowed by the policy, but is not
  needed and not used.)
- **No solver, no WASM, no app code in the docs:** each widget is a scripted
  scene with its own small rules (the DOF rectangle knows its four unknowns).
  `@extrudo/site` keeps depending on no internal package
  (`scripts/check-boundaries.mjs`).
- **Accessibility:** every control works from the keyboard (switches are real
  checkboxes; drag handles are `role="slider"` with arrow keys); the stage SVG has
  `role="group"` (it holds focusable handles, so not `img`: axe's
  `nested-interactive`) and an `aria-label` that describes the starting state; live
  results go to an `aria-live="polite"` line. Under `prefers-reduced-motion`
  nothing animates by itself.

### 2. Figures: drawn SVG, inlined by the build, coloured by class

- A relative image whose file name ends in **`.figure.svg`** is not emitted as
  `<img>`: the build reads it, checks it and writes the SVG into the page
  inside `<figure class="sk-figure">`, the image's alt text becoming its
  `aria-label` (with `role="img"`) and its title, if any, a `<figcaption>`.
  Inline, it follows the site's light and dark theme through `docs.css`,
  which an `<img>` cannot.
- **The check is an allow-list.** Elements: `svg g path line polyline polygon
  rect circle ellipse text tspan title desc defs marker symbol use`.
  Attributes: geometry and text layout (`x y x1 y1 x2 y2 cx cy r rx ry width
  height d points transform viewBox text-anchor dominant-baseline font-size
  font-weight marker-start marker-end marker-mid refX refY markerWidth
  markerHeight orient preserveAspectRatio`), `class`, `id`, `href` only as a
  local `#id`, `fill`/`stroke` only as `none` or `currentColor`,
  `stroke-dasharray`, `stroke-width`, `stroke-linecap`, `stroke-linejoin`,
  `opacity`, `xmlns`. Anything else fails the build with the file and the
  element or attribute: no `style`, no `<style>`, no `on*`, no
  `foreignObject`, no external `href`, no literal colour.
- **Ids are made unique** per page by prefixing them with the file's stem
  (references follow).
- **Colours come from classes**, defined in `docs.css` for both themes from the
  site's tokens, matching the app's sketch colours:

  | Class | Draws |
  |---|---|
  | `sk-free` | a free curve: sketch blue stroke |
  | `sk-fixed` | a fixed curve: ink stroke |
  | `sk-conflict` | an over-constrained curve: red stroke |
  | `sk-construction` | construction: grey, dashed |
  | `sk-projected` | projected from a body: purple stroke |
  | `sk-hover` | what a tool would act on (Trim's piece): red, dashed |
  | `sk-point` | a sketch point: page fill, sketch stroke |
  | `sk-profile` | a profile's shading: translucent sketch fill |
  | `sk-dim`, `sk-dim-text` | a dimension's lines (muted, thin) and its value (ink) |
  | `sk-glyph`, `sk-glyph-text` | a constraint glyph's box (raised, line) and its mark (muted) |
  | `sk-body`, `sk-body-side`, `sk-face` | a body's top, its sides, a picked face |
  | `sk-ui`, `sk-ui-text`, `sk-muted` | app chrome drawn in a figure (panel, line), its text, muted text |
  | `sk-accent` | the one thing a figure points at: accent stroke |
  | `sk-step`, `sk-step-text` | a numbered click marker: accent disc, dark digit |
  | `sk-pointer` | the mouse pointer |

  Widgets use the same classes, so a widget and a figure beside it match.
- Screenshots stay for real UI where the UI itself is the point (the sketch
  palette, dialogs): `pnpm demos -g guide` as before.

### 3. Heading anchors

Every `h2` and `h3` in a docs page gets an `id`: the heading text lower-cased,
runs of anything but `a-z0-9` replaced by one `-`, trimmed; a repeat on the
same page gets `-2`, `-3`. So `## The sketch palette` is `#the-sketch-palette`.

### 4. F1 lands on the right section

- `DocsPage` gains `{ guide: string; anchor?: string }`: the guide page
  `/docs/<guide>/` and its section. Guide and anchor are `[a-z0-9-]+`, checked
  in `docsPath`.
- **One remembered help target** replaces "the tile hovered last": toolbar
  tiles set `{ tool }`, sketch palette rows set `{ guide: 'sketching', anchor }`.
  F1 opens the remembered target; with none, `{ guide: 'sketching' }` while a
  sketch is open, else the guide. Opening or closing a sketch clears the
  target, so F1 right after opening a sketch goes to the sketching page. The
  Menu's **Help for This Tool** still reads only a tool target.
- The palette rows' anchors are listed once, in
  `apps/web/src/shell/docsAnchors.json` (`{ guide, anchor }` entries); a site
  test checks that every listed anchor exists in the built page, so renaming a
  heading can't silently break F1.
- The desktop app builds the URL itself from an allow-list (ADR-0080 S9):
  `DOCS_PATH` in `apps/desktop/src/main/docs.ts` also accepts
  `/<guide>/` and an optional `#<anchor>`, both `[a-z0-9-]+`.

### 5. The pilot, then the roll-out

The pilot is `/docs/sketching/` and five tool pages (Line, Dimension, Project,
Trim, Sketch Fillet), with four widgets: `dof-playground` (a rectangle, its
constraints switched on and off, colours and the DOF counter following),
`palette-switches` (the palette's display switches on a plate with a hole),
`dimension-label` (where a two-point dimension's label goes decides
horizontal, vertical or aligned) and `trim` (point at a piece, click to trim).
The guide gains a section **The sketch palette**, one `h3` per switch.
Tool pages stay generated; the new text goes between their `<!-- notes -->`
markers, in the order Step by step, Options, What it keeps, Messages (each only
where it has something to say). Messages are quoted from the app word for word.

After the owner's review of the pilot, the other 45 sketch tool pages follow in
batches, the 24 tools without a clip get one, and two more widgets join
(`snap-explorer`, `profiles`).

## Consequences

- `docs.test.ts`'s "no script" assertion becomes "no script except the one
  widget module, and only on a page with a widget"; the handler, `style` and
  `javascript:` assertions stay.
- A docs page with widgets needs JavaScript for interaction only; its content,
  including the widget's starting picture, is in the HTML.
- A figure that uses a colour outside the class list fails the build; a new
  colour is a new class in `docs.css`, for both themes.
- Widgets are hand-written scenes, so a change in how the app behaves (a new
  snap, a renamed switch) can leave a widget showing old behaviour. The tool
  pages' clips are re-recorded from the app; widgets are reviewed with the
  page they sit on.

## Rejected

- **The real app in a frame** on the docs page: many MB of WASM per page, a
  policy that would need `wasm-unsafe-eval` and frames, slow and fragile.
- **The real solver (planegcs) in the docs:** the same WASM and policy cost for
  scenes a few lines of code can play exactly.
- **Pictures and clips only:** no interaction, the thing that settled the
  palette's design.
- **SVG as `<img>`:** an image can't follow the page's theme (no
  `currentColor`, no site CSS), and an inline `<style>` inside it is the kind
  of style the policy is there to refuse.
- **Raw HTML or a custom tag for widgets** (`<figure data-widget>` in
  Markdown): it would widen "the only raw HTML is `<video>`", and shows as
  nothing on GitHub.
- **A framework** (React, Lit) for widgets: a few hundred lines of DOM code
  each don't need one, and the site has none.
