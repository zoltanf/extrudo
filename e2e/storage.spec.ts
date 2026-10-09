import { expect, type Page, test } from '@playwright/test';
import { readArchive } from '../packages/storage/src/archive';
import { exportProject, renameProject } from './benchmark-helpers';
import { fileAction, kernelReady, openProject, pickTool, saveStatus } from './helpers';

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

test("a saved design's thumbnail shows the whole model inside a transparent border", async ({
  page,
}) => {
  await openProject(page, 'wall-bracket');
  await kernelReady(page);
  // An edit makes the next save take a fresh picture; exporting flushes it.
  await renameProject(page, 'Thumbnail check');
  const bytes = await exportProject(page, 'thumbnail-check.extrudo');
  const { thumbnail } = readArchive(new Uint8Array(bytes));
  if (!thumbnail) throw new Error('the export has no thumbnail');
  const base64 = Buffer.from(thumbnail).toString('base64');
  // Pixels in the 4 px border that are not transparent, and in the picture overall.
  const result = (await page.evaluate(`(async () => {
    const bin = atob('${base64}');
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0);
    const { data, width, height } = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
    let border = 0;
    let opaque = 0;
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        if (data[(y * width + x) * 4 + 3] === 0) continue;
        opaque++;
        if (x < 4 || y < 4 || x >= width - 4 || y >= height - 4) border++;
      }
    return { width, height, border, opaque };
  })()`)) as { width: number; height: number; border: number; opaque: number };
  expect(result.width).toBe(256);
  expect(result.opaque).toBeGreaterThan(2000);
  expect(result.border).toBe(0);
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

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    fileAction(page, 'Export .extrudo'),
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
  await pickTool(page, 'Parameters');
  await expect(page.getByRole('textbox', { name: 'Expression of wall', exact: true })).toHaveValue(
    '2.4 mm',
  );
});

test('opens a design a newer Extrudo saved, and says what it left out (P3-13)', async ({
  page,
}) => {
  await openProject(page);
  await rename(page, 'From the future');
  const id = page.url().split('/').pop() as string;
  await page.goto('./');
  // What a newer Extrudo would have stored: a higher format version and a key this one doesn't know.
  const edited = await page.evaluate(`(async () => {
    const root = await navigator.storage.getDirectory();
    const dir = await (await root.getDirectoryHandle('projects')).getDirectoryHandle(${JSON.stringify(id)});
    const handle = await dir.getFileHandle('document.json');
    const doc = JSON.parse(await (await handle.getFile()).text());
    doc.formatVersion = 2;
    doc.lighting = 'studio';
    const writable = await handle.createWritable();
    await writable.write(JSON.stringify(doc));
    await writable.close();
    return true;
  })()`);
  expect(edited).toBe(true);
  await card(page, 'From the future').getByRole('link', { name: 'From the future' }).click();
  await expect(
    page.getByRole('button', { name: 'Project name: From the future. Rename' }),
  ).toBeVisible();
  await expect(
    page.getByRole('status').filter({ hasText: 'saved by a newer Extrudo (file format 2' }),
  ).toContainText("1 setting this version doesn't know was left out.");
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

test('another tab upgrading the database tells this one to reload', async ({ page, context }) => {
  await openProject(page);
  await expect(saveStatus(page)).toHaveText('Saved');

  // A second tab of this context, standing in for a newer build: it can't open
  // the database at all (so it holds no connection to block its own upgrade).
  const other = await context.newPage();
  await other.addInitScript(`(() => {
    window.__idbOpen = indexedDB.open.bind(indexedDB);
    indexedDB.open = () => {
      throw new DOMException('This tab opens no database (a test wants the upgrade).', 'InvalidStateError');
    };
  })();`);
  await other.goto('./');
  await expect(
    other.getByRole('heading', { name: "Extrudo can't store designs in this window" }),
  ).toBeVisible();

  // It upgrades the database, which this tab's connection has to let go of.
  const upgraded = await other.evaluate(`(async () => {
    const db = await new Promise((resolve, reject) => {
      const request = window.__idbOpen('extrudo');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const next = db.version + 1;
    db.close();
    return new Promise((resolve, reject) => {
      const request = window.__idbOpen('extrudo', next);
      request.onsuccess = () => {
        request.result.close();
        resolve(true);
      };
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('the upgrade is blocked'));
    });
  })()`);
  expect(upgraded).toBe(true);

  const notice = page
    .getByRole('status')
    .filter({ hasText: 'Extrudo was updated in another tab. Reload this tab to keep working.' });
  await expect(notice).toBeVisible();
  await expect(notice.getByRole('button', { name: 'Reload', exact: true })).toBeEnabled();
  // Its storage is gone now, so the next save says so instead of working.
  await page.getByRole('button', { name: /^Project name: / }).click();
  await page.getByRole('textbox', { name: 'Project name' }).fill('After the upgrade');
  await page.getByRole('textbox', { name: 'Project name' }).press('Enter');
  await expect(saveStatus(page)).toHaveText("Couldn't save");
  await other.close();
});

for (const theme of ['dark', 'light'] as const) {
  test(`the home screen looks right in the ${theme} theme`, async ({ page }) => {
    await page.addInitScript(
      `localStorage.setItem('extrudo.theme', ${JSON.stringify(JSON.stringify(theme))});`,
    );
    await page.addInitScript(stubPersistence(true, true));
    await page.goto('./');
    await expect(page.getByText('No designs yet.', { exact: false })).toBeVisible();
    await page.evaluate('document.fonts.ready.then(() => true)');
    // The template cards' pictures (P3-12) are in the shot.
    await page.evaluate(
      'Promise.all([...document.images].map((i) => i.decode().catch(() => undefined))).then(() => true)',
    );
    await expect(page).toHaveScreenshot(`home-${theme}.png`, {
      animations: 'disabled',
      caret: 'hide',
    });
  });
}
