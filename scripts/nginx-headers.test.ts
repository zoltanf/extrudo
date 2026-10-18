// The Docker image's nginx configuration is generated from `_headers`
// (ADR-0091 §3): the committed files must be what the generator writes now.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { expectedHeaders, nginxConfig } from './nginx-headers.mjs';

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

describe('nginx-headers', () => {
  it('docker/nginx/ matches apps/web/public/_headers', () => {
    const { maps, headers } = nginxConfig(read('apps/web/public/_headers'));
    const message = 'docker/nginx/ is out of date: run `pnpm docker:headers`';
    expect(read('docker/nginx/maps.conf'), message).toBe(maps);
    expect(read('docker/nginx/headers.conf'), message).toBe(headers);
  });

  it('turns a splat rule, an exact rule and `/*` into add_header lines and map keys', () => {
    const { maps, headers } = nginxConfig(
      [
        '/*',
        '  X-Test: a "b"',
        '/x.js',
        '  Cache-Control: no-cache',
        '/assets/*',
        '  Cache-Control: immutable',
      ].join('\n'),
    );
    expect(headers).toContain('add_header X-Test "a \\"b\\"" always;\n');
    expect(headers).toContain('add_header Cache-Control $extrudo_cache_control always;\n');
    expect(maps).toContain('map $uri $extrudo_cache_control {\n  default "";\n');
    expect(maps).toContain('  "/x.js" "no-cache";\n');
    expect(maps).toContain('  "~^/assets/" "immutable";\n');
    expect(maps).not.toContain('X-Test');
  });

  it('lists the headers a path gets', () => {
    const text = ['/*', '  X-A: 1', '/p', '  X-B: 2'].join('\n');
    expect(expectedHeaders(text, '/p')).toEqual(['x-a: 1', 'x-b: 2']);
    expect(expectedHeaders(text, '/q')).toEqual(['x-a: 1']);
  });
});
