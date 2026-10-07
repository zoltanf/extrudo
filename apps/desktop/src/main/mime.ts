/**
 * The `app://` URL rules (P6-01, ADR-0075 §1): the MIME type of each packaged
 * renderer file and where a URL path lands under the build's `dist`. Kept free
 * of Electron so the MIME map is unit-tested without a binary; the protocol
 * handler that uses it lives in `protocol.ts`.
 */
import { extname, join, resolve, sep } from 'node:path';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.cjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.webm': 'video/webm',
  '.mp4': 'video/mp4',
  '.txt': 'text/plain; charset=utf-8',
};

export function mimeFor(path: string): string {
  return TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream';
}

/**
 * The file a URL path means under `root`: `app://bundle/` and any directory
 * path land on `index.html` (hash routing keeps one document); a path trying
 * to climb out of `root` is refused. The result is absolute.
 */
export function resolveAppPath(root: string, pathname: string): string | undefined {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    // A malformed escape (`%zz`): not a path we can serve, so 404 rather than
    // throwing out of the protocol handler (P6-01's review).
    return undefined;
  }
  // Refuse anything trying to climb out before normalising it away.
  if (decoded.split(/[/\\]/).includes('..')) return undefined;
  const directory = decoded === '' || decoded.endsWith('/') || decoded.endsWith('\\');
  const clean = decoded.replace(/^[/\\]+/, '');
  const target = resolve(root, directory ? join(clean, 'index.html') : clean);
  const base = resolve(root);
  if (target !== base && !target.startsWith(base + sep)) return undefined;
  return target;
}
