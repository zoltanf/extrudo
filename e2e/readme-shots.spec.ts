import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, type Page, test } from '@playwright/test';
import { chip } from './benchmark-helpers';
import {
  clicker,
  kernelReady,
  mapping,
  newSketchOnXY,
  openProject,
  pickTool,
  selectTab,
} from './helpers';

// The README's pictures, recorded from the real app at 1440 × 900, each scene in the light and
// the dark theme (the app follows the system's colour scheme until a theme is picked):
//
//   pnpm demos -g readme       (builds, then records; --skip-build when dist is current)
//
// It writes docs/images/readme/<scene>-<theme>.webp, so it only runs with RECORD_ASSETS=1. The
// shots are WebP at quality 90 (Chromium's encoder, in a blank page): 256-colour PNGs band the
// view's gradient. The status bar's render rate, recompute time and "Software rendering" are
// hidden with e2e/screenshot.css, as in the tutorials' pictures.
test.skip(!process.env.RECORD_ASSETS, 'RECORD_ASSETS=1 rewrites the README pictures');
test.use({ viewport: { width: 1440, height: 900 } });
test.describe.configure({ timeout: 120_000 });

const IMAGES = join(process.cwd(), 'docs', 'images', 'readme');
const STYLE = join(process.cwd(), 'e2e', 'screenshot.css');

/** Re-encodes a PNG screenshot as WebP in a blank page of the same browser. */
async function webp(page: Page, png: Buffer): Promise<Buffer> {
  const blank = await page.context().newPage();
  const base64: string = await blank.evaluate(
    `(async (b64) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      canvas.getContext('2d').drawImage(bitmap, 0, 0);
      const blob = await canvas.convertToBlob({ type: 'image/webp', quality: 0.9 });
      const out = new Uint8Array(await blob.arrayBuffer());
      let s = '';
      for (let i = 0; i < out.length; i += 0x8000) s += String.fromCharCode(...out.subarray(i, i + 0x8000));
      return btoa(s);
    })(${JSON.stringify(png.toString('base64'))})`,
  );
  await blank.close();
  return Buffer.from(base64, 'base64');
}

/** Lets the view settle with the pointer out of the way, then saves the whole window. */
async function shoot(page: Page, scene: string, theme: string) {
  await page.mouse.move(1430, 450);
  await page.waitForTimeout(1500);
  await mkdir(IMAGES, { recursive: true });
  await writeFile(
    join(IMAGES, `${scene}-${theme}.webp`),
    await webp(page, await page.screenshot({ style: await readFile(STYLE, 'utf8') })),
  );
}

async function bracket(page: Page) {
  await openProject(page, 'wall-bracket');
  await kernelReady(page);
}

const scenes: Record<string, (page: Page) => Promise<void>> = {
  async home(page) {
    await page.goto('./');
    await expect(
      page.getByRole('button', { name: 'Start from the Wall bracket template' }),
    ).toBeVisible();
  },
  async model(page) {
    await bracket(page);
  },
  async sketch(page) {
    await bracket(page);
    await chip(page, 'Sketch1').dblclick();
    await expect(page.getByRole('region', { name: 'Sketch palette' })).toBeVisible();
  },
  async drawing(page) {
    // A plate with a hole on XY, dimensioned: the 2D sketch view, top down.
    await openProject(page);
    const viewport = page.getByRole('region', { name: 'Viewport' });
    const home = await newSketchOnXY(page);
    const centre = home(0, 0);
    await page.mouse.move(centre.x, centre.y);
    const size = async () => Number(await viewport.getAttribute('data-camera-size'));
    for (let before = await size(); before > 110; before = await size()) {
      await page.mouse.wheel(0, -100);
      await expect.poll(size).not.toBe(before);
    }
    const click = clicker(page, await mapping(viewport));
    // Snap to grid rounds the picks: the circle's radius is 10.
    await page.keyboard.press('r');
    await click(-30, -20);
    await click(30, 20);
    await page.keyboard.press('Escape');
    await page.keyboard.press('c');
    await click(0, 0);
    await click(10, 0);
    await page.keyboard.press('Escape');
    await page.keyboard.press('d');
    for (const [pick, place, value] of [
      [[0, -20], [0, -28], '60'],
      [[-30, 0], [-38, 0], '40'],
      [[10 * Math.SQRT1_2, 10 * Math.SQRT1_2], [16, 16], '20'],
    ] as const) {
      await click(pick[0], pick[1]);
      await click(place[0], place[1]);
      const input = page.getByRole('textbox', { name: /^Value of d\d+$/ });
      await expect(input).toBeFocused();
      await input.fill(value);
      await input.press('Enter');
      await expect(page.locator('[data-dimension-editor]')).toHaveCount(0);
    }
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-dimension]')).toHaveCount(3);
  },
  async fillet(page) {
    await bracket(page);
    await chip(page, 'Fillet1').dblclick();
    const dialog = page.getByRole('region', { name: 'Edit Fillet1 dialog' });
    await expect(dialog).toHaveAttribute('data-preview-status', 'ok', { timeout: 15_000 });
  },
  async assembly(page) {
    await page.goto('./');
    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.getByRole('button', { name: 'Import…', exact: true }).click(),
    ]);
    await chooser.setFiles('fixtures/components/hinge.extrudo');
    await expect(page).toHaveURL(/#\/p\/[^/]+$/);
    await kernelReady(page);
    await page.keyboard.press('F6');
  },
  async print(page) {
    await bracket(page);
    await selectTab(page, 'Make');
    await pickTool(page, 'Print Info');
    await expect(page.getByRole('region', { name: 'Print Info' })).toHaveAttribute(
      'data-print-state',
      'ready',
      { timeout: 20_000 },
    );
  },
  async customizer(page) {
    await bracket(page);
    await pickTool(page, 'Customizer');
    await expect(page.getByRole('region', { name: 'Customizer' })).toHaveAttribute(
      'data-customizer-state',
      /.+/,
    );
  },
};

for (const theme of ['light', 'dark'] as const) {
  test.describe(theme, () => {
    test.use({ colorScheme: theme });
    for (const [scene, setUp] of Object.entries(scenes)) {
      test(scene, async ({ page }) => {
        await setUp(page);
        await shoot(page, scene, theme);
      });
    }
  });
}
