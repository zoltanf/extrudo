import { describe, expect, it } from 'vitest';
import { ABOUT_LINKS } from '../../../web/src/shell/aboutLinks';
import { createLinks } from './links';

function run(...urls: unknown[]): string[] {
  const opened: string[] = [];
  const links = createLinks((url) => opened.push(url));
  for (const url of urls) links.open(url);
  return opened;
}

describe('links', () => {
  it('opens the site, the repository and its sub-paths', () => {
    const urls = [
      'https://extrudo.org',
      'https://extrudo.org/docs/tools/',
      'https://github.com/zoltanf/extrudo',
      'https://github.com/zoltanf/extrudo/commit/abc',
      'https://github.com/zoltanf/extrudo/blob/main/NOTICE',
    ];
    expect(run(...urls)).toEqual(urls);
  });

  it('opens every URL the About dialog links to', () => {
    expect(ABOUT_LINKS.length).toBeGreaterThan(8);
    expect(run(...ABOUT_LINKS)).toEqual([...ABOUT_LINKS]);
  });

  it('refuses http, other hosts, lookalike paths, credentials, ports and non-strings', () => {
    expect(
      run(
        'http://extrudo.org/',
        'https://evil.example/zoltanf/extrudo',
        'https://extrudo.org.evil.example/',
        'https://github.com/zoltanf/extrudo-evil',
        'https://github.com/zoltanf/extrudo/../other',
        'https://github.com/zoltanf',
        'https://user:pw@extrudo.org/',
        'https://extrudo.org:8443/',
        'javascript:alert(1)',
        'not a url',
        42,
        undefined,
        { href: 'https://extrudo.org/' },
      ),
    ).toEqual([]);
  });
});
