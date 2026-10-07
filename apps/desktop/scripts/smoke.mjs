#!/usr/bin/env node
/**
 * Desktop smoke test (P6-01, ADR-0075 §5). Launches the built Electron app
 * (`apps/desktop/out`) **asynchronously** with `--remote-debugging-port`,
 * connects over CDP, opens a new design, waits for the kernel worker's first
 * recompute (`data-model-status="ready"`), waits for the autosave to say
 * "Saved", and quits.
 *
 * `--app <path>` launches a **packaged** binary instead (the AppImage the
 * `desktop` workflow builds, P6-01 slice 3): with `--appimage-extract-and-run`
 * (no FUSE needed) and `--no-sandbox` (CI runners forbid the SUID sandbox on an
 * extracted image), software WebGL (SwiftShader), a throwaway data directory (`EXTRUDO_USER_DATA`, read by
 * main before anything else) and `EXTRUDO_DISABLE_UPDATES=1` (a CI run never
 * asks GitHub for an update, P6-01 slice 4), and it also fails on any renderer console error
 * or uncaught page error.
 *
 * It needs a display and the Electron binary:
 *   - no display (a headless machine): run it under `xvfb-run -a`
 *     (`xvfb-run -a node apps/desktop/scripts/smoke.mjs`);
 *   - `pnpm --filter @extrudo/desktop build` first, and `pnpm install` must
 *     have downloaded Electron's binary (which pnpm runs only if its build
 *     script is approved).
 *
 * It is deliberately not part of `pnpm check`: CI has no Electron download. The
 * unit tests (the Node store, the bridge, the proxy, the platform) prove the
 * same wiring in Node.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const appDir = join(dirname(fileURLToPath(import.meta.url)), '..');

function bail(message, code = 1) {
  console.error(`smoke: ${message}`);
  process.exit(code);
}

const appFlag = process.argv.indexOf('--app');
const packagedApp = appFlag >= 0 ? process.argv[appFlag + 1] : undefined;
if (appFlag >= 0 && !packagedApp) bail('--app needs the path of a packaged binary.');
if (packagedApp && !existsSync(packagedApp)) bail(`no packaged app at ${packagedApp}.`);

if (!packagedApp && !existsSync(join(appDir, 'out', 'main', 'index.cjs'))) {
  bail('no build found; run `pnpm --filter @extrudo/desktop build` first.');
}

if (!process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
  const xvfb = spawnSync('command', ['-v', 'xvfb-run'], { shell: true, encoding: 'utf8' });
  if (xvfb.status !== 0) {
    bail(
      'no display and no `xvfb-run`; install xvfb-run or run this on a machine with a display.',
      2,
    );
  }
  bail('no display; re-run under `xvfb-run -a`.', 2);
}

let electronPath;
if (!packagedApp) {
  try {
    ({ default: electronPath } = await import('electron'));
  } catch {
    bail("the `electron` package isn't installed; run `pnpm install`.", 2);
  }
  if (typeof electronPath !== 'string' || !existsSync(electronPath)) {
    bail("Electron's binary isn't downloaded (pnpm did not run its build script).", 2);
  }
}
const userData = packagedApp ? mkdtempSync(join(tmpdir(), 'extrudo-smoke-')) : undefined;

let chromium;
// The workspace root has `@playwright/test` (which re-exports `chromium`); the
// bare `playwright` package is only there when something else installs it.
for (const name of ['playwright', '@playwright/test']) {
  try {
    ({ chromium } = await import(name));
    break;
  } catch {}
}
if (!chromium) bail("Playwright isn't available to drive the app.", 2);

const port = Number(process.env.SMOKE_PORT ?? 9333);
const url = `http://127.0.0.1:${port}`;
/** An `.extrudo` file to hand the app on the command line (the association/argv path). */
const openPath = process.env.SMOKE_OPEN;

/** Starts Electron and returns the child process. */
function launch() {
  if (packagedApp) {
    const args = [
      '--appimage-extract-and-run',
      '--no-sandbox',
      // A CI runner has no GPU, and Chromium blocklists its software GL for
      // WebGL2: ask for SwiftShader, as the Playwright e2e specs run.
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--ignore-gpu-blocklist',
      `--remote-debugging-port=${port}`,
    ];
    if (openPath) args.push(openPath);
    return spawn(resolve(packagedApp), args, {
      // Its own process group: the AppImage runner starts Electron as a child,
      // and killing the runner alone would leave the app (and Xvfb) running.
      detached: true,
      stdio: 'inherit',
      // No update check against GitHub from a CI run (P6-01 slice 4).
      env: {
        ...process.env,
        ELECTRON_ENABLE_LOGGING: '1',
        EXTRUDO_USER_DATA: userData,
        EXTRUDO_DISABLE_UPDATES: '1',
      },
    });
  }
  const args = ['.', `--remote-debugging-port=${port}`];
  if (openPath) args.push(openPath);
  return spawn(electronPath, args, {
    cwd: appDir,
    stdio: 'inherit',
    env: { ...process.env, ELECTRON_ENABLE_LOGGING: '1', EXTRUDO_DISABLE_UPDATES: '1' },
  });
}

/** Waits for the debug port to accept a CDP connection. */
async function connect(timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      return await chromium.connectOverCDP(url, { timeout: 5_000 });
    } catch (error) {
      if (Date.now() > deadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
}

const started = Date.now();
const child = launch();
const errors = [];
let browser;
try {
  browser = await connect();
  const context = browser.contexts()[0] ?? (await browser.newContext());
  const page = context.pages()[0] ?? (await context.newPage());
  if (packagedApp) {
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(`console: ${message.text()}`);
    });
    page.on('pageerror', (error) => errors.push(`page error: ${error.message}`));
  }

  // The home screen: open a new design, or wait for the one the association
  // opened (SMOKE_OPEN). The kernel worker's first recompute is the readiness
  // signal either way.
  if (!openPath) {
    await page.getByRole('button', { name: /^New design/ }).click({ timeout: 30_000 });
  }
  await page.waitForSelector('[data-model-status="ready"]', { timeout: 90_000 });
  const status = await page.getAttribute('[data-model-status]', 'data-model-status');
  if (openPath) {
    // The project route proves the file was imported and opened, not just read.
    await page.waitForURL(/#\/p\//, { timeout: 30_000 });
  }
  // The autosave's own word: it saves automatically after an edit.
  await page
    .locator('[role="status"][aria-label="Save status"]', { hasText: 'Saved' })
    .waitFor({ timeout: 30_000 });

  console.log(`smoke: model status = ${status}`);
  console.log(
    openPath
      ? `smoke: opened ${openPath} through the association, kernel ready, project Saved`
      : 'smoke: home screen opened a design, kernel ready, project Saved',
  );
  if (errors.length > 0) {
    for (const line of errors) console.error(`smoke: ${line}`);
    throw new Error(`${errors.length} renderer error(s)`);
  }
  console.log(`smoke: OK in ${((Date.now() - started) / 1000).toFixed(1)} s`);
} catch (error) {
  console.error(`smoke: could not drive the app: ${error.message}`);
  process.exitCode = 1;
} finally {
  await browser?.close().catch(() => {});
  if (packagedApp && child.pid) {
    try {
      process.kill(-child.pid);
    } catch {}
  } else child.kill();
  await new Promise((resolve) => {
    if (child.exitCode !== null) resolve();
    else {
      child.once('exit', resolve);
      setTimeout(resolve, 5_000);
    }
  });
  // After the app has gone: removing the data directory while it was still
  // writing failed with ENOTEMPTY (P6-01 slice 4's run), and a cleanup failure
  // must not turn a passed smoke into a failure.
  if (userData) {
    try {
      rmSync(userData, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch (error) {
      console.warn(`smoke: left ${userData} behind: ${error.message}`);
    }
  }
}
