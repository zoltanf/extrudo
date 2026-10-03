import { defineConfig, type Plugin } from 'vite';
import { addresses } from './addresses';

// The landing page (ADR-0057): one static page. `__SITE_URL__`, `__APP_URL__` and
// `__EDGE_URL__` in index.html become the build's addresses (env overrides, see
// addresses.ts); the script reads the same values through `define`.
const urls = addresses(process.env);

function addressPlugin(): Plugin {
  return {
    name: 'extrudo-site-addresses',
    transformIndexHtml: (html) =>
      html
        .replaceAll('__SITE_URL__', urls.SITE_URL)
        .replaceAll('__APP_URL__', urls.APP_URL)
        .replaceAll('__EDGE_URL__', urls.EDGE_URL),
  };
}

export default defineConfig({
  plugins: [addressPlugin()],
  define: { __APP_URL__: JSON.stringify(urls.APP_URL) },
  // No data: URLs: the content policy allows fonts and images from this origin only.
  build: { target: 'es2022', assetsInlineLimit: 0 },
});
