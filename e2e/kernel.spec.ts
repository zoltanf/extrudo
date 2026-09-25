import { expect, test } from '@playwright/test';

// P0-09: the kernel worker renders the test part, and survives a forced WASM
// abort (NFR-03): the worker restarts and the next command works.
test('the kernel renders the test part and restarts after a crash', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));

  await page.goto('./#/debug/kernel');
  const status = page.getByRole('status', { name: 'Kernel status' });
  await expect(status).toContainText('ready', { timeout: 15_000 });

  await page.getByRole('button', { name: 'Render test part' }).click();
  const summary = page.getByTestId('part-summary');
  await expect(summary).toContainText('Valid solid · 11 faces');
  await expect(page.getByTestId('kernel-stage').locator('canvas')).toBeVisible();

  await page.getByRole('button', { name: 'Crash the kernel' }).click();
  await expect(status).toContainText('restarted 1×', { timeout: 15_000 });
  await expect(status).toContainText('ready');
  await expect(page.getByText('The kernel stopped and restarted.')).toBeVisible();

  await page.getByRole('button', { name: 'Render test part' }).click();
  await expect(summary).toContainText('Valid solid · 11 faces');
  expect(errors).toEqual([]);
});
