import { resolve } from 'node:path';
import { expect, type Page, test } from '@playwright/test';
import { type StaticHost, startStaticHost } from './static-host';

// The landing page at extrudo.org (apps/site, ADR-0057), served from its build the way
// Cloudflare Pages does (its own _headers, .html redirects). The app moved to
// app.extrudo.org; extrudo.org must still send old links there and retire the app's
// service worker that visitors from before the move have.

const SITE = resolve('apps/site/dist');
const APP = resolve('apps/web/dist');
const APP_URL = 'https://app.extrudo.org';

test.use({ serviceWorkers: 'allow', viewport: { width: 1280, height: 860 } });

let host: StaticHost;
test.beforeEach(async () => {
  host = await startStaticHost(SITE);
});
test.afterEach(async () => {
  await host.close();
});

const heading = (page: Page) =>
  page.getByRole('heading', { name: 'Parametric CAD for 3D printing, in your browser.' });

test('the landing page leads to the app, plays the intro and keeps to its content policy', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(
    `document.addEventListener('securitypolicyviolation', (e) => console.error('CSP ' + e.violatedDirective + ' ' + e.blockedURI));`,
  );
  await page.goto(`${host.url}/`);
  await expect(heading(page)).toBeVisible();

  const open = page.getByRole('link', { name: /^Open Extrudo/ });
  await expect(open.first()).toHaveAttribute('href', `${APP_URL}/`);
  await expect(page.locator('[data-open-app]')).toHaveAttribute('href', `${APP_URL}/`);
  await expect(page.getByRole('link', { name: 'Try the latest build' })).toHaveAttribute(
    'href',
    'https://edge.extrudo.org/',
  );
  // The intro video loads from this origin (it is in the build, not a placeholder).
  const video = page.locator('video[data-intro]');
  await expect(video).toBeVisible();
  await expect
    .poll(() => video.evaluate((v) => (v as unknown as { readyState: number }).readyState))
    .toBeGreaterThan(0);
  await expect(page.getByRole('heading', { name: 'What it does' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('an old link to a design goes on to the app with its route', async ({ page }) => {
  await page.route(`${APP_URL}/**`, (route) =>
    route.fulfill({ contentType: 'text/html', body: '<title>App</title><h1>The app</h1>' }),
  );
  await page.goto(`${host.url}/#/p/0b8a7f1e-1111-4222-8333-944455556666`);
  await expect(page).toHaveURL(`${APP_URL}/#/p/0b8a7f1e-1111-4222-8333-944455556666`);
});

test("the old app's home route stays on the landing page", async ({ page }) => {
  await page.goto(`${host.url}/#/`);
  await expect(heading(page)).toBeVisible();
  expect(new URL(page.url()).hash).toBe('');
});

test("a returning visitor's app service worker retires itself and the landing page shows", async ({
  page,
}) => {
  // Before the move: the app at this address, its worker installed and in control.
  host.serve(APP);
  await page.goto(`${host.url}/`);
  await expect(page.getByRole('heading', { name: 'Your designs' })).toBeVisible();
  await page.evaluate('navigator.serviceWorker.ready.then(() => true)');
  await expect.poll(() => page.evaluate('!!navigator.serviceWorker.controller')).toBe(true);

  // The move: the address now serves the landing page. The next visit is still answered
  // by the old worker from its cache and finds the new sw.js. That one takes over, cleans
  // up and reloads the page; or, when Chrome holds it back behind the open tab, the old
  // app offers "A new version of Extrudo is ready" and its Reload sends SKIP_WAITING.
  host.serve(SITE);
  await page.reload();
  const landed = await heading(page)
    .waitFor({ timeout: 8_000 })
    .then(() => true)
    .catch(() => false);
  if (!landed) {
    await page.getByRole('button', { name: 'Reload', exact: true }).click();
  }
  await expect(heading(page)).toBeVisible({ timeout: 15_000 });
  await expect
    .poll(() => page.evaluate('navigator.serviceWorker.getRegistrations().then((r) => r.length)'))
    .toBe(0);
  await expect.poll(() => page.evaluate('caches.keys().then((k) => k.length)')).toBe(0);
  // And it stays the landing page.
  await page.reload();
  await expect(heading(page)).toBeVisible();
});
