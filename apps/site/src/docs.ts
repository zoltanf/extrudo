/**
 * The API docs as static pages (ADR-0068 §6): every Markdown file under
 * `docs/api` becomes HTML under `/docs/api/` at build time, linked from the
 * landing page's footer.
 *
 * Nothing here runs in a browser: `docsPlugin` (`docs-plugin.ts`) calls these
 * functions while building, the Markdown becomes HTML, and the pages carry a
 * stylesheet, a sidebar and nothing else. No script, which is what the site's
 * stricter content policy asks for (ADR-0057).
 *
 * The pages are read from the same Markdown the repository holds, so the
 * reference on extrudo.org is the reference in `docs/api/`, with its relative
 * links (`./sketch.md`, `../references.md`) rewritten to the pages they became.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, posix } from 'node:path';
import { marked } from 'marked';

/** One Markdown file, and what the site needs to know about it. */
export interface DocPage {
  /** The file's path below the docs directory, e.g. `features/extrude.md`. */
  path: string;
  /** The address it is published at, e.g. `/docs/api/features/extrude/`. */
  url: string;
  title: string;
  /** `Guide` for the hand-written pages, `Features` for the generated ones. */
  section: string;
  /** The sidebar's own heading for a feature: `Create`, `Modify`, … */
  category?: string;
  /** The order in its section, from the front matter or the file's name. */
  order: number;
  /** The page's own HTML body. */
  html: string;
}

/** One entry of the sidebar: a link, or a group of them under a heading. */
export interface SidebarEntry {
  title: string;
  entries: { title: string; url: string }[];
}

/** Where the pages live in the build, and what each Markdown file becomes. */
export const DOCS_PREFIX = '/docs/api';

/** The categories in the order the app's tools are grouped (lower case, core's spelling). */
const CATEGORY_ORDER = ['sketch', 'create', 'modify', 'construct', 'inspect'];

/**
 * Every Markdown file below `dir` as a page: the front matter read (title,
 * section, category, order), the relative links rewritten and the rest rendered
 * to HTML. Sorted by its address, so the sidebar and the output are the same on
 * every run.
 */
export function docPages(dir: string): DocPage[] {
  return markdownFiles(dir).map((path) => {
    const source = readFileSync(join(dir, path), 'utf8');
    const { meta, body } = frontMatter(source);
    return {
      path,
      url: urlFor(path),
      title: meta.title ?? path,
      section: meta.section ?? 'Guide',
      ...(meta.category ? { category: meta.category } : {}),
      order: Number(meta.order ?? (Number(path.replace(/\D/g, '')) || 0)),
      html: focusable(
        marked.parse(rewriteLinks(body, path), { gfm: true, async: false }) as string,
      ),
    };
  });
}

/**
 * The sidebar every page carries: the guide pages in their own order, then the
 * feature pages grouped by category. Nothing is active — a page carries no
 * script, so it cannot mark where it is.
 */
export function sidebar(pages: readonly DocPage[]): SidebarEntry[] {
  const guide = pages
    .filter((page) => page.section === 'Guide')
    .sort((a, b) => a.order - b.order)
    .map((page) => ({ title: page.title, url: page.url }));
  const features = pages
    .filter((page) => page.section === 'Features')
    .sort((a, b) => a.order - b.order);
  const categories = [
    ...new Set(features.filter((page) => page.category).map((page) => page.category ?? '')),
  ].sort((a, b) => categoryRank(a) - categoryRank(b));
  return [
    { title: 'Getting started', entries: guide },
    // The feature index comes first: it is the way into the pages below.
    ...(features.some((page) => !page.category)
      ? [
          {
            title: 'Features',
            entries: features
              .filter((page) => !page.category)
              .map((page) => ({ title: page.title, url: page.url })),
          },
        ]
      : []),
    ...categories.map((category) => ({
      // Core's category is lower case ('create'); the sidebar reads as a heading.
      title: `${category.charAt(0).toUpperCase()}${category.slice(1)}`,
      entries: features
        .filter((page) => (page.category ?? 'features') === category)
        .map((page) => ({ title: page.title, url: page.url })),
    })),
  ];
}

/**
 * One page as a whole document: the head (a canonical URL, the site's colour
 * scheme and its stylesheet), the sidebar, the page and a footer back to the
 * landing page. `stylesheet` is the built stylesheet's path and `description`
 * the site's one-liner, both handed in because the build knows them.
 */
export function pageHtml(
  page: DocPage,
  pages: readonly DocPage[],
  options: { stylesheet: string; description: string; siteUrl: string },
): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="color-scheme" content="dark light" />
    <title>${html(page.title)} — Extrudo API docs</title>
    <meta name="description" content="${html(options.description)}" />
    <link rel="canonical" href="${html(page.url)}" />
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <link rel="stylesheet" href="${html(options.stylesheet)}" />
  </head>
  <body>
    <a class="skip" href="#main">Skip to content</a>
    <header class="top">
      <a class="brand" href="/" aria-label="Extrudo home">
        ${mark()}
        <span class="wordmark">extrudo</span>
      </a>
      <p class="where">API docs</p>
    </header>
    <div class="docs">
      <nav class="side" aria-label="API docs" tabindex="0">
        ${sidebar(pages)
          .map(
            (group) => `<section>
          <h2>${html(group.title)}</h2>
          <ul>
            ${group.entries
              .map(
                (entry) =>
                  `<li><a href="${html(entry.url)}"${entry.url === page.url ? ' aria-current="page"' : ''}>${html(entry.title)}</a></li>`,
              )
              .join('\n            ')}
          </ul>
        </section>`,
          )
          .join('\n        ')}
      </nav>
      <main id="main" class="page">
${page.html}
      </main>
    </div>
    <footer class="foot">
      <p>
        <a href="/">Extrudo</a> ·
        <a href="/docs/api/">API docs</a> ·
        <a href="https://github.com/zoltanf/extrudo">Source code</a> ·
        <a href="https://github.com/zoltanf/extrudo/blob/main/docs/file-format.md">File format</a>
      </p>
      <p class="muted">Free software under the GPL-3.0. Generated from <code>docs/api/</code>.</p>
    </footer>
  </body>
</html>
`;
}

/**
 * The whole stylesheet: the brand's tokens (the same file the landing page
 * imports) and the docs' own rules. The font faces are added by the build, which
 * knows the hashed file names it emitted for them.
 */
export function stylesheet(tokens: string, rules: string, faces: readonly string[]): string {
  return [tokens.trim(), faces.join('\n'), rules.trim()].join('\n\n');
}

/**
 * What scrolls, made reachable: the code blocks and the tables are wider than the
 * column and scroll sideways, and a scrollable region a keyboard cannot reach is
 * a WCAG failure (axe's `scrollable-region-focusable`, which the site's own audit
 * runs). `tabindex` is the one thing that needs no script.
 */
function focusable(html: string): string {
  return html.replace(/<(pre|table)>/g, '<$1 tabindex="0">');
}

/** The logo mark, the landing page's own SVG (ADR-0057, docs/05-brand.md §2). */
function mark(): string {
  return `<svg class="mark" width="32" height="32" viewBox="0 0 64 64" aria-hidden="true">
          <path class="mark-top" d="M10 24 24 10H52L38 24Z" />
          <path class="mark-side" d="M38 24 52 10V38L38 52Z" />
          <rect class="mark-sketch" x="10" y="24" width="28" height="28" rx="1" />
          <circle class="mark-dot" cx="10" cy="24" r="2.2" />
          <circle class="mark-dot" cx="38" cy="24" r="2.2" />
          <circle class="mark-dot" cx="10" cy="52" r="2.2" />
          <circle class="mark-dot" cx="38" cy="52" r="2.2" />
        </svg>`;
}

/** Every Markdown file below `dir`, as paths relative to it, sorted. */
function markdownFiles(dir: string, below = ''): string[] {
  const found: string[] = [];
  // Sorted here, not left to the filesystem: the sidebar and the output must be
  // the same on every machine.
  for (const entry of readdirSync(join(dir, below)).sort()) {
    const path = below ? `${below}/${entry}` : entry;
    if (entry.endsWith('.md')) found.push(path);
    else if (statSync(join(dir, path)).isDirectory()) found.push(...markdownFiles(dir, path));
  }
  return found;
}

/**
 * The address a Markdown file is published at: `docs/api/README.md` is
 * `/docs/api/`, `docs/api/features/README.md` is `/docs/api/features/`, and
 * anything else is a directory of its own under `/docs/api/`.
 */
function urlFor(path: string): string {
  const stem = path.replace(/\.md$/, '');
  const address = stem.endsWith('README') ? dirname(stem) : stem;
  return `${DOCS_PREFIX}${address ? `/${address}` : ''}/`;
}

/**
 * The front matter of a page: the `key: value` lines between the first two `---`
 * fences, and the rest of the file. A file with no front matter is all body.
 */
function frontMatter(source: string): { meta: Record<string, string>; body: string } {
  const match = /^---\n([\s\S]*?)\n---\n?/.exec(source);
  if (!match) return { meta: {}, body: source };
  const meta: Record<string, string> = {};
  for (const line of (match[1] ?? '').split('\n')) {
    const [key, ...rest] = line.split(':');
    if (key) meta[key.trim()] = rest.join(':').trim();
  }
  return { meta, body: source.slice(match[0].length) };
}

/**
 * The relative links a page holds, rewritten to the addresses they became:
 * `./sketch.md` in `features/extrude.md` is `/docs/api/sketch/`, and
 * `../references.md` is `/docs/api/references/`. A link that is not to a
 * Markdown file of this tree — a repository URL, an anchor, a mail address — is
 * left as it is.
 */
function rewriteLinks(body: string, path: string): string {
  return body.replace(/\]\(([^)\s]+\.md)(#[^)\s]*)?\)/g, (_all, target: string, anchor = '') => {
    // A link to the repository (a file's own page on GitHub) keeps its address:
    // only the ones inside the docs tree became pages here.
    if (/^[a-z][a-z0-9+.-]*:/i.test(target)) return _all;
    const resolved = target.startsWith('/')
      ? target.slice(1)
      : posix.normalize(posix.join(dirname(path), target));
    return `](${urlFor(resolved)}${anchor})`;
  });
}

/** Text for an HTML attribute, a heading or a title: `&`, `<`, `>` and a quote. */
function html(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** A sidebar group's place among the categories. */
function categoryRank(category: string): number {
  const index = CATEGORY_ORDER.indexOf(category);
  return index < 0 ? CATEGORY_ORDER.length : index;
}

/** `path`'s directory, as a path string ('' for the docs root). */
function dirname(path: string): string {
  const cut = path.lastIndexOf('/');
  return cut < 0 ? '' : path.slice(0, cut);
}
