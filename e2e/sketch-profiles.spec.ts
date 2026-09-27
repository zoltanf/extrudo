import { expect, type Page, test } from '@playwright/test';
import { clicker, sketchOnXY } from './helpers';

// P1-11: closed profiles are found as geometry is drawn (a hole nested in a
// plate, a line splitting it), hovered and selected where no entity is, shown
// in the properties panel, and hidden with the palette's "Show profiles".

test.use({ viewport: { width: 1440, height: 900 } });

let errors: string[] = [];

test.beforeEach(async ({ page }) => {
  errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

type At = Awaited<ReturnType<typeof sketchOnXY>>;

const summary = (page: Page) =>
  page.getByRole('region', { name: 'Viewport' }).getAttribute('data-sketch-profiles');
const overlay = (page: Page) => page.locator('[data-selected-profiles]');
const selected = async (page: Page) =>
  ((await overlay(page).getAttribute('data-selected-profiles')) ?? '').split(' ').filter(Boolean);
const panel = (page: Page) => page.getByRole('region', { name: 'Selection' });
const prompt = (page: Page) => page.getByRole('status', { name: 'Tool prompt' });

/** A 60 × 40 plate around the origin with a hole of radius 10 around (−10, 0) (grid points: snap is on). */
async function plate(page: Page, at: At) {
  const click = clicker(page, at);
  await page.keyboard.press('r');
  await click(-30, -20);
  await click(30, 20);
  await page.keyboard.press('Escape');
  await expect(prompt(page)).toHaveCount(0);
  await expect.poll(() => summary(page)).toBe('profiles=1 holes=0');
  await page.keyboard.press('c');
  await click(-10, 0);
  await click(-10, 10);
  await page.keyboard.press('Escape');
  await expect(prompt(page)).toHaveCount(0);
  await expect.poll(() => summary(page)).toBe('profiles=2 holes=1');
}

test('profiles nest, hover, select, show their area, and split', async ({ page }) => {
  const at = await sketchOnXY(page);
  await plate(page, at);
  const click = clicker(page, at);

  // Hovering the plate, away from any curve, pre-highlights its profile.
  const inPlate = at(15, 5);
  await page.mouse.move(inPlate.x, inPlate.y);
  await expect(overlay(page)).toHaveAttribute('data-hover-profile', /.+/);

  // A click selects it; the panel shows its area without the hole.
  await click(15, 5);
  await expect.poll(() => selected(page)).toHaveLength(1);
  await expect(panel(page).locator('[data-selection-title]')).toHaveText('Profile');
  await expect(panel(page)).toContainText('Area');
  await expect(panel(page)).toContainText('2085.84 mm²');
  await expect(panel(page)).toContainText('Holes');

  // Shift adds the hole's disc; a click on empty space clears both.
  await page.keyboard.down('Shift');
  await click(-12, 3);
  await page.keyboard.up('Shift');
  await expect.poll(() => selected(page)).toHaveLength(2);
  await expect(panel(page).locator('[data-selection-title]')).toHaveText('2 profiles');
  await click(50, 0);
  await expect.poll(() => selected(page)).toHaveLength(0);

  // A line across the plate splits it (the hole stays in the left part).
  await page.keyboard.press('l');
  await click(10, -30);
  await click(10, 30);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect(prompt(page)).toHaveCount(0);
  await expect.poll(() => summary(page)).toBe('profiles=3 holes=1');

  // Undo takes the split back.
  await page.keyboard.press('Control+z');
  await expect.poll(() => summary(page)).toBe('profiles=2 holes=1');
});

test('"Show profiles" hides the shading and stops picking profiles', async ({ page }) => {
  const at = await sketchOnXY(page);
  await plate(page, at);
  const toggle = page.getByRole('checkbox', { name: 'Show profiles' });
  await expect(toggle).toBeChecked();
  await toggle.uncheck();
  await toggle.blur();
  await expect.poll(() => summary(page)).toBeNull();

  await clicker(page, at)(15, 5);
  await expect.poll(() => selected(page)).toHaveLength(0);
  await expect(panel(page)).toHaveCount(0);

  await toggle.check();
  await expect.poll(() => summary(page)).toBe('profiles=2 holes=1');
});
