import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, type Page, test } from '@playwright/test';
import { headersFor, parseHeaders } from '../apps/web/pwa/headers';
import { exportModel, objectsOf3mf, primitive } from './benchmark-helpers';
import { clicker, counts, kernelReady, newSketchOnXY } from './helpers';
import { type StaticHost, startStaticHost } from './static-host';

// The hosted site's headers (apps/web/public/_headers, ADR-0054). `vite preview`, which
// serves every other spec, applies the global block; this file serves the build through a
// host that applies the whole file (path rules too), the way Cloudflare Pages does.
const DIST = resolve('apps/web/dist');

test.use({ viewport: { width: 1440, height: 900 } });

let host: StaticHost;
test.beforeAll(async () => {
  host = await startStaticHost(DIST);
});
test.afterAll(async () => {
  await host.close();
});

/** Collects what a strict policy would complain about: CSP violations and page errors. */
async function watchPolicy(page: Page) {
  await page.addInitScript(`
    window.__violations = [];
    document.addEventListener('securitypolicyviolation', (e) => {
      window.__violations.push(e.violatedDirective + ' ' + e.blockedURI + ' ' + e.sourceFile);
    });
  `);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  return {
    errors,
    violations: () => page.evaluate('window.__violations') as Promise<string[]>,
  };
}

test('the build carries the header rules the host needs', async () => {
  const rules = parseHeaders(readFileSync(resolve(DIST, '_headers'), 'utf8'));
  const html = headersFor(rules, '/');
  expect(html['cross-origin-opener-policy']).toBe('same-origin');
  expect(html['cross-origin-embedder-policy']).toBe('require-corp');
  expect(html['cache-control']).toBe('no-cache');
  expect(headersFor(rules, '/sw.js')['cache-control']).toBe('no-cache');
  expect(headersFor(rules, '/assets/index-abc.js')['cache-control']).toContain('immutable');
  // Link previews and the canonical URL name the site (pwa/site.ts), never a placeholder.
  const index = readFileSync(resolve(DIST, 'index.html'), 'utf8');
  expect(index).toMatch(/<link rel="canonical" href="https:\/\/[^"]+\/" \/>/);
  expect(index).toMatch(/property="og:image" content="https:\/\/[^"]+\/og-image\.png"/);
  expect(index).not.toContain('__SITE_URL__');
  expect(readFileSync(resolve(DIST, 'og-image.png')).subarray(1, 4).toString()).toBe('PNG');
});

test('the host serves the shell and the worker uncached and the hashed files for good', async ({
  request,
}) => {
  const get = async (path: string) => (await request.get(host.url + path)).headers();
  for (const path of ['/', '/index.html', '/sw.js']) {
    const headers = await get(path);
    expect(headers['cache-control']).toBe('no-cache');
    expect(headers['cross-origin-opener-policy']).toBe('same-origin');
    expect(headers['cross-origin-embedder-policy']).toBe('require-corp');
  }
  const index = readFileSync(resolve(DIST, 'index.html'), 'utf8');
  const asset = /src="\.\/(assets\/[^"]+\.js)"/.exec(index)?.[1];
  expect(asset).toBeTruthy();
  const headers = await get(`/${asset}`);
  expect(headers['cache-control']).toBe('public, max-age=31536000, immutable');
  expect(headers['content-type']).toContain('javascript');
  expect(headers['x-content-type-options']).toBe('nosniff');
});

test('the app runs cross-origin isolated under the content policy: kernel, recompute, export', async ({
  page,
}) => {
  const policy = await watchPolicy(page);
  await page.goto(`${host.url}/`);
  await expect(page.getByRole('heading', { name: 'Your designs' })).toBeVisible();
  expect(await page.evaluate('window.crossOriginIsolated')).toBe(true);

  // A design that needs the kernel worker, its WASM and a fresh recompute.
  await page.getByRole('button', { name: 'Start from the Wall bracket template' }).click();
  await kernelReady(page);
  const viewport = page.getByRole('region', { name: 'Viewport' });
  await expect(viewport).toHaveAttribute('data-ready', 'true');
  await expect(viewport).toHaveAttribute('data-bodies', /^Bracket:12:/);

  await page.goto(`${host.url}/`);
  await page.getByRole('button', { name: 'New design' }).click();
  await expect(page.getByRole('region', { name: 'Viewport' })).toHaveAttribute(
    'data-ready',
    'true',
  );
  await primitive(page, 'Box', { Length: '20 mm', Width: '20 mm', Height: '20 mm' });
  await expect(page.getByRole('region', { name: 'Viewport' })).toHaveAttribute(
    'data-bodies',
    'Body1:6:20,20,20',
  );

  // A file leaves through a blob URL and a worker-free zip.
  const exported = await exportModel(page, '3MF');
  expect(exported.name).toMatch(/\.3mf$/);
  expect(objectsOf3mf(exported)).toHaveLength(1);

  expect(await policy.violations()).toEqual([]);
  expect(policy.errors).toEqual([]);
});

test('a sketch solves under the content policy (the solver WASM, too)', async ({ page }) => {
  const policy = await watchPolicy(page);
  await page.goto(`${host.url}/`);
  await page.getByRole('button', { name: 'New design' }).click();
  await expect(page.getByRole('region', { name: 'Viewport' })).toHaveAttribute(
    'data-ready',
    'true',
  );
  const at = await newSketchOnXY(page);
  const click = clicker(page, at);
  await page.keyboard.press('r');
  await click(-20, -10);
  await click(20, 10);
  // Four corners joined, horizontal and vertical edges: the solver ran.
  await expect.poll(() => counts(page)).toMatchObject({ points: 8, lines: 4 });
  expect((await counts(page)).constraints).toBeGreaterThanOrEqual(8);

  expect(await policy.violations()).toEqual([]);
  expect(policy.errors).toEqual([]);
});
