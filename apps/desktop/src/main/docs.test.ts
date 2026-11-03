import { describe, expect, it } from 'vitest';
import { createDocs, DOCS_URL } from './docs';

describe('docs', () => {
  it('opens an accepted path at the docs address', () => {
    const opened: string[] = [];
    const docs = createDocs((url) => opened.push(url));
    docs.open('/');
    docs.open('/tools/extrude/');
    expect(opened).toEqual([
      'https://extrudo.org/docs/',
      'https://extrudo.org/docs/tools/extrude/',
    ]);
    expect(DOCS_URL).toBe('https://extrudo.org/docs');
  });

  it('opens every docsPath result', () => {
    const opened: string[] = [];
    const docs = createDocs((url) => opened.push(url));
    docs.open('/tutorials/');
    docs.open('/examples/');
    docs.open('/tools/');
    docs.open('/tools/a1/');
    expect(opened).toEqual([
      'https://extrudo.org/docs/tutorials/',
      'https://extrudo.org/docs/examples/',
      'https://extrudo.org/docs/tools/',
      'https://extrudo.org/docs/tools/a1/',
    ]);
  });

  it('opens a guide page, with or without a section (P6-22 S2, ADR-0116 §4)', () => {
    const opened: string[] = [];
    const docs = createDocs((url) => opened.push(url));
    docs.open('/sketching/');
    docs.open('/sketching/#face-outline');
    expect(opened).toEqual([
      'https://extrudo.org/docs/sketching/',
      'https://extrudo.org/docs/sketching/#face-outline',
    ]);
  });

  it('opens nothing for a guide path outside the whitelist', () => {
    const opened: string[] = [];
    const docs = createDocs((url) => opened.push(url));
    for (const path of [
      '/sketching/../x',
      '/Sketching/',
      '/sketching/#a b',
      '/sketching#face-outline',
      '/sketching/#',
      'javascript:',
    ]) {
      docs.open(path);
    }
    expect(opened).toEqual([]);
  });

  it('opens the source by name, nothing else', () => {
    const opened: string[] = [];
    const docs = createDocs((url) => opened.push(url));
    docs.openSite('repo');
    for (const link of [
      'about',
      'toString',
      '__proto__',
      'https://evil.example.org/',
      undefined,
      42,
    ]) {
      docs.openSite(link);
    }
    expect(opened).toEqual(['https://github.com/zoltanf/extrudo']);
  });

  it('opens nothing for what is not a whitelisted path', () => {
    const opened: string[] = [];
    const docs = createDocs((url) => opened.push(url));
    for (const path of [
      '../',
      'https://evil.example.org/docs/',
      '/tools/a b/',
      undefined,
      42,
      '',
    ]) {
      docs.open(path);
    }
    expect(opened).toEqual([]);
  });
});
