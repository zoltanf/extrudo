import { expect, type Page, test } from '@playwright/test';
import { clicker, counts, sketchOnXY } from './helpers';

// P1-09: selecting sketch geometry (click, Shift-click, window and crossing
// boxes), dragging it with a live solve, deleting it with its constraints,
// and the properties panel.

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

const overlay = (page: Page) => page.locator('[data-selected-entities]');
const selected = async (page: Page) =>
  ((await overlay(page).getAttribute('data-selected-entities')) ?? '').split(' ').filter(Boolean);
const panel = (page: Page) => page.getByRole('region', { name: 'Selection' });

/** A 60 × 40 rectangle around the origin; the tool is left afterwards. */
async function rectangle(page: Page, at: At) {
  const click = clicker(page, at);
  await page.keyboard.press('r');
  await click(-30, -20);
  await click(30, 20);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('status', { name: 'Tool prompt' })).toHaveCount(0);
}

/** Presses at one sketch point and releases at another, moving in steps. */
async function drag(page: Page, at: At, from: [number, number], to: [number, number]) {
  const a = at(...from);
  const b = at(...to);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 4 });
  await page.mouse.move(b.x, b.y, { steps: 4 });
  await page.mouse.up();
}

test('click and Shift-click select geometry; the panel says what it is', async ({ page }) => {
  const at = await sketchOnXY(page);
  await rectangle(page, at);
  const click = clicker(page, at);

  await click(0, 20);
  await expect.poll(() => selected(page)).toHaveLength(1);
  await expect(panel(page).locator('[data-selection-title]')).toHaveText('Line');
  await expect(panel(page)).toContainText('60.00 mm');

  // Shift toggles (page.mouse.click takes no modifiers).
  const shiftClick = async (x: number, y: number) => {
    await page.keyboard.down('Shift');
    await click(x, y);
    await page.keyboard.up('Shift');
  };
  await shiftClick(30, 0);
  await expect.poll(() => selected(page)).toHaveLength(2);
  await expect(panel(page).locator('[data-selection-title]')).toHaveText('2 selected');
  await shiftClick(30, 0);
  await expect.poll(() => selected(page)).toHaveLength(1);
  // A click on empty space keeps a Shift selection; Esc clears it.
  await shiftClick(0, 0);
  await expect.poll(() => selected(page)).toHaveLength(1);
  await page.keyboard.press('Escape');
  await expect.poll(() => selected(page)).toHaveLength(0);
  await expect(panel(page)).toHaveCount(0);
});

test('a window box takes what is inside, a crossing box what it touches', async ({ page }) => {
  const at = await sketchOnXY(page);
  await rectangle(page, at);

  // Left to right around the whole rectangle: 8 corner points and 4 lines.
  await drag(page, at, [-45, 35], [45, -35]);
  await expect.poll(() => selected(page)).toHaveLength(12);
  await expect(panel(page)).toContainText('8 points, 4 lines');

  // Right to left over the top edge only: the line it crosses.
  await drag(page, at, [5, 25], [-5, 15]);
  await expect.poll(() => selected(page)).toHaveLength(1);
  await expect(panel(page).locator('[data-selection-title]')).toHaveText('Line');
});

test('dragging an edge moves it with a live solve, as one undo step', async ({ page }) => {
  const at = await sketchOnXY(page);
  await rectangle(page, at);
  const click = clicker(page, at);

  await drag(page, at, [0, 20], [0, 30]);
  // The top-left corner went up with the edge; the sides stretched.
  await click(-30, 30);
  await expect(panel(page).locator('[data-selection-title]')).toHaveText('Point');
  await expect(panel(page).getByRole('textbox', { name: 'Y' })).toHaveValue('30');
  await expect(panel(page).getByRole('textbox', { name: 'X' })).toHaveValue('-30');

  await page.keyboard.press('Control+Z');
  await expect(panel(page).getByRole('textbox', { name: 'Y' })).toHaveValue('20');
});

test('typed coordinates move a point; Delete takes geometry with its constraints', async ({
  page,
}) => {
  const at = await sketchOnXY(page);
  await rectangle(page, at);
  const click = clicker(page, at);

  // A corner's coincident glyph can sit right over the corner (it did in CI's
  // Ubuntu image) and take the click: hide the glyphs.
  const glyphs = page.getByRole('checkbox', { name: 'Show constraints' });
  await glyphs.uncheck();
  await glyphs.blur();
  await click(30, 20);
  const x = panel(page).getByRole('textbox', { name: 'X' });
  await x.fill('40');
  await x.press('Enter');
  await expect(x).toHaveValue('40');

  // The top edge goes, with its points, its horizontal and its two corners' coincidences.
  await expect.poll(() => counts(page)).toMatchObject({ lines: 4, points: 8, constraints: 8 });
  await click(0, 20);
  await page.keyboard.press('Delete');
  await expect.poll(() => counts(page)).toMatchObject({ lines: 3, points: 6, constraints: 5 });
  await page.keyboard.press('Control+Z');
  await expect.poll(() => counts(page)).toMatchObject({ lines: 4, points: 8, constraints: 8 });

  // The panel's construction toggle.
  await click(0, -20);
  const construction = panel(page).getByRole('checkbox', { name: 'Construction' });
  await construction.check();
  await expect(construction).toBeChecked();
  // Shortcuts don't fire while a control has the focus.
  await construction.blur();
  await page.keyboard.press('Control+Z');
  await expect(construction).not.toBeChecked();
});
