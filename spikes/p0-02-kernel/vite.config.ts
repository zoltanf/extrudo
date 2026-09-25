import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  // The Emscripten glue files locate themselves via import.meta.url; keep
  // them out of dependency pre-bundling so that keeps working in dev.
  optimizeDeps: { exclude: ['libcascade', 'replicad-opencascadejs', 'occt-wasm', 'brepjs', 'replicad'] },
  worker: { format: 'es' },
  build: { target: 'es2024', chunkSizeWarningLimit: 10_000 },
  server: { host: '127.0.0.1', port: 5174, strictPort: true },
  preview: { host: '127.0.0.1', port: 5175, strictPort: true },
});
