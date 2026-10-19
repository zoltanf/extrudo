import { expect, type Page, test } from '@playwright/test';
import { clicker, counts, sketchOnXY } from './helpers';

// ADR-0093 (#61): the Sketch Dimension tool picks the origin and the origin
// axes. A line dimensioned to the Y axis projects the axis as a construction
// line and moves the line to the typed distance; a line end dimensioned to
// the origin projects the origin point.

test.use({ viewport: { width: 1440, height: 900 } });
test.describe.configure({ timeout: 120_000 });

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
const viewportOf = (page: Page) => page.getByRole('region', { name: 'Viewport' });

/** The screen length of the last dimension's line, in sketch mm. */
async function dimensionLength(page: Page, perPixel: number) {
  const line = page.locator('[data-dimension-graphic] line').last();
  const [x1, y1, x2, y2] = await Promise.all(
    ['x1', 'y1', 'x2', 'y2'].map(async (a) => Number(await line.getAttribute(a))),
  );
  return Math.hypot((x2 ?? 0) - (x1 ?? 0), (y2 ?? 0) - (y1 ?? 0)) * perPixel;
}

test('dimensions a line to the Y axis and its end to the origin', async ({ page }) => {
  const at = await sketchOnXY(page);
  const click = clicker(page, at);
  const perPixel = 10 / (at(10, 0).x - at(0, 0).x);
  const viewport = viewportOf(page);

  // A vertical line right of the Y axis.
  await page.keyboard.press('l');
  await click(30, -10);
  await click(30, 10);
  await page.keyboard.press('Escape');

  // Dimension: the line, then the parallel Y axis: no placement click (ADR-0093).
  await page.keyboard.press('d');
  await click(30, 5);
  await expect(toolPrompt(page)).toHaveText(
    'Click to place the length, or pick a second line or a point.',
  );
  await click(0, 25);
  // The dimension lands once the kernel has projected the axis, and opens for editing.
  const value = page.getByRole('textbox', { name: 'Value of d1' });
  await expect(value).toBeFocused({ timeout: 60_000 });
  await expect(value).toHaveValue('30');
  await page.keyboard.type('20');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await counts(page)).dimensions).toBe(1);
  await expect(labels(page)).toHaveText(['20.00']);
  expect(await dimensionLength(page, perPixel)).toBeCloseTo(20, 1);
  // The axis came in as a 100 mm construction line on x = 0.
  await expect(viewport).toHaveAttribute('data-sketch-projected', /:curves=1:x=0\.\.0:y=-50\.\.50/);

  // The line's top end, now at (20, 10), to the origin.
  await expect(toolPrompt(page)).toHaveText('Pick a line, circle or arc to dimension, or a point.');
  await click(20, 10);
  await click(0, 0);
  await click(-8, 5); // left of both: the vertical distance
  const second = page.getByRole('textbox', { name: 'Value of d2' });
  await expect(second).toBeFocused({ timeout: 60_000 });
  await expect(second).toHaveValue('10');
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await counts(page)).dimensions).toBe(2);
  // Two projections now: the origin point adds a point at (0, 0), no curve.
  await expect(viewport).toHaveAttribute('data-sketch-projected', /:curves=1:x=0\.\.0:y=-50\.\.50/);
  await expect(labels(page)).toHaveText(['20.00', '10.00']);
});
