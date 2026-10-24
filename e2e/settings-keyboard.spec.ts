import { expect, type Page, test } from '@playwright/test';
import { kernelReady, openProject } from './helpers';

// ADR-0082's 2026-10-18 amendment: Settings › Keyboard changes any command's keys. The keys
// are the `keymap.overrides` preference (localStorage), so a reload keeps them.

const keyboard = (page: Page) => page.locator('[data-settings-page="keyboard"]');
const row = (page: Page, id: string) => page.locator(`[data-keymap-row="${id}"]`);
const stored = (page: Page) =>
  page.evaluate(() => JSON.parse(localStorage.getItem('extrudo.keymap.overrides') ?? '{}'));

test("a tile's Change shortcut… records its key, and the key runs it after a reload", async ({
  page,
}) => {
  await openProject(page);
  await kernelReady(page);
  await page.locator('[data-tool="hole"]').click({ button: 'right' });
  await page.getByRole('menuitem', { name: /Change shortcut/ }).click();
  await expect(keyboard(page)).toBeVisible();
  // It replaces Hole's key H: the row is recording, in view.
  await expect(row(page, 'hole')).toHaveAttribute('data-keymap-recording', '');
  await expect(row(page, 'hole')).toBeInViewport();
  await page.keyboard.press('Shift+O');
  await expect(row(page, 'hole')).toContainText('Enter keeps it');
  await page.keyboard.press('Enter');
  await expect(row(page, 'hole')).not.toHaveAttribute('data-keymap-recording', '');
  await expect(row(page, 'hole').getByRole('button', { name: 'Hole: Shift+O' })).toBeVisible();
  await expect(row(page, 'hole')).toHaveAttribute('data-keymap-changed', 'true');
  expect(await stored(page)).toEqual({ hole: ['Shift+O'] });
  // The tile's tooltip shows the new key at once, no reload (ADR-0102 §5: the key labels
  // read the keymap through `useKeysFor`, which the React Compiler can't memoise away).
  await page.keyboard.press('Escape');
  await expect(keyboard(page)).toBeHidden();
  await page.locator('[data-tool="hole"]').hover();
  await expect(page.getByRole('tooltip').locator('kbd').first()).toHaveText('Shift+O');

  await page.reload();
  await kernelReady(page);
  await page
    .locator('canvas')
    .first()
    .click({ position: { x: 600, y: 400 } });
  await page.keyboard.press('h');
  await expect(page.getByRole('region', { name: 'Hole dialog' })).toBeHidden();
  await page.keyboard.press('Shift+O');
  await expect(page.getByRole('region', { name: 'Hole dialog' })).toBeVisible();
});

test('a key another command uses here asks first; Replace takes it, Reset gives it back', async ({
  page,
}) => {
  await openProject(page);
  await kernelReady(page);
  await page.keyboard.press('Control+,');
  await page.locator('[data-settings-section="keyboard"]').click();
  await keyboard(page).getByRole('textbox', { name: 'Search commands' }).fill('hole');
  await row(page, 'hole').getByRole('button', { name: 'Hole: H' }).click();
  await page.keyboard.press('e');
  await page.keyboard.press('Enter');
  const alert = row(page, 'hole').getByRole('alert');
  await expect(alert).toContainText('is Extrude here');
  expect(await stored(page)).toEqual({});
  await alert.getByRole('button', { name: 'Replace' }).click();
  expect(await stored(page)).toEqual({ hole: ['E'], extrude: [] });

  // A key Escape, Tab or the browser owns can't be recorded; Esc cancels.
  await row(page, 'hole').getByRole('button', { name: 'Hole: E' }).click();
  await page.keyboard.press('Control+w');
  await expect(row(page, 'hole')).toContainText("can't be used");
  await page.keyboard.press('Escape');
  await expect(row(page, 'hole')).not.toHaveAttribute('data-keymap-recording', '');
  await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible();

  // The Changed filter lists both; Reset all keys empties the preference.
  await keyboard(page).getByRole('textbox', { name: 'Search commands' }).fill('');
  await keyboard(page)
    .getByRole('button', { name: /^Changed/ })
    .click();
  await expect(keyboard(page).locator('[data-keymap-row]')).toHaveCount(2);
  await row(page, 'extrude').getByRole('button', { name: 'Reset Extrude' }).click();
  expect(await stored(page)).toEqual({ hole: ['E'] });
  await keyboard(page).getByRole('button', { name: 'Reset all keys' }).click();
  expect(await stored(page)).toEqual({});
});

test("search's key button records a chord", async ({ page }) => {
  await openProject(page);
  await kernelReady(page);
  await page.keyboard.press('Control+k');
  await page.getByRole('combobox', { name: 'Search commands' }).fill('measure');
  await page
    .getByRole('option', { name: /^Measure/ })
    .locator('[data-change-shortcut]')
    .click();
  await expect(row(page, 'measure')).toHaveAttribute('data-keymap-recording', '');
  await page.keyboard.press('k');
  await page.keyboard.press('y');
  expect(await stored(page)).toEqual({ measure: ['K Y'] });
  await expect(row(page, 'measure').getByRole('button', { name: 'Measure: K Y' })).toBeVisible();
});
