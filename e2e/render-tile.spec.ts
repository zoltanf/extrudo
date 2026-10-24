import { expect, test } from '@playwright/test';
import { kernelReady, openProject, saveStatus } from './helpers';

// P6-16 (ADR-0101 §6): in the web build the app renders the picture itself.
// A draft only: CI's Chrome renders WebGL in software (SwiftShader). The
// dialog's choices and the Blender engine are covered by RenderDialog.test.tsx.

test.use({ viewport: { width: 1440, height: 900 } });

test('Render Picture renders a draft of the wall bracket in the browser', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await openProject(page, 'wall-bracket');
  await expect(saveStatus(page)).toHaveText('Saved');
  await kernelReady(page);

  await page.getByRole('tab', { name: '3D Print' }).click();
  const tile = page.getByRole('button', { name: 'Render Picture', exact: true });
  await expect(tile).not.toHaveAttribute('aria-disabled', 'true');
  await tile.click();

  const dialog = page.getByRole('dialog', { name: 'Render picture' });
  await expect(dialog).toBeVisible();
  // The web has one engine: no "Render with" row, no Blender line.
  await expect(dialog.getByRole('radiogroup', { name: 'Render with' })).toHaveCount(0);
  await dialog.getByLabel('Draft').check();
  await dialog.getByLabel('Size').selectOption('1280x720');
  await dialog.getByRole('button', { name: 'Render', exact: true }).click();

  const picture = dialog.getByRole('img', { name: 'Rendered picture of Wall bracket' });
  await expect(picture).toBeVisible({ timeout: 60_000 });
  // A real PNG of the chosen size.
  const size = await picture.evaluate((img) => {
    const { naturalWidth, naturalHeight } = img as { naturalWidth: number; naturalHeight: number };
    return [naturalWidth, naturalHeight];
  });
  expect(size).toEqual([1280, 720]);
  await picture.click();
  await expect(dialog.locator('button[aria-pressed="true"]')).toBeVisible();
  expect(errors).toEqual([]);
});
