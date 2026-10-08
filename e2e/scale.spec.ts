import { expect, type Page, test } from '@playwright/test';
import { selectBodies } from './benchmark-helpers';
import { kernelReady, openProject, pickTool } from './helpers';

// P3-08: Scale (FR-FT-12). A cube doubled about its centre, then edited to a
// per-axis scale.

test.use({ viewport: { width: 1440, height: 900 } });
test.describe.configure({ timeout: 60_000 });

let errors: string[] = [];

test.beforeEach(async ({ page }) => {
  errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

const chip = (page: Page, name: string) =>
  page
    .getByRole('list', { name: 'Features' })
    .getByRole('button', { name: new RegExp(`^${name}`) });

test('scales a cube uniformly, then per axis', async ({ page }) => {
  const viewport = await openProject(page);
  await kernelReady(page);
  await pickTool(page, 'Box');
  const box = page.getByRole('region', { name: 'Box dialog' });
  await expect(box).toHaveAttribute('data-preview-status', 'ok', { timeout: 15_000 });
  await box.getByRole('button', { name: 'OK' }).click();
  await kernelReady(page);
  await expect(viewport).toHaveAttribute('data-bodies', 'Body1:6:20,20,20');

  await selectBodies(page, ['Body1']);
  await pickTool(page, 'Scale');
  const dialog = page.getByRole('region', { name: 'Scale dialog' });
  await expect(dialog.getByRole('button', { name: 'Bodies', exact: true })).toHaveText('Body1');
  // A factor of 1 changes nothing: a warning until it is set.
  await expect(dialog).toHaveAttribute('data-preview-status', 'warning', { timeout: 15_000 });
  await dialog.getByRole('textbox', { name: 'Scale factor', exact: true }).fill('2');
  await expect(dialog).toHaveAttribute('data-preview-status', 'ok', { timeout: 15_000 });
  await dialog.getByRole('button', { name: 'OK' }).click();
  await expect(dialog).toBeHidden();
  await kernelReady(page);
  await expect(chip(page, 'Scale1')).toBeVisible();
  await expect(viewport).toHaveAttribute('data-bodies', 'Body1:6:40,40,40');

  // Per axis: only Z grows; the box stays a box of six flat faces.
  await chip(page, 'Scale1').dblclick();
  const edit = page.getByRole('region', { name: 'Edit Scale1 dialog' });
  await edit.getByRole('combobox', { name: 'Scale type' }).selectOption('non-uniform');
  await expect(edit.getByRole('textbox', { name: 'Scale factor', exact: true })).toHaveCount(0);
  await edit.getByRole('textbox', { name: 'Z factor', exact: true }).fill('1.5');
  await expect(edit).toHaveAttribute('data-preview-status', 'ok', { timeout: 15_000 });
  await edit.getByRole('button', { name: 'OK' }).click();
  await expect(edit).toBeHidden();
  await kernelReady(page);
  await expect(viewport).toHaveAttribute('data-bodies', 'Body1:6:20,20,30');
});
