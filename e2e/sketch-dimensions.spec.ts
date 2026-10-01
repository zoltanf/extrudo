import { expect, type Page, test } from '@playwright/test';
import { clicker, mapping, sketchOnXY } from './helpers';

// P1-07: the Sketch Dimension tool (D), editing values in place, dragging
// labels, driven dimensions, and dimensions as parameters.

test.use({ viewport: { width: 1440, height: 900 } });

let errors: string[] = [];

test.beforeEach(async ({ page }) => {
  errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

const labels = (page: Page) => page.locator('[data-dimension]');
const toolPrompt = (page: Page) => page.getByRole('status', { name: 'Tool prompt' });
const editor = (page: Page) => page.locator('[data-dimension-editor]');

/** The screen length of the dimension's line (its last line), in sketch mm. */
async function dimensionLength(page: Page, perPixel: number) {
  const line = page.locator('[data-dimension-graphic] line').last();
  const [x1, y1, x2, y2] = await Promise.all(
    ['x1', 'y1', 'x2', 'y2'].map(async (a) => Number(await line.getAttribute(a))),
  );
  return Math.hypot((x2 ?? 0) - (x1 ?? 0), (y2 ?? 0) - (y1 ?? 0)) * perPixel;
}

test('the Dimension tool places a length, and its value drives the line', async ({ page }) => {
  const at = await sketchOnXY(page);
  const click = clicker(page, at);
  const perPixel = 10 / (at(10, 0).x - at(0, 0).x);
  await page.keyboard.press('l');
  await click(-20, 0);
  await click(20, 0);
  await page.keyboard.press('Escape');

  await page.keyboard.press('d');
  await expect(toolPrompt(page)).toHaveText('Pick a line, circle or arc to dimension, or a point.');
  await click(0, 0);
  await expect(toolPrompt(page)).toHaveText(
    'Click to place the length, or pick a second line or a point.',
  );
  const place = at(0, 12);
  await page.mouse.move(place.x, place.y);
  await expect(page.locator('[data-preview="dimension-label"]')).toHaveText('40.00');
  await page.mouse.click(place.x, place.y);

  // The new dimension opens for editing, its value selected.
  const value = page.getByRole('textbox', { name: 'Value of d1' });
  await expect(value).toBeFocused();
  await expect(value).toHaveValue('40');
  await page.keyboard.type('25');
  await page.keyboard.press('Enter');
  await expect(editor(page)).toHaveCount(0);
  await expect(labels(page)).toHaveText(['25.00']);
  expect(await dimensionLength(page, perPixel)).toBeCloseTo(25, 1);

  // One undo step takes the value back, and the line with it.
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+Z');
  await expect(labels(page)).toHaveText(['40.00']);
  expect(await dimensionLength(page, perPixel)).toBeCloseTo(40, 1);
});

test('labels select, drag, edit, turn driven and delete', async ({ page }) => {
  const at = await sketchOnXY(page);
  const click = clicker(page, at);
  await page.keyboard.press('c');
  await click(0, 0);
  await click(10, 0);
  await page.keyboard.press('Escape');

  // A circle gets its diameter; Esc closes the editor as it is.
  await page.keyboard.press('d');
  await click(10, 0);
  await click(18, 18);
  await expect(editor(page)).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(editor(page)).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(toolPrompt(page)).toHaveCount(0);
  const label = labels(page).first();
  await expect(label).toHaveText('⌀20.00');

  // Click selects; hovering highlights the circle.
  await label.hover();
  await expect(page.locator('[data-highlight-entity]')).toHaveCount(1);
  await label.click();
  await expect(label).toHaveAttribute('aria-pressed', 'true');

  // Dragging moves the label, as one undo step.
  const before = await label.boundingBox();
  if (!before) throw new Error('no label');
  const cx = before.x + before.width / 2;
  const cy = before.y + before.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 60, cy + 30, { steps: 5 });
  await page.mouse.up();
  const after = await label.boundingBox();
  expect((after?.x ?? 0) - before.x).toBeCloseTo(60, -1);
  expect((after?.y ?? 0) - before.y).toBeCloseTo(30, -1);
  await page.keyboard.press('Control+Z');
  await expect.poll(async () => (await label.boundingBox())?.x).toBeCloseTo(before.x, 0);

  // Double-click edits; the editor turns it driven, and it only measures.
  await label.dblclick();
  await expect(page.getByRole('textbox', { name: 'Value of d1' })).toBeFocused();
  await editor(page).getByRole('checkbox', { name: 'Driven (measures only)' }).check();
  await expect(editor(page)).toContainText('(⌀20.00)');
  await page.keyboard.press('Escape');
  await expect(label).toHaveText('(⌀20.00)');

  // Delete removes the selected dimension; undo brings it back.
  await label.click();
  await page.keyboard.press('Delete');
  await expect(labels(page)).toHaveCount(0);
  await page.keyboard.press('Control+Z');
  await expect(labels(page)).toHaveCount(1);

  // A right-click on a label selects it and opens its menu: Edit Value, Delete (P3-17).
  await page.mouse.click(10, 10);
  await expect(label).toHaveAttribute('aria-pressed', 'false');
  await label.click({ button: 'right' });
  const menu = page.getByRole('menu', { name: 'Dimension menu' });
  await expect(menu).toBeVisible();
  await expect(label).toHaveAttribute('aria-pressed', 'true');
  await menu.getByRole('menuitem', { name: /^Edit Value/ }).click();
  // (Driven now: the editor shows the measured value and the Driven box.)
  await expect(editor(page)).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(editor(page)).toHaveCount(0);
  await label.click({ button: 'right' });
  await menu.getByRole('menuitem', { name: /^Delete/ }).click();
  await expect(labels(page)).toHaveCount(0);
  await page.keyboard.press('Control+Z');
  await expect(labels(page)).toHaveCount(1);

  // The palette hides them.
  const palette = page.getByRole('region', { name: 'Sketch palette' });
  await palette.getByRole('checkbox', { name: 'Show dimensions' }).uncheck();
  await expect(labels(page)).toHaveCount(0);
  await palette.getByRole('checkbox', { name: 'Show dimensions' }).check();
  await expect(labels(page)).toHaveCount(1);
});

test('a dimension is a parameter: the Parameters dialog edits it, and it takes expressions', async ({
  page,
}) => {
  const at = await sketchOnXY(page);
  const click = clicker(page, at);
  await page.keyboard.press('l');
  await click(-20, 0);
  await click(20, 0);
  await page.keyboard.press('Escape');
  await page.keyboard.press('d');
  await click(0, 0);
  await click(0, 12);
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Finish Sketch' }).last().click();

  await page.getByRole('button', { name: 'Parameters', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Parameters' });
  const row = dialog.getByRole('row').filter({ hasText: 'd1' });
  await expect(row).toContainText('Sketch1');
  const d1 = dialog.getByRole('textbox', { name: 'Expression of d1' });
  await expect(d1).toHaveValue('40');

  // A user parameter, then d1 from it.
  await dialog.getByRole('textbox', { name: 'New parameter name' }).fill('w');
  await dialog.getByRole('textbox', { name: 'New parameter expression' }).fill('12');
  await dialog.getByRole('button', { name: 'Add' }).click();
  await d1.fill('w * 2');
  await d1.press('Enter');
  await expect(dialog.getByRole('alert')).toHaveText('');
  // Deleting `w` is refused while d1 uses it.
  await dialog.getByRole('button', { name: 'Delete w' }).click();
  await expect(dialog.getByRole('alert')).toHaveText('w is used by d1. Change that first.');
  await dialog.getByRole('textbox', { name: 'Expression of w' }).fill('15');
  await dialog.getByRole('textbox', { name: 'Expression of w' }).press('Enter');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);

  // The sketch followed: d1 = 2 × 15. Opening it fits the view again.
  await page.getByRole('button', { name: 'Edit Sketch1' }).click();
  await expect(labels(page)).toHaveText(['fx: 30.00']);
  const viewport = page.getByRole('region', { name: 'Viewport' });
  await expect
    .poll(async () => {
      const again = await mapping(viewport);
      return dimensionLength(page, 10 / (again(10, 0).x - again(0, 0).x));
    })
    .toBeCloseTo(30, 1);

  // `name = value` in the editor creates a parameter and uses it (FR-PAR-03).
  await labels(page).first().dblclick();
  const value = page.getByRole('textbox', { name: 'Value of d1' });
  await value.fill('w = 1');
  await expect(editor(page)).toContainText('A parameter named w already exists.');
  await value.fill('len = 35');
  await expect(editor(page)).toContainText('= 35.00 mm');
  await value.press('Enter');
  await expect(labels(page)).toHaveText(['fx: 35.00']);
  await expect(labels(page).first()).toHaveAttribute('title', 'd1 = len');
  await page.keyboard.press('Control+Z');
  await expect(labels(page)).toHaveText(['fx: 30.00']);
});
