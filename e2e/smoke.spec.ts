import { expect, test } from '@playwright/test';

test('the app opens the shell with the Extrudo brand', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));

  await page.goto('./');

  await expect(page).toHaveTitle('Extrudo');
  await expect(page.getByRole('img', { name: 'Extrudo', exact: true })).toBeVisible();
  await expect(page.getByText('extrudo', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Project name: Wall bracket/ })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Viewport' })).toBeVisible();
  expect(errors).toEqual([]);
});
