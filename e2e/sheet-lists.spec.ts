import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';
import { type Download, expect, type Page, test } from '@playwright/test';
import type {
  BodyId,
  DocumentId,
  ExtrudoDocument,
  Feature,
  FeatureId,
  ParameterId,
  PrimitiveInputOptions,
} from '../packages/core/src/index';
import { createDocument, primitiveInputs } from '../packages/core/src/index';
import { writeArchive } from '../packages/storage/src/archive';
import {
  kernelReady,
  parameterExpression,
  parametersDialog,
  pickTool,
  selectParameter,
  selectTab,
} from './helpers';

// P6-24 S5, the list tools (ADR-0143's S5 amendments): the reference's base-frame sheet
// rebuilt by hand on a design with a top and two equal legs (the second turned a quarter):
// Standard views, a parts list whose legs are one row with Qty 2 and their sizes, balloons
// numbered 1, 2, 2, a typed material, a hidden column, a free table typed in place, a text
// with `{= legs}` that follows a parameter change and a rename, a leg deleted and its balloon
// picked again, undo of each step, and the exported PDF's text.

test.use({ viewport: { width: 1440, height: 900 } });
test.describe.configure({ timeout: 300_000 });
// Run it alone with `SHEET_SHOTS=<dir>` for pictures (see `shot`).

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
const row = (page: Page, id: string) => browser(page).locator(`[data-sheet-item-row="${id}"]`);
const chip = (page: Page, name: string) =>
  page
    .getByRole('list', { name: 'Features' })
    .getByRole('button', { name: new RegExp(`^${name}`) });
const menuItem = (page: Page, name: string) =>
  page.getByRole('menuitem', { name: new RegExp(`^${name}`) });
const tile = (page: Page, label: string) => page.locator(`#toolbar-groups [data-label="${label}"]`);
/** An item's drawn paths on the sheet. */
const paths = (page: Page, id: string) =>
  sheet(page).locator(`[data-sheet-paper] > svg path[data-key="item:${id}"]`);
/** The texts one item draws (the invisible text layer), in order. */
const textsOf = (page: Page, id: string) =>
  sheet(page).locator(`[data-sheet-text] text[data-key="item:${id}"]`).allTextContents();
const step = (page: Page) => page.locator('[data-note-step]');
/** The states an item's paths are drawn in (`null`: ok). */
const states = (page: Page, id: string) =>
  paths(page, id).evaluateAll((all) => [...new Set(all.map((p) => p.getAttribute('data-state')))]);

/** Every item row's ID in the browser, in order. */
const itemIds = (page: Page) =>
  browser(page)
    .locator('[data-sheet-item-row]')
    .evaluateAll((all) => all.map((r) => r.getAttribute('data-sheet-item-row') ?? ''));

/** The ID of the one item row that is new since `before`. */
async function newItem(page: Page, before: readonly string[]): Promise<string> {
  await expect.poll(async () => (await itemIds(page)).length).toBe(before.length + 1);
  const id = (await itemIds(page)).find((i) => !before.includes(i));
  if (!id) throw new Error('No new item');
  return id;
}

/** The screen point of sheet point (`x`, `y`) mm on an A3 landscape sheet. */
async function onSheet(page: Page, x: number, y: number) {
  const box = await sheet(page).locator('[data-sheet-paper]').boundingBox();
  if (!box) throw new Error('No paper');
  return { x: box.x + (x / 420) * box.width, y: box.y + (y / 297) * box.height };
}

/** A view's lines' box in sheet mm (strokes left out), once none of them is stale. */
async function viewBox(page: Page, id: string): Promise<[number, number, number, number]> {
  const lines = sheet(page).locator(
    `[data-sheet-paper] > svg path[data-key="view:${id}"][stroke-width]`,
  );
  await expect
    .poll(() => lines.evaluateAll((all) => all.length > 0 && all.every((p) => !p.dataset.state)), {
      timeout: 60_000,
    })
    .toBe(true);
  return lines.evaluateAll((all) => {
    let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
    for (const p of all) {
      const b = (
        p as unknown as { getBBox(): { x: number; y: number; width: number; height: number } }
      ).getBBox();
      x0 = Math.min(x0, b.x);
      y0 = Math.min(y0, b.y);
      x1 = Math.max(x1, b.x + b.width);
      y1 = Math.max(y1, b.y + b.height);
    }
    return [x0, y0, x1, y1] as [number, number, number, number];
  });
}

/** Moves to sheet point (`x`, `y`) and waits for the tool to show what a click takes. */
async function hoverAt(page: Page, x: number, y: number, what = '[data-dimension-hover]') {
  const at = await onSheet(page, x, y);
  await page.mouse.move(at.x - 3, at.y - 3);
  await page.mouse.move(at.x, at.y, { steps: 3 });
  await expect(sheet(page).locator(what)).toHaveCount(1);
  return at;
}

/** Clicks sheet point (`x`, `y`) with a pick tool, waiting for it to read the pick. */
async function pickAt(page: Page, x: number, y: number, what?: string) {
  const at = await hoverAt(page, x, y, what);
  await page.mouse.click(at.x, at.y);
  await expect(step(page)).not.toHaveText('Reading the pick…');
}

/** Moves to sheet point (`x`, `y`) in steps and clicks there. */
async function clickAt(page: Page, x: number, y: number) {
  const at = await onSheet(page, x, y);
  await page.mouse.move(at.x - 4, at.y - 4);
  await page.mouse.move(at.x, at.y, { steps: 3 });
  await page.mouse.click(at.x, at.y);
}

/** Types into the field on the sheet: lines joined by Shift+Enter, finished by Enter. */
async function typeOnSheet(page: Page, kind: string, lines: readonly string[]) {
  const field = sheet(page).locator(`[data-sheet-editor="${kind}"]`);
  await expect(field).toBeFocused();
  for (const [i, line] of lines.entries()) {
    if (i > 0) await page.keyboard.press('Shift+Enter');
    await page.keyboard.type(line);
  }
  await page.keyboard.press('Enter');
  await expect(field).toHaveCount(0);
}

/** Undo takes item `id` away and redo brings it back: it was one undo step. */
async function oneStep(page: Page, id: string) {
  await page.keyboard.press('Control+z');
  await expect(row(page, id)).toHaveCount(0);
  await page.keyboard.press('Control+y');
  await expect(row(page, id)).toHaveCount(1);
}

/** Undo puts `check` back to what it was before the step, and redo again: one step. */
async function undoRedo(page: Page, before: () => Promise<unknown>, after: () => Promise<unknown>) {
  await page.keyboard.press('Control+z');
  await before();
  await page.keyboard.press('Control+y');
  await after();
}

async function downloaded(page: Page, click: () => Promise<unknown>) {
  const [download] = (await Promise.all([page.waitForEvent('download'), click()])) as [
    Download,
    unknown,
  ];
  return readFile(await download.path());
}

/** A string as the PDF's text layer writes it (lowercase hex). */
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

// The design ---------------------------------------------------------------------------

function primitive(id: string, options: PrimitiveInputOptions): Feature {
  return {
    id: id as FeatureId,
    type: 'box',
    name: id,
    suppressed: false,
    inputs: primitiveInputs('box', options),
  } satisfies Feature;
}

/**
 * The base frame (as `parts.kernel.test.ts` builds it): a 600 × 400 × 18 mm top on two
 * 50 × 50 mm legs `legs` (700 mm) tall, the second turned a quarter; each box centred on its
 * x and y, from z 0 up.
 */
async function frameFile(path: string) {
  const leg = { length: '50 mm', width: '50 mm', height: 'legs' };
  const features = [
    primitive('Top', {
      numbers: { length: '600 mm', width: '400 mm', height: '18 mm', offset: 'legs' },
    }),
    primitive('Leg1', { numbers: { ...leg, x: '-250 mm', y: '-150 mm' } }),
    primitive('Leg2', { numbers: { ...leg, x: '250 mm', y: '150 mm', rotation: '90 deg' } }),
  ];
  const doc: ExtrudoDocument = {
    ...createDocument({
      id: 'base-frame' as DocumentId,
      name: 'Base frame',
      now: '2026-11-11T10:00:00.000Z',
    }),
    parameters: [
      { id: 'p-legs' as ParameterId, name: 'legs', expression: '700 mm', unit: 'length' },
    ],
    features,
    timelineMarker: features.length,
    bodies: {
      ['Top:0' as BodyId]: { name: 'Top', visible: true },
      ['Leg1:0' as BodyId]: { name: 'Leg 1', visible: true },
      ['Leg2:0' as BodyId]: { name: 'Leg 2', visible: true },
    },
  };
  await writeFile(path, writeArchive(doc));
}

/** Opens the base frame and starts its drawing with New drawing's Standard views. */
async function frameSheet(page: Page, file: string) {
  await frameFile(file);
  await page.goto('./');
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.getByRole('button', { name: 'Import…', exact: true }).click(),
  ]);
  await chooser.setFiles(file);
  await kernelReady(page);
  await selectTab(page, 'Make');
  await pickTool(page, 'Drawing');
  const dialog = page.getByRole('dialog', { name: 'New drawing' });
  await dialog.getByRole('button', { name: 'Create Drawing' }).click();
  await expect(dialog).toHaveCount(0);
  const views = browser(page).locator('[data-sheet-view-row]');
  await expect(views).toHaveCount(4);
  const id = async (name: string) =>
    (await views
      .filter({ hasText: new RegExp(`^${name}$`) })
      .getAttribute('data-sheet-view-row')) ?? '';
  return { front: await id('Front'), top: await id('Top') };
}

test('the list tools rebuild the base-frame sheet: parts list, balloons, table, fields, each one undo step, exported', async ({
  page,
}, info) => {
  const { front } = await frameSheet(page, info.outputPath('base-frame.extrudo'));
  // The front view: x right (the top from -300 to 300), z up (0 to 718 at the top's face).
  const [fx0, fy0, fx1, fy1] = await viewBox(page, front);
  const k = (fx1 - fx0) / 600;
  const fAt = (x: number, z: number): [number, number] => [fx0 + k * (x + 300), fy1 - k * z];

  // Whole millimetres, as the reference's base-frame sheet: Sheet Setup's Decimals.
  const decimals = page
    .getByRole('region', { name: 'Sheet setup' })
    .getByRole('textbox', { name: 'Decimals' });
  await decimals.fill('0');
  await decimals.press('Enter');

  // Parts List: click the front view, then where the list goes; one undo step.
  let before = await itemIds(page);
  await tile(page, 'Parts List').click();
  const listPanel = page.getByRole('region', { name: 'Parts List tool' });
  await expect(listPanel).toBeVisible();
  await expect(step(page)).toHaveText('Click a view: its bodies become the rows.');
  await clickAt(page, (fx0 + fx1) / 2, (fy0 + fy1) / 2);
  await expect(step(page)).toHaveText(/^Click where the list of Front goes/);
  await expect(sheet(page).locator('[data-parts-view]')).toHaveCount(1);
  const listAt = await onSheet(page, 272, 28);
  await page.mouse.move(listAt.x, listAt.y, { steps: 4 });
  await shot(page, 'parts-list-placing');
  await page.mouse.click(listAt.x, listAt.y);
  const list = await newItem(page, before);
  await expect(row(page, list)).toContainText('Parts list');
  await expect(row(page, list)).toContainText('Front');
  // Its rows from the model: the top, then the two legs merged, Qty 2, their sizes.
  await expect
    .poll(() => textsOf(page, list), { timeout: 60_000 })
    .toEqual(
      expect.arrayContaining(['ITEM', 'QTY', 'NAME', 'SIZE (MM)', 'Top', '600 × 400 × 18', 'Leg']),
    );
  const cells = await textsOf(page, list);
  expect(cells).toContain('700 × 50 × 50');
  expect(cells.filter((t) => t === '2')).toHaveLength(2); // item 2, qty 2
  expect(cells).not.toContain('Leg 1');
  await oneStep(page, list);
  await page.keyboard.press('Escape');
  await expect(listPanel).toHaveCount(0);

  // Balloons (B): the top, then each leg; numbered 1, 2, 2 by the list; each one step.
  await page.keyboard.press('b');
  const balloonPanel = page.getByRole('region', { name: 'Balloon tool' });
  await expect(balloonPanel).toContainText('Front: numbered by its parts list.');
  await expect(step(page)).toHaveText(
    'Pick a part in a view with a parts list: an edge, a point or a face.',
  );
  const balloons: string[] = [];
  for (const [pick, place] of [
    [fAt(60, 718), fAt(120, 820)],
    [fAt(-275, 350), fAt(-380, 420)],
    [fAt(275, 350), fAt(380, 420)],
  ] as const) {
    before = await itemIds(page);
    await pickAt(page, pick[0], pick[1]);
    await expect(step(page)).toHaveText('Click where the balloon goes.');
    const at = await onSheet(page, place[0], place[1]);
    await page.mouse.move(at.x, at.y, { steps: 4 });
    await expect(sheet(page).locator('[data-dimension-preview]')).toHaveCount(1);
    if (balloons.length === 1) await shot(page, 'balloon-placing');
    await page.mouse.click(at.x, at.y);
    const id = await newItem(page, before);
    balloons.push(id);
    await oneStep(page, id);
  }
  const [b1, b2, b3] = balloons as [string, string, string];
  await expect.poll(() => textsOf(page, b1)).toEqual(['1']);
  await expect.poll(() => textsOf(page, b2)).toEqual(['2']);
  await expect.poll(() => textsOf(page, b3)).toEqual(['2']);
  await expect(row(page, b3)).toContainText('Balloon 2');
  await page.keyboard.press('Escape');
  await expect(balloonPanel).toHaveCount(0);

  // The parts list's card: a typed material, a typed name and back to the model's, a hidden
  // column; each one undo step.
  await row(page, list).getByRole('button').click();
  const card = page.getByRole('region', { name: 'Parts list' });
  await expect(card).toBeVisible();
  const material = card.getByRole('textbox', { name: 'Material, row 1' });
  await material.fill('Birch plywood 18');
  await material.press('Enter');
  await expect.poll(() => textsOf(page, list)).toContain('Birch plywood 18');
  await undoRedo(
    page,
    () => expect.poll(() => textsOf(page, list)).not.toContain('Birch plywood 18'),
    () => expect.poll(() => textsOf(page, list)).toContain('Birch plywood 18'),
  );
  const name = card.getByRole('textbox', { name: 'Name, row 2' });
  await expect(name).toHaveAttribute('placeholder', 'Leg');
  await name.fill('Leg, planed');
  await name.press('Enter');
  await expect.poll(() => textsOf(page, list)).toContain('Leg, planed');
  await card.getByRole('button', { name: "Model's name, row 2" }).click();
  await expect.poll(() => textsOf(page, list)).toContain('Leg');
  await expect.poll(() => textsOf(page, list)).not.toContain('Leg, planed');
  await card.getByRole('checkbox', { name: 'Mass' }).uncheck();
  await expect.poll(() => textsOf(page, list)).not.toContain('MASS (G)');
  await undoRedo(
    page,
    () => expect.poll(() => textsOf(page, list)).toContain('MASS (G)'),
    () => expect.poll(() => textsOf(page, list)).not.toContain('MASS (G)'),
  );
  await shot(page, 'parts-list-card');
  await page.keyboard.press('Escape');

  // A free table: placed by a click, a cell typed in place (a double-click), a row added on
  // its card; each one undo step.
  before = await itemIds(page);
  await tile(page, 'Table').click();
  await expect(page.getByRole('region', { name: 'Table tool' })).toBeVisible();
  await clickAt(page, 322, 200);
  const table = await newItem(page, before);
  await expect(row(page, table)).toContainText('3 × 2');
  await oneStep(page, table);
  await page.keyboard.press('Escape');
  const cell = await onSheet(page, 327, 203.5);
  await page.mouse.dblclick(cell.x, cell.y);
  await shot(page, 'table-typing');
  await typeOnSheet(page, 'cell', ['Finish']);
  await expect.poll(() => textsOf(page, table)).toEqual(['Finish']);
  await undoRedo(
    page,
    () => expect.poll(() => textsOf(page, table)).toEqual([]),
    () => expect.poll(() => textsOf(page, table)).toEqual(['Finish']),
  );
  const second = await onSheet(page, 352, 203.5);
  await page.mouse.dblclick(second.x, second.y);
  await typeOnSheet(page, 'cell', ['Oiled, two coats']);
  await expect.poll(() => textsOf(page, table)).toEqual(['Finish', 'Oiled, two coats']);
  const tableCard = page.getByRole('region', { name: 'Table' });
  await tableCard.getByRole('button', { name: 'Add row' }).click();
  await expect(row(page, table)).toContainText('4 × 2');
  await undoRedo(
    page,
    () => expect(row(page, table)).toContainText('3 × 2'),
    () => expect(row(page, table)).toContainText('4 × 2'),
  );
  await page.keyboard.press('Escape');

  // A text with a parameter's value in braces, and a field inserted from its card.
  before = await itemIds(page);
  await page.keyboard.press('t');
  await clickAt(page, 30, 250);
  await typeOnSheet(page, 'text', ['Legs {= legs}, sheet ']);
  const text = await newItem(page, before);
  await expect.poll(() => textsOf(page, text)).toEqual(['Legs 700 mm, sheet ']);
  await page.keyboard.press('Escape');
  await row(page, text).getByRole('button').click();
  const textCard = page.getByRole('region', { name: 'Text', exact: true });
  await textCard.getByRole('combobox', { name: 'Insert field' }).selectOption('{sheet}');
  await expect(textCard.getByRole('textbox', { name: 'Text' })).toHaveValue(
    'Legs {= legs}, sheet {sheet}',
  );
  await expect.poll(() => textsOf(page, text)).toEqual(['Legs 700 mm, sheet 1']);
  await page.keyboard.press('Escape');

  // legs 700 → 650 mm: the text, the legs' size and the views follow.
  await selectTab(page, 'Home');
  await pickTool(page, 'Parameters');
  const expr = await parameterExpression(page, 'legs');
  await expr.fill('650 mm');
  await expr.press('Enter');
  // Renamed: the field's expression is rewritten, the sheet reads the same.
  await selectParameter(page, 'legs');
  const rename = parametersDialog(page).getByRole('textbox', { name: 'Name of legs' });
  await rename.fill('legHeight');
  await rename.press('Enter');
  await page.keyboard.press('Escape');
  await expect(parametersDialog(page)).toHaveCount(0);
  await expect
    .poll(() => textsOf(page, text), { timeout: 60_000 })
    .toEqual(['Legs 650 mm, sheet 1']);
  await expect.poll(() => textsOf(page, list), { timeout: 60_000 }).toContain('650 × 50 × 50');
  await row(page, text).getByRole('button').click();
  await expect(textCard.getByRole('textbox', { name: 'Text' })).toHaveValue(
    'Legs {= legHeight}, sheet {sheet}',
  );
  await page.keyboard.press('Escape');
  await shot(page, 'base-frame-sheet');

  // Leg2 deleted: its balloon is lost (red, dashed) and the list has one leg; the balloon's
  // end dragged onto Leg 1 picks it again (number 2); undo twice brings Leg2 back.
  await page.getByRole('button', { name: 'Finish Drawing' }).first().click();
  await chip(page, 'Leg2').click({ button: 'right' });
  await menuItem(page, 'Delete').click();
  await browser(page).locator('[data-sheet-row]').first().dblclick();
  await expect(row(page, b3)).toHaveAttribute('data-state', 'detached', { timeout: 60_000 });
  await expect.poll(() => states(page, b3)).toContain('detached');
  await expect.poll(() => textsOf(page, list)).toContain('Leg 1');
  await row(page, b3).getByRole('button').click();
  await expect(page.getByRole('region', { name: 'Balloon' })).toContainText('deleted');
  await shot(page, 'balloon-lost');
  const handle = sheet(page).locator('[data-repick-handle="0"]');
  await expect(handle).toBeVisible();
  const [gx0, , gx1, gy1] = await viewBox(page, front);
  const g = (gx1 - gx0) / 600;
  const from = await handle.boundingBox();
  const to = await onSheet(page, gx0 + g * (300 - 225), gy1 - g * 300);
  if (!from) throw new Error('No handle');
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await expect(sheet(page).locator('[data-dimension-hover]')).toHaveCount(1);
  await page.mouse.up();
  await expect(row(page, b3)).toHaveAttribute('data-state', 'ok');
  await expect.poll(() => textsOf(page, b3)).toEqual(['2']);
  await page.keyboard.press('Control+z');
  await expect(row(page, b3)).toHaveAttribute('data-state', 'detached');
  await page.keyboard.press('Control+z');
  await expect(row(page, b3)).toHaveAttribute('data-state', 'ok', { timeout: 60_000 });
  await expect.poll(() => textsOf(page, list), { timeout: 60_000 }).toContain('Leg');
  await page.keyboard.press('Escape');

  // The export reads the rows and the fields again and writes them.
  await selectTab(page, 'Drawing');
  await tile(page, 'Export PDF').click();
  const dialog = page.getByRole('dialog', { name: 'Export drawing' });
  await expect(dialog.locator('[data-sheet-export-summary]')).toHaveText('1 page · A3 landscape');
  const bytes = await downloaded(page, () =>
    dialog.getByRole('button', { name: 'Export' }).click(),
  );
  await expect(dialog).toHaveCount(0);
  if (process.env.SHEET_SHOTS) await writeFile(join(process.env.SHEET_SHOTS, 'export.pdf'), bytes);
  const pdf = pdfContent(bytes);
  for (const written of [
    'Birch plywood 18',
    '600 × 400 × 18',
    '650 × 50 × 50',
    'Legs 650 mm, sheet 1',
    'Oiled, two coats',
    'SIZE (MM)',
  ]) {
    expect(pdf, written).toContain(`<${hexOf(written)}> Tj`);
  }
  expect(pdf).not.toContain(`<${hexOf('MASS (G)')}> Tj`);
});
