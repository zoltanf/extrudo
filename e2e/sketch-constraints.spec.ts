import { expect, type Page, test } from '@playwright/test';
import { clicker, counts, sketchOnXY } from './helpers';

// P1-06: constraint glyphs next to the geometry (hover highlights what they
// constrain; click selects; Delete removes), the constraint tools, and the
// palette's "Show constraints" toggle.

test.use({ viewport: { width: 1440, height: 900 } });

let errors: string[] = [];

test.beforeEach(async ({ page }) => {
  errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

const glyphs = (page: Page) => page.locator('[data-constraint]');
const glyph = (page: Page, name: string) =>
  page.getByRole('button', { name: `${name} constraint`, exact: true });
const toolPrompt = (page: Page) => page.getByRole('status', { name: 'Tool prompt' });

test('glyphs show, highlight, select and delete constraints', async ({ page }) => {
  const at = await sketchOnXY(page);
  const click = clicker(page, at);
  await page.keyboard.press('r');
  await click(-30, -20);
  await click(30, 20);
  await page.keyboard.press('Escape');
  await expect(toolPrompt(page)).toHaveCount(0);

  // A rectangle: 4 coincident corners, 2 horizontal and 2 vertical lines.
  await expect(glyphs(page)).toHaveCount(8);
  await expect(glyph(page, 'Coincident')).toHaveCount(4);
  await expect(glyph(page, 'Horizontal')).toHaveCount(2);
  await expect(glyph(page, 'Vertical')).toHaveCount(2);

  // Hovering a glyph highlights the line it holds.
  const top = glyph(page, 'Horizontal').first();
  await top.hover();
  await expect(page.locator('[data-highlight] [data-highlight-entity]')).toHaveCount(1);

  // Click selects; Shift-click adds; Esc clears; Delete removes the selection.
  await top.click();
  await expect(top).toHaveAttribute('aria-pressed', 'true');
  await glyph(page, 'Vertical')
    .first()
    .click({ modifiers: ['Shift'] });
  await expect(page.locator('[data-constraint][aria-pressed="true"]')).toHaveCount(2);
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-constraint][aria-pressed="true"]')).toHaveCount(0);
  await top.click();
  await page.keyboard.press('Delete');
  await expect(glyphs(page)).toHaveCount(7);
  await expect(glyph(page, 'Horizontal')).toHaveCount(1);
  await page.keyboard.press('Control+Z');
  await expect(glyphs(page)).toHaveCount(8);

  // A click on empty space clears the selection.
  await glyph(page, 'Vertical').first().click();
  const empty = at(0, 60);
  await page.mouse.click(empty.x, empty.y);
  await expect(page.locator('[data-constraint][aria-pressed="true"]')).toHaveCount(0);

  // The wheel still zooms over a glyph.
  const viewport = page.getByRole('region', { name: 'Viewport' });
  const size = await viewport.getAttribute('data-camera-size');
  await glyph(page, 'Vertical').first().hover();
  await page.mouse.wheel(0, -200);
  await expect(viewport).not.toHaveAttribute('data-camera-size', size ?? '');

  // The palette hides them all.
  const palette = page.getByRole('region', { name: 'Sketch palette' });
  await palette.getByRole('checkbox', { name: 'Show constraints' }).uncheck();
  await expect(glyphs(page)).toHaveCount(0);
  await palette.getByRole('checkbox', { name: 'Show constraints' }).check();
  await expect(glyphs(page)).toHaveCount(8);
});

test('constraint tools pick geometry, add solved constraints and refuse redundant ones', async ({
  page,
}) => {
  const at = await sketchOnXY(page);
  const click = clicker(page, at);
  await page.keyboard.press('l');
  // Two lines at odd angles; Ctrl turns inference off, so nothing is inferred.
  await page.keyboard.down('Control');
  await click(-35, -25);
  await click(15, -17);
  await page.keyboard.up('Control');
  await page.keyboard.press('Escape');
  await page.keyboard.down('Control');
  await click(-35, 12);
  await click(15, 31);
  await page.keyboard.up('Control');
  await page.keyboard.press('Escape');
  expect((await counts(page)).constraints).toBe(0);

  await page
    .getByRole('group', { name: 'Constraints' })
    .getByRole('button', { name: 'Parallel', exact: true })
    .click();
  await expect(toolPrompt(page)).toHaveText('Pick a line.');
  // Hovering shows what a click would pick.
  const first = at(-10, -21);
  await page.mouse.move(first.x, first.y);
  await expect(page.locator('[data-preview="hover"] [data-highlight-entity]')).toHaveCount(1);
  await click(-10, -21);
  await expect(toolPrompt(page)).toHaveText('Pick a line to make parallel to it.');
  await click(-10, 21.5);
  await expect(glyph(page, 'Parallel')).toHaveCount(2);
  expect((await counts(page)).constraints).toBe(1);

  // Again: the sketch already holds it.
  await click(-10, -21);
  await click(-10, 21.5);
  await expect(toolPrompt(page)).toHaveText("Parallel isn't needed: the sketch already holds it.");
  expect((await counts(page)).constraints).toBe(1);

  // Esc leaves the tool; the glyphs become clickable, and Esc again is harmless.
  await page.keyboard.press('Escape');
  await expect(toolPrompt(page)).toHaveCount(0);
  await page.keyboard.press('Escape');
  await glyph(page, 'Parallel').first().click();
  await page.keyboard.press('Delete');
  await expect(glyphs(page)).toHaveCount(0);
});
