/**
 * Serving the packaged renderer over `app://` (P6-01, ADR-0075 §1). `file://`
 * has no real origin, so a module worker's relative import and a WASM `fetch`
 * fail; a privileged standard scheme gives the renderer an origin while every
 * byte still comes from the build's `dist`. `protocol.registerSchemesAsPrivileged`
 * must run before `app.whenReady()`; `protocol.handle` then answers requests.
 */
import { readFile } from 'node:fs/promises';
import { protocol } from 'electron';
import { HEADERS } from './headers';
import { mimeFor, resolveAppPath } from './mime';

export const APP_SCHEME = 'app';
export const APP_URL = `${APP_SCHEME}://bundle/`;

export function registerAppScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: APP_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
        corsEnabled: true,
      },
    },
  ]);
}

/** Answers `app://bundle/…` from `root` (the renderer build's directory). */
export function handleAppProtocol(root: string): void {
  protocol.handle(APP_SCHEME, async (request) => {
    const url = new URL(request.url);
    const path = resolveAppPath(root, url.pathname);
    if (!path)
      return new Response('Not found', {
        status: 404,
        headers: { ...HEADERS, 'content-type': 'text/plain' },
      });
    try {
      const body = await readFile(path);
      return new Response(body, { headers: { ...HEADERS, 'content-type': mimeFor(path) } });
    } catch {
      return new Response('Not found', {
        status: 404,
        headers: { ...HEADERS, 'content-type': 'text/plain' },
      });
    }
  });
}
