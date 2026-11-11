import { readFile } from 'node:fs/promises';
import { type Download, expect, type Page, test } from '@playwright/test';
import { openProject, pickTool, selectTab, toolbarTabs } from './helpers';

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
const drawings = (page: Page) =>
  page.getByRole('complementary', { name: 'Browser' }).locator('[data-sheet-row]');
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

/** Types into a Sheet Setup field and commits it with Enter. */
async function type(page: Page, field: string, text: string) {
  const box = setup(page).getByRole('textbox', { name: field, exact: true });
  await box.fill(text);
  await box.press('Enter');
}

test('enter from Make, set up a sheet, finish, and undo each step', async ({ page }) => {
  const viewport = await openProject(page);
  await newDrawing(page);

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
  await expect(page.getByRole('complementary', { name: 'Browser' })).toContainText('No sheets yet');
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

  // Export PDF: one file, a page per sheet, at A3's size in points.
  const [download] = (await Promise.all([
    page.waitForEvent('download'),
    page.locator('#toolbar-groups [data-label="Export PDF"]').click(),
  ])) as [Download, unknown];
  expect(download.suggestedFilename()).toBe('Untitled.pdf');
  const pdf = (await readFile(await download.path())).toString('latin1');
  expect(pdf.startsWith('%PDF-')).toBe(true);
  expect(pdf.match(/\/Type \/Page /g)).toHaveLength(2);
  expect(pdf).toContain('/MediaBox [0 0 1190.551 841.89]');

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
