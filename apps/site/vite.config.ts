import { defineConfig, type Plugin } from 'vite';
import { addresses } from './addresses';
import { docsPlugin } from './src/docs-plugin';

// The landing page (ADR-0057): one static page. `__SITE_URL__`, `__APP_URL__`,
// `__EDGE_URL__` and `__CONTACT_EMAIL__` in index.html become the build's addresses
// (env overrides, see addresses.ts); the script reads the same values through `define`.
const urls = addresses(process.env);

function addressPlugin(): Plugin {
  return {
    name: 'extrudo-site-addresses',
    transformIndexHtml: (html) =>
      html
        .replaceAll('__SITE_URL__', urls.SITE_URL)
        .replaceAll('__APP_URL__', urls.APP_URL)
        .replaceAll('__EDGE_URL__', urls.EDGE_URL)
        .replaceAll('__CONTACT_EMAIL__', urls.CONTACT_EMAIL),
  };
}

export default defineConfig({
  // The API docs (ADR-0068 §6): `docs/api/**/*.md` becomes static pages under
  // `/docs/api/` while the site is built, with no script in them.
  plugins: [addressPlugin(), docsPlugin()],
  define: { __APP_URL__: JSON.stringify(urls.APP_URL) },
  // No data: URLs: the content policy allows fonts and images from this origin only.
  build: { target: 'es2022', assetsInlineLimit: 0 },
});
