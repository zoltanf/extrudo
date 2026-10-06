import { readFileSync } from 'node:fs';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { parseHeaders } from './pwa/headers.ts';
import { precachePlugin } from './pwa/precache-plugin.ts';
import { sitePlugin } from './pwa/site.ts';

// The live site's global headers (COOP/COEP, CSP…; public/_headers, ADR-0054) also apply to
// `vite preview`, which the e2e suite serves: every test runs under the same policy as production.
const globalHeaders = parseHeaders(
  readFileSync(new URL('./public/_headers', import.meta.url), 'utf8'),
).find((rule) => rule.pattern === '/*');

export default defineConfig({
  // Relative asset URLs so the same build loads from file:// inside Electron.
  base: './',
  plugins: [react(), tailwindcss(), sitePlugin(), precachePlugin()],
  preview: {
    headers: Object.fromEntries(globalHeaders?.headers.map((h) => [h.name, h.value]) ?? []),
  },
  // Module workers (every worker is started with `type: 'module'`), so a
  // worker's dynamic imports stay chunks of their own: the kernel worker loads
  // the script runner (QuickJS's glue, sucrase, the document API) only for a
  // design with a script (P5-02, ADR-0070 §2), and opentype.js only for text.
  worker: { format: 'es' },
  build: {
    // The main chunk holds three.js's core (~380 kB), since the viewport store
    // uses its math and three.core doesn't tree-shake. The R3F viewport itself
    // is a lazy chunk (P0-05, ADR-0008).
    chunkSizeWarningLimit: 1000,
  },
});
