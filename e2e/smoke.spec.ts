import { expect, test } from '@playwright/test';
import { openProject } from './helpers';

test('the app opens on the home screen, and a template opens in the shell', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));

  await page.goto('./');
  await expect(page).toHaveTitle('Extrudo');
  await expect(page.getByRole('img', { name: 'Extrudo', exact: true })).toBeVisible();
  await expect(page.getByText('extrudo', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Your designs' })).toBeVisible();

  await openProject(page, 'wall-bracket');
  await expect(page.getByRole('button', { name: /^Project name: Wall bracket/ })).toBeVisible();
  expect(errors).toEqual([]);
});
