import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: ['packages/*', 'apps/web', 'apps/site', 'apps/desktop'],
    passWithNoTests: true,
  },
});
