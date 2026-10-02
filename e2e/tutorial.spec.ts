import { expect, type Page, test } from '@playwright/test';
import { chip, clickEdge, turnView, viewportOf } from './benchmark-helpers';
import { clicker, kernelReady, mapping } from './helpers';

// P3-12: the first-run tutorial (ADR-0052). The home screen offers it once;
// the card follows the real design (a sketch, four lines, a dimension, an
// extrude, a fillet), points at the control to use, and can be closed with
// Esc or restarted from Help and Ctrl+K.

test.use({ viewport: { width: 1440, height: 900 } });
test.setTimeout(120_000);

let errors: string[] = [];

test.beforeEach(async ({ page }) => {
  errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

const card = (page: Page) => page.getByRole('region', { name: 'Tutorial' });
const step = (page: Page) => card(page).getAttribute('data-tutorial-step');

test('offers the tour on the home screen once, and Help restarts it', async ({ page }) => {
  await page.goto('./');
  await expect(page.getByRole('button', { name: 'Take the tour' })).toBeVisible();
  // Dismissing it is remembered.
  await page.getByRole('button', { name: 'Dismiss the tour' }).click();
  await expect(page.getByRole('button', { name: 'Take the tour' })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Your designs' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Take the tour' })).toHaveCount(0);

  // A new design shows the hint; Help › Tutorial starts the tour in it, at once.
  await page.getByRole('button', { name: 'New design' }).click();
  await expect(page.locator('[data-viewport-hint]')).toBeVisible();
  await page.getByRole('button', { name: 'Help' }).click();
  await page.getByRole('menuitem', { name: 'Tutorial' }).click();
  await expect(card(page)).toBeVisible();
  await expect(card(page)).toContainText('Step 1 of 5');
  // The card takes the hint's place, and points at Create Sketch.
  await expect(page.locator('[data-viewport-hint]')).toHaveCount(0);
  await expect(page.locator('[data-tutorial-ring="sketch"]')).toBeVisible();

  // Esc closes it while focus is in the card; Ctrl+K brings it back.
  await card(page).getByRole('button', { name: 'Skip step' }).focus();
  await page.keyboard.press('Escape');
  await expect(card(page)).toHaveCount(0);
  await page.keyboard.press('Control+k');
  await page.keyboard.type('Tutorial');
  await page.keyboard.press('Enter');
  await expect(card(page)).toContainText('Step 1 of 5');

  // Skipping a step moves to the next.
  await card(page).getByRole('button', { name: 'Skip step' }).click();
  await expect(card(page)).toContainText('Step 2 of 5');
  await card(page).getByRole('button', { name: 'Close tutorial' }).click();
  await expect(card(page)).toHaveCount(0);
});

test('walks the tour: a sketch, a rectangle, a size, an extrude and a fillet', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('button', { name: 'Take the tour' }).click();
  await expect(page).toHaveURL(/#\/p\/[0-9a-f-]+$/);
  const viewport = viewportOf(page);
  await expect(viewport).toHaveAttribute('data-ready', 'true');
  await expect(
    page.getByRole('button', { name: 'Project name: My first box. Rename' }),
  ).toBeVisible();
  await expect(card(page)).toContainText('Step 1 of 5');
  expect(await step(page)).toBe('sketch');
  await expect(page.locator('[data-tutorial-ring="sketch"]')).toBeVisible();

  // 1. Create Sketch, then a plane: the card moves on by itself.
  await page.getByRole('button', { name: 'Create Sketch' }).click();
  await expect(card(page)).toContainText('Now click the XY plane');
  await page
    .getByRole('region', { name: 'Create Sketch' })
    .getByRole('button', { name: 'XY' })
    .click();
  await expect(card(page)).toContainText('Step 2 of 5');
  await expect(page.locator('[data-tutorial-ring="rectangle"]')).toBeVisible();
  await expect(viewport).toHaveAttribute('data-camera-direction', '0,0,-1');
  const at = await mapping(viewport);
  const click = clicker(page, at);

  // 2. A rectangle.
  await page.getByRole('button', { name: /^Rectangle/ }).click();
  await click(-20, -10);
  await click(20, 10);
  await page.keyboard.press('Escape');
  await expect(card(page)).toContainText('Step 3 of 5');
  await expect(page.locator('[data-tutorial-ring="dimension"]')).toBeVisible();

  // 3. A dimension: the bottom side, labelled below it, set to 40.
  await page.getByRole('button', { name: /^Dimension/ }).click();
  await click(0, -10);
  await click(0, -16);
  await page.keyboard.type('40');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  await expect(card(page)).toContainText('Step 4 of 5');
  // In the sketch the card points at Finish Sketch, outside it at Extrude.
  await expect(page.locator('[data-tutorial-ring="finishSketch"]')).toBeVisible();
  await page.getByRole('button', { name: 'Finish Sketch' }).last().click();
  await expect(chip(page, 'Sketch1')).toBeVisible();
  await expect(page.locator('[data-tutorial-ring="extrude"]')).toBeVisible();

  // 4. Extrude the profile (selected in the model first), 15 mm.
  const world = await turnView(page, 'Shift+1');
  const centre = world([0, 0, 0]);
  await page.mouse.move(centre.x, centre.y);
  await page.mouse.click(centre.x, centre.y);
  await expect.poll(() => viewport.getAttribute('data-model-selection')).toMatch(/^profile:/);
  await page.getByRole('button', { name: /^Extrude/ }).click();
  const dialog = page.getByRole('region', { name: 'Extrude dialog' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('textbox', { name: 'Distance' }).fill('15');
  await expect(dialog).toHaveAttribute('data-preview-status', 'ok', { timeout: 15_000 });
  await dialog.getByRole('button', { name: 'OK' }).click();
  await expect(chip(page, 'Extrude1')).toBeVisible();
  await kernelReady(page);
  await expect(card(page)).toContainText('Step 5 of 5');
  await expect(page.locator('[data-tutorial-ring="fillet"]')).toBeVisible();

  // 5. Round the box's top front edge with a fillet.
  const home = await turnView(page, 'Shift+1');
  await clickEdge(page, home, [0, -10, 15]);
  await page.getByRole('button', { name: /^Fillet/ }).click();
  const fillet = page.getByRole('region', { name: 'Fillet dialog' });
  await expect(fillet).toBeVisible();
  await expect(fillet).toHaveAttribute('data-preview-status', 'ok', { timeout: 15_000 });
  await fillet.getByRole('button', { name: 'OK' }).click();
  await expect(chip(page, 'Fillet1')).toBeVisible();

  // Done: the card says so, and carrying on closes it.
  expect(await step(page)).toBe('finished');
  await expect(card(page)).toContainText('You made a box');
  await card(page).getByRole('button', { name: 'Keep designing' }).click();
  await expect(card(page)).toHaveCount(0);

  // Finished, the tour isn't offered again.
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Your designs' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Take the tour' })).toHaveCount(0);
});
