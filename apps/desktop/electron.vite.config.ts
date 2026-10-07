import { resolve } from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';

/**
 * The Electron build (P6-01, ADR-0075 §1). Main and preload are CommonJS
 * (`"type": "module"` is for the sources; a sandboxed preload cannot be ESM),
 * and the renderer is the web app rebuilt from its own source with the desktop
 * entry. Nothing is externalised: every workspace package is TypeScript source
 * that has to be bundled, and `electron` is external by default.
 */
export default defineConfig({
  main: {
    build: {
      // Every package is bundled (they are devDependencies: the installer
      // carries no node_modules). With the default, electron-vite externalises
      // by the package's `dependencies` and `electron` itself was inlined.
      externalizeDeps: false,
      outDir: 'out/main',
      rollupOptions: {
        external: ['electron', /^electron\/.+/],
        output: { format: 'cjs', entryFileNames: '[name].cjs' },
      },
    },
  },
  preload: {
    build: {
      externalizeDeps: false,
      outDir: 'out/preload',
      rollupOptions: {
        external: ['electron', /^electron\/.+/],
        output: { format: 'cjs', entryFileNames: '[name].cjs' },
      },
    },
  },
  renderer: {
    root: 'src/renderer',
    base: './',
    plugins: [react(), tailwindcss()],
    // Module workers, as on the web: the kernel worker's dynamic imports stay
    // chunks of their own (ADR-0070 §2).
    worker: { format: 'es' },
    build: {
      outDir: 'out/renderer',
      chunkSizeWarningLimit: 1000,
      rollupOptions: { input: resolve(import.meta.dirname, 'src/renderer/index.html') },
    },
  },
});
