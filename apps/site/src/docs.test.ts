/**
 * The API docs pages the site builds (ADR-0068 §6).
 *
 * The pages are read from the repository's own `docs/api/`, so these tests are
 * about what the build will actually publish: every Markdown file becomes a page
 * at the address its links point to, the sidebar is the guide pages then the
 * feature pages by category, and a page carries no script (the site's content
 * policy allows none, ADR-0057).
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  apiGroups,
  collectAssets,
  type DocPage,
  docPages,
  pageHtml,
  sidebar,
  stylesheet,
} from './docs';

const allPages = docPages(resolve('docs'), { tokens: { APP_URL: 'https://app.example' } });
/** The API's own pages: their addresses and sidebar are pinned since ADR-0068. */
const pages = allPages.filter((page) => page.collection.dir === 'api');
const options = {
  stylesheet: '/assets/docs-1234.css',
  description: 'The Extrudo document API.',
  siteUrl: '/docs/api/',
};

/** The page with a given path, or a failure that says which. */
function pageAt(path: string): DocPage {
  const page = pages.find((candidate) => candidate.path === path);
  if (!page) throw new Error(`No page for docs/api/${path}`);
  return page;
}

describe('the docs pages', () => {
  it('are every Markdown file under docs/api', () => {
    const paths = pages.map((page) => page.path);
    expect(paths.filter((path) => !path.startsWith('features/'))).toEqual([
      'README.md',
      'emit.md',
      'plugins.md',
      'references.md',
      'scripts.md',
      'sketch.md',
    ]);
    expect(paths).toContain('features/README.md');
    // One page per feature type (46 since P6-03's plugin feature) and their index.
    expect(paths.filter((path) => path.startsWith('features/'))).toHaveLength(47);
  });

  it('are at the address their links point to', () => {
    const addresses = new Set(pages.map((page) => page.url));
    expect(addresses.size).toBe(pages.length);
    for (const page of pages) {
      expect(page.url, page.path).toMatch(/^\/docs\/api(?:\/[a-zA-Z0-9-]+)*\/$/);
    }
    expect(pageAt('README.md').url).toBe('/docs/api/');
    expect(pageAt('sketch.md').url).toBe('/docs/api/sketch/');
    expect(pageAt('features/README.md').url).toBe('/docs/api/features/');
    expect(pageAt('features/extrude.md').url).toBe('/docs/api/features/extrude/');
  });

  it('link to each other by page, never to a Markdown file', () => {
    for (const page of pages) {
      for (const [, href] of page.html.matchAll(/href="([^"]*)"/g)) {
        const link = href ?? '';
        // A link into the repository keeps its file: that one is read on GitHub.
        if (/^[a-z][a-z0-9+.-]*:/i.test(link)) {
          expect(link, `${page.path} → ${link}`).toMatch(/^https:/);
          continue;
        }
        expect(link, `${page.path} → ${link}`).not.toMatch(/\.md($|#)/);
        if (link.startsWith('/docs/api/')) expect(addresses).toContain(link);
      }
    }
  });

  it('read their title from the front matter, not the file name', () => {
    expect(pageAt('README.md').title).toBe('The API');
    expect(pageAt('sketch.md').title).toBe('Sketches');
    expect(pageAt('references.md').title).toBe('References');
    expect(pageAt('features/extrude.md').title).toBe('Extrude');
  });

  it('render their tables and code blocks, reachable by keyboard', () => {
    const extrude = pageAt('features/extrude.md');
    expect(extrude.html).toContain('<table tabindex="0">');
    expect(extrude.html).toContain('<th>Input</th>');
    expect(extrude.html).toContain('<pre tabindex="0"><code class="language-ts">');
  });
});

/** Every page's address, as a list (the link test walks them). */
const addresses: string[] = pages.map((page) => page.url);

describe('the sidebar', () => {
  const groups = apiGroups(pages);

  it('leads with the guide pages, in their own order', () => {
    expect(groups[0]).toEqual({
      title: 'Getting started',
      entries: [
        { title: 'The API', url: '/docs/api/' },
        { title: 'Sketches', url: '/docs/api/sketch/' },
        { title: 'References', url: '/docs/api/references/' },
        { title: 'Scripts', url: '/docs/api/scripts/' },
        { title: 'Macros', url: '/docs/api/emit/' },
        { title: 'Plugins', url: '/docs/api/plugins/' },
      ],
    });
  });

  it('then the feature pages, by category and in the registry\u2019s order', () => {
    expect(groups.map((group) => group.title)).toEqual([
      'Getting started',
      'Features',
      'Sketch',
      'Create',
      'Modify',
      'Construct',
    ]);
    const create = groups.find((group) => group.title === 'Create');
    expect(create?.entries.slice(0, 3)).toEqual([
      { title: 'Extrude', url: '/docs/api/features/extrude/' },
      { title: 'Revolve', url: '/docs/api/features/revolve/' },
      { title: 'Box', url: '/docs/api/features/box/' },
    ]);
  });

  it('holds every page exactly once', () => {
    const listed = groups.flatMap((group) => group.entries.map((entry) => entry.url));
    expect([...listed].sort()).toEqual([...addresses].sort());
  });
});

describe('a page document', () => {
  const html = pageHtml(pageAt('features/extrude.md'), allPages, options);

  it('carries no script of any kind', () => {
    expect(html).not.toContain('<script');
    expect(html).not.toMatch(/\\son\\w+=/);
    expect(html).not.toContain('javascript:');
  });

  it('has the head a page needs, and no more', () => {
    expect(html).toContain('<meta name="color-scheme" content="dark light" />');
    expect(html).toContain('<link rel="canonical" href="/docs/api/features/extrude/" />');
    expect(html).toContain('<link rel="stylesheet" href="/assets/docs-1234.css" />');
    expect(html).toContain('<title>Extrude — Extrudo API docs</title>');
  });

  it('has the sidebar, with this page marked', () => {
    expect(html).toContain('<nav class="side" aria-label="Docs" tabindex="0">');
    expect(html).toContain('<a href="/docs/api/features/extrude/" aria-current="page">Extrude</a>');
    expect(html).toContain('<a class="skip" href="#main">Skip to content</a>');
    expect(html).toContain('<main id="main" class="page">');
  });

  it('goes back to the landing page', () => {
    expect(html).toContain('<a href="/">Extrudo</a>');
    expect(html).toContain('<a href="/docs/">Docs</a>');
    expect(html).toContain('<a href="/docs/api/">API docs</a>');
  });
});

describe('the stylesheet', () => {
  const css = stylesheet(':root { --x-bg: #1b1f27; }', '.docs { display: grid; }', [
    '@font-face { font-weight: 400; }',
  ]);

  it('is the brand\u2019s tokens first, then the font faces, then the rules', () => {
    expect(css.indexOf('--x-bg')).toBeLessThan(css.indexOf('@font-face'));
    expect(css.indexOf('@font-face')).toBeLessThan(css.indexOf('.docs'));
  });
});

describe('the guide', () => {
  it('has its index at /docs/, with the app address filled in', () => {
    const index = allPages.find((page) => page.url === '/docs/');
    expect(index?.file).toBe('guide/index.md');
    expect(index?.section).toBe('Guide');
    expect(index?.html).toContain('href="https://app.example/"');
    expect(index?.html).toContain('href="/docs/api/"');
  });

  it('is titled for the docs, the API keeps its own title', () => {
    const index = allPages.find((page) => page.url === '/docs/');
    if (!index) throw new Error('no index');
    expect(pageHtml(index, allPages, options)).toContain(
      '<title>Extrudo docs · Extrudo docs</title>',
    );
  });
});

/** A small docs tree in a temp directory. */
const roots: string[] = [];
function tree(files: Record<string, string | Buffer>): string {
  const root = mkdtempSync(join(tmpdir(), 'extrudo-docs-'));
  roots.push(root);
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(root, path, '..'), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return root;
}
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});
const page = (title: string, extra = '', body = 'Text.\n') =>
  `---\ntitle: ${title}\n${extra}---\n\n${body}`;
const PNG = Buffer.from('89504e470d0a1a0a', 'hex');

describe('collections', () => {
  const root = tree({
    'guide/index.md': page('Home'),
    'guide/concepts.md': page('Concepts', 'order: 2\n', 'See [the API](../api/README.md#top).\n'),
    'guide/examples.md': page('Examples gallery', 'section: Examples\n'),
    'guide/tutorials/first.md': page('First'),
    'guide/tutorials/index.md': page('Tutorials'),
    'guide/tools/index.md': page('Tools'),
    'guide/tools/extrude.md': page('Extrude', 'category: Solid\norder: 1\n'),
    'guide/tools/line.md': page('Line', 'category: Sketch\norder: 2\n'),
    'api/README.md': page('The API', 'section: Guide\n'),
    'api/features/extrude.md': page('Extrude', 'section: Features\ncategory: create\n'),
  });
  const found = docPages(root);
  const url = (file: string) => found.find((candidate) => candidate.file === file)?.url;

  it('send each file to the deepest collection that holds it', () => {
    expect(url('guide/index.md')).toBe('/docs/');
    expect(url('guide/concepts.md')).toBe('/docs/concepts/');
    expect(url('guide/examples.md')).toBe('/docs/examples/');
    expect(url('guide/tutorials/first.md')).toBe('/docs/tutorials/first/');
    expect(url('guide/tutorials/index.md')).toBe('/docs/tutorials/');
    expect(url('guide/tools/index.md')).toBe('/docs/tools/');
    expect(url('api/README.md')).toBe('/docs/api/');
    expect(url('api/features/extrude.md')).toBe('/docs/api/features/extrude/');
  });

  it('resolve links between collections', () => {
    expect(found.find((candidate) => candidate.file === 'guide/concepts.md')?.html).toContain(
      'href="/docs/api/#top"',
    );
  });

  it('leave a link to a Markdown file outside the tree for the link test to refuse', () => {
    const odd = docPages(tree({ 'guide/a.md': page('A', '', '[x](../nowhere.md)\n') }));
    expect(odd[0]?.html).toContain('href="../nowhere.md"');
  });

  it('are not needed to exist', () => {
    expect(docPages(tree({ 'guide/index.md': page('Only') })).map((p) => p.url)).toEqual([
      '/docs/',
    ]);
  });

  it('refuse two files with one address', () => {
    const same = tree({ 'guide/index.md': page('A'), 'guide/README.md': page('B') });
    expect(() => docPages(same)).toThrow(/both \/docs\//);
  });

  it('keep the API at the addresses it always had', () => {
    expect(
      allPages.filter((p) => p.section === 'API').every((p) => p.url.startsWith('/docs/api/')),
    ).toBe(true);
  });

  describe('the sidebar', () => {
    const sections = sidebar(found);

    it('lists the sections in order and leaves out an empty one', () => {
      expect(sections.map((section) => section.title)).toEqual([
        'Guide',
        'Tutorials',
        'Tools',
        'Examples',
        'API',
      ]);
      const without = sidebar(found.filter((p) => !p.url.startsWith('/docs/tutorials/')));
      expect(without.map((section) => section.title)).toEqual([
        'Guide',
        'Tools',
        'Examples',
        'API',
      ]);
    });

    it('orders a section by order, then title', () => {
      expect(sections[0]?.entries.map((entry) => entry.title)).toEqual(['Home', 'Concepts']);
      expect(sections[1]?.entries.map((entry) => entry.title)).toEqual(['First', 'Tutorials']);
    });

    it('keeps the API two levels deep', () => {
      const api = sections[4];
      expect(api?.groups.map((group) => group.title)).toEqual(['Getting started', 'Create']);
    });

    it('groups the tools by the tab they first appear in, in TABS order', () => {
      const tools = sections[2];
      // The index is the section's own entry; the pages are grouped by category.
      expect(tools?.entries.map((entry) => entry.title)).toEqual(['Tools']);
      expect(tools?.groups.map((group) => group.title)).toEqual(['Solid', 'Sketch']);
      expect(tools?.groups[0]?.entries.map((entry) => entry.title)).toEqual(['Extrude']);
    });

    it('marks the page it is on', () => {
      const first = found.find((p) => p.file === 'guide/tutorials/first.md');
      if (!first) throw new Error('no page');
      const html = pageHtml(first, found, options);
      expect(html.match(/aria-current="page"/g)).toHaveLength(1);
      expect(html).toContain('<a href="/docs/tutorials/first/" aria-current="page">First</a>');
    });
  });
});

describe('assets', () => {
  it('fail the build for a missing image, naming the page', () => {
    const root = tree({ 'guide/x.md': page('X', '', '![a](./images/x.png)\n') });
    expect(() => docPages(root)).toThrow('docs/guide/x.md: missing image ./images/x.png');
  });

  it('turn an image into a placeholder for a hashed file', () => {
    const root = tree({
      'guide/x.md': page('X', '', '![A plate](./images/x.png)\n'),
      'guide/images/x.png': PNG,
    });
    const [only] = docPages(root);
    expect(only?.html).toMatch(/<img src="__DOCS_FILE_[0-9a-f]{12}-x\.png__" alt="A plate"/);
    expect(only?.assets).toHaveLength(1);
  });

  it('are emitted once when two pages use them', () => {
    const root = tree({
      'guide/a.md': page('A', '', '![x](./images/x.png)\n'),
      'guide/tutorials/b.md': page('B', '', '![x](../images/x.png)\n'),
      'guide/images/x.png': PNG,
    });
    const found = docPages(root);
    expect(found.every((p) => p.assets.length === 1)).toBe(true);
    expect(collectAssets(found)).toHaveLength(1);
  });

  it('refuse a picture that is not a relative file of a known type', () => {
    for (const src of ['https://example.org/x.png', '/x.png', './x.gif']) {
      const root = tree({ 'guide/x.md': page('X', '', `![a](${src})\n`) });
      expect(() => docPages(root), src).toThrow(/docs\/guide\/x\.md: image/);
    }
  });

  it('let a video through with the allowed attributes only', () => {
    const root = tree({
      'guide/x.md': page(
        'X',
        '',
        '<video src="./clip.webm" muted loop autoplay playsinline controls width="320" aria-label="A clip"></video>\n',
      ),
      'guide/clip.webm': PNG,
    });
    const [only] = docPages(root);
    expect(only?.html).toMatch(
      /<video src="__DOCS_FILE_[0-9a-f]{12}-clip\.webm__" muted loop autoplay playsinline controls width="320" aria-label="A clip"><\/video>/,
    );
  });

  it('resolve demo:<tool> to the app\u2019s clip', () => {
    // The demo clips live next to the docs root, in apps/web/public/demos.
    const repo = tree({
      'docs/guide/x.md': page('X', '', '<video src="demo:sketch" muted loop></video>\n'),
      'apps/web/public/demos/sketch.webm': PNG,
    });
    const [only] = docPages(join(repo, 'docs'));
    expect(only?.assets.map((asset) => asset.name)).toEqual(['sketch.webm']);
    const missing = tree({
      'docs/guide/x.md': page('X', '', '<video src="demo:nope" muted></video>\n'),
    });
    expect(() => docPages(join(missing, 'docs'))).toThrow(
      'docs/guide/x.md: missing video demo:nope',
    );
  });

  it('refuse any other raw HTML, so a page never holds a script or a style', () => {
    const cases = [
      '<script>alert(1)</script>',
      '<div style="color:red">hi</div>',
      '<img src="x.png" onerror="x()">',
      '<video src="./clip.webm" onplay="x()"></video>',
      '<video src="./clip.webm" style="width:1px"></video>',
      'inline <b>bold</b> text',
    ];
    for (const html of cases) {
      const root = tree({ 'guide/x.md': page('X', '', `${html}\n`), 'guide/clip.webm': PNG });
      expect(() => docPages(root), html).toThrow(/docs\/guide\/x\.md: /);
    }
  });

  it('drop HTML comments', () => {
    const root = tree({
      'guide/x.md': page('X', '', '<!-- notes -->\n\nText.\n\n<!-- /notes -->\n'),
    });
    expect(docPages(root)[0]?.html).not.toContain('notes');
  });
});
