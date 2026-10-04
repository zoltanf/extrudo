import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';
import { type StaticHost, startStaticHost } from './static-host';

// The landing page at extrudo.org (apps/site, ADR-0057), served from its build the way
// Cloudflare Pages does (its own _headers, .html redirects). The app moved to
// app.extrudo.org; extrudo.org must still send old links there and retire the app's
// service worker that visitors from before the move have.

const SITE = resolve('apps/site/dist');
const APP = resolve('apps/web/dist');
const APP_URL = 'https://app.extrudo.org';

const BEACON_SRC = 'https://static.cloudflareinsights.com/beacon.min.js';
const RUM_URL = 'https://cloudflareinsights.com/cdn-cgi/rum';

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
  // The contact address, as a mailto and as text to copy (ADR-0057).
  await expect(page.getByRole('link', { name: 'hello@extrudo.org' })).toHaveAttribute(
    'href',
    'mailto:hello@extrudo.org',
  );
  await expect(page.locator('[data-contact]')).toContainText('Questions or feedback?');
  // What the page says about itself: the site counts visits, the app doesn't (ADR-0057
  // amendment).
  await expect(page.locator('[data-privacy]')).toContainText('Cloudflare Web Analytics');
  expect(errors).toEqual([]);
});

test("Cloudflare Web Analytics runs under the landing page's content policy", async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(
    `document.addEventListener('securitypolicyviolation', (e) => console.error('CSP ' + e.violatedDirective + ' ' + e.blockedURI));`,
  );

  // What Pages injects before </body> when Web Analytics is enabled for the project
  // (Metrics > Web Analytics). It is not in the repository (the token would be), so the
  // test writes the tag into the built page it serves. The script and its RUM request
  // are stubbed: the two hosts in the site's policy are the only thing under test.
  let scriptAsked = false;
  let rumAsked = false;
  await page.route('https://static.cloudflareinsights.com/**', (route) => {
    scriptAsked = true;
    void route.fulfill({
      contentType: 'text/javascript',
      headers: {
        'access-control-allow-origin': '*',
        'cross-origin-resource-policy': 'cross-origin',
      },
      body: `fetch(${JSON.stringify(RUM_URL)}, { method: 'POST', body: '{}', mode: 'no-cors', keepalive: true });`,
    });
  });
  await page.route('https://cloudflareinsights.com/**', (route) => {
    rumAsked = true;
    void route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } });
  });

  const tag = `<!-- Cloudflare Pages Analytics --><script defer src='${BEACON_SRC}' data-cf-beacon='{"token": "test"}'></script><!-- Cloudflare Pages Analytics -->`;
  const html = readFileSync(join(SITE, 'index.html'), 'utf8').replace('</body>', `${tag}</body>`);
  host.override('/', html, 'text/html; charset=utf-8');
  await page.goto(`${host.url}/`);
  await expect(heading(page)).toBeVisible();

  // Nothing the policy refused (a blocked beacon is a console error), then the beacon
  // itself runs and sends its one request.
  expect(errors).toEqual([]);
  await expect.poll(() => scriptAsked && rumAsked, { timeout: 15_000 }).toBe(true);
  // And nothing it refused afterwards either: a blocked beacon reports from its own
  // script, so a `connect-src` refusal only shows up once the deferred script has run.
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

/** WCAG 2.1's contrast ratio of two colours (`rgb()` or hex, 1 to 21). */
function contrast(a: string, b: string): number {
  const channels = (colour: string): [number, number, number] => {
    const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(colour.trim())?.[1];
    if (hex) {
      const full = hex.length === 3 ? [...hex].map((c) => c + c).join('') : hex;
      return [0, 2, 4].map((i) => Number.parseInt(full.slice(i, i + 2), 16)) as [
        number,
        number,
        number,
      ];
    }
    const numbers = colour.match(/[\d.]+/g);
    if (!numbers || numbers.length < 3) throw new Error(`Cannot read the colour "${colour}"`);
    return numbers.slice(0, 3).map(Number) as [number, number, number];
  };
  const luminance = (colour: string) => {
    const [r, g, bl] = channels(colour).map((v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    }) as [number, number, number];
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const l1 = luminance(a);
  const l2 = luminance(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

test("the footer's links meet WCAG AA contrast in both themes", async ({ page }) => {
  // axe's own rule cannot judge this (see the audit test below), and the brand's sketch
  // blue is 3.63:1 on white in the light theme, under AA's 4.5:1 for text, so the footer's
  // links have their own measurement. The footer sits below the glow (the gradient is the
  // body's top 80 %), so the flat `--x-bg` is what is painted behind it. The links *over*
  // the glow are a separate design question.
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme });
    await page.goto(`${host.url}/`);
    await expect(heading(page)).toBeVisible();
    const links = (await page.evaluate(
      `(() => Array.from(document.querySelectorAll('footer a')).map((a) => ({
      text: (a.textContent || '').trim().replace(/\\s+/g, ' '),
      colour: getComputedStyle(a).color,
      background: getComputedStyle(document.body).backgroundColor,
    })))()`,
    )) as { text: string; colour: string; background: string }[];
    expect(links.length).toBeGreaterThan(0);
    const tooLow = links
      .map((l) => ({ text: l.text, ratio: Number(contrast(l.colour, l.background).toFixed(2)) }))
      .filter((l) => l.ratio < 4.5);
    expect.soft(tooLow, `footer links under 4.5:1 in the ${colorScheme} theme`).toEqual([]);
  }
});

test('the landing page passes an axe audit in both themes', async ({ page }) => {
  // NFR-07, like e2e/a11y.spec.ts for the app: WCAG 2.1 A and AA, both colour schemes.
  // This is a net for the rules axe can judge; it deliberately does **not** judge text
  // over the body's gradient (`--x-glow`), which it reports as *incomplete* instead of
  // passing or failing, so the footer's links have their own ratio test above.
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme });
    await page.goto(`${host.url}/`);
    await expect(heading(page)).toBeVisible();
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect
      .soft(
        results.violations.map((v) => ({
          theme: colorScheme,
          rule: v.id,
          impact: v.impact,
          help: v.help,
          nodes: v.nodes.map((n) => `${n.target.join(' ')} :: ${n.html.slice(0, 220)}`),
        })),
        `axe violations in the ${colorScheme} theme`,
      )
      .toEqual([]);
  }
});
