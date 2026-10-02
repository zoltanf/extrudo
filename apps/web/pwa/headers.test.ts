import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { headersFor, matches, parseHeaders } from './headers';

const file = parseHeaders(readFileSync(new URL('../public/_headers', import.meta.url), 'utf8'));

describe('_headers parser', () => {
  it('reads patterns, comments and indented headers', () => {
    const rules = parseHeaders('# c\n/a\n  X-One: 1\n  X-Two: a: b\n\n/b/*\n  X-Three: 3\n');
    expect(rules).toEqual([
      {
        pattern: '/a',
        headers: [
          { name: 'X-One', value: '1' },
          { name: 'X-Two', value: 'a: b' },
        ],
      },
      { pattern: '/b/*', headers: [{ name: 'X-Three', value: '3' }] },
    ]);
  });

  it('refuses a header before any pattern', () => {
    expect(() => parseHeaders('  X-One: 1\n')).toThrow(/outside a rule/);
  });

  it('matches exact paths and trailing splats', () => {
    expect(matches('/sw.js', '/sw.js')).toBe(true);
    expect(matches('/sw.js', '/sw.js.map')).toBe(false);
    expect(matches('/assets/*', '/assets/a-1.js')).toBe(true);
    expect(matches('/assets/*', '/assetsx')).toBe(false);
    expect(matches('/*', '/anything/at/all')).toBe(true);
  });

  it('joins a header set by two matching rules, like the host', () => {
    const rules = parseHeaders('/*\n  X-A: 1\n/x\n  X-A: 2\n');
    expect(headersFor(rules, '/x')).toEqual({ 'x-a': '1, 2' });
    expect(headersFor(rules, '/y')).toEqual({ 'x-a': '1' });
  });
});

describe('the hosted app headers (public/_headers, ADR-0054)', () => {
  it('isolates every response: COOP same-origin, COEP require-corp', () => {
    for (const path of ['/', '/index.html', '/sw.js', '/assets/worker-abc.js', '/demos/a.webm']) {
      const h = headersFor(file, path);
      expect(h['cross-origin-opener-policy']).toBe('same-origin');
      expect(h['cross-origin-embedder-policy']).toBe('require-corp');
      expect(h['x-content-type-options']).toBe('nosniff');
      expect(h['referrer-policy']).toBeTruthy();
    }
  });

  it('revalidates the shell and the service worker, and caches hashed assets for good', () => {
    for (const path of ['/', '/index.html', '/sw.js', '/manifest.webmanifest']) {
      expect(headersFor(file, path)['cache-control']).toBe('no-cache');
    }
    expect(headersFor(file, '/assets/index-abc123.js')['cache-control']).toBe(
      'public, max-age=31536000, immutable',
    );
  });

  it('gives no path two Cache-Control rules (the host would join them into nonsense)', () => {
    for (const path of ['/', '/index.html', '/sw.js', '/manifest.webmanifest', '/assets/x.js']) {
      expect(headersFor(file, path)['cache-control']).not.toContain(',no-cache');
      expect(headersFor(file, path)['cache-control']?.split(', no-cache')).toHaveLength(1);
    }
    const cacheRules = file.filter((r) => r.headers.some((h) => /^cache-control$/i.test(h.name)));
    expect(cacheRules.length).toBeGreaterThan(0);
    for (const path of ['/', '/index.html', '/sw.js', '/manifest.webmanifest', '/assets/x.js']) {
      expect(cacheRules.filter((r) => matches(r.pattern, path))).toHaveLength(1);
    }
  });

  it('has a content policy: own origin only, no inline script, eval only for the embind glue', () => {
    const csp = headersFor(file, '/')['content-security-policy'] ?? '';
    // One policy for every path (two joined policies would both apply: the stricter wins).
    for (const path of ['/index.html', '/assets/worker-abc.js', '/sw.js']) {
      expect(headersFor(file, path)['content-security-policy']).toBe(csp);
    }
    const directive = (name: string) =>
      csp
        .split(';')
        .map((d) => d.trim())
        .find((d) => d.startsWith(`${name} `));
    expect(directive('default-src')).toBe("default-src 'self'");
    // Scripts: this origin, WASM, and eval (embind's `new Function`: ADR-0054's open item),
    // never inline.
    expect(directive('script-src')).toBe("script-src 'self' 'wasm-unsafe-eval' 'unsafe-eval'");
    expect(directive('worker-src')).toContain("'self'");
    expect(directive('object-src')).toBe("object-src 'none'");
    expect(directive('frame-ancestors')).toBe("frame-ancestors 'none'");
    // No third-party origin anywhere: the app loads nothing from other hosts.
    expect(csp).not.toMatch(/https?:\/\//);
  });
});
