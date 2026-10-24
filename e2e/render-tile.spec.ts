import { expect, test } from '@playwright/test';
import { kernelReady, openProject, saveStatus } from './helpers';

// P6-15 (ADR-0101): in the web build the Render Picture tile is there but says
// what it needs. The dialog itself is covered by RenderDialog.test.tsx.

test.use({ viewport: { width: 1440, height: 900 } });

test('the Render Picture tile says it needs the desktop app', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await openProject(page, 'wall-bracket');
  await expect(saveStatus(page)).toHaveText('Saved');
  await kernelReady(page);

  await page.getByRole('tab', { name: '3D Print' }).click();
  const tile = page.getByRole('button', { name: 'Render Picture', exact: true });
  await tile.hover();
  await expect(page.getByRole('tooltip')).toContainText(
    'Rendering needs the desktop app and Blender (free, blender.org).',
  );
  await expect(tile).toHaveAttribute('aria-disabled', 'true');
  expect(errors).toEqual([]);
});
