import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // The runner loads QuickJS's WebAssembly and the tests run scripts through
    // it; a run has its own two-second limit, so the test's own limit has to be
    // above what a suite of runs costs (ADR-0070 §2).
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
