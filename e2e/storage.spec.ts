import { expect, type Page, test } from '@playwright/test';
import { openProject, saveStatus } from './helpers';

// P0-08: projects live in the browser (OPFS + IndexedDB), autosave with a
// visible state, the home screen, `.extrudo` export and import, and the
// persistent-storage request (FR-PRJ-01, -02, -04, -05).

test.use({ viewport: { width: 1440, height: 900 } });

let errors: string[] = [];

test.beforeEach(async ({ page }) => {
  errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

async function rename(page: Page, name: string) {
  await page.getByRole('button', { name: /^Project name: / }).click();
  await page.getByRole('textbox', { name: 'Project name' }).fill(name);
  await page.getByRole('textbox', { name: 'Project name' }).press('Enter');
  await expect(page.getByRole('button', { name: `Project name: ${name}. Rename` })).toBeVisible();
  await expect(saveStatus(page)).toHaveText('Saved');
}

/** An init script that makes `navigator.storage` answer as given. */
const stubPersistence = (persisted: boolean, persist: boolean) =>
  `Object.assign(navigator.storage, {
    persisted: () => Promise.resolve(${persisted}),
    persist: () => Promise.resolve(${persist}),
  });`;

const card = (page: Page, name: string) =>
  page.getByRole('list', { name: 'Designs' }).getByRole('listitem').filter({ hasText: name });

test('a new design is saved, survives a reload and shows on the home screen', async ({ page }) => {
  await openProject(page);
  await expect(page.getByRole('button', { name: 'Project name: Untitled. Rename' })).toBeVisible();
  await rename(page, 'Cable clip');

  await page.reload();
  await expect(
    page.getByRole('button', { name: 'Project name: Cable clip. Rename' }),
  ).toBeVisible();
  await expect(saveStatus(page)).toHaveText('Saved');

  await page.getByRole('link', { name: /Extrudo/ }).click();
  await expect(page.getByRole('heading', { name: 'Your designs' })).toBeVisible();
  await expect(card(page, 'Cable clip')).toContainText('Edited just now');

  await page.reload();
  await expect(card(page, 'Cable clip')).toBeVisible();
  await card(page, 'Cable clip').getByRole('link', { name: 'Cable clip' }).click();
  await expect(
    page.getByRole('button', { name: 'Project name: Cable clip. Rename' }),
  ).toBeVisible();
});

test('undo is saved too', async ({ page }) => {
  await openProject(page);
  await rename(page, 'First');
  await page.keyboard.press('Control+z');
  await expect(page.getByRole('button', { name: 'Project name: Untitled. Rename' })).toBeVisible();
  await expect(saveStatus(page)).toHaveText('Saved');
  await page.reload();
  await expect(page.getByRole('button', { name: 'Project name: Untitled. Rename' })).toBeVisible();
});

test('an edit made just before a reload is kept', async ({ page }) => {
  await openProject(page);
  await expect(saveStatus(page)).toHaveText('Saved');
  // Reloading before autosave's delay (or while it writes) used to lose the edit.
  await page.getByRole('button', { name: /^Project name: / }).click();
  await page.getByRole('textbox', { name: 'Project name' }).fill('Quick edit');
  await page.getByRole('textbox', { name: 'Project name' }).press('Enter');
  await expect(saveStatus(page)).toHaveText('Edited');
  await page.reload();
  await expect(
    page.getByRole('button', { name: 'Project name: Quick edit. Rename' }),
  ).toBeVisible();
  await expect(saveStatus(page)).toHaveText('Saved');

  // The home screen lists it too.
  await page.getByRole('link', { name: /Extrudo/ }).click();
  await expect(card(page, 'Quick edit')).toBeVisible();
});

test('export and import round-trip a project as an .extrudo file', async ({ page }, info) => {
  await openProject(page, 'wall-bracket');
  await rename(page, 'Bracket v2');
  const chips = page.getByRole('list', { name: 'Features' }).getByRole('listitem');
  const timeline = await chips.allTextContents();
  expect(timeline.length).toBeGreaterThan(1);
  const original = page.url();

  await page.getByRole('button', { name: 'File menu' }).click();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('menuitem', { name: 'Export .extrudo' }).click(),
  ]);
  expect(download.suggestedFilename()).toBe('Bracket v2.extrudo');
  const file = info.outputPath('Bracket v2.extrudo');
  await download.saveAs(file);
  await expect(
    page.getByRole('status').filter({ hasText: 'Exported Bracket v2.extrudo.' }),
  ).toBeVisible();

  // Import it on the home screen: the same project exists, so it comes in as a copy.
  await page.goto('./');
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.getByRole('button', { name: 'Import .extrudo' }).click(),
  ]);
  await chooser.setFiles(file);
  await expect(page).toHaveURL(/#\/p\/[0-9a-f-]+$/);
  expect(page.url()).not.toBe(original);
  await expect(
    page.getByRole('button', { name: 'Project name: Bracket v2. Rename' }),
  ).toBeVisible();
  await expect(chips).toHaveCount(timeline.length);
  expect(await chips.allTextContents()).toEqual(timeline);
  await page.getByRole('button', { name: 'Parameters', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Expression of wall', exact: true })).toHaveValue(
    '2.4 mm',
  );
});

test('import refuses a file that is not a project', async ({ page }) => {
  await page.goto('./');
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.getByRole('button', { name: 'Import .extrudo' }).click(),
  ]);
  await chooser.setFiles({
    name: 'notes.extrudo',
    mimeType: 'text/plain',
    buffer: Buffer.from('hi'),
  });
  await expect(page.getByRole('alert')).toContainText(
    "Import failed: This isn't an Extrudo project file: it isn't a zip archive.",
  );
  await expect(page.getByRole('heading', { name: 'Your designs' })).toBeVisible();
});

test('rename, duplicate, trash, restore and delete on the home screen', async ({ page }) => {
  await openProject(page);
  await rename(page, 'Hook');
  await page.goto('./');

  // Rename from the card menu.
  await card(page, 'Hook').getByRole('button', { name: 'More actions for Hook' }).click();
  await page.getByRole('menuitem', { name: 'Rename' }).click();
  const field = page.getByRole('textbox', { name: 'New name for Hook' });
  await field.fill('Coat hook');
  await field.press('Enter');
  await expect(card(page, 'Coat hook')).toBeVisible();

  // Duplicate.
  await card(page, 'Coat hook').getByRole('button', { name: 'More actions for Coat hook' }).click();
  await page.getByRole('menuitem', { name: 'Duplicate' }).click();
  await expect(card(page, 'Coat hook copy')).toBeVisible();
  await expect(page.getByRole('list', { name: 'Designs' }).getByRole('listitem')).toHaveCount(2);

  // Search.
  await page.getByRole('searchbox', { name: 'Search designs' }).fill('copy');
  await expect(page.getByRole('list', { name: 'Designs' }).getByRole('listitem')).toHaveCount(1);
  await page.getByRole('searchbox', { name: 'Search designs' }).fill('');

  // Trash and restore.
  await card(page, 'Coat hook copy')
    .getByRole('button', { name: 'More actions for Coat hook copy' })
    .click();
  await page.getByRole('menuitem', { name: 'Move to trash' }).click();
  await expect(page.getByRole('list', { name: 'Designs' }).getByRole('listitem')).toHaveCount(1);
  await page.getByRole('button', { name: 'Trash (1)' }).click();
  const trashed = page.getByRole('list', { name: 'Trashed designs' }).getByRole('listitem');
  await expect(trashed).toHaveCount(1);
  await trashed.getByRole('button', { name: 'Restore' }).click();
  await expect(page.getByText('The trash is empty.')).toBeVisible();
  await page.getByRole('button', { name: 'Designs' }).click();
  await expect(page.getByRole('list', { name: 'Designs' }).getByRole('listitem')).toHaveCount(2);

  // Delete forever, after confirming. It stays gone after a reload.
  await card(page, 'Coat hook copy')
    .getByRole('button', { name: 'More actions for Coat hook copy' })
    .click();
  await page.getByRole('menuitem', { name: 'Move to trash' }).click();
  await page.getByRole('button', { name: 'Trash (1)' }).click();
  await page.getByRole('button', { name: 'Delete forever' }).click();
  const confirm = page.getByRole('alertdialog', { name: 'Delete “Coat hook copy” forever?' });
  await confirm.getByRole('button', { name: 'Delete forever' }).click();
  await expect(page.getByText('The trash is empty.')).toBeVisible();
  await page.reload();
  await expect(page.getByRole('list', { name: 'Designs' }).getByRole('listitem')).toHaveCount(1);
  await expect(page.getByRole('button', { name: /^Trash/ })).toHaveText('Trash');
});

test('an unknown project link says so and leads home', async ({ page }) => {
  await page.goto('./#/p/00000000-0000-4000-8000-000000000000');
  await expect(page.getByRole('alert')).toHaveText(
    "This project doesn't exist. It may have been deleted.",
  );
  await page.getByRole('button', { name: 'All designs' }).click();
  await expect(page.getByRole('heading', { name: 'Your designs' })).toBeVisible();
});

for (const granted of [true, false]) {
  test(`persistent storage ${granted ? 'granted' : 'denied'}`, async ({ page }) => {
    // Stub the StorageManager: headless Chromium's answer isn't predictable.
    // A string, since e2e/ typechecks without the DOM library.
    await page.addInitScript(stubPersistence(false, granted));
    await page.goto('./');
    await expect(page.getByRole('status', { name: 'Storage' })).toHaveText(
      granted ? 'Stored on this device' : 'Storage may be cleared',
    );
  });
}

for (const theme of ['dark', 'light'] as const) {
  test(`the home screen looks right in the ${theme} theme`, async ({ page }) => {
    await page.addInitScript(
      `localStorage.setItem('extrudo.theme', ${JSON.stringify(JSON.stringify(theme))});`,
    );
    await page.addInitScript(stubPersistence(true, true));
    await page.goto('./');
    await expect(page.getByText('No designs yet.', { exact: false })).toBeVisible();
    await page.evaluate('document.fonts.ready.then(() => true)');
    await expect(page).toHaveScreenshot(`home-${theme}.png`, {
      animations: 'disabled',
      caret: 'hide',
    });
  });
}
