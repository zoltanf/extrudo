import { readFile, writeFile } from 'node:fs/promises';
import { expect, type Locator, type Page, test } from '@playwright/test';
import { exportModel } from './benchmark-helpers';
import { fileAction, kernelReady, openProject, selectTab } from './helpers';

// P4-06, slice 2: a STEP file as solid bodies (ADR-0066 §0, §2). The Insert
// tab's Import picks the file, stores its bytes with the design, and opens the
// dialog, which previews what the file holds; OK adds the file's record and the
// feature as one undo step. The file travels: an exported design imported as a
// new one still has the bodies.

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

/** The STEP file our own `writeStep` wrote of B3's two bodies (P4-06's fixture). */
const STEP_FILE = 'fixtures/imports/b3.step';

const viewport = (page: Page) => page.getByRole('region', { name: 'Viewport' });
const dialog = (page: Page, name = 'Import dialog') => page.getByRole('region', { name });
const chip = (page: Page, name: string) =>
  page
    .getByRole('list', { name: 'Features' })
    .getByRole('button', { name: new RegExp(`^${name}`) });

/**
 * "Body1:6:60,80,10" per drawn body: its name, face count and size in mm. A
 * body's name may hold spaces (a file's part name), so the entries are matched
 * whole rather than split on them.
 */
async function bodies(page: Page) {
  const drawn = (await viewport(page).getAttribute('data-bodies')) ?? '';
  return [...drawn.matchAll(/(?:^|\s)([^:]+):(\d+):([-\d.,]+)(?=\s|$)/g)].map((match) => ({
    name: match[1] ?? '',
    faces: Number(match[2]),
    size: (match[3] ?? '').split(',').map(Number),
  }));
}

/** The Insert tab's Import tile, then a file through the platform's picker. */
async function importFile(
  page: Page,
  file: string | { name: string; mimeType: string; buffer: Buffer },
): Promise<Locator> {
  const chooser = page.waitForEvent('filechooser');
  await selectTab(page, 'Home');
  await page.getByRole('button', { name: 'Import Model', exact: true }).click();
  await (await chooser).setFiles(file);
  const panel = dialog(page);
  await expect(panel).toBeVisible();
  return panel;
}

/** The drawn bodies' sizes, in mm. */
const sizes = async (page: Page) => (await bodies(page)).map((b) => b.size);

test('a STEP file becomes one body per solid, and undo takes it away', async ({ page }) => {
  await openProject(page);
  await kernelReady(page);
  expect(await bodies(page)).toEqual([]);

  const panel = await importFile(page, STEP_FILE);
  // The file is named, with its size; a STEP file has no Units of its own here.
  await expect(panel.locator('[data-info="file"]')).toContainText('b3.step');
  await expect(panel.getByRole('combobox', { name: 'Units' })).toHaveCount(0);
  // And no As solid: a STEP file comes in as a solid already (ADR-0097 §6).
  await expect(panel.getByRole('checkbox', { name: 'As solid' })).toHaveCount(0);
  // A new import is centred on the origin, on the XY plane (2026-11-04).
  await expect(panel.getByRole('combobox', { name: 'Position' })).toHaveValue('centre');
  // The live preview drew the two solids before OK.
  await expect(panel).toHaveAttribute('data-preview-status', 'ok', { timeout: 60_000 });

  await panel.getByRole('button', { name: /^OK/ }).click();
  await expect(chip(page, 'Import1')).toBeVisible();
  await expect
    .poll(async () => sizes(page), { timeout: 30_000 })
    .toEqual([
      [60, 80, 10],
      [60, 31.8, 60],
    ]);
  expect((await bodies(page)).map((b) => b.faces)).toEqual([6, 6]);
  // The file's part names became the bodies' names (ADR-0034's amendment).
  expect((await bodies(page)).map((b) => b.name)).toEqual(['Stand base', 'Stand rest']);

  // One undo step: the bodies go with the feature (and its file's record).
  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await bodies(page)).length).toBe(0);
  await expect(chip(page, 'Import1')).toHaveCount(0);
  await page.keyboard.press('Control+Shift+z');
  await expect(chip(page, 'Import1')).toBeVisible();
  await expect.poll(async () => (await bodies(page)).length).toBe(2);
});

test('a solid the file hides comes in as a hidden body', async ({ page }) => {
  await openProject(page);
  await kernelReady(page);
  // B3's file with its second solid (the back rest) listed in an INVISIBILITY
  // entity, the way a converted file hides a shape (ADR-0066's amendment of
  // 2026-11-10).
  const text = await readFile(STEP_FILE, 'latin1');
  const solids = [...text.matchAll(/#(\d+) = MANIFOLD_SOLID_BREP/g)].map((m) => m[1]);
  expect(solids).toHaveLength(2);
  const end = text.lastIndexOf('ENDSEC;');
  const hiding = `${text.slice(0, end)}#9100 = INVISIBILITY((#${solids[1]}));\n${text.slice(end)}`;
  const panel = await importFile(page, {
    name: 'b3-hidden.step',
    mimeType: 'model/step',
    buffer: Buffer.from(hiding, 'latin1'),
  });
  await expect(panel).toHaveAttribute('data-preview-status', 'ok', { timeout: 60_000 });
  await panel.getByRole('button', { name: /^OK/ }).click();
  await expect(chip(page, 'Import1')).toBeVisible();

  // Both solids are bodies, and only the one the file shows is drawn.
  const row = (name: string) =>
    page.locator('[data-body]').filter({ has: page.getByRole('button', { name, exact: true }) });
  await expect(row('Stand rest')).toHaveAttribute('data-body-display', 'hidden', {
    timeout: 30_000,
  });
  await expect(row('Stand base')).toHaveAttribute('data-body-display', 'shown');
  expect((await bodies(page)).map((b) => b.name)).toEqual(['Stand base']);

  // Its eye shows it, and it stays shown through a recompute of the import.
  await page.getByRole('button', { name: 'Show Stand rest', exact: true }).click();
  await expect
    .poll(async () => (await bodies(page)).map((b) => b.name))
    .toEqual(['Stand base', 'Stand rest']);
  await chip(page, 'Import1').dblclick();
  const edit = dialog(page, 'Edit Import1 dialog');
  await edit.getByRole('combobox', { name: 'Up' }).selectOption('y');
  await expect(edit).toHaveAttribute('data-preview-status', 'ok', { timeout: 60_000 });
  await edit.getByRole('button', { name: /^OK/ }).click();
  await expect
    .poll(async () => sizes(page), { timeout: 30_000 })
    .toEqual([
      [60, 10, 80],
      [60, 60, 31.8],
    ]);
  await expect(row('Stand rest')).toHaveAttribute('data-body-display', 'shown');
});

test('Up y turns the file a quarter turn about X', async ({ page }) => {
  await openProject(page);
  await kernelReady(page);
  await (await importFile(page, STEP_FILE)).getByRole('button', { name: /^OK/ }).click();
  await expect.poll(async () => (await bodies(page)).length, { timeout: 30_000 }).toBe(2);

  // Editing from the timeline chip: the dialog shows the file it read.
  await chip(page, 'Import1').dblclick();
  const edit = dialog(page, 'Edit Import1 dialog');
  await expect(edit).toBeVisible();
  await expect(edit.locator('[data-info="file"]')).toContainText('b3.step');
  await edit.getByRole('combobox', { name: 'Up' }).selectOption('y');
  await expect(edit).toHaveAttribute('data-preview-status', 'ok', { timeout: 60_000 });
  await edit.getByRole('button', { name: /^OK/ }).click();
  // (x, y, z) → (x, −z, y): the sizes' y and z swap, and the bodies keep their
  // order (the larger one is still first).
  await expect
    .poll(async () => sizes(page), { timeout: 30_000 })
    .toEqual([
      [60, 10, 80],
      [60, 60, 31.8],
    ]);
  // One undo step for the edit too.
  await page.keyboard.press('Control+z');
  await expect
    .poll(async () => sizes(page), { timeout: 30_000 })
    .toEqual([
      [60, 80, 10],
      [60, 31.8, 60],
    ]);
});

test('the file travels with an exported design', async ({ page }, info) => {
  await openProject(page);
  await kernelReady(page);
  await (await importFile(page, STEP_FILE)).getByRole('button', { name: /^OK/ }).click();
  await expect.poll(async () => (await bodies(page)).length, { timeout: 30_000 }).toBe(2);

  const file = info.outputPath('imported.extrudo');
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    fileAction(page, 'Export .extrudo'),
  ]);
  await download.saveAs(file);

  await page.goto('./');
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.getByRole('button', { name: 'Import…', exact: true }).click(),
  ]);
  await chooser.setFiles(file);
  await expect(page).toHaveURL(/#\/p\/[0-9a-f-]+$/);
  await kernelReady(page);
  await expect(chip(page, 'Import1')).toBeVisible();
  await expect
    .poll(async () => sizes(page), { timeout: 60_000 })
    .toEqual([
      [60, 80, 10],
      [60, 31.8, 60],
    ]);
  expect(await page.getByText(/is missing from this design/).count()).toBe(0);
});

const browserOf = (page: Page) => page.getByRole('complementary', { name: 'Browser' });

/** A body's colour through its Appearance panel's hex field (one undo step). */
async function colourBody(page: Page, name: string, hex: string) {
  await browserOf(page).getByRole('button', { name, exact: true }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Appearance…' }).click();
  const panel = page.getByRole('dialog', { name: `${name} appearance` });
  const field = panel.getByRole('textbox', { name: 'Hex colour' });
  await field.fill(hex);
  await field.press('Enter');
  await field.blur();
  await panel.getByRole('radio', { name: 'Opaque' }).focus();
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
}

test("a STEP file's colours colour the imported bodies once (P4-12)", async ({ page }, info) => {
  // The Wall bracket coloured through Appearance, exported as STEP: the body's
  // colour is its solid's styled item (ADR-0034's amendment).
  const view = await openProject(page, 'wall-bracket');
  await kernelReady(page);
  await colourBody(page, 'Bracket', '#c81e28');
  await expect(view).toHaveAttribute('data-body-appearance', 'Bracket:#c81e28:1');
  const step = await exportModel(page, 'STEP');
  const text = step.bytes.toString('latin1');
  expect(text.match(/COLOUR_RGB/g)).toHaveLength(1);
  expect(text).toContain("PRODUCT('Bracket','Bracket'");
  const file = info.outputPath('red-bracket.step');
  await writeFile(file, step.bytes);

  // Imported into a new design, the body comes in red.
  await openProject(page);
  await kernelReady(page);
  const panel = await importFile(page, file);
  await expect(panel).toHaveAttribute('data-preview-status', 'ok', { timeout: 60_000 });
  await panel.getByRole('button', { name: /^OK/ }).click();
  await expect.poll(async () => sizes(page), { timeout: 30_000 }).toEqual([[40, 80, 60]]);
  await expect(viewport(page)).toHaveAttribute('data-body-appearance', 'Bracket:#c81e28:1');

  // Recoloured by the user, it stays so when the import changes (Up y): the
  // document's metadata wins over the file's colour.
  await colourBody(page, 'Bracket', '#22b3c2');
  await expect(viewport(page)).toHaveAttribute('data-body-appearance', 'Bracket:#22b3c2:1');
  await chip(page, 'Import1').dblclick();
  const edit = dialog(page, 'Edit Import1 dialog');
  await edit.getByRole('combobox', { name: 'Up' }).selectOption('y');
  await expect(edit).toHaveAttribute('data-preview-status', 'ok', { timeout: 60_000 });
  await edit.getByRole('button', { name: /^OK/ }).click();
  await expect.poll(async () => sizes(page), { timeout: 30_000 }).toEqual([[40, 60, 80]]);
  await expect(viewport(page)).toHaveAttribute('data-body-appearance', 'Bracket:#22b3c2:1');
});

test('a file that is not a STEP file says so and cannot be committed', async ({ page }, info) => {
  await openProject(page);
  await kernelReady(page);
  const rubbish = info.outputPath('not-a-model.step');
  await writeFile(rubbish, 'ISO-8859-1;\nthis is not a STEP file\n');

  const panel = await importFile(page, rubbish);
  await expect(panel).toHaveAttribute('data-preview-status', 'error', { timeout: 60_000 });
  await expect(panel.getByRole('status', { name: 'Feature status' })).toBeVisible();
  await expect(panel.getByRole('status', { name: 'Feature status' })).not.toContainText(
    'Internal error',
  );
  await expect(panel).not.toHaveAttribute('data-dialog-valid', 'true');
  // OK can't run: the button is disabled, so nothing is committed.
  await expect(panel.getByRole('button', { name: /^OK/ })).toHaveAttribute('aria-disabled', 'true');
  await expect(chip(page, 'Import1')).toHaveCount(0);
  expect(await bodies(page)).toEqual([]);
});

test('the Home tab imports, and the drawing import needs a sketch', async ({ page }) => {
  await openProject(page);
  await kernelReady(page);

  // Outside a sketch the drawing import says why it can't run.
  await selectTab(page, 'Home');
  await page.locator('[data-tool="importDrawing"]').click();
  await expect(page.getByText('Open a sketch to import an SVG or DXF file into it.')).toBeVisible();

  // Home's Import is the same command whatever opened it.
  const chooser = page.waitForEvent('filechooser');
  await fileAction(page, 'Import Model');
  await (await chooser).setFiles(STEP_FILE);
  const panel = dialog(page);
  await expect(panel).toBeVisible();
  await expect(panel.locator('[data-info="file"]')).toContainText('b3.step');
  await panel.getByRole('button', { name: 'Cancel Esc' }).click();
  // Cancelling adds nothing: no feature, and no bodies.
  await expect(chip(page, 'Import1')).toHaveCount(0);
  expect(await bodies(page)).toEqual([]);
});
