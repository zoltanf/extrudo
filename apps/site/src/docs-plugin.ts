/**
 * The build step that turns every Markdown file under the docs collections into the site
 * `/docs/` pages (ADR-0068 §6, ADR-0080).
 *
 * Everything happens while the site is built: the Markdown becomes HTML, the
 * stylesheet and the two font faces are emitted with hashed names (so the
 * site's `_headers` can serve them for good), and each page is written where the
 * host will find it. No script ends up in a docs page — the site's content
 * policy allows none (ADR-0057) and the pages need none.
 *
 * The pages themselves are built by `docs.ts`, which has no Vite in it and is
 * unit-tested on its own.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';
import { addresses } from '../addresses';
import {
  assetPlaceholder,
  collectAssets,
  type DocPage,
  docPages,
  pageHtml,
  stylesheet,
} from './docs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SITE = dirname(HERE);
/** The repository root, two levels up from `apps/site`. */
const ROOT = dirname(dirname(SITE));

/** Where the Markdown lives; `docs.ts`' collections say where each folder is published. */
const DOCS_DIR = join(ROOT, 'docs');

/** The one-liner every page's description carries (the site's own, ADR-0057). */
const DESCRIPTION =
  'Extrudo docs: guides, tutorials, the tool reference and the document API for parametric CAD in the browser.';

/** The bundled font the brand sets its UI in (docs/05-brand.md §4). */
const FACES = [
  { file: 'instrument-sans-latin-400-normal.woff2', weight: 400 },
  { file: 'instrument-sans-latin-600-normal.woff2', weight: 600 },
] as const;

/** The docs pages, built from the repository's Markdown. */
export function docsPlugin(): Plugin {
  /** Placeholder → the emitted file's reference. */
  const files = new Map<string, string>();
  return {
    name: 'extrudo-site-docs',
    apply: 'build',
    // The pages are assets, so they are collected before the bundle is written.
    async buildStart() {
      const urls = addresses(process.env);
      let pages: DocPage[];
      try {
        // A missing picture or a stray tag fails here, naming the page.
        pages = docPages(DOCS_DIR, { tokens: urls });
      } catch (error) {
        return this.error(error instanceof Error ? error.message : String(error));
      }
      if (pages.length === 0) this.error(`No Markdown under ${DOCS_DIR}.`);

      // Each picture and clip once, however many pages use it; rollup puts a
      // content hash in the file name and `generateBundle` fills it in.
      for (const asset of collectAssets(pages)) {
        files.set(
          assetPlaceholder(asset),
          this.emitFile({ type: 'asset', name: asset.name, source: readFileSync(asset.file) }),
        );
      }

      // The stylesheet first: the HTML needs its hashed name, and the names are
      // known as soon as the assets are emitted (resolve in generateBundle).
      const tokens = readFileSync(join(SITE, 'src/tokens.css'), 'utf8');
      const rules = readFileSync(join(SITE, 'src/docs.css'), 'utf8');
      const faces = FACES.map((face) => {
        const bytes = readFileSync(
          join(SITE, 'node_modules/@fontsource/instrument-sans/files', face.file),
        );
        const url = `__DOCS_ASSET_${face.file}__`;
        this.emitFile({ type: 'asset', name: face.file, source: bytes });
        return `@font-face {\n  font-family: 'Instrument Sans';\n  font-style: normal;\n  font-display: swap;\n  font-weight: ${face.weight};\n  src: url(${url}) format('woff2');\n}`;
      });
      this.emitFile({
        type: 'asset',
        name: 'docs.css',
        source: stylesheet(tokens, rules, faces),
      });

      for (const page of pages) {
        this.emitFile({
          type: 'asset',
          fileName: fileNameFor(page),
          source: pageHtml(page, pages, {
            stylesheet: '__DOCS_ASSET_docs.css__',
            description: DESCRIPTION,
            siteUrl: '/docs/',
          }),
        });
      }
    },

    // Hashed names are settled here; the HTML points at them by placeholder.
    generateBundle(_options, bundle) {
      const names = new Map<string, string>();
      for (const output of Object.values(bundle)) {
        if (output.type === 'asset') names.set(output.name ?? '', `/${output.fileName}`);
      }
      for (const output of Object.values(bundle)) {
        if (output.type !== 'asset' || !output.fileName.endsWith('/index.html')) continue;
        let html = output.source as string;
        for (const [placeholder, reference] of files) {
          html = html.replaceAll(placeholder, `/${this.getFileName(reference)}`);
        }
        for (const [name, url] of names) {
          html = html.replaceAll(`__DOCS_ASSET_${name}__`, url);
        }
        output.source = html;
      }
    },
  };
}

/** A page is a directory of its own: `/docs/api/sketch/` is `docs/api/sketch/index.html`. */
function fileNameFor(page: DocPage): string {
  return `${page.url.replace(/^\//, '')}index.html`;
}
