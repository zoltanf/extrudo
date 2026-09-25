import { expect, test } from '@playwright/test';

test('the app loads and shows the Extrudo brand', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));

  await page.goto('./');

  await expect(page).toHaveTitle('Extrudo');
  await expect(page.getByRole('heading', { level: 1, name: 'extrudo' })).toBeVisible();
  await expect(page.getByRole('img', { name: 'Extrudo logo' })).toBeVisible();
  await expect(page.getByText('.extrudo')).toBeVisible();
  expect(errors).toEqual([]);
});
