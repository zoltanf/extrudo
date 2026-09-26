import { expect, type Page, test } from '@playwright/test';
import { clicker, counts, pickTool, sketchOnXY } from './helpers';

// P1-05: polygons, slots, ellipses and splines, drawn through the Create menu;
// what landed in the sketch is read from the overlay's summary.

test.use({ viewport: { width: 1440, height: 900 } });

let errors: string[] = [];

test.beforeEach(async ({ page }) => {
  errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

const toolPrompt = (page: Page) => page.getByRole('status', { name: 'Tool prompt' });
const headsUp = (page: Page) => page.getByRole('group', { name: 'Heads-up input' });

test('draws polygons: inscribed with a typed diameter, circumscribed with five sides, from an edge', async ({
  page,
}) => {
  const at = await sketchOnXY(page);
  const click = clicker(page, at);

  await pickTool(page, 'Inscribed Polygon');
  await expect(toolPrompt(page)).toHaveText('Click the center.');
  await click(-30, -20);
  const corner = at(-20, -15);
  await page.mouse.move(corner.x, corner.y);
  await page.keyboard.type('20');
  await page.keyboard.press('Enter');
  // Six edges on a construction circle, with the typed diameter.
  await expect.poll(() => counts(page)).toMatchObject({ lines: 6, circles: 1, dimensions: 1 });

  await pickTool(page, 'Circumscribed Polygon');
  await click(20, -20);
  const flat = at(28, -17);
  await page.mouse.move(flat.x, flat.y);
  await headsUp(page).getByRole('textbox', { name: 'Sides' }).fill('5');
  await click(28, -17);
  // Five more edges, the circle through the corners and the one inside.
  await expect.poll(() => counts(page)).toMatchObject({ lines: 11, circles: 3 });

  await pickTool(page, 'Edge Polygon');
  await click(-35, 15);
  await click(-25, 15);
  await expect(toolPrompt(page)).toHaveText('Click the side the polygon goes on.');
  await click(-30, 25);
  await expect.poll(() => counts(page)).toMatchObject({ lines: 17, circles: 4 });
});

test('draws center-to-center and overall slots', async ({ page }) => {
  const at = await sketchOnXY(page);
  const click = clicker(page, at);

  await pickTool(page, 'Center to Center Slot');
  await click(-40, -25);
  await click(-20, -25);
  await expect(toolPrompt(page)).toHaveText('Click to set the width, or type it.');
  await click(-30, -21);
  // Two edges, a construction centerline and two arcs.
  await expect.poll(() => counts(page)).toMatchObject({ lines: 3, arcs: 2 });

  await pickTool(page, 'Overall Slot');
  await click(0, -25);
  await click(30, -25);
  const side = at(15, -21);
  await page.mouse.move(side.x, side.y);
  await page.keyboard.type('6');
  await page.keyboard.press('Enter');
  await expect.poll(() => counts(page)).toMatchObject({ lines: 6, arcs: 4, dimensions: 1 });
});

test('draws an ellipse and a fit-point spline', async ({ page }) => {
  const at = await sketchOnXY(page);
  const click = clicker(page, at);

  await pickTool(page, 'Ellipse');
  await click(0, 20);
  await click(15, 20);
  const minor = at(5, 26);
  await page.mouse.move(minor.x, minor.y);
  await expect(page.locator('[data-preview="curve"]')).toHaveCount(1);
  await click(5, 26);
  await expect.poll(() => counts(page)).toMatchObject({ ellipses: 1, points: 3 });

  await pickTool(page, 'Fit Point Spline');
  await click(-40, 20);
  await click(-30, 30);
  await click(-20, 20);
  const next = at(-10, 30);
  await page.mouse.move(next.x, next.y);
  await expect(page.locator('[data-preview="curve"]')).toHaveCount(1);
  await expect(toolPrompt(page)).toHaveText('Click the next point, or press Enter to finish.');
  await page.keyboard.press('Enter');
  await expect.poll(() => counts(page)).toMatchObject({ splines: 1, points: 6 });
});
