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

/** Scrolls a walkthrough step to the middle of the viewport (the line the observer watches). */
function scrollToStep(page: Page, n: number) {
  return page.evaluate(
    `document.querySelector('li.step[data-step="${n}"]').scrollIntoView({ block: 'center' })`,
  );
}

/** A computed style property of the first element matching `selector`, as a string. */
function computed(page: Page, selector: string, property: string) {
  return page.evaluate(
    `getComputedStyle(document.querySelector(${JSON.stringify(selector)})).getPropertyValue(${JSON.stringify(property)})`,
  );
}

/**
 * What the site's content policy refuses and what the console reports while a
 * page loads (ADR-0057). The docs pages carry no script and load nothing from
 * another origin, so both stay empty.
 */
async function watchPolicy(
  page: Page,
): Promise<{ errors: string[]; violations: () => Promise<string[]> }> {
  await page.addInitScript(`
    window.__violations = [];
    document.addEventListener('securitypolicyviolation', (e) => {
      window.__violations.push(e.violatedDirective + ' ' + e.blockedURI);
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

test('the landing page leads to the app, shows the walkthrough and keeps to its content policy', async ({
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
  // The walkthrough shows the app itself: its first picture is in the build, not a placeholder.
  const first = page.locator('[data-walkthrough-stage] img[data-step="1"]');
  await expect(first).toBeVisible();
  await expect
    .poll(() => first.evaluate((el) => (el as unknown as { naturalWidth: number }).naturalWidth))
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

test('the walkthrough follows the scroll', async ({ page }) => {
  // ADR-0057 amendment: the nine pictures change as the captions cross the viewport's middle.
  await page.goto(`${host.url}/`);
  const section = page.locator('[data-walkthrough]');
  await expect(section).toHaveAttribute('data-enhanced', '');
  const steps = section.locator('li.step');
  await expect(steps).toHaveCount(9);
  for (let n = 1; n <= 9; n++) {
    const step = steps.nth(n - 1);
    await expect(step).toHaveAttribute('data-step', String(n));
    await expect(step.locator('h3')).not.toBeEmpty();
    await expect(step.locator('img.shot')).toHaveAttribute('alt', /./);
  }
  for (const n of [1, 4, 9]) {
    await scrollToStep(page, n);
    await expect.poll(() => section.getAttribute('data-active-step')).toBe(String(n));
    await expect(section.locator('[data-walkthrough-counter]')).toHaveText(`Step ${n} of 9`);
    await expect(section.locator('li.step[aria-current="step"]')).toHaveCount(1);
    await expect(steps.nth(n - 1)).toHaveAttribute('aria-current', 'step');
    await expect
      .poll(() => computed(page, `[data-walkthrough-stage] img[data-step="${n}"]`, 'opacity'))
      .toBe('1');
    for (let other = 1; other <= 9; other++) {
      if (other === n) continue;
      await expect
        .poll(() => computed(page, `[data-walkthrough-stage] img[data-step="${other}"]`, 'opacity'))
        .toBe('0');
    }
  }
});

test('the walkthrough works on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(`${host.url}/`);
  const section = page.locator('[data-walkthrough]');
  await expect(section).toHaveAttribute('data-enhanced', '');
  // The stage sticks at the top and the captions scroll under it.
  await expect.poll(() => computed(page, '[data-walkthrough-stage]', 'position')).toBe('sticky');
  for (const n of [1, 5, 9]) {
    await scrollToStep(page, n);
    await expect.poll(() => section.getAttribute('data-active-step')).toBe(String(n));
    await expect(section.locator('[data-walkthrough-counter]')).toHaveText(`Step ${n} of 9`);
    await expect(section.locator('li.step[aria-current="step"]')).toHaveCount(1);
    await expect
      .poll(() => computed(page, `[data-walkthrough-stage] img[data-step="${n}"]`, 'opacity'))
      .toBe('1');
  }
});

test('the walkthrough is a plain list without JavaScript', async ({ browser }) => {
  const context = await browser.newContext({
    javaScriptEnabled: false,
    viewport: { width: 1280, height: 860 },
  });
  const page = await context.newPage();
  await page.goto(`${host.url}/`);
  const section = page.locator('[data-walkthrough]');
  await expect(section).toBeVisible();
  await expect(page.locator('[data-walkthrough-stage]')).toHaveCount(0);
  await expect(page.locator('[data-walkthrough][data-enhanced]')).toHaveCount(0);
  // Every step's own picture shows, in order, at full size.
  const shots = section.locator('li.step img.shot');
  await expect(shots).toHaveCount(9);
  for (let n = 0; n < 9; n++) {
    const box = await shots.nth(n).boundingBox();
    expect(box?.height ?? 0).toBeGreaterThan(100);
  }
  await context.close();
});

test('the walkthrough swaps without a fade under reduced motion', async ({ page }) => {
  const selector = '[data-walkthrough-stage] img[data-step="1"]';
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(`${host.url}/`);
  await expect(page.locator('[data-walkthrough]')).toHaveAttribute('data-enhanced', '');
  await expect.poll(() => computed(page, selector, 'transition-duration')).toBe('0s');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.reload();
  await expect(page.locator('[data-walkthrough]')).toHaveAttribute('data-enhanced', '');
  await expect.poll(() => computed(page, selector, 'transition-duration')).toBe('0.35s');
});

test('every walkthrough picture comes from the build', async ({ page }) => {
  await page.goto(`${host.url}/`);
  const section = page.locator('[data-walkthrough]');
  await expect(section).toHaveAttribute('data-enhanced', '');
  for (let n = 1; n <= 9; n++) {
    await scrollToStep(page, n);
    await expect.poll(() => section.getAttribute('data-active-step')).toBe(String(n));
  }
  // Lazy pictures load as their step is reached; give them a moment.
  await expect
    .poll(
      () =>
        page.evaluate(
          `Array.from(document.querySelectorAll('[data-walkthrough] img.shot')).every((img) => img.naturalWidth > 0)`,
        ),
      { timeout: 15_000 },
    )
    .toBe(true);
  const sources = (await page.evaluate(`(() => {
    const out = [];
    for (const img of document.querySelectorAll('[data-walkthrough] img.shot')) {
      out.push({ src: img.currentSrc, width: img.naturalWidth });
    }
    return out;
  })()`)) as { src: string; width: number }[];
  expect(sources).toHaveLength(18);
  for (const { src, width } of sources) {
    expect(src.startsWith(`${host.url}/assets/`)).toBe(true);
    expect(width).toBeGreaterThan(0);
  }
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

test('the API docs are built into the site and the footer links to them', async ({ page }) => {
  const policy = await watchPolicy(page);

  // The landing page's footer carries the link (ADR-0068 §6).
  await page.goto(`${host.url}/`);
  const link = page.getByRole('link', { name: 'API docs' });
  await expect(link).toHaveAttribute('href', '/docs/api/');

  // The docs' own index: a sidebar, a heading and the examples.
  await link.click();
  await expect(page).toHaveURL(`${host.url}/docs/api/`);
  await expect(page.getByRole('heading', { name: 'The Extrudo document API' })).toBeVisible();
  const sidebar = page.getByRole('navigation', { name: 'API docs' });
  await expect(sidebar.getByRole('link', { name: 'References' })).toHaveAttribute(
    'href',
    '/docs/api/references/',
  );
  await expect(sidebar.getByRole('heading', { name: 'Create' })).toBeVisible();
  await expect(page.locator('pre code').first()).toBeVisible();

  // Nothing refused, and nothing the pages brought with them: no script at all
  // (the site's own policy allows the app's, not these pages').
  expect(policy.errors).toEqual([]);
  expect(await policy.violations()).toEqual([]);
  expect(await page.evaluate('document.querySelectorAll("script").length')).toBe(0);
  await expect(page.locator('link[rel="stylesheet"]')).toHaveAttribute(
    'href',
    /\/assets\/docs-[^/]+\.css$/,
  );
});

test('a feature page shows its inputs table, its face roles and its example', async ({ page }) => {
  const policy = await watchPolicy(page);

  await page.goto(`${host.url}/docs/api/features/extrude/`);
  await expect(page.getByRole('heading', { name: 'Extrude', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Extrude', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );

  // The inputs table, with the rows the generator wrote from the schemas.
  const table = page.locator('table').first();
  const headers = table.locator('th');
  await expect(headers).toHaveText(['Input', 'Type', 'Required or default', 'What it does']);
  await expect(table.getByRole('cell', { name: 'distance', exact: true })).toBeVisible();
  await expect(table).toContainText('string | number | ParameterHandle');
  await expect(table).toContainText('default one-side');

  // The face roles, and an example call with the code in it.
  await expect(page.getByRole('cell', { name: 'cap:end' })).toBeVisible();
  await expect(page.locator('pre code')).toContainText(
    "d.extrude({ profiles: profile, distance: '10 mm' });",
  );
  // A link between pages is a page, not a Markdown file.
  await page.getByRole('main').getByRole('link', { name: 'Sketches', exact: true }).click();
  await expect(page).toHaveURL(`${host.url}/docs/api/sketch/`);
  await expect(page.getByRole('heading', { name: 'Sketches', exact: true })).toBeVisible();

  expect(policy.errors).toEqual([]);
  expect(await policy.violations()).toEqual([]);
});

test('the API docs pass an axe audit in both themes', async ({ page }) => {
  // NFR-07, like the landing page's own audit below: the docs are pages of the
  // site, and their tables and code blocks are as much content as its cards are.
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme });
    for (const path of ['/docs/api/', '/docs/api/features/extrude/']) {
      await page.goto(`${host.url}${path}`);
      await expect(page.locator('main h1')).toBeVisible();
      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();
      expect
        .soft(
          results.violations.map((v) => ({
            theme: colorScheme,
            page: path,
            rule: v.id,
            impact: v.impact,
            help: v.help,
            nodes: v.nodes.map((n) => `${n.target.join(' ')} :: ${n.html.slice(0, 220)}`),
          })),
          `axe violations on ${path} in the ${colorScheme} theme`,
        )
        .toEqual([]);
    }
  }
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

/** A piece of text on the page: its colour, whether WCAG counts it as large, its line boxes. */
interface TextBox {
  text: string;
  colour: string;
  large: boolean;
  /** The element's own and its ancestors' `opacity`, multiplied; below 1 the colour isn't real. */
  opacity: number;
  rects: { x: number; y: number; w: number; h: number }[];
}

// Every visible text node of the page, with its line boxes in page coordinates. Text
// off the page (the skip link until it has focus) is left out.
const TEXT_BOXES = `(() => {
  const out = [];
  const width = document.documentElement.scrollWidth;
  const height = document.documentElement.scrollHeight;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = (node.textContent || '').trim().replace(/\\s+/g, ' ');
    const element = node.parentElement;
    if (!text || !element || element.closest('script, style, noscript')) continue;
    const style = getComputedStyle(element);
    if (style.visibility !== 'visible') continue;
    const range = document.createRange();
    range.selectNodeContents(node);
    const rects = Array.from(range.getClientRects())
      .map((r) => ({ x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height }))
      .filter((r) => r.w >= 2 && r.h >= 2 && r.x >= 0 && r.y >= 0 &&
        r.x + r.w <= width && r.y + r.h <= height);
    if (rects.length === 0) continue;
    const size = parseFloat(style.fontSize);
    const bold = Number(style.fontWeight) >= 700;
    // The real colour of a text node is its inherited colour times every
    // ancestor's opacity; the measurement below reads pixels, so it can't see it.
    let opacity = 1;
    for (let e = element; e; e = e.parentElement) {
      const o = parseFloat(getComputedStyle(e).opacity);
      if (Number.isFinite(o)) opacity *= o;
      if (opacity === 0) break;
    }
    out.push({ text: text.slice(0, 48), colour: style.color, rects,
      opacity,
      large: size >= 24 || (bold && size >= 18.66) });
  }
  return out;
})()`;

// Makes every glyph transparent, so a screenshot shows only what is painted behind the
// text. Through the CSSOM, which the site's content policy allows (an injected <style>
// would not be).
const HIDE_TEXT = `(() => {
  for (const element of document.querySelectorAll('*')) {
    element.style.setProperty('color', 'transparent', 'important');
    element.style.setProperty('-webkit-text-fill-color', 'transparent', 'important');
    element.style.setProperty('text-shadow', 'none', 'important');
  }
})()`;

/**
 * The light and dark end of what is painted behind each text box, read from a PNG of the
 * page in a blank page of its own (no content policy there), so the worst background for a
 * light text and for a dark one are both known. Each box is read 2 px inside its edges,
 * and its ends are the 2nd and 98th percentile of the pixels' luminance rather than the
 * extremes: a code chip's border can land on the first row of its text's box (sub-pixel
 * layout), and the pixels at a box's edge are no glyph's background.
 */
function backgroundRange(png: Buffer, boxes: TextBox[]): string {
  return `(async () => {
    const image = new Image();
    image.src = 'data:image/png;base64,${png.toString('base64')}';
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(image, 0, 0);
    const luminance = (r, g, b) => [r, g, b]
      .map((v) => v / 255)
      .map((s) => (s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4))
      .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
    return ${JSON.stringify(boxes)}.map((box) => {
      const pixels = [];
      for (const r of box.rects) {
        const x = Math.ceil(r.x) + 2;
        const y = Math.ceil(r.y) + 2;
        const w = Math.max(1, Math.floor(r.w) - 5);
        const h = Math.max(1, Math.floor(r.h) - 5);
        const data = context.getImageData(x, y, w, h).data;
        for (let i = 0; i < data.length; i += 4) {
          pixels.push([luminance(data[i], data[i + 1], data[i + 2]), data[i], data[i + 1], data[i + 2]]);
        }
      }
      pixels.sort((a, b) => a[0] - b[0]);
      const at = (q) => {
        const p = pixels[Math.min(pixels.length - 1, Math.floor(q * pixels.length))];
        return 'rgb(' + p[1] + ', ' + p[2] + ', ' + p[3] + ')';
      };
      return { light: at(0.98), dark: at(0.02) };
    });
  })()`;
}

test('every text on the landing page meets WCAG AA contrast against what is painted behind it', async ({
  page,
}) => {
  // axe reports text over the body's gradient (`--x-glow`) as *incomplete* instead of
  // judging it (see the audit below), and that is where the hero and the nav sit. So
  // this measures the real pixels: every glyph made transparent, a screenshot, and each
  // text's own colour against the lightest and the darkest pixel behind its line boxes.
  // AA is 4.5:1, or 3:1 for large text (24 px, or 18.66 px bold).
  test.setTimeout(90_000);
  const failures: {
    scheme: string;
    width: number;
    text: string;
    ratio: number;
    need: number;
    opacity?: number;
  }[] = [];
  for (const colorScheme of ['dark', 'light'] as const) {
    for (const viewport of [
      { width: 1280, height: 860 },
      { width: 375, height: 812 },
    ]) {
      await page.setViewportSize(viewport);
      await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
      await page.goto(`${host.url}/`);
      await expect(heading(page)).toBeVisible();
      await page.evaluate('document.fonts.ready.then(() => true)');
      const boxes = (await page.evaluate(TEXT_BOXES)) as TextBox[];
      expect(boxes.length).toBeGreaterThan(20);
      await page.evaluate(HIDE_TEXT);
      const png = await page.screenshot({ fullPage: true, animations: 'disabled' });
      const blank = await page.context().newPage();
      const ranges = (await blank.evaluate(backgroundRange(png, boxes))) as {
        light: string;
        dark: string;
      }[];
      await blank.close();
      boxes.forEach((box, i) => {
        // The measurement reads the computed colour, which ignores opacity: a
        // translucent text node can look fine here and be far under AA on screen.
        if (box.opacity < 1) {
          failures.push({
            scheme: colorScheme,
            width: viewport.width,
            text: box.text,
            ratio: box.opacity,
            need: 1,
            opacity: box.opacity,
          });
          return;
        }
        const range = ranges[i];
        if (!range) return;
        const ratio = Math.min(contrast(box.colour, range.light), contrast(box.colour, range.dark));
        const need = box.large ? 3 : 4.5;
        if (ratio < need) {
          failures.push({
            scheme: colorScheme,
            width: viewport.width,
            text: box.text,
            ratio: Number(ratio.toFixed(2)),
            need,
          });
        }
      });
    }
  }
  expect(failures, 'text under WCAG AA contrast against its painted background').toEqual([]);
});

test('the landing page passes an axe audit in both themes', async ({ page }) => {
  // NFR-07, like e2e/a11y.spec.ts for the app: WCAG 2.1 A and AA, both colour schemes.
  // This is a net for the rules axe can judge; it deliberately does **not** judge text
  // over the body's gradient (`--x-glow`), which it reports as *incomplete* instead of
  // passing or failing, so the measurement of every text against its painted
  // background above covers contrast.
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
