import { expect, type Page, test } from '@playwright/test';
import { parameterExpression, parametersDialog, pickTool } from './helpers';

// ADR-0111: on the bottle cap (B9, an ~8 s recompute) a parameter change shows
// "Updating the model…" with a Cancel button; Cancel undoes the change, the
// earlier model comes back from the kernel's cache once the feature in flight
// ends, and Redo brings the change back. The first load's
// "Preparing your design…" has no Cancel. Traps are in docs/agent/e2e-notes.md.

test.use({ viewport: { width: 1440, height: 900 } });
test.setTimeout(120_000);

const kernel = (page: Page) => page.getByRole('status', { name: 'Kernel' });

/** Opens Parameters, checks `capDia`'s expression and closes the dialog again. */
async function expectCapDia(page: Page, value: string) {
  await pickTool(page, 'Parameters');
  await expect(await parameterExpression(page, 'capDia')).toHaveValue(value);
  await page.keyboard.press('Escape');
  await expect(parametersDialog(page)).toHaveCount(0);
}

test('Cancel on a long update undoes the edit, and Redo brings it back', async ({ page }) => {
  await page.goto('./#/example/bottle-cap');
  // The first load: nothing to undo, so no Cancel.
  const preparing = page.locator('[data-model-progress="preparing"]');
  await expect(preparing).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('[data-model-cancel]')).toHaveCount(0);
  await expect(kernel(page)).toHaveAttribute('data-model-status', 'ready', { timeout: 60_000 });

  // Change the cap diameter: every feature re-evaluates (B9 ≈ 8 s).
  await pickTool(page, 'Parameters');
  const field = await parameterExpression(page, 'capDia');
  await field.fill('34 mm');
  await field.press('Enter');
  await page.keyboard.press('Escape');
  await expect(parametersDialog(page)).toHaveCount(0);

  const updating = page.locator('[data-model-progress="updating"]');
  await expect(updating).toBeVisible();
  const cancel = updating.locator('[data-model-cancel]');
  await expect(cancel).toBeVisible();
  await expect(cancel).toHaveAttribute(
    'aria-label',
    'Cancel: undo the changes since the last model',
  );
  const clicked = Date.now();
  await cancel.click();
  // The toast comes with the click and may be gone before the kernel is ready.
  await expect(page.locator('[data-toast]').filter({ hasText: 'Update cancelled' })).toHaveCount(1);
  // Cancel waits for the feature in flight (the heavy thread) and then replays
  // from the cache (ADR-0111): about 1-3.5 s on CI, more on a busy runner, so
  // the budget is generous and the time is logged rather than asserted.
  await expect(kernel(page)).toHaveAttribute('data-model-status', 'ready', { timeout: 20_000 });
  const ms = Date.now() - clicked;
  test.info().annotations.push({ type: 'click to ready', description: `${ms} ms` });
  console.log(`kernel-cancel: click to ready ${ms} ms`);

  await expectCapDia(page, '32 mm');

  await page.keyboard.press('Control+y');
  await expectCapDia(page, '34 mm');
});
