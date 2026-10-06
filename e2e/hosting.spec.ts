import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, type Page, test } from '@playwright/test';
import { headersFor, parseHeaders } from '../apps/web/pwa/headers';
import { attr, chip, exportModel, objectsOf3mf, primitive, zoomOutTo } from './benchmark-helpers';
import { clicker, counts, kernelReady, mapping, newSketchOnXY, pickTool } from './helpers';
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

// ADR-0071 (P5-04): OpenSCAD runs in a module worker nested in the kernel
// worker, its glue a hashed asset and its 11 MB WASM fetched on first use. Under
// the served headers (COOP/COEP, the CSP) a `.scad` import compiles to a body
// with no violation and no console error.
test('an OpenSCAD import compiles under the content policy', async ({ page, request }) => {
  const policy = await watchPolicy(page);
  const wasm: string[] = [];
  page.on('requestfinished', (finished) => {
    if (/\/assets\/openscad-[^/]+\.wasm$/.test(finished.url())) wasm.push(finished.url());
  });
  await page.goto(`${host.url}/`);
  await page.getByRole('button', { name: 'New design' }).click();
  const viewport = page.getByRole('region', { name: 'Viewport' });
  await expect(viewport).toHaveAttribute('data-ready', 'true');
  await kernelReady(page);
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('tab', { name: 'Insert' }).click();
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await (await chooser).setFiles('fixtures/imports/customizer-plate.scad');
  const dialog = page.getByRole('region', { name: 'Import dialog' });
  await expect(dialog.locator('[data-scad-overrides]')).toHaveAttribute(
    'data-scad-overrides',
    'ready',
    { timeout: 90_000 },
  );
  await expect(dialog).toHaveAttribute('data-preview-status', 'ok', { timeout: 90_000 });
  await dialog.getByRole('button', { name: /^OK/ }).click();
  await expect(viewport).toHaveAttribute('data-bodies', 'Body1:1:40,30,4', { timeout: 60_000 });
  // The WASM came from this origin, as a hashed asset served as WASM.
  expect(wasm.length).toBeGreaterThan(0);
  const served = await request.get(wasm[0] as string);
  expect(served.headers()['content-type']).toBe('application/wasm');
  expect(served.headers()['cache-control']).toContain('immutable');

  expect(await policy.violations()).toEqual([]);
  expect(policy.errors).toEqual([]);
});

// ADR-0067 H1: the policy allows nothing to evaluate a string. Both WASM builds
// are made with dynamic execution off and zod's JIT off, so 'unsafe-eval' is
// gone from script-src; this walks a whole session under the served headers and
// listens for the violation any remaining `eval` would raise.
test('nothing in a whole session evaluates a string', async ({ page, request }) => {
  const headers = (await request.get(`${host.url}/`)).headers();
  const scriptSrc = /script-src ([^;]*)/.exec(headers['content-security-policy'] ?? '')?.[1] ?? '';
  expect(scriptSrc).toContain("'wasm-unsafe-eval'");
  expect(scriptSrc).not.toContain("'unsafe-eval'");

  const policy = await watchPolicy(page);
  await page.goto(`${host.url}/`);
  await page.getByRole('button', { name: 'Start from the Wall bracket template' }).click();
  await kernelReady(page);
  const viewport = page.getByRole('region', { name: 'Viewport' });
  await expect(viewport).toHaveAttribute('data-ready', 'true');
  await expect(viewport).toHaveAttribute('data-bodies', /^Bracket:12:/);

  // A sketch beside the bracket: a line with the Line tool (the solver's WASM in
  // this page) and a rectangle to have a profile, drawn clear of the body.
  await newSketchOnXY(page);
  await zoomOutTo(page, { x: 900, y: 500 }, 300);
  const at = await mapping(viewport);
  const click = clicker(page, at);
  await page.keyboard.press('l');
  await click(60, 40);
  await click(100, 40);
  await page.keyboard.press('Escape');
  await page.keyboard.press('r');
  await click(60, -40);
  await click(100, -20);
  await page.keyboard.press('Escape');
  await expect.poll(() => counts(page)).toMatchObject({ lines: 5, circles: 0 });
  await expect(viewport).toHaveAttribute('data-sketch-profiles', 'profiles=1 holes=0');
  await page.getByRole('button', { name: 'Finish Sketch' }).last().click();

  // A profile picked in the model, extruded: the kernel's WASM in its worker.
  const inside = at(80, -30);
  await page.mouse.move(inside.x, inside.y);
  await page.mouse.click(inside.x, inside.y);
  await expect.poll(() => attr(viewport, 'data-model-selection')).toMatch(/^profile:/);
  await page.keyboard.press('e');
  const extrude = page.getByRole('region', { name: 'Extrude dialog' });
  await expect(extrude).toBeVisible();
  await expect(extrude).toHaveAttribute('data-preview-status', 'ok', { timeout: 20_000 });
  await extrude.getByRole('button', { name: 'OK' }).click();
  await expect(extrude).toBeHidden();
  await kernelReady(page);
  await expect(chip(page, 'Extrude3')).toBeVisible();
  await expect(viewport).toHaveAttribute('data-bodies', /Bracket:12:[\d,]+ Body1:6:/);

  // The command palette, and a file out through a blob URL and a worker-free zip.
  await page.keyboard.press('Control+k');
  await expect(page.getByRole('dialog', { name: 'Command palette' })).toBeVisible();
  await page.keyboard.press('Escape');
  const exported = await exportModel(page, '3MF');
  expect(objectsOf3mf(exported)).toHaveLength(2);

  await page.getByRole('tab', { name: 'Solid' }).click();
  await pickTool(page, 'Script');
  const script = page.getByRole('region', { name: 'Script dialog' });
  await expect(page.getByRole('textbox', { name: 'Script code' })).toBeVisible();
  await expect(script).toHaveAttribute('data-preview-status', 'ok', { timeout: 30_000 });
  await expect(script.locator('[data-script-made]')).toHaveText('Made 1 features');
  await script.getByRole('button', { name: /^Cancel Esc/ }).click();

  expect(await policy.violations()).toEqual([]);
  expect(policy.errors).toEqual([]);
});
