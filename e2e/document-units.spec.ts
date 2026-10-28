// Document units (FR-PRJ-07, ADR-0113 §1): the home screen's New design card
// picks the unit of a new design and remembers it; the browser's Document
// settings folder changes a design's unit and precision through one undoable
// command; both show in the status bar's "<n> features · <unit>".
import { expect, type Page, test } from '@playwright/test';
import { openProject, saveStatus } from './helpers';

const status = (page: Page) => page.getByRole('status', { name: 'Status', exact: true });
const browser = (page: Page) => page.getByRole('complementary', { name: 'Browser' });
const homeUnits = (page: Page) => page.getByRole('combobox', { name: 'Units of a new design' });

/** Opens the Document settings folder in the browser (a second click would close it). */
async function openSettingsFolder(page: Page) {
  const folder = browser(page).getByRole('button', { name: 'Document settings' });
  if ((await folder.getAttribute('aria-expanded')) !== 'true') await folder.click();
  await expect(folder).toHaveAttribute('aria-expanded', 'true');
}

test('a new design takes the unit picked on the home screen, which is remembered', async ({
  page,
}) => {
  await page.goto('./');
  await expect(homeUnits(page)).toHaveValue('mm');
  await homeUnits(page).selectOption('in');
  await expect(page.getByText('An empty design in inches.')).toBeVisible();
  await page.getByRole('button', { name: 'New design' }).click();
  await expect(page).toHaveURL(/#\/p\/[0-9a-f-]+$/);
  await expect(status(page)).toHaveText('0 features · in');

  await page.goto('./');
  await expect(homeUnits(page)).toHaveValue('in');
});

test('the browser changes the unit and precision, undoably, and the change is saved', async ({
  page,
}) => {
  await openProject(page);
  await expect(status(page)).toHaveText('0 features · mm');
  await openSettingsFolder(page);
  const units = browser(page).getByRole('combobox', { name: 'Units' });
  const precision = browser(page).getByRole('combobox', { name: 'Precision' });
  await expect(units).toHaveValue('mm');
  await expect(precision).toHaveValue('2');

  await units.selectOption('in');
  await expect(status(page)).toHaveText('0 features · in');
  await precision.selectOption('3');
  await expect(precision).toHaveValue('3');

  // Two commands, two undo steps.
  await page.keyboard.press('Control+z');
  await expect(precision).toHaveValue('2');
  await expect(status(page)).toHaveText('0 features · in');
  await page.keyboard.press('Control+z');
  await expect(status(page)).toHaveText('0 features · mm');
  await page.keyboard.press('Control+Shift+z');
  await expect(status(page)).toHaveText('0 features · in');

  await expect(saveStatus(page)).toHaveText('Saved', { timeout: 20_000 });
  await page.reload();
  await expect(status(page)).toHaveText('0 features · in');
  await openSettingsFolder(page);
  await expect(browser(page).getByRole('combobox', { name: 'Units' })).toHaveValue('in');
});
