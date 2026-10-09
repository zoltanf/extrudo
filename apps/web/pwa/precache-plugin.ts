import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import type { Plugin } from 'vite';

/**
 * Files the app never needs offline: the debug pages, the legacy font formats and
 * the tools' demo clips (`demos/`, P3-12: a nicety fetched when a tooltip opens,
 * which the service worker leaves to the network), the host's `_headers` file and
 * the link-preview picture, and the examples' pictures (P6-06 S4, below).
 */
/** Cached by the service worker on first use, not at install (ADR-0071 §4). */
const RUNTIME = /^assets\/openscad-[^/]*\.wasm$/;

/**
 * The example designs (P6-06 S3) are fetched over the network when one opens,
 * not precached — but the template gallery (`home/gallery.ts`) imports three
 * of the same benchmark files, and the templates must open offline, so those
 * three stay on the precache list. The rule below is a list of the fixture
 * files to **keep** (`TEMPLATE_FIXTURES`, the ones gallery.ts imports): every
 * other bundled `benchmarks/` `.extrudo` asset is skipped (the examples' own
 * b1, b3, b6–b10, p4-01).
 */
const TEMPLATE_FIXTURES = ['b2-storage-box', 'b4-box-with-lid', 'b5-pcb-enclosure'];
const EXAMPLE_ASSETS = new RegExp(`^assets/(?!(${TEMPLATE_FIXTURES.join('|')})-)[^/]*\\.extrudo$`);

const SKIPPED = [
  /(^|\/)debug-worker-/,
  /Debug-[^/]*\.js$/,
  /\.woff$/,
  /\.map$/,
  /^demos\//,
  // OpenSCAD's 11 MB WASM (ADR-0071 §4): only a design with a `.scad` import
  // fetches it, and the service worker keeps it then (`RUNTIME`).
  RUNTIME,
  // The example designs (P6-06 S3), except the template gallery's three
  // (`TEMPLATE_ASSETS`) — those are `import`ed by `home/gallery.ts` and the
  // templates open offline.
  EXAMPLE_ASSETS,
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
      const pictures = examplePictureAssets(join(root, '..', '..'), dir);
      const files = listFiles(dir).filter(
        (f) => f !== 'sw.js' && !SKIPPED.some((s) => s.test(f)) && !pictures.has(f),
      );
      // The template fixtures must survive the skip list above (the templates
      // open offline, ADR-0052): a rename in gallery.ts or a new skip rule
      // that catches one fails the build here rather than silently.
      for (const name of TEMPLATE_FIXTURES) {
        if (!files.some((f) => f.startsWith(`assets/${name}-`) && f.endsWith('.extrudo'))) {
          throw new Error(
            `precache: the ${name} fixture isn't in the precache and a template needs it offline`,
          );
        }
      }
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

/**
 * The examples' pictures (P6-06 S4, `docs/guide/images/examples/<id>.png`) are
 * fetched when the More examples… dialog or the examples page shows them, not
 * precached. Vite hashes each one into `assets/` under a name that can match a
 * template thumbnail's (`storage-box`, `box-with-lid`…), so the files are found
 * by their bytes: a built PNG that is byte-for-byte one of the pictures. A
 * picture that is also a template's thumbnail (same bytes: both are the design's
 * own snapshot, ADR-0009's amendment of 2026-10-09) is one built file the
 * templates need offline, so it stays precached.
 */
function examplePictureAssets(repo: string, dir: string): Set<string> {
  const picturesDir = join(repo, 'docs', 'guide', 'images', 'examples');
  if (!existsSync(picturesDir)) return new Set();
  const pngs = (d: string) =>
    existsSync(d)
      ? readdirSync(d)
          .filter((name) => name.endsWith('.png'))
          .map((name) => readFileSync(join(d, name)))
      : [];
  const thumbnails = pngs(join(repo, 'apps', 'web', 'src', 'home', 'templates'));
  const pictures = pngs(picturesDir).filter((p) => !thumbnails.some((t) => t.equals(p)));
  const out = new Set<string>();
  for (const f of listFiles(dir)) {
    if (!f.startsWith('assets/') || !f.endsWith('.png')) continue;
    const bytes = readFileSync(join(dir, f));
    if (pictures.some((p) => p.equals(bytes))) out.add(f);
  }
  return out;
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
