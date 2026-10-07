import { readFileSync } from 'node:fs';
import { expect, type Page, test } from '@playwright/test';
import { readArchive } from '../packages/storage/src/archive';
import { writePluginFile } from '../packages/storage/src/plugin-file';
import { chip, exportProject, primitive } from './benchmark-helpers';
import { kernelReady, openProject, projector } from './helpers';

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

// A plugin's custom feature (P6-03 slice 3, ADR-0077 §6): the Create menu and Ctrl+K list it
// once the plugin is enabled, its dialog is generated from the manifest, and OK adds the
// feature **and** the plugin file's record to the design as one undo step.
test("adds a plugin's custom feature, and the design carries the plugin file", async ({ page }) => {
  test.setTimeout(180_000);
  const viewport = await openProject(page);
  await kernelReady(page);
  await openPlugins(page);
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    dialog(page).getByRole('button', { name: 'Install…' }).click(),
  ]);
  await chooser.setFiles({
    name: 'name-plate.extrudo-plugin',
    mimeType: 'application/zip',
    buffer: pluginFile(),
  });
  await expect(dialog(page).getByRole('status', { name: 'Plugins status' })).toHaveText(
    'Installed Name plate 1.0.0.',
  );
  await page.keyboard.press('Escape');
  await expect(dialog(page)).toBeHidden();

  // The Create menu lists it under "Plugins".
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: 'Name plate' })).toBeVisible();
  await page.keyboard.press('Escape');

  // Ctrl+K opens its generated dialog.
  const options = await search(page, 'name plate');
  await expect(options.first()).toHaveAccessibleName(/^Name plate.*Plugins › Name plate/);
  await page.keyboard.press('Enter');
  const box = page.getByRole('region', { name: 'Name plate dialog' });
  await expect(box).toBeVisible();
  await expect(box).toContainText('Plugin: Name plate 1.0.0');
  const width = box.getByRole('textbox', { name: 'Width', exact: true });
  await width.fill('50 mm');
  // Shortcuts don't fire (and keys type) while a field has the focus.
  await width.blur();

  // Pick the XY plane's square in the home view (no other plane is in front there).
  const at = await (async () => {
    await page.keyboard.press('Shift+1');
    let last = '';
    await expect
      .poll(async () => {
        const key = (
          await Promise.all(
            ['size', 'target', 'direction'].map((k) => viewport.getAttribute(`data-camera-${k}`)),
          )
        ).join(' ');
        const still = key === last;
        last = key;
        return still;
      })
      .toBe(true);
    return projector(viewport);
  })();
  const h = Number(await viewport.getAttribute('data-camera-size')) * 0.16;
  const { x, y } = at([h * 0.5, -h * 0.5, 0]);
  await page.mouse.move(x, y);
  await page.mouse.click(x, y);
  await expect(box.getByRole('button', { name: 'Plane', exact: true })).toHaveText('XY plane');
  await expect(box).toHaveAttribute('data-preview-status', /^ok|warning$/, { timeout: 60_000 });
  await box.getByRole('button', { name: 'OK' }).click();
  await expect(box).toBeHidden();
  await kernelReady(page);
  await expect(viewport).toHaveAttribute('data-bodies', /^Body1:\d+:50,20,3$/);
  await expect(chip(page, 'Name plate1')).toBeVisible();

  // The design carries the file: the export has one attachment, and undo takes it away
  // together with the feature.
  const withFile = readArchive(
    new Uint8Array(await exportProject(page, 'plugin-name-plate.extrudo')),
  );
  expect(Object.keys(withFile.doc.attachments ?? {})).toHaveLength(1);
  expect(Object.values(withFile.doc.attachments ?? {})[0]).toMatchObject({
    name: 'Name plate 1.0.0',
    mediaType: 'application/x-extrudo-plugin',
  });
  await page.keyboard.press('Control+z');
  await kernelReady(page);
  await expect(chip(page, 'Name plate1')).toHaveCount(0);
  const without = readArchive(
    new Uint8Array(await exportProject(page, 'plugin-name-plate.extrudo')),
  );
  expect(Object.keys(without.doc.attachments ?? {})).toHaveLength(0);
});
