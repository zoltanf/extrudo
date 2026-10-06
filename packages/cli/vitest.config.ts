import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // The script examples under `docs/api/examples/` (P5-02) import the API by
    // its own name, as a user writes it. They are outside every package, so the
    // name is resolved here, to the API's entry (as `packages/api` does).
    alias: {
      '@extrudo/api': new URL('../api/src/index.ts', import.meta.url).pathname,
    },
  },
});
