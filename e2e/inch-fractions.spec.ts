// P6-18 S3, ADR-0113 §3: an inch design reads and writes fractions. The
// parser takes `1 1/2"` and `5' 6"`; the browser's Document settings
// Fractions switch shows inch lengths as fractions, in a sketch dimension
// label and in the Parameters dialog.
import { expect, type Page, test } from '@playwright/test';
import {
  addUserParameter,
  clicker,
  newSketchOnXY,
  openProject,
  parametersDialog,
  pickTool,
} from './helpers';

const status = (page: Page) => page.getByRole('status', { name: 'Status', exact: true });
const browser = (page: Page) => page.getByRole('complementary', { name: 'Browser' });
const labels = (page: Page) => page.locator('[data-dimension]');

/** Opens the Document settings folder in the browser. */
async function openSettingsFolder(page: Page) {
  const folder = browser(page).getByRole('button', { name: 'Document settings' });
  if ((await folder.getAttribute('aria-expanded')) !== 'true') await folder.click();
  await expect(folder).toHaveAttribute('aria-expanded', 'true');
}

/** Sets the document unit to inches and turns fractions on. */
async function useInchFractions(page: Page) {
  await openSettingsFolder(page);
  await browser(page).getByRole('combobox', { name: 'Units' }).selectOption('in');
  await expect(status(page)).toHaveText('0 features · in');
  const fractions = browser(page).getByRole('checkbox', { name: 'Fractions' });
  await fractions.check();
  await expect(fractions).toBeChecked();
  // The Precision list reads as fractions in this mode.
  await expect(
    browser(page).getByRole('combobox', { name: 'Precision' }).locator('option[value="2"]'),
  ).toHaveText('1/16');
}

test('an inch design reads fractions in a dimension label and feet-inches as a parameter', async ({
  page,
}) => {
  await openProject(page);
  await useInchFractions(page);

  // A sketch line dimensioned `1 1/2"` shows the fraction with its unit.
  const at = await newSketchOnXY(page);
  const click = clicker(page, at);
  await page.keyboard.press('l');
  await click(-20, 0);
  await click(20, 0);
  await page.keyboard.press('Escape');
  await page.keyboard.press('d');
  await click(0, 0);
  const place = at(0, 12);
  await page.mouse.move(place.x, place.y);
  await page.mouse.click(place.x, place.y);
  const value = page.getByRole('textbox', { name: 'Value of d1' });
  await value.fill('1 1/2"');
  await value.press('Enter');
  await expect(labels(page)).toHaveText(['1 1/2 in']);

  // Feet and inches as one quantity: `5' 6"` is 66 in.
  await page.getByRole('button', { name: 'Finish Sketch' }).last().click();
  await pickTool(page, 'Parameters');
  await addUserParameter(page, 'len', `5' 6"`);
  await expect(parametersDialog(page).locator('[data-parameter-row="len"]')).toContainText('66 in');
});
