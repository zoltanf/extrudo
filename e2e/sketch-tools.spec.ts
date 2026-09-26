import { expect, type Page, test } from '@playwright/test';
import { sketchOnXY } from './helpers';

// P1-02: the sketch tool framework, through the Line tool. Pointer positions
// on the sketch plane, snapping and alignment with their auto-constraints,
// the heads-up box, Esc and undo.

test.use({ viewport: { width: 1440, height: 900 } });

let errors: string[] = [];

test.beforeEach(async ({ page }) => {
  errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

const overlay = (page: Page) => page.locator('[data-sketch-summary]');
const toolPrompt = (page: Page) => page.getByRole('status', { name: 'Tool prompt' });
const headsUp = (page: Page) => page.getByRole('group', { name: 'Heads-up input' });

test('draws a closed rectangle with the Line tool, with inferred constraints', async ({ page }) => {
  const at = await sketchOnXY(page);
  await page.keyboard.press('l');
  await expect(page.getByRole('button', { name: 'Line', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(toolPrompt(page)).toHaveText(
    'Click to start a line. Drag from the end of a curve for a tangent arc.',
  );

  const click = async (x: number, y: number) => {
    const p = at(x, y);
    await page.mouse.move(p.x, p.y);
    await page.mouse.click(p.x, p.y);
  };
  // A little off the grid points; the grid (10 mm here) snaps them.
  await click(-30.5, -19.6);
  await expect(toolPrompt(page)).toContainText('Click the next point');
  // Level with the start: a dashed horizontal guide.
  const end = at(30.3, -20.8);
  await page.mouse.move(end.x, end.y);
  await expect(overlay(page).locator('[data-guide="horizontal"]')).toHaveCount(1);
  await expect(headsUp(page).getByRole('textbox', { name: 'Length' })).toHaveValue('60');
  await page.mouse.click(end.x, end.y);
  await click(29.6, 20.4);
  // Level with the anchor, and above the first point: both guides.
  const corner = at(-29.4, 20.3);
  await page.mouse.move(corner.x, corner.y);
  await expect(overlay(page).locator('[data-guide]')).toHaveCount(2);
  await page.mouse.click(corner.x, corner.y);
  // Back at the first point: the endpoint glyph, and the click closes the loop.
  const first = at(-29.8, -20.2);
  await page.mouse.move(first.x, first.y);
  await expect(overlay(page).locator('[data-snap="endpoint"]')).toHaveCount(1);
  await page.mouse.click(first.x, first.y);

  // 4 coincident (3 joins, the closure), horizontal, vertical, horizontal, and
  // the last corner vertical with the first point.
  await expect(overlay(page)).toHaveAttribute(
    'data-sketch-summary',
    'points=8 lines=4 circles=0 arcs=0 ellipses=0 splines=0 constraints=8 dimensions=0',
  );
  await expect(toolPrompt(page)).toHaveText(
    'Click to start a line. Drag from the end of a curve for a tangent arc.',
  );

  // Undo inside the sketch removes the last segment.
  await page.keyboard.press('Control+Z');
  await expect(overlay(page)).toHaveAttribute(
    'data-sketch-summary',
    'points=6 lines=3 circles=0 arcs=0 ellipses=0 splines=0 constraints=6 dimensions=0',
  );
});

test('the heads-up box takes a typed length and angle; Esc steps back', async ({ page }) => {
  const at = await sketchOnXY(page);
  await page.getByRole('button', { name: 'Line', exact: true }).click();
  const start = at(10, 10);
  await page.mouse.move(start.x, start.y);
  await page.mouse.click(start.x, start.y);
  const pointer = at(35, 22);
  await page.mouse.move(pointer.x, pointer.y);

  // Typing goes straight into the Length field; Tab moves to Angle.
  await page.keyboard.type('2*d');
  const length = headsUp(page).getByRole('textbox', { name: 'Length' });
  await expect(length).toBeFocused();
  await expect(length).toHaveValue('2*d');
  // There's no parameter "d": the field says so, and nothing is locked.
  await expect(length).toHaveAttribute('aria-invalid', 'true');
  await page.keyboard.press('Backspace');
  await page.keyboard.type('20');
  await expect(headsUp(page)).toContainText('= 40.00 mm');
  await page.keyboard.press('Tab');
  await expect(headsUp(page).getByRole('textbox', { name: 'Angle' })).toBeFocused();
  await page.keyboard.type('90');
  await page.keyboard.press('Enter');

  // A 40 mm vertical line with its dimension.
  await expect(overlay(page)).toHaveAttribute(
    'data-sketch-summary',
    'points=2 lines=1 circles=0 arcs=0 ellipses=0 splines=0 constraints=1 dimensions=1',
  );
  // The chain goes on from the new end, with the fields live again.
  await page.mouse.move(pointer.x, pointer.y + 1);
  await expect(length).not.toBeFocused();
  await expect(length).not.toHaveValue('2*20');

  // Esc ends the chain, then the tool.
  await page.keyboard.press('Escape');
  await expect(toolPrompt(page)).toHaveText(
    'Click to start a line. Drag from the end of a curve for a tangent arc.',
  );
  await page.keyboard.press('Escape');
  await expect(toolPrompt(page)).toBeHidden();
  await expect(page.getByRole('button', { name: 'Line', exact: true })).not.toHaveAttribute(
    'aria-pressed',
    'true',
  );
});
