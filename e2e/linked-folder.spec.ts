import { expect, type Page, test } from '@playwright/test';
import {
  addParameter,
  applyCommand,
  createDocument,
  type ParameterId,
} from '../packages/core/src/index';
import { readArchive, writeArchive } from '../packages/storage/src/archive';
import { saveStatus } from './helpers';

// P4-09, ADR-0065 §3: a folder on disk, linked through the File System Access
// API. Only Chromium has it, and headless Chromium's real picker needs a
// person, so the spec stubs `showDirectoryPicker` over an OPFS directory
// (`linked`), as ADR-0065's Slices item 2 says. OPFS handles have no
// `queryPermission`/`requestPermission`, so the stub adds both on the
// prototype: the test answers `prompt` where it wants to see a Reconnect.

test.use({ viewport: { width: 1440, height: 900 } });

/**
 * `showDirectoryPicker` over an OPFS directory, with permission answers.
 *
 * One shim more than the ADR's Slices item says: **an OPFS handle cannot be
 * read back out of IndexedDB in this Chromium build** (it crashes the
 * renderer, which is what the first CI run showed), so the stub keeps the
 * folder's *name* in the handle store and rebuilds the handle on the way out.
 * The app's own code is untouched: it puts what the picker gave it and gets a
 * directory handle back, which is all it ever asked for.
 */
const folderStub = `(() => {
  const answer = { permission: 'granted' };
  window.__linkedFolder = answer;
  const define = (name, value) =>
    Object.defineProperty(FileSystemDirectoryHandle.prototype, name, { value, configurable: true });
  define('queryPermission', () => Promise.resolve(answer.permission));
  define('requestPermission', () => {
    answer.permission = 'granted';
    return Promise.resolve('granted');
  });
  window.showDirectoryPicker = async () => {
    const root = await navigator.storage.getDirectory();
    return root.getDirectoryHandle('linked', { create: true });
  };
  const live = new Map();
  const folderOf = (name) =>
    navigator.storage.getDirectory().then((root) => root.getDirectoryHandle(name, { create: true }));
  const put = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function (value, key) {
    if (this.name !== 'handles') return put.apply(this, arguments);
    live.set(key, value);
    return put.call(this, value.name, key);
  };
  const get = IDBObjectStore.prototype.get;
  IDBObjectStore.prototype.get = function (key) {
    const request = get.apply(this, arguments);
    if (this.name !== 'handles') return request;
    const answer = { onsuccess: null, onerror: null, result: undefined, error: null };
    request.addEventListener('success', () => {
      const stored = request.result;
      const handle = typeof stored === 'string' ? folderOf(stored) : Promise.resolve(stored);
      handle.then(
        (value) => {
          answer.result = value;
          answer.onsuccess && answer.onsuccess({ target: answer });
        },
        (error) => {
          answer.error = error;
          answer.onerror && answer.onerror(error);
        },
      );
    });
    return answer;
  };
})();`;

const section = (page: Page) => page.getByRole('region', { name: 'Linked folder' });

let errors: string[] = [];

test.beforeEach(async ({ page }) => {
  errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

const bytesOf = (base64: string) => Uint8Array.from(Buffer.from(base64, 'base64'));

/** The files in the linked folder, as OPFS has them. */
const linkedFiles = (page: Page) =>
  page.evaluate(`(async () => {
    const root = await navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle('linked');
    const names = [];
    for await (const [name] of dir.entries()) names.push(name);
    return names;
  })()`) as Promise<string[]>;

/** A file's bytes out of the linked folder. */
async function readLinked(page: Page, name: string): Promise<Uint8Array> {
  const base64 = (await page.evaluate(`(async () => {
    const root = await navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle('linked');
    const file = await (await dir.getFileHandle(${JSON.stringify(name)})).getFile();
    const bytes = new Uint8Array(await file.arrayBuffer());
    let text = '';
    for (const byte of bytes) text += String.fromCharCode(byte);
    return btoa(text);
  })()`)) as string;
  return bytesOf(base64);
}

/**
 * The name of the document in a linked file, or `undefined` while it is being
 * written: a file being written through `createWritable` is briefly not there
 * (OPFS swaps it), so a poll must not read it as "gone".
 */
const nameIn = async (page: Page, file: string) =>
  readLinked(page, file)
    .then((bytes) => readArchive(bytes).doc.name)
    .catch(() => undefined);

/** Writes a file into the linked folder, as another program would. */
async function putLinked(page: Page, name: string, bytes: Uint8Array) {
  const base64 = Buffer.from(bytes).toString('base64');
  await page.evaluate(`(async () => {
    const root = await navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle('linked', { create: true });
    const handle = await dir.getFileHandle(${JSON.stringify(name)}, { create: true });
    const writable = await handle.createWritable();
    const text = atob(${JSON.stringify(base64)});
    const bytes = new Uint8Array(text.length);
    for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i);
    await writable.write(bytes);
    await writable.close();
  })()`);
}

async function rename(page: Page, name: string) {
  await page.getByRole('button', { name: /^Project name: / }).click();
  await page.getByRole('textbox', { name: 'Project name' }).fill(name);
  await page.getByRole('textbox', { name: 'Project name' }).press('Enter');
  await expect(page.getByRole('button', { name: `Project name: ${name}. Rename` })).toBeVisible();
  await expect(saveStatus(page)).toHaveText('Saved');
}

/** Links the folder from the home screen and says the section is ready. */
async function linkFolder(page: Page) {
  await page.addInitScript(folderStub);
  await page.goto('./');
  await section(page).getByRole('button', { name: 'Link a folder…' }).click();
  await expect(section(page)).toHaveAttribute('data-linked-folder', 'ready');
  await expect(section(page)).toContainText('linked');
}

test('links a folder, saves a design into it, and writes again after an edit', async ({ page }) => {
  await linkFolder(page);
  await expect(section(page)).toContainText('linked has no .extrudo files yet.');

  await page.getByRole('button', { name: 'New design' }).click();
  await expect(page).toHaveURL(/#\/p\/[0-9a-f-]+$/);
  await rename(page, 'Cable clip');

  await page.getByRole('button', { name: 'File menu' }).click();
  await page.getByRole('menuitem', { name: 'Save to Linked Folder' }).click();
  await expect.poll(() => linkedFiles(page)).toEqual(['Cable clip.extrudo']);
  // The file is the design, exactly as an export would write it.
  expect(readArchive(await readLinked(page, 'Cable clip.extrudo')).doc.name).toBe('Cable clip');
  // Linked projects don't get the command again.
  await page.getByRole('button', { name: 'File menu' }).click();
  await expect(page.getByRole('menuitem', { name: 'Save to Linked Folder' })).toHaveCount(0);
  await page.keyboard.press('Escape');

  // An edit, and the throttled write follows within the 10 s it allows.
  await rename(page, 'Cable clip v2');
  await page.waitForTimeout(12_000);
  const archive = readArchive(await readLinked(page, 'Cable clip.extrudo'));
  expect(archive.doc.name).toBe('Cable clip v2');
  expect(archive.doc.parameters).toHaveLength(0);

  // The home screen lists the file, and the design behind it.
  await page.getByRole('link', { name: /Extrudo/ }).click();
  await expect(section(page).locator('[data-linked-file="Cable clip.extrudo"]')).toBeVisible();
  await expect(
    page
      .getByRole('list', { name: 'Designs' })
      .getByRole('listitem')
      .filter({ hasText: 'Cable clip v2' }),
  ).toBeVisible();
});

test('opens a file from the folder as a project linked to it', async ({ page }) => {
  await linkFolder(page);
  // A design another program wrote into the folder.
  const doc = applyCommand(
    createDocument({ name: 'From the folder' }),
    addParameter({
      parameter: {
        id: 'wall' as ParameterId,
        name: 'wall',
        expression: '2.4 mm',
        unit: 'length',
      },
    }),
  ).doc;
  await putLinked(page, 'From the folder.extrudo', writeArchive(doc));

  await section(page).getByRole('button', { name: 'Refresh the linked folder' }).click();
  const card = section(page).locator('[data-linked-file="From the folder.extrudo"]');
  await expect(card).toBeVisible();
  await expect(card).toContainText('From the folder.extrudo');
  await card.click();

  await expect(page).toHaveURL(/#\/p\/[0-9a-f-]+$/);
  await expect(
    page.getByRole('button', { name: 'Project name: From the folder. Rename' }),
  ).toBeVisible();
  // The project is linked to the file it came from, so it needs no command.
  await page.getByRole('button', { name: 'File menu' }).click();
  await expect(page.getByRole('menuitem', { name: 'Save to Linked Folder' })).toHaveCount(0);
  await page.keyboard.press('Escape');
});

test('a file that changed on disk is a conflict, and Overwrite wins', async ({ page }) => {
  await linkFolder(page);
  await page.getByRole('button', { name: 'New design' }).click();
  await expect(page).toHaveURL(/#\/p\/[0-9a-f-]+$/);
  await rename(page, 'Bracket');
  await page.getByRole('button', { name: 'File menu' }).click();
  await page.getByRole('menuitem', { name: 'Save to Linked Folder' }).click();
  await expect.poll(() => linkedFiles(page)).toEqual(['Bracket.extrudo']);

  // Someone else writes the file, as a synced folder would.
  await page.waitForTimeout(100);
  await putLinked(page, 'Bracket.extrudo', writeArchive(createDocument({ name: 'Theirs' })));

  await rename(page, 'Mine');
  await page.waitForTimeout(12_000);
  const conflict = page.getByRole('alert').filter({ hasText: 'Bracket.extrudo changed on disk.' });
  await expect(conflict).toBeVisible();
  await expect(conflict.getByRole('button', { name: 'Load from disk' })).toBeEnabled();
  await expect(conflict.getByRole('button', { name: 'Overwrite' })).toBeEnabled();

  await conflict.getByRole('button', { name: 'Overwrite' }).click();
  await expect.poll(() => nameIn(page, 'Bracket.extrudo')).toBe('Mine');
});

test('a folder that needs permission again says so, and Reconnect grants it', async ({ page }) => {
  await linkFolder(page);
  await page.getByRole('button', { name: 'New design' }).click();
  await expect(page).toHaveURL(/#\/p\/[0-9a-f-]+$/);
  await rename(page, 'Latch');
  await page.getByRole('button', { name: 'File menu' }).click();
  await page.getByRole('menuitem', { name: 'Save to Linked Folder' }).click();
  await expect.poll(() => linkedFiles(page)).toEqual(['Latch.extrudo']);

  // The browser asks again after a reload: the handle is still there.
  await page.addInitScript('window.__linkedFolder.permission = "prompt";');
  await page.goto('./');
  await expect(section(page)).toHaveAttribute('data-linked-folder', 'needs-permission');
  await expect(section(page)).toContainText('Extrudo needs permission to read and write linked.');
  await expect(section(page).locator('[data-linked-file]')).toHaveCount(0);

  await section(page).getByRole('button', { name: 'Reconnect' }).click();
  await expect(section(page)).toHaveAttribute('data-linked-folder', 'ready');
  await expect(section(page).locator('[data-linked-file="Latch.extrudo"]')).toBeVisible();
});

test('unlinking forgets the folder and the links, and the files stay', async ({ page }) => {
  await linkFolder(page);
  await page.getByRole('button', { name: 'New design' }).click();
  await expect(page).toHaveURL(/#\/p\/[0-9a-f-]+$/);
  await rename(page, 'Tab');
  await page.getByRole('button', { name: 'File menu' }).click();
  await page.getByRole('menuitem', { name: 'Save to Linked Folder' }).click();

  await page.getByRole('link', { name: /Extrudo/ }).click();
  await section(page).getByRole('button', { name: 'Unlink the folder' }).click();
  await expect(section(page)).toHaveAttribute('data-linked-folder', 'none');
  await expect(section(page).getByRole('button', { name: 'Link a folder…' })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'unlinked' })).toBeVisible();
  // The file is still in the folder; only the link is gone.
  expect(await linkedFiles(page)).toEqual(['Tab.extrudo']);
});
