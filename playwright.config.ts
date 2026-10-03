import { defineConfig, devices } from '@playwright/test';

// E2E_PORT lets several checkouts (git worktrees) run their suites at once:
// with a shared port, `reuseExistingServer` would test another checkout's build.
const PORT = Number(process.env.E2E_PORT ?? 4173);

// Set PLAYWRIGHT_CHROMIUM_PATH to use an installed Chromium instead of the
// browser that `pnpm e2e:install` downloads (useful on distros Playwright
// does not officially support); E2E_GPU=1 turns on real GPU rendering (below).
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
    // The production build registers a service worker that precaches 20 MB of
    // WASM; only e2e/pwa.spec.ts wants it.
    serviceWorkers: 'block',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // Opt-in GPU rendering for local runs on a machine with a GPU
        // (measured on an NVIDIA GTX 1050 Ti: WebGL about 150x faster than
        // SwiftShader, e2e specs 17-39 % faster). Never in CI: the
        // screenshot baselines are made with SwiftShader and GPU pixels
        // differ. '--use-gl=egl' alone silently stays on SwiftShader, so the
        // angle backend has to be named too.
        launchOptions: {
          ...(executablePath ? { executablePath } : {}),
          ...(process.env.E2E_GPU
            ? { args: ['--use-angle=gl-egl', '--ignore-gpu-blocklist', '--enable-gpu'] }
            : {}),
        },
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
