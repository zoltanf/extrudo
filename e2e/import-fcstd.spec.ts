import { expect, type Page, test } from '@playwright/test';
import { shapesFile } from '../packages/fcstd/src/shape-fixtures';

// The FreeCAD import (P6-25 S3, ADR-0144): its worker reads the file and its
// own kernel worker turns each stored shape into STEP. The file is the
// package's authored fixture (hand-written XML, the kernel's own test
// shapes), never a sample.

let errors: string[] = [];

test.beforeEach(async ({ page }) => {
  errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

async function importFile(page: Page, name: string, buffer: Buffer) {
  await page.goto('./');
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.getByRole('button', { name: 'Import…', exact: true }).click(),
  ]);
  await chooser.setFiles({ name, mimeType: 'application/octet-stream', buffer });
}

const browserOf = (page: Page) => page.getByRole('complementary', { name: 'Browser' });
const bodyLeaf = (page: Page, name: string) =>
  browserOf(page)
    .locator('[data-body]')
    .filter({ has: page.getByRole('button', { name, exact: true }) });

test("a FreeCAD file opens as a new design with the file's shapes as bodies", async ({ page }) => {
  test.setTimeout(120_000);
  const workers: string[] = [];
  page.on('worker', (worker) => workers.push(worker.url()));
  await importFile(page, 'Shapes.FCStd', Buffer.from(shapesFile()));
  await expect(page).toHaveURL(/#\/p\/[^/]+$/, { timeout: 60_000 });
  await expect(
    page.getByText('Imported from the FreeCAD file: 9 of 11 shapes, as bodies without history.'),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Not imported: Scan (a mesh, which Extrudo doesn't import from FreeCAD files yet); Empty body (no shape).",
    ),
  ).toBeVisible();
  for (const name of [
    'Bracket',
    'Holed box',
    'Red box',
    'Moved box',
    'Holed box copy',
    'Pair',
    'Pair 2',
  ])
    await expect(bodyLeaf(page, name)).toHaveAttribute('data-body-display', 'shown', {
      timeout: 60_000,
    });
  await expect(bodyLeaf(page, 'Hidden box')).toHaveAttribute('data-body-display', 'hidden');
  expect(workers.some((url) => /fcstdWorker/.test(url))).toBe(true);
  expect(workers.some((url) => /importKernelWorker/.test(url))).toBe(true);
});

test("a file that isn't a FreeCAD file says why, and the page stays", async ({ page }) => {
  await importFile(page, 'Broken.FCStd', Buffer.from('not a zip at all, just text'));
  await expect(page.getByRole('alert')).toContainText(
    "Import failed: This file can't be read as a FreeCAD file",
  );
  await expect(page.getByRole('button', { name: 'Import…', exact: true })).toBeEnabled();
});
