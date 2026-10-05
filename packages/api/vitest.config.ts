import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // The examples under `docs/api/examples/` import the package by its own
    // name, as a user writes it. They are outside every package, so the name is
    // resolved here, to this package's entry (ADR-0068 §6).
    alias: {
      '@extrudo/api': new URL('./src/index.ts', import.meta.url).pathname,
    },
  },
});
