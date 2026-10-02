import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SITE_URL, siteUrl } from './site';

describe('site URL', () => {
  it('defaults to the project domain', () => {
    expect(siteUrl(undefined)).toBe(DEFAULT_SITE_URL);
    expect(siteUrl('')).toBe(DEFAULT_SITE_URL);
    expect(DEFAULT_SITE_URL).toBe('https://extrudo.org');
  });

  it('takes a custom domain and drops a trailing slash', () => {
    expect(siteUrl('https://example.org/')).toBe('https://example.org');
    expect(siteUrl(' https://example.org/app/ ')).toBe('https://example.org/app');
  });

  it('refuses what is not an http(s) URL', () => {
    expect(() => siteUrl('example.org')).toThrow(/full URL/);
    expect(() => siteUrl('ftp://example.org')).toThrow(/http/);
  });

  it('is the only place the page names its address (index.html has only the token)', () => {
    const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    expect(html).toContain('<link rel="canonical" href="__SITE_URL__/" />');
    expect(html).toContain('og:image" content="__SITE_URL__/og-image.png"');
    expect(html).not.toMatch(/https?:\/\//);
  });
});
