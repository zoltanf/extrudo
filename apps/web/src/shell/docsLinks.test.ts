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
});

describe('docsUrl', () => {
  it('joins the docs address and the path', () => {
    expect(DOCS_URL).toBe('https://extrudo.org/docs');
    expect(docsUrl('guide')).toBe('https://extrudo.org/docs/');
    expect(docsUrl({ tool: 'extrude' })).toBe('https://extrudo.org/docs/tools/extrude/');
  });
});
