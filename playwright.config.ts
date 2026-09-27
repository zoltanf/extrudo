import { defineConfig, devices } from '@playwright/test';

// E2E_PORT lets several checkouts (git worktrees) run their suites at once:
// with a shared port, `reuseExistingServer` would test another checkout's build.
const PORT = Number(process.env.E2E_PORT ?? 4173);

// Set PLAYWRIGHT_CHROMIUM_PATH to use an installed Chromium instead of the
// browser that `pnpm e2e:install` downloads (useful on distros Playwright
// does not officially support).
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH;

export default defineConfig({
  testDir: 'e2e',
  expect: {
    // Text antialiasing differs slightly between Linux distributions (Arch
    // locally, Ubuntu in CI): about a dozen pixels over the colour threshold
    // per full-page shot. 0.1 % still catches any layout change.
    // The render rate in the status bar varies from run to run: hidden in shots.
    toHaveScreenshot: { maxDiffPixelRatio: 0.001, stylePath: './e2e/screenshot.css' },
  },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: executablePath ? { executablePath } : {},
      },
    },
  ],
  webServer: {
    // Start Vite's own script with node. Going through pnpm (`pnpm --filter`,
    // `pnpm exec`) leaves the server running after the tests on pnpm 12, because
    // pnpm does not pass Playwright's stop signal on to Vite.
    command: `node node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port ${PORT} --strictPort`,
    cwd: 'apps/web',
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: !process.env.CI,
  },
});
