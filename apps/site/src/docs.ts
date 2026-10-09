/**
 * The docs as static pages (ADR-0068 §6, ADR-0080): every Markdown file under
 * `docs/guide` and `docs/api` becomes HTML under `/docs/` at build time, linked
 * from the landing page.
 *
 * Nothing here runs in a browser: `docsPlugin` (`docs-plugin.ts`) calls these
 * functions while building, the Markdown becomes HTML, and the pages carry a
 * stylesheet, a sidebar and nothing else. No script, which is what the site's
 * stricter content policy asks for (ADR-0057).
 *
 * The pages are read from the same Markdown the repository holds, so the
 * reference on extrudo.org is the reference in `docs/`, with its relative
 * links (`./sketch.md`, `../api/README.md`) rewritten to the pages they became.
 * Pictures and clips are collected as assets for the build to emit, and raw HTML
 * other than a `<video>` is refused, so a page can never hold a script.
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join, posix } from 'node:path';
import { Marked } from 'marked';

/** A folder of Markdown and where it is published. */
export interface Collection {
  /** The folder below the docs root, e.g. `guide/tutorials`. */
  dir: string;
  /** The address it is published at, with both slashes, e.g. `/docs/tutorials/`. */
  prefix: string;
  /** The sidebar's top-level section its pages are in, unless a page says otherwise. */
  section: string;
}

/**
 * The collections (ADR-0080 §1). A file belongs to the deepest one whose folder
 * contains it, so `docs/guide/tutorials/x.md` is a tutorial, not a guide page.
 */
export const COLLECTIONS: readonly Collection[] = [
  { dir: 'guide', prefix: '/docs/', section: 'Guide' },
  { dir: 'guide/tutorials', prefix: '/docs/tutorials/', section: 'Tutorials' },
  { dir: 'guide/tools', prefix: '/docs/tools/', section: 'Tools' },
  { dir: 'api', prefix: '/docs/api/', section: 'API' },
];

/** The sidebar's top-level sections, in order. */
export const SECTIONS = ['Guide', 'Tutorials', 'Tools', 'Examples', 'API'] as const;

/** One asset (a picture or a clip) a page refers to, and where it is on disk. */
export interface DocAsset {
  /** A content hash and the file's name: equal files are one asset. */
  id: string;
  /** The file's name, which the build hashes into the emitted file's own. */
  name: string;
  /** The absolute path. */
  file: string;
}

/** One Markdown file, and what the site needs to know about it. */
export interface DocPage {
  /** The file's path below its collection's folder, e.g. `features/extrude.md`. */
  path: string;
  /** The file's path below the docs root, e.g. `api/features/extrude.md`. */
  file: string;
  collection: Collection;
  /** The address it is published at, e.g. `/docs/api/features/extrude/`. */
  url: string;
  title: string;
  /** The sidebar's top-level section (one of `SECTIONS`). */
  section: string;
  /** The API's own sub-group from the front matter: `Guide` or `Features`. */
  group?: string;
  /** The sidebar's own heading for a feature: `Create`, `Modify`, … */
  category?: string;
  /** The order in its section, from the front matter or the file's name. */
  order: number;
  /** The page's own HTML body; assets are `__DOCS_FILE_<id>__` until the build names them. */
  html: string;
  /** The pictures and clips the page uses. */
  assets: DocAsset[];
}

/** One group of the sidebar: a heading and links. */
export interface SidebarEntry {
  title: string;
  entries: { title: string; url: string }[];
}

/** One top-level section of the sidebar: its own links, then nested groups. */
export interface SidebarSection extends SidebarEntry {
  groups: SidebarEntry[];
}

/** The categories in the order the app's tools are grouped (lower case, core's spelling). */
const CATEGORY_ORDER = ['sketch', 'create', 'modify', 'construct', 'inspect'];

/**
 * The Tools sidebar's categories, in the order the app's tabs appear
 * (`TABS`, ADR-0079): a tool page's `category` is the label of the first tab it
 * appears in, which `pnpm docs:generate` writes. The site cannot import the app
 * (ADR-0057), so the order is kept here; `toolDocs.test.ts` and the site's own
 * tests pin it against the generated pages.
 */
const TOOL_CATEGORY_ORDER = [
  'Home',
  'Solid',
  'Modify',
  'Construct',
  'Inspect',
  'Sketch',
  '3D Print',
];

const IMAGE_TYPES = ['.png', '.jpg', '.webp', '.svg'];
const VIDEO_TYPES = ['.webm', '.mp4'];
/** The schemes a link may have; anything without one is a relative path or a fragment. */
const LINK_SCHEMES = ['https', 'http', 'mailto'];

/** The only raw HTML a page may hold: a `<video>` with these attributes. */
const VIDEO_FLAGS = ['muted', 'loop', 'autoplay', 'playsinline', 'controls'];
const VIDEO_VALUES = ['width', 'height', 'aria-label'];
const PLACEHOLDER = (id: string) => `__DOCS_FILE_${id}__`;

/** What a build tells the pages about itself. */
export interface DocOptions {
  /** `{{NAME}}` tokens in Markdown, e.g. `APP_URL` (ADR-0080 §3). */
  tokens?: Record<string, string>;
  /** The collections; the docs' own by default. */
  collections?: readonly Collection[];
}

/**
 * Every Markdown file below the collections' folders as a page: the front matter
 * read (title, section, category, order), the relative links rewritten and the
 * rest rendered to HTML. A folder that doesn't exist is skipped. Sorted by its
 * address, so the sidebar and the output are the same on every run.
 */
export function docPages(root: string, options: DocOptions = {}): DocPage[] {
  const collections = options.collections ?? COLLECTIONS;
  const tops = collections.filter(
    (collection) => !collections.some((other) => isInside(collection.dir, other.dir)),
  );
  const files = tops.flatMap((top) =>
    existsSync(join(root, top.dir)) ? markdownFiles(root, top.dir) : [],
  );
  const pages = files.map((file) => {
    const collection = collectionOf(collections, file);
    if (!collection) throw new Error(`docs/${file}: no collection`);
    const path = file.slice(collection.dir.length + 1);
    const source = readFileSync(join(root, file), 'utf8');
    const { meta, body } = frontMatter(source);
    const assets = new Map<string, DocAsset>();
    const text = fillTokens(body, options.tokens ?? {});
    const html = renderer(root, file, assets).parse(rewriteLinks(text, file, collections));
    const api = collection.section === 'API';
    const named = SECTIONS.find((name) => name === meta.section);
    return {
      path,
      file,
      collection,
      url: urlFor(collection, path),
      title: meta.title ?? path,
      section: api ? 'API' : (named ?? collection.section),
      ...(api && meta.section ? { group: meta.section } : {}),
      ...(meta.category ? { category: meta.category } : {}),
      order: Number(meta.order ?? (Number(path.replace(/\D/g, '')) || 0)),
      html: focusable(html),
      assets: [...assets.values()],
    } satisfies DocPage;
  });
  const seen = new Map<string, string>();
  for (const page of pages) {
    const other = seen.get(page.url);
    if (other) throw new Error(`docs/${page.file} and docs/${other} are both ${page.url}`);
    seen.set(page.url, page.file);
  }
  return pages.sort((a, b) => a.url.localeCompare(b.url));
}

/** Every distinct asset the pages use, once each, in a stable order. */
export function collectAssets(pages: readonly DocPage[]): DocAsset[] {
  const all = new Map<string, DocAsset>();
  for (const page of pages) for (const asset of page.assets) all.set(asset.id, asset);
  return [...all.values()].sort((a, b) => a.id.localeCompare(b.id));
}

/** The placeholder a page's HTML holds for an asset until the build names its file. */
export function assetPlaceholder(asset: DocAsset): string {
  return PLACEHOLDER(asset.id);
}

/**
 * The sidebar every page carries (ADR-0080 §1): the top-level sections in order,
 * a section with no pages left out, and inside one the pages by `order`, then
 * title. The API keeps its own nested groups. Nothing is active — a page carries
 * no script, so it cannot mark where it is (the page marks its own entry).
 */
export function sidebar(pages: readonly DocPage[]): SidebarSection[] {
  const sections: SidebarSection[] = [];
  for (const title of SECTIONS) {
    const own = pages.filter((page) => page.section === title);
    if (own.length === 0) continue;
    if (title === 'API') {
      sections.push({ title, entries: [], groups: apiGroups(own) });
      continue;
    }
    if (title === 'Tools') {
      // The index page carries no category and is listed first; the rest are
      // grouped by the tab they first appear in (ADR-0080 §2).
      sections.push({
        title,
        entries: links(own.filter((page) => !page.category)),
        groups: toolGroups(own),
      });
      continue;
    }
    sections.push({ title, entries: links(own), groups: [] });
  }
  return sections;
}

/**
 * The API's sub-groups: the guide pages in their own order, then the feature
 * pages grouped by category.
 */
export function apiGroups(pages: readonly DocPage[]): SidebarEntry[] {
  const guide = pages.filter((page) => page.group !== 'Features');
  const features = pages.filter((page) => page.group === 'Features').sort(byOrder);
  const categories = [
    ...new Set(features.filter((page) => page.category).map((page) => page.category ?? '')),
  ].sort((a, b) => categoryRank(a) - categoryRank(b));
  return [
    { title: 'Getting started', entries: links(guide) },
    // The feature index comes first: it is the way into the pages below.
    ...(features.some((page) => !page.category)
      ? [{ title: 'Features', entries: links(features.filter((page) => !page.category)) }]
      : []),
    ...categories.map((category) => ({
      // Core's category is lower case ('create'); the sidebar reads as a heading.
      title: `${category.charAt(0).toUpperCase()}${category.slice(1)}`,
      entries: links(features.filter((page) => page.category === category)),
    })),
  ];
}

/**
 * The Tools sub-groups: the pages without a category (the index) are listed by
 * the section itself, and the rest are grouped by the tab they first appear in,
 * in `TABS` order. Named like the tab, so the sidebar reads `Solid`, `3D Print`.
 */
export function toolGroups(pages: readonly DocPage[]): SidebarEntry[] {
  const categorised = pages.filter((page) => page.category);
  const categories = [...new Set(categorised.map((page) => page.category ?? ''))].sort(
    (a, b) => toolRank(a) - toolRank(b),
  );
  return categories.map((category) => ({
    title: category,
    entries: links(categorised.filter((page) => page.category === category)),
  }));
}

function links(pages: readonly DocPage[]): { title: string; url: string }[] {
  return [...pages].sort(byOrder).map((page) => ({ title: page.title, url: page.url }));
}

function byOrder(a: DocPage, b: DocPage): number {
  return a.order - b.order || a.title.localeCompare(b.title);
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
    <title>${html(page.title)} ${page.section === 'API' ? '— Extrudo API docs' : '· Extrudo docs'}</title>
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
      <p class="where">Docs</p>
    </header>
    <div class="docs">
      <nav class="side" aria-label="Docs" tabindex="0">
        ${sidebar(pages)
          .map(
            (section) => `<section>
          <h2>${html(section.title)}</h2>${list(section.entries, page.url)}${section.groups
            .map(
              (group) =>
                `\n          <h3>${html(group.title)}</h3>${list(group.entries, page.url)}`,
            )
            .join('')}
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
        <a href="/docs/">Docs</a> ·
        <a href="/docs/api/">API docs</a> ·
        <a href="https://github.com/zoltanf/extrudo">Source code</a> ·
        <a href="https://github.com/zoltanf/extrudo/blob/main/docs/file-format.md">File format</a>
      </p>
      <p class="muted">Free software under the GPL-3.0. Built from <code>docs/</code>.</p>
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

/** A sidebar list, the page's own entry marked. */
function list(entries: readonly { title: string; url: string }[], current: string): string {
  if (entries.length === 0) return '';
  return `
          <ul>
            ${entries
              .map(
                (entry) =>
                  `<li><a href="${html(entry.url)}"${entry.url === current ? ' aria-current="page"' : ''}>${html(entry.title)}</a></li>`,
              )
              .join('\n            ')}
          </ul>`;
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

/** Every Markdown file below `root/below`, as paths relative to `root`, sorted. */
function markdownFiles(root: string, below: string): string[] {
  const found: string[] = [];
  // Sorted here, not left to the filesystem: the sidebar and the output must be
  // the same on every machine.
  for (const entry of readdirSync(join(root, below)).sort()) {
    const path = `${below}/${entry}`;
    if (entry.endsWith('.md')) found.push(path);
    else if (statSync(join(root, path)).isDirectory()) found.push(...markdownFiles(root, path));
  }
  return found;
}

/** Whether folder `inner` is strictly inside folder `outer`. */
function isInside(inner: string, outer: string): boolean {
  return inner !== outer && inner.startsWith(`${outer}/`);
}

/** The deepest collection whose folder contains `file` (a path below the docs root). */
function collectionOf(collections: readonly Collection[], file: string): Collection | undefined {
  let best: Collection | undefined;
  for (const collection of collections) {
    if (!file.startsWith(`${collection.dir}/`)) continue;
    if (!best || collection.dir.length > best.dir.length) best = collection;
  }
  return best;
}

/**
 * The address a Markdown file is published at: `docs/api/README.md` is
 * `/docs/api/`, `docs/guide/index.md` is `/docs/`, and anything else is a
 * directory of its own under its collection's prefix. `path` is below the
 * collection's folder.
 */
function urlFor(collection: Collection, path: string): string {
  const stem = path.replace(/\.md$/, '');
  const name = stem.slice(stem.lastIndexOf('/') + 1);
  const address = name === 'README' || name === 'index' ? dirname(stem) : stem;
  return `${collection.prefix}${address ? `${address}/` : ''}`;
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
 * `./sketch.md` in `api/features/extrude.md` is `/docs/api/sketch/`, and
 * `../api/README.md` from a guide page is `/docs/api/`. A link that is not to a
 * Markdown file of a collection — a repository URL, an anchor, a mail address, a
 * file outside the tree — is left as it is (and the tests refuse a `.md` link
 * that stayed).
 */
function rewriteLinks(body: string, file: string, collections: readonly Collection[]): string {
  return body.replace(/\]\(([^)\s]+\.md)(#[^)\s]*)?\)/g, (all, target: string, anchor = '') => {
    // A link to the repository (a file's own page on GitHub) keeps its address:
    // only the ones inside the docs tree became pages here.
    if (/^[a-z][a-z0-9+.-]*:/i.test(target)) return all;
    const resolved = target.startsWith('/')
      ? posix.normalize(target.slice(1))
      : posix.normalize(posix.join(dirname(file), target));
    const collection = collectionOf(collections, resolved);
    if (!collection) return all;
    return `](${urlFor(collection, resolved.slice(collection.dir.length + 1))}${anchor})`;
  });
}

/** `{{APP_URL}}` and the like, replaced when the build knows the name. */
function fillTokens(body: string, tokens: Record<string, string>): string {
  return body.replace(/\{\{([A-Z_]+)\}\}/g, (all, name: string) => tokens[name] ?? all);
}

/** A Markdown parser for one file: images and clips collected, raw HTML checked. */
function renderer(
  root: string,
  file: string,
  assets: Map<string, DocAsset>,
): { parse(source: string): string } {
  const where = posix.join('docs', file);
  /** The first problem found: marked rewrites what a renderer throws, so it is kept here. */
  let problem: Error | undefined;
  const fail = (message: string): never => {
    throw new Error(`${where}: ${message}`);
  };

  /** The asset a relative reference names; a failure names the page and the reference. */
  const asset = (kind: 'image' | 'video', src: string, types: string[]): string => {
    let path: string;
    const demo = /^demo:([A-Za-z0-9_-]+)$/.exec(src);
    if (kind === 'video' && demo) {
      // A tool's demo clip stays where the app keeps it (ADR-0080 §2).
      path = join(root, '..', 'apps/web/public/demos', `${demo[1]}.webm`);
    } else {
      if (/^[a-z][a-z0-9+.-]*:/i.test(src) || src.startsWith('/')) {
        fail(`${kind} ${src} must be a relative file (${types.join(', ')})`);
      }
      if (!types.some((type) => src.toLowerCase().endsWith(type))) {
        fail(`${kind} ${src} must be one of ${types.join(', ')}`);
      }
      const inside = posix.normalize(posix.join(dirname(file), src));
      if (inside.startsWith('..')) fail(`${kind} ${src} is outside the docs`);
      path = join(root, inside);
    }
    if (!existsSync(path) || !statSync(path).isFile()) fail(`missing ${kind} ${src}`);
    const hash = createHash('sha256').update(readFileSync(path)).digest('hex').slice(0, 12);
    const name = basename(path);
    const id = `${hash}-${name}`;
    assets.set(id, { id, name, file: path });
    return PLACEHOLDER(id);
  };

  /** One raw `<video>` tag, or the closing tag, rebuilt from checked attributes. */
  const video = (tag: string, closing: boolean, attributes: string): string => {
    if (tag !== 'video') return fail(`raw HTML <${tag}> isn't allowed in a docs page`);
    if (closing) return '</video>';
    let src: string | undefined;
    const parts: string[] = [];
    for (const match of attributes.matchAll(
      /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g,
    )) {
      const name = (match[1] ?? '').toLowerCase();
      const value = match[2] ?? match[3] ?? match[4];
      if (name === 'src') {
        src = value ?? '';
        parts.push(`src="${html(asset('video', src, VIDEO_TYPES))}"`);
      } else if (VIDEO_FLAGS.includes(name)) {
        parts.push(name);
      } else if (VIDEO_VALUES.includes(name) && value !== undefined) {
        if (name !== 'aria-label' && !/^\d+$/.test(value)) fail(`<video ${name}> must be a number`);
        parts.push(`${name}="${html(value)}"`);
      } else {
        fail(`<video> attribute "${name}" isn't allowed in a docs page`);
      }
    }
    if (src === undefined) fail('<video> needs a src');
    return `<video ${parts.join(' ')}>`;
  };

  const marked = new Marked({
    gfm: true,
    async: false,
    renderer: {
      image({ href, title, text }) {
        const src = guarded(() => asset('image', href, IMAGE_TYPES));
        return `<img src="${html(src)}" alt="${html(text)}"${title ? ` title="${html(title)}"` : ''} loading="lazy" />`;
      },
      html({ text }) {
        return guarded(() => rawHtml(text));
      },
      // Marked passes any href through (`javascript:` included), so the scheme is
      // checked here; autolinks are link tokens and come through this too.
      link({ href, title, tokens }) {
        const checked = guarded(() => linkTarget(href));
        const label = this.parser.parseInline(tokens);
        if (checked === '') return label;
        return `<a href="${html(checked)}"${title ? ` title="${html(title)}"` : ''}>${label}</a>`;
      },
    },
  });

  /** A link's target if its scheme is allowed (relative, `#`, https, http, mailto), else a build failure. */
  const linkTarget = (href: string): string => {
    // Browsers ignore whitespace and control characters inside a scheme.
    // biome-ignore lint/suspicious/noControlCharactersInRegex: that is the point
    const bare = href.replace(/[\u0000-\u0020\u007f]/g, '').toLowerCase();
    const scheme = /^([a-z][a-z0-9+.-]*):/.exec(bare)?.[1];
    if (scheme !== undefined && !LINK_SCHEMES.includes(scheme)) {
      fail(`link scheme not allowed: ${href}`);
    }
    return href;
  };

  /** Runs one renderer step; a failure is kept and the page fails after the parse. */
  function guarded(step: () => string): string {
    try {
      return step();
    } catch (error) {
      problem ??= error instanceof Error ? error : new Error(String(error));
      return '';
    }
  }

  function rawHtml(text: string): string {
    // Comments are for the people who write the page (the tool generator's
    // markers): they leave no trace. Anything else must be a `<video>`.
    const bare = text.replace(/<!--[\s\S]*?-->/g, '');
    let rest = bare;
    let out = '';
    for (const match of bare.matchAll(
      /<(\/?)([a-zA-Z][\w-]*)((?:\s+[^\s=>/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+))?)*)\s*\/?>/g,
    )) {
      out += video((match[2] ?? '').toLowerCase(), match[1] === '/', match[3] ?? '');
      rest = rest.replace(match[0], '');
    }
    if (rest.trim() !== '')
      fail(`raw HTML isn't allowed in a docs page: ${rest.trim().slice(0, 40)}`);
    return out;
  }

  return {
    parse(source: string): string {
      const out = marked.parse(source) as string;
      if (problem) throw problem;
      return out;
    },
  };
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

/** A Tools sidebar group's place among the app's tabs. */
function toolRank(category: string): number {
  const index = TOOL_CATEGORY_ORDER.indexOf(category);
  return index < 0 ? TOOL_CATEGORY_ORDER.length : index;
}

/** `path`'s directory, as a path string ('' for the docs root). */
function dirname(path: string): string {
  const cut = path.lastIndexOf('/');
  return cut < 0 ? '' : path.slice(0, cut);
}
