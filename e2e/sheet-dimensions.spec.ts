import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';
import { type Download, expect, type Page, test } from '@playwright/test';
import type {
  SheetId,
  SheetItem,
  SheetItemId,
  SheetRefAnchor,
  SheetViewId,
} from '../packages/core/src/index';
import { sheetStandardFrom } from '../packages/core/src/index';
import { readArchive, writeArchive } from '../packages/storage/src/archive';
import { parameterExpression, parametersDialog, pickTool, selectTab } from './helpers';

// P6-24 S3, dimensions in the app (ADR-0143's S3 amendments): the open sheet's anchors are
// resolved after the model changes, a lost one is drawn detached (red, dashed) with its
// reason in the browser row and the status bar, undo attaches it again, and the export
// resolves too and writes the dimensions' text.

test.use({ viewport: { width: 1440, height: 900 } });
test.describe.configure({ timeout: 180_000 });

let errors: string[] = [];

test.beforeEach(async ({ page }) => {
  errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

/** Pictures for a person to look at (`SHEET_SHOTS=<dir>`), light and dark; none in CI. */
async function shot(page: Page, name: string) {
  const dir = process.env.SHEET_SHOTS;
  if (!dir) return;
  await mkdir(dir, { recursive: true });
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.waitForTimeout(300);
    await page.screenshot({ path: join(dir, `${name}-${scheme}.png`) });
  }
  await page.emulateMedia({ colorScheme: 'dark' });
}

const sheet = (page: Page) => page.getByRole('region', { name: 'Sheet', exact: true });
const browser = (page: Page) => page.getByRole('complementary', { name: 'Browser' });
const status = (page: Page) => page.locator('output[aria-label="Status"]');
/** A dimension's text on the sheet (the invisible text layer). */
const text = (page: Page, id: string) =>
  sheet(page).locator(`[data-sheet-text] text[data-key="item:${id}"]`);
/** A dimension's drawn paths' states. */
const states = (page: Page, id: string) =>
  sheet(page)
    .locator(`[data-sheet-paper] > svg path[data-key="item:${id}"]`)
    .evaluateAll((paths) => [...new Set(paths.map((p) => p.getAttribute('data-state')))]);
const dimensionRow = (page: Page, id: string) =>
  browser(page).locator(`[data-sheet-item-row="${id}"]`);
const chip = (page: Page, name: string) =>
  page
    .getByRole('list', { name: 'Features' })
    .getByRole('button', { name: new RegExp(`^${name}`) });
const menuItem = (page: Page, name: string) =>
  page.getByRole('menuitem', { name: new RegExp(`^${name}`) });

/**
 * Edges of B2 (the storage box, `fixtures/benchmarks/b2-storage-box.extrudo`, fixed IDs) as
 * the kernel names them, with their fingerprints: the box's height edge (40), its front
 * bottom edge (80, along X) and the pocket's floor edge at the back (74, z = 4). A file
 * keeps these; if the naming ever changes, stored dimensions stop resolving and this fails.
 */
const BOX = 'extrude:19798de9-45c1-4832-9212-5711797580b1';
const POCKET = 'extrude:5900f4e9-01b0-4395-a1d2-5490f3e246a4';
const SIDE_A = 'side:e666f81c-59f5-4e48-b305-333598b74ffb';
const SIDE_B = 'side:f157f660-0832-424c-a41e-4f4781c0e962';
const POCKET_SIDE = 'side:8611d6f4-b394-4be0-9ea1-69e4f79142e9';
const edge = (
  a: string,
  b: string,
  at: [number, number, number],
  dir: [number, number, number],
  size: number,
): SheetRefAnchor => ({
  ref: {
    kind: 'edge',
    id: `e[${a}|${b}]`,
    fingerprint: { type: 'line', at, dir, size, adj: [a, b] },
  },
});
const HEIGHT = edge(`${BOX}:${SIDE_A}`, `${BOX}:${SIDE_B}`, [0, 0, 20], [0, 0, 1], 40);
const WIDTH = edge(`${BOX}:cap:start`, `${BOX}:${SIDE_A}`, [40, 0, 0], [1, 0, 0], 80);
const FLOOR = edge(`${POCKET}:cap:end`, `${POCKET}:${POCKET_SIDE}`, [40, 57, 4], [1, 0, 0], 74);

/** B2 with a sheet: its front view at 2:1 with the three dimensions. */
async function boxFixture(path: string) {
  const { doc } = readArchive(
    new Uint8Array(await readFile('fixtures/benchmarks/b2-storage-box.extrudo')),
  );
  const view = 'v1' as SheetViewId;
  const dimension = (id: string, anchor: SheetRefAnchor, at: [number, number]): SheetItem => ({
    kind: 'dimension',
    id: id as SheetItemId,
    view,
    type: 'linear',
    anchors: [anchor],
    at,
  });
  doc.sheets = [
    {
      id: 's1' as SheetId,
      name: 'Box',
      size: 'A3',
      orientation: 'landscape',
      scale: [2, 1],
      projection: 'first',
      decimals: 0,
      views: [{ id: view, name: 'Front', at: [130, 190], from: sheetStandardFrom('front') }],
      items: [
        dimension('dh', HEIGHT, [-10, 20]),
        dimension('dw', WIDTH, [40, -10]),
        dimension('df', FLOOR, [40, 30]),
      ],
    },
  ];
  await writeFile(path, writeArchive(doc));
}

async function openBox(page: Page, file: string) {
  await boxFixture(file);
  await page.goto('./');
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.getByRole('button', { name: 'Import…', exact: true }).click(),
  ]);
  await chooser.setFiles(file);
  await openDrawing(page);
}

async function openDrawing(page: Page) {
  await browser(page).locator('[data-sheet-row="s1"]').first().dblclick();
  await expect(sheet(page)).toBeVisible();
}

async function downloaded(page: Page, click: () => Promise<unknown>) {
  const [download] = (await Promise.all([page.waitForEvent('download'), click()])) as [
    Download,
    unknown,
  ];
  return readFile(await download.path());
}

/** A string as the PDF's text layer writes it (lowercase hex: "74" is <3734>). */
const hexOf = (value: string) => Buffer.from(value, 'latin1').toString('hex');

/** A PDF's page content, its streams inflated. */
function pdfContent(bytes: Buffer): string {
  const all = bytes.toString('latin1');
  const out: string[] = [];
  const re = /\/FlateDecode >>\nstream\n/g;
  for (let m = re.exec(all); m; m = re.exec(all)) {
    const start = m.index + m[0].length;
    const end = all.indexOf('\nendstream', start);
    out.push(inflateSync(bytes.subarray(start, end)).toString('latin1'));
  }
  return out.join('\n');
}

test("a file's dimensions are drawn from the model, follow a parameter, and are exported", async ({
  page,
}, info) => {
  await openBox(page, info.outputPath('box.extrudo'));
  // Measured by the kernel: nothing is drawn detached while it answers.
  await expect(text(page, 'dh')).toHaveText('40', { timeout: 60_000 });
  await expect(text(page, 'dw')).toHaveText('80');
  await expect(text(page, 'df')).toHaveText('74');
  for (const id of ['dh', 'dw', 'df']) expect(await states(page, id)).toEqual([null]);
  // The browser's Dimensions folder: the text and the view, a click selects.
  await expect(dimensionRow(page, 'dh')).toContainText('40');
  await expect(dimensionRow(page, 'dh')).toContainText('Front');
  await expect(dimensionRow(page, 'dh')).toHaveAttribute('data-state', 'ok');
  await dimensionRow(page, 'dw').getByRole('button').click();
  await expect(sheet(page)).toHaveAttribute('data-selected', 'item:dw');
  await shot(page, 'dimensions');

  // height 40 → 55 mm: the dimension follows.
  await selectTab(page, 'Home');
  await pickTool(page, 'Parameters');
  const expr = await parameterExpression(page, 'height');
  await expr.fill('55 mm');
  await expr.press('Enter');
  await page.keyboard.press('Escape');
  await expect(parametersDialog(page)).toHaveCount(0);
  await expect(text(page, 'dh')).toHaveText('55', { timeout: 30_000 });
  await expect(dimensionRow(page, 'dh')).toContainText('55');

  // The export resolves and writes the dimensions' text (the PDF's text layer).
  await selectTab(page, 'Drawing');
  await page.locator('#toolbar-groups [data-label="Export PDF"]').click();
  const dialog = page.getByRole('dialog', { name: 'Export drawing' });
  await expect(dialog.locator('[data-sheet-export-summary]')).toHaveText('1 page · A3 landscape');
  const bytes = await downloaded(page, () =>
    dialog.getByRole('button', { name: 'Export' }).click(),
  );
  if (process.env.SHEET_SHOTS) await writeFile(join(process.env.SHEET_SHOTS, 'export.pdf'), bytes);
  const pdf = pdfContent(bytes);
  // The invisible text layer writes each string in hex ("74" is <3734>).
  const hex = (value: string) => Buffer.from(value, 'latin1').toString('hex').toUpperCase();
  for (const value of ['55', '80', '74']) expect(pdf).toContain(`<${hex(value)}> Tj`);
});

test('a deleted or suppressed feature detaches its dimension; undo attaches it again', async ({
  page,
}, info) => {
  await openBox(page, info.outputPath('box.extrudo'));
  await expect(text(page, 'df')).toHaveText('74', { timeout: 60_000 });

  // Delete the pocket (Extrude2) in the model, then back to the drawing.
  await page.getByRole('button', { name: 'Finish Drawing' }).first().click();
  await chip(page, 'Extrude2').click({ button: 'right' });
  await menuItem(page, 'Delete').click();
  await openDrawing(page);
  await expect.poll(() => states(page, 'df'), { timeout: 60_000 }).toEqual(['detached']);
  // Drawn where it was (the geometry kept this session), in red and dashed.
  const dash = sheet(page)
    .locator('[data-sheet-paper] > svg path[data-key="item:df"][stroke-dasharray]')
    .first();
  await expect(dash).toHaveAttribute('stroke', '#d93d3d');
  expect(await states(page, 'dh')).toEqual([null]);
  await expect(dimensionRow(page, 'df')).toHaveAttribute('data-state', 'detached');
  await expect(dimensionRow(page, 'df')).toContainText('lost its edge');
  await dimensionRow(page, 'df').getByRole('button').click();
  await expect(status(page)).toHaveText('The feature this was measured on is deleted.');
  await expect(status(page)).toHaveAttribute('data-state', 'detached');
  await shot(page, 'detached');
  await selectTab(page, 'Drawing');
  await page.locator('#toolbar-groups [data-label="Export PDF"]').click();
  const dialog = page.getByRole('dialog', { name: 'Export drawing' });
  await expect(dialog.locator('[data-sheet-export-summary]')).toHaveText(
    '1 page · A3 landscape · 1 dimension detached, written as ?',
  );
  // The export writes only what the model says now: the lost dimension is its text alone,
  // "?", never the last value the screen kept.
  const lostPdf = await downloaded(page, () =>
    dialog.getByRole('button', { name: 'Export' }).click(),
  );
  if (process.env.SHEET_SHOTS) {
    await writeFile(join(process.env.SHEET_SHOTS, 'export-detached.pdf'), lostPdf);
  }
  const content = pdfContent(lostPdf);
  expect(content).toContain(`<${hexOf('?')}> Tj`);
  expect(content).not.toContain(`<${hexOf('74')}> Tj`);
  expect(content).toContain(`<${hexOf('40')}> Tj`);

  // Undo in the drawing is a plain undo: the pocket is back, and so is the dimension.
  await page.keyboard.press('Control+z');
  await expect.poll(() => states(page, 'df'), { timeout: 60_000 }).toEqual([null]);
  await expect(text(page, 'df')).toHaveText('74');
  await expect(dimensionRow(page, 'df')).toHaveAttribute('data-state', 'ok');

  // Suppressed: detached with the kernel's reason.
  await page.getByRole('button', { name: 'Finish Drawing' }).first().click();
  await chip(page, 'Extrude2').click({ button: 'right' });
  await menuItem(page, 'Suppress').click();
  await openDrawing(page);
  await expect.poll(() => states(page, 'df'), { timeout: 60_000 }).toEqual(['detached']);
  await dimensionRow(page, 'df').getByRole('button').click();
  await expect(status(page)).toHaveText(
    'Extrude2, the feature this was measured on, is suppressed. Unsuppress it to show the dimension again.',
  );
});
