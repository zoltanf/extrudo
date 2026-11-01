/**
 * The API docs pages the site builds (ADR-0068 §6).
 *
 * The pages are read from the repository's own `docs/api/`, so these tests are
 * about what the build will actually publish: every Markdown file becomes a page
 * at the address its links point to, the sidebar is the guide pages then the
 * feature pages by category, and a page carries no script (the site's content
 * policy, ADR-0057) but the one widget module, and only where a widget is
 * (ADR-0116).
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
import { ENHANCERS } from './widgets/enhance';
import { WIDGETS } from './widgets/index';

const allPages = docPages(resolve('docs'), { tokens: { APP_URL: 'https://app.example' } });
/** The API's own pages: their addresses and sidebar are pinned since ADR-0068. */
const pages = allPages.filter((page) => page.collection.dir === 'api');
const options = {
  stylesheet: '/assets/docs-1234.css',
  description: 'The Extrudo document API.',
  siteUrl: '/docs/api/',
  widgetScript: '/assets/docs-widgets-1234.js',
};
const WIDGET_TAG = '<script type="module" src="/assets/docs-widgets-1234.js"></script>';

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
    // One page per feature type (48 since P4-13's meshToSolid) and their index.
    expect(paths.filter((path) => path.startsWith('features/'))).toHaveLength(49);
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
    // Every collection's pages (guide, tutorials, tools, examples and the API),
    // and a /docs/ link has to name a page that exists.
    const known = new Set(allPages.map((page) => page.url));
    for (const page of allPages) {
      for (const [, href] of page.html.matchAll(/href="([^"]*)"/g)) {
        const link = href ?? '';
        // A link into the repository keeps its file: that one is read on GitHub.
        if (/^[a-z][a-z0-9+.-]*:/i.test(link)) {
          expect(link, `${page.file} → ${link}`).toMatch(/^(https|mailto):/);
          continue;
        }
        expect(link, `${page.file} → ${link}`).not.toMatch(/\.md($|#)/);
        if (link.startsWith('/docs/')) {
          expect(known, `${page.file} → ${link}`).toContain(link.replace(/[#?].*$/, ''));
        }
      }
    }
  });

  it('read their title from the front matter, not the file name', () => {
    expect(pageAt('README.md').title).toBe('The API');
    expect(pageAt('sketch.md').title).toBe('Sketches');
    expect(pageAt('references.md').title).toBe('References');
    expect(pageAt('features/extrude.md').title).toBe('Extrude');
  });

  it('read a quoted title without its quotes', () => {
    const title = (url: string) => allPages.find((page) => page.url === url)?.title;
    expect(title('/docs/tutorials/first-part/')).toBe('Your first part: a plate with four holes');
    expect(title('/docs/components/')).toBe('Assemblies: components and joints');
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

/**
 * The page-level assertions the content policy needs (ADR-0057, ADR-0116): no
 * handler, style or script URL, and no script but the widget module, which a page
 * holds exactly once if it has a widget and not at all if it hasn't.
 */
function expectPolicy(html: string, widgets: boolean, where = 'the page'): void {
  const scripts = html.match(/<script\b[^>]*>/gi) ?? [];
  expect(scripts, where).toEqual(widgets ? [WIDGET_TAG.replace('</script>', '')] : []);
  expect(html.split('</script>').length - 1, where).toBe(widgets ? 1 : 0);
  if (widgets) expect(html, where).toContain(WIDGET_TAG);
  expect(html, where).not.toMatch(/\son\w+=/i);
  expect(html, where).not.toMatch(/\sstyle=/i);
  expect(html, where).not.toMatch(/<style/i);
  expect(html, where).not.toMatch(/javascript:/i);
}

describe('a page document', () => {
  const html = pageHtml(pageAt('features/extrude.md'), allPages, options);

  it('carries no script, except the widget module on a page with a widget', () => {
    expectPolicy(html, false);
    for (const every of allPages) {
      expectPolicy(pageHtml(every, allPages, options), every.widgets.length > 0, every.file);
    }
    const sketching = allPages.find((every) => every.url === '/docs/sketching/');
    expect(sketching?.widgets).toEqual([
      'trim',
      'dof-playground',
      'dimension-label',
      'palette-switches',
    ]);
    expect(pageHtml(sketching as DocPage, allPages, options)).toContain(WIDGET_TAG);
    const widgetsOf = (url: string) => allPages.find((every) => every.url === url)?.widgets;
    expect(widgetsOf('/docs/tools/trim/')).toEqual(['trim']);
    expect(widgetsOf('/docs/tools/dimension/')).toEqual(['dimension-label']);
  });

  it('has every section F1 opens, by the ids in docsAnchors.json', () => {
    const anchors: { guide: string; anchor: string }[] = JSON.parse(
      readFileSync(resolve('apps/web/src/shell/docsAnchors.json'), 'utf8'),
    );
    expect(anchors.length).toBeGreaterThan(0);
    for (const { guide, anchor } of anchors) {
      const built = allPages.find((every) => every.url === `/docs/${guide}/`);
      expect(built, guide).toBeDefined();
      expect(built?.html, `${guide}#${anchor}`).toContain(`id="${anchor}"`);
    }
  });

  it('gives every h2 and h3 of every page an id', () => {
    for (const every of allPages) {
      expect(every.html, every.file).not.toMatch(/<h[23]>/);
      const ids = [...every.html.matchAll(/<h[23] id="([^"]*)"/g)].map((match) => match[1]);
      for (const id of ids) expect(id, every.file).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
      expect(new Set(ids).size, every.file).toBe(ids.length);
    }
    const sketching = allPages.find((every) => every.url === '/docs/sketching/');
    expect(sketching?.html).toContain('<h2 id="free-fixed-conflict">');
    expect(sketching?.html).toContain('<h2 id="constraints-you-didn-t-ask-for">');
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

describe('links', () => {
  const built = (href: string) =>
    docPages(tree({ 'guide/x.md': page('X', '', `[go](${href}) and <${href}>\n`) }));

  it('let relative paths, fragments, https, http and mailto through', () => {
    for (const href of [
      './other/',
      '/docs/tools/',
      '#top',
      'https://example.org/a?b=1',
      'http://example.org/',
      'mailto:conduct@extrudo.org',
      'HTTPS://example.org/',
    ]) {
      const [only] = built(href);
      expect(only?.html, href).toContain(`<a href="${href}">`);
    }
  });

  it('fail the build for any other scheme, naming the page and the link', () => {
    for (const href of [
      'javascript:alert(1)',
      'JaVaScRiPt:alert(1)',
      ' javascript:alert(1)',
      'java\tscript:alert(1)',
      '\u0001javascript:alert(1)',
      'data:text/html,<b>x</b>',
      'vbscript:msgbox(1)',
      'file:///etc/passwd',
    ]) {
      const root = tree({ 'guide/x.md': page('X', '', `[go](<${href}>)\n`) });
      expect(() => docPages(root), href).toThrow(
        `docs/guide/x.md: link scheme not allowed: ${href}`,
      );
    }
  });

  it('fail the build for a hostile autolink or reference link', () => {
    for (const body of ['<javascript:alert(1)>', '[go][a]\n\n[a]: vbscript:x']) {
      const root = tree({ 'guide/x.md': page('X', '', `${body}\n`) });
      expect(() => docPages(root), body).toThrow(/link scheme not allowed/);
    }
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

  it('refuse a raw tag with an event handler, wherever it sits', () => {
    const cases = [
      '<img src=x onerror=alert(1)>',
      '<img src="x.png" onerror="alert(1)">',
      '<video src="./clip.webm" onplay=alert(1)></video>',
      '<video src="./clip.webm" ONCLICK="x()"></video>',
      '[<img src=x onerror=alert(1)>](/docs/)',
      'text <svg onload=alert(1)> more',
    ];
    for (const body of cases) {
      const root = tree({ 'guide/x.md': page('X', '', `${body}\n`), 'guide/clip.webm': PNG });
      expect(() => docPages(root), body).toThrow(/docs\/guide\/x\.md: /);
    }
  });

  it('refuse link text with HTML in it', () => {
    for (const body of ['[a <b>bold</b>](/docs/)', '[<span onclick=x()>go</span>](/docs/)']) {
      const root = tree({ 'guide/x.md': page('X', '', `${body}\n`) });
      expect(() => docPages(root), body).toThrow(/docs\/guide\/x\.md: raw HTML/);
    }
  });

  it('drop HTML comments', () => {
    const root = tree({
      'guide/x.md': page('X', '', '<!-- notes -->\n\nText.\n\n<!-- /notes -->\n'),
    });
    expect(docPages(root)[0]?.html).not.toContain('notes');
  });
});

describe('heading ids', () => {
  it('are the text in lower case, a repeat numbered', () => {
    const root = tree({
      'guide/x.md': page(
        'X',
        '',
        '# Top\n\n## The sketch palette\n\n### Show `points` & more\n\n## Notes\n\n### Notes\n\n## Notes\n\n#### Deep\n',
      ),
    });
    const html = docPages(root)[0]?.html ?? '';
    expect(html).toContain('<h1>Top</h1>');
    expect(html).toContain('<h2 id="the-sketch-palette">The sketch palette</h2>');
    expect(html).toContain('<h3 id="show-points-more">Show <code>points</code> &amp; more</h3>');
    expect([...html.matchAll(/id="(notes[^"]*)"/g)].map((match) => match[1])).toEqual([
      'notes',
      'notes-2',
      'notes-3',
    ]);
    expect(html).toContain('<h4>Deep</h4>');
  });
});

describe('widgets', () => {
  it('draw the named widget in its starting state, the body its caption', () => {
    const root = tree({
      'guide/x.md': page('X', '', '```widget palette-switches\nFlip one.\n```\n'),
    });
    const [only] = docPages(root);
    expect(only?.widgets).toEqual(['palette-switches']);
    const html = only?.html ?? '';
    expect(html).toContain('<figure class="widget" data-widget="palette-switches">');
    expect(html).toMatch(
      /<svg class="widget-stage" viewBox="0 0 420 240" role="group" aria-label="[^"]+">/,
    );
    expect(html).toContain('class="sk-profile"');
    expect(html.match(/<input type="checkbox"[^>]*>/g)).toHaveLength(5);
    expect(html.match(/<input type="checkbox"[^>]* checked disabled/g)).toHaveLength(5);
    expect(html).toContain('<figcaption>Flip one.</figcaption>');
    expect(html).not.toContain('<pre');
  });

  it('are counted once however often a page uses one', () => {
    const block = '```widget palette-switches\n```\n\n';
    const root = tree({ 'guide/x.md': page('X', '', block + block) });
    const [only] = docPages(root);
    expect(only?.widgets).toEqual(['palette-switches']);
    expect(only?.html).not.toContain('<figcaption>');
  });

  it('fail the build for an unknown name', () => {
    for (const [block, name] of [
      ['```widget nope\nCaption.\n```\n', 'nope'],
      ['```widget\n```\n', ''],
      ['```widget toString\n```\n', 'toString'],
    ]) {
      const root = tree({ 'guide/x.md': page('X', '', block) });
      expect(() => docPages(root), block).toThrow(`docs/guide/x.md: unknown widget "${name}"`);
    }
  });

  it('leave other code blocks alone', () => {
    const root = tree({ 'guide/x.md': page('X', '', '```widgets\nx\n```\n\n```ts\ny\n```\n') });
    const [only] = docPages(root);
    expect(only?.widgets).toEqual([]);
    expect(only?.html.match(/<pre/g)).toHaveLength(2);
  });

  it('each have a script under the same name', () => {
    expect(Object.keys(ENHANCERS).sort()).toEqual(Object.keys(WIDGETS).sort());
  });
});

describe('drawn figures', () => {
  const svg = (inner: string, head = '') =>
    `${head}<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50" width="100" height="50">${inner}</svg>\n`;
  const build = (
    file: string,
    body = '![A plate with a hole](./images/plate.figure.svg "The plate")\n',
  ) => {
    const root = tree({ 'guide/x.md': page('X', '', body), 'guide/images/plate.figure.svg': file });
    return docPages(root)[0];
  };

  it('are inlined in a figure, named by the alt text, captioned by the title', () => {
    const only = build(
      svg(
        '<!-- a note --><g class="sk-free"><rect x="10" y="10" width="80" height="30" fill="none" stroke-width="2"/></g><text class="sk-dim-text" x="50" y="8" text-anchor="middle">60 &amp; &lt;more&gt;</text>',
        '<?xml version="1.0" encoding="UTF-8"?>\n',
      ),
    );
    expect(only?.assets).toEqual([]);
    expect(only?.html).toContain(
      '<figure class="sk-figure"><svg viewBox="0 0 100 50" width="100" height="50" role="img" aria-label="A plate with a hole"><g class="sk-free"><rect x="10" y="10" width="80" height="30" fill="none" stroke-width="2"/></g><text class="sk-dim-text" x="50" y="8" text-anchor="middle">60 &amp; &lt;more&gt;</text></svg><figcaption>The plate</figcaption></figure>',
    );
    expect(only?.html).not.toContain('<p><figure');
    expect(only?.html).not.toContain('a note');
  });

  it('stand in one gallery when two or more come in a row, a lone one stays alone', () => {
    const fig = (n: number) => `![Figure ${n}](./images/plate.figure.svg "Title ${n}")`;
    const count = (html: string, needle: string) => html.split(needle).length - 1;
    const wrapper = '<div class="sk-figures">';
    const run = build(
      svg('<rect x="1" y="1" width="5" height="5"/>'),
      `${fig(1)}\n\n${fig(2)}\n\n${fig(3)}\n`,
    );
    expect(count(run?.html ?? '', wrapper)).toBe(1);
    expect(count(run?.html ?? '', '<figure class="sk-figure">')).toBe(3);
    const lone = build(svg('<rect x="1" y="1" width="5" height="5"/>'), `${fig(1)}\n`);
    expect(lone?.html).not.toContain(wrapper);
    expect(count(lone?.html ?? '', '<figure class="sk-figure">')).toBe(1);
    const split = build(
      svg('<rect x="1" y="1" width="5" height="5"/>'),
      `${fig(1)}\n\nText between.\n\n${fig(2)}\n`,
    );
    expect(split?.html).not.toContain(wrapper);
    expect(count(split?.html ?? '', '<figure class="sk-figure">')).toBe(2);
  });

  it('prefix their ids with the file stem, and the references follow', () => {
    const only = build(
      svg(
        '<defs><marker id="arrow" refX="5" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0L10 5L0 10z"/></marker><symbol id="dot"><circle r="2"/></symbol></defs><line x1="0" y1="0" x2="50" y2="0" marker-end="url(#arrow)" marker-start="none"/><use href="#dot" x="5" y="5"/>',
      ),
    );
    const html = only?.html ?? '';
    expect(html).toContain('<marker id="plate-arrow"');
    expect(html).toContain('marker-end="url(#plate-arrow)" marker-start="none"');
    expect(html).toContain('<symbol id="plate-dot">');
    expect(html).toContain('<use href="#plate-dot" x="5" y="5"/>');
  });

  it('refuse anything outside the allow-list, naming the page, the file and the offender', () => {
    const cases: [string, string][] = [
      [svg('<rect style="fill:red" width="1" height="1"/>'), 'attribute style="fill:red"'],
      [svg('<style>rect { fill: red }</style>'), 'element <style>'],
      [
        svg('<rect width="1" height="1"/>').replace('<svg ', '<svg onload="alert(1)" '),
        'attribute onload="alert(1)"',
      ],
      [svg('<foreignObject width="1" height="1"></foreignObject>'), 'element <foreignObject>'],
      [svg('<script>alert(1)</script>'), 'element <script>'],
      [
        svg('<use href="https://example.org/x.svg#a"/>'),
        'attribute href="https://example.org/x.svg#a"',
      ],
      [svg('<use href="other.svg#a"/>'), 'attribute href="other.svg#a"'],
      [svg('<rect fill="#f00" width="1" height="1"/>'), 'attribute fill="#f00"'],
      [svg('<rect stroke="red" width="1" height="1"/>'), 'attribute stroke="red"'],
      [svg('', '<!DOCTYPE svg [<!ENTITY x "y">]>'), 'a DOCTYPE'],
      [svg('<text><![CDATA[x]]></text>'), 'CDATA'],
      [svg('<?evil x?>'), 'processing instruction'],
      [svg('<text>&#60;</text>'), 'entity &#60;'],
      [svg('<text>&nbsp;</text>'), 'entity &nbsp;'],
      [svg('<use xlink:href="#a"/>'), 'attribute xlink:href'],
      [svg('<line marker-end="url(https://x/y#a)"/>'), 'attribute marker-end'],
      [svg('<rect transform="url(#x)"/>'), 'attribute transform'],
      [svg('<use href="#missing"/>'), '#missing names no element'],
      [svg('<g>loose text</g>'), 'text isn'],
      [svg('<g>'), "</svg> doesn't close <g>"],
      [svg('').replace('</svg>', ''), '<svg> is not closed'],
      [svg('') + svg(''), 'one <svg>'],
      ['<g/>', 'one <svg>'],
    ];
    for (const [file, offender] of cases) {
      expect(() => build(file), file).toThrow(
        'docs/guide/x.md: figure ./images/plate.figure.svg: ',
      );
      expect(() => build(file), file).toThrow(offender);
    }
  });

  it('must be a paragraph of their own', () => {
    expect(() => build(svg(''), 'See ![a](./images/plate.figure.svg) here.\n')).toThrow(
      'docs/guide/x.md: figure ./images/plate.figure.svg must be a paragraph of its own',
    );
  });

  it('leave other SVG pictures as images', () => {
    const root = tree({ 'guide/x.md': page('X', '', '![a](./x.svg)\n'), 'guide/x.svg': svg('') });
    expect(docPages(root)[0]?.html).toMatch(/<img src="__DOCS_FILE_[0-9a-f]{12}-x\.svg__"/);
  });
});
