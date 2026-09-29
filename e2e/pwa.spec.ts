import { expect, test } from '@playwright/test';
import { kernelReady } from './helpers';

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
  // Debug pages and legacy font formats stay out.
  expect(cached.some((p) => /debug-worker|\.woff$/.test(p))).toBe(false);

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
