import { expect, type Locator, test } from '@playwright/test';
import { clicker, kernelReady, sketchOnXY } from './helpers';

// WebKit smoke test (the `webkit` project of playwright.config.ts): the one
// flow that broke in Safari and iOS browsers before the Symbol.dispose polyfill
// (`@extrudo/core/polyfills`). Vite lowers `using` to a helper that looks the
// disposer up under `Symbol.dispose || Symbol.for('Symbol.dispose')`, and an
// engine without `Symbol.dispose` made the kernel's first `using` throw
// "Object is not disposable." when a closed loop was drawn, so nothing could
// be extruded. The spec draws a rectangle, which must give a profile, and
// extrudes it, which must produce a body. The rest of the suite stays on
// Chromium. Playwright's WebKit (26.6) has Symbol.dispose itself, so this is a
// canary for WebKit as a whole (WASM threads under COOP/COEP, WebGL, the
// kernel worker) rather than proof of the polyfill; WebKit 26.0, which lacks
// the symbol, verified the polyfill by hand (docs/agent/e2e-notes.md).

test.use({ viewport: { width: 1440, height: 900 } });
test.describe.configure({ timeout: 90_000 });

const attr = async (el: Locator, name: string) => (await el.getAttribute(name)) ?? '';

let errors: string[] = [];

test.beforeEach(async ({ page }) => {
  errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

test('a rectangle gives a profile and extrudes to a body', async ({ page }) => {
  const at = await sketchOnXY(page);
  const viewport = page.getByRole('region', { name: 'Viewport' });
  const click = clicker(page, at);
  const prompt = page.getByRole('status', { name: 'Tool prompt' });

  // A 40 × 30 rectangle from the origin: the closed loop is the first `using`
  // a user meets (profile detection in the sketch feature).
  await page.keyboard.press('r');
  await expect(prompt).toBeVisible();
  await click(0, 0);
  await click(40, 30);
  await page.keyboard.press('Escape');
  await expect(prompt).toHaveCount(0);
  await expect(viewport).toHaveAttribute('data-sketch-profiles', 'profiles=1 holes=0');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.getByRole('button', { name: 'Finish Sketch' }).last().click();
  await kernelReady(page);

  // Extrude the profile by 10 mm: a new body of six faces, 40 × 30 × 10.
  const inside = at(20, 15);
  await page.mouse.move(inside.x, inside.y);
  await page.mouse.click(inside.x, inside.y);
  await expect.poll(() => attr(viewport, 'data-model-selection')).toMatch(/^profile:/);
  await page.keyboard.press('e');
  const extrude = page.getByRole('region', { name: 'Extrude dialog' });
  await expect(extrude).toBeVisible();
  await extrude.getByRole('textbox', { name: 'Distance' }).fill('10');
  await expect(extrude).toHaveAttribute('data-preview-status', 'ok', { timeout: 30_000 });
  await extrude.getByRole('button', { name: 'OK' }).click();
  await expect(extrude).toBeHidden();
  await kernelReady(page);
  await expect(viewport).toHaveAttribute('data-bodies', 'Body1:6:40,30,10');
  await expect(page.getByRole('alert')).toHaveCount(0);
});
