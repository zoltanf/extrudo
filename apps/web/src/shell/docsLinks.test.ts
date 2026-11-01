import { describe, expect, it } from 'vitest';
import { DOCS_URL, docsPath, docsUrl } from './docsLinks';

describe('docsPath', () => {
  it('gives the top sections their own paths', () => {
    expect(docsPath('guide')).toBe('/');
    expect(docsPath('tutorials')).toBe('/tutorials/');
    expect(docsPath('examples')).toBe('/examples/');
    expect(docsPath('tools')).toBe('/tools/');
  });

  it('gives a tool its generated page', () => {
    expect(docsPath({ tool: 'extrude' })).toBe('/tools/extrude/');
  });

  it('falls back to the tool index for an ID no command has', () => {
    expect(docsPath({ tool: 'plugin:a1:b2' })).toBe('/tools/');
    expect(docsPath({ tool: 'a b' })).toBe('/tools/');
    expect(docsPath({ tool: '' })).toBe('/tools/');
  });

  it('opens a guide page, with or without a section (ADR-0116 §4)', () => {
    expect(docsPath({ guide: 'sketching' })).toBe('/sketching/');
    expect(docsPath({ guide: 'sketching', anchor: 'snap-to-grid' })).toBe(
      '/sketching/#snap-to-grid',
    );
  });

  it('falls back to the guide for a name that is not a slug (ADR-0116 §4)', () => {
    expect(docsPath({ guide: 'Sketching' })).toBe('/');
    expect(docsPath({ guide: '' })).toBe('/');
    expect(docsPath({ guide: 'a b' })).toBe('/');
    expect(docsPath({ guide: '../x' })).toBe('/');
    expect(docsPath({ guide: 'sketching', anchor: 'A b' })).toBe('/');
    expect(docsPath({ guide: 'sketching', anchor: '' })).toBe('/');
    expect(docsPath({ guide: 'sketching', anchor: 'a/b' })).toBe('/');
  });
});

describe('docsUrl', () => {
  it('joins the docs address and the path', () => {
    expect(DOCS_URL).toBe('https://extrudo.org/docs');
    expect(docsUrl('guide')).toBe('https://extrudo.org/docs/');
    expect(docsUrl({ tool: 'extrude' })).toBe('https://extrudo.org/docs/tools/extrude/');
    expect(docsUrl({ guide: 'sketching', anchor: 'face-outline' })).toBe(
      'https://extrudo.org/docs/sketching/#face-outline',
    );
  });
});
