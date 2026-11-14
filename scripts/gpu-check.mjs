#!/usr/bin/env node
// Drives the app in a browser that is already running on another machine, to
// see whether its graphics card keeps the 3D view alive (#259, ADR-0076): CI
// and the dev machines draw with SwiftShader or a recent GPU, so a driver that
// loses the WebGL context only shows on the real thing.
//
//   node scripts/gpu-check.mjs --cdp http://127.0.0.1:9333 --url http://localhost:5173/
//
// On the machine under test, start a second Chromium with a profile of its
// own and a debugging port, on its desktop session:
//
//   chromium --user-data-dir=/tmp/gpu-check --remote-debugging-port=9333 about:blank
//
// From the dev machine, forward that port here and the dev server (or a
// `vite preview`) there, so the page is a secure context on localhost:
//
//   ssh -N -L 9333:127.0.0.1:9333 -R 5173:127.0.0.1:5173 <machine>
//
// What it does: a sketch with a rectangle and two dimensions (each edit saves
// and takes a thumbnail), then the Wall bracket template, an orbit and a Draft
// render. It prints the GPU, the orbit's frame times and every lost context,
// and exits 1 when a context was lost or a step failed. `docs/agent/dev-environment.md`
// has the notes.
import { chromium, expect } from '@playwright/test';

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const cdp = arg('cdp', 'http://127.0.0.1:9333');
const url = arg('url', 'http://localhost:5173/');

const started = Date.now();
const log = (...a) =>
  console.log(`${((Date.now() - started) / 1000).toFixed(1).padStart(6)}s`, ...a);
let losses = 0;
let failed = false;

const browser = await chromium.connectOverCDP(cdp);
const context = browser.contexts()[0];

/** A page of the app that logs the WebGL lines and counts lost contexts. */
async function open() {
  const page = await context.newPage();
  await page.setViewportSize({ width: 1280, height: 720 });
  page.on('console', (message) => {
    const text = message.text().split('\n')[0];
    if (/Context Lost/.test(text)) losses++;
    if (/Context (Lost|Restored)|could not be created/.test(text)) log('  console:', text);
  });
  page.on('pageerror', (error) => log('  page error:', error.message));
  await page.addInitScript(() => {
    window.__extrudoRenderLog = [];
  });
  await page.goto(url);
  return page;
}

const viewportOf = (page) => page.getByRole('region', { name: 'Viewport' });

/** Sketch mm → page px, from the Viewport region's camera attributes. */
async function mapping(page) {
  const viewport = viewportOf(page);
  const box = await viewport.boundingBox();
  const [tx = 0, ty = 0] = ((await viewport.getAttribute('data-camera-target')) ?? '')
    .split(',')
    .map(Number);
  const perPixel = Number(await viewport.getAttribute('data-camera-size')) / box.height;
  const shift = Number((await viewport.getAttribute('data-camera-shift')) ?? 0);
  return (x, y) => ({
    x: box.x + ((1 + shift) * box.width) / 2 + (x - tx) / perPixel,
    y: box.y + box.height / 2 - (y - ty) / perPixel,
  });
}

async function sketch() {
  const page = await open();
  await page.getByRole('button', { name: 'New design' }).click();
  const viewport = viewportOf(page);
  await expect(viewport).toHaveAttribute('data-ready', 'true', { timeout: 90_000 });
  log(
    'GPU:',
    await page.evaluate(() => {
      const gl = document.createElement('canvas').getContext('webgl2');
      const info = gl?.getExtension('WEBGL_debug_renderer_info');
      const text = `${info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : 'unknown'}, MAX_SAMPLES ${gl?.getParameter(gl.MAX_SAMPLES)}, antialiasing ${gl?.getContextAttributes()?.antialias ? 'granted' : 'refused'}`;
      gl?.getExtension('WEBGL_lose_context')?.loseContext();
      return text;
    }),
  );

  await page
    .locator('#toolbar-groups')
    .getByRole('button', { name: 'Create Sketch' })
    .first()
    .click();
  await page
    .getByRole('region', { name: 'Create Sketch' })
    .getByRole('button', { name: 'XY' })
    .click();
  await expect(viewport).toHaveAttribute('data-camera-direction', '0,0,-1');
  await expect(viewport).toHaveAttribute('data-camera-up', '0,1,0');
  // Zoom out so that the rectangle clears the sketch palette.
  const centre = (await mapping(page))(50, 40);
  await page.mouse.move(centre.x, centre.y);
  const size = async () => Number(await viewport.getAttribute('data-camera-size'));
  for (let before = await size(); before < 300; before = await size()) {
    await page.mouse.wheel(0, 100);
    await expect.poll(size).not.toBe(before);
  }
  const at = await mapping(page);
  const click = async (x, y) => {
    const p = at(x, y);
    await page.mouse.move(p.x, p.y);
    await page.mouse.click(p.x, p.y);
  };

  await page.keyboard.press('r');
  await click(0, 0);
  await click(100, 80);
  await page.keyboard.press('Escape');
  log('sketch: rectangle drawn');
  // The save comes 800 ms after an edit, its thumbnail in the next idle moment.
  await page.waitForTimeout(5000);
  await page.keyboard.press('d');
  for (const [pick, place, value] of [
    [[50, 0], [50, -15], '90'],
    [[90, 40], [105, 40], '70'],
  ]) {
    await click(...pick);
    await click(...place);
    const editor = page.getByRole('textbox', { name: /^Value of d\d+$/ });
    await expect(editor).toBeFocused();
    await page.waitForTimeout(4000);
    await editor.fill(value);
    await editor.press('Enter');
    log(`sketch: dimension ${value}`);
    await page.waitForTimeout(4000);
  }
  await page.keyboard.press('Escape');
  await page.waitForTimeout(15_000);
  await page.close();
}

async function model() {
  const page = await open();
  const card = page.getByRole('button', { name: 'Start from the Wall bracket template' });
  if (!(await card.isVisible().catch(() => false)))
    await page.getByRole('button', { name: 'Start from a template', exact: true }).click();
  await card.click();
  const viewport = viewportOf(page);
  await expect(viewport).toHaveAttribute('data-ready', 'true', { timeout: 90_000 });
  await expect(page.getByRole('status', { name: 'Kernel' })).toHaveAttribute(
    'data-model-status',
    'ready',
    { timeout: 90_000 },
  );
  await page.waitForTimeout(4000);

  const box = await viewport.boundingBox();
  const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(centre.x, centre.y);
  const from = await page.evaluate(() => performance.now());
  await page.mouse.down({ button: 'middle' });
  for (let i = 1; i <= 120; i++) {
    const angle = (i / 120) * Math.PI * 4;
    await page.mouse.move(centre.x + Math.cos(angle) * 160, centre.y + Math.sin(angle) * 90);
    await page.waitForTimeout(16);
  }
  await page.mouse.up({ button: 'middle' });
  const frames = await page.evaluate(
    (f) =>
      window.__extrudoRenderLog
        .filter((r) => r.start >= f)
        .map((r) => r.ms)
        .sort((a, b) => a - b),
    from,
  );
  log(
    `model: orbit drew ${frames.length} frames, median ${(frames[frames.length >> 1] ?? 0).toFixed(1)} ms, longest ${(frames.at(-1) ?? 0).toFixed(1)} ms`,
  );

  await page.getByRole('tab', { name: 'Make' }).click();
  await page.getByRole('button', { name: 'Render Picture', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Render picture' });
  await dialog.getByLabel('Draft').check();
  await dialog.getByLabel('Size').selectOption('1280x720');
  await dialog.getByRole('button', { name: 'Render', exact: true }).click();
  const picture = dialog.getByRole('img', { name: /^Rendered picture of/ });
  const message = dialog.locator('[data-render-message]');
  await expect(picture.or(message)).toBeVisible({ timeout: 90_000 });
  if (await picture.isVisible()) log('model: Draft render done');
  else throw new Error(`Draft render: ${await message.innerText()}`);
  await page.waitForTimeout(3000);
  await page.close();
}

for (const [name, step] of [
  ['sketch', sketch],
  ['model', model],
]) {
  try {
    await step();
  } catch (error) {
    failed = true;
    log(`${name} FAILED:`, String(error).split('\n')[0]);
  }
}
log(losses === 0 && !failed ? 'OK: no lost context' : `NOT OK: ${losses} lost context(s)`);
await browser.close();
process.exit(losses === 0 && !failed ? 0 : 1);
