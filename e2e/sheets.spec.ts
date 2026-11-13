import { readFile, writeFile } from 'node:fs/promises';
import { type Download, expect, type Page, test } from '@playwright/test';
import {
  createDocument,
  type SheetId,
  type SheetItemId,
  type SheetViewId,
} from '../packages/core/src/index';
import { writeArchive } from '../packages/storage/src/archive';
import { fileAction, openProject, pickTool, selectTab, toolbarTabs } from './helpers';

// P6-24 S1, the Drawing mode (ADR-0143's S1 mode amendment): Make › Drawing opens New
// drawing, Create Drawing adds a sheet and enters the mode (Home and Drawing tabs, the sheet
// in place of the 3D view, sheet tabs in place of the timeline). Every Sheet Setup change is
// one undo step; Finish Drawing is none, and Esc never leaves the mode.

test.use({ viewport: { width: 1440, height: 900 } });
test.describe.configure({ timeout: 120_000 });

let errors: string[] = [];

test.beforeEach(async ({ page }) => {
  errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

const sheet = (page: Page) => page.getByRole('region', { name: 'Sheet', exact: true });
const setup = (page: Page) => page.getByRole('region', { name: 'Sheet setup' });
const tabs = (page: Page) => page.getByRole('list', { name: 'Sheet tabs' });
const browser = (page: Page) => page.getByRole('complementary', { name: 'Browser' });
const drawings = (page: Page) => browser(page).locator('[data-sheet-row]');
/**
 * The title block's title as the sheet draws it (the invisible text layer): the cell's
 * label ("TITLE") comes first under the same key, its value last.
 */
const titleText = (page: Page) =>
  sheet(page).locator('[data-sheet-text] [data-key="title-block:title"]').last();

/** Make › Drawing, then New drawing's Create Drawing: the mode with one A3 sheet. */
async function newDrawing(page: Page) {
  await selectTab(page, 'Make');
  await pickTool(page, 'Drawing');
  const dialog = page.getByRole('dialog', { name: 'New drawing' });
  await expect(dialog.locator('[data-new-sheets-summary]')).toHaveText(
    'One empty A3 landscape sheet.',
  );
  await dialog.getByRole('button', { name: 'Create Drawing' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(sheet(page)).toHaveAttribute('data-paper', '420x297');
  // The fonts load first: the title block's text is drawn once they are in.
  await expect(titleText(page)).toHaveText('Untitled');
}

/** Runs `click` and returns the download it starts, with its text. */
async function downloaded(page: Page, click: () => Promise<unknown>) {
  const [download] = (await Promise.all([page.waitForEvent('download'), click()])) as [
    Download,
    unknown,
  ];
  return {
    name: download.suggestedFilename(),
    text: (await readFile(await download.path())).toString('latin1'),
  };
}

/** Types into a Sheet Setup field and commits it with Enter. */
async function type(page: Page, field: string, text: string) {
  const box = setup(page).getByRole('textbox', { name: field, exact: true });
  await box.fill(text);
  await box.press('Enter');
}

test('enter from Make, set up a sheet, finish, and undo each step', async ({ page }) => {
  const viewport = await openProject(page);
  // A folder opened in the model's browser (closed by default) is open again afterwards.
  const settings = browser(page).getByRole('button', { name: 'Document settings' });
  await settings.click();
  await expect(settings).toHaveAttribute('aria-expanded', 'true');
  await newDrawing(page);
  await expect(settings).toBeHidden();

  // The mode's chrome: Home and Drawing, the Drawing tab's tools, sheet tabs, the status.
  await expect(toolbarTabs(page).getByRole('tab')).toHaveText(['Home', 'Drawing']);
  for (const tool of ['New Sheet', 'Sheet Setup', 'Export PDF', 'Finish Drawing']) {
    await expect(page.locator(`#toolbar-groups [data-label="${tool}"]`)).toHaveCount(1);
  }
  await expect(page.getByRole('region', { name: 'Timeline' })).toHaveCount(0);
  await expect(tabs(page).locator('[data-sheet-tab]')).toHaveText(['1 · Sheet 1']);
  await expect(page.locator('output[aria-label="Status"]')).toHaveText(
    'Editing drawing · sheet 1 of 1 · A3 landscape · 1:1 · mm',
  );
  // White paper with the border and the simple title block, drawn from the display list.
  for (const key of ['paper', 'border', 'title-block']) {
    await expect(sheet(page).locator(`path[data-key="${key}"]`).first()).toBeAttached();
  }
  // The 3D view stays mounted underneath, inert.
  await expect(viewport).toBeAttached();
  // Esc never leaves the mode.
  await page.keyboard.press('Escape');
  await expect(sheet(page)).toBeVisible();

  await type(page, 'Sheet name', 'Assembly');
  await expect(tabs(page).locator('[data-sheet-tab]')).toHaveText(['1 · Assembly']);
  await setup(page).getByRole('combobox', { name: 'Paper' }).selectOption('A4');
  await expect(sheet(page)).toHaveAttribute('data-paper', '297x210');
  await type(page, 'Title', 'Bracket drawing');
  await expect(titleText(page)).toHaveText('Bracket drawing');

  // Finish Drawing: back to the model, the sheet listed under Drawings.
  await setup(page).getByRole('button', { name: 'Finish Drawing' }).click();
  await expect(sheet(page)).toHaveCount(0);
  await expect(toolbarTabs(page).getByRole('tab', { name: 'Solid' })).toBeVisible();
  await expect(drawings(page)).toHaveText(['1 · AssemblyA4']);
  await expect(settings).toHaveAttribute('aria-expanded', 'true');

  // Finish is no undo step: the first undo takes back the title.
  await drawings(page).first().dblclick();
  await expect(titleText(page)).toHaveText('Bracket drawing');
  await page.keyboard.press('Control+z');
  await expect(titleText(page)).toHaveText('Untitled');
  await page.keyboard.press('Control+z');
  await expect(sheet(page)).toHaveAttribute('data-paper', '420x297');
  await page.keyboard.press('Control+z');
  await expect(tabs(page).locator('[data-sheet-tab]')).toHaveText(['1 · Sheet 1']);
  // Undoing New drawing takes the last sheet away, and the drawing ends with it.
  await page.keyboard.press('Control+z');
  await expect(sheet(page)).toHaveCount(0);
  await expect(browser(page)).toContainText('No sheets yet');
});

test('sheet tabs: add, switch, rename, duplicate, delete; Fit and the model-only tools', async ({
  page,
}) => {
  await openProject(page);
  await newDrawing(page);
  const tab = (name: string) => tabs(page).locator('[data-sheet-tab]').filter({ hasText: name });

  await tabs(page).getByRole('button', { name: 'New sheet' }).click();
  await expect(tabs(page).locator('[data-sheet-tab]')).toHaveText(['1 · Sheet 1', '2 · Sheet 2']);
  await expect(tab('Sheet 2').getByRole('button')).toHaveAttribute('aria-current', 'page');
  // Ctrl+PageUp and Ctrl+PageDown step through the tabs.
  await page.keyboard.press('Control+PageUp');
  await expect(tab('Sheet 1').getByRole('button')).toHaveAttribute('aria-current', 'page');
  await page.keyboard.press('Control+PageDown');
  await expect(tab('Sheet 2').getByRole('button')).toHaveAttribute('aria-current', 'page');

  // Double-click renames in place; the menu duplicates and deletes.
  await tab('Sheet 2').getByRole('button').dblclick();
  const rename = tabs(page).getByRole('textbox', { name: 'Rename Sheet 2' });
  await rename.fill('Lid');
  await rename.press('Enter');
  await tab('Lid').getByRole('button').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Duplicate' }).click();
  await expect(tabs(page).locator('[data-sheet-tab]')).toHaveText([
    '1 · Sheet 1',
    '2 · Lid',
    '3 · Lid copy',
  ]);
  await tab('Lid copy').getByRole('button').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  await expect(tabs(page).locator('[data-sheet-tab]')).toHaveText(['1 · Sheet 1', '2 · Lid']);

  // The wheel zooms at the pointer; F6 fits the sheet again.
  const fitted = await sheet(page).getAttribute('data-zoom');
  const box = await sheet(page).boundingBox();
  if (!box) throw new Error('No sheet');
  await page.mouse.move(box.x + box.width / 3, box.y + box.height / 2);
  await page.mouse.wheel(0, -400);
  await expect(sheet(page)).not.toHaveAttribute('data-zoom', fitted ?? '');
  await page.keyboard.press('F6');
  await expect(sheet(page)).toHaveAttribute('data-zoom', fitted ?? '');

  // Home's model-only tools say why they don't run; Parameters does.
  await selectTab(page, 'Home');
  await pickTool(page, 'Canvas');
  await expect(page.getByText('Finish the drawing to use Canvas.')).toBeVisible();
  await pickTool(page, 'Parameters');
  await expect(page.getByRole('dialog', { name: /Parameters/ })).toBeVisible();
});

test('Export drawing: PDF or an SVG per sheet, the format remembered; the saved file reopens', async ({
  page,
}, info) => {
  await openProject(page);
  await newDrawing(page);
  await tabs(page).getByRole('button', { name: 'New sheet' }).click();
  await setup(page).getByRole('combobox', { name: 'Paper' }).selectOption('A4');
  await expect(sheet(page)).toHaveAttribute('data-paper', '297x210');

  // Export PDF opens the dialog on every sheet: one PDF, a page per sheet.
  await page.locator('#toolbar-groups [data-label="Export PDF"]').click();
  const dialog = page.getByRole('dialog', { name: 'Export drawing' });
  const summary = dialog.locator('[data-sheet-export-summary]');
  await expect(summary).toHaveText('2 pages · A3 landscape, A4 landscape');
  await expect(dialog.getByRole('radio', { name: 'PDF' })).toHaveAttribute('aria-checked', 'true');
  await expect(dialog.getByRole('textbox', { name: 'File name' })).toHaveValue('Untitled');
  const pdf = await downloaded(page, () => dialog.getByRole('button', { name: 'Export' }).click());
  await expect(dialog).toHaveCount(0);
  expect(pdf.name).toBe('Untitled.pdf');
  expect(pdf.text.startsWith('%PDF-')).toBe(true);
  expect(pdf.text.match(/\/Type \/Page /g)).toHaveLength(2);
  expect(pdf.text).toContain('/MediaBox [0 0 1190.551 841.89]');
  expect(pdf.text).toContain('/MediaBox [0 0 841.89 595.276]');

  // SVG of the second sheet only: no sheet chosen can't export.
  await page.locator('#toolbar-groups [data-label="Export PDF"]').click();
  await dialog.getByRole('radio', { name: 'SVG' }).click();
  await expect(summary).toHaveText('2 SVG files · A3 landscape, A4 landscape');
  await dialog.getByRole('checkbox', { name: '1 · Sheet 1' }).uncheck();
  await dialog.getByRole('checkbox', { name: '2 · Sheet 2' }).uncheck();
  await expect(summary).toHaveText('Choose at least one sheet.');
  await expect(dialog.getByRole('button', { name: 'Export' })).toBeDisabled();
  await dialog.getByRole('checkbox', { name: '2 · Sheet 2' }).check();
  await expect(summary).toHaveText('1 SVG file · A4 landscape');
  await dialog.getByRole('textbox', { name: 'File name' }).fill('Lid');
  const svg = await downloaded(page, () => dialog.getByRole('button', { name: 'Export' }).click());
  expect(svg.name).toBe('Lid.svg');
  expect(svg.text).toContain('width="297mm" height="210mm" viewBox="0 0 297 210"');

  // The format is remembered; Export This Sheet chooses that sheet and names the file after it.
  const tab = tabs(page).locator('[data-sheet-tab]').filter({ hasText: 'Sheet 1' });
  await tab.getByRole('button').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Export This Sheet' }).click();
  await expect(dialog.getByRole('radio', { name: 'SVG' })).toHaveAttribute('aria-checked', 'true');
  await expect(dialog.getByRole('checkbox', { name: '1 · Sheet 1' })).toBeChecked();
  await expect(dialog.getByRole('checkbox', { name: '2 · Sheet 2' })).not.toBeChecked();
  await expect(dialog.getByRole('textbox', { name: 'File name' })).toHaveValue(
    'Untitled - Sheet 1',
  );
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);

  // Saved as an .extrudo and opened again, the design has both sheets.
  await setup(page).getByRole('button', { name: 'Finish Drawing' }).click();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    fileAction(page, 'Export .extrudo'),
  ]);
  const file = info.outputPath('drawing.extrudo');
  await download.saveAs(file);
  await page.goto('./');
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.getByRole('button', { name: 'Import…', exact: true }).click(),
  ]);
  await chooser.setFiles(file);
  await expect(drawings(page)).toHaveText(['1 · Sheet 1A3', '2 · Sheet 2A4']);
  await drawings(page).nth(1).dblclick();
  await expect(sheet(page)).toHaveAttribute('data-paper', '297x210');
});

/** A design with one sheet holding a text item and a view (drawn as its placeholder). */
async function fixture(path: string) {
  const doc = createDocument({ name: 'Selection' });
  doc.sheets = [
    {
      id: 's1' as SheetId,
      name: 'Sheet 1',
      size: 'A3',
      orientation: 'landscape',
      scale: [1, 1],
      projection: 'first',
      decimals: 1,
      border: {},
      titleBlock: { template: 'simple', fields: { title: 'Selection' } },
      views: [
        {
          id: 'v1' as SheetViewId,
          name: 'Front',
          at: [200, 150],
          from: { kind: 'base', direction: [0, 1, 0], up: [0, 0, 1] },
        },
      ],
      items: [{ kind: 'text', id: 't1' as SheetItemId, at: [40, 40], text: 'A note' }],
    },
  ];
  await writeFile(path, writeArchive(doc));
}

/** The screen point of sheet point (`x`, `y`) mm. */
async function onSheet(page: Page, x: number, y: number) {
  const box = await sheet(page).locator('[data-sheet-paper]').boundingBox();
  if (!box) throw new Error('No paper');
  return { x: box.x + (x / 420) * box.width, y: box.y + (y / 297) * box.height };
}

/** The left edge (mm) of a target's selection frame. */
async function frameX(page: Page, target: string) {
  return Number(await sheet(page).locator(`[data-sheet-frame="${target}"] rect`).getAttribute('x'));
}

test('selecting on the sheet: hover, click, toggle, box, title block, move, nudge, delete, undo', async ({
  page,
}, info) => {
  const file = info.outputPath('selection.extrudo');
  await fixture(file);
  await page.goto('./');
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.getByRole('button', { name: 'Import…', exact: true }).click(),
  ]);
  await chooser.setFiles(file);
  await drawings(page).first().dblclick();
  await expect(sheet(page).locator('path[data-key="item:t1"]').first()).toBeAttached();
  const text = await onSheet(page, 46, 41.5);
  const view = await onSheet(page, 200, 140);

  // Hover pre-highlights; a click selects; Ctrl toggles another in.
  await page.mouse.move(text.x, text.y);
  await expect(sheet(page)).toHaveAttribute('data-hover', 'item:t1');
  await page.mouse.click(text.x, text.y);
  await expect(sheet(page)).toHaveAttribute('data-selected', 'item:t1');
  // A text's own card (S4): its Text.
  await expect(
    page.getByRole('region', { name: 'Text', exact: true }).getByRole('textbox', { name: 'Text' }),
  ).toHaveValue('A note');
  await page.keyboard.down('Control');
  await page.mouse.click(view.x, view.y);
  await page.keyboard.up('Control');
  await expect(sheet(page)).toHaveAttribute('data-selected', 'item:t1 view:v1');
  // A click on empty paper clears; a box on empty paper selects what lies wholly inside it.
  const empty = await onSheet(page, 100, 220);
  await page.mouse.click(empty.x, empty.y);
  await expect(sheet(page)).not.toHaveAttribute('data-selected', /./);
  const corner = await onSheet(page, 30, 30);
  const across = await onSheet(page, 120, 60);
  await page.mouse.move(corner.x, corner.y);
  await page.mouse.down();
  await page.mouse.move(across.x, across.y, { steps: 5 });
  await page.mouse.up();
  await expect(sheet(page)).toHaveAttribute('data-selected', 'item:t1');

  // The title block selected shows its fields.
  const block = await onSheet(page, 380, 280);
  await page.mouse.click(block.x, block.y);
  await expect(sheet(page)).toHaveAttribute('data-selected', 'title-block');
  await expect(page.getByRole('region', { name: 'Title block' })).toBeVisible();
  await expect(
    page.getByRole('region', { name: 'Title block' }).getByRole('textbox', { name: 'Title' }),
  ).toHaveValue('Selection');

  // A drag moves the view; the arrows nudge it 1 mm, 10 with Shift. Each is one undo step.
  // Snap off (S4): the drag moves exactly as far as the pointer.
  await page.getByRole('button', { name: 'Snap', exact: true }).click();
  await page.mouse.click(view.x, view.y);
  await expect(sheet(page)).toHaveAttribute('data-selected', 'view:v1');
  const x0 = await frameX(page, 'view:v1');
  const to = await onSheet(page, 220, 140);
  await page.mouse.move(view.x, view.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => frameX(page, 'view:v1')).toBeCloseTo(x0 + 20, 0);
  const x1 = await frameX(page, 'view:v1');
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => frameX(page, 'view:v1')).toBeCloseTo(x1 + 1, 2);
  await page.keyboard.press('Shift+ArrowLeft');
  await expect.poll(() => frameX(page, 'view:v1')).toBeCloseTo(x1 - 9, 2);
  // Delete takes the view away.
  await page.keyboard.press('Delete');
  await expect(sheet(page).locator('path[data-key="view:v1"]')).toHaveCount(0);

  // Undo each step: the view comes back, then each move goes back.
  await page.keyboard.press('Control+z');
  await expect(sheet(page).locator('path[data-key="view:v1"]').first()).toBeAttached();
  // Selected again (its frame is what the checks read): it lies 11 mm right of where it began.
  await page.mouse.click(view.x, view.y);
  await expect(sheet(page)).toHaveAttribute('data-selected', 'view:v1');
  await page.keyboard.press('Control+z');
  await expect.poll(() => frameX(page, 'view:v1')).toBeCloseTo(x1 + 1, 2);
  await page.keyboard.press('Control+z');
  await expect.poll(() => frameX(page, 'view:v1')).toBeCloseTo(x1, 2);
  await page.keyboard.press('Control+z');
  await expect.poll(() => frameX(page, 'view:v1')).toBeCloseTo(x0, 2);
});
