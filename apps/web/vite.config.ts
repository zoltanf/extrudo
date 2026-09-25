import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset URLs so the same build loads from file:// inside Electron.
  base: './',
  plugins: [react(), tailwindcss()],
  build: {
    // The main chunk holds three.js's core (~380 kB), since the viewport store
    // uses its math and three.core doesn't tree-shake. The R3F viewport itself
    // is a lazy chunk (P0-05, ADR-0008).
    chunkSizeWarningLimit: 1000,
  },
});
