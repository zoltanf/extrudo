import { expect, type Locator, type Page, test } from '@playwright/test';
import { clicker, kernelReady, sketchOnXY } from './helpers';

// P2-07: Revolve in a real project (ADR-0029). A rectangle beside the Y
// axis is revolved about the origin axis (pre-selected with the profile) a
// whole turn, then edited to a quarter; a second rectangle is revolved
// about a sketch line picked in the view, symmetric, half a turn.

test.use({ viewport: { width: 1440, height: 900 } });

let errors: string[] = [];

test.beforeEach(async ({ page }) => {
  errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

const attr = async (el: Locator, name: string) => (await el.getAttribute(name)) ?? '';
const viewportOf = (page: Page) => page.getByRole('region', { name: 'Viewport' });
const chip = (page: Page, name: string) =>
  page
    .getByRole('list', { name: 'Features' })
    .getByRole('button', { name: new RegExp(`^${name}`) });
const prompt = (page: Page) => page.getByRole('status', { name: 'Tool prompt' });

type At = Awaited<ReturnType<typeof sketchOnXY>>;

/** Draws a rectangle from (x0, y0) to (x1, y1) in the open sketch. */
async function rectangle(page: Page, at: At, x0: number, y0: number, x1: number, y1: number) {
  const click = clicker(page, at);
  await page.keyboard.press('r');
  await click(x0, y0);
  await click(x1, y1);
  await page.keyboard.press('Escape');
  await expect(prompt(page)).toHaveCount(0);
}

test('revolves a profile about an origin axis a whole turn, then edits it to a quarter', async ({
  page,
}) => {
  const at = await sketchOnXY(page);
  const viewport = viewportOf(page);
  // 20 × 20 from x = 10: a ring of radii 10 and 30 about Y.
  await rectangle(page, at, 10, 0, 30, 20);
  await page.getByRole('button', { name: 'Finish Sketch' }).last().click();
  await expect(chip(page, 'Sketch1')).toBeVisible();

  // Pre-select the profile and, with Shift, the Y axis; then Revolve.
  const inside = at(20, 10);
  await page.mouse.move(inside.x, inside.y);
  await page.mouse.click(inside.x, inside.y);
  await expect.poll(() => attr(viewport, 'data-model-selection')).toMatch(/^profile:/);
  const onAxis = at(0, 45);
  await page.mouse.move(onAxis.x, onAxis.y);
  await expect.poll(() => attr(viewport, 'data-model-hover')).toBe('axis:origin:y');
  await page.keyboard.down('Shift');
  await page.mouse.click(onAxis.x, onAxis.y);
  await page.keyboard.up('Shift');
  await expect
    .poll(() => attr(viewport, 'data-model-selection'))
    .toMatch(/^profile:\S+ axis:origin:y$/);
  await expect(page.locator('output[aria-label="Selection"]')).toContainText('1 profile, 1 axis');

  await page.getByRole('button', { name: 'Revolve', exact: true }).click();
  const dialog = page.getByRole('region', { name: 'Revolve dialog' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Profiles', exact: true })).toHaveText(
    '1 profile',
  );
  await expect(dialog.getByRole('button', { name: 'Axis', exact: true })).toHaveText('Y axis');
  await expect(dialog.getByRole('textbox', { name: 'Angle' })).toHaveValue('360 deg');
  await expect(dialog.getByRole('combobox', { name: 'Operation' })).toHaveValue('new-body');
  await expect(dialog.getByRole('textbox', { name: 'Angle 2' })).toHaveCount(0);
  await expect(viewport).toHaveAttribute('data-preview', 'new', { timeout: 15_000 });
  await expect(dialog).toHaveAttribute('data-preview-status', 'ok');
  await expect(viewport.locator('[data-manipulators]')).toHaveAttribute(
    'data-manipulators',
    'angle:angle',
  );
  await page.screenshot({ path: test.info().outputPath('full-preview.png') });
  await dialog.getByRole('button', { name: 'OK' }).click();
  await expect(dialog).toBeHidden();
  await expect(chip(page, 'Revolve1')).toBeVisible();
  await kernelReady(page);
  await expect(chip(page, 'Revolve1')).toHaveAccessibleName('Revolve1');
  // A ring: two cylinders and two annuli, 60 wide, 20 tall (along Y), 60 deep.
  await expect(viewport).toHaveAttribute('data-bodies', 'Body1:4:60,20,60');

  // Editing it to a quarter turn: +X turns towards −Z about +Y.
  await chip(page, 'Revolve1').dblclick();
  const edit = page.getByRole('region', { name: 'Edit Revolve1 dialog' });
  await expect(edit).toHaveAttribute('data-dialog-mode', 'edit');
  await expect(edit.getByRole('button', { name: 'Axis', exact: true })).toHaveText('Y axis');
  const angle = edit.getByRole('textbox', { name: 'Angle' });
  await angle.fill('90 deg');
  await expect(viewport).toHaveAttribute('data-preview', 'new', { timeout: 15_000 });
  await expect(edit).toHaveAttribute('data-preview-status', 'ok');
  await page.screenshot({ path: test.info().outputPath('quarter-preview.png') });
  await angle.press('Enter');
  await expect(edit).toBeHidden();
  await kernelReady(page);
  await expect(viewport).toHaveAttribute('data-bodies', 'Body1:6:30,20,30');

  // One undo step each.
  await page.keyboard.press('Control+z');
  await expect(viewport).toHaveAttribute('data-bodies', 'Body1:4:60,20,60');
  await page.keyboard.press('Control+y');
  await expect(viewport).toHaveAttribute('data-bodies', 'Body1:6:30,20,30');
});

test('revolves about a sketch line picked in the view, symmetric, half a turn', async ({
  page,
}) => {
  const at = await sketchOnXY(page);
  const viewport = viewportOf(page);
  const click = clicker(page, at);
  // A 20 × 20 rectangle from x = 10 and a line at x = 40 going up: the axis, 10 to 30 mm away.
  await rectangle(page, at, 10, 0, 30, 20);
  await page.keyboard.press('l');
  await click(40, -10);
  await click(40, 30);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect(prompt(page)).toHaveCount(0);
  await page.getByRole('button', { name: 'Finish Sketch' }).last().click();
  await expect(chip(page, 'Sketch1')).toBeVisible();

  const inside = at(20, 10);
  await page.mouse.move(inside.x, inside.y);
  await page.mouse.click(inside.x, inside.y);
  await expect.poll(() => attr(viewport, 'data-model-selection')).toMatch(/^profile:/);
  await page.getByRole('button', { name: 'Revolve', exact: true }).click();
  const dialog = page.getByRole('region', { name: 'Revolve dialog' });
  const axis = dialog.getByRole('button', { name: 'Axis', exact: true });
  // The axis is the field picks go to now.
  await expect(axis).toHaveAttribute('aria-pressed', 'true');
  await expect(axis).toHaveText('Pick an axis');
  const onLine = at(40, 25);
  await page.mouse.move(onLine.x, onLine.y);
  await page.mouse.click(onLine.x, onLine.y);
  await expect(axis).toHaveText('1 sketch curve');
  await expect(viewport).toHaveAttribute('data-model-selection', /sketchEntity:\S+\/\S+/);

  await dialog.getByRole('combobox', { name: 'Direction' }).selectOption('symmetric');
  await dialog.getByRole('textbox', { name: 'Angle' }).fill('180 deg');
  await expect(viewport).toHaveAttribute('data-preview', 'new', { timeout: 15_000 });
  await expect(dialog).toHaveAttribute('data-preview-status', 'ok');
  await page.screenshot({ path: test.info().outputPath('symmetric-preview.png') });
  await dialog.getByRole('button', { name: 'OK' }).click();
  await expect(dialog).toBeHidden();
  await kernelReady(page);
  await expect(chip(page, 'Revolve1')).toHaveAccessibleName('Revolve1');
  // Half a ring about x = 40: from x = 10 to 40, 20 tall, ±30 deep.
  await expect(viewport).toHaveAttribute('data-bodies', 'Body1:6:30,20,60');

  // Edited to two sides, 90° and 0°: a quarter turn, to one side.
  await chip(page, 'Revolve1').dblclick();
  const edit = page.getByRole('region', { name: 'Edit Revolve1 dialog' });
  await expect(edit.getByRole('button', { name: 'Axis', exact: true })).toHaveText(
    '1 sketch curve',
  );
  await edit.getByRole('combobox', { name: 'Direction' }).selectOption('two-sides');
  await edit.getByRole('textbox', { name: 'Angle', exact: true }).fill('90 deg');
  await edit.getByRole('textbox', { name: 'Angle 2' }).fill('0 deg');
  await expect(viewport.locator('[data-manipulators]')).toHaveAttribute(
    'data-manipulators',
    'angle:angle angle:angle2',
  );
  await expect(edit).toHaveAttribute('data-preview-status', 'ok', { timeout: 15_000 });
  await edit.getByRole('button', { name: 'OK' }).click();
  await expect(edit).toBeHidden();
  await kernelReady(page);
  await expect(viewport).toHaveAttribute('data-bodies', 'Body1:6:30,20,30');
});
