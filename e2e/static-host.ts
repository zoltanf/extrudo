import { readFileSync, statSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { extname, join, normalize } from 'node:path';
import { headersFor, parseHeaders } from '../apps/web/pwa/headers';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.webm': 'video/webm',
  '.woff2': 'font/woff2',
};

export interface StaticHost {
  /** `http://127.0.0.1:<port>`, no trailing slash. */
  url: string;
  /**
   * Serves `body` at `path` from now on instead of the file (a new service worker,
   * a page with a tag injected into it). The content type comes from the path's
   * extension, so pass it for a path like `/` that has none.
   */
  override(path: string, body: string, contentType?: string): void;
  /** Serves another build folder from now on, with its own `_headers` (a site replacing the app). */
  serve(dir: string): void;
  close(): Promise<void>;
}

/**
 * A static host for a build folder that behaves like Cloudflare Pages
 * (ADR-0054): it applies the build's own `_headers` file, redirects `.html`
 * paths as Pages does (`/index.html` → `/`, 308) and falls back to
 * `index.html` for unknown paths. The e2e tests use it where `vite preview`
 * isn't enough: path-specific headers (`/sw.js` revalidates) and serving a
 * changed service worker to test the update toast.
 */
export async function startStaticHost(initial: string): Promise<StaticHost> {
  let dir = initial;
  let rules = parseHeaders(readFileSync(join(dir, '_headers'), 'utf8'));
  const overrides = new Map<string, { body: string; contentType?: string }>();
  const server: Server = createServer((req, res) => {
    const path = decodeURIComponent((req.url ?? '/').split('?')[0] ?? '/');
    const headers = headersFor(rules, path);
    // Pages drops `.html` and `index.html` from paths with a 308 (ADR-0054 amendment).
    if (path.endsWith('.html')) {
      const location = path.replace(/(index)?\.html$/, '');
      res.writeHead(308, { ...headers, location: location || '/' });
      res.end();
      return;
    }
    const override = overrides.get(path);
    if (override !== undefined) {
      res.writeHead(200, {
        ...headers,
        'content-type': override.contentType ?? TYPES[extname(path)] ?? 'text/plain',
      });
      res.end(override.body);
      return;
    }
    // Never leave `dir`.
    let file = join(dir, normalize(path).replace(/^(\.\.[/\\])+/, ''));
    try {
      if (statSync(file).isDirectory()) file = join(file, 'index.html');
    } catch {
      file = join(dir, 'index.html');
    }
    try {
      const body = readFileSync(file);
      res.writeHead(200, {
        ...headers,
        'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
      });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end('not found');
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    override: (path, body, contentType) => void overrides.set(path, { body, contentType }),
    serve: (next) => {
      dir = next;
      rules = parseHeaders(readFileSync(join(dir, '_headers'), 'utf8'));
      overrides.clear();
    },
    close: () =>
      new Promise<void>((resolve) => {
        // A page that navigated away can leave an idle keep-alive socket, and
        // `server.close` waits for it: drop the connections so teardown is quick.
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
