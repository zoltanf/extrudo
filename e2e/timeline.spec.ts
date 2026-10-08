import { expect, type Page, test } from '@playwright/test';
import { openProject, pickTool } from './helpers';

// P1-12: timeline chips and the browser tree. Right-click menus rename,
// hide, suppress and delete; F2 renames in the browser; the pointer on a
// chip or row highlights the sketch in the view; eyes hide sketches.
// The Wall bracket template has Sketch1 and Sketch2 (both drawn).

test.use({ viewport: { width: 1440, height: 900 } });

let errors: string[] = [];

test.beforeEach(async ({ page }) => {
  errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

const browser = (page: Page) => page.getByRole('complementary', { name: 'Browser' });
const row = (page: Page, name: string) =>
  browser(page)
    .getByRole('listitem')
    .filter({ has: page.getByRole('button', { name, exact: true }) })
    // The innermost: the Sketches folder holds the row too.
    .last();
const chip = (page: Page, name: string) =>
  page
    .getByRole('list', { name: 'Features' })
    .getByRole('button', { name: new RegExp(`^${name}`) });
const drawn = async (page: Page) =>
  ((await page.getByRole('region', { name: 'Viewport' }).getAttribute('data-sketches')) ?? '')
    .split(' ')
    .filter(Boolean).length;
const menuItem = (page: Page, name: string) =>
  page.getByRole('menuitem', { name: new RegExp(`^${name}`) });

test('hovering a chip or a browser row highlights the sketch', async ({ page }) => {
  const viewport = await openProject(page, 'wall-bracket');
  await expect(viewport).not.toHaveAttribute('data-highlight', /./);
  await chip(page, 'Sketch2').hover();
  const id = await viewport.getAttribute('data-highlight');
  expect(id).toBeTruthy();
  await page.mouse.move(700, 400);
  await expect(viewport).not.toHaveAttribute('data-highlight', /./);
  await row(page, 'Sketch2').hover();
  await expect(viewport).toHaveAttribute('data-highlight', id ?? '');
  await row(page, 'Sketch1').hover();
  await expect(viewport).not.toHaveAttribute('data-highlight', id ?? '');
});

test('eyes hide and show sketches, one at a time or the whole folder', async ({ page }) => {
  await openProject(page, 'wall-bracket');
  await expect.poll(() => drawn(page)).toBe(2);
  await browser(page).getByRole('button', { name: 'Hide Sketch1' }).click();
  await expect.poll(() => drawn(page)).toBe(1);
  await expect(browser(page).getByRole('button', { name: 'Show Sketch1' })).toBeVisible();

  await browser(page).getByRole('button', { name: 'Hide all sketches' }).click();
  await expect.poll(() => drawn(page)).toBe(0);
  await browser(page).getByRole('button', { name: 'Show all sketches' }).click();
  await expect.poll(() => drawn(page)).toBe(2);

  // Each eye is one undo step.
  await page.keyboard.press('Control+z');
  await expect.poll(() => drawn(page)).toBe(0);
  await page.keyboard.press('Control+z');
  await expect.poll(() => drawn(page)).toBe(1);
});

test('rename from the chip menu and with F2 in the browser', async ({ page }) => {
  await openProject(page, 'wall-bracket');
  await chip(page, 'Sketch1').click({ button: 'right' });
  await menuItem(page, 'Rename').click();
  const field = page.getByRole('textbox', { name: 'Name' });
  await expect(field).toBeFocused();
  await expect(field).toBeInViewport();
  await field.fill('Side profile');
  await field.press('Enter');
  await expect(field).toHaveCount(0);
  await expect(chip(page, 'Side profile')).toBeVisible();
  await expect(row(page, 'Side profile')).toBeVisible();

  await browser(page).getByRole('button', { name: 'Sketch2', exact: true }).focus();
  await page.keyboard.press('F2');
  const inline = browser(page).getByRole('textbox', { name: 'Rename Sketch2' });
  await expect(inline).toBeFocused();
  await inline.fill('Holes');
  // Esc keeps the old name.
  await inline.press('Escape');
  await expect(row(page, 'Sketch2')).toBeVisible();
  await browser(page).getByRole('button', { name: 'Sketch2', exact: true }).focus();
  await page.keyboard.press('F2');
  await inline.fill('Holes');
  await inline.press('Enter');
  await expect(row(page, 'Holes')).toBeVisible();

  await page.keyboard.press('Control+z');
  await expect(row(page, 'Sketch2')).toBeVisible();
});

test('suppress and delete from the menus; not while a sketch is open', async ({ page }) => {
  await openProject(page, 'wall-bracket');
  await chip(page, 'Sketch2').click({ button: 'right' });
  await menuItem(page, 'Suppress').click();
  await expect(chip(page, 'Sketch2')).toHaveAccessibleName('Sketch2 (suppressed)');
  await expect.poll(() => drawn(page)).toBe(1);
  await chip(page, 'Sketch2').click({ button: 'right' });
  await menuItem(page, 'Unsuppress').click();
  await expect.poll(() => drawn(page)).toBe(2);

  // Sketch1's profile is Extrude1's: deleting it is refused, with the reason.
  await row(page, 'Sketch1').click({ button: 'right' });
  await menuItem(page, 'Delete').click();
  await expect(page.getByRole('alert')).toHaveText(
    "Can't delete Sketch1: Extrude1 uses it. Change or delete that first.",
  );
  await expect(row(page, 'Sketch1')).toBeVisible();
  // The message sits over the timeline.
  await page.getByRole('alert').getByRole('button', { name: 'Dismiss' }).click();

  // Nothing refers to Extrude2: it goes, and Undo brings it back.
  await chip(page, 'Extrude2').click({ button: 'right' });
  await menuItem(page, 'Delete').click();
  await expect(chip(page, 'Extrude2')).toHaveCount(0);
  await page.keyboard.press('Control+z');
  await expect(chip(page, 'Extrude2')).toBeVisible();

  // The Delete key on a focused row: Extrude2 goes, then Sketch2, which nothing uses any more.
  await chip(page, 'Extrude2').click({ button: 'right' });
  await menuItem(page, 'Delete').click();
  await expect(chip(page, 'Extrude2')).toHaveCount(0);
  await browser(page).getByRole('button', { name: 'Sketch2', exact: true }).focus();
  await page.keyboard.press('Delete');
  await expect(row(page, 'Sketch2')).toHaveCount(0);
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+z');
  await expect(row(page, 'Sketch2')).toBeVisible();

  await chip(page, 'Sketch2').dblclick();
  await expect(page.getByRole('region', { name: 'Sketch palette' })).toBeVisible();
  await chip(page, 'Sketch1').click({ button: 'right' });
  await expect(menuItem(page, 'Delete')).toHaveAttribute('aria-disabled', 'true');
  await expect(menuItem(page, 'Suppress')).toHaveAttribute('aria-disabled', 'true');
  await page.keyboard.press('Escape');
  await expect(row(page, 'Sketch1')).toBeVisible();
});

test('two chips fit without a scrollbar, with the marker at either end', async ({ page }) => {
  await openProject(page);
  for (let i = 0; i < 2; i++) {
    await pickTool(page, 'Create Sketch');
    await page
      .getByRole('region', { name: 'Create Sketch' })
      .getByRole('button', { name: 'XY' })
      .click();
    await page.getByRole('button', { name: 'Finish Sketch' }).last().click();
  }
  const list = page.getByRole('list', { name: 'Features' });
  // The marker's triangle is wider than its bar; it used to stick out by a pixel and make
  // the list scroll (a scrollbar under the chips where overlay scrollbars aren't used).
  const overflow = () => list.evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(await overflow()).toBe(0);
  await page.getByRole('button', { name: 'Roll back to start' }).click();
  expect(await overflow()).toBe(0);
});
