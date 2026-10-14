import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { FOOTER, header, pageOf, SPRITE, withPartials } from './partials';

const SITE = dirname(dirname(fileURLToPath(import.meta.url)));
const PAGES = {
  home: 'index.html',
  features: 'features/index.html',
  download: 'download/index.html',
} as const;
const MARKERS = ['<!-- site:sprite -->', '<!-- site:header -->', '<!-- site:footer -->'];

describe('the shared pieces of the site', () => {
  it.each(Object.entries(PAGES))('%s page carries each marker once', (_, file) => {
    const html = readFileSync(join(SITE, file), 'utf8');
    for (const marker of MARKERS) expect(html.split(marker)).toHaveLength(2);
  });

  it('writes the sprite, header and footer in place of the markers', () => {
    const html = withPartials(MARKERS.join('\n'), 'home');
    expect(html).toBe([SPRITE, header('home'), FOOTER].join('\n'));
    expect(html).not.toContain('<!-- site:');
  });

  it('knows each page by its path', () => {
    expect(pageOf('/index.html')).toBe('home');
    expect(pageOf('/features/index.html')).toBe('features');
    expect(pageOf('/download/index.html')).toBe('download');
  });

  it('marks the current page in the nav', () => {
    expect(header('home')).not.toContain('aria-current');
    expect(header('features')).toContain('<a href="/features/" aria-current="page">Features</a>');
    expect(header('features').split('aria-current')).toHaveLength(2);
    expect(header('download')).toContain('<a href="/download/" aria-current="page">Apps');
    expect(header('download').split('aria-current')).toHaveLength(2);
  });

  it('lists Apps, with its New pill, before Features', () => {
    const html = header('home');
    expect(html).toContain('<a href="/download/">Apps <b class="new">New</b></a>');
    expect(html.indexOf('>Apps')).toBeLessThan(html.indexOf('>Features'));
  });

  it('keeps the address placeholders for the address plugin to fill in', () => {
    expect(header('home')).toContain('href="__APP_URL__/"');
    expect(FOOTER).toContain('mailto:__CONTACT_EMAIL__');
  });
});
