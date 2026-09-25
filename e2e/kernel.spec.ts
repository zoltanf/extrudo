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

// P0-05: the four visual styles (FR-VP-03), on the test part in the real viewport.
test('the visual styles draw the test part differently', async ({ page }) => {
  await page.goto('./#/debug/kernel');
  await expect(page.getByRole('status', { name: 'Kernel status' })).toContainText('ready', {
    timeout: 15_000,
  });
  await page.getByRole('button', { name: 'Render test part' }).click();
  await expect(page.getByTestId('part-summary')).toContainText('Valid solid');
  const viewport = page.getByRole('region', { name: 'Viewport' });
  const canvas = viewport.locator('canvas');

  const pictures: Buffer[] = [];
  for (const style of ['Shaded', 'Shaded with edges', 'Shaded with hidden edges', 'Wireframe']) {
    await page.getByRole('button', { name: 'Visual style' }).click();
    await page.getByRole('menuitemradio', { name: style, exact: true }).click();
    await expect(page.getByRole('menu')).toHaveCount(0);
    // Let the fit animation and the redraw settle.
    await expect(viewport).not.toHaveAttribute('data-camera-size', '');
    await page.waitForTimeout(500);
    pictures.push(await canvas.screenshot());
  }
  for (let i = 0; i < pictures.length; i++) {
    for (let j = i + 1; j < pictures.length; j++) {
      expect(pictures[i]?.equals(pictures[j] as Buffer), `styles ${i} and ${j}`).toBe(false);
    }
  }
});
