import { expect, test } from '@playwright/test';

// P1-03: the planegcs WASM loads from the production bundle and solves on the
// main thread: drags in generated sketches, and a conflict naming both widths.
test('the sketch solver loads, drags and reports a conflict', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));

  await page.goto('./#/debug/solver');
  await expect(page.getByRole('status', { name: 'Solver status' })).toContainText('ready', {
    timeout: 15_000,
  });
  await page.getByRole('button', { name: 'Drag test' }).click();

  const results = page.getByTestId('solver-results');
  await expect(results.getByRole('row')).toHaveCount(4, { timeout: 30_000 });
  for (const [name, components] of [
    ['Rectangle, hole, slot', '1'],
    ['Anchored plate', '22'],
    ['Chained plate', '1'],
  ]) {
    const row = results.getByRole('row').filter({ hasText: name });
    await expect(row.getByRole('cell').nth(2)).toHaveText(components as string);
    await expect(row.getByRole('cell').nth(3)).toHaveText('DOF 1');
  }
  await expect(page.getByTestId('solver-conflict')).toContainText('2 constraints involved');
  expect(errors).toEqual([]);
});
