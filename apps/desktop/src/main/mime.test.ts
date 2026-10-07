import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { mimeFor, resolveAppPath } from './mime';

describe('the app:// MIME map (ADR-0075 §1)', () => {
  it('names the types the renderer loads, .wasm included', () => {
    expect(mimeFor('/assets/index-abc.js')).toBe('text/javascript; charset=utf-8');
    expect(mimeFor('/assets/extrudo_occt.wasm')).toBe('application/wasm');
    expect(mimeFor('/index.html')).toBe('text/html; charset=utf-8');
    expect(mimeFor('/assets/Inter.woff2')).toBe('font/woff2');
    expect(mimeFor('/logo.svg')).toBe('image/svg+xml');
    expect(mimeFor('/x.unknown')).toBe('application/octet-stream');
  });

  it('maps a URL path under the renderer dist, with index.html for a directory', () => {
    const root = resolve('/app/out/renderer');
    expect(resolveAppPath(root, '/')).toBe(join(root, 'index.html'));
    expect(resolveAppPath(root, '')).toBe(join(root, 'index.html'));
    expect(resolveAppPath(root, '/assets/a.js')).toBe(join(root, 'assets/a.js'));
    expect(resolveAppPath(root, '/assets/')).toBe(join(root, 'assets/index.html'));
  });

  it('refuses a path that climbs out of the dist', () => {
    const root = resolve('/app/out/renderer');
    expect(resolveAppPath(root, '/../../etc/passwd')).toBeUndefined();
    expect(resolveAppPath(root, '/../main/index.cjs')).toBeUndefined();
  });
});
