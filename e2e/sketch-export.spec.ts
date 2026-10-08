import { readFile } from 'node:fs/promises';
import { type Download, expect, type Page, test } from '@playwright/test';
import { clicker, mapping, openProject, pickTool, sketchOnXY } from './helpers';

// P1-13: a sketch exports to SVG (1 unit = 1 mm, with the size on the root)
// and DXF R12, as its curves or its profiles: from the Sketch tab's Export
// button while editing (selected profiles first), or from a timeline chip's
// menu.

test.use({ viewport: { width: 1440, height: 900 } });

let errors: string[] = [];

test.beforeEach(async ({ page }) => {
  errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

const dialog = (page: Page) => page.getByRole('dialog', { name: 'Export sketch' });
const summary = (page: Page) => dialog(page).locator('[data-export-summary]');
const prompt = (page: Page) => page.getByRole('status', { name: 'Tool prompt' });
/** The Sketch tab's Export Sketch tile (its label is "Export"). */
const exportTile = (page: Page) =>
  page
    .getByRole('group', { name: 'Export' })
    .getByRole('button', { name: 'Export', exact: true })
    .first();

async function save(page: Page, button: string): Promise<{ name: string; text: string }> {
  const [download] = (await Promise.all([
    page.waitForEvent('download'),
    dialog(page).getByRole('button', { name: button }).click(),
  ])) as [Download, unknown];
  const path = await download.path();
  return { name: download.suggestedFilename(), text: await readFile(path, 'utf8') };
}

test('the Sketch tab exports selected profiles as SVG and the curves as DXF', async ({ page }) => {
  const at = await sketchOnXY(page);
  const click = clicker(page, at);
  // A 60 × 40 plate with a hole of radius 10 (grid points: snap is on).
  await page.keyboard.press('r');
  await click(-30, -20);
  await click(30, 20);
  await page.keyboard.press('Escape');
  await page.keyboard.press('c');
  await click(-10, 0);
  await click(-10, 10);
  await page.keyboard.press('Escape');
  await expect(prompt(page)).toHaveCount(0);

  // Select the plate's profile, then Export: the selection is chosen.
  await click(15, 5);
  await expect(page.locator('[data-selected-profiles]')).toHaveAttribute(
    'data-selected-profiles',
    /.+/,
  );
  await exportTile(page).click();
  await expect(dialog(page)).toBeVisible();
  await expect(dialog(page).getByRole('radio', { name: 'Selected profile' })).toBeChecked();
  await expect(summary(page)).toHaveText('1 profile, 60 × 40 mm');

  const svg = await save(page, 'Export SVG');
  expect(svg.name).toBe('Untitled - Sketch1.svg');
  expect(svg.text).toContain('width="60mm" height="40mm" viewBox="-30 -20 60 40"');
  expect(svg.text).toContain('fill-rule="evenodd"');
  // The outer loop and the hole in one path.
  expect(svg.text.match(/<path /g)).toHaveLength(1);
  await expect(dialog(page)).toHaveCount(0);

  // Again, as DXF of all curves: four lines and the circle.
  await exportTile(page).click();
  await dialog(page).getByRole('radio', { name: /^DXF/ }).check();
  await dialog(page).getByRole('radio', { name: 'All curves' }).check();
  await expect(summary(page)).toHaveText('5 curves, 60 × 40 mm');
  const dxf = await save(page, 'Export DXF');
  expect(dxf.name).toBe('Untitled - Sketch1.dxf');
  expect(dxf.text).toContain('AC1009');
  expect(dxf.text.match(/\n {2}0\nLINE\n/g)).toHaveLength(4);
  expect(dxf.text.match(/\n {2}0\nCIRCLE\n/g)).toHaveLength(1);
});

test('a timeline chip exports its sketch; an open sketch has no profiles to export', async ({
  page,
}) => {
  await openProject(page, 'wall-bracket');
  await page
    .getByRole('list', { name: 'Features' })
    .getByRole('button', { name: /^Sketch1/ })
    .click({ button: 'right' });
  await page.getByRole('menuitem', { name: /^Export SVG or DXF/ }).click();
  await expect(dialog(page)).toBeVisible();
  await expect(dialog(page).getByRole('radio', { name: 'All curves' })).toBeChecked();
  await expect(summary(page)).toHaveText(/^\d+ curves?, [\d.]+ × [\d.]+ mm$/);
  const svg = await save(page, 'Export SVG');
  expect(svg.name).toMatch(/Sketch1\.svg$/);
  const [, width, height] = svg.text.match(/width="([\d.]+)mm" height="([\d.]+)mm"/) ?? [];
  expect(Number(width)).toBeGreaterThan(0);
  expect(Number(height)).toBeGreaterThan(0);

  // A sketch with only an open line: no profiles, so nothing to export as profiles.
  await pickTool(page, 'Create Sketch');
  await page
    .getByRole('region', { name: 'Create Sketch' })
    .getByRole('button', { name: 'XY' })
    .click();
  const viewport = page.getByRole('region', { name: 'Viewport' });
  await expect(viewport).toHaveAttribute('data-camera-direction', '0,0,-1');
  const at = await mapping(viewport);
  const click = clicker(page, at);
  await page.keyboard.press('l');
  await click(0, 0);
  await click(20, 0);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect(prompt(page)).toHaveCount(0);
  await exportTile(page).click();
  await dialog(page)
    .getByRole('radio', { name: /^All profiles/ })
    .check();
  await expect(summary(page)).toHaveText(/no closed profiles/);
  await expect(dialog(page).getByRole('button', { name: 'Export SVG' })).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(dialog(page)).toHaveCount(0);
});
