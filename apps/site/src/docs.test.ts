/**
 * The API docs pages the site builds (ADR-0068 §6).
 *
 * The pages are read from the repository's own `docs/api/`, so these tests are
 * about what the build will actually publish: every Markdown file becomes a page
 * at the address its links point to, the sidebar is the guide pages then the
 * feature pages by category, and a page carries no script (the site's content
 * policy allows none, ADR-0057).
 */
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { type DocPage, docPages, pageHtml, sidebar, stylesheet } from './docs';

const DOCS = resolve('docs/api');
const pages = docPages(DOCS);
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
      'references.md',
      'scripts.md',
      'sketch.md',
    ]);
    expect(paths).toContain('features/README.md');
    // One page per feature type (41 since P5-02's `script`) and their index.
    expect(paths.filter((path) => path.startsWith('features/'))).toHaveLength(42);
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
  const groups = sidebar(pages);

  it('leads with the guide pages, in their own order', () => {
    expect(groups[0]).toEqual({
      title: 'Getting started',
      entries: [
        { title: 'The API', url: '/docs/api/' },
        { title: 'Sketches', url: '/docs/api/sketch/' },
        { title: 'References', url: '/docs/api/references/' },
        { title: 'Scripts', url: '/docs/api/scripts/' },
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
  const html = pageHtml(pageAt('features/extrude.md'), pages, options);

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
    expect(html).toContain('<nav class="side" aria-label="API docs" tabindex="0">');
    expect(html).toContain('<a href="/docs/api/features/extrude/" aria-current="page">Extrude</a>');
    expect(html).toContain('<a class="skip" href="#main">Skip to content</a>');
    expect(html).toContain('<main id="main" class="page">');
  });

  it('goes back to the landing page', () => {
    expect(html).toContain('<a href="/">Extrudo</a>');
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
