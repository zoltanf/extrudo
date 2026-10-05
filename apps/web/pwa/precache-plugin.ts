import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import type { Plugin } from 'vite';

/**
 * Files the app never needs offline: the debug pages, the legacy font formats and
 * the tools' demo clips (`demos/`, P3-12: a nicety fetched when a tooltip opens,
 * which the service worker leaves to the network), the host's `_headers` file and
 * the link-preview picture.
 */
/** Cached by the service worker on first use, not at install (ADR-0071 §4). */
const RUNTIME = /^assets\/openscad-[^/]*\.wasm$/;

const SKIPPED = [
  /(^|\/)debug-worker-/,
  /Debug-[^/]*\.js$/,
  /\.woff$/,
  /\.map$/,
  /^demos\//,
  // OpenSCAD's 11 MB WASM (ADR-0071 §4): only a design with a `.scad` import
  // fetches it, and the service worker keeps it then (`RUNTIME`).
  RUNTIME,
  // For the host and for link previews (ADR-0054), never for the app itself.
  /^_headers$/,
  /^og-image\.png$/,
];

/**
 * Writes `sw.js` into the build output (ADR-0037): the service worker from
 * `pwa/sw.js` with the list of everything the build made. `assets/` files carry
 * a content hash in their name; the rest (index.html, icons, the manifest) are
 * fetched again at every install. The version hashes every listed file, so any
 * change to the app changes `sw.js` and the browser installs an update.
 */
export function precachePlugin(): Plugin {
  let outDir = 'dist';
  let root = process.cwd();
  return {
    name: 'extrudo-precache',
    apply: 'build',
    enforce: 'post',
    configResolved(config) {
      outDir = config.build.outDir;
      root = config.root;
    },
    closeBundle() {
      const dir = join(root, outDir);
      const files = listFiles(dir).filter((f) => f !== 'sw.js' && !SKIPPED.some((s) => s.test(f)));
      const hashed = files.filter((f) => f.startsWith('assets/'));
      const fixed = files.filter((f) => !f.startsWith('assets/'));
      const version = createHash('sha256');
      for (const f of files) version.update(f).update(readFileSync(join(dir, f)));
      const source = readFileSync(join(root, 'pwa/sw.js'), 'utf8')
        .replace('__VERSION__', version.digest('hex').slice(0, 12))
        .replace(
          '/*__HASHED__*/ []',
          JSON.stringify(
            hashed.map((f) => `./${f}`),
            null,
            2,
          ),
        )
        .replace(
          '/*__RUNTIME__*/ []',
          JSON.stringify(
            listFiles(dir)
              .filter((f) => RUNTIME.test(f))
              .map((f) => `./${f}`),
          ),
        )
        .replace(
          '/*__FIXED__*/ []',
          JSON.stringify(
            fixed.map((f) => `./${f}`),
            null,
            2,
          ),
        );
      writeFileSync(join(dir, 'sw.js'), source);
    },
  };
}

function listFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const path = join(d, entry.name);
      if (entry.isDirectory()) walk(path);
      else out.push(relative(dir, path).split(sep).join('/'));
    }
  };
  walk(dir);
  return out.sort();
}
