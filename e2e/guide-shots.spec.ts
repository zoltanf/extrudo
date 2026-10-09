import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { expect, type Page, test } from '@playwright/test';
import { chip } from './benchmark-helpers';
import {
  clicker,
  counts,
  kernelReady,
  mapping,
  newSketchOnXY,
  openProject,
  pickTool,
  selectTab,
} from './helpers';
import { indexed } from './indexed-png';

// The pictures of the concept guide (docs/guide/*.md, P6-06 slice S6), recorded from the
// real app at 1440 × 900 in the dark theme:
//
//   RECORD_ASSETS=1 pnpm exec playwright test e2e/guide-shots.spec.ts
//
// It writes into docs/guide/images/<page>/, so it only runs with RECORD_ASSETS=1. Every shot
// goes through `indexed` (e2e/indexed-png.ts, 256 colours) to stay under about 150 kB.
test.skip(!process.env.RECORD_ASSETS, 'RECORD_ASSETS=1 rewrites the guide pictures');
test.use({ viewport: { width: 1440, height: 900 } });
test.describe.configure({ timeout: 120_000 });

const IMAGES = join(process.cwd(), 'docs', 'guide', 'images');
const out = (page: string, name: string) => join(IMAGES, page, `${name}.png`);

async function ensureDir(file: string) {
  await mkdir(dirname(file), { recursive: true });
}

async function save(
  page: Page,
  file: string,
  clip?: { x: number; y: number; width: number; height: number },
) {
  await writeFile(file, await indexed(page, await page.screenshot(clip ? { clip } : {})));
}

/** Numbered badges over the page (CSSOM only: the app's content policy refuses a style attribute). */
async function badges(page: Page, marks: readonly [number, number, number][]) {
  await page.evaluate(
    `(${JSON.stringify(marks)}).forEach(([n, x, y]) => {
      const el = document.createElement('div');
      el.textContent = String(n);
      const s = el.style;
      s.position = 'fixed';
      s.left = x - 12 + 'px';
      s.top = y - 12 + 'px';
      s.width = '24px';
      s.height = '24px';
      s.borderRadius = '12px';
      s.background = '#ffb020';
      s.color = '#1a1a1a';
      s.font = '700 14px sans-serif';
      s.display = 'flex';
      s.alignItems = 'center';
      s.justifyContent = 'center';
      s.zIndex = '99999';
      s.pointerEvents = 'none';
      document.body.appendChild(el);
    })`,
  );
}

test('the layout of the app', async ({ page }) => {
  await openProject(page, 'wall-bracket');
  await kernelReady(page);
  await page.waitForTimeout(1500);
  await badges(page, [
    [1, 1200, 20],
    [2, 1120, 75],
    [3, 130, 128],
    [4, 1075, 818],
    [5, 440, 876],
    [6, 930, 876],
  ]);
  const file = out('getting-started', 'layout');
  await ensureDir(file);
  await save(page, file, undefined);
});

test('constraint colours', async ({ page }) => {
  await openProject(page);
  const viewport = page.getByRole('region', { name: 'Viewport' });
  const home = await newSketchOnXY(page);
  const centre = home(50, 20);
  await page.mouse.move(centre.x, centre.y);
  const size = async () => Number(await viewport.getAttribute('data-camera-size'));
  for (let before = await size(); before < 300; before = await size()) {
    await page.mouse.wheel(0, 100);
    await expect.poll(size).not.toBe(before);
  }
  const at = await mapping(viewport);
  const click = clicker(page, at);
  // A rectangle on the origin with both sides dimensioned is fully constrained; the circle is not.
  await page.keyboard.press('r');
  await click(0, 0);
  await click(40, 30);
  await page.keyboard.press('Escape');
  await page.keyboard.press('c');
  await click(70, 20);
  await click(80, 20);
  await page.keyboard.press('Escape');
  await page.keyboard.press('d');
  const dimension = async (picks: (readonly [number, number])[], expr: string) => {
    for (const [x, y] of picks) await click(x, y);
    const value = page.getByRole('textbox', { name: /^Value of d\d+$/ });
    await expect(value).toBeFocused();
    await value.fill(expr);
    await value.press('Enter');
    await expect(page.locator('[data-dimension-editor]')).toHaveCount(0);
  };
  await dimension(
    [
      [20, 0],
      [20, -10],
    ],
    '40',
  );
  await dimension(
    [
      [0, 15],
      [-10, 15],
    ],
    '30',
  );
  await page.keyboard.press('Escape');
  const palette = page.getByRole('region', { name: 'Sketch palette' });
  await expect(palette.locator('[data-constraint-state]')).toHaveText('3 DOF left');
  expect(await counts(page)).toMatchObject({ lines: 4, circles: 1 });
  await page.mouse.move(at(100, 80).x, at(100, 80).y);
  await page.waitForTimeout(500);
  const file = out('sketching', 'constraints');
  await ensureDir(file);
  await save(page, file, { x: 860, y: 250, width: 580, height: 450 });
});

test('the timeline rolled back', async ({ page }) => {
  await openProject(page, 'wall-bracket');
  await kernelReady(page);
  await chip(page, 'Extrude1').click({ button: 'right' });
  await page.getByRole('menuitem', { name: /^Roll Back to Here/ }).click();
  await expect(page.getByRole('slider', { name: 'Timeline marker' })).toHaveAttribute(
    'aria-valuenow',
    '2',
  );
  await page.evaluate('document.activeElement && document.activeElement.blur()');
  await page.keyboard.press('Escape');
  await page.mouse.move(1100, 250);
  await page.waitForTimeout(1500);
  const file = out('features-and-timeline', 'timeline');
  await ensureDir(file);
  await save(page, file, { x: 0, y: 850, width: 560, height: 50 });
});

test('the Parameters dialog', async ({ page }) => {
  await openProject(page, 'wall-bracket');
  await kernelReady(page);
  await pickTool(page, 'Parameters');
  const dialog = page.getByRole('dialog', { name: 'Parameters' });
  await expect(dialog).toBeVisible();
  await page.waitForTimeout(800);
  const file = out('parameters', 'dialog');
  await ensureDir(file);
  await writeFile(file, await indexed(page, await dialog.screenshot()));
});

// Part 2 (P6-06 slice S7): bodies, printing and files.
test('the browser with its folders', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('button', { name: 'Start from the Box with a lid template' }).click();
  await expect(page).toHaveURL(/#\/p\/[0-9a-f-]+$/);
  await kernelReady(page);
  await pickTool(page, 'Section Analysis');
  const panel = page.getByRole('region', { name: 'Section Analysis' });
  await panel.getByRole('button', { name: 'XY plane' }).click();
  await panel.getByRole('button', { name: 'Done' }).click();
  await page.mouse.move(900, 450);
  await page.waitForTimeout(1500);
  const browser = page.getByRole('complementary', { name: 'Browser' });
  const box = await browser.boundingBox();
  if (!box) throw new Error('no browser');
  const file = out('bodies', 'browser');
  await ensureDir(file);
  await save(page, file, {
    x: Math.max(0, box.x - 8),
    y: Math.max(0, box.y - 8),
    width: box.width + 16,
    height: Math.min(box.height + 16, 600),
  });
});

test('the Export model dialog', async ({ page }) => {
  await openProject(page, 'wall-bracket');
  await kernelReady(page);
  await selectTab(page, '3D Print');
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Export model' });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('[data-export-summary]')).toHaveAttribute(
    'data-export-summary',
    /triangles.*watertight/,
    { timeout: 20_000 },
  );
  await page.waitForTimeout(500);
  const file = out('printing', 'export');
  await ensureDir(file);
  await writeFile(file, await indexed(page, await dialog.screenshot()));
});

test('the Print Info panel', async ({ page }) => {
  await openProject(page, 'wall-bracket');
  await kernelReady(page);
  await pickTool(page, 'Print Info');
  const panel = page.getByRole('region', { name: 'Print Info' });
  await expect(panel).toHaveAttribute('data-print-state', 'ready', { timeout: 20_000 });
  await page.waitForTimeout(500);
  const file = out('printing', 'print-info');
  await ensureDir(file);
  await writeFile(file, await indexed(page, await panel.screenshot()));
});

test('the Versions dialog', async ({ page }) => {
  await openProject(page, 'wall-bracket');
  await kernelReady(page);
  const dialog = page.getByRole('dialog', { name: 'Versions' });
  const texts = ['Bracket as the template made it', 'Before the wall gets thicker'];
  for (const text of texts) {
    await page.getByRole('button', { name: 'Version history' }).click();
    await expect(dialog).toBeVisible();
    await dialog.getByRole('textbox', { name: 'Description' }).fill(text);
    await page.keyboard.press('Enter');
    await expect(dialog).toBeHidden();
  }
  await page.getByRole('button', { name: 'Version history' }).click();
  await expect(dialog.locator('[data-version]')).toHaveCount(2);
  await page.waitForTimeout(500);
  const file = out('files', 'versions');
  await ensureDir(file);
  await writeFile(file, await indexed(page, await dialog.screenshot()));
});
