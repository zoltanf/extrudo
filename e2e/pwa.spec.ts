import { resolve } from 'node:path';
import { expect, type Page, test } from '@playwright/test';
import { kernelReady } from './helpers';
import { type StaticHost, startStaticHost } from './static-host';

// The rest of the suite blocks service workers (playwright.config.ts); this
// file runs against the production preview build with the worker allowed.
test.use({ serviceWorkers: 'allow' });

const cachedUrls = (page: import('@playwright/test').Page) =>
  page.evaluate(
    `caches.open('extrudo-precache').then(async (c) => (await c.keys()).map((r) => new URL(r.url).pathname))`,
  ) as Promise<string[]>;

test('the service worker precaches the app, WASM included, and the app opens offline', async ({
  page,
  context,
}) => {
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Your designs' })).toBeVisible();
  // `ready` resolves once the worker is active, i.e. after it precached everything.
  await page.evaluate('navigator.serviceWorker.ready.then(() => true)');

  const cached = await cachedUrls(page);
  expect(cached.some((p) => /\/assets\/extrudo_occt_single-.*\.wasm$/.test(p))).toBe(true);
  expect(cached.some((p) => /\/assets\/planegcs-.*\.wasm$/.test(p))).toBe(true);
  expect(cached.some((p) => /\/assets\/worker-.*\.js$/.test(p))).toBe(true);
  expect(cached.some((p) => p.endsWith('/index.html'))).toBe(true);
  expect(cached.some((p) => p.endsWith('/manifest.webmanifest'))).toBe(true);
  // Debug pages and legacy font formats stay out, and so do the tools' demo clips (P3-12:
  // fetched when a tooltip opens); the templates' files and pictures are in (hashed assets).
  expect(cached.some((p) => /debug-worker|\.woff$/.test(p))).toBe(false);
  expect(cached.some((p) => /\/demos\//.test(p))).toBe(false);
  expect(cached.some((p) => /\/assets\/b2-storage-box-.*\.extrudo$/.test(p))).toBe(true);
  expect(cached.some((p) => /\/assets\/storage-box-.*\.png$/.test(p))).toBe(true);

  const manifest = await page.evaluate(
    `fetch(document.querySelector('link[rel=manifest]').href).then((r) => r.json())`,
  );
  expect(manifest).toMatchObject({ name: 'Extrudo', display: 'standalone' });

  // Offline: a reload comes from the cache, and so does the kernel.
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Your designs' })).toBeVisible();
  await page.getByRole('button', { name: 'Start from the Wall bracket template' }).click();
  await expect(page).toHaveURL(/#\/p\/[0-9a-f-]+$/);
  await kernelReady(page);
  await expect(page.getByRole('region', { name: 'Viewport' })).toHaveAttribute(
    'data-ready',
    'true',
  );

  // A template that comes from a file works offline too.
  await page.goto('./');
  await page.getByRole('button', { name: 'Start from the Storage box template' }).click();
  await expect(page).toHaveURL(/#\/p\/[0-9a-f-]+$/);
  await kernelReady(page);
  await expect(
    page.getByRole('button', { name: 'Project name: Storage box. Rename' }),
  ).toBeVisible();
});

test("an update keeps the previous version's files for one more round, then drops them", async ({
  page,
}) => {
  const reinstall = async () => {
    // A fresh install and activation, like an update: unregister, then load again.
    await page.evaluate(`navigator.serviceWorker.getRegistration().then((r) => r.unregister())`);
    await page.reload();
    await page.evaluate('navigator.serviceWorker.ready.then(() => true)');
  };
  await page.goto('./');
  await page.evaluate('navigator.serviceWorker.ready.then(() => true)');
  const current = await cachedUrls(page);
  // Pretend the previous version listed a file this build doesn't have.
  await page.evaluate(`caches.open('extrudo-precache').then(async (c) => {
    await c.put('./assets/old-abc.js', new Response('old'));
    await c.put('./.previous-precache', new Response(JSON.stringify([new URL('./assets/old-abc.js', location.href).href])));
  })`);

  await reinstall();
  await expect.poll(() => cachedUrls(page)).toContain('/assets/old-abc.js');
  expect(await cachedUrls(page)).toEqual(expect.arrayContaining(current));

  await reinstall();
  await expect.poll(() => cachedUrls(page)).not.toContain('/assets/old-abc.js');
  expect(await cachedUrls(page)).toEqual(expect.arrayContaining(current));
});

// ADR-0054: an update installs in the background and waits; the person decides when to reload.
// A static host with the build's own _headers (e2e/static-host.ts) can swap its sw.js at will.
test.describe('an update is waiting', () => {
  let host: StaticHost;
  test.beforeEach(async () => {
    host = await startStaticHost(resolve('apps/web/dist'));
  });
  test.afterEach(async () => {
    await host.close();
  });

  /** The version the active worker stamped into the cache when it activated. */
  const activeVersion = (page: Page) =>
    (
      page.evaluate(
        `caches.open('extrudo-precache').then((c) => c.match('./.previous-precache')).then((r) => r && r.headers.get('x-extrudo-version'))`,
      ) as Promise<string | null>
    )
      // Polled while the page reloads: a context that is being replaced answers "not yet".
      .catch(() => null);

  /** Serves a changed sw.js and asks the browser to look for it, as it does on its own at times. */
  async function publishUpdate(page: Page, version: string) {
    const current = await (await fetch(`${host.url}/sw.js`)).text();
    host.override(
      '/sw.js',
      current.replace(/const VERSION = '[^']*'/, `const VERSION = '${version}'`),
    );
    await page.evaluate(`navigator.serviceWorker.getRegistration().then((r) => r.update())`);
  }

  // The host redirects /index.html to / like Cloudflare Pages: a precached redirected
  // response used to fail every visit after the first with ERR_FAILED (2026-10-02).
  test('a repeat visit through the worker opens on a host that redirects index.html', async ({
    page,
  }) => {
    expect((await fetch(`${host.url}/index.html`, { redirect: 'manual' })).status).toBe(308);
    await page.goto(`${host.url}/`);
    await page.evaluate('navigator.serviceWorker.ready.then(() => true)');
    await expect.poll(() => page.evaluate('!!navigator.serviceWorker.controller')).toBe(true);

    await page.reload();
    await expect(page.getByRole('heading', { name: 'Your designs' })).toBeVisible();
    await page.goto(`${host.url}/#/`);
    await expect(page.getByRole('heading', { name: 'Your designs' })).toBeVisible();
  });

  test('a toast offers the reload and the reload activates the new version', async ({ page }) => {
    await page.goto(`${host.url}/`);
    await expect(page.getByRole('heading', { name: 'Your designs' })).toBeVisible();
    await page.evaluate('navigator.serviceWorker.ready.then(() => true)');
    await expect.poll(() => activeVersion(page)).toBeTruthy();
    const before = await activeVersion(page);
    expect(before).not.toBe('test-v2');
    await expect(page.getByText('A new version of Extrudo is ready.')).toHaveCount(0);

    await publishUpdate(page, 'test-v2');
    await expect(page.getByText('A new version of Extrudo is ready.')).toBeVisible();
    // Nothing swapped yet: the old worker is still the active one.
    expect(await activeVersion(page)).toBe(before);

    await page.getByRole('button', { name: 'Reload', exact: true }).click();
    await expect.poll(() => activeVersion(page), { timeout: 15_000 }).toBe('test-v2');
    // The reloaded page runs and has no second toast for the same update.
    await expect(page.getByRole('heading', { name: 'Your designs' })).toBeVisible();
    await expect(page.getByText('A new version of Extrudo is ready.')).toHaveCount(0);
  });

  test('the reload keeps what you were doing: the open design is saved first', async ({ page }) => {
    await page.goto(`${host.url}/`);
    await page.getByRole('button', { name: 'New design' }).click();
    await expect(page).toHaveURL(/#\/p\/[0-9a-f-]+$/);
    await page.evaluate('navigator.serviceWorker.ready.then(() => true)');

    await page.getByRole('button', { name: /^Project name: / }).click();
    await page.getByRole('textbox', { name: 'Project name' }).fill('Edited before the update');
    await page.getByRole('textbox', { name: 'Project name' }).press('Enter');
    await publishUpdate(page, 'test-v3');
    await expect(page.getByText('A new version of Extrudo is ready.')).toBeVisible();
    await page.getByRole('button', { name: 'Reload', exact: true }).click();

    await expect.poll(() => activeVersion(page), { timeout: 15_000 }).toBe('test-v3');
    await expect(
      page.getByRole('button', { name: 'Project name: Edited before the update. Rename' }),
    ).toBeVisible();
  });
});
