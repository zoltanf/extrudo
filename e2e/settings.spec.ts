import { expect, type Page, test } from '@playwright/test';
import { kernelReady, openProject, pickTool } from './helpers';

// ADR-0082: the Settings dialog. Preferences are per browser (localStorage), so each test
// starts from the defaults and a reload keeps what it changed.

const dialog = (page: Page) => page.getByRole('dialog', { name: 'Settings' });
const section = (page: Page, id: string) => page.locator(`[data-settings-section="${id}"]`);
const numberOf = (text: string | null) => Number.parseFloat((text ?? '').replace(/[^0-9.]/g, ''));

test('Ctrl+, opens Settings and every section opens', async ({ page }) => {
  await openProject(page);
  await kernelReady(page);
  await page.keyboard.press('Control+,');
  await expect(dialog(page)).toBeVisible();
  await expect(page.locator('[data-settings-page="general"]')).toBeVisible();

  for (const [id, heading] of [
    ['view', 'View and navigation'],
    ['sketch', 'Sketch'],
    ['printing', '3D printing'],
    ['export', 'Export'],
    ['general', 'General'],
  ] as const) {
    await section(page, id).click();
    const content = page.locator(`[data-settings-page="${id}"]`);
    await expect(content).toBeVisible();
    await expect(content.getByRole('heading', { name: heading, exact: true })).toBeVisible();
  }
  // The web build has no Desktop section.
  await expect(section(page, 'desktop')).toHaveCount(0);

  // The last section is remembered.
  await section(page, 'sketch').click();
  await page.keyboard.press('Escape');
  await expect(dialog(page)).toBeHidden();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('menuitem', { name: /^Settings…/ }).click();
  await expect(page.locator('[data-settings-page="sketch"]')).toBeVisible();
});

test('PLA density: a tweak shows in Print Info and the weight, Reset brings 1.24 back', async ({
  page,
}) => {
  await openProject(page, 'wall-bracket');
  await kernelReady(page);
  await page.keyboard.press('Control+,');
  await section(page, 'printing').click();
  const plaDensity = dialog(page).getByRole('textbox', { name: 'PLA density' });
  await expect(plaDensity).toHaveValue('1.24');
  await expect(dialog(page).getByRole('button', { name: 'Reset PLA density' })).toHaveCount(0);

  await plaDensity.fill('1.3');
  await plaDensity.blur();
  await expect(dialog(page).getByRole('button', { name: 'Reset PLA density' })).toBeVisible();
  // Walls and infill: solid, so the weight is volume × density.
  const infill = dialog(page).getByRole('textbox', { name: 'Infill', exact: true });
  await infill.fill('100');
  await infill.blur();
  await page.keyboard.press('Escape');
  await expect(dialog(page)).toBeHidden();

  await pickTool(page, 'Print Info');
  const panel = page.getByRole('region', { name: 'Print Info' });
  await expect(panel).toHaveAttribute('data-print-state', 'ready', { timeout: 20_000 });
  await expect(panel.getByRole('combobox', { name: 'Material' })).toHaveValue('pla');
  await expect(panel.getByRole('textbox', { name: 'Density' })).toHaveValue('1.3');
  const volume = numberOf(await panel.locator('[data-print-row="volume"]').textContent());
  await expect
    .poll(async () =>
      Math.abs(
        numberOf(await panel.locator('[data-print-row="weight"]').textContent()) - volume * 1.3,
      ),
    )
    .toBeLessThan(0.15);

  // Editing Print Info's field is the same override.
  await panel.getByRole('textbox', { name: 'Density' }).fill('1.5');
  await page.keyboard.press('Control+,');
  await section(page, 'printing').click();
  await expect(dialog(page).getByRole('textbox', { name: 'PLA density' })).toHaveValue('1.5');

  await dialog(page).getByRole('button', { name: 'Reset PLA density' }).click();
  await expect(dialog(page).getByRole('textbox', { name: 'PLA density' })).toHaveValue('1.24');
  await page.keyboard.press('Escape');
  await expect(panel.getByRole('textbox', { name: 'Density' })).toHaveValue('1.24');
});

test('Radial right-click menu matches the gear menu; the theme applies at once', async ({
  page,
}) => {
  await openProject(page);
  await kernelReady(page);
  await page.keyboard.press('Control+,');
  const radial = dialog(page).getByRole('checkbox', { name: 'Radial right-click menu' });
  await expect(radial).toBeChecked();
  await radial.uncheck();
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(
    page.getByRole('menuitemcheckbox', { name: 'Radial right-click menu' }),
  ).toHaveAttribute('aria-checked', 'false');
  await page.keyboard.press('Escape');

  await page.keyboard.press('Control+,');
  await dialog(page).getByRole('radio', { name: 'Light' }).check();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await dialog(page).getByRole('radio', { name: 'Dark' }).check();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});

test('settings survive a reload, and a sketch setting is the palette’s', async ({ page }) => {
  await openProject(page);
  await kernelReady(page);
  await page.keyboard.press('Control+,');
  await section(page, 'sketch').click();
  const snap = dialog(page).getByRole('checkbox', { name: 'Snap to grid' });
  await expect(snap).toBeChecked();
  await snap.uncheck();
  await section(page, 'export').click();
  await dialog(page).getByRole('combobox', { name: 'Default format' }).selectOption('stl');
  await section(page, 'printing').click();
  await dialog(page).getByRole('textbox', { name: 'ABS density' }).fill('1.1');
  await dialog(page).getByRole('textbox', { name: 'ABS density' }).blur();
  await page.keyboard.press('Escape');

  await page.reload();
  await kernelReady(page);
  await page.keyboard.press('Control+,');
  await expect(dialog(page)).toBeVisible();
  await section(page, 'sketch').click();
  await expect(dialog(page).getByRole('checkbox', { name: 'Snap to grid' })).not.toBeChecked();
  await section(page, 'export').click();
  await expect(dialog(page).getByRole('combobox', { name: 'Default format' })).toHaveValue('stl');
  await section(page, 'printing').click();
  await expect(dialog(page).getByRole('textbox', { name: 'ABS density' })).toHaveValue('1.1');
  await dialog(page).getByRole('button', { name: 'Reset 3D printing to defaults' }).click();
  await expect(dialog(page).getByRole('textbox', { name: 'ABS density' })).toHaveValue('1.04');
});

test('the home screen has the same dialog', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(dialog(page)).toBeVisible();
  await section(page, 'view').click();
  await dialog(page).getByRole('combobox', { name: 'Projection' }).selectOption('orthographic');
  await page.keyboard.press('Escape');
  await page.reload();
  await page.keyboard.press('Control+,');
  await section(page, 'view').click();
  await expect(dialog(page).getByRole('combobox', { name: 'Projection' })).toHaveValue(
    'orthographic',
  );
});

test('at 900 x 700 the dialog is usable', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 700 });
  await openProject(page);
  await kernelReady(page);
  await page.keyboard.press('Control+,');
  const box = await dialog(page).boundingBox();
  expect(box).not.toBeNull();
  expect(box?.y).toBeGreaterThanOrEqual(0);
  expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(700);
  expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(900);
  await section(page, 'printing').click();
  // The last control is reachable by scrolling the page.
  const reset = dialog(page).getByRole('button', { name: 'Reset 3D printing to defaults' });
  await reset.scrollIntoViewIfNeeded();
  await expect(reset).toBeInViewport();
  await expect(dialog(page).getByRole('button', { name: 'Close' })).toBeInViewport();
});
