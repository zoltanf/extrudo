import { expect, type Page, test } from '@playwright/test';
import { fileAction, kernelReady, openProject } from './helpers';

// P2-14: version history (FR-PRJ-03, ADR-0036). Ctrl+S saves a version with
// a description; the history lists versions, restores one (one undo step,
// keeping what was there as a version first) and opens one as a copy.
// Versions are stored with the project and survive a reload.

test.use({ viewport: { width: 1440, height: 900 } });
test.setTimeout(60_000);

let errors: string[] = [];

test.beforeEach(async ({ page }) => {
  errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

const chips = (page: Page) =>
  page
    .getByRole('list', { name: 'Features' })
    .getByRole('listitem')
    .filter({ has: page.getByRole('button') });
const chip = (page: Page, name: string) =>
  page
    .getByRole('list', { name: 'Features' })
    .getByRole('button', { name: new RegExp(`^${name}`) });
const versionsDialog = (page: Page) => page.getByRole('dialog', { name: 'Versions' });
const toast = (page: Page, text: string | RegExp) =>
  page.getByRole('status').filter({ hasText: text });

test('saves versions, restores one, and opens one as a copy', async ({ page }) => {
  await openProject(page, 'wall-bracket');
  await kernelReady(page);
  const count = await chips(page).count();
  expect(count).toBeGreaterThan(2);

  // Ctrl+S: the dialog opens at the description.
  await page.keyboard.press('Control+s');
  const dialog = versionsDialog(page);
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('No versions yet.')).toBeVisible();
  const description = dialog.getByRole('textbox', { name: 'Description' });
  await expect(description).toBeFocused();
  await description.fill('Original bracket');
  await page.keyboard.press('Enter');
  await expect(dialog).toBeHidden();
  await expect(toast(page, 'Saved V1.')).toBeVisible();

  // Change the design: the last feature goes.
  await chip(page, 'Fillet1').click({ button: 'right' });
  await page.getByRole('menuitem', { name: /^Delete/ }).click();
  await expect(chip(page, 'Fillet1')).toHaveCount(0);
  await expect(chips(page)).toHaveCount(count - 1);

  // The history, from the button beside the name: restore V1.
  await page.getByRole('button', { name: 'Version history' }).click();
  await expect(dialog).toBeVisible();
  const list = dialog.getByRole('list', { name: 'Saved versions' });
  await expect(list.getByRole('listitem')).toHaveCount(1);
  await expect(list.getByRole('listitem').first()).toContainText('Original bracket');
  await dialog.getByRole('button', { name: 'Restore V1' }).click();
  await expect(dialog).toBeHidden();
  await expect(toast(page, /^Restored V1\. What you had is kept as V2/)).toBeVisible();
  await expect(chip(page, 'Fillet1')).toHaveCount(1);
  await expect(chips(page)).toHaveCount(count);
  await kernelReady(page);

  // One undo step: Undo brings the edited design back.
  await page.keyboard.press('Control+z');
  await expect(chip(page, 'Fillet1')).toHaveCount(0);

  // Versions are stored with the project.
  await page.reload();
  await kernelReady(page);
  await fileAction(page, 'Version History…');
  const items = versionsDialog(page)
    .getByRole('list', { name: 'Saved versions' })
    .getByRole('listitem');
  await expect(items).toHaveCount(2);
  await expect(items.first()).toHaveAttribute('data-version', '2');
  await expect(items.first()).toContainText('Before restoring V1');

  // Open V1 as a copy: a new design with V1's timeline; this one keeps its own.
  const original = page.url();
  await versionsDialog(page).getByRole('button', { name: 'Open V1 as a copy' }).click();
  await expect(page).not.toHaveURL(original);
  await expect(page).toHaveURL(/#\/p\/[0-9a-f-]+$/);
  await expect(page.getByRole('button', { name: /^Project name: .* V1\. Rename$/ })).toBeVisible();
  await kernelReady(page);
  await expect(chips(page)).toHaveCount(count);
  await page.goBack();
  await kernelReady(page);
  await expect(chip(page, 'Fillet1')).toHaveCount(0);
});

test('deletes a version after asking, and prunes the older ones (P3-13)', async ({ page }) => {
  await openProject(page);
  const dialog = versionsDialog(page);
  const items = dialog.getByRole('list', { name: 'Saved versions' }).getByRole('listitem');
  // Twelve versions, two more than the prune keeps.
  for (let n = 1; n <= 12; n++) {
    await page.keyboard.press('Control+s');
    await dialog.getByRole('textbox', { name: 'Description' }).fill(`Step ${n}`);
    await page.keyboard.press('Enter');
    await expect(toast(page, `Saved V${n}.`)).toBeVisible();
  }
  await page.getByRole('button', { name: 'Version history' }).click();
  await expect(items).toHaveCount(12);

  // One version: the confirmation can be declined, then accepted.
  await dialog.getByRole('button', { name: 'Delete V12' }).click();
  const confirm = page.getByRole('alertdialog', { name: 'Delete V12?' });
  await expect(confirm).toBeVisible();
  await confirm.getByRole('button', { name: 'Cancel' }).click();
  await expect(items).toHaveCount(12);
  await dialog.getByRole('button', { name: 'Delete V12' }).click();
  await confirm.getByRole('button', { name: 'Delete' }).click();
  await expect(items).toHaveCount(11);
  await expect(items.first()).toHaveAttribute('data-version', '11');
  await expect(dialog.getByRole('status', { name: 'Versions status' })).toHaveText('Deleted V12.');

  // Prune: the newest ten stay.
  await dialog.getByRole('button', { name: 'Delete older versions' }).click();
  await page
    .getByRole('alertdialog', { name: 'Delete V1?' })
    .getByRole('button', { name: 'Delete' })
    .click();
  await expect(items).toHaveCount(10);
  await expect(dialog.getByRole('button', { name: 'Delete older versions' })).toHaveCount(0);
  await expect(items.last()).toHaveAttribute('data-version', '2');

  // Numbers aren't reused: the next version is V13.
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+s');
  await page.keyboard.press('Enter');
  await expect(toast(page, 'Saved V13.')).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Version history' }).click();
  await expect(items).toHaveCount(11);
  await expect(items.first()).toHaveAttribute('data-version', '13');
});
