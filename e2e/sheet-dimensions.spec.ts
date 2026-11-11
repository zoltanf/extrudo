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
import {
  kernelReady,
  openProject,
  parameterExpression,
  parametersDialog,
  pickTool,
  selectTab,
} from './helpers';

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
  const pdf = pdfContent(
    await downloaded(page, () => dialog.getByRole('button', { name: 'Export' }).click()),
  );
  // The invisible text layer writes each string in hex ("74" is <3734>).
  const hex = (value: string) => Buffer.from(value, 'latin1').toString('hex');
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
    '1 page · A3 landscape · 1 dimension detached',
  );
  await page.keyboard.press('Escape');

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

// The Dimension tool ------------------------------------------------------------------

const toolPanel = (page: Page) => page.getByRole('region', { name: 'Dimension tool' });
const dimensionCard = (page: Page) => page.getByRole('region', { name: 'Dimension', exact: true });
const selectedTargets = (page: Page) => sheet(page).getAttribute('data-selected');

/** The screen point of sheet point (`x`, `y`) mm on an A3 landscape sheet. */
async function onSheet(page: Page, x: number, y: number) {
  const box = await sheet(page).locator('[data-sheet-paper]').boundingBox();
  if (!box) throw new Error('No paper');
  return { x: box.x + (x / 420) * box.width, y: box.y + (y / 297) * box.height };
}

/** A view's lines' box in sheet mm (strokes left out), once none of them is stale. */
async function viewBox(page: Page, id: string): Promise<[number, number, number, number]> {
  const paths = sheet(page).locator(
    `[data-sheet-paper] > svg path[data-key="view:${id}"][stroke-width]`,
  );
  await expect
    .poll(() => paths.evaluateAll((all) => all.length > 0 && all.every((p) => !p.dataset.state)), {
      timeout: 60_000,
    })
    .toBe(true);
  return paths.evaluateAll((all) => {
    let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
    for (const p of all) {
      const b = (p as unknown as SVGGraphicsElement).getBBox();
      x0 = Math.min(x0, b.x);
      y0 = Math.min(y0, b.y);
      x1 = Math.max(x1, b.x + b.width);
      y1 = Math.max(y1, b.y + b.height);
    }
    return [x0, y0, x1, y1] as [number, number, number, number];
  });
}

/** An empty A3 sheet of the wall bracket with its front and top views at 2:1. */
async function bracketSheet(page: Page) {
  await openProject(page, 'wall-bracket');
  await kernelReady(page);
  await selectTab(page, 'Make');
  await pickTool(page, 'Drawing');
  const dialog = page.getByRole('dialog', { name: 'New drawing' });
  await dialog.getByRole('radio', { name: 'Empty sheet' }).click();
  await dialog.getByRole('button', { name: 'Create Drawing' }).click();
  await expect(dialog).toHaveCount(0);
  const ids: string[] = [];
  for (const [looking, x, y] of [
    ['Front', 110, 140],
    ['Top', 290, 150],
  ] as const) {
    await page.locator('#toolbar-groups [data-label="Base View"]').click();
    const panel = page.getByRole('region', { name: 'Base view' });
    await panel.getByRole('combobox', { name: 'Looking from' }).selectOption({ label: looking });
    await panel.getByRole('combobox', { name: 'Scale' }).selectOption('2:1');
    const at = await onSheet(page, x, y);
    await page.mouse.move(at.x - 20, at.y - 20);
    await page.mouse.move(at.x, at.y, { steps: 4 });
    await expect(sheet(page).locator('[data-sheet-placing]')).toBeVisible();
    await page.mouse.click(at.x, at.y);
    await expect.poll(() => selectedTargets(page)).toMatch(/^view:/);
    ids.push(((await selectedTargets(page)) ?? '').slice(5));
    // Base View carries on as Projected View: Esc ends it.
    await page.keyboard.press('Escape');
  }
  return { front: ids[0] as string, top: ids[1] as string };
}

/** Clicks sheet point (`x`, `y`) with the tool, waiting for it to read a pick there. */
async function pickAt(page: Page, x: number, y: number) {
  const at = await onSheet(page, x, y);
  await page.mouse.move(at.x - 3, at.y - 3);
  await page.mouse.move(at.x, at.y, { steps: 3 });
  await expect(sheet(page).locator('[data-dimension-hover]')).toHaveCount(1);
  await page.mouse.click(at.x, at.y);
  await expect(toolPanel(page).locator('[data-dimension-step]')).not.toHaveText(
    'Reading the pick…',
  );
}

/** Moves to sheet point (`x`, `y`) until the preview reads `text`, then clicks to place. */
async function placeAt(page: Page, x: number, y: number, text: string | RegExp) {
  const at = await onSheet(page, x, y);
  await page.mouse.move(at.x - 4, at.y - 4);
  await page.mouse.move(at.x, at.y, { steps: 3 });
  const preview = sheet(page).locator('[data-dimension-preview]');
  await expect(preview).toHaveAttribute('data-text', text);
  const before = await sheet(page).locator('[data-sheet-text] text[data-key^="item:"]').count();
  await page.mouse.click(at.x, at.y);
  await expect(sheet(page).locator('[data-sheet-text] text[data-key^="item:"]')).toHaveCount(
    before + 1,
  );
}

/** The texts of the sheet's items. */
const itemTexts = (page: Page) =>
  sheet(page).locator('[data-sheet-text] text[data-key^="item:"]').allTextContents();

test('the Dimension tool places a length, a distance, an angle and a diameter; they follow the model; the card', async ({
  page,
}) => {
  const { front, top } = await bracketSheet(page);
  const [fx0, fy0, fx1, fy1] = await viewBox(page, front);
  const [tx0, ty0, , ty1] = await viewBox(page, top);
  const ty = (ty0 + ty1) / 2;

  await page.locator('#toolbar-groups [data-label="Dimension"]').click();
  await expect(toolPanel(page)).toBeVisible();
  await expect(toolPanel(page).locator('[data-dimension-waiting]')).toHaveCount(0, {
    timeout: 60_000,
  });
  await expect(toolPanel(page).locator('[data-dimension-step]')).toHaveText(
    'Pick an edge, a point or a circle.',
  );

  // A length: the wall's outside edge (60 less the 3.6 mm outside round), placed to its left.
  await pickAt(page, fx0, fy0 + 30);
  await expect(sheet(page).locator('[data-dimension-picked]')).toHaveCount(1);
  await placeAt(page, fx0 - 15, fy0 + 30, '56.4');
  await shot(page, 'placing-done');

  // A distance: the wall's outside edge and the foot's end, parallel: 40, placed below.
  await pickAt(page, fx0, fy0 + 60);
  await pickAt(page, fx1, fy1 - 2.4);
  const below = await onSheet(page, (fx0 + fx1) / 2, fy1 + 14);
  await page.mouse.move(below.x, below.y, { steps: 3 });
  await expect(sheet(page).locator('[data-dimension-preview]')).toHaveAttribute(
    'data-text',
    '40.0',
  );
  await shot(page, 'placing');
  await placeAt(page, (fx0 + fx1) / 2, fy1 + 14, '40.0');

  // An angle: the wall's outside edge and the foot's underside.
  await pickAt(page, fx0, fy0 + 80);
  await pickAt(page, fx0 + 50, fy1);
  await placeAt(page, fx0 + 20, fy1 - 25, '90.0°');

  // A diameter: a hole's rim in the top view (25 mm along X, 20 mm either side of the middle).
  await pickAt(page, tx0 + 50 + 5, ty - 40);
  await placeAt(page, tx0 + 75, ty - 58, /^Ø\d/);

  // The first Esc drops a pick; the tool stays on.
  await pickAt(page, tx0, ty + 30);
  await expect(sheet(page).locator('[data-dimension-picked]')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(sheet(page).locator('[data-dimension-picked]')).toHaveCount(0);
  await expect(toolPanel(page)).toBeVisible();

  // A length that follows a parameter: the wall's top edge in the top view, 80 = width.
  await pickAt(page, tx0, ty + 10);
  await placeAt(page, tx0 - 15, ty + 10, '80.0');
  await shot(page, 'several');
  await page.keyboard.press('Escape');
  await expect(toolPanel(page)).toHaveCount(0);
  expect(await itemTexts(page)).toEqual(expect.arrayContaining(['56.4', '40.0', '90.0°', '80.0']));

  // width 80 → 100 mm: the top view's edge follows.
  await selectTab(page, 'Home');
  await pickTool(page, 'Parameters');
  const expr = await parameterExpression(page, 'width');
  await expr.fill('100 mm');
  await expr.press('Enter');
  await page.keyboard.press('Escape');
  await expect(parametersDialog(page)).toHaveCount(0);
  await expect.poll(() => itemTexts(page), { timeout: 30_000 }).toContain('100.0');

  // The card: each change is one undo step.
  const row = browser(page).locator('[data-sheet-item-row]').filter({ hasText: '100.0' });
  await row.getByRole('button').click();
  await expect(dimensionCard(page)).toBeVisible();
  const decimals = dimensionCard(page).getByRole('textbox', { name: 'Decimals' });
  await decimals.fill('2');
  await decimals.press('Enter');
  await expect.poll(() => itemTexts(page)).toContain('100.00');
  const before = dimensionCard(page).getByRole('textbox', { name: 'Text before' });
  await before.fill('2×');
  await before.press('Enter');
  await expect.poll(() => itemTexts(page)).toContain('2×100.00');
  await dimensionCard(page).getByRole('switch', { name: 'In brackets (reference)' }).click();
  await expect.poll(() => itemTexts(page)).toContain('(2×100.00)');
  await shot(page, 'card');
  // Horizontal on an upright edge measures across it: 0.
  await dimensionCard(page).getByRole('radio', { name: 'Horizontal' }).click();
  await expect.poll(() => itemTexts(page)).toContain('(2×0.00)');
  for (const text of ['(2×100.00)', '2×100.00', '100.00', '100.0']) {
    await page.keyboard.press('Control+z');
    await expect.poll(() => itemTexts(page)).toContain(text);
  }

  // The holes deleted (Extrude2): the diameter is lost; dragging its end onto an edge picks
  // that instead; undo takes that back, and undo again brings the holes and the diameter back.
  const diameter = browser(page).locator('[data-sheet-item-row]').filter({ hasText: 'Ø' });
  const id = (await diameter.getAttribute('data-sheet-item-row')) ?? '';
  await selectTab(page, 'Drawing');
  await page.getByRole('button', { name: 'Finish Drawing' }).first().click();
  await chip(page, 'Extrude2').click({ button: 'right' });
  await menuItem(page, 'Delete').click();
  await browser(page).locator('[data-sheet-row]').first().dblclick();
  await expect(dimensionRow(page, id)).toHaveAttribute('data-state', 'detached', {
    timeout: 60_000,
  });
  await dimensionRow(page, id).getByRole('button').click();
  await expect(status(page)).toHaveText('The feature this was measured on is deleted.');
  await expect(dimensionCard(page)).toContainText('The feature this was measured on is deleted.');
  await shot(page, 'lost');
  const handle = sheet(page).locator('[data-repick-handle="0"]');
  await expect(handle).toBeVisible();
  const [ux0, uy0, , uy1] = await viewBox(page, top);
  const from = await handle.boundingBox();
  const to = await onSheet(page, ux0, (uy0 + uy1) / 2 + 30);
  if (!from) throw new Error('No handle');
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await expect(sheet(page).locator('[data-dimension-hover]')).toHaveCount(1);
  await page.mouse.up();
  await expect(dimensionRow(page, id)).toHaveAttribute('data-state', 'ok');
  await expect(text(page, id)).toHaveText('100.0');
  await page.keyboard.press('Control+z');
  await expect(dimensionRow(page, id)).toHaveAttribute('data-state', 'detached');
  await page.keyboard.press('Control+z');
  await expect(dimensionRow(page, id)).toHaveAttribute('data-state', 'ok', { timeout: 60_000 });
  await expect(text(page, id)).toHaveText(/^Ø\d/);

  // The export writes them.
  await selectTab(page, 'Drawing');
  await page.locator('#toolbar-groups [data-label="Export PDF"]').click();
  const dialog = page.getByRole('dialog', { name: 'Export drawing' });
  const bytes = await downloaded(page, () =>
    dialog.getByRole('button', { name: 'Export' }).click(),
  );
  if (process.env.SHEET_SHOTS) await writeFile(join(process.env.SHEET_SHOTS, 'export.pdf'), bytes);
  const pdf = pdfContent(bytes);
  const hex = (value: string) => Buffer.from(value, 'latin1').toString('hex');
  for (const value of ['100.0', '40.0', '56.4', '90.0°'])
    expect(pdf).toContain(`<${hex(value)}> Tj`);
});
