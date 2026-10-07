import { readFileSync } from 'node:fs';
import { expect, type Page, test } from '@playwright/test';
import { writePluginFile } from '../packages/storage/src/plugin-file';
import { chip, primitive } from './benchmark-helpers';
import { kernelReady, openProject } from './helpers';

// Installed plugins and plugin commands (P6-03 slice 2, ADR-0077 §4-§5): the
// example plugin (`examples/plugins/name-plate/`) packed here, installed
// through the Plugins dialog, disabled and enabled, and its "Three holes"
// command run from Ctrl+K on a Box: the handler runs in the kernel worker's
// sandbox and its two features (a sketch and a cut) go in as one undo step.

const EXAMPLE = new URL('../examples/plugins/name-plate/', import.meta.url);
const read = (file: string) => readFileSync(new URL(file, EXAMPLE), 'utf8');

const pluginFile = () =>
  Buffer.from(
    writePluginFile({
      manifest: JSON.parse(read('plugin.json')),
      code: read('main.ts'),
      readme: read('README.md'),
    }),
  );

const dialog = (page: Page) => page.getByRole('dialog', { name: 'Plugins' });
const palette = (page: Page) => page.getByRole('dialog', { name: 'Command palette' });

async function openPlugins(page: Page) {
  await page.getByRole('button', { name: 'File menu' }).click();
  await page.getByRole('menuitem', { name: 'Plugins…' }).click();
  await expect(dialog(page)).toBeVisible();
}

/** The palette's options for a search, by accessible name. */
async function search(page: Page, text: string) {
  await page.keyboard.press('Control+k');
  await expect(palette(page)).toBeVisible();
  await palette(page).getByRole('combobox', { name: 'Search commands' }).fill(text);
  return palette(page).getByRole('option');
}

test('installs a plugin, enables it and runs its command as one undo step', async ({ page }) => {
  test.setTimeout(120_000);
  const viewport = await openProject(page);
  await primitive(page, 'Box', { Length: '60 mm' });
  await expect(viewport).toHaveAttribute('data-bodies', 'Body1:6:60,20,20');

  // Install the file through the dialog's own picker.
  await openPlugins(page);
  await expect(dialog(page)).toContainText('No plugins yet.');
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    dialog(page).getByRole('button', { name: 'Install…' }).click(),
  ]);
  await chooser.setFiles({
    name: 'name-plate.extrudo-plugin',
    mimeType: 'application/zip',
    buffer: pluginFile(),
  });
  const status = dialog(page).getByRole('status', { name: 'Plugins status' });
  await expect(status).toHaveText('Installed Name plate 1.0.0.');
  const row = dialog(page).locator('[data-plugin="name-plate"]');
  await expect(row).toContainText('Name plate 1.0.0');
  await expect(row.locator('[data-plugin-command="three-holes"]')).toHaveCount(1);

  // The same file again is refused, with both versions named.
  const [again] = await Promise.all([
    page.waitForEvent('filechooser'),
    dialog(page).getByRole('button', { name: 'Install…' }).click(),
  ]);
  await again.setFiles({
    name: 'name-plate.extrudo-plugin',
    mimeType: 'application/zip',
    buffer: pluginFile(),
  });
  await expect(status).toHaveText(
    'Name plate 1.0.0 is already installed; this file is the same version, 1.0.0.',
  );

  // Disabled, its command is gone from Ctrl+K; enabled, it is back.
  const enabled = row.getByRole('checkbox', { name: 'Enabled: Name plate' });
  await expect(enabled).toBeChecked();
  await enabled.click();
  await expect(enabled).not.toBeChecked();
  await expect(status).toHaveText('Disabled Name plate.');
  await page.keyboard.press('Escape');
  await expect(dialog(page)).toBeHidden();
  await search(page, 'three holes');
  await expect(palette(page).getByRole('option', { name: /^Three holes/ })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await openPlugins(page);
  await enabled.click();
  await expect(enabled).toBeChecked();
  await expect(status).toHaveText('Enabled Name plate.');
  await page.keyboard.press('Escape');
  await expect(dialog(page)).toBeHidden();

  // Run it from Ctrl+K: three Ø4 holes through the 60 mm box, one undo step.
  const options = await search(page, 'three holes');
  await expect(options.first()).toHaveAccessibleName(/^Three holes.*Plugins › Name plate/);
  await page.keyboard.press('Enter');
  await expect(
    page.getByRole('status').filter({ hasText: 'Name plate: Three holes: added 2 features.' }),
  ).toBeVisible();
  await kernelReady(page);
  await expect(viewport).toHaveAttribute('data-bodies', 'Body1:9:60,20,20');
  await expect(chip(page, 'Sketch1')).toBeVisible();
  await expect(chip(page, 'Extrude1')).toBeVisible();

  await page.keyboard.press('Control+z');
  await kernelReady(page);
  await expect(viewport).toHaveAttribute('data-bodies', 'Body1:6:60,20,20');
  await expect(chip(page, 'Sketch1')).toHaveCount(0);
  await expect(chip(page, 'Extrude1')).toHaveCount(0);
});
