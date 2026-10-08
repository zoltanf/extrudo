# ADR-0080: Docs site, tutorials and examples

- **Status:** accepted (2026-10-08)
- **Task:** P6-06 (docs site, tutorials, example library), slice S1.
- **Depends on:** ADR-0057 (the landing page, its stricter `_headers`, no
  script, no `style` attribute, no internal package), ADR-0068 §6 (the API
  pages built from `docs/api/`), ADR-0052 (the in-app tour and the recorder),
  ADR-0066 and the benchmark fixtures (ADR-0039).

## Context

The owner decided on 2026-10-08, after the v0.4.0 release:

1. **Tutorials are web pages** on extrudo.org/docs with screenshots recorded
   from the real app, and **each tutorial is an e2e test** that walks the same
   steps. The in-app tour stays the one "first box" tour.
2. **Examples are a gallery page** on the site. Each one has "Open in Extrudo",
   which opens a copy through an app route `#/example/<id>`. The app's home
   screen gets a "More examples" entry. The list starts from the benchmark
   fixtures.
3. **The guide** is hand-written concept pages plus **one generated page per
   tool**, built from the app's own tool list.

Today the site has one docs tree, `docs/api/` at `/docs/api/`, with its own
sidebar. Everything else has to fit beside it without breaking an API address.

## Decision

### 1. One docs site under `/docs/`

`apps/site` builds `docs/` Markdown at build time, as it does the API pages
today. A page carries no script, loads nothing from another origin and needs no
internal package. The Markdown is the source; the repository's own `docs/` is
what a reader on GitHub sees too.

**Collections** map folders to addresses. A file belongs to the *deepest*
collection whose folder contains it, so a nested folder can have its own
address without a rule for each file:

| Folder | Address | Top-level section |
|---|---|---|
| `docs/guide/` | `/docs/` (`index.md` is `/docs/`) | Guide |
| `docs/guide/tutorials/` | `/docs/tutorials/` | Tutorials |
| `docs/guide/tools/` | `/docs/tools/` | Tools |
| `docs/api/` | `/docs/api/` (unchanged) | API |

`docs/guide/examples.md` is a guide page at `/docs/examples/`; its front matter
`section: Examples` puts it under Examples in the sidebar. In `docs/api/` the
front matter `section` keeps meaning the API's own sub-group (`Guide`,
`Features`), so every API address and group stays as it was. A folder that
doesn't exist (the tutorials, tools or examples before their slices land) is
simply not read. Relative links between collections resolve
(`../api/README.md` from a guide page is `/docs/api/`); a link to a `.md` that
isn't a page is left alone, and the test that no link ends in `.md` fails on
it.

**One sidebar**: Guide, Tutorials, Tools, Examples, API, in that order; a
section with no pages is not shown; inside a section pages go by front matter
`order`, then title. The API section keeps its two-level shape (Getting started,
Features, then the categories) as nested groups. The page's own entry has
`aria-current="page"`. A page's `<title>` is `<page> · Extrudo docs`; the API
pages keep `<page> — Extrudo API docs`.

*What it protects:* the API's addresses are linked from the app, the CLI docs
and other people's pages, so they never move; and a reader finds every kind of
page from one place.

### 2. Assets are emitted, never inlined, and missing ones fail the build

- A Markdown image `![alt](./images/x.png)` (relative; `.png`, `.jpg`, `.webp`,
  `.svg`) and a `<video src="./x.webm">` (relative; `.webm`, `.mp4`) are
  resolved against the Markdown file's folder. Each distinct file is emitted
  once as a hashed asset (`assets/x-<hash>.png`) and the `src` rewritten.
  The site's `img-src`/`media-src 'self'` already allows them.
- **A missing file fails the build**, naming the page and the reference:
  `docs/guide/x.md: missing image ./images/x.png`. A broken picture on the
  published site is a bug the build can catch.
- **Tool demo clips** (ADR-0052) are never copied into `docs/`: a video `src` of
  `demo:<toolId>` resolves to `apps/web/public/demos/<toolId>.webm`.
- **Raw HTML is limited to `<video>`** with `src`, `muted`, `loop`, `autoplay`,
  `playsinline`, `controls`, `width`, `height` and `aria-label`. Any other raw
  tag or attribute fails the build. HTML comments are allowed and dropped (the
  tool generator's `<!-- notes -->` markers). The tag is rebuilt from the
  checked attributes, not passed through. *What it protects:* a docs page can
  never carry a script, an event handler or a `style` attribute, which the
  site's content policy would refuse anyway (ADR-0057).

### 3. Addresses in Markdown

A page can write `{{APP_URL}}` (also `{{SITE_URL}}`, `{{EDGE_URL}}`); the build
replaces it with the build's address from `apps/site/addresses.ts`, the one
place that knows the domains. Markdown can't import a TypeScript file, and a
hard-coded domain is a bug (ADR-0054). Other `{{…}}` text is left alone.

### 4. The rest of the plan, recorded here so slices agree

- **Tool reference is generated** (`pnpm docs:generate`) from the app's tool
  list, key map and demo list into `docs/guide/tools/<id>.md` and an index,
  keeping each page's hand-written `<!-- notes -->` section; a test fails with
  "run pnpm docs:generate" when the files are stale.
- **Examples registry**: `fixtures/examples/examples.json` is the one source
  (`id`, `title`, `description`, `file`, `tags`, `level`); the app bundles the
  files, the site reads the JSON for `examples.md`. The route `#/example/<id>`
  opens a copy under a new ID, then `#/p/<new id>`; an unknown ID goes home with
  a toast. The examples are not precached.
- **Tutorials are tests**: each step is marked `<!-- step: <slug> -->` in the
  page and walked by `e2e/tutorials/<name>.spec.ts` with `step('<slug>', …)`,
  which saves the picture only with `RECORD_ASSETS=1` and otherwise asserts the
  outcome. A unit test fails when a page's slugs and its spec's differ.
- **The app links to the docs**: Help items and each tooltip's "Learn more",
  through a new `Platform.openExternal` (desktop: limited to
  `https://extrudo.org/docs/` URLs).

**S9 (2026-10-08), what changed from the plan:** the tooltip holds no link —
**F1 does it** (`keymap.help`). A tooltip closes when the pointer leaves and
screen readers read it as plain text, so a control inside it was never going to
work; instead every toolbar tile's tooltip carries a muted "F1 for more" line,
and F1 opens the hovered (or focused) tile's tool page, else the user guide.
The links go through `Platform.openDocs(path)` (required; the web opens
`DOCS_URL + path` in a new tab, `VITE_DOCS_URL` overridable at build time;
`shell/docsLinks.ts` builds the paths), and on the desktop over the new
`docs:open` channel, where **main builds its own URL** from a whitelist of
`docsPath` results and opens it through injected `shell.openExternal` — never a
URL from the renderer. The Help menu's four items (User Guide, Tutorials,
Examples, Tool Reference) are commands too (`docsGuide`, `docsTutorials`,
`docsExamples`, `docsTools`, group "Help"), so Ctrl+K and the desktop's Help
menu find the same ones.

## Rejected options

- **Interactive in-app tutorials.** A second tour system to build and keep in
  step with every dialog; the one "first box" tour (ADR-0052) stays, and web
  pages with pictures can be read beside the app.
- **Untested pages.** A tutorial that nobody runs rots at the next UI change;
  walking it as an e2e spec makes CI say which step broke.
- **A site-only or app-only example library.** A site-only gallery can't open
  anything; an app-only one can't be linked or searched. One registry feeds both.
- **A hand-written tool reference.** There are about 110 tools and the toolbar,
  keys and demos change; a generator from `TOOLS`, `TABS` and the keymap can't
  go stale unnoticed.
- **A separate docs generator (VitePress, Docusaurus).** They ship client
  scripts and a second toolchain under a site whose content policy allows no
  script; `marked` plus a small plugin already builds the API pages.

## Consequences

- The sidebar and title rules are in `apps/site/src/docs.ts` and tested with
  small fixture trees; adding a collection is one line.
- The site's docs navigation is labelled "Docs" (it was "API docs"); the
  landing page's nav gets "Docs" (`/docs/`) and the footer keeps "API docs".
- Later slices add content into the structure without touching the build.
- Images and clips grow the site's output; they are hashed and cacheable.

## Slices

| # | Slice |
|---|---|
| S1 | This ADR and the docs build: collections, one sidebar, the `/docs/` index, asset emission, the nav link |
| S2 | The tool reference generator and its first run |
| S3 | The examples registry, `#/example/<id>`, the home screen's "More examples" |
| S4 | The gallery page and thumbnails |
| S5 | Tutorial infrastructure and tutorial 1 (wall bracket) |
| S6 | Concept guide, part 1 |
| S7 | Concept guide, part 2 |
| S8 | Tutorials 2–4 (storage box, threaded cap, name tag) |
| S9 | In-app links: Help items, "Learn more", `Platform.openExternal` |
| S10 | Review, then tick P6-06, changelog |

**S5 (2026-10-08).** Decisions the plan left open: a tutorial's spec is `step(slug,
actions, check)` bound to a page by `tutorial(page, name)` (`e2e/tutorials/step.ts`),
pictures are the **whole 1440 × 900 page** reduced to **256-colour PNGs** by a median cut in
the browser (a full-colour shot of the gradient view is about 570 kB, the indexed one
80 to 105 kB; no dependency), toasts dismissed and the pointer parked; the Markdown
marker is `<!-- step: <slug> -->` before each `###` heading with the picture
`./images/<name>/<slug>.png` after it; `pnpm demos -g tutorials` records. A tutorial's last
asserted file (the STL) is checked after its final step, so the picture can show the dialog.
Links from a tutorial to `../tools/<id>.md` resolve to `/docs/tools/<id>/` whether or not
the tool page exists (the build does not check): name only tools that have a page.
