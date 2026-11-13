import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';
import { type Download, expect, type Page, test } from '@playwright/test';
import { kernelReady, openProject, pickTool, selectTab } from './helpers';

// P6-24 S4, the notes tools (ADR-0143's S4 amendments): mock-up 1's sheet rebuilt by hand on
// the wall bracket template: Standard views, two dimensions, a centre mark on a hole, a
// centre line between the foot's edges, a leader note on a hole and one on a face, a text and
// a sticky note, each one undo step; typing in place; the view's Centre lines switch; a
// leader lost with its hole and picked again; the export with and without the sticky note.

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
const status = (page: Page) => page.locator('output[aria-label="Status"]');
const row = (page: Page, id: string) => browser(page).locator(`[data-sheet-item-row="${id}"]`);
const notes = (page: Page) => browser(page).getByRole('button', { name: /^Notes/ });
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
/** The texts of the sheet's items (the invisible text layer). */
const itemTexts = (page: Page) =>
  sheet(page).locator('[data-sheet-text] text[data-key^="item:"]').allTextContents();
const step = (page: Page) => page.locator('[data-note-step]');

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

/** An item's drawn box in sheet mm. */
function itemBox(page: Page, id: string): Promise<[number, number, number, number]> {
  return paths(page, id).evaluateAll((all) => {
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
  await expect(step(page).or(page.locator('[data-dimension-step]'))).not.toHaveText(
    'Reading the pick…',
  );
}

/** Clicks sheet point (`x`, `y`) with no pick: a text or sticky note starts there. */
async function clickAt(page: Page, x: number, y: number) {
  const at = await onSheet(page, x, y);
  await page.mouse.move(at.x, at.y);
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

/** Exports the drawing as PDF, checking the dialog's summary first. */
async function exportPdf(page: Page, summary: RegExp) {
  await selectTab(page, 'Drawing');
  await tile(page, 'Export PDF').click();
  const dialog = page.getByRole('dialog', { name: 'Export drawing' });
  await expect(dialog.locator('[data-sheet-export-summary]')).toHaveText(summary);
  const bytes = await downloaded(page, () =>
    dialog.getByRole('button', { name: 'Export' }).click(),
  );
  await expect(dialog).toHaveCount(0);
  return bytes;
}

/** The wall bracket's drawing with New drawing's Standard views: the views' IDs by name. */
async function bracketSheet(page: Page) {
  await openProject(page, 'wall-bracket');
  await kernelReady(page);
  await selectTab(page, 'Make');
  await pickTool(page, 'Drawing');
  const dialog = page.getByRole('dialog', { name: 'New drawing' });
  await expect(dialog.getByRole('radio', { name: 'Standard views' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
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

test('the notes tools rebuild mock-up 1 by hand: each item one undo step, typed in place, lost and picked again, exported', async ({
  page,
}) => {
  const { front, top } = await bracketSheet(page);
  // The front view: x right, z up (the wall at the left, the foot along the bottom); the top
  // view: x right, y up (the holes at x 25, y ±20; the foot 80 wide).
  const [fx0, fy0, fx1, fy1] = await viewBox(page, front);
  const [tx0, ty0, tx1, ty1] = await viewBox(page, top);
  const k = (tx1 - tx0) / 40;
  const tAt = (x: number, y: number): [number, number] => [tx0 + k * x, (ty0 + ty1) / 2 - k * y];

  // Two dimensions, as S3 makes them: the wall's height and the foot's length.
  await tile(page, 'Dimension').click();
  await expect(page.locator('[data-dimension-waiting]')).toHaveCount(0, { timeout: 60_000 });
  await pickAt(page, fx0, (fy0 + fy1) / 2);
  let at = await onSheet(page, fx0 - 12, (fy0 + fy1) / 2);
  await page.mouse.move(at.x, at.y, { steps: 3 });
  await expect(sheet(page).locator('[data-dimension-preview]')).toHaveAttribute('data-text', /^5/);
  await page.mouse.click(at.x, at.y);
  await pickAt(page, (fx0 + fx1) / 2 + 5, fy1);
  at = await onSheet(page, (fx0 + fx1) / 2, fy1 + 12);
  await page.mouse.move(at.x, at.y, { steps: 3 });
  await expect(sheet(page).locator('[data-dimension-preview]')).toHaveAttribute('data-text', /^\d/);
  await page.mouse.click(at.x, at.y);
  await page.keyboard.press('Escape');
  await expect(browser(page).getByRole('button', { name: /^Dimensions/ })).toBeVisible();

  // A centre mark on a hole's rim (top view), placed by the click.
  let before = await itemIds(page);
  await tile(page, 'Centre Mark').click();
  const markPanel = page.getByRole('region', { name: 'Centre Mark tool' });
  await expect(markPanel).toBeVisible();
  await expect(step(page)).toHaveText('Pick a circle, or a cylinder seen from the side.');
  const rim = tAt(25 + 2.6, 20);
  await pickAt(page, rim[0], rim[1]);
  const mark = await newItem(page, before);
  await expect(paths(page, mark)).not.toHaveCount(0);
  await expect(row(page, mark)).toContainText('Centre mark');
  await oneStep(page, mark);
  await page.keyboard.press('Escape');
  await expect(markPanel).toHaveCount(0);

  // A centre line midway between the foot's two long edges (top view, y ±40).
  before = await itemIds(page);
  await tile(page, 'Centreline').click();
  const back = tAt(15, 40);
  const ahead = tAt(15, -40);
  await pickAt(page, back[0], back[1]);
  await expect(step(page)).toHaveText('Pick the parallel edge on the other side.');
  await pickAt(page, ahead[0], ahead[1]);
  const line = await newItem(page, before);
  await expect(paths(page, line)).not.toHaveCount(0);
  await oneStep(page, line);
  await page.keyboard.press('Escape');

  // A leader note on the other hole's rim (N), its text typed where it goes.
  before = await itemIds(page);
  await page.keyboard.press('n');
  await expect(page.getByRole('region', { name: 'Leader Note tool' })).toBeVisible();
  const hole = tAt(25 + 2.6, -20);
  await pickAt(page, hole[0], hole[1]);
  await expect(step(page)).toHaveText('Click where the text goes, then type.');
  const [lx, ly] = tAt(12, -52);
  at = await onSheet(page, lx, ly);
  await page.mouse.move(at.x, at.y, { steps: 4 });
  await expect(sheet(page).locator('[data-dimension-preview]')).toHaveCount(1);
  await shot(page, 'leader-placing');
  await page.mouse.click(at.x, at.y);
  await typeOnSheet(page, 'leader', ['2 × Ø5 through']);
  const leader = await newItem(page, before);
  await expect.poll(() => itemTexts(page)).toContain('2 × Ø5 through');
  await oneStep(page, leader);

  // A second leader on the foot's top face: a dot, not an arrow.
  before = await itemIds(page);
  const face = tAt(12, 8);
  await pickAt(page, face[0], face[1], '[data-face-hover]');
  const [mx, my] = tAt(-20, 30);
  at = await onSheet(page, mx, my);
  await page.mouse.move(at.x, at.y, { steps: 4 });
  await page.mouse.click(at.x, at.y);
  await typeOnSheet(page, 'leader', ['Top face sanded']);
  const dot = await newItem(page, before);
  await expect(row(page, dot)).toHaveAttribute('data-state', 'ok');
  await page.keyboard.press('Escape');

  // A text of two lines (T): Shift+Enter starts the second, Enter finishes.
  before = await itemIds(page);
  await page.keyboard.press('t');
  await expect(page.getByRole('region', { name: 'Text tool' })).toBeVisible();
  await clickAt(page, 300, 150);
  await shot(page, 'text-typing');
  await typeOnSheet(page, 'text', ['NOTES', '1. Wall and foot 2.4 mm.']);
  const note = await newItem(page, before);
  await expect
    .poll(() => itemTexts(page))
    .toEqual(expect.arrayContaining(['NOTES', '1. Wall and foot 2.4 mm.']));
  await oneStep(page, note);
  // Esc in the field leaves nothing behind.
  await clickAt(page, 300, 200);
  await page.keyboard.type('Never mind');
  await page.keyboard.press('Escape');
  await expect(sheet(page).locator('[data-sheet-editor]')).toHaveCount(0);
  expect(await itemIds(page)).toHaveLength(before.length + 1);
  await page.keyboard.press('Escape');

  // A sticky note: yellow, on screen only until its Print switch is on.
  before = await itemIds(page);
  await tile(page, 'Sticky Note').click();
  await expect(page.getByRole('region', { name: 'Sticky Note tool' })).toBeVisible();
  await clickAt(page, 300, 165);
  await typeOnSheet(page, 'sticky', ['Check the fit', 'after the first print.']);
  const sticky = await newItem(page, before);
  await expect.poll(() => itemTexts(page)).toContain('On screen only');
  await oneStep(page, sticky);
  await page.keyboard.press('Escape');
  await expect(notes(page)).toBeVisible();

  // Snap: the sticky note dragged down, its left edge half a millimetre off the text's, lands
  // on it with a dashed guide; one undo step puts it back.
  const [nx0] = await itemBox(page, note);
  const [sx0, sy0, sx1, sy1] = await itemBox(page, sticky);
  const grab = await onSheet(page, (sx0 + sx1) / 2, (sy0 + sy1) / 2);
  const drop = await onSheet(page, (sx0 + sx1) / 2 + (nx0 + 0.5 - sx0), (sy0 + sy1) / 2 + 40);
  await page.mouse.move(grab.x, grab.y);
  await page.mouse.down();
  await page.mouse.move(drop.x, drop.y, { steps: 10 });
  await expect(sheet(page).locator('[data-sheet-guides]')).toBeVisible();
  await page.mouse.up();
  await expect.poll(async () => (await itemBox(page, sticky))[0]).toBeCloseTo(nx0, 1);
  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await itemBox(page, sticky))[0]).toBeCloseTo(sx0, 1);
  await page.keyboard.press('Escape');
  await shot(page, 'artboard-1');

  // A double-click types the text again where it is: one undo step.
  const first = sheet(page).locator(`[data-sheet-text] text[data-key="item:${note}"]`).first();
  const box = await first.boundingBox();
  if (!box) throw new Error('No text');
  await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
  const field = sheet(page).locator('[data-sheet-editor="text"]');
  await expect(field).toBeFocused();
  await page.keyboard.press('Control+a');
  await page.keyboard.type('NOTES (edited)');
  await page.keyboard.press('Enter');
  await expect.poll(() => itemTexts(page)).toContain('NOTES (edited)');
  await page.keyboard.press('Control+z');
  await expect.poll(() => itemTexts(page)).toContain('NOTES');
  await page.keyboard.press('Escape');

  // The view's Centre lines switch hides its centre mark and line; nothing else changes.
  await browser(page).locator(`[data-sheet-view-row="${top}"]`).getByRole('button').click();
  const card = page.getByRole('region', { name: 'View', exact: true });
  await card.getByRole('switch', { name: 'Centre lines' }).click();
  await expect(paths(page, mark)).toHaveCount(0);
  await expect(paths(page, line)).toHaveCount(0);
  await page.keyboard.press('Control+z');
  await expect(paths(page, mark)).not.toHaveCount(0);
  await page.keyboard.press('Escape');

  // The export leaves the screen-only sticky note out and says so; printed, it is in.
  let pdf = pdfContent(await exportPdf(page, /· 1 sticky note left out$/));
  expect(pdf).toContain(`<${hexOf('2 × Ø5 through')}> Tj`);
  expect(pdf).not.toContain(`<${hexOf('Check the fit')}> Tj`);
  await row(page, sticky).getByRole('button').click();
  const stickyCard = page.getByRole('region', { name: 'Sticky note' });
  await stickyCard.getByRole('switch', { name: 'Print' }).click();
  await expect.poll(() => itemTexts(page)).not.toContain('On screen only');
  await shot(page, 'sticky-card');
  const printed = await exportPdf(page, /^1 page · A3 landscape$/);
  if (process.env.SHEET_SHOTS) {
    await writeFile(join(process.env.SHEET_SHOTS, 'export.pdf'), printed);
  }
  pdf = pdfContent(printed);
  expect(pdf).toContain(`<${hexOf('Check the fit')}> Tj`);
  expect(pdf).toContain(`<${hexOf('NOTES')}> Tj`);

  // The holes deleted (Extrude2): the leader on a hole is lost and says why; dragging its
  // handle onto the foot's edge picks that; undo, and undo again brings the holes back.
  await page.getByRole('button', { name: 'Finish Drawing' }).first().click();
  await chip(page, 'Extrude2').click({ button: 'right' });
  await menuItem(page, 'Delete').click();
  await browser(page).locator('[data-sheet-row]').first().dblclick();
  await expect(row(page, leader)).toHaveAttribute('data-state', 'detached', { timeout: 60_000 });
  await expect(row(page, dot)).toHaveAttribute('data-state', 'ok');
  await row(page, leader).getByRole('button').click();
  await expect(status(page)).toHaveText('The feature this was drawn on is deleted.');
  await expect(page.getByRole('region', { name: 'Leader note' })).toContainText('deleted');
  await shot(page, 'leader-lost');
  const handle = sheet(page).locator('[data-repick-handle="0"]');
  await expect(handle).toBeVisible();
  const [ux0, uy0, ux1] = await viewBox(page, top);
  const from = await handle.boundingBox();
  const to = await onSheet(page, (ux0 + ux1) / 2 + 10, uy0);
  if (!from) throw new Error('No handle');
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await expect(sheet(page).locator('[data-dimension-hover]')).toHaveCount(1);
  await page.mouse.up();
  await expect(row(page, leader)).toHaveAttribute('data-state', 'ok');
  await page.keyboard.press('Control+z');
  await expect(row(page, leader)).toHaveAttribute('data-state', 'detached');
  await page.keyboard.press('Control+z');
  await expect(row(page, leader)).toHaveAttribute('data-state', 'ok', { timeout: 60_000 });
  await expect(row(page, mark)).toHaveAttribute('data-state', 'ok');
});
