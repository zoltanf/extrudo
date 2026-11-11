import { expect, type Page, test } from '@playwright/test';
import { historyFile, rectangle } from '../packages/fcstd/src/history-fixtures';
import { shapesFile } from '../packages/fcstd/src/shape-fixtures';
import { boxBrep } from '../packages/kernel/src/read-brep-test-support';

// The FreeCAD import (P6-25 S3 and S5, ADR-0144): its worker reads the file
// and its own kernel worker turns each stored shape into STEP, and rebuilds
// each PartDesign body's features against the shapes the file stores. The
// files are the package's authored fixtures (hand-written XML, the kernel's
// own test shapes), never a sample.

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
});

test("a file that isn't a FreeCAD file says why, and the page stays", async ({ page }) => {
  await importFile(page, 'Broken.FCStd', Buffer.from('not a zip at all, just text'));
  await expect(page.getByRole('alert')).toContainText(
    "Import failed: This file can't be read as a FreeCAD file",
  );
  await expect(page.getByRole('button', { name: 'Import…', exact: true })).toBeEnabled();
});

/**
 * Two bodies: Bracket, a pad and a pocket that rebuild equal to what the file
 * stores, and Lid, a pad and then a fillet (not rebuilt in S5).
 */
function historyBytes(): Buffer {
  const box = boxBrep([0, 0, 0], [10, 20, 30]);
  const lid = boxBrep([40, 0, 0], [50, 20, 5]);
  return Buffer.from(
    historyFile([
      {
        name: 'Body',
        label: 'Bracket',
        sketches: [
          { name: 'Sketch', geometry: rectangle(0, 0, 10, 20) },
          { name: 'Sketch001', geometry: rectangle(-1, -1, 11, 21), placement: [0, 0, 30] },
        ],
        features: [
          { name: 'Pad', type: 'Pad', length: 30, stored: box },
          {
            name: 'Pocket',
            type: 'Pocket',
            sketch: 'Sketch001',
            length: 10,
            stored: boxBrep([0, 0, 0], [10, 20, 20]),
          },
        ],
      },
      {
        name: 'Body001',
        label: 'Lid',
        sketches: [{ name: 'Sketch002', geometry: rectangle(40, 0, 50, 20) }],
        features: [
          { name: 'Pad001', type: 'Pad', sketch: 'Sketch002', length: 5, stored: lid },
          { name: 'Fillet', type: 'PartDesign::Fillet', stored: lid },
        ],
      },
    ]),
  );
}

test('PartDesign bodies come in with their history, or as far as it rebuilds', async ({ page }) => {
  test.setTimeout(120_000);
  await importFile(page, 'History.FCStd', historyBytes());
  await expect(page).toHaveURL(/#\/p\/[^/]+$/, { timeout: 60_000 });
  await expect(
    page.getByText(
      'Imported from the FreeCAD file: 2 of 2 shapes, 1 with its history and 1 as a body without history.',
    ),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Taken from the file's own shapes, without their whole history: Lid. Most often because it has a feature Extrudo doesn't rebuild from FreeCAD files yet. The features rebuilt before that stay in the timeline, ahead of a Remove that takes out what they made.",
    ),
  ).toBeVisible();
  const chips = page.getByRole('list', { name: 'Features' }).locator('[data-timeline-item="chip"]');
  // Bracket: its two sketches (one on a plane at the pocket's height) and both features, no import.
  // Lid: its sketch and pad, then the Remove of what they made and the file's shape.
  await expect
    .poll(() => chips.evaluateAll((els) => els.map((el) => el.getAttribute('aria-label'))), {
      timeout: 60_000,
    })
    .toEqual([
      'Sketch',
      'Pad',
      'Sketch001 plane',
      'Sketch001',
      'Pocket',
      'Sketch002',
      'Pad001',
      'Remove Lid',
      'Import Lid',
    ]);
  for (const name of ['Bracket', 'Lid'])
    await expect(bodyLeaf(page, name)).toHaveAttribute('data-body-display', 'shown', {
      timeout: 60_000,
    });
  // Every rebuilt feature recomputes in the project's kernel too.
  await expect(chips.and(page.locator('[data-feature-status="error"]'))).toHaveCount(0);
});
